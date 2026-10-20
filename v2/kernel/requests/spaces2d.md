# Kernel requests from the spaces2d workstream

Each request has the workaround the spaces2d primitives use today.

## 1. Pass the instance to `validate`

`validate(config, doc, ctx)` doesn't say which instance is being validated, so a space can't find its own zones. That matters for zone rects outside the map, hex wrap parity and so on.

- **Workaround:** each space validates the zones of every document space whose raw `with` matches the normalized config (`sameConfig`). Two spaces of the same kind with identical `with` would report each zone error twice.
- **Request:** call `validate(config, doc, ctx, { path, id, use })`.

## 2. Spaces outside the frozen capability list

KERNEL_API §3 allows new capabilities, documented under `provides.capabilityMethods`. `spaceConformance` only checks `CAPABILITY_METHODS`, so new capabilities go unverified. spaces2d adds `bounds`, `wrap`, `dynamics`, `joints`, `boxes`, `ledges`, `scroll`, `settle` and `cellRules`.

- **Workaround:** `tests/v2-p-spaces2d-capabilities.test.js` checks them.
- **Request:** have `spaceConformance` also read the registered card's `provides.capabilityMethods`. The shared vocabularies can then be lifted into `CAPABILITY_METHODS`, so every workstream sees the same names:
  - `bounds: [bounds, inBounds]`
  - `wrap: [wrapPos, delta]`
  - `dynamics: [impulse, velocity, setVelocity]`

## 3. Body anchor convention

`engine.space.test` anchors a body's box at its min corner. The continuous spaces2d spaces (tilemap, arena2d, physics2d, track) anchor at the box centre. The centre is needed by rotation in physics2d, and by mirrored box sets and symmetric zones.

- **Workaround:** every spaces2d API exposes `api.anchor`: `'center'`, `'cell'` (grid) or `'slot'` (none). Movement, puzzle and items workstreams read `api.anchor ?? 'min'`.
- **Request:** document `anchor` in KERNEL_API §3 and set `anchor: 'min'` on `testSpace`.

## 4. `canReach` signature

The signature differs between implementations:

| Implementation | Signature |
| --- | --- |
| graph | `(a, b, rt)` |
| testSpace | `(a, b)` |
| catalog | `(a, b, abilities)` |

- **Workaround:** spaces2d accepts both `(a, b, rt, opts)` and `(a, b, opts)` by checking for `.state`. The spatial verifier uses only `reachable(from, rt, {abilities, envelope})` plus `zoneAt(member)`. spaces2d `zoneAt` accepts `'x,y'` keys as well as At values.
- **Request:** standardize on `canReach(a, b, rt, opts)` and `reachable(from, rt, opts)`, where `opts = {abilities, envelope, who, ...}`.

## 5. Zones added at runtime

Generators add zones with `api.addZone(zone, rt)`. Those zones persist in `rt.state.spaces[id].zones` and are merged with the document's zones; on an id clash the document wins. Preflight can't see them, so `{zone: '<generated>'}` predicates fail `ref_unknown`.

- **Request:** let a generator declare the zone ids it will create, for example `card.defines: [{kind: 'zone', in: 'zones'}]` read from its `with`. This already works for generators that list their zones in `with`. Alternatively, the planner can write the generated zones back into the document.

## 6. Grid `cell` predicate

The kernel `cell` predicate calls `rt.space(p.space).getCell(p.cell)`, which needs an explicit `space` and doesn't take a layer.

- **Workaround:** none. The grid and tilemap `getCell(at, layer?)` treat a missing layer as the space's default layer.
- **Request:** default `p.space` to the subject's space and pass `p.layer`.
