# Kernel requests from the verification layer (v2/verify)

Each request lists the workaround already in `v2/verify`, so nothing is blocked.

1. **`canReach` signature differs between spaces.** `engine.space.graph` takes `(a, b, rt)`, `testSpace` takes `(a, b)`, and the catalog says `(a, b, abilities?)`. Request: freeze it as `canReach(a, b, rt, {abilities, envelope})`, matching `reachable`. Workaround: the verifier calls only `reachable` and tests membership itself.

2. **What `reachable` returns.** The catalog says `Set<Cell|ZoneId>`. `testSpace` returns `'x,y,z'` key strings, and the 2D spaces return `'x,y'` keys. Request: document the members as zone ids or `'x,y[,z]'` cell keys, and add `cellOf(entity) → key` to the `position` capability (spaces2d already exposes it), because an entity's floor(at) is not always its standing cell. Workaround: `util.memberOf` accepts all three forms, and the verifier uses `api.cellOf?.(e)` when it exists.

3. **`reachable` options in testSpace.** `testSpace.reachable` ignores `{abilities, envelope}`. Request: let it honour an optional `envelope.blocked(cell)` or similar, so ability-gated reachability can be tested without a fixture space. Workaround: tests wrap testSpace in a fixture space (`engine.space.fixture-ledge`).

4. **Option identity.** Solvers replay paths by option label. Request: KERNEL_API §2 should require labels that are unique within one state. Also document `rt.availableOptions()`: it exists in world.js but is missing from the table. Workaround: duplicate labels get `#n` suffixes (`drive.optionLabels`).

5. **RNG shape for chance sampling.** Expectimax and greedy sample chance by setting `state.rng` on a snapshot. Request: document `state.rng` as a single uint32 seed advanced only by `rt.random()`, so verifiers may reseed snapshots. Workaround: the verifier relies on the current mulberry32 state in rng.js.

6. **Component fields the verifier reads.** Request: the catalog should fix these field names:
   - `health.hp` and `health.max`;
   - `body.vel` and `body.size`;
   - a vulnerability flag in `status`, such as `frightened` or `vulnerable`;
   - `collectible` / `pickup` and `interact` as markers.

   Workaround: `drive.js` reads `hp | current | value` and treats `status` as either an object or a list.

7. **Continuous verbs.** Aim/power search needs the parameter ranges of continuous verbs. Request: add `card.actionSpace = { verb: { param: { min, max } } }` to KERNEL_API §1. Workaround: the verifier already reads it, and only `strategies/aim.js` depends on it.

8. **Space bounds.** The random-policy escape check needs bounds. Request: spaces with finite extent should expose `size` (cells) or `bounds: [min, max]` on their API. Workaround: the verifier uses `api.size`, then `api.bounds`, and otherwise skips the escape check.

9. **Snapshot cost of edit logs.** `testSpace` keeps every `setCell` in `state.spaces[id].log`, so snapshots grow without bound during long board searches. Placement search snapshots the state dozens of times per piece. Request: a compaction rule for edit logs (for example a base grid plus a log since the last checkpoint), or a documented cap. Workaround: none. Long runs just get slower.
