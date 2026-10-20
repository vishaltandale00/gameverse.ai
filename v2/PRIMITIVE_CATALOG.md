# Gameverse v2 primitive catalog

Spec for every primitive needed to express the 55 games in `v2/research/games-2007-2019.md`. Companion to `ARCHITECTURE.md`; the reference implementations are `engine.space.graph`, `plot.storyboard` and `gameplay.inventory`. Full-scale usage: `v2/games/{blockport,hollow-lantern,emberfall}.json`.

## 0. Conventions

**Param notation:** `name:type[min..max]unit=default`. Types: `n` number, `i` integer, `b` boolean, `s` string, `enum(a|b)`, `ref:<kind>`, `list<T>`, `obj{..}`, `pred`, `fx` (effect list), `json`. `v2` = `[x,y]` or `[x,y,z]` in the space's units. `req` marks required.

**Tiers:** **P0** = needed by Blockport, Hollow Lantern or Emberfall, plus the most common systems. **P1** = common in the 55 games, needed for the next wave. **P2** = long tail.

**Document slots** (kernel `preflight`): `spaces[]` holds `engine.space.*` plus its `generators[]` (`engine.generate.*`); `systems[]` holds every other `engine.*`, all `plot.*` and all `gameplay.*` instances, installed in document order after spaces; `graphics[]` holds `graphics.*` and is skipped headless. (ARCHITECTURE §3 calls `systems[]` "gameplay[]"; the kernel reads `systems`.) Each instance is `{use, with, space?}`; `space` binds it to a space id (default: first space).

**Views:** `1p` first-person, `3p` third-person, `td` top-down, `side`, `iso`, `board`, `ui` (DOM/card), `any`.

**Event naming.** Every event carries `{who?, ...}`. A primitive that emits an event about a typed subject also emits the qualified form `name:<subject>` (so `count` predicates and quest objectives can address it): `defeated` + `defeated:<archetype>`, `discovered:<zone>`, `talked:<character>`, `crafted:<recipe>`, `block_placed:<block>`, `block_mined:<block>`, `item_gained:<item>`, `used:<interactable>`. Cards list these as `name:*`; preflight treats `name:*` in `provides.events` as a wildcard.

**Component ownership.** Archetype `components` (see §8) are keyed by owning primitive: `health` (combat.health), `melee`, `ranged`, `ai` (ai.brain), `attacks` (ai.attacks), `schedule` (ai.schedule), `vehicle`, `mount`, `interact`, `shop` (economy), `container`, `equipment`, `loot`, `level`, `resources`, `status`, `model` (graphics). Unknown components are preserved but unvalidated.

**Required kernel deltas** (small, listed so implementers do not discover them late): (1) `REF_KINDS` gains `cutscene`, `faction`, `ability`, `interactable`, `portal`, `gate`, `station`, `pool`, `table`, `status`; (2) `provides.events` accepts `name:*`; (3) `capabilities` set extended with `surface`, `occupancy`, `los` (below); (4) `zone` predicate and `teleport` effect are registered by every space with `at`, resolved through the entity's space.

## 1. Capability interfaces

A space's `install()` calls `rt.defineSpace(id, api)`; `api` implements exactly the capabilities the space's `capabilities(config)` reports. `At` is the space's coordinate (§2). All methods are deterministic and read only `rt.state` plus space state.

| Capability | Methods (signature → result) |
| --- | --- |
| `position` | `place(e)`; `remove(e)`; `setPos(e, at, rt)`; `pos(e) → At`; `entitiesAt(at) → id[]` |
| `distance` | `distance(a: At, b: At, metric?: 'euclid'\|'manhattan'\|'path') → n` (graph: hops; units: m for 3D, tiles for 2D) |
| `overlap` | `overlap(shape, filter?) → id[]`; `contacts(e) → [{id?, cell?, normal}]`. `shape` = `{kind:'aabb'\|'sphere'\|'circle'\|'cone', at, size?, r?, dir?, angle?}` |
| `raycast` | `raycast(from, dir, maxDist, mask?) → {hit:'cell'\|'entity'\|'none', at, normal, dist, id?, cell?}` |
| `pathfind` | `path(from, to, {radius?, height?, step?, abilities?, avoid?}) → At[] \| null` (A* over the space's nav representation) |
| `reachable` | `reachable(from, rt, {abilities?}) → Set<Cell\|ZoneId>`; `canReach(a, b, abilities?) → b` (used by the spatial verifier) |
| `editCells` | `getCell(at) → blockId`; `setCell(at, blockId, rt, by?) → b` (appends to the edit log `{t,at,from,to,by}`); `fill(box, blockId, rt)`; `cellsIn(box) → [{at,block}]`; `editLog(sinceT?) → entry[]` |
| `gravity` | `gravityAt(at) → v3`; `move(e, delta, rt) → {moved, blocked:{x,y,z}, grounded, normal?}` (collide-and-slide); `grounded(e) → b` |
| `navigate` | `neighbors(id) → id[]`; `canMove(e, to, rt) → b`; `move(e, to, rt, {force?}) → b` (discrete, gate-aware) |
| `surface` | `groundAt(x, z) → {y, normal, material, biome?}`; `slopeAt(x, z) → deg`; `waterDepthAt(x, z) → m` |
| `occupancy` | `occupant(cell) → id\|null`; `cellsInRange(cell, n, metric, {passable?}) → cell[]`; `moveCost(from, to, e) → n`; `coverAt(cell, dir) → 0\|1\|2` |
| `los` | `los(a, b) → {clear: b, cover: 0\|1\|2}`; `visibleFrom(a, range) → cell[]` |

## 2. Space primitives

| Id | T | Intent / key params | Caps | `At` and zone shape | Views | Persisted state |
| --- | --- | --- | --- | --- | --- | --- |
| `engine.space.voxel` | P0 | Chunked editable 3D grid. `chunk:[i,i,i]=[16,64,16]` · `height:i[32..512]=128` · `seaLevel:i=48` · `cell:n[0.25..2]m=1` · `viewDistance:i[2..32]chunks=8` · `lightModel:enum(none\|sky\|full)=sky` · `fluid:b=false` | position, distance, overlap, raycast, pathfind, reachable, editCells, gravity, surface | `[x,y,z]` m, cells integer-aligned. Zone: `{id,name,bounds:{min:[x,y,z],max:[x,y,z]}\|{center:[x,z],r}, tags[], rules{}}` | 1p, 3p, iso | seed + generator params + edit log |
| `engine.space.mesh3d` | P0 | Heightfield terrain + placed meshes/colliders + navmesh. `size:[n,n][64..16384]m=[2048,2048]` · `heightRes:n[0.5..8]m=2` · `gravity:n=-9.8` · `navCell:n[0.25..4]m=1` · `streamRadius:n[100..4000]m=600` | position, distance, overlap, raycast, pathfind, reachable, gravity, surface | `[x,y,z]` m (y derived from terrain when omitted). Zone: as voxel, or `{polygon:[[x,z]..]}` | 1p, 3p, iso, td | generator params + placed-object list |
| `engine.space.tilemap` | P0 | 2D tile layers, side or top-down. `tile:i[8..64]px=16` · `size:[i,i][8..4096]tiles` · `mode:enum(side\|topdown)=side` · `gravity:n=-60tiles/s²` (side only) · `layers:list<s>=['bg','solid','fg']` | position, distance, overlap, raycast, pathfind, reachable, editCells, surface, gravity (only when `mode=side`) | `[x,y]` tiles, y up. Zone: `{id,name,rect:[x0,y0,x1,y1],tags[],rules{}}` | side, td | generator params + edit log |
| `engine.space.physics2d` | P1 | Continuous 2D rigid bodies. `gravity:v2=[0,-9.8]` · `bounds:[n,n]m` · `substeps:i[1..8]=2` | position, distance, overlap, raycast, gravity | `[x,y]` m. Zone: rect | side, td | body list |
| `engine.space.graph` | P0 | Locations + gated exits (reference impl). No params. | position, distance, navigate, reachable | zone id. Zone: `{id,name,exits:[{to,gate?:pred,label?}],tags[]}` | text, map, ui | `at` per entity |
| `engine.space.grid` | P1 | Discrete board. `topology:enum(square\|hex\|iso)=square` · `size:[i,i][2..128]` · `diagonals:b=false` · `cover:b=false` | position, distance, navigate, pathfind, reachable, occupancy, los, overlap | `[col,row]`. Zone: `{id,rect}` | board, td, iso | cell + occupant list |
| `engine.space.none` | P1 | No spatial state; for card, dialogue, UI and management games. | none | none | ui | none |

Several spaces may coexist (overworld + interiors, map + battle); entities live in exactly one. `engine.portal` moves them.

## 3. Engine primitives (`engine.*`)

Columns: **Params** · **Provides** (caps/events/vars/services) · **Logic** (predicates `P:` / effects `E:`) · **Requires/space**.

### 3.1 Generators (slot: `spaces[].generators[]`; each is deterministic from `seed`)

| Id | T | Intent | Params | Provides | Spaces |
| --- | --- | --- | --- | --- | --- |
| `engine.generate.terrain.noise` | P0 | Fractal heightfield / voxel surface | `octaves:i[1..8]=5` · `scale:n[16..4096]m=256` · `amplitude:n[1..600]m=40` · `ridged:n[0..1]=0` · `falloff:enum(none\|island\|radial)=none` · `seaLevel:n m` · `rivers:i[0..64]=0` · `erosion:i[0..8]=0` · `warp:n[0..1]=0` | service `surface`; event `generated` | voxel, mesh3d, tilemap(side) |
| `engine.generate.biomes` | P0 | Climate-driven biome assignment with pinned regions | `biomes:list<obj{id req,temp:[n,n],moist:[n,n],surface:ref:block\|s,sub:ref:block\|s,trees:n[0..1],color:s}>` · `regions:list<obj{zone:ref:zone,biome:s,blend:n m}>` · `blendWidth:n[1..200]m=24` | `biomeAt(x,z)`; P: `biome{biome,who?}` | voxel, mesh3d |
| `engine.generate.caves` | P0 | Carve tunnels and caverns | `density:n[0..1]=0.3` · `minY:i` · `maxY:i` · `worms:i[0..2000]` · `caverns:i[0..200]` · `lavaLevel:i?` · `rooms:list<obj{zone,at?,size:v2}>` (pinned caverns) | `cave` tag cells | voxel, tilemap |
| `engine.generate.ores` | P0 | Vein placement | `veins:list<obj{block:ref:block req,minY:i,maxY:i,size:i[1..64],perChunk:n[0..40],biome?:s}>` | none | voxel, tilemap |
| `engine.generate.roads` | P0 | Connects zones/points with path or road splines; builds the road graph | `links:list<obj{from:ref:zone,to:ref:zone,width:n[1..30]m,surface:s,curviness:n[0..1],bridge:b}>` · `snapToTerrain:b=true` | service `roadgraph(space) → {nodes,edges,lanes}` | voxel, mesh3d |
| `engine.generate.city` | P0 | Districts of blocks, lots, buildings, street grid; contributes to the road graph | `districts:list<obj{zone:ref:zone req,density:n[0..1],floors:[i,i][1..80],style:s,landmarks:list<s>,grid:enum(regular\|organic\|radial)}>` · `block:[i,i]m=[48,48]` · `roadWidth:n[3..24]m=8` · `sidewalk:n m=2` · `interiors:b=false` · `streetProps:list<s>` | `roadgraph`; lots list; `lotAt(x,z)` | voxel, mesh3d |
| `engine.generate.structures` | P0 | Places prefab buildings/camps/ruins/shrines | `place:list<obj{id req,kind:enum(house\|hut\|tower\|camp\|ruin\|shrine\|bridge\|gate\|arena\|cabin\|mine),zone:ref:zone req,count:[i,i]\|at:v2,style:s,size:v2,interior:b,loot:ref:table,spawns:list<ref:archetype>,tags:list<s>}>` | `structures` index (ids→bounds) | voxel, mesh3d, tilemap |
| `engine.generate.scatter` | P0 | Density-based props: trees, rocks, flora, debris | `props:list<obj{model:ref:model\|block:ref:block,per100m2:n[0..50],zones?:list<ref:zone>,biomes?:list<s>,slopeMax:deg,clump:n[0..1],minSpacing:n m,scale:[n,n]}>` | none | voxel, mesh3d, tilemap |
| `engine.generate.water` | P1 | Lakes, rivers, sea at level; flow and fords | `level:n m` · `lakes:i` · `flow:b` | service `waterDepthAt` | voxel, mesh3d |
| `engine.generate.tilemap.rooms` | P0 | Authored-topology 2D rooms generated to spec, guaranteed traversable for the stated abilities | `rooms:list<obj{id req,zone:ref:zone req,rect:[i,i,i,i],style:enum(cave\|hall\|shaft\|arena\|corridor\|village\|flooded),theme:s,platforms:i,gaps:i,hazards:list<s>,features:list<obj{kind,at?,ref?}>,exits:list<obj{side:enum(l\|r\|t\|b),to?:ref:zone,gate?:pred}>}>` · `requiresAbilities:list<s>` (generator proves reachability with these) | `rooms` index; markers (bench, door, chest) | tilemap |
| `engine.generate.dungeon.rooms` | P1 | Room-and-corridor dungeon with lock/key graph | `rooms:i[3..80]` · `branching:n[0..1]` · `keys:list<ref:item>` · `loot:ref:table` · `boss:ref:archetype` | `rooms` index | voxel, mesh3d, grid |
| `engine.generate.graph.world` | P1 | Node maps (sector maps, level selects) | `nodes:i` · `layout:enum(layered\|web\|linear)` · `templates:list<obj{kind,weight,zone}>` | zones+exits | graph |
| `engine.generate.grid.board` | P2 | Boards: tactics maps, lane fields, match-3 fills, hex continents | `kind:enum(tactics\|lanes\|match\|hex-continent)` · `fill:list<obj{piece,weight}>` | cells | grid |

### 3.2 Runtime engine primitives (slot: `systems[]`)

| Id | T | Intent / Params | Provides | Logic | Requires |
| --- | --- | --- | --- | --- | --- |
| `engine.blocks` | P0 | Block registry from `content.blocks` (voxel/tile). `tiers:list<s>=['hand','wood','stone','iron','steel']` · `lightLevels:i=15` | events `cell_changed`; service `blockDef(id)` | — | editCells |
| `engine.time` | P0 | World clock, calendar, timers. `dayLength:n[30..7200]s=1200` · `startHour:n[0..24]=8` · `daysPerSeason:i[1..60]` · `seasons:list<s>` · `scale:n[0..60]=1` · `phases:obj{dawn:n,day:n,dusk:n,night:n}` hours | vars `time.hour` `time.day` `time.season`; events `dawn` `dusk` `midnight` `new_day` `season_change` `timer:*` | P: `daytime{phase?,hour gte/lte,day gte,season?}` `timer{timer,state:running\|done}` · E: `set_time{hour}` `skip_time{hours}` `start_timer{timer,seconds,do:fx}` `cancel_timer{timer}` | — |
| `engine.weather` | P1 | Weather state machine. `states:list<obj{id req,weight:n,minMin:n,maxMin:n,wind:n,temp:n}>` · `byBiome:b` | var `weather`; event `weather_changed` | P: `weather{weather}` · E: `change_weather{weather,lock?:b}` | — |
| `engine.spawner` | P0 | Population by zone/biome/time. `rules:list<obj{id,archetype:ref:archetype req,zone?:ref:zone,biome?:s,count:[i,i],per1000m2:n,when:pred,respawnSec:n,despawnDist:n m,maxAlive:i,surface?:list<ref:block>,near?:s,groupSize:[i,i]}>` · `globalCap:i[10..2000]=300` | events `spawn` `despawn`; var `population` | E: `spawn{archetype,at?,zone?,count?,id?}` `despawn{who\|archetype,zone?}` | position |
| `engine.save` | P0 | Checkpoints and persistence. `auto:b=true` · `intervalSec:n=60` · `slots:i=3` · `keepEditLog:b=true` | events `saved` `loaded`; state `checkpoint` | E: `set_checkpoint{zone?,at?,id?}` `save_game{}` | — |
| `engine.zones` | P0 | Named regions: entry/leave events, discovery, per-zone rules. `discoverRadius:n m=0` · `rulesDefault:obj` | events `enter_zone` `leave_zone` `discovered:*`; var `zone.current` | P: `zone{zone,who?}` (continuous spaces) `discovered{zone}` · E: `discover{zone}` | position |
| `engine.portal` | P0 | Doors/warps between spaces, zones, interiors. `portals:list<obj{id req,from:obj{space?,zone?,at:v2,size:v2},to:obj{space?,zone?,at:v2,facing?:n},gate?:ref:gate\|pred,prompt:s,transition:enum(cut\|fade\|elevator\|load),oneWay:b,key?:ref:item}>` | events `portal_used` `blocked`; action `use_portal` | E: `use_portal{portal,who?}` | position |
| `engine.input.actions` | P0 | Semantic verbs and per-view bindings. `verbs:list<s>` (move look jump sprint crouch use attack alt_attack block dodge aim mine place drive brake handbrake interact talk map menu inventory lockon heal cast dash) · `bindings:obj{view→verb→keys[]}` · `touch:b` | action names for the kernel `step({actions})` | — | — |
| `engine.physics.body` | P0 | Colliders, layers, material for non-character entities (props, pickups, projectiles). `layers:list<s>` · `matrix:list<obj{a,b,collide:b}>` · `friction:n` · `restitution:n` | event `collide{a,b,normal}` | — | overlap |
| `engine.physics.character` | P0 | Kinematic capsule/box controller used by all `gameplay.move.*`. `radius:n m=0.35` · `height:n m=1.8` · `stepHeight:n m=0.4` · `slopeLimit:n[0..89]deg=50` · `skin:n=0.02` | event `landed{speed}` `fell{height}` | — | gravity, overlap |
| `engine.physics.rigid` | P1 | Dynamic rigid bodies, constraints, destruction. `substeps:i` · `maxBodies:i=400` · `sleepSec:n` | events `impact{speed}` | E: `impulse{who,v}` | overlap, gravity |
| `engine.stream` | P1 | Chunk/region streaming, LOD budget, progressive hot-load of generated detail (<1 s first playable). `budgetMs:n[1..16]=6` · `preloadRadius:n` · `unloadRadius:n` | events `region_loaded` | — | position |
| `engine.replay` | P2 | Input recording and ghosts. `maxSec:n` | `ghost` entities | E: `start_ghost{}` | — |
| `engine.assist` | P2 | Accessibility/difficulty modifiers (invincibility, slow game speed, infinite stamina). `options:obj` | var `assist.*` | — | — |

## 4. Plot primitives (`plot.*`)

All plot data lives in `doc.plot` and is read by these primitives.

| Id | T | Intent / Params | Provides | Logic | Reads |
| --- | --- | --- | --- | --- | --- |
| `plot.character` | P0 | Named people/creatures binding identity to archetype, model, dialogue, schedule, home. `spawnAtStart:b=true` · `nameplates:b=true` | events `talked:*`; service `character(id)` | P: `alive{character}` `met{character}` · E: `set_alive{character,alive:b}` | `plot.characters` |
| `plot.storyboard` | P0 | Acts of beats (existing). `sequentialActs:b=true` | events `beat` `act_start` `act_complete` | P: `beat{beat}` `act{act,state:active\|done}` · E: `say{character,text}` | `plot.storyboard` `plot.characters` `plot.endings` |
| `plot.dialogue` | P0 | Node graphs with conditions, choices, effects, skill checks. `lineSpeed:n[0..100]cps=40` · `interruptible:b=true` · `repeatSeen:b=false` | events `dialogue_start` `dialogue_end` `choice_made{dialogue,node,choice}`; action `choose` | P: `said{dialogue,node}` `chose{dialogue,choice}` · E: `start_dialogue{dialogue,with?}` `end_dialogue{}` | `plot.dialogue` |
| `plot.quest` | P0 | One primitive for every quest type, built from objective kinds (§4.2). `maxActive:i[1..50]=20` · `trackOne:b=true` · `failOnDeathOfGiver:b=false` | events `quest_started` `quest_updated` `objective_done` `quest_complete` `quest_failed`; var `quests.active` | P: `quest{quest,state}` `objective{quest,objective,state}` · E: `start_quest` `complete_quest` `fail_quest` `set_objective{quest,objective,state}` `track_quest` | `plot.quests` |
| `plot.gate` | P0 | Named requirement predicates that lock exits, portals, beats, interactables, quests. Gates are data in `plot.gates` | events `gate_opened:*` `gate_blocked:*` | P: `gate{gate,open?:b}` · E: `unlock{gate}` `lock{gate}` (force override) | `plot.gates` |
| `plot.ending` | P0 | Evaluates `plot.endings[].when` each plot tick; first match fires its `do` then `end_game`. `epilogue:b=true` | event `ending_reached` | P: `ending_available{ending}` | `plot.endings` |
| `plot.cutscene` | P1 | Scripted sequences: camera, move, say, wait, fx; skippable. `letterbox:b=true` · `skippable:b=true` | events `cutscene_start` `cutscene_end:*` | E: `play_cutscene{cutscene}` | `plot.cutscenes` |
| `plot.relationship` | P1 | Faction reputation and character affinity. `repRange:[i,i]=[-100,100]` · `decayPerDay:n` | vars `rep.<faction>` `affinity.<character>`; events `rep_changed` `affinity_changed` | P: none (read vars `rep.<faction>`, `affinity.<character>`) · E: `add_rep{faction,delta}` `add_affinity{character,delta}` | `plot.factions` |
| `plot.journal` | P1 | Codex/lore/journal entries gained by effects or collectibles; feeds ui.journal and endings. | events `journal_added` | P: `known{entry}` `entries{tag,gte}` · E: `add_entry{entry}` | `plot.entries` |
| `plot.barks` | P1 | Ambient lines, radio/narrator channels with predicates and cooldowns. `channels:list<s>` | event `bark` | E: `bark{channel?,line}` | `plot.barks` |
| `plot.events.random` | P2 | Weighted text/choice events (FTL, Reigns, radiant quests). `rate:n` | events `random_event` | E: `trigger_event{event}` | `plot.randomEvents` |
| `plot.investigation` | P2 | Clues and deductions; solved when a clue set holds. | events `clue_found:*` `deduced:*` | P: `clue{clue}` · E: `add_clue{clue}` | `plot.clues` |

### 4.1 Plot data shapes

```
characters[]  { id, name, role, archetype?, model: ref:model, home?: ref:zone, faction?, bio?,
                dialogue?: [{ when?: pred, id: ref:dialogue }],           // first match wins
                schedule?: [{ from: hour, to: hour, zone|at, doing: s }], // read by ai.schedule
                shop?: ref-economy shop id, tags?[] }
storyboard    { acts: [ { id, title, summary?, beats: [ { id, title?, when?: pred, after?: beat[], do?: fx, optional?: b } ] } ] }
dialogue{}    id → { speaker: ref:character|'player', start: nodeId,
                nodes: { nodeId: { who?: ref:character, say: s, if?: pred, do?: fx, next?: nodeId, end?: b,
                         choices?: [ { text, if?: pred, do?: fx, next?: nodeId, once?: b, check?: { stat, gte } } ] } } }
quests[]      { id, title, kind: main|side|contract|bounty|challenge, giver?: ref:character, zone?: ref:zone,
                summary, gate?: pred (offered when true), prereq?: ref:quest[], autoStart?: b,
                objectives: [ { id, kind, text, optional?: b, hidden?: b, ...kind fields } ],
                order?: sequential|any (default sequential), fail?: pred, timeLimit?: seconds,
                onStart?: fx, onComplete?: fx, onFail?: fx, rewards?: { xp?, money?, items?: [{item,count}], rep?: [{faction,delta}] },
                repeatable?: b, branches?: [ { id, label, when?: pred } ] }
gates[]       { id, requires: pred, hint: s, locks?: [ 'exit:zone>zone' | 'portal:id' | 'beat:id' | 'interactable:id' ] }
endings[]     { id, title, when: pred, epilogue: s, cutscene?: ref:cutscene, do?: fx, outcome?: won|lost|neutral }
cutscenes{}   id → { steps: [ { camera?: {pos,look,fov,ease,sec}, say?: {character,text}, move?: {who,to,sec}, wait?: s, fx?: fx } ], skippable?: b }
factions[]    { id, name, ranks?: [ {at: rep, title} ], hostileBelow?: rep }
entries[]     { id, title, text, tag?: s }
barks[]       { channel, when?: pred, say: s, character?: ref:character, cooldown?: s, once?: b }
```

### 4.2 Quest objective kinds (fields beyond `id,kind,text,optional,hidden`)

| Kind | Fields | Completes when |
| --- | --- | --- |
| `reach` | `zone` or `at:v2`, `radius?:n` | entity enters zone/radius (`enter_zone`) |
| `collect` | `item`, `count`, `consume?:b` | inventory holds `count` of `item` |
| `deliver` | `item`, `count`, `to: ref:character\|ref:zone` | `give` interaction at target (consumes item) |
| `defeat` | `archetype` or `target: id`, `count`, `zone?` | `defeated:<archetype>` count since objective active |
| `talk` | `character`, `dialogue?`, `node?` | `talked:<character>` (or `said{dialogue,node}`) |
| `escort` | `who: archetype/char`, `to: zone`, `failIfDead:b=true` | escortee reaches zone alive |
| `survive` | `seconds` or `until: pred`, `zone?` | timer elapses with player alive |
| `build` | `block?`, `structure?`, `count`, `zone?` | `block_placed:<block>` ≥ count since active, or structure detected |
| `drive` | `vehicle?: archetype`, `to?: zone`, `distance?:n m`, `maxSeconds?` | vehicle condition met |
| `craft` | `recipe`, `count` | `crafted:<recipe>` |
| `use` | `interactable` or `tag`, `count?` | `used:<interactable>` |
| `discover` | `zone` or `tag`, `count?` | `discovered:*` matches |
| `until` | `when: pred` | predicate true (generic escape hatch: use sparingly) |

## 5. Graphics primitives (`graphics.*`)

Skipped when headless. `Params` are presentation only and never change simulation. Renderers select by space kind.

### 5.1 Renderers, cameras, world look

| Id | T | Intent / Params | Provides | Space/views |
| --- | --- | --- | --- | --- |
| `graphics.render.voxel` | P0 | three.js chunk mesher: greedy meshing, ambient occlusion, per-face shade, frustum + distance cull. `meshBudgetMs:n[1..16]=4` · `ao:b=true` · `lodRings:i[0..3]=1` · `shadows:enum(none\|sun)=sun` | — | voxel / 1p 3p iso |
| `graphics.render.mesh3d` | P0 | three.js scene for mesh3d: terrain patches, instanced props, skinned characters. `shadows:enum(none\|sun\|cascade)=cascade` · `drawDistance:n m=1200` · `instancing:b=true` | — | mesh3d / 1p 3p |
| `graphics.render.tilemap` | P0 | canvas tile renderer with chunk cache and layer order. `pixelSnap:b=true` · `scale:i[1..8]=3` · `layerOrder:list<s>` | — | tilemap |
| `graphics.render.physics2d` | P1 | canvas shapes/sprites for continuous 2D bodies | — | physics2d |
| `graphics.render.grid` | P1 | canvas board: square/hex/iso cells, highlights, move/attack ranges | — | grid |
| `graphics.render.dom` | P1 | DOM/CSS scenes for graph, card and dialogue spaces | — | graph, none |
| `graphics.camera.first-person` | P0 | `fov:n[50..110]deg=75` · `bob:n[0..1]` · `sensitivity:n` · `eyeHeight:n m=1.6` | action `look` | 1p |
| `graphics.camera.third-person` | P0 | Orbit/chase; collision avoid; lock-on framing. `distance:n[1..12]m=4.5` · `height:n m=1.6` · `fov:n=65` · `lockOnBlend:n[0..1]` · `shoulder:enum(left\|right\|center)` · `collide:b=true` | cam state | 3p |
| `graphics.camera.side` | P0 | 2D follow with look-ahead, room bounds, shake. `zoom:n[0.5..8]=1` · `lookAhead:n tiles=2` · `smoothing:n[0..1]=0.15` · `roomLock:b=true` · `deadzone:v2` | — | side |
| `graphics.camera.top-down` | P1 | `zoom:n` · `tilt:n[0..90]deg` · `follow:b=true` | — | td |
| `graphics.camera.isometric` | P1 | `angle:n=35deg` · `zoom:n` · `rotatable:b` | — | iso |
| `graphics.material.palette` | P0 | Block/surface colors, per-face shading, texture-free styles. `colors:obj{id→hex}` · `faceShade:v3=[1,0.6,0.8]` · `style:enum(flat\|noise\|bevel\|toon)=flat` · `emissive:list<s>` | — | any 3D |
| `graphics.sky` | P0 | Sky gradient, sun/moon, stars, clouds, fog, light color by `time.hour`. `palette:obj{dawn,day,dusk,night}` · `fogDensity:n[0..0.05]` · `clouds:n[0..1]` · `sunTilt:n deg` · `stars:b` | reads `time.hour` `weather` | 3D |
| `graphics.lighting.2d` | P1 | Dynamic 2D lights, darkness layers, light-cones around lanterns/torches. `ambient:n[0..1]` · `lights:list<obj{follow?:ref:archetype\|tag,radius:n tiles,color,flicker:n,shadow:b}>` · `darkZones:list<ref:zone>` | var `light.level` | tilemap |
| `graphics.background.parallax` | P0 | Layered 2D backdrops per zone. `layers:list<obj{zone?:ref:zone,depth:n[0..1],pattern:s,color:s,drift:n,fogColor?:s}>` | — | side, td |
| `graphics.audio.synth` | P1 | Procedural SFX and music stems (no assets): cue map by event. `cues:list<obj{event:s,voice:enum(blip\|noise\|chord\|sweep\|pad\|drone),pitch:n,gain:n}>` · `music:list<obj{zone?,when?:pred,mode:s,bpm:n,layers:list<s>}>` | — | any |
| `graphics.fx.feedback` | P1 | Hit-stop, screen shake, flash, vignette, slow-mo. `hitStop:n ms=60` · `shake:n[0..1]` · `damageFlash:b` · `slowmoOn:list<s>` | reacts to events | any |
| `graphics.particles` | P0 | CPU/GPU particles with named presets bound to events/entities. `presets:list<obj{id,shape:enum(dust\|spark\|smoke\|debris\|rain\|snow\|ember\|leaf\|splash\|glow),color:s,count:i,life:n s,speed:n,gravity:n}>` · `bind:list<obj{event:s,preset:s,at?:s}>` · `budget:i[100..20000]=3000` | — | any |
| `graphics.post` | P0 | `bloom:n[0..2]` · `tonemap:enum(none\|aces\|filmic)` · `outline:n px` · `quantize:i? colors` · `vignette:n` · `grain:n` · `scanlines:b` · `ssao:b` | — | any |

### 5.2 Models, sprites, terrain, characters

| Id | T | Intent / Params | Notes |
| --- | --- | --- | --- |
| `graphics.model.voxel` | P0 | Layered palette grids → voxel meshes (characters, mobs, vehicles, props). Model spec in `content.models`: `{kind:'voxel', size:[w,h,d], palette:{k:hex}, parts:[{box:[x,y,z,w,h,d], c:k, name?}], pivots?:obj}`. Params: `voxelSize:n m=0.0625` · `bake:b=true` | parts named for the rig (`head,torso,armL,armR,legL,legR`) enable `rig.humanoid` |
| `graphics.model.lowpoly` | P0 | Composed boxes/cylinders/spheres/cones with materials. Spec: `{kind:'lowpoly', rig?:'humanoid'\|'quadruped'\|s, height:n, build?:{...}, palette:{k:hex}, parts:[{shape:'box'\|'cyl'\|'sphere'\|'cone'\|'cap', at:v3, size:v3, c:k, mat?:'matte'\|'metal'\|'glow', bone?:s}]}`. Params: `segments:i[6..32]=12` · `flatShade:b=true` | vehicles, buildings, characters |
| `graphics.model.mesh` | P2 | Imported or generated glTF. Spec `{kind:'mesh', src}` | needs asset pipeline; excluded from P0 |
| `graphics.sprite.pixel` | P0 | Palette-indexed 2D sprite sets with named animations. Spec: `{kind:'pixel', size:[w,h], palette:{k:hex}, parts:[{rect:[x,y,w,h], c:k, name?}], anims:{name:{frames:i,fps:n,loop:b}}, pivot:v2}`. Params: `outline:s?` · `shadow:b` | generated procedurally from part list |
| `graphics.sprite.vector` | P2 | SVG/canvas shape sprites. `{kind:'vector', svg\|shapes}` | |
| `graphics.tileset.pixel` | P0 | Generated tile art + 47-tile blob autotiling. `tileSize:i=16` · `themes:list<obj{id,palette:{k:hex},pattern:enum(rock\|brick\|moss\|wood\|ice\|metal\|crystal\|soil\|ash),edge:s}>` · `autotile:enum(blob47\|wang16\|none)=blob47` | binds `content.blocks[].tile` to theme |
| `graphics.anim.sprite` | P0 | Plays sprite animations from entity state (idle, run, jump, fall, dash, attack, hurt, die). `map:obj{state→anim}` · `squash:b` · `trail:list<s>` | `side`/`td` |
| `graphics.terrain.procedural` | P0 | Rich 3D outdoor look over mesh3d heightfield: LOD patches, slope/height/biome splat materials, vegetation instancing, water plane, atmosphere. `lodLevels:i[1..6]=4` · `patch:i[16..256]m=64` · `splat:list<obj{biome\|slope:[deg,deg]\|height:[m,m],color:s,roughness:n}>` · `grass:obj{density,height,windSway}` · `water:obj{level,color,foam:b,reflect:b}` · `fog:obj{near,far,color}` | reads `engine.generate.biomes` |
| `graphics.foliage.scatter` | P1 | Instanced trees/grass/rocks from `generate.scatter` models with wind. `windSway:n` · `lodDistance:n` · `cull:n` | |
| `graphics.rig.humanoid` | P0 | Procedural humanoid skeleton (≈20 bones) built and skinned to a model's tagged parts. `scale:n` · `proportions:obj{legs,arms,torso,head}` · `attach:list<obj{bone,slot,model}>` (weapons, backpack, lantern) | required by `anim.*` on humanoids |
| `graphics.rig.quadruped` | P0 | Four-legged skeleton (spine, 4×2 bone legs, neck, tail) for horses, dogs, deer. `legLength:n` · `bodyLength:n` · `saddle:b` | |
| `graphics.rig.custom` | P2 | Author-defined bone trees (creatures, bosses): `bones:list<obj{id,parent,at:v3}>` | |
| `graphics.anim.clips` | P0 | Procedural/keyframe clips (idle, attack swings, hurt, die, emote, interact, mount, drink) with events at frames (`hit`, `step`, `release`). `clips:list<obj{id,rig,dur:n s,keys:json,events:list<obj{t,event}>}>` or `presets:list<s>` | |
| `graphics.anim.locomotion` | P0 | Blend tree over speed, direction, grounded, slope; root-motion optional. `idleWalkRun:[n,n]m/s` · `turnLean:n` · `strafe:b` · `states:list<s>` | needs `anim.clips` |
| `graphics.anim.ik` | P0 | Two-bone and FABRIK solvers: foot placement on terrain (`surface`), hand reach for climb/interact, look-at, aim, riding pose. `foot:b` · `hand:b` · `lookAt:obj{maxYaw,maxPitch,targets:list<s>}` · `pelvisAdjust:b` · `iterations:i[1..16]=8` | requires `surface` for foot IK |
| `graphics.anim.secondary` | P1 | Spring bones for hair, capes, tails, straps; cloth proxies. `chains:list<obj{bones,stiffness,damping}>` | |
| `graphics.anim.ragdoll` | P1 | Death/knockback ragdoll with blend-in from animation. `onDeath:b` · `maxActive:i=8` · `fadeSec:n` | needs `engine.physics.rigid` |

### 5.3 UI

| Id | T | Intent / Params |
| --- | --- | --- |
| `graphics.ui.hud` | P0 | Widgets bound to vars/resources/state: `meters:list<obj{pool,color,pos}>` · `counters:list<obj{var\|item,icon,pos}>` · `stars:obj{var,max}` (wanted) · `prompt:b` (interact prompt) · `compass:b` · `clock:b` · `status:b` · `bossBar:b` · `crosshair:enum(none\|dot\|cross)` |
| `graphics.ui.dialogue` | P0 | Dialogue box, portraits (model busts), choices, typewriter, subtitle mode for barks. `portrait:b` · `style:s` |
| `graphics.ui.journal` | P0 | Quest log (tracked/available/complete), lore codex, map notes. `tabs:list<enum(quests\|lore\|bestiary\|characters\|notes)>` |
| `graphics.ui.minimap` | P0 | Radar/minimap: zone shape, markers by tag, quest pins, road overlay. `radius:n m` · `rotate:b` · `shape:enum(circle\|square)` · `markers:list<obj{tag,icon,color}>` |
| `graphics.ui.map` | P0 | Full world map with discovery fog, fast travel, pins, region labels. `fog:b` · `fastTravel:b` · `layers:list<s>` |
| `graphics.ui.inventory` | P0 | Grid/list inventory, equipment doll, crafting and charm loadout panels, container/shop trade panels. `panels:list<enum(items\|equipment\|crafting\|loadout\|container\|shop\|skills)>` · `sort:b` |
| `graphics.ui.cards` | P2 | Card hand/board/deck-builder layouts (for `gameplay.cards`). |
| `graphics.ui.menu` | P1 | Title/pause/settings/save slots. `slots:i` |

## 6. Gameplay primitives (`gameplay.*`)

All gameplay primitives are systems over the ECS. Unless stated, they work for any entity with the matching component (player or NPC). Column **Req** = required space capabilities (`caps:`) or primitives.

### 6.1 Movement and interaction

| Id | T | Intent / Params | Provides | Logic | Req / views |
| --- | --- | --- | --- | --- | --- |
| `gameplay.move.walk` | P0 | Ground locomotion: walk/run/sprint/crouch/jump in 3D or top-down. Feel presets. `walk:n[0.5..8]m/s=3` · `run:n=6` · `sprint:n=8` · `crouch:n=1.5` · `jump:n[0..12]m/s=6` · `airControl:n[0..1]=0.4` · `accel:n m/s²=40` · `coyoteMs:n=80` · `preset:enum(arcade\|realistic\|floaty)` · `sprintCost:n/s` (draws `stamina` pool) | events `jumped` `landed` `sprint_start` `sprint_end` | action `move`; P: `moving` | caps: gravity, overlap · 1p 3p td |
| `gameplay.move.platformer` | P0 | Side-view platforming with ability-gated verbs. `run:n tiles/s=9` · `accel:n` · `jump:n=22` · `jumpCut:n[0..1]=0.5` · `gravityScale:n=1` · `fallMax:n=30` · `coyoteMs:n=90` · `bufferMs:n=100` · `abilities:obj{doubleJump:b,dash:b,wallSlide:b,wallJump:b,wallClimb:b,glide:b,swim:b,crouch:b}` (each default false; granted by `unlock_ability`) · `doubleJumps:i[0..3]=1` · `dash:obj{speed,sec,cooldown,airOnce:b,iframes:n s}` · `wallSlide:n tiles/s` · `wallClimbStamina:n/s?` | events `jumped` `double_jumped` `dashed` `wall_jumped` `landed` | P: `ability{ability}` via progression.abilities | caps: gravity, overlap · side |
| `gameplay.move.climb` | P0 | Ladders and free surface climbing with stamina. `speed:n m/s=1.4` · `surfaces:enum(ladders\|any\|tagged)` · `staminaCost:n/s` · `slipMin:deg` · `ledgeGrab:b` | events `climb_start` `climb_end` `ledge_grab` | — | caps: raycast, overlap; resources `stamina` · 3p |
| `gameplay.move.swim` | P1 | Buoyancy, dive, breath. `speed:n` · `breath:n s` · `drownDps:n` | events `submerged` `surfaced` | — | caps: surface or editCells · 1p 3p |
| `gameplay.move.fly` | P1 | Free flight (creative mode, jetpack, wings). `speed` · `fuel?` | — | — | caps: gravity |
| `gameplay.move.glide` | P1 | Paraglider/wing-suit descent. `fallSpeed:n` · `staminaCost` | — | — | caps: gravity · 3p |
| `gameplay.move.dodge` | P0 | Roll/dash/backstep with i-frames, cost and recovery. `distance:n m=3` · `sec:n=0.45` · `iframes:[n,n]s` · `cost:n stamina` · `directions:enum(any\|back\|facing)` | events `dodged` | — | caps: gravity · 3p side td |
| `gameplay.move.grapple` | P2 | Grapple/web swing. `range` · `ropeLen` | — | — | caps: raycast, gravity |
| `gameplay.mount` | P0 | Mountable creatures: bond, speed, stamina, call whistle, gaits. `walk:n m/s=3` · `trot:n=7` · `gallop:n=14` · `staminaMax:n=100` · `bondGain:n/min` · `callRange:n m=120` · `jumpHeight:n m` · `fightMounted:b=false` | events `mounted` `dismounted` `mount_called` | P: `mounted{mount?}` · E: `mount{mount,who?}` `dismount{}` `call_mount{}` | caps: gravity, pathfind · 3p |
| `gameplay.interact` | P0 | Contextual use: talk, pick up, open, sit, pull, read, harvest, loot. `range:n m=2.5` · `facingOnly:b` · `holdMs:n` · `prompts:b=true` | action `interact`; events `used:*` `interacted` | P: `used{interactable}` · E: `interact{who,target}` `enable_interactable{id,on:b}` | caps: overlap |
| `gameplay.rest` | P0 | Sleep, rest, wait, meditate at beds/benches/campfires: time skip, heal, save. `healFull:b` · `skipTo:s?` · `safeRequired:b` · `respawnsEnemies:b` | events `rested` | E: `rest{hours?}` | engine.time |
| `gameplay.checkpoint` | P0 | Bench/bonfire/spawn points: set respawn, restore resources, reset ambient enemies. `restoreAll:b` · `respawnEnemies:b` · `fastTravelBetween:b` | events `checkpoint_set` | P: `at_checkpoint{checkpoint}` · E: `set_checkpoint` (from engine.save) | engine.save |
| `gameplay.collectible` | P0 | Pickups and counters (coins, shards, pages): magnet, collect rules, per-zone counts, persistent. `magnet:n m` · `counters:list<obj{id,var,total:i,zone?}>` | events `collected:*`; vars per counter | P: `collected{counter,gte..}` | caps: overlap |
| `gameplay.mechanism` | P0 | Doors, levers, plates, breakable walls, lifts, timers wired by signals. `mechanisms:list<obj{id req,kind:enum(door\|lever\|plate\|breakable\|lift\|gate\|trap\|timer),at:v2,size:v2,signal?:s,opens?:list<s>,gate?:ref:gate\|pred,hits:i,sec:n,persist:b}>` | events `triggered:*` `opened:*` `broken:*` | P: `mechanism{mechanism,state}` · E: `trigger{mechanism}` `set_mechanism{mechanism,state}` | caps: overlap |
| `gameplay.hazard` | P0 | Damage volumes and falls: spikes, lava, acid, drowning, fall damage, kill planes. `types:list<obj{id,damage:n,dps:n,status?:ref:status,respawn:enum(checkpoint\|nearest-safe)}>` · `fallDamage:obj{minHeight,perMeter}` | events `hazard_hit` | — | caps: overlap |

### 6.2 Blocks, items, economy

| Id | T | Intent / Params | Provides | Logic | Req |
| --- | --- | --- | --- | --- | --- |
| `gameplay.blocks.mine` | P0 | Break cells with tool tiers, hardness time, drops. `reach:n m=5` · `hardnessScale:n=1` · `drops:b=true` · `autoCollect:b` · `fx:b` | events `block_mined:*` `block_mined` | P: `mined{block,gte}` (counts) | caps: editCells, raycast |
| `gameplay.blocks.place` | P0 | Place held block items; ghost preview; protected regions. `reach:n=5` · `protect:list<ref:zone>` · `snap:b` · `forbidNear:list<s>` | events `block_placed:*` | E: `set_blocks{box:[v3,v3],block}` (scripted edit) | caps: editCells, raycast |
| `gameplay.blocks.fluid` | P2 | Water/lava flow rules. | — | — | caps: editCells |
| `gameplay.blocks.logic` | P2 | Wire/redstone-like signal blocks. | — | — | caps: editCells |
| `gameplay.inventory` | P0 | (existing) Stacked item bags. `slots:i[1..1000]=36` · `start:list<{item,count}>` | events `item_gained` `item_lost` `inventory_full` | P: `item{item,who?,gte..}` · E: `give_item` `take_item` | — |
| `gameplay.item.use` | P0 | Consumables and usable items: food, potions, tools, scrolls; cooldowns. Item `use:{fx, cooldown, consume}` in content | events `used_item:*` | E: `use_item{item,who?}` | inventory |
| `gameplay.equipment` | P0 | Equip slots with stat modifiers, durability, loadout budgets (charm notches). `slots:list<obj{id,accepts:list<s>,max:i}>` · `budget:obj{pool,total}` (charm notches) · `durability:b` · `statMods:b` | events `equipped` `unequipped` `broke:*`; vars `stat.*` | P: `equipped{item}` · E:  `equip{item,slot?}` `unequip{slot}` `repair{item}` | inventory |
| `gameplay.crafting` | P0 | Recipes at stations; tag-based inputs; cooking-style merge. `stations:list<obj{id,name,tags,zone?}>` · `handCraft:b` · `queue:b` · `merge:obj{enabled,stat}` · `discover:enum(known\|learned\|experiment)` | events `crafted:*` | P: `knows{recipe}` · E: `learn_recipe{recipe}` `craft{recipe,count?}` | inventory |
| `gameplay.container` | P1 | Chests, corpses, barrels, shop shelves. `slots:i` · `lockable:b` | events `opened:*` | E: `open_container{container}` | inventory, interact |
| `gameplay.loot` | P0 | Loot tables for drops, chests, fishing. Tables in `content.tables`: `{id, rolls:[i,i], entries:[{item,weight,count:[i,i],when?:pred}]}` | events `loot_dropped` | E: `drop_loot{table,at?,who?}` | inventory |
| `gameplay.economy` | P0 | Currencies, shops, prices, buy/sell spread, rarity, bounty/pay. `currencies:list<obj{id,name,var}>` · `shops:list<obj{id,owner:ref:character,stock:list<obj{item,count,price?}>,restock:enum(daily\|weekly\|never),buys:list<s>,markup:n[0.5..3]}>` · `sellRatio:n[0..1]=0.4` · `haggle:b` | vars `money.<id>`; events `bought` `sold` `paid` | P: none (var `money.<id>`) · E: `give_money{amount,currency?}` `take_money{amount,currency?}` `open_shop{shop}` | inventory |
| `gameplay.farming` | P1 | Till, plant, water, grow by season/day, harvest. `crops:list<obj{item,days:i,seasons:list<s>,yield}>` | events `planted` `harvested:*` | — | engine.time; caps: editCells |
| `gameplay.build.structure` | P1 | Snap-together bases, settlement slots, plot ownership. `pieces:list<s>` · `ownership:b` | events `built:*` | — | caps: editCells |

### 6.3 Combat, resources, status

| Id | T | Intent / Params | Provides | Logic | Req |
| --- | --- | --- | --- | --- | --- |
| `gameplay.resource` | P0 | Named pools (stamina, mana, soul, focus, oxygen): max, regen, drain, lockout. Pool defs: `pools:list<obj{id req,max:n,regen:n/s,regenDelay:n s,startFull:b,exhaustLock:b,drainTags:list<s>}>` | events `depleted:*` `restored:*`; vars `res.<id>` `res.<id>.max` | P: `resource{resource,who?,gte..}` · E: `spend{resource,amount}` `gain{resource,amount}` `set_max{resource,value}` | — |
| `gameplay.combat.health` | P0 | HP, damage types, resistances/armor, i-frames, death/revive/respawn. `types:list<s>=['phys','fire','ice','shock','poison','void']` · `iframes:n s=0.5` · `regenDelay:n` · `friendlyFire:b=false` · `knockback:n` · `corpse:b` | events `damaged` `healed` `died` `defeated` + `defeated:*`; vars `hp` `hp.max` | P: `health{who?,gte..}` `alive{who}` · E: `damage{who,amount,type?}` `heal{who,amount}` `kill{who}` `revive{who}` | — |
| `gameplay.combat.melee` | P0 | Swing hitboxes with windup/active/recover, combos, heavy attacks, block/parry, pogo, stamina cost, hit-stop. `weapons` come from item `weapon:{damage,reach,arc,speed,stamina,combo,type}` · `comboWindowMs:n=450` · `parry:obj{window:n ms,stagger:n s,riposte:n×}` · `block:obj{reduction:n[0..1],staminaPerDmg:n}` · `pogo:b` (downward strike bounce, side) · `hitStopMs:n` · `poise:b` | events `attack_started` `hit` `parried` `blocked` `staggered` | P: `in_combat{who?}` | caps: overlap |
| `gameplay.combat.projectile` | P0 | Arrows, bolts, thrown items, spells, bullets: ballistics, pierce, homing, ammo. Weapon `ranged:{projectile,speed,gravity,spread,ammo,draw}` · `maxLive:i=64` · `friendly:b=false` | events `fired` `projectile_hit` | — | caps: raycast, overlap |
| `gameplay.combat.target` | P0 | Lock-on/target select: cycle, soft-lock, camera binding, strafe. `range:n m=20` · `fov:n deg` · `switchOnDeath:b` · `breakDist:n m` | var `target`; events `locked` `unlocked` | P: `locked{who?}` | caps: raycast · 3p |
| `gameplay.combat.status` | P1 | Buffs/debuffs: burning, poison, slow, stun, regen, charm effects. Defs in `content.statuses`: `{id,duration,tick:{dps,type},mods:{stat:delta},stacks:i,tags}` | events `status_applied:*` `status_ended:*` | P: `status{status,who?}` · E: `apply_status{who,status,sec?}` `clear_status{who,status?}` | combat.health |
| `gameplay.combat.boss` | P0 | Authored encounters: arena lock, health bar, phase table keyed on hp thresholds or predicates, adds, enrage, reward. `bosses:list<obj{id req,archetype:ref:archetype req,arena:ref:zone,phases:list<obj{at:n[0..1],pattern:list<s>,speed:n,summon?:list<ref:archetype>,fx?:fx}>,onStart:fx,onDefeat:fx,rewards:obj,gate:b}>` · `retryReset:b=true` | events `boss_start:*` `boss_phase:*` `boss_defeated:*`; vars `boss.hp` | P: `boss{boss,state:idle\|active\|defeated}` · E: `start_boss{boss}` | ai.attacks |
| `gameplay.combat.stealth` | P1 | Detection meters, noise, light, silent takedowns. `sightRange` · `crouchFactor` · `takedown:b` | events `detected` `lost_target` `takedown` | P: `detected{who?}` | ai.brain |
| `gameplay.combat.cover` | P2 | Cover snapping and cover bonus (shooters/tactics). | — | — | caps: raycast |
| `gameplay.combat.aim` | P2 | Slow-motion targeting and hit-chance selection (V.A.T.S./Dead Eye). | — | — | — |
| `gameplay.element` | P1 | Chemistry: element tags on objects/surfaces and reaction rules (fire burns grass, water extinguishes, electric conducts). `reactions:list<obj{a,b,result:fx,spread:n}>` | events `reaction:*` | E: `ignite{at,r}` | caps: overlap |
| `gameplay.vision.mode` | P1 | Detective/sense overlay that reveals tagged entities & traces. `range` · `tags:list<s>` · `cooldown` | events `scan` | P: `scanned{target}` | — |

### 6.4 AI

| Id | T | Intent / Params | Provides | Logic | Req |
| --- | --- | --- | --- | --- | --- |
| `gameplay.ai.brain` | P0 | Behavior selector per archetype `ai` component: ordered behavior list with predicates; behavior kinds `wander patrol chase flee follow guard flyer circle ambush sit work`. Includes perception (sight cone, hearing, memory), aggro leashes and group alert. `tick:n s=0.2` · `maxActive:i=120` (distance LOD) · `perception:obj{sight:n m,fov:n deg,hearing:n m,memory:n s}` | events `aggro` `lost_target` `alerted` | P: `aware{who}` · E: `set_ai{who,mode}` `command{who,order}` | caps: pathfind |
| `gameplay.ai.attacks` | P0 | Telegraphed attack patterns for `attacks` component: `{id,range,windup,active,recover,damage,type,shape,move,projectile?,weight,when?}`; sequencing and cooldown selection; used by bosses/enemies. `telegraph:b=true` · `globalCooldown:n s` | events `telegraph` `attack_launched` | — | combat.health, overlap |
| `gameplay.ai.schedule` | P0 | NPCs follow `character.schedule` by `time.hour`: travel, perform activity, sleep; interrupts for combat/dialogue. `travel:enum(walk\|teleportOffscreen)` · `offscreenTeleport:b` | events `arrived` `departed` | E: `set_schedule{character,schedule}` | engine.time, caps: pathfind |
| `gameplay.ai.traffic` | P0 | Vehicles drive lanes on the road graph with lights, yielding, panic, density by hour and zone. `density:n[0..1]` · `maxCars:i` · `speed:n km/h` · `lanes:b` · `lights:b` · `panic:b` · `archetypes:list<obj{archetype,weight}>` | events `traffic_collision` | — | roadgraph service, vehicle.core |
| `gameplay.ai.crowd` | P1 | Pedestrians on sidewalks/paths: flow, avoid, react (flee gunfire), density by hour. `density:n` · `archetypes:list<obj{archetype,weight}>` · `panic:b` | events `witness` | — | roadgraph or caps: pathfind |
| `gameplay.ai.flock` | P2 | Boids for birds, fish, herds. | — | — | — |
| `gameplay.ai.director` | P2 | Pacing director adjusting spawns/intensity. | — | — | — |

### 6.5 Vehicles

| Id | T | Intent / Params | Provides | Logic | Req |
| --- | --- | --- | --- | --- | --- |
| `gameplay.vehicle.core` | P0 | Seats, enter/exit, ownership/theft, damage, fuel, horn, radio. Archetype `vehicle:{seats,health,fuel,model}` · `enterRange:n m=3` · `theftDifficulty:n` · `damage:b` | events `vehicle_entered` `vehicle_exited` `vehicle_destroyed` `vehicle_stolen` | P: `in_vehicle{kind?}` · E: `enter_vehicle{who,vehicle}` `exit_vehicle{who}` | caps: overlap |
| `gameplay.vehicle.car` | P0 | Wheeled handling: engine/gears simplified, grip, handbrake, drift, suspension, optional boost/drift-boost (kart preset). `preset:enum(arcade\|sim\|kart)` · Archetype `car:{maxSpeed:km/h,accel:n,grip:n[0..2],mass:kg,steer:deg,brake:n,drift:b,boost:obj}` | events `crash{speed}` `drift` | — | caps: gravity, overlap, raycast; vehicle.core |
| `gameplay.vehicle.boat` | P1 | Buoyancy and water drag. | events `docked` | — | caps: surface; vehicle.core |
| `gameplay.vehicle.aircraft` | P1 | Lift/thrust simplified flight, takeoff/landing. | events `airborne` `landed` | — | caps: gravity; vehicle.core |
| `gameplay.race` | P1 | Checkpoints, laps, timers, ghosts, positions. `laps:i` · `checkpoints:list<ref:zone>` | events `lap` `race_finished` | P: `race{race,state}` | vehicle.core |

### 6.6 Progression and systems

| Id | T | Intent / Params | Provides | Logic | Req |
| --- | --- | --- | --- | --- | --- |
| `gameplay.progression.level` | P0 | XP, levels, stat points, curve. `curve:obj{base:n,growth:n}` · `maxLevel:i[1..200]` · `pointsPerLevel:i` · `stats:list<obj{id,base:n,perPoint:n}>` · `xpSources:list<obj{event:s,xp:n}>` | events `level_up`; vars `level` `xp` `stat.*` | P: none (vars `level` `xp`) · E: `give_xp{amount}` `add_stat{stat,delta}` | — |
| `gameplay.progression.abilities` | P0 | Ability registry: unlocks gate verbs and plot. `abilities:list<obj{id req,name,desc,grants:list<s>,requires?:pred}>` · `start:list<s>` | events `ability_unlocked:*` | P: `ability{ability}` · E: `unlock_ability{ability}` `lock_ability{ability}` | — |
| `gameplay.progression.tree` | P1 | Perk/skill tree with prerequisites and point costs; use-based skill XP option. `nodes:list<obj{id,cost,requires:list<s>,mods:obj}>` · `useBased:b` | events `perk_unlocked:*` | P: `perk{perk}` · E: `unlock_perk{perk}` | progression.level |
| `gameplay.wanted` | P0 | Crime heat, witnesses, escalating law response, decay, hiding, bribe/surrender. `levels:i[1..6]=5` · `crimes:obj{kind→heat}` · `witnessRange:n m` · `decayPerSec:n` · `hideSec:n` · `response:list<obj{level,archetype,count,vehicle?,roadblock:b}>` · `safeZones:list<ref:zone>` · `bribe:obj{cost:n/level}` | var `wanted`; events `crime{kind}` `wanted_changed{from,to}` `busted` `escaped` | P: none (var `wanted`) · E: `set_wanted{level}` `add_wanted{delta}` `report_crime{kind}` | ai.brain, caps: pathfind |
| `gameplay.death` | P0 | Death rules: respawn point, penalty (drop currency/items, corpse run), fade, game over option. `respawn:enum(checkpoint\|hospital\|zone)` · `penalty:obj{dropCurrency:n[0..1],corpse:b,keepItems:b,loseXp:n}` · `retrieveSec:n?` | events `player_died` `retrieved` | P: none | combat.health, engine.save |
| `gameplay.minigame` | P2 | Sub-mode launcher (fishing, lockpicking, hacking, card duel) pausing the main loop. `games:list<s>` | events `minigame_end:*` | E: `start_minigame{game}` | — |
| `gameplay.cards` | P1 | Deck, hand, energy/mana, effects, enemy intents; board and duel formats. `zones:list<s>` · `energy:i` · `handSize:i` · `cards` in `content.cards` | events `card_played` `turn_end` | P: `card_owned` | space none |
| `gameplay.turns` | P1 | Turn order, action points, phases, overwatch, hit chance, permadeath option. `order:enum(alternate\|initiative\|simultaneous)` · `ap:i` · `hitChance:b` · `overwatch:b` | events `turn_start` `turn_end` | P: `turn{who}` | space grid |
| `gameplay.waves` | P1 | Wave scripts for defense games and arenas. `waves:list<obj{at:n s,spawn:list<obj{archetype,count,lane?}>}>` | events `wave_start` `wave_clear` | P: `wave{gte..}` | engine.spawner |
| `gameplay.match` | P2 | Match-N swap/cascade/specials with move limits. | events `matched` `cascade` | — | space grid |
| `gameplay.rts` | P2 | Unit selection, orders, production queues, fog of war, resource nodes. | — | — | caps: pathfind |
| `gameplay.creature.catch` | P1 | Encounter, capture odds, party storage. `ballItems:list<ref:item>` | events `caught:*` | E: `give_creature{archetype}` | inventory |
| `gameplay.creature.battle` | P1 | Turn-based battle sub-mode on `none` space: moves, types, XP. | events `battle_end` | — | gameplay.turns or cards |
| `gameplay.automation` | P2 | Belts, inserters, machines, throughput. | — | — | caps: editCells |
| `gameplay.rewind` | P2 | Time rewind with per-entity time rules (Braid). `maxSec` | — | — | snapshot |
| `gameplay.portal` | P2 | Placeable linked portals with momentum conservation. | — | — | caps: raycast |
| `gameplay.sports` | P2 | Ball/goal/score/match clock. | events `goal` | — | physics2d or mesh3d |

## 7. Predicate and effect vocabulary

**Scalar state is read with `var`, not dedicated predicates.** Primitives publish vars: `level` `xp` `stat.<id>` `hp` `hp.max` `res.<pool>` `res.<pool>.max` `money.<currency>` `rep.<faction>` `affinity.<character>` `wanted` `time.hour` `time.day` `time.season` `weather` `zone.current` `boss.hp` `quests.active` `population`, always for the player (`who` variants use the predicates below). Write the predicate's kind key first (`{"quest":"q","state":"active"}`): the kernel takes the first registered key as the kind.

Kernel built-ins: predicates `all any not var count flag time`; effects `set_flag clear_flag set_var add_var emit end_game`. Everything else is registered by the owner. Predicate fields in braces; comparators `gte lte gt lt eq ne` apply wherever a number is read. `who` defaults to `"player"`.

### Predicates

| Kind | Registered by | Fields |
| --- | --- | --- |
| `zone` | engine.zones / space.graph | `zone`, `who?` |
| `discovered` | engine.zones | `zone` |
| `biome` | generate.biomes | `biome`, `who?` |
| `beat` | plot.storyboard | `beat` |
| `act` | plot.storyboard | `act`, `state?: active\|done` |
| `quest` | plot.quest | `quest`, `state: available\|active\|complete\|failed` |
| `objective` | plot.quest | `quest`, `objective`, `state: active\|done` |
| `said` | plot.dialogue | `dialogue`, `node` |
| `chose` | plot.dialogue | `dialogue`, `choice` (choice node id) |
| `met` / `alive` | plot.character | `character` |
| `gate` | plot.gate | `gate`, `open?` |
| `ending_available` | plot.ending | `ending` |
| `known` | plot.journal | `entry` |
| `entries` | plot.journal | `tag` + comparator (count of entries with tag) |
| `item` | gameplay.inventory | `item`, `who?` + comparator |
| `equipped` | gameplay.equipment | `item` (or charm id), `who?` |
| `knows` | gameplay.crafting | `recipe` |
| `ability` | gameplay.progression.abilities | `ability`, `who?` |
| `perk` | gameplay.progression.tree | `perk` |
| `health` | gameplay.combat.health | `who?` + comparator (fraction when `frac:true`) |
| `resource` | gameplay.resource | `resource`, `who?` + comparator |
| `status` | gameplay.combat.status | `status`, `who?` |
| `locked` | gameplay.combat.target | `who?` |
| `boss` | gameplay.combat.boss | `boss`, `state` |
| `mounted` | gameplay.mount | `mount?` |
| `in_vehicle` | gameplay.vehicle.core | `kind?` |
| `used` | gameplay.interact | `interactable` (count via comparator) |
| `mechanism` | gameplay.mechanism | `mechanism`, `state` |
| `collected` | gameplay.collectible | `counter` + comparator |
| `at_checkpoint` | gameplay.checkpoint | `checkpoint` |
| `daytime` | engine.time | primary value is the phase: `{daytime:"night"}` (`dawn\|day\|dusk\|night`); hour/day/season use vars `time.hour` `time.day` `time.season` |
| `timer` | engine.time | `timer`, `state: running\|done` |
| `weather` | engine.weather | `weather` |
| `aware` / `detected` | gameplay.ai.brain / combat.stealth | `who?` |
| `in_combat` | gameplay.combat.melee | `who?` |
| `cell` | engine.space.* (editCells) | `{cell: v3, block}` |
| `near` | engine.space.* (distance) | `{near: <entity id\|archetype\|zone>, within, who?}` |

### Effects

| Kind | Registered by | Fields |
| --- | --- | --- |
| `teleport` | spaces | `who?`, `zone` or `at`, `space?` |
| `move_to` | spaces (pathfind) | `who`, `zone` or `at`, `run?:b` |
| `spawn` / `despawn` | engine.spawner | `archetype`, `at?`, `zone?`, `count?`, `id?` / `who\|archetype`, `zone?` |
| `give_item` / `take_item` | gameplay.inventory | `item`, `count?`, `who?` |
| `use_item` | gameplay.item.use | `item`, `who?` |
| `equip` / `unequip` / `repair` | gameplay.equipment | `item`, `slot?` |
| `learn_recipe` / `craft` | gameplay.crafting | `recipe`, `count?` |
| `drop_loot` | gameplay.loot | `table`, `at?` |
| `give_money` / `take_money` | gameplay.economy | `amount`, `currency?` |
| `open_shop` | gameplay.economy | `shop` |
| `damage` / `heal` / `kill` / `revive` | gameplay.combat.health | `who`, `amount?`, `type?` |
| `apply_status` / `clear_status` | gameplay.combat.status | `who`, `status`, `sec?` |
| `spend` / `gain` / `set_max` | gameplay.resource | `resource`, `amount` / `value` |
| `give_xp` / `add_stat` | gameplay.progression.level | `amount` / `stat`,`delta` |
| `unlock_ability` / `lock_ability` | gameplay.progression.abilities | `ability` |
| `unlock_perk` | gameplay.progression.tree | `perk` |
| `start_quest` / `complete_quest` / `fail_quest` / `track_quest` | plot.quest | `quest` |
| `set_objective` | plot.quest | `quest`, `objective`, `state` |
| `start_dialogue` / `end_dialogue` | plot.dialogue | `dialogue`, `with?` |
| `play_cutscene` | plot.cutscene | `cutscene` |
| `say` | plot.storyboard | `character`, `text` |
| `bark` | plot.barks | `channel?`, `line` |
| `unlock` / `lock` | plot.gate | `gate` |
| `add_rep` / `add_affinity` | plot.relationship | `faction`,`delta` / `character`,`delta` |
| `add_entry` | plot.journal | `entry` |
| `set_alive` | plot.character | `character`, `alive` |
| `set_schedule` | gameplay.ai.schedule | `character`, `schedule` |
| `set_ai` / `command` | gameplay.ai.brain | `who`, `mode` / `order` |
| `mount` / `dismount` / `call_mount` | gameplay.mount | `mount?` |
| `enter_vehicle` / `exit_vehicle` | gameplay.vehicle.core | `who`, `vehicle` |
| `interact` / `enable_interactable` | gameplay.interact | `target` / `id`,`on` |
| `trigger` / `set_mechanism` | gameplay.mechanism | `mechanism`, `state?` |
| `set_wanted` / `add_wanted` / `report_crime` | gameplay.wanted | `level` / `delta` / `kind` |
| `start_boss` | gameplay.combat.boss | `boss` |
| `use_portal` | engine.portal | `portal` |
| `set_blocks` | gameplay.blocks.place | `box`, `block` |
| `set_time` / `skip_time` / `start_timer` / `cancel_timer` | engine.time | see §3.2 |
| `change_weather` | engine.weather | `weather` |
| `set_checkpoint` / `save_game` | engine.save | `zone?`,`at?` |
| `discover` | engine.zones | `zone` |
| `rest` | gameplay.rest | `hours?` |
| `notify` | graphics.ui.hud (headless: event only) | `text`, `kind?: info\|quest\|warn` |
| `play_sound` / `shake` | graphics.audio.synth / fx.feedback (headless: event only) | `cue` / `amount` |

## 8. Content schemas (`doc.content`)

```
items[]       { id, name, kind: material|tool|weapon|armor|food|potion|key|quest|currency|charm|ammo|block|misc,
                tags?[], stack?: i, value?: n, desc?, use?: { fx, cooldown?, consume?: b },
                weapon?: { damage, reach, arc, speed, stamina, combo, type, durability? }, ranged?: {...},
                armor?: { slot, def:{type:n}, durability? }, tool?: { kind, tier }, block?: ref:block,
                charm?: { cost, mods:{stat:delta}, fx? }, stats?: {stat: delta}, ingredient?: { tags[], effects{} } }
recipes[]     { id, station?, inputs: [ { item | tag, count } ], output: { item, count }, time?: s, learned?: bool|flag, merge?: bool }
blocks[]      { id, name, color, solid, hardness, tool?: kind, tier?: i, drops?: [{item,count,p?}], light?: i, transparent?: b, tags?[], tile?: s }
archetypes[]  { id, kind: player|npc|creature|enemy|boss|vehicle|prop|projectile|pickup|mount, components: {…} }
tables[]      { id, rolls: [i,i], entries: [ { item, weight, count?: [i,i], when?: pred } ] }
statuses[]    { id, duration, tick?: {dps,type}, mods?: {stat:delta}, stacks?: i }
models{}      id → graphics.model/sprite spec (§5.2)
structures[]  (optional, read by generate.structures) prefab overrides
```

## 9. Coverage matrix: 55 games

Ids omit the family prefix (`space.voxel` = `engine.space.voxel`; `quest` = `plot.quest`; `ui.hud` = `graphics.ui.hud`; `ai.brain` = `gameplay.ai.brain`). Ubiquitous in every row and omitted: `time`, `save`, `zones`, `input.actions`, `character`, `storyboard`, `dialogue`, `ending`, `ui.hud`, `inventory`, `combat.health`, `level` where applicable. Tier is the highest-tier primitive the row needs. **Gap** = cannot be expressed by this catalog yet.

| # | Game | Primitives | Tier | Gap / status |
| --- | --- | --- | --- | --- |
| 1 | Minecraft | space.voxel, generate.{terrain.noise,biomes,caves,ores,scatter,structures}, blocks, blocks.mine, blocks.place, crafting, container, ai.brain, spawner, move.walk/swim, weather, render.voxel, model.voxel | P0 | redstone = P2 `blocks.logic`; multiplayer servers out of scope |
| 2 | GTA IV | space.mesh3d or voxel, generate.city/roads, vehicle.core/car, ai.traffic/crowd, wanted, combat.{melee,projectile}, quest, cutscene, barks (radio), economy | P0 | Euphoria procedural ragdoll → `anim.ragdoll` (P1); phone/social = `plot.relationship` + minigames (later) |
| 3 | GTA V | as #2 + vehicle.{boat,aircraft}, quest branches (heist plans via quest.branches), progression.abilities | P1 | protagonist switching = later (`gameplay.switch.player`); online mode out of scope |
| 4 | Skyrim | space.mesh3d, generate.terrain/biomes/structures, portal (interiors), crafting, progression.tree (use-based), combat.melee/projectile, ai.schedule, quest, relationship | P1 | dragons/flying bosses: `boss` + `move.fly` (P1); radiant AI beyond schedule = `ai.director` (P2) |
| 5 | Red Dead Redemption | mesh3d, mount, ai.schedule/flock, wanted (law/bounty), economy, stealth, aim | P2 | Dead Eye = `combat.aim` (P2); wildlife ecosystems via spawner + flock |
| 6 | Red Dead Redemption 2 | as #5 + camp as `build.structure` + relationship (honor) | P2 | camp upkeep/simulation depth: later; online out of scope |
| 7 | The Witcher 3 | mesh3d, terrain.procedural, rig.humanoid, anim.ik, combat.{melee,target,status}, crafting (alchemy), quest.branches, relationship, vision.mode, cards | P1 | Gwent = `gameplay.cards` on `space.none` (P1); investigation = `plot.investigation` (P2) |
| 8 | Zelda: Breath of the Wild | mesh3d, move.{climb,glide}, resource (stamina), equipment durability, crafting.merge (cooking), element (chemistry), mechanism (shrines), gameplay.interact | P1 | physics-sandbox shrines need `engine.physics.rigid` (P1) |
| 9 | Fallout 3 | mesh3d + portal interiors, combat.aim, progression.level (SPECIAL stats), relationship (karma), crafting, economy | P2 | V.A.T.S. = `combat.aim` (P2) |
| 10 | Fallout: New Vegas | as #9 + factions (rep), companions (ai.brain follow) | P2 | combat.aim (P2) |
| 11 | Fallout 4 | as #9 + build.structure (settlements) + equipment mods | P2 | combat.aim (P2) |
| 12 | Assassin's Creed II | mesh3d, move.{climb,walk}, combat.{melee,stealth}, vision.mode, economy (villa), quest | P2 | free-running parkour with contextual route finding = later (`move.parkour`) |
| 13 | Batman: Arkham City | mesh3d, move.glide/grapple, combat.{melee,stealth}, vision.mode, quest | P2 | freeflow counter-chain timing: tunable in `melee` combo/parry; `move.grapple` (P2) |
| 14 | Spider-Man | mesh3d, move.grapple (swing), combat.{melee,stealth}, crafting, quest | P2 | physics web-swing = `move.grapple` P2 |
| 15 | Portal 2 | space.mesh3d, gameplay.portal, mechanism, physics.rigid, quest/barks (narrator) | P2 | portal momentum math = P2; co-op out of scope |
| 16 | Dark Souls | mesh3d, combat.{melee,target,boss}, resource (stamina), checkpoint, death (shade/corpse), equipment | P0 | async messages/invasions out of scope (netcode) |
| 17 | Bloodborne | as #16 + melee parry/riposte + generate.dungeon.rooms (chalice) | P1 | async online features out of scope |
| 18 | Mass Effect 2 | mesh3d/graph hubs, combat.{projectile,cover}, relationship (loyalty), dialogue (wheel via choices), progression.abilities | P2 | cover shooting = `combat.cover` (P2); planet scanning minigame later |
| 19 | BioShock | mesh3d, combat.projectile, abilities (plasmid), minigame (hacking), plot.journal (audio logs) | P2 | hacking minigame (P2) |
| 20 | Uncharted 2 | mesh3d, move.climb, combat.{projectile,cover,stealth}, cutscene, mechanism | P2 | cinematic set-piece scripting = `cutscene` + `mechanism` (limited) |
| 21 | The Last of Us | as #20 + crafting + vision.mode | P2 | listen mode = `vision.mode`; companion AI = `ai.brain` (follow) |
| 22 | God of War | mesh3d, combat.{melee,target,projectile (axe recall)}, boss, crafting, equipment, cutscene | P1 | single-shot continuous camera = `camera.third-person` + `cutscene` (P1) |
| 23 | Overwatch | mesh3d, abilities with cooldowns (`resource`), combat.projectile, wave/objective modes | P2 | PvP netcode/matchmaking out of scope; bot-only modes expressible |
| 24 | Fortnite | mesh3d, build.structure (real-time), combat.projectile, vehicle, shrinking zone (`zones` + timer) | P2 | PvP netcode out of scope |
| 25 | PUBG | mesh3d, loot, vehicle, combat.projectile, shrinking zone | P2 | PvP netcode out of scope |
| 26 | League of Legends | mesh3d(iso), abilities, combat, ai.brain (creeps), waves, economy (items) | P2 | PvP/matchmaking out of scope; vs-bots expressible |
| 27 | Dota 2 | as #26 | P2 | PvP/draft out of scope |
| 28 | StarCraft II | space.mesh3d/grid, rts, economy, waves, quest (campaign) | P2 | fog of war / production queues in `gameplay.rts` (P2); ladder out of scope |
| 29 | Rocket League | physics2d or mesh3d, vehicle.car (boost), sports | P2 | PvP netcode out of scope |
| 30 | Mario Kart 8 | mesh3d, vehicle.car (kart), race, item boxes via loot, ai.brain | P1 | anti-gravity track segments = custom gravity region (later) |
| 31 | Civilization V | space.grid (hex), generate.grid.board, turns, economy, progression.tree (tech), ai.brain | P1 | diplomacy AI depth later |
| 32 | XCOM: Enemy Unknown | space.grid, turns (overwatch, hitChance), combat.cover, progression.level, base management on `space.graph` | P1 | permadeath via `gameplay.death` option |
| 33 | Plants vs. Zombies | space.grid, waves, economy (sun), spawner | P1 | — |
| 34 | Clash of Clans | space.grid/iso, build.structure, economy, timers (`engine.time`), rts-lite | P2 | async PvP raids and clans out of scope |
| 35 | Factorio | tilemap/voxel, automation, crafting, progression.tree, spawner, waves | P2 | belts/inserters throughput sim = `automation` (P2) |
| 36 | Kerbal Space Program | — | — | **out of scope:** true orbital mechanics and part-based vehicle construction/physics; later `engine.space.orbital` |
| 37 | Terraria | space.tilemap(side), generate.{terrain.noise,caves,ores}, blocks.mine/place, crafting, combat.boss, move.platformer, spawner, container, economy | P0 | NPC housing = `build.structure` (P1) |
| 38 | Stardew Valley | space.tilemap(td), farming, ai.schedule, relationship (hearts), economy, minigame (fishing), time/calendar | P1 | fishing = `minigame` (P2) |
| 39 | Hollow Knight | space.tilemap(side), tilemap.rooms, move.platformer, combat.{melee (pogo),boss}, resource (soul), equipment (charms), checkpoint, death, economy, ui.map | P0 | — |
| 40 | Celeste | tilemap(side), move.platformer (dash, wall climb stamina), hazard, checkpoint, assist | P0 | assist mode = `engine.assist` (P2) |
| 41 | Super Meat Boy | tilemap(side), move.platformer, hazard, replay (ghost) | P1 | replay ghosts = `engine.replay` (P2) |
| 42 | Braid | tilemap(side), move.platformer, rewind, mechanism | P2 | time-rewind with per-object time rules = `gameplay.rewind` (P2) |
| 43 | Limbo | tilemap/physics2d, move.platformer, physics.rigid, hazard, mechanism | P1 | — |
| 44 | Undertale | tilemap(td), dialogue (mercy), minigame (bullet-hell battle), plot.relationship | P2 | bullet-hell battle sub-mode = `minigame`; meta save-memory = `engine.save` extension later |
| 45 | Spelunky | tilemap(side), generate.dungeon.rooms or tilemap.rooms, move.platformer, loot, economy, death (permadeath) | P1 | daily seed = `seed` param (kernel) |
| 46 | The Binding of Isaac | tilemap(td), generate.dungeon.rooms, combat.projectile, loot, items w/ synergies (`equipment.statMods`), boss | P1 | item synergy rules: data via `statMods` + `tags` |
| 47 | FTL | space.graph (generate.graph.world), plot.events.random, resource (power), combat via `gameplay.turns`/real-time-pause, economy | P2 | ship cross-section management = later (`gameplay.ship`) |
| 48 | Slay the Spire | space.graph (map), none (battle), cards, generate.graph.world, relics via equipment, plot.events.random | P1 | — |
| 49 | Hearthstone | space.none, cards, economy | P1 | ranked PvP and collection economy out of scope |
| 50 | Angry Birds | physics2d, engine.physics.rigid, combat.projectile (sling), destructibles, scoring | P1 | — |
| 51 | Candy Crush | space.grid, match, economy (lives), generate.grid.board | P2 | social features out of scope |
| 52 | Among Us | tilemap(td), mechanism (tasks), ai.brain (bots), los/vision, voting via `dialogue`/`gameplay.cards` | P2 | online lobbies out of scope; bot-only play expressible |
| 53 | Super Mario Galaxy | mesh3d, move.walk | P2 | **later:** arbitrary-body spherical gravity (`gravityAt` supports it; needs `engine.space.planetoid`) |
| 54 | Pokémon Go | creature.catch | — | **out of scope:** AR camera, GPS/real-world map |
| 55 | Animal Crossing: New Leaf | tilemap(td) or mesh3d, engine.time (real clock option), ai.schedule, relationship, farming, economy, build.structure (decoration), collectible | P1 | real-time wall-clock mode: `engine.time.scale=1`+`syncWall:b` (add) |

### Explicitly out of scope or deferred

| Item | Status |
| --- | --- |
| Online PvP/co-op netcode, matchmaking, ladders, async invasions/raids, servers | out of scope (the kernel is deterministic and could host lockstep later; not designed here) |
| AR/GPS/real-world maps, device sensors | out of scope |
| True orbital mechanics, part-based vehicle construction physics | later: new space (`engine.space.orbital`) and primitives |
| Spherical/arbitrary-body gravity worlds | later: `engine.space.planetoid` |
| Procedural ragdoll physics at AAA quality (Euphoria), cloth/fluid simulation | `anim.ragdoll` (P1) is simplified; fluids = P2 `blocks.fluid` |
| Imported high-fidelity meshes, voice acting, facial capture | `graphics.model.mesh` P2; never P0 |
| Multi-protagonist switching, large-scale RTS fog/production, ship-management sims, deep diplomacy | later (`gameplay.rts` P2 minimal) |
| Moddable asset pipelines, user-generated content sharing | out of scope here |

## 10. P0 primitive list

Spaces: `engine.space.{voxel,mesh3d,tilemap,graph}`. Generators: `engine.generate.{terrain.noise,biomes,caves,ores,roads,city,structures,scatter,tilemap.rooms}`. Engine: `engine.{blocks,time,spawner,save,zones,portal,input.actions,physics.body,physics.character}`. Plot: `plot.{character,storyboard,dialogue,quest,gate,ending}`. Graphics: `graphics.{render.voxel,render.mesh3d,render.tilemap,camera.first-person,camera.third-person,camera.side,material.palette,sky,background.parallax,particles,post,model.voxel,model.lowpoly,sprite.pixel,tileset.pixel,anim.sprite,terrain.procedural,rig.humanoid,rig.quadruped,anim.clips,anim.locomotion,anim.ik,ui.hud,ui.dialogue,ui.journal,ui.minimap,ui.map,ui.inventory}`. Gameplay: `gameplay.{move.walk,move.platformer,move.climb,move.dodge,mount,interact,rest,checkpoint,collectible,mechanism,hazard,blocks.mine,blocks.place,inventory,item.use,equipment,crafting,loot,economy,resource,combat.health,combat.melee,combat.projectile,combat.target,combat.boss,ai.brain,ai.attacks,ai.schedule,ai.traffic,vehicle.core,vehicle.car,progression.level,progression.abilities,wanted,death}`.
