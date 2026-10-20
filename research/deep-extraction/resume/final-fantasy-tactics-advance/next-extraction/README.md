# FFTA: executable terrain-service extraction

Actual execution advanced beyond the earlier static packet: three exact HighFunctions were exported and two own-ROM functions were automatically lifted, validated, lowered and passed finite native differential qualification. [manifest.json](manifest.json) pins sources, artifacts, failures, timings and reproducer scripts. [l2-contract.json](l2-contract.json) describes the coherent terrain-admission subsystem's inputs, borrowed state, guards, outputs, services and source-observed call order. It is a source-backed contract; the full root is not yet executable L2.

| Function | Current result | Scope |
| --- | --- | --- |
| `0801cd4c` | Native parity passed, 1,024 vectors | Rectangle width/height/origin output stores; four distinct destination byte views matching its observed caller |
| `0801cd08` | Native parity passed, 1,024 vectors | Shared grid flag-byte query; x/y 0–15 and stride exactly 16 |
| `0801cc7c` | Automatic linking attempted, blocked | Compiler cannot bind bounds-helper outputs to caller stack bytes: `unresolved pointer v2` |
| `0812e3e8` | Newly exported; automatic lift attempted, blocked | Depends on unresolved validity helper |
| `0812f0e4` | Newly exported; automatic lift attempted, blocked | Adjacent admission policy depends on same validity helper |
| `08098e7c` | Newly exported; automatic lift attempted, blocked | First missing direction dependency is `0809d6bc`; occupancy/height/caller closure remains open |

The getter's stride-16 restriction is an explicit qualification precondition, **not a proven original-game invariant**. Its 511-byte collection at grid offset 1 preserves one contiguous backing span, including intervening availability bytes. The wider subsystem must preserve the same canonical interleaved grid for availability and flags. The bounds helper's native return proof now verifies its original Thumb incoming-LR epilogue; the original static return uncertainty is not the current helper blocker. Overlapping output pointers remain outside qualification.

Native comparisons used the existing original-ROM/emitted-code oracle and retained clean build, ABI and state parity receipts under `local/ir/fleet-next/final-fantasy-tactics-advance/contract-lifts/`. Original and automatically emitted ARM code ran through the native oracle. No generated game ROM, authored behavior wrapper, template, demo, catalog, global queue or shared compiler was produced or edited. Decompiler C remained an analysis oracle only.

Timings: initial launcher failed because the private Java home directory was absent (0.190196291 s); the failure is retained. After directory creation and a new permit, the retry exported 3/3 entries in 3.216263375 s process time, with 0.078159041 s nested exporter work and a 264,504-byte payload. Both permits were released immediately. The helper qualification wall times were 0.208359458 s and 0.202800416 s; stage times are in receipts. Interactive analysis and queue timing are unavailable. These are extraction/qualification measurements, not game-build performance comparisons.

The exact invocation-stack/callee-output failure and private reproducer were sent to `/root/compiler_shared_state`. Next action is to repair that shared symbolic linkage, retry `0801cc7c` and the root, then qualify the guarded query with one grid backing and explicit unit aliases. Grid initialization/allocation/reload, unrestricted stride domains, occupancy callbacks and height checks remain open. The game remains partial, and Mario remains the higher depth priority.
