// Capture with shake checks (CONTRACT.md §2).
import { statsOf, speciesOf } from './stats.js';
import { int } from './random.js';

/** The catch value a and the shake threshold b for a ball bonus against a creature's state. */
export function captureOdds(content, creature, ballBonus = 1) {
  const maxHp = statsOf(content, creature).hp, hp = Math.max(1, creature.hp);
  const rate = speciesOf(content, creature.species).catchRate;
  const statusBonus = creature.status === 'sleep' || creature.status === 'freeze' ? 2.5 : creature.status ? 1.5 : 1;
  const a = Math.max(1, Math.floor((3 * maxHp - 2 * hp) * rate * ballBonus / (3 * maxHp) * statusBonus));
  const b = a >= 255 ? 65536 : Math.floor(1048560 / Math.sqrt(Math.sqrt(16711680 / a)));
  return { a, b, probability: a >= 255 ? 1 : (b / 65536) ** 4 };
}

/** Four shake checks; returns { shakes: 0..4, success }. A guaranteed catch still reports 4 shakes. */
export function attemptCapture(content, creature, ballBonus, rng) {
  const { a, b } = captureOdds(content, creature, ballBonus);
  if (a >= 255) return { shakes: 4, success: true };
  let shakes = 0;
  while (shakes < 4 && int(rng, 65536) < b) shakes++;
  return { shakes, success: shakes === 4 };
}
