> **Legacy reference.** Kits are the earlier generation. They are not called from the live path and these documents are not instructions; see `v2/ARCHITECTURE.md`. Port their depth (constants, frame data, bots, generators) into primitives.

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
  // reads
  active, player, enemies, blocked, wrap?, lives?,
  level?(state) -> n                                   // the current level/stage index; mods restart per level
  size?(state) -> { w, h, cell?, gravity? }            // capability 'grid': a tile grid (see below)
  // operations
  spawn?(state, { x?, y?, kind?, hp?, required? }) -> id | null   // capability 'spawn'
  setBlocked?(state, x, y, on) -> bool                 // capability 'terrain': tile x, y solid or empty
  addScore?(state, n)                                  // capability 'score'
  hurtPlayer?(state, { by }) -> bool                   // capability 'hurt': costs a life/health per the genre
  invulnerable?(state, frames)                         // capability 'invulnerable': the player can't be hurt for a while
  end?(state, { won, reason })                         // capability 'end': finish the run now
  defeat(state, id, { by }), stun?(state, id, frames)  // existing
}
```

Kits declare these through `world.capabilities`: `'grid'`, `'spawn'`, `'boss'`, `'terrain'`,
`'score'`, `'hurt'`, `'invulnerable'` and `'end'`. When what a world can do depends on the content
(a breakout level has a brick grid, a pinball table doesn't; a runner's lanes mode spawns barriers,
its flap mode doesn't), the kit also gives `world.capabilitiesFor(content)`; `composeGame` then runs
only the mods that content can host, while the schema offers everything the kit can ever do.

- **spawn** adds an enemy or target of the genre's own kind. Without `x, y` the kit picks its
  natural entry point (a hunter released from the house, a brick in a free cell, a gunship flying
  in from the top, a barrier ahead of the runner). `hp` counts standard hits (about one ball hit or
  one clean shot); a kit may scale it to its own damage. `kind: 'boss'` (capability `'boss'`) asks
  for one big, tough enemy that the genre's own attacks hurt. `required: true` holds the level
  clear while it lives. It returns null when there is no room; mods try again later. Each `defeat`
  of a spawned enemy with hp left costs it one hit. Enemies report `kind`, `hp` and `maxHp` for
  spawned ones.
- **setBlocked** takes tile coordinates and refuses (returns false) what would break the kit:
  the border, houses and doors, tiles the player or an enemy stands near. New walls crush pellets
  under them. Mods must still keep the level winnable (the falling mod flood-fills first).
- **invulnerable**: the genre decides what it stops (a hunter bounces off, a lost ball bounces back
  from the bottom, a crash is ignored) and emits `shielded` when it saves the player.
- **size** describes a grid. Without `cell`, tiles are the world units (tile 3, 4 is centred at
  3, 4). With `cell: { x0, y0, w, h }`, tile (i, j) covers `[x0 + i·w, x0 + (i+1)·w] ×
  [y0 + j·h, y0 + (j+1)·h]` in world units (breakout bricks are 1 × 0.5). `gravity` is the way
  things stack: 1 (down, the default) or -1 (breakout pieces rise against the wall).
  `tileCenter`/`tileAt` in `mods/fx.js` convert.

What each kit honors today:

| Kit | Operations | Notes |
| --- | --- | --- |
| maze | grid, terrain, spawn, boss, score, hurt, invulnerable, end, stun | spawned hunters leave the house; a boss hunter is big and slower |
| physics | score, hurt, end; breakout also grid, spawn, boss, invulnerable | spawned bricks count toward the clear; the boss is the breakout boss block |
| runner | score, hurt, end; invulnerable (not rhythm-dash); spawn in lanes and climb | no levels: per-level mods run per run |
| shmup | spawn, boss, score, hurt, invulnerable, end | units are 20 px tiles; both buttons are the kit's |
| fighting | score, hurt, invulnerable, end, stun | both buttons are the kit's |

A **snapshot** is the plain-JSON view a sandbox gets each step:

```js
{
  frame, active, level,
  size: { w, h, cell?, gravity? },
  player: { x, y, facing },
  enemies: [{ id, name, x, y, radius, hittable, kind?, hp?, maxHp? }],
  blocked: { w, h, bits },  // bits: row-major string of '0'/'1' per tile when the kit has a grid; otherwise null
  lives,
  events: [{ name, ... }],  // this step's events
}
```

An **operation** returned by a sandbox is one of:
- `{ op: 'spawn', x?, y?, kind?, hp?, required? }`
- `{ op: 'setBlocked', x, y, on }`
- `{ op: 'score', n }`
- `{ op: 'hurt', by }`
- `{ op: 'invulnerable', frames }`
- `{ op: 'end', won, reason }`
- `{ op: 'defeat', id }`
- `{ op: 'stun', id, frames }`
- `{ op: 'emit', name, data }`

The host applies an operation only if the kit declares the matching capability; anything else is
dropped and counted in the report.

## Native mods (tier 2)

`v2/kits/mods/` holds the mechanics written against these operations. Each mod has a strict schema
fragment that is off by default, a `summary` the content model reads, `normalize`, `requires`
(capabilities; a list inside means any one of them) and `button` (true, false, or a function of its
config). It draws in world units through `render.view`, with a HUD badge in its own slot.

| Mod | Requires | Runs on |
| --- | --- | --- |
| weapon | player, enemies, blocked, defeat + a free button | maze, physics, runner |
| falling | player, blocked, grid, terrain or spawn | maze (new walls), breakout (new bricks) |
| waves | enemies, spawn | maze, breakout, shmup, runner (lanes, climb) |
| boss | enemies, spawn, boss, defeat | maze, breakout, shmup |
| timer | score, end | maze, physics, runner, shmup, fighting |
| shield | player, invulnerable + a free button | maze, breakout, runner |
| zones | player, score | maze, physics, runner, shmup, fighting |

Mods keep their randomness in their own state (`seedFrom`/`random` from `v2/kernel/rng.js`, seeded
from the game seed), never `Math.random`. Events a mod emits that carry positions use the mod's own
names (`piece_land`, `boss_hit`, `shield_up`), because kit renderers read shared events like `hit`
in their own units.

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
