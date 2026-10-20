# Ruby executable extraction advance

Recovered own-ROM initializer `08000400` and four-row menu column-clamp `080e7ab8` through automatic HighFunction → L1 → generated native code. Original/generated parity passed 512 and 1,024 synthetic cases respectively. The clamp is conditional on row 0..3, evidenced by mode-1 controller wrapping given valid entry state; this does not establish general menu reachability or legal zero-length row invariants.

The two missing menu HighFunctions were exported in 3.480261666 s under EX029. Original project unchanged; permit released. Initializer qualification took 0.218713334 s; clamp qualification 0.218158541 s, including nested compile/link/oracle stages. These are finite synthetic native helper checks, not gameplay traces or whole-subsystem qualification.

Sampler `08000428` stops at KEYINPUT MMIO service support: v4 is ROM literal at `08000464` containing `04000130`. The controller `080e77e8`, linked with the recovered clamp, stops at shared collection/direct-field alias: `row_limits[1]` at `020011ab` is directly loaded by the same controller. Both exact failures were sent to the compiler owner; no shared code was edited. Return-proof handling already succeeds for the clamp.

Machine-readable source-backed system: `l2-contract/system.json`. Actual private L1/native receipts, export receipts, retained failures, hashes and next actions: `result.json`. No manual C/compiler input, new games, templates, global queue/catalog edits, broad inventory or new dependencies. All games remain incomplete.
