# Subgame contract

> 2026-10-16 scope update: Pokémon FireRed is the sole initial game, compiled from editable source. Mario is deferred and does not block slice 1. Finish FireRed play, controls, save/return/resume and recovery before expanding. [Current setup, evidence and remaining gates](../DEVELOPMENT.md).
Version: 0.3 · Date: 2026-10-15 · Status: updated requirements; exact interfaces remain proposed

Defines the seam between the [base game](BASE_GAME.md) and independently delivered games. [Slice 1](../plans/ENVIRONMENT_SLICES.md) includes complete FireRed (PRD R02) as the sole initial game, exact-session resume (R17) and normal-save fallback. Slice 2 adds world navigation; slice 3 adds loop integration. FireRed requires qualification; no additional game or fixture is required.

Game configs are versioned manifests that may reference larger objects, source trees and artifacts. The same environment/adapter concepts support replaceable base games and growing subgame sets. Base-owned discovery and the independently versioned loop use [PARALLEL_DEVELOPMENT.md](PARALLEL_DEVELOPMENT.md); internal loop candidate/search representations are Shishir's responsibility.

## Registration record

Every installable version supplies the following information. Serialization and runtime technology remain open; these are required meanings, not a claim that a validator exists.

| Field | Meaning |
| --- | --- |
| Contract version | Host-interface version; unsupported versions fail before execution |
| Game ID and version ID | Stable game identity plus immutable playable revision |
| Config/source/settings references | Exact resolved config revision, game role, settings and source/build definition; configuration can refer to larger objects |
| Artifact reference and digest | Exact entrypoint, assets and runtime/core dependencies; no floating latest references |
| Adapter kind/version | How the host loads and controls this artifact; compatible host versions |
| Display metadata | Name, controls and entry/resume information |
| Save policy | Schema, supported source versions, durable checkpoint behavior and required migrations |
| Runtime capabilities | Pause, checkpoint, safe-state observation, context and supported input; unsupported capabilities are explicit |
| Proposal and evidence | Declared core loop, boot/input/play/save checks and observed results tied to this artifact |
| Lineage | Pinned parent games/versions for forks/mashups; engine dependencies recorded separately |

Unverified artifacts remain candidates and cannot be registered as accepted playable versions. Manual installation uses the same evidence requirements as generated games; it can happen without an improvement worker.

## Host interface

The implementation should provide the following behavior through a small adapter interface. Operations return explicit success/failure and session/version identity. The host must be able to abandon an unresponsive session and recover without the adapter's cooperation.

| Operation | Obligation |
| --- | --- |
| Load | Start the pinned artifact with profile reference and a compatible copied save; signal ready or a useful failure |
| Deliver input | Consume semantic gameplay actions only while the session owns focus |
| Pause/resume | Stop/resume simulation and audio, or explicitly report unsupported behavior |
| Capture checkpoint | Return progress plus schema/version/revision information, or explain why no durable checkpoint is currently possible |
| Observe state | Report session health, target context and whether a verified safe boundary exists; unknown means unsafe |
| Validate/migrate progress | Validate a copy against the target version; declare changes and preserve recognized progress for an update |
| Health check | Prove the loaded version resumed into an operable state with shared exit/feedback still reachable |
| Dispose | Release simulation, audio, input subscriptions and resources; repeated disposal is harmless |

Use adapter/session identifiers to reject late callbacks from a disposed game. Set and measure load/save/recovery deadlines during the runtime spike; do not let an unanswered operation trap the shell. Keep runtime isolation sufficient for B05: for a browser-native game, a synchronous infinite loop must not share the only execution context that can render shell recovery. Choose and prove the concrete mechanism during implementation.

Capabilities govern eligibility. A manually played game can report unsupported safe-update behavior and visibly disable automatic updates. PRD improvement acceptance requires the actual target adapter to implement and verify that behavior; a capability flag alone is insufficient.

## Progress and identity

Progress is scoped to profile, game ID, version/schema and progress revision. Passing a profile reference into a game does not grant access to other games' saves or promise the same visual avatar in every runtime.

Entering a subgame never imports another game's progress implicitly. Forks have independent saves; offered transfers use explicit adapters and copied data. Save import failures preserve the original and provide retry/return recovery. A routine return must not silently start a new game when a save cannot load.

For slice 1 FireRed, explicit return pauses/captures/durably confirms an execution snapshot before runtime disposal. Bind it to profile, cartridge/game version, emulator/core, available snapshot-format version and checkpoint revision; restart must restore the captured moment, including mid-battle. Retain ordinary in-game saves separately, protect newer confirmed records and offer explicit retry/fallback on failure. Abrupt shutdown recovers only the last confirmed checkpoint.

In-game battery saves and emulator execution snapshots are different formats. Cross-version continuation requires tested in-game save compatibility or migration. An emulator snapshot tied to old cartridge code cannot stand in for a portable checkpoint. Safe-state detection must observe actual game state rather than elapsed time.

## Qualification cases

| ID | Required result |
| --- | --- |
| S01 | Host loads the exact declared version; missing/tampered assets or unsupported contracts are rejected. |
| S02 | The declared core loop is playable repeatedly with controller and keyboard, including success/failure and return. |
| S03 | Slice 1 confirmed snapshot → return → browser restart → matching game/core → exact mid-battle resume; normal-save fallback and failed import/write preserve confirmed records without silent reset. |
| S04 | Entry/exit, overlays, disconnect/reconnect and repeated navigation do not leak input, audio or sessions. |
| S05 | Boot failure, runtime crash and unresponsive operations leave a usable host recovery path. |
| S06 | Game-specific safe states and compatible copied-save continuation are verified before automatic update eligibility. |
| S07 | One game's failure/update/rollback does not change another game's accepted artifact or progress. |
| S08 | Isolated background sessions pin versions, report outcomes/timings and leave accepted player progress unchanged; unsupported simulation capabilities are explicit. |

Complete FireRed additionally requires reproducible pinned baseline/build evidence, representative early/mid/late saves, campaign/progression QA, real browser play and both-controller evidence. The current research patch and headless alternative-game observations do not pass this gate. Source selection, packaging rights and runtime dependencies must be recorded before bundling a distributable artifact.
