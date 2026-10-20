# Extending games beyond their kit

A request a kit can't express, like "add a Tetris mechanic to Breakout", has three ways forward,
and the studio offers them as buttons instead of a dead end:

| Tier | What | Speed | Guarantee |
| --- | --- | --- | --- |
| 2. Mods | Native cross-genre mechanics in `v2/kits/mods/`, written once against the world adapter | instant | tested, deterministic |
| 3. Experiments | Model-written code for this one game, run sandboxed | seconds | checked headless; labelled "Experimental — not play-tested" |
| 4. Promotion | A coding agent turns a good experiment into a native mod (or kit) with tests | minutes, in the background | full tests and kit verification |

All three act on a game through the **same world operations**. Native mods call them directly,
while experiments return them as data from a sandbox.

## World snapshot and operations

These extend the adapter in `KIT_CONTRACT.md`. Each operation is optional and declared as a
capability; mods and experiments are offered only what a kit declares.

```js
adapter(game) -> {
  // reads (existing)
  active, player, enemies, blocked, wrap?, lives?, size?(state) -> { w, h },
  // operations (new)
  spawn?(state, { x, y, kind?, hp? }) -> id          // capability 'spawn': add an enemy or target at x, y
  setBlocked?(state, x, y, on)                         // capability 'terrain': make a tile solid or empty
  addScore?(state, n)                                  // capability 'score'
  hurtPlayer?(state, { by })                           // capability 'hurt': costs a life/health per the genre
  defeat(state, id, { by }), stun?(state, id, frames)  // existing
}
```

Kits declare these through `world.capabilities`: `'spawn'`, `'terrain'`, `'score'` and `'hurt'`.

A **snapshot** is the plain-JSON view a sandbox gets each step:

```js
{
  frame, active,
  size: { w, h },
  player: { x, y, facing },
  enemies: [{ id, name, x, y, radius, hittable }],
  blocked: { w, h, bits },  // bits: row-major string of '0'/'1' when the kit has a grid; otherwise null
  lives,
  events: [{ name, ... }],  // this step's events
}
```

An **operation** returned by a sandbox is one of:
- `{ op: 'spawn', x, y, kind?, hp? }`
- `{ op: 'setBlocked', x, y, on }`
- `{ op: 'score', n }`
- `{ op: 'hurt', by }`
- `{ op: 'defeat', id }`
- `{ op: 'stun', id, frames }`
- `{ op: 'emit', name, data }`

The host applies an operation only if the kit declares the matching capability; anything else is
dropped and counted in the report.

## Experiment code (tier 3)

An experiment is an ES module, written by the code model, that default-exports:

```js
{
  label: 'Falling bricks',               // shown in controls and the HUD
  button: false,                         // true: wants a free button (a or b), like a mod
  init(snapshot, rng) -> state,          // rng() returns [0, 1); no Math.random, Date or performance
  step(state, { snapshot, input: { x, y, held, pressed } }) -> { state, ops: [] },
  draw(state, snapshot) -> [             // display list in world units; the host maps it with render.view
    { t: 'rect', x, y, w, h, color, alpha? },
    { t: 'circle', x, y, r, color, alpha? },
    { t: 'line', x1, y1, x2, y2, color, width? },
    { t: 'poly', points: [[x, y], …], color, alpha? },
    { t: 'text', x, y, text, color, size? },
  ],
}
```

Experiment state is plain JSON.
- **In the browser**, the module runs in a Worker with no network, no DOM and no timers. Each step
  the host posts the snapshot and input, and applies the operations that come back. The result
  lags the game by one frame; that's acceptable because experiments are labelled.
- **On the server**, the same code is checked headless with `node:vm` under a time limit. It must
  load, run 600 steps against real snapshots from the game without throwing, and return
  well-formed operations and draws.

Stored on the game version: `doc.experiments = [{ schema: 'gameverse.v2.experiment/0.1', id, label, request, code, check }]`.

## Promotion (tier 4)

`promote(experiment, { kit, gameId })` starts a background job. A coding agent works in a
disposable git worktree:
- **locally**, the Claude Code CLI;
- **hosted**, the Daytona runner in `infra/cloudflare`.

The agent writes a native mod in `v2/kits/mods/` (or kit changes) with tests. The job runs the mod
tests, the kit contract test and the kit's verify. The result is a branch, a report and a diff; it
is never applied without the player's confirmation. Failed and cancelled jobs keep their logs.
