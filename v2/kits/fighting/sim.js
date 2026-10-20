// The fighting simulation: menus, select and VS screens, rounds, and a 60 Hz fighter state
// machine with frame data, hitboxes/hurtboxes, blocking, throws, specials by motion, supers,
// combos, juggles, hit-stop and KO slow motion. Pure and deterministic: all randomness comes
// from state.rng (v2/kernel/rng.js), and state is plain JSON.
import { random } from '../../kernel/rng.js';
import { compileFighter, phaseOf, SUPER_COST } from './moves.js';
import { record, recentPress, pressedAt, consume, hasMotion, doubleTap, pressedBoth, rel, dirOf, PRESS_BUFFER, CANCEL_BUFFER } from './input.js';
import { cpuInput, newBrain } from './ai.js';

import { ARENA, useArena, useArenaOf } from './arena.js';
export { ARENA };
export const JUGGLE_MAX = 3;
const SCALING = [1, 1, 0.85, 0.75, 0.65, 0.56, 0.48, 0.42, 0.36, 0.3];
const NEUTRAL = { x: 0, y: 0, a: false, b: false };
const FREE = new Set(['idle', 'walk', 'crouch', 'guard']);
const UNTHROWABLE = new Set(['hit', 'block', 'knockdown', 'wakeup', 'thrown', 'throw', 'ko', 'dazed', 'launch', 'ledge', 'climb', 'respawn', 'flourished']);
const IMMUNE = new Set(['knockdown', 'wakeup', 'ko', 'thrown', 'throw', 'climb', 'respawn', 'flourish', 'flourished', 'win']);
const AIR_SPECIAL_OK = new Set(['fireball', 'uppercut', 'spin_kick', 'charge_dash', 'teleport', 'air_dive', 'axe_kick', 'flurry']);

const sign = v => v > 0 ? 1 : v < 0 ? -1 : 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ev = (state, name, data = {}) => state.events.push({ name, ...data });

// ---------- setup ----------
export function createGame(content, { seed = 1 } = {}) {
  const roster = content.fighters.map(compileFighter);
  const index = new Map(roster.map((f, i) => [f.id, i]));
  const bossIdx = index.get(content.boss.fighter);
  let selectable = roster.map((_, i) => i).filter(i => i !== bossIdx);
  if (!selectable.length) selectable = roster.map((_, i) => i);
  const stageIdx = new Map(content.stages.map((s, i) => [s.id, i]));
  const game = { content, roster, index, bossIdx, selectable, stageIdx, platform: content.mode === 'platform', seed, toWin: content.roundsToWin, maxRounds: content.roundsToWin * 2 + 1, speed: content.gameSpeed };
  game.createState = () => ({
    status: 'playing', score: 0, events: [], rng: (Number(seed) >>> 0) || 1, frame: 0,
    phase: 'menu', pt: 0, menu: { cursor: 0 }, sel: null, arcade: null, match: null,
    fighters: [], projectiles: [], pid: 0, hitstop: 0, slow: 0, flash: null, banner: null, nav: { prev: NEUTRAL, held: 0 },
    stats: { hits: 0, maxCombo: 0, perfects: 0, finishers: 0, rounds: 0, matches: 0 },
  });
  game.step = (state, input) => step(game, state, input || NEUTRAL);
  game.startMatch = (state, opts) => startMatch(game, state, opts);
  // Test hooks for verification: start a move directly, skip the round intro.
  game.debug = {
    startMove: (state, slot, id) => startMove(game, state, state.fighters[slot], id),
    skipIntro: state => { if (state.phase === 'intro') { setPhase(state, 'fight'); state.banner = null; } },
  };
  return game;
}

/** The arcade ladder for fighter p1: content ladder, then the boss. */
export function ladderFor(game, p1) {
  const c = game.content, list = c.ladder.map(r => ({ fighter: game.index.get(r.fighter), difficulty: r.difficulty }));
  list.forEach(r => { r.stage = game.stageIdx.get(game.roster[r.fighter].fighter.stage) ?? 0; });
  // Classic arcade: you never fight yourself on the way up (unless that leaves no one).
  const others = list.filter(r => r.fighter != null && r.fighter !== p1);
  const ladder = others.length || !list.length ? others : list;
  ladder.push({ fighter: game.bossIdx, difficulty: c.boss.difficulty, stage: game.stageIdx.get(c.boss.stage) ?? 0, boss: true });
  return ladder.filter(r => r.fighter != null);
}

function newFighter(game, slot, fid, level, wins = 0) {
  const F = game.roster[fid], ph = F.phys;
  return {
    slot, fid, x: 0, y: 0, vx: 0, vy: 0, pv: 0, facing: slot === 0 ? 1 : -1, air: false,
    hp: ph.hp, maxHp: ph.hp, meter: 0, percent: 0, stocks: game.content.stocks, wins,
    st: 'idle', t: 0, move: null, mf: 0, hitsDone: 0, lastHitMf: -99, connect: null, landT: 0,
    stun: 0, juggle: 0, invuln: 0, inv: null, throwProt: 0, hidden: false, airUsed: false, jumps: 1, airSpecial: false,
    combo: 0, comboDmg: 0, crouchHit: false, blockLow: false, grab: null, counterStrike: 0, diving: false, dropT: 0, ledgeCd: 0,
    buf: [], n: 0, prev: { ...NEUTRAL }, consumed: -1, charge: { b: 0, d: 0, bm: 0, dm: 0 },
    jumpDir: 0, finishStyle: F.fighter.finish.style, mirror: false,
    cpu: level ? newBrain(level) : null,
  };
}

/** Start a match directly: { p1, p2 (roster indices), stage, level (CPU difficulty for p2), cpuBoth, levels:[l1,l2] }. */
export function startMatch(game, state, { p1, p2, stage = 0, level = 1, cpuBoth = false, levels = null } = {}) {
  const l = levels || [cpuBoth ? level : 0, level];
  state.match = { p1, p2, stage, level, round: 0, wins: [0, 0], timer: 0, winner: null, rounds: [], cpuBoth, levels: l, mirror: p1 === p2, arena: game.content.stages[stage]?.width || 920 };
  useArenaOf(state);
  state.fighters = [newFighter(game, 0, p1, l[0]), newFighter(game, 1, p2, l[1])];
  state.fighters[1].mirror = p1 === p2;
  state.cpuBoth = cpuBoth;
  startRound(game, state);
}

function startRound(game, state) {
  const m = state.match, [a, b] = state.fighters;
  m.round++;
  m.timer = (game.platform ? game.content.roundTime * 3 : game.content.roundTime) * 60;
  useArenaOf(state);
  const cx = game.platform ? ARENA.P.center : ARENA.T.center, d = game.platform ? ARENA.P.start : ARENA.T.start;
  for (const f of [a, b]) {
    const keep = { meter: f.meter, wins: f.wins, cpu: f.cpu };
    Object.assign(f, newFighter(game, f.slot, f.fid, 0, keep.wins), { meter: m.round === 1 ? 0 : keep.meter, cpu: keep.cpu ? newBrain(keep.cpu.level) : null, mirror: f.mirror });
    f.x = cx + (f.slot === 0 ? -d : d);
    f.facing = f.slot === 0 ? 1 : -1;
  }
  state.projectiles = []; state.hitstop = 0; state.slow = 0; state.flash = null;
  setPhase(state, 'intro');
  const final = m.wins[0] === game.toWin - 1 && m.wins[1] === game.toWin - 1;
  banner(state, game.platform ? 'READY' : final ? 'FINAL ROUND' : `ROUND ${m.round}`, 'round');
  ev(state, 'round', { round: m.round });
}

const setPhase = (state, phase) => { state.phase = phase; state.pt = 0; };
const banner = (state, text, kind, sub = '') => { state.banner = { text, kind, sub, at: state.frame }; };

// ---------- top-level step ----------
function step(game, state, input) {
  state.events = [];
  if (state.status !== 'playing') return state;
  state.frame++; state.pt++;
  const nav = navEdges(state, input);
  switch (state.phase) {
    case 'menu': return menuStep(game, state, nav);
    case 'select': return selectStep(game, state, nav);
    case 'vs': if (state.pt > 150 || (nav.a && state.pt > 30)) beginRung(game, state); return state;
    case 'matchEnd': return matchEndStep(game, state, nav);
    case 'continue': return continueStep(game, state, nav);
    case 'ending': if (state.pt > 480 || (nav.a && state.pt > 60)) { state.status = 'won'; ev(state, 'won'); } return state;
    default: {
      // Game speed runs extra (or fewer) simulation frames per step, like an arcade turbo setting.
      useArenaOf(state);
      state.speedAcc = (state.speedAcc || 0) + game.speed;
      while (state.speedAcc >= 1 && state.status === 'playing' && state.match) { state.speedAcc -= 1; fightStep(game, state, input); if (!FIGHT_PHASES.has(state.phase)) { state.speedAcc = 0; break; } }
      return state;
    }
  }
}
const FIGHT_PHASES = new Set(['intro', 'fight', 'ko', 'finish', 'flourish', 'roundEnd']);

// Menu navigation edges with hold-to-repeat.
function navEdges(state, input) {
  const p = state.nav.prev, held = (input.x || input.y) && input.x === p.x && input.y === p.y;
  state.nav.held = held ? state.nav.held + 1 : 0;
  const rep = state.nav.held > 18 && state.nav.held % 6 === 0;
  const out = { dx: input.x !== p.x || rep ? input.x : 0, dy: input.y !== p.y || rep ? input.y : 0, a: input.a && !p.a, b: input.b && !p.b };
  state.nav.prev = { x: input.x, y: input.y, a: !!input.a, b: !!input.b };
  return out;
}

function menuStep(game, state, nav) {
  if (nav.dy || nav.dx) { state.menu.cursor = (state.menu.cursor + 1) % 2; ev(state, 'menu_move'); }
  if (nav.a) {
    state.sel = { mode: state.menu.cursor ? 'versus' : 'arcade', step: 'p1', cursor: 0, p1: null, cpu: null, level: 2 };
    setPhase(state, 'select'); ev(state, 'menu_confirm');
  }
  return state;
}

function selectStep(game, state, nav) {
  const s = state.sel;
  const list = s.step === 'p1' ? game.selectable : game.roster.map((_, i) => i);
  const cols = Math.min(4, list.length);
  if (s.step === 'level') {
    if (nav.dx || nav.dy) { s.level = clamp(s.level + (nav.dx || -nav.dy), 1, 5); ev(state, 'menu_move'); }
    if (nav.a) { const stage = game.stageIdx.get(game.roster[s.cpu].fighter.stage) ?? 0; state.arcade = null; state.vs = { p1: s.p1, p2: s.cpu, stage, level: s.level }; setPhase(state, 'vs'); ev(state, 'menu_confirm'); }
    else if (nav.b) { s.step = 'cpu'; ev(state, 'menu_move'); }
    return state;
  }
  if (nav.dx || nav.dy) {
    let c = s.cursor;
    if (nav.dx) c = (c + nav.dx + list.length) % list.length;
    if (nav.dy) { c += nav.dy * cols; if (c < 0 || c >= list.length) c = s.cursor; }
    if (c !== s.cursor) { s.cursor = c; ev(state, 'menu_move'); }
  }
  if (nav.b) { if (s.step === 'cpu') { s.step = 'p1'; s.cursor = Math.max(0, game.selectable.indexOf(s.p1)); } else setPhase(state, 'menu'); ev(state, 'menu_move'); return state; }
  if (nav.a) {
    ev(state, 'menu_confirm');
    if (s.step === 'p1') {
      s.p1 = list[s.cursor];
      if (s.mode === 'arcade') { state.arcade = { list: ladderFor(game, s.p1), rung: 0, p1: s.p1 }; queueRung(game, state); }
      else { s.step = 'cpu'; s.cursor = 0; }
    } else { s.cpu = list[s.cursor]; s.step = 'level'; }
  }
  return state;
}

function queueRung(game, state) {
  const ar = state.arcade, r = ar.list[ar.rung];
  state.vs = { p1: ar.p1, p2: r.fighter, stage: r.stage, level: r.difficulty, boss: !!r.boss, rung: ar.rung, of: ar.list.length };
  setPhase(state, 'vs');
}
function beginRung(game, state) {
  const v = state.vs;
  startMatch(game, state, { p1: v.p1, p2: v.p2, stage: v.stage, level: v.level });
}

function matchEndStep(game, state, nav) {
  const m = state.match;
  if (m.cpuBoth) { if (state.pt > 60) { state.status = m.winner === 0 ? 'won' : 'lost'; state.reason = m.winner === 0 ? 'Left fighter won' : 'Right fighter won'; } return state; }
  if (state.pt < 200 && !(nav.a && state.pt > 60)) return state;
  const won = m.winner === 0;
  state.stats.matches++;
  if (state.arcade) {
    if (won) {
      state.arcade.rung++;
      if (state.arcade.rung >= state.arcade.list.length) { setPhase(state, 'ending'); state.score += 10000; ev(state, 'level_up'); }
      else { queueRung(game, state); ev(state, 'level_up'); }
    } else { setPhase(state, 'continue'); }
  } else {
    state.status = won ? 'won' : 'lost';
    if (!won) state.reason = loseReason(game, state);
    ev(state, won ? 'won' : 'lost');
  }
  return state;
}
const loseReason = (game, state) => `${m2name(game, state)} won the match`;
const m2name = (game, state) => game.roster[state.match.p2].name;

function continueStep(game, state, nav) {
  if (nav.a && state.pt > 20) { state.score = Math.floor(state.score / 2); queueRung(game, state); ev(state, 'menu_confirm'); return state; }
  if (state.pt > 600 || (nav.b && state.pt > 20)) {
    const ar = state.arcade;
    state.status = 'lost'; state.reason = `Defeated by ${m2name(game, state)} (stage ${ar.rung + 1} of ${ar.list.length})`;
    ev(state, 'lost');
  }
  return state;
}

// ---------- fight ----------
function fightStep(game, state, input) {
  const fs = state.fighters, m = state.match;
  const winner = m.winner;
  for (const f of fs) {
    const o = fs[1 - f.slot];
    let inp = f.cpu ? cpuInput(game, state, f, o) : f.slot === 0 ? input : NEUTRAL;
    const live = state.phase === 'fight' || (state.phase === 'finish' && f.slot === winner);
    if (!live) inp = NEUTRAL;
    record(f, inp);
  }
  if (state.flash) { if (--state.flash.t <= 0) state.flash = null; return state; }
  if (state.hitstop > 0) { state.hitstop--; return state; }
  if (state.slow > 0) { state.slow--; if (state.slow % 3) return state; }
  for (const f of fs) think(game, state, f, fs[1 - f.slot]);
  for (const f of fs) physics(game, state, f, fs[1 - f.slot]);
  separate(game, fs[0], fs[1]);
  for (const f of fs) if (canTurn(f)) { const dx = fs[1 - f.slot].x - f.x; if (Math.abs(dx) > 2) f.facing = sign(dx); }
  stepProjectiles(game, state);
  resolveHits(game, state);
  if (game.platform) blastZones(game, state);
  phaseClock(game, state);
  return state;
}

const canTurn = f => !f.air && (FREE.has(f.st) || f.st === 'land' || f.st === 'prejump' || f.st === 'wakeup');

function phaseClock(game, state) {
  const m = state.match, fs = state.fighters;
  switch (state.phase) {
    case 'intro':
      if (state.pt === 70) { banner(state, game.platform ? 'GO!' : 'FIGHT!', 'fight'); ev(state, 'fight'); }
      if (state.pt >= 100) setPhase(state, 'fight');
      break;
    case 'fight':
      if (--m.timer <= 0) timeOver(game, state);
      break;
    case 'finish':
      if (state.pt > 330) { const l = fs[1 - m.winner]; knockOut(game, state, l, fs[m.winner], { force: true }); }
      break;
    case 'flourish':
      if (state.pt > 210) endRound(game, state);
      break;
    case 'ko':
      if ((state.pt > 110 && fs.every(f => !f.air || f.st === 'ledge') && !state.slow) || state.pt > 420) endRound(game, state);
      break;
    case 'roundEnd':
      if (state.pt === 45 && m.winner != null) { const w = fs[m.winner]; if (!w.air && w.st !== 'ko') { w.st = 'win'; w.t = 0; w.vx = 0; } }
      if (state.pt > 170) {
        const done = m.wins.some(w => w >= game.toWin) || m.round >= game.maxRounds;
        if (done) {
          m.winner = m.wins[0] > m.wins[1] ? 0 : 1;
          setPhase(state, 'matchEnd');
          const w = game.roster[fs[m.winner].fid];
          banner(state, `${w.name.toUpperCase()} WINS`, 'match', w.fighter.winQuote);
          if (!m.cpuBoth) ev(state, m.winner === 0 ? 'reach_goal' : 'fell');
        } else startRound(game, state);
      }
      break;
  }
}

function timeOver(game, state) {
  const m = state.match, [a, b] = state.fighters;
  let w;
  if (game.platform) w = a.stocks !== b.stocks ? (a.stocks > b.stocks ? 0 : 1) : a.percent !== b.percent ? (a.percent < b.percent ? 0 : 1) : null;
  else { const ra = a.hp / a.maxHp, rb = b.hp / b.maxHp; w = ra === rb ? null : ra > rb ? 0 : 1; }
  m.winner = w;
  setPhase(state, 'roundEnd');
  banner(state, w == null ? 'DRAW GAME' : 'TIME', 'time');
  ev(state, 'time_up');
  scoreRound(game, state, w);
}

function scoreRound(game, state, w) {
  const m = state.match;
  m.rounds.push({ winner: w, timer: m.timer, how: state.banner?.kind });
  if (w != null) m.wins[w]++;
  for (const f of state.fighters) f.wins = m.wins[f.slot];
  state.stats.rounds++;
  if (w === 0 && !m.cpuBoth) {
    const f = state.fighters[0];
    state.score += 1000 + Math.ceil(m.timer / 60) * 50 + Math.round((f.hp / f.maxHp) * 1000);
  }
}

function endRound(game, state) {
  const m = state.match;
  setPhase(state, 'roundEnd');
  if (m.pendingWinner !== undefined) {
    const w = m.pendingWinner; delete m.pendingWinner;
    m.winner = w;
    const wf = state.fighters[w ?? 0];
    if (w != null && !game.platform && wf.hp === wf.maxHp) { banner(state, 'PERFECT', 'perfect'); ev(state, 'perfect'); if (w === 0) { state.score += 5000; state.stats.perfects++; } }
    scoreRound(game, state, w);
  }
}

// A KO: slow motion, then the round ends. The match-deciding KO may open the finish window instead.
function knockOut(game, state, loser, winner, { force = false } = {}) {
  const m = state.match;
  const deciding = !game.platform && m.wins[winner.slot] + 1 >= game.toWin;
  if (!force && game.content.finisher && deciding && state.phase === 'fight' && !loser.air) {
    m.winner = winner.slot;
    loser.st = 'dazed'; loser.t = 0; loser.vx = 0; loser.pv = 0; loser.hp = 0; loser.stun = 0;
    setPhase(state, 'finish');
    state.projectiles = [];
    banner(state, 'FINISH!', 'finish', `${game.roster[winner.fid].fighter.finish.name}: down, down + B`);
    ev(state, 'finish');
    return;
  }
  loser.hp = 0;
  loser.st = 'ko'; loser.t = 0; loser.air = true; loser.y = Math.max(loser.y, 1);
  loser.vy = 7.5; loser.vx = sign(loser.x - winner.x || -loser.facing) * 3.2;
  m.pendingWinner = winner.slot;
  setPhase(state, 'ko');
  state.slow = 90; state.hitstop = Math.max(state.hitstop, 24);
  banner(state, 'K.O.', 'ko');
  ev(state, 'ko', { slot: loser.slot, x: loser.x, y: loser.y + 50 });
  ev(state, loser.slot === 0 && !m.cpuBoth ? 'hurt' : 'defeated');
}

function tryFinisher(game, state, w, l) {
  if (!FREE.has(w.st) || Math.abs(w.x - l.x) > 170) return false;
  const pi = recentPress(w, 'b', PRESS_BUFFER);
  if (pi < 0 || !hasMotion(w, 'tap-dd', pi)) return false;
  consume(w, pi);
  w.st = 'flourish'; w.t = 0; w.vx = 0;
  l.st = 'flourished'; l.t = 0;
  state.match.pendingWinner = w.slot;
  setPhase(state, 'flourish');
  banner(state, game.roster[w.fid].fighter.finish.name.toUpperCase(), 'flourish');
  ev(state, 'finisher', { slot: w.slot, style: w.finishStyle, x: l.x, y: l.y + 50 });
  if (w.slot === 0 && !state.match.cpuBoth) { state.score += 3000; state.stats.finishers++; }
  return true;
}

// ---------- fighter state machine ----------
function threatened(game, state, f, o) {
  if (o.st === 'attack' && phaseOf(game.roster[o.fid].moves[o.move], o.mf) !== 'recovery' && Math.abs(o.x - f.x) < 220) return true;
  return state.projectiles.some(p => p.owner === o.slot && Math.abs(p.x - f.x) < 240 && sign(p.vx) === sign(f.x - p.x));
}

function think(game, state, f, o) {
  const F = game.roster[f.fid], ph = F.phys;
  f.t++;
  if (f.invuln > 0) f.invuln--;
  if (f.throwProt > 0) f.throwProt--;
  if (f.ledgeCd > 0) f.ledgeCd--;
  const v = f.buf[f.buf.length - 1], d = rel(dirOf(v), f.facing);
  const live = state.phase === 'fight' || (state.phase === 'finish' && f.slot === state.match.winner);
  const free = () => {
    if (!live) { f.st = 'idle'; f.vx = 0; return; }
    if (state.phase === 'finish' && tryFinisher(game, state, f, o)) return;
    if (tryAct(game, state, f, o)) return;
    if (doubleTap(f, 'fwd')) { setSt(f, 'dash'); f.vx = ph.dash * f.facing; return; }
    if (doubleTap(f, 'back')) { setSt(f, 'backdash'); f.vx = -ph.dash * 0.9 * f.facing; f.invuln = Math.max(f.invuln, 6); return; }
    if (d >= 7) { setSt(f, 'prejump'); f.jumpDir = d === 9 ? 1 : d === 7 ? -1 : 0; f.vx = 0; return; }
    const guard = (d === 4 || d === 1) && threatened(game, state, f, o);
    if (game.platform && f.surface === 'soft' && d >= 1 && d <= 3) { f.dropT++; if (f.dropT > 9) { f.air = true; f.y -= 2; f.vy = -1; setSt(f, 'air'); f.dropT = 0; f.dropping = 12; return; } } else f.dropT = 0;
    if (d <= 3) { f.st = guard ? 'guard' : 'crouch'; f.vx = 0; }
    else if (guard) { f.st = 'guard'; f.vx = 0; }
    else if (d === 6) { f.st = 'walk'; f.vx = ph.walk * f.facing; }
    else if (d === 4) { f.st = 'walk'; f.vx = -ph.back * f.facing; }
    else { f.st = 'idle'; f.vx = 0; }
  };
  switch (f.st) {
    case 'idle': case 'walk': case 'crouch': case 'guard': free(); break;
    case 'prejump':
      if (live && tryAct(game, state, f, o, { specialsOnly: true })) break;
      if (f.t >= 4) { f.air = true; f.vy = ph.jumpV; f.vx = f.jumpDir * ph.jumpX * f.facing; setSt(f, 'air'); f.airUsed = false; ev(state, 'jump', { slot: f.slot }); }
      break;
    case 'air':
      if (!live) break;
      if (game.platform && airJump(state, f, ph, d)) break;
      tryAct(game, state, f, o, { air: true });
      break;
    case 'land': f.vx *= 0.6; if (f.t >= f.landT) { f.st = 'idle'; free(); } break;
    case 'dash': f.vx *= 0.9; if (f.t >= 16) { f.st = 'idle'; f.vx = 0; } break;
    case 'backdash': f.vx *= 0.9; if (f.t >= 19) { f.st = 'idle'; f.vx = 0; } break;
    case 'attack': runMove(game, state, f, o, live); break;
    case 'hit': case 'block':
      f.vx = 0;
      if (--f.stun <= 0) { f.st = 'idle'; f.throwProt = 6; f.combo = 0; f.comboDmg = 0; f.juggle = 0; }
      break;
    case 'launch':
      if (game.platform && --f.stun <= 0) { setSt(f, 'air'); f.airUsed = false; f.combo = 0; f.comboDmg = 0; }
      break;
    case 'knockdown':
      f.vx *= 0.8;
      if (f.t >= (game.platform ? 22 : 38)) { setSt(f, 'wakeup'); f.invuln = 18; }
      break;
    case 'wakeup': if (f.t >= 16) { f.st = 'idle'; f.combo = 0; f.comboDmg = 0; f.juggle = 0; f.throwProt = 4; } break;
    case 'throw': runThrow(game, state, f, o); break;
    case 'thrown': break;
    case 'ledge': ledgeThink(state, f, d, ph); break;
    case 'climb': if (f.t >= 14) { const L = f.ledge; f.x = L < 0 ? ARENA.P.main.x0 + ph.hw + 2 : ARENA.P.main.x1 - ph.hw - 2; f.y = 0; f.air = false; f.st = 'idle'; f.invuln = Math.max(f.invuln, 6); } break;
    case 'respawn':
      f.vx = 0; f.vy = 0; f.y = 230; f.x = ARENA.P.center;
      if (f.t > 40) f.hidden = false;
      if (f.t >= 100 || (f.t > 50 && live && (d !== 5 || recentPress(f, 'any', 2) >= 0))) { setSt(f, 'air'); f.airUsed = false; f.jumps = 1; }
      break;
    default: break;  // dazed, ko, win, flourish, flourished: animation only
  }
}
const setSt = (f, st) => { f.st = st; f.t = 0; };

function airJump(state, f, ph, d) {
  const prevD = f.buf.length > 1 ? rel(dirOf(f.buf[f.buf.length - 2]), f.facing) : 5;
  if (d >= 7 && prevD < 7 && f.jumps > 0 && f.t > 3) {
    f.jumps--; f.vy = ph.jumpV * 0.95; f.vx = (d === 9 ? 1 : d === 7 ? -1 : 0) * ph.jumpX * f.facing; f.t = 0; f.airUsed = false;
    ev(state, 'jump', { slot: f.slot, air: true });
    return true;
  }
  if (d <= 3 && prevD > 3 && f.vy < 2) f.vy = Math.min(f.vy, -ph.jumpV * 1.05); // fast fall
  if (d === 6 || d === 4) f.vx = clamp(f.vx + (d === 6 ? 0.18 : -0.18) * f.facing, -ph.jumpX * 1.1, ph.jumpX * 1.1);
  return false;
}

/** Try to start an action from a free state. Order: super, specials, throw, normals. */
function tryAct(game, state, f, o, { air = false, specialsOnly = false, cancelFrom = null } = {}) {
  const F = game.roster[f.fid], within = cancelFrom ? CANCEL_BUFFER : PRESS_BUFFER;
  const pi = recentPress(f, 'any', within);
  if (pi < 0) return false;
  const btn = pressedAt(f, pi).includes('b') ? 'b' : 'a';
  const canSuper = f.meter >= SUPER_COST && (!cancelFrom || cancelFrom.superCancel || cancelFrom.kind === 'special');
  const superOk = !air || game.platform;
  if (canSuper && superOk && hasMotion(f, 'qcf2', pi)) { consume(f, pi); startMove(game, state, f, 'super'); return true; }
  const inAir = air || f.air;
  if (!cancelFrom || cancelFrom.specialCancel) for (const sp of inAir ? F.airSpecials : F.specials) {
    if (inAir ? !(sp.air || (game.platform && AIR_SPECIAL_OK.has(sp.archetype))) : sp.shadowed) continue;
    if (inAir && f.airSpecial && game.platform) continue;
    if ((sp.archetype === 'fireball' || sp.archetype === 'ground_wave') && state.projectiles.some(p => p.owner === f.slot)) continue;
    if (!hasMotion(f, sp.motion, pi)) continue;
    consume(f, pi);
    if (inAir) f.airSpecial = true;
    startMove(game, state, f, sp[btn]);
    return true;
  }
  if (specialsOnly || (cancelFrom && !cancelFrom.chain.length)) return false;
  if (!air && !cancelFrom && pressedBoth(f) && throwReach(game, f, o, F.moves.throw.params.range)) { consume(f, f.buf.length - 1); startMove(game, state, f, 'throw'); return true; }
  const crouch = [1, 2, 3].includes(rel(dirOf(f.buf[f.buf.length - 1]), f.facing));
  const id = air ? (btn === 'b' ? 'jB' : 'jA') : (crouch ? '2' : '5') + (btn === 'b' ? 'B' : 'A');
  if (cancelFrom && !cancelFrom.chain.includes(id)) return false;
  if (air && f.airUsed) return false;
  consume(f, pi);
  startMove(game, state, f, id);
  return true;
}
const throwReach = (game, f, o, range) => Math.abs(o.x - f.x) <= range && !o.air && Math.abs(o.y - f.y) < 10;

function startMove(game, state, f, id) {
  const F = game.roster[f.fid], m = F.moves[id];
  f.st = 'attack'; f.t = 0; f.move = id; f.mf = 0; f.hitsDone = 0; f.lastHitMf = -99; f.connect = null; f.diving = false; f.counterStrike = 0; f.hidden = false;
  if (!f.air) f.vx = 0;
  if (f.air) f.airUsed = true;
  if (m.kind === 'special') f.meter = Math.min(SUPER_COST, f.meter + 3);
  if (m.kind === 'super') {
    f.meter -= SUPER_COST;
    state.flash = { slot: f.slot, t: 36, name: m.name };
    ev(state, 'super', { slot: f.slot, title: m.name });
    ev(state, 'power', { slot: f.slot });
  }
  ev(state, 'move', { slot: f.slot, id, kind: m.kind });
}

function runMove(game, state, f, o, live) {
  const F = game.roster[f.fid], m = F.moves[f.move], P = m.params;
  f.mf++;
  const ph = phaseOf(m, f.mf);
  f.inv = m.invuln && f.mf >= m.invuln[0] && f.mf <= m.invuln[1] ? m.invuln[2] : null;
  // Cancels: chain normals, special cancels and super cancels once the move has connected.
  if (live && f.connect && f.mf > m.startup && f.mf <= m.startup + m.active + 8 && (m.chain.length || m.specialCancel || m.superCancel)) {
    if (tryAct(game, state, f, o, { cancelFrom: m, air: f.air })) return;
  }
  if (game.platform && f.air && f.mf === m.startup && ['rise', 'travel', 'dive'].includes(m.behavior)) { const hx = sign(f.prev.x); if (hx) f.facing = hx; }
  const fwd = f.facing;
  switch (m.behavior) {
    case 'strike':
      if (P.vx && ph === 'active') f.vx = P.vx * fwd; else if (!f.air) f.vx *= 0.7;
      if (f.air && m.kind !== 'normal') { f.vy = Math.max(f.vy, -0.5); }
      break;
    case 'projectile':
      if (f.air) f.vy = Math.max(f.vy, -1);
      if (f.mf === m.startup + 1) spawnProjectile(state, f, F, m);
      break;
    case 'rise':
      if (f.mf === m.startup + 1) { f.air = true; f.y = Math.max(f.y, 1); f.vy = P.vy; f.vx = P.vx * fwd; }
      break;
    case 'travel':
      if (ph === 'active') {
        f.vx = (P.stopOnHit && f.connect ? 1.2 : P.vx) * fwd;
        if (P.hover || f.air) {
          if (f.mf === m.startup + 1) f.hoverY = f.y + (P.hover && !f.air ? P.hover : 0);
          f.air = true; if (P.hover) f.y += (f.hoverY - f.y) * 0.3; f.vy = 0;
        }
        // Platform mode: a dash that starts on the stage stops at its edge instead of running off.
        if (game.platform && !f.air && f.surface === 'main') { const M = ARENA.P.main, hw = F.phys.hw * 0.5; if ((fwd > 0 && f.x + f.vx > M.x1 - hw) || (fwd < 0 && f.x + f.vx < M.x0 + hw)) f.vx = 0; }
      } else if (ph === 'recovery' && !f.air) f.vx *= 0.7;
      break;
    case 'grab':
      if (f.mf === m.startup + 1) tryGrab(game, state, f, o, m);
      if (!f.air) f.vx = 0;
      break;
    case 'teleport':
      f.hidden = ph === 'active';
      if (f.air && ph !== 'recovery') f.vy = 0;
      if (f.mf === m.startup + m.active) teleport(game, state, f, o, P);
      break;
    case 'counter':
      if (f.counterStrike > 0 && ++f.counterStrike === 4) applyHit(game, state, f, o, m, { x: f.x + fwd * 30, y: f.y + 60 });
      break;
    case 'dive':
      if (f.mf === m.startup && !f.air) { f.air = true; f.y = 1; f.vy = P.hop; f.vx = 2.4 * fwd; f.diveAt = f.mf + 11; }
      else if (f.mf === m.startup && f.air) f.diveAt = f.mf + 1;
      if (f.diveAt && f.mf === f.diveAt) { f.diving = true; f.vx = P.vx * fwd; f.vy = P.vy; }
      if (f.diving) f.mf = Math.min(f.mf, m.startup + m.active - 1); // stays active until it lands
      break;
    case 'hop':
      if (f.mf === 4 && !f.air) { f.air = true; f.y = 1; f.vy = P.vy; f.vx = P.vx * fwd; }
      break;
  }
  if (phaseOf(m, f.mf) === 'done') {
    f.inv = null; f.hidden = false;
    if (f.air) {
      // Rising, travelling and teleporting specials end in a helpless fall; air normals return to the jump.
      const helpless = !m.air && (!game.platform || ['rise', 'travel', 'teleport', 'dive'].includes(m.behavior));
      setSt(f, helpless ? 'fall' : 'air'); f.airUsed = true;
      f.landT = m.air ? m.landRecovery : Math.max(2, m.landRecovery);
    }
    else { f.st = 'idle'; f.t = 0; f.vx = 0; }
  }
}

function spawnProjectile(state, f, F, m) {
  const P = m.params;
  state.projectiles.push({
    id: ++state.pid, owner: f.slot, fid: f.fid, kind: P.kind, move: m.id,
    x: f.x + f.facing * (F.phys.hw + 14), y: f.y + P.y, vx: P.speed * f.facing, w: P.w, h: P.h,
    hits: P.hits, every: P.every || 0, t: 0, life: P.life, lastHit: -99, level: P.level,
  });
  ev(state, 'shoot', { slot: f.slot, kind: P.kind });
}

function stepProjectiles(game, state) {
  const ps = state.projectiles;
  for (const p of ps) {
    p.t++; p.x += p.vx;
    if (p.kind === 'wave') p.y = groundBelow(game, p.x, p.y + 4) ?? p.y;
  }
  // Opposing projectiles cancel hit for hit.
  for (const p of ps) for (const q of ps) {
    if (p.owner >= q.owner || p.hits <= 0 || q.hits <= 0) continue;
    if (Math.abs(p.x - q.x) < (p.w + q.w) / 2 && Math.abs(p.y - q.y) < (p.h + q.h) / 2) {
      const n = Math.min(p.hits, q.hits); p.hits -= n; q.hits -= n;
      ev(state, 'clash', { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    }
  }
  const lim = game.platform ? [ARENA.P.blast.l - 120, ARENA.P.blast.r + 120] : [ARENA.T.left - 60, ARENA.T.right + 60];
  state.projectiles = ps.filter(p => p.hits > 0 && p.t < p.life && p.x > lim[0] && p.x < lim[1]);
}

// ---------- throws, teleports, counters ----------
function throwable(game, f) { return !f.air && !UNTHROWABLE.has(f.st) && f.inv !== 'all' && f.invuln <= 0 && f.throwProt <= 0 && !f.hidden; }

function tryGrab(game, state, f, o, m) {
  if (!throwReach(game, f, o, m.params.range) || !throwable(game, o)) return false;
  const F = game.roster[f.fid];
  const back = rel(dirOf(f.buf[f.buf.length - 1]), f.facing) % 3 === 1 && m.kind === 'throw';
  f.st = 'throw'; f.t = 0; f.vx = 0;
  f.grab = { move: m.id, back, techable: !!m.params.techable, len: m.params.cinematic ? 14 + m.params.cinematic * 8 : 26, hits: 0 };
  o.st = 'thrown'; o.t = 0; o.vx = 0; o.pv = 0; o.combo = 0;
  o.x = f.x + f.facing * (F.phys.hw + game.roster[o.fid].phys.hw + 2);
  ev(state, 'throw', { slot: f.slot, kind: m.kind });
  return true;
}

function runThrow(game, state, f, o) {
  const g = f.grab, F = game.roster[f.fid], m = F.moves[g.move];
  if (!g) { f.st = 'idle'; return; }
  // Throw tech: the defender presses A+B early in a normal throw.
  if (g.techable && f.t <= 9 && pressedBoth(o)) {
    consume(o, o.buf.length - 1);
    for (const x of [f, o]) { setSt(x, 'block'); x.stun = 16; x.grab = null; }
    f.pv = -5 * f.facing; o.pv = 5 * f.facing;
    ev(state, 'tech', { x: (f.x + o.x) / 2, y: f.y + 60 });
    return;
  }
  if (m.params.cinematic && f.t > 10 && (f.t - 10) % 8 === 0 && g.hits < m.params.cinematic) {
    g.hits++;
    const dmg = Math.round(m.damage * 0.08);
    damage(game, state, f, o, dmg, m, { x: o.x, y: o.y + 60, strength: 'super' });
    if (o.hp <= 0) o.hp = 1;
    state.hitstop = 4;
  }
  if (f.t >= g.len) {
    const rest = m.params.cinematic ? Math.round(m.damage * (1 - 0.08 * m.params.cinematic)) : m.damage;
    if (g.back) { o.x = f.x - f.facing * 34; f.facing = -f.facing; }
    f.grab = null; setSt(f, 'land'); f.landT = 10;
    o.st = 'launch'; o.t = 0; o.air = true; o.y = Math.max(o.y, 2);
    const away = sign(o.x - f.x) || f.facing;
    if (game.platform) {
      o.percent = round1(o.percent + rest / 10);
      const kb = knockback(game, o, m);
      o.vx = Math.cos(kb.a) * kb.v * away; o.vy = Math.max(3, Math.sin(kb.a) * kb.v); o.stun = Math.round(kb.v * 3);
    } else { o.vx = away * (m.params.slam ? 2 : 4.2); o.vy = m.params.slam ? 4 : 6.5; }
    damage(game, state, f, o, rest, m, { x: o.x, y: o.y + 40, strength: 'heavy' });
    if (!game.platform && o.hp <= 0) knockOut(game, state, o, f, { force: true });
    state.hitstop = Math.max(state.hitstop, 8);
    ev(state, 'shake', { power: m.kind === 'super' ? 10 : 6 });
  }
}

function teleport(game, state, f, o, P) {
  const F = game.roster[f.fid];
  let x;
  if (game.platform && f.air) {
    const toward = sign(ARENA.P.center - f.x) || 1;
    x = f.x + toward * 190; f.y = Math.max(f.y + 70, 30); f.vy = 0;
  } else if (P.behind) x = o.x + sign(o.x - f.x || f.facing) * (F.phys.hw + 40);
  else x = f.x - f.facing * 230;
  // On the ground a teleport stays on the stage; in the air it can carry you back to it.
  f.x = game.platform ? (f.air ? clamp(x, ARENA.P.blast.l + 60, ARENA.P.blast.r - 60) : clamp(x, ARENA.P.main.x0 + F.phys.hw, ARENA.P.main.x1 - F.phys.hw)) : clamp(x, ARENA.T.left + F.phys.hw, ARENA.T.right - F.phys.hw);
  if (!game.platform) f.x = clamp(f.x, o.x - ARENA.T.maxSep, o.x + ARENA.T.maxSep);
  const dx = o.x - f.x; if (Math.abs(dx) > 2) f.facing = sign(dx);
  ev(state, 'teleport', { slot: f.slot, x: f.x, y: f.y });
}

// ---------- physics ----------
function groundBelow(game, x, y) {
  if (!game.platform) return 0;
  let best = null;
  if (x >= ARENA.P.main.x0 && x <= ARENA.P.main.x1 && y >= -2) best = 0;
  for (const p of ARENA.P.soft) if (x >= p.x0 && x <= p.x1 && y >= p.y - 2 && (best == null || p.y > best)) best = p.y;
  return best;
}

function physics(game, state, f, o) {
  if (f.st === 'thrown' || f.st === 'ledge' || f.st === 'climb' || f.st === 'respawn') return;
  const ph = game.roster[f.fid].phys;
  f.x += f.pv; f.pv *= 0.8; if (Math.abs(f.pv) < 0.05) f.pv = 0;
  if (f.dropping > 0) f.dropping--;
  if (!f.air) {
    f.x += f.vx;
    if (!FREE.has(f.st) && f.st !== 'attack' && f.st !== 'dash' && f.st !== 'backdash') f.vx *= 0.8;
    if (game.platform) {
      const g = groundBelow(game, f.x, f.y);
      if (g == null || Math.abs(g - f.y) > 1) {
        f.air = true; f.vy = 0;
        if (FREE.has(f.st) || f.st === 'land' || f.st === 'dash' || f.st === 'backdash') { setSt(f, 'air'); f.airUsed = false; }
        else if (f.st === 'hit' || f.st === 'block' || f.st === 'knockdown' || f.st === 'wakeup') { setSt(f, 'launch'); f.stun = Math.max(f.stun, 6); }
      }
      else f.surface = g === 0 ? 'main' : 'soft';
    }
  } else {
    const hover = f.st === 'attack' && game.roster[f.fid].moves[f.move]?.behavior === 'travel' && phaseOf(game.roster[f.fid].moves[f.move], f.mf) === 'active';
    const grav = ph.gravity * (f.st === 'launch' || f.st === 'ko' ? 0.92 : 1);
    if (!hover) f.vy = Math.max(f.vy - grav, f.st === 'launch' ? -13 : -15);
    if (game.platform && f.st === 'launch') { f.vx *= 0.955; if (f.vy > 0) f.vy *= 0.97; }
    const prevY = f.y;
    f.x += f.vx; f.y += f.vy;
    if (game.platform) {
      // The main stage is solid from the side and below.
      const M = ARENA.P.main;
      if (f.y < -1 && f.x > M.x0 - ph.hw * 0.4 && f.x < M.x1 + ph.hw * 0.4) {
        if (prevY >= -1) { f.y = 0; land(game, state, f); }
        else f.x = f.x < ARENA.P.center ? M.x0 - ph.hw * 0.4 : M.x1 + ph.hw * 0.4;
      } else if (f.vy <= 0) {
        for (const p of ARENA.P.soft) if (!f.dropping && f.x >= p.x0 && f.x <= p.x1 && prevY >= p.y && f.y <= p.y && !(f.st === 'launch' && f.vy < -9)) { f.y = p.y; land(game, state, f); break; }
        if (f.air && (f.st === 'air' || f.st === 'fall') && f.ledgeCd <= 0) tryLedge(state, f, o, ph);
      }
    } else if (f.y <= 0) { f.y = 0; land(game, state, f); }
  }
  if (!game.platform) {
    f.x = clamp(f.x, ARENA.T.left + ph.hw, ARENA.T.right - ph.hw);
  }
}

function land(game, state, f) {
  const speed = -f.vy;
  f.air = false; f.vy = 0; f.jumps = 1; f.airSpecial = false; f.airUsed = false;
  const F = game.roster[f.fid];
  switch (f.st) {
    case 'air': setSt(f, 'land'); f.landT = 3; f.vx = 0; break;
    case 'fall': setSt(f, 'land'); f.vx = 0; break;
    case 'attack': {
      const m = F.moves[f.move];
      const extra = m.behavior === 'dive' && !f.connect ? 6 : 0;
      setSt(f, 'land'); f.landT = (m.air ? m.landRecovery : Math.max(3, m.landRecovery)) + extra; f.vx = 0; f.diving = false; f.inv = null; f.hidden = false;
      break;
    }
    case 'launch':
      if (game.platform && f.stun <= 0) { setSt(f, 'land'); f.landT = 4; f.vx = 0; break; }
      setSt(f, 'knockdown'); f.juggle = 0; f.vx *= 0.4;
      ev(state, 'down', { slot: f.slot, x: f.x });
      break;
    case 'ko': setSt(f, 'ko'); f.vx *= 0.3; f.down = true; ev(state, 'down', { slot: f.slot, x: f.x, heavy: true }); break;
    default: break;
  }
  if (speed > 4) ev(state, 'land', { slot: f.slot, speed: speed * 2 });
}

function tryLedge(state, f, o, ph) {
  const M = ARENA.P.main;
  for (const side of [-1, 1]) {
    const ex = side < 0 ? M.x0 : M.x1;
    const out = (f.x - ex) * side;
    if (out > -6 && out < 34 && f.y < 0 && f.y > -70 && !(o.st === 'ledge' && o.ledge === side)) {
      setSt(f, 'ledge'); f.ledge = side; f.x = ex + side * ph.hw * 0.7; f.y = -ph.h * 0.62; f.vx = 0; f.vy = 0; f.facing = -side;
      f.invuln = Math.max(f.invuln, 30); f.jumps = 1; f.airSpecial = false;
      ev(state, 'ledge', { slot: f.slot, x: ex });
      return;
    }
  }
}

function ledgeThink(state, f, d, ph) {
  const toward = d === 6 || d >= 7, away = d === 4 || (d <= 3 && d >= 1);
  if (f.t > 4 && (toward || recentPress(f, 'any', 2) >= 0)) { setSt(f, 'climb'); f.invuln = Math.max(f.invuln, 16); return; }
  if ((f.t > 4 && away) || f.t > 300) { setSt(f, 'air'); f.air = true; f.x += f.ledge * 10; f.vy = d >= 7 ? ph.jumpV : 0; f.ledgeCd = 30; f.airUsed = false; }
}

function separate(game, a, b) {
  if (a.st === 'thrown' || b.st === 'thrown' || a.hidden || b.hidden || a.st === 'respawn' || b.st === 'respawn' || a.st === 'ledge' || b.st === 'ledge') return;
  const A = game.roster[a.fid].phys, B = game.roster[b.fid].phys;
  const overlapY = a.y < b.y + B.h * 0.75 && b.y < a.y + A.h * 0.75;
  const dx = b.x - a.x, need = A.hw + B.hw;
  if (overlapY && Math.abs(dx) < need) {
    const s = sign(dx) || (a.facing > 0 ? 1 : -1), push = (need - Math.abs(dx)) / 2;
    a.x -= s * push; b.x += s * push;
    if (!game.platform) {
      // A fighter pinned to a wall pushes the other one out instead.
      for (const [f, o, P] of [[a, b, A], [b, a, B]]) {
        const lo = ARENA.T.left + P.hw, hi = ARENA.T.right - P.hw;
        if (f.x < lo) { o.x += lo - f.x; f.x = lo; } else if (f.x > hi) { o.x -= f.x - hi; f.x = hi; }
      }
    }
  }
  if (!game.platform) {
    // Screen limit: the camera keeps both fighters in view.
    const sep = b.x - a.x;
    if (Math.abs(sep) > ARENA.T.maxSep) { const over = (Math.abs(sep) - ARENA.T.maxSep) / 2 * sign(sep); a.x += over; b.x -= over; }
  }
}

function blastZones(game, state) {
  const Z = ARENA.P.blast;
  for (const f of state.fighters) {
    if (f.st === 'respawn' || f.st === 'ko') continue;
    if (f.x < Z.l || f.x > Z.r || f.y < Z.b || f.y > Z.t) {
      f.stocks--;
      ev(state, 'blast', { slot: f.slot, x: clamp(f.x, Z.l, Z.r), y: clamp(f.y, Z.b, Z.t), percent: f.percent });
      const o = state.fighters[1 - f.slot];
      if (f.stocks > 0) {
        Object.assign(f, { st: 'respawn', t: 0, x: ARENA.P.center, y: 230, vx: 0, vy: 0, pv: 0, air: true, percent: 0, invuln: 160, hidden: true, combo: 0, comboDmg: 0, stun: 0, jumps: 1, airSpecial: false });
        ev(state, f.slot === 0 && !state.match.cpuBoth ? 'hurt' : 'defeated', { slot: f.slot });
      } else {
        Object.assign(f, { st: 'ko', t: 0, hidden: true, vx: 0, vy: 0, air: false, x: clamp(f.x, Z.l, Z.r) });
        state.match.pendingWinner = o.slot;
        setPhase(state, 'ko'); state.slow = 60;
        banner(state, 'GAME!', 'ko');
        ev(state, 'ko', { slot: f.slot, x: f.x, y: f.y });
        ev(state, f.slot === 0 && !state.match.cpuBoth ? 'hurt' : 'defeated');
      }
    }
  }
}

// ---------- boxes and hits ----------
const crouching = (game, f) => f.st === 'crouch' || (f.st === 'guard' && f.prev.y === 1) || (f.st === 'block' && f.blockLow) || (f.st === 'hit' && f.crouchHit) || (f.st === 'attack' && (f.move === '2A' || f.move === '2B'));

/** World-space hurtboxes for fighter f: [{x, y, w, h}]. */
export function hurtboxes(game, f) {
  if (f.hidden || IMMUNE.has(f.st) || f.st === 'flourished') return [];
  const F = game.roster[f.fid], ph = F.phys, hw = ph.hw;
  let h = ph.h, y0 = f.y;
  const m = f.st === 'attack' ? F.moves[f.move] : null;
  if (f.air) { y0 = f.y + ph.h * 0.12; h = ph.h * 0.74; }
  else if (m?.lowProfile && phaseOf(m, f.mf) !== 'startup') h = ph.h * 0.34;
  else if (crouching(game, f)) h = ph.h * 0.64;
  else if (f.st === 'ledge') { y0 = f.y; h = ph.h * 0.7; }
  const out = [{ x: f.x - hw, y: y0, w: hw * 2, h }];
  // Attacking limbs are hittable from the active frames through half the recovery.
  if (m?.box && m.behavior === 'strike' && f.mf > m.startup && f.mf <= m.startup + m.active + m.recovery / 2) {
    const b = worldBox(f, m.box), s = 0.8;
    out.push({ x: b.x + b.w * (1 - s) / 2, y: b.y + b.h * (1 - s) / 2, w: b.w * s, h: b.h * s });
  }
  return out;
}
export const worldBox = (f, b) => ({ x: f.facing > 0 ? f.x + b.x : f.x - b.x - b.w, y: f.y + b.y, w: b.w, h: b.h });
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The active hitbox of f this frame, or null. */
export function activeHitbox(game, f) {
  if (f.st !== 'attack' || f.hidden) return null;
  const m = game.roster[f.fid].moves[f.move];
  if (!m.box || m.behavior === 'counter' || m.behavior === 'grab' || m.behavior === 'projectile') return null;
  if (phaseOf(m, f.mf) !== 'active') return null;
  if (m.behavior === 'dive' && !f.diving) return null;
  if (f.hitsDone >= m.hits || (f.hitsDone > 0 && f.mf - f.lastHitMf < Math.max(1, m.every))) return null;
  if (f.hitsDone > 0 && !m.every) return null;
  return worldBox(f, m.box);
}

function vulnerable(game, d, level, kind) {
  if (d.invuln > 0 || d.inv === 'all') return false;
  if (d.inv === 'strike' && kind !== 'grab') return false;
  if (d.st === 'attack' && level === 'low' && game.roster[d.fid].moves[d.move].lowInvuln && phaseOf(game.roster[d.fid].moves[d.move], d.mf) === 'active') return false;
  if (d.st === 'launch' && d.juggle >= JUGGLE_MAX && !game.platform) return false;
  return true;
}

function resolveHits(game, state) {
  const fs = state.fighters, pending = [];
  for (const a of fs) {
    const d = fs[1 - a.slot], hb = activeHitbox(game, a);
    if (!hb) continue;
    const m = game.roster[a.fid].moves[a.move];
    if (!vulnerable(game, d, m.level, 'strike')) continue;
    if (hurtboxes(game, d).some(h => overlap(hb, h))) pending.push([a, d, m, hb]);
  }
  for (const [a, d, m, hb] of pending) {
    a.hitsDone++; a.lastHitMf = a.mf;
    const dm = d.st === 'attack' ? game.roster[d.fid].moves[d.move] : null;
    if (dm?.behavior === 'counter' && phaseOf(dm, d.mf) === 'active' && !d.counterStrike && pending.length === 1) {
      // Counter stance: absorb the strike and answer it.
      d.counterStrike = 1; d.mf = dm.startup + dm.active; d.inv = 'all';
      setSt(a, 'hit'); a.stun = 26; a.vx = 0;
      state.hitstop = 14;
      ev(state, 'parry', { slot: d.slot, x: (a.x + d.x) / 2, y: d.y + 60 });
      continue;
    }
    applyHit(game, state, a, d, m, { x: hb.x + hb.w / 2 + (a.facing > 0 ? hb.w * 0.25 : -hb.w * 0.25), y: hb.y + hb.h / 2 });
  }
  for (const p of state.projectiles) {
    const d = fs[1 - p.owner], a = fs[p.owner];
    if (p.hits <= 0 || p.t - p.lastHit < Math.max(1, p.every)) continue;
    const box = { x: p.x - p.w / 2, y: p.y - p.h / 2 + (p.kind === 'wave' ? p.h / 2 : 0), w: p.w, h: p.h };
    if (!vulnerable(game, d, p.level, 'proj')) continue;
    if (!hurtboxes(game, d).some(h => overlap(box, h))) continue;
    p.hits--; p.lastHit = p.t;
    const m = game.roster[p.fid].moves[p.move];
    const final = p.hits === 0 && m.params.final ? { ...m, launch: m.params.final.launch, knockdown: true } : m;
    applyHit(game, state, a, d, final, { x: p.x, y: p.y }, { projectile: true, dir: sign(p.vx) });
  }
}

function canBlock(game, d) {
  return (FREE.has(d.st) || d.st === 'block') && !d.air;
}

/** Apply a strike or projectile from attacker a to defender d. */
function applyHit(game, state, a, d, m, at, { projectile = false, dir = 0 } = {}) {
  const away = dir || sign(d.x - a.x) || a.facing;
  if (d.st === 'dazed' || d.st === 'flourished') { if (d.st === 'dazed') { d.hp = 0; knockOut(game, state, d, a, { force: true }); ev(state, 'hit', { slot: a.slot, x: at.x, y: at.y, dmg: 0, strength: 'heavy', counter: false, combo: 0 }); } return; }
  const holdBack = sign(d.prev.x) === away, low = d.prev.y === 1;
  const levelOk = m.level === 'low' ? low : m.level === 'overhead' ? !low : true;
  const fin = m.params?.final && !projectile && a.hitsDone >= m.hits;
  const mm = fin ? { ...m, launch: m.params.final.launch, knockdown: true } : m;
  if (!mm.unblockable && canBlock(game, d) && holdBack && levelOk) {
    setSt(d, 'block'); d.stun = mm.blockstun; d.blockLow = low;
    const chip = mm.kind === 'normal' ? 0 : mm.chip;
    if (game.platform) d.percent = round1(d.percent + chip / 20);
    else if (chip) d.hp = Math.max(0, d.hp - chip);
    d.pv = away * mm.blockPush * 0.22;
    if (!projectile) wallPush(game, a, d, mm.blockPush * 0.22);
    a.meter = Math.min(SUPER_COST, a.meter + Math.round(mm.meter * 0.5));
    d.meter = Math.min(SUPER_COST, d.meter + Math.round(mm.meter * 0.4));
    if (!projectile) a.connect = a.connect || 'block';
    state.hitstop = Math.max(state.hitstop, mm.hitstop - 3);
    ev(state, 'block', { slot: d.slot, x: at.x, y: at.y, strength: mm.strength });
    if (!game.platform && d.hp <= 0) knockOut(game, state, d, a);
    return;
  }
  // Counter hit: struck during the startup of their own move.
  const dm = d.st === 'attack' ? game.roster[d.fid].moves[d.move] : null;
  const counter = !!dm && phaseOf(dm, d.mf) === 'startup';
  const scale = SCALING[Math.min(d.combo, SCALING.length - 1)] * (counter ? 1.2 : 1);
  const dmg = Math.max(1, Math.round(mm.damage * (mm.kind === 'super' ? Math.max(0.5, scale) : scale)));
  const wasAir = d.air;
  d.crouchHit = crouching(game, d);
  if (d.st === 'attack') { d.hidden = false; d.inv = null; d.diving = false; }
  d.combo++;
  if (!projectile) a.connect = 'hit';
  state.hitstop = Math.max(state.hitstop, mm.hitstop + (counter ? 3 : 0));
  if (game.platform) {
    d.percent = round1(d.percent + dmg / 10);
    const kb = knockback(game, d, mm);
    const spike = kb.a < 0;
    if (!wasAir && kb.v < 3.4 && !spike && !mm.knockdown && !mm.launch) {
      setSt(d, 'hit'); d.stun = Math.max(8, Math.round(mm.hitstun * 0.7)); d.pv = away * kb.v * 0.9;
    } else {
      setSt(d, 'launch'); d.air = true; d.y = Math.max(d.y, 1) + (spike ? 0 : 2);
      d.vx = Math.cos(kb.a) * kb.v * away; d.vy = Math.sin(kb.a) * kb.v * (spike && !wasAir ? -0.4 : 1); d.stun = Math.min(60, Math.round(kb.v * 2.6));
    }
    d.kb = kb.v;
  } else {
    d.hp = Math.max(0, d.hp - dmg);
    if (wasAir || mm.launch || mm.knockdown || d.st === 'launch') {
      const L = mm.launch || (mm.knockdown && !wasAir ? { vx: 3.2, vy: 5 } : { vx: 2.4, vy: 4.5 });
      setSt(d, 'launch'); d.air = true; d.y = Math.max(d.y, 1);
      d.vx = away * L.vx; d.vy = L.vy; d.juggle += wasAir ? 1 : 0;
      if (mm.launch && !wasAir) d.juggle = 1;
    } else {
      setSt(d, 'hit'); d.stun = mm.hitstun + (counter ? 4 : 0);
      d.pv = away * mm.push * 0.22;
      if (!projectile) wallPush(game, a, d, mm.push * 0.22);
    }
  }
  d.comboDmg += dmg;
  a.meter = Math.min(SUPER_COST, a.meter + mm.meter);
  d.meter = Math.min(SUPER_COST, d.meter + Math.round(mm.meter * 0.5));
  ev(state, 'hit', { slot: a.slot, x: at.x, y: at.y, dmg, strength: mm.strength, counter, combo: d.combo });
  if (counter) ev(state, 'counter', { slot: a.slot, x: at.x, y: at.y });
  if (d.combo >= 2) ev(state, 'combo', { slot: a.slot, hits: d.combo, damage: d.comboDmg });
  if (d.slot === 0 && !state.match.cpuBoth) ev(state, 'hurt', { dmg });
  if (a.slot === 0 && !state.match.cpuBoth) { state.score += dmg * 10 + (d.combo >= 3 ? d.combo * 50 : 0); state.stats.hits++; state.stats.maxCombo = Math.max(state.stats.maxCombo, d.combo); }
  if (mm.strength !== 'light') ev(state, 'shake', { power: mm.strength === 'super' ? 8 : mm.strength === 'special' ? 5 : 4 });
  if (!game.platform && d.hp <= 0 && state.phase === 'fight') knockOut(game, state, d, a);
}

function damage(game, state, a, d, dmg, m, at) {
  if (game.platform) d.percent = round1(d.percent + dmg / 10); else d.hp = Math.max(0, d.hp - dmg);
  d.combo++; d.comboDmg += dmg;
  a.meter = Math.min(SUPER_COST, a.meter + Math.round(dmg * 0.06));
  ev(state, 'hit', { slot: a.slot, x: at.x, y: at.y, dmg, strength: at.strength || m.strength, counter: false, combo: d.combo });
  if (d.slot === 0 && !state.match.cpuBoth) ev(state, 'hurt', { dmg });
  if (a.slot === 0 && !state.match.cpuBoth) { state.score += dmg * 10; state.stats.hits++; }
}

function wallPush(game, a, d, amount) {
  if (game.platform || a.air) return;
  const hw = game.roster[d.fid].phys.hw;
  if (d.x - hw <= ARENA.T.left + 1 || d.x + hw >= ARENA.T.right - 1) a.pv = -sign(d.x - a.x) * amount;
}

/** Can fighter d be hit by something outside the fight rules (a mod's bolt or blast)? */
export function hittable(game, d) { return !d.hidden && !IMMUNE.has(d.st) && d.st !== 'flourished' && vulnerable(game, d, 'mid', 'proj'); }

/**
 * An outside hit (from a mod): `damage` as a heavy strike that knocks down, or `stun` frames of
 * hitstun with no damage. Goes through the normal hit path, so KOs, combos and score all apply.
 */
export function externalHit(game, state, slot, { damage: dmg = 0, stun = 0, from = null } = {}) {
  useArenaOf(state);
  const d = state.fighters[slot], a = state.fighters[1 - slot];
  if (state.phase !== 'fight' || !hittable(game, d)) return 0;
  if (stun > 0) { setSt(d, 'hit'); d.stun = Math.min(120, stun); d.vx = 0; d.inv = null; d.hidden = false; return 0; }
  const m = { ...game.roster[a.fid].moves['5B'], id: 'mod', name: 'mod', kind: 'special', damage: dmg, knockdown: true, unblockable: true, meter: 0, strength: 'special' };
  applyHit(game, state, a, d, m, { x: d.x, y: d.y + 50 }, { projectile: true, dir: sign(d.x - (from ?? a.x)) || -d.facing });
  return dmg * 10;
}

/** Platform-mode knockback: grows with the defender's percent, shrinks with weight. */
export function knockback(game, d, m) {
  const [b, g, ang] = m.kb, w = game.roster[d.fid].phys.weight;
  const v = (b + g * d.percent) * (1.4 - w * 0.06);
  return { v, a: ang * Math.PI / 180 };
}
const round1 = v => Math.round(v * 10) / 10;
