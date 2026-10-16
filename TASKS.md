# Delivery tasks

Date: 2026-10-15 · Status: reviewable work packages; implementation has not started.

These are task specifications for repository issues and implementation work. The [PRD](PRD.md) remains the overall acceptance baseline; [contracts](contracts/BASE_GAME.md) define the seams used to split delivery. Publication of these specifications does not claim implementation.

Start parallel work from [PARALLEL_DEVELOPMENT.md](contracts/PARALLEL_DEVELOPMENT.md). It captures the latest config/version/discovery/simulation decisions and the remaining schema handoff. Requirements are recorded from Vishal's discussion; Shishir's acceptance and exact interface implementation remain joint work.

| Task | Owner | Deliverable | Dependencies | Status |
| --- | --- | --- | --- | --- |
| P0 — Publish the planning baseline | Vishal | Reviewable repository with README, contracts, task specs and research provenance | Approved publication scope | Public repository and MIT license verified; receipt in PUBLICATION.md |
| T1 — Versioned environment, base and subgame adapters | Vishal | One reused/swappable world, config-defined games, base-owned discovery, play/progress, simulation hooks and candidate activation | Shared v0 interface; source/runtime and browser selection | [Issue #1](https://github.com/vishaltandale00/gameverse.ai/issues/1), assigned to vishaltandale00; unimplemented |
| T2 — Integrate complete FireRed as a subgame | Vishal, for baseline play/integration | Reproducible FireRed artifact, browser adapter and retained play/save/campaign evidence | Subgame contract; toolchain and runtime feasibility | Specified; unimplemented |
| T3 — Versioned build/improvement harness | Shishir (tandalesc) | Config-defined initial builds/improvements for base/subgames, isolated simulations, evidence, updates/forks and timing reports | Shared v0 interface and executable reference; T2 for later FireRed scenarios | [Issue #2](https://github.com/vishaltandale00/gameverse.ai/issues/2); named owner; GitHub assignment rejected; repository integration unimplemented |

T1 and T3 can start in parallel against the same v0 config/adapter/submission/timing contract and an executable reference target. The reference provider and exact wire format still need agreement. T2 source/toolchain work can proceed independently; full FireRed qualification is not a prerequisite for the shared contract or initial handoff. Finishing T1 alone is not full product completion.

## Ownership and joint handoff

Vishal confirmed the ownership split on 2026-10-15: Shishir is building the game improvement loop; Vishal is building the base game and the ability to navigate and play subgames. T1/T2 are the playable environment workstream; T3 is the creation/improvement workstream. Shishir's external work has not been inspected as a runnable integration in this repository.

The proposed joint handoff below needs agreement between the two workstreams; the owner split does not mean the detailed interfaces have already been accepted by both people.

| Integration point | Vishal supplies | Shishir supplies |
| --- | --- | --- |
| Playable game | Registration, versioned loading, gameplay input, save/resume and return to base | Generated/changed game artifacts conforming to the subgame contract |
| Configuration and versions | Game config/environment/adapter meanings and exact supported references | Independently versioned loop config; pinned input/output config and artifact provenance |
| Discovery and session policy | Base-configured discovery/presentation and player-session policy | Compatible submissions; no dependency on a particular world UI or pause/continue policy |
| Background simulations | Isolated sessions, supported runtime/action/context/checkpoint hooks and cleanup | Experiment orchestration and internal candidate/search/version representation |
| Feedback and builder | Shared invocation action, exact game/version context and a shell overlay surface with focus/recovery | Voice/transcript correction, builder conversation, durable request receipt and job status |
| Verification | Observable runtime/input/checkpoint hooks and truthful safe-state reporting | Proposals, executable play/change checks and artifact-bound evidence |
| Activation | Host-owned coordinator that validates eligibility, copies/checkpoints progress, switches versions and recovers | Verified candidate, declared compatibility and any tested migration/progress adapter |
| Turnaround | CI/build/host timings and comparable environments under AGENTS.md | Loop/build/simulation/evaluation/repair timings and outcomes under the same run context |

The loop cannot directly overwrite an accepted artifact or player save. The host cannot claim a candidate is verified merely because it loads. Existing subgames remain playable when the loop is absent or failed.

## P0 — Publish the planning baseline

**Outcome:** another contributor can find the current product intent, implementation status, task ownership and first acceptance journey without reading conversation history.

Scope: inspect intended files; provide entrypoint and ignored local/generated artifacts; preserve existing research with its limitations; reconcile PRD/handoff with the task split; validate local links and JSON examples. Create the initial commit and GitHub repository only after destination/visibility and publication scope are settled. Publish task specs as issues if requested, avoiding duplicate issue/chat creation.

Gate: [publication checks](PUBLICATION.md) pass; the exact initial file set is reviewable; remote URL, visibility and pushed commit are verified after publication. Repository publication does not deploy a game or confer a license on third-party content.

## T1 — Play the base game and enter subgames

Implementation plan: [plans/BASE_GAME.md](plans/BASE_GAME.md). Tracking issue: [#1 — Vishal's versioned game environment requirements](https://github.com/vishaltandale00/gameverse.ai/issues/1).

**Outcome:** launch → create/select character → move/interact in a playable home → enter a subgame → play/save → return → enter a second game → resume prior progress after refresh.

Scope:

- Implement the base-game and shell responsibilities in [BASE_GAME.md](contracts/BASE_GAME.md).
- Begin with a simple reused world and keep it replaceable through versioned configs/adapters. Let that base own discovery and game-specific session policy; do not prescribe a universal library UI or pause/continue rule.
- Supply the config/version/session/submission/timing meanings in the parallel contract, including isolated background instances and candidate receipts/activation.
- Implement registration, version pinning, adapter lifecycle, focus, checkpoint persistence and host recovery from [SUBGAME.md](contracts/SUBGAME.md).
- Deliver two small playable fixture games with independent progress to prove that another game can be installed without changing host logic. Declare their loops; do not present them as FireRed or generated content.
- Keep the shared feedback action and captured target context available. When improvement is absent, show an honest capability state; do not build transcription, queues or coding workers in this task.
- Implement version-associated storage and a coordinator that can load/recover a compatible artifact/checkpoint pair. Candidate production and autonomous migration work belong to T3.

Before substantial scene/UI investment, select/build/run the reused world and choose the smallest discovery interaction it supports. City scale, renderer, narrative and cross-runtime avatar appearance are not implied. Record browser/OS, storage and measured build/runtime assumptions.

**Acceptance:** B01–B13, applicable S01–S08 and X01–X10. Record controller/keyboard journeys, isolated simulations, config/version provenance, candidate receipts, reconnect/focus, failed loads, stalled runtime, duplicate/stale submissions and compatible recovery. Automatic updates require actual S06 qualification. Add real run/test instructions and timing baselines with the implementation.

**Handoff to T2/T3:** pinned host-interface version, manifest examples for both fixtures, run instructions, automated interface checks where useful, session/progress semantics and continuous visible journey evidence. Pause at this user-tryable gate before expanding scope.

## T2 — Integrate complete FireRed as a subgame

**Outcome:** complete FireRed can be installed, entered, played, saved, exited and resumed through the same host used by fixture games.

Start with the pinned source/toolchain and adapter spike in HANDOFF M0. Build the unmodified baseline and verify its reference checksum before applying any research patch. Pin emulator/core/build dependencies. Document source and packaging prerequisites separately from the planning repository.

Implement the subgame interface and map actual FireRed progress and runtime states. Distinguish battery saves from execution snapshots. Prove pause/dispose, controller focus, save export/import and failed-load recovery. Observe actual safe states for future updates or report the capability unavailable until verified.

**Acceptance:** S01–S07 as applicable and PRD R02: reproducible baseline/build logs; complete campaign coverage plan with representative early/mid/late fixtures and observed results; real browser play; both controller families; return/restart/resume with recognized progress. A town slice or Red recreation does not pass. Report remaining campaign coverage honestly rather than treating a checksum as gameplay proof.

**Handoff to T3:** actual accepted game/version/artifact, adapter, save schema/ranges, checkpoint fixtures, safe-state observations, core-loop checks and source edit/build instructions. The forest patch can then be exercised as an integration probe; generated quests/build automation are T3 work.

## T3 — Create and improve games through conversation

Tracking issue: [#2 — Shishir's versioned build/improvement harness requirements](https://github.com/vishaltandale00/gameverse.ai/issues/2). Owner: Shishir ([tandalesc](https://github.com/tandalesc)); GitHub currently rejected assignment to that account, so ownership is recorded in the issue text.

The loop is a config-defined, independently versioned harness. It operates during initial construction and later improvement of either game role, may simulate multiple isolated versions, and owns its internal algorithms/iteration representations. The environment consumes stable submissions and timing reports under the parallel contract.

**Outcome:** play → speak/correct request → durable receipt → keep playing during build → inspect/reply in builder → verified safe update → play result → request another change. Separately, create/enter a new game with independent progress and lineage.

Implement [IMPROVEMENT_LOOP.md](contracts/IMPROVEMENT_LOOP.md): voice/correction, persistent builder conversation, configurable worker, proposals, isolated source builds, executable verification, evidence, classification and host-mediated activation. The same targeting model supports base-game changes. Use T1's host and T2's game adapter rather than rebuilding either inside the worker.

First parallel gate: agree/example the v0 interface, then demonstrate pinned initial build, isolated simulations, versioned update/fork submissions and timing reports (I08–I11/X01–X10) against a compatible reference/environment. The player-feedback gate then covers I01–I04, two durable cycles including a mechanic/quest, stale/cancelled failure, safe switching and recovery. A fixture gate does not claim FireRed completion.

Second gate: I05–I07 and PRD E01–E05. Demonstrate forest behavior, the pre-Misty quest and infiltration in FireRed; blank basketball creation; an actual composed mashup with lineage; verified optional progress import; base-game targeting and recovery. Preserve parent games and their saves. Meet controller-first routine operation and configured cost/repair limits.

**Completion:** retain continuous visible journeys plus version/proposal-bound verification and recovery evidence. Then perform overall PRD qualification across T1–T3. Neither successful builds nor task specifications establish completion.
