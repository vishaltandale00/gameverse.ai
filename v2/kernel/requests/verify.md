# Kernel requests from the verification layer (v2/verify)

Each request lists the workaround already in `v2/verify`, so nothing is blocked.

1. **`canReach` signature** (resolved by kernel update b13218bd: `reachable(from, rt, opts)` and `canReach(a, b, rt, opts)` with `opts = {abilities, envelope, who}`). The verifier passes `abilities` as `{id: true}`, the merged movement `envelope`, `who`, and the body `width`/`height`. It still only calls `reachable`, because graph and testSpace keep their older `canReach` forms.

2. **What `reachable` returns** (partly resolved: tilemap and grid return `'x,y'` keys, `zoneAt` accepts them, and both expose `cellOf`). Still open: write the member forms and `cellOf(entity)` into KERNEL_API §3 so every space follows them. testSpace returns `'x,y,z'` keys and its `zoneAt` does not accept keys. Workaround: `util.memberOf` accepts every form, and keys go to `zoneAt` only when the space has `cellOf`.

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

8. **Space bounds** (resolved for the 2D spaces, which expose `bounds() → {min, max, wrap}`). Request: add the `bounds` capability to KERNEL_API §3 for every finite space, including the 3D ones. The verifier reads `bounds()` first, then `size`.

9. **Snapshot cost of edit logs.** `testSpace` keeps every `setCell` in `state.spaces[id].log`, so snapshots grow without bound during long board searches. Placement search snapshots the state dozens of times per piece. Request: a compaction rule for edit logs (for example a base grid plus a log since the last checkpoint), or a documented cap. Workaround: none. Long runs just get slower.
10. **Macro options for continuous spaces.** No continuous space offers "travel to zone" options. Workaround: `v2/verify/macros.js` adds `travel <zone>` options through `rt.options`, planned with the space's `path` under the current abilities and envelope.
    - `warp` mode follows the path waypoint by waypoint.
    - `steer` mode holds the real controls, using the move axes and a jump verb it finds by probing.
    - The solver uses `auto` mode, which steers whenever inputs move the player. The playtest always steers.

    Request: let movement primitives export their own `travel(rt, path)`, so steering follows each controller's real verbs instead of a generic heuristic. `track` has no `path` or `reachable`, so spatial checks there report `spatial_unsupported` and rely on the beam prover.
