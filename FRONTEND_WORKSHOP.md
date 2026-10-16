# Game Space and Workshop

This branch extends the source-built FireRed launcher with a research catalog,
an interactive map and an evidence-anchored request workbench. It adds no runtime
dependencies, external fonts, model requests, telemetry service or CI job.
`npm run dev` serves it locally. The Play view keeps the verified cartridge,
profile, checkpoint, controller and recovery paths from the original launcher.
Only the source-build catalog determines whether a game can be played.

## Discovery and request flow

The committed `games/research.json` snapshot contains all 33 indexed research
games, 676 component summaries from 19 partially extracted games and 18 existing
embedding/capture views. It contains no ROM bytes, screenshots, raw embedding
vectors, credentials or absolute machine paths. Source file hashes and source
commit identify the snapshot. Component citations retain their original evidence
quality; their presence does not establish semantic correctness or completeness.
Summaries longer than 800 characters end with an ellipsis; consult the canonical
ontology before implementation.

Select a dimension and a point to inspect a game, its nearest/farthest neighbors,
component records and original source references. Neighbor ranking uses the
original per-view distances, not distances on the 2D projection. The exporter
reuses existing projected coordinates. Embedding vectors are mean-centered and
normalized, except the already standardized rendering telemetry view. Distances
are normalized by the maximum within each view. The frontend/projection distribution axes are vision-model classifications of
captured screens; visual-style/audio axes are capture embeddings; rendering
telemetry is observed hardware activity. These bases have separate UI badges.
The 13 text axes were generated
from local-model recall and can contain mistakes; capture axes cover limited
scenes. No axis is a validated compatibility score. The cached embedding model
revision is unavailable. Capture nodes with fewer than the original coverage
threshold are marked with a dashed outline.

Add games to the mix, then open component records and choose **Use this component**.
Describe the desired game and each adaptation. **Copy concept** creates a design
prompt with unbuilt status. **Export harness request** emits the real
`tools/game_attempt` schema: version, candidate ID, title, intent, exact
component IDs, adaptation notes and bounded constraints. It requires components
from at least two games, at most eight components, an intent no longer than
4,000 characters and adaptations no longer than 1,500 characters. Unknown or
stale selections are rejected. Browser-only metadata does not enter the harness
request.

**Try the key + gate example** loads Emerald's `grid_step_locomotion` and Zero
Mission's `ability_gating_graph`, with explicit simplification notes. In the
research checkout, run the downloaded request with:

```sh
python3 -m tools.game_attempt --request /path/to/gameverse-request.json
```

The current harness creates and playtests a small reference grid game. Selected
ontology IDs are design anchors, not automatic recovered implementations. Other
movement, combat, sound, art and narrative systems require implementation by
Codex. There is no browser-side generation or registration endpoint, and export
does not create a playable ROM or modify accepted player saves.

## Refresh the research snapshot

This optional research operation is outside the build and CI path. Reuse the
research environment's existing Python, PyYAML and NumPy; the web app itself has
no Python dependency.

```sh
python scripts/export-research.py /path/to/research-checkout
```

The input checkout must contain the indexed ROM metadata, canonical ontology
YAMLs and existing `local/embeddings` artifacts. Input contents are hashed. No
models are called, no vectors are exported, and local untracked inputs are
identified by their hashes rather than represented as committed source content.

## Validation and timing

No CI job, matrix or build stage was added. Four offline tests cover the actual
request boundary, stale references, resource limits, secret-free compact data and
catalog filtering. They run alongside the six existing identity/cartridge tests.

Representative local measurements on 2026-10-16, macOS arm64, Node 24.14.0,
existing `node_modules` cache, same isolated checkout and runtime:

| Operation | Before | After | Outcome |
| --- | --- | --- | --- |
| Shell-copy build (`npm run build`) | 15.9 ms | 17.1 ms | passed |
| Node tests (`npm test`) | 6 tests / 721.5 ms | 10 tests / 746.4 ms | passed |

Before source: `d63a776` (`origin/main`). After: the
`codex/frontend-ontology-mashup` working tree before its local commit, using
research source `d4fa48b`. No queue, CI or remote runner measurement was available.
These are individual local observations, not an established latency budget or
statistical performance result. The build remains a shell copy and excludes game
artifacts. Research snapshot size is approximately 856 KB uncompressed; it is
requested once per page load and parsed locally. The map has 33 interactive SVG
nodes and no continuous animation. Reduced motion disables optional animation
and smooth scrolling. Controller status text is updated only when its value
changes rather than every animation frame.

Headless Chromium (cached revision 1223) checks covered catalog search/filter,
map selection and provenance, component selection with retained context, request download, original
FireRed card/profile dialog, mobile overflow and page/CSP errors: 18 checks passed
in 848.5 ms. This tests the shell and interactions; it does not qualify a full
FireRed playthrough. No visible browser was opened or controlled. The downloaded
request was then executed by the actual offline generation/playtest harness:
`20261016T053553Z-833a89ea` succeeded, total 0.033809 s, generation 0.000012 s,
validation 0.001502 s, playthrough 0.013679 s. Stages are nested in total; queue
and build time are unavailable for this data-only attempt.

The first headless attempt used a missing default browser revision and was
corrected to the existing cached executable. A subsequent test clicked an SVG
group's label-inclusive bounding box rather than its point; targeting the actual
point resolved it. The secret-scan fixture initially matched ordinary words
containing `sk-`; the pattern now checks key-shaped strings without logging full
research contents. None required a dependency install or an extra CI stage.
