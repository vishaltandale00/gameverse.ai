# FF I/II admission coverage

The published `ff12.choice.entry_transition` component passed real `assembly.py` validation, Composer and lowering in two retained requests:

- One invocation: `binding_valid_obligations_unproven`, 0.011095958 s.
- Sixteen ordered invocations of the same instance: `binding_valid_obligations_unproven`, 0.011357583 s.

[gap-manifest.json](gap-manifest.json) pins the exact package, behavior, requests, receipts, source contract and open obligations. Package SHA256 is `dcdc427b1b140c05538f3e266a32e8151f4d997876de3e0e83c3956eddadd663`; before/after pins remained stable.

All 13 typed fields bind explicitly to one external, shared caller scene. No private state defaults, invented owner, fixed FPS or runtime service is used. The first request starts at phase 6 with counter 15. The sequence starts with counter zero and retains the same scene across 16 explicit calls. Original phase-6 dispatch and wrapped signed counter comparison support that bounded order; admission does not execute it or prove the intervening input/render/fade/IRQ schedule.

Only this FF I/II member is public in the composition contracts. The sequence is a temporal selfsequence, not a distinct-component connection. Navigation remains compiler-blocked; context restoration remains private with opaque wider meanings. No partner was invented to create a graph.

These positive receipts establish binding/lowering coverage. They do not establish runtime L2, full mechanic closure, actual gameplay reachability or whole-game completion. Earlier absence of a receipt meant untested, not rejected. Existing native proof was reused unchanged; this pass performed no mining, JVM work, native rerun, generated game or ROM, and made no shared catalog/index/UI changes.

Next: retain these admissions in coverage reporting, then close navigation, input, scene-loop and IRQ/render/audio service obligations before claiming a complete executable choice subsystem. Queue and full interactive analysis durations are unavailable. No code or turnaround system changed, so no comparable before/after speed benchmark applies.
