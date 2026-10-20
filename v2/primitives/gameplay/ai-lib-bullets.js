// Bullet patterns and AI-owned shots (ported from the shmup kit's enemy fire,
// v2/kits/shmup/game.js pattern()/enemyFire()). Used by gameplay.ai.attacks
// emitters and any other ai primitive that fires.
//
// Shots go through combat's `projectiles` service when it exists (combat owns
// components.projectile). Otherwise the ai workstream moves its own shots under
// a separate component key, `aiShot`, so nothing is moved twice.
import { v3, add, sub, mul, len, norm, r6, round6, spaceOf, can, continuous, applyHit, dead, centerOf, atFromCenter, TAU } from './ai-lib.js';

export const PATTERNS = ['aimedOne', 'aimed', 'spread', 'ring', 'spiral', 'burst', 'flower'];
/** Difficulty multipliers: bullet speed (bs) and fire rate (fr), as in the kit. */
export const DIFF = { easy: { bs: 0.8, fr: 0.7 }, normal: { bs: 1, fr: 1 }, hard: { bs: 1.2, fr: 1.3 } };
/** Live-bullet caps per stage mode in the kit; selectable with capBy. */
export const MODE_CAPS = { fixed: 24, vertical: 140, twinstick: 80, asteroids: 16 };

/** Unit vector at angle a in the plane spanned by axes (default xy). */
const dirAt = (a, ax = [1, 0, 0], bx = [0, 1, 0]) => r6(add(mul(ax, Math.cos(a)), mul(bx, Math.sin(a))));

/**
 * Directions (and speed factors) for one volley of `kind` from src toward aim.
 * mem keeps the emitter's spin and burst counters (JSON, in the caller's store).
 * boss + phase reproduce the kit's boss variants (more bullets per phase).
 */
export function volley(kind, aimAngle, mem, { boss = false, phase = 0, count, step } = {}) {
  const out = [];
  const fan = (a, n, st) => { for (let i = 0; i < n; i++) out.push({ a: a + (i - (n - 1) / 2) * st, k: 1 }); };
  mem.spin ??= 0;
  switch (kind) {
    case 'aimedOne': fan(aimAngle, count ?? (boss ? 3 : 1), step ?? 0.14); break;
    case 'aimed': fan(aimAngle, count ?? (boss ? 3 + phase * 2 : 1), step ?? 0.16); break;
    case 'spread': fan(aimAngle, count ?? (boss ? 7 : 3), step ?? (boss ? 0.19 : 0.26)); break;
    case 'ring': { const n = count ?? (boss ? 18 : 8); for (let i = 0; i < n; i++) out.push({ a: mem.spin + i / n * TAU, k: 0.85 }); mem.spin += 0.17; break; }
    case 'spiral': { const arms = count ?? (boss ? 3 : 1); for (let i = 0; i < arms; i++) out.push({ a: mem.spin + i / arms * TAU, k: 0.9 }); mem.spin += boss ? 0.23 : 0.45; break; }
    case 'burst': mem.burst = count ?? (boss ? 5 : 3); mem.burstGap = 1; break;
    case 'flower': { const n = count ?? (boss ? 12 : 6); for (let i = 0; i < n; i++) { out.push({ a: mem.spin + i / n * TAU, k: 0.95 }); out.push({ a: mem.spin + (i + 0.5) / n * TAU, k: 0.65, big: true }); } mem.spin += 0.21; break; }
  }
  mem.spin = round6(mem.spin % TAU);
  return out;
}

/** Live shots fired by non-player entities (for caps). */
export function liveShots(rt) {
  let n = 0;
  for (const e of Object.values(rt.state.entities)) { const p = e.components.aiShot || e.components.projectile; if (p && p.by !== 'player') n++; }
  return n;
}

/**
 * Fire one shot. spec: { speed, damage, type, status, radius, life (s), gravity, pierce, archetype, homing }.
 * Returns the new entity id(s).
 */
export function fireShot(rt, src, dir, spec, target = null) {
  const d = norm(dir);
  if (rt.hasService('projectiles')) return rt.service('projectiles').fire(src, { ...spec, count: 1, pattern: 'single' }, { dir: d, target: target?.id ?? null }) || [];
  const api = spaceOf(rt, src), r = spec.radius ?? 0.25, size = [2 * r, 2 * r, 2 * r];
  const c = add(continuous(src) ? centerOf(src, api) : [0, 0, 0], mul(d, spec.offset ?? 0.5));
  const e = rt.spawn(spec.archetype ?? 'ai_shot', { space: src.space, at: atFromCenter(api, c, size), components: { body: { size }, aiShot: {
    by: src.id, vel: r6(mul(d, spec.speed ?? 10)), damage: spec.damage ?? 1, type: spec.type ?? null, status: spec.status ?? null,
    life: spec.life ?? 4, gravity: spec.gravity ?? 0, radius: spec.radius ?? 0.25, pierce: spec.pierce ?? 0, homing: spec.homing ?? 0, target: target?.id ?? null, hit: [],
  } } });
  return [e.id];
}

/**
 * Install (once) the system that moves `aiShot` entities, applies gravity and
 * homing, stops them on solid cells and hits hostile entities they overlap.
 * hostileFn(a, b) decides who a shot may hit.
 */
export function ensureShots(rt, hostileFn) {
  if (rt.caches.aiShots) return;
  rt.caches.aiShots = true;
  rt.system('physics', rt => {
    for (const e of Object.values(rt.state.entities)) {
      const s = e.components.aiShot; if (!s) continue;
      const api = spaceOf(rt, e);
      s.life = round6(s.life - rt.dt);
      if (!api || s.life <= 0) { rt.despawn(e.id); continue; }
      const up = can(api, 'gravityAt') && len(api.gravityAt(e.at)) > 1e-9 ? norm(mul(api.gravityAt(e.at), -1)) : [0, 1, 0];
      if (s.gravity) s.vel = r6(sub(s.vel, mul(up, s.gravity * rt.dt)));
      const tgt = s.homing && s.target ? rt.entity(s.target) : null;
      if (tgt && tgt.space === e.space) { const want = mul(norm(sub(tgt.at, e.at)), len(s.vel)); s.vel = r6(add(mul(s.vel, 1 - s.homing * rt.dt), mul(want, s.homing * rt.dt))); }
      const delta = mul(s.vel, rt.dt), dist = len(delta);
      if (can(api, 'raycast') && dist > 0) { const r = api.raycast(e.at, delta, dist); if (r.hit === 'cell') { rt.emit('shot_blocked', { who: e.id, by: s.by, at: r.at }); rt.despawn(e.id); continue; } }
      api.setPos(e, r6(add(e.at, delta)), rt);
      const owner = rt.entity(s.by) || { id: s.by };
      const ids = can(api, 'overlap') ? api.overlap({ kind: 'sphere', at: centerOf(e, api), r: s.radius }, o => o.id !== e.id && o.id !== s.by && !o.components.aiShot && !o.components.projectile) : [];
      for (const id of ids) {
        const o = rt.entity(id); if (!o || dead(o) || s.hit.includes(id) || !hostileFn(owner, o)) continue;
        s.hit.push(id);
        applyHit(rt, owner, o, { amount: s.damage, type: s.type ?? undefined, status: s.status ?? undefined, dir: norm(s.vel) });
        rt.emit('shot_hit', { who: id, by: s.by, shot: e.id, damage: s.damage });
        if (s.hit.length > s.pierce) { rt.despawn(e.id); break; }
      }
    }
  }, 'gameplay.ai.shots');
}
