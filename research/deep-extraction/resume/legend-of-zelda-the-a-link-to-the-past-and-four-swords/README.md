# A Link to the Past & Four Swords: resume evidence

This game remains partial. [packet.json](packet.json) maps one concrete **static causal closure candidate**, an input-triggered timed bit toggle in `0x080042cc`, and twelve prioritized dependencies. It is blocked for executable promotion. Mario remains the depth priority. No compiler, queue, catalog, UI or unrelated research files were changed.

Own-ROM SHA256: `f328f8f07d736288a00c80d31cc1630f3aa02aaf20efdcba73d31dae832b5d76`. The packet pins the 7,079-record own-ROM census, exact per-function C hashes (review/oracle only), actual cached HighFunction files, ROM slices and source commit. Its analysis must not be used as hand-authored C compiler input.

The actual cache contains **800 HighFunction exports**, distinct from the 7,079 census records and 80 L1 candidates. The queue reports zero native-qualified, composable-port-ready or mechanics-closure-ready entries for this game. In particular, the second input engine's `0x0806941c → 0x0806995c` has census pseudo-C but **no cached L0**; this cannot be described as a lift-ready dependency.

The causal chain is:

1. `0x0800bba0` samples active-low input, computes `fresh_edges = held & ~previous_held`, stores fresh edges, then stores held. The symbolic input is shared for the tick.
2. `0x08001d5c` preserves actor in r0 and returns an indexed state pointer in r1. ROM literal `0x08002148` points at table `0x08000ff4`: `0x03006a30`, `0x03006ac0`, `0x03006b50`, `0x03006be0`. They are 0x90 apart. These are shared references selected by actor byte +0x0a; a four-value runtime index constraint is not proven.
3. Once upstream gates in `0x080042cc` allow the region `0x080044e2–0x0800451a`, state byte +0x89 decrements when nonzero. Expiry or fresh edge bit 0x2 toggles bit 0x80 of state byte +0x26. Expiry short-circuits the edge load, so simultaneous expiry/input toggles once.
4. Activation queues event 0x69 via `0x08003dfc`, then reloads timer 0xf0; deactivation clears the timer. The timer unit is eligible controller invocations, not established video frames.
5. `0x08001ec0` and `0x080012fc` can reset +0x26. `0x08001328`, `0x080015bc`, and `0x08007364` consume that byte in interruption/action/interaction gates. Preserve their ordering and shared state.

The semantic name is deliberately neutral: gameplay identity, actor reachability and bundled-engine assignment are unresolved. This evidence does not establish a sword, movement ability, combat system, or complete controller. The event queue is capacity eight, drops when full, and still needs its consumer identified before the event is considered dispensable audio/presentation.

Priority zero is the existing L0 for controller, indexed state accessor and input sampler. Preserve paired return ABI, live r1/flags and shared handle aliases before qualification. The input sampler's opaque indirect jump at `0x0800bbc0` may be a stack return idiom and must be resolved from instructions. No direct caller of `0x080042cc` appears in the census; indirect dispatch reachability remains open. Other priority-one entries recover reset/action/scheduling boundaries. The missing second-engine L0 is priority two, not a reason to generate C manually.

The focused cache/source/hash audit measured **0.684664 s** in the current macOS arm64/Python environment (details in packet). Earlier interactive analysis and queue wait were not instrumented. Historical discovery recorded 8.472362 s export process plus 0.306211 s static census, 8.785543 s enclosing wall time; those are historical discovery timings, not this analysis or native verification. New builds, native tests, simulations and CI were unrun. There is no comparable before/after runtime measurement because no implementation changed. JSON/provenance verification passed in 0.009890 s: 14 source/L0 hashes, five own-ROM slices, cache parsing and missing-target assertions.

Next: the compiler owner should resolve the return/live-register ABI, bind actor handles to shared state, and lift the gated region with event/reset dependencies from existing L0. When native execution is authorized, compare timer 0/1/2/240, both toggle states, input absent/present/simultaneous expiry, event count 7/8, gated ticks and same-handle cross-actor mutation. Obtain second-engine L0 only in a later authorized export batch. This packet does not run headless Ghidra, builds or native fixtures.
