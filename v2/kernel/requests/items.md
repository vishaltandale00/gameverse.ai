# Kernel requests from the items workstream

## 1. tests/v2-kernel.test.js registers a stub with a real primitive id

`preflight catches unknown primitives, references, capabilities and vocabulary` builds
`catalogue([needsCells])` with a stub whose id is `gameplay.blocks.mine`. The items workstream now
registers the real `gameplay.blocks.mine` (catalog §6.2), so `Registry.add` throws
`duplicate primitive 'gameplay.blocks.mine'`.

Fix (either):
- use the real primitive: `const c = catalogue();`. It requires `editCells` and `raycast`, so on the graph
  space it still yields `capability_missing`, and the hint still names `navigate`;
- or rename the stub, e.g. `gameplay.test.needs-cells`.

Workaround: none inside items files (the catalog id is fixed). Only that one kernel test fails.

## 2. `validate()` cannot point errors at its own instance's `with` fields

`validate(config, doc, ctx)` gets no instance path. An error returned without `path` lands on the
instance path (`systems[i]`), which is useful. One that names a field (`with.skipTo`) has no absolute
prefix. Items validators therefore omit `path` and put the field name in `message`.

Request: pass the instance path as `ctx.path` (or `ctx.instancePath`) to `validate`, so that cards can
emit `${ctx.path}.with.<field>`.

## 3. Shared event names other workstreams should emit or consume

These are not kernel changes, but they need one meaning everywhere:
- `respawn_enemies {reason}`: emitted by gameplay.rest and gameplay.checkpoint; spawners reset ambient
  enemies.
- `tool_used {who, item}` / `weapon_used {who, item}`: wear equipment durability (gameplay.equipment
  `wear` rules). Combat should emit `weapon_used` when a weapon swing lands.
- `died` / `defeated` with `{id | target | who}` naming the dead entity and optional `by`: gameplay.loot
  drops the entity's `loot` table. Please settle which field names the victim. Loot accepts
  `id ?? target ?? who`.
- `out_of_bounds {who}` / `scrolled_out {who}` from arena spaces: gameplay.hazard treats them as
  `killType`.
- `hit` / `projectile_hit` with `{target, at?}`: gameplay.mechanism counts breakable hits on mechanism
  entities and erodes cell bunkers at `at`.
