# Creature-collector RPG kit: contract

This is a complete, deep implementation of the creature-collecting RPG genre, at the depth of the
mainline handheld games' core loop. The model writes **content**; the kit supplies **systems**.
Everything here is original: generated games reuse genre mechanics, never another game's names, data
or art.

The core loop:
- explore towns and routes;
- meet wild creatures in tall grass;
- battle them turn by turn with typed moves;
- weaken and catch them, building a party of up to six;
- level up, learn moves and evolve;
- beat trainers who spot you;
- earn gym badges that open the next area;
- face your rival and the final champion;
- heal at centers and shop at marts.

## Layout

```
v2/kits/creature/
  CONTRACT.md                    (this file)
  content.js       schema + validate(content) + normalize(content)   (shared; owned by the integrator)
  rules/           pure, deterministic battle/creature math          (workstream A)
  world/           overworld runtime, map generation, story, saves  (workstream B)
  game.js          composes rules + world into one game              (workstream B)
  ui/              renderer, battle scene, menus, dialogue, title    (workstream C)
  generate/        model prompts/schemas, balancing, art list        (workstream D)
  verify/          reachability, balance sim, scripted playthrough   (workstreams B + D)
```

**Rules for all code:**
- ES modules that run in the browser and in Node, with no dependencies.
- All randomness comes from `rng.js` (`v2/kernel/rng.js`, a seeded generator held in game state).
- Game state is plain JSON, so the same content, seed and inputs always give the same game.
- Code is clear and commented where non-obvious; there are tests under `tests/v2-creature-*.test.js`.

## 1. Content (what the model generates, validated by `content.js`)

```js
{
  schema: 'gameverse.v2.creature-content/0.1',
  id, title, logline, artStyle, music: { mood, tempo, key, scale, instrument },
  region: { name, description },
  player:  { name, look },                     // look = visual description for art
  rival:   { name, look, personality },
  mentor:  { name, look, role },               // gives the starter
  types:   [{ id, name, color, look }],        // 6–18 types; ids are lowercase slugs
  chart:   { attacking: { defending: 0 | 0.5 | 2 } },   // only non-1 entries; validated per type pair
  moves:   [{ id, name, type, category: 'physical'|'special'|'status', power: 0|10..150,
              accuracy: 30..100 | null /* never misses */, pp: 5..40, priority: -3..3,
              effect?: { kind: 'status', status: 'burn'|'poison'|'paralysis'|'sleep'|'freeze'|'confusion', chance: 1..100 }
                     | { kind: 'stat', target: 'self'|'foe', stat: 'atk'|'def'|'spa'|'spd'|'spe'|'acc'|'eva', stages: -2..2, chance }
                     | { kind: 'heal', fraction: 0.25..1 } | { kind: 'drain', fraction } | { kind: 'recoil', fraction }
                     | { kind: 'multihit', min: 2, max: 5 } | { kind: 'protect' } | { kind: 'flinch', chance },
              description }],
  species: [{ id, name, types: [typeId] | [typeId, typeId], base: { hp, atk, def, spa, spd, spe },   // each 20..160
              growth: 'fast'|'medium'|'slow', catchRate: 3..255, expYield: 40..300,
              learnset: [{ level, move }],     // starts with ≥ 2 moves at level 1
              evolves?: { to: speciesId, level } , look, dex }],                  // look → art prompt
  starters: [speciesId, speciesId, speciesId],
  items: [{ id, name, kind: 'ball'|'heal'|'status'|'revive'|'key'|'repel', price, value, description }],
  areas: [{ id, name, kind: 'town'|'route'|'cave'|'gym'|'interior'|'league', theme, description,
            connects: [{ to, gate?: { badge?: n, flag?: id } }],
            encounters?: [{ species, minLevel, maxLevel, weight }],   // routes/caves; tall grass in routes, all floor in caves
            trainers?: [{ id, name, class, look, party: [{ species, level }], prize, intro, defeat }],
            leader?: { id, name, look, type, party, badge: { id, name }, intro, defeat },   // gyms
            services?: ['heal', 'mart', 'pc'], mart?: [itemId], npcs?: [{ id, name, look, lines: [string] }] }],
  story: [{ id, when: <predicate>, then: [<effect>] }],   // predicate/effect vocabulary in §4
  champion: { name, look, party, intro, defeat },          // final battle; beating it ends the game
}
```

**Normalization and validation** (`content.js` reports errors with codes and paths, as v2 preflight
does):
- References resolve: types, moves, species, evolves.to, items, areas and connects.
- Every species has at least two moves by level 5, and a damaging move of its own or Normal-like type
  by level 5.
- Evolution levels increase along each line, and there are no cycles.
- Starters are three level-1 lines whose types beat each other in a cycle.
- The area graph, given badge gates, reaches every gym in order and then the league.
- Every route has encounters.
- Trainer and leader levels follow the level curve (§5) within ±3.

## 2. Rules (`rules/`): pure functions over plain data

**Stats**
- Level 1–100.
- `stat = floor((2*base + iv) * level / 100) + 5`; `hp = floor((2*base + iv) * level / 100) + level + 10`.
- IVs are 0–31 per stat, rolled from the RNG when a creature is created. No natures and no EVs in v0.1.

**Experience**
- Growth curves:

  | Curve | Total experience at level n |
  | --- | --- |
  | fast | 0.8n³ |
  | medium | n³ |
  | slow | 1.25n³ |

- Defeating a creature gives `floor(expYield * foeLevel / 7)`, ×1.5 for trainer battles, split among
  the creatures that took part.
- Leveling up recomputes stats and keeps the damage taken. Moves are learned at their levels: with
  fewer than four moves, auto-learn; otherwise the UI prompts for a move to forget (or skip).
- Evolution is checked after battle, when level ≥ `evolves.level`. Pressing B in the evolution scene
  cancels it.

**Damage**
- Formula: `floor(floor(floor(2*L/5+2) * power * A/D) / 50) + 2`, then:
  - ×1.5 critical hits (1/16 chance, or 1/8 for high-crit moves);
  - × random 0.85–1.00;
  - ×1.5 same-type bonus;
  - × type effectiveness (product over the defender's types);
  - burn halves physical damage.
- Physical moves use atk/def; special moves use spa/spd.

**Stat stages**
- Stages run −6..+6, with multiplier (2+s)/2 for s ≥ 0 and 2/(2−s) for s < 0.
- Accuracy and evasion use thirds.

**Status conditions**

| Status | Effect |
| --- | --- |
| burn | 1/16 hp per turn; halves physical damage |
| poison | 1/8 hp per turn |
| paralysis | speed ×0.5; 25% chance to lose the turn |
| sleep | 1–3 turns |
| freeze | 20% thaw chance per turn |
| confusion | volatile, 2–5 turns, 33% chance to hit itself with power 40 |

**Turn order**
- Priority first, then speed, with ties broken by RNG. Switching and items go before moves.
- Escaping from wild battles: `f = (speed*128/foeSpeed + 30*attempts) mod 256`; success if
  RNG < f or speed ≥ foe speed.

**Capture**
- `a = (3*maxHp − 2*hp) * catchRate * ballBonus / (3*maxHp)`, with a status bonus (×2.5 sleep or
  freeze, ×1.5 for others).
- Four shake checks at `b = 1048560 / sqrt(sqrt(16711680/a))`. Report the number of shakes so the UI
  can animate them.
- On success the creature joins the party, or the box if the party has six.

**AI**
- Wild creatures pick a random usable move.
- Trainers pick the move with the best expected damage (power × same-type bonus × effectiveness ×
  accuracy). They use a status move when it's useful and not already applied. Leaders use a healing
  item once, below 25% hp.
- After a faint, trainers switch to their best type matchup.

**Interface** (exact names; workstreams depend on these):

```js
createCreature(content, speciesId, level, rng)             -> creature
statsOf(content, creature)                                 -> { hp, atk, def, spa, spd, spe }
expToLevel(growth, level)                                  -> number
startBattle(content, { kind: 'wild'|'trainer'|'leader'|'champion', player: party, foe: party, foeTrainer?, rng })  -> battle
chooseAction(battle, { kind: 'move', index } | { kind: 'switch', index } | { kind: 'item', item, target? } | { kind: 'run' })
resolveTurn(content, battle, rng)                          -> { events: BattleEvent[], battle }   // battle is updated in place
// BattleEvent: { type: 'move'|'damage'|'miss'|'crit'|'effective'|'status'|'stat'|'faint'|'switch'|'exp'|'levelup'
//                |'learn'|'learnPrompt'|'evolve'|'capture'|'shake'|'run'|'end', ... } with text for the log
needsInput(battle) -> null | { kind: 'action' } | { kind: 'switch' } | { kind: 'learn', move }
battleResult(battle) -> null | { outcome: 'win'|'lose'|'run'|'capture', exp, money }
```

## 3. World (`world/`)

**Map generation**
- `generateMaps(content, seed) -> { maps: { [areaId]: Tilemap }, warps, spawns }`. Each area becomes a
  tile grid (16 px tiles), and `connects` become exits on the edges or doors.
- Tile kinds: `ground`, `path`, `grass` (encounters), `tree`, `water` (blocking in v0.1), `ledge`
  (one-way, downward), `wall`, `roof`, `door`, `sign`, `heal`, `counter` and `flower` (decor).
- **Towns** have a heal center, a mart, houses, signs, paths and fences; a gym where `kind: gym` lives
  inside the town.
- **Routes** are 40–80 tiles long with winding paths, tall-grass patches, ledges, trees as walls, and
  trainers positioned so their sight lines cross the path.
- **Caves** have rock walls, a floor that triggers encounters, and items.
- **Gyms** are interiors with gym trainers in sight lines, a simple puzzle (a switch or a path maze),
  and the leader at the back.
- Generation is deterministic and checked: every exit is reachable from every entrance, and every
  trainer and item is reachable.

**Overworld runtime**
- `createOverworld(content, maps, state)` and `stepOverworld(content, world, input, rng) -> events`.
- Movement is grid-based in four directions, eight frames per tile with a walk cycle. Holding B runs
  at double speed. A bump sound plays against walls.
- Moving into tall grass rolls the area's encounter rate (default 10% per step), then a weighted
  species and a level, and emits `encounter`.
- Trainers have a facing and a sight range (4 tiles). On seeing the player they show "!", walk up,
  say their intro, and emit `trainerBattle`. Defeated trainers are remembered.
- NPCs either stand or wander inside a radius. Pressing A on an NPC, sign or item gives `dialogue` or
  `pickup`.
- Doors and exits warp between maps with a fade.
- Gates (badge or flag) block a path with an NPC or barrier that explains what's needed.
- Services: heal (restores the party, sets the respawn point), mart (buy and sell UI events), PC
  (box).
- The start menu (Start or Esc) offers party, bag, map, save and options.

**Story**
- `story[]` rules are evaluated on every event: the first visit to an area, beating a trainer, getting
  a badge, catching a creature, and so on.
- Effects: dialogue, give an item or creature, set a flag, a rival battle, unlock a gate, heal,
  warp, end the game.
- Default beats are always present unless overridden:
  - the mentor gives the starter (a choice of three);
  - the rival picks the counter-starter and battles you at the first route and twice more;
  - each gym badge opens the next gate;
  - the champion ends the game with credits.

**Game** (`game.js`): `createGame(content, { seed }) -> { createState(), step(state, input), view(state) }`.
- Modes are `title`, `intro`, `overworld`, `battle`, `menu`, `dialogue`, `shop`, `evolution` and
  `ending`.
- `input = { up, down, left, right, a, b, start, select }` (held), with edges derived internally.
- `view(state)` returns what the UI needs to draw, with no logic: the mode, map, camera, entities,
  dialogue text and choices, battle participants, HP and EXP bars, menu cursor, and so on.
- `state.events` carries this step's events for sound and effects.
- Saves are `JSON.stringify(state)`. Restoring a save after a version change keeps the party, bag,
  badges and flags.

## 4. Predicates and effects (story, gates)

- **Predicates:** `{ flag }`, `{ badges: { gte } }`, `{ area }` (the player is in it),
  `{ defeated: trainerId }`, `{ owns: speciesId }`, `{ caught: { gte } }`, `{ all: [] }`,
  `{ any: [] }`, `{ not: {} }`.
- **Effects:** `{ do: 'say', who, text }`, `{ do: 'give_item', item, count }`,
  `{ do: 'give_creature', species, level }`, `{ do: 'set_flag', flag }`,
  `{ do: 'battle', trainer | party }`, `{ do: 'heal' }`, `{ do: 'warp', area, to? }`,
  `{ do: 'end_game' }`.

## 5. Balance (`generate/` + `verify/`)

**Level curve.** With gyms numbered `g`, the target level is `L(g) = 5 + 7g` for the leader's ace
(roughly 12, 19, 26, 33, …). Wild levels on the route before gym `g` run `L(g) − 6 .. L(g) − 3`.
Trainers on that route are `L(g) − 4 ± 1`, and the champion is `L(G) + 6`.

**Balance pass.** `balance(content)` scales base-stat totals per evolution stage:

| Stage | Base-stat total |
| --- | --- |
| Starter or base | 290–330 |
| Middle | 400–440 |
| Final | 500–540 |
| Legendary (optional) | ≤ 580 |

It also sets catch rates by stage, fills learnsets that are too sparse, and fixes the type chart so
every type has at least one weakness and one resistance.

**Verification.** Recorded in the version report:
1. **Content validation** (§1).
2. **Map reachability** per area, with gates in story order.
3. **Battle balance sim:** a greedy player party, leveled along the expected curve, beats each leader
   in at least 70% of 200 seeded runs, and a level-matched wild battle is won in at least 95%.
4. **Scripted playthrough:** an agent walks the critical path with pathfinding, battles with the
   greedy policy, heals when below 50%, catches one creature per route, and reaches the ending.
   It records the frames, wall time and every battle result.

## 6. Presentation (`ui/`), built against `view(state)` only

**Overworld**
- Generated tileset with autotiling, four-direction walk frames for the player, NPCs and trainers
  (generated pose frames), smooth camera, area name banner, day tint optional.
- Tall grass rustles; the trainer "!" pops; doors fade.

**Battle**
- Generated backdrop per area theme, foe front sprite and player back sprite, entry slide-ins, HP
  bars that animate down and turn green, yellow then red, EXP bar fill, a typewriter text box, and
  the Fight / Bag / Party / Run menu.
- Move menu with type and PP. Move animations by type (projectile, flash, shake, particles), screen
  shake on super-effective hits, faint drop-and-fade, catch throw with arc, shakes and a
  sparkle-or-break-out, level-up stat panel, learn-move prompt, and evolution sequence.

**Menus**
- Party (sprites, HP, status, reorder, summary page with stats, moves and types).
- Bag (pockets, use on target), Dex (seen and caught), mart buy/sell, map, save.

**Title**
- Generated key art, the logo set from the title, "Press Start", new or continue.
- Intro: the mentor's speech, then naming (default names, editable).

**Sound** comes from `v2/engine/audio.js` events: area themes from the music direction, a battle
theme, cries per species (procedural, seeded by species id), and menu sounds.

**Art.** Each piece is generated by the art pipeline, with emoji or primitive-shape placeholders
until it arrives:
- creature front sprites, plus back sprites as edits of the front;
- the player, rival, mentor, NPC and trainer overworld 4-direction frames (edits of a base sprite);
- trainer battle portraits;
- tilesets per area theme (2×2 template cells extended to a 4×4 template: ground, path, grass, tree,
  water, wall, roof, door, flower, ledge, fence, sign, heal and mart roofs, counter);
- battle backdrops;
- title art.

## Implementation notes (v0.1)

Decisions made where this contract was open or the host differs:
- **Input.** The host gives `{ x, y, a, b }` with no Start button. A confirms and talks. B goes back,
  and holding it runs. A quick tap of B while standing still (released within 14 frames, no step
  taken) opens the start menu: Party, Bag, Dex, Save and Close. There is no Map or Options entry yet.
- **Generated content is a journey.** The model writes the compact shape in `generate/schema.js`:
  the cast, types, moves and species, a home town, one chapter per gym, and a finale. A chapter has
  1–3 routes or caves, then a town with a gym. `generate/from-model.js` expands it into the §1 content:
  linear connects, a badge gate on the way out of each gym town, and services.
  `generate/balance.js` and `generate/tune.js` then set levels on the curve, fix stats, learnsets and
  the chart, and simulation-tune the leaders. A generated game stores the journey, so a revision edits
  exactly what the model wrote. Hand-written full content, like the sample, works too.
- **Real options for common requests.** These live in `content.settings`:
  - `routeLength` (24–160 tiles; areas can override it with `length`);
  - `encounterRate` (percent; areas can override it);
  - `difficulty` (easy/normal/hard): trainer AI and a ±2 level offset;
  - `levelStep`: `L(g) = 5 + levelStep·g`.

  Gym count is the number of chapters, world size is the routes per chapter plus route length, and
  species count is the species list.
- **Default beats.** The game starts in the mentor's lab with the intro and the starter choice. The
  mentor also hands over 5 of the cheapest ball and 2 of the cheapest heal, so the first route can be
  caught on. The rival takes the starter whose type beats yours. In the first rival battle the
  rival's creature only knows its level-1 moves, as in the classics. Losing a story battle (rival or
  scripted) blacks out and the story moves on; losing to a world trainer means a rematch.
- **Story rules fire once each** (`state.fired`), even without a flag effect.
- **Rival battles use the counter-starter** at level 5 with 0 badges, otherwise `L(badges+1) − 3`.
  Fillers come from encounter species up to the current stage.
- **Evolution after battle** applies to creatures that leveled up in it. Pressing B in the scene
  cancels it.
- **Movement.** A step takes 8 frames walking and 4 running. Tapping a new direction turns in place
  (4 frames) before walking.
- **The verifier's balance sim** uses a curve-level party: the starter line at `L(g)−1` plus the two
  best catches so far at `L(g)−3`. The party leads with its best matchup and carries `2+2g` heals, and
  it must win at least 70% of 200 runs per gym for every starter. Level-matched wild battles must be
  won at least 95% of the time. The scripted playthrough uses the real inputs and runs once per
  starter while the budget lasts.
