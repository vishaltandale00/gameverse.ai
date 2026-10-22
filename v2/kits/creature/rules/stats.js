// Creatures, stats and experience (CONTRACT.md §2). Creatures are plain JSON:
// { uid, species, name, level, exp, ivs, hp, status, sleep, moves: [{ id, pp, max }] }.
// `hp` is current health; max health and the other stats are derived by statsOf.
import { STATS, indexContent } from '../content.js';
import { int, uidFrom } from './random.js';

// Content is immutable during play, so its id maps are cached per content object.
const INDEX = new WeakMap();
export function lookup(content) {
  let idx = INDEX.get(content);
  if (!idx) { idx = indexContent(content); INDEX.set(content, idx); }
  return idx;
}

/** The move used when every move is out of PP: typeless, never misses, 1/4 recoil. */
export const STRUGGLE = Object.freeze({ id: 'struggle', name: 'Struggle', type: null, category: 'physical', power: 50, accuracy: null, pp: 1, priority: 0, effect: { kind: 'recoil', fraction: 0.25 }, description: 'A desperate attack.' });

export const moveOf = (content, id) => id === 'struggle' ? STRUGGLE : lookup(content).moves.get(id);
export const speciesOf = (content, id) => lookup(content).species.get(id);

const GROWTH_K = { fast: 0.8, medium: 1, slow: 1.25 };
/** Total experience needed to be at `level` on a growth curve (0.8n³, n³, 1.25n³). */
export function expToLevel(growth, level) {
  if (level <= 1) return 0;
  return Math.floor((GROWTH_K[growth] ?? 1) * level ** 3);
}
/** Highest level reached with `exp` total experience (1..100). */
export function levelForExp(growth, exp) {
  let n = 1;
  while (n < 100 && expToLevel(growth, n + 1) <= exp) n++;
  return n;
}

/** stat = floor((2*base + iv) * level / 100) + 5; hp = floor((2*base + iv) * level / 100) + level + 10. */
export function statsOf(content, creature) {
  const sp = speciesOf(content, creature.species);
  const out = {};
  for (const k of STATS) {
    const core = Math.floor((2 * sp.base[k] + (creature.ivs?.[k] ?? 0)) * creature.level / 100);
    out[k] = k === 'hp' ? core + creature.level + 10 : core + 5;
  }
  return out;
}
export const maxHpOf = (content, c) => statsOf(content, c).hp;

const slot = (content, id) => { const m = moveOf(content, id); return { id, pp: m.pp, max: m.pp }; };
/** The four most recently learned moves at a level, in learn order. */
export function movesAt(content, speciesId, level) {
  const sp = speciesOf(content, speciesId);
  const known = [];
  for (const l of sp.learnset) {
    if (l.level > level || known.includes(l.move)) continue;
    known.push(l.move);
    if (known.length > 4) known.shift();
  }
  return known.map(id => slot(content, id));
}

/** A new creature with IVs rolled from the RNG, full health and its level's moves. */
export function createCreature(content, speciesId, level, rng) {
  const sp = speciesOf(content, speciesId);
  if (!sp) throw Error(`unknown species '${speciesId}'`);
  const lv = Math.max(1, Math.min(100, Math.round(level)));
  const ivs = Object.fromEntries(STATS.map(k => [k, int(rng, 32)]));
  const c = { uid: uidFrom(rng), species: sp.id, name: sp.name, level: lv, exp: expToLevel(sp.growth, lv), ivs, hp: 0, status: null, sleep: 0, moves: movesAt(content, sp.id, lv) };
  c.hp = statsOf(content, c).hp;
  return c;
}

/** A compact summary for events and views. */
export function summary(content, c) {
  const sp = speciesOf(content, c.species), st = statsOf(content, c);
  return { uid: c.uid, species: c.species, name: c.name, level: c.level, hp: c.hp, maxHp: st.hp, status: c.status, types: sp.types };
}

/** Restore health, PP and status (heal centers, blackouts). */
export function healCreature(content, c) {
  c.hp = statsOf(content, c).hp;
  c.status = null; c.sleep = 0;
  for (const m of c.moves) m.pp = m.max;
}

/**
 * Raise a creature's level once, recomputing stats and keeping the damage taken.
 * Returns { before, after } stats. Learning is handled by the caller (it may need a prompt).
 */
export function levelUp(content, c) {
  const before = statsOf(content, c);
  c.level = Math.min(100, c.level + 1);
  const after = statsOf(content, c);
  c.hp = c.hp > 0 ? Math.max(1, after.hp - (before.hp - c.hp)) : 0;
  return { before, after };
}

/** Moves a species learns at exactly `level` that the creature doesn't already know. */
export function newMovesAt(content, c, level = c.level) {
  const sp = speciesOf(content, c.species);
  return [...new Set(sp.learnset.filter(l => l.level === level).map(l => l.move))].filter(id => !c.moves.some(m => m.id === id));
}
export const learnSlot = slot;

/** The species this creature can evolve into now (level ≥ evolves.level), or null. */
export function evolutionOf(content, c) {
  const sp = speciesOf(content, c.species);
  return sp.evolves && c.level >= sp.evolves.level && speciesOf(content, sp.evolves.to) ? sp.evolves.to : null;
}

/** Evolve in place: new species, stats recomputed keeping the damage taken, name follows the species. */
export function evolve(content, c, to) {
  const before = statsOf(content, c), from = speciesOf(content, c.species), next = speciesOf(content, to);
  if (c.name === from.name) c.name = next.name;
  c.species = to;
  const after = statsOf(content, c);
  c.hp = c.hp > 0 ? Math.max(1, after.hp - (before.hp - c.hp)) : 0;
  return { before, after };
}
