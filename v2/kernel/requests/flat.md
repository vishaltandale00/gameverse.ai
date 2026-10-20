# Kernel / host requests from the flat graphics workstream

Each request names the workaround already in place in `v2/primitives/graphics/*`.

## 1. Host time scale for hit-stop and slow motion (player.js)

`graphics.fx.feedback` needs to pause or slow the simulation for a few frames (hit-stop, KO slow-mo). Graphics must not write `rt.state`, and the fixed-step loop lives in `v2/web/player.js`.

**Request:** `view.setTimeScale(s)` in `mountGame`, where `s` is in `[0, 1]` and scales the accumulator (`acc += dt * s`). `0` holds the simulation; inputs still queue. Determinism is unaffected, because steps stay fixed and only wall-clock pacing changes.

**Workaround:** if `view.setTimeScale` exists, `fx.feedback` calls it. Without it, the effect is presentational:
- hit-stop freezes the displayed entity positions, then eases back to the live state over about 90 ms;
- slow-mo slows the presentation clock (particles and animation) and darkens the frame slightly.

## 2. Default 2D renderers in the host (player.js)

`DEFAULT_GRAPHICS` only maps `engine.space.graph` to `graphics.ui.story`. A document with a 2D space and no `graphics[]` shows nothing.

**Request:** add these defaults:

| Space | Default graphics |
| --- | --- |
| `engine.space.tilemap` | `graphics.render.tilemap` |
| `engine.space.grid` | `graphics.render.grid` |
| `engine.space.physics2d` | `graphics.render.physics2d` |
| `engine.space.arena2d` | `graphics.render.arena2d` |
| `engine.space.track` | `graphics.render.track` |
| `engine.space.none` | `graphics.render.dom` + `graphics.ui.story` |

Optionally, add `graphics.render.dom` before `graphics.ui.story` for graph spaces. Each renderer already brings default juice (particles and feedback), a default backdrop, generated art and a default camera.

## 3. Grid anchor vs `bodyBox`

The grid card says integer `at` values are cell centres. `testing.js` `bodyBox(e, api)` with `anchor: 'cell'`, however, returns `min = at`, which is a cell spanning `[at, at + 1)`.

The flat grid renderer follows the space card and draws cells centred on `cellCenter(at)`. Please make the two agree: either `bodyBox` centres cell anchors, or the grid documents `at` as the cell corner.

## Resolved

- Digit-led id segments: `graphics.lighting.2d` registers under its catalog id (cbc7e2d8).
