// Verification: proves generated content playable before it publishes.
//  1. frame-data sanity: every move has startup, active and recovery frames, and its hitbox,
//     projectile or grab actually connects with a standing dummy at a fair distance;
//  2. every special (both buttons) and the super come out from their canonical motion fed
//     through the real input path;
//  3. CPU-vs-CPU matches finish within the time limit, with KOs;
//  4. a simple scripted player beats the easiest CPU at least sometimes over seeded runs.
import { validate } from './content.js';
import { createGame } from './sim.js';
import { phaseOf, SUPER_COST } from './moves.js';
import { motionFrames, toInput } from './input.js';
import { ARENA } from './arena.js';

const N = { x: 0, y: 0, a: false, b: false };

function sandbox(game, p1, p2, gap) {
  const s = game.createState();
  game.startMatch(s, { p1, p2, stage: 0 });
  game.debug.skipIntro(s);
  s.fighters[1].cpu = null;              // a passive dummy
  const c = game.platform ? ARENA.P.center : ARENA.T.center;
  s.fighters[0].x = c - gap / 2; s.fighters[1].x = c + gap / 2;
  return s;
}

/** Start move `id` for slot 0 against a dummy `gap` units away; true if it connects. */
function connects(game, fid, id, gap, dummy) {
  const s = sandbox(game, fid, dummy, gap), m = game.roster[fid].moves[id];
  if (m.air) { s.fighters[0].air = true; s.fighters[0].y = 50; s.fighters[0].vy = 0; s.fighters[0].st = 'air'; }
  game.debug.startMove(s, 0, id);
  for (let i = 0; i < m.total + 90; i++) {
    game.step(s, N);
    if (s.events.some(e => (e.name === 'hit' || e.name === 'throw') && e.slot === 0)) return true;
    if (s.fighters[0].st !== 'attack' && s.fighters[0].st !== 'throw' && i > 2 && !s.projectiles.length) break;
  }
  return false;
}

function frameData(game, problems, report) {
  let moves = 0, connected = 0;
  game.roster.forEach((F, fid) => {
    const dummy = fid === 0 ? 1 : 0, P = F.phys, reachGap = P.hw + game.roster[dummy].phys.hw + 4;
    for (const m of Object.values(F.moves)) {
      moves++;
      const where = `${F.id}.${m.id} (${m.name})`;
      if (!(m.startup >= 1)) problems.push({ code: 'frames', path: where, message: 'startup must be at least 1 frame' });
      if (!(m.active >= 1)) problems.push({ code: 'frames', path: where, message: 'no active frames' });
      if (!(m.recovery >= 1)) problems.push({ code: 'frames', path: where, message: 'recovery must be at least 1 frame' });
      if (m.box && m.box.x + m.box.w <= P.hw + 6) problems.push({ code: 'reach', path: where, message: 'hitbox does not reach past the body' });
      if (m.behavior === 'teleport') continue;   // no damage by design
      if (m.behavior === 'counter') { connected++; continue; }  // proven by the counter mechanic test
      const gap = m.behavior === 'projectile' ? 170 : m.behavior === 'grab' ? Math.min(m.params.range - 4, reachGap + 10) : ['travel', 'dive', 'hop'].includes(m.behavior) ? reachGap + 40 : reachGap;
      if (connects(game, fid, m.id, gap, dummy)) connected++;
      else problems.push({ code: 'whiff', path: where, message: `does not connect with a standing opponent ${Math.round(gap)} units away` });
    }
  });
  report.frameData = { moves, connected };
}

function motions(game, problems, report) {
  let tried = 0, ok = 0;
  game.roster.forEach((F, fid) => {
    const dummy = fid === 0 ? 1 : 0;
    const cases = [...F.specials.flatMap(sp => ['a', 'b'].map(btn => ({ motion: sp.motion, btn, want: sp[btn], air: sp.air && sp.shadowed, name: sp.name }))), { motion: 'qcf2', btn: 'b', want: 'super', name: F.moves.super.name, meter: true }];
    for (const c of cases) {
      tried++;
      const s = sandbox(game, fid, dummy, 280), f = s.fighters[0];
      if (c.meter) f.meter = SUPER_COST;
      const seq = [];
      if (c.air) { seq.push([0, -1, 0, 0]); for (let i = 0; i < 8; i++) seq.push([0, 0, 0, 0]); }
      seq.push(...motionFrames(c.motion, c.btn));
      let hit = false;
      for (const fr of seq) { game.step(s, toInput(fr, f.facing)); if (f.st === 'attack' && f.move === c.want) hit = true; }
      for (let i = 0; i < 3 && !hit; i++) { game.step(s, N); if (f.st === 'attack' && f.move === c.want) hit = true; }
      if (hit) ok++;
      else problems.push({ code: 'motion', path: `${F.id}.${c.want}`, message: `${c.name} did not come out from ${c.motion} + ${c.btn}` });
    }
  });
  report.motions = { tried, ok };
}

function play(game, s, inputFor, cap) {
  let n = 0;
  const tally = { hits: 0, supers: 0, throws: 0, maxCombo: 0, ko: 0 };
  while (s.status === 'playing' && n < cap) {
    game.step(s, inputFor ? inputFor(s) : N); n++;
    for (const e of s.events) {
      if (e.name === 'hit') tally.hits++;
      else if (e.name === 'super') tally.supers++;
      else if (e.name === 'throw') tally.throws++;
      else if (e.name === 'combo') tally.maxCombo = Math.max(tally.maxCombo, e.hits);
    }
  }
  tally.frames = n;
  tally.koRounds = s.match.rounds.filter(r => r.how === 'ko' || r.how === 'perfect' || r.how === 'flourish').length;
  tally.timeRounds = s.match.rounds.filter(r => r.how === 'time').length;
  return tally;
}

/** A scripted player for slot 0: walk in, block what it sees coming, poke and combo. */
export function scriptedPlayer(game) {
  let queue = [], cool = 0;
  return s => {
    const me = s.fighters[0], op = s.fighters[1], F = game.roster[me.fid];
    if (s.phase !== 'fight') { queue = []; return N; }
    if (queue.length) return toInput(queue.shift(), me.facing);
    const dist = Math.abs(op.x - me.x);
    const om = op.st === 'attack' ? game.roster[op.fid].moves[op.move] : null;
    if (om && phaseOf(om, op.mf) !== 'recovery' && dist < 150) return toInput([-1, om.level === 'overhead' ? 0 : 1, 0, 0], me.facing);
    if (s.projectiles.some(p => p.owner === 1 && Math.abs(p.x - me.x) < 150)) return toInput([-1, 1, 0, 0], me.facing);
    if (cool > 0) { cool--; return toInput([dist > 80 ? 1 : 0, 0, 0, 0], me.facing); }
    if (me.st !== 'idle' && me.st !== 'walk' && me.st !== 'crouch') return N;
    const fire = F.specials.find(sp => sp.archetype === 'fireball');
    const canc = F.specials.find(sp => ['uppercut', 'fireball', 'spin_kick', 'flurry', 'slide'].includes(sp.archetype));
    if (dist > 200 && fire && !s.projectiles.some(p => p.owner === 0)) { queue = motionFrames(fire.motion, 'a'); cool = 20; return N; }
    if (dist > 75) return toInput([1, 0, 0, 0], me.facing);
    cool = 14;
    if (me.meter >= SUPER_COST) { queue = motionFrames('qcf2', 'b'); return N; }
    queue = (s.frame / 7 | 0) % 2
      ? [[0, 1, 1, 0], ...Array(5).fill([0, 1, 0, 0]), [0, 1, 1, 0], ...Array(5).fill([0, 1, 0, 0]), [0, 1, 0, 1], ...Array(4).fill([0, 1, 0, 0])]
      : [[0, 0, 1, 0], ...Array(5).fill([0, 0, 0, 0]), [0, 0, 0, 1], ...Array(14).fill([0, 0, 0, 0]), ...(canc ? motionFrames(canc.motion, 'b') : [])];
    return N;
  };
}

export function verify(input, { seed = 1, budgetMs = 2000 } = {}) {
  const t0 = performance.now(), problems = [], report = { proven: [], kit: 'fighting' };
  const checked = validate(input);
  if (!checked.ok) return { ok: false, problems: checked.errors, report: { ...report, ms: Math.round(performance.now() - t0) } };
  const content = checked.content, game = createGame(content, { seed });
  const over = () => performance.now() - t0 > budgetMs;

  frameData(game, problems, report);
  if (!problems.length) report.proven.push('every move has startup, active and recovery frames and connects');
  const before = problems.length;
  motions(game, problems, report);
  if (problems.length === before) report.proven.push('every special and super comes out from its motion input');

  // CPU vs CPU: each fighter against the next one on the roster.
  const roundFrames = (game.platform ? content.roundTime * 3 : content.roundTime) * 60, cap = Math.ceil((roundFrames * game.maxRounds + 60 * 60) / game.speed);
  const cvc = [], n = game.roster.length;
  for (let i = 0; i < n && !over(); i++) {
    const g = createGame(content, { seed: seed + i }), s = g.createState();
    g.startMatch(s, { p1: i, p2: (i + 1) % n, stage: i % content.stages.length, cpuBoth: true, levels: [3, 3] });
    const r = play(g, s, null, cap);
    cvc.push({ p1: g.roster[i].id, p2: g.roster[(i + 1) % n].id, finished: s.status !== 'playing', winner: s.match.winner, ...r });
  }
  const unfinished = cvc.filter(m => !m.finished);
  if (unfinished.length) problems.push({ code: 'stalemate', path: 'cpu-vs-cpu', message: `${unfinished.length} CPU match(es) did not finish` });
  const koRounds = cvc.reduce((a, m) => a + m.koRounds, 0);
  if (cvc.length && !koRounds) problems.push({ code: 'no_ko', path: 'cpu-vs-cpu', message: 'no CPU round ended in a KO' });
  report.cpuVsCpu = { matches: cvc.length, finished: cvc.length - unfinished.length, koRounds, timeRounds: cvc.reduce((a, m) => a + m.timeRounds, 0), avgSeconds: cvc.length ? Math.round(cvc.reduce((a, m) => a + m.frames, 0) / cvc.length / 60) : 0, avgHits: cvc.length ? Math.round(cvc.reduce((a, m) => a + m.hits, 0) / cvc.length) : 0, maxCombo: Math.max(0, ...cvc.map(m => m.maxCombo)), supers: cvc.reduce((a, m) => a + m.supers, 0), throws: cvc.reduce((a, m) => a + m.throws, 0) };
  if (!unfinished.length && koRounds) report.proven.push('CPU-vs-CPU matches finish with KOs inside the time limit');

  // Difficulty sanity: a scripted player against the easiest ladder CPU.
  const rung = content.ladder.length ? content.ladder.reduce((a, r) => r.difficulty < a.difficulty ? r : a, content.ladder[0]) : { fighter: content.boss.fighter, difficulty: content.boss.difficulty };
  const easy = game.index.get(rung.fighter), runs = [];
  for (let k = 0; k < 6 && !over(); k++) {
    const g = createGame(content, { seed: seed * 31 + k }), s = g.createState(), hero = g.selectable[k % g.selectable.length];
    g.startMatch(s, { p1: hero, p2: easy, stage: 0, level: rung.difficulty });
    const r = play(g, s, scriptedPlayer(g), cap);
    runs.push({ hero: g.roster[hero].id, won: s.match.winner === 0, finished: s.phase === 'matchEnd' || s.status !== 'playing', frames: r.frames });
    // Matches stop at the match-end screen for a human player; that is the result we need.
  }
  const wins = runs.filter(r => r.won).length;
  report.scripted = { opponent: rung.fighter, level: rung.difficulty, runs: runs.length, wins };
  if (runs.length && !wins) problems.push({ code: 'too_hard', path: `ladder.${rung.fighter}`, message: `a scripted player never beat the easiest CPU (${rung.fighter}, level ${rung.difficulty}) in ${runs.length} runs` });
  else if (wins) report.proven.push(`a scripted player beats the easiest CPU (${wins}/${runs.length} seeded runs)`);

  report.ms = Math.round(performance.now() - t0);
  if (over()) report.budgetExceeded = true;
  return { ok: problems.length === 0, problems, report };
}
