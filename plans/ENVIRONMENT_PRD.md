# Game environment PRD

> 2026-10-16 scope update: Pokémon FireRed is the sole initial game, compiled from editable source. Mario is deferred and does not block slice 1. Finish FireRed play, controls, save/return/resume and recovery before expanding. [Current setup, evidence and remaining gates](../DEVELOPMENT.md).
Date: 2026-10-15 · Owner: Vishal · Status: agreed three-slice scope; slice 1 implementation is in progress; acceptance remains open.

Parent: [issue #1](https://github.com/vishaltandale00/gameverse.ai/issues/1). Delivery: [three vertical slices](ENVIRONMENT_SLICES.md). The [overall PRD](../PRD.md) retains the complete product acceptance requirements. This specification replaces the earlier fixture-first, eight-slice plan.

## Outcome and delivery

Gameverse starts as a browser launcher: create a character, select FireRed, play, return to the selector and resume the exact session after restarting. Next, an open-world base replaces menu-only discovery with navigation to a game entrance. Finally, the environment integrates with Shishir's improvement loops for both the base and subgames.

| Slice | Player experience | Tracking | Dependency |
| --- | --- | --- | --- |
| 1 | Character creator and FireRed selector with exact-session resume | [#3](https://github.com/vishaltandale00/gameverse.ai/issues/3) | FireRed/browser feasibility resolved within the slice |
| 2 | Explore an open-world base and navigate into FireRed | [#4](https://github.com/vishaltandale00/gameverse.ai/issues/4) | Slice 1 hands-on acceptance |
| 3 | Request improvements, keep playing, then play verified updates or forks | [#5](https://github.com/vishaltandale00/gameverse.ai/issues/5) | Slice 2 and the agreed interface with Shishir's harness |

Vishal owns the environment, FireRed integration, open-world navigation, controls, persistence and host-controlled activation/recovery. Shishir owns the independently versioned build/improvement harness in [issue #2](https://github.com/vishaltandale00/gameverse.ai/issues/2), including transcript/builder workflows, algorithms and experiment/resource policy. Slice 3 is joint integration, not a transfer of his implementation responsibilities. His harness and shared-interface work can proceed alongside slices 1 and 2.

FireRed is the sole initial selectable game, built from editable source. FireRed requires source/build/browser/save/restore qualification. Additional fixture games and an open world are not prerequisites for slice 1. Multiplayer, public distribution, native console delivery and a mandatory central orchestration system remain outside scope.

## Slice 1 character creator and FireRed selector

**Journey:** open Gameverse → create/select character → select FireRed → play → return to selector → close/reopen browser → select character/FireRed → resume the captured moment, including mid-battle.

The Gameverse character has a name and preset avatar and owns persistent game progress. FireRed retains its own trainer creation; automatic appearance/name translation is not required. The selector contains one FireRed entry with start/continue, loading, unavailable and error states. Starting fresh must be a deliberate action that protects existing progress.

Deliver the actual complete GBA FireRed game, not a restricted recreation. Pin its source/build/artifact and emulator/core versions. Prove browser play, audio, controller/keyboard input, ordinary in-game saving and emulator snapshot export/import. Source/build/runtime choice still requires qualification; existing research is not a passing runtime test.

### Exact session resume

On a normal return to the selector, pause execution, capture the emulator snapshot, durably store it with its identity/context and confirm success before disposing the runtime. Reopening loads the matching game/core and snapshot, restores focus without held-input leakage, then resumes the captured execution state. Snapshot metadata includes profile, game/version, cartridge digest, emulator/core and snapshot-format version where available, plus checkpoint identity/revision.

Keep normal FireRed in-game saves as a separately retained fallback. A snapshot and an in-game save are distinct records; restoring one must not silently destroy a newer confirmed record of the other. Failed capture/write retains the previous confirmed checkpoint and offers retry, cancel or an explicitly disclosed forced return. A failed snapshot restore offers an explicit fallback/retry choice, not a silent new game or downgrade to an older save.

The acceptance guarantee covers an explicit return after the snapshot is confirmed, followed by browser restart. Abrupt browser/OS termination recovers the last confirmed checkpoint; automatic checkpoint cadence is an implementation choice to measure, not a guarantee of saving the final frame during shutdown. Exact-session resume applies to the matching unchanged game/emulator versions. Cross-version updates need separately verified compatibility in slice 3.

### Controls and recovery

DualSense, Xbox and keyboard complete routine creation/selection/play/return/resume. Reserve Gameverse-owned navigation/feedback actions, clear held inputs on focus changes and reconnect, and prevent duplicate entry or concurrent writes to the same profile/game progress. Record actual browser/OS and controller connection modes.

Loading, crashes, stalls, invalid saves and failed writes leave a responsive shell with truthful retry/return choices and the last confirmed compatible checkpoint. The improvement worker may be absent: play and persistence still work, while feedback reports unavailable without inventing a queued request. Full transcription/build/candidate workflows belong to slice 3.

**Acceptance:** retain a continuous real-browser journey including a mid-battle snapshot, process/browser restart and exact continuation; an ordinary in-game-save fallback; controller/input/recovery evidence; reproducible pinned baseline/build logs and real early/mid/late campaign/save checks with documented full-campaign qualification scope and results. Full game availability and campaign verification must not be inferred from a title screen or source checksum. Pause for Vishal's hands-on review before expanding to slice 2.

## Slice 2 open world and game entrances

**Journey:** enter the world as the Gameverse character → move/explore → discover FireRed's entrance → enter/play → return to the world → resume the same FireRed session later.

Select and qualify a small reused open-world base. The existing profile, FireRed adapter, controls and progress remain in use; the new work is world play, discovery, entry and return placement. The base owns presentation and its pause/continue policy, subject to truthful adapter capabilities. Do not prescribe doors, NPCs, a universal library UI or a specific engine before selection.

**Acceptance:** world navigation and entry/return work on both controller families and keyboard; profile and FireRed snapshot/in-game saves survive moving from the menu base to the world base and browser restart; failed entry leaves a usable world and safe progress. Retain source/config/artifact/adapter identity, measured world/runtime behavior and continuous browser evidence. FireRed progress is preserved; no additional game or fixture is required.

## Slice 3 improvement loop integration

**Journey:** invoke feedback in FireRed or the base → review/correct scoped text → durable request receipt → keep playing during build/verification → inspect/reply in builder → verified safe update or discoverable fork → play the result and give further feedback.

Jointly agree versioned game/environment/loop configs, capabilities, run context, candidate submission/result and timing examples before depending on them. The loop supplies proposals, executable evidence, compatibility and immutable source/build/artifact references. The host supplies isolated pinned sessions, accepted registration, truthful game state, progress protection and activation/recovery. Shishir retains ownership of his algorithms and scheduling; no new central orchestrator is required.

Registration and activation are distinct. New/update/fork retries return durable idempotent results. Expected baseline, current progress, evidence, cancellation and capabilities are rechecked at activation. Apply eligible updates automatically at a verified safe boundary using copied/validated progress, candidate load and resume-health checks before commit. Failed/stale/cancelled/incompatible candidates preserve the original compatible pair. Forks have separate identity/progress and pinned lineage; offered progress transfers require tested mappings.

An old emulator snapshot is not assumed portable into changed FireRed code. Preserve the original snapshot with its original version; use verified in-game-save compatibility/migration for changed versions. Lossy rollback retains newer records, discloses consequences and requires the player's choice.

**Acceptance:** actual exchange with Shishir's harness; two durable improvement cycles including a new mechanic/quest; explicit base and FireRed targets; isolated simulation state; new/fork availability, receipts/retries/rejection, safe activation and crash/rollback recovery. Reference submissions may help development but do not certify real loop integration. Overall PRD E01–E05 remain staged product qualification within slice 3, including workshop creation and mashups; they are not extra initial installed games or additional vertical slices.

## Requirement coverage

The existing V-REQ identifiers are retained for traceability. The three slices supersede their earlier delivery order and fixture requirements.

| Requirement | Delivery |
| --- | --- |
| V-REQ1 replaceable base | Slice 1 menu/creator base, slice 2 reused open world, slice 3 compatible base updates |
| V-REQ2 manifests and immutable references | Pin FireRed/base/environment/core identity in slices 1–2; complete candidate provenance in slice 3 |
| V-REQ3 environment and adapters | Player lifecycle/input/checkpoint/recovery in slice 1; world adapter in slice 2; simulation/activation in slice 3 |
| V-REQ4 base-owned discovery | FireRed selector in slice 1; world discovery in slice 2; newly accepted content in slice 3 |
| V-REQ5 input/profile/progress | Persistent name/preset character and exact-session resume in slice 1, retained through slices 2–3 |
| V-REQ6 isolated background instances | Slice 3 |
| V-REQ7 durable candidate boundary | Slice 3; slice 1 uses a pinned manually supplied FireRed baseline |
| V-REQ8 safe activation and recovery | Player/runtime/save recovery in slice 1; candidate switching and rollback in slice 3 |
| V-REQ9 scoped feedback | Reserve action/context and truthful unavailable state in slices 1–2; real workflow in slice 3 |
| V-REQ10 lean CI and timings | Every slice under AGENTS.md |

## Timing and remaining decisions

No runnable environment/CI/loop baseline is established by this plan. Measure source setup separately from clean/incremental builds, recording cache state and outcome. Measure load, input response, snapshot capture/write/restore, ordinary-save persistence and recovery in slice 1; world operations in slice 2; queue/build/simulation/evaluation/repair and activation in slice 3. Reuse existing tool timestamps and retain failed/cancelled outcomes with run/source/game/config/environment/adapter and applicable loop context. Distinguish CI queue, job wall time, critical path and aggregate work; annotate overlapping stages and unavailable metrics.

Justify each added dependency/job/check by coverage and expected cost before adding it. Compare representative before/after inputs and environments when turnaround changes; report missing baselines explicitly. Routine CI uses narrow lifecycle/persistence/coordinator checks. Broad campaign/browser matrices, physical-controller qualification and expensive simulations/LLM evaluations are separately triggered with explicit limits. No numeric latency SLA or unlimited-resource permission is implied.

Remaining choices: selected GBA browser runtime/toolchain and snapshot format; browser/OS matrix, preset assets and storage durability/write exclusion; measured operation deadlines and optional checkpoint cadence; slice 2 world/renderer/entrance/policy; slice 3 wire formats, supported compatibility ranges and loop resource configuration. Name plus preset avatar, separate FireRed trainer and exact-session resume in slice 1 are agreed requirements.
