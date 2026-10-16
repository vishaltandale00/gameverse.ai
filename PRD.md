# Gameverse — Product Requirements Document

> 2026-10-16 scope update: Pokémon FireRed is the sole initial game, compiled from editable source. Mario is deferred and does not block slice 1. Finish FireRed play, controls, save/return/resume and recovery before expanding. [Current setup, evidence and remaining gates](DEVELOPMENT.md).
Version: 0.4 · Date: 2026-10-15 · Status: implementation-planning baseline

This PRD consolidates the design conversation. User decisions are requirements; proposed defaults and unresolved decisions are labeled. It is not a claim that the product has been built. Engineering execution starts in [HANDOFF.md](HANDOFF.md).

Delivery has three agreed vertical slices: (1) character creator and FireRed selector with exact-session resume, (2) an open-world base with navigation into FireRed, and (3) integration with the improvement loops. See [TASKS.md](TASKS.md), the [environment PRD](plans/ENVIRONMENT_PRD.md) and [slice checklists](plans/ENVIRONMENT_SLICES.md). Adapters, persistence, recovery, simulation and activation are implementation tasks inside those slices. The earlier fixture-first/eight-slice split is superseded.

The current parallel-work requirements are in [PARALLEL_DEVELOPMENT.md](contracts/PARALLEL_DEVELOPMENT.md): Vishal owns the versioned environment harness; Shishir owns the separately versioned config-defined build/improvement harness. Start with a character creator/menu base; add a simple reused open world in slice 2. Keep games swappable through adapters/manifests and let each base own discovery/session policy. The loop operates during initial builds and later improvements and can simulate isolated versions before submitting candidates. Exact schemas and Shishir's acceptance remain joint work.

## 1. Product and intended outcome

Gameverse is a single-player, browser-based environment where one person uses a controller to **play games and develop those games through conversation**. The player creates a character, enters a base world, plays the complete Pokémon FireRed experience, requests changes while playing, and visits a workshop to create games from a blank project, a fork, or a mashup.

The improvement loop must create durable changes to game behavior, content and mechanics. A voice-controlled settings panel alone does not satisfy the product. Examples include a new quest or infiltration mechanic, alongside simpler requests such as regional difficulty changes.

The human supplies intent, plays the result and gives further feedback. The configurable processor and the conversation/verification workflow can themselves evolve. Future multiplayer/community search across promising game branches is a long-term direction, not an MVP dependency.

## 2. User and environment

The initial user is the project owner working locally for a private proof of concept. Routine play, requests, transcript corrections, builder conversations, candidate status and game/version navigation should remain on the game display and controller.

Target input: DualSense/PS5 and Xbox controllers connected to a computer, plus keyboard/mouse fallback. This is not a native console release. Initial installation, pairing, credentials and OS/browser permissions may require a keyboard or mouse; this exception must be disclosed rather than repeated during routine operation.

Browser execution is required. A local companion worker may perform transcription, processing and builds. Local gameplay does not imply that every configured AI service runs locally. A zero-install hosted URL is not a confirmed MVP requirement.

## 3. Scope and decision status

| Area | Requirement or decision | Status |
| --- | --- | --- |
| Initial audience | Single player, local/private PoC | Confirmed |
| Initial game | Complete GBA FireRed in slice 1, compiled from editable source; Mario deferred | Confirmed |
| Session continuation | Exact emulator-session resume, including mid-battle, after confirmed return and browser restart under matching game/core versions; retain normal in-game saves as fallback | Confirmed for slice 1 |
| Creation | Blank projects, forks and mashups; basketball and basketball × Pokémon are examples | Confirmed |
| Change execution | Asynchronous; user supplied no latency limit | Confirmed |
| Change classification | Agent decides update versus fork | Confirmed |
| Updates | Same game identity, old/new versions retained, checkpoint/reload at a safe boundary | Confirmed |
| Forks | Separate games with lineage; progress adapters may be supplied | Confirmed |
| Verification | Core loop defined in the game proposal before build | Confirmed |
| Human interaction | Editable live transcript and a builder channel/sidebar or workshop setting | Confirmed |
| Backward compatibility | A formal rule is required; progress-preserving rule below operationalizes it | Rule proposed for implementation |
| Base/subgame separation | Slice 1 character/menu base; slice 2 reused open-world base; same FireRed integration and progress through configs/adapters | Confirmed; world source/runtime and presentation remain open |
| Harness/config versions | Independently version environment and LLM harnesses, base/subgames and their config/object references | Confirmed; exact schema/transport remains joint work |
| Loop scope | Initial game construction and later improvement of base games/subgames; isolated simulation; update/fork submissions | Confirmed; internal algorithms/search representation belong to Shishir |
| Character creation | Persistent Gameverse name and preset avatar; FireRed keeps its own trainer creation | Confirmed for slice 1; world avatar representation remains to qualify |
| Technology | Browser environment and supported game adapters; reused source/world choice and local worker implementation to qualify | Open; older Godot-city and FireRed-adapter proposals are research inputs |

Slices 1 and 2 must support play without an improvement worker. Complete FireRed integration is inside slice 1. No open world or fixture-first gate precedes FireRed. Keep the shell/FireRed adapter reusable when slice 2 introduces world-based discovery.

### Three vertical slices

| Slice | Experience and acceptance boundary | Tracking |
| --- | --- | --- |
| 1 | Create/select name/preset character → select FireRed → play → return to selector → close/reopen → resume the captured moment, including mid-battle. Keep normal saves, controller/keyboard support and responsive recovery. | [#3](https://github.com/vishaltandale00/gameverse.ai/issues/3) |
| 2 | Enter a reused open world as the Gameverse character → navigate to FireRed → play → return at a valid world location, retaining slice 1 progress and resume. | [#4](https://github.com/vishaltandale00/gameverse.ai/issues/4) |
| 3 | Connect real improvement loops to base and subgame targets: scoped feedback/build/verification → safe update or independent fork → play and follow up. | [#5](https://github.com/vishaltandale00/gameverse.ai/issues/5) |

Pause for hands-on review of each playable experience before expansion. Shishir may develop his versioned harness in [#2](https://github.com/vishaltandale00/gameverse.ai/issues/2) in parallel; actual integrated slice 3 acceptance depends on the playable environment and agreed interface. The full creation/workshop/evaluation requirements below remain staged qualification in slice 3, not extra initial games or vertical slices.

### Included in MVP

Character/profile creation; playable world entry; complete FireRed integration; controller/keyboard play; voice requests with live text and correction; configurable asynchronous game builder; builder channel; proposal-defined verification; compatible updates; separate forks/mashups and lineage; workshop creation of a playable game; checkpoints, history and recovery.

Basketball is the first suggested workshop demonstration. Basketball × Pokémon demonstrates meaningful composition and lineage, with a progress adapter only when a transfer is offered. They are not two preinstalled subgames that must precede the initial FireRed loop.

### Outside MVP

Public game distribution, native console builds, multiplayer, crowd voting/beam-search infrastructure, production GTA-scale fidelity, universal automatic compatibility across arbitrary runtimes, instantaneous live code replacement, and guaranteed success for every request. No narrative connecting the games is required. Publishing this planning repository is a separate preparation task.

## 4. End-to-end journeys

**Slice 1 play and exact resume:** open browser → create/select Gameverse character → select FireRed → play → return and confirm emulator snapshot → close/reopen → resume the same game/core at the captured moment.

**Slice 2 world navigation:** enter the world as your character → navigate to the FireRed entrance → play → return to the world → revisit and resume.

**Play and improve:** launch browser shell → create/select character → enter game → record a request → review/correct transcript → queue → continue playing → inspect builder when desired → verified update waits for safe boundary → checkpoint/reload → play changed version → give more feedback.

**Build a game:** enter workshop/open builder → speak a concept or choose source games → agent records a proposal and classification → asynchronous build and verification → new game entry appears → enter it with controller → play its declared loop → iterate.

**Recover:** a failed candidate leaves the current game playable. Inspect failed checks and respond/retry/cancel in the builder channel. A revert shows checkpoint consequences, preserves newer saves and restores an artifact/checkpoint pair that can actually run together.

## 5. Functional requirements

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| R01 | Persistent shell and profile: name/preset character and FireRed selector in slice 1, world navigation in slice 2 and workshop/builder integration in slice 3. | Profile survives reload/transitions; FireRed retains its separate trainer creation; progress stays associated with the selected Gameverse profile. |
| R02 | Complete FireRed baseline inside slice 1. Preserve campaign, maps, battles, progression and supported saves rather than substituting a restricted demo. | Reproducible baseline artifact, browser play evidence, representative early/mid/late campaign fixtures and documented full-campaign QA coverage. Source availability alone is insufficient. |
| R03 | Controller-first operation and keyboard fallback. Reserve one semantic feedback action across all games and overlays. | Both controller families complete routine journeys; no double actions from overlay/game focus; reconnect and input loss recover. |
| R04 | Live transcription and correction. Display provisional/final text and captured game/version context; allow voice replacement, rerecord, append, playback and controller navigation. | Correct a deliberate misrecognition before queuing without typing at a laptop. A final transcript is never labeled verified intent. |
| R05 | Durable request submission. Freeze reviewed text, context and active baseline under a request ID; revisions must be explicit. | Refresh/reconnect recovers submitted work, retries do not duplicate jobs, and switching games does not retarget a request. |
| R06 | Config-defined, independently versioned asynchronous build/improvement harness targeting base games and subgames during construction and later improvement. | Pin exact loop and environment/game/config versions; real source/content/mechanic changes build into artifacts; internal algorithms remain configurable. |
| R07 | Persistent builder channel scoped to game/request. Show interpretation, proposal, classification reasoning, work state and verification evidence. | Controller can reply, refine, cancel, retry, pause/resume and inspect history; failed work is visible without opening an editor. |
| R08 | Versioned proposal defines the core loop and acceptance scenarios before each build attempt. | Preconditions, actions and assertions are executable; proposal revision is attached to evidence; repairs do not silently weaken checks. |
| R09 | Agent chooses update/fork and explains the choice. | Update retains game identity; fork has a new identity and pinned parent lineage. Failed intended updates cannot be relabeled to evade checks. |
| R10 | Verified updates apply automatically via checkpoint/reload at a safe boundary. | No switch during unsafe state; original artifact/save retained; candidate resumes and passes health check before activation commits. |
| R11 | Backward-compatible updates preserve recognized progress. | Copied supported save fixtures load/migrate, preserve progress and remain reachable; failed compatibility blocks promotion. |
| R12 | Forks/mashups have independent progress and explicit adapters when transferring progress. | Parent is unchanged; lineage is inspectable; transfer preview identifies mapped/dropped fields; target validates the copied result. |
| R13 | Blank/fork/mashup workshop creation produces a playable game. | A proposal becomes a verified artifact/library entry with a repeatable core loop and the shared feedback action. |
| R14 | Shared verification/submission contract for updates and new games, with isolated background simulation. | Build, boot, input, core loop, requested behavior and save/adapter checks bind to exact artifacts and run context; parallel simulations preserve accepted player state. |
| R15 | Version history, rollback and failure recovery. | Compatible old artifact/checkpoint can be restored; newer saves retained; potential progress loss is disclosed and explicitly chosen. |
| R16 | Config-defined, versioned and replaceable base under versioned environment/adapter contracts: character/menu first, open world second. | Pin config/source/build/artifact/adapter references; discovery/session policy belongs to each base; transitions and supported updates preserve profile/library/progress and do not mix cached versions. |
| R17 | Exact-session resume for each selected GBA game in slice 1 using a durably confirmed emulator snapshot, with separately retained normal in-game saves. | Explicit return → close/reopen → matching game/core → resume a demonstrated mid-battle moment. Failed capture/write/restore preserves prior confirmed records and offers explicit retry/fallback; no silent reset. |

### Proposed recording defaults

R3 toggles recording; F8 is keyboard fallback. After stopping and final transcription, show a stable review card. A/Cross queues, B/Circle cancels, D-pad selects text/action, X/Square replaces a phrase by voice, and Y/Triangle plays audio. Provide labeled append/rerecord actions and an on-screen keyboard fallback. Bindings are remappable and must be physically tested.

Review-first submission is a proposed default, not a confirmed requirement for an extra approval screen. Once submitted, a correction is a new request revision/cancel-and-replace event. Active game/version/location can be attached automatically; screenshots/clips and their retention need explicit configuration. The transcript UI must never confuse confidence with correctness.

### Builder and proposal behavior

The agent may work from a reasonable interpretation rather than forcing a planning interview for every change. A proposal need not require manual approval; the user delegated classification. The channel is the place to inspect, refine and answer consequential questions. It must show when work has failed or needs input rather than appearing to run forever.

Proposal content: player actions, repeating action/challenge/reward/reset loop, success/failure, persistent state, intended change, constraints, compatibility, acceptance scenarios and parent/version references. Freeze the verification contract for each attempt; change intended requirements by issuing a new proposal revision, retaining previous evidence.

## 6. Version and compatibility rules

**Same-version exact resume:** snapshot captures emulator execution state, while a FireRed in-game save captures game-defined persistent progress. On explicit return, pause/capture/durably confirm the snapshot before disposal. Bind it to profile, game/version/cartridge digest, emulator/core, available snapshot-format version and checkpoint revision. Keep ordinary saves separately; restore must not silently overwrite newer confirmed records. Snapshot failure offers retry/cancel/explicit fallback or forced return with disclosed consequences. Abrupt browser/OS termination recovers the last confirmed checkpoint; final-frame shutdown saving is not promised.

**Changed-version continuation:** preserve the original snapshot with its original version. Do not assume it can resume changed cartridge code or another emulator/core. Slice 3 updates require separately verified in-game-save compatibility/migration and safe activation.

**Update:** same game ID; new immutable version; preserved recognized progress through supported save loading or verified migration. Recognized progress includes profile references, party/roster, inventory, currency, badges/unlocks, quest completion and relevant world flags. Migration must preserve meaning and reachability, not merely parse bytes.

**Fork:** new game ID, independent proposal/saves, parent game/version lineage. An intentional incompatible redesign may use this path. A mashup records multiple parents and the contribution of each. A blank game has no game parent; engine/template dependencies are separate metadata.

**Progress adapter:** optional explicit mapping from source semantic progress to a target schema. Run on copies, declare copied/mapped/dropped fields and balance rules, preview the outcome, verify the target, and leave the parent save intact. Without a verified adapter, clearly present the fork as fresh progress. A FireRed party becoming a basketball roster is an illustrative adapter, not a raw-save copy.

**Safe application:** runtime-reported and verified safe state → checkpoint → copy/migrate/validate save → load candidate → resume health check → atomically activate. Proposed safe boundaries include module transitions, match ends and idle overworld checkpoints. Battles, cutscenes, dialogue, recording/correction and save/adapter writes are unsafe. Failure restores the original compatible pair.

**Rollback:** backward compatibility does not imply old code understands a newer save. Preserve newer saves with their versions. A revert to an old checkpoint may lose subsequent progress; show that consequence and require a controller choice. Carrying subsequent progress backward requires a verified reverse adapter.

## 7. Evaluation scenarios

The system must generalize beyond these examples; they are evaluation cases, not the only supported intents.

| ID | User request | Required verification |
| --- | --- | --- |
| E01 | “The Pokémon in Viridian Forest are too weak, make them stronger.” | Scoped stronger encounters, adjacent areas unaffected, saves compatible, follow-up feedback still works. The existing +3-level wild-table patch is only a provisional source-level probe. |
| E02 | “I don't know how to beat Misty's Starmie, give me a quest to find a strong electric type. Pikachu isn't cutting it.” | Quest reachable from an actual pre-Misty save without later HM/badge gates; useful intended electric strategy; one-time reward and party-full behavior; persistent quest; original badge/TM progression intact. |
| E03 | “I want to infiltrate Team Rocket.” | A playable new infiltration/cover/access behavior, reachable start, detection/failure retry, persistent state, no progression-flag collision, original campaign still reachable. |
| E04 | “Create a basketball game.” | Agent proposal defines possession/scoring/match completion; verified repeated play, save/return and shared feedback. |
| E05 | “Create a basketball × Pokémon game.” | Proposal identifies an actual composed mechanic, separate game identity and lineage; that mechanic affects play and is tested; any offered progress import uses a verified adapter. |

The suggested quest stories, rewards and mechanics are candidate interpretations the agent can refine through feedback, not fixed product content.

## 8. Quality and MVP exit criteria

- Slice 1: demonstrate creator/selector/FireRed/return/browser-restart/exact-mid-battle-resume and normal-save fallback on both controller families and keyboard, including failure/recovery cases.
- Slice 2: demonstrate character/world/entrance/FireRed/return with preserved existing progress.
- Slice 3: demonstrate the complete play/request/build/checkpoint/reload/feedback journey on both controller families, after disclosed setup exceptions.
- Demonstrate at least two consecutive durable improvement cycles, including a new mechanic or quest; regional parameter edits alone cannot meet the exit criterion.
- Run E01–E05 as staged qualification scenarios with retained evidence. No launch claim based solely on a successful compiler exit or on headless smoke tests.
- Prove failed verification and stale candidates cannot replace a current game; replay a failed job without duplicate promotion.
- Verify supported save fixtures and actual rollback recovery. No silent resets or parent-save mutation.
- Measure frame rate, input response, recording/transcription time, queue/build time and recovery time on the target computer. Establish a playability budget during the runtime spike. No user-approved build-latency SLA exists.
- Track CI queue/job/critical-path time and clean/incremental build plus loop/simulation/evaluation timings under [AGENTS.md](AGENTS.md). Compare representative baselines and justify added work; broad qualification/expensive simulations are separate from routine CI.
- No recurring editor/terminal use in routine journeys. Provide visible recovery when external setup or developer work is genuinely needed.

## 9. Open decisions and risks

| ID | Open item | Impact / next action |
| --- | --- | --- |
| O01 | Slice 2 open-world source, extent, discovery and session policy | Qualify a reused world after the slice 1 menu/FireRed journey; it is not a slice 1 dependency. |
| O02 | Preset assets and representation in the slice 2 world | Name/preset identity and separate FireRed trainer creation are agreed; qualify world character representation without requiring trainer translation. |
| O03 | Environment/runtime adapters and browser/OS matrix | Benchmark the selected source/runtime; older Godot/EmulatorJS suggestions are not completed selections. |
| O04 | Streaming transcription/provider, capture retention and request review default | Prototype live text/correction and configure processing/data handling explicitly. |
| O05 | Repair/cost budgets and human-escalation thresholds | Set configurable limits before autonomous builds; no latency target does not authorize unlimited work. |
| O06 | Supported save/version ranges and reverse adapters | Declare support before promotions; retain older saves/artifacts beyond the tested range. |
| O07 | Exact config/run/submission/timing schemas, transport and first executable reference target | Agree v0 across issues #1/#2 before parallel implementations harden incompatible assumptions; observation/action and simulation details remain open. |

Source/build prerequisites, physical controller behavior and full-campaign verification remain risks documented in the handoff. The old desktop/two-subgame config is historical and must not override this PRD.

## 10. Provenance and implementation status

Current artifacts: [MVP contract](MVP_CONTRACT.md), [source research](POKEMON_SOURCE_RESEARCH.md), [audit results](research/pokemon/audit-results.json), [scenario designs](research/pokemon/scenarios.json), [proposal example](design/game_proposal.example.json).

Slice 1 now has a runnable local shell and matching source-built FireRed browser boot/input/snapshot evidence. Mario is deferred and is not an acceptance dependency. Mid-battle/campaign/controller qualification and actual voice service, autonomous builder, generated quest, save migration and automatic switching remain unimplemented or unverified. These results are not MVP acceptance. See [HANDOFF.md](HANDOFF.md) for the exact starting state and first work package.
