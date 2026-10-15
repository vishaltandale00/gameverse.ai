# Controller-first build-and-play MVP contract

Draft date: 2026-10-14. This document incorporates the design interview answers. It defines proposed implementation behavior; no game runtime, voice service or verification worker has been implemented by writing it.

Supersession note, 2026-10-15: [PRD.md](PRD.md), [TASKS.md](TASKS.md) and the [base](contracts/BASE_GAME.md), [subgame](contracts/SUBGAME.md) and [improvement](contracts/IMPROVEMENT_LOOP.md) contracts now define the delivery split. Base-game play/hosting is independent of FireRed integration and the improvement worker. Earlier alternatives below are retained as design history; they do not reopen that logical separation. Visual home layout and avatar mapping remain open.

## Confirmed direction

- Single-player MVP, played in a browser. Create a character, play the complete FireRed experience, improve it, and access a place/channel for building games with a controller.
- Build from a blank project, fork an existing game, or mash up existing games. Basketball and basketball × Pokémon are example workshop outputs.
- The agent decides whether a requested change is an update or a fork.
- An update retains original/new versions and applies by checkpoint and reload at a safe boundary.
- A fork is a separate game with parent lineage and optional game-progress adapters.
- Define the game's core loop in its proposal before building. Verification must exercise that loop.
- Show live transcription with easy controller corrections.
- Provide a builder conversation/status sidebar or overworld setting to inspect work and participate when needed.

Full FireRed remains a requirement. The answer “no full fire red,” submitted to a question about overworld size, does not settle whether FireRed itself becomes the MVP overworld or remains a separate subgame. That placement and the extent of character customization remain open. The shell, builder, version model and contracts below work with either placement.

## The persistent shell

The outer browser shell owns profile identity, semantic controller actions, recording/transcript review, the game library, builder conversations, job status and version selection. A game adapter owns gameplay and its save/checkpoint behavior. The feedback action remains available across games and builder screens; it is not reimplemented by every generated game.

The complete FireRed candidate remains the audited `pret/pokefirered` source plus a browser GBA adapter. The earlier source research is a source-selection result, not a running integration. The city can be another browser runtime if FireRed remains a subgame. The shell can host the builder UI over the currently loaded game if FireRed itself supplies the first world.

## Live transcription and correction

We cannot reliably know that a transcript is wrong. A recognizer's confidence is not evidence that it captured the intended meaning, and an accurate transcript can still target the wrong object or game. Let the player compare the displayed words with what they said, and show the captured game/context beside them.

Proposed initial controller flow:

1. Tap the reserved feedback button, provisionally R3, to record. Show the live text and an unmistakable recording indicator. Visually distinguish provisional words from finalized words; avoid moving the selection as provisional text changes.
2. Tap again to stop. Wait for final transcription, then show a stable review card with game, version and request context. A “final” transcript is still editable and is not presented as verified intent.
3. Confirm queues the reviewed request. Cancel discards it. Editing and recording do not launch a build.
4. Corrections use voice: select a phrase and rerecord it, append detail, or rerecord the whole request. Provide controller-operated phrase selection and an on-screen keyboard as a fallback. Audio playback lets the player compare the recording and transcript.
5. After queuing, freeze the submitted transcript/context under a request ID. A later correction is a new revision/cancel-and-replace event; never silently rewrite a job already building.

Example review bindings, remappable and shown in the UI: A/Cross = queue; B/Circle = cancel/back; X/Square = replace selected phrase; Y/Triangle = play recording; D-pad = select phrase/action; R3 = append/rerecord according to the current labeled action. The recording overlay takes input ownership; its buttons do not also trigger gameplay.

This adds a short review step as the proposed default to support reliable corrections. Automatic submission can be a later configurable mode. Initial browser permissions, pairing and installation may still require operating-system/browser interaction; controller-only routine use should not be confused with bypassing those dialogs.

## Builder channel

The player can open a persistent sidebar/panel from the controller or enter the workshop. Each game/request has a conversation, preventing a correction for FireRed from being interpreted as feedback on a basketball game.

The panel shows:

- Request and captured context; the agent's current interpretation.
- Proposed game/change and whether it is a blank build, update, fork or mashup; reasons for that classification.
- Defined core loop, controls, intended result and compatibility expectations.
- Queued/building/checking/ready/waiting-for-boundary/applied/failed/needs-input status.
- Verification evidence, failed checks and what the next attempt is doing.
- Controller actions to speak a reply, refine/cancel a request, retry, pause/resume work, inspect versions, enter a new fork and revert.

The agent can act on a reasonable interpretation and refine through feedback. The panel is available for inspection throughout; it need not force a planning interview for every small request. Material unresolved intent, persistent failure or a requested exception is surfaced here. Repair/cost limits remain configurable; no unlimited spending or infinite retry policy is inferred from the absence of a latency limit.

## Proposal before build

Every candidate has a versioned proposal. Agent-authored proposals are editable through the builder channel. A proposal is not necessarily a required manual approval screen; the user has delegated update/fork classification to the agent.

The proposal defines:

- Inputs and player actions; the recurring action/challenge/reward/reset loop.
- What constitutes success, failure or return to play.
- State and progress that persist between cycles.
- The change's intended behavior and constraints.
- Executable acceptance scenarios with preconditions, actions and assertions.
- Technical invariants: shell feedback input, pause/exit behavior, save/checkpoint behavior and candidate identity.
- Compatibility policy and required fixtures/adapters.

The verification contract must be frozen before its build attempt. A repair may change implementation without weakening assertions just to make them pass. If the intended game changes, create a proposal revision and keep the earlier evidence. Automated checks judge whether the defined loop works; player feedback judges whether it is enjoyable and faithful to intent.

A basketball proposal might define repeated possessions: gain possession → move/pass/shoot → defend or regain possession → score and resolve the match → persist the result and start another match. Its checks exercise shooting/scoring, possession transfer, match completion and return to play. A basketball × Pokémon proposal must define what creatures actually change in that loop—such as roster attributes or on-court abilities—and verify that mechanic. A label alone does not establish a mashup.

Example proposal fields and acceptance scenarios are in `design/game_proposal.example.json`. They are illustrative contract data, not test results or a fixed cap on the agent's ideas.

## Agent classification and lineage

**Update:** same game identity; preserve the baseline core loop unless the proposal explicitly evolves it, and satisfy the backward-compatibility rule. The agent creates a new candidate version and retains the original artifact and checkpoint.

**Fork:** new game identity, pinned parent game/version lineage, its own proposal, independent saves and independent future updates. A major redesign that intentionally breaks the parent's play/progress contract can be routed here. A defect in an intended update is still a failed update; relabeling it as a fork does not make failed verification pass.

**Mashup:** new game identity with multiple pinned parent/reference entries, recording what is reused from each. Specify interfaces between mechanics, controls, data and assets. Different game runtimes are not automatically compatible because they share lineage. An adapter or new implementation has to realize the combined core loop.

**Blank project:** new game identity with no parent. Engine/template dependencies are recorded separately from game lineage.

## Proposed backward-compatibility rule

An update is eligible for automatic promotion only if supported saves from the previous accepted version can load or migrate on a copy without losing the player's recognized progress or stranding them in the world.

Recognized progress includes character/profile references, party/roster, inventory, currency, badges/unlocks, quest completion and relevant world flags. Preserve semantic meaning, not merely the ability to parse bytes. Relocating a player out of invalid geometry may be acceptable when explicitly defined in the migration; it must not silently reset accomplishments.

Required checks:

1. Preserve original artifacts and unmodified checkpoint saves.
2. Load/migrate copied fixtures from fresh, mid-game, late-game and affected-quest states, where relevant.
3. Validate progress equivalence plus world reachability after migration.
4. Save and reload the candidate; run the defined core loop and change scenario.
5. Revert using the previous version's own compatible checkpoint and verify it remains playable.

If compatibility cannot be established, keep the current version active and show the failed requirement in the builder channel. An intentionally incompatible redesign may become a separate fork with a declared progress adapter; it must not be pushed as a compatible update or silently start the user over.

Rollback has a separate limitation: loading an older checkpoint may lose progress earned after that checkpoint. Do not imply that old code automatically understands a newer save. Preserve the newer save with its own version, show the checkpoint consequence, and require an explicit controller choice for that potentially lossy revert. Carrying later progress backward requires a verified reverse adapter. This does not add approval to ordinary verified updates at safe boundaries.

## Fork progress adapters

A progress adapter maps source semantic progress into the target game's schema. It records source/target game and version ranges, copied/mapped/dropped fields, balance rules and validation checks. It runs on a copy; the parent and its save remain independently available.

For basketball × Pokémon, one possible adapter could turn a source party into a basketball roster. That needs declared species-to-roster mappings and attribute/ability balance rules; it is not a raw FireRed save import. Provide a preview of the transfer, including any loss. If no verified adapter exists, the fork has its own fresh state and the original progress remains in the parent; the channel must state that clearly.

Lineage is mandatory for forks. Transfer of progress is optional and must be explicit, verified and non-destructive to the parent. No adapter is implemented by this document.

## Safe-boundary application

A ready, verified update can apply automatically at a safe boundary, as requested. Proposed boundaries: a module entrance/exit, a match end, or an idle overworld checkpoint. Do not switch during a battle, cutscene, active dialogue, recording/correction, save write or progress-adapter transaction.

Each runtime adapter must report and verify a safe point. For FireRed, detection of actual game state must be implemented and tested; a host page guessing from elapsed time is insufficient. At the boundary: checkpoint → copy/validate save → load the candidate artifact → resume → health check. Commit the active-version manifest only after successful resume; failure restores the compatible original checkpoint. Display the update and retain a controller path to history/revert.

A fork becomes a new library/overworld entry. Its creation does not silently overwrite or repoint the parent. The workshop can offer “play the new game” when ready.

## Verification pipeline

Freeze proposal and baseline → isolated build → boot/input checks → core-loop acceptance → requested-change scenario → save compatibility/adapter checks → package immutable artifact and evidence → wait for safe boundary or new-game entry → apply/resume checks → collect controller feedback.

For FireRed, the source audit supplies integration points and the three sample scenarios. It does not establish a passing full-game or browser verification suite. The compiler toolchain, emulator adapter, controller/microphone tests and automated progression fixtures remain implementation work. Budget/repair policy and the extent of the overworld are still configurable/open.

The contract is ready for review and implementation planning. The requested behaviors are specified; they have not been implemented or runtime-verified.
