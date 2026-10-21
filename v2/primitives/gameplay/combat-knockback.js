// gameplay.combat.knockback: platform-fighter damage. Entities with
// components.knockback = {percent, weight, stocks} take damage as percent instead
// of (or as well as) hit points, and every hit launches them with
//   v = (base + growth * percent) * (1.4 - weight * 0.06)   at `angle` degrees
// from the hit's kb triple [base, growth, angle] (melee frame data) or this
// instance's default. Launched entities fly with gravity and drag until their
// launch stun ends; leaving the blast zone (the `bounds` box, or the space's
// bounds capability) costs a stock, respawns with invulnerability, or KOs.
// Ported from the fighting kit's platform mode.
import { frames, grantInvuln, v3, add, posOf, facingSign, like, spaceOf, round, err, intercept, combat, displace } from './combat-lib.js';

const KEY = 'gameplay.combat.knockback';

export default {
  id: KEY,
  card: {
    loop: { verbs: [], progress: ['launched', 'stock_lost', 'blast_ko'] },
    intent: 'Platform-fighter knockback for any entity with a knockback component: damage builds percent, hits launch by [base, growth, angle] scaled by percent and weight, launched bodies fly and drift, and leaving the blast zone costs a stock (respawn with invulnerability) or KOs.',
    views: ['side'],
    params: {
      kb: { type: 'list', of: { type: 'number' }, default: [2, 0.04, 40], min: 3, max: 3, effect: 'default [base, growth per %, angle°] for hits without frame data' },
      percentPerDamage: { type: 'number', default: 0.1, min: 0, max: 10, unit: '%', effect: 'percent added per point of damage' },
      hpDamage: { type: 'boolean', default: false, effect: 'hits also reduce hit points (false: only percent and stocks matter)' },
      launchMin: { type: 'number', default: 3.4, min: 0, max: 100, effect: 'grounded hits below this knockback only flinch' },
      speedScale: { type: 'number', default: 0.6, min: 1e-6, max: 1e4, unit: 'units/s per kb', effect: 'world speed of one knockback unit' },
      gravity: { type: 'number', default: 20, min: 0, max: 1e4, unit: 'units/s²' },
      floor: { type: 'number', default: 0, unit: 'units', effect: 'ground height when the space has no gravity' },
      bounds: { type: 'object', fields: { min: { type: 'list', of: { type: 'number' }, min: 2, max: 3 }, max: { type: 'list', of: { type: 'number' }, min: 2, max: 3 } }, effect: 'blast zone box; omit to use the space bounds capability' },
      stocks: { type: 'integer', default: 3, min: 1, max: 99, effect: 'stocks per entity (components.knockback.stocks overrides)' },
      respawnAt: { type: 'list', of: { type: 'number' }, effect: 'respawn point; default the entity home' },
      respawnInvulnSec: { type: 'number', default: 2.6, min: 0, max: 30, unit: 's' },
      integrate: { type: 'boolean', default: true, effect: 'fly launched bodies here (off when the space or versus physics moves them)' },
    },
    provides: { events: ['launched', 'blast_ko', 'stock_lost', 'percent'], vars: ['percent', 'stocks'] },
    requires: { primitives: ['gameplay.combat.health'] },
  },
  validate(config) {
    const errors = [];
    if (config.bounds && config.bounds.min && config.bounds.max && config.bounds.min.some((v, i) => v >= config.bounds.max[i])) errors.push(err('knockback_bounds_invalid', 'with.bounds', 'bounds.min must be below bounds.max on every axis'));
    if (config.bounds && !(config.bounds.min && config.bounds.max)) errors.push(err('knockback_bounds_invalid', 'with.bounds', 'bounds needs min and max'));
    return errors;
  },
  install(rt, config) {
    const kc = e => { const k = e.components.knockback; k.percent ??= 0; k.weight ??= 5; k.stocks ??= config.stocks; k.launch ??= 0; return k; };
    const sync = e => { if (e.id === 'player') { rt.state.vars.percent = kc(e).percent; rt.state.vars.stocks = kc(e).stocks; } };
    /** Knockback magnitude and angle (radians) for entity e at its current percent. */
    const knock = (e, kb) => { const [b, g, ang] = kb, k = kc(e); return { v: (b + g * k.percent) * (1.4 - k.weight * 0.06), a: ang * Math.PI / 180 }; };
    const grounded = e => { const b = e.components.body; if (typeof b?.grounded === 'boolean') return b.grounded; return posOf(e)[1] <= config.floor + 1e-6; };

    intercept(rt, 12, (d, hit) => {
      if (!d.components.knockback || hit.source === 'status' || hit.blocked) return hit;
      const k = kc(d), a = hit.by ? rt.entity(hit.by) : null;
      const dmg = Math.max(0, combat(rt).mitigate(d, { ...hit, amount: hit.amount ?? 0 }));
      k.percent = round(k.percent + dmg * config.percentPerDamage, 10);
      rt.emit('percent', { who: d.id, percent: k.percent, by: hit.by ?? null });
      const kb = knock(d, hit.kb ?? config.kb), spike = kb.a < 0, wasAir = !grounded(d);
      const away = a && posOf(a) && posOf(d) ? Math.sign(posOf(d)[0] - posOf(a)[0]) || facingSign(a) : Math.sign(v3(hit.dir)[0]) || 1;
      const out = { ...hit, amount: config.hpDamage ? hit.amount : 0, raw: !config.hpDamage ? true : hit.raw, nonLethal: !config.hpDamage || hit.nonLethal, knockback: 0, launch: null };
      if (!wasAir && kb.v < config.launchMin && !spike && !hit.knockdown && !hit.launch) {
        out.stun = Math.max(8, Math.round((hit.stun ?? 16) * 0.7)); out.stunKind = 'hit';
        displace(rt, d, [away * kb.v * 0.9 * config.speedScale / 10, 0, 0]);
      } else {
        const b = (d.components.body ??= {}), s = kb.v * config.speedScale;
        const v = [Math.cos(kb.a) * s * away, Math.sin(kb.a) * s * (spike && !wasAir ? -0.4 : 1), 0], api = spaceOf(rt, d);
        if (api?.setVelocity) api.setVelocity(d, v, rt); else b.vel = like(Array.isArray(b.vel) ? b.vel : [0, 0], v);
        b.grounded = false;
        k.launch = Math.min(60, Math.round(kb.v * 2.6));
        out.stun = k.launch; out.stunKind = 'launch';
        if (d.components.versus) d.components.versus.st = 'launch';
        const p = posOf(d); if (!spike && p[1] <= config.floor) { p[1] = config.floor + 0.02; rt.space(d.space).setPos?.(d, like(d.at, p), rt); }
        rt.emit('launched', { who: d.id, by: hit.by ?? null, v: round(kb.v, 1e3), angle: hit.kb?.[2] ?? config.kb[2], percent: k.percent });
      }
      sync(d);
      return out;
    }, KEY);

    const boundsOf = e => {
      if (config.bounds?.min) return { min: v3(config.bounds.min), max: v3(config.bounds.max).map((v, i) => (config.bounds.max.length === 2 && i === 2 ? Infinity : v)) };
      const api = spaceOf(rt, e);
      if (api?.bounds && !api.config?.blast) { const b = api.bounds(); const lo = v3(b.min), hi = v3(b.max); if (b.min.length === 2) { lo[2] = -Infinity; hi[2] = Infinity; } return { min: lo, max: hi }; }
      if (api?.size) return { min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] };
      return null;
    };
    /** Leaving the blast zone: lose a stock and respawn invulnerable, or be KO'd on the last stock. */
    const ko = e => {
      const k = kc(e);
      k.stocks--;
      rt.emit('blast_ko', { who: e.id, percent: k.percent, at: e.at, stocks: k.stocks });
      rt.emit('stock_lost', { who: e.id, stocks: k.stocks });
      if (k.stocks > 0) {
        const at = config.respawnAt ?? e.components.health?.home ?? e.at;
        rt.space(e.space).setPos?.(e, like(e.at, v3(at)), rt);
        k.percent = 0; k.launch = 0;
        const api = spaceOf(rt, e);
        if (api?.setVelocity) api.setVelocity(e, [0, 0, 0], rt); else if (e.components.body) e.components.body.vel = like(Array.isArray(e.components.body.vel) ? e.components.body.vel : [0, 0], [0, 0, 0]);
        if (e.components.health) { grantInvuln(e, frames(config.respawnInvulnSec)); e.components.health.stun = 0; }
        if (e.components.versus) e.components.versus.st = 'free';
      } else combat(rt)?.kill(e, { by: e.components.health?.lastBy ?? null, source: 'blast' });
      sync(e);
    };
    // Spaces with their own blast rect (arena2d `blast`) report it with `blasted`.
    rt.on('blasted', ({ who }) => { const e = rt.entity(who); if (e?.components.knockback && !e.components.health?.dead && !config.bounds) ko(e); });
    rt.system('physics', rt => {
      for (const e of Object.values(rt.state.entities)) {
        if (!e.components.knockback || !Array.isArray(e.at) || e.components.health?.dead) continue;
        const k = kc(e);
        if (k.launch > 0) {
          k.launch--;
          const charDriven = rt.has('engine.physics.character') && (e.components.body?.controller === 'character' || (e.id === 'player' && e.components.body?.controller === undefined));
          if (config.integrate && !e.components.versus && !charDriven) {
            const b = e.components.body ??= {}, vel = v3(b.vel);
            vel[0] *= 0.955; vel[1] = vel[1] > 0 ? vel[1] * 0.97 : vel[1]; vel[1] -= config.gravity / 60;
            const p = add(posOf(e), [vel[0] / 60, vel[1] / 60, 0]);
            if (p[1] <= config.floor && !spaceOf(rt, e)?.gravityAt) { p[1] = config.floor; vel[1] = 0; b.grounded = true; }
            b.vel = like(Array.isArray(b.vel) ? b.vel : [0, 0], vel.map(v => round(v)));
            rt.space(e.space).setPos?.(e, like(e.at, p.map(v => round(v))), rt);
          }
        }
        const bz = boundsOf(e), p = posOf(e);
        if (bz && p.some((v, i) => v < bz.min[i] || v > bz.max[i])) ko(e);
      }
    }, KEY);
  },
};
