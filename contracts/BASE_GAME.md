# Base game contract

Version: 0.2 · Date: 2026-10-15 · Status: updated requirements; exact interfaces remain proposed

Owner: Vishal, including subgame navigation, play, progress and host-controlled activation. Shishir owns the separate creation/improvement loop. The base must be independently usable while that integration is unavailable.

Implements PRD R01, R03, R15 and R16, and the hosting portion of R05/R10. Read alongside [the subgame contract](SUBGAME.md), [the improvement contract](IMPROVEMENT_LOOP.md) and [the task split](../TASKS.md).

The base game must support a complete play journey without the improvement worker. Start with one simple existing/reused game world, with source/runtime selection still open. The base remains replaceable through adapters. It owns subgame discovery and game-specific session policy; neither a custom-built hub nor a universal library UI is required. [PARALLEL_DEVELOPMENT.md](PARALLEL_DEVELOPMENT.md) records the config/version/simulation handoff to Shishir.

## Ownership

| Module | Owns |
| --- | --- |
| Base game | Playable world, character/profile entry, subgame discovery/presentation, configured session policy and return location |
| Shell | Profile/library records, semantic controls, active session, overlays, history and recoverable navigation |
| Subgame adapter | The loaded game's simulation, controls, progress format and truthful runtime state |
| Version coordinator | Accepted versions, compatible checkpoints and transactional switching/recovery |
| Improvement worker | Requests, proposals, builds and candidate verification; specified separately |

These are logical responsibilities, not prescribed processes or packages. The base game itself has a stable game identity and immutable versions. Future requests may target it using the same improvement contract, but a subgame update must not require rebuilding the base game.

## Required behavior

| ID | Obligation | Acceptance evidence |
| --- | --- | --- |
| B01 | Launch locally in a supported browser; create/select a profile and character; enter a playable home. | Move and interact with a subgame entrance using controller or keyboard; profile survives refresh. Appearance depth remains O02. |
| B02 | Let the base game's config/implementation discover and present available subgames, including accepted version, progress/resume state and readiness. | Demonstrate discovery through the chosen base world; distinguish ready/unavailable/failed entries without prescribing doors, NPCs or menus in the shared interface. |
| B03 | Enter a pinned subgame version and return to the home through a shell-owned action. | Home → game → home → resume game; preserve profile, return location and independent progress. |
| B04 | Own one shared semantic control mapping and input focus. | Both controller families and keyboard complete entry/return; overlays receive each action once; no stuck movement or leaked confirmation presses. |
| B05 | Preserve a shell recovery path when a game fails, hangs or refuses an operation. | Deliberately crash/stall an adapter; bounded recovery returns to a usable home and last confirmed checkpoint without claiming unsaved progress was saved. |
| B06 | Persist library/profile and version-associated checkpoints outside disposable game runtimes. | Reload/browser restart restores accepted references and compatible progress; failed writes leave the last confirmed record usable. |
| B07 | Accept an explicit, validated subgame registration without an AI worker. | Register two independently versioned fixture games; enter each and preserve separate progress without editing base-game logic per game. |
| B08 | Remain playable when improvement capability is absent, offline or failed. | Disable the worker: play, save, return and resume still work; feedback opens an honest unavailable state and does not pretend a request was durably queued. |
| B09 | Load each version from an immutable manifest/artifact reference. | Refresh and failed base updates cannot combine code/assets from different versions or lose existing library/profile references. |
| B10 | Expose target context for a later improvement integration. | Captured context identifies base game or subgame, exact version, session/profile and available checkpoint; opening an overlay does not change the target. |
| B11 | Resolve versioned base/subgame config manifests and adapter references under a separately versioned environment harness. | Record exact config/source/artifact/adapter versions; load a compatible new base revision without rewriting the loop or silently resetting player/library state. |
| B12 | Support declared background simulation/session capabilities independently of player progress. | Two pinned simulation sessions can operate on copied/fresh state and fail/clean up without modifying the player's accepted state. |
| B13 | Measure host/game build and runtime-operation timings using the shared run context. | Establish observed baselines and report failure/cancellation, cache/build mode and unavailable measurements; follow AGENTS.md for CI overhead. |

For B07, fixtures are small playable games with actions, an outcome and saved progress. They prove hosting behavior; they do not satisfy the complete FireRed requirement. Fixture choices and the home renderer are implementation decisions to demonstrate and review.

## Entry, exit and recovery

Entry order: select accepted game/version → check adapter/manifest compatibility → preserve home return context → prepare a session → load → verify readiness → transfer gameplay focus. A failed load leaves the home usable. Never start a second gameplay session or duplicate input subscriptions because a button was pressed twice.

Exit order: request pause → capture and durably store a checkpoint when supported → dispose runtime → restore home and focus. The adapter reports whether saving is safe. If it cannot checkpoint now, show waiting/cancel options; do not report a successful save. The shell can still offer a forced return that preserves the last confirmed checkpoint and explicitly discloses possible loss of subsequent progress. It must not wait forever on an unresponsive game.

Only the active game or overlay receives gameplay actions. Clear held inputs on focus changes/disconnects, require release before forwarding a held button into another screen, and restore audio/focus on return. The shell retains exit/recovery and feedback actions independently of the game.

Whether the player's base world pauses or continues when entering a subgame is game-configured policy, not a fixed improvement-loop requirement. Respect declared adapter capabilities and protect player progress from concurrent writers. Background simulations have separate session identities and copied/fresh state. Exact storage and coordination mechanisms remain open.

## Interface with the other tasks

Subgame delivery supplies a manifest, adapter, artifact and evidence satisfying [SUBGAME.md](SUBGAME.md). Installation validates them before adding a library entry. Registration is local and does not imply public distribution.

Improvement delivery consumes captured context and publishes verified candidates through the version coordinator. It cannot directly replace a running artifact, edit an accepted save or take over shell controls. Until integrated, the shell needs only the shared feedback action, target-context capture and a capability/unavailable state; live transcription and builder jobs belong to the improvement task.

## Completion gate

Record one continuous journey: launch → profile/character → move in home → enter fixture A → play/save → return → enter fixture B → play/save → refresh → resume A. Also demonstrate a failed load, stalled-runtime recovery, controller reconnect, worker absence and a rejected unsupported manifest. Retain browser/OS, artifact versions and actual controller connection details with evidence.

Passing this gate completes the base/hosting task. Full FireRed and the improvement loop have their own gates; the overall PRD still requires both.
