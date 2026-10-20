# Private Thumb decoder context

The installed Ghidra12.1.4 API explains the Wario absent-instruction failure. `ProgramContext.getValue()` combines saved/default context; `getNonDefaultValue()` and `getDefaultValue()` return `RegisterValue` with separate definition masks. Wario's target had no saved instruction or nondefault TMode value; its combined zero came from default ARM context. That alone was not evidence of an explicit conflicting ARM instruction.

`PseudoDisassembler.disassemble(address, pseudoContext, false)` calls `getTargetStartContext`, which calls `pseudoContext.flowStart(address)` before reading its base register context. A current-only `setValue(TMode,ONE)` before that call can therefore be discarded. The installed implementation's low-bit mode handling uses the future-register path. For an independently source-proven Thumb target:

```java
var context = new PseudoDisassemblerContext(program.getProgramContext());
context.setFutureRegisterValue(address, new RegisterValue(TMode, BigInteger.ONE));
var instruction = new PseudoDisassembler(program).disassemble(address, context, false);
```

This changes only a private pseudo context. It is not permission to change Program context, overwrite conflicting instructions, infer a boundary from arbitrary data or insert code. Existing instructions/explicit nondefault conflicts, instruction interiors and unrelated function ownership remain failures. Record intended and final private context plus exact decoded bytes/length and source-table/guard evidence. Undefined mask bits must stay undefined; do not use `IgnoreMask` to manufacture a saved value.

Primary API evidence was read locally with `javap -c -p` from `Ghidra/Framework/SoftwareModeling/lib/SoftwareModeling.jar`, specifically `PseudoDisassembler.disassemble(Address,PseudoDisassemblerContext,boolean)`, `getTargetStartContext`, and `setTargetContextForDisassembly(DisassemblerContext,Address)`. `ProgramContext`/`RegisterValue` signatures were inspected directly. No Internet assumption or guessed version API was used.

Wario's separately permitted V3 nonmutating audit subsequently validated158 ordered table entries,15 unique targets and393 source-flow instructions with private Thumb context retained. Its all-paths-to-frame result still assumes two named direct callees preserve AAPCS state. The audit grants no metadata-repair/native qualification. Earlier failed audits remain retained by the owner.

Earlier FFVI pseudo-decoded AND/OR source artifacts remain valid: those exact requested helper addresses had saved Thumb context and their output bytes, mode, operations and register writes were verified. The new diagnosis does not justify rerunning unchanged valid exports.
