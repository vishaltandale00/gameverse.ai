# Game component ontology

Status: populated draft data model (2026-10-16). Existing game records include deep and explicitly partial extractions; passing the schema does not establish factual correctness or complete coverage. Start with [the extraction handoff](RESEARCH_HANDOFF.md) for current evidence, experiments and remaining work.

This is step 1 of the composition pipeline in Shishir's loop (issue #2): decompose existing games into components, register them in a shared ontology, then sample components to propose and evaluate mashups. The first corpus is 33 GBA games (local ROMs, never committed). GBA is a reference platform for testing the idea, not the target runtime.

## What gets recorded

**Concept**: a reusable idea in the shared vocabulary, e.g. `rendering.background.per_scanline_affine` ("Mode 7"), `movement.jump.variable_height`, `frontend.title.attract_demo`, `ai.enemy.patrol_chase_fsm`. Concepts form an `is_a` hierarchy inside a facet. Seeded from published taxonomies; new leaves are proposed during extraction and merged/deduplicated with embeddings plus review.

**Component**: one game's concrete instance of one or more concepts, e.g. Super Mario World's run/jump physics, Mario Kart Super Circuit's HBlank-DMA affine track renderer. Mechanic components are *operational*:

| Field | Meaning |
| --- | --- |
| `instantiates` | concept IDs (weighted when partial) |
| `reads` / `writes` | typed state touched, e.g. `player.velocity.y`, `world.flags.ability.*`, `camera.scroll` |
| `params` | tunable numbers with units and evidence, e.g. gravity, jump impulse, max speed |
| `invariants` | what must stay true, e.g. "player cannot pass a locked gate without ability X" |
| `relations` | to other components: `modulates`, `requires`, `conflicts_with`, `variant_of`, `part_of` |

Presentation, narrative and setting components are descriptive but still cite evidence.

**Evidence**: every claim names its source and confidence:

| Kind | Example reference |
| --- | --- |
| `decomp_source` | community decompilation file/function (e.g. pret/pokeemerald `src/title_screen.c`) |
| `ghidra_function` | ROM address + our pseudo-C export |
| `capture_telemetry` | emulator phase/frame range with register evidence (video mode, HBlank DMA target) |
| `capture_frame` | keyframe image from a capture (stays in `local/`) |
| `static_signature` | byte/string signature (sound engine, save type, compression) |
| `llm_knowledge` | model recall without code evidence; lowest default confidence |
| `human` | reviewer judgement |

## Provisional top-level facets

| Facet | Covers | Seeded from |
| --- | --- | --- |
| `mechanics` | entities, abilities, attributes, rules, goals, termination, combat | Game Ontology Project, VGDL, Björk & Holopainen |
| `movement_physics` | locomotion, jump models, momentum, collision, game feel | Swink, VGDL physics classes |
| `ai` | enemy/opponent/NPC behaviour, rubber banding, difficulty adjustment | game-AI literature |
| `camera` | viewpoint and scrolling behaviour | IGDB/MobyGames perspectives |
| `projection` | top-down, side view, isometric, behind-view pseudo-3D | graphics terminology |
| `rendering` | hardware/engine technique: tile modes, affine/Mode 7, raster effects, bitmap software 3D, sprite tricks | GBA hardware (verify against GBATEK) |
| `ui_hud` | HUD, menus in play, input mapping | Game Ontology Project interface |
| `progression` | ability gating, lock-and-key, levels, hubs, overworld, open world | Metroidvania and Dormans lock-and-key work |
| `economy` | resources, sources, drains, converters | Machinations |
| `narrative_delivery` | cutscenes, dialogue, embedded/emergent story | Jenkins |
| `setting` | fiction, theme, tone | our vocabulary |
| `frontend` | boot logos, title, attract mode, menus, save/load, game over | our vocabulary |
| `audio` | sound engine, music structure, adaptive music, feedback sounds | our vocabulary |

Genre is a derived tag computed from components, not a decomposition axis. Tunable parameters live on components (`params`), not in a facet. Relation types adopt Björk & Holopainen's `instantiates`, `modulates` and `conflicts_with`, plus `is_a`, `part_of`, `requires`/`gated_by` and `variant_of`.

## Layout

- `ontology/concepts/<facet>.yaml`: concept vocabulary (source of truth, reviewable).
- `ontology/games/<game-id>.yaml`: per-game decomposition into components with evidence.
- `ontology/schema/`: JSON Schemas validating the above.
- `tools/re/`: ROM indexing, capture harness and Ghidra pipeline that produce evidence.
- `local/` (gitignored): ROMs, community decomps, Ghidra projects, pseudo-C, captures, embeddings.

Only abstractions and evidence references are committed. Decompiled code, ROM bytes and captured frames stay in `local/`.

The current work is comprehensive extraction and mining across the corpus: rules, entities, resources, player skills and strategies, hardware, assets/style and narrative. Composition is a later use of the extracted material. A source-file inventory is not a recovered asset-use graph, and a screenshot label is not evidence of live player control. Missing ROM decompilation remains required work.
