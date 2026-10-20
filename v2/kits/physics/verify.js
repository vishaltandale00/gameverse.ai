// Verification: prove each level playable before it publishes.
//   breakout  — every breakable brick is reachable, and a ball-tracking bot clears the level in time;
//   peggle    — every orange peg is hit by some cannon angle (headless aim search);
//   slingshot — a search over launch angles and powers defeats every foe within the given shots;
//   pinball   — random flipper policies never leave a ball stuck and never let it escape the table.
import { validate, unreachableBricks } from './content.js';
import { createGame } from './game.js';
import { seedFrom, random } from '../../kernel/rng.js';
import { findBody } from './physics.js';
import * as breakout from './modes/breakout.js';
import * as peggle from './modes/peggle.js';
import * as slingshot from './modes/slingshot.js';
import * as pinball from './modes/pinball.js';

const NEUTRAL = { x: 0, y: 0, a: false, b: false };
const NO_PRESS = { a: false, b: false, up: false, down: false, left: false, right: false };
const WEIGHT = { breakout: 1, peggle: 1.2, slingshot: 1.6, pinball: 0.8 };
export const LIMITS = { breakoutSeconds: 240, pinballRuns: 4, pinballSeconds: 25, stuckSeconds: 3, slingshotCandidates: 14 };

function levelState(game, index) {
  const S = game.createState();
  game.startLevel(S, index);
  S.phase = 'play'; S.phaseT = 0; S.lives = 99; S.events = [];
  return S;
}

export function verify(input, { seed = 1, budgetMs = 2000 } = {}) {
  const started = performance.now();
  const checked = validate(input);
  if (!checked.ok) return { ok: false, problems: checked.errors.map(e => ({ code: e.code, path: e.path, message: e.message })), report: { proven: [], levels: [], ms: Math.round(performance.now() - started) } };
  const content = checked.content, game = createGame(content, { seed });
  const problems = [], levels = [], proven = new Set();
  let weightLeft = content.levels.reduce((s, l) => s + WEIGHT[l.mode], 0);
  let deaths = 0, botTime = 0, cleared = 0;
  content.levels.forEach((level, i) => {
    // Each level gets its weight's share of whatever budget is left, so time a quick level saves flows on.
    const t0 = performance.now(), left = Math.max(0, budgetMs * 0.92 - (t0 - started)), share = left * WEIGHT[level.mode] / weightLeft;
    const deadline = t0 + share;
    weightLeft -= WEIGHT[level.mode];
    let r;
    if (level.mode === 'breakout') r = verifyBreakout(game, i, level, deadline);
    else if (level.mode === 'peggle') r = verifyPeggle(game, i, level, deadline);
    else if (level.mode === 'slingshot') r = verifySlingshot(game, i, level, deadline);
    else r = verifyPinball(game, i, level, deadline, seed);
    r.ms = Math.round(performance.now() - t0);
    // A search cut short by the time budget says so, rather than blaming the content.
    if (!r.ok && performance.now() >= deadline) for (const p of r.problems) { p.budgetExhausted = true; p.message += ` (search stopped at the ${Math.round(share)} ms budget)`; }
    levels.push({ level: i, name: level.name, mode: level.mode, ...r });
    for (const p of r.problems) problems.push({ ...p, level: i, path: `levels[${i}]${p.path ? '.' + p.path : ''}` });
    if (r.ok) { proven.add(r.proven); cleared += r.cleared ? 1 : 0; }
    deaths += r.deaths || 0; botTime += r.time || 0;
  });
  const ms = Math.round(performance.now() - started);
  // Running out of time is a warning (KIT_CONTRACT.md): it says nothing about the content.
  const warnings = problems.filter(p => p.budgetExhausted);
  const real = problems.filter(p => !p.budgetExhausted);
  if (ms > budgetMs * 1.5) warnings.push({ code: 'over_budget', path: '', message: `verification took ${ms} ms (budget ${budgetMs} ms)` });
  return {
    ok: real.length === 0, problems: real, warnings,
    report: { proven: [...proven], levels, bot: { cleared, levels: content.levels.length, time: Math.round(botTime * 10) / 10, deaths }, ms, budgetMs },
  };
}

// ---------- breakout ----------
function verifyBreakout(game, index, level, deadline) {
  const problems = [];
  const sealed = unreachableBricks(level.breakout.rows);
  if (sealed.length) problems.push({ code: 'unreachable_brick', path: 'breakout[0].rows', message: `${sealed.length} breakable bricks are sealed in by metal` });
  const S = levelState(game, index);
  const bricks = S.world.bodies.filter(b => b.tag === 'brick').length, breakable = S.m.bricksLeft;
  // Bigger fields get proportionally more time (about 3 s per breakable brick, plus a boss allowance).
  const limit = Math.max(LIMITS.breakoutSeconds, breakable * 3 + (S.m.boss ? S.m.boss.max * 4 : 0)) * 60;
  let steps = 0;
  while (S.level === index && S.phase === 'play' && steps < limit) {
    game.step(S, breakout.bot(S)); steps++;
    if ((steps & 255) === 0 && performance.now() > deadline + 400) break;
  }
  const cleared = S.phase === 'clear' || S.level !== index || S.status === 'won';
  const time = steps / 60, deaths = S.stats.lifeLost;
  if (!cleared) problems.push({ code: 'bot_failed', path: 'breakout[0]', message: `the bot did not clear the level in ${Math.round(time)} s (${S.m.bricksLeft} bricks left${S.m.boss ? ', boss alive' : ''}); use fewer hard or metal bricks, a lower boss hp, a slower speed or a wider paddle` });
  return { ok: !problems.length, problems, cleared, time, deaths, proven: 'every breakable brick is reachable and a ball-tracking bot clears each breakout level', metrics: { bricks, seconds: Math.round(time * 10) / 10, deaths, sealed: sealed.length } };
}

// ---------- peggle ----------
// Lit pegs vanish after each shot, so a peg shielded at the start becomes reachable once the pegs
// in front of it are cleared. Rounds: find every peg some aim hits, remove them, search again.
function peggleShot(S, level, aim, floorY) {
  const s = structuredClone(S);
  peggle.fire(s, aim);
  for (let i = 0; i < 60 * 16 && s.m.phase === 'shot' && s.phase === 'play'; i++) {
    s.events = []; peggle.step(s, level, NEUTRAL, NO_PRESS);
    // Nothing left to learn once every ball has fallen below the lowest unproven peg.
    if ((i & 7) === 0 && s.m.ballIds.every(id => { const b = findBody(s.world, id); return !b || (b.y > floorY && b.vy > 0); })) break;
  }
  return s.m.shotLit;
}

function verifyPeggle(game, index, level, deadline) {
  let base = levelState(game, index);
  const allPegs = base.world.bodies.filter(b => b.tag === 'peg');
  const oranges = allPegs.filter(p => p.data.kind === 'orange').map(p => p.id);
  const covered = new Set(), hitEver = new Set();
  let shots = 0, rounds = 0;
  const A = 1.45;
  const open = () => oranges.filter(id => !covered.has(id));
  const floor = () => Math.max(...open().map(id => findBody(base.world, id)?.y ?? 0)) + 0.6;
  const shoot = aim => { shots++; for (const id of peggleShot(base, level, aim, floor())) { hitEver.add(id); if (oranges.includes(id)) covered.add(id); } };
  // Rounds of targeted shots: aim where the guide's first contact is each unproven orange peg.
  while (open().length && rounds < 5 && performance.now() < deadline) {
    rounds++;
    const pegs = base.world.bodies.filter(b => b.tag === 'peg' && !b.dead);
    const aimFor = new Map(), N = 240;
    for (let k = 0; k <= N; k++) {
      const aim = -A + 2 * A * k / N, g = peggle.guide(base, aim);
      if (g.id) (aimFor.get(g.id) || aimFor.set(g.id, []).get(g.id)).push(aim);
    }
    for (const id of open()) {
      if (covered.has(id) || performance.now() > deadline) continue;
      const aims = aimFor.get(id);
      // Middle of the aim window first, then its edges (moving pegs drift while the ball flies).
      if (aims?.length) for (const f of [0.5, 0.2, 0.8]) { if (covered.has(id) || performance.now() > deadline) break; shoot(aims[Math.floor((aims.length - 1) * f)]); if (aims.length < 3) break; }
    }
    if (!open().length) break;
    // Clear every peg proven hittable so far and look again.
    const next = structuredClone(base);
    let removed = 0;
    for (const b of next.world.bodies) if (b.tag === 'peg' && !b.dead && hitEver.has(b.id)) { b.dead = true; removed++; }
    next.world.rev++;
    if (!removed) break;
    base = next;
  }
  // Last resort: sweep the cannon across the board.
  for (const n of [36, 72]) for (let k = 0; k <= n && open().length; k++) {
    if (performance.now() > deadline) break;
    if (n > 36 && k % 2 === 0) continue;
    shoot(-A + 2 * A * k / n);
  }
  const missing = oranges.filter(id => !covered.has(id));
  const first = levelState(game, index);
  const problems = missing.length ? [{ code: 'orange_unreachable', path: 'peggle[0].groups', message: `${missing.length} of ${oranges.length} orange pegs were never hit by any aim (e.g. at ${missing.slice(0, 3).map(id => { const p = findBody(first.world, id); return `(${(p.x / first.m.scale).toFixed(0)}, ${(p.y / first.m.scale).toFixed(0)})`; }).join(', ')}); move them out from behind other pegs or make fewer oranges` }] : [];
  return { ok: !problems.length, problems, proven: 'every orange peg is hit by some cannon angle (pegs shielded at the start once the pegs in front are cleared)', metrics: { pegs: allPegs.length, oranges: oranges.length, covered: oranges.length - missing.length, shots, rounds, pegsHit: hitEver.size } };
}

// ---------- slingshot ----------
function slingCandidates(S) {
  const out = [], seen = [];
  const targets = S.world.bodies.filter(b => b.tag === 'target' && !b.dead).sort((a, b) => a.x - b.x);
  const push = (angle, power) => { if (angle == null || angle < -0.45 || angle > 1.38 || seen.some(([a, p]) => Math.abs(a - angle) < 0.012 && p === power)) return; seen.push([angle, power]); out.push({ angle, power }); };
  for (const t of targets) for (const power of [1, 0.86, 0.72]) {
    for (const [dx, dy] of [[-t.r * 0.4, 0], [0, t.r * 0.7]]) {
      const [low, high] = slingshot.aimAt(t.x + dx, t.y + dy, power, S.m.speedMax);
      push(low, power); push(high, power);
    }
  }
  return out;
}

function runShot(S, level, angle, power) {
  const s = structuredClone(S);
  slingshot.fire(s, angle, power);
  for (let i = 0; i < 60 * 12 && s.m.phase === 'flight' && s.phase === 'play'; i++) {
    s.events = [];
    slingshot.step(s, level, NEUTRAL, NO_PRESS);
    if (s.m.targetsLeft === 0) break;
  }
  return s;
}

function verifySlingshot(game, index, level, deadline) {
  let S = levelState(game, index);
  const total = S.m.targetsLeft, plan = [];
  let sims = 0;
  while (S.m.targetsLeft > 0 && S.m.queue.length && performance.now() < deadline) {
    let best = null;
    for (const c of slingCandidates(S).slice(0, LIMITS.slingshotCandidates)) {
      if (performance.now() > deadline) break;
      const s = runShot(S, level, c.angle, c.power); sims++;
      const kills = S.m.targetsLeft - s.m.targetsLeft, value = kills * 1e6 + s.levelScore;
      if (!best || value > best.value) best = { s, value, kills, c };
      if (s.m.targetsLeft === 0) break;
    }
    if (!best) break;
    plan.push({ shot: S.m.queue[0], angle: Math.round(best.c.angle * 1000) / 1000, power: best.c.power, defeated: best.kills });
    S = best.s;
    if (S.phase !== 'play' && S.m.targetsLeft > 0) break;
  }
  const solved = S.m.targetsLeft === 0;
  const problems = solved ? [] : [{ code: 'slingshot_unsolved', path: 'slingshot[0]', message: `no launch plan defeated all ${total} foes (${S.m.targetsLeft} left after ${plan.length} shots); add shots, bring foes closer or out of cover, or use softer toughness` }];
  return { ok: solved, problems, cleared: solved, proven: 'a launch search defeats every foe within the given shots', metrics: { foes: total, shotsUsed: plan.length, shots: level.slingshot.shots.length, sims, plan } };
}

// ---------- pinball ----------
function verifyPinball(game, index, level, deadline, seed) {
  const problems = [];
  let stuck = 0, escaped = 0, drains = 0, bumpers = 0, searches = 0, runs = 0, seconds = 0, missions = 0;
  for (let r = 0; r < LIMITS.pinballRuns && performance.now() < deadline; r++) {
    const S = levelState(game, index), policy = { rng: seedFrom(`${seed}:pinball:${index}:${r}`) };
    let left = false, right = false, hold = 0;
    const still = {};
    runs++;
    for (let f = 0; f < LIMITS.pinballSeconds * 60 && S.phase === 'play'; f++) {
      if (f % 6 === 0) { left = random(policy) < 0.3; right = random(policy) < 0.3; }
      let y = 0;
      if (S.m.lane) { if (hold <= 0) hold = 15 + Math.floor(random(policy) * 50); hold--; y = hold > 0 ? 1 : 0; }
      game.step(S, { x: 0, y, a: left, b: right });
      const anyUp = S.m.flippers.some(fl => fl.up);
      for (const id of S.m.balls) {
        const b = findBody(S.world, id);
        if (!b) continue;
        if (b.x < 0 || b.x > pinball.W || b.y < -0.5) { escaped++; S.m.balls = S.m.balls.filter(x => x !== id); continue; }
        const slow = Math.hypot(b.vx, b.vy) < 0.25 && S.m.lane !== id && !anyUp;
        still[id] = slow ? (still[id] || 0) + 1 / 60 : 0;
        if (still[id] > LIMITS.stuckSeconds) { stuck++; still[id] = -999; problems.push({ code: 'ball_stuck', path: 'pinball[0]', message: `a ball came to rest at (${b.x.toFixed(1)}, ${b.y.toFixed(1)}) with no way out; move bumpers, walls or targets apart, or use another table preset` }); }
      }
      seconds += 1 / 60;
    }
    drains += S.m.drains; bumpers += S.m.bumperHits; searches += S.m.searches; missions = Math.max(missions, S.m.mission);
  }
  if (escaped) problems.push({ code: 'ball_escaped', path: 'pinball[0]', message: `${escaped} balls left the table` });
  return { ok: !problems.length, problems: problems.slice(0, 4), proven: 'random flipper play never leaves a pinball stuck or lets it escape', metrics: { runs, seconds: Math.round(seconds), stuck, escaped, drains, bumperHits: bumpers, searches, bestMission: missions } };
}
