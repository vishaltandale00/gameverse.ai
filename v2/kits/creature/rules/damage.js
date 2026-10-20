// Type effectiveness, stat stages and the damage formula (CONTRACT.md §2).
import { statsOf, speciesOf } from './stats.js';
import { range, chance } from './random.js';

/** Product of chart multipliers over the defender's types. A typeless move (Struggle) is neutral. */
export function effectiveness(content, moveType, defenderTypes) {
  if (!moveType) return 1;
  return defenderTypes.reduce((m, t) => m * (content.chart?.[moveType]?.[t] ?? 1), 1);
}

/** Battle stats: (2+s)/2 for s ≥ 0, 2/(2−s) below. */
export const stageMult = s => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
/** Accuracy and evasion use thirds. */
export const accMult = s => (s >= 0 ? (3 + s) / 3 : 3 / (3 - s));
export const clampStage = s => Math.max(-6, Math.min(6, s));

export const typesOf = (content, c) => speciesOf(content, c.species).types;

/**
 * Damage for one hit. Options let tests pin the random parts: { crit: bool, roll: 85..100 }.
 * floor(floor(floor(2L/5+2) * power * A/D) / 50) + 2, then ×1.5 crit, × roll/100, ×1.5 same-type, × type, burn halves physical.
 * Critical hits ignore the attacker's negative and the defender's positive stages.
 */
export function calcDamage(content, { attacker, defender, move, attStages = {}, defStages = {}, rng, crit, roll }) {
  if (!move.power) return { damage: 0, crit: false, eff: 1, stab: false };
  const eff = effectiveness(content, move.type, typesOf(content, defender));
  if (eff === 0) return { damage: 0, crit: false, eff: 0, stab: false };
  const isCrit = crit ?? chance(rng, move.highCrit ? 1 / 8 : 1 / 16);
  const physical = move.category === 'physical';
  const [ak, dk] = physical ? ['atk', 'def'] : ['spa', 'spd'];
  let as = attStages[ak] || 0, ds = defStages[dk] || 0;
  if (isCrit) { as = Math.max(0, as); ds = Math.min(0, ds); }
  const A = Math.max(1, Math.floor(statsOf(content, attacker)[ak] * stageMult(as)));
  const D = Math.max(1, Math.floor(statsOf(content, defender)[dk] * stageMult(ds)));
  let dmg = Math.floor(Math.floor(Math.floor(2 * attacker.level / 5 + 2) * move.power * A / D) / 50) + 2;
  if (isCrit) dmg = Math.floor(dmg * 1.5);
  dmg = Math.floor(dmg * (roll ?? range(rng, 85, 100)) / 100);
  const stab = !!move.type && typesOf(content, attacker).includes(move.type);
  if (stab) dmg = Math.floor(dmg * 1.5);
  dmg = Math.floor(dmg * eff);
  if (physical && attacker.status === 'burn') dmg = Math.floor(dmg / 2);
  return { damage: Math.max(1, dmg), crit: isCrit, eff, stab };
}
