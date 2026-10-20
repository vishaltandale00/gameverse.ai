# Whole-source target and integration contract

Current implementation target: **Pokémon Emerald × Pokémon FireRed**, a single trainer's connected Hoenn and Kanto journey. Selection follows inspection of the existing 33-game source inventory, actual local source trees, source build scripts, native session API, previous composition failures and complete-system gaps. This is not a claim of a delivered or qualified whole-game mashup.

The user cited Metroid and Pokémon as an example, not a prescribed pair. Earlier Relay Runner and Echo Tactics prototypes do not satisfy this task; their function-level regressions remain useful, but they are not whole-game inputs or acceptance evidence. Current work tests the build/composition/native playtester pipeline, with no browser testing.

## Selection

| Pair | Evidence and gameplay fit | Integration cost / decision |
| --- | --- | --- |
| Emerald × FireRed | Both actual matching complete source trees; distinct regions, maps, scripts, gym/league arcs and encounters; shared Gen III creature concepts and controls | Selected. Whole-source regional integration can make captures, training, move choices and party composition consequential in both campaigns without replacing either battle engine. Species, move, item and serialized creature compatibility must still be checked, not inferred from franchise. |
| Emerald × Red Rescue Team | Both local source projects report matching complete games; complementary trainer journey and tactical rescue dungeons | Strong next design candidate. Different creature records, ally AI, move semantics, hunger, dungeon scheduler, missions and save ownership require substantially more new conversion before a faithful transition. |
| Zero Mission × Emerald | Existing matched MZM build and native encounter experiment | The existing implementation preserves MZM but replaces most Emerald behavior with a small authored battle bridge. Full Emerald world, party/capture/evolution/AI/menu/save closure is a new integration, not a small extension. |
| Zero Mission × Aria of Sorrow | Side-view exploration and ability progression fit | Aria source is WIP; complete executable subsystem and source-build evidence is weaker. Existing soul/impact leaves do not close its source scheduler/world/save. |
| Minish Cap × Emerald | Top-down exploration and item/creature progression fit | Minish source WIP and unresolved source service boundaries. Broad map, item, puzzle and party integrations need independent full-runtime proof. |
| Zero Mission × Fusion | Related controls, world structure and equipment | Fusion source explicitly warns it is not shiftable. Region/event/save differences and two competing progression programs remain; less gameplay differentiation. |
| Sonic Advance × Zero Mission | Speed and gated exploration complement | Sonic source region mismatch and conflicting terrain/momentum policies. Existing native operator bridge preserved one host and had route failures; it is not a second whole campaign. |

Evidence: `local/decomps/survey.json`, each selected checkout's README/Makefile and source; `tools/gba_mashup/{README.md,BUILD_MZM.md,BUILD_COMPONENTS.md}`; `research/ir-workshop/reconstruction-interoperability-20261016/pairing-review/README.md`; `research/ir-workshop/pipeline-efficiency-20261016/REPORT.md`. The survey's completeness labels are discovery evidence; actual source build receipts are required. `vendor/` is absent here despite old FireRed setup documentation, so this task uses actual `local/decomps/` trees.

Selected source pins:

- Emerald `731ad5bfd6e6f265508d0efcca0ba42f9dcf5881`; expected baseline SHA-1 `f3ae088181bf583e55daf962a92bb46f4f1d07b7`.
- FireRed `037335f4c725d7c9aecdac87066f2002b4bd7e14`; expected baseline SHA-1 `41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc`.

## Execution choice

Build both full original source engines into version-pinned native scene modules. The source engines retain their entire game execution and presentation. One composition session owns the active scene, both region snapshots, shared trainer/traveling party and the travel transaction. Source-native field interactions cause travel; arbitrary host title selection is not the gameplay transition.

A single-engine source graft of every map, script, resource, special, trainer, animation and event from the other game could ultimately remove the runtime boundary, but it introduces broad namespace, resource and semantic translation before preserving even the existing campaign. Current portable IR has no complete source-system closure. Two original source-engine domains provide faithful full execution while isolating the genuinely new behavior: cross-region travel and state transfer. This is legitimate only if the source event, shared state, return location, persistent outcomes and recovery work causally. Booting two games or exposing a switch button would fail this contract.

## Required responsibility ownership

| Responsibility | Authority and integration invariant |
| --- | --- |
| Maps, traversal, collision, NPCs, scripts, trainers and story | Each original source campaign remains authoritative, including beginning, middle, ending and postgame. Region story variables are never copied by numeric ID. |
| Battles, captures, evolution, move learning, status, items, abilities and AI | The active region's complete source engine runs them. No simplified battle replacement. Updated traveling creatures become the input to the other region. |
| Traveling party and trainer identity | One trainer and up to six active travelers. Source APIs or a source-proved exact serialized representation must retain all creature identity, progression, condition and metadata. Unsupported values or attached resources fail visibly before departure. |
| PC storage and collection | Regional original PC systems and box collections persist independently. The player selects the six travelers through the original PC. There is no claim of a globally unified box collection. No destination party may be silently overwritten. |
| Bags, local key items, money, badges and Pokédex | Regional source save authority initially. All ordinary systems continue. Cross-region creature presence and caught/seen bookkeeping require an explicit source-backed policy; local badge/obedience/HM gates remain real source rules. |
| Input, clock, renderer, camera, palette, OAM, audio and UI | One active original engine owns its complete frame. The inactive scene is suspended. Native game graphics/audio are retained; no generic reconstructed viewport. Input releases at transition to prevent held-button leakage. |
| Saves and recovery | Composition checkpoint captures both exact engine states and cartridge-save bytes, shared state, current region and transaction sequence. Ordinary region saves alone cannot represent the composition. Exact bundle/core/schema pins are required; unsupported migration rejects instead of resetting progress. |
| New region introduction | First arrival initializes the destination with the shared trainer identity but no imported party, then retains its original introduction and starter acquisition. Travelers remain transaction-owned until an explicit merge at the source-safe boundary. Capacity must be checked before departure; the source starter or any traveler cannot be dropped. Subsequent visits restore the existing region. This is an implementation gate, not assumed solved. |
| Ending | Both original campaign completion paths remain reachable. A bot fragment may test an integration boundary but cannot certify both campaigns. A first successful handoff is not a whole-game completion claim. |

## Travel transaction

1. A source-native field interaction raises an eligible travel request only at a source-proven safe boundary.
2. Release inputs; capture a pre-transfer composition checkpoint and sequence. Export the traveling state through the source bridge; validate every admitted field and linked resource.
3. Prepare the destination engine at a valid source scene boundary. New-region introduction and existing destination party preservation must be explicit. Do not copy live CPU or arbitrary source globals across games.
4. Import through destination source APIs, then read back and verify identity/progression invariants. Keep each engine's map/story/save owners intact.
5. Commit both source states, shared party, destination region and event sequence together. Duplicate event sequences cannot transfer twice. On failure restore both pre-transfer source states and retain the prior durable head.
6. Later travel returns to the suspended source world with the current travelers; source battle/capture/training outcomes must actually affect subsequent original gameplay.

Exact mailbox layout is owned by `tools/whole_game/source_bridge/`; native writes are limited to that pinned mailbox range. This document does not invent RAM addresses or a wire layout before the source implementation fixes them.

## Pipeline and evidence

The full-source builder owns isolated source copies, exact baseline checks and complete candidate ROM/ELF/build receipts. A manifest pins both inputs/artifacts, bridge implementation and state compatibility. The session module owns transactions/checkpoints; the existing playtester adapter supplies actual model decisions and native frame observations. Build receipts retain failure, build mode, cache context, toolchain, configured limits, per-stage and total durations. No new CI or broad matrix is required.

Focused transaction/ABI checks are necessary to protect saves and prevent silent creature loss. Actual original-engine integration is exercised by the existing Decisions/System 1/System 2 playtester, bounded native fast-forward and checkpoints. A scripted controller route cannot substitute for that requested bot test. Model configuration/provider failures are retained as failures, not relabeled as model play using a hidden policy fallback.

Required evidence levels remain distinct: (1) baseline/source builds; (2) candidate source bridge execution; (3) transfer, duplicate/failure/restore invariants; (4) real bot gameplay fragment with source state consequences; (5) full early/mid/late/endgame qualification. No measured full-loop speedup or completed campaign is available at the time this contract is written.

## Actual baseline build checkpoint

Both complete, clean source builds now reproduce their expected original SHA-1. Each ROM is 16,777,216 bytes. FireRed make took 43.279 seconds, total request 45.653 seconds; Emerald make took 62.578 seconds, total 65.210 seconds, with two jobs per build on Darwin arm64 and existing compiled toolchains. The builds overlapped, so their durations must not be added and described as elapsed turnaround. Queue time is unavailable. These are full-source baseline builds, not candidate gameplay or a comparable optimization before/after.

- FireRed receipt: `local/whole-game-mashup/emerald-firered/builds/firered/20261016T162448Z-053175321b49/receipt.json`.
- Emerald receipt: `local/whole-game-mashup/emerald-firered/builds/emerald/20261016T162445Z-aeb9cae75002/receipt.json`.

An earlier failed Emerald header-copy attempt is retained by the builder. Candidate bridge compilation and native gameplay qualification are separate later evidence.

## Candidate build and architecture review checkpoint

Both complete source candidates now compile and link with frozen bridge digest `d85d0450564e05a3f4175083aa780585820a493666e4d51777f39888a41086d4`:

| Source | Candidate ROM SHA-256 | Final passing receipt | Full make duration |
| --- | --- | --- | --- |
| FireRed | `1270e7caf5be37f395dae70fa82af11ca5f6d823f0e843e94dadb55f2d48734d` | `local/whole-game-mashup/emerald-firered/builds/firered/20261016T163403Z-ac7d5bd4b4f5/receipt.json` | 45.216 s |
| Emerald | `7ff888d3b2d3332c28e57727555cdc3b5da784a208dbffe62db2fa1530bc4de3` | `local/whole-game-mashup/emerald-firered/builds/emerald/20261016T163400Z-95d86d881bd9/receipt.json` | 65.349 s |

The same-machine, two-job, cold-source-object baseline/candidate make measurements are FireRed 43.279→45.216 seconds and Emerald 62.578→65.349 seconds. These are single samples with overlapping builds and different source inputs, not an optimization benchmark or throughput guarantee. Emerald final total request was 68.212 seconds, containing its make stage. Queue time and interactive end-to-end latency remain unavailable.

Real integration defects found and corrected in this work include:

- The original linker declares EWRAM `NOLOAD`; a C initializer did not initialize the mailbox in the running game. Explicit source startup initialization now owns it.
- Calling the destination new-game callback directly skipped native introduction state, including FireRed rival naming. First arrival now arms the unmodified title/introduction flow and waits for native starter acquisition before merging travelers.
- Exported state could change while the host completed a frame batch. Source export now freezes at its acknowledged field boundary; native stepping observes event boundaries.
- A generic party reconstruction would lose identity, encrypted payload and metadata. The bridge retains the exact common 100-byte source record, checks checksum before getters, proves source declarations/IDs and rejects unsupported linked mail, custom Enigma Berry and game-dependent Deoxys state.
- Composition snapshots initially omitted bridge initialization and pending arrival state, and travel journaling retained only the preimage. The session now serializes bridge/pending state, pins the actual runtime, retains both engines, and publishes a durable post-state head with rollback and rejected-travel recovery.
- Source build integration exposed a malformed script literal, a verifier relative-path assumption and FireRed's discarded libc `memcmp`; each failure is retained. The final bridge uses a local comparison helper.
- The builder incorrectly applied the original baseline hash rule to a modified candidate. The repaired assertion distinguishes baseline from candidate. Final passing ROM bytes equal the prior compile-complete outputs; the redundant clean receipt rebuild had already started before the reuse request and is retained as actual cost.

These builds establish runnable full-source artifacts and an implemented cross-region seam. Native startup/checkpoint and bot gameplay evidence are separately owned by the session/playtester reports. They do not certify both campaigns or a completed travel episode.

On the final candidate bundle, native startup initialized both mailboxes in 26 neutral frames. A paired checkpoint, one further neutral frame and restore reproduced the exact saved PNG in 2.056 seconds. A separate fresh-process restore reproduced the paired state, active region and decoded callback facts in 2.059 seconds. Eight focused transaction checks passed in 0.029 seconds. These are separate scopes, not durations to sum as end-to-end latency.

A separately labeled native FireRed mailbox fixture used a synthetic identity and neutral input to verify that `BOOTSTRAP` arms `READY` without jumping out of the original introduction callback: 13 initialization frames, six command frames, one stability frame, 1.506 seconds. It proves the source command boundary only. Actual model-driven NPC travel, native starter acquisition and cross-region party consequences remain the gameplay qualification gates.

Evidence:

- `local/whole-game-mashup/emerald-firered/native-smoke/final-adapter-155eef4f85/smoke.json`
- `local/whole-game-mashup/emerald-firered/native-smoke/portable-resume-78491d79c9/smoke.json`
- `local/whole-game-mashup/emerald-firered/native-smoke/bootstrap-contract-9814a0491a/fixture.json`

The real model-controlled composition pipeline run is owned by the playtester lane; no browser or hand-authored controller route is used as its substitute.
