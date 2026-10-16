# Gameverse — Engineering Handoff

Version: 0.3 · Date: 2026-10-15 · Companion: [PRD.md](PRD.md)

## 1. Start here

Build a single-player browser environment where the owner uses a controller to play and develop games through voice feedback. The first substantial game must provide the complete FireRed experience. The workshop supports blank games, forks and mashups; basketball and basketball × Pokémon are example outputs. A settings-only improvement loop does not satisfy the brief.

The agent decides update versus fork. Every build has a proposal defining a verifiable core loop. Work runs asynchronously while the current game stays playable. Verified updates apply by checkpoint/reload at a safe boundary. Forks have separate identity, lineage and optional progress adapters. Live editable transcription and a controller-accessible builder conversation are core product behavior.

**Starting state: design/research repository, not a running application.** No app package, server entrypoint or Gameverse run/test command was present in the inspected workspace. Do not report a working game based on these documents or the example JSON.

This handoff is sufficient to begin technical spikes. Do not block shell, toolchain or adapter work waiting for every design question. Resolve O01/O02 before committing to world layout and avatar mapping; preserve the complete FireRed requirement.

### Delivery split, 2026-10-15

Current requirements: [parallel development contract](contracts/PARALLEL_DEVELOPMENT.md), [Vishal's issue #1](https://github.com/vishaltandale00/gameverse.ai/issues/1) and [Shishir's issue #2](https://github.com/vishaltandale00/gameverse.ai/issues/2). Vishal supplies the independently versioned environment/adapter harness and one simple reused/swappable base world. Shishir supplies the config-defined build/improvement harness targeting both game roles, during construction and later improvement. Config manifests, isolated simulations, submissions/results and timing reports are the shared seam; base discovery/session policy and loop internals stay with their owners. Exact v0 schemas and the first executable reference remain joint work. Follow [AGENTS.md](AGENTS.md) for CI/build/loop turnaround.

Use [TASKS.md](TASKS.md) for separate implementation assignments: T1 base game plus hosting, T2 complete FireRed subgame, T3 creation/improvement loop. T1 must deliver a complete playable home/entry/save/return/resume journey while T3 is unavailable. T2's toolchain/adapter work can run independently of T1 against [the subgame contract](contracts/SUBGAME.md). Two small playable fixtures qualify host behavior without claiming FireRed completion. [The base contract](contracts/BASE_GAME.md) and [improvement contract](contracts/IMPROVEMENT_LOOP.md) assign ownership and integration gates.

The M0–M6 table below remains a technical dependency/reference checklist, not a requirement to serialize these tasks. The forest edit and autonomous builder are not prerequisites for finishing T1. No implementation milestone has been completed by this split.

## 2. Read order and authority

1. [PRD.md](PRD.md): current consolidated product scope, R01–R16, E01–E05 and O01–O06.
2. This handoff: recommended engineering approach, observed evidence and staged work.
3. [MVP_CONTRACT.md](MVP_CONTRACT.md): detailed design draft behind the PRD; proposed behaviors remain distinguishable from user decisions.
4. [POKEMON_SOURCE_RESEARCH.md](POKEMON_SOURCE_RESEARCH.md): pinned candidate audit and its limits.
5. [research/pokemon/audit-results.json](research/pokemon/audit-results.json), adjacent logs and [scenarios.json](research/pokemon/scenarios.json): machine-readable evidence and scenario designs.
6. [design/game_proposal.example.json](design/game_proposal.example.json): illustrative proposal shape. Parent versions and game IDs are placeholders, not installed games.

Later explicit user directions take precedence. Where older documents disagree, the consolidated PRD is the current implementation baseline; do not silently resolve an item marked open.

Read the current parallel/delivery contracts and TASKS.md before using the older MVP contract. The latest direction is to reuse a simple existing world as the base, with the actual source/runtime still open; a custom city/hub is not required. This does not remove the separate full-FireRed qualification item. [CONTEXT.md](CONTEXT.md) defines the shared terms.

### Historical material, not active configuration

`POC_DESIGN.md`, `BROWSER_DESIGN.md`, `BASE_GAME_CANDIDATES.md`, `ENGINE_COMPARISON.md` and `RESEARCH.md` explain earlier investigations. Preserve them for provenance.

`design/processor.example.json` is an older desktop/two-subgame example: `platform=desktop-macos-first`, `code_candidates_enabled=false`, three fixed module IDs, a five-second grace period, manual acceptance and a 600-second job limit. Those are **not current confirmed MVP rules**. `design/request_examples.json` is likewise illustrative historical content. Create a current versioned configuration when implementing; do not boot the product from these examples unchanged.

The current brief has no fixed build-latency limit, requires actual mechanic development and uses automatic safe-boundary update application. Resource limits still require configuration; absence of a latency target is not an infinite-retry policy.

## 3. Observed evidence, not assumed capability

Research was performed on 2026-10-14; these are pinned observations, not a fresh audit of current upstream branches.

| Item | Observed | Not established |
| --- | --- | --- |
| FireRed source | `pret/pokefirered` at `037335f4c725d7c9aecdac87066f2002b4bd7e14`; encounters, Misty/Rocket scripts, flags and save primitives inspected | Complete local build, matching artifact hash, browser runtime or full-campaign test |
| Forest probe | Patch raises 12 FireRed forest wild slots by three levels; 24 level fields change; other encounter data preserved; JSON/data invariants and `git apply --check` passed | Gameplay, save compatibility or deployment |
| Electric quest / Rocket infiltration | Source integration points and acceptance requirements recorded | Implemented quests or passing runtime checks |
| Claude Red alternative | Pinned Red recreation; 10-battle headless sample, 47 interactions across six maps with no reported hangs/errors; a headless forest render inspected | FireRed fidelity, authentic early-game reachability, full campaign or physical input |
| Other browser Red projects | Red-web advertised test command discovered zero tests; Kanto validator failed a stale cache-token check despite passing subchecks | Reliable complete FireRed substitutes |
| Local prerequisites | Initial clean-checkout FireRed build lacked bootstrapped host tools, `agbcc`, ARM assembler/preprocessor; browser automation endpoint unavailable | Repository defect or proof that either task is impossible |

Logs: [FireRed build tail](research/pokemon/firered-build-tail.log), [Kanto validator](research/pokemon/kanto_validator.log), [Red-web test output](research/pokemon/red_web_advertised_tests.log). Some tools exit successfully while reporting no tests or errors in their text; inspect discovered counts and reported outcomes.

Audit clones were in `/tmp/gameverse-pokemon-audit-SSOOcf`; treat that location as disposable. Recreate pinned checkouts in an explicit dependency workspace rather than relying on a temporary directory. No root LICENSE/COPYING file was found in the four audited game-source checkouts. Public availability was not established as an explicit permissive license; emulator licensing is separate. Do not relabel research candidates as redistributable product packages.

## 4. Recommended component boundaries

These are implementation recommendations, not existing modules or final stack selections.

| Component | Owns | Must not own |
| --- | --- | --- |
| Browser AppShell | Profile, library/world navigation, semantic input, transcript review, builder panel, status/history | Running arbitrary build processes or provider secrets |
| GameRuntimeAdapter | Load/pause/dispose, gameplay input, safe-state reporting, checkpoint/save import/export, resume checks | Global feedback-button logic duplicated per game |
| Voice adapter | Browser capture, interim/final text, audio playback and finalized request draft | Silent edits to submitted requests |
| Local companion | Same-origin app/API serving, durable queue, STT/processor orchestration, source workspaces, verification, artifact registry | Mutating the active game in place while building |
| Processor adapter | Rules/planner/hybrid policy, proposal generation, classification and source-edit planning | Treating an unverified candidate as active |
| Version coordinator | Immutable versions/lineage, copied saves, compatibility evidence and transactional activation | Assuming emulator snapshots are compatible across changed code |
| Verification adapters | Generic checks plus game-specific executable core-loop/change/save scenarios | Silently weakening failed assertions |

The earlier TypeScript/Node/SQLite shell and Godot-city suggestions are research inputs, not selected requirements. Start by qualifying the reused world's build/runtime and adapter under the shared contract. The separate FireRed integration can use a GBA browser adapter around its rebuilt cartridge; preserving one runtime is not a reason to rewrite the complete game.

EmulatorJS and a documented mGBA-WASM SDK were researched but not integrated. Pin the selected wrapper, core, worker toolchain and build flags. Measure memory/input/performance on the actual machine before finalizing the renderer/emulator combination. Keep only the active gameplay input owner while the shell reserves feedback/navigation actions.

## 5. Contracts to implement

### Request and context

Store `requestId`, `requestRevision`, `conversationId`, `gameId`, captured `versionId`/artifact hash, profile/checkpoint reference, finalized transcript, context references, timestamps and cancellation state. Active-game/version context is captured when the request is made; later navigation must not retarget it. Screenshot/clip retention and external processing are configurable and visible.

Before submission, text is a mutable draft. After submission, revisions are separate events. Use request/revision idempotency so reconnects or a replayed upload do not duplicate builds. Record a durable worker receipt before showing the request as safely queued. Browser-local pending uploads are not the authoritative work queue.

### Proposal and verification evidence

A proposal contains classification and rationale, baseline version, parents/reused contributions, core loop, controls, persistent state, expected change, constraints, compatibility scope and acceptance scenarios with preconditions/actions/assertions. Pin a proposal revision before each build attempt.

Evidence must identify proposal revision, source revision/diff, artifact hash, build environment, fixture versions, check IDs, discovered test counts, outcomes and diagnostics. A scenario specification in JSON is not executable evidence. A generated test that merely asserts its own output is insufficient; verify observable runtime behavior and unchanged baseline invariants.

The current [proposal example](design/game_proposal.example.json) is a design sample, not a schema validator or implementation. Replace its parent placeholders with actual accepted versions before use.

### Game, version, save and lineage

Keep separate records for:

- `Game`: stable identity, name, runtime type, active accepted version.
- `GameVersion`: immutable artifact/source/proposal references, runtime/core version, save schema and verification record.
- `LineageEdge`: child game/version, parent game/version and contribution/reuse type. Blank builds have no game parent; mashups may have several.
- `SaveCheckpoint`: game/version/schema/profile, content hash and original/copy/trial role.
- `ProgressAdapter`: supported source/target ranges, semantic mapping and loss description, tests and target-schema validation.

Keep engine/template dependencies distinct from game lineage. Detect cycles and invalid/missing parent references. A fork never silently overwrites or repoints the parent entry.

### Runtime adapter surface

Implement an equivalent of `load(version, save)`, `pause`, `resume`, `dispose`, `captureCheckpoint`, `validateOrMigrateSave`, `reportSafeBoundary` and `healthCheck`. Exact language/API is open. Safe-state reporting is a game-specific contract, not elapsed-time guessing. FireRed needs a real way to distinguish battles/dialogue/scripts/save writes from a valid checkpoint.

A cartridge's battery/in-game save and an emulator's live execution snapshot are distinct. Do not load a snapshot from arbitrary changed cartridge code as a migration strategy.

### Durable job lifecycle

Suggested states: `queued → interpreting → proposed → building → verifying → ready → waiting_for_boundary → applying → applied`, with `needs_input`, `failed`, `cancelled` and `stale` branches. Transcription/review precede a finalized queued request.

Persist transitions and attempt counts. Failed verification cannot reach ready. Cancellation and stale-base checks must be repeated before promotion. If the accepted baseline changes during a build, rebase/revalidate or mark the candidate stale; never apply the old candidate blindly. Use a per-game mutation lock and compare the expected baseline when committing activation. A progress revision created during the build also needs validation against the actual application-time checkpoint, not only a fixture from job start.

### Activation transaction

1. Confirm candidate evidence, uncancelled status, expected baseline and verified safe state.
2. Capture an original checkpoint and preserve its artifact/schema references.
3. Copy and validate/migrate the application-time save; retain the original.
4. Load the candidate and check successful resume plus shell feedback availability.
5. Commit active version only after health checks; retain a recoverable transaction record.
6. If interrupted or unsuccessful, recover to the previous compatible artifact/checkpoint pair.

Test crashes between each step and a page refresh during application. A potentially lossy manual revert requires a displayed consequence and explicit controller choice; automatic rollback after a failed activation uses the just-captured compatible checkpoint.

## 6. Controller and builder UX

Use semantic actions rather than device-specific keys throughout game code. Provisional recording binding: R3; keyboard F8. Recording stops to a finalized review card; A/Cross queues, B/Circle cancels, D-pad selects phrase/action, X/Square rerecords a phrase and Y/Triangle plays audio. Support full rerecord/append and a controller-operated keyboard fallback. This review-first default remains a proposal, not a newly imposed user requirement.

Keep provisional words visually distinct; do not move a phrase selection as interim text changes. Show game/version/location with the request. Text being final does not mean it is correct. A later correction must not silently rewrite a build's frozen request.

The builder panel is the persistent human channel: request/context, interpretation, proposal, classification reason, progress, failed checks and next action. It supports spoken replies, refining, cancellation, retries, pausing/resuming and version history. Maintain controller focus and ensure UI buttons do not also shoot, move or confirm inside the active game. Reconnect behavior and exit/pause/feedback are part of every generated game's contract.

Keep credentials and builds in the companion, not generated game code. If generated code fails, the shell's controller recovery UI must remain available. No particular AI model/provider has been selected.

## 7. Delivery sequence and acceptance gates

These are work packages to execute, not completed milestones. A small technical slice may precede the MVP, but it must not be reported as satisfying complete FireRed.

| Stage | Work package | Required exit evidence | PRD coverage |
| --- | --- | --- | --- |
| M0 | Reproducible FireRed toolchain and browser-adapter spike | Pinned baseline builds; reference checksum verified; browser boots/plays; save export/import; both controllers tested; documented performance and safe-state feasibility | R02, R03 |
| M1 | Shell/profile, world entry, workshop entry and versioned base | Reload/transition preserves profile/library; keyboard and both controller families navigate; base manifest avoids mixed cached assets | R01, R03, R16 |
| M2 | Voice review, builder channel, durable queue and configurable processor contract | Live interim/final text, voice correction and explicit request receipt; reconnect/idempotency; game scope frozen; builder controls usable | R04–R07 |
| M3 | Isolated edits, proposals and verification runner | First durable forest change built and exercised in game; new mechanic/quest candidate follows; baseline regressions checked; all checks attached to proposal/artifact | R06, R08, R14; E01–E03 |
| M4 | Compatible update, safe swap and recovery | Application-time migration; safe-boundary checkpoint/reload; stale/cancel race and crash recovery; two consecutive improvement cycles; explicit rollback consequence | R09–R11, R15 |
| M5 | Blank creation, forks/mashups and adapters | Basketball core loop playable; a separate composed game has real lineage/mechanic; parent unaffected; any offered progress transfer previewed and verified | R09, R12, R13; E04–E05 |
| M6 | MVP qualification | Complete FireRed evidence and all E01–E05 results; both-controller routine journeys; failed candidate recovery; measured playability and no recurring laptop workflow | R01–R16 |

Keep the forest patch as the cheapest first integration probe, not the finish line. The user's Misty quest and Rocket infiltration requests are explicitly meant to exercise creation of new behavior. Do not make the user pre-author those quests or hard-code a system that only handles the five qualification phrases.

Use [research/pokemon/scenarios.json](research/pokemon/scenarios.json) for the source locations and request-specific checks. Its proposed reward/story interpretations can change; preserve the actual requested outcome. In particular, a pre-Misty quest cannot require a later HM or badge, and infiltration must change gameplay rather than only dialogue.

## 8. FireRed spike work package (T2)

This sequence starts T2. T1 starts from its independent play journey in [TASKS.md](TASKS.md); it does not wait for the forest candidate or FireRed build. Step 6 below continues T2 integration with the shared host rather than assigning shell/queue ownership to the FireRed task.

1. Inspect the workspace and read PRD R01–R16/O01–O06. Confirm no later implementation already exists before scaffolding.
2. Recreate the pinned FireRed checkout in a deliberate dependency workspace. Check its pinned INSTALL.md/Makefile and bootstrap host tools plus its required compiler/toolchain. Choose an available reproducible native or container route; this handoff does not supply an already working build image.
3. Build the unmodified baseline and verify the reference hash using the repository's checksums. Preserve full logs and exact tool versions. Do this before applying the forest patch.
4. Evaluate one browser GBA adapter for load, real controller input, in-game save export/import, pause/dispose and recovery. Pin the wrapper/core and record licensing/build dependencies separately. Select the adapter on observed behavior.
5. Apply the existing scoped forest patch to an isolated candidate checkout. Build and run it against a copied baseline save; check requested forest encounters and unaffected adjacent areas. Do not mutate the player's accepted save.
6. Report these observations and the next limiting dependency. Integrate the validated adapter with T1's host interface and hand source/build/save evidence to T3; do not substitute a tiny Red recreation to avoid the complete FireRed requirement.

Example checkout commands, **instructions for the next work package, not commands executed by this handoff**:

```sh
git clone https://github.com/pret/pokefirered.git vendor/pokefirered
git -C vendor/pokefirered checkout 037335f4c725d7c9aecdac87066f2002b4bd7e14
```

After provisioning the pinned project's prerequisites, use its documented build steps and checksum file. To inspect whether the retained patch applies without changing the checkout:

```sh
git -C vendor/pokefirered apply --check ../../research/pokemon/forest-candidate.patch
```

There is no `npm run dev`/app test command to hand over yet. Add accurate run/test instructions once those commands actually exist. Do not assume the old temporary clones, browser debugging endpoint or compiler are still available.

## 9. Decisions to resolve during implementation

O01: selected reused world and base-owned discovery/session policy. O02: character appearance depth/mapping. O03: runtime/adapter and browser/OS support. O04: transcription/provider/retention and review defaults. O05: resource/repair escalation policy. O06: save/version ranges and reverse adapters. O07: v0 config/run/submission/timing schemas, transport and executable reference for the parallel handoff.

Implementation can begin on independent contracts and M0 now. Do not manufacture user answers. Escalate a decision in the builder/product channel when it materially affects the next irreversible layout or compatibility choice. The longer-term community search mechanism is deferred; preserve lineage/evidence now without building multiplayer infrastructure.

## 10. Handoff checklist and status

- [x] Consolidated product requirements and acceptance IDs.
- [x] Existing research/evidence paths and pinned FireRed source identified.
- [x] Proposed contracts, milestones and first work package documented.
- [x] Old-config conflicts and open decisions explicitly recorded.
- [ ] Reproducible FireRed build and browser runtime.
- [ ] Physical controller/microphone verification.
- [ ] App shell, builder channel, queue and actual coding worker.
- [ ] Executable core-loop verification, generated quests and progress adapters.
- [ ] Verified safe-boundary activation, migration and rollback.
- [ ] Complete MVP acceptance evidence.

This delivery produces the PRD and handoff. It does not complete any unchecked implementation milestone.
