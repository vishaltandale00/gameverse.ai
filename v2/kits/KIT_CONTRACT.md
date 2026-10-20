# Kit contract

A kit is a complete engine for one genre (see `ROADMAP.md`). Every kit exposes the same module
shape, so one host runs any kit, one pipeline generates for any kit, and one art system draws for
any kit.

## Module

`v2/kits/<id>/index.js` default-exports:

```js
{
  id: 'maze',                       // slug, also the directory name
  name: 'Maze chase',
  version: '0.1.0',                 // bump when rules change; recorded in every version's provenance
  summary: 'Grid maze, pellets, power-ups that turn the hunters into the hunted, ghost AI with personalities.',
  examples: ['Pac-Man', 'Ms. Pac-Man'],   // the router's reference games for this kit (mechanics only)

  content: {
    schema,   // strict JSON schema the model fills (OpenAI strict mode: every property required, additionalProperties false)
    prompt,   // instructions for the model writing content in this genre
    sample,   // a complete, valid hand-written content object (tests and offline mode)
  },
  validate(content) -> { ok, errors, warnings, content },   // content is normalized; errors are { code, path, message, hint? }

  cast(content) -> { brief, entities },
  //   brief:    { player: { name, glyph? }, enemy, pickup, hazard, goal } names for the art director
  //   entities: { kind: { tags: ['player'|'enemy'|'collectible'|'hazard'|'goal'] } } (paintGameArt input)

  createGame(content, { seed }) -> { createState(), step(state, input) },
  createRenderer(game, { art }) -> render(ctx, state, frame),
  verify(content, { seed, budgetMs }) -> { ok, problems, report },
  controls: [{ input: 'move' | 'a' | 'b', label }],
}
```

## Rules

- **Pure and deterministic.** `createGame` and `step` run headless in Node and in the browser.
  They use no DOM, no `Math.random` and no wall-clock time. Randomness comes from
  `v2/kernel/rng.js` with its state kept inside the game state.
- **Fixed step.** `step` advances exactly 1/60 s.
- **Input** is held state: `{ x: -1|0|1, y: -1|0|1, a: bool, b: bool }`. The kit derives presses
  (edges) itself, keeping the previous input in state.
- **State** is plain JSON, so `structuredClone` makes a save. It always has:
  - `status`: `'playing' | 'won' | 'lost'`;
  - `score` (a number);
  - `events`: this step's events as `{ name, ...data }`.
- **Shared event names**, so sound and effects work in every kit: `collect`, `power`, `hurt`,
  `defeated` (an enemy), `shoot`, `hit`, `jump`, `land`, `extra_life`, `level_up`, `reach_goal`,
  `won`, `lost`. Kits may add their own.
- **Lose reason.** When status becomes `'lost'`, set `state.reason` to a short phrase like
  "Caught by Blinky".

## Renderer

`createRenderer(game, { art })` returns `render(ctx, state, frame)`.
- `frame` is `{ cssWidth, cssHeight, dt, events, reducedMotion, paused, attract }`, where
  `attract` is true behind the title screen.
- `ctx` is already scaled for device pixel ratio.
- The renderer draws everything inside the canvas, including the HUD. Title, pause and end screens
  are the host's.
- It uses `art` (the record from `v2/art/paint.js`): `sprites`, `frames[kind][pose]`, `tileset`,
  `background` and `style`. When art is missing it falls back to drawing shapes in code, never to
  emoji.
- Polish is the default:
  - animation in every state;
  - particles on events;
  - screen shake (off with `reducedMotion`);
  - a readable HUD.

## World adapter and mods

Concepts mix across genres through **mods** (`v2/kits/mods/`): mechanics written once and switched
on inside any kit that can host them. Pac-Man with guns is the maze kit plus the `weapon` mod. A kit
opts in by describing its world:

```js
world: {
  capabilities: ['player', 'enemies', 'blocked', 'defeat', 'stun', 'lives'],  // what this world can report and do
  buttons: ['a'],              // buttons the kit itself uses; mods get the free ones
  adapter(game) -> {           // world units (tiles or the kit's own units)
    active(state),             // true while play is live (not intros, deaths or menus)
    player(state) -> { x, y, facing: { x, y } },
    enemies(state) -> [{ id, name, x, y, radius, hittable }],
    blocked(state, x, y),      // terrain blocks movement and shots here
    wrap?(state, x, y) -> [x, y],
    defeat(state, id, { by }) -> points,   // the genre decides what defeat means (eyes, explode, KO)
    stun?(state, id, frames),  // a stunned enemy doesn't move or hurt
    lives?(state),
  },
}
```

The renderer sets `render.view = { X(x), Y(y), s, clip?, hud? }` each frame, mapping world units to
CSS pixels, so mods draw in the same space. Hosts and the pipeline go through
`composeGame`/`composeRenderer`, which offer a kit exactly the mods its capabilities and free buttons
allow. The content model switches mods on in a fixed-shape `mods` object, and anything neither the
kit nor a mod can express is listed as unsupported, never claimed.

## Verification

`verify` must prove the content playable before it publishes. Depending on the genre, a bot plays
it or a solver checks it. The `report` records:
- what was proven;
- bot metrics (cleared, time, deaths);
- the wall time spent.

Keep it under `budgetMs`, by default 2000 ms.

## Game document

The pipeline stores kit games as:

```js
{ schema: 'gameverse.v2.kit-game/0.1', kit, kitVersion, id, title, logline, seed, content, art }
```

## Tests

`tests/v2-kit-<id>.test.js` must cover:
- the sample validates;
- the same seed and inputs give the same final state;
- the bot verifies the sample;
- the defining mechanics behave as specified.
