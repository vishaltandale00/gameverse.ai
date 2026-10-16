# Base game contract

> 2026-10-16 scope update: Pokémon FireRed is the sole initial game, compiled from editable source. Mario is deferred and does not block slice 1. Finish FireRed play, controls, save/return/resume and recovery before expanding. [Current setup, evidence and remaining gates](../DEVELOPMENT.md).
Version: 0.3 · Date: 2026-10-15 · Status: updated requirements; exact interfaces remain proposed

Owner: Vishal, including subgame navigation, play, progress and host-controlled activation. Shishir owns the separate creation/improvement loop. The base must be independently usable while that integration is unavailable.

Implements PRD R01, R03, R15 and R16, and the hosting portion of R05/R10. Read alongside [the subgame contract](SUBGAME.md), [the improvement contract](IMPROVEMENT_LOOP.md) and [the task split](../TASKS.md).

Delivery follows [three slices](../plans/ENVIRONMENT_SLICES.md). Slice 1 is a name/preset-avatar character creator and FireRed selector with exact-session resume, without the improvement worker. FireRed keeps separate trainer creation. Slice 2 introduces a simple reused open world through the same environment interface. Slice 3 integrates the improvement loops and candidate activation. The base owns discovery/session policy and remains replaceable through adapters. [PARALLEL_DEVELOPMENT.md](PARALLEL_DEVELOPMENT.md) records the config/version/simulation handoff to Shishir.

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
| B01 | Launch locally in a supported browser; create/select persistent name/preset character and enter the FireRed selector in slice 1, then a playable world in slice 2. | Controller/keyboard creator → selector → FireRed works first; world movement/entrance follows in slice 2; FireRed keeps its own trainer creation. |
| B02 | Let the base config/implementation present available games and readiness. | Slice 1 has one FireRed entry with start/continue/loading/error states; slice 2 has world-owned entrances; slice 3 exposes accepted generated/fork entries. |
| B03 | Enter pinned FireRed and return through a shell-owned action. | Selector → FireRed → confirmed snapshot → selector → browser restart → exact mid-battle resume in slice 1; valid world return placement in slice 2. |
| B04 | Own one shared semantic control mapping and input focus. | Both controller families and keyboard complete entry/return; overlays receive each action once; no stuck movement or leaked confirmation presses. |
| B05 | Preserve a shell recovery path when a game fails, hangs or refuses an operation. | Deliberately crash/stall an adapter; bounded recovery returns to a usable home and last confirmed checkpoint without claiming unsaved progress was saved. |
| B06 | Persist profile, version-associated emulator snapshots and separately retained normal saves outside disposable runtimes. | Confirm explicit-return snapshot before disposal; restart restores exact session with matching cartridge/core; failures retain prior records and offer explicit fallback. Abrupt termination recovers the last confirmed checkpoint. |
| B07 | Accept a validated pinned FireRed baseline without an AI worker. | Slice 1 loads the declared complete game with runtime/play/save evidence; FireRed requires qualification; no additional game or fixture is required. General new/fork registration and isolation are qualified in slice 3. |
| B08 | Remain playable when improvement capability is absent, offline or failed. | Disable the worker: play, save, return and resume still work; feedback opens an honest unavailable state and does not pretend a request was durably queued. |
| B09 | Load each version from an immutable manifest/artifact reference. | Refresh and failed base updates cannot combine code/assets from different versions or lose existing library/profile references. |
| B10 | Expose target context for a later improvement integration. | Captured context identifies base game or subgame, exact version, session/profile and available checkpoint; opening an overlay does not change the target. |
| B11 | Resolve versioned base/subgame config manifests and adapter references under a separately versioned environment harness. | Record exact config/source/artifact/adapter versions; load a compatible new base revision without rewriting the loop or silently resetting player/library state. |
| B12 | Support declared background simulation/session capabilities independently of player progress. | Two pinned simulation sessions can operate on copied/fresh state and fail/clean up without modifying the player's accepted state. |
| B13 | Measure host/game build and runtime-operation timings using the shared run context. | Establish observed baselines and report failure/cancellation, cache/build mode and unavailable measurements; follow AGENTS.md for CI overhead. |

Deliver B01–B10 and player-facing B11/B13 behavior as used in slices 1–2. Background sessions and full candidate activation belong to slice 3; they are not separate vertical slices. FireRed baseline/campaign qualification is required inside slice 1. Test fixtures may assist checks but cannot replace it.

## Entry, exit and recovery

Entry order: select accepted game/version → check adapter/manifest compatibility → preserve home return context → prepare a session → load → verify readiness → transfer gameplay focus. A failed load leaves the home usable. Never start a second gameplay session or duplicate input subscriptions because a button was pressed twice.

Slice 1 normal exit: request pause → capture and durably confirm the matching-version emulator snapshot → dispose runtime → restore selector and focus. Slice 2 uses the same operation before world return. The adapter reports whether saving is safe. If it cannot checkpoint now, show waiting/cancel options; do not report a successful save. The shell can still offer a forced return that preserves the last confirmed checkpoint and explicitly discloses possible loss of subsequent progress. It must not wait forever on an unresponsive game.

Only the active game or overlay receives gameplay actions. Clear held inputs on focus changes/disconnects, require release before forwarding a held button into another screen, and restore audio/focus on return. The shell retains exit/recovery and feedback actions independently of the game.

Whether the player's base world pauses or continues when entering a subgame is game-configured policy, not a fixed improvement-loop requirement. Respect declared adapter capabilities and protect player progress from concurrent writers. Background simulations have separate session identities and copied/fresh state. Exact storage and coordination mechanisms remain open.

## Interface with the other tasks

Subgame delivery supplies a manifest, adapter, artifact and evidence satisfying [SUBGAME.md](SUBGAME.md). Installation validates them before adding a library entry. Registration is local and does not imply public distribution.

Improvement delivery consumes captured context and publishes verified candidates through the version coordinator. It cannot directly replace a running artifact, edit an accepted save or take over shell controls. Until integrated, the shell needs only the shared feedback action, target-context capture and a capability/unavailable state; live transcription and builder jobs belong to the improvement task.

## Completion gates

Slice 1: creator/FireRed selector → real play → confirmed snapshot → return → close/reopen → exact mid-battle resume, plus ordinary-save fallback, failure/recovery and both-controller/keyboard evidence. Pause for hands-on review. Slice 2: world movement → FireRed entrance → play → world return → restart/revisit with preserved existing progress. Slice 3: actual loop exchange, isolated sessions, candidate registration/activation and compatible recovery under the improvement contract.

Retain browser/OS, game/core/config/adapter versions, actual controller connections and observed timings. These gates replace the old two-fixture hosting gate; full FireRed is part of slice 1, not a later substitute for fixtures.
