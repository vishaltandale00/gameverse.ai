// Opt-in heuristic: exact Thumb POP{rN};BX rN with bounded saved-entry-LR stack proof.
// No global BX heuristic, function recreation, analyzer pass, or ABI type repair.
// @category GBA
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import com.google.gson.*;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.lang.Register;

public class GbaReturns extends GhidraScript {
    static String hex(long n) { return String.format("0x%08x", n); }
    int half(Address a) throws Exception { return currentProgram.getMemory().getShort(a) & 0xffff; }
    int instructionCount;
    public static boolean pushesEntryLr(int h) { return (h & 0xff00) == 0xb500; }
    public static int singletonPopBxRegister(int pop, int branch) {
        if ((branch & 0xff87) != 0x4700) return -1;
        int reg = (branch >>> 3) & 15;
        return reg <= 7 && pop == (0xbc00 | (1 << reg)) ? reg : -1;
    }
    boolean thumb(Instruction i) {
        java.math.BigInteger mode = currentProgram.getProgramContext().getValue(currentProgram.getRegister("TMode"), i.getAddress(), false);
        return mode != null && mode.intValue() == 1;
    }
    List<Map<String,Object>> candidates(Function f) throws Exception {
        List<Map<String,Object>> result=new ArrayList<>();
        for (Instruction i:currentProgram.getListing().getInstructions(f.getBody(),true)) {
            if(i.getLength()!=2 || !thumb(i)) continue;
            Instruction prev=currentProgram.getListing().getInstructionBefore(i.getAddress());
            if(prev==null || prev.getLength()!=2 || !thumb(prev) || !prev.getAddress().add(2).equals(i.getAddress())) continue;
            int reg=singletonPopBxRegister(half(prev.getAddress()),half(i.getAddress()));
            if(reg<0) continue;
            Map<String,Object> c=new LinkedHashMap<>(); c.put("function",hex(f.getEntryPoint().getOffset()));
            c.put("address",hex(i.getAddress().getOffset())); c.put("register",reg);
            c.put("accepted",false); c.put("criterion","exact singleton Thumb POP/BX; bounded CFG saved-LR proof still required");
            result.add(c);
        }
        return result;
    }

    List<Map<String,Object>> inspect(Function f) throws Exception {
        List<Map<String,Object>> accepted = new ArrayList<>();
        Listing listing = currentProgram.getListing();
        Instruction first = listing.getInstructionAt(f.getEntryPoint());
        if (first == null) return accepted;
        Register tmode = currentProgram.getRegister("TMode");
        java.math.BigInteger mode = currentProgram.getProgramContext().getValue(tmode, first.getAddress(), false);
        if (mode == null || mode.intValue() != 1) return accepted;
        int prologue = half(first.getAddress());
        if (!pushesEntryLr(prologue)) return accepted; // PUSH low regs + LR, original LR at entry SP-4.
        TreeMap<Long,Instruction> ins = new TreeMap<>();
        for (Instruction i : listing.getInstructions(f.getBody(), true)) ins.put(i.getAddress().getOffset(), i);
        if (ins.size() > 512) return accepted;
        instructionCount += ins.size();
        Map<Long,Integer> stack = new HashMap<>();
        Map<Long,Set<Long>> preds = new HashMap<>();
        ArrayDeque<Long> todo = new ArrayDeque<>();
        long entry = first.getAddress().getOffset();
        stack.put(entry,0); todo.add(entry);
        boolean reject = false;
        while (!todo.isEmpty() && !reject) {
            monitor.checkCancelled();
            long address = todo.removeFirst(); Instruction i = ins.get(address);
            if (i == null) continue;
            int sp = stack.get(address); int nextSp = sp; int h = half(i.getAddress());
            if (!thumb(i)) { reject=true; break; }
            String mnemonic = i.getMnemonicString().toLowerCase();
            // Only supported constant SP modifications are accepted.
            if ((h & 0xfe00) == 0xb400) nextSp -= 4 * (Integer.bitCount(h & 0xff) + ((h >>> 8) & 1));
            else if ((h & 0xfe00) == 0xbc00) nextSp += 4 * (Integer.bitCount(h & 0xff) + ((h >>> 8) & 1));
            else if ((h & 0xff00) == 0xb000) nextSp += ((h & 0x80) != 0 ? -1 : 1) * 4 * (h & 0x7f);
            else {
                String operand0 = i.getNumOperands() > 0 ? i.getDefaultOperandRepresentation(0).toLowerCase() : "";
                if ((operand0.equals("sp") || operand0.startsWith("sp!")) && !mnemonic.startsWith("cmp") && !mnemonic.startsWith("tst")) { reject=true; break; }
            }
            // A direct SP-relative store to the original saved LR slot disqualifies the function.
            if ((h & 0xf800) == 0x9000 && sp + 4 * (h & 0xff) == -4) { reject=true; break; }
            if (Math.abs(nextSp) > 4096) { reject=true; break; }
            List<Address> successors = new ArrayList<>();
            Address fall = i.getFallThrough();
            if (fall != null) successors.add(fall);
            if (!i.getFlowType().isCall()) successors.addAll(Arrays.asList(i.getFlows()));
            for (Address target : successors) {
                long t = target.getOffset(); if (!ins.containsKey(t)) continue;
                preds.computeIfAbsent(t,k->new HashSet<>()).add(address);
                Integer old = stack.get(t);
                if (old != null && old.intValue() != nextSp) { reject=true; break; }
                if (old == null) { stack.put(t,nextSp); todo.add(t); }
            }
        }
        if (reject) return accepted;
        for (Instruction i : ins.values()) {
            int h = half(i.getAddress());
            if (i.getLength()!=2 || !thumb(i) || (h & 0xff87) != 0x4700) continue; // exact BX, not BLX or MOV PC.
            int reg = (h >>> 3) & 15;
            if (reg > 7) continue;
            long address = i.getAddress().getOffset();
            Instruction pop = ins.get(address - 2);
            if (pop == null || pop.getLength()!=2 || !thumb(pop) || singletonPopBxRegister(half(pop.getAddress()),h)<0) continue;
            if (!Objects.equals(stack.get(address-2),-4) || !Objects.equals(stack.get(address),0)) continue;
            Set<Long> incoming = preds.get(address);
            if (incoming == null || incoming.size()!=1 || !incoming.contains(address-2)) continue;
            if (i.getFlowOverride() != FlowOverride.NONE) continue;
            Map<String,Object> evidence = new LinkedHashMap<>();
            evidence.put("function",hex(entry)); evidence.put("address",hex(address));
            evidence.put("prologue",first.toString()); evidence.put("pop",pop.toString()); evidence.put("branch",i.toString());
            evidence.put("register",reg); evidence.put("sp_before_pop",-4); evidence.put("sp_after_pop",0);
            evidence.put("saved_lr_source","entry PUSH including LR stores original LR at entry SP-4");
            evidence.put("proof_scope","CFG constant-SP propagation; all merges agree; branch sole predecessor is singleton POP; direct SP-relative saved-slot stores rejected. Calls assumed balanced; arbitrary aliasing stores not disproved.");
            accepted.add(evidence);
        }
        return accepted;
    }

    @Override public void run() throws Exception {
        long t0=System.currentTimeMillis(); String output=null; String runId=null;
        for (String arg:getScriptArgs()) { if(arg.startsWith("out=")) output=arg.substring(4); if(arg.startsWith("run_id=")) runId=arg.substring(7); }
        if(output==null) throw new IllegalArgumentException("out= required");
        List<Map<String,Object>> changes=new ArrayList<>(); List<Map<String,Object>> candidates=new ArrayList<>(); int inspected=0;
        // First inspect every function against the unchanged program, then mutate only accepted branches.
        for(Function f:currentProgram.getFunctionManager().getFunctions(true)) { monitor.checkCancelled(); inspected++; candidates.addAll(candidates(f)); changes.addAll(inspect(f)); }
        for(Map<String,Object> change:changes) {
            Instruction i=currentProgram.getListing().getInstructionAt(toAddr(Long.parseLong(((String)change.get("address")).substring(2),16)));
            i.setFlowOverride(FlowOverride.RETURN);
        }
        Set<String> applied=new HashSet<>(); for(Map<String,Object> c:changes) applied.add((String)c.get("function")+":"+c.get("address"));
        for(Map<String,Object> c:candidates) if(applied.contains((String)c.get("function")+":"+c.get("address"))) c.put("accepted",true);
        Map<String,Object> report=new LinkedHashMap<>(); report.put("run_id",runId); report.put("heuristic",true); report.put("criteria_version",1);
        report.put("source_script_sha256",HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(getSourceFile().getFile(false).toPath()))));
        report.put("functions_inspected",inspected); report.put("candidate_count",candidates.size()); report.put("candidates",candidates);
        report.put("start_ms",t0); report.put("end_ms",System.currentTimeMillis());
        report.put("instructions_in_bounded_functions",instructionCount); report.put("flow_overrides",changes.size());
        report.put("changes",changes); report.put("wall_ms",System.currentTimeMillis()-t0);
        report.put("limitations","Heuristic ABI pilot only; indirect aliasing stores and callee stack balance are not independently proved. No arbitrary BX, MOV PC, software stack, or true computed-dispatch override.");
        Files.createDirectories(Paths.get(output));
        Files.write(Paths.get(output,"returns.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report).getBytes(StandardCharsets.UTF_8));
        println("Heuristic returns applied "+changes.size()+" exact saved-LR candidates over "+inspected+" functions");
    }
}
