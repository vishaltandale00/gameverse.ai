# PMD generic Mashup admission

The four published input-lifecycle components now have actual generic Composer binding receipts. Two scopes were admitted with `binding_valid_obligations_unproven`: a three-component shared-u16 initialize → pressed-clear → repeat-suppression graph, and a separate publication graph whose recovered IR copies packed words before clearing accumulated event lanes. A four-component graph attempting the source-required packed-word/halfword alias was correctly rejected: `output narrowing requires qualified source field domain: publish.field_0`.

[manifest.json](manifest.json) pins requests, actual receipts, published package/source identities and validator source hashes. [source-context.json](source-context.json) records the ownership, ordering, opaque state and service limits. Existing finite native qualification is retained; this pass performed only symbolic binding and actual Composer lowering.

The graphs do not establish full original input-context identity: publication uses packed u32 output words, while the lifecycle helpers access their u16 halves. The current Mashup API has no bit-slice alias binding. Opaque publication-tail and auxiliary reset state remains private. KEYINPUT sampling and the stateful producer remain unresolved outside these leaves. No copied state is presented as preserved source aliasing, and no fixed FPS or elapsed-time unit is assigned to invocation counters.

Actual validator times were 0.012048083 s, 0.011240208 s and 0.001578458 s (0.024866749 s total). Validator time is nested within process time; do not add both. No native rerun, ROM generation, game generation, build or fresh mining occurred. All games remain partial.
