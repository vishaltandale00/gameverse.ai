// Shared helpers for the plot story primitives (plot.character, plot.dialogue,
// plot.quest, plot.gate, plot.ending, plot.cutscene, plot.relationship,
// plot.journal, plot.barks, plot.events.random, plot.investigation).
// Nothing here holds state: everything that must survive a snapshot lives in
// rt.store(<primitive id>), and derived indexes are rebuilt per rt.doc.

export const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

/** Derived data cached per document version (hot-loaded content rebuilds it). Never JSON state. */
export function cached(rt, key, build) {
  const c = rt.caches[key];
  if (c && c.doc === rt.doc) return c.value;
  const value = build(rt.doc);
  rt.caches[key] = { doc: rt.doc, value };
  return value;
}

/** zone id -> { space, zone } for every space in the document. */
export function zoneIndex(doc) {
  const out = new Map();
  for (const s of doc.spaces || []) for (const z of s.zones || []) out.set(z.id, { space: s.id, zone: z });
  return out;
}

export const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/** Validate a list of effects (or report a type error). */
export function checkEffects(list, path, errors, ctx) {
  if (list === undefined) return;
  if (!Array.isArray(list)) { errors.push(err('param_type', path, 'must be a list of effects')); return; }
  list.forEach((e, i) => ctx.checkEffect(e, `${path}[${i}]`, errors));
}
export function checkPred(p, path, errors, ctx) { if (p !== undefined) ctx.checkPredicate(p, path, errors); }

/** Report unknown keys of a data record against an allowed set. */
export function checkKeys(record, allowed, path, errors, code = 'field_unknown') {
  for (const k of Object.keys(record || {})) if (!allowed.includes(k)) errors.push(err(code, `${path}.${k}`, `unknown field '${k}'`, `known: ${allowed.join(', ')}`));
}

/** True when the id is defined for a kind (or the kind is not indexed by any registered primitive). */
export const hasRef = (ctx, kind, id) => !ctx.indexes?.[kind] || ctx.indexes[kind].has(id);
export function checkRef(ctx, kind, id, path, errors) {
  if (typeof id !== 'string') { errors.push(err('param_type', path, `must be a ${kind} id`)); return; }
  if (!hasRef(ctx, kind, id)) errors.push(err('ref_unknown', path, `unknown ${kind} '${id}'`, `defined: ${[...(ctx.indexes[kind] || [])].slice(0, 20).join(', ') || 'none'}`));
}

/** Liveness of an entity as far as plot is concerned: present and not reported dead by its health component. */
export function entityAlive(e) {
  if (!e) return false;
  const h = e.components?.health;
  if (h && typeof h === 'object') { if (h.dead) return false; for (const k of ['hp', 'current', 'value']) if (typeof h[k] === 'number' && h[k] <= 0) return false; }
  return true;
}

/** Distance from entity a to entity b through a's space; null when not comparable. Graph spaces measure hops. */
export function entityDistance(rt, a, b) {
  if (!a || !b || a.space !== b.space || !a.space) return null;
  let api; try { api = rt.space(a.space); } catch { return null; }
  if (api.nearest) { const d = api.nearest(a, b.id, rt); if (d !== null && d !== undefined) return d; }
  if (api.distance && a.at != null && b.at != null) { const d = api.distance(a.at, b.at); return Number.isFinite(d) ? d : null; }
  return null;
}

/** Deep walk calling fn(value, path, parentKey) for every object/array node. */
export function walk(value, fn, path = '', key = null) {
  if (!value || typeof value !== 'object') return;
  fn(value, path, key);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, fn, `${path}[${i}]`, key));
  else for (const [k, v] of Object.entries(value)) walk(v, fn, path ? `${path}.${k}` : k, k);
}

/** Every effect object ({do: string}) anywhere in the document, with its path. */
export function allEffects(doc) {
  const out = [];
  walk(doc, (v, path) => { if (isObj(v) && typeof v.do === 'string') out.push({ e: v, path }); });
  return out;
}

/** Ticks needed for `seconds` at the runtime step. */
export const ticks = (rt, seconds) => Math.max(0, Math.ceil((seconds || 0) / rt.dt - 1e-9));

/** Number of player-facing seconds a line of text takes at `cps` characters per second (0 = instant). */
export const readSeconds = (text, cps) => (cps > 0 ? String(text || '').length / cps : 0);

/** Look up an optional service without throwing. */
export const service = (rt, name) => (rt.hasService(name) ? rt.service(name) : null);

/** Weighted pick using rt.random() (deterministic). items: [{weight}] */
export function weightedPick(rt, items) {
  if (items.length === 1) return items[0];
  const total = items.reduce((s, x) => s + Math.max(0, x.weight ?? 1), 0);
  if (!(total > 0)) return null;
  let r = rt.random() * total;
  for (const x of items) { r -= Math.max(0, x.weight ?? 1); if (r < 0) return x; }
  return items[items.length - 1];
}
