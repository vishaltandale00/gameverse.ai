// Grapple hook and rope swing (Spider-Man, Bionic Commando, Arkham grapnel,
// Terraria hooks). Fire a hook along the aim with space.raycast. It attaches
// to solid cells (optionally only cells carrying anchor tags), then either swings
// as a pendulum on a rope you can reel in and out, or pulls you straight to the
// anchor. Release keeps your momentum.
import {
  round6, bodyOf, intent, installOverlay, integrate, hasAbility, verbs, boxOf, v3, add, sub, scale, dot, len, norm, motor, probe, canProbe, blockTags, COMMON_PARAMS,
} from './move-lib-core.js';

const ID = 'gameplay.move.grapple';

function envelope(config, abilities = new Set()) {
  const ok = !config.ability || abilities.has(config.ability);
  return { mode: 'continuous', grapple: ok ? config.range : 0, jumpHeight: ok ? config.range * 0.7 : 0, jumpGap: ok ? config.range * 1.4 : 0 };
}

export default {
  id: ID,
  card: {
    intent: 'Grapple hook: fire along the aim to hook a surface within range, then swing on the rope like a pendulum (reel in and out) or get pulled straight to the anchor. Release to fly off with your momentum. Anchors can be limited to tagged cells.',
    views: ['side', '3p', '1p'],
    actionSpace: { move: { type: 'vector', min: -1, max: 1 }, aim: { type: 'vector', min: -1, max: 1 } },
    params: {
      range: { type: 'number', min: 1, max: 200, default: 12, unit: 'units', effect: 'maximum hook distance' },
      ropeLen: { type: 'number', min: 1, max: 200, default: 10, unit: 'units', effect: 'longest rope while swinging' },
      minLen: { type: 'number', min: 0.5, max: 50, default: 1.5, unit: 'units', effect: 'shortest rope when reeling in' },
      style: { type: 'string', options: ['swing', 'pull'], default: 'swing', effect: 'swing: pendulum on a rope; pull: zip to the anchor' },
      pullSpeed: { type: 'number', min: 1, max: 100, default: 18, unit: 'units/s', effect: 'zip speed in pull style' },
      reelSpeed: { type: 'number', min: 0, max: 50, default: 4, unit: 'units/s', effect: 'rope length change with up/down while swinging' },
      swingAccel: { type: 'number', min: 0, max: 100, default: 8, unit: 'units/s²', effect: 'pumping force from the stick while swinging' },
      aim: { type: 'string', options: ['diagonal', 'input', 'up', 'facing'], default: 'diagonal', effect: 'diagonal: up and forward at 45°; input: stick (or axes.aim); up; facing' },
      anchorTags: { type: 'list', of: { type: 'string' }, default: [], effect: 'only cells with one of these tags take a hook (empty = any solid)' },
      releaseBoost: { type: 'number', min: 0, max: 3, default: 1.1, effect: 'velocity multiplier on release' },
      hold: { type: 'boolean', default: true, effect: 'release when the verb is let go; otherwise press again to release' },
      cooldown: { type: 'number', min: 0, max: 5, default: 0.25, unit: 's', effect: 'time between shots' },
      verb: { type: 'string', default: 'grapple', effect: 'input verb' },
      ability: { type: 'string', default: '', effect: 'ability required; empty = always' },
      ...COMMON_PARAMS,
    },
    provides: { events: ['grapple_fire', 'grapple_attach', 'grapple_miss', 'grapple_release'], actions: ['grapple'] },
    requires: { capabilities: ['position', 'raycast'] },
    optional: { capabilities: ['gravity', 'editCells'] },
    envelope,
  },
  envelope,
  validate(config) { return config.minLen > config.ropeLen ? [{ code: 'grapple_rope_order', field: 'minLen', message: 'minLen is longer than ropeLen' }] : []; },
  install(rt, c, instance) {
    verbs(rt, [c.verb]);
    const center = (api, e) => { const b = boxOf(api, e); return v3(b.min.map((m, i) => m + b.size[i] / 2)); };
    const aimDir = (e, fr, it) => {
      const V = fr.vert ?? 1, f = e.components.body?.dir ? v3(e.components.body.dir) : (() => { const d = [0, 0, 0]; d[fr.plane[0]] = 1; return d; })();
      const fwd = [0, 0, 0]; for (const i of fr.plane) fwd[i] = f[i]; const fl = len(fwd) || 1;
      const up = [0, 0, 0]; up[V] = fr.upSign || 1;
      if (c.aim === 'up') return up;
      if (c.aim === 'facing') return norm(fwd);
      if (c.aim === 'input') { const a = it.ctl?.aim; if (a) return norm(v3(a)); const d = v3(it.dir); d[V] += it.vert * (fr.upSign || 1); return len(d) > 0.2 ? norm(d) : norm(add(scale(fwd, 1 / fl), up)); }
      return norm(add(scale(fwd, 1 / fl), up));
    };
    installOverlay(rt, c, instance, {
      id: ID, mode: 'grapple', pri: 45,
      wants(e, api, fr, s, active) {
        const it = intent(rt, e, api, fr), ctl = it.ctl;
        if (active) {
          if (s.endReason) return false;
          if (c.hold ? !(ctl ? ctl.down(c.verb) : e.components.steer?.grapple) : ctl?.pressed(c.verb)) { s.endReason = 'released'; return false; }
          return true;
        }
        if (rt.state.time < (s.ready ?? -1)) return false;
        if (!(ctl ? ctl.pressed(c.verb) : e.components.steer?.grapple && !s.held)) { s.held = Boolean(e.components.steer?.grapple); return false; }
        s.held = true;
        if (c.ability && !hasAbility(rt, e, c.ability)) return false;
        s.ready = round6(rt.state.time + c.cooldown);
        const from = center(api, e), dir = aimDir(e, fr, it);
        rt.emit('grapple_fire', { who: e.id, dir: dir.map(round6) });
        const hit = api.raycast(from.slice(0, fr.dims), dir.slice(0, fr.dims), c.range);
        if (!hit || hit.hit !== 'cell') { rt.emit('grapple_miss', { who: e.id }); return false; }
        if (c.anchorTags.length) {
          const tags = hit.cell && api.getCell ? blockTags(rt, api.getCell(hit.cell)) : canProbe(api) && hit.at ? probe(rt, api, hit.at).tags : [];
          if (!tags.some(t => c.anchorTags.includes(t))) { rt.emit('grapple_miss', { who: e.id, reason: 'anchor' }); return false; }
        }
        s.anchor = v3(hit.at).map(round6); s.len = round6(Math.min(c.ropeLen, Math.max(c.minLen, hit.dist)));
        return true;
      },
      start(e, api, fr, s) { s.endReason = null; rt.emit('grapple_attach', { who: e.id, at: s.anchor, length: s.len }); },
      end(e, api, s, reason) {
        const b = bodyOf(e); b.vel = b.vel.map(v => round6(v * c.releaseBoost));
        rt.emit('grapple_release', { who: e.id, reason }); s.anchor = null;
      },
      step(e, api, fr, s) {
        const b = bodyOf(e), it = intent(rt, e, api, fr), dt = rt.dt, A = s.anchor;
        if (c.style === 'pull') {
          const to = sub(A, center(api, e)), d = len(to);
          if (d < 1) { s.endReason = 'arrived'; b.vel = scale(norm(to), c.pullSpeed * 0.3); b.state = 'grapple'; return; }
          b.vel = scale(norm(to), c.pullSpeed);
          const r = integrate(rt, e, api, fr);
          if (!r.moved) s.endReason = 'blocked';
          b.state = 'grapple'; return;
        }
        // Swing: gravity + pumping, then the rope constraint.
        if (fr.up !== null) b.vel[fr.up] += fr.g[fr.up] * dt;
        for (const i of fr.plane) b.vel[i] += (it.dir[i] ?? 0) * c.swingAccel * dt;
        const reel = it.ctl ? it.ctl.move[1] : it.vert;
        s.len = round6(Math.max(c.minLen, Math.min(c.ropeLen, s.len - reel * c.reelSpeed * dt)));
        integrate(rt, e, api, fr);
        const p = center(api, e), off = sub(p, A), dist = len(off);
        if (dist > s.len) {
          const n = scale(off, 1 / dist), fix = scale(n, s.len - dist);
          motor(rt, e, api, fix);
          const out = dot(b.vel, n); if (out > 0) b.vel = sub(b.vel, scale(n, out));
        }
        b.grounded = false;
        b.state = 'grapple';
      },
    });
  },
};
