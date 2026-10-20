// gameplay.combat.aim: slow-motion targeting (V.A.T.S. queue, Dead Eye marks).
// `aim` enters aim mode: var time.scale drops to timeScale (renderers and
// movement primitives that honour time.scale slow down; the simulation step
// stays fixed). `mark` queues a shot on a target (the given id, the locked
// target, or the best visible hostile) with a hit chance from distance, cover and
// stat.aim, paying action points. `execute` (or leaving aim in mark mode) resolves
// each queued shot with rt.random() against its chance. Damage comes from the
// shooter's ranged weapon when gameplay.combat.projectile defines it.
import { v3, sub, len, posOf, spaceOf, distance, hostile, statOf, combat, service, clamp, round, err } from './combat-lib.js';

const KEY = 'gameplay.combat.aim';

export default {
  id: KEY,
  card: {
    intent: 'Slow-motion aiming: enter aim mode (time.scale drops), queue or mark shots on targets with hit chances from distance, cover and aim stat, pay action points, then resolve them with seeded rolls (V.A.T.S. queue or Dead Eye marks).',
    views: ['1p', '3p', 'td'],
    params: {
      mode: { type: 'string', options: ['queue', 'mark'], default: 'queue', effect: 'queue: shots fire on execute; mark: marked shots fire when aim mode ends' },
      pool: { type: 'string', default: 'ap', effect: 'resource pool paying for shots; a built-in pool is used if gameplay.resource lacks it' },
      points: { type: 'number', default: 100, min: 1, max: 1000, effect: 'built-in pool size' },
      regen: { type: 'number', default: 10, min: 0, max: 1000, unit: '/s', effect: 'built-in pool regen outside aim mode' },
      cost: { type: 'number', default: 25, min: 0, max: 1000, effect: 'points per queued shot' },
      timeScale: { type: 'number', default: 0.1, min: 0, max: 1, effect: 'time.scale while aiming' },
      maxShots: { type: 'integer', default: 6, min: 1, max: 50 },
      range: { type: 'number', default: 30, min: 0.5, max: 1000, unit: 'units' },
      baseChance: { type: 'number', default: 0.95, min: 0, max: 1 },
      falloff: { type: 'number', default: 0.02, min: 0, max: 1, unit: '/unit', effect: 'chance lost per unit of distance' },
      coverPenalty: { type: 'number', default: 0.3, min: 0, max: 1, effect: 'chance lost per cover level' },
      minChance: { type: 'number', default: 0.05, min: 0, max: 1 },
      damage: { type: 'number', default: 10, min: 0, max: 1e6, effect: 'damage when the shooter has no ranged weapon' },
      critChance: { type: 'number', default: 0.05, min: 0, max: 1 },
      critMult: { type: 'number', default: 2, min: 1, max: 20 },
      maxSec: { type: 'number', default: 0, min: 0, max: 60, unit: 's', effect: 'mark mode ends by itself after this long (0 = no limit)' },
    },
    provides: { events: ['aim_start', 'aim_end', 'aim_marked', 'aim_shot', 'aim_miss', 'aim_no_points'], vars: ['aim.active', 'aim.points', 'time.scale'], actions: ['aim', 'mark', 'execute'] },
    requires: { primitives: ['gameplay.combat.health'] },
  },
  validate(config) {
    return config.minChance > config.baseChance ? [err('aim_chance_invalid', 'with.minChance', 'minChance exceeds baseChance')] : [];
  },
  install(rt, config) {
    const s = () => { const x = rt.store(KEY); x.active ??= false; x.queue ??= []; x.points ??= config.points; x.t ??= 0; return x; };
    const res = () => { const r = service(rt, 'resources'); return r && r.pools().includes(config.pool) ? r : null; };
    const points = p => (res() ? res().get(p, config.pool) : s().points);
    const pay = (p, n) => { if (res()) return res().spend(p, config.pool, n, { partial: false }); if (s().points < n) return false; s().points -= n; return true; };
    const sync = () => { rt.state.vars['aim.active'] = s().active ? 1 : 0; rt.state.vars['aim.points'] = round(points(rt.player()) ?? 0); rt.state.vars['time.scale'] = s().active ? config.timeScale : 1; };
    const coverLevel = (a, t) => { if (t.components.cover?.in) return t.components.cover.level ?? 1; const api = spaceOf(rt, a); return api?.los ? api.los(a.at, t.at).cover ?? 0 : 0; };
    const visible = (a, t) => { const api = spaceOf(rt, a); if (api?.los) return api.los(a.at, t.at).clear || coverLevel(a, t) < 2; if (api?.raycast && posOf(a) && posOf(t)) { const d = sub(posOf(t), posOf(a)), l = len(d); const r = api.raycast(a.at, d, l); return r.hit === 'none' || r.dist >= l - 0.5; } return true; };
    const chance = (a, t) => clamp(config.baseChance - distance(rt, a, t) * config.falloff - coverLevel(a, t) * config.coverPenalty + statOf(rt, a, 'stat.aim'), config.minChance, config.baseChance);
    const pick = p => {
      const locked = service(rt, 'target')?.of(p); if (locked && rt.entity(locked)) return rt.entity(locked);
      return Object.values(rt.state.entities).filter(o => o.space === p.space && o.id !== p.id && o.components.health && combat(rt)?.alive(o) && hostile(rt, p, o) && distance(rt, p, o) <= config.range && visible(p, o))
        .sort((a, b) => distance(rt, p, a) - distance(rt, p, b) || (a.id < b.id ? -1 : 1))[0] ?? null;
    };
    const start = () => { if (s().active) return; s().active = true; s().queue = []; s().t = 0; rt.emit('aim_start', { who: 'player' }); sync(); };
    const execute = () => {
      const p = rt.player(), q = s().queue; s().queue = [];
      const r = p?.components.ranged, w = r?.weapon ? service(rt, 'projectiles')?.weapon(r.weapon, r.tier) : null;
      for (const shot of q) {
        const t = rt.entity(shot.target);
        if (!t || !combat(rt)?.alive(t)) continue;
        const roll = rt.random();
        if (roll < shot.chance) {
          const crit = rt.random() < config.critChance + statOf(rt, p, 'stat.crit');
          const out = combat(rt).hit(t, { amount: (w?.damage ?? config.damage) * (crit ? config.critMult : 1), type: w?.type ?? undefined, by: p.id, source: 'aim', dir: posOf(t) && posOf(p) ? sub(posOf(t), posOf(p)) : undefined });
          rt.emit('aim_shot', { who: p.id, target: t.id, chance: shot.chance, crit, damage: out.damage ?? 0 });
        } else rt.emit('aim_miss', { who: p.id, target: t.id, chance: shot.chance });
      }
    };
    const end = () => { if (!s().active) return; if (config.mode === 'mark') execute(); s().active = false; s().queue = []; rt.emit('aim_end', { who: 'player' }); sync(); };
    rt.action('aim', (v, rt) => { if (s().active) end(); else start(); });
    rt.action('mark', (v, rt) => {
      const p = rt.player(); if (!p || !s().active) return;
      if (s().queue.length >= config.maxShots) return;
      const t = typeof v === 'string' ? rt.entity(v) : pick(p);
      if (!t || distance(rt, p, t) > config.range || !hostile(rt, p, t)) return;
      if (!pay(p, config.cost)) { rt.emit('aim_no_points', { who: p.id }); return; }
      const c = round(chance(p, t), 1e4); s().queue.push({ target: t.id, chance: c });
      rt.emit('aim_marked', { who: p.id, target: t.id, chance: c, queued: s().queue.length }); sync();
    });
    rt.action('execute', (v, rt) => { if (!s().active) return; if (config.mode === 'queue') execute(); end(); });
    rt.system('rules', rt => {
      const x = s();
      if (x.active) { x.t++; if (config.maxSec && x.t >= config.maxSec * 60) end(); }
      else if (!res() && x.points < config.points) x.points = Math.min(config.points, x.points + config.regen / 60);
      sync();
    }, KEY);
  },
};
