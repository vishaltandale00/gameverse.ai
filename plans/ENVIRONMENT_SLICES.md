# Gameverse vertical slices

> 2026-10-16 scope update: Pokémon FireRed is the sole initial game, compiled from editable source. Mario is deferred and does not block slice 1. Finish FireRed play, controls, save/return/resume and recovery before expanding. [Current setup, evidence and remaining gates](../DEVELOPMENT.md).
Date: 2026-10-15 · Status: three agreed slices; slice 1 in progress; slices 2 and 3 unimplemented. Parent: [#1](https://github.com/vishaltandale00/gameverse.ai/issues/1). Scope: [environment PRD](ENVIRONMENT_PRD.md) and [overall PRD](../PRD.md).

| Slice | Issue | Dependency |
| --- | --- | --- |
| 1 Character creator and FireRed selector | [#3](https://github.com/vishaltandale00/gameverse.ai/issues/3) | Browser/FireRed feasibility inside the slice |
| 2 Open-world base and game entrances | [#4](https://github.com/vishaltandale00/gameverse.ai/issues/4) | Slice 1 hands-on acceptance |
| 3 Improvement loop integration | [#5](https://github.com/vishaltandale00/gameverse.ai/issues/5) | Slice 2 plus Shishir's versioned harness/interface in [#2](https://github.com/vishaltandale00/gameverse.ai/issues/2) |

Adapters, persistence, controls, recovery, versioning, simulations and activation are implementation tasks within these three player journeys. FireRed is the sole initial game and uses an editable source build. Mario is deferred. The earlier eight-slice plan is superseded; #6–#10 are retired and their applicable requirements are incorporated below. Harness development/shared-interface work can proceed in parallel; these dependencies govern integrated player acceptance.

## Slice 1 Character creator and FireRed selector

**Owner:** Vishal. **Outcome:** create/select a character → select FireRed → play → return to selector → close/reopen browser → resume the exact captured moment, including mid-battle.

**Scope:** persistent Gameverse name and preset avatar; separate FireRed trainer creation; FireRed selector with start/continue/loading/error states; complete GBA FireRed browser integration; versioned load/input/pause/checkpoint/restore/dispose adapter; shell controls and external progress storage. No open world or running improvement worker is required. FireRed is the only game required in slice 1.

**Acceptance:**

- [ ] Pin and build/obtain the declared FireRed baseline with reproducible source/build/artifact evidence; pin the emulator/core and demonstrate actual browser play/audio/input. A restricted clone or title-screen boot does not qualify.
- [ ] Profile name/avatar survive refresh/restart and own FireRed progress; existing progress is protected when starting fresh. FireRed keeps its own trainer creation.
- [ ] Both DualSense and Xbox plus keyboard complete creation/selector/play/return/resume; document browser/OS, connection modes and mappings. Focus transitions, held buttons, double entry and reconnect do not leak or duplicate actions.
- [ ] Explicit return pauses execution and durably confirms a snapshot before disposal. Store profile/game/version/cartridge digest/core/snapshot-format/checkpoint identity; reload the matching versions and resume a demonstrated mid-battle moment after browser restart.
- [ ] Retain normal in-game saves independently as fallback. Failed snapshot capture/write preserves the previous confirmed checkpoint; failed restore offers explicit retry/fallback without silently resetting or overwriting newer records. Forced exit explains unconfirmed progress loss.
- [ ] Abrupt termination recovers the last confirmed checkpoint; do not promise the last frame was saved during shutdown. Prevent concurrent writers to the same profile/game progress.
- [ ] Failed boot, crash, stalled runtime, invalid snapshot/save and failed writes leave responsive shell recovery. Worker absence does not block play/save/resume; reserved feedback reports unavailable without a false durable receipt.
- [ ] Retain continuous browser proof, actual early/mid/late campaign/save checks and documented full-campaign qualification scope/results, pinned setup/run instructions and measured build/load/input/snapshot/restore/recovery behavior.

**Verification and cost:** first prove FireRed browser play and snapshot export/store/restart/import with the selected runtime. Use targeted lifecycle/input/persistence failure checks; keep broad campaign/browser/controller qualification separately triggered. Establish the first actual baseline, then compare affected operations under matching inputs/toolchain/cache conditions. Follow AGENTS.md before adding checks/dependencies.

**Gate:** Vishal tries the complete journey before expansion to slice 2. Exact resume is for unchanged matching game/emulator versions; candidate compatibility belongs to slice 3.

## Slice 2 Open world and game entrances

**Owner:** Vishal. **Depends on:** [slice 1 / #3](https://github.com/vishaltandale00/gameverse.ai/issues/3). **Outcome:** enter an open world as your Gameverse character → navigate to FireRed → play → return to the world → revisit and resume.

**Scope:** select and qualify a simple reused open-world base; character representation, movement/interactions, game discovery and return placement. Reuse slice 1's FireRed integration, input, profile and progress through the environment interface. Source/runtime, entrance presentation and pause/continue policy remain implementation/design choices.

**Acceptance:**

- [ ] Pin/build/run the selected world and adapter; it is playable and navigable, with a discoverable FireRed entrance and truthful readiness/error states.
- [ ] Existing profile identity/preset and FireRed snapshot/in-game saves survive the transition from menu base to world base and browser restart; no re-created trainer or silent reset.
- [ ] Both controller families and keyboard complete world movement/entry/play/return/resume without input/audio/session leaks or duplicate entry.
- [ ] Return restores a valid intended world location and focus. Failed game entry or world operation leaves usable recovery and the last confirmed progress.
- [ ] World-specific presentation/session policy remains in base config/implementation and respects actual adapter capabilities. FireRed retains its identity and progress; no additional game or fixture is required.
- [ ] Retain continuous browser evidence, exact world/game/config/adapter versions, setup instructions and measured build/world-load/navigation/return behavior. Worker absence remains supported.

**Verification and cost:** reuse slice 1 lifecycle/persistence checks and add world-entry/return cases only. Compare equivalent FireRed operations to slice 1 and measure new world overhead separately. Pause at a user-tryable world journey before integrated slice 3 acceptance.

## Slice 3 Integrate games with improvement loops

**Owner:** Vishal for environment integration; Shishir for his harness and workflow in [#2](https://github.com/vishaltandale00/gameverse.ai/issues/2). **Depends on:** [slice 2 / #4](https://github.com/vishaltandale00/gameverse.ai/issues/4) plus agreed v0 interface and runnable loop. **Outcome:** feedback in FireRed or base → corrected scoped request → keep playing during build/verification → safe update or playable fork → play result → follow-up feedback.

**Scope:** connect the shared invocation/context and transcript/builder workflow; versioned config/run/submission/result/timing exchange; isolated simulations; durable idempotent registration; base-owned discovery of accepted results; host-controlled safe activation/recovery. Shishir retains algorithm/search/resource ownership; no central orchestrator is mandated.

**Acceptance:**

- [ ] Exchange and implement agreed game/environment/loop config, capabilities, run, submission/result and timing examples with exact pinned references. Both initial construction and later improvement are represented; real integration uses Shishir's harness, not reference-only proof.
- [ ] Controller/voice feedback captures the exact original base/subgame version/session/profile/progress context; editable transcription, durable receipt and builder conversation survive navigation/reconnect without retargeting or duplicate jobs.
- [ ] Continue playing while work runs; two improvement cycles produce durable playable versions including a real mechanic/quest. Demonstrate both FireRed and base targeting and preserved follow-up feedback.
- [ ] Two pinned background sessions use fresh/copied state, report actual outcomes and clean up without mutating accepted player progress or taking focus. Shishir owns experiment scheduling.
- [ ] New/update/fork submissions retain immutable source/config/artifact/evidence/parents/compatibility/run references. Receipts survive restart and retries; cancelled/stale/failed/unsupported submissions cannot promote. Registration/availability and activation are separate.
- [ ] New games/forks become discoverable through the base, with independent identity/progress and lineage. Offered progress transfer uses a tested mapping on copies; parent records remain intact.
- [ ] Eligible updates revalidate current baseline/progress/cancellation/evidence and apply automatically only at a verified safe boundary: checkpoint/copy/validate or migrate/load/health-check/commit. Failure or interruption restores a compatible original pair, for both base and FireRed.
- [ ] Preserve slice 1 snapshots with their original game/core. Do not use old execution snapshots as assumed migration into changed code; qualify in-game-save compatibility/migration. Retain newer records and require the player's choice for lossy rollback.
- [ ] Retain actual loop/environment exchange, continuous player and failure evidence, relevant automated checks and comparable timing/outcome reports including failed/cancelled attempts. Overall PRD E01–E05 remain staged qualification inside this slice, not extra initial games/slices.

**Verification and cost:** reuse earlier adapter/lifecycle/recovery checks, then add bounded receipt/activation/isolation cases. Use reference submissions during development but keep actual loop acceptance open until exercised. Broad campaign/version matrices and expensive model/evaluation runs are separately triggered with explicit resource/repair limits. Measure queue/build/simulation/evaluation/repair/activation with both harness configs; distinguish nested/parallel stages and unavailable data.
