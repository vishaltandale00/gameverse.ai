// Swimming in any liquid a space can report: cells tagged water/liquid (getCell),
// the surface capability's water depth (3D terrain), or zones tagged water.
// Buoyancy floats you to the surface. Diving goes under, and breath runs out
// while the head is under, after which drowning deals damage through
// combat.health's `damage` effect. A jump at the surface climbs out.
import {
  round6, bodyOf, intent, installOverlay, integrate, submersion, pool, canSpend, hasAbility, verbs, ensureShared, steerPlane, hurt, boxOf, probe, zoneTags,
  COMMON_PARAMS, controls, travelAlong,
} from './move-lib-core.js';

const ID = 'gameplay.move.swim';

function envelope(config, abilities = new Set()) {
  const ok = !config.ability || abilities.has(config.ability);
  return { mode: 'continuous', swim: ok, swimSpeed: ok ? config.speed : 0, dive: ok && config.dive, breath: config.breath };
}

export default {
  id: ID,
  card: {
    loop: { verbs: ['dive', 'ascend', 'jump'], progress: ['swim_start', 'submerged'] },
    locomotion: 'modifier', // base: moves the player on its own; modifier: adds a move on top of base locomotion
    intent: 'Swim, float and dive in liquid: buoyancy brings you to the surface, dive and ascend verbs move you underwater, breath runs down while the head is submerged and drowning damage follows, and jumping at the surface climbs out.',
    views: ['1p', '3p', 'side', 'td', 'iso'],
    actionSpace: { move: { type: 'vector', min: -1, max: 1, kind: 'continuous' } },
    params: {
      speed: { type: 'number', min: 0.2, max: 20, default: 3, unit: 'units/s', effect: 'swim speed' },
      sprint: { type: 'number', min: 0, max: 30, default: 0, unit: 'units/s', effect: 'fast swim speed with the sprint verb (0 = none)' },
      sprintCost: { type: 'number', min: 0, max: 100, default: 0, unit: '/s', effect: 'stamina per second of fast swimming' },
      staminaCost: { type: 'number', min: 0, max: 100, default: 0, unit: '/s', effect: 'stamina per second while swimming at all (BotW-style); exhausted swimmers sink' },
      pool: { type: 'string', default: 'stamina', effect: 'gameplay.resource pool for stamina costs' },
      accel: { type: 'number', min: 0.5, max: 100, default: 8, unit: 'units/s²', effect: 'how quickly swim velocity responds' },
      buoyancy: { type: 'number', min: 0, max: 20, default: 2, unit: 'units/s', effect: 'rise speed toward the surface when not diving' },
      dive: { type: 'boolean', default: true, effect: 'allow going under on descend/crouch' },
      breath: { type: 'number', min: 1, max: 600, default: 20, unit: 's', effect: 'time the head can stay under' },
      drownDps: { type: 'number', min: 0, max: 1000, default: 10, effect: 'damage per second once breath is gone' },
      exitJump: { type: 'number', min: 0, max: 30, default: 6, unit: 'units/s', effect: 'upward speed of a jump out at the surface' },
      enter: { type: 'number', min: 0.1, max: 1, default: 0.5, effect: 'fraction of the body submerged before swimming starts' },
      liquids: { type: 'list', of: { type: 'string' }, default: ['water', 'liquid', 'fluid'], effect: 'cell/zone tags that count as swimmable liquid' },
      ability: { type: 'string', default: '', effect: 'ability required to swim; without it you sink (and may drown)' },
      ...COMMON_PARAMS,
    },
    provides: { events: ['submerged', 'surfaced', 'swim_start', 'swim_end', 'drowning', 'move_hurt'], vars: ['move.breath'], actions: ['dive', 'ascend', 'jump'] },
    requires: { capabilities: ['position'] },
    optional: { capabilities: ['editCells', 'surface', 'gravity', 'raycast'] },
    envelope,
  },
  envelope,
  /** Verifier travel macro: drive this controller along a space path in real steps; true when it arrived. */
  travel: (rt, path, config, instance) => travelAlong(rt, path, {}),
  install(rt, c, instance) {
    verbs(rt, ['dive', 'ascend', 'jump']);
    ensureShared(rt, { speed: c.speed });
    // Breath ticks for every driven entity, swimming or not (ability-less sinkers drown too).
    rt.system('physics', rt => {
      for (const e of Object.values(rt.state.entities)) {
        const s = e.components.move?.swim; if (!s?.wet) continue;
        s.breath ??= c.breath;
        if (s.head) {
          s.breath = Math.max(0, round6(s.breath - rt.dt));
          if (s.breath <= 0 && c.drownDps > 0) { s.drown = round6((s.drown || 0) + rt.dt); if (s.drown >= 1) { s.drown = round6(s.drown - 1); rt.emit('drowning', { who: e.id }); hurt(rt, e, c.drownDps, 'drown', 'drowning'); } }
        } else { s.breath = Math.min(c.breath, round6(s.breath + c.breath * rt.dt)); s.drown = 0; }
        if (e.id === 'player') rt.state.vars['move.breath'] = round6(s.breath);
      }
    }, ID);
    const wadeIn = (e, api, fr) => {
      const it = intent(rt, e, api, fr, { free3d: true }), l = Math.hypot(...it.dir);
      if (l < 0.3) return false;
      const b = boxOf(api, e), p = b.min.map((m, i) => m + b.size[i] / 2);
      for (const i of fr.plane) p[i] += (it.dir[i] / l) * (b.size[i] / 2 + 0.2);
      return probe(rt, api, p).tags.some(t => c.liquids.includes(t)) || zoneTags(rt, e, p).some(t => c.liquids.includes(t));
    };
    installOverlay(rt, c, instance, {
      id: ID, mode: 'swim', pri: 30,
      wants(e, api, fr, s) {
        const w = submersion(rt, api, e, fr, c.liquids);
        if (w.head !== Boolean(s.head)) rt.emit(w.head ? 'submerged' : 'surfaced', { who: e.id });
        s.head = w.head; s.wet = w.frac > 0; s.frac = w.frac;
        if (!s.wet && e.id === 'player' && rt.state.vars['move.breath'] !== undefined) rt.state.vars['move.breath'] = c.breath;
        if (c.ability && !hasAbility(rt, e, c.ability)) return false;
        if (s.exitUntil && rt.state.time < s.exitUntil) return false;
        if (w.frac < c.enter && !(s.on && w.frac > 0) && !(fr.up === null && wadeIn(e, api, fr))) { s.endReason = 'out'; return false; }
        const stam = c.staminaCost > 0 ? pool(rt, e, c.pool) : null;
        if (stam && !canSpend(stam, c.staminaCost * rt.dt)) { s.endReason = 'exhausted'; return false; }
        return true;
      },
      start(e) { const b = bodyOf(e); b.vel = b.vel.map(v => round6(v * 0.3)); rt.emit('swim_start', { who: e.id }); }, // the splash soaks up momentum
      end(e, api, s, reason) { rt.emit('swim_end', { who: e.id, reason }); },
      step(e, api, fr, s) {
        const b = bodyOf(e), it = intent(rt, e, api, fr, { free3d: true }), ctl = controls(rt, e), dt = rt.dt, V = fr.vert;
        const stam = pool(rt, e, c.pool);
        let speed = c.speed;
        if (c.sprint > 0 && ctl?.down('sprint') && canSpend(stam, c.sprintCost * dt)) { speed = c.sprint; if (stam && c.sprintCost) stam.spend(c.sprintCost * dt); }
        if (stam && c.staminaCost) stam.spend(c.staminaCost * dt);
        const want = it.dir.map(v => v * speed);
        steerPlane(b, fr, want, c.accel * dt);
        if (V !== null) {
          const up = fr.upSign || 1;
          const diveIn = ctl ? (ctl.down('dive') || ctl.down('crouch') || ctl.down('descend') ? -1 : 0) + (ctl.down('ascend') || ctl.down('jump') ? 1 : 0) + (fr.plane.length === 1 ? ctl.move[1] : 0) : it.vert;
          let target;
          if (diveIn < -0.2 && c.dive) target = -speed;
          else if (diveIn > 0.2) target = s.head ? speed : 0; // ascend to the surface, then tread water
          else target = s.head ? c.buoyancy : (s.frac > 0.67 ? c.buoyancy * 0.25 : 0);
          const cur = b.vel[V] * up;
          b.vel[V] = up * (cur + Math.max(-c.accel * dt, Math.min(c.accel * dt, target - cur)));
          // Jumping out at the surface.
          if (!s.head && (it.jump || ctl?.pressed('jump')) && c.exitJump > 0) { b.vel[V] = up * c.exitJump; s.exitUntil = rt.state.time + 0.3; s.endReason = 'exit'; rt.emit('jumped', { who: e.id, from: 'swim' }); }
        }
        integrate(rt, e, api, fr, { swim: true });
        b.grounded = false;
        b.state = s.head ? 'dive' : 'swim';
      },
    });
  },
};
