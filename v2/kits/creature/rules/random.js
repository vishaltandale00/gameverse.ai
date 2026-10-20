// Random helpers over the kernel PRNG. `rng` is any object holding a numeric `rng` field (usually
// the game state itself), advanced in place, so battles replay exactly from a saved state.
import { random } from '../../../kernel/rng.js';

export const rand = rng => random(rng);
/** Integer in 0..n-1. */
export const int = (rng, n) => Math.floor(random(rng) * n);
/** Integer in lo..hi inclusive. */
export const range = (rng, lo, hi) => lo + int(rng, hi - lo + 1);
export const chance = (rng, p) => random(rng) < p;

/** Pick from a list by weight (weightOf(item) > 0). */
export function weighted(rng, list, weightOf = x => x.weight) {
  const total = list.reduce((s, x) => s + Math.max(0, weightOf(x)), 0);
  let r = random(rng) * total;
  for (const x of list) { r -= Math.max(0, weightOf(x)); if (r < 0) return x; }
  return list[list.length - 1];
}

/** A short, stable id drawn from the RNG (creature uids). */
export const uidFrom = rng => int(rng, 2 ** 31).toString(36).padStart(6, '0');
