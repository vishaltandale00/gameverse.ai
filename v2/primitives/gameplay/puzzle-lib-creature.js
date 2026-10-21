// Creature rules shared by gameplay.creature.{party,battle,catch} and gameplay.encounter,
// ported from the creature kit (rules/stats, damage, capture, ai). Pure functions over
// document content and plain-JSON creatures; randomness comes in as `rand` (rt.random).
//
// content.species[]: { id, name, types[], base{hp,atk,def,spa,spd,spe}, catchRate, expYield,
//                      growth: fast|medium|slow, learnset[{level, move}], evolves?{level, to} }
// content.moves[]:   { id, name, type, category: physical|special|status, power, accuracy|null,
//                      pp, priority?, highCrit?, effect?{kind: status|stat|heal|drain|recoil|
//                      multihit|flinch|protect, ...} }
// content.types:     { attackingType: { defendingType: multiplier } }  (missing = 1)
// content.items[].creature: { kind: ball|heal|status|revive, value }
// Creature: { uid, species, name, level, exp, ivs, hp, status, sleep, moves: [{ id, pp, max }] }

export const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAGE_STATS = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
export const STATUSES = ['burn', 'poison', 'paralysis', 'sleep', 'freeze', 'confusion'];
export const EFFECT_KINDS = ['status', 'stat', 'heal', 'drain', 'recoil', 'multihit', 'flinch', 'protect'];
export const STRUGGLE = Object.freeze({ id: 'struggle', name: 'Struggle', type: null, category: 'physical', power: 50, accuracy: null, pp: 1, priority: 0, effect: { kind: 'recoil', fraction: 0.25 } });
const GROWTH_K = { fast: 0.8, medium: 1, slow: 1.25 };

export const int = (rand, n) => Math.floor(rand() * n);
export const range = (rand, lo, hi) => lo + int(rand, hi - lo + 1);
export const chance = (rand, p) => rand() < p;

const INDEX = new WeakMap();
/** Id maps for a content object (cached; rebuilt when the document's content object changes). */
export function lookup(content) {
  let idx = INDEX.get(content);
  if (!idx) {
    idx = { species: new Map((content.species || []).map(s => [s.id, s])), moves: new Map((content.moves || []).map(m => [m.id, m])), items: new Map((content.items || []).map(i => [i.id, i])) };
    INDEX.set(content, idx);
  }
  return idx;
}
export const speciesOf = (content, id) => lookup(content).species.get(id);
export const moveOf = (content, id) => id === 'struggle' ? STRUGGLE : lookup(content).moves.get(id);
export const itemRule = (content, id) => { const it = lookup(content).items.get(id); return it?.creature ? { id, name: it.name || id, ...it.creature } : null; };

/** Total experience to be at `level` (0.8n³, n³, 1.25n³). */
export function expToLevel(growth, level) { return level <= 1 ? 0 : Math.floor((GROWTH_K[growth] ?? 1) * level ** 3); }
export function levelForExp(growth, exp) { let n = 1; while (n < 100 && expToLevel(growth, n + 1) <= exp) n++; return n; }

/** stat = floor((2·base + iv)·L/100) + 5; hp = floor((2·base + iv)·L/100) + L + 10. */
export function statsOf(content, c) {
  const sp = speciesOf(content, c.species), out = {};
  for (const k of STATS) { const core = Math.floor((2 * sp.base[k] + (c.ivs?.[k] ?? 0)) * c.level / 100); out[k] = k === 'hp' ? core + c.level + 10 : core + 5; }
  return out;
}
const slot = (content, id) => { const m = moveOf(content, id); return { id, pp: m.pp, max: m.pp }; };
/** The four most recently learned moves at a level, in learn order. */
export function movesAt(content, speciesId, level) {
  const known = [];
  for (const l of speciesOf(content, speciesId).learnset || []) { if (l.level > level || known.includes(l.move)) continue; known.push(l.move); if (known.length > 4) known.shift(); }
  return known.map(id => slot(content, id));
}
export function createCreature(content, speciesId, level, rand, uid) {
  const sp = speciesOf(content, speciesId);
  if (!sp) throw Error(`unknown species '${speciesId}'`);
  const lv = Math.max(1, Math.min(100, Math.round(level)));
  const ivs = Object.fromEntries(STATS.map(k => [k, int(rand, 32)]));
  const c = { uid, species: sp.id, name: sp.name || sp.id, level: lv, exp: expToLevel(sp.growth, lv), ivs, hp: 0, status: null, sleep: 0, moves: movesAt(content, sp.id, lv) };
  c.hp = statsOf(content, c).hp;
  return c;
}
export function healCreature(content, c) { c.hp = statsOf(content, c).hp; c.status = null; c.sleep = 0; for (const m of c.moves) m.pp = m.max; }
export function levelUp(content, c) {
  const before = statsOf(content, c);
  c.level = Math.min(100, c.level + 1);
  const after = statsOf(content, c);
  c.hp = c.hp > 0 ? Math.max(1, after.hp - (before.hp - c.hp)) : 0;
  return { before, after };
}
export function newMovesAt(content, c, level = c.level) {
  const sp = speciesOf(content, c.species);
  return [...new Set((sp.learnset || []).filter(l => l.level === level).map(l => l.move))].filter(id => !c.moves.some(m => m.id === id));
}
export const learnSlot = slot;
export function evolutionOf(content, c) { const sp = speciesOf(content, c.species); return sp.evolves && c.level >= sp.evolves.level && speciesOf(content, sp.evolves.to) ? sp.evolves.to : null; }
export function evolve(content, c, to) {
  const before = statsOf(content, c), from = speciesOf(content, c.species), next = speciesOf(content, to);
  if (c.name === (from.name || from.id)) c.name = next.name || next.id;
  c.species = to;
  const after = statsOf(content, c);
  c.hp = c.hp > 0 ? Math.max(1, after.hp - (before.hp - c.hp)) : 0;
  return { before, after };
}
/** Give experience outside a learn prompt; returns [{level, learned[], pending[]}] per level gained. */
export function gainExp(content, c, amount) {
  const out = [], growth = speciesOf(content, c.species).growth;
  if (c.level >= 100) return out;
  c.exp += amount;
  while (c.level < 100 && c.exp >= expToLevel(growth, c.level + 1)) {
    const st = levelUp(content, c), learned = [], pending = [];
    for (const id of newMovesAt(content, c)) { if (c.moves.length < 4) { c.moves.push(slot(content, id)); learned.push(id); } else pending.push(id); }
    out.push({ level: c.level, ...st, learned, pending });
  }
  return out;
}
export const expBar = (growth, c) => ({ from: expToLevel(growth, c.level), to: c.level >= 100 ? expToLevel(growth, 100) : expToLevel(growth, c.level + 1), now: c.exp });

// ---- damage ----
export function effectiveness(content, moveType, defenderTypes) {
  if (!moveType) return 1;
  const chart = Array.isArray(content.types) ? {} : content.types;
  return defenderTypes.reduce((m, t) => m * (chart?.[moveType]?.[t] ?? 1), 1);
}
export const stageMult = s => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
export const accMult = s => (s >= 0 ? (3 + s) / 3 : 3 / (3 - s));
export const clampStage = s => Math.max(-6, Math.min(6, s));
export const typesOf = (content, c) => speciesOf(content, c.species).types;
/**
 * floor(floor(floor(2L/5+2)·power·A/D)/50)+2, ×1.5 crit (1/16, 1/8 high-crit), × roll 85..100 %,
 * ×1.5 same-type, × type chart, burn halves physical. Crits ignore the attacker's negative and the
 * defender's positive stages. opts.crit / opts.roll pin the random parts.
 */
export function calcDamage(content, { attacker, defender, move, attStages = {}, defStages = {}, rand, crit, roll }) {
  if (!move.power) return { damage: 0, crit: false, eff: 1, stab: false };
  const eff = effectiveness(content, move.type, typesOf(content, defender));
  if (eff === 0) return { damage: 0, crit: false, eff: 0, stab: false };
  const isCrit = crit ?? chance(rand, move.highCrit ? 1 / 8 : 1 / 16);
  const physical = move.category === 'physical', [ak, dk] = physical ? ['atk', 'def'] : ['spa', 'spd'];
  let as = attStages[ak] || 0, ds = defStages[dk] || 0;
  if (isCrit) { as = Math.max(0, as); ds = Math.min(0, ds); }
  const A = Math.max(1, Math.floor(statsOf(content, attacker)[ak] * stageMult(as)));
  const D = Math.max(1, Math.floor(statsOf(content, defender)[dk] * stageMult(ds)));
  let dmg = Math.floor(Math.floor(Math.floor(2 * attacker.level / 5 + 2) * move.power * A / D) / 50) + 2;
  if (isCrit) dmg = Math.floor(dmg * 1.5);
  dmg = Math.floor(dmg * (roll ?? range(rand, 85, 100)) / 100);
  const stab = !!move.type && typesOf(content, attacker).includes(move.type);
  if (stab) dmg = Math.floor(dmg * 1.5);
  dmg = Math.floor(dmg * eff);
  if (physical && attacker.status === 'burn') dmg = Math.floor(dmg / 2);
  return { damage: Math.max(1, dmg), crit: isCrit, eff, stab };
}

// ---- capture ----
/** Catch value a and shake threshold b; probability of four shakes. */
export function captureOdds(content, creature, ballBonus = 1) {
  const maxHp = statsOf(content, creature).hp, hp = Math.max(1, creature.hp), rate = speciesOf(content, creature.species).catchRate ?? 45;
  const statusBonus = creature.status === 'sleep' || creature.status === 'freeze' ? 2.5 : creature.status ? 1.5 : 1;
  const a = Math.max(1, Math.floor((3 * maxHp - 2 * hp) * rate * ballBonus / (3 * maxHp) * statusBonus));
  const b = a >= 255 ? 65536 : Math.floor(1048560 / Math.sqrt(Math.sqrt(16711680 / a)));
  return { a, b, probability: a >= 255 ? 1 : (b / 65536) ** 4 };
}
export function attemptCapture(content, creature, ballBonus, rand) {
  const { a, b } = captureOdds(content, creature, ballBonus);
  if (a >= 255) return { shakes: 4, success: true };
  let shakes = 0;
  while (shakes < 4 && int(rand, 65536) < b) shakes++;
  return { shakes, success: shakes === 4 };
}

// ---- AI ----
export const usableMoves = c => c.moves.map((m, i) => (m.pp > 0 ? i : -1)).filter(i => i >= 0);
export function moveScore(content, attacker, defender, move) {
  if (!move?.power) return 0;
  const stab = move.type && typesOf(content, attacker).includes(move.type) ? 1.5 : 1;
  const hits = move.effect?.kind === 'multihit' ? (move.effect.min + move.effect.max) / 2 : 1;
  const acc = move.accuracy == null ? 1 : move.accuracy / 100;
  const st = statsOf(content, attacker), ratio = move.category === 'physical' ? st.atk / Math.max(1, st.spa) : st.spa / Math.max(1, st.atk);
  return move.power * hits * stab * effectiveness(content, move.type, typesOf(content, defender)) * acc * Math.min(1.25, Math.max(0.8, ratio));
}
function statusScore(content, side, foeSide, move) {
  const me = side.party[side.active], foe = foeSide.party[foeSide.active], e = move.effect;
  const acc = move.accuracy == null ? 1 : move.accuracy / 100;
  const foeHp = foe.hp / statsOf(content, foe).hp, myHp = me.hp / statsOf(content, me).hp;
  if (!e) return 0;
  if (e.kind === 'heal') return myHp < 0.4 ? 140 : 0;
  if (foeHp < 0.35) return 0;
  if (e.kind === 'status') { if (e.status === 'confusion') return foeSide.vol.confusion > 0 ? 0 : 40 * acc; return foe.status ? 0 : (e.status === 'sleep' || e.status === 'paralysis' ? 55 : 45) * acc; }
  if (e.kind === 'stat') { if (e.target === 'self') return (side.stages[e.stat] || 0) < 2 && myHp > 0.6 ? (e.stages > 0 ? 35 : 0) : 0; return (foeSide.stages[e.stat] || 0) > -2 && e.stages < 0 ? 28 * acc : 0; }
  return 0;
}
export function bestMove(content, side, foeSide, { statusMoves = true } = {}) {
  const me = side.party[side.active], foe = foeSide.party[foeSide.active], usable = usableMoves(me);
  if (!usable.length) return -1;
  let best = usable[0], bestScore = -1;
  for (const i of usable) {
    const move = moveOf(content, me.moves[i].id);
    const score = move.category === 'status' ? (statusMoves ? statusScore(content, side, foeSide, move) : 0) : moveScore(content, me, foe, move);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}
export function wildMove(me, rand) { const u = usableMoves(me); return u.length ? u[int(rand, u.length)] : -1; }
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

// ---- content validation (shared by party / battle preflight) ----
export function validateContent(content = {}) {
  const errors = [], sp = new Set((content.species || []).map(s => s.id)), mv = new Set((content.moves || []).map(m => m.id));
  // content.types is a chart ({ attacking: { defending: multiplier } }); a plain list of type names is a chart where every multiplier is 1.
  const types = Array.isArray(content.types) ? new Set(content.types.map(t => (typeof t === 'string' ? t : t?.id)).filter(t => typeof t === 'string'))
    : new Set([...Object.keys(content.types || {}), ...Object.values(content.types || {}).flatMap(o => Object.keys(o || {}))]);
  (content.species || []).forEach((s, i) => {
    const p = `content.species[${i}]`;
    if (!Array.isArray(s.types) || !s.types.length) errors.push({ code: 'species_invalid', path: `${p}.types`, message: 'species needs at least one type' });
    for (const k of STATS) if (!(s.base?.[k] >= 1 && s.base[k] <= 255)) errors.push({ code: 'species_invalid', path: `${p}.base.${k}`, message: `base ${k} must be 1..255` });
    if (s.growth && !GROWTH_K[s.growth]) errors.push({ code: 'species_invalid', path: `${p}.growth`, message: 'growth is fast|medium|slow' });
    (s.learnset || []).forEach((l, j) => { if (!mv.has(l.move)) errors.push({ code: 'ref_unknown', path: `${p}.learnset[${j}].move`, message: `unknown move '${l.move}'` }); if (!(l.level >= 1 && l.level <= 100)) errors.push({ code: 'species_invalid', path: `${p}.learnset[${j}].level`, message: 'learn level 1..100' }); });
    if (s.evolves && !sp.has(s.evolves.to)) errors.push({ code: 'ref_unknown', path: `${p}.evolves.to`, message: `unknown species '${s.evolves.to}'` });
    if (types.size) for (const t of s.types || []) if (!types.has(t)) errors.push({ code: 'type_unknown', path: `${p}.types`, message: `type '${t}' is not in content.types` });
  });
  (content.moves || []).forEach((m, i) => {
    const p = `content.moves[${i}]`;
    if (!['physical', 'special', 'status'].includes(m.category)) errors.push({ code: 'move_invalid', path: `${p}.category`, message: 'category is physical|special|status' });
    if (!(m.pp >= 1)) errors.push({ code: 'move_invalid', path: `${p}.pp`, message: 'pp must be >= 1' });
    if (m.category !== 'status' && !(m.power > 0)) errors.push({ code: 'move_invalid', path: `${p}.power`, message: 'damaging moves need power > 0' });
    if (m.effect && !EFFECT_KINDS.includes(m.effect.kind)) errors.push({ code: 'move_invalid', path: `${p}.effect.kind`, message: `effect kind is ${EFFECT_KINDS.join('|')}` });
    if (m.effect?.kind === 'status' && !STATUSES.includes(m.effect.status)) errors.push({ code: 'move_invalid', path: `${p}.effect.status`, message: `status is ${STATUSES.join('|')}` });
    if (m.effect?.kind === 'stat' && !STAGE_STATS.includes(m.effect.stat)) errors.push({ code: 'move_invalid', path: `${p}.effect.stat`, message: `stat is ${STAGE_STATS.join('|')}` });
    if (types.size && m.type && !types.has(m.type)) errors.push({ code: 'type_unknown', path: `${p}.type`, message: `type '${m.type}' is not in content.types` });
  });
  return errors;
}
