// gameplay.score: points by event, multipliers and bonuses, into var `score`.
//   points[]  {on: event, points: n | "data" (the event's own points), when?}
//   chains[]  combos/chains: geometric (maze eat chain 200·2^min(n,3)), step
//             (shmup chain multiplier min(cap, 1 + floor(n/divisor)) on all
//             points), linear; each with a window, reset events and scope.
//   nearMiss  hostile shots or bodies passing close without a hit score points
//             (and can request a short slow-motion via var time.scale).
//   zones     zone multipliers while the player is inside.
//   timeBonus points for time left when an event fires (stage clear).
//   stars     thresholds -> var stars; high score -> var score.high.
// Every award multiplies by the vars in multVars (powerups write score.mult).
import { frames, sub, len, posOf, centerOf, hostile, round, err } from './combat-lib.js';

const KEY = 'gameplay.score';
const KINDS = ['geometric', 'step', 'linear'];

export default {
  id: KEY,
  card: {
    intent: 'Scoring: points by event, chain/combo multipliers (maze eat chain 200·2^n, shmup chain 1+chain/6 up to 8), near-miss bonuses, zone multipliers, time bonus, stars, and high score; owns the add_score {amount, reason?, who?} effect and the score var.',
    views: ['any'],
    params: {
      var: { type: 'string', default: 'score' },
      points: { type: 'list', default: [], of: { type: 'object', fields: { on: { type: 'string', required: true }, points: { type: 'json', default: 'data', effect: 'a number, or "data" for the event’s points field' }, when: { type: 'predicate' }, mult: { type: 'boolean', default: true }, chain: { type: 'string', effect: 'chain whose value this award uses (geometric chains)' } } } },
      chains: { type: 'list', default: [], of: { type: 'object', fields: {
        id: { type: 'string', required: true }, on: { type: 'list', of: { type: 'string' }, min: 1 }, kind: { type: 'string', options: KINDS, default: 'step' },
        base: { type: 'number', default: 200 }, growth: { type: 'number', default: 2 }, cap: { type: 'number', default: 8 }, divisor: { type: 'number', default: 6, min: 1 },
        window: { type: 'number', default: 0, min: 0, unit: 's', effect: 'the chain breaks after this long without a link (0 = never)' },
        resetOn: { type: 'list', of: { type: 'string' }, default: [] },
      } } },
      nearMiss: { type: 'object', fields: { radius: { type: 'number', default: 1, min: 0 }, points: { type: 'number', default: 50, min: 0 }, of: { type: 'string', options: ['projectiles', 'hostiles', 'both'], default: 'both' }, slowmoSec: { type: 'number', default: 0, min: 0 }, slowmo: { type: 'number', default: 0.5, min: 0.05, max: 1 }, cooldownSec: { type: 'number', default: 1.6, min: 0 } } },
      zones: { type: 'list', default: [], of: { type: 'object', fields: { zone: { type: 'ref', to: 'zone', required: true }, mult: { type: 'number', default: 2, min: 0 } } } },
      timeBonus: { type: 'object', fields: { on: { type: 'string', required: true }, parSec: { type: 'number', default: 60, min: 0 }, perSec: { type: 'number', default: 100, min: 0 }, startOn: { type: 'string', effect: 'event that restarts the clock (default: game start)' } } },
      stars: { type: 'list', of: { type: 'number' }, default: [], effect: 'score thresholds for 1, 2, 3... stars' },
      high: { type: 'number', default: 0, min: 0, effect: 'high score to beat' },
      multVars: { type: 'list', of: { type: 'string' }, default: ['score.mult'] },
      combo: { type: 'object', fields: { window: { type: 'number', default: 1.4, min: 0.05 }, every: { type: 'integer', default: 5, min: 1 } }, effect: 'counts scored events in quick succession; emits combo every N' },
    },
    provides: { events: ['scored', 'chain', 'chain_broken', 'near_miss', 'high_score', 'stars', 'combo'], vars: ['score', 'score.high', 'stars', 'score.chain', 'score.mult.chain'] },
  },
  logic(logic) {
    // Frozen contract (KERNEL_API §2): add_score {amount, reason?, who?}; `mult: false` skips multipliers.
    logic.effect('add_score', { check: (e, path, errors) => { if (!Number.isFinite(e.amount)) errors.push(err('effect_invalid', `${path}.amount`, 'amount must be a number')); }, run: (e, rt, c) => rt.service('score').add(e.amount, { mult: e.mult !== false, on: e.reason ?? 'effect', who: e.who ?? c.self ?? null }) });
  },
  validate(config) {
    const errors = [], ids = new Set();
    config.chains.forEach((c, i) => { if (ids.has(c.id)) errors.push(err('score_chain_duplicate', `with.chains[${i}].id`, `duplicate chain '${c.id}'`)); ids.add(c.id); if (!c.on?.length) errors.push(err('score_chain_invalid', `with.chains[${i}].on`, 'a chain needs at least one event')); });
    config.points.forEach((p, i) => {
      if (p.points !== 'data' && !Number.isFinite(p.points)) errors.push(err('score_points_invalid', `with.points[${i}].points`, 'points must be a number or "data"'));
      if (p.chain && !ids.has(p.chain)) errors.push(err('score_chain_unknown', `with.points[${i}].chain`, `unknown chain '${p.chain}'`));
    });
    if (config.stars.some((v, i, a) => i && v <= a[i - 1])) errors.push(err('score_stars_order', 'with.stars', 'star thresholds must increase'));
    return errors;
  },
  install(rt, config) {
    const S = () => { const s = rt.store(KEY); s.chains ??= {}; s.high ??= config.high; s.near ??= {}; s.clock ??= 0; s.combo ??= 0; s.comboT ??= 0; s.slowT ??= 0; s.cd ??= 0; return s; };
    const chainOf = id => { const c = (S().chains[id] ??= { n: 0, t: 0 }); return c; };
    const defs = new Map(config.chains.map(c => [c.id, c]));
    const multOf = c => { const n = chainOf(c.id).n; return c.kind === 'step' ? Math.min(c.cap, 1 + Math.floor(n / c.divisor)) : c.kind === 'linear' ? Math.min(c.cap, 1 + n * c.growth) : 1; };
    const globalMult = () => {
      let m = 1;
      for (const c of config.chains) if (c.kind !== 'geometric') m *= multOf(c);
      for (const v of config.multVars) if (rt.state.vars[v] !== undefined) m *= rt.state.vars[v];
      const p = rt.player();
      for (const z of config.zones) if (p?.zone === z.zone) m *= z.mult;
      return m;
    };
    const sync = () => {
      const s = S(), score = rt.state.vars[config.var] ?? 0;
      rt.state.vars[config.var] = score;
      if (score > s.high) { if (!s.beat && s.high > 0) rt.emit('high_score', { score }); s.beat = true; s.high = score; }
      rt.state.vars['score.high'] = s.high;
      const stars = config.stars.filter(t => score >= t).length;
      if (config.stars.length && stars !== rt.state.vars.stars) { rt.state.vars.stars = stars; rt.emit('stars', { stars }); }
      const step = config.chains.find(c => c.kind !== 'geometric');
      if (step) { rt.state.vars['score.chain'] = chainOf(step.id).n; rt.state.vars['score.mult.chain'] = multOf(step); }
    };
    const api = {
      add(points, { mult = true, on = null, base = points, who = null } = {}) {
        const m = mult ? globalMult() : 1, total = Math.round(points * m);
        rt.state.vars[config.var] = Math.max(0, (rt.state.vars[config.var] ?? 0) + total);
        if (total) {
          rt.emit('scored', { points: total, amount: total, base, mult: round(m, 1e3), on, reason: on, who });
          if (config.combo) { const s = S(); s.combo = s.comboT > 0 ? s.combo + 1 : 1; s.comboT = frames(config.combo.window); if (s.combo % config.combo.every === 0) rt.emit('combo', { count: s.combo }); }
        }
        sync(); return total;
      },
      mult: globalMult,
      chain: id => chainOf(id).n,
      high: () => S().high,
    };
    rt.provide('score', api);
    // Chains advance before point rules read them (handlers registered first run first).
    for (const c of config.chains) {
      for (const ev of c.on) rt.on(ev, d => {
        const ch = chainOf(c.id);
        if (c.window && ch.t <= 0 && ch.n) ch.n = 0;
        ch.pending = ch.n; ch.n++; ch.t = frames(c.window);
        rt.emit('chain', { chain: c.id, count: ch.n, mult: c.kind === 'geometric' ? Math.pow(c.growth, Math.min(ch.pending, c.cap)) : multOf(c) });
      });
      for (const ev of c.resetOn) rt.on(ev, () => { const ch = chainOf(c.id); if (ch.n) rt.emit('chain_broken', { chain: c.id, count: ch.n }); ch.n = 0; ch.t = 0; });
    }
    for (const p of config.points) rt.on(p.on, d => {
      if (p.when && !rt.test(p.when, { self: d.who ?? d.by })) return;
      const c = p.chain ? defs.get(p.chain) : null;
      let pts = p.points === 'data' ? Number(d.points) || 0 : p.points;
      if (c?.kind === 'geometric') pts = (p.points === 'data' && d.points ? pts : c.base) * Math.pow(c.growth, Math.min(chainOf(c.id).pending ?? 0, c.cap));
      api.add(pts, { mult: p.mult, on: p.on });
    });
    if (config.timeBonus) {
      const tb = config.timeBonus;
      if (tb.startOn) rt.on(tb.startOn, () => { S().clock = rt.state.frame; });
      rt.on(tb.on, () => { const sec = (rt.state.frame - S().clock) / 60, bonus = Math.max(0, Math.round((tb.parSec - sec) * tb.perSec)); if (bonus) api.add(bonus, { mult: false, on: 'time_bonus' }); });
    }
    rt.system('late', rt => {
      const s = S();
      for (const c of config.chains) { const ch = chainOf(c.id); if (c.window && ch.t > 0 && --ch.t === 0 && ch.n) { rt.emit('chain_broken', { chain: c.id, count: ch.n }); ch.n = 0; } }
      if (s.comboT > 0 && --s.comboT === 0) s.combo = 0;
      if (s.slowT > 0 && --s.slowT === 0) rt.state.vars['time.scale'] = 1;
      if (s.cd > 0) s.cd--;
      const nm = config.nearMiss, p = rt.player();
      if (nm && p && posOf(p) && !p.components.health?.dead) {
        for (const e of Object.values(rt.state.entities)) {
          if (e.id === p.id || e.space !== p.space || !posOf(e)) continue;
          const shot = e.components.projectile, body = e.components.health && !e.components.health.dead && hostile(rt, e, p);
          if (!((shot && nm.of !== 'hostiles' && shot.team !== 'player') || (body && nm.of !== 'projectiles'))) continue;
          const d = len(sub(centerOf(rt, e), centerOf(rt, p))), r = nm.radius + (shot?.radius ?? 0.5);
          const k = s.near[e.id];
          if (d <= r && !k) s.near[e.id] = { hp: p.components.health?.hp ?? 0 };
          else if (d > r && k) {
            delete s.near[e.id];
            if ((p.components.health?.hp ?? 0) >= k.hp) {
              api.add(nm.points, { on: 'near_miss' }); rt.emit('near_miss', { who: p.id, of: e.id });
              if (nm.slowmoSec && s.cd === 0) { s.slowT = frames(nm.slowmoSec); s.cd = frames(nm.cooldownSec); rt.state.vars['time.scale'] = nm.slowmo; }
            }
          }
        }
        for (const id of Object.keys(s.near)) if (!rt.entity(id)) delete s.near[id];
      }
      sync();
    }, KEY);
    rt.on('game_start', () => { S().clock = 0; sync(); });
  },
};
