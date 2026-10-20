// Deterministic PRNG kept inside game state, so snapshots replay exactly.
export function seedFrom(value) {
  let h = 2166136261 >>> 0;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h || 1;
}

// mulberry32 advancing state.rng in place; returns [0, 1).
export function random(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
