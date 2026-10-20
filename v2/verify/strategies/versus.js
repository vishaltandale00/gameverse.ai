// Versus checks for any document where the player fights AI opponents with
// health (ported from the fighting kit's verifier):
//   1. every combat verb connects with an opponent placed beside the player;
//   2. the opponent AI can finish a match against an idle player (no stalemate);
//   3. a scripted player (approach, attack in turn, back off from active
//      attacks) beats the opponents in at least some seeded matches.
// Combat verbs are the actions provided by gameplay.combat.* cards (all
// verbs if none declare any). Positions and distances go through the space.
import { hold, hpOf, foes, vitality, posOf } from '../drive.js';
import { budget as makeBudget, instancesOf } from '../util.js';
import { multiSeed, problem, livingFoes } from './common.js';

/** Verbs declared by combat primitives in the document, else every verb. */
export function combatVerbs(ctx, rt) {
  const declared = new Set();
  for (const x of instancesOf(ctx.doc)) { const p = ctx.registry.get(x.inst?.use); if (p && /\.combat\b/.test(p.id)) for (const a of p.card.provides.actions || []) declared.add(a); }
  const verbs = rt.actions();
  const list = verbs.filter(v => declared.has(v));
  return { verbs: list.length ? list : verbs, declared: list.length > 0 };
}

const nearestFoe = rt => {
  const p = rt.player(); if (!p) return null;
  const api = rt.space(p.space), at = posOf(rt, p);
  return livingFoes(rt).map(e => ({ e, d: api.distance(at, e.at) })).sort((a, b) => a.d - b.d)[0] || null;
};
const offset = (at, dx) => (Array.isArray(at) ? at.map((v, i) => (i === 0 ? v + dx : v)) : at);

/** Does `verb` damage an opponent placed beside the player (either side)? */
export function connects(rt, verb, { frames = 90 } = {}) {
  const snap = rt.snapshot();
  for (const side of [-1, 1]) {
    rt.restore(snap);
    const p = rt.player(), f = nearestFoe(rt); if (!p || !f) break;
    const api = rt.space(p.space), size = p.components.body?.size?.[0] ?? 1;
    if (Array.isArray(f.e.at)) api.setPos(p, offset(f.e.at, side * (size + 0.1)), rt);
    else api.setPos(p, f.e.at, rt);
    const id = f.e.id, hp0 = hpOf(f.e);
    hold(rt, { actions: { [verb]: true } }, 1);
    for (let i = 0; i < frames && rt.state.status === 'playing'; i++) {
      const e = rt.entity(id);
      if (!e || (hpOf(e) ?? hp0) < hp0) { rt.restore(snap); return true; }
      hold(rt, {}, 1);
    }
    const e = rt.entity(id);
    if (!e || (hpOf(e) ?? hp0) < hp0) { rt.restore(snap); return true; }
  }
  rt.restore(snap);
  return false;
}

/** A scripted fighter: approach, attack in turn, step back from an opponent mid-attack. */
export function scriptedFighter(verbs, { reach = 1.5 } = {}) {
  let turn = 0, cool = 0, back = 0;
  return rt => {
    const p = rt.player(), f = nearestFoe(rt);
    if (!p || !f) return {};
    const at = posOf(rt, p), dx = Array.isArray(at) && Array.isArray(f.e.at) ? Math.sign(f.e.at[0] - at[0]) || 1 : 0, dy = Array.isArray(at) && Array.isArray(f.e.at) ? Math.sign(Math.round(f.e.at[1] - at[1])) : 0;
    const busy = f.e.components.attacks?.active || f.e.components.melee?.active || f.e.components.ai?.attacking;
    if (back > 0) { back--; return { axes: { move: [-dx, 0] } }; }
    if (busy && f.d < reach * 1.5 && (vitality(rt).hp ?? 1) > 0 && turn % 3 === 2) { back = 6; return { axes: { move: [-dx, 0] } }; }
    if (f.d > reach) return { axes: { move: [dx, dy] } };
    if (cool > 0) { cool--; return {}; }
    cool = 6; const v = verbs[turn++ % verbs.length];
    return { actions: { [v]: true }, axes: { move: [dx, 0] } };
  };
}

export default {
  id: 'versus',
  intent: 'Player-vs-AI combat with health: every attack connects, the AI finishes matches, and a scripted player wins some seeded matches.',
  requires: { capabilities: ['position', 'distance'] },
  detect(ctx) { const rt = ctx.make(ctx.seed); return Boolean(rt.player()) && foes(rt).some(e => e.components.ai) && rt.actions().length > 0; },
  run(ctx, { matchFrames = 3600, seeds = [1, 2, 3, 4, 5, 6], budgetMs = 2000, maxSteps = Infinity, reach } = {}) {
    const b = makeBudget({ ms: budgetMs, steps: maxSteps });
    const rt = ctx.make(ctx.seed), problems = [], proven = [];
    const { verbs, declared } = combatVerbs(ctx, rt);
    // 1. Every combat verb connects.
    const hits = verbs.filter(v => connects(rt, v));
    if (!hits.length) problems.push(problem('no_attack_connects', 'systems', `none of the player's verbs (${verbs.join(', ')}) damage an opponent beside the player`, { hint: 'check attack reach and hitboxes against opponent size' }));
    else if (declared) for (const v of verbs.filter(x => !hits.includes(x))) problems.push(problem('whiff', 'systems', `combat verb '${v}' never damages an opponent beside the player`, { severity: 'warning', hint: 'raise its reach or fix its hitbox' }));
    if (hits.length === verbs.length) proven.push(`every combat verb connects (${verbs.join(', ')})`);
    // 2. The AI finishes against an idle player.
    const idle = ctx.make(ctx.seed), hp0 = vitality(idle).hp;
    let damaged = false;
    for (let f = 0; f < matchFrames && idle.state.status === 'playing' && !b.over(); f++) { hold(idle, {}, 1, b); const v = vitality(idle); if (v.hp !== null && hp0 !== null && v.hp < hp0) damaged = true; if (!v.alive) break; }
    if (!damaged && idle.state.status === 'playing') problems.push(problem('stalemate', 'systems', `the opponents never damage an idle player in ${Math.round(matchFrames / 60)} s`, { severity: 'warning', hint: 'give the AI an attack it uses in range, or raise its aggression' }));
    else proven.push('the opponent AI damages an idle player');
    // 3. A scripted player beats the AI sometimes.
    const range = reach ?? 1.2 * (rt.player()?.components.body?.size?.[0] ?? 1);
    const play = seed => {
      const w = ctx.make(seed), policy = scriptedFighter(hits.length ? hits : verbs, { reach: range });
      while (w.state.status === 'playing' && w.state.frame < matchFrames && !b.over() && livingFoes(w).length && vitality(w).alive) hold(w, policy(w), 1, b);
      const won = w.state.status === 'won' || (!livingFoes(w).length && vitality(w).alive);
      return { seed, won, status: w.state.status, frames: w.state.frame, foesLeft: livingFoes(w).length, hp: vitality(w).hp, budget: !won && w.state.status === 'playing' && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate: 1 / seeds.length, b });
    if (!r.wins && r.runs.some(x => !x.budget)) problems.push(problem('too_hard', 'systems', `a scripted player never beat the opponents in ${r.runs.length} seeded matches`, { hint: 'lower opponent hp/damage or reaction, or strengthen the player' }));
    else if (r.wins) proven.push(`a scripted player beats the opponents (${r.wins}/${r.runs.length} seeded matches)`);
    return { ok: !problems.some(p => p.severity === 'error'), proven, problems, metrics: { verbs, connected: hits, idleDamaged: damaged, matches: r.runs }, exhaustive: false, budget: b.report() };
  },
};
