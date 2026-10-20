# Single-ROM Emerald and FireRed composition

**Current work checkpoint:** the user changed the primary objective to lossless component extraction, original-game reconstruction and evidence-backed interchangeability. New mashup implementation and link iterations have stopped. Existing changes, source evidence and failed build receipts are preserved for that work. The coordinator currently lists 31 stages, but that registry has not run; the latest actual combined run is the 27-stage linker failure below. No standalone mashup ROM or linked ELF exists.

This preserved implementation replaces the rejected paired-ROM/native-host design. Its delivery target was **one standalone `.gba`**, with no second ROM, external switching host, or runtime state-transfer service. The older paired candidates and model runs are historical engineering evidence, not this deliverable. No single-ROM candidate has been built or qualified yet.

## Source authority and runtime

Emerald commit `731ad5bfd6e6f265508d0efcca0ba42f9dcf5881` supplies the running engine. FireRed commit `037335f4c725d7c9aecdac87066f2002b4bd7e14` supplies its complete regional world, campaign scripts, encounters, assets, and required native services. Canonical source trees and original ROMs remain immutable. All transformations run in isolated source copies with source-to-output provenance.

The target preserves Emerald's 518 maps in 34 groups and imports FireRed's 425 maps in 43 additional groups. Imported map/layout/script labels and constants receive an explicit FireRed namespace. The one engine owns rendering, input, map lifecycle, battles, capture, evolution, party, inventory, PC storage, and native save serialization. Interregional travel must be a native map/script transition within this same engine and persistent state, with meaningful cross-region party and progression effects.

Both original campaigns remain obligations. A compiling subset, boot screen, imported map count, or first crossing cannot establish full campaign correctness. Credits, postgame, field moves, regional story gates, gifts, trainers, wild encounters, shops, and recovery require explicit coverage. Unsupported original behavior blocks complete qualification; native service stubs and blanket script no-ops are forbidden.

## Work ownership

All modules below are under `tools/whole_game/single_rom/` and produce deterministic staged-source edits plus dependency/coverage records.

| Module | Responsibility |
| --- | --- |
| `world_assets.py` | All donor maps, layouts, connections, tilesets, object graphics, original asset provenance |
| `map_runtime.py` | Variable borders, tileset split and metatile attributes, graphics-bank provenance, source field behavior |
| `map_semantics.py`, `field_movement.py` | Donor predicates, terrain, Cut, spinners, stairs, cycling and boulder behavior |
| `scripts.py` | Complete script/text import, command translation, labels, native-service dependency inventory |
| `script_constants.py`, `opcodes.py` | Audited operand domains and actual donor command handlers |
| `native_services.py` | Verified shared service bindings and actual donor native service closure |
| `native_ui.py` | Source-backed donor menu, text, PC, and campaign UI service providers |
| `fonts.py`, `region_map.py` | Original donor font assets/renderers and Kanto/Sevii map presentation |
| `state.py` | Regional flags/vars/trainer progress, shared native save, initialization and capacity checks |
| `encounters.py` | Donor trainers/parties, wild encounters, items, battle-facing data compatibility |
| `battle_modes.py`, `battle_tutorial.py` | Donor battle-script modes and Oak tutorial without changing the native Hoenn tutorial |
| `world_services.py` | Regional roamer and Safari state, shared bag service bindings |
| `audio.py` | Donor songs, sound banks/samples, script/map music identifiers |
| `campaign.py` | Native interregional travel and donor campaign initialization without replacing the shared trainer or party |
| `travel.py` | Regional heal locations, blackout, escape, and destination state |
| `quest_log.py` | Native donor recording/playback subsystem and its saved history provider |
| `map_events.py`, `vs_seeker.py` | Donor clone/hidden-item events, renewable items and native trainer rematches |
| `daycare.py`, `fame_checker.py` | Route 5 daycare and original Fame Checker data/UI lifecycle |
| `trainer_tower.py`, `progression.py`, `credits.py` | Original Tower rules, regional badge/completion ownership and FireRed ending |
| `save_codec.py`, `save_runtime.py` | Bounded reversible box encoding and unified native save transactions |
| `build.py` | Isolated source assembly, transform dependencies, coverage gate, patch/provenance receipt, native build |

The separate pipeline owner maintains `tools/whole_game/pipeline.py`; the bot owner maintains the existing native playtester and one-ROM adapter. No UI or browser validation is in scope.

## Verified constraints shaping implementation

- Both map-group sets fit the original eight-bit group field (77 groups total). Appending preserves Emerald group identifiers.
- FireRed uses a 640-primary-tile/metatile split; Emerald uses 512. Both use 1024 total. Raw copying without corresponding renderer/field handling is incorrect.
- FireRed metatile attributes are 32 bits, Emerald's are 16 bits, and tileset member order differs. Explicit source-semantic translation or native dispatch is required.
- FireRed map layouts have variable borders. Emerald's implicit 2-by-2 border handling must preserve donor dimensions.
- Object graphics identifiers are eight bits and cannot simply be appended. Imported-object provenance must select the donor graphics bank while native player/surf/bike graphics retain the engine's bank.
- SaveBlock1 has only 120 spare bytes; SaveBlock2 has only 84. The existing nine-sector PokemonStorage allocation has 1968 unused bytes after the original structure, sufficient for the donor flag/variable block without removing any boxes. Initialization, clearing, serialization, and reset paths still require review and tests.
- Script command encodings, standard-script tables, and native special services differ. Matching names alone do not establish equivalent semantics.
- The linker permits 32 MiB but has fixed animation/graphics placements. Final content size and relocations require a real linked build; feasibility is not established merely by adding two padded 16 MiB file sizes.

## Artifact and qualification contract

The standalone manifest uses `whole-source-single-rom/1`: exactly one ROM and ELF, `runtimeDependencies: []`, both original source revisions/tree pins, a merge receipt with source-to-output coverage and patch hash, and the successful native build receipt. The build patch hash must equal the merge receipt's output patch hash. Native sessions pin the resulting ROM and ELF; no paired checkpoint is compatible.

Builds retain clean/incremental mode, source pins, toolchain, duration and failures. Component checks are narrow; full campaign qualification is separately scoped. Bot testing uses the existing System 1/System 2 decision loop and native emulator, with source observations resolved from the exact new ELF. No hard-coded controller route substitutes for the bot. Initial qualification must show native cross-region interaction with the same party/progression and native save/reload; whole-campaign untested obligations remain explicit afterward.

`build-development` may compile real transformed source while semantic obligations remain open, to expose compiler/linker failures and permit explicitly unqualified checkpoints. It cannot substitute stubs, skip missing transform modules, or produce a qualified manifest. A fresh unified save is an explicit supported policy; importing an old original-game or paired-runtime save is not required for this new game.

## Source ownership choices

Shared party, PC, inventory, ordinary combat, and their standard menus use the actual Emerald source systems in both regions. FireRed trainer parties and encounter data feed that engine through audited identifiers and typed services. This intentionally combines source systems; it does not assert that Emerald's AI or menu presentation is byte-identical to FireRed's. Unique donor mechanics and campaign-specific rules still require their source implementations. For example, the Oak tutorial cannot reuse Emerald's identically named first-battle flag, whose behavior belongs to Birch's encounter. TM Case and Berry Pouch may invoke the native Emerald pocket selectors with correct lifecycle and item effects instead of duplicating the entire bag UI.

Repel is one shared item-effect counter. Flute flags use the shared native state, but retain the source lifetime: both originals clear those effects on map load. Native travel therefore does not invent a separate persistence rule for them.

## Retained integration evidence and failures

The first integrated source pass (`20261016T170203Z-c477f16f269b`) produced 5,204 changed files in 22.068 seconds. Its patch applied to pristine Emerald. This was staged source, with unresolved obligations, not a playable ROM.

A diagnostic build exposed an integrity defect: `git apply` inside an uninitialized archived tree discovered the enclosing repository and silently skipped patch paths. The receipt recorded the patch hash while the ROM remained the original Emerald. That historical result is invalid as composition evidence. The builder now initializes an isolated temporary Git root, records the applied tree and changed files, and checks the expected merged tree before compilation. A focused existing-file/new-file patch test exercises the failure mode. The corrected native build then exposed real source compiler failures, including numeric map-local IDs and an ambiguous nested battle branch; those failures are retained and assigned to their owners.

The fourteen-stage pass (`20261016T170839Z-b5d81f9f8bb3`) applied all 5,231 changed files and reached native compilation. It remains a failed development build. Bounded keep-going diagnostics collect independent translation-unit errors instead of repeatedly compiling a clean tree only to rediscover one early error.

## Full-save capacity obligation

The original 128 KiB flash layout cannot hold raw full donor QuestLog history plus all existing saved features with the old section allocation. Dropping history or treating a checksum as atomic recovery is not a solution. A source-verified 80-to-75-byte BoxPokemon codec now preserves every native byte on admitted valid records, saving exactly 2,100 bytes for 420 slots. Its native oracle passed 2,704 roundtrips and 29 rejection cases, including all 24 substructure permutations; ARM compilation also passed. This is a codec result, not a completed save system.

The enclosing streaming serializer is implemented with two thirteen-sector campaign snapshots, separate QuestLog sectors, and existing Hall of Fame/Trainer Hill/recorded-battle sectors. Its 178 focused fault cases and ARM compilation passed in 0.677 seconds. It distinguishes uncertain flash reads from verified empty storage, writes the inactive snapshot, delays the link-save commit until peer synchronization, and blocks field entry or further saving after a failed load. It reuses the native sector buffer rather than allocating an additional full snapshot in EWRAM. These are host fault-model and compiler results; final combined structure size, EWRAM linking, native flash timing and actual game save/reload remain unqualified. QuestLog history has an explicit independent single-copy recovery policy.

## Current compilation checkpoint

The retained 22-stage diagnostic `20261016T172450Z-3701ecceb96f` reached actual native compilation through source build `20261016T172517Z-f18dcc9a1daa`. It failed, with 76.5 seconds in the build and 103.0 seconds total. Subsequent focused checks compile the corrected native UI, Trainer Tower and VS Seeker units with agbcc. All 425 imported map-event outputs now assemble, and all 183 packed hidden-item records match the original JSON fields byte-for-byte. These checks do not establish a linked cartridge.

The 26-stage diagnostic `20261016T173505Z-7a6efda30ecc` applied 5,449 changed files with exact intended/applied tree `80479e2c7293cf2c3390c1f0c8f26546637f89eb`. Build `20261016T173534Z-9df091486bf7` failed with 14 compiler diagnostics across three translation units, down from the earlier 137 diagnostics. Its build took 77.7 seconds and total elapsed time was 106.2 seconds. This comparison records different corrected source snapshots, not a build-speed improvement. Targeted fixes for those errors now pass; a 27-stage snapshot also includes the original FireRed credits. No merged ROM is available yet.

The source-definition audit `native-services/native-frontier.json` exposes a separate closure gap: the first analyzer classified 221 native roots as script-reachable, of which 76 have emitted donor-prefixed C definitions and 145 still need providers; it classified another 51 unique registry roots as unreferenced. **Those reachability counts are provisional:** a subsequent audit found parameterized `special \\function` calls in 118 Fame Checker macro invocations that the first analyzer skipped. Argument-bound macro expansion and default-argument resolution are required before claiming a complete root set or pruning anything. A provider claim in metadata is insufficient. The shared-service resolver must first bind proven complete Emerald services using signature, state, identifier and dependency evidence. Actual donor divergences then receive source implementations. Unreferenced registry entries may be removed only after a complete static operand/reachability proof, never replaced with success stubs. This remaining closure prevents a complete-source claim even after translation units compile.

The subsequent real ARM assembler listing resolves that static-root omission: 223 unique specials across 1,063 encoded calls, including all 118 Fame Checker invocations (101 default and 17 overridden targets). No unknown operands or raw special opcodes remained in the imported static closure. `special_registry.py` consumes assembler expansion and preprocessor lineage rather than inventing a parallel macro interpreter. The audit took 1.46 seconds, with 1.17 seconds for the listing. Registry pruning remains disabled: received MysteryEvent RAM scripts have a separate bytecode ABI boundary, whose actual dispatcher is the native Emerald script table. Its advertised protocol and ownership must be established before any compaction decision.

A prepare that captured an in-progress syntax edit was retained as a failure with no compiler invocation. Optional eclectic prefab modifications must enter the same source/provenance and linked-provider checks; their inclusion must not be inferred from a stage count.

The subsequent 27-stage snapshot `20261016T173930Z-87585bfe12e4` compiled every source translation unit and reached GNU ld. Source build `20261016T173959Z-bfa91fe05a01` applied 5,492 changed files with exact tree `36c024006819bcdc6723e5431bb0ac8cf3704d64`; build time was 78.1 seconds and total time 107.1 seconds. The complete build log contains 4,491 references to 835 unique undefined symbols. An earlier count of 192 unique symbols came from a truncated diagnostic excerpt and is not the full frontier. Most failures are symbolic integration gaps: 425 map-script labels, 63 tileset globals, 130 object-graphics constants and 25 other constants; the remaining 192 are native/helper symbols. The retained `link-undefined-inventory.json` pins the complete log, and future receipts explicitly identify diagnostic truncation. This actual object/link frontier drives source-provider and constant fixes. There is still no ROM or linked ELF and no merged-game bot qualification.

The user's additional eclectic request is an additive, explicitly pinned prefab recipe over this complete source foundation. It must retain one standalone cartridge, declare exact source-backed mechanics and native hook/state ownership, and use the reusable pipeline. It does not relax the original campaign obligations or authorize a separate substitute game.

## Preserved reconstruction handoff

The clean original source builds, their ROM/ELF artifacts and object partitions are the reconstruction baseline. Imported or adapted mashup modules are not evidence that either original game can be losslessly reconstructed from interchangeable components. The build owner has sent the exact baseline receipts and partition locations to the pipeline architecture lead.

The incremental diagnostic route (`--reuse-build-receipt` plus an exact receipt hash) is implemented and fixture-tested. It verifies a fresh patched source tree before cloning prior outputs with distinct inodes, synchronizes changed source, and preserves old artifacts. It has never run on a real incremental candidate, so no incremental before/after timing exists.

Registry compaction was discussed but **not implemented**. The original native table prefix and full appended donor registry remain unchanged. The assembler root proof and supported native external-protocol boundary are preserved as evidence for future compiler work.

Several newer source modules have only focused checks and were never included in the latest combined run. The utility-service checkpoint completed seven of thirteen targeted translation units and failed six in 3.1916 seconds; its source admission remains blocked. The remaining UI checkpoint has one failing source-contract test and incomplete native preprocessing qualification. Campaign's latest EReader reset edit postdates one earlier receipt hash, so that receipt must not be treated as proof for the current file. These unfinished states are retained rather than repaired after the objective change.
