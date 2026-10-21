// Versus checks for any document where the player fights AI opponents with
// health (ported from the fighting kit's verifier):
//   1. every combat verb connects with an opponent the player walks up to (through the controls);
//   2. the opponent AI can finish a match against an idle player (no stalemate);
//   3. a scripted player (approach, attack in turn, back off from active
//      attacks) beats the opponents in at least some seeded matches.
// Combat verbs are the actions provided by gameplay.combat.* cards (all
// verbs if none declare any). Positions and distances go through the space.
import { hold, hpOf, foes, vitality, posOf } from '../drive.js';
import { budget as makeBudget, instancesOf } from '../util.js';
import { multiSeed, problem, livingFoes } from './common.js';

/**
 * The combat presses a person has: the verbs declared by combat primitives in the document (all verbs if none declare
 * any), each with the value its first key sends (a press sends true; a verb bound per value, a fighter's special
 * motions, sends one of them), keeping only verbs a control issues. -> { verbs: [verb], presses: [{ verb, value }], declared }
 */
export function combatVerbs(ctx, rt) {
  const declared = new Set();
  for (const x of instancesOf(ctx.doc)) { const p = ctx.registry.get(x.inst?.use); if (p && /\.combat\b/.test(p.id)) for (const a of p.card.provides.actions || []) declared.add(a); }
  const verbs = rt.actions().filter(v => !rt.controls || rt.controls.presses(v).length);
  const list = verbs.filter(v => declared.has(v)), chosen = list.length ? list : verbs;
  return { verbs: chosen, presses: chosen.map(v => ({ verb: v, value: rt.controls ? rt.controls.presses(v)[0] : true })), declared: list.length > 0 };
}

const nearestFoe = rt => {
  const p = rt.player(); if (!p) return null;
  const api = rt.space(p.space), at = posOf(rt, p);
  return livingFoes(rt).map(e => ({ e, d: api.distance(at, e.at) })).sort((a, b) => a.d - b.d)[0] || null;
};
const toward = (rt, p, f) => { const at = posOf(rt, p); return Array.isArray(at) && Array.isArray(f.e.at) ? [Math.sign(f.e.at[0] - at[0]) || 1, Math.sign(Math.round(f.e.at[1] - at[1]))] : [0, 0]; };

/**
 * Does a press damage the nearest opponent? Through the controls: walk toward it with the held move axis and, every
 * few frames of the approach, try the press on a snapshot (face it, press, watch its health), so the press is tried at
 * every distance its reach may need, never from a placed position.
 */
export function connects(rt, press, { frames = 45, approach = 240, every = 4 } = {}) {
  const snap = rt.snapshot();
  const f0 = nearestFoe(rt); if (!rt.player() || !f0) { rt.restore(snap); return false; }
  const id = f0.e.id;
  const tryHere = () => {
    const here = rt.snapshot(), p = rt.player(), f = nearestFoe(rt), hp0 = hpOf(rt.entity(id));
    let hit = false;
    if (p && f) {
      hold(rt, { axes: { move: [toward(rt, p, f)[0], 0] }, actions: { [press.verb]: press.value } }, 1);
      for (let i = 0; i < frames && rt.state.status === 'playing' && !hit; i++) { const e = rt.entity(id); hit = !e || (hpOf(e) ?? hp0) < hp0; if (!hit) hold(rt, {}, 1); }
      const e = rt.entity(id); hit = hit || !e || (hpOf(e) ?? hp0) < hp0;
    }
    rt.restore(here);
    return hit;
  };
  for (let i = 0; i < approach && rt.state.status === 'playing'; i++) {
    if (i % every === 0 && tryHere()) { rt.restore(snap); return true; }
    const p = rt.player(), f = nearestFoe(rt); if (!p || !f || f.e.id !== id) break;
    hold(rt, { axes: { move: toward(rt, p, f) } }, 1);
  }
  rt.restore(snap);
  return false;
}

/** A scripted fighter: approach, attack in turn, step back from an opponent mid-attack. presses: [{ verb, value }]. */
export function scriptedFighter(presses, { reach = 1.5 } = {}) {
  let turn = 0, cool = 0, back = 0;
  return rt => {
    const p = rt.player(), f = nearestFoe(rt);
    if (!p || !f) return {};
    const [dx, dy] = toward(rt, p, f);
    const busy = f.e.components.attacks?.active || f.e.components.melee?.active || f.e.components.ai?.attacking;
    if (back > 0) { back--; return { axes: { move: [-dx, 0] } }; }
    if (busy && f.d < reach * 1.5 && (vitality(rt).hp ?? 1) > 0 && turn % 3 === 2) { back = 6; return { axes: { move: [-dx, 0] } }; }
    if (f.d > reach) return { axes: { move: [dx, dy] } };
    if (cool > 0) { cool--; return {}; }
    cool = 6; const x = presses[turn++ % presses.length];
    return { actions: { [x.verb]: x.value }, axes: { move: [dx, 0] } };
  };
}

export default {
  id: 'versus',
  intent: 'Player-vs-AI combat with health: every attack connects, the AI finishes matches, and a scripted player wins some seeded matches.',
  requires: { capabilities: ['position', 'distance'] },
  detect(ctx) { const rt = ctx.make(ctx.seed); return Boolean(rt.player()) && foes(rt).some(e => e.components.ai) && rt.actions().length > 0; },
  run(ctx, { matchFrames = 3600, seeds = [1, 2, 3, 4, 5, 6], budgetMs = 2000, maxSteps = Infinity, reach } = {}) {
    const b = makeBudget({ ms: budgetMs, steps: maxSteps });
    // Opponents spawned by rules arrive after frame 0, and round rules (var round.live) hold fighters through an intro: idle until both are ready (up to 10 s).
    const ready = w => {
      let i = 0; const go = () => w.state.status === 'playing' && i++ < 600;
      while (go() && !livingFoes(w).length) w.step({});
      hold(w, {}, 2); // rules that start on the opponent's arrival (a match) get their first step
      while (go() && w.state.vars['round.live'] === 0) w.step({});
      return w;
    };
    const rt = ready(ctx.make(ctx.seed)), problems = [], proven = [];
    const { verbs, presses, declared } = combatVerbs(ctx, rt);
    // 1. Every combat verb connects (walked up to through the controls, then pressed).
    const hitting = presses.filter(x => connects(rt, x)), hits = hitting.map(x => x.verb);
    if (!hits.length) problems.push(problem('no_attack_connects', 'systems', `none of the player's verbs (${verbs.join(', ')}) damage an opponent beside the player`, { hint: 'check attack reach and hitboxes against opponent size' }));
    else if (declared) for (const v of verbs.filter(x => !hits.includes(x))) problems.push(problem('whiff', 'systems', `combat verb '${v}' never damages an opponent beside the player`, { severity: 'warning', hint: 'raise its reach or fix its hitbox' }));
    if (hits.length === verbs.length) proven.push(`every combat verb connects (${verbs.join(', ')})`);
    // 2. The AI finishes against an idle player.
    const idle = ready(ctx.make(ctx.seed)), hp0 = vitality(idle).hp;
    let damaged = false;
    for (let f = 0; f < matchFrames && idle.state.status === 'playing' && !b.over(); f++) { hold(idle, {}, 1, b); const v = vitality(idle); if (v.hp !== null && hp0 !== null && v.hp < hp0) damaged = true; if (!v.alive) break; }
    if (!damaged && idle.state.status === 'playing') problems.push(problem('stalemate', 'systems', `the opponents never damage an idle player in ${Math.round(matchFrames / 60)} s`, { severity: 'warning', hint: 'give the AI an attack it uses in range, or raise its aggression' }));
    else proven.push('the opponent AI damages an idle player');
    // 3. A scripted player beats the AI sometimes.
    const range = reach ?? 1.2 * (rt.player()?.components.body?.size?.[0] ?? 1);
    const play = seed => {
      const w = ready(ctx.make(seed)), fought = livingFoes(w).length > 0, policy = scriptedFighter(hitting.length ? hitting : presses, { reach: range });
      // Fight while opponents stand; between rounds (KO, round end, next round) wait up to 10 s for the match to go on or end.
      let idleFrames = 0;
      while (w.state.status === 'playing' && w.state.frame < matchFrames && !b.over() && vitality(w).alive && idleFrames < 600) { if (livingFoes(w).length) { idleFrames = 0; hold(w, policy(w), 1, b); } else { idleFrames++; hold(w, {}, 1, b); } }
      const won = w.state.status === 'won' || (fought && !livingFoes(w).length && vitality(w).alive);
      return { seed, won, status: w.state.status, frames: w.state.frame, foesLeft: livingFoes(w).length, hp: vitality(w).hp, budget: !won && w.state.status === 'playing' && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate: 1 / seeds.length, b });
    if (!r.wins && r.runs.some(x => !x.budget)) problems.push(problem('too_hard', 'systems', `a scripted player never beat the opponents in ${r.runs.length} seeded matches`, { hint: 'lower opponent hp/damage or reaction, or strengthen the player' }));
    else if (r.wins) proven.push(`a scripted player beats the opponents (${r.wins}/${r.runs.length} seeded matches)`);
    return { ok: !problems.some(p => p.severity === 'error'), proven, problems, metrics: { verbs, connected: hits, idleDamaged: damaged, matches: r.runs }, exhaustive: false, budget: b.report() };
  },
};
