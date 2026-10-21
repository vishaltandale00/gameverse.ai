// Ladders and free surface climbing (Zelda BotW walls, Minecraft ladders,
// Uncharted handholds) for any entity on any continuous space. Climbable
// surfaces are found through capabilities only: cell probes (getCell tags)
// or raycasts for walls, overlap for ladder cells, and zone tags. Climbing
// drains a stamina pool. Running out makes you slip. Topping out can mantle
// onto the ledge.
import {
  round6, bodyOf, intent, installOverlay, integrate, wallBeside, ledgeAt, probe, boxOf, canProbe, pool, canSpend,
  hasAbility, verbs, ensureShared, wallProbeDirs, zoneTags, COMMON_PARAMS, controls, travelAlong,
} from './move-lib-core.js';

const ID = 'gameplay.move.climb';

function envelope(config, abilities = new Set()) {
  const ok = !config.ability || abilities.has(config.ability);
  return { mode: 'continuous', climb: ok, climbSpeed: ok ? config.speed : 0, climbSurfaces: config.surfaces };
}

export default {
  id: ID,
  card: {
    loop: { verbs: ['climb', 'grab', 'jump'], progress: ['climb_start', 'ledge_grab'] },
    locomotion: 'modifier', // base: moves the player on its own; modifier: adds a move on top of base locomotion
    intent: 'Climb ladders and climbable walls: push into or grab a surface to climb up, down and sideways at a set speed, drain stamina while climbing, jump off, slip when exhausted, and mantle over the top. Surfaces are ladders, any steep wall, or cells/zones carrying climb tags.',
    views: ['1p', '3p', 'side', 'iso'],
    actionSpace: { move: { type: 'vector', min: -1, max: 1, kind: 'continuous' } },
    params: {
      speed: { type: 'number', min: 0.1, max: 20, default: 1.4, unit: 'units/s', effect: 'climbing speed' },
      surfaces: { type: 'string', options: ['ladders', 'any', 'tagged'], default: 'ladders', effect: 'ladders: ladder cells only; any: every steep solid wall; tagged: walls whose cell or zone carries a climb tag' },
      tags: { type: 'list', of: { type: 'string' }, default: ['climbable', 'ladder', 'vine'], effect: 'cell/zone tags that are climbable when surfaces=tagged' },
      ladderTags: { type: 'list', of: { type: 'string' }, default: ['ladder', 'vine', 'climbable'], effect: 'non-solid cells you climb inside (ladders, vines, climbable tiles)' },
      staminaCost: { type: 'number', min: 0, max: 200, default: 0, unit: '/s', effect: 'stamina per second while moving on a wall (a third of that while hanging still)' },
      pool: { type: 'string', default: 'stamina', effect: 'gameplay.resource pool (res.<pool>); an internal pool when absent' },
      jumpCost: { type: 'number', min: 0, max: 100, default: 0, effect: 'stamina for a jump off the wall' },
      jumpOff: { type: 'number', min: 0, max: 30, default: 5, unit: 'units/s', effect: 'push away from the wall on jump' },
      slipMin: { type: 'number', min: 0, max: 90, default: 60, unit: 'deg', effect: 'surfaces less steep than this are walked, not climbed' },
      ledgeGrab: { type: 'boolean', default: false, effect: 'mantle onto the top when climbing past a wall top' },
      auto: { type: 'boolean', default: true, effect: 'pushing into a climbable surface starts climbing; otherwise hold grab/climb' },
      ability: { type: 'string', default: '', effect: 'ability required to climb (via unlock_ability grants); empty = always' },
      ...COMMON_PARAMS,
    },
    provides: { events: ['jumped', 'evaded', 'climb_start', 'climb_end', 'ledge_grab', 'landed'], actions: ['climb', 'grab', 'jump'] },
    requires: { capabilities: ['position'] },
    optional: { capabilities: ['gravity', 'editCells', 'raycast', 'overlap'] },
    envelope,
  },
  envelope,
  /** Verifier travel macro: drive this controller along a space path in real steps; true when it arrived. */
  travel: (rt, path, config, instance) => travelAlong(rt, path, {}),
  validate(config) {
    if (config.surfaces === 'tagged' && !config.tags.length) return [{ code: 'climb_no_tags', field: 'tags', message: 'surfaces=tagged needs at least one tag' }];
    return [];
  },
  install(rt, c, instance) {
    verbs(rt, ['climb', 'grab', 'jump']);
    ensureShared(rt, { speed: c.speed });
    const steepEnough = n => { const up = Math.abs(n?.[1] ?? 0); return (Math.acos(Math.min(1, up)) * 180) / Math.PI >= c.slipMin - 1e-6; };
    const climbable = (tags, solid) => c.surfaces === 'any' ? solid : c.surfaces === 'tagged' ? tags.some(t => c.tags.includes(t)) : tags.some(t => c.ladderTags.includes(t));
    // A ladder (non-solid climbable cell) overlapping the body, or a climbable wall beside it.
    const surfaceOf = (e, api, fr, dir) => {
      const b = boxOf(api, e), mid = b.min.map((m, i) => m + b.size[i] / 2);
      if (canProbe(api)) { const pr = probe(rt, api, mid); if (!pr.solid && pr.tags.some(t => c.ladderTags.includes(t))) return { kind: 'ladder', normal: null }; }
      if (zoneTags(rt, e, mid).some(t => c.ladderTags.includes(t) || (c.surfaces === 'tagged' && c.tags.includes(t)))) return { kind: 'ladder', normal: null };
      if (c.surfaces === 'ladders') return null;
      for (const [ax, s] of wallProbeDirs(e, fr, dir)) {
        const w = wallBeside(rt, api, e, ax, s, 0.1);
        if (w && steepEnough(w.normal) && climbable(w.tags, true)) return { kind: 'wall', ax, s, normal: w.normal };
      }
      return null;
    };
    installOverlay(rt, c, instance, {
      id: ID, mode: 'climb', pri: 40,
      wants(e, api, fr, s, active) {
        if (c.ability && !hasAbility(rt, e, c.ability)) return false;
        if (rt.state.time < (s.release ?? -1)) return false;
        const it = intent(rt, e, api, fr), ctl = it.ctl;
        const surf = surfaceOf(e, api, fr, active && s.ax !== undefined ? (() => { const d = [0, 0, 0]; d[s.ax] = s.s; return d; })() : it.dir);
        if (!surf) { if (active) s.endReason = 'off'; return false; }
        const stam = c.staminaCost > 0 ? pool(rt, e, c.pool) : null;
        if (active) {
          if (stam && !canSpend(stam, (c.staminaCost * rt.dt) / 3)) { s.endReason = 'stamina'; return false; }
          if (it.jump) { s.jumpOff = true; return true; }
          if (bodyOf(e).grounded && (it.vert < -0.3 || (ctl && ctl.move[1] < -0.3)) && s.t > 0.1) { s.endReason = 'ground'; return false; }
          return true;
        }
        if (stam && !canSpend(stam, c.staminaCost * rt.dt)) return false;
        const grab = Boolean(ctl?.down('climb') || ctl?.down('grab'));
        const vert = ctl ? Math.abs(ctl.move[1]) > 0.3 || ctl.down('up') : Math.abs(it.vert) > 0.3;
        if (surf.kind === 'ladder') return grab || vert;
        const pushing = surf.ax !== undefined && (it.dir[surf.ax] ?? 0) * surf.s > 0.3;
        if (!(grab || (c.auto && pushing))) return false;
        s.ax = surf.ax; s.s = surf.s; s.kind = 'wall';
        return true;
      },
      start(e, api, fr, s) { const b = bodyOf(e); b.vel = [0, 0, 0]; rt.emit('climb_start', { who: e.id, surface: s.kind || 'ladder' }); },
      end(e, api, s, reason) { rt.emit('climb_end', { who: e.id, reason }); s.ax = undefined; s.kind = undefined; },
      step(e, api, fr, s) {
        const b = bodyOf(e), it = intent(rt, e, api, fr), ctl = controls(rt, e) || null, V = fr.vert ?? 1;
        const stick = ctl ? ctl.move : [0, it.vert];
        const stam = c.staminaCost > 0 ? pool(rt, e, c.pool) : null;
        if (s.jumpOff) {
          s.jumpOff = false;
          const v = [0, 0, 0]; v[V] = c.jumpOff * (fr.upSign || 1);
          if (s.ax !== undefined) v[s.ax] = -s.s * c.jumpOff;
          b.vel = v; if (stam && c.jumpCost) stam.spend(c.jumpCost);
          s.endReason = 'jump'; s.release = rt.state.time + 0.25; rt.emit('jumped', { who: e.id, from: 'climb' });
          integrate(rt, e, api, fr); b.state = 'air'; return;
        }
        // Up/down along the vertical axis; sideways along the wall.
        const v = [0, 0, 0];
        v[V] = round6((stick[1] || 0) * c.speed * (fr.upSign || 1));
        const lateral = fr.plane.filter(i => i !== s.ax);
        if (lateral.length) { const w = [0, 0, 0]; for (const i of lateral) w[i] = it.dir[i] ?? 0; for (const i of lateral) v[i] = w[i] * c.speed; }
        if (s.ax !== undefined) v[s.ax] = s.s * 0.5; // keep contact with the wall
        b.vel = v;
        const moving = Math.abs(stick[0] || 0) + Math.abs(stick[1] || 0) > 0.1;
        if (stam) stam.spend(c.staminaCost * rt.dt * (moving ? 1 : 1 / 3));
        integrate(rt, e, api, fr, { climb: true });
        // Topping out: the wall ended at head height while climbing up.
        if (s.ax !== undefined && (stick[1] || 0) > 0.3 && !wallBeside(rt, api, e, s.ax, s.s, 0.1, [0.9])) {
          const L = c.ledgeGrab ? ledgeAt(rt, api, e, s.ax, s.s) : null;
          if (L) { api.setPos(e, L.stand, rt); b.vel = [0, 0, 0]; b.grounded = true; rt.emit('ledge_grab', { who: e.id }); s.endReason = 'top'; s.release = rt.state.time + 0.25; }
        }
        b.state = 'climb';
      },
    });
  },
};
