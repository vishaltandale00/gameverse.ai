# Game decomposition extraction brief

Brief version: 2 (2026-10-16). Extractors cite the version actually used in their `extraction_run` source. Existing v1 extractions remain identifiable.

You are decomposing one GBA game into ontology components. Read first:

- `ontology/README.md`: data model and facets.
- `ontology/schema/game.schema.json`: the exact output schema.
- `ontology/games/metroid-zero-mission.yaml`: the reference decomposition. Match its depth and evidence style.
- `local/re/seed_vocab.json`: seed vocabulary (VGDL, Björk & Holopainen patterns, Game Ontology Project, game feel, progression).

## Goal

Components will be sampled and recombined into mashups (e.g. "Prince of Persia platforming physics + Metroid ability gating"). Mechanics, movement physics, AI and progression must be operational: typed state read/written, tunable params with units and native values, invariants, and relations (`requires`, `gated_by`, `modulates`, `part_of`, `conflicts_with`, `variant_of`) with conditions where they only sometimes hold.

The present task is extraction across the entire corpus, not mashup construction. Cover entities/pieces, resource flows, rule interactions, hardware implementation, assets/style, narrative/setting, and tuning parameters as evidence permits. Record missing domains explicitly. Parallelize independent games and evidence channels; do not require finishing one game before investigating others.

Player strategies and skills are distinct from implemented mechanics. State the enabling rule, preconditions, candidate action, expected effect and counterconditions. Mark these as inference unless observed in a retained trajectory or test. For now, schema-compatible summaries and research sidecars may carry this distinction; do not invent schema fields or claim a tested strategy from a screenshot. Keep the ontology plural: a resource-flow description and a read/write operator expose different facts.

## Evidence, strongest first

1. Community decompilation source (`local/decomps/<repo>/`). Record the repo commit (`git -C <dir> rev-parse HEAD`). Cite `repo:path:Symbol` for files and functions you actually opened.
2. Emulator captures (`local/captures/<id>/summary.json`, per-phase telemetry, keyframes, WAVs) from `tools/re/capture`. Cite as `capture:<phase>:<frames or field>`. Use them for rendering (video modes, HBlank DMA targets, affine, blending, windows), front-end flow (what appears in attract/front-end phases; view keyframes) and audio (DirectSound/PSG, mix rate).
3. Ghidra exports (`local/re/<id>/functions.jsonl`) when present. Cite `ghidra:0xADDRESS`.
4. `derived`: values you computed from other evidence. List the inputs.
5. `llm_knowledge` (confidence ≤ 0.6): only for what code and captures can't show (plot, tone, setting).

Never invent references. Say what you couldn't establish in `open_questions`.

Check the cited symbol and line span as well as the filename. Preserve integer operation order, directional clamps, shared random draws, unit conventions and caller preconditions. A valid source path does not prove entailment. Pin source/ROM revisions separately; a byte-matching build using `incbin` does not mean its rules have been recovered as source. Captures describe only the sampled phases, and an attract demo does not establish human or agent control.

For Ghidra, `decomp_ok` means pseudo-C was generated, not that types, returns, control flow or function boundaries are correct. Read warning/repair metadata and confirm consequential rules with instructions or matching source. Optional return repair helps control flow but can expose fictitious `undefined8`, `in_lr` or concatenated returns; do not interpret these as game state. IO direction hints are unverified; literal-address references are not proof of reads or writes. Keep unknown offsets as offsets until their gameplay role is established.

## Output rules

- Write `ontology/games/<id>.yaml` (ID from `local/re/roms.json`) and make `uv run tools/ontology/validate.py ontology/games/<id>.yaml` pass.
- Cover every evidenced facet, keeping movement, mechanics, AI and progression granular. Rich source may support 30–60 or more components; sparse evidence must produce an explicitly partial record rather than padded guesses. Facet count and component count are not completeness metrics.
- Reuse concept IDs already proposed in other `ontology/games/*.yaml` files when they fit (grep them first). Only propose new concepts with general, game-independent definitions. A component may instantiate concepts from other facets.
- Put fixed-point/unit conventions in `conventions`. Convert params to px, frames and seconds, keeping `native_value`/`native_unit`. Put difficulty/equipment/terrain-dependent values in `variants`. Put per-entity stats (enemy HP/damage, item effects) in `tables`.
- Use `variant_of` relations (`<other-game-id>/<component-id>`) when a component is a shared engine or a series variant of one already decomposed.
- Don't copy source code or text dumps into the YAML. Paraphrase and cite.
- Other extractors run in parallel. Keep draft/part files only in your own folder `<scratchpad>/<game-id>/`, never in shared paths. Write `ontology/games/<id>.yaml` once, when it parses.
- Record wall time in `game.sources`: `{kind: extraction_run, ref: "<model>, brief v1, <start>-<end>, <files read>"}`.

## Final reply (under 30 lines)

Component count per facet, new concepts proposed, the 3–5 most mashup-relevant operational components with key params, and what evidence was missing.
