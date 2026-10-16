// Read-only HighFunction SSA/CFG export; independent of the shared GbaExport.
// @category GBA
import java.nio.file.*;
import java.util.*;
import com.google.gson.*;
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.pcode.*;
import ghidra.program.model.listing.*;

public class ExportBehavior extends GhidraScript {
    IdentityHashMap<Varnode,String> ids = new IdentityHashMap<>();
    JsonArray vars = new JsonArray();
    Gson gson = new GsonBuilder().setPrettyPrinting().create();

    String var(Varnode v) {
        if (v == null) return null;
        if (ids.containsKey(v)) return ids.get(v);
        String id = "v" + ids.size(); ids.put(v,id);
        JsonObject x = new JsonObject(); x.addProperty("id",id);
        x.addProperty("size",v.getSize());
        x.addProperty("space",v.getAddress().getAddressSpace().getName());
        x.addProperty("offset",Long.toUnsignedString(v.getOffset()));
        x.addProperty("constant",v.isConstant()); x.addProperty("input",v.isInput());
        if (v.isRegister()) {
            var register = currentProgram.getRegister(v.getAddress(),v.getSize());
            if (register != null) x.addProperty("register",register.getName());
        }
        vars.add(x); return id;
    }

    int blockAt(HighFunction h, ghidra.program.model.address.Address a) {
        for (PcodeBlockBasic b : h.getBasicBlocks()) if (b.contains(a)) return b.getIndex();
        return -1;
    }

    JsonObject export(Function f, DecompInterface decompiler) throws Exception {
        ids.clear(); vars = new JsonArray(); long started = System.nanoTime();
        DecompileResults result = decompiler.decompileFunction(f,2,monitor);
        HighFunction h = result.getHighFunction();
        if (h == null) throw new Exception(result.getErrorMessage());
        JsonObject root = new JsonObject();
        root.addProperty("format","gameverse.l0.highfunction/0.2");
        root.addProperty("entry",f.getEntryPoint().toString());
        root.addProperty("diagnostics",result.getErrorMessage());
        JsonArray blocks = new JsonArray(); int n = 0;
        for (PcodeBlockBasic b : h.getBasicBlocks()) {
            JsonObject row = new JsonObject(); row.addProperty("id",b.getIndex());
            row.addProperty("start",b.getStart().toString()); row.addProperty("stop",b.getStop().toString());
            JsonArray edges = new JsonArray(), predecessors = new JsonArray();
            for (int i=0;i<b.getOutSize();i++) edges.add(b.getOut(i).getIndex());
            for (int i=0;i<b.getInSize();i++) predecessors.add(b.getIn(i).getIndex());
            row.add("successors",edges); row.add("predecessors",predecessors);
            if (b.getOutSize()==2) {
                row.addProperty("true_successor",b.getTrueOut().getIndex());
                row.addProperty("false_successor",b.getFalseOut().getIndex());
            }
            JsonArray ops = new JsonArray(); Iterator<PcodeOp> iterator = b.getIterator();
            while (iterator.hasNext()) {
                PcodeOp o = iterator.next(); JsonObject op = new JsonObject();
                op.addProperty("id","op"+(n++)); op.addProperty("opcode",o.getMnemonic());
                op.addProperty("pc",o.getSeqnum().getTarget().toString());
                op.addProperty("output",var(o.getOutput())); JsonArray inputs = new JsonArray();
                for (int i=0;i<o.getNumInputs();i++) inputs.add(var(o.getInput(i)));
                op.add("inputs",inputs); ops.add(op);
            }
            row.add("ops",ops); blocks.add(row);
        }
        JsonArray tables = new JsonArray();
        for (JumpTable jt : h.getJumpTables()) {
            JsonObject table = new JsonObject(); table.addProperty("pc",jt.getSwitchAddress().toString());
            JsonArray cases = new JsonArray(); var labels = jt.getLabelValues(); var targets = jt.getCases();
            for (int i=0;i<targets.length;i++) {
                JsonObject c = new JsonObject(); if(i<labels.length && labels[i]!=null)c.addProperty("label",labels[i]);else c.addProperty("label_status","unavailable");
                c.addProperty("target",targets[i].toString()); c.addProperty("block",blockAt(h,targets[i])); cases.add(c);
            }
            table.add("cases",cases); JsonArray guards = new JsonArray();
            var instructions = currentProgram.getListing().getInstructions(f.getBody(),true);
            while (instructions.hasNext()) {
                var instruction = instructions.next();
                if (instruction.getAddress().compareTo(jt.getSwitchAddress())>=0) break;
                if (!instruction.getFlowType().isJump() || instruction.getFlowType().isComputed()) continue;
                for (var destination : instruction.getFlows()) {
                    int target = blockAt(h,destination); if (target<0) continue;
                    JsonObject guard = new JsonObject(); guard.addProperty("pc",instruction.getAddress().toString());
                    guard.addProperty("instruction",instruction.toString()); guard.addProperty("target_block",target); guards.add(guard);
                }
            }
            table.add("prior_conditional_guards",guards); tables.add(table);
        }
        root.add("jump_tables",tables); root.add("blocks",blocks); root.add("varnodes",vars);
        root.addProperty("wall_s",(System.nanoTime()-started)/1e9); return root;
    }

    public void run() throws Exception {
        String[] args = getScriptArgs(); Path output = Paths.get(args[0]); Files.createDirectories(output);
        List<Function> functions = new ArrayList<>(); boolean queued = args.length>1 && args[1].equals("QUEUE"); boolean batch = args.length>1 && args[1].equals("ALL");
        double budget = batch ? Double.parseDouble(args[2]) : 45;
        long maxBytes=128L*1024*1024, writtenBytes=0; boolean outputCap=false; int limit = batch ? Integer.parseInt(args[3]) : args.length-1;
        if(queued){JsonObject selection=JsonParser.parseString(Files.readString(Paths.get(args[2]))).getAsJsonObject();budget=selection.get("budget_s").getAsDouble();limit=selection.get("limit").getAsInt();for(JsonElement e:selection.getAsJsonArray("priority_entries")){var address=toAddr(Long.parseLong(e.getAsString(),16));Function f=currentProgram.getFunctionManager().getFunctionAt(address);if(f==null){currentProgram.getProgramContext().setValue(currentProgram.getRegister("TMode"),address,address,java.math.BigInteger.ONE);disassemble(address);f=createFunction(address,null);}if(f!=null)functions.add(f);}}

        if (batch || queued) {
            var iterator = currentProgram.getFunctionManager().getFunctions(true);
            while (iterator.hasNext() && functions.size()<limit) {var next=iterator.next();if(!functions.contains(next))functions.add(next);}
        } else for (int i=1;i<args.length;i++) {
            Function f = currentProgram.getFunctionManager().getFunctionAt(toAddr(Long.parseLong(args[i],16)));
            if (f==null) throw new Exception("missing function "+args[i]); functions.add(f);
        }
        DecompInterface decompiler = new DecompInterface(); decompiler.openProgram(currentProgram);
        long started = System.nanoTime(); int passed=0; JsonArray failures = new JsonArray();
        for (Function function : functions) {
            if ((System.nanoTime()-started)/1e9>=budget) break;
            String entry = function.getEntryPoint().toString();
            try {
                String content=gson.toJson(export(function,decompiler));long bytes=content.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;if(writtenBytes+bytes>maxBytes){outputCap=true;break;}Files.writeString(output.resolve(entry+".json"),content);writtenBytes+=bytes;passed++;
            } catch (Exception exception) {
                JsonObject failure = new JsonObject(); failure.addProperty("entry",entry);
                failure.addProperty("error",exception.toString()); failures.add(failure);
            }
        }
        decompiler.dispose(); JsonObject summary = new JsonObject();
        summary.addProperty("schema","gameverse.l0.export-run/0.2"); summary.addProperty("requested",functions.size());
        summary.addProperty("exported",passed); summary.add("failures",failures);
        summary.addProperty("budget_s",budget); summary.addProperty("wall_s",(System.nanoTime()-started)/1e9);
        summary.addProperty("budget_exhausted",passed+failures.size()<functions.size());summary.addProperty("output_byte_cap",maxBytes);summary.addProperty("written_bytes",writtenBytes);summary.addProperty("output_cap_reached",outputCap);summary.addProperty("available_program_functions",currentProgram.getFunctionManager().getFunctionCount());
        summary.addProperty("per_function_timeout_s",2); summary.addProperty("read_only",true);
        Files.writeString(output.resolve("export-summary.json"),gson.toJson(summary));
    }
}
