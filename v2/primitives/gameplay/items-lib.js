// Shared helpers for the items workstream (KERNEL_API.md §7: helpers prefixed
// with the area). Item lookups and tag tokens, deterministic rolls, entity
// geometry through space capabilities, and optional cross-primitive effects
// (run only when their owner registered them).
import { spaceFrame } from '../engine/runtime-lib-frame.js';

/** A map from a stat (or damage type) to a number. */
const NUMBERS = { type: 'object', values: { type: 'number' } };
/**
 * The fields of content.items entries the items and combat primitives read (ARCHITECTURE §1.4: each card declares the
 * parts of a section it reads, card.data, over the kernel's base { id, name }). One declaration per field, so every card
 * reading a field declares it the same way: a card's data picks the fields its code reads (itemsData).
 */
export const ITEM = Object.freeze({
  kind: { type: 'string', effect: 'what the item is: a token accepts, buys and recipes match (weapon, tool, food...)' },
  tags: { type: 'list', of: { type: 'string' }, effect: 'tokens accepts, buys and tag recipe inputs match' },
  value: { type: 'number', min: 0, effect: 'base price' },
  block: { type: 'ref', to: 'block', effect: 'the block it places' },
  stack: { type: 'integer', min: 1, effect: 'items per inventory stack' },
  tool: { type: 'object', fields: { kind: { type: 'string', effect: 'tool kind (tool:<kind> token)' }, durability: { type: 'number', min: 0 } }, effect: 'a tool' },
  ingredient: { type: 'object', fields: { tags: { type: 'list', of: { type: 'string' }, effect: 'tokens tag recipe inputs match' } }, effect: 'a crafting ingredient' },
  weapon: { type: 'object', fields: {
    damage: { type: 'number', min: 0 }, reach: { type: 'number', min: 0 }, arc: { type: 'number', min: 0, max: 360, unit: 'deg' }, speed: { type: 'number', min: 0, effect: 'swing speed (1 = normal; below 0.2 counts as 0.2)' },
    combo: { type: 'integer', min: 1, effect: 'light hits in its combo' }, stamina: { type: 'number', min: 0 }, type: { type: 'string', effect: 'damage type' }, durability: { type: 'number', min: 0 },
  }, effect: 'a melee weapon (gameplay.combat.melee builds its moveset)' },
  ranged: { type: 'object', fields: {
    speed: { type: 'number', min: 0 }, gravity: { type: 'number' }, spread: { type: 'number', min: 0, unit: 'deg' }, damage: { type: 'number', min: 0 }, type: { type: 'string', effect: 'damage type' },
    draw: { type: 'number', min: 0, unit: 's', effect: 'charge time for full power' }, rate: { type: 'number', min: 0, unit: '/s' }, life: { type: 'number', min: 0, unit: 's' }, radius: { type: 'number', min: 0 },
    ammo: { type: 'ref', to: 'item', effect: 'the item each shot spends' }, projectile: { type: 'ref', to: 'archetype', effect: 'the archetype of its shots' },
  }, effect: 'a ranged weapon (gameplay.combat.projectile fires it)' },
  armor: { type: 'object', fields: { slot: { type: 'string', effect: 'armor:<slot> token' }, def: { ...NUMBERS, effect: 'damage type -> defense' }, durability: { type: 'number', min: 0 } }, effect: 'armor' },
  charm: { type: 'object', fields: { mods: { ...NUMBERS, effect: 'stat -> modifier while worn' }, cost: { type: 'number', min: 0, effect: 'budget it costs worn' } }, effect: 'a charm' },
  stats: { ...NUMBERS, effect: 'stat -> modifier while worn' },
  durability: { type: 'number', min: 0, effect: 'uses before it breaks (with equipment durability)' },
  cost: { type: 'number', min: 0, effect: 'budget it costs worn (charms use charm.cost)' },
  use: { type: 'object', fields: {
    fx: { type: 'effects', required: true, effect: 'what using it does (self = the user)' }, cooldown: { type: 'number', min: 0, unit: 's' }, consume: { type: 'boolean', effect: 'using it spends one (default true)' },
    when: { type: 'predicate', effect: 'usable only while it holds' }, group: { type: 'string', effect: 'items of one group share a cooldown' },
  }, effect: 'a usable item (gameplay.item.use)' },
  creature: { type: 'object', fields: { kind: { type: 'string', options: ['ball', 'heal', 'status', 'revive'], required: true, effect: 'ball catches; heal restores hp; status cures; revive brings a fainted creature back' }, value: { type: 'number', min: 0, effect: 'catch bonus (ball), hp or hp fraction <= 1 (heal, revive)' } }, effect: 'a creature-battle item' },
});
/** The card.data of a card that reads these content.items fields. @param {Array<keyof typeof ITEM>} fields */
export const itemsData = fields => ({ 'content.items': { type: 'list', of: { type: 'object', open: true, fields: Object.fromEntries(fields.map(f => [f, ITEM[f]])) } } });

/** Item definitions by id, re-indexed whenever rt.doc changes (hot-loaded items appear). */
export function items(rt) {
  const c = rt.caches;
  if (c.itemsDoc !== rt.doc) { c.itemsDoc = rt.doc; c.items = new Map((rt.doc.content?.items || []).map(i => [i.id, i])); }
  return c.items;
}
export const item = (rt, id) => items(rt).get(id);

/**
 * Tokens an item answers to in `accepts`, `buys` and tag-based recipe inputs:
 * its id, kind, tags, ingredient tags, `armor:<slot>`, `tool:<kind>`, `charm`, `block`, and `*`.
 */
export function tokens(def) {
  if (!def) return new Set(['*']);
  const t = new Set(['*', def.id, def.kind, ...(def.tags || []), ...(def.ingredient?.tags || [])]);
  if (def.armor?.slot) { t.add('armor'); t.add(`armor:${def.armor.slot}`); }
  if (def.tool) { t.add('tool'); if (def.tool.kind) t.add(`tool:${def.tool.kind}`); }
  if (def.weapon && def.kind === 'weapon') t.add('weapon');
  if (def.charm) t.add('charm');
  if (def.block) t.add('block');
  return t;
}
export const matches = (def, accepts) => { const t = tokens(def); return (accepts || []).some(a => t.has(a)); };

/** Integer in [a, b] from rt.random(); a number n means exactly n. */
export function roll(rt, range, fallback = 1) {
  if (range == null) return fallback;
  if (typeof range === 'number') return range;
  const [a, b] = range; return a + Math.floor(rt.random() * (b - a + 1));
}
/** Weighted pick over entries with `weight` (default 1); null when total weight is 0. */
export function pick(rt, entries) {
  const total = entries.reduce((s, e) => s + (e.weight ?? 1), 0);
  if (total <= 0) return null;
  let r = rt.random() * total;
  for (const e of entries) { r -= e.weight ?? 1; if (r < 0) return e; }
  return entries[entries.length - 1];
}

/** Bag / entity key for an effect's `who`: undefined|'player' -> 'player', 'self' -> context.self, else the id. */
export const whoKey = (who, context = {}) => (who == null || who === 'player' ? 'player' : who === 'self' ? context.self ?? 'player' : who);

/** Optional vocabulary owned by other primitives: usable only when its owner is installed (rt.canRun / rt.canTest). */
export const hasEffect = (rt, kind) => rt.canRun(kind);
export const hasPredicate = (rt, kind) => rt.canTest(kind);
/** Run `effect` only if its owner is installed; returns whether it ran. */
export function runIf(rt, effect, context) {
  if (!rt.canRun(effect.do)) return false;
  rt.run([effect], context); return true;
}
/** Test `pred` when every predicate kind in it can be tested; otherwise return `fallback`. */
export function testIf(rt, pred, context, fallback = false) {
  const ok = p => { if (!p || typeof p !== 'object') return false; const k = rt.logic.kindOf(p); if (!k || !rt.canTest(k)) return false; return k === 'all' || k === 'any' ? p[k].every(ok) : k === 'not' ? ok(p.not) : true; };
  return ok(pred) ? rt.test(pred, context) : fallback;
}

/** Add score through gameplay.score's add_score when present, else the `score` var. */
export function addScore(rt, points, context) {
  if (!points) return;
  if (!runIf(rt, { do: 'add_score', amount: points }, context)) rt.state.vars.score = (rt.state.vars.score ?? 0) + points;
}

/** Heal to full and refill every published resource pool for `who` (rest, checkpoints). */
export function restoreAll(rt, who = 'player', { resources = true } = {}) {
  const v = rt.state.vars;
  if (who === 'player' && v['hp.max'] != null) { const need = v['hp.max'] - (v.hp ?? 0); if (need > 0) runIf(rt, { do: 'heal', who, amount: need }); }
  else runIf(rt, { do: 'heal', who, amount: 1e9 });
  if (resources && who === 'player') for (const k of Object.keys(v)) {
    const m = /^res\.([^.]+)\.max$/.exec(k); if (!m) continue;
    const need = v[k] - (v[`res.${m[1]}`] ?? 0);
    if (need > 0) runIf(rt, { do: 'gain', resource: m[1], amount: need });
  }
}

// ---- geometry through space capabilities ----
export const isVec = a => Array.isArray(a);
export const v3 = a => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
export const add = (a, b) => v3(a).map((x, i) => x + (v3(b)[i] ?? 0));
export const sub = (a, b) => v3(a).map((x, i) => x - (v3(b)[i] ?? 0));
export const len = a => Math.hypot(...v3(a));
export const norm = a => { const l = len(a) || 1; return v3(a).map(x => x / l); };
export const dot = (a, b) => v3(a).reduce((s, x, i) => s + x * v3(b)[i], 0);
export const api = (rt, e) => (e?.space && rt.spaces().includes(e.space) ? rt.space(e.space) : null);
export const pos = (rt, e) => { const s = api(rt, e); return s ? s.pos(e) : e?.at; };
/** Where a space anchors entity positions in components.body.size: 'min' corner (testSpace) or 'center' (api.anchor). */
export const anchor = (rt, spaceId) => (spaceId && rt.spaces().includes(spaceId) ? rt.space(spaceId).anchor ?? 'min' : 'min');
/** Body extents; like the kernel's bodyBox, an entity without body.size is one unit along each axis of its position (flat on missing axes). */
export const sizeOf = e => v3(e.components?.body?.size || (isVec(e?.at) ? e.at.map(() => 1) : [0, 0, 0]));
/** Set an entity's velocity through the space's dynamics capability, else components.body.vel. */
export function setVelocity(rt, e, v) {
  const s = api(rt, e), n = isVec(e.at) ? e.at.length : 3, vel = v3(v).slice(0, n).map(x => +x.toFixed(6));
  if (s && typeof s.setVelocity === 'function') s.setVelocity(e, vel, rt);
  else (e.components.body ??= {}).vel = vel;
}
/** Current velocity (dynamics capability, else components.body.vel, else zero), padded to 3D. */
export function velocity(rt, e) {
  const s = api(rt, e), v = s && typeof s.velocity === 'function' ? s.velocity(e, rt) : e.components?.body?.vel;
  return v3(Array.isArray(v) ? v : [0, 0, 0]);
}
/** World box {min, max} of a box of `size` positioned at `at` in a space (anchor-aware). */
export function boxAt(rt, spaceId, at, size = [0, 0, 0]) {
  const s = v3(size), a = v3(at), min = anchor(rt, spaceId) === 'center' ? a.map((x, i) => x - s[i] / 2) : a;
  return { min, max: min.map((x, i) => x + s[i]) };
}
/** World box of an entity (array positions only). */
export const boxOf = (rt, e) => boxAt(rt, e.space, pos(rt, e), sizeOf(e));
/** Box centre of an entity; opaque positions are returned as-is. */
export function center(rt, e) { const p = pos(rt, e); if (!isVec(p)) return p; const b = boxOf(rt, e); return b.min.map((x, i) => (x + b.max[i]) / 2); }
/** Position that puts an entity's box min corner at `min` (anchor-aware), trimmed to the entity's dimensionality. */
export function posForMin(rt, e, min) { const p = anchor(rt, e.space) === 'center' ? v3(min).map((x, i) => x + sizeOf(e)[i] / 2) : v3(min); return isVec(e.at) ? p.slice(0, Math.max(e.at.length, 2)) : p; }
/** Distance between entities of the same space; opaque positions (graph nodes) are 0 when equal, else Infinity. */
export function dist(rt, a, b) {
  if (!a || !b || a.space !== b.space) return Infinity;
  const pa = pos(rt, a), pb = pos(rt, b);
  if (!isVec(pa) || !isVec(pb)) return pa === pb ? 0 : Infinity;
  return len(sub(center(rt, a), center(rt, b)));
}
/** Distance from an entity's centre to a point (array positions only). */
export function distTo(rt, e, at) { const p = pos(rt, e); return isVec(p) && isVec(at) ? len(sub(center(rt, e), at)) : (p === at ? 0 : Infinity); }
/** Half-open overlap per axis; a zero-extent side is a point (inside when min <= p < max). Axes where both are flat count as overlapping when equal. */
const span = (a0, a1, b0, b1, eps) => a0 === a1 && b0 === b1 ? Math.abs(a0 - b0) <= eps : a0 === a1 ? a0 >= b0 - eps && a0 < b1 + eps : b0 === b1 ? b0 >= a0 - eps && b0 < a1 + eps : a0 < b1 + eps && b0 < a1 + eps;
export const boxesTouch = (a, b, eps = 0) => a.min.every((m, i) => span(m, a.max[i], b.min[i], b.max[i], eps));
/** Entities whose box touches the world box {min, max} in a space (anchor-aware; zero-size entities are points). */
export function inBox(rt, spaceId, box, filter = () => true) {
  const out = [];
  for (const e of Object.values(rt.state.entities)) if (e.space === spaceId && isVec(e.at) && filter(e) && boxesTouch(boxOf(rt, e), box)) out.push(e.id);
  return out;
}
/** Move an entity toward a point by at most `step` (magnets); array positions only. */
export function pull(rt, e, to, step) {
  const s = api(rt, e), p = pos(rt, e); if (!s || !isVec(p)) return;
  const d = sub(to, center(rt, e)), l = len(d); if (l < 1e-6) return;
  s.setPos(e, add(p, d.map(x => x / l * Math.min(step, l))).slice(0, p.length), rt);
}
/** Unit facing vector from components.body.facing (vector, or ±1 along x for side views); null if unknown. */
export function facing(e) {
  const f = e?.components?.body?.facing;
  if (isVec(f)) return norm(f);
  if (typeof f === 'number' && f) return [Math.sign(f), 0, 0];
  return null;
}
/** Hostile = archetype kind enemy|boss or components.hostile (used by rest safety checks). */
export function hostile(rt, e) { return e.id !== 'player' && (e.components.hostile === true || ['enemy', 'boss'].includes(rt.archetype(e.archetype)?.kind)); }

/** Entity a `who`/target string names: an entity id, else the first entity of that archetype. */
export function entityByRef(rt, ref, context) {
  const e = rt.resolve(ref, context); if (e) return e;
  return Object.values(rt.state.entities).find(x => x.archetype === ref) || null;
}

// ---- cells (editCells + raycast spaces) ----
export const cellKey = c => c.join(',');
export const cellOf = at => v3(at).map(Math.floor);
/** The point to look an entity's own cell up with getCell: its box centre cell on min-anchored spaces, else its position (cell and centre anchors round/floor it themselves). */
export function cellPoint(rt, e) { const p = pos(rt, e); return anchor(rt, e.space) === 'min' ? center(rt, e).map(Math.floor) : v3(p).slice(0, p.length); }
/** Look direction: components.body.look, else facing; null if neither. */
export function lookDir(e) { const l = e?.components?.body?.look; return isVec(l) ? norm(l) : faceDir(e); }
/**
 * The direction an entity faces: body.dir (movement keeps the full direction there; in 2D body.facing is only the
 * ±1 of x), else body.facing.
 */
export function faceDir(e) { const d = e?.components?.body?.dir; return isVec(d) && len(d) > 1e-6 ? norm(d) : facing(e); }
/** Views that look at the world from above or behind the player (the faced cell is in front), not from the side. */
const FRONT_VIEWS = new Set(['td', 'board', 'iso', '1p', '3p']);
/**
 * The cell a ground verb acts on when it names none (farming's till, plant, water, harvest), from the space's frame
 * (runtime-lib-frame.js) and the document's view: in a plane seen from above (frame.up null) the cell the player faces;
 * with an up axis, below the feet in a side view and the ground cell in front in the views from above or behind. Pure.
 * @param {{ up: number | null } | null} frame @param {string | undefined} view @param {number[]} feet @param {number[] | null} dir
 */
export function actionCellAt(frame, view, feet, dir) {
  if (!frame) return null;
  const up = frame.up, f = v3(feet), front = () => {
    if (!dir) return null;
    const axes = [0, 1, 2].filter(i => i !== up && (up !== null || i < 2)), d = v3(dir);
    const i = axes.reduce((m, k) => (Math.abs(d[k]) > Math.abs(d[m]) ? k : m), axes[0]);
    if (Math.abs(d[i]) < 1e-6) return null;
    const step = [0, 0, 0]; step[i] = Math.sign(d[i]); return step;
  };
  if (up === null || up === undefined) { const s = front(); return s ? add(f, s) : null; }
  const down = [0, 0, 0]; down[up] = -1;
  if (!FRONT_VIEWS.has(view)) return add(f, down);
  const s = front(); return s ? add(add(f, s), down) : null;
}
/** The cell an entity's ground verbs act on now (actionCellAt over its space's frame, the document's view, its feet and facing). */
export function actionCell(rt, e) {
  const p = center(rt, e); if (!isVec(p)) return null;
  return actionCellAt(spaceFrame(rt, e.space), rt.doc.views?.primary, p.map(Math.floor), faceDir(e));
}
/** Eye point: box centre raised by components.body.eye (default 0). */
export function eyeOf(rt, e) { const c = center(rt, e); return isVec(c) ? add(c, [0, e.components?.body?.eye ?? 0, 0]) : c; }
/** The cell an entity looks at within reach: { cell, normal } or null (raycast capability). */
export function lookCell(rt, e, reach) {
  const s = api(rt, e), dir = lookDir(e);
  if (!s || typeof s.raycast !== 'function' || !dir) return null;
  const hit = s.raycast(eyeOf(rt, e), dir, reach);
  return hit?.hit === 'cell' && hit.cell ? { cell: v3(hit.cell), normal: (hit.normal || [0, 0, 0]).map(Math.round) } : null;
}
/** Distance from an entity's eye to a cell's centre. */
export const cellDist = (rt, e, cell) => len(sub(eyeOf(rt, e), add(cell, [0.5, 0.5, 0.5])));
/** Blocks by id (content.blocks), re-indexed when rt.doc changes. */
export function blocks(rt) {
  const c = rt.caches;
  if (c.blocksDoc !== rt.doc) { c.blocksDoc = rt.doc; c.blocks = new Map((rt.doc.content?.blocks || []).map(b => [b.id, b])); }
  return c.blocks;
}

/** Push a param-style error for list entries with duplicate ids. */
export function uniqueIds(list, path, errors, what = 'entry') {
  const seen = new Set();
  (list || []).forEach((x, i) => { if (seen.has(x.id)) errors.push({ code: 'id_duplicate', path: `${path}[${i}].id`, message: `duplicate ${what} id '${x.id}'` }); seen.add(x.id); });
}
/** Error helper: unknown item id in content (refs checked by the kernel only for card params). */
export function checkItem(doc, id, path, errors) {
  if (id == null) return;
  if (!(doc.content?.items || []).some(i => i.id === id)) errors.push({ code: 'ref_unknown', path, message: `unknown item '${id}'` });
}
