// gameplay.combat.target: lock-on and target selection for the player and any
// entity. Candidates are hostile, living entities within range and the field of
// view, with line of sight. The lock breaks with distance, switches on death,
// cycles left/right by angle, and (faceTarget) keeps the locker facing it so
// movement strafes and attacks aim at the target.
import { v3, sub, norm, dot, len, posOf, facingOf, setFacing, spaceOf, distance, hostile, resolveWho, combat, err } from './combat-lib.js';

const KEY = 'gameplay.combat.target';

export default {
  id: KEY,
  card: {
    intent: 'Lock-on targeting: pick the best hostile in range and view with line of sight, cycle targets, keep facing the locked target for strafing, switch on death and break with distance.',
    views: ['3p', '1p', 'td', 'side'],
    params: {
      range: { type: 'number', default: 20, min: 0.5, max: 1000, unit: 'units', effect: 'how far a lock can start' },
      fov: { type: 'number', default: 90, min: 1, max: 360, unit: 'deg', effect: 'cone in front of the locker that candidates must be in' },
      switchOnDeath: { type: 'boolean', default: true, effect: 'lock the next candidate when the target dies' },
      breakDist: { type: 'number', default: 30, min: 0.5, max: 2000, unit: 'units', effect: 'the lock breaks beyond this distance' },
      los: { type: 'boolean', default: true, effect: 'require line of sight (space los or raycast)' },
      faceTarget: { type: 'boolean', default: true, effect: 'the locker keeps facing its target' },
    },
    provides: { events: ['locked', 'unlocked', 'target_switched'], vars: ['target'], services: ['target'], actions: ['lock', 'cycle'] },
    requires: { primitives: ['gameplay.combat.health'], capabilities: ['raycast'] },
    actionSpace: { cycle: { type: 'enum', options: [-1, 1] } },
  },
  logic(logic) {
    logic.predicate('locked', { test: (p, rt, c) => { const e = resolveWho(rt, p.locked === true ? undefined : p.locked ?? p.who, c); const t = e && rt.service('target').of(e); return p.target ? t === p.target || rt.entity(t)?.archetype === p.target : Boolean(t); } });
    logic.effect('lock_target', { run: (e, rt, c) => { const who = resolveWho(rt, e.who, c); if (who) rt.service('target').lock(who, e.target ? resolveWho(rt, e.target, c)?.id : undefined); } });
    logic.effect('unlock_target', { run: (e, rt, c) => { const who = resolveWho(rt, e.who, c); if (who) rt.service('target').unlock(who); } });
  },
  validate(config) {
    return config.breakDist < config.range ? [err('target_break_invalid', 'with.breakDist', 'breakDist must be at least range')] : [];
  },
  install(rt, config) {
    const store = () => rt.store(KEY);
    const visible = (e, o) => {
      if (!config.los) return true;
      const api = spaceOf(rt, e), a = posOf(e), b = posOf(o); if (!api || !a || !b) return true;
      if (api.los) return api.los(e.at, o.at).clear;
      if (api.raycast) { const d = sub(b, a), l = len(d); const r = api.raycast(e.at, d, l); return r.hit === 'none' || r.dist >= l - 0.5; }
      return true;
    };
    const angleTo = (e, o) => { const a = posOf(e), b = posOf(o); if (!a || !b) return 0; return Math.acos(Math.max(-1, Math.min(1, dot(facingOf(e), norm(sub(b, a)))))) * 180 / Math.PI; };
    const candidates = e => Object.values(rt.state.entities)
      .filter(o => o.id !== e.id && o.space === e.space && o.components.health && combat(rt)?.alive(o) && hostile(rt, e, o))
      .map(o => ({ o, d: distance(rt, e, o), a: angleTo(e, o) }))
      .filter(c => c.d <= config.range && c.a <= config.fov / 2 && visible(e, c.o))
      .sort((x, y) => (x.a / config.fov + x.d / config.range) - (y.a / config.fov + y.d / config.range) || (x.o.id < y.o.id ? -1 : 1));
    const sync = () => { const p = rt.player(); rt.state.vars.target = (p && store()[p.id]) || ''; };
    const api = {
      of: e => store()[e?.id] ?? null,
      candidates: e => candidates(e).map(c => c.o.id),
      lock(e, id) {
        const t = id ?? candidates(e)[0]?.o.id; if (!t) return null;
        const prev = store()[e.id]; store()[e.id] = t; (e.components.target ??= {}).id = t;
        rt.emit(prev ? 'target_switched' : 'locked', { who: e.id, target: t, from: prev ?? null }); sync(); return t;
      },
      unlock(e, reason = 'manual') { const t = store()[e.id]; if (!t) return; delete store()[e.id]; if (e.components.target) e.components.target.id = null; rt.emit('unlocked', { who: e.id, target: t, reason }); sync(); },
      /** Next candidate to the left (-1) or right (+1) of the current target, by signed angle. */
      cycle(e, dirn = 1) {
        const cur = store()[e.id], list = candidates(e).filter(c => c.o.id !== cur); if (!list.length) return cur;
        const f = facingOf(e), side = c => { const d = sub(posOf(c.o), posOf(e)); return Math.sign(f[0] * d[1] - f[1] * d[0] + f[2] * d[0] - f[0] * d[2]) * c.a; };
        const sorted = list.sort((x, y) => side(x) - side(y));
        return api.lock(e, (dirn > 0 ? sorted.find(c => side(c) > 0) ?? sorted[0] : [...sorted].reverse().find(c => side(c) < 0) ?? sorted.at(-1)).o.id);
      },
    };
    rt.provide('target', api);
    rt.action('lock', (v, rt) => { const p = rt.player(); if (!p) return; if (api.of(p)) api.unlock(p); else api.lock(p, typeof v === 'string' ? v : undefined); });
    rt.action('cycle', (v, rt) => { const p = rt.player(); if (p && api.of(p)) api.cycle(p, typeof v === 'number' ? v : 1); });
    rt.system('late', rt => {
      for (const [who, t] of Object.entries(store())) {
        const e = rt.entity(who), o = rt.entity(t);
        if (!e) { delete store()[who]; continue; }
        const dead = !o || !combat(rt)?.alive(o);
        if (dead) { api.unlock(e, 'dead'); if (config.switchOnDeath) api.lock(e); continue; }
        if (distance(rt, e, o) > config.breakDist || o.space !== e.space) { api.unlock(e, 'distance'); continue; }
        if (config.faceTarget && posOf(e) && posOf(o)) { const d = sub(posOf(o), posOf(e)); if (len(d) > 1e-6) setFacing(e, d); }
      }
      sync();
    }, KEY);
  },
};
