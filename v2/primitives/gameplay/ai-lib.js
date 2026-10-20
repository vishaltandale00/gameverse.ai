// Shared helpers for the ai workstream (gameplay.ai.*, progression.*, wanted).
// Everything here programs against space capability methods only (KERNEL_API §3)
// and keeps per-entity runtime state in rt.store(...) so snapshots replay.
//
// Locomotion contract (agreed with ws-move): AI writes intents in the 'ai' phase:
//   components.moveTo = { at, zone, run, speed?, by: 'ai' }   goal seeking
//   components.steer  = { dir: [x,y,z], speed, face? }         direct steering
// When an entity is driven by a gameplay.move.* primitive (it has the move.*
// marker components.move, or ai.drive === 'intent'), AI stops there: move.*
// reads components.input, then steer, then moveTo, in its 'movement' phase. Otherwise AI carries the intent out
// itself through the space API: path() waypoints, then slide() (collide and
// slide) or setPos() in speed*dt increments, or navigate.move() hop by hop on
// discrete spaces. AI never jump-cuts an entity to its goal.

export const TAU = Math.PI * 2;

/**
 * An object param whose default is built from its fields' defaults. The kernel
 * returns an omitted object param's `default` as-is (nested field defaults are
 * not applied), so `default: {}` would leave every field undefined.
 */
export function objectParam(schema) {
  const build = sc => (sc.type === 'object' && sc.fields ? Object.fromEntries(Object.entries(sc.fields).map(([k, f]) => [k, f.default !== undefined ? structuredClone(f.default) : f.type === 'object' && f.fields && !f.required ? build(f) : undefined]).filter(([, v]) => v !== undefined)) : undefined);
  return { ...schema, default: build(schema) };
}
export const v3 = a => (Array.isArray(a) ? [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0] : [0, 0, 0]);
export const add = (a, b) => v3(a).map((v, i) => v + (b[i] ?? 0));
export const sub = (a, b) => v3(a).map((v, i) => v - (b[i] ?? 0));
export const mul = (a, k) => v3(a).map(v => v * k);
export const dot = (a, b) => v3(a).reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
export const len = a => Math.hypot(...v3(a));
export const norm = a => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : [0, 0, 0]; };
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const wrapAng = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
export const steerAng = (cur, target, max) => cur + clamp(wrapAng(target - cur), -max, max);
export const round6 = v => Math.round(v * 1e6) / 1e6;
export const r6 = a => a.map(round6);

/** Space API of an entity (null when it has none or the space is gone). */
export function spaceOf(rt, e) {
  if (!e?.space || !rt.spaces().includes(e.space)) return null;
  return rt.space(e.space);
}
export const can = (api, m) => typeof api?.[m] === 'function';
/** Continuous spaces give array positions; graph-like spaces give node ids. */
export const continuous = e => Array.isArray(e?.at);

/** Unit "up" vector of the space at a point, or null when there is no gravity. */
export function upAt(api, at) {
  if (!can(api, 'gravityAt')) return null;
  const g = v3(api.gravityAt(at));
  return len(g) > 1e-9 ? norm(mul(g, -1)) : null;
}
/**
 * Remove the vertical component of a direction for ground agents. plane:
 * 'auto' (perpendicular to gravity; free when there is none), 'xy', 'xz', 'xyz'.
 */
export function planar(api, at, dir, plane = 'auto', fly = false) {
  const d = v3(dir);
  if (fly || plane === 'xyz') return d;
  if (plane === 'xy') return [d[0], d[1], 0];
  if (plane === 'xz') return [d[0], 0, d[2]];
  const up = upAt(api, at);
  return up ? sub(d, mul(up, dot(d, up))) : d;
}

/** Distance between two entities in the same space (Infinity otherwise). */
export function distBetween(rt, a, b) {
  if (!a || !b || a.space !== b.space) return Infinity;
  const api = spaceOf(rt, a); if (!api) return Infinity;
  if (can(api, 'distance')) { const d = api.distance(a.at, b.at); return Number.isFinite(d) ? d : Infinity; }
  return continuous(a) ? len(sub(a.at, b.at)) : (a.at === b.at ? 0 : Infinity);
}
export const distTo = (rt, e, at) => {
  const api = spaceOf(rt, e); if (!api) return Infinity;
  if (can(api, 'distance')) return api.distance(e.at, at);
  return continuous(e) ? len(sub(e.at, at)) : (e.at === at ? 0 : Infinity);
};

/** Facing vector: components.body.facing (sign or vector), else the last movement direction. */
export function facingOf(e, fallback) {
  const f = e?.components?.body?.facing;
  if (Array.isArray(f)) return norm(f);
  if (typeof f === 'number') return [Math.sign(f) || 1, 0, 0];
  return fallback && len(fallback) > 1e-9 ? norm(fallback) : [1, 0, 0];
}

/** Line of sight via los, else raycast, else assume clear. */
export function clearLine(api, a, b) {
  if (can(api, 'los')) return Boolean(api.los(a, b)?.clear);
  if (can(api, 'raycast')) { const d = sub(b, a), l = len(d); const r = api.raycast(a, d, l); return r.hit === 'none' || r.dist >= l - 0.5 || r.id !== undefined; }
  return true;
}
/** Sight test: within range, inside the fov cone around facing, with a clear line. */
export function sees(rt, viewer, target, { range, fov = 360, facing }) {
  if (!viewer || !target || viewer.space !== target.space) return false;
  const d = distBetween(rt, viewer, target); if (!(d <= range)) return false;
  if (!continuous(viewer)) return true; // discrete spaces: same-node or within hop range
  const api = spaceOf(rt, viewer);
  if (fov < 360 && d > 1e-6) {
    const to = norm(sub(target.at, viewer.at)), f = facing || facingOf(viewer);
    if (dot(to, f) < Math.cos((fov / 2) * Math.PI / 180) - 1e-9) return false;
  }
  return clearLine(api, centerOf(viewer), centerOf(target));
}
/** Box centre of an entity (positions are box min corners in cell spaces). */
export function centerOf(e) {
  const s = e?.components?.body?.size;
  return Array.isArray(s) ? add(e.at, mul(s, 0.5)) : v3(e.at);
}

/** True when a gameplay.move.* primitive owns this entity's locomotion. */
export function moverOwned(e) { return Boolean(e?.components?.move) || e?.components?.ai?.drive === 'intent'; }

/** Busy flag shared between brain and attacks: an attack in progress roots the agent. */
export function attacking(rt, id) { const a = rt.state.prim['gameplay.ai.attacks']?.agents?.[id]; return Boolean(a && a.phase && a.phase !== 'idle'); }

/** Seeded pick from weighted entries [{weight}] using rt.random(). */
export function weighted(rt, list, w = x => x.weight ?? 1) {
  const total = list.reduce((s, x) => s + Math.max(0, w(x)), 0); if (!(total > 0)) return null;
  let r = rt.random() * total;
  for (const x of list) { r -= Math.max(0, w(x)); if (r < 0) return x; }
  return list[list.length - 1];
}
export const between = (rt, a, b) => a + rt.random() * (b - a);

/**
 * Event-name matching for xp sources, crimes and director inputs: exact, or a
 * `prefix:*` wildcard that matches typed events (`block_mined:*`).
 */
export const eventMatch = (pattern, name) => pattern === name || (pattern.endsWith(':*') && name.startsWith(pattern.slice(0, -1)));
/** Subscribe fn(name, data) to every event matching any pattern. Typed events are seen once via their typed form. */
export function onEvents(rt, patterns, fn) {
  const exact = patterns.filter(p => !p.endsWith(':*')), wild = patterns.filter(p => p.endsWith(':*'));
  for (const p of new Set(exact)) rt.on(p, (data, rt) => fn(p, data, rt));
  if (wild.length) rt.on('*', (ev, rt) => { if (wild.some(p => eventMatch(p, ev.name))) { const { name, ...data } = ev; fn(name, data, rt); } });
}

/** A world position for a zone: doc zone `at`, `center`, `rect` [x0,y0,x1,y1] or `box` [[min],[max]]. */
export function zonePoint(rt, spaceId, zoneId) {
  const z = rt.doc.spaces?.find(s => s.id === spaceId)?.zones?.find(q => q.id === zoneId);
  if (!z) return null;
  if (Array.isArray(z.at)) return v3(z.at);
  if (Array.isArray(z.center)) return v3(z.center);
  if (Array.isArray(z.rect)) return [Math.floor((z.rect[0] + z.rect[2] - 1) / 2), Math.floor((z.rect[1] + z.rect[3] - 1) / 2), 0];
  if (Array.isArray(z.box)) return mul(add(z.box[0], z.box[1]), 0.5);
  return null;
}

// ---------- locomotion ----------
const NAV = 'gameplay.ai.nav';
const navOf = (rt, id) => ((rt.store(NAV).agents ??= {})[id] ??= {});
export function dropNav(rt, id) { const s = rt.store(NAV).agents; if (s) delete s[id]; }

/**
 * Move a continuous entity by `delta` (already scaled by dt): slide when the
 * space collides, else setPos. Returns the distance actually moved.
 */
export function displace(rt, e, delta, api = spaceOf(rt, e)) {
  if (!api || !continuous(e)) return 0;
  const before = v3(e.at);
  const d = r6(v3(delta).slice(0, e.at.length >= 3 ? 3 : 3));
  if (can(api, 'slide')) api.slide(e, d, rt);
  else if (can(api, 'setPos')) api.setPos(e, r6(add(before, d)), rt);
  const moved = len(sub(e.at, before));
  if (moved > 1e-9) { const nav = navOf(rt, e.id); nav.heading = r6(norm(sub(e.at, before))); }
  return moved;
}

/** Steer: move toward dir at speed for one step. opts: { plane, fly }. */
export function steerStep(rt, e, dir, speed, opts = {}) {
  const api = spaceOf(rt, e); if (!api || !continuous(e) || !(speed > 0)) return 0;
  const d = norm(planar(api, e.at, dir, opts.plane, opts.fly));
  return displace(rt, e, mul(d, speed * rt.dt), api);
}

/** Last movement heading recorded by displace (for facing-less entities). */
export const headingOf = (rt, id) => rt.state.prim[NAV]?.agents?.[id]?.heading || null;

/**
 * Follow a path toward `goal` (At, or a node id on discrete spaces). Repaths when the
 * goal moves more than `repathDist` or every `repathSec`. Returns 'arrived' | 'moving' | 'blocked'.
 * opts: { speed, arrive, plane, fly, repathSec }
 */
export function seek(rt, e, goal, opts = {}) {
  const api = spaceOf(rt, e); if (!api || goal == null) return 'blocked';
  const speed = opts.speed ?? 2, nav = navOf(rt, e.id);
  if (!continuous(e)) return hop(rt, e, goal, speed, api, nav);
  const arrive = opts.arrive ?? Math.max(0.05, speed * rt.dt);
  const target = v3(goal);
  if (len(sub(target, e.at)) <= arrive) { nav.path = null; return 'arrived'; }
  const goalKey = r6(target).join(',');
  const stale = nav.goal !== goalKey || (rt.state.time - (nav.at ?? -1e9)) > (opts.repathSec ?? 0.75) || !nav.path;
  if (stale && can(api, 'path') && !opts.fly) {
    const p = api.path(e.at, target, { radius: e.components.body?.size?.[0] });
    nav.goal = goalKey; nav.at = rt.state.time;
    nav.path = p ? p.map(v3) : null; nav.i = 0;
    if (!p) return 'blocked';
    // Paths run cell to cell; finish on the exact goal.
    if (len(sub(nav.path[nav.path.length - 1], target)) > 1e-6) nav.path.push(target);
    // Skip waypoints already passed: the first is usually the cell the agent stands in.
    while (nav.i < nav.path.length - 1) {
      const a = nav.path[nav.i], b = nav.path[nav.i + 1];
      if (len(sub(a, e.at)) <= arrive || dot(sub(b, a), sub(e.at, a)) > 0) nav.i++; else break;
    }
  } else if (stale) { nav.goal = goalKey; nav.at = rt.state.time; nav.path = [target]; nav.i = 0; }
  let budget = speed * rt.dt;
  for (let guard = 0; guard < 4 && budget > 1e-9 && nav.path; guard++) {
    const wp = nav.path[nav.i] ?? target, to = sub(planar(api, e.at, sub(wp, e.at), opts.plane, opts.fly), [0, 0, 0]), d = len(to);
    if (d <= 1e-6) { if (nav.i < nav.path.length - 1) { nav.i++; continue; } break; }
    const step = Math.min(budget, d), moved = displace(rt, e, mul(norm(to), step), api);
    budget -= step;
    if (moved < step * 0.25) { nav.path = null; return 'blocked'; }
    if (d - step <= 1e-6 && nav.i < nav.path.length - 1) nav.i++;
  }
  return len(sub(target, e.at)) <= arrive ? 'arrived' : 'moving';
}

/** Discrete spaces: one hop toward goal every 1/speed seconds along a BFS over neighbors. */
function hop(rt, e, goal, speed, api, nav) {
  if (e.at === goal) return 'arrived';
  nav.wait = (nav.wait ?? 0) - rt.dt;
  if (nav.wait > 0) return 'moving';
  const next = firstHop(rt, api, e, goal);
  if (next == null) return 'blocked';
  nav.wait = 1 / Math.max(0.01, speed);
  return api.move(e, next, rt) ? (e.at === goal ? 'arrived' : 'moving') : 'blocked';
}
export function firstHop(rt, api, e, goal) {
  if (!can(api, 'neighbors')) return null;
  const prev = new Map([[e.at, null]]), q = [e.at];
  while (q.length) {
    const n = q.shift();
    if (n === goal) { let k = n; while (prev.get(k) !== e.at && prev.get(k) != null) k = prev.get(k); return k; }
    for (const m of api.neighbors(n)) if (!prev.has(m) && (n !== e.at || !can(api, 'canMove') || api.canMove(e, m, rt))) { prev.set(m, n); q.push(m); }
  }
  return null;
}

/** A random point within `range` of `center` on the agent's movement plane (continuous). */
export function randomPoint(rt, api, center, range, plane = 'auto') {
  const c = v3(center), up = plane === 'auto' ? upAt(api, c) : null;
  let d;
  if (plane === 'xyz') d = [between(rt, -1, 1), between(rt, -1, 1), between(rt, -1, 1)];
  else if (plane === 'xz') d = [between(rt, -1, 1), 0, between(rt, -1, 1)];
  else if (plane === 'xy' || !up) d = [between(rt, -1, 1), between(rt, -1, 1), 0];
  else d = planar(api, c, [between(rt, -1, 1), between(rt, -1, 1), between(rt, -1, 1)]);
  const k = range * Math.sqrt(rt.random());
  return r6(add(c, mul(norm(d), k)));
}

/** Clear per-entity state in every store listed when an entity despawns. */
export function cleanupOnDespawn(rt, keys) {
  rt.on('despawn', ({ id }, rt) => { for (const k of [...keys, NAV]) { const s = rt.state.prim[k]; if (s?.agents) delete s.agents[id]; } });
}

/** Check a predicate list inside a behavior/attack/etc. with stable paths. */
export const checkWhen = (ctx, p, path, errors) => { if (p !== undefined) ctx.checkPredicate(p, path, errors); };

/**
 * Agent-relative predicates: kernel spatial predicates (`zone`, `near`) inside AI
 * rules default to `who: 'self'` so `{near: 'player', within: 7}` reads "this agent
 * is within 7 of the player". Returns a rewritten copy (cached by identity).
 */
const selfCache = new WeakMap();
export function selfRelative(p) {
  if (!p || typeof p !== 'object') return p;
  if (selfCache.has(p)) return selfCache.get(p);
  let out;
  if (Array.isArray(p.all)) out = { ...p, all: p.all.map(selfRelative) };
  else if (Array.isArray(p.any)) out = { ...p, any: p.any.map(selfRelative) };
  else if (p.not) out = { ...p, not: selfRelative(p.not) };
  else if (('near' in p || 'zone' in p) && p.who === undefined && Object.keys(p)[0] !== 'var') out = { ...p, who: 'self' };
  else out = p;
  selfCache.set(p, out);
  return out;
}

/** Hit a target the way combat expects: combat service, else damage effect, else event only. */
export function applyHit(rt, by, target, { amount = 0, type, status, sec, dir, knockback, tags } = {}) {
  let result = { applied: false };
  if (!(amount > 0) && !status) return result;
  if (rt.hasService('combat')) return rt.service('combat').hit(target, { amount, type, by: by?.id, dir, knockback, status, tags }) || result;
  if (amount > 0 && rt.logic.effects.has('damage')) { rt.run([{ do: 'damage', who: target.id, amount, ...(type ? { type } : {}), ...(by ? { by: by.id } : {}) }]); result = { applied: true, damage: amount }; }
  if (status && rt.logic.effects.has('apply_status') && rt.state.entities[target.id]) { rt.run([{ do: 'apply_status', who: target.id, status, ...(sec ? { sec } : {}) }]); result.applied = true; }
  return result;
}
/** Is the entity dead per combat.health (components.health.dead or hp <= 0)? */
export const dead = e => { const h = e?.components?.health; return Boolean(h && (h.dead || (h.hp ?? h.max ?? 1) <= 0)); };

/**
 * Install (once per runtime) the 'movement' system that carries out steer/moveTo
 * intents for non-player entities that no move.* primitive owns. Arrival of a
 * scripted moveTo (not written by AI itself) clears it and emits `arrived`
 * {who, zone?} + `arrived:<zone>`; an unreachable one emits `move_failed`.
 */
export function ensureLocomotion(rt) {
  if (rt.caches.aiLocomotion) return;
  rt.caches.aiLocomotion = true;
  rt.system('movement', rt => {
    for (const e of Object.values(rt.state.entities)) {
      if (e.id === 'player' || moverOwned(e)) continue;
      const c = e.components, s = c.steer, m = c.moveTo;
      if (s && Array.isArray(s.dir)) { steerStep(rt, e, s.dir, s.speed ?? c.ai?.speed ?? 2, { fly: s.fly, plane: s.plane ?? c.ai?.plane }); continue; }
      if (!m) continue;
      const api = spaceOf(rt, e); if (!api) continue;
      let goal = m.at ?? null;
      if (goal == null && m.zone) goal = continuous(e) ? zonePoint(rt, e.space, m.zone) : m.zone;
      if (m.zone && m.at == null && api.inZone?.(e, m.zone, rt)) goal = e.at;
      const speed = m.speed ?? (c.ai?.speed ?? 2) * (m.run ? (c.ai?.run ?? 1.6) : 1);
      const r = goal == null ? 'blocked' : seek(rt, e, goal, { speed, plane: c.ai?.plane, fly: m.fly });
      if (m.by === 'ai') continue;
      if (r === 'arrived') { delete c.moveTo; if (m.zone) rt.emitTyped('arrived', m.zone, { who: e.id, zone: m.zone }); else rt.emit('arrived', { who: e.id }); }
      else if (r === 'blocked') { m.fails = (m.fails ?? 0) + 1; if (goal == null || m.fails > 30) { delete c.moveTo; rt.emit('move_failed', { who: e.id, reason: goal == null ? 'no_point' : 'no_path' }); } }
      else m.fails = 0;
    }
  }, 'gameplay.ai.locomotion');
}
