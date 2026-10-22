// A bot that plays the real game through its inputs: pathfinding across maps, talking through
// dialogue, and battling with the greedy policy (best expected damage), catching when asked and
// healing when low. Used by the scripted tests and the verifier's critical-path playthrough.
import { DIRS, isLedge, tileAt } from '../world/tiles.js';
import { liveEntities, passable } from '../world/overworld.js';
import { bestMove, statsOf, lookup, moveScore, moveOf } from '../rules/index.js';
import { battleBag } from '../world/battle-flow.js';

const INPUT = { up: { y: -1 }, down: { y: 1 }, left: { x: -1 }, right: { x: 1 } };

export function createBot(game, state, opts = {}) {
  const bot = {
    frames: 0, battles: [], log: [], stuck: 0,
    catchSpecies: opts.catchSpecies ?? null, // species id to catch, or 'any' for the first uncaught
    maxFrames: opts.maxFrames ?? 400000,
  };
  const step = (input = {}) => { game.step(state, input); bot.frames++; };
  const tap = (key, extra = {}) => { step({ ...extra, [key]: key === 'a' || key === 'b' ? true : undefined, ...(INPUT[key] || {}) }); step({}); };
  bot.step = step; bot.tap = tap;

  // ---------------------------------------------------------------- pathing

  /** BFS on the current map to any tile where goal(x, y) holds. Returns directions, or null. */
  bot.path = (goal, { avoidGrass = false } = {}) => {
    const map = game.maps[state.player.map];
    const blocked = new Set(liveEntities(game, state, map.id).filter(e => e.def.solid !== false).map(e => `${e.x},${e.y}`));
    const start = [state.player.x, state.player.y];
    const prev = new Map([[`${start[0]},${start[1]}`, null]]);
    const q = [start];
    while (q.length) {
      const [x, y] = q.shift();
      if (goal(x, y) && !(x === start[0] && y === start[1])) {
        const dirs = [];
        let k = `${x},${y}`;
        while (prev.get(k)) { const p = prev.get(k); dirs.unshift(p.dir); k = p.from; }
        return dirs;
      }
      // Don't path through warps unless they are the goal.
      if (!(x === start[0] && y === start[1]) && map.warps.some(w => w.x === x && w.y === y)) continue;
      for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
        let nx = x + dx, ny = y + dy;
        const ch = tileAt(map, nx, ny);
        if (isLedge(ch)) { if (dir !== 'down') continue; ny += 1; }
        else if (!passable(game, state, map, nx, ny)) continue;
        if (!passable(game, state, map, nx, ny) || blocked.has(`${nx},${ny}`)) continue;
        if (avoidGrass && tileAt(map, nx, ny) === '"' && !goal(nx, ny)) continue;
        const k = `${nx},${ny}`;
        if (prev.has(k)) continue;
        prev.set(k, { from: `${x},${y}`, dir });
        q.push([nx, ny]);
      }
    }
    return null;
  };

  /** Walk directions; stops early if a script or mode interrupts. Returns true when all were walked. */
  bot.walk = dirs => {
    for (const dir of dirs) {
      const p = state.player, [dx, dy] = DIRS[dir];
      const map = p.map, tx = p.x + dx * (isLedge(tileAt(game.maps[map], p.x + dx, p.y + dy)) ? 1 : 1), ty0 = p.y;
      let guard = 0;
      void tx; void ty0;
      const sx = p.x, sy = p.y;
      while (guard++ < 60) {
        if (state.mode !== 'overworld' || state.script.length || state.status !== 'playing') return false;
        step(INPUT[dir]);
        if (state.player.map !== map) return false;
        if ((state.player.x !== sx || state.player.y !== sy) && !state.player.move) break;
      }
      if (guard >= 60) { bot.stuck++; return false; }
    }
    // Let the last step settle (warps, encounters).
    for (let i = 0; i < 2 && state.mode === 'overworld' && !state.script.length; i++) step({});
    return true;
  };

  /** Maps reachable through warps: shortest map route from the current map to `target`. */
  bot.mapRoute = target => {
    const from = state.player.map;
    const prev = new Map([[from, null]]), q = [from];
    while (q.length) {
      const id = q.shift();
      if (id === target) break;
      for (const w of game.maps[id].warps) if (!prev.has(w.to)) { prev.set(w.to, id); q.push(w.to); }
    }
    if (!prev.has(target)) return null;
    const route = [];
    for (let k = target; k !== from; k = prev.get(k)) route.unshift(k);
    return route;
  };

  // ---------------------------------------------------------------- handling modes

  /** Run frames until the game is back in free overworld control (or the run ends). */
  bot.settle = (limit = 20000) => {
    let n = 0;
    while (n++ < limit && state.status === 'playing') {
      if (state.mode === 'overworld' && !state.script.length && !state.player.move) {
        step({});
        if (state.mode === 'overworld' && !state.script.length && !state.player.move) return true;
        continue;
      }
      bot.handle();
    }
    return state.status !== 'playing';
  };

  bot.handle = () => {
    switch (state.mode) {
      case 'dialogue': {
        const d = state.dialogue;
        if (d.choices && d.t * 1.25 >= d.pages[d.page].length && d.page === d.pages.length - 1) {
          const want = d.id === 'starter' ? (opts.starter ?? 0) : 0;
          if (d.cursor !== want) { tap(d.cursor < want ? 'down' : 'up'); return; }
        }
        tap('a'); return;
      }
      case 'battle': return battleTurn();
      case 'evolution': tap('a'); return;
      case 'menu': tap('b'); return;
      case 'shop': tap('b'); return;
      case 'pc': tap('b'); return;
      default: step({});
    }
  };

  // ---------------------------------------------------------------- battle policy

  const navGrid = (cur, target) => { if (cur % 2 !== target % 2) return 'right'; if ((cur >= 2) !== (target >= 2)) return 'down'; return null; };
  const navList = (cur, target) => (cur === target ? null : cur < target ? 'down' : 'up');

  function wantCatch(B) {
    if (B.kind !== 'wild' || state.party.length + state.box.length >= 30) return false;
    const foe = B.rules.foe.party[B.rules.foe.active];
    const target = bot.catchSpecies;
    if (!target) return false;
    if (target !== 'any' && foe.species !== target) return false;
    if (state.caught[foe.species]) return false;
    return battleBag(game, state).some(e => e.item.kind === 'ball');
  }

  function battleTurn() {
    const B = state.battle, R = B.rules, { content } = game;
    if (B.phase === 'beats') { tap('a'); if (!B.recorded && R.over) { B.recorded = true; bot.battles.push({ kind: B.kind, trainer: B.trainer?.id || null, outcome: R.outcome, turns: R.turn, frame: bot.frames }); } return; }
    const me = R.player.party[R.player.active], foe = R.foe.party[R.foe.active];
    if (B.phase === 'learn') { tap('b'); return; }
    if (B.phase === 'party') {
      // Best matchup among the healthy.
      let best = -1, bestScore = -1;
      R.player.party.forEach((c, i) => {
        if (c.hp <= 0 || (i === R.player.active && !B.forced)) return;
        const s = Math.max(...c.moves.map(m => moveScore(content, c, foe, moveOf(content, m.id)))) * (c.hp / statsOf(content, c).hp + 0.5);
        if (s > bestScore) { best = i; bestScore = s; }
      });
      if (best < 0) { tap('b'); return; }
      const d = navList(B.sub, best);
      tap(d || 'a'); return;
    }
    const lowHp = me.hp / statsOf(content, me).hp;
    const healer = battleBag(game, state).find(e => e.item.kind === 'heal');
    const catching = wantCatch(B);
    const foeLow = foe.hp / statsOf(content, foe).hp;
    let plan;
    if (catching && (foeLow < 0.55 || lookup(content).species.get(foe.species).catchRate >= 200)) plan = { menu: 1, ball: true };
    else if (lowHp < 0.3 && healer && B.kind !== 'wild') plan = { menu: 1, heal: healer.id };
    else {
      // Switch out of a hopeless matchup once per foe in trainer battles.
      plan = { menu: 0, move: bestMove(content, R.player, R.foe, { statusMoves: !catching || foeLow > 0.55 }) };
      if (catching && foeLow < 0.55) {
        // Use the weakest damaging move to avoid knocking it out.
        let weakest = plan.move, ws = Infinity;
        me.moves.forEach((m, i) => { const mv = moveOf(content, m.id); const sc = moveScore(content, me, foe, mv); if (m.pp > 0 && mv.power && sc < ws) { ws = sc; weakest = i; } });
        plan.move = weakest;
      }
      if (plan.move < 0) plan.move = 0;
    }
    if (B.phase === 'menu') { const d = navGrid(B.cursor, plan.menu); tap(d || 'a'); return; }
    if (B.phase === 'moves') { if (plan.menu !== 0) { tap('b'); return; } const d = navGrid(B.sub, plan.move); tap(d || 'a'); return; }
    if (B.phase === 'bag') {
      const bag = battleBag(game, state);
      const target = plan.ball ? bag.findIndex(e => e.item.kind === 'ball') : plan.heal ? bag.findIndex(e => e.id === plan.heal) : -1;
      if (target < 0) { tap('b'); return; }
      const d = navList(B.sub, target); tap(d || 'a'); return;
    }
    if (B.phase === 'target') { const d = navList(B.sub, R.player.active); tap(d || 'a'); return; }
    tap('b');
  }

  // ---------------------------------------------------------------- goals

  /** Go to a map (through warps), then optionally to a tile on it. Returns true on arrival. */
  bot.goTo = (mapId, tile, { avoidGrass = false } = {}) => {
    for (let tries = 0; tries < 200 && state.status === 'playing'; tries++) {
      if (bot.frames > bot.maxFrames) return false;
      if (!bot.settle()) return false;
      if (state.player.map === mapId) {
        if (!tile) return true;
        if (state.player.x === tile.x && state.player.y === tile.y) return true;
        const dirs = bot.path((x, y) => x === tile.x && y === tile.y, { avoidGrass });
        if (!dirs) { bot.fail = `no path to ${tile.x},${tile.y} on ${mapId}`; step({}); continue; }
        bot.walk(dirs);
        continue;
      }
      const route = bot.mapRoute(mapId);
      if (!route) { bot.fail = `no map route to ${mapId}`; return false; }
      const next = route[0], map = game.maps[state.player.map];
      const exits = map.warps.filter(w => w.to === next);
      const dirs = bot.path((x, y) => exits.some(w => w.x === x && w.y === y), { avoidGrass });
      if (!dirs) { bot.fail = `no path on ${state.player.map} from ${state.player.x},${state.player.y} to ${next}`; for (let i = 0; i < 40; i++) step({}); continue; }
      bot.walk(dirs);
    }
    return state.player.map === mapId;
  };

  /** Walk next to an entity and press A facing it. */
  bot.talkTo = id => {
    bot.settle();
    const e = liveEntities(game, state, state.player.map).find(x => x.def.id === id);
    if (!e) return false;
    const map = game.maps[state.player.map];
    const near = (x, y) => [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => x + dx === e.x && y + dy === e.y)
      || [[0, -2], [0, 2], [-2, 0], [2, 0]].some(([dx, dy]) => x + dx === e.x && y + dy === e.y && tileAt(map, x + dx / 2, y + dy / 2) === 'C');
    if (!near(state.player.x, state.player.y)) { const dirs = bot.path(near); if (!dirs) return false; bot.walk(dirs); bot.settle(); }
    const p = state.player, dx = Math.sign(e.x - p.x), dy = Math.sign(e.y - p.y);
    const dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
    if (p.facing !== dir) { step(INPUT[dir]); step({}); }
    tap('a');
    return true;
  };

  /** Move party member i to the front through the start menu (Party → Switch). */
  bot.swapToFront = i => {
    if (i <= 0 || i >= state.party.length || !bot.settle()) return false;
    const want = state.party[i].uid;
    tap('b');                                   // open the start menu
    if (state.mode !== 'menu') return false;
    tap('a');                                   // Party
    for (let k = 0; k < i; k++) tap('down');
    tap('a'); tap('down'); tap('a');            // Switch
    for (let k = 0; k < i; k++) tap('up');
    tap('a');                                   // swap with the first slot
    for (let k = 0; k < 3 && state.mode === 'menu'; k++) tap('b');
    return state.party[0].uid === want;
  };

  /** Walk back and forth in encounter tiles until a battle starts (or a step budget runs out). */
  bot.grind = (steps = 200) => {
    const map = game.maps[state.player.map];
    const enc = map.encounter === 'grass' ? '"' : map.encounter === 'floor' ? '_' : null;
    if (!enc) return false;
    for (let i = 0; i < steps && state.status === 'playing'; i++) {
      if (!bot.settle()) return false;
      if (tileAt(map, state.player.x, state.player.y) !== enc) {
        const dirs = bot.path((x, y) => tileAt(map, x, y) === enc);
        if (!dirs) return false;
        bot.walk(dirs);
        continue;
      }
      const dirs = Object.keys(DIRS).filter(d => { const [dx, dy] = DIRS[d]; return tileAt(map, state.player.x + dx, state.player.y + dy) === enc && passable(game, state, map, state.player.x + dx, state.player.y + dy); });
      if (!dirs.length) return false;
      const before = bot.battles.length;
      bot.walk([dirs[i % dirs.length]]);
      if (state.mode === 'transition' || state.mode === 'battle') { bot.settle(); if (bot.battles.length > before) return true; }
    }
    return false;
  };

  return bot;
}
