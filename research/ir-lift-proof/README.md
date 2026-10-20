# Single automatic L0 → L1 → C → native proof

Passed for **one** own-ROM Sonic function. Behavior came from actual Ghidra
`HighFunction` p-code SSA/CFG, not pseudo-C or a hand-written recovered function.
The generated C is compact named state and typed expressions; no raw addresses,
native offsets, padded actor structs or behavior copied from recovered C occur
in L1 or its generated C.

Review the exact result:

- `artifacts/l0.json`: internal machine SSA/CFG,20 operations,4 blocks.
- `artifacts/l1.json`: automatically recovered two symbolic typed fields and
  structured `if` with wrap-preserving field expressions. Provenance uses opaque
  operation IDs; machine layout stays in L0/validation adapter.
- `artifacts/generated.c`: generated only from the serialized L1 JSON.
- `artifacts/validation-adapter.json` and `.c`: original-machine layout/entry and
  reused libmgba invocation boilerplate, isolated from composition behavior.
- `artifacts/receipt.json`:131,072 original/emitted pairs passed;2,490,368
  combined instructions. Full original32-byte record compared with canaries.
- `artifacts/summary.json`: limits, failures, artifact pins and actual timings.

The L1 example proposes a minimal behavior shape: named state with exact storage
types and separately qualified semantic quantity/unit/frame, typed expression
trees, structured statements, and opaque provenance links. It is a proof artifact,
not a universal schema or completed architecture. Semantic names/units are
explicitly **unknown, confidence0**, rather than guessed from a gravity label.
The verification receipt is external; L1's initial pending annotation is retained
unchanged as the exact compiler input.

`ExportOne.java` is an isolated read-only single-function script. It does not
edit `GbaExport.java`. `lift_one.py` derives base+constant memory clusters,
assigns symbolic field names, resolves a single diamond/phi, emits address-free
L1, then reads that L1 back to generate C. Unsupported forms fail explicitly.
`qualify_one.py` compiles ARM7TDMI and reuses the existing native oracle pattern;
it does not use hand-recovered behavior as its model.

The first native comparison failed. The HighFunction had inverted a condition
without changing the p-code branch operand's machine target. Using that stale
target selected the wrong arm. Exporting and consuming `getTrueOut()` and
`getFalseOut()` fixes the generic CFG interpretation. Failed L1/C/receipt are
retained; no constant or behavior was patched to match the oracle.

Inclusive bounded attempt:174s, including two isolated Java-launch repairs and
the failed parity/CFG repair. Successful compile/link/oracle/parity total and
export/lift timings are in `summary.json`; stage times are nested, not additive.
No comparable previous automatic lift baseline existed. No shared exporter,
native builder, Sonic game work or browser was changed. Mario mining is paused
at the user's explicit direction.

Next work requires a deliberate continuation: generalize opcode/CFG coverage,
infer argument/layout/service contracts and semantic units with evidence, and
run the same differential mechanism over more functions. This proof does not
establish those capabilities or deliver a new GBA game.
