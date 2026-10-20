# Kernel requests from the generate2d workstream

Each request lists the workaround the generate2d primitives use today (`v2/primitives/engine/generate2d-lib.js`).

## 1. Normalize generator configs in preflight

`preflight()` returns `with` normalized (defaults applied) for spaces, systems and graphics, but `spaces[].generators[]` keep their raw `with`. KERNEL_API §1 says install receives a complete config.

- **Workaround:** every generator calls `withDefaults(card, with)` in `install` and `validate`. It feeds defaults back through `checkFields` so nested defaults (list items, object fields) apply too.
- **Request:** normalize generator instances in the preflight output, and apply nested defaults when a list or object param falls back to its `default`. Today `checkParam` returns `structuredClone(default)` without checking its items.

## 2. Zones created at runtime

Spaces from spaces2d implement `api.addZone(zone, rt)`. The graph space and the test space don't.

- **Workaround:** `addZones()` calls `api.addZone` when the space has it. Otherwise it replaces `rt.doc` with a copy whose space has the zones appended, and re-applies that copy on `content_added`, because `rt.extend` swaps in the planner's document.
- **Requests:**
  - a kernel `rt.addZone(spaceId, zone)` (or `addZone` on every position space, including graph) so no primitive rewrites `rt.doc`;
  - preflight declaration of computed zone ids. `card.defines {kind:'zone', in}` only covers ids already listed in `with`, which is fine for overworld areas. Maze houses, board deploy/base/start zones and graph-world nodes can't be referenced from predicates at preflight.

## 3. `rt.extend` skips generator instances

`rt.extend` calls `extend()` on spaces, systems and graphics, but never on `spaces[].generators[]`.

- **Workaround:** none needed yet. Generators cache nothing outside `rt.store`, and the zone copy is re-applied on `content_added`.
- **Request:** include generators, so a generator can react to new zones or rooms added by a hot-load patch. That would allow a "generate the new region" step.

## 4. Edit-log-free baseline writes on the test space

`testSpace` has no `bake`, so generation writes go through `setCell`. Every one appends to the edit log and emits `cell_changed`: about 600 entries for a classic maze and about 6,000 for a vast one.

- **Workaround:** `cellWriter()` uses `bake` when the space has it. spaces2d spaces also treat `setCell` calls made before `game_start` as baseline.
- **Request:** give `testSpace` `bake(cells, rt)` (or the same pre-`game_start` baseline rule), so tests see the production behaviour.

## 5. Block properties on the test space

`testSpace` treats every non-null cell as solid.

- **Workaround:** generators keep walkable roles empty by default (overworld grass, doors, mats; maze house interiors) and record them in their services. Rooms prove one-way rungs with their own movement model.
- **Request (optional):** let `testSpace` read `content.blocks` `solid`/`tags`, so generator proofs can be cross-checked against it as they already are against `engine.space.tilemap` and `engine.space.grid`.

## 6. Vocabulary ownership lookup (resolved)

Resolved by `rt.canRun`, `rt.canTest` and `rt.has` (cbc7e2d8). `vocabulary()` now delegates to them, and falls back to `logic.owners` on older kernels.
