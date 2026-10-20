# MegaMan Zero: air entry, ordered air step and landing

This is one **static causal closure candidate**, with a concrete dispatch route and explicit unresolved dependencies. MegaMan Zero remains partial; this is neither a composable package nor native qualification. Mario retains depth priority. No compiler, queue, catalog, UI, dependency, build or native-run changes were made.

The own-ROM export contains 5,122 function records. The actual cache contains **800 HighFunction function records plus one export-summary.json** (801 total JSON files), matching the durable queue's 800 exported functions. Individual target files were read; 21 of the 23 prioritized targets have cached HighFunction. The required division routine `0x080c8ad0` and dispatcher bridge `0x080c8a98` have corpus records but no files in this game's bounded HighFunction cache. A filename search of `local/ir` and `local/re` also found no `080c8ad0` export. Corpus pseudo-C is an interpretation aid, never compiler input. No manual C recovery was used.

The ROM SHA256 is `cf505422d68295fba36136a49a3c9dedb104ab16aa542edaeecbb89efdd57807`; the functions export SHA256 is `949f91443e51c0249106082aeaadf32a94b064843c412ba7ba5a3133f8a6fc5b`. Both match the retained queue entry. [packet.json](packet.json) records exact per-target HighFunction, ROM body and canonical function-record hashes, source commit, original export paths, operations and call dependencies. The corpus includes warning-prone ABI/boundary recovery and does not establish whole-game coverage.

## Concrete causal path

`0x0801f5f0` indexes ROM table `0x082a99ec` by actor byte `+0x0f`. The two ROM words are `0x0801f609` and `0x0801f675`, selecting Thumb functions `0x0801f608` and `0x0801f674`. Air entry cancels vertical velocity when its sign opposes acceleration, selects animation, and under state bytes `e=2,f=0` writes `f=1` and calls the air step in the **same tick**.

The air step calls `0x08016d78` to consume an indexed command-history byte, set facing and update X; calls terrain handling with shared actor position/contact subviews; integrates Y using the **old** vertical velocity; queries vertical contact; queries reduction; updates signed acceleration and next velocity; then consumes the saved contact result for landing state rewrites and landing event 6. Reordering integration, correction, acceleration and state writes changes the mechanic.

The actor's halfword at `+0x0e` aliases bytes `+0x0e/+0x0f`. Its command ring, position and previous/contact subviews must remain inside one canonical actor backing. Shared effective input `0x02022b62` has one producer/publication, including synthetic and disabled-input branches. Do not make independent callee copies. Physical offsets belong to provenance and validation bindings; executable ports need symbolic owned state and alias-preserving views. Pixel scale and frame rate were not established here.

An upstream launch candidate `0x080164ec`, guarded by `0x08016374`, sets upward velocity and packed state `0x0201`. That means `e=1,f=2`, whereas this air entry uses `e=2,f=0`. **A launch-to-this-air-step scheduling connection is not proved.** “Wall rebound” is a hypothesis, not a promoted mechanic label.

## Compiler-relevant blockers and next action

ROM bytes at `0x08016682`, `0x0801f840` and `0x08000fc4` are `00 47` (Thumb `BX r0`); cached HighFunction represents each as `CALLIND`. Resolve the stack/return ABI before classifying these as callbacks or erasing them. Real table dispatch also needs explicit resolution and a proven index domain.

Start with cached `0x08016d78` as a small direction/position target, preserving indexed actor storage and packed facing writes. Then resolve the entry/air-step return ABI and shared collision views. A separately authorized extraction batch must supply the missing math/dispatch L0. Terrain routines mutate shared geometry and return contact/reduction values; animation fields feed controller conditions, so neither terrain nor animation can be replaced with arbitrary no-op services. No complete terrain, actor lifecycle, input ring producer or launch scheduling closure is claimed.

## Checks, qualification and timing

All 5,122 function lines parsed. ROM and export hashes matched; both table entries and all three BX sites matched the source ROM. The consolidation/hash audit took **0.078150167 seconds**, including reads, SHA256 calculations, target inventory and packet construction. That narrow elapsed measurement is not the full research-session duration; a session start timestamp was not captured. Queue time is unavailable.

Historical discovery retained **7.16325225 s** for export-process time, **0.38487975 s** for static census and **7.554859542 s** total; stage times are nested, not additive to total. These are prior discovery measurements, not this analysis's runtime. The retained queue has 101 static candidates and **zero** native-qualified behaviors, port-ready subsets or closed mechanics for this game. Generic past capture media does not qualify this particular closure. Native/build/simulation/evaluation stages were **unrun** here, and no before/after implementation-latency comparison exists because no implementation changed.

The final packet integrity check (JSON parse, six source assertions, 23 target records and 21 cached L0 references) passed in **0.000178292 s**. This check is separate from the consolidation audit.

A focused schema audit corrected the total-file interpretation: 800 files have format `gameverse.l0.highfunction/0.2`; the remaining file is `export-summary.json`. The audit command took **0.191700042 s** wall time.
