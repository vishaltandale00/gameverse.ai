# Kernel requests from the pipeline workstream

Each request names the workaround the planner (`v2/planner/*`) uses today.

## 1. Vocabulary owners in preflight (done: `vocabulary_owner_missing`, kernel cbc7e2d8)

The logic vocabulary is built from the whole catalogue, so a document that uses `give_item` or `{ "item": ... }` without `gameplay.inventory` in `systems[]` passes preflight; the effect then runs without its primitive's `install` (caches, starting inventory).

- **Now:** repair adds `{use: owner}` from the hint. The earlier workaround, `planner/repair.js` `missingOwners()`, walks effects and predicates (under `when gate if requires fail condition unless not`) and adds the owning primitive (`select.js` `vocabIndex()`); it stays as a fallback.
- **Request:** preflight reports `vocabulary_owner_missing` (with the owner id in the hint) when a used predicate/effect kind's owner is not in the document.

## 2. Zone shape in space cards

The planner writes zones for whichever space it selects. Spaces now describe their zone shape in `card.zones` as prose ("Zone = {id, rect:[x0,y0,x1,y1)...}"), and `engine.space.graph` has none.

- **Workaround:** `outline.js` `zoneShape()` reads `card.zones` for `exits`, `rect`, `range`, `bounds`, `slot`; without it, capabilities decide. Zones are laid out across the space's `size`/`bounds` default.
- **Request:** a machine-readable `card.zoneFields` (a param-schema map, like `params`) on every space, checked by preflight, so planners and repair use the same schema.

## 3. `mergePatch` cannot extend existing zones

A detail patch can add zones, generators and content, but not add an exit (or tags, rules) to an existing zone: an existing zone id in a patch is appended as a duplicate.

- **Workaround:** the outline creates the whole zone graph; detail patches add content inside zones only (`detail.js` `sanitizePatch`).
- **Request:** `mergePatch` merges `exits` (and other list fields) of a zone whose id already exists, and reports `added.exits`.

## 4. `rt.extend` does not install generators appended to existing spaces

`extend` installs generators only for new spaces.

- **Workaround:** detail patches may append generators, but they take effect on the next load (the studio rebuilds the world for non-additive versions).
- **Request:** install generators that `mergePatch` appended to existing spaces (`added.generators`).

## 5. Player agency is not declared

Only `engine.space.graph` gives the player a way to travel (its `go` action and options), and nothing on the card says so; continuous spaces need a movement primitive. The planner cannot tell from cards whether a composed document lets the player act.

- **Workaround:** `outline.js` `ensureAgency()` boots the procedural skeleton headless and requires `rt.availableOptions().length > 0`; otherwise it re-selects the space, and reports a `player_agency` gap when nothing works.
- **Request:** cards declare the actions their `install` registers (`provides.actions`, already used by plot primitives) including spaces (`go` on graph), and movement primitives declare which spaces' travel they provide (`provides.travel: ['engine.space.tilemap', ...]` or a `travel` capability).

## 6. Experiment primitives and wall-clock limits

Primitive experiments (`v2/experiments/primitive-host.js`) run model-written code in `node:vm` with per-call time limits. A call that exceeds its limit under heavy machine load disables the experiment, so verification of an experiment is not fully independent of the machine.

- **Workaround:** budgets match the kit experiments' (25 ms per call, 5 ms average step); the gate reports `disabled` with the reason.
- **Request:** none for the kernel; noted so verification owners know an experiment's verdict can differ under extreme load.

## 7. Data schemas for the sections a primitive reads

Cards describe `params`, not the document data they read (`plot.dialogue`, `plot.quests`, `content.items`...). Models writing outlines and detail patches got those shapes wrong in live runs (`dialogue_node_unknown`, `objective_kind_unknown`, `field_unknown`, validators throwing on shapes).

- **Workaround:** `catalog.js` `dataShapes()` parses PRIMITIVE_CATALOG.md §4.1, §4.2 and §8 and puts the shapes of the sections the chosen primitives read into outline, detail and revision prompts; repair drops dangling `*_unknown` fields.
- **Request:** `card.data: { "<section path>": <param-schema> }` on primitives that own a section, checked by preflight like `params`, so prompts, repair and validation share one schema.
