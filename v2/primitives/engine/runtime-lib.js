// Shared helpers for the engine runtime primitives (engine.time, spawner,
// zones, portal, physics.*...). Everything here is space-agnostic: positions
// are whatever the entity's space uses (`At`), and every spatial question is
// asked through the space's capability methods, never by assuming a geometry.
import { bodyBox } from '../../kernel/testing.js';
import { Logic } from '../../kernel/logic.js';

export const FPS = 60;

/**
 * The body component (KERNEL_API §2, owned by the engine physics primitives: engine.physics.body, .character and
 * .rigid declare this one shape): the shared kinematic fields every space and movement primitive reads, and the
 * material and controller fields the physics primitives read. Open: a space adds fields of its own (physics2d's shape).
 * `facing` (+1/-1 in 2D, a vector in 3D) has no single type in the params dialect and is not declared.
 */
export const BODY = Object.freeze({ type: 'object', open: true, effect: 'kinematics and collision of a body (spaces with dynamics keep it current)', fields: {
  size: { type: 'list', of: { type: 'number', min: 0 }, min: 1, max: 3, effect: 'box extents per axis' },
  vel: { type: 'list', of: { type: 'number' }, max: 3, effect: 'velocity per axis' },
  grounded: { type: 'boolean', effect: 'standing on something (spaces keep it current)' },
  layer: { type: 'string', effect: 'collision layer: one of engine.physics.body layers' },
  solid: { type: 'boolean', effect: "true: other bodies' slide treats this entity as an obstacle (doors, crates); false: an opened obstacle" },
  oneWay: { type: 'boolean', effect: 'solid from above only' },
  sensor: { type: 'boolean', effect: 'reports contacts, never pushes' },
  static: { type: 'boolean', effect: 'never moved by contacts' },
  mass: { type: 'number', min: 0, effect: 'share of push-apart and impulses (default 1)' },
  friction: { type: 'number', min: 0, max: 2, effect: 'surface friction (default engine.physics.body friction)' },
  restitution: { type: 'number', min: 0, max: 1, effect: 'bounciness (default engine.physics.body restitution)' },
  controller: { type: 'string', effect: "who integrates the body: 'character' (engine.physics.character), 'move' (a movement primitive owns integration)" },
  character: { type: 'object', effect: 'per-entity overrides of engine.physics.character', fields: {
    radius: { type: 'number', min: 0.01, max: 50, unit: 'm' }, height: { type: 'number', min: 0.01, max: 100, unit: 'm' }, stepHeight: { type: 'number', min: 0, max: 10, unit: 'm' },
    slopeLimit: { type: 'number', min: 0, max: 89, unit: 'deg' }, gravityScale: { type: 'number', min: 0, max: 10 }, maxFall: { type: 'number', min: 0.1, max: 1000, unit: 'm/s' },
  } },
  tags: { type: 'list', of: { type: 'string' }, effect: 'classes space rules match (grid rules appliesTo/except)' },
  gravityScale: { type: 'number', min: 0, max: 10, effect: "multiplier on the space's gravity" },
} });
/** Seconds to whole frames (never negative). */
export const frames = sec => Math.max(0, Math.round((sec || 0) * FPS));
export const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const isVec = v => Array.isArray(v) && v.length > 0 && v.every(Number.isFinite);
export const v3 = a => [a?.[0] ?? 0, a?.[1] ?? 0, a?.[2] ?? 0];
export const round = (v, p = 1e4) => Math.round(v * p) / p;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
/** Integer in [lo, hi] from a [lo, hi] pair (or a single number). */
export const rollRange = (range, random) => { if (!Array.isArray(range)) return range ?? 0; const [lo, hi = lo] = range; return lo + Math.floor(random() * (hi - lo + 1)); };

/** Find a static zone definition: { space, zone } or null. */
export function zoneDef(doc, id) {
  for (const s of doc.spaces || []) { const z = (s.zones || []).find(x => x.id === id); if (z) return { space: s.id, zone: z }; }
  return null;
}

/** Area of a zone from its document shape (rect, bounds, center+r); null when the shape is unknown. */
export function zoneArea(z) {
  if (Array.isArray(z?.rect)) return Math.abs((z.rect[2] - z.rect[0]) * (z.rect[3] - z.rect[1]));
  if (z?.bounds?.min && z?.bounds?.max) { const a = z.bounds.min, b = z.bounds.max; return a.length >= 3 ? Math.abs((b[0] - a[0]) * (b[2] - a[2])) : Math.abs((b[0] - a[0]) * (b[1] - a[1])); }
  if (Number.isFinite(z?.r)) return Math.PI * z.r * z.r;
  return null;
}

/** A uniformly random point inside a zone's document shape, in the zone's own coordinates; null when unknown. */
export function samplePoint(z, random) {
  if (Array.isArray(z?.rect)) { const [x0, y0, x1, y1] = z.rect; return [x0 + random() * (x1 - x0), y0 + random() * (y1 - y0)]; }
  if (z?.bounds?.min && z?.bounds?.max) return z.bounds.min.map((lo, i) => lo + random() * (z.bounds.max[i] - lo));
  if (isVec(z?.center) && Number.isFinite(z.r)) { const a = random() * Math.PI * 2, d = Math.sqrt(random()) * z.r; const p = z.center.slice(); p[0] += Math.cos(a) * d; p[1] += Math.sin(a) * d; return p; }
  return null;
}

/** Jitter a vector point inside a radius on its first two axes (deterministic via random). */
export function scatter(at, spread, random) {
  if (!isVec(at) || !spread) return at;
  const a = random() * Math.PI * 2, d = Math.sqrt(random()) * spread, p = at.slice();
  p[0] += Math.cos(a) * d; if (p.length >= 3) p[2] += Math.sin(a) * d; else p[1] += Math.sin(a) * d;
  return p;
}

/**
 * Is entity `e` inside region `r` = { space?, zone?, at?, size?, r? }?
 * - `at` with `size`/`r`: the space's `overlap` (aabb/sphere), else `distance` <= r;
 * - `at` without a vector position (graph spaces): the entity is at that location;
 * - only `zone`: the space's `inZone`.
 */
export function inRegion(rt, e, r, radius = 1) {
  if (!e?.space || (r.space && r.space !== e.space)) return false;
  const api = rt.space(e.space);
  if (r.at !== undefined && r.at !== null) {
    if (!isVec(r.at) || !isVec(e.at)) return e.at === r.at;
    if (api.overlap && (isVec(r.size) || Number.isFinite(r.r))) {
      const shape = isVec(r.size) ? { kind: 'aabb', at: r.at, size: r.size } : { kind: 'sphere', at: r.at, r: r.r };
      return api.overlap(shape, x => x.id === e.id).includes(e.id);
    }
    if (api.distance) return api.distance(e.at, r.at) <= (r.r ?? (isVec(r.size) ? Math.max(...r.size) / 2 : radius));
    return false;
  }
  if (r.zone) return Boolean(api.inZone?.(e, r.zone, rt));
  return false;
}

/** Facing sign of an entity (+1 / -1) from components.body.facing (number, or a vector's x). */
export function facingSign(e) {
  const f = e?.components?.body?.facing;
  const x = Array.isArray(f) ? f[0] : f;
  return Number.isFinite(x) && x < 0 ? -1 : 1;
}

/**
 * Axis-aligned box of a body, honoring the space's anchor (KERNEL_API §3:
 * 'center' for continuous spaces, 'min' for the test space, 'cell'/'slot'
 * otherwise). Delegates to the kernel's bodyBox.
 */
export const boxOf = (api, e) => bodyBox(e, api);
/** The overlap shape covering a body's box (min corner + size, not centred). */
export const boxShape = (api, e) => { const b = bodyBox(e, api); return { kind: 'aabb', at: b.min, size: b.max.map((v, i) => v - b.min[i]), centered: false }; };

/** Validate a list of effects / a predicate stored in a param of type json (or nested data). */
export function checkFx(list, path, errors, ctx) {
  if (list === undefined) return;
  if (!Array.isArray(list)) { errors.push({ code: 'param_type', path, message: 'must be a list of effects' }); return; }
  list.forEach((e, i) => ctx.checkEffect(e, `${path}[${i}]`, errors));
}

/** Push an error unless every id in `list` is unique; returns the set. */
export function uniqueIds(list, path, code, errors) {
  const seen = new Set();
  (list || []).forEach((x, i) => { if (seen.has(x.id)) errors.push({ code, path: `${path}[${i}].id`, message: `duplicate id '${x.id}'` }); seen.add(x.id); });
  return seen;
}

// Vocabulary registered by the primitives of a preflight's registry (built once per registry).
const vocab = new WeakMap();
const logicOf = registry => { let l = vocab.get(registry); if (!l) { l = new Logic(); for (const id of registry.ids()) registry.get(id).logic?.(l); vocab.set(registry, l); } return l; };
/** True when an effect / predicate kind is registered by some primitive in this preflight's catalogue. */
export const hasEffect = (ctx, kind) => logicOf(ctx.registry).effects.has(kind);
export const hasPredicate = (ctx, kind) => logicOf(ctx.registry).predicates.has(kind);

/** Per-step context that a primitive can run effect lists with, carrying `self`. */
export const ctxOf = (self, extra = {}) => ({ self: self ?? undefined, ...extra });

/**
 * space.slide plus contact closing: on each blocked axis, retry halved moves so
 * bodies come to rest against surfaces even in spaces whose slide is
 * all-or-nothing per axis. Returns the first slide's result with `blocked`
 * kept and `grounded` refreshed.
 */
export function sweep(api, e, delta, rt, opts, halvings = 8) {
  const r = api.slide(e, delta, rt, opts);
  const names = ['x', 'y', 'z'];
  for (let i = 0; i < delta.length && i < 3; i++) {
    if (!r.blocked?.[names[i]] || !delta[i]) continue;
    let step = delta[i];
    for (let k = 0; k < halvings; k++) { step /= 2; const d = delta.map(() => 0); d[i] = step; api.slide(e, d, rt); }
  }
  return { ...r, grounded: api.grounded ? api.grounded(e) : r.grounded };
}
