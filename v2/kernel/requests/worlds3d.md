# Kernel requests from the worlds3d workstream

Each request has the workaround the worlds3d primitives (`engine.space.voxel`, `engine.space.mesh3d`, `engine.generate.*` 3D generators) use today.

## 1. Preflight does not normalize generator configs

`preflight()` returns a normalized document in which `spaces[i].with`, `systems[i].with` and `graphics[i].with` have card defaults applied. `spaces[i].generators[j].with` is left raw, so a generator's `install()` receives an incomplete config. That contradicts KERNEL_API §1, which says "install receives a complete config".

- **Workaround:** every worlds3d generator calls `withDefaults(card, config)` (`worlds3d-lib-world.js`, a `checkFields` pass without a ctx) at the top of `install`.
- **Request:** also map `generators[j].with` to the normalized config in the `out` document.

## 2. Object params lose their nested field defaults when omitted

When an `object` param is missing, `checkParam` returns `structuredClone(schema.default)` and never visits `fields`. A card with `default: {}` and field defaults therefore yields `{}`.

- **Workaround:** object params carry a complete `default` (for example `engine.generate.terrain.noise` `blocks`).
- **Request:** when the value is `undefined` and the schema is an `object` with `fields`, return `checkFields(fields, schema.default ?? {}, ...)`.

## 3. No "all generators installed" hook

Generators install after their space in document order. Several worlds3d builds need every contribution to be registered first: roads snap to city streets, structures avoid roads and lots, and scatter avoids all of them. That holds regardless of document order.

- **Workaround:** generators register deterministic build steps on the space's `WorldModel`. The model builds lazily, in stage order, on the first spatial query; in practice that is the player's `place()` during `createWorld`. A model rebuilds when the seed in state changes on restore, or when hot-loaded zones arrive (`extend`).
- **Request:** an `rt.onReady(fn)` (or `afterInstall`) hook that runs once after every install and before the player spawns, so builds can be eager and their timing explicit.

## 4. Spatial verifier point targets on coarse navigation grids

`v2/verify/spatial.js` checks a point target with `keys.has(floor(at).join(','))`. Only zones and entities go through `api.zoneAt` / `api.cellOf`. Large continuous worlds flood-fill reachability on a coarse grid (mesh3d's `reachable()` cell grows so the whole world fits `reachNodes`, for example 24 m for Emberfall), so a floored point is almost never a member.

- **Workaround:** mesh3d `reachable()` adds zone ids, and `cellOf(at | entity)` maps any position onto the same key grid. Point targets in mesh3d documents should be zones, or should be checked with `cellOf`.
- **Request:** in `spatial.js`, test point targets with `api.cellOf?.(at) ?? floor(at)`.

## 5. `validate` cannot see generator space kinds without a lookup

This is solved by the 4th `validate` argument. worlds3d uses `inst.space` to check voxel block ids against `content.blocks` at preflight (`block_unknown`). No request remains; it is recorded here because the same lookup (`spaceOf(doc, inst)` in `worlds3d-lib-world.js`) is useful to other generator workstreams.
