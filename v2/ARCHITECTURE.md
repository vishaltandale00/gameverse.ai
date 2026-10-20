# Gameverse v2 architecture: games from primitives

**Target:** a player describes a game ("Minecraft in GTA", a Metroidvania with a story, a creature-collecting
RPG, a tactics game, a mystery) and gets a playable, multi-region game. The first area is playable within seconds; the rest of the
world, story and content stream in behind it.

**Scope:** 2D and 3D games of many kinds run on the same architecture: open worlds, platformers, RPGs,
tactics, narrative and card games. The complicated case is designed in from the start.

`v2/engine/` is the 2D single-level prototype. Its patterns (cards, preflight, deterministic JSON state,
snapshot search) carry over. `v2/kernel/` replaces it.

## 1. The kernel is space-agnostic; spaces are primitives

The kernel knows about:
- entities and components (plain JSON);
- events;
- a phase-ordered scheduler and time;
- vars and flags;
- predicates and effects;
- RNG and snapshots.

It does **not** know what space looks like. A game picks a space primitive, or several (an overworld and
interiors, a world map and a battle screen), from a menu:

| Space primitive | Good for |
| --- | --- |
| `engine.space.voxel` | Minecraft-like editable 3D worlds; chunked, generated plus an edit log |
| `engine.space.mesh3d` | Heightfield terrain plus placed meshes and colliders: GTA-like cities, racing, 3D action |
| `engine.space.tilemap` | 2D top-down or side-view tiles: platformers, Zelda/Pokémon-style maps, roguelikes |
| `engine.space.physics2d` | Continuous 2D bodies and shapes: physics puzzles, pinball, top-down driving |
| `engine.space.graph` | Rooms and locations as nodes and edges: adventure, board, management and narrative games |
| `engine.space.grid` | Discrete turn-based boards: tactics, puzzle, chess-likes, match-3 |
| `engine.space.none` | Card, dialogue and UI-driven games |

**Capabilities.** Each space provides the subset of capability interfaces it can support:
`position`, `distance`, `overlap`, `raycast`, `pathfind`, `reachable`, `editCells`, `gravity`,
`navigate`. Gameplay, AI and verification primitives declare the capabilities they require. For example,
`gameplay.blocks.mine` needs `editCells`, `gameplay.vehicle.car` needs a continuous space, and
`plot.dialogue` needs nothing. Preflight rejects a game whose primitives need capabilities its spaces
don't provide, and the planner picks spaces to fit the idea.

**State and determinism**
- Each space owns its serialized state; voxel and tile spaces store generation params plus an edit log.
- The kernel owns everything else.
- RNG lives in state, so runs are deterministic and replayable.
- The same simulation runs headless in Node or a worker for verification, and in the browser for play.

## 2. Four primitive families

A **primitive** is a reusable, parameterized building block. Every primitive has:

- **`id`**: `family.domain.name`, for example `gameplay.vehicle.car` or `plot.quest.fetch`.
- **`card`**: what the planner model sees.
  - `intent`;
  - `views`: the view kinds it supports;
  - `params`, each with a type, default, range or options, unit and effect;
  - `provides`: components, events, vars and actions;
  - `requires`: other primitives or components;
  - `conflicts`.
- **`schema` checks**: `validate(config, doc)` returns errors with stable codes, paths and fix hints
  (millisecond preflight).
- **Runtime hooks**:
  - `install(world, config)` adds systems (phase-ordered step functions), event handlers, actions and
    vars;
  - `generate(world, config)` for world-building primitives;
  - `render` hooks for graphics primitives.

### Engine primitives (`engine.*`)

The substrate. The space primitives are listed in section 1.

| Primitive | Covers |
| --- | --- |
| `engine.generate.*` | Per-space generators: noise terrain and biomes, voxel caves, city blocks and road networks, dungeon rooms, tilemap rooms, graph worlds, scattered props |
| `engine.blocks` | Cell palette and properties, for voxel and tile spaces |
| `engine.physics.*` | Bodies and collision for whichever spaces support them |
| `engine.time` | Fixed step, day/night clock |
| `engine.spawner` | Population by region and density |
| `engine.save` | Checkpoints and edit-log persistence |
| `engine.zones` | Named regions with bounds, entry events and per-zone rules |
| `engine.portal` | Doors and warps between zones or interiors |
| `engine.input.actions` | Semantic verbs (move, look, jump, use, attack, mine, place, drive, talk, menu) bound per view |

### Plot primitives (`plot.*`)

Story as data the engine executes and the verifier can solve:

- `plot.character`: identity, role, personality, voxel/sprite model, schedule and home zone.
- `plot.storyboard`: acts → beats. Each beat has a trigger (a predicate over world state and events)
  and effects.
- `plot.dialogue`: lines and choices with conditions and effects.
- `plot.quest.*`: objectives built from the goal kinds below, with rewards, gates and failure
  conditions.
- `plot.gate`: requirements on flags, items or abilities that lock zones, portals or beats. This is how
  Metroidvania and Pokémon progression works.
- `plot.cutscene`: camera moves, letterboxing, scripted moves and dialogue.
- `plot.ending`: one or more endings.

Predicates are shared with gameplay: vars, event counts, flags, items, zone presence, and
`all`/`any`/`not`.

Effects:
- `set_flag`, `give_item`, `take_item`, `spawn`, `despawn`, `unlock`, `start_quest`, `complete_quest`;
- `say`, `move_to`, `teleport`, `play_cutscene`, `set_var`, `change_weather`, `end_game`.

Quest goal kinds: `reach`, `collect`, `deliver`, `defeat`, `talk`, `escort`, `survive`, `build`, `drive`.

### Graphics primitives (`graphics.*`)

Generated art and presentation with no external assets:

- **Models**, generated with no external assets; pick per game and style:
  - `graphics.model.voxel`: layered palette grids;
  - `graphics.model.lowpoly`: composed boxes, cylinders and spheres with materials;
  - `graphics.model.mesh`: an imported or generated glTF;
  - `graphics.sprite.pixel`: palette grids for 2D;
  - `graphics.sprite.vector`: SVG/canvas shapes;
  - `graphics.tileset.*`: generated tile art and autotiling rules for tilemap games.
- **Landscapes:** `graphics.terrain.procedural`, heightfield or noise terrain with LOD, splat
  materials, water, vegetation scattering and atmosphere, for rich 3D outdoor worlds.
- **Characters:**
  - `graphics.rig.*`: humanoid, quadruped and custom skeletons, procedurally built and skinned to
    generated meshes;
  - `graphics.anim.*`: keyframe clips, locomotion blend trees driven by speed and direction,
    two-bone and FABRIK IK (foot placement on terrain, hand reach, look-at), ragdoll, and procedural
    secondary motion.

  A tilemap game and a game with IK characters on procedural terrain both pick from this family.
- **World look:** `graphics.material.palette` (block colors and per-face shading),
  `graphics.sky` (sky, fog, sun and day/night lighting).
- **Cameras:** `graphics.camera.*`: first-person, third-person, top-down, side and isometric.
- **Effects:** `graphics.particles` (dust, sparks, smoke, debris) and `graphics.post` (bloom, tone
  mapping, outlines, palette quantization for retro looks).
- **UI:** `graphics.ui.*`: HUD meters and counters, dialogue box, quest log, minimap, inventory grid,
  wanted stars.
- **Renderers, one per space kind:**
  - three.js: voxel chunk meshing, and mesh3d scenes;
  - canvas: tilemap, physics2d and grid boards;
  - DOM: graph, card and dialogue games.

### Gameplay primitives (`gameplay.*`)

Mechanics, all components and systems over the ECS:

- **Movement:** `gameplay.move.*`: walk/run/jump, fly, swim, climb, dash, wall-jump. Shared physics
  tunables carry "feel presets".
- **Interaction:** `gameplay.interact.*`: use, talk, pick up, open, sit.
- **Blocks:** `gameplay.blocks.mine` and `gameplay.blocks.place`, with tool tiers and drops.
- **Items:** `gameplay.inventory`, `gameplay.crafting` (recipes and stations), `gameplay.container`,
  `gameplay.economy` (currency, shops, prices).
- **Combat:** `gameplay.combat.*`: melee, projectile, damage types, health, armor, knockback,
  invulnerability.
- **AI:** `gameplay.ai.*`: wander, patrol, chase, flee, follow, schedule (go to places at times) and
  traffic (vehicles on road graphs).
- **Vehicles:** `gameplay.vehicle.*`: car, boat and aircraft physics, entering and exiting, seats.
- **Progression:** `gameplay.progression.*`: XP, levels, ability unlocks and stats.
- **Systems:** `gameplay.wanted` (heat level, police response) and `gameplay.creature.*` (catch,
  party, turn-based battle, as a sub-mode).

## 3. The game document (`gameverse.v2.game/0.2`)

A game is one JSON document that references primitives by id and parameterizes them:

```
{ schema, id, title, logline, views: { primary, alternates },
  plot:     { premise, characters[], storyboard{acts[]}, quests[], dialogue{}, endings[] },
  spaces:   [ { id, use: "engine.space.*", with, generators[ {use, with} ], zones[] } ],
  content:  { models{}, items[], recipes[], archetypes[], vehicles[], spawns[] },
  gameplay: [ {use, with} ], graphics: [ {use, with} ],
  player:   { archetype, start, abilities[], inventory[] } }
```

All references (character, item, zone, quest, model, archetype, flag) are checked by preflight. The
examples in `v2/games/` are written at full scale (multiple acts, zones, quests, characters and
systems) and serve as integration targets and few-shot material.

## 4. Generation: progressive and hierarchical

A large game doesn't come from one model call. It comes in layers, and each layer is checked before
the next one builds on it:

| Step | Model | Target time | What happens |
| --- | --- | --- | --- |
| 1. Outline | Sonnet | ~3–5 s | Premise, characters, act/beat skeleton, zone graph, primitives chosen. Preflighted. |
| 2. First playable | none | <1 s | The world is generated procedurally from the outline's generator params; the starting zone, player and first beat are instantiated. Play starts here. |
| 3. Detail, in parallel | Sonnet | background | Each zone's structures, spawns, dialogue and quests. Each piece is preflighted and the plot re-solved on arrival, then hot-loaded into the running world. |
| 4. Gaps | Opus | background | Ideas no primitive covers become a new primitive (card + implementation + tests), gated by preflight, unit tests and playtest, then registered. |
| 5. Tweaks | Haiku or rules | <1 s | "Faster cars", "more police": parameter or content patches that leave the code alone. |

## 5. Verification at scale

- **Preflight:** schema, references and parameter ranges, across the whole document. Milliseconds.
- **Plot solver:** build the dependency graph of beats, quests, gates, items, flags and zones, then
  search it for at least one path to an ending. This catches softlocks, unobtainable key items and
  circular gates before any simulation runs.
- **Spatial checks:** reachability between zone entrances, quest targets and portals, using whatever
  each space's `reachable` capability provides and the player's movement abilities.
- **Headless playtest:**
  - snapshot search (the 2D prototype's Go-Explore approach) inside zones;
  - scripted agents for quest steps;
  - invariant checks: non-finite values, entity explosions, stuck states.

  Model calls happen only at decision points.

## 6. Code layout

| Path | Contents |
| --- | --- |
| `v2/kernel/` | ECS, events, scheduler, predicates, effects, capabilities, registry, document preflight; no space code |
| `v2/primitives/{engine,plot,graphics,gameplay}/` | One file per primitive, with its card |
| `v2/games/` | Full-scale example documents |
| `v2/planner/` | Layered generation |
| `v2/verify/` | Plot solver, spatial checks, playtest |
| `v2/web/` | Player and builder UI |

## 7. Benchmarks

**Game creation**
- request → first playable latency;
- preflight and plot-solver pass rate;
- detail patches accepted ÷ proposed;
- repeatability: the same document and seed replay to an identical state hash.

**Playtesting and general play: ARC-AGI-3**

ARC-AGI-3 games are interactive grid worlds with hidden rules:
- 1–64 × 1–64 cells, 16 colors;
- `ACTION1`–`ACTION7`, where `ACTION6` is a click at x, y;
- several levels per game.

**Scoring:** each level scores `min(115, (baseline_actions / actions)² × 100)`, and levels are averaged with
weights by level index. We use this as the efficiency metric for our playtester and solver.

Two tracks:
1. **Native ARC-style games.** Author them in Gameverse on `engine.space.grid` and score our agents with
   the formula above.
2. **The real public games**, run through a bridge to the ARC SDK in the user's `d1_arc_agi` workspace
   (offline mode, seeded). Snapshot and restore there are reset plus action-prefix replay, which fits
   our solver's restore contract.

The first is the routine benchmark. The second is a separately triggered qualification run (per
AGENTS.md: no long or model-heavy runs in routine CI). **Never copy ARC game sources into this
repository.**
