> **Legacy reference.** Kits are the earlier generation. They are not called from the live path and these documents are not instructions; see `v2/ARCHITECTURE.md`. Port their depth (constants, frame data, bots, generators) into primitives.

# Genre kits: roadmap to popular arcade and 2000s–2010s games

**Goal.** Any popular arcade game, or any game from 2000–2019, can be asked for and comes out as a
real game of that genre: its defining mechanics at full depth, original content and code-drawn art.
"Mortal Kombat" must become a fighting game, not a top-down shooter.

**How.** A **kit** is a complete engine for one genre:
- the model writes the *content* (cast, levels, moves, waves, story);
- the kit supplies the *systems* (rules, AI, physics, camera, UI);
- the kit *verifies* what it builds (a solver or bot proves it playable).

Kits share one interface (`KIT_CONTRACT.md`) and one host, so the studio, the overworld venues,
saves, art and audio work the same for every genre. A genre router in the design step picks the
kit. When no kit fits, the router reports the gap instead of forcing a wrong genre.

## The kits

Representative games are the targets each kit is measured against. They are references for
mechanics only; all content is original.

| # | Kit | Defining systems | Representative games |
| --- | --- | --- | --- |
| 1 | **Platformer** (exists, deepen) | Run/jump feel, dash, wall-jump, moving platforms, power-ups, bosses, world map | Super Mario Bros/World, Sonic, Celeste, Super Meat Boy, Rayman Origins, Shovel Knight |
| 2 | **Maze and grid arcade** | Grid movement, chase/scatter ghost AI, pellets and power states, bombs, lanes | Pac-Man, Bomberman, Dig Dug, Frogger, Crossy Road, Lode Runner |
| 3 | **Shoot 'em up** | Waves and formations, bullet patterns, power-up tiers, bosses; fixed, vertical and twin-stick | Space Invaders, Galaga, Asteroids, Centipede, Missile Command, Geometry Wars, Ikaruga |
| 4 | **Block and match puzzle** | Falling pieces with rotation rules, match-3 cascades, specials, move/level goals | Tetris, Puyo Puyo, Bejeweled, Candy Crush, Dr. Mario, 2048, Threes |
| 5 | **Physics toy** | Rigid bodies, paddles and balls, slingshots, pegs, destructible stacks | Breakout/Arkanoid, Peggle, Angry Birds, Pinball, Cut the Rope, Pong |
| 6 | **Endless runner and one-touch** | Procedural lanes or chunks, one-button control, speed ramp, score chase | Temple Run, Subway Surfers, Flappy Bird, Doodle Jump, Jetpack Joyride, Geometry Dash, Canabalt |
| 7 | **Fighting** | Frame data, hitboxes and hurtboxes, combos and cancels, specials by motion input, blocking, rounds, AI | Street Fighter II/IV, Mortal Kombat, Tekken (2D), Smash Bros (platform-fighter mode) |
| 8 | **Beat 'em up and run-and-gun** | Lane-depth brawling or side shooting, crowd AI, grabs, weapons pickups, co-op-ready | Streets of Rage, Final Fight, Castle Crashers, Metal Slug, Contra, Cuphead |
| 9 | **Metroidvania and 2D action-adventure** | Connected rooms map, ability gates, melee and charms, bosses, save points; top-down Zelda variant | Hollow Knight, Metroid, Castlevania SotN, Ori, Zelda: A Link to the Past/Minish Cap |
| 10 | **Creature collector RPG** (contract done) | Typed turn battles, capture, party, evolution, gyms, trainers | Pokémon Red–Black, Monster Rancher-likes |
| 11 | **Party RPG and JRPG** | Turn or ATB party battles, equipment, spells, overworld towns and dungeons, story; bullet-dodge battles | Final Fantasy VI–X, Dragon Quest, Chrono Trigger, Undertale, Paper Mario |
| 12 | **Roguelike and action RPG** | Procedural floors, item synergies, permadeath runs, loot and stats | Spelunky, Binding of Isaac, Dead Cells, Hades, Diablo II, Enter the Gungeon |
| 13 | **Tactics, tower defense and light strategy** | Grid turns with cover and hit chance; lanes and towers with waves; RTS-lite gather and build | XCOM, Fire Emblem, Advance Wars, Plants vs. Zombies, Bloons, Kingdom Rush, StarCraft (lite), Civilization (lite) |
| 14 | **Cards and deckbuilders** | Deck, hand, energy, intents, relics, drafting; head-to-head boards | Slay the Spire, Hearthstone, Balatro-likes, Solitaire |
| 15 | **Sandbox and life sim (2D)** | Tile mining and building, crafting, farming seasons, NPC schedules, friendship | Terraria, Stardew Valley, Animal Crossing, Harvest Moon, Factorio (lite), Minecraft (2D) |
| 16 | **Racing** | Kart, drift and boost, items, AI racers on splines; top-down and pseudo-3D | Mario Kart, Out Run, Micro Machines, Burnout (lite), F-Zero |
| 17 | **Rhythm** | Note charts synced to generated music, timing windows, combos | Guitar Hero, DDR, Rhythm Heaven, Osu!, Taiko |
| 18 | **Sports** | Ball physics, team AI, matches and seasons | Wii Sports, Rocket League (2D), NBA Jam, Tony Hawk (2D), Punch-Out!! |
| 19 | **Puzzle adventure** | Rules-as-puzzles, time rewind, sokoban pushes, point-and-click inventory | Braid, Portal (2D), Baba Is You, Professor Layton, Monkey Island |
| 20 | **3D action** (phase 4) | three.js: third-person and first-person controllers, open world, vehicles, shooting | Halo, GTA III–V, Zelda BotW, Minecraft, Super Mario 64/Galaxy, Portal, Spider-Man |

**Honest limits.**
- The 3D kits (row 20) are the largest, and they come last. Until then, a 3D game is offered as
  its 2D or top-down rendition (GTA as top-down GTA 1/2, Minecraft as Terraria-style), and the
  router says so.
- Online multiplayer games (Among Us, Fortnite, MOBAs) need networked sessions. These start as
  single-player with bots, and the router says so.

## Shared foundation (built once, used by every kit)

- **Kit host:** one runner for `createGame/step/view` with fixed-step simulation, input mapping
  (keyboard, gamepad, touch), pause, save and resume, hot reload of new versions, and
  title/pause/game-over screens.
- **Art:** code-drawn characters, props, tiles and scenery from a locked art direction
  (`v2/art/`). Kits add genre pieces: a fighter's larger rig, vehicles, cards, board pieces.
- **Audio:** `v2/engine/audio.js` events, mapped per kit.
- **Verification harness:** each kit ships a bot or solver. A version publishes only after its bot
  proves the content playable (clearable, winnable, balanced).
- **Router:** the design step classifies the idea into a kit and fills that kit's content schema.
  Mashups pick one kit as the core and theme it with the other idea, e.g. "Pokémon with Mario"
  becomes a creature RPG with a plumber cast.

## Order of work

| Phase | Kits | Why first |
| --- | --- | --- |
| 0 | Kit contract, host, router; maze kit as the reference | Every kit plugs in the same way |
| 1 | Arcade pack: shmup, block/match puzzle, physics toy, endless runner, platformer depth | Small engines, huge coverage of famous games |
| 2 | Fighting, beat 'em up/run-and-gun, metroidvania, creature RPG, roguelike | Deep mechanics the user asked for directly |
| 3 | Party RPG, tactics/TD, cards, sandbox/life sim, racing, rhythm, sports, puzzle adventure | Broadest remaining coverage |
| 4 | 3D action | Largest; builds on the v1 three.js world |

Each kit is done when:
- its representative games' defining mechanics work;
- its bot verifies generated content;
- it has tests;
- the studio can generate and revise a game in it within seconds.
