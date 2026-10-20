# Coherent action timer and delayed-event core: blocked prefab

[source-core-loop-map.json](source-core-loop-map.json) traces the original shared input → indexed actor state → gated timer/mode update → bounded event append → snapshot/reset → gated FIFO/locality-aware dispatch boundary. It distinguishes mapped source structure, missing source closure, executable service coverage and required host dependencies. Inventory is explicitly unmapped; no opaque event tag is recast as an item or unlock.

[allowlist-candidate.json](allowlist-candidate.json) proposes one blocked source core and **zero ready prefabs** to the canonical allowlist owner. [manifest.json](manifest.json) pins all evidence. Only the bounded enqueue service is published for this game. A singleton append, duplicate append instances or disconnected cross-game inventory/timer services would not constitute the requested useful core-loop graph.

The smallest executable blocker was refreshed against the current compiler: automatic lifting of the existing own-ROM indexed-state accessor still fails with `unsupported scalar opcode PIECE` in **0.006767 s**. It returns original actor r0 and indexed shared-state pointer r1; integer concatenation alone does not establish alias-preserving pointer result bindings. The exact L0/current compiler hashes and traceback are retained privately and sent to compiler_shared_state.

Existing enqueue native and Composer/lowering receipts remain pinned and unchanged. The prior `binding_valid_obligations_unproven` service admission is not counted as a core prefab. There were no new assembly runs because no meaningful multi-role graph exists among the published packages, and no native rerun, ROM, game, JVM or export. No central UI/allowlist edits were made.

Next: support the paired reference return, then automatically close the gated timed update and original snapshot/reset/drain consumers with the same shared state and source order. A useful prefab must expose its real action admission, input/state defaults, event result and required services; those cannot be manufactured from enqueue alone.
