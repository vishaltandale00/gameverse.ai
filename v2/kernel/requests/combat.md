# Kernel requests from the combat workstream

Each request has the workaround the combat primitives use today, so nothing is blocked.

## 1. Event data must not override the event name

`rt.emit(name, data)` pushes `{ name, ...data }` and passes the same object to `'*'` handlers. A `name` field in the data (a boss or power-up display name, for example) replaces the event name for `'*'` listeners and in `state.events`. `counts` stays correct.

- **Workaround:** combat events carry display names as `title`, never `name`.
- **Request:** build the record as `{ ...data, name }`, or reject a reserved `name` key.

## 2. Nested defaults in list params

`checkParam` returns `structuredClone(schema.default)` for a missing value without normalizing it through `schema.of`. A default list of objects therefore skips its fields' defaults. `gameplay.combat.stealth`'s default `noise` list had no `amount`.

- **Workaround:** defaults are written out in full, and use sites fall back with `??`.
- **Request:** normalize defaults through the schema the same way as supplied values.

## 3. A shared stat accessor

Statuses, equipment and progression all modify the same stats (`stat.move`, `stat.damage`, `stat.fire_resist`, `hp.max`, `res.<pool>.max`...). Vars only exist for the player. Combat resolves a stat as:

```
vars[key] (player, stat.* only) + components.stats[key] + active status modifiers
```

in `combat-lib.js` `statOf`. Movement primitives that read only `vars['stat.move']` miss status modifiers such as `frozen`'s `stat.move: -1`.

- **Workaround:** `gameplay.combat.status` provides the service `stats.get(entity, key)`.
- **Request:** freeze `stats.get(entity, key)` as the shared accessor, or document `components.stats` plus a modifier hook in KERNEL_API §2.

## 4. Teams

`friendlyFire`, target selection, stealth watchers, bombs and projectile hits all need "is A hostile to B". There is no frozen field for this.

- **Workaround:** combat reads `components.health.team`, then `components.faction` (a string or `{id}`), then `player`, then the archetype `kind` (`enemy`/`boss` mean the `enemy` team). `neutral` can be hit by anyone.
- **Request:** freeze a team/faction field in the shared component table.

## 5. Runtime body boxes

`bodyBox(entity, api)` lives in `kernel/testing.js`. Importing it at runtime also loads `compile` and the test space.

- **Workaround:** `combat-lib.js` imports it from `testing.js`, as KERNEL_API §3 allows.
- **Request:** move `bodyBox` (and `CAPABILITY_METHODS`) to a small runtime module such as `kernel/space.js`, and re-export it from `testing.js`.

## 6. Time scale

Slow motion (`gameplay.combat.aim`, power-ups, near-miss slow-mo) and hit-stop need a shared time scale. Nothing in the kernel reads one.

- **Workaround:** these primitives write var `time.scale`, which renderers and movement primitives may honour. Hit-stop is per entity (`components.melee.hitstop`, frames), and the fixed step never changes.
- **Request:** document `time.scale` as the convention, or add `rt.timeScale` so integrators can scale `dt`.

## 7. Box sets outside arena2d

Melee uses authored per-pose hit/hurt boxes when a space has the `boxes` capability (arena2d). Other spaces fall back to shapes built from move frame data (`box` or `reach` + `arc`), tested against body boxes through `overlap`.

- **Request:** add `boxes` (`boxesOf`, `setPose`, `setBoxes`, `boxHits`) to the 3D spaces, mirrored by facing yaw, so 3D brawlers get per-limb hurt boxes too.
