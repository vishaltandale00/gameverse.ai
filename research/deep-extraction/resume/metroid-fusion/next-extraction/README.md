# Fusion original-ROM jump/contact extraction

Five targeted missing HighFunctions were exported under permit EX024 in 3.349998084 s, with the original Ghidra project unchanged. Existing cached functions were reused. No game or ROM was generated.

Two members now have automatic executable L1 and original-ROM native differential receipts:

- `08006240`: directional horizontal acceleration and signed speed clamp — 256 vectors, 12,283 native instructions, pass.
- `08004d60`: packed current-state snapshot followed by current-state resets — 256 vectors, 25,678 native instructions, pass.

These finite synthetic fixtures establish member parity within the recorded harness scope. They do not establish full controller reachability or a qualified jump/contact system. Generated C is automatic lowering of pinned HighFunction L1; manual/decompiler C is used only for analysis.

[system.json](system.json) and [l2-contract.json](l2-contract.json) describe the source-backed jump-transition, movement and terrain-contact subsystem with source line references, exact L0 hashes, inputs/state/output, packed aliases, services, conditional order and honest gaps. [result-manifest.json](result-manifest.json) links the L1/adapter/receipt hashes, actual stage timings, retained failures and next action.

The corrected closure attempt consumes actual fresh exports. Terrain `08068b1c` fails at native `08068b68` because the original shared map index needs bounded pointer/world domains. Integration `08009d78` fails at `08009dbc`: the guarded jump-table offset `(state-4)*4` loses its bound during subtraction. Transition members encounter the same switch-index class. Exact diagnostics and repeatable private runners were sent to the shared compiler owner. Initial local runner output also retains a corrected export-pool path mistake; those obsolete missing-L0 failures are explicitly distinguished from current compiler failures.

Native/build stages are nested in the first 0.439759709 s private attempt; the corrected export-pool lift attempt took 0.028321791 s. Packaging took 0.02009375 s. Queue time and full interactive duration are unavailable. All writes are confined to this research directory and the private Fusion output root. No compiler, queue, catalog or shared UI changes were made.

Next: repair guarded table bounds and exact terrain reference domains, qualify unchanged source roots, then recover the actual driver and frame order before claiming complete executable L2.
