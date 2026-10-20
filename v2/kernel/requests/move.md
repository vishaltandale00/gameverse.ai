# Kernel requests from the move workstream

Each request lists the workaround already in place in `v2/primitives/gameplay/move-*.js`.

1. **Collision independent of gravity.** `slide`/`grounded` belong to the `gravity` capability, but top-down tilemap and arena2d (gravity 0) also expose `slide`. Movement cards cannot declare "needs collide-and-slide" without also requiring gravity.
   - Request: a `collide` (or `kinematics`) capability = `slide grounded`, reported by every continuous space whatever its gravity.
   - Workaround: walk, swim, fly, dodge, climb, ship and lanes require only `position`. They probe `typeof api.slide`, then fall back to axis-separated `getCell` collision, then to plain `setPos`. Cards list the soft needs under `card.optional.capabilities`, a field the kernel ignores.

2. **`card.optional`.** Document an optional-capabilities field so the planner and preflight can show soft requirements (better with X) without failing.

3. **Press edges.** `rt.input` has `actions` and `held`, but no "pressed this frame" that is robust to hosts that repeat `actions` while a key is held.
   - Workaround: move keeps the previous frame's down verbs in `components.move.held`, written by one shared `late` system. `pressed = actions[v] && !prevHeld.has(v)`.
   - A kernel-level `input.pressed` would let every primitive agree.

4. **`path` to a zone id.** tilemap, grid and arena2d accept a zone id as `path(from, to, opts)`'s target; `engine.space.test` does not.
   - Request: freeze `to: At | zoneId` in §3 and support it in the test space.
   - Workaround: move passes a zone id only when `api.zones?.has(zone)`; otherwise it plans to a free cell inside the zone shape (`zoneAnchor`).

5. **Test space blocks.** Every non-null cell in `engine.space.test` is solid, and it has no `tagsAt`. Liquids, ladders and updrafts can therefore only be tested there through zone tags.
   - Request: honour `content.blocks[].solid === false` in its slide, and expose `tagsAt` / `collisionOf` like tilemap.

6. **Per-step scratch.** Movement memoises intents and control reads per frame. It keys `rt.caches.moveFrame` by `state.frame` plus the `state.prim` object identity so that `restore()` invalidates it. An official per-step scratch (`rt.frame` cache cleared by `step()` and `restore()`) would make this pattern safe for everyone.

7. **I-frames and health.** The frozen `health.invulnerable` (seconds left) is owned by combat.health.
   - Dodge, dash, ledge grab and hyperspace publish `components.move.invulnerableFrom/Until` (state time) and `body.iframes` (bool).
   - Request: combat.health ignores damage while `body.iframes` is true. This is a coordination rule, not kernel code; recording it here so it lands in the catalog.

8. **Envelope fields.** Freeze the movement envelope names that spaces read (tilemap nav: `jumpHeight`, `jumpGap`/`jumpDistance`, `doubleJump`, `dash`, `climb`, `wallJump`, `swim`, `fly`, `dropThrough`). Also freeze that ability-gated values are computed from movement grant names (the verifier now expands `grants`).
   - move.* also reports `run`, `mode`, `reachHeight`, `reachGap`, `glideRatio`, `climbSpeed`, `swimSpeed`, `flyRange`, `grapple` and `oneWay`.
