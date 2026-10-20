// Overworld runtime (CONTRACT.md §3): grid movement in four directions, running, ledges, bumping,
// warps, tall-grass encounters, trainer sight lines, wandering NPCs, gates and interaction.
// Everything here reads `game` (content + generated maps, immutable) and mutates `state` (JSON).
import { T, walkable, isLedge, DIRS, OPPOSITE, tileAt } from './tiles.js';
import { int, chance, weighted, range } from '../rules/random.js';
import { lookup } from '../rules/stats.js';
import { speakerName } from './story.js';

export const WALK_FRAMES = 8, RUN_FRAMES = 4, JUMP_FRAMES = 16, TURN_FRAMES = 4, NPC_FRAMES = 12;
const SIGHT_DEFAULT = 4;

/** The contract's createOverworld: the game context and the state it runs over. */
// `game` is the object createGame returns (content, maps, openMenu, startWarp); `state` is its state.
export function createOverworld(content, maps, state, game) { return { content, maps: maps.maps || maps, state, game }; }

/** The contract's stepOverworld: one overworld frame; returns this frame's events. */
export function stepOverworld(content, world, input) {
  const before = world.state.events.length;
  overworldFrame(world.game, world.state, input, {});
  return world.state.events.slice(before);
}

// ---------------------------------------------------------------- entities

/** Runtime state for an entity (position, facing, movement), created from its map definition. */
export function rt(state, e) {
  let r = state.npcs[e.id];
  if (!r) r = state.npcs[e.id] = { x: e.x, y: e.y, facing: e.facing, move: null, timer: 0 };
  return r;
}

export function gateOpen(state, gate) {
  if (!gate) return true;
  if (gate.badge && state.badges.length < gate.badge) return false;
  if (gate.flag && !state.flags[gate.flag]) return false;
  return true;
}

/** Visible entities on a map with their live positions (guards stand aside once their gate opens). */
export function liveEntities(game, state, mapId) {
  const map = game.maps[mapId];
  const out = [];
  for (const e of map.entities) {
    if (e.kind === 'item' && state.picked[e.id]) continue;
    if (e.kind === 'starter' && state.starter) continue;
    const r = state.npcs[e.id];
    let x = r?.x ?? e.x, y = r?.y ?? e.y;
    if (e.kind === 'guard' && gateOpen(state, e.gate)) { x = e.aside.x; y = e.aside.y; }
    out.push({ def: e, x, y, facing: r?.facing ?? e.facing, move: r?.move || null });
  }
  if (state.rival?.map === mapId) out.push({ def: { id: 'rival', kind: 'rival', name: game.content.rival?.name, look: game.content.rival?.look, solid: true }, x: state.rival.x, y: state.rival.y, facing: state.rival.facing, move: null });
  return out;
}

const occupied = (game, state, mapId, x, y, except) => liveEntities(game, state, mapId).some(e => e.def.id !== except && e.def.solid !== false && ((e.x === x && e.y === y) || (e.move && e.move.tx === x && e.move.ty === y)));

/** Can a walker enter (x, y) on a map? Barriers fall once their gym switch is pressed. */
export function passable(game, state, map, x, y) {
  const ch = tileAt(map, x, y);
  if (ch == null) return false;
  if (ch === T.barrier) return !!(map.puzzle && state.flags[map.puzzle.flag]);
  return walkable(ch);
}

// ---------------------------------------------------------------- player

const dirOf = input => {
  if (input.x && input.y) return null;
  if (input.x) return input.x > 0 ? 'right' : 'left';
  if (input.y) return input.y > 0 ? 'down' : 'up';
  return null;
};

/** One overworld frame for the player and NPCs. Returns nothing; pushes ops and events into state. */
export function overworldFrame(game, state, input, edges = {}) {
  const p = state.player, map = game.maps[p.map];
  stepNpcs(game, state, map);
  if (p.move) {
    if (input.b) { p.bHeld = (p.bHeld || 0) + 1; p.bMoved = true; } else p.bHeld = 0;
    p.move.t++;
    if (p.move.t >= p.move.dur) { const m = p.move; p.move = null; arrive(game, state, m); }
    return;
  }
  // B: hold to run; tap (press and release without moving) opens the start menu.
  if (input.b) { p.bHeld++; if (p.bHeld === 1) p.bMoved = false; }
  else if (p.bHeld) { const tap = p.bHeld <= 14 && !p.bMoved; p.bHeld = 0; if (tap) { game.openMenu(state); return; } }
  if (edges.a) { interact(game, state); return; }
  const dir = dirOf(input);
  if (!dir) { p.turnT = 0; return; }
  if (p.bHeld) p.bMoved = true;
  if (dir !== p.facing && !p.turnT) { p.facing = dir; p.turnT = TURN_FRAMES; return; }
  if (p.turnT > 1) { p.turnT--; return; }
  p.turnT = 0;
  tryStep(game, state, dir, !!input.b);
}

function tryStep(game, state, dir, running) {
  const p = state.player, map = game.maps[p.map];
  p.facing = dir;
  const [dx, dy] = DIRS[dir], nx = p.x + dx, ny = p.y + dy;
  const ch = tileAt(map, nx, ny);
  // The start town keeps you in until you have a partner.
  if (!state.starter && map.area === game.content.areas[0].id && map.warps.some(w => w.kind === 'edge' && w.x === nx && w.y === ny)) {
    state.script.push({ op: 'say', who: 'mentor', name: speakerName(game.content, 'mentor'), text: 'Wait! Tall grass is dangerous without a partner. Come see me in my lab!' });
    return;
  }
  if (isLedge(ch) && dir === 'down') {
    const ly = ny + 1;
    if (passable(game, state, map, nx, ly) && !occupied(game, state, p.map, nx, ly)) {
      p.move = { fx: p.x, fy: p.y, t: 0, dur: JUMP_FRAMES, jump: true };
      p.x = nx; p.y = ly; p.steps++;
      state.events.push({ name: 'jump' });
      return;
    }
  }
  if (!passable(game, state, map, nx, ny) || occupied(game, state, p.map, nx, ny)) {
    if (state.frame - (p.bumpAt || -99) > 16) { state.events.push({ name: 'bump' }); p.bumpAt = state.frame; }
    return;
  }
  p.move = { fx: p.x, fy: p.y, t: 0, dur: running ? RUN_FRAMES : WALK_FRAMES, run: running };
  p.x = nx; p.y = ny; p.steps++;
  p.stride = (p.stride + 1) % 4;
}

/** After finishing a step: warps, switches, encounters, trainers. */
function arrive(game, state, move) {
  const p = state.player, map = game.maps[p.map];
  const ch = tileAt(map, p.x, p.y);
  state.stats.steps++;
  if (state.repel > 0) { state.repel--; if (!state.repel) state.script.push({ op: 'say', text: 'The repellent wore off.' }); }
  if (move?.jump) state.events.push({ name: 'land' });
  const warp = map.warps.find(w => w.x === p.x && w.y === p.y);
  if (warp) { game.startWarp(state, { map: warp.to, x: warp.tx, y: warp.ty, facing: warp.facing }, warp.kind); return; }
  if (ch === T.switch && map.puzzle && !state.flags[map.puzzle.flag]) {
    state.flags[map.puzzle.flag] = true;
    state.events.push({ name: 'power', what: 'switch' });
    state.script.push({ op: 'say', text: 'Click! Somewhere, a barrier lowered.' });
    return;
  }
  if (spotCheck(game, state)) return;
  if ((map.encounter === 'grass' && ch === T.grass) || (map.encounter === 'floor' && ch === T.floor)) maybeEncounter(game, state, map);
}

function maybeEncounter(game, state, map) {
  if (!map.encounters?.length || !state.party.some(c => c.hp > 0)) return;
  if (!chance(state, map.encounterRate ?? 0.1)) return;
  const e = weighted(state, map.encounters);
  const level = range(state, e.minLevel, e.maxLevel);
  const lead = state.party.find(c => c.hp > 0);
  if (state.repel > 0 && lead && level < lead.level) return;
  state.events.push({ name: 'encounter', species: e.species, level });
  state.script.push({ op: 'battle', wild: { species: e.species, level } });
}

// ---------------------------------------------------------------- trainers

/** Does an undefeated trainer see the player? Queues the approach and battle. */
export function spotCheck(game, state) {
  const p = state.player;
  if (state.script.length) return false;
  for (const e of liveEntities(game, state, p.map)) {
    const d = e.def;
    if (d.kind !== 'trainer' || state.defeated[d.trainer] || !(d.sight ?? SIGHT_DEFAULT)) continue;
    const [dx, dy] = DIRS[e.facing];
    for (let k = 1; k <= (d.sight ?? SIGHT_DEFAULT); k++) {
      const x = e.x + dx * k, y = e.y + dy * k;
      if (x === p.x && y === p.y) {
        state.events.push({ name: 'trainerBattle', trainer: d.trainer });
        state.script.push({ op: 'emote', entity: d.id, kind: '!' }, { op: 'approach', entity: d.id }, ...trainerOps(game, state, d));
        return true;
      }
      if (!passable(game, state, game.maps[p.map], x, y) || occupied(game, state, p.map, x, y, d.id)) break;
    }
  }
  return false;
}

/** Intro, battle and bookkeeping for a trainer, leader or champion entity. */
export function trainerOps(game, state, d) {
  const { content } = game;
  if (d.kind === 'champion') {
    const c = content.champion;
    return [{ op: 'face', entity: d.id }, { op: 'say', who: 'champion', name: c.name, text: c.intro || 'Let us begin.' }, { op: 'battle', champion: true }, { op: 'end_game' }];
  }
  const t = lookup(content).trainers.get(d.trainer);
  const ops = [{ op: 'face', entity: d.id }, { op: 'say', who: t.id, name: speakerName(content, t.id), text: t.intro || 'Let\'s battle!' }, { op: 'battle', trainer: t.id }, { op: 'defeat', id: t.id }];
  if (t.isLeader) ops.push({ op: 'badge', area: t.area });
  return ops;
}

// ---------------------------------------------------------------- NPCs

function stepNpcs(game, state, map) {
  for (const e of map.entities) {
    const r = state.npcs[e.id];
    if (r?.move) {
      r.move.t++;
      if (r.move.t >= r.move.dur) { r.x = r.move.tx; r.y = r.move.ty; r.move = null; }
      continue;
    }
    if (!e.wander || state.script.length || state.mode !== 'overworld') continue;
    const s = rt(state, e);
    if (--s.timer > 0) continue;
    s.timer = 50 + int(state, 120);
    const dir = ['up', 'down', 'left', 'right'][int(state, 4)];
    s.facing = dir;
    if (chance(state, 0.4)) continue;
    const [dx, dy] = DIRS[dir], nx = s.x + dx, ny = s.y + dy;
    if (Math.abs(nx - e.x) > e.wander || Math.abs(ny - e.y) > e.wander) continue;
    const p = state.player;
    if ((nx === p.x && ny === p.y) || (p.move && p.move.fx === nx && p.move.fy === ny)) continue;
    if (!passable(game, state, map, nx, ny) || occupied(game, state, map.id, nx, ny, e.id)) continue;
    if (map.warps.some(w => w.x === nx && w.y === ny)) continue;
    s.move = { fx: s.x, fy: s.y, tx: nx, ty: ny, t: 0, dur: NPC_FRAMES };
  }
}

/** Move an entity one tile toward a target (scripted walks). Returns true when arrived. */
export function walkEntity(game, state, id, tx, ty) {
  const map = game.maps[state.player.map];
  const e = map.entities.find(x => x.id === id);
  if (!e) return true;
  const s = rt(state, e);
  if (s.move) return false;
  if (s.x === tx && s.y === ty) return true;
  const dir = s.x !== tx ? (tx > s.x ? 'right' : 'left') : (ty > s.y ? 'down' : 'up');
  const [dx, dy] = DIRS[dir];
  s.facing = dir;
  s.move = { fx: s.x, fy: s.y, tx: s.x + dx, ty: s.y + dy, t: 0, dur: WALK_FRAMES + 2 };
  return false;
}

/** The tile next to the player along the entity's line, for trainers walking up. */
export function approachTarget(game, state, id) {
  const e = game.maps[state.player.map].entities.find(x => x.id === id);
  const s = rt(state, e), p = state.player;
  const [dx, dy] = DIRS[s.facing];
  return { x: p.x - dx, y: p.y - dy };
}

export function faceEachOther(game, state, id) {
  const p = state.player;
  const e = game.maps[p.map].entities.find(x => x.id === id);
  if (!e) return;
  const s = rt(state, e);
  const dx = p.x - s.x, dy = p.y - s.y;
  s.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  p.facing = OPPOSITE[s.facing];
}

// ---------------------------------------------------------------- interaction

function interact(game, state) {
  const p = state.player, map = game.maps[p.map], { content } = game;
  const [dx, dy] = DIRS[p.facing];
  let tx = p.x + dx, ty = p.y + dy;
  const at = (x, y) => liveEntities(game, state, p.map).find(e => e.x === x && e.y === y);
  let target = at(tx, ty);
  // Talk across counters.
  if (!target && tileAt(map, tx, ty) === T.counter) { target = at(tx + dx, ty + dy); }
  const ch = tileAt(map, tx, ty);
  if (!target) {
    if (ch === T.sign && map.signs[`${tx},${ty}`]) { state.script.push({ op: 'say', text: map.signs[`${tx},${ty}`] }); state.events.push({ name: 'menu_confirm' }); }
    else if (ch === T.pc) state.script.push({ op: 'say', text: `${content.player?.name || 'You'} booted up the PC.` }, { op: 'pc' });
    else if (ch === T.table && map.room === 'lab') state.script.push({ op: 'say', text: 'Three orbs sit on the table. Each holds a creature.' });
    return;
  }
  const d = target.def;
  const say = (text, who = d.id, name = d.name) => ({ op: 'say', who, name, text });
  state.events.push({ name: 'menu_confirm' });
  switch (d.kind) {
    case 'npc': case 'rival': {
      if (d.kind === 'npc') faceEachOther(game, state, d.id);
      state.script.push(...(d.lines?.length ? d.lines : ['...']).map(l => say(l)));
      break;
    }
    case 'trainer': case 'leader': {
      const t = lookup(content).trainers.get(d.trainer);
      faceEachOther(game, state, d.id);
      if (state.defeated[d.trainer]) state.script.push(say(d.kind === 'leader' ? `${t.defeat || 'Well fought.'} Keep going — the next challenge awaits.` : (t.defeat || 'You\'re strong!')));
      else state.script.push(...trainerOps(game, state, d));
      break;
    }
    case 'champion': faceEachOther(game, state, d.id); state.script.push(...trainerOps(game, state, d)); break;
    case 'mentor': {
      faceEachOther(game, state, d.id);
      if (!state.starter) state.script.push({ op: 'starter_intro' });
      else {
        const seen = Object.keys(state.seen).length, caught = Object.keys(state.caught).length;
        state.script.push(say(`Your Dex has ${seen} seen and ${caught} caught. Keep exploring, ${content.player?.name || ''}!`));
      }
      break;
    }
    case 'starter': state.script.push({ op: 'starter_pick', index: d.index }); break;
    case 'nurse':
      state.script.push(say('Welcome to the Heal Center! We\'ll restore your creatures to full health.'), { op: 'heal', center: true }, say('Your creatures are fighting fit. We hope to see you again!'));
      break;
    case 'clerk': state.script.push(say('Welcome! How may I help you?'), { op: 'shop', area: map.area }); break;
    case 'item': {
      state.picked[d.id] = true;
      state.script.push({ op: 'give_item', item: d.item, count: d.count || 1, found: true });
      break;
    }
    case 'guard': {
      const g = d.gate;
      const need = g.badge ? `You need ${g.badge} badge${g.badge > 1 ? 's' : ''} to pass. You have ${state.badges.length}.` : 'You can\'t go this way yet.';
      faceEachOther(game, state, d.id);
      state.script.push(say(`Halt! The way ahead is dangerous. ${need}`));
      break;
    }
    default: break;
  }
}
