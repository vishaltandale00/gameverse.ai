# Emerald generic Mashup admission

[result.json](result.json) pins actual generic `assembly.py` receipts for two published Emerald roots. Both single-root graphs and the paired **side lookup → paired action/battler-order swap** graph pass the real Composer binding/lowering path. The paired graph emits statement SHA256 `2dcbe5cc684d4a8735d0549c7df3b4d28575cc71bbf274f2e3d2b2e04b61dd9a`.

This is an admitted helper schedule with explicit caller-selected handles and swap decision. The source comparator queries battler side before the scheduler conditionally swaps both order lanes. The graph supplies that selection as constants; the missing comparator decision is not recovered. Side lookup has no published return semantic contract, so its result remains unbound. This is not a connected decision controller or full battle L2.

The supplied hypothetical initial state has four battler-side encodings and two separate four-byte order collections. Side encodings use battler handles; the action and battler-order lanes use order positions. All published package and source-contract identities are pinned in [request-pins.json](request-pins.json). This pass invokes only the two Emerald roots actually exposed by the composition-contract index.

Actual negative receipts reject all three attempted unsupported bindings:

- Side-encoding collection aliased to battler-order collection: `collection port contract mismatch`.
- Dynamic same-index handle argument: `parameters require correctly typed finite constants: side.param_0`.
- Swap position 4, outside the qualified 0..3 domain: `component parameter domain is not statically established`.

All six validator invocations total 0.035888 seconds of reported validator wall time. This sum excludes interactive work and process startup. No ROM generation, game/native rerun, exporter, JVM, mining or shared catalog edit occurred. Exact index/alias/domain/order/return/RNG gaps remain in the result contract. Admission proves only pinned bindings and lowering, not runtime reachability, gameplay correctness or arbitrary catalog compatibility.
