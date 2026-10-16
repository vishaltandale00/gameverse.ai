# Game Space and Mashup

The app combines the original source-built GBA player, a 33-game research map and
an eight-dimension mashup workspace. It adds no runtime dependency, external font,
model call, CI job or generation service. `npm run dev` serves the normal app on
port 4173. `/?view=play`, `/?view=workshop` and `/?view=discover` select its views.

## Design flow

Choose two to four parent games from all 33 indexed games, then choose a campaign
foundation. Up to eight broad decisions cover movement/perspective, encounters,
growth, world rules, resources/companions, opposition, atmosphere and story.
Each may favor a parent, propose a bridge or remain open. Parent-inspired bundles
reference existing ontology IDs; absent research is identified explicitly.

Companion requirements and conditional conflicts accompany the decisions. A
side-view field plus top-down hubs is a possible bridge requiring explicit
collision/camera/control transitions; it is not automatically implemented by
selecting two viewpoints. Style and story choices remain creative directions.

Copy/download exports a schema 2 `gameverse_mashup_request` targeting GBA, with
parents, foundation, at most eight design choices, multiple source components per
bundle, dependency decisions and request constraints. It is a build brief for
Codex implementation review. Export does not create or register a cartridge.
The rejected JavaScript game and abstract grid generator have been removed.

## Research map

Explore retains the 33-game library, 676 component summaries from 19 partial game
ontologies, and 18 embedding/capture views. Neighbor rankings use original
per-view distances, not positions on the 2D projection. Text axes are unverified
local-model recall; capture axes describe limited observed scenes. Similarity is
not established compatibility. Source evidence is linked independently.

`games/research.json` is a public derived summary with source hashes and revision.
It now includes 33 graded game portraits: 222 broad design pieces, including 84
with partial source support, 82 observed interpretations and 56 unverified
candidates. Story beats, vibes, requirements, conditional conflicts and proposed
bridges appear in bundle drilldowns and exported GBA briefs. Source-supported
partial, observed and unverified/model-prior grades remain distinct; a source
reference does not qualify an assembled game or recover a complete plot graph.

The local development server watches canonical `ontology/games/*.yaml` and
`ontology/portraits/*.json` metadata through a lightweight on-demand cache.
`/research/status.json` reports the published version, freshness, counts and errors.
The UI checks on focus/visibility and every 20 seconds while idle, and offers
Refresh research. New data retains the selected parents, foundation, choices and
notes. Automatic application is deferred while editing, and refreshes are skipped
while a GBA session is active. Failed refreshes retain the last successful summary.
The research bar identifies when data was updated and separately dates the retained
embedding map.

Source-only refresh uses existing PyYAML and retains all 18 embedding coordinates
and neighbor rankings. It does not import NumPy, read vectors, call models, or
recompute the map. Configure `RESEARCH_PYTHON` if the server's default Python lacks
PyYAML. Static builds retain their last exported summary and have no watcher.
The public data contains no ROMs, raw vectors, credentials or private machine paths.

```sh
python3 scripts/export-research.py . --source-only
```

The original full map export remains available with the existing NumPy/PyYAML
research environment, without `--source-only`. Future mining agents should publish
validated canonical records and graded portraits incrementally; raw decompiler
leads and research logs are not automatically promoted into usable components or
published by this watcher.

## Play

Normal Play registers actual source-built GBA artifacts through the existing
catalog and `GbaAdapter`, preserving cartridge/core/profile save identity. FireRed
and `mzm-emerald-encounters-v1` are the current local entries. The latter retains
the Zero Mission campaign and adds native three-Pokémon encounters. Its battle
subset, reset party and hazard-inclusive entry limitations are documented in
`tools/gba_mashup/recipes/mzm-emerald-encounters-v1.json`.

A research entry does not become playable without a matching source/artifact
receipt. The native composition receipt additionally pins its recipe. Build
outputs, raw assets and gameplay recordings remain local ignored files.

## Bounded verification and timing

New mashup browser inspection took 492.5 ms on the existing cached Chromium 1223,
macOS arm64 development machine. It covered all eight choices, bridge selection,
schema 2 export, retained Explore map, FireRed card, no runtime errors and no
390px-wide overflow. A subsequent isolated browser check loaded the exact native
candidate through normal Play: 3.466 s total, 43.9 ms load/restore, native frames 0→92,
240×160 canvas, no errors. No existing player profile was used or modified.
Reports/screenshots: `local/re/mashup-ui/` and `local/re/native-play-ui/`.

Six identity/cartridge checks passed during the earlier combined Node run.
The four workshop checks were then updated to the actual schema 2 boundary and
passed in 37.35 ms: eight broad choices may contain more than eight raw pieces,
and stale choices, duplicate/missing parents and unbounded notes are rejected.
The unused schema 1 grid-request helpers were removed. There is no complete
campaign qualification or new CI measurement.

Earlier frontend shell-copy build observations were 15.9 ms before and 17.1 ms after
on comparable inputs (`d63a776` to the earlier frontend working tree). Those
measurements predate this redesign and do not quantify its overhead. No comparable
before/after measurement for the current redesign is available. Queue time is
unavailable. These are individual local observations, not a latency SLA.


### Research refresh measurement

A bounded local check used a temporary copy of the canonical records and portraits,
with the same retained embedding snapshot and existing macOS arm64/Node/Python
runtime. An unchanged forced metadata check took 1.98 ms. After one portrait label
changed in that fixture, export plus reload took 1.536 s (1.535 s inside the refresh
stage). The UI picked up the change on focus while retaining intent, custom story
notes and combat selection; all embedding-view data remained identical. Graded
counts remained 84 partial-source, 82 observed and 56 unverified. The exported brief
contained portrait pieces and story beats, and no browser runtime errors occurred.
Fixture records never replaced actual mining inputs.

A separate real local HTTP status request took 18.3 ms, including 4.80 ms of server
metadata checking, and returned the current 33-game/676-component/222-piece summary.
Four existing workshop tests passed in 44.5 ms. Reports are under
`local/re/research-refresh/`; its image is a fixture witness, not a new mining claim.
No old manual-refresh timing was captured, so these observations do not establish
a comparable before/after feature-overhead improvement. Queue time and CI duration
are unavailable. No new CI job, dependency, model call or ROM campaign was added.
