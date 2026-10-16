// Post-analysis function discovery for GBA ROMs: scans ROM bytes that auto-analysis
// left undefined for Thumb "push {..., lr}" prologues (and optionally ARM
// "stmdb sp!, {..., lr}"), validates each with Ghidra's pseudo-disassembler,
// creates functions, optionally re-running analysis. Can instead expand direct
// call targets without scanning gaps. All modes have candidate/scan-time bounds.
//
// Script args (key=value): out=<dir> (required, writes <out>/discover.json),
//   gap_thumb=1, gap_arm=0, call_targets=0, analyze_changes=1, max_rounds=3,
//   candidate_limit=10000, budget_ms=60000
// @category GBA
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
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.SourceType;

public class GbaDiscover extends GhidraScript {

	static final long ROM_BASE = 0x08000000L;

	@Override
	public void run() throws Exception {
		long t0 = System.currentTimeMillis();
		Program p = currentProgram;
		Map<String, String> args = new LinkedHashMap<>();
		for (String s : getScriptArgs()) {
			int i = s.indexOf('=');
			if (i > 0) args.put(s.substring(0, i), s.substring(i + 1));
		}
		String out = args.get("out");
		boolean gapThumb = !"0".equals(args.getOrDefault("gap_thumb", "1"));
		boolean gapArm = "1".equals(args.getOrDefault("gap_arm", "0"));
		int maxRounds = Integer.parseInt(args.getOrDefault("max_rounds", "3"));
		boolean callTargets = "1".equals(args.getOrDefault("call_targets", "0"));
		boolean analyze = !"0".equals(args.getOrDefault("analyze_changes", "1"));
		int candidateLimit = Integer.parseInt(args.getOrDefault("candidate_limit", "10000"));
		long budgetMs = Long.parseLong(args.getOrDefault("budget_ms", "60000"));
		if (maxRounds < 1 || candidateLimit < 1 || budgetMs < 1)
			throw new IllegalArgumentException("round, candidate and scan-time limits must be positive");

		Map<String, Object> stats = new LinkedHashMap<>();
		stats.put("discover_start_ms", t0);
		stats.put("functions_before", p.getFunctionManager().getFunctionCount());
		stats.put("args", args);
		stats.put("analyze_changes", analyze);
		stats.put("candidate_limit", candidateLimit);
		stats.put("cooperative_scan_budget_ms", budgetMs);
		stats.put("budget_note", "time is checked between scan candidates, not a hard deadline for individual Ghidra commands; runner process timeout remains the hard cap");
		List<Map<String, Object>> rounds = new ArrayList<>();
		Register tmode = p.getRegister("TMode");
		MemoryBlock rom = p.getMemory().getBlock(p.getAddressFactory().getDefaultAddressSpace().getAddress(ROM_BASE));
		byte[] bytes = new byte[(int) rom.getSize()];
		rom.getBytes(rom.getStart(), bytes);
		Listing listing = p.getListing();
		PseudoDisassembler pd = new PseudoDisassembler(p);

		int totalCandidates = 0;
		String stopReason = "max_rounds";
		for (int round = 0; round < maxRounds && (gapThumb || gapArm || callTargets); round++) {
			long rt = System.currentTimeMillis();
			AddressSet thumb = new AddressSet();
			AddressSet arm = new AddressSet();
			int candidates = 0;
			int directCalls = 0;
			int validatedThumbGaps = 0, validatedArmGaps = 0;
			if (callTargets) {
				for (Instruction ins : listing.getInstructions(new AddressSet(rom.getStart(), rom.getEnd()), true)) {
					monitor.checkCancelled();
					if (System.currentTimeMillis() - t0 >= budgetMs || totalCandidates >= candidateLimit) break;
					if (!ins.getFlowType().isCall()) continue;
					for (Address target : ins.getFlows()) {
						if (!rom.contains(target) || getFunctionAt(target) != null || thumb.contains(target) || arm.contains(target)) continue;
						if (totalCandidates >= candidateLimit) break;
						// Known target context wins; otherwise direct BL preserves the source ISA.
						Instruction targetIns = getInstructionAt(target);
						Address contextAt = targetIns == null ? ins.getAddress() : target;
						BigInteger mode = p.getProgramContext().getValue(tmode, contextAt, false);
						boolean isThumb = mode != null && mode.signum() != 0;
						if (targetIns == null && ins.getMnemonicString().equalsIgnoreCase("blx")) isThumb = !isThumb;
						(isThumb ? thumb : arm).add(target);
						candidates++;
						directCalls++;
						totalCandidates++;
					}
				}
			}
			// Walk undefined ranges only.
			AddressSetView undefined = gapThumb || gapArm
				? listing.getUndefinedRanges(new AddressSet(rom.getStart(), rom.getEnd()), false, monitor) : new AddressSet();
			gapScan:
			for (AddressRange r : undefined) {
				if (!gapThumb && !gapArm) break;
				long s = (r.getMinAddress().getOffset() + 1) & ~1L;
				long e = r.getMaxAddress().getOffset();
				for (long ad = s; ad + 1 <= e; ad += 2) {
					monitor.checkCancelled();
					if (System.currentTimeMillis() - t0 >= budgetMs || totalCandidates >= candidateLimit) break gapScan;
					int o = (int) (ad - ROM_BASE);
					int hw = (bytes[o] & 0xFF) | ((bytes[o + 1] & 0xFF) << 8);
					if (gapThumb && (hw & 0xFF00) == 0xB500) {
						candidates++;
						totalCandidates++;
						Address a = toAddr(ad);
						PseudoDisassemblerContext ctx = new PseudoDisassemblerContext(p.getProgramContext());
						ctx.setValue(tmode, a, BigInteger.ONE);
						if (pd.checkValidSubroutine(a, ctx, true, true)) { thumb.add(a); validatedThumbGaps++; }
					} else if (gapArm && (ad & 3) == 0 && ad + 3 <= e && (hw & 0x4000) != 0
						&& (((bytes[o + 2] & 0xFF) | ((bytes[o + 3] & 0xFF) << 8)) == 0xE92D)) {
						// stmdb sp!, {..., lr}: low halfword has bit 14 set
						candidates++;
						totalCandidates++;
						Address a = toAddr(ad);
						PseudoDisassemblerContext ctx = new PseudoDisassemblerContext(p.getProgramContext());
						ctx.setValue(tmode, a, BigInteger.ZERO);
						if (pd.checkValidSubroutine(a, ctx, true, true)) { arm.add(a); validatedArmGaps++; }
					}
				}
			}
			int before = p.getFunctionManager().getFunctionCount();
			apply(p, tmode, thumb, true);
			apply(p, tmode, arm, false);
			if (analyze && (!thumb.isEmpty() || !arm.isEmpty())) analyzeChanges(p);
			int after = p.getFunctionManager().getFunctionCount();
			Map<String, Object> rs = new LinkedHashMap<>();
			rs.put("candidates", candidates);
			rs.put("direct_call_candidates", directCalls);
			rs.put("thumb_valid", validatedThumbGaps);
			rs.put("arm_valid", validatedArmGaps);
			rs.put("thumb_selected", thumb.getNumAddresses());
			rs.put("arm_selected", arm.getNumAddresses());
			rs.put("functions_added", after - before);
			rs.put("ms", System.currentTimeMillis() - rt);
			rounds.add(rs);
			println("GbaDiscover round " + round + ": " + rs);
			if (totalCandidates >= candidateLimit) { stopReason = "candidate_limit"; break; }
			if (System.currentTimeMillis() - t0 >= budgetMs) { stopReason = "scan_time_budget"; break; }
			if (thumb.isEmpty() && arm.isEmpty()) { stopReason = "no_candidates"; break; }
			if (after == before) { stopReason = "no_new_functions"; break; }
		}
		long t1 = System.currentTimeMillis();
		stats.put("rounds", rounds);
		stats.put("total_candidates", totalCandidates);
		stats.put("stop_reason", stopReason);
		stats.put("functions_after", p.getFunctionManager().getFunctionCount());
		stats.put("discover_end_ms", t1);
		stats.put("discover_ms", t1 - t0);
		if (out != null) {
			Files.write(Paths.get(out, "discover.json"), new com.google.gson.GsonBuilder().setPrettyPrinting()
				.create().toJson(stats).getBytes(StandardCharsets.UTF_8));
		}
	}

	void apply(Program p, Register tmode, AddressSet seeds, boolean thumb) {
		if (seeds.isEmpty()) return;
		for (AddressRange r : seeds) {
			for (Address a : r) {
				try {
					p.getProgramContext().setValue(tmode, a, a, thumb ? BigInteger.ONE : BigInteger.ZERO);
				} catch (Exception e) {
					// context conflict with existing code; skip
				}
			}
		}
		new ArmDisassembleCommand(seeds, null, thumb).applyTo(p, monitor);
		AddressSet entries = new AddressSet();
		for (AddressRange r : seeds) {
			for (Address a : r) {
				if (getInstructionAt(a) != null && getFunctionAt(a) == null) entries.add(a);
			}
		}
		new CreateFunctionCmd(entries, SourceType.ANALYSIS).applyTo(p, monitor);
	}
}
