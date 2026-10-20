// Gliding (paraglider, wing-suit, cape, umbrella): while airborne and falling,
// holding glide caps the fall speed and carries you forward at glide speed.
// It drains stamina. Updraft cells or zones give lift.
import { round6, bodyOf, intent, installOverlay, integrate, pool, canSpend, hasAbility, verbs, ensureShared, steerPlane, zoneTags, probe, canProbe, boxOf, COMMON_PARAMS, norm } from './move-lib-core.js';

const ID = 'gameplay.move.glide';

function envelope(config, abilities = new Set()) {
  const ok = !config.ability || abilities.has(config.ability);
  return { mode: 'continuous', glideRatio: ok ? round6(config.speed / config.fallSpeed) : 0, glide: ok };
}

export default {
  id: ID,
  card: {
    intent: 'Glide while falling: hold glide (or jump) in the air to cap your fall speed and sail forward, spending stamina; updraft cells or zones lift you. Gate it behind an ability to make it a progression unlock.',
    views: ['3p', '1p', 'side', 'iso'],
    params: {
      fallSpeed: { type: 'number', min: 0.5, max: 6, default: 2.8, unit: 'units/s', effect: 'maximum sink speed while gliding' },
      speed: { type: 'number', min: 0.5, max: 40, default: 7, unit: 'units/s', effect: 'horizontal glide speed' },
      accel: { type: 'number', min: 0.5, max: 60, default: 6, unit: 'units/s²', effect: 'steering response in the air' },
      staminaCost: { type: 'number', min: 0, max: 100, default: 6, unit: '/s', effect: 'stamina per second gliding' },
      pool: { type: 'string', default: 'stamina', effect: 'gameplay.resource pool for the cost' },
      minFall: { type: 'number', min: 0, max: 30, default: 0.5, unit: 'units/s', effect: 'must be falling at least this fast to deploy' },
      jumpHolds: { type: 'boolean', default: true, effect: 'holding jump while falling also glides' },
      updraft: { type: 'number', min: 0, max: 30, default: 6, unit: 'units/s', effect: 'rise speed inside updraft cells/zones' },
      updraftTags: { type: 'list', of: { type: 'string' }, default: ['updraft'], effect: 'cell/zone tags that lift a glider' },
      ability: { type: 'string', default: '', effect: 'ability required (via unlock_ability grants); empty = always' },
      ...COMMON_PARAMS,
    },
    provides: { events: ['glide_start', 'glide_end'], actions: ['glide', 'jump'] },
    requires: { capabilities: ['position', 'gravity'] },
    optional: { capabilities: ['editCells', 'raycast'] },
    envelope,
  },
  envelope,
  install(rt, c, instance) {
    verbs(rt, ['glide', 'jump']);
    const lifted = (e, api) => {
      const b = boxOf(api, e), mid = b.min.map((m, i) => m + b.size[i] / 2);
      return (canProbe(api) && probe(rt, api, mid).tags.some(t => c.updraftTags.includes(t))) || zoneTags(rt, e, mid).some(t => c.updraftTags.includes(t));
    };
    ensureShared(rt, { speed: c.speed });
    installOverlay(rt, c, instance, {
      id: ID, mode: 'glide', pri: 20,
      wants(e, api, fr, s, active) {
        if (fr.up === null) return false;
        const b = bodyOf(e);
        if (b.grounded) { s.endReason = 'landed'; return false; }
        if (c.ability && !hasAbility(rt, e, c.ability)) return false;
        const it = intent(rt, e, api, fr), ctl = it.ctl;
        const hold = ctl ? ctl.down('glide') || (c.jumpHolds && ctl.down('jump')) : Boolean(e.components.steer?.glide);
        if (!hold) { s.endReason = 'released'; return false; }
        const stam = c.staminaCost > 0 ? pool(rt, e, c.pool) : null;
        if (!canSpend(stam, c.staminaCost * rt.dt)) { s.endReason = 'stamina'; return false; }
        if (!active && b.vel[fr.up] * fr.upSign > -c.minFall && !lifted(e, api)) return false;
        return true;
      },
      start(e) { rt.emit('glide_start', { who: e.id }); },
      end(e, api, s, reason) { rt.emit('glide_end', { who: e.id, reason }); },
      step(e, api, fr, s) {
        const b = bodyOf(e), it = intent(rt, e, api, fr), dt = rt.dt, U = fr.up, up = fr.upSign;
        const stam = c.staminaCost > 0 ? pool(rt, e, c.pool) : null;
        if (stam) stam.spend(c.staminaCost * dt);
        // Glide forward along the stick, or keep heading along facing when the stick is idle.
        const dir = Math.hypot(...it.dir) > 0.1 ? norm(it.dir) : (b.dir ? fr.plane.reduce((d, i) => (d[i] = b.dir[i] ?? 0, d), [0, 0, 0]) : [0, 0, 0]);
        steerPlane(b, fr, dir.map(v => v * c.speed), c.accel * dt);
        let vy = b.vel[U] * up + fr.g[U] * up * dt;
        if (lifted(e, api)) vy = Math.min(c.updraft, vy + (c.updraft + fr.gmag) * dt);
        else vy = Math.max(vy, -c.fallSpeed);
        b.vel[U] = vy * up;
        integrate(rt, e, api, fr);
        b.state = 'glide';
      },
    });
  },
};
