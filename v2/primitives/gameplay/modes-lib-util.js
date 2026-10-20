// Shared helpers for the modes workstream (vehicles, race, turns, cards, waves,
// rounds, stage.sequence, minigame, rts, automation, rewind, portal, sports).
// Pure functions over JSON; nothing here touches rt.state except through rt.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const v3 = a => [a?.[0] ?? 0, a?.[1] ?? 0, a?.[2] ?? 0];
export const add = (a, b) => a.map((v, i) => v + (b[i] ?? 0));
export const sub = (a, b) => a.map((v, i) => v - (b[i] ?? 0));
export const mul = (a, k) => a.map(v => v * k);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
export const len = a => Math.hypot(...a);
export const norm = a => { const l = len(a); return l ? a.map(v => v / l) : a.map(() => 0); };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Round to 1e-6 so JSON state stays compact; deterministic either way. */
export const r6 = x => Math.round(x * 1e6) / 1e6;
export const r6v = a => a.map(r6);
export const KMH = 1 / 3.6;
export const DEG = Math.PI / 180;
export const sign = x => (x > 0 ? 1 : x < 0 ? -1 : 0);
/** Move v toward target by at most step. */
export const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
export const wrapAngle = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * Entities are alive unless their health component (owned by combat.health)
 * reports hp <= 0 or dead. Missing entities are not alive.
 */
export function alive(e) {
  if (!e) return false;
  const h = e.components?.health;
  if (h && (h.dead || (typeof h.hp === 'number' && h.hp <= 0))) return false;
  return true;
}
/** Read hp and max through combat.health's documented fields. */
export function hpOf(e) {
  const h = e?.components?.health; if (!h) return { hp: 0, max: 0, frac: 0 };
  const max = h.max ?? h.hp ?? 0, hp = h.hp ?? max;
  return { hp, max, frac: max ? hp / max : 0 };
}
/** True when an entity matches a selector: its id, archetype or one of components.tags. */
export const matches = (e, sel) => Boolean(e) && (sel === e.id || sel === e.archetype || (Array.isArray(e.components?.tags) && e.components.tags.includes(sel)));
export const matchesAny = (e, sels = []) => sels.some(s => matches(e, s));
/** Entities sorted by id (deterministic iteration). */
export const sortedEntities = rt => Object.values(rt.state.entities).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
export const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const BIND_KEYS = new Set(['who', 'target', 'vehicle', 'by', 'of', 'with']);
/**
 * Substitute role names in an effect/predicate tree so third-party vocabulary
 * (combat's `damage{who}`, inventory's `give_item{who}`...) can address the
 * participants of a mode action. In `who`-like keys the bare words
 * 'target' | 'actor' | 'owner' are replaced; anywhere, '$target' / '$actor' /
 * '$owner' / '$self' are replaced. Kernel resolve() only knows 'player'/'self'
 * (see v2/kernel/requests/modes.md).
 */
export function bindRoles(tree, roles) {
  if (Array.isArray(tree)) return tree.map(t => bindRoles(t, roles));
  if (!tree || typeof tree !== 'object') return tree;
  const out = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') {
      if (v[0] === '$' && roles[v.slice(1)] !== undefined) out[k] = roles[v.slice(1)];
      else if (BIND_KEYS.has(k) && roles[v] !== undefined && (v === 'target' || v === 'actor' || v === 'owner')) out[k] = roles[v];
      else out[k] = v;
    } else out[k] = bindRoles(v, roles);
  }
  return out;
}
/** Run effects with role binding; context.self defaults to the actor. */
export function runBound(rt, effects, roles = {}, context = {}) {
  if (!effects?.length) return;
  rt.run(bindRoles(effects, roles), { self: roles.actor ?? roles.owner, ...context });
}

/** Capability probe on a space api. */
export const has = (api, ...methods) => Boolean(api) && methods.every(m => typeof api[m] === 'function');
export const spaceOf = (rt, e) => { try { return e?.space ? rt.space(e.space) : null; } catch { return null; } };

/**
 * Horizontal plane for continuous movers. 'xz' = 3D, y up (voxel, mesh3d);
 * 'xy' = 2D (top-down tilemaps, physics2d). 'auto' picks xz when the space has
 * the surface capability and positions are 3-vectors.
 */
export function planeFor(pref, api, e) {
  if (pref === 'xz' || pref === 'xy') return pref;
  return has(api, 'groundAt') && Array.isArray(e.at) && e.at.length === 3 ? 'xz' : 'xy';
}
/** Plane coordinates (u, w) of a position. */
export const planeUW = (plane, at) => (plane === 'xz' ? [at[0] ?? 0, at[2] ?? 0] : [at[0] ?? 0, at[1] ?? 0]);
/** 3D delta from a plane delta plus vertical. */
export const fromPlane = (plane, du, dw, dy = 0, dims = 3) => (plane === 'xz' ? [du, dy, dw] : dims === 2 ? [du, dw] : [du, dw, 0]);

/** Euclidean distance through the space when it can measure, else direct. */
export function dist(rt, a, b) {
  if (!a || !b) return Infinity;
  if (a.space && b.space && a.space !== b.space) return Infinity;
  const api = spaceOf(rt, a);
  if (has(api, 'distance')) return api.distance(a.at, b.at);
  if (Array.isArray(a.at) && Array.isArray(b.at)) return len(sub(v3(a.at), v3(b.at)));
  return a.at === b.at ? 0 : Infinity;
}

/** Stable key for a cell. */
export const cellKey = c => v3(c).map(Math.floor).join(',');
export const keyCell = k => k.split(',').map(Number);

/** Ensure a var path is published for the player. */
export const setVar = (rt, name, value) => { rt.state.vars[name] = value; };

/** Simple error helper for validate(). */
export const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

/** Find systems instances of a primitive in a document. */
export const instancesOf = (doc, use) => (doc.systems || []).map((s, i) => ({ s, i })).filter(x => x.s.use === use);

/** Check a fixed-field effect: push effect_invalid when required fields are missing. */
export function needFields(e, fields, path, errors) {
  for (const f of fields) if (e[f] === undefined || e[f] === null || e[f] === '') errors.push({ code: 'effect_invalid', path, message: `'${e.do}' needs '${f}'` });
}
