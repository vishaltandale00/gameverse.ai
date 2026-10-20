// gameplay.launcher: one-projectile-per-turn launchers for any 2D space.
// cannon (Peggle): aim an angle around `forward` and fire at fixed speed.
// sling (Angry Birds): pull back from the pouch (≤ maxPull) and release; launch
// speed scales with the pull (power 0.2..1).
// Shots come from a queue of archetypes with abilities used mid-flight:
// split (two extra ±0.2 rad), boost (×2.1), heavy (dive: vx×0.35, +24 down,
// mass ×2.5), bomb (blast r 3.6 strength 15; also 0.9 s after the first hit).
// A turn ends when every projectile is gone, has come to rest (quiet 0.35 s after
// 1.2 s) or flew 9 s; then the next shot is ready. Physics spaces fly the
// projectiles; motion 'self' integrates them (gravity + collide-and-slide) and
// reports `contact` like a physics space, so destructibles react the same.
import { centerOf, placeCenter, velOf, setVel, stepSelf, explode, massOf } from './puzzle-lib-body.js';

const ID = 'gameplay.launcher';
export const ABILITIES = ['normal', 'split', 'boost', 'bomb', 'heavy'];
const rotate = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

export default {
  id: ID,
  card: {
    intent: 'Cannon or slingshot launcher: aim/pull and fire one projectile per turn from a shot queue, with mid-flight abilities (split, boost, bomb, heavy dive) and turn end when the shot settles.',
    views: ['side', 'td'],
    params: {
      mode: { type: 'string', default: 'cannon', options: ['cannon', 'sling'], effect: 'cannon: aim + fixed speed; sling: pull vector sets direction and power' },
      origin: { type: 'list', required: true, min: 2, max: 3, of: { type: 'number' }, effect: 'muzzle / pouch position (space units)' },
      forward: { type: 'list', default: [0, -1], min: 2, max: 2, of: { type: 'number', min: -1, max: 1 }, effect: 'unit direction at aim 0; aim rotates it counter-clockwise' },
      aim: { type: 'list', default: [-1.45, 1.45], min: 2, max: 2, of: { type: 'number', min: -3.2, max: 3.2 }, effect: '[min, max] aim angle (rad)' },
      aimSpeed: { type: 'number', default: 0.85, min: 0, max: 10, unit: 'rad/s', effect: 'aim change per second for aim_left/aim_right' },
      speed: { type: 'number', default: 13, min: 0.1, max: 500, unit: 'u/s', effect: 'launch speed (sling: at full pull)' },
      maxPull: { type: 'number', default: 1.9, min: 0.1, max: 50, effect: 'sling pull length for full power' },
      muzzle: { type: 'number', default: 0, min: 0, max: 20, effect: 'spawn this far along the launch direction' },
      shots: { type: 'list', required: true, min: 1, max: 200, of: { type: 'object', fields: { archetype: { type: 'ref', to: 'archetype', required: true }, ability: { type: 'string', default: 'normal', options: ABILITIES }, count: { type: 'integer', default: 1, min: 1, max: 100 } } }, effect: 'shot queue in order' },
      motion: { type: 'string', default: 'space', options: ['space', 'self'], effect: 'space: physics space flies projectiles; self: integrate here' },
      restitution: { type: 'number', default: 0.3, min: 0, max: 1, effect: 'self motion bounce' },
      quietMin: { type: 'number', default: 1.2, min: 0, max: 60, unit: 's', effect: 'earliest turn end by coming to rest' },
      quietSec: { type: 'number', default: 0.35, min: 0, max: 10, unit: 's', effect: 'rest time that ends the turn' },
      maxFlight: { type: 'number', default: 9, min: 0.5, max: 120, unit: 's', effect: 'turn ends after this flight time' },
      bounds: { type: 'list', default: [], max: 4, of: { type: 'number' }, effect: '[minX, minY, maxX, maxY]: projectiles leaving it are removed' },
      bomb: { type: 'object', default: { r: 3.6, strength: 15, fuse: 0.9 }, fields: { r: { type: 'number', default: 3.6, min: 0.1, max: 100 }, strength: { type: 'number', default: 15, min: 0, max: 1000 }, fuse: { type: 'number', default: 0.9, min: 0, max: 30 } }, effect: 'bomb blast radius, strength, fuse after first hit (s)' },
      onEmpty: { type: 'effects', default: [], effect: 'run when the last shot has ended' },
    },
    provides: { events: ['launched', 'launched:*', 'ability_used', 'ability_used:*', 'shot_end', 'shots_empty', 'explosion', 'contact', 'move'], vars: ['launcher.shots', 'launcher.aim', 'launcher.power'], actions: ['aim', 'aim_left', 'aim_right', 'pull', 'power', 'fire', 'ability'] },
    requires: { capabilities: ['position'] },
  },
  validate(config) {
    const errors = [];
    if (Math.abs(Math.hypot(...config.forward) - 1) > 0.01) errors.push({ code: 'launcher_forward', path: 'with.forward', message: 'forward must be a unit vector' });
    if (config.aim[0] > config.aim[1]) errors.push({ code: 'launcher_aim', path: 'with.aim', message: 'aim is [min, max]' });
    if (config.bounds.length && config.bounds.length !== 4) errors.push({ code: 'launcher_bounds', path: 'with.bounds', message: 'bounds is [minX, minY, maxX, maxY]' });
    return errors;
  },
  install(rt, config, instance) {
    const spaceId = instance.space ?? rt.doc.spaces[0].id, st = () => rt.store(ID), api = () => rt.space(spaceId);
    const queue = config.shots.flatMap(s => Array.from({ length: s.count }, () => ({ archetype: s.archetype, ability: s.ability })));
    function init() {
      const s = st(); if (s.phase) return;
      Object.assign(s, { phase: 'aim', next: 0, aim: Math.max(config.aim[0], Math.min(config.aim[1], 0)), power: 1, active: [], flightT: 0, quietT: 0, firstHit: -1, ability: false, shot: null, memo: {} });
      vars(s);
    }
    const vars = s => { rt.state.vars['launcher.shots'] = queue.length - s.next; rt.state.vars['launcher.aim'] = +s.aim.toFixed(4); rt.state.vars['launcher.power'] = +s.power.toFixed(4); };
    const clampAim = a => Math.max(config.aim[0], Math.min(config.aim[1], a));
    function fire(s) {
      if (s.phase !== 'aim' || s.next >= queue.length) return false;
      const shot = queue[s.next++], dir = rotate(config.forward, s.aim), sp = config.speed * (config.mode === 'sling' ? Math.max(0.2, Math.min(1, s.power)) : 1);
      const a = api(), e = rt.spawn(shot.archetype, { space: spaceId, at: config.origin.slice(), components: { launcher: { ability: shot.ability } } });
      placeCenter(rt, a, e, [config.origin[0] + dir[0] * config.muzzle, config.origin[1] + dir[1] * config.muzzle]);
      setVel(rt, a, e, [dir[0] * sp, dir[1] * sp]);
      Object.assign(s, { phase: 'flight', active: [e.id], flightT: 0, quietT: 0, firstHit: -1, ability: shot.ability !== 'normal', shot: shot.ability, memo: {} });
      rt.emitTyped('launched', shot.ability, { id: e.id, archetype: shot.archetype, aim: s.aim, power: s.power, speed: sp });
      rt.emit('move', { kind: 'shot' });
      vars(s);
      return true;
    }
    function useAbility(s) {
      const b = rt.entity(s.active[0]); if (!b || !s.ability) return;
      s.ability = false;
      const a = api(), v = velOf(a, b), c = centerOf(a, b);
      rt.emitTyped('ability_used', s.shot, { id: b.id, at: c });
      if (s.shot === 'split') for (const turn of [-0.2, 0.2]) {
        const nb = rt.spawn(b.archetype, { space: spaceId, at: (a.pos ? a.pos(b) : b.at).slice(), components: { launcher: { ability: 'split', child: true } } });
        setVel(rt, a, nb, rotate(v, turn)); s.active.push(nb.id);
      } else if (s.shot === 'boost') setVel(rt, a, b, [v[0] * 2.1, v[1] * 2.1]);
      else if (s.shot === 'heavy') {
        const down = rt.space(spaceId).gravityAt ? Math.sign(rt.space(spaceId).gravityAt(b.at)[1] || -1) : -1;
        setVel(rt, a, b, [v[0] * 0.35, down * Math.max(Math.abs(v[1]), 0) * (Math.sign(v[1]) === down ? 1 : 0) + down * 24]);
        const body = (b.components.body ??= {}); body.mass = massOf(b) * 2.5; if (body.density) body.density *= 2.5;
      } else if (s.shot === 'bomb') { rt.despawn(b.id); s.active = s.active.filter(id => id !== b.id); explode(rt, spaceId, c, config.bomb.r, config.bomb.strength, 'bomb'); }
    }
    init();
    rt.action('aim', v => { const s = st(); if (Number.isFinite(v)) { s.aim = clampAim(v); vars(s); } });
    rt.action('aim_left', () => { const s = st(); s.aim = clampAim(s.aim + config.aimSpeed * rt.dt); vars(s); });
    rt.action('aim_right', () => { const s = st(); s.aim = clampAim(s.aim - config.aimSpeed * rt.dt); vars(s); });
    rt.action('power', v => { const s = st(); if (Number.isFinite(v)) { s.power = Math.max(0.2, Math.min(1, v)); vars(s); } });
    rt.action('pull', v => {
      const s = st(); if (!Array.isArray(v)) return;
      const l = Math.hypot(v[0], v[1]); if (l < 1e-6) return;
      const dir = [-v[0] / l, -v[1] / l]; // launch opposite to the pull
      const ang = Math.atan2(config.forward[0] * dir[1] - config.forward[1] * dir[0], config.forward[0] * dir[0] + config.forward[1] * dir[1]);
      s.aim = clampAim(ang); s.power = Math.max(0.2, Math.min(1, l / config.maxPull)); vars(s);
    });
    rt.action('fire', () => fire(st()));
    rt.action('ability', () => { const s = st(); if (s.phase === 'flight' && s.flightT > 0.08) useAbility(s); });
    rt.on('contact', d => {
      const s = st(); if (s.phase !== 'flight' || d.sensor) return;
      if (s.firstHit < 0 && (s.active.includes(d.a) || s.active.includes(d.b))) { s.firstHit = s.flightT; if (s.shot === 'split') s.ability = false; }
    });
    rt.system('physics', rt => {
      const s = st(); init();
      if (s.phase !== 'flight') return;
      const a = api(), dt = rt.dt;
      s.flightT += dt;
      for (const id of [...s.active]) {
        const e = rt.entity(id); if (!e) continue;
        if (config.motion === 'self') stepSelf(rt, a, e, { restitution: config.restitution, friction: 0.15, contactMemo: s.memo, filter: o => !s.active.includes(o.id) });
        const c = centerOf(a, e), bd = config.bounds;
        if (bd.length === 4 && (c[0] < bd[0] || c[1] < bd[1] || c[0] > bd[2] || c[1] > bd[3])) rt.despawn(id);
      }
      s.active = s.active.filter(id => rt.entity(id));
      if (s.shot === 'bomb' && s.ability && s.firstHit >= 0 && s.flightT - s.firstHit > config.bomb.fuse) useAbility(s);
      const moving = s.active.some(id => { const v = velOf(a, rt.entity(id)); return Math.hypot(v[0], v[1]) > 0.4; });
      s.quietT = moving ? 0 : s.quietT + dt;
      if (!s.active.length || (s.flightT > config.quietMin && s.quietT > config.quietSec) || s.flightT > config.maxFlight) {
        for (const id of s.active) rt.despawn(id);
        s.active = []; s.phase = 'aim';
        rt.emit('shot_end', { shot: s.next, left: queue.length - s.next });
        vars(s);
        if (s.next >= queue.length) { s.phase = 'empty'; rt.emit('shots_empty', {}); rt.run(config.onEmpty, {}); }
      }
    }, ID);
    // Solver options: a fan of aims (and, for slings, powers) per shot.
    rt.options(rt => {
      const s = st(); if (s.phase !== 'aim') return [];
      const out = [], n = 9;
      for (let i = 0; i < n; i++) {
        const aim = config.aim[0] + (config.aim[1] - config.aim[0]) * i / (n - 1);
        for (const power of config.mode === 'sling' ? [0.6, 0.8, 1] : [1]) out.push({ label: `fire aim ${aim.toFixed(2)} power ${power}`, actions: { aim: aim || 1e-9, power, fire: true } });
      }
      return out;
    });
  },
};
