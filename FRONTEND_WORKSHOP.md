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

`games/research.json` is a compact cached snapshot with source hashes and revision.
It contains no ROMs, raw vectors, credentials or private machine paths. Refresh
outside build/CI with the existing research Python/PyYAML/NumPy environment:

```sh
python scripts/export-research.py /path/to/research-checkout
```

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
