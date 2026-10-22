// The creature game (CONTRACT.md §3 "Game", KIT_CONTRACT.md): rules + world composed into
// createGame(content, { seed }) → { createState(), step(state, input), view(state), restore(save) }.
//
// Input is held state { x, y, a, b } (the host has no Start button). A confirms and talks; B goes
// back, holds to run, and a quick tap of B while standing still opens the start menu.
//
// Everything that happens in the world is a queue of script ops (state.script): dialogue, choices,
// battles, gifts, walks, warps. Talking, trainer sight, story rules and battle results all push ops;
// modes (dialogue, battle, menu, shop, pc, evolution) take over until their op completes.
import { seedFrom } from '../../kernel/rng.js';
import { STARTER_LEVEL, levelCurve } from './content.js';
import { createCreature, healCreature, lookup, speciesOf, summary, statsOf, expBar } from './rules/index.js';
import { generateMaps } from './world/maps.js';
import { T, DIRS, OPPOSITE, tileAt } from './world/tiles.js';
import { overworldFrame, liveEntities, passable, spotCheck, walkEntity, approachTarget, faceEachOther, rt, gateOpen } from './world/overworld.js';
import { storyRules, opsFor, test, speakerName, fill, counterStarter } from './world/story.js';
import { beginBattle, battleFrame, battleView } from './world/battle-flow.js';
import { openMenu, menuFrame, menuView, openShop, shopFrame, shopView, openPc, pcFrame, pcView, startEvolution, evolutionFrame, evolutionView } from './world/menus.js';

/** A model-written phrase as a sentence: capitalized, ending in punctuation. */
const sentence = t => { const x = String(t || '').trim(); return x ? x[0].toUpperCase() + x.slice(1) + (/[.!?]$/.test(x) ? '' : '.') : ''; };

export const GAME_VERSION = '0.1.0';
export const SAVE_SCHEMA = 'gameverse.v2.creature-save/0.1';
const FADE = 12, DIALOGUE_REVEAL = 1.25, PAGE = 92;

/** Split dialogue into pages of about two lines, at sentence then word boundaries. */
export function paginate(text, size = PAGE) {
  const words = String(text).split(/\s+/).filter(Boolean), pages = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > size && cur) { pages.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
    if (/[.!?]["”]?$/.test(w) && cur.length > size * 0.6) { pages.push(cur); cur = ''; }
  }
  if (cur) pages.push(cur);
  return pages.length ? pages : [''];
}

export function createGame(content, { seed = 1 } = {}) {
  const world = generateMaps(content, seed);
  const game = { content, seed, maps: world.maps, world, rules: storyRules(content) };
  const idx = lookup(content);
  const playerName = content.player?.name || 'You';

  // ---------------------------------------------------------------- state

  function createState() {
    const s = world.spawns.start;
    const state = {
      schema: SAVE_SCHEMA, version: GAME_VERSION, status: 'playing', score: 0, events: [], frame: 0,
      rng: seedFrom(`${content.id}:${seed}:play`) || 1,
      mode: 'overworld', input: { a: false, b: false, dir: null, held: 0 },
      player: { map: s.map, x: s.x, y: s.y, facing: s.facing, move: null, bHeld: 0, bMoved: false, turnT: 0, steps: 0, stride: 0 },
      party: [], box: [], bag: {}, money: 3000, badges: [], flags: {}, defeated: {}, picked: {}, fired: {},
      seen: {}, caught: {}, visited: { [game.maps[s.map].area]: true }, respawn: { ...s }, repel: 0,
      starter: null, rivalStarter: null, rivalBattles: 0, rival: null, npcs: {},
      script: introOps(), dialogue: null, battle: null, menu: null, shop: null, pc: null, evolution: null,
      transition: null, warp: null, ending: null, emote: null, banner: { text: game.maps[s.map].name, t: 0 }, saves: 0,
      stats: { steps: 0, battles: 0, wins: 0, caught: 0, frames: 0 },
    };
    return state;
  }

  function introOps() {
    const m = content.mentor || {}, mentor = m.name || 'Professor';
    return [
      { op: 'say', who: 'mentor', name: mentor, text: `Welcome to ${content.region?.name || 'our region'}! I'm ${mentor}${m.role ? `, a ${m.role}` : ''}.` },
      { op: 'say', who: 'mentor', name: mentor, text: `${sentence(content.region?.description) || 'This land is full of wild creatures.'} People and creatures here live, battle and grow together.` },
      { op: 'say', who: 'mentor', name: mentor, text: `${playerName}, your journey starts today. Earn every badge and face the champion!` },
      { op: 'starter_intro' },
    ];
  }

  // ---------------------------------------------------------------- input

  function edgesOf(state, input) {
    const prev = state.input;
    const dir = input.y < 0 ? 'up' : input.y > 0 ? 'down' : input.x < 0 ? 'left' : input.x > 0 ? 'right' : null;
    const e = { a: !!input.a && !prev.a, b: !!input.b && !prev.b, up: false, down: false, left: false, right: false };
    let held = prev.held;
    if (dir) {
      if (dir !== prev.dir) { e[dir] = true; held = 0; }
      else { held++; if (held > 16 && (held - 16) % 5 === 0) e[dir] = true; }
    }
    state.input = { a: !!input.a, b: !!input.b, dir, held };
    return e;
  }

  // ---------------------------------------------------------------- script ops

  const after = (state, ...ops) => state.script.splice(1, 0, ...ops);
  const say = (text, who, name) => ({ op: 'say', who, name: name ?? (who ? speakerName(content, who) : undefined), text });

  function openDialogue(state, op) {
    state.dialogue = { who: op.who || null, name: op.name || null, pages: paginate(fill(content, op.text)), page: 0, t: 0, choices: op.choices || null, cursor: 0, cancel: op.cancel ?? null, id: op.id || null, data: op.data || null };
    state.mode = 'dialogue';
    state.events.push({ name: 'dialogue' });
  }

  function placeRival(state) {
    const p = state.player, map = game.maps[p.map];
    const order = [p.facing, ...['left', 'right', 'down', 'up'].filter(d => d !== p.facing)];
    for (const d of order) {
      const [dx, dy] = DIRS[d], x = p.x + dx, y = p.y + dy;
      if (passable(game, state, map, x, y) && !liveEntities(game, state, p.map).some(e => e.x === x && e.y === y) && !map.warps.some(w => w.x === x && w.y === y)) {
        state.rival = { map: p.map, x, y, facing: OPPOSITE[d] };
        p.facing = d;
        return;
      }
    }
    state.rival = { map: p.map, x: p.x, y: p.y - 1, facing: 'down' };
  }

  function giveCreature(state, species, level) {
    const c = createCreature(content, species, level, state);
    if (state.party.length < 6) state.party.push(c); else state.box.push(c);
    state.seen[species] = true; state.caught[species] = true;
    return c;
  }

  function spawnFor(areaId) {
    const map = game.maps[areaId];
    if (!map) return world.spawns.start;
    const o = map.openings[0]?.inner[0] || map.mats[0]?.inner;
    if (o) return { map: map.id, x: o[0], y: o[1], facing: 'down' };
    return { map: map.id, x: Math.floor(map.w / 2), y: Math.floor(map.h / 2), facing: 'down' };
  }

  const OPS = {
    say(state, op) { openDialogue(state, op); return 'wait'; },
    choose(state, op) { openDialogue(state, op); return 'wait'; },
    starter_intro(state) {
      const mentor = speakerName(content, 'mentor');
      const names = content.starters.map(id => { const s = speciesOf(content, id); return `${s.name} (${content.types.find(t => t.id === s.types[0])?.name || s.types[0]})`; });
      after(state,
        say(`On this table are three creatures. ${content.starters.map(id => speciesOf(content, id).name).join(', ')}... Each one beats another's type.`, 'mentor', mentor),
        { op: 'choose', who: 'mentor', name: mentor, text: 'Which partner will you choose?', choices: [...names, 'Let me think'], cancel: 3, id: 'starter' });
      return 'done';
    },
    starter_pick(state, op) {
      const sp = speciesOf(content, content.starters[op.index]);
      const type = content.types.find(t => t.id === sp.types[0])?.name || sp.types[0];
      after(state, { op: 'choose', who: 'mentor', name: speakerName(content, 'mentor'), text: `So you want ${sp.name}, the ${type}-type creature?`, choices: ['Yes', 'No'], cancel: 1, id: 'starter-confirm', data: { index: op.index } });
      return 'done';
    },
    give_starter(state, op) {
      const species = content.starters[op.index], c = giveCreature(state, species, STARTER_LEVEL);
      state.starter = species;
      state.rivalStarter = counterStarter(content, species);
      const balls = content.items.filter(i => i.kind === 'ball').sort((a, b) => a.price - b.price)[0];
      const heal = content.items.filter(i => i.kind === 'heal').sort((a, b) => a.price - b.price)[0];
      state.events.push({ name: 'collect', what: 'starter' });
      const rivalSp = speciesOf(content, state.rivalStarter);
      after(state,
        say(`${playerName} received ${c.name}!`),
        { op: 'rival', show: true },
        say(`Then I'll take ${rivalSp.name}! Its type beats yours. See you out there, ${playerName}!`, 'rival'),
        { op: 'rival', show: false },
        ...(balls ? [{ op: 'give_item', item: balls.id, count: 5 }] : []),
        ...(heal ? [{ op: 'give_item', item: heal.id, count: 2 }] : []),
        say(`Weaken wild creatures in battle, then throw a ${balls?.name || 'ball'} to catch them. Off you go — ${content.areas.find(a => a.kind === 'gym')?.name || 'the first gym'} awaits!`, 'mentor'));
      return 'done';
    },
    give_item(state, op) {
      const it = idx.items.get(op.item);
      if (!it) return 'done';
      state.bag[it.id] = (state.bag[it.id] || 0) + (op.count || 1);
      state.events.push({ name: 'collect', item: it.id });
      after(state, say(`${playerName} ${op.found ? 'found' : 'received'} ${op.count > 1 ? `${op.count}× ` : 'a '}${it.name}!`));
      return 'done';
    },
    give_creature(state, op) {
      const c = giveCreature(state, op.species, op.level || STARTER_LEVEL);
      state.events.push({ name: 'collect', species: op.species });
      after(state, say(`${playerName} received ${c.name}!${state.box.includes(c) ? ' It was sent to the PC box.' : ''}`));
      return 'done';
    },
    flag(state, op) { state.flags[op.flag] = true; return 'done'; },
    fired(state, op) { state.fired[op.rule] = true; return 'done'; },
    defeat(state, op) { state.defeated[op.id] = true; return 'done'; },
    heal(state, op) {
      for (const c of state.party) healCreature(content, c);
      if (op.center) { const m = game.maps[state.player.map]; if (m.respawn) state.respawn = { map: m.id, ...m.respawn }; }
      state.events.push({ name: 'heal' }, { name: 'power' });
      after(state, { op: 'wait', frames: 45, fx: 'heal' });
      return 'done';
    },
    wait(state, op) { op.t = (op.t || 0) + 1; state.fx = op.fx || null; if (op.t >= op.frames) { state.fx = null; return 'done'; } return 'wait'; },
    emote(state, op) {
      if (!op.t) state.emote = { entity: op.entity, kind: op.kind, t: 0 };
      op.t = (op.t || 0) + 1; state.emote.t = op.t;
      if (op.t === 1) state.events.push({ name: 'spotted' });
      if (op.t >= 36) { state.emote = null; return 'done'; }
      return 'wait';
    },
    approach(state, op) {
      if (!op.target) op.target = approachTarget(game, state, op.entity);
      return walkEntity(game, state, op.entity, op.target.x, op.target.y) ? 'done' : 'wait';
    },
    face(state, op) { faceEachOther(game, state, op.entity); return 'done'; },
    rival(state, op) { if (op.show) placeRival(state); else state.rival = null; return 'done'; },
    battle(state, op) { beginBattle(game, state, op); return 'wait'; },
    badge(state, op) {
      const area = idx.areas.get(op.area), badge = area?.leader?.badge;
      if (!badge || state.badges.includes(badge.id)) return 'done';
      state.badges.push(badge.id);
      state.events.push({ name: 'reach_goal', badge: badge.id }, { name: 'badge', badge: badge.id });
      after(state, say(`${playerName} received the ${badge.name}!`), say(`${area.leader.name}: "With ${state.badges.length} badge${state.badges.length > 1 ? 's' : ''}, new roads open to you. Go on!"`));
      return 'done';
    },
    shop(state, op) { openShop(game, state, op.area); return 'wait'; },
    pc(state) { openPc(state); return 'wait'; },
    evolve(state, op) { return startEvolution(game, state, op.uid) ? 'wait' : 'done'; },
    blackout(state) {
      state.money = Math.floor(state.money / 2);
      for (const c of state.party) healCreature(content, c);
      state.rival = null;
      startWarp(state, state.respawn, 'blackout');
      after(state, say(`${playerName} hurried back to safety and rested. The team is healed.`));
      return 'done';
    },
    warp(state, op) { startWarp(state, spawnFor(op.area), 'story'); return 'done'; },
    end_game(state) {
      state.mode = 'ending'; state.ending = { t: 0, party: state.party.map(c => summary(content, c)) };
      state.flags['champion'] = true;
      state.events.push({ name: 'reach_goal' }, { name: 'ending' });
      return 'wait';
    },
  };

  const CHOICES = {
    starter(state, i) { if (i < content.starters.length) after(state, { op: 'give_starter', index: i }); else after(state, say('Take your time. Talk to me when you\'re ready.', 'mentor')); },
    'starter-confirm'(state, i, data) { if (i === 0) after(state, { op: 'give_starter', index: data.index }); },
  };

  function runScript(state) {
    for (let guard = 0; guard < 64 && state.mode === 'overworld' && state.script.length; guard++) {
      const op = state.script[0];
      const handler = OPS[op.op];
      if (!handler) { state.script.shift(); continue; }
      const r = handler(state, op);
      if (r === 'wait') return;
      state.script.shift();
    }
  }

  // ---------------------------------------------------------------- modes

  function dialogueFrame(state, edges) {
    const d = state.dialogue;
    d.t++;
    const text = d.pages[d.page], done = d.t * DIALOGUE_REVEAL >= text.length;
    if (!(edges.a || edges.b)) {
      if (done && d.choices && (edges.up || edges.down)) { d.cursor = (d.cursor + (edges.up ? d.choices.length - 1 : 1)) % d.choices.length; state.events.push({ name: 'menu_move' }); }
      return;
    }
    if (!done) { d.t = Math.ceil(text.length / DIALOGUE_REVEAL); return; }
    if (d.page < d.pages.length - 1) { d.page++; d.t = 0; state.events.push({ name: 'menu_move' }); return; }
    if (d.choices) {
      const pick = edges.b ? (d.cancel ?? d.cursor) : d.cursor;
      if (edges.b && d.cancel == null) return;
      state.events.push({ name: 'menu_confirm' });
      state.dialogue = null; state.mode = 'overworld';
      const id = d.id, data = d.data;
      CHOICES[id]?.(state, pick, data);
      state.script.shift();
      return;
    }
    state.events.push({ name: 'menu_move' });
    state.dialogue = null; state.mode = 'overworld';
    state.script.shift();
  }

  function startWarp(state, dest, kind) {
    state.mode = 'warp';
    state.warp = { dest: { ...dest }, t: 0, kind };
    state.events.push({ name: 'warp', kind });
  }

  function warpFrame(state) {
    const w = state.warp;
    w.t++;
    if (w.t === FADE) {
      const p = state.player, fromArea = game.maps[p.map].area;
      Object.assign(p, { map: w.dest.map, x: w.dest.x, y: w.dest.y, facing: w.dest.facing || p.facing, move: null, turnT: 0 });
      const map = game.maps[p.map];
      if (map.area !== fromArea || w.kind === 'blackout') { state.banner = { text: map.kind === 'interior' && map.area === fromArea ? map.name : (game.maps[map.area]?.name || map.name), t: 0 }; state.rival = null; }
      else if (map.kind === 'interior' || map.kind === 'gym' || map.kind === 'league') state.banner = { text: map.name, t: 0 };
      state.visited[map.area] = true;
    }
    if (w.t >= FADE * 2) { state.warp = null; state.mode = 'overworld'; spotCheck(game, state); }
  }

  function transitionFrame(state) {
    state.transition.t++;
    if (state.transition.t >= state.transition.dur) { state.transition = null; state.mode = 'battle'; }
  }

  function endingFrame(state, edges) {
    const e = state.ending;
    e.t++;
    if ((e.t > 150 && edges.a) || e.t > 720) {
      state.status = 'won';
      state.events.push({ name: 'won' });
    }
  }

  function evaluateStory(state) {
    for (const rule of game.rules) {
      if (state.fired[rule.id]) continue;
      if (test(rule.when, state, game)) { state.script.push(...opsFor(content, rule)); return true; }
    }
    return false;
  }

  // ---------------------------------------------------------------- step

  function step(state, input = {}) {
    state.events = [];
    if (state.status !== 'playing') return state;
    state.frame++; state.stats.frames++;
    if (state.banner) state.banner.t++;
    const edges = edgesOf(state, input);
    switch (state.mode) {
      case 'overworld': {
        if (state.script.length) { overworldIdleNpcs(state); runScript(state); break; }
        const p = state.player;
        if (!p.move && evaluateStory(state)) { runScript(state); break; }
        overworldFrame(game, state, input, edges);
        if (state.script.length && state.mode === 'overworld' && !state.player.move) runScript(state);
        break;
      }
      case 'dialogue': dialogueFrame(state, edges); if (state.mode === 'overworld') runScript(state); break;
      case 'battle': battleFrame(game, state, edges); if (state.mode === 'overworld') runScript(state); break;
      case 'transition': transitionFrame(state); break;
      case 'warp': warpFrame(state); break;
      case 'menu': menuFrame(game, state, edges); break;
      case 'shop': shopFrame(game, state, edges); if (state.mode === 'overworld') runScript(state); break;
      case 'pc': pcFrame(game, state, edges); if (state.mode === 'overworld') runScript(state); break;
      case 'evolution': evolutionFrame(game, state, edges); if (state.mode === 'overworld') runScript(state); break;
      case 'ending': endingFrame(state, edges); break;
      default: state.mode = 'overworld';
    }
    state.score = state.badges.length * 1000 + Object.keys(state.caught).length * 100 + Object.keys(state.defeated).length * 50 + (state.flags.champion ? 5000 : 0);
    return state;
  }

  // Scripted walks still animate NPCs while a script runs.
  function overworldIdleNpcs(state) {
    const map = game.maps[state.player.map];
    for (const e of map.entities) {
      const r = state.npcs[e.id];
      if (r?.move) { r.move.t++; if (r.move.t >= r.move.dur) { r.x = r.move.tx; r.y = r.move.ty; r.move = null; } }
    }
    if (state.player.move) { state.player.move.t++; if (state.player.move.t >= state.player.move.dur) state.player.move = null; }
  }

  game.openMenu = state => openMenu(state);
  game.startWarp = startWarp;

  // ---------------------------------------------------------------- view

  function view(state) {
    const p = state.player, map = game.maps[p.map];
    const lerp = (m, x, y) => (m ? { x: m.fx + (x - m.fx) * Math.min(1, m.t / m.dur), y: m.fy + (y - m.fy) * Math.min(1, m.t / m.dur) } : { x, y });
    const pp = lerp(p.move, p.x, p.y);
    const jump = p.move?.jump ? Math.sin(Math.PI * p.move.t / p.move.dur) * 0.6 : 0;
    const entities = liveEntities(game, state, p.map).map(e => {
      const m = e.move, pos = m ? { x: e.x + (m.tx - e.x) * (m.t / m.dur), y: e.y + (m.ty - e.y) * (m.t / m.dur) } : { x: e.x, y: e.y };
      const d = e.def;
      return {
        id: d.id, kind: d.kind, x: pos.x, y: pos.y, facing: e.facing, walking: !!m, phase: m ? m.t / m.dur : 0, name: d.name, look: d.look,
        species: d.species, item: d.item, defeated: d.trainer ? !!state.defeated[d.trainer] : false,
        emote: state.emote?.entity === d.id ? { kind: state.emote.kind, t: state.emote.t } : null,
      };
    });
    const tile = tileAt(map, p.x, p.y);
    const out = {
      mode: state.mode, frame: state.frame, status: state.status,
      map: { id: map.id, area: map.area, name: map.name, kind: map.kind, theme: map.theme, w: map.w, h: map.h, dark: map.dark, barrierOpen: !!(map.puzzle && state.flags[map.puzzle.flag]), puzzle: map.puzzle || null },
      player: { x: pp.x, y: pp.y, tx: p.x, ty: p.y, facing: p.facing, walking: !!p.move && !p.move.jump, running: !!p.move?.run, phase: p.move ? (p.stride % 2) + p.move.t / p.move.dur : 0, jump, inGrass: tile === T.grass && !p.move },
      entities, camera: { x: pp.x + 0.5, y: pp.y + 0.5 },
      banner: state.banner && state.banner.t < 150 ? { text: state.banner.text, t: state.banner.t } : null,
      hud: { money: state.money, badges: state.badges.length, party: state.party.map(c => summary(content, c)) },
      fx: state.fx || null,
      transition: state.transition ? { ...state.transition } : null,
      warp: state.warp ? { fade: state.warp.t < FADE ? state.warp.t / FADE : 1 - (state.warp.t - FADE) / FADE, kind: state.warp.kind } : null,
      dialogue: null, battle: null, menu: null, shop: null, pc: null, evolution: null, ending: null,
    };
    if (state.dialogue) {
      const d = state.dialogue, text = d.pages[d.page];
      const shown = Math.min(text.length, Math.floor(d.t * DIALOGUE_REVEAL));
      out.dialogue = { name: d.name, who: d.who, text, shown, done: shown >= text.length, more: d.page < d.pages.length - 1, choices: shown >= text.length ? d.choices : null, cursor: d.cursor };
    }
    if (state.battle) out.battle = battleView(game, state);
    if (state.menu) out.menu = menuView(game, state);
    if (state.shop) out.shop = shopView(game, state);
    if (state.pc) out.pc = pcView(game, state);
    if (state.evolution) out.evolution = evolutionView(game, state);
    if (state.ending) out.ending = { t: state.ending.t, party: state.ending.party, champion: content.champion?.name, title: content.title, player: playerName, caught: Object.keys(state.caught).length, badges: state.badges.length };
    return out;
  }

  // ---------------------------------------------------------------- saves

  /**
   * Restore a save (a state object or its JSON). Saves from another version keep the party, box, bag,
   * money, badges and flags; the player returns to their respawn point if their map no longer exists.
   */
  function restore(saved) {
    const s = typeof saved === 'string' ? JSON.parse(saved) : structuredClone(saved);
    if (s.version === GAME_VERSION && game.maps[s.player?.map]) return s;
    const fresh = createState();
    const keep = ['party', 'box', 'bag', 'money', 'badges', 'flags', 'defeated', 'picked', 'fired', 'seen', 'caught', 'visited', 'starter', 'rivalStarter', 'rivalBattles', 'stats'];
    for (const k of keep) if (s[k] !== undefined) fresh[k] = s[k];
    const valid = c => idx.species.has(c?.species);
    fresh.party = (fresh.party || []).filter(valid); fresh.box = (fresh.box || []).filter(valid);
    for (const c of [...fresh.party, ...fresh.box]) { c.moves = (c.moves || []).filter(m => idx.moves.has(m.id)); c.hp = Math.min(c.hp ?? 0, statsOf(content, c).hp); }
    fresh.bag = Object.fromEntries(Object.entries(fresh.bag || {}).filter(([id]) => idx.items.has(id)));
    const where = s.respawn && game.maps[s.respawn.map] ? s.respawn : world.spawns.start;
    Object.assign(fresh.player, { map: where.map, x: where.x, y: where.y, facing: where.facing || 'down' });
    fresh.respawn = { ...where };
    fresh.script = fresh.starter ? [] : introOps();
    return fresh;
  }

  return Object.assign(game, { createState, step, view, restore, version: GAME_VERSION, expBar, levelCurve, rt, gateOpen });
}
