// Export per-function facts and pseudo-C for a GBA program analysed by GbaSetup
// (+ GbaDiscover). Writes <out>/functions.jsonl, <out>/strings.json and
// <out>/summary.json. Decompile failures/timeouts are recorded, never dropped.
//
// Script args (key=value): out=<dir> (required), run_id=<id>, script_hash=<hash>,
//   decompile=1, decomp_threads=3, decomp_timeout=30 (seconds per function),
//   max_list=256 (cap for per-function address lists)
// @category GBA
import java.io.*;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

import com.google.gson.*;

import ghidra.app.decompiler.*;
import ghidra.app.script.GhidraScript;
import ghidra.framework.Application;
import ghidra.program.model.address.*;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.*;
import ghidra.program.model.pcode.*;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.*;
import ghidra.util.task.TaskMonitor;

public class GbaExport extends GhidraScript {

	static final long ROM_BASE = 0x08000000L, IO_BASE = 0x04000000L, IO_END = 0x04000400L;

	Program p;
	long romEnd;
	TreeMap<Long, String[]> ioRegs = new TreeMap<>(); // start -> {name, size}
	int maxList;

	static String hex(long v) {
		return String.format("0x%08x", v);
	}

	@Override
	public void run() throws Exception {
		long t0 = System.currentTimeMillis();
		p = currentProgram;
		Map<String, String> args = new LinkedHashMap<>();
		for (String s : getScriptArgs()) {
			int i = s.indexOf('=');
			if (i > 0) args.put(s.substring(0, i), s.substring(i + 1));
		}
		String out = args.get("out");
		if (out == null) throw new IllegalArgumentException("out=<dir> required");
		boolean decompile = !"0".equals(args.getOrDefault("decompile", "1"));
		boolean autoAnalysis = !"0".equals(args.getOrDefault("auto_analysis", "1"));
		boolean reusedProject = "1".equals(args.getOrDefault("reuse_project", "0"));
		boolean repairReturns = "1".equals(args.getOrDefault("repair_returns", "0"));
		int threads = Integer.parseInt(args.getOrDefault("decomp_threads", "3"));
		int timeout = Integer.parseInt(args.getOrDefault("decomp_timeout", "30"));
		maxList = Integer.parseInt(args.getOrDefault("max_list", "256"));
		Path outDir = Paths.get(out);
		Files.createDirectories(outDir);

		MemoryBlock rom = p.getMemory().getBlock(toAddr(ROM_BASE));
		romEnd = rom.getEnd().getOffset() + 1;
		for (Symbol s : p.getSymbolTable().getAllSymbols(false)) {
			long o = s.getAddress().getOffset();
			if (s.getAddress().isMemoryAddress() && o >= IO_BASE && o < IO_END && s.getName().startsWith("REG_")) {
				Data d = getDataAt(s.getAddress());
				ioRegs.put(o, new String[] {s.getName().substring(4), String.valueOf(d == null ? 2 : d.getLength())});
			}
		}

		Register tmode = p.getRegister("TMode");
		FunctionManager fm = p.getFunctionManager();
		List<Function> funcs = new ArrayList<>();
		for (Function f : fm.getFunctions(true)) funcs.add(f);

		// Static facts per function (single-threaded, cheap).
		long ts0 = System.currentTimeMillis();
		Map<Long, Map<String, Object>> recs = new LinkedHashMap<>();
		for (Function f : funcs) {
			monitor.checkCancelled();
			recs.put(f.getEntryPoint().getOffset(), staticFacts(f, tmode));
		}
		long staticMs = System.currentTimeMillis() - ts0;

		// Decompile in parallel, one DecompInterface per worker thread.
		long td0 = System.currentTimeMillis();
		int ok = 0, failed = 0, timedOut = 0;
		List<Map<String, Object>> failures = new ArrayList<>();
		if (decompile) {
			List<DecompInterface> ifcs = Collections.synchronizedList(new ArrayList<>());
			ThreadLocal<DecompInterface> tl = ThreadLocal.withInitial(() -> {
				DecompInterface ifc = new DecompInterface();
				DecompileOptions opts = new DecompileOptions();
				opts.grabFromProgram(p);
				ifc.setOptions(opts);
				ifc.toggleCCode(true);
				ifc.toggleSyntaxTree(true);
				ifc.setSimplificationStyle("decompile");
				if (!ifc.openProgram(p)) throw new RuntimeException("decompiler failed to open: " + ifc.getLastMessage());
				ifcs.add(ifc);
				return ifc;
			});
			ExecutorService pool = Executors.newFixedThreadPool(Math.max(1, threads));
			List<Future<Map<String, Object>>> futs = new ArrayList<>();
			for (Function f : funcs) {
				futs.add(pool.submit(() -> decompileOne(tl.get(), f, timeout)));
			}
			int done = 0;
			for (int i = 0; i < funcs.size(); i++) {
				Map<String, Object> d;
				try {
					d = futs.get(i).get();
				} catch (ExecutionException e) {
					d = new LinkedHashMap<>();
					d.put("decomp_ok", false);
					d.put("decomp_error", "exception: " + e.getCause());
				}
				Map<String, Object> r = recs.get(funcs.get(i).getEntryPoint().getOffset());
				mergeIo(r, d);
				r.putAll(d);
				if (Boolean.TRUE.equals(d.get("decomp_ok"))) ok++;
				else {
					failed++;
					if (Boolean.TRUE.equals(d.get("decomp_timeout"))) timedOut++;
					Map<String, Object> fl = new LinkedHashMap<>();
					fl.put("entry", r.get("entry"));
					fl.put("error", d.get("decomp_error"));
					failures.add(fl);
				}
				if (++done % 2000 == 0) println("decompiled " + done + "/" + funcs.size());
			}
			pool.shutdown();
			for (DecompInterface ifc : ifcs) ifc.dispose();
		}
		long decompMs = System.currentTimeMillis() - td0;

		Gson gson = new GsonBuilder().disableHtmlEscaping().serializeNulls().create();
		try (Writer w = Files.newBufferedWriter(outDir.resolve("functions.jsonl"), StandardCharsets.UTF_8)) {
			for (Map<String, Object> r : recs.values()) {
				quarantineIoDirections(r);
				w.write(gson.toJson(r));
				w.write('\n');
			}
		}
		int nStrings = writeStrings(outDir.resolve("strings.json"));

		// Summary with timings; merge setup/discover stats written by earlier scripts.
		long t1 = System.currentTimeMillis();
		JsonObject setup = readJson(outDir.resolve("setup.json"));
		JsonObject disc = readJson(outDir.resolve("discover.json"));
		JsonObject returns = repairReturns ? readJson(outDir.resolve("returns.json")) : null;
		Map<String, Object> s = new LinkedHashMap<>();
		s.put("run_id", args.get("run_id"));
		s.put("program", p.getName());
		s.put("ghidra_version", Application.getApplicationVersion());
		s.put("language", p.getLanguageID().toString() + ":" + p.getCompilerSpec().getCompilerSpecID());
		s.put("script_hash", args.get("script_hash"));
		s.put("export_script_sha256", sha256(getSourceFile().getFile(false)));
		s.put("function_count", funcs.size());
		int thumb = 0;
		for (Map<String, Object> r : recs.values()) if ("thumb".equals(r.get("mode"))) thumb++;
		s.put("thumb_functions", thumb);
		s.put("arm_functions", funcs.size() - thumb);
		s.put("decompile_enabled", decompile);
		s.put("auto_analysis_enabled", autoAnalysis);
		s.put("reused_project", reusedProject);
		s.put("return_repair_requested", repairReturns);
		Map<String, Object> returnSummary = null;
		if (returns != null) {
			returnSummary = new LinkedHashMap<>();
			for (String key : List.of("heuristic", "criteria_version", "candidate_count", "flow_overrides", "source_script_sha256", "wall_ms")) {
				if (returns.has(key)) returnSummary.put(key, gson.fromJson(returns.get(key), Object.class));
			}
			returnSummary.put("evidence_file", outDir.resolve("returns.json").toString());
			returnSummary.put("note", "CFG return aid only; inferred signatures, in_lr/CONCAT44 and register types remain unverified");
		}
		s.put("return_repair", returnSummary);
		s.put("decompile_success_note", "decomp_ok means pseudo-C was generated, not that function boundaries, ABI, or semantics were verified");
		s.put("io_direction_verified", false);
		s.put("io_direction_note", "read/write inference is unverified; raw hints are retained in io_direction_hints, io_read/io_write are empty, and possible registers are in io_ref");
		int cWarnings = 0, unaffRegisters = 0, inLr = 0, indirectTables = 0, lrReturns = 0;
		for (Map<String, Object> r : recs.values()) {
			String code = (String) r.get("c");
			if (code != null && code.contains("WARNING")) cWarnings++;
			if (code != null && code.contains("unaff_")) unaffRegisters++;
			if (code != null && code.contains("in_lr")) inLr++;
			if (code != null && code.contains("UNRECOVERED_JUMPTABLE")) indirectTables++;
			if (code != null && code.contains("CONCAT44(in_lr")) lrReturns++;
		}
		s.put("functions_with_c_warnings", decompile ? cWarnings : null);
		s.put("functions_with_unaff_registers", decompile ? unaffRegisters : null);
		s.put("functions_with_in_lr", decompile ? inLr : null);
		s.put("functions_with_unrecovered_jumptable", decompile ? indirectTables : null);
		s.put("functions_with_concat44_in_lr", decompile ? lrReturns : null);
		s.put("decompiled_count", ok);
		s.put("decompile_failures", failed);
		s.put("decompile_timeouts", timedOut);
		s.put("decomp_threads", threads);
		s.put("decomp_timeout_s", timeout);
		s.put("string_count", nStrings);
		Map<String, Object> tm = new LinkedHashMap<>();
		Long setupStart = reusedProject || setup == null ? null : setup.get("setup_start_ms").getAsLong();
		Long setupEnd = reusedProject || setup == null ? null : setup.get("setup_end_ms").getAsLong();
		Long discStart = reusedProject || disc == null ? null : disc.get("discover_start_ms").getAsLong();
		Long discEnd = reusedProject || disc == null ? null : disc.get("discover_end_ms").getAsLong();
		Long returnsStart = returns == null ? null : returns.get("start_ms").getAsLong();
		Long returnsEnd = returns == null ? null : returns.get("end_ms").getAsLong();
		tm.put("setup_ms", setupStart == null ? null : setupEnd - setupStart);
		// Auto-analysis runs between setup end and the first post-script.
		Long firstPost = discStart != null ? discStart : returnsStart != null ? returnsStart : t0;
		tm.put("auto_analysis_ms", !autoAnalysis || setupEnd == null ? null : firstPost - setupEnd);
		tm.put("setup_to_export_gap_ms", setupEnd == null ? null : firstPost - setupEnd);
		tm.put("discover_ms", discStart == null ? null : discEnd - discStart);
		tm.put("return_repair_ms", returnsStart == null ? null : returnsEnd - returnsStart);
		tm.put("analysis_total_ms", setupStart == null ? null : t0 - setupStart);
		tm.put("export_static_ms", staticMs);
		tm.put("decompile_ms", decompile ? decompMs : null);
		tm.put("export_total_ms", t1 - t0);
		tm.put("note", "analysis_total_ms = setup + setup-to-export gap + discover (excludes JVM start/import);"
			+ " auto_analysis_ms is unavailable when auto-analysis is skipped;"
			+ " reused projects retain prior setup/discover metadata but current analysis timings are null;"
			+ " return_repair_ms is nested in analysis_total_ms for imports; do not add it again;"
			+ " export_total_ms includes decompile_ms; process wall time is recorded by the runner");
		s.put("timings", tm);
		Map<String, Object> ts = new LinkedHashMap<>();
		ts.put("setup_start", iso(setupStart));
		ts.put("export_start", iso(t0));
		ts.put("export_end", iso(t1));
		s.put("timestamps", ts);
		s.put("setup", setup == null ? null : gson.fromJson(setup, Map.class));
		s.put("discover", disc == null ? null : gson.fromJson(disc, Map.class));
		s.put("decompile_failure_list", failures);
		Files.write(outDir.resolve("summary.json"),
			new GsonBuilder().disableHtmlEscaping().serializeNulls().setPrettyPrinting().create().toJson(s)
				.getBytes(StandardCharsets.UTF_8));
		println("GbaExport: " + funcs.size() + " functions, decompiled " + ok + ", failed " + failed + ", "
			+ decompMs + " ms decompile");
	}

	static String iso(Long ms) {
		return ms == null ? null : java.time.Instant.ofEpochMilli(ms).toString();
	}

	static JsonObject readJson(Path f) {
		try {
			if (!Files.exists(f)) return null;
			return JsonParser.parseString(new String(Files.readAllBytes(f), StandardCharsets.UTF_8)).getAsJsonObject();
		} catch (Exception e) {
			return null;
		}
	}

	static String sha256(File f) {
		try {
			MessageDigest md = MessageDigest.getInstance("SHA-256");
			byte[] h = md.digest(Files.readAllBytes(f.toPath()));
			StringBuilder sb = new StringBuilder();
			for (byte b : h) sb.append(String.format("%02x", b));
			return sb.toString();
		} catch (Exception e) {
			return null;
		}
	}

	String ioName(long addr) {
		Map.Entry<Long, String[]> e = ioRegs.floorEntry(addr);
		if (e != null && addr < e.getKey() + Integer.parseInt(e.getValue()[1])) {
			long off = addr - e.getKey();
			return off == 0 ? e.getValue()[0] : e.getValue()[0] + "+" + off;
		}
		return String.format("IO_%03x", addr - IO_BASE);
	}

	boolean inRom(long v) {
		return v >= ROM_BASE && v < romEnd;
	}

	static void addCapped(Collection<String> c, String v, int cap) {
		if (c.size() < cap) c.add(v);
	}

	Map<String, Object> staticFacts(Function f, Register tmode) throws Exception {
		Address entry = f.getEntryPoint();
		Map<String, Object> r = new LinkedHashMap<>();
		r.put("entry", hex(entry.getOffset()));
		BigInteger tm = p.getProgramContext().getValue(tmode, entry, false);
		r.put("mode", tm != null && tm.signum() != 0 ? "thumb" : "arm");
		AddressSetView body = f.getBody();
		r.put("size", body.getNumAddresses());
		r.put("end", hex(body.getMaxAddress().getOffset() + 1));
		r.put("name", f.getName());
		r.put("is_thunk", f.isThunk());
		Set<String> callers = new TreeSet<>(), callees = new TreeSet<>();
		for (Function c : f.getCallingFunctions(TaskMonitor.DUMMY)) callers.add(hex(c.getEntryPoint().getOffset()));
		for (Function c : f.getCalledFunctions(TaskMonitor.DUMMY)) callees.add(hex(c.getEntryPoint().getOffset()));

		Set<String> ioR = new TreeSet<>(), ioW = new TreeSet<>(), ioRef = new TreeSet<>();
		Set<Long> swis = new TreeSet<>();
		Set<String> romData = new TreeSet<>(), ram = new TreeSet<>(), fptrs = new TreeSet<>();
		Map<String, String> strings = new TreeMap<>();
		Listing listing = p.getListing();
		Memory mem = p.getMemory();
		int nIns = 0;
		for (Instruction ins : listing.getInstructions(body, true)) {
			nIns++;
			String mn = ins.getMnemonicString().toLowerCase();
			if (mn.startsWith("swi") || mn.startsWith("svc")) {
				Scalar sc = ins.getScalar(0);
				if (sc != null) {
					long v = sc.getUnsignedValue();
					swis.add(v > 0xFF ? (v >> 16) & 0xFF : v); // ARM-mode SWI uses imm24 >> 16
				}
			}
			for (Reference ref : ins.getReferencesFrom()) {
				Address to = ref.getToAddress();
				if (!to.isMemoryAddress()) continue;
				long t = to.getOffset();
				RefType rt = ref.getReferenceType();
				if (rt.isFlow()) continue; // calls/jumps handled via callees
				long target = t;
				// Literal pool load: follow the pooled word to the real target.
				if (inRom(t) && mn.startsWith("ldr") && (t & 3) == 0 && Math.abs(t - ins.getAddress().getOffset()) < 4096
					&& getInstructionContaining(to) == null) {
					try {
						target = mem.getInt(to) & 0xFFFFFFFFL;
					} catch (MemoryAccessException e) {
						target = t;
					}
					if (!(target >= 0x02000000L && target < 0x0F000000L)) target = t; // plain constant, keep pool addr
				}
				if (target >= IO_BASE && target < IO_END) {
					String n = ioName(target);
					if (target != t) addCapped(ioRef, n, maxList); // base loaded from pool; access unknown here
					else if (rt.isWrite()) addCapped(ioW, n, maxList);
					else if (rt.isRead()) addCapped(ioR, n, maxList);
					else addCapped(ioRef, n, maxList);
				} else if (target >= 0x02000000L && target < 0x03008000L) {
					addCapped(ram, hex(target), maxList);
				} else if (inRom(target) || inRom(target & ~1L)) {
					Address ta = toAddr(target & ~1L);
					Function tf = getFunctionAt(ta);
					if (tf != null) {
						addCapped(fptrs, hex(target & ~1L), maxList);
						continue;
					}
					if (getInstructionContaining(ta) != null) continue;
					Data d = getDataContaining(toAddr(target));
					if (d != null && d.hasStringValue() && strings.size() < maxList) {
						Object v = d.getValue();
						strings.put(hex(d.getAddress().getOffset()), v == null ? "" : truncate(v.toString(), 200));
					} else {
						addCapped(romData, hex(target), maxList);
					}
				}
			}
		}
		r.put("instructions", nIns);
		r.put("callers", callers);
		r.put("callees", callees);
		r.put("function_pointers", fptrs);
		List<Map<String, String>> sl = new ArrayList<>();
		for (Map.Entry<String, String> e : strings.entrySet()) sl.add(Map.of("addr", e.getKey(), "value", e.getValue()));
		r.put("strings", sl);
		r.put("io_read", ioR);
		r.put("io_write", ioW);
		r.put("io_ref", ioRef);
		r.put("swi", swis);
		r.put("rom_data", romData);
		r.put("ram_refs", ram);
		return r;
	}

	static String truncate(String s, int n) {
		return s.length() <= n ? s : s.substring(0, n) + "...";
	}

	Map<String, Object> decompileOne(DecompInterface ifc, Function f, int timeout) {
		Map<String, Object> d = new LinkedHashMap<>();
		long t = System.currentTimeMillis();
		try {
			DecompileResults res = ifc.decompileFunction(f, timeout, TaskMonitor.DUMMY);
			d.put("decomp_ms", System.currentTimeMillis() - t);
			if (res != null && res.decompileCompleted() && res.getDecompiledFunction() != null) {
				d.put("decomp_ok", true);
				d.put("c", res.getDecompiledFunction().getC());
				collectPcodeIo(res.getHighFunction(), d);
			} else {
				d.put("decomp_ok", false);
				d.put("decomp_timeout", res != null && res.isTimedOut());
				String msg = res == null ? "null result" : res.getErrorMessage();
				d.put("decomp_error", msg == null || msg.isBlank() ? (res != null && res.isTimedOut() ? "timeout" : "unknown") : msg.trim());
			}
		} catch (Exception e) {
			d.put("decomp_ms", System.currentTimeMillis() - t);
			d.put("decomp_ok", false);
			d.put("decomp_error", "exception: " + e);
		}
		return d;
	}

	/** IO register reads/writes visible in the decompiler's p-code (constant addresses). */
	void collectPcodeIo(HighFunction hf, Map<String, Object> d) {
		if (hf == null) return;
		Set<String> r = new TreeSet<>(), w = new TreeSet<>();
		Iterator<PcodeOpAST> it = hf.getPcodeOps();
		while (it.hasNext()) {
			PcodeOpAST op = it.next();
			int oc = op.getOpcode();
			if (oc == PcodeOp.LOAD || oc == PcodeOp.STORE) {
				Varnode ptr = op.getInput(1);
				Long v = constValue(ptr);
				if (v != null && v >= IO_BASE && v < IO_END) (oc == PcodeOp.LOAD ? r : w).add(ioName(v));
				continue;
			}
			Varnode o = op.getOutput();
			if (o != null && o.getAddress().isMemoryAddress()) {
				long a = o.getAddress().getOffset();
				if (a >= IO_BASE && a < IO_END) w.add(ioName(a));
			}
			for (Varnode in : op.getInputs()) {
				if (in != null && in.getAddress().isMemoryAddress()) {
					long a = in.getAddress().getOffset();
					if (a >= IO_BASE && a < IO_END) r.add(ioName(a));
				}
			}
		}
		d.put("_pio_r", r);
		d.put("_pio_w", w);
	}

	static Long constValue(Varnode v) {
		if (v == null) return null;
		if (v.isConstant()) return v.getOffset();
		PcodeOp def = v.getDef();
		if (def != null && (def.getOpcode() == PcodeOp.COPY || def.getOpcode() == PcodeOp.CAST) && def.getInput(0).isConstant())
			return def.getInput(0).getOffset();
		if (def != null && (def.getOpcode() == PcodeOp.INT_ADD || def.getOpcode() == PcodeOp.PTRSUB)) {
			Long a = constValue(def.getInput(0)), b = constValue(def.getInput(1));
			if (a != null && b != null) return (a + b) & 0xFFFFFFFFL;
		}
		return null;
	}

	@SuppressWarnings("unchecked")
	void mergeIo(Map<String, Object> r, Map<String, Object> d) {
		Object pr = d.remove("_pio_r"), pw = d.remove("_pio_w");
		if (pr != null) ((Set<String>) r.get("io_read")).addAll((Set<String>) pr);
		if (pw != null) ((Set<String>) r.get("io_write")).addAll((Set<String>) pw);
		Set<String> ref = (Set<String>) r.get("io_ref");
		ref.removeAll((Set<String>) r.get("io_read"));
		ref.removeAll((Set<String>) r.get("io_write"));
	}

	/** Retain hypotheses without publishing incorrect register access directions.
	 * The initial extractor misclassified some stores as reads in noanalysis mode.
	 * Literal-pool loads alone also do not establish a hardware access direction. */
	@SuppressWarnings("unchecked")
	static void quarantineIoDirections(Map<String, Object> record) {
		Set<String> reads = new TreeSet<>((Collection<String>) record.get("io_read"));
		Set<String> writes = new TreeSet<>((Collection<String>) record.get("io_write"));
		Set<String> refs = new TreeSet<>((Collection<String>) record.get("io_ref"));
		refs.addAll(reads);
		refs.addAll(writes);
		record.put("io_direction_hints", Map.of("read", reads, "write", writes));
		record.put("io_direction_verified", false);
		record.put("io_ref", refs);
		record.put("io_read", new TreeSet<String>());
		record.put("io_write", new TreeSet<String>());
	}

	int writeStrings(Path f) throws IOException {
		List<Map<String, Object>> out = new ArrayList<>();
		ReferenceManager rm = p.getReferenceManager();
		MemoryBlock rom = p.getMemory().getBlock(toAddr(ROM_BASE));
		for (Data d : p.getListing().getDefinedData(new AddressSet(rom.getStart(), rom.getEnd()), true)) {
			if (!d.hasStringValue()) continue;
			Map<String, Object> m = new LinkedHashMap<>();
			m.put("addr", hex(d.getAddress().getOffset()));
			m.put("length", d.getLength());
			Object v = d.getValue();
			m.put("value", v == null ? "" : truncate(v.toString(), 1000));
			Set<String> fx = new TreeSet<>();
			for (Reference ref : rm.getReferencesTo(d.getAddress())) {
				Function fn = getFunctionContaining(ref.getFromAddress());
				if (fn != null) fx.add(hex(fn.getEntryPoint().getOffset()));
				else {
					// pooled pointer: who loads the pool word?
					for (Reference r2 : rm.getReferencesTo(ref.getFromAddress())) {
						Function f2 = getFunctionContaining(r2.getFromAddress());
						if (f2 != null) fx.add(hex(f2.getEntryPoint().getOffset()));
					}
				}
			}
			m.put("functions", fx);
			out.add(m);
		}
		Files.write(f, new GsonBuilder().disableHtmlEscaping().create().toJson(out).getBytes(StandardCharsets.UTF_8));
		return out.size();
	}
}
