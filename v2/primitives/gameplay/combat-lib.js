// Shared helpers for the combat workstream (gameplay.combat.*, resource, element,
// vision.mode, death, score, powerup, ability.active). Pure functions over rt and
// plain JSON entities; nothing here keeps state outside rt.state / rt.caches.
//
// Conventions every combat primitive follows:
// - Time inside the simulation is counted in frames (60 per second); card params
//   are in seconds or milliseconds, as their units say, and converted with frames().
// - Positions are the space's `At` (entity.at). Hit shapes are built relative to
//   it, so the same move works in side, top-down and 3D spaces.
// - Facing comes from components.body.facing: a number (side view, sign = x
//   direction) or a vector. Missing facing means +x.
// - Damage always goes through the `combat` service of gameplay.combat.health,
//   so resistances, i-frames, blocks, shields and death rules apply once.
import { bodyBox } from '../../kernel/testing.js';

export const FPS = 60;
export const DT = 1 / FPS;
export const frames = s => Math.max(0, Math.round((Number(s) || 0) * FPS));
export const msFrames = ms => Math.max(0, Math.round((Number(ms) || 0) * FPS / 1000));

export const v3 = a => (Array.isArray(a) ? [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0] : typeof a === 'number' ? [a, 0, 0] : [0, 0, 0]);
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = (a, fallback = [1, 0, 0]) => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : fallback.slice(); };
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const round = (v, d = 1e6) => Math.round(v * d) / d;
/** Keep an entity's `at` in the dimensionality it started with (2D spaces use [x,y]). */
export const like = (orig, p) => (Array.isArray(orig) && orig.length === 2 ? [round(p[0]), round(p[1])] : [round(p[0]), round(p[1]), round(p[2])]);

/**
 * Invulnerability lives in the frozen field health.invulnerable (seconds left).
 * grantInvuln raises it to at least `frames` frames; invulnFrames reads it back.
 */
export function grantInvuln(e, f) { const h = e?.components?.health; if (!h || !(f > 0)) return; h.invulnerable = Math.max(h.invulnerable || 0, Math.round(f) / FPS); }
export const invulnFrames = e => Math.round((e?.components?.health?.invulnerable || 0) * FPS);

export const isPos = at => Array.isArray(at) && at.every(Number.isFinite);
export const posOf = e => (isPos(e?.at) ? v3(e.at) : null);

/** Unit facing vector. */
export function facingOf(e) {
  const f = e?.components?.body?.facing ?? e?.components?.facing;
  if (typeof f === 'number') return [f < 0 ? -1 : 1, 0, 0];
  if (Array.isArray(f)) return norm(v3(f));
  return [1, 0, 0];
}
/** Side-view facing sign (+1 right, -1 left). */
export const facingSign = e => (facingOf(e)[0] < 0 ? -1 : 1);
/** Turn an entity to face along x (side view) or along a vector. */
export function setFacing(e, dir) {
  const body = (e.components.body ??= {});
  if (typeof dir === 'number') { body.facing = dir < 0 ? -1 : 1; return; }
  if (Array.isArray(body.facing)) body.facing = like(body.facing, norm(v3(dir)));
  else body.facing = sign(v3(dir)[0]) || body.facing || 1;
}

export function spaceOf(rt, e) {
  if (!e?.space) return null;
  try { return rt.space(e.space); } catch { return null; }
}

export function distance(rt, a, b) {
  const pa = posOf(a), pb = posOf(b);
  if (pa && pb) return len(sub(pa, pb));
  if (a?.space && a.space === b?.space && a.at != null && b.at != null) {
    const api = spaceOf(rt, a);
    if (api?.distance) { const d = api.distance(a.at, b.at); return Number.isFinite(d) ? d : Infinity; }
  }
  return Infinity;
}

/**
 * Entity ids overlapping a shape in e's space. Uses the space's overlap capability
 * when present; otherwise falls back to distance from each entity's `at`, so the
 * same primitive works in spaces without overlap (graph, grid).
 * shape: { kind: 'aabb'|'sphere'|'circle'|'cone', at, size?, r?, dir?, angle? }
 */
export function overlapping(rt, spaceId, shape, filter = () => true, kind) {
  let api = null;
  try { api = rt.space(spaceId); } catch { return []; }
  if (api?.overlap) {
    const ids = kind ? api.overlap(shape, filter, kind) : api.overlap(shape, filter);
    return shape.kind === 'cone' && shape.angle < 360 ? ids.filter(id => inCone(shape, rt.entity(id))) : ids;
  }
  const c = shape.kind === 'aabb' ? add(v3(shape.at), mul(v3(shape.size), 0.5)) : v3(shape.at);
  const r = shape.kind === 'aabb' ? len(mul(v3(shape.size), 0.5)) + (shape.r ?? 0) : shape.r ?? 0;
  return Object.values(rt.state.entities)
    .filter(e => e.space === spaceId && filter(e) && posOf(e) && len(sub(posOf(e), c)) <= r + 0.5)
    .filter(e => shape.kind !== 'cone' || !(shape.angle < 360) || inCone(shape, e))
    .map(e => e.id);
}
function inCone(shape, e) {
  const p = posOf(e); if (!p) return false;
  const d = sub(p, v3(shape.at)); if (len(d) < 1e-6) return true;
  const cos = dot(norm(d), norm(v3(shape.dir)));
  return cos >= Math.cos((shape.angle / 2) * Math.PI / 180) - 1e-9;
}

/** World box {min, max} (3D) of an entity's body, honoring the space anchor (KERNEL_API §3). */
export function boxOf(rt, e) {
  const api = spaceOf(rt, e), at = posOf(e) || [0, 0, 0], size = v3(e.components?.body?.size || (Array.isArray(e.at) && e.at.length === 2 ? [1, 1] : [1, 1, 1]));
  if (Array.isArray(e.at) && e.at.length === 2) size[2] = 0;
  if (!api) return { min: at, max: add(at, size) };
  const b = bodyBox({ at: e.at, components: { body: { size: e.at.length === 2 ? size.slice(0, 2) : size } } }, api);
  return { min: v3(b.min), max: v3(b.max).map((v, i) => (i === 2 && e.at.length === 2 ? 0 : v)) };
}
/** Centre of an entity's body box. */
export const centerOf = (rt, e) => { const b = boxOf(rt, e); return mul(add(b.min, b.max), 0.5); };
/** Move an entity so its body centre is at c (keeps the space's anchor convention). */
export function setCenter(rt, e, c) {
  const api = spaceOf(rt, e); if (!api?.setPos || !isPos(e.at)) return;
  const off = sub(posOf(e), centerOf(rt, e));
  api.setPos(e, like(e.at, add(v3(c), off)), rt);
}

/**
 * World shape of a hitbox relative to entity e.
 * box: { x, y, w, h, d? } in the attacker's frame (fighting convention): x/w along
 *      facing from the body centre, y/h up from the feet, d lateral (centred). In
 *      top-down spaces (facing along y) vertical maps to z.
 * arc: { reach, arc } builds a cone of radius `reach` and `arc` degrees from the centre.
 * scale multiplies every length.
 */
export function hitShape(rt, e, spec, scale = 1) {
  const b = boxOf(rt, e), c = mul(add(b.min, b.max), 0.5), f = facingOf(e);
  if (spec.box) {
    const bx = spec.box, s = scale;
    const axis = Math.abs(f[0]) >= Math.abs(f[1]) && Math.abs(f[0]) >= Math.abs(f[2]) ? 0 : Math.abs(f[2]) >= Math.abs(f[1]) ? 2 : 1;
    const dir = sign(f[axis]) || 1, vert = axis === 1 ? 2 : 1, lat = [0, 1, 2].find(i => i !== axis && i !== vert);
    const min = c.slice(), size = [0, 0, 0];
    const w = (bx.w ?? 1) * s, h = (bx.h ?? 1) * s, d = (bx.d ?? bx.h ?? 1) * s, x = (bx.x ?? 0) * s, y = (bx.y ?? 0) * s;
    min[axis] = dir > 0 ? c[axis] + x : c[axis] - x - w; size[axis] = w;
    min[vert] = (vert === 1 ? b.min[1] : c[vert]) + y; size[vert] = h;
    min[lat] = c[lat] - d / 2; size[lat] = d;
    return { kind: 'aabb', at: min, size };
  }
  const reach = (spec.reach ?? 1) * scale, arc = spec.arc ?? 90;
  if (arc >= 360) return { kind: 'sphere', at: c, r: reach };
  return { kind: 'cone', at: c, r: reach, dir: f, angle: arc };
}

/** Team of an entity: explicit faction/team, else player, else archetype kind. */
export function teamOf(rt, e) {
  const c = e?.components || {};
  const t = c.health?.team ?? (typeof c.faction === 'string' ? c.faction : c.faction?.id);
  if (t) return t;
  if (e?.id === 'player') return 'player';
  const kind = rt.archetype(e?.archetype)?.kind;
  if (kind === 'enemy' || kind === 'boss') return 'enemy';
  if (kind === 'player' || kind === 'companion') return 'player';
  return 'neutral';
}
/** True when a may harm b. Neutral entities can be hit by anyone. */
export function hostile(rt, a, b, friendlyFire = false) {
  if (!a || !b || a.id === b.id) return false;
  if (friendlyFire) return true;
  const ta = teamOf(rt, a), tb = teamOf(rt, b);
  return ta === 'neutral' || tb === 'neutral' || ta !== tb;
}

/**
 * A numeric stat for any entity. Player stats come from vars (equipment and
 * progression publish `stat.*`); every entity adds its own `components.stats`
 * and the modifiers of active statuses (gameplay.combat.status store).
 */
export function statOf(rt, e, key) {
  if (!e) return 0;
  let v = e.components?.stats?.[key] ?? 0;
  v += rt.state.prim['gameplay.combat.status']?.[e.id]?.mods?.[key] ?? 0;
  if (e.id === 'player' && key.startsWith('stat.')) v += rt.state.vars[key] ?? 0;
  return v;
}

/** who: 'player' | 'self' | 'target' | 'by' | 'source' | entity id. Context carries target/by. */
export function resolveWho(rt, who, ctx = {}) {
  if (who === 'target') return rt.entity(ctx.target) || null;
  if (who === 'by' || who === 'source') return rt.entity(ctx.by) || null;
  return rt.resolve(who, ctx);
}
/** All entities an effect addresses: `who`, or every entity of `archetype`. */
export function targetsOf(rt, e, ctx = {}) {
  if (e.archetype) return Object.values(rt.state.entities).filter(x => x.archetype === e.archetype);
  const one = resolveWho(rt, e.who, ctx);
  return one ? [one] : [];
}

/** Shared hook lists for the combat primitives (functions only; rebuilt at install). */
export function hooks(rt) {
  return (rt.caches.combatHooks ??= { intercept: [], damaged: [], dmgMult: [] });
}
/** Register a hit interceptor fn(target, hit, rt) -> hit | {cancel:true, ...result}. Lower order runs first. */
export function intercept(rt, order, fn, owner) {
  const h = hooks(rt).intercept;
  h.push({ order, fn, owner }); h.sort((a, b) => a.order - b.order);
}

/** The combat service, or null when gameplay.combat.health is absent. */
export const combat = rt => (rt.hasService('combat') ? rt.service('combat') : null);
export const service = (rt, name) => (rt.hasService(name) ? rt.service(name) : null);

/** Displace an entity by delta through its space (collide-and-slide when available). */
export function displace(rt, e, delta) {
  const api = spaceOf(rt, e); if (!api || !isPos(e.at)) return;
  const d = v3(delta);
  if (api.slide) api.slide(e, d, rt);
  else if (api.setPos) api.setPos(e, like(e.at, add(v3(e.at), d)), rt);
}

/** Held verbs for an entity this step: the player's input, or an NPC's components.melee.intent.hold. */
export function held(rt, e, verb) {
  if (e.id === 'player') return Boolean(rt.input?.held?.[verb]);
  return Boolean(e.components?.melee?.intent?.hold?.includes?.(verb) || e.components?.intent?.hold?.includes?.(verb));
}

/** True if an archetype id exists in the document (for validate). */
export const hasArchetype = (doc, id) => (doc.content?.archetypes || []).some(a => a.id === id);
export const archetypes = doc => doc.content?.archetypes || [];
export const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

/** Entities with `component` in a space bound to an instance (null space = every space). */
export function inSpace(rt, component, spaceId = null) {
  return Object.values(rt.state.entities).filter(e => component in e.components && (!spaceId || e.space === spaceId));
}
