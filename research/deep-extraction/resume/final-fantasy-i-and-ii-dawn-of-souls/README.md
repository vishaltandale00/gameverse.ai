# Final Fantasy I & II: choice controller resume evidence

This is a blocked static dependency-closure candidate, not a qualified mechanic or a recovered game. All 33 games remain partial; Mario remains the depth priority. The exact queue item, immutable source hashes, nine function records, historical census failures and next actions are in [packet.json](packet.json).

The concrete behavior is bounded choice navigation and confirmation. Its actual gameplay screen and association with the bundled FFI versus FFII engine remain unconfirmed. It does not establish combat or progression recovery.

Own-ROM constructor `0x0801bed0` sets the option count and selected index. Input poll `0x08011d70` writes pressed edges consumed by `0x0801cfb4` and `0x0801d100`. The former enters phase 6 with a zero transition timer; `0x0801d074` advances its timer and writes phase 7 plus cursor state after 16 invocations from zero. The correspondence of phase numbers to callbacks still needs exact dispatcher evidence. Navigation at `0x0801d100` gives A priority over B and Up priority over Down, wraps the index, and projects cursor coordinates to x=84, y=104+10*index. B sets the cancellation sentinel 2, writes phase 10 and skips cursor projection. A writes phase 10 and still reaches cursor projection. Nonwrapping navigation emits two feedback requests when the index changes; wrapping emits one. Preserve this order and multiplicity until service behavior is qualified.

The constructor can produce count zero and accepts negative initial indices under its observed signed comparison. A semantic port must establish the real caller domain; adding a clamp would change behavior. Input history, scene fields and embedded cursor/fade views require shared ownership and alias preservation. `0x0801d200` conditionally advances the phase on fade completion, so palette timing may own a required scene transition. Result wrapper `0x0801d490` reads the selected index, but scheduling and object lifecycle remain open.

The earliest blockers are concrete:

- Historical census rejects navigation with `unresolved callee closure 0818c250`. Its feedback call passes the Thumb target `0x0818abfd` in r1, resolving to `0x0818abfc`; generic trampoline calls cannot all become the same service.
- HighFunction/C interprets the controller epilogue as an unknown indirect call. Retained assembly shows `0x0801d1ec pop {r4-r7}`, `0x0801d1ee pop {r0}`, `0x0801d1f0 bx r0`. Repair return recovery from binary evidence, never by feeding hand C into the compiler.
- Input polling has historical `unresolved pointer v4`; define a symbolic input service and shared edge/repeat state.
- Missing caller edges and unresolved vtable/phase dispatch prevent a complete scheduler, completion and destruction contract.

Start with existing static `candidate_275` for `0x0801d074`, then navigation, input polling, constructor, entry transition, fade completion and result lifecycle. Shared compiler edits require the coordinator's lease. No headless Ghidra, build, native run, queue/catalog/UI edit or dependency was performed here. Retained decompiler C and reviewed C are analysis/verification oracles only.

Historical evidence is limited: the queue reports 485 bounded L0 exports, 24 static candidates and zero native-qualified/port-ready/closure-ready behaviors. The larger own-ROM functions export contains 4,589 records. The queue's retained discovery took 9.197943667 s, including 8.797700958 s export-process and 0.392126833 s static census; these are historical measurements, not new work. General frontend captures do not qualify this choice closure.

Current packet generation plus ROM/export/L0 hash checks took 0.108588 s (nested reads and hashes; not full analysis-session duration). ROM SHA256 and source-export SHA256 matched the exact queue item, and all available selected HighFunction hashes matched the historical census. Full analysis duration, queue wait, build, simulation and evaluation durations are unavailable or unrun, not zero. No comparable before/after turnaround measurement applies because no implementation was changed.

Next: compiler owner resolves the pinned navigation trampoline and stack-return idiom, retains ordered service calls, and recovers the exact scheduler/vtable closure. Only then qualify legal and boundary state domains, A/B/direction conflicts, navigation wrap, cancellation, timer completion and aliasing against the original ROM and emitted code, followed by a bounded reachable native scenario.
