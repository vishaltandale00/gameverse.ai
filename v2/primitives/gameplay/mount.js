// Mountable creatures and riding (Red Dead, Zelda, Witcher, Skyrim horses,
// Yoshi, dragons on the ground). A mount is any entity with a `mount`
// component: { speed?: {walk,trot,gallop}, stamina?: {max}, bond?, tameable?, owner? }.
// While ridden, the rider's input drives the mount through the same ground
// model as gameplay.move.walk, choosing gaits (walk, trot, gallop). Galloping
// drains the mount's stamina. Bond grows while riding, and an untamed mount
// may buck until bond reaches tameBond. A call brings an owned mount
// galloping to you along space.path when it is in range.
// Runtime fields kept on the mount component: rider, gait, st (stamina), called.
// The rider gets components.move.riding = <mount id>, body.state = 'ride' and body.riding.
import {
  round6, mv, bodyOf, spaceApi, frameOf, intent, claim, ownedBy, ownerKey, verbs, ensureShared, len, sub, v3, boxHits, canProbe, settle, COMMON_PARAMS, MACRO_PARAMS, travelAlong,
} from './move-lib-core.js';
import { stepWalk, walkConfig } from './move-walk.js';

const ID = 'gameplay.mount';
const num = (min, max, d, unit, effect) => ({ type: 'number', min, max, default: d, unit, effect });

function envelope(config, abilities = new Set(), ctx = {}) {
  const g = ctx.gravity ?? 9.8, v0 = Math.sqrt(2 * g * config.jumpHeight);
  return { mode: 'continuous', run: config.gallop, jumpHeight: config.jumpHeight, jumpGap: round6(config.gallop * (2 * v0) / g), mount: true };
}

export default {
  id: ID,
  card: {
    // What an entity carrying these components reads as on screen (graphics/flat-art.js roleOf; never its name).
    presents: { mount: { role: 'mount' } },
    loop: { verbs: ['mount', 'call', 'sprint'], progress: ['mounted'] },
    intent: 'Mounts: ride creatures with walk/trot/gallop gaits and a stamina meter, build bond while riding (untamed mounts buck until bonded), jump while mounted, and call your mount to you from within range. Any entity with a `mount` component can be ridden.',
    views: ['3p', 'td', 'iso', 'side'],
    actionSpace: { move: { type: 'vector', min: -1, max: 1, kind: 'continuous' } },
    params: {
      walk: num(0.5, 20, 3, 'units/s', 'walk gait speed'), trot: num(0.5, 40, 7, 'units/s', 'trot gait speed'), gallop: num(0.5, 80, 14, 'units/s', 'gallop gait speed (sprint)'),
      accel: num(0.5, 200, 10, 'units/s²', 'how quickly gaits change speed'),
      staminaMax: num(1, 1000, 100, '', 'mount stamina (a mount component stamina.max overrides it)'),
      gallopCost: num(0, 200, 20, '/s', 'stamina per second galloping'), staminaRegen: num(0, 200, 15, '/s', 'stamina regained per second when not galloping'),
      bondGain: num(0, 100, 3, '/min', 'bond gained per minute ridden'), bondMax: num(1, 1000, 100, '', 'bond cap'),
      tameBond: num(0, 1000, 30, '', 'bond at which a tameable mount stops bucking'), buckChance: num(0, 1, 0.6, '', 'chance an unbonded tameable mount bucks you off, falling with bond'),
      tameStep: num(0, 100, 5, '', 'bond gained per failed mount attempt'),
      callRange: num(0, 10000, 120, 'units', 'a call reaches mounts this close'),
      callBeyond: { type: 'string', options: ['none', 'teleport'], default: 'none', effect: 'what a call does past callRange: nothing, or bring the mount to you directly' },
      mountRange: num(0.5, 20, 2.5, 'units', 'how close you must be to mount'),
      jumpHeight: num(0, 10, 1.2, 'units', 'jump height while mounted (0 = no jumping)'),
      seat: { type: 'list', of: { type: 'number' }, default: [0, 1, 0], effect: 'rider offset from the mount position' },
      fightMounted: { type: 'boolean', default: false, effect: 'whether combat may be used mounted; combat reads it through `mounted` and components.move.mountedCombat' },
      ...COMMON_PARAMS, ...MACRO_PARAMS,
    },
    provides: { events: ['mounted', 'mounted:*', 'dismounted', 'mount_called', 'mount_call_failed', 'mount_arrived', 'bucked', 'gait', 'mount_exhausted'], actions: ['mount', 'call', 'sprint'] },
    requires: { capabilities: ['position'] },
    optional: { capabilities: ['gravity', 'pathfind', 'distance'] },
    reads: ['content.archetypes'],
    envelope,
  },
  envelope,
  /** Verifier travel macro: drive this controller along a space path in real steps; true when it arrived. */
  travel: (rt, path, config, instance) => travelAlong(rt, path, {}),
  logic(logic) {
    logic.predicate('mounted', {
      test(p, rt, c) {
        const rider = rt.resolve(p.who, c), id = rider?.components.move?.riding;
        if (!id) return p.mounted === false;
        if (p.mounted === true || p.mounted == null) return true;
        if (p.mounted === false) return false;
        const m = rt.entity(id); return m && (m.id === p.mounted || m.archetype === p.mounted);
      },
    });
    logic.effect('mount', { run: (e, rt, c) => { const r = rt.resolve(e.who, c); if (r) mountOn(rt, r, e.mount ?? null); } });
    logic.effect('dismount', { run: (e, rt, c) => { const r = rt.resolve(e.who, c); if (r) dismount(rt, r, 'effect'); } });
    logic.effect('call_mount', { run: (e, rt, c) => { const r = rt.resolve(e.who, c); if (r) call(rt, r, e.mount ?? null); } });
  },
  validate(config) {
    if (!(config.walk <= config.trot && config.trot <= config.gallop)) return [{ code: 'mount_gait_order', field: 'trot', message: 'gaits must satisfy walk ≤ trot ≤ gallop' }];
    return [];
  },
  install(rt, c, instance) {
    const owner = ownerKey(instance);
    rt.caches.mountCfg = c;
    ensureShared(rt, { speed: c.trot, ...c.macro });
    verbs(rt, ['mount', 'call', 'sprint']);
    const mounts = () => Object.values(rt.state.entities).filter(e => e.components.mount && typeof e.components.mount === 'object');
    rt.system('input', rt => {
      const p = rt.player();
      if (p && c.player !== false) {
        const src = rt.input?.actions || {};
        if (src.mount && !(mv(p).held || []).includes('mount')) { if (p.components.move?.riding) dismount(rt, p, 'input'); else mountOn(rt, p, null); }
        if (src.call && !(mv(p).held || []).includes('call')) call(rt, p, null);
      }
      for (const m of mounts()) {
        const M = m.components.mount;
        if (M.rider) { const r = rt.entity(M.rider); if (!r || r.components.move?.riding !== m.id) { M.rider = null; continue; } claim(rt, m, 'ridden', 60, owner); claim(rt, r, 'ride', 60, owner); }
        else if (M.called) claim(rt, m, 'called', 60, owner);
      }
    }, ID);
    rt.system('movement', rt => {
      for (const m of mounts()) {
        const M = m.components.mount;
        if (!ownedBy(rt, m, owner)) continue;
        const api = spaceApi(rt, m); if (!api || !Array.isArray(m.at)) continue;
        const fr = frameOf(api, m, c.plane), dt = rt.dt;
        const spd = { walk: M.speed?.walk ?? c.walk, trot: M.speed?.trot ?? c.trot, gallop: M.speed?.gallop ?? c.gallop };
        const max = M.stamina?.max ?? c.staminaMax;
        M.st ??= max;
        const g = (fr.gmag || 9.8), jumpV = c.jumpHeight > 0 && fr.up !== null ? round6(Math.sqrt(2 * g * c.jumpHeight)) : 0;
        const wc = walkConfig({ walk: spd.walk, run: spd.trot, sprint: spd.gallop, crouch: spd.walk, jump: jumpV, preset: 'realistic', accel: c.accel, decel: c.accel, airControl: 0.1, coyoteMs: 80, bufferMs: 100, maxFall: 50, sprintCost: 0, sprintPool: 'none', sprintMin: 0, walkThreshold: 0.5, steer: 'auto', lookRate: 3, hopGravity: 30, plane: c.plane });
        if (M.rider) {
          const r = rt.entity(M.rider), it = intent(rt, r, spaceApi(rt, r), fr), ctl = it.ctl;
          const mag = Math.min(1, len(it.dir));
          let gait = mag < 0.05 ? 'stand' : ctl?.down('crouch') || mag < 0.5 ? 'walk' : 'trot';
          if (gait !== 'stand' && ctl?.down('sprint') && M.st > 0 && !M.tired) gait = 'gallop';
          if (gait === 'gallop') { M.st = Math.max(0, round6(M.st - c.gallopCost * dt)); if (M.st <= 0) { M.tired = true; rt.emit('mount_exhausted', { who: m.id }); } }
          else { M.st = Math.min(max, round6(M.st + c.staminaRegen * dt)); if (M.tired && M.st >= max * 0.3) M.tired = false; }
          if (gait !== M.gait) { M.gait = gait; rt.emit('gait', { who: m.id, gait }); }
          stepWalk(rt, m, wc, { intent: { ...it, run: true }, speed: gait === 'stand' ? 0 : spd[gait], jump: jumpV, noJump: !jumpV });
          M.bond = Math.min(c.bondMax, round6((M.bond || 0) + (c.bondGain * dt) / 60));
          // The rider sits on the mount.
          const rapi = spaceApi(rt, r), seat = v3(c.seat);
          if (rapi) rapi.setPos(r, m.at.map((v, i) => round6(v + (seat[i] ?? 0))), rt);
          const rb = bodyOf(r); rb.vel = bodyOf(m).vel.slice(); rb.grounded = bodyOf(m).grounded; rb.state = 'ride'; rb.riding = m.id; rb.dir = bodyOf(m).dir; rb.facing = bodyOf(m).facing; rb.controller = 'move';
          bodyOf(m).state = gait === 'stand' ? 'idle' : gait;
        } else if (M.called) {
          const caller = rt.entity(M.called);
          if (!caller || caller.space !== m.space) { M.called = null; continue; }
          mv(m);
          const d = len(sub(v3(caller.at), v3(m.at)));
          if (d <= c.mountRange * 0.8) { M.called = null; delete m.components.moveTo; bodyOf(m).vel = [0, 0, 0]; rt.emit('mount_arrived', { who: m.id, to: caller.id }); continue; }
          const mt = m.components.moveTo;
          if (!mt?.at || len(sub(v3(mt.at), v3(caller.at))) > 1) m.components.moveTo = { at: caller.at.slice(), run: true };
          const it = intent(rt, m, api, fr, { tol: c.mountRange * 0.8 });
          if (!m.components.moveTo) { M.called = null; continue; }
          stepWalk(rt, m, wc, { intent: it, speed: spd.gallop, noJump: !jumpV, jump: jumpV });
          bodyOf(m).state = 'gallop';
        }
        settle(m, fr);
      }
    }, ID);
    rt.options(rt => {
      const p = rt.player(); if (!p) return [];
      if (p.components.move?.riding) return [{ label: 'dismount', actions: { mount: true }, steps: 1 }, { label: 'gallop', actions: { up: true, sprint: true }, steps: 30 }];
      const near = nearestMount(rt, p, c.mountRange);
      const out = near ? [{ label: `mount ${near.id}`, actions: { mount: true }, steps: 1 }] : [];
      if (mounts().some(m => m.components.mount.owner === p.id && m.space === p.space)) out.push({ label: 'call mount', actions: { call: true }, steps: 1 });
      return out;
    });
  },
};

function distanceOf(rt, a, b) {
  const api = spaceApi(rt, a);
  if (typeof api?.distance === 'function') return api.distance(a.at, b.at);
  return Array.isArray(a.at) ? len(sub(v3(a.at), v3(b.at))) : a.at === b.at ? 0 : Infinity;
}
function nearestMount(rt, rider, range, which = null) {
  let best = null, bd = Infinity;
  for (const m of Object.values(rt.state.entities)) {
    if (!m.components.mount || m.space !== rider.space || m.id === rider.id || m.components.mount.rider) continue;
    if (which && m.id !== which && m.archetype !== which) continue;
    const d = distanceOf(rt, rider, m);
    if (d <= range && d < bd) { bd = d; best = m; }
  }
  return best;
}

/** Mount the given (or nearest) mount within range; untamed mounts may buck. */
export function mountOn(rt, rider, which) {
  const c = rt.caches.mountCfg; if (!c || rider.components.move?.riding) return false;
  const m = which && rt.entity(which)?.components.mount ? rt.entity(which) : nearestMount(rt, rider, c.mountRange, which);
  if (!m || distanceOf(rt, rider, m) > c.mountRange) { rt.emit('mount_failed', { who: rider.id, reason: 'none_in_range' }); return false; }
  const M = m.components.mount;
  if (M.tameable && (M.bond || 0) < c.tameBond && M.owner !== rider.id) {
    const chance = c.buckChance * (1 - (M.bond || 0) / c.tameBond);
    if (rt.random() < chance) { M.bond = Math.min(c.bondMax, round6((M.bond || 0) + c.tameStep)); rt.emit('bucked', { who: rider.id, mount: m.id, bond: M.bond }); return false; }
  }
  M.rider = rider.id; M.owner ??= rider.id; M.called = null; delete m.components.moveTo;
  mv(rider).riding = m.id; mv(rider).mountedCombat = Boolean(c.fightMounted);
  rt.emitTyped('mounted', m.archetype, { who: rider.id, mount: m.id });
  return true;
}

export function dismount(rt, rider, reason) {
  const id = rider.components.move?.riding; if (!id) return false;
  const m = rt.entity(id), c = rt.caches.mountCfg;
  delete rider.components.move.riding; delete rider.components.move.mountedCombat;
  const b = bodyOf(rider); delete b.riding; b.state = 'idle';
  if (m) {
    m.components.mount.rider = null; m.components.mount.gait = 'stand';
    const api = spaceApi(rt, rider);
    if (api && Array.isArray(m.at)) {
      const fr = frameOf(api, m), side = fr.plane[0] ?? 0;
      const spots = [1, -1].map(s => { const p = m.at.slice(); p[side] += s * Math.max(1, c?.mountRange ?? 1.2) * 0.6; return p; });
      const spot = spots.find(p => !canProbe(api) || !boxHits(rt, api, rider, p)) ?? m.at.slice();
      api.setPos(rider, spot, rt);
    }
  }
  rt.emit('dismounted', { who: rider.id, mount: id, reason });
  return true;
}

export function call(rt, caller, which) {
  const c = rt.caches.mountCfg; if (!c) return false;
  const owned = Object.values(rt.state.entities).filter(m => m.components.mount && !m.components.mount.rider && (which ? m.id === which || m.archetype === which : m.components.mount.owner === caller.id));
  const m = owned.filter(m => m.space === caller.space).sort((a, b) => distanceOf(rt, caller, a) - distanceOf(rt, caller, b))[0];
  if (!m) { rt.emit('mount_call_failed', { who: caller.id, reason: 'no_mount' }); return false; }
  const d = distanceOf(rt, caller, m);
  if (d > c.callRange) {
    if (c.callBeyond !== 'teleport') { rt.emit('mount_call_failed', { who: caller.id, mount: m.id, reason: 'range' }); return false; }
    const api = spaceApi(rt, m), p = caller.at.slice(); p[0] += c.mountRange * 0.6;
    api?.setPos(m, p, rt);
    rt.emit('mount_called', { who: caller.id, mount: m.id, teleported: true });
    return true;
  }
  m.components.mount.called = caller.id;
  rt.emit('mount_called', { who: caller.id, mount: m.id, distance: round6(d) });
  return true;
}
