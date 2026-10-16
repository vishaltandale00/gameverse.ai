// Pre-analysis setup for a GBA ROM imported as a raw binary at 0x08000000
// (ARM:LE:32:v4t). Creates the GBA memory map, labels hardware registers and
// the cartridge header, marks the ARM entry branch, and seeds Thumb/ARM
// disassembly before auto-analysis runs.
//
// Script args (key=value): out=<dir> (required, writes <out>/setup.json),
//   seed_oddptr=off|push|valid   odd ROM words (Thumb pointers) -> Thumb seeds
//   seed_file=<path>             executed addresses + mode (see README)
//   opt:<Analyzer Name>=<value>  override a Ghidra analysis option
//   dump_options=1               write current analysis options to setup.json
// @category GBA
import java.io.*;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

import ghidra.app.cmd.disassemble.ArmDisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.app.util.PseudoDisassembler;
import ghidra.app.util.PseudoDisassemblerContext;
import ghidra.program.model.address.*;
import ghidra.program.model.data.*;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.*;
import ghidra.program.model.symbol.SourceType;

public class GbaSetup extends GhidraScript {

	static final long ROM_BASE = 0x08000000L;

	// name, offset from 0x04000000, size in bytes
	static final Object[][] IO_REGS = {
		{"DISPCNT", 0x000, 2}, {"GREENSWAP", 0x002, 2}, {"DISPSTAT", 0x004, 2}, {"VCOUNT", 0x006, 2},
		{"BG0CNT", 0x008, 2}, {"BG1CNT", 0x00A, 2}, {"BG2CNT", 0x00C, 2}, {"BG3CNT", 0x00E, 2},
		{"BG0HOFS", 0x010, 2}, {"BG0VOFS", 0x012, 2}, {"BG1HOFS", 0x014, 2}, {"BG1VOFS", 0x016, 2},
		{"BG2HOFS", 0x018, 2}, {"BG2VOFS", 0x01A, 2}, {"BG3HOFS", 0x01C, 2}, {"BG3VOFS", 0x01E, 2},
		{"BG2PA", 0x020, 2}, {"BG2PB", 0x022, 2}, {"BG2PC", 0x024, 2}, {"BG2PD", 0x026, 2},
		{"BG2X", 0x028, 4}, {"BG2Y", 0x02C, 4},
		{"BG3PA", 0x030, 2}, {"BG3PB", 0x032, 2}, {"BG3PC", 0x034, 2}, {"BG3PD", 0x036, 2},
		{"BG3X", 0x038, 4}, {"BG3Y", 0x03C, 4},
		{"WIN0H", 0x040, 2}, {"WIN1H", 0x042, 2}, {"WIN0V", 0x044, 2}, {"WIN1V", 0x046, 2},
		{"WININ", 0x048, 2}, {"WINOUT", 0x04A, 2}, {"MOSAIC", 0x04C, 2},
		{"BLDCNT", 0x050, 2}, {"BLDALPHA", 0x052, 2}, {"BLDY", 0x054, 2},
		{"SOUND1CNT_L", 0x060, 2}, {"SOUND1CNT_H", 0x062, 2}, {"SOUND1CNT_X", 0x064, 2},
		{"SOUND2CNT_L", 0x068, 2}, {"SOUND2CNT_H", 0x06C, 2},
		{"SOUND3CNT_L", 0x070, 2}, {"SOUND3CNT_H", 0x072, 2}, {"SOUND3CNT_X", 0x074, 2},
		{"SOUND4CNT_L", 0x078, 2}, {"SOUND4CNT_H", 0x07C, 2},
		{"SOUNDCNT_L", 0x080, 2}, {"SOUNDCNT_H", 0x082, 2}, {"SOUNDCNT_X", 0x084, 2},
		{"SOUNDBIAS", 0x088, 2}, {"WAVE_RAM", 0x090, 16}, {"FIFO_A", 0x0A0, 4}, {"FIFO_B", 0x0A4, 4},
		{"DMA0SAD", 0x0B0, 4}, {"DMA0DAD", 0x0B4, 4}, {"DMA0CNT_L", 0x0B8, 2}, {"DMA0CNT_H", 0x0BA, 2},
		{"DMA1SAD", 0x0BC, 4}, {"DMA1DAD", 0x0C0, 4}, {"DMA1CNT_L", 0x0C4, 2}, {"DMA1CNT_H", 0x0C6, 2},
		{"DMA2SAD", 0x0C8, 4}, {"DMA2DAD", 0x0CC, 4}, {"DMA2CNT_L", 0x0D0, 2}, {"DMA2CNT_H", 0x0D2, 2},
		{"DMA3SAD", 0x0D4, 4}, {"DMA3DAD", 0x0D8, 4}, {"DMA3CNT_L", 0x0DC, 2}, {"DMA3CNT_H", 0x0DE, 2},
		{"TM0CNT_L", 0x100, 2}, {"TM0CNT_H", 0x102, 2}, {"TM1CNT_L", 0x104, 2}, {"TM1CNT_H", 0x106, 2},
		{"TM2CNT_L", 0x108, 2}, {"TM2CNT_H", 0x10A, 2}, {"TM3CNT_L", 0x10C, 2}, {"TM3CNT_H", 0x10E, 2},
		{"SIOMULTI0", 0x120, 2}, {"SIOMULTI1", 0x122, 2}, {"SIOMULTI2", 0x124, 2}, {"SIOMULTI3", 0x126, 2},
		{"SIOCNT", 0x128, 2}, {"SIOMLT_SEND", 0x12A, 2},
		{"KEYINPUT", 0x130, 2}, {"KEYCNT", 0x132, 2}, {"RCNT", 0x134, 2},
		{"JOYCNT", 0x140, 2}, {"JOY_RECV", 0x150, 4}, {"JOY_TRANS", 0x154, 4}, {"JOYSTAT", 0x158, 2},
		{"IE", 0x200, 2}, {"IF", 0x202, 2}, {"WAITCNT", 0x204, 2}, {"IME", 0x208, 2},
		{"POSTFLG", 0x300, 1}, {"HALTCNT", 0x301, 1},
	};

	Program p;
	Map<String, Object> stats = new LinkedHashMap<>();

	Address a(long off) {
		return p.getAddressFactory().getDefaultAddressSpace().getAddress(off);
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
		Files.createDirectories(Paths.get(out));
		stats.put("setup_start_ms", t0);
		stats.put("args", args);

		// Analysis option overrides (applied before auto-analysis starts).
		Map<String, String> applied = new LinkedHashMap<>();
		for (Map.Entry<String, String> e : args.entrySet()) {
			if (e.getKey().startsWith("opt:")) {
				setAnalysisOption(p, e.getKey().substring(4), e.getValue());
				applied.put(e.getKey().substring(4), e.getValue());
			}
		}
		stats.put("analysis_option_overrides", applied);

		buildMemoryMap();
		labelHeaderAndIo();

		// Entry: ARM branch at the start of ROM.
		Register tmode = p.getRegister("TMode");
		Address entry = a(ROM_BASE);
		p.getProgramContext().setValue(tmode, entry, entry, BigInteger.ZERO);
		p.getSymbolTable().addExternalEntryPoint(entry);
		createLabel(entry, "rom_entry", true, SourceType.IMPORTED);
		new ArmDisassembleCommand(entry, null, false).applyTo(p, monitor);
		new CreateFunctionCmd(entry).applyTo(p, monitor);

		// Seeds.
		AddressSet thumbSeeds = new AddressSet();
		AddressSet armSeeds = new AddressSet();
		String oddMode = args.getOrDefault("seed_oddptr", "valid");
		if (!oddMode.equals("off")) seedOddPointers(oddMode, thumbSeeds);
		String seedFile = args.get("seed_file");
		if (seedFile != null && !seedFile.isEmpty()) {
			if (!Files.exists(Paths.get(seedFile)))
				throw new IllegalArgumentException("configured seed file is missing: " + seedFile);
			readSeedFile(seedFile, thumbSeeds, armSeeds);
		} else {
			stats.put("seed_file", null);
		}
		applySeeds(thumbSeeds, true);
		applySeeds(armSeeds, false);
		stats.put("functions_after_setup", p.getFunctionManager().getFunctionCount());

		if ("1".equals(args.get("dump_options"))) {
			stats.put("analysis_options", new TreeMap<>(getCurrentAnalysisOptionsAndValues(p)));
		}
		long t1 = System.currentTimeMillis();
		stats.put("setup_end_ms", t1);
		stats.put("setup_ms", t1 - t0);
		Files.write(Paths.get(out, "setup.json"), new com.google.gson.GsonBuilder().serializeNulls().setPrettyPrinting().create().toJson(stats).getBytes(StandardCharsets.UTF_8));
		println("GbaSetup done in " + (t1 - t0) + " ms: " + stats.get("seeds"));
	}

	void block(String name, long start, long len, boolean w, boolean x, boolean vol) throws Exception {
		Memory mem = p.getMemory();
		if (mem.getBlock(a(start)) != null) return;
		MemoryBlock b = mem.createUninitializedBlock(name, a(start), len, false);
		b.setRead(true);
		b.setWrite(w);
		b.setExecute(x);
		b.setVolatile(vol);
	}

	void buildMemoryMap() throws Exception {
		MemoryBlock rom = p.getMemory().getBlock(a(ROM_BASE));
		rom.setName("ROM");
		rom.setRead(true);
		rom.setWrite(false);
		rom.setExecute(true);
		block("BIOS", 0x00000000L, 0x4000, false, true, false);
		block("EWRAM", 0x02000000L, 0x40000, true, true, false);
		block("IWRAM", 0x03000000L, 0x8000, true, true, false);
		block("IO", 0x04000000L, 0x400, true, false, true);
		block("PALETTE", 0x05000000L, 0x400, true, false, false);
		block("VRAM", 0x06000000L, 0x18000, true, false, false);
		block("OAM", 0x07000000L, 0x400, true, false, false);
		block("SRAM", 0x0E000000L, 0x10000, true, false, true);
		stats.put("rom_size", rom.getSize());
	}

	void data(long addr, DataType dt, String name) throws Exception {
		Address ad = a(addr);
		createLabel(ad, name, true, SourceType.IMPORTED);
		clearListing(ad, ad.add(dt.getLength() - 1));
		createData(ad, dt);
	}

	void labelHeaderAndIo() throws Exception {
		for (Object[] r : IO_REGS) {
			String name = (String) r[0];
			int off = (Integer) r[1];
			int size = (Integer) r[2];
			DataType dt = size == 1 ? ByteDataType.dataType
				: size == 2 ? WordDataType.dataType
				: size == 4 ? DWordDataType.dataType
				: new ArrayDataType(ByteDataType.dataType, size, 1);
			data(0x04000000L + off, dt, "REG_" + name);
		}
		// BIOS-maintained IWRAM words.
		data(0x03007FF8L, WordDataType.dataType, "INTR_CHECK");
		data(0x03007FFCL, Pointer32DataType.dataType, "INTR_VECTOR");
		// Cartridge header.
		data(ROM_BASE + 0x04, new ArrayDataType(ByteDataType.dataType, 156, 1), "rom_header_logo");
		data(ROM_BASE + 0xA0, new ArrayDataType(CharDataType.dataType, 12, 1), "rom_header_title");
		clearListing(a(ROM_BASE + 0xAC), a(ROM_BASE + 0xBF));
		createLabel(a(ROM_BASE + 0xAC), "rom_header_game_code", true, SourceType.IMPORTED);
		createData(a(ROM_BASE + 0xAC), new ArrayDataType(CharDataType.dataType, 4, 1));
		createLabel(a(ROM_BASE + 0xB0), "rom_header_maker_code", true, SourceType.IMPORTED);
		createData(a(ROM_BASE + 0xB0), new ArrayDataType(CharDataType.dataType, 2, 1));
		createLabel(a(ROM_BASE + 0xB2), "rom_header_rest", true, SourceType.IMPORTED);
		createData(a(ROM_BASE + 0xB2), new ArrayDataType(ByteDataType.dataType, 14, 1));
	}

	/** Thumb pointer candidates: 4-aligned ROM words with the low bit set. */
	void seedOddPointers(String mode, AddressSet thumbSeeds) throws Exception {
		MemoryBlock rom = p.getMemory().getBlock(a(ROM_BASE));
		long size = rom.getSize();
		byte[] bytes = new byte[(int) size];
		rom.getBytes(a(ROM_BASE), bytes);
		Set<Long> targets = new TreeSet<>();
		for (int o = 0; o + 4 <= bytes.length; o += 4) {
			long w = (bytes[o] & 0xFFL) | ((bytes[o + 1] & 0xFFL) << 8) | ((bytes[o + 2] & 0xFFL) << 16)
				| ((bytes[o + 3] & 0xFFL) << 24);
			if ((w & 1) == 1 && w >= ROM_BASE + 0xC0 && w < ROM_BASE + size) targets.add(w - 1);
		}
		PseudoDisassembler pd = new PseudoDisassembler(p);
		Register tmode = p.getRegister("TMode");
		int push = 0, valid = 0;
		for (long t : targets) {
			int off = (int) (t - ROM_BASE);
			int hw = (bytes[off] & 0xFF) | ((bytes[off + 1] & 0xFF) << 8);
			if ((hw & 0xFF00) == 0xB500) { // push {..., lr}
				thumbSeeds.add(a(t));
				push++;
			} else if (mode.equals("valid")) {
				PseudoDisassemblerContext ctx = new PseudoDisassemblerContext(p.getProgramContext());
				ctx.setValue(tmode, a(t), BigInteger.ONE);
				if (pd.checkValidSubroutine(a(t), ctx, true, true)) {
					thumbSeeds.add(a(t));
					valid++;
				}
			}
		}
		Map<String, Object> s = new LinkedHashMap<>();
		s.put("mode", mode);
		s.put("odd_rom_words", targets.size());
		s.put("push_lr", push);
		s.put("valid_leaf", valid);
		stats.put("seeds_oddptr", s);
	}

	/** Decode one seed, including capture's compact [address, "T"|"A", hits] form.
	 * Return aligned address and Thumb=1/ARM=0; null denotes an absent address. */
	static long[] decodeSeed(Object o) {
		Object av = o;
		String mode = null;
		if (o instanceof Map) {
			Map<?, ?> m = (Map<?, ?>) o;
			av = m.get("addr") != null ? m.get("addr") : m.get("address") != null ? m.get("address") : m.get("pc");
			Object md = m.get("mode");
			if (md != null) mode = md.toString().toLowerCase(Locale.ROOT);
			else if (m.get("thumb") instanceof Boolean) mode = ((Boolean) m.get("thumb")) ? "thumb" : "arm";
		} else if (o instanceof List) {
			List<?> row = (List<?>) o;
			if (row.size() < 2) throw new IllegalArgumentException("capture seed needs address and mode: " + row);
			av = row.get(0);
			mode = row.get(1).toString().toLowerCase(Locale.ROOT);
		}
		if (av == null) return null;
		long v = av instanceof Number ? ((Number) av).longValue() : Long.decode(av.toString().trim());
		if (mode == null) mode = (v & 1) == 1 ? "thumb" : "arm";
		if (!Set.of("t", "thumb", "a", "arm").contains(mode))
			throw new IllegalArgumentException("unknown seed instruction mode: " + mode);
		boolean thumb = mode.startsWith("t");
		return new long[] { v & (thumb ? ~1L : ~3L), thumb ? 1 : 0 };
	}

	static List<?> seedRows(Object root) {
		if (root instanceof Map) {
			Map<?, ?> m = (Map<?, ?>) root;
			if (m.get("regions") instanceof Map) {
				Object rom = ((Map<?, ?>) m.get("regions")).get("rom");
				if (!(rom instanceof Map) || !(((Map<?, ?>) rom).get("functions") instanceof List))
					throw new IllegalArgumentException("capture coverage missing regions.rom.functions");
				root = ((Map<?, ?>) rom).get("functions");
			}
			for (String k : new String[] {"entries", "seeds", "executed", "functions", "blocks"}) {
				if (root != m) break;
				if (m.get(k) instanceof List) { root = m.get(k); break; }
			}
		}
		if (!(root instanceof List)) throw new IllegalArgumentException("seed file has no supported entry list");
		return (List<?>) root;
	}

	/** Seed file: maps, compact capture arrays or bare addresses. Capture files
	 * contain regions.rom.functions; never use their basic-block entries as functions. */
	void readSeedFile(String path, AddressSet thumbSeeds, AddressSet armSeeds) throws Exception {
		Object root = new com.google.gson.Gson().fromJson(new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8), Object.class);
		int th = 0, ar = 0, skipped = 0;
		MemoryBlock rom = p.getMemory().getBlock(a(ROM_BASE));
		for (Object o : seedRows(root)) {
			long[] seed = decodeSeed(o);
			if (seed == null) { skipped++; continue; }
			long v = seed[0];
			if (!rom.contains(a(v))) { skipped++; continue; }
			if (seed[1] == 1) { thumbSeeds.add(a(v)); th++; }
			else { armSeeds.add(a(v)); ar++; }
		}
		Map<String, Object> s = new LinkedHashMap<>();
		s.put("path", path);
		s.put("thumb", th);
		s.put("arm", ar);
		s.put("skipped_non_rom", skipped);
		stats.put("seeds_file", s);
	}

	void applySeeds(AddressSet seeds, boolean thumb) throws Exception {
		if (seeds.isEmpty()) return;
		Register tmode = p.getRegister("TMode");
		AddressSet fresh = new AddressSet();
		for (AddressRange r : seeds) {
			for (Address ad : r) {
				if (ad.getOffset() % 2 != 0) continue;
				if (getInstructionContaining(ad) != null || (getDataContaining(ad) != null && getDataContaining(ad).isDefined())) continue;
				p.getProgramContext().setValue(tmode, ad, ad, thumb ? BigInteger.ONE : BigInteger.ZERO);
				fresh.add(ad);
			}
		}
		ArmDisassembleCommand cmd = new ArmDisassembleCommand(fresh, null, thumb);
		cmd.applyTo(p, monitor);
		AddressSet entries = new AddressSet();
		for (AddressRange r : fresh) {
			for (Address ad : r) {
				Instruction ins = getInstructionAt(ad);
				if (ins != null && getFunctionAt(ad) == null) entries.add(ad);
			}
		}
		new CreateFunctionCmd(entries, SourceType.ANALYSIS).applyTo(p, monitor);
		@SuppressWarnings("unchecked")
		Map<String, Object> s = (Map<String, Object>) stats.computeIfAbsent("seeds", k -> new LinkedHashMap<>());
		s.put(thumb ? "thumb_applied" : "arm_applied", entries.getNumAddresses());
	}
}
