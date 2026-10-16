# Delivery tasks

> 2026-10-16 scope update: Pokémon FireRed is the sole initial game, compiled from editable source. Mario is deferred and does not block slice 1. Finish FireRed play, controls, save/return/resume and recovery before expanding. [Current setup, evidence and remaining gates](DEVELOPMENT.md).
Date: 2026-10-15 · Status: three agreed vertical slices; slice 1 implementation is in progress; acceptance remains open.

The [PRD](PRD.md) and [environment PRD](plans/ENVIRONMENT_PRD.md) define scope. [The slice specifications](plans/ENVIRONMENT_SLICES.md) contain acceptance checklists; [the base plan](plans/BASE_GAME.md) describes implementation order. These three player experiences replace the earlier eight-slice and T1/T2/T3 delivery decomposition.

| Slice | Owner | Deliverable | Dependency | Tracking |
| --- | --- | --- | --- | --- |
| 1 | Vishal | Name/preset character, FireRed selector, complete GBA game, controls/recovery and exact-session resume | FireRed/browser feasibility inside the slice | [#3](https://github.com/vishaltandale00/gameverse.ai/issues/3) |
| 2 | Vishal | Reused open-world base, character navigation, FireRed entrance and return with preserved progress | Slice 1 hands-on acceptance | [#4](https://github.com/vishaltandale00/gameverse.ai/issues/4) |
| 3 | Vishal and Shishir at the integration boundary | Scoped feedback/build/play journey, isolated simulation, candidate receipts, safe updates/forks and recovery for base/subgame targets | Slice 2 and agreed runnable harness/interface | [#5](https://github.com/vishaltandale00/gameverse.ai/issues/5) |

[#1](https://github.com/vishaltandale00/gameverse.ai/issues/1) is the delivery parent with three native subissues. Shishir's separately versioned harness remains [#2](https://github.com/vishaltandale00/gameverse.ai/issues/2); it is an implementation workstream, not a fourth vertical slice. His harness and joint-interface work can proceed alongside slices 1 and 2. The superseded #6–#10 requirements are folded into these slices, not completed work.

## Slice 1 agreed behavior

The character is a persistent Gameverse name/preset avatar; FireRed keeps its own trainer creation. FireRed is the sole initial game, with independent per-profile snapshots and normal saves. Explicit return to the selector captures and durably confirms an emulator snapshot before disposal; close/reopen resumes the same moment, including mid-battle, under matching game/core versions. Keep normal FireRed in-game saves separately as fallback. Failed writes/restores preserve confirmed records and show explicit recovery choices. Abrupt termination recovers the last confirmed checkpoint, not a guaranteed final frame.

Actual FireRed baseline/build/browser integration and campaign/save qualification now belong inside slice 1. The old T2 label is no longer a separate delivery dependency. No open world or additional fixture is needed before the FireRed journey works. Pause for hands-on review of slice 1 before expanding the experience.

## Ownership and joint handoff

Vishal owns the environment harness, base/FireRed adapters, character/profile, discovery/navigation, controls, player progress and host activation/recovery. Shishir owns transcript/builder workflow, durable requests, proposals, construction/improvement algorithms, experiments, verification evidence and loop resource policies.

| Boundary | Vishal supplies | Shishir supplies |
| --- | --- | --- |
| Player/session | Versioned loading, gameplay focus, snapshot/save continuation, return and recovery | Compatible generated/changed artifacts and declared capabilities |
| Shared records | Game/environment/adapter configs and supported operations | Loop config and exact run/input/output provenance |
| Simulation | Isolated pinned sessions, actions/observations, health and cleanup | Experiment scheduling and internal search representation |
| Feedback | Shared invocation, captured original target and shell surface/focus | Editable transcript, durable receipt, builder conversation and status |
| Candidates | Validation/registration, accepted discovery, copied-progress safe activation and recovery | Immutable new/update/fork envelope, parents, compatibility/migrations and artifact-bound verification evidence |
| Timing | CI/build/player/runtime timings under AGENTS.md | Queue/build/simulation/evaluation/repair timings with the same correlation/context meanings |

Start at [PARALLEL_DEVELOPMENT.md](contracts/PARALLEL_DEVELOPMENT.md). Exact v0 formats/transport, simulation vocabulary and supported compatibility ranges require joint agreement. The host protects accepted artifacts/saves; the loop cannot overwrite them directly. Exact snapshots of an old FireRed version are not assumed portable into changed code. A reference submission supports development but does not close real slice 3 integration acceptance.

## Qualification and cost

Each slice retains continuous user-visible evidence, pinned setup/run instructions, meaningful affected checks and actual timings. Both controller families and keyboard, focus/reconnect, failed load/save/runtime, restart and confirmed-progress recovery are part of slice 1. Slice 2 adds world discovery/return; slice 3 adds actual loop exchange, two improvement cycles including a mechanic/quest, base targeting, isolation, new/fork progress, stale/cancelled rejection and safe activation/recovery. Overall PRD E01–E05 remain staged qualification inside slice 3.

Follow [AGENTS.md](AGENTS.md): justify added jobs/dependencies/checks by coverage and expected cost, reuse timestamps, retain failed/cancelled runs, annotate unavailable or nested metrics and compare representative turnaround on matching inputs/environments. Broad campaigns and expensive loop evaluations are separately triggered with explicit limits. No runtime/CI baseline has been measured by this planning change.

## Publication history

P0 planning publication is recorded in [PUBLICATION.md](PUBLICATION.md). The repository publication receipt remains historical evidence; these updated documents and issues do not claim implementation, deployment or completion of any slice.
