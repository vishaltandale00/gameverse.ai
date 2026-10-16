# Evidence-graded game portraits

These 33 portraits are a research layer above the granular game ontologies. They
help a person describe a desired game using recognizable pieces: movement and
view, combat, AI, progression, setting, story, presentation and tone. A portrait
has at most eight pieces. Missing slots are intentional; a generic engine helper
does not justify inventing player-facing mechanics.

The records cover every current `local/re/roms.json` entry. Coverage is partial:
19 games have canonical component records, and 15 currently support meaningful
source-linked design pieces. Some other games have only instruction-checked
helpers, retained scenes and unverified proposals. See
`research/requests/corpus-coverage.json` for the exact queue and per-game gaps.
All referenced local paths are relative to the repository root. Source checkouts,
ROMs and retained captures remain local inputs; they are not bundled here.

## Schema and evidence meaning

Each JSON file has `schema_version`, `game_id`, `title`, `identity`, `pieces`,
`story`, `coverage` and `provenance`.

- `identity` supplies an editorial tagline, category vocabulary, view and visible
  examples. A genre/category tag is not proof that its rules have been extracted.
  `gameplay_prior` is explicitly unverified unless a specific piece links source.
- `pieces` contain a plain-language `effect`, `flavor`, `knobs`, granular
  `component_refs`, conceptual `requires`/`exposes`, conditional `conflicts` and
  possible `bridge_options`. These explain design dependencies; they are not an
  already implemented universal ABI. A proposed bridge is not a qualified build.
- `story.beats` distinguish source-backed local state transitions, observed
  scenes without causal-order claims, and unverified recalled premises. A list
  of event names does not establish the complete chronological plot. `delivery`
  describes how scenes, dialogue, camera and world-state changes are coordinated.
- `coverage` identifies depth, missing evidence and granular records that are not
  summarized by the high-level pieces. They remain available in the canonical
  game YAML rather than being discarded.
- `provenance` records the ROM hash, inherited source/check-out metadata, canonical
  file hash, retained frame hashes and direct new source anchors where present.
  Confidence numbers are editorial evidence assessments, not calibrated event
  probabilities or model-accuracy measurements.

`source_supported_partial` means a piece binds to existing canonical components
with their original evidence and caveats. This pass reads those records; it does
not independently re-verify every source claim. Mixed evidence inside a canonical
component remains mixed, including explicitly marked `llm_knowledge` entries.
`direct_source_inspection` adds a named file/span with both SHA-256 hashes.

`observed_interpretation` supports a local reading of two retained scene
thumbnails: visible framing, palettes, architecture, HUD or character staging.
It does not prove control, collision, motion rules, a complete plot or a completed
playthrough. Vibes such as “gothic,” “warm” or “tense” are editorial interpretations
of those scenes, not canonical game-state variables. A game's overall tone may
vary outside the observed scenes.

`candidate_unverified` and `model_prior_unverified` mark remembered gameplay or
story directions that need source/event evidence. They must not be advertised as
extracted mechanics, silently used as a build recipe, or promoted merely because
a title sounds familiar. This is especially important for sparse ROM-only games
and games whose current decompilation records are anonymous numeric helpers.

## Newly deepened story anchors

Zero Mission adds local source branches for Mother Brain defeat, the Ruins Test
power restoration and Mecha Ridley defeat becoming an escape sequence, alongside
its named cutscene inventory. Emerald adds Route101's staged help request and
starter choice, Sky Pillar's state transition and Sootopolis's weather-clearing
set piece. Exact file/span hashes and local prerequisites/results are in those
two portraits. Neither is represented as a complete campaign event graph.

No new ROM extraction, simulation, paid-model batch or gameplay campaign was run
for this portrait pass. A narrow reference check resolves component IDs, local
paths, retained frame hashes and new source-span hashes. The resulting corpus
queue separates missing player rules, uneven existing depth, story graphs and
native composition contracts so future work can proceed across games in parallel.
