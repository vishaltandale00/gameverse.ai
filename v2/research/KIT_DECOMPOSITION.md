# Kit → primitive decomposition map

The kits in `v2/kits/*` are being retired. Their depth moves into primitives (KERNEL_API.md §7), and each kit's games come back as preset documents. Line numbers are approximate.

Mapping key:
- **(a)**: an existing catalog id absorbs it;
- **(b)**: a NEW primitive;
- **(c)**: kernel or verify layer.

## Kit contract → kernel equivalents

| Kit concept | Kernel equivalent |
| --- | --- |
| `world.capabilities` (player, enemies, blocked, defeat, stun, lives, grid, terrain, spawn, boss, score, hurt, invulnerable, end) | Space capabilities plus card `requires` |
| Mod ops (`kits/mods/compose.js` `applyOps`) | `spawn` → `spawn`<br>`setBlocked` → `setCell`/`set_blocks`<br>`score` → `add_score` (gameplay.score)<br>`hurt` → `damage`<br>`invulnerable`/`stun` → `apply_status`<br>`defeat` → `kill`<br>`end` → `end_game`<br>`emit` → `emit` |
| Free-button allocation | `engine.input.actions` |
| Experiments (model-written code over snapshot + ops) | `engine.script.sandbox` |

## Maze (`kits/maze/`)

**Space:** `engine.space.grid`, which needs:
- wrap topology and a wrap distance;
- per-class passability (house door) and one-way cells (`noUp`);
- per-cell speed modifiers;
- `editCells`.

| Mechanic | Source | Map |
| --- | --- | --- |
| Mirrored lattice generator (degree ≥ 2 pruning, houses, tunnels, sizes, styles) | maze.js 1-274 | (b) `engine.generate.grid.maze` |
| Self-proof: `checkMaze` | maze.js 294-354 | generator self-proof |
| Lane-locked movement with buffered turns (CORNER 0.45, BASE_SPEED 9.47) | game.js 179-205 | (b) `gameplay.move.grid` |
| Pellets, power pellets, bonus prize | | (a) `gameplay.collectible` +`clearsLevel`, `spawnAtCount` |
| Fright mode | | `combat.status` + (b) `gameplay.score` chain 200·2^n |
| Four ghost personalities: greedy target tile, no reverse, tie order U L D R | 243-281 | (a) `gameplay.ai.brain` kind `target-tile` |
| Scatter/chase schedule, Elroy, speed tiers | | `ai.brain` `modeSchedule` + (b) `gameplay.stage.sequence` tables |
| House release (dot limits) | | `engine.spawner` `release` |
| Eyes return home | | `combat.health` `respawn:home` |
| Extra life at score | | `gameplay.death` + `score` |
| Danger-field BFS bot | verify.js 18-124 | (c) verify bot |
| Neon contour walls, follow camera | render.js | `graphics.render.grid` +wall style, `camera.top-down` deadzone, `ui.minimap` |

## Shmup (`kits/shmup/`)

**Space:** (b) `engine.space.arena2d`, a continuous kinematic space with wrap, scroll window and bounded arena.

| Mechanic | Source | Map |
| --- | --- | --- |
| Ship controller: rail, 8-way, twinstick, inertial thrust (300, drag 0.55, rot 4.6), hyperspace | game.js 176-213 | (b) `gameplay.move.ship` |
| Weapons: shot, spread, laser, homing, three tiers | 227-254 | `combat.projectile` +`pattern`, `pierce`, `homing`, `tiers` |
| Bomb | | (b) `gameplay.ability.active` |
| 15 motion behaviours (sine, zigzag, dive, hover, orbit, chase-steer, wander, split, snake, gravity well, saucer) | 539-638 | (b) `gameplay.ai.motion` |
| Bullet emitters (aimed, spread, ring, spiral, burst, flower), cap and difficulty | 641-678 | `ai.attacks` +`emitter` |
| Waves with entry paths and telegraphs | 319-403 | `gameplay.waves` +`entry`, `telegraph` |
| Galaga formation, Invaders march, dives with escorts | 418-470 | (b) `gameplay.ai.formation` |
| Bunkers | | `mechanism` `breakable` cells |
| Boss: hp phases, moves, phase invulnerability, bullet cancel, time limit | 681-756 | `combat.boss` |
| Chain multiplier | 758-790 | `gameplay.score` |
| Drops with a pity meter (16) and magnet | | `loot` +`pity` |
| Weapon tier upgrades | | (b) `gameplay.powerup` |
| Split-on-death rocks | | `combat.health` +`splitOnDeath` |
| Loop scaling | | `stage.sequence` `loopScale` |
| Rollout dodging bots (9 directions, wrap-aware), boss DPS check | verify.js 9-187 | (c) |

## Fighting (`kits/fighting/`)

**Space:** `arena2d` side view: floor, walls, maxSep 360; platform mode adds soft platforms, blast zones and ledges (arena.js 7-30).

**Needs:** `overlap` with per-pose multi-box hurtboxes and hitboxes.

| Mechanic | Source | Map |
| --- | --- | --- |
| Move compiler: frame data, hit/blockstun, push, levels, chains, cancels, invulnerability windows, hitstop; 12 special and 4 super archetypes; BUILD table | moves.js 7-150 | `combat.melee` frame data |
| Versus rules: guard high/low/overhead, chip, counter-hit 1.2, juggles (3), SCALING table, meter, throws and tech, command grab, teleport, counter, wall push | sim.js 357-660, 788-972 | (b) `gameplay.combat.versus` |
| Motion parser: qcf, dp, hcf, qcf2, charge (40 + 10), taps, buffers, priority | input.js 5-139 | (b) `engine.input.motions` |
| Rounds: timer, KO, perfect, time over, best-of-N, stocks | sim.js 247-356 | (b) `gameplay.rounds` |
| Arcade ladder | | `stage.sequence` + `ui.menu` select |
| Platform mode: percent, knockback [base, growth, angle], blast zones, ledges | 657-787 | (b) `gameplay.combat.knockback`, `move.platformer` +`ledgeGrab` |
| CPU: five-level table (react, block, read, anti-air, punish, combo, tech, mistake), macros through the real input path | ai.js 11-238 | (b) `gameplay.ai.versus` |
| Verify: every move connects, every motion is enterable, CPU vs CPU KOs, scripted beats easy CPU | verify.js 16-173 | (c) |
| 2D skeleton rig, keyframe poses, cel shading, framing camera, hit sparks, KO slow-mo | rig.js 15-385, render.js | `rig.custom` 2D, `anim.clips`, `camera.side` `frameTargets`, `fx.feedback` |

## Puzzle (`kits/puzzle/`)

**Space:** `grid`, which needs `editCells` and column `settle`.

| Mechanic | Source | Map |
| --- | --- | --- |
| Falling: SRS kicks, 7-bag, hold, next, ghost, DAS/ARR, lock delay 30 / 15 resets, T-spin, combo, B2B, guideline scoring, polyominoes, garbage | falling.js 8-309 | (b) `gameplay.falling.pieces` |
| Chain (pairs pop groups, CHAIN_POWER, COLOR_BONUS, virus/capsule) | chain.js 8-292 | `gameplay.match` `rule:group` |
| Swap match-3: L/T groups, specials and combos, jelly, blockers, reshuffle | swap.js 10-424 | `gameplay.match` +`specials`, `layers`, `reshuffle`; `generate.grid.board` `fillNoMatch` |
| Slide 2048 | slide.js 8-153 | (b) `gameplay.slide.merge` |
| Level goals (9 kinds) and stars | | `stage.sequence` + `score` stars |
| Bots: El-Tetris with honest input timing, chain lookahead, greedy swap, slide expectimax depth 1-3 | falling-bot.js, chain.js 293-400, swap.js 427-474, slide.js 154-260 | (c) |
| Per-level isolated verify (PASS_RATE 0.7, survive 150 pieces) | verify.js | (c) |

## Physics (`kits/physics/`)

**Space:** `engine.space.physics2d`, porting this solver.

| Mechanic | Source | Map |
| --- | --- | --- |
| Impulse solver: warm start, restitution, Coulomb friction, joints, sleeping, swept bullets, grid broadphase (SLOP 0.004, BAUMGARTE 0.15, 4 substeps, 6 iterations) | physics.js 13-592 | `physics2d` space + `engine.physics.rigid` |
| Breakout: paddle angle, serve and catch, ramp, brick kinds, capsules, boss | modes/breakout.js | (b) `gameplay.paddle`, `gameplay.powerup` |
| Peggle: cannon, shaped peg groups, fever | modes/peggle.js | (b) `gameplay.launcher`, (b) `engine.generate.layout.shapes` |
| Slingshot: materials, impulse damage, TNT | modes/slingshot.js | `launcher` + (b) `gameplay.destructible` |
| Pinball: flippers, plunger, bumpers, slings, ramps, drop targets, rollovers, multiball, tilt, missions | modes/pinball.js | `mechanism` kinds + `plot.quest` missions |
| Verify: brick reachability, aim and power search, random flipper policies | verify.js | (c) |

## Runner (`kits/runner/`)

**Spaces:**
- lanes: (b) `engine.space.track`;
- side, flap, climb and dash: `arena2d` with a scroll window;
- hop: `grid`.

| Mechanic | Source | Map |
| --- | --- | --- |
| Speed curve, tiers, chunk eligibility, density | world.js 18-43, 116-131 | (b) `engine.generate.chunks` |
| Combos, near-miss slow-mo | | `score` `nearMiss` |
| Rotating missions | | `plot.quest` challenge `rotate` |
| Power-ups (magnet, multiplier, jetpack, shield, superjump, slowmo) | | `gameplay.powerup` |
| Lanes (switch 0.15 s, jump, slide, chaser) | modes/lanes.js | (b) `gameplay.move.lanes` |
| Side (jumpH 3.3, g 62, cut 0.42) and flap (g 34, flap 9.6) | | `move.platformer` presets |
| Climb: auto-bounce, wrap, moving/breaking/spring/vanishing platforms, rising camera kill | | `move.platformer` `autoBounce`, `mechanism`, `hazard` |
| Rhythm dash (beat grid) | | (b) `engine.beat` |
| Hop: periodic lanes of cars, logs and trains, eagle on idle | modes/hop.js | (b) `gameplay.lanes.periodic` + `move.grid` hop |
| Verify: per-chunk beam search at max speed | verify.js 13-200 | (c) |
| Pseudo-3D rail track | | (b) `graphics.render.track` |

## Creature (`kits/creature/`)

**Spaces:** tilemap (topdown) areas, `space.graph` for area reachability, `space.none` for battles.

| Mechanic | Source | Map |
| --- | --- | --- |
| Damage formula, type chart, STAB 1.5, crit 1/16, roll 85-100, stages | rules/damage.js | `gameplay.creature.battle` |
| Battle: priority, statuses, items, switching, escape, exp, move learning | rules/battle.js | `creature.battle` on `gameplay.turns` |
| Capture: four shakes | rules/capture.js | `creature.catch` |
| Stats, IVs, growth, learnsets, evolution, party, PC, dex | rules/stats.js, world/menus.js | (b) `gameplay.creature.party`, `progression.level` perEntity |
| Battle AI | rules/ai.js | `creature.battle` ai |
| Overworld: grid walk/run (8/4 frames), ledges, warps, trainer sight (4), NPC wander | world/overworld.js | `move.grid`, `portal`, `ai.brain` `sight-challenge`, `plot.gate` |
| Tall-grass encounters | | (b) `gameplay.encounter` |
| Map generation (towns, routes, caves, gyms, league, interiors) with reachability and retries | world/maps.js | (b) `engine.generate.tilemap.overworld` |
| Badge gates | | `generate.graph.world` linear + `plot.gate` |
| Story scripts | world/story.js | `plot.*` |
| Heal centre, mart, PC | | `rest`, `economy`, `ui.*` |
| Compact → journey → full expansion, balance, simulation tuning | generate/*.js | planner + optional (b) `engine.generate.creature.roster` |
| Verify: badge-ordered reach, balance sim, playthrough bot | verify/*.js | (c) |
| Battle UI, autotiles, rig sprites | ui/*.js | (b) `graphics.ui.battle`, `tileset.pixel`, `sprite.pixel` |

## Mods (`kits/mods/`)

| Mod | Map |
| --- | --- |
| weapon (bolts, plus bombs: fuse 60, range 3, stun 180; ammo from events) | `combat.projectile` +`blast`, `ammo` |
| falling (pieces over any grid with a reachability guard) | `gameplay.falling.pieces` |
| waves (MAX_ALIVE 12) | `gameplay.waves` |
| boss (tire, dazed) | `combat.boss` |
| timer | `engine.time` `pauseWhen` + `score` time bonus |
| shield | `ability.active` |
| zones (score multipliers) | `engine.zones` dynamic + `score` |
