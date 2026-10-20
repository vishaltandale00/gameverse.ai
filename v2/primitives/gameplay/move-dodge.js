// Dodge roll / dash / backstep with invulnerability frames, stamina cost and
// recovery, for any entity in any continuous space (3D, side, top-down).
// I-frames are published as components.move.invulnerableFrom/Until (state
// time) and body.iframes (true inside the window). Combat primitives
// should ignore hits while body.iframes is true.
import { round6, mv, bodyOf, intent, installOverlay, integrate, pool, canSpend, hasAbility, verbs, len, norm, COMMON_PARAMS, project, travelAlong } from './move-lib-core.js';

const ID = 'gameplay.move.dodge';

function envelope(config) { return { mode: 'continuous', dash: config.distance, dodge: true }; }

export default {
  id: ID,
  card: {
    intent: 'Dodge: a roll, dash or backstep that covers a set distance over a set time with an invulnerability window, costs stamina, and leaves a short recovery. Direction comes from the stick, the facing, or always backwards.',
    views: ['3p', 'side', 'td', 'iso', '1p'],
    actionSpace: { move: { type: 'vector', min: -1, max: 1, kind: 'continuous' } },
    params: {
      distance: { type: 'number', min: 0.2, max: 30, default: 3, unit: 'units', effect: 'distance covered' },
      sec: { type: 'number', min: 0.05, max: 2, default: 0.45, unit: 's', effect: 'duration of the move' },
      iframes: { type: 'list', of: { type: 'number', min: 0, max: 2 }, default: [0.05, 0.3], min: 2, max: 2, unit: 's', effect: '[from, until] seconds after the start during which hits are ignored' },
      cost: { type: 'number', min: 0, max: 200, default: 0, effect: 'stamina per dodge' },
      pool: { type: 'string', default: 'stamina', effect: 'gameplay.resource pool for the cost' },
      directions: { type: 'string', options: ['any', 'back', 'facing'], default: 'any', effect: 'any: stick direction (backstep with no stick); back: always away from facing; facing: always forward' },
      curve: { type: 'string', options: ['ease', 'constant'], default: 'ease', effect: 'ease: fast start, slowing to a stop (roll); constant: even speed (dash)' },
      backstep: { type: 'number', min: 0, max: 1, default: 0.6, effect: 'distance fraction of a backstep (no stick, directions=any)' },
      recovery: { type: 'number', min: 0, max: 2, default: 0.15, unit: 's', effect: 'time after the move with no control' },
      cooldown: { type: 'number', min: 0, max: 5, default: 0.1, unit: 's', effect: 'time before the next dodge after recovery' },
      air: { type: 'boolean', default: false, effect: 'allow dodging in the air' },
      verb: { type: 'string', default: 'dodge', effect: 'input verb that triggers it' },
      ability: { type: 'string', default: '', effect: 'ability required; empty = always' },
      ...COMMON_PARAMS,
    },
    provides: { events: ['dodged', 'dodge_end'], actions: ['dodge'] },
    requires: { capabilities: ['position'] },
    optional: { capabilities: ['gravity'] },
    envelope,
  },
  envelope,
  /** Verifier travel macro: drive this controller along a space path in real steps; true when it arrived. */
  travel: (rt, path, config, instance) => travelAlong(rt, path, {}),
  validate(config) {
    const [a, b] = config.iframes || [];
    if (a > b) return [{ code: 'dodge_iframes_order', field: 'iframes', message: `iframes start ${a} is after end ${b}` }];
    if (b > config.sec + config.recovery) return [{ code: 'dodge_iframes_long', field: 'iframes', message: 'iframes outlast the dodge and its recovery', hint: `end ≤ ${config.sec + config.recovery}` }];
    return [];
  },
  install(rt, c, instance) {
    verbs(rt, [c.verb]);
    rt.system('late', rt => {
      for (const e of Object.values(rt.state.entities)) {
        const m = e.components.move; if (m?.invulnerableUntil == null || !e.components.body) continue;
        const t = rt.state.time; e.components.body.iframes = t >= (m.invulnerableFrom ?? -1) && t < m.invulnerableUntil;
      }
    }, ID);
    installOverlay(rt, c, instance, {
      id: ID, mode: 'dodge', pri: 50,
      wants(e, api, fr, s, active) {
        if (active) { const going = s.t < c.sec + c.recovery; if (!going) s.endReason = 'done'; return going; }
        if (rt.state.time < (s.ready ?? -1)) return false;
        const it = intent(rt, e, api, fr), ctl = it.ctl;
        const press = ctl ? ctl.pressed(c.verb) : Boolean(e.components.steer?.dodge);
        if (!press) return false;
        if (c.ability && !hasAbility(rt, e, c.ability)) return false;
        if (!c.air && fr.up !== null && !bodyOf(e).grounded) return false;
        const stam = c.cost > 0 ? pool(rt, e, c.pool) : null;
        if (stam && !canSpend(stam, c.cost)) { rt.emit('dodge_failed', { who: e.id, reason: 'stamina' }); return false; }
        if (stam) stam.spend(c.cost);
        const facing = e.components.body?.dir ? project(fr, e.components.body.dir) : (() => { const d = [0, 0, 0]; d[fr.plane[0]] = 1; return d; })();
        let dir, frac = 1;
        if (c.directions === 'back') dir = facing.map(v => -v);
        else if (c.directions === 'facing') dir = facing;
        else if (len(it.dir) > 0.2) dir = norm(it.dir);
        else { dir = facing.map(v => -v); frac = c.backstep; }
        s.dir = norm(dir).map(round6); s.frac = frac; s.t = 0;
        return true;
      },
      start(e, api, fr, s) {
        const m = mv(e), t = rt.state.time;
        m.invulnerableFrom = round6(t + c.iframes[0]); m.invulnerableUntil = round6(t + c.iframes[1]);
        rt.emit('dodged', { who: e.id, dir: s.dir, backstep: s.frac < 1 });
      },
      end(e, api, s, reason) { s.ready = round6(rt.state.time + c.cooldown); rt.emit('dodge_end', { who: e.id, reason }); },
      step(e, api, fr, s) {
        const b = bodyOf(e), d = c.distance * s.frac, t = s.t - rt.dt;
        let v = 0;
        if (t < c.sec) v = c.curve === 'constant' ? d / c.sec : (2 * d / c.sec) * (1 - (t + rt.dt / 2) / c.sec);
        for (const i of fr.plane) b.vel[i] = (s.dir[i] ?? 0) * v;
        if (fr.up !== null) { b.vel[fr.up] += fr.g[fr.up] * rt.dt; }
        integrate(rt, e, api, fr);
        b.state = 'dodge';
      },
    });
  },
};
