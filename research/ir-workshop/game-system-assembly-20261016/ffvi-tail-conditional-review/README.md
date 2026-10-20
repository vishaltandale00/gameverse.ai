# FFVI conditional tail source review

Scoped source clearance for frozen VM compiler `2cd4149707d2b51faabd4b8ee8cbcf43d9f603c7fd9e01264156d218a5fdee78` and the actual EX073 tail rooted0808b6ca. Exact27 implementation/proof/candidate file pins are retained in review.json. This releases one bounded native qualification attempt after the separate native-frame review; it does not establish native parity.

The new simplification prunes a CBRANCH only when its exact p-code condition evaluates to a literal under the declared entry context. It records that SSA value and rechecks the proof after all incoming edges have joined; stale first-predecessor constants reject the whole transform. Unknown conditions retain both successors. Source/CFG/step/resource budgets remain unchanged. Retained focused checks cover true/false host execution, three unknown selectors with both edges retained, and stale mixed-predecessor proof rejection.

In the actual tail, context byte03007106 is native-visible field28 with exact entry domain0. Source subtracts2, stores byte254, shifts the full result left24 to fe000000 and uses its negative flag at BMI0808b714. Thus only under this declared context the selected edge is0808b718; the outer-loop edge0808b716 is excluded. Target2 and unknown-target contexts remain rejected in retained focused probes. This is contextual branch proof, not a generic loop bound.

The actual continuation spill is field24 at03006ffc, with null input domain and no portable data reads. Three source calls to helper08134b14 each copy incoming LR, add4 and store at r5-4; their source BL continuations yield portable tokens1/2/3 for0808b6d3,0808b6fd,0808b705. STORE provenance is retained as op110/op2908/op4195. Strict finite codec handling keeps numeric code addresses adapter-only and rejects unknown observed spill values. Native r5+4/r7+2 frame and exit checks remain the separate ABI review scope.

The eight source regions contain185 instructions. Owner and frozen tail-candidate-v2 raw bundle, L1, adapter and C match byte-for-byte; normalized SSA hash and raw source hashes match their adapter pins. Sixteen retained entry states and expected-field-subset records each cover all32 admitted fields. They are prepared semantic expectations, not executed evidence from this review.

The retained HP regression keeps393 blocks, normalized SSA identity and identical L1/C; its adapter assumptions differ only in ordering. No unchanged HP native campaign was repeated. Actual tail static lift took0.234143 seconds. Review total and queue timing are unavailable.

Read-only source/metadata/proof inspection: no tests, builds, native calls or browser. Fixed target0 and source stream/frame only; no arbitrary target, full VM, battle-system or whole-game qualification claim.
