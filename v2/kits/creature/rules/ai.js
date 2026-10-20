// Battle AI (CONTRACT.md §2). Wild creatures pick a random usable move. Trainers pick the move with
// the best expected damage (power × same-type bonus × effectiveness × accuracy), use a status move
// when it's useful and not already applied, and leaders heal once below 25% hp. After a faint,
// trainers send in their best type matchup. The same scoring is the verifier's greedy player policy.
import { moveOf, statsOf, STRUGGLE } from './stats.js';
import { effectiveness, typesOf } from './damage.js';
import { int, rand } from './random.js';

export const usableMoves = c => c.moves.map((m, i) => (m.pp > 0 ? i : -1)).filter(i => i >= 0);

/** Expected damage score of a damaging move from attacker to defender. */
export function moveScore(content, attacker, defender, move) {
  if (!move.power) return 0;
  const stab = move.type && typesOf(content, attacker).includes(move.type) ? 1.5 : 1;
  const hits = move.effect?.kind === 'multihit' ? (move.effect.min + move.effect.max) / 2 : 1;
  const acc = move.accuracy == null ? 1 : move.accuracy / 100;
  const st = statsOf(content, attacker);
  const ratio = move.category === 'physical' ? st.atk / Math.max(1, st.spa) : st.spa / Math.max(1, st.atk);
  // A mild preference for the attacker's stronger attacking stat breaks ties between similar moves.
  return move.power * hits * stab * effectiveness(content, move.type, typesOf(content, defender)) * acc * Math.min(1.25, Math.max(0.8, ratio));
}

/** Usefulness of a status move right now (0 = useless). */
function statusScore(content, side, foeSide, move) {
  const me = side.party[side.active], foe = foeSide.party[foeSide.active], e = move.effect;
  const acc = move.accuracy == null ? 1 : move.accuracy / 100;
  const foeHp = foe.hp / statsOf(content, foe).hp, myHp = me.hp / statsOf(content, me).hp;
  if (!e) return 0;
  if (e.kind === 'heal') return myHp < 0.4 ? 140 : 0;
  if (foeHp < 0.35) return 0; // finish it instead
  if (e.kind === 'status') {
    if (e.status === 'confusion') return foeSide.vol.confusion > 0 ? 0 : 40 * acc;
    return foe.status ? 0 : (e.status === 'sleep' || e.status === 'paralysis' ? 55 : 45) * acc;
  }
  if (e.kind === 'stat') {
    if (e.target === 'self') return (side.stages[e.stat] || 0) < 2 && myHp > 0.6 ? (e.stages > 0 ? 35 : 0) : 0;
    return (foeSide.stages[e.stat] || 0) > -2 && e.stages < 0 ? 28 * acc : 0;
  }
  return 0;
}

/** The best move index for a trainer (or the greedy player). -1 means Struggle. */
export function bestMove(content, side, foeSide, { statusMoves = true } = {}) {
  const me = side.party[side.active], foe = foeSide.party[foeSide.active];
  const usable = usableMoves(me);
  if (!usable.length) return -1;
  let best = usable[0], bestScore = -1;
  for (const i of usable) {
    const move = moveOf(content, me.moves[i].id);
    const score = move.category === 'status' ? (statusMoves ? statusScore(content, side, foeSide, move) : 0) : moveScore(content, me, foe, move);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

/** Wild creatures: a random usable move. */
export function wildMove(me, rng) {
  const usable = usableMoves(me);
  return usable.length ? usable[int(rng, usable.length)] : -1;
}

/** Index of the party member with the best type matchup against `against` (alive, not `exclude`). */
export function bestMatchup(content, party, against, exclude = -1) {
  let best = -1, bestScore = -Infinity;
  party.forEach((c, i) => {
    if (i === exclude || c.hp <= 0) return;
    const offense = Math.max(0, ...c.moves.map(m => moveScore(content, c, against, moveOf(content, m.id))));
    const defense = Math.max(0, ...against.moves.map(m => moveScore(content, against, c, moveOf(content, m.id))));
    const score = offense - defense * 0.8 + c.level;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

/** The foe's action for this turn. */
export function foeAction(content, battle, rng) {
  const side = battle.foe, me = side.party[side.active];
  if (battle.kind === 'wild') return { kind: 'move', index: wildMove(me, rng) };
  // Difficulty (content.settings.difficulty): easy trainers often pick at random; hard ones all heal once.
  const healer = battle.kind === 'leader' || battle.kind === 'champion' || battle.difficulty === 'hard';
  if (healer && !side.healUsed && me.hp > 0 && me.hp < statsOf(content, me).hp * 0.25) return { kind: 'heal' };
  if (battle.difficulty === 'easy' && rand(rng) < 0.5) return { kind: 'move', index: wildMove(me, rng) };
  return { kind: 'move', index: bestMove(content, side, battle.player) };
}

export { STRUGGLE };
