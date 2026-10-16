# Parallel development contract

Version: 0.1 · Date: 2026-10-15 · Status: requirements confirmed by Vishal; exact wire formats and joint implementation remain to be agreed with Shishir.

Vishal builds the game environment harness: the base-game integration, adapters, subgame navigation/play, progress and activation/recovery. Shishir builds the LLM build/improvement harness, targeting both base games and subgames. Shishir is delivering the loop; a runnable candidate game version is an output of that loop, not his only deliverable.

Read the [base](BASE_GAME.md), [subgame](SUBGAME.md) and [improvement](IMPROVEMENT_LOOP.md) contracts for detailed behavior; [AGENTS.md](../AGENTS.md) governs development turnaround and CI overhead.

## Confirmed split

| ID | Requirement | Owner / evidence |
| --- | --- | --- |
| X01 | Start with one simple base world, preferably reused from an existing game; keep the base replaceable through defined adapters. | Vishal: demonstrate the same environment contract can load different base revisions/adapters without rewriting the improvement loop. Exact source/runtime selection remains open. |
| X02 | Base-game and subgame configs are manifests that can reference larger source trees, code, assets, artifacts, adapters and settings. | Vishal defines the supported environment side; Shishir consumes it and can submit changed configs with their referenced objects. A universal config-only game language is not required. |
| X03 | Independently version the environment harness and the LLM build/improvement harness. Version each base game, subgame and relevant configuration as well. | Each run pins exact input versions/config references; each resulting artifact has immutable identity. A moving file path or latest branch alone is insufficient. |
| X04 | The base game owns subgame discovery and presentation. | Vishal: base config/implementation decides doors, NPCs, menus or other discovery. Shared infrastructure exposes available accepted game/version descriptors and entry/return operations without mandating a library UI. |
| X05 | Game-specific play-session policy belongs to game config/implementation. | Adapters report lifecycle capabilities truthfully. This contract does not choose whether the player's base world pauses or continues during subgame play. Unsupported policy/capability combinations fail visibly. |
| X06 | The loop operates during initial game building and later improvement, for either base games or subgames. | Shishir: same external target/submission contract covers both modes; the internal algorithms and candidate/search representation are his responsibility. |
| X07 | Background simulations may exercise multiple pinned game versions using isolated state. | Vishal supplies executable adapter/session hooks; Shishir orchestrates experiments. Simulations cannot mutate accepted player progress or silently take over the player's session. |
| X08 | The loop submits runnable new games, compatible updates or separate forks through a stable submission envelope. | Shishir supplies immutable artifact/config references, parents, compatibility and evidence. Vishal validates/registers submissions and applies updates through the host coordinator. |
| X09 | Failed, stale, cancelled or incompatible candidates cannot replace the current accepted game or silently reset progress. | Joint integration evidence: candidate rejection, independent fork progress, safe application and recovery. |
| X10 | Measure CI, build and improvement-loop turnaround with comparable run context; avoid adding unnecessary work. | Both: stage timing/outcomes and explicit unavailable measurements; CI owner reports queue/job/critical-path time. Establish baselines before numeric budgets. |

## Required meanings at the interface

These are contract requirements, not an implemented schema, final field spelling or transport choice.

| Record | Required meanings |
| --- | --- |
| Game config | Schema/contract version, game identity/version and base/subgame role; immutable references to settings, source/build definition, playable artifact and adapter; save schema/capabilities and supported compatibility ranges. Game-specific settings remain extensible. |
| Environment reference | Exact environment-harness version/config and adapter contract/implementation version; declared capabilities and supported game-config versions. |
| Loop config | Exact harness/algorithm version, configuration revision, model/tool/dependency references, evaluation policies and configured resource/repair limits. Provider secrets remain external credential references. |
| Run | Run/request/attempt identity; operation and target game role; input game/config versions, environment/adapter versions and loop config; isolated state/checkpoint reference; status, output/evidence references and timing report. A direct initial build may have no player request ID. |
| Candidate submission | Stable submission ID; new/update/fork classification; target game/version and expected accepted baseline for updates; pinned parent lineage; immutable config/source/build/artifact references; adapter requirements; proposal and verification evidence; save compatibility or explicit fresh progress; tested migration/transfer references when offered; originating run/timing reference. |
| Submission result | Durable receipt, submission identity and accepted/rejected/stale state with a reason. Registration/availability and activation are distinct outcomes; duplicate submissions cannot create duplicate playable versions. |
| Timing report | Correlation ID, source/config/environment context, outcome and total/queue time; available build/simulation/evaluation/repair timings and attempt counts. CI also reports per-job wall time; builds identify cache/clean/incremental mode. Distinguish nested/overlapping work and unavailable metrics. |

Changing a config or one of its resolved source/artifact dependencies produces a new recorded revision. Running against an old pinned environment/loop configuration must remain distinguishable from a new run; reproducibility here means retained inputs and provenance, not guaranteed identical LLM output.

## Adapter and simulation capabilities

The environment side must expose supported load/run, actions/input, observation/context, checkpoint/restore, lifecycle state, health and disposal operations. A background experiment gets a separately identified session with copied or fresh state and pinned versions. Failure and cleanup remain observable to the loop without taking down host recovery.

The exact observation/action vocabulary, step/reset semantics and rendered versus headless simulation strategy remain joint interface work. Neither a complete structured world model nor a particular simulation engine was selected in the discussion. A game must implement the capabilities its declared improvement/verification scenarios require; unsupported capabilities cannot be hidden by a successful process exit.

The host enforces accepted-version and player-save integrity. The loop can choose its internal search, code editing, simulation scheduling and repair process within configured resources; those choices do not require changes to the base-game discovery implementation.

## Independent starting points and joint gate

Vishal can build and play the environment with manually supplied compatible games and an absent-loop state. Shishir can build against a small reference adapter/session implementation satisfying the agreed interface without waiting for the final base world. Which implementation supplies the first executable reference is a joint task; this repository has not supplied one yet.

Before parallel implementations lock in incompatible assumptions, agree on a v0 schema/transport and exchange example game/loop configs, a candidate submission/result and timing report. Then demonstrate:

1. Build from a pinned game config, recording both harness versions and build/loop timings.
2. Run two isolated simulations of pinned versions; preserve the player's accepted artifact/progress.
3. Submit a verified update and a fork; register them once and return inspectable receipt/status.
4. Apply an eligible update through the environment, using actual checkpoint/compatibility checks and recovery; preserve independent fork/parent progress.
5. Show newly available subgames through base-owned discovery, without making Shishir implement the world's navigation UI.
6. Reject/recover from unsupported adapters, failed checks, stale baselines and duplicate/cancelled submissions.

This is a requirements and integration gate. The algorithms, runtime/source choice, exact schemas, adapters and timing instrumentation remain implementation work. Full FireRed qualification and other PRD scenarios are separate from agreeing this parallel-development seam.
