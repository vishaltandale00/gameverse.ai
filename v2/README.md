# Gameverse v2: idea to playable game in seconds

v2 builds free-form JavaScript games from a player's request. It doesn't depend on the GBA. The v1
app (FireRed, the overworld, sports) and the GBA reverse-engineering work stay as they are, for
Vishal and for later exploration ([v3 handoff](../plans/V3_GBA_LAYER_HANDOFF.md) on the RE branch).

## How a request becomes a game

```
request ──► retrieve module cards ──► spec writer (Sonnet) ──► preflight ──► compose ──► play
  text/voice      (ms, local)           JSON game spec         (≈1 ms)     (≈ms)    first frame
                                              ▲                     │
                                              └── repair with error codes + hints (one round)
                                                                    │
                                    headless playtest in a worker ◄─┘ (≤1.5 s): winnable?
                                    trivially won? instant loss? runtime/invariant errors?
                                    unused mechanics? ──► report + automatic repair
ideas the library can't express ──► background module job (Opus): new module + card + tests,
                                    gated by preflight and playtest, then hot-swapped into the game
```

**Latency budget** (targets, not yet measured end to end):

| Step | Target |
| --- | --- |
| Spec written | ≤ 3–5 s |
| Preflight | ≤ 10 ms |
| First frame after the spec | ≤ 100 ms |
| Playtest report | ≤ 1.5 s |
| Tweaks ("floatier jump", "more enemies") | under 1 s, as tunable or level patches with no new code |

**Model routing**

| Model | Used for |
| --- | --- |
| Haiku | Exploration, intent classification, quick tweak patches |
| Sonnet | Writing and repairing game specs |
| Opus | Writing and running new module code |

## Contracts

### Game spec (`gameverse.v2.game-spec/0.1`)

JSON, compact enough for a model to write in one shot:
- `level.rows`: ASCII rows. `.` is empty space and every other character must be in `level.legend`.
- `level.legend`: maps a character to an entity kind.
- `entities`: per kind:
  - `solid: true` makes the kind static tiles;
  - otherwise it's an entity with `tags`, `glyph` (emoji), `color`, and `w`/`h` in tiles.
- `modules`: an ordered list of `{ use, with }` mechanics with tunables.
- `win` and `lose`: predicates over vars and event counts, for example
  `{ "var": "remaining", "lte": 0 }`, `{ "count": "reach_goal", "gte": 1 }`, or `{ "all"|"any": [...] }`.
- Exactly one entity is tagged `player`.
- Units are tiles and seconds.

[`engine/spec.js`](engine/spec.js) `preflight(spec, registry)` validates in about 1 ms and fills tunable
defaults. It returns errors with stable codes, a path and a fix hint:
- `unknown_module`
- `tunable_range`
- `unknown_tunable`
- `legend_missing`
- `kind_missing`
- `player_count`
- `requires_unmet`
- `module_conflict`
- `predicate_unknown_var` / `predicate_unknown_event`
- `level_size`
- `budget`
- `schema`

### Mechanic modules and cards

A module ([`modules/`](modules/)) is a plain object `{ id, card, init?, step?, on? }`.

The card is the model-facing description:
- `intent`;
- `phase` (`input`, `motion`, `interaction` or `rules`);
- `tunables` with default, range, unit and effect;
- `provides` (vars and events);
- `requires` (tags);
- `conflicts`.

Modules talk through events (`api.emit('hurt', …)`, handled in `on: { hurt }`) and shared `state.vars`. They
keep their own data in `state.modules.<id>` or `entity.data`, always plain JSON.

There are nine modules so far: `platformer`, `topdown`, `collect`, `hazard`, `health`, `patrol`, `goal`, `timer` and
`shooter`.

### Game definition

[`engine/compose.js`](engine/compose.js) `compose(spec, registry)` returns:
- `createState(seed)`;
- `step(state, input)`, a fixed 1/60 s step;
- `check(state)`;
- `snapshot(state)`.

State is plain JSON with a seeded RNG inside it, so every game is deterministic, cloneable and replayable.
Input is `{ x, y, a, b }`; the engine derives `aPressed`/`bPressed`. This is the same pure-state
`createState`/`step`/`validateState` shape as v1's sports games.

### Playtest

[`engine/playtest.js`](engine/playtest.js) `playtest(game, { budgetMs })` runs a Go-Explore-style search over
JSON snapshots. Cells are the player's tile plus coarse progress, and promising, rarely visited cells
are favoured. It reports:
- `winnable`, with the winning input path, replayed to confirm determinism;
- the idle outcome;
- places explored, frames simulated and the speedup over real time;
- losses and events fired;
- issues: `runtime_error`, `invariant_violation`, `trivially_won`, `instant_loss`, `nondeterministic`,
  `goal_not_reached` (a warning) and `mechanic_unused` (a warning).

The coin-cavern example is proven winnable in about 0.2 s, at more than 5,000× real time.

```bash
node v2/tools/playtest.mjs v2/examples/coin-cavern.json
```

### Rendering

[`engine/render2d.js`](engine/render2d.js) `createRenderer(game)` returns `render(ctx, state)`. It draws on a 2D
canvas with a follow camera, tiles, emoji or shape entities, a HUD from the vars, and win/lose banners.

## What carried over from the GBA reverse-engineering work

| From | Here |
| --- | --- |
| Mechanic cards: intent, named state with units, tunables, provides/requires | Module `card`s, the planner's only view of the library |
| Composition contracts plus link/footprint preflight | `preflight`, with millisecond validation and repairable error codes |
| Choosing among reviewed variants instead of writing code | Tweaks as tunable or level patches |
| Savestate search plus scenario predicates | `playtest` over JSON snapshots, with `win`/`lose` predicates |
| Failure taxonomy and corpus benchmarks | Stable codes everywhere, plus measured latency per step |
| Per-game design parameters (`ontology/games/*.yaml`) | Feel presets for tunables (planned) |
