// gameplay.powerup: timed buffs and tiered upgrades, collected from pickup
// entities (components.powerup = id) or given by effects. Kinds:
//   magnet       pulls pickups/collectibles toward the holder
//   multiplier   multiplies score (var score.mult, read by gameplay.score)
//   shield       absorbs the next hit (and clears nearby hostile shots)
//   invulnerable ignores all hits
//   weapon       ranged weapon upgrade: same weapon -> next tier, at the top tier
//                overflow points; another weapon switches and keeps the tier;
//                optionally drop a tier when hurt (shmup)
//   slowmo       var time.scale while active
//   status       applies a combat status for the duration
//   stat         adds `value` to a stat while active (stat.move, stat.damage...)
//   life         an extra life (gameplay.death); bomb: a charge of an active ability
//   effects      only onStart/onEnd
import { frames, grantInvuln, v3, add, sub, mul, norm, len, posOf, like, spaceOf, distance, intercept, combat, service, teamOf, round, err } from './combat-lib.js';

const KEY = 'gameplay.powerup';
const KINDS = ['magnet', 'multiplier', 'shield', 'invulnerable', 'weapon', 'slowmo', 'status', 'stat', 'life', 'bomb', 'effects'];

export default {
  id: KEY,
  card: {
    // Shapes of the archetype components this primitive owns (the planner's schemas and repair read them).
    components: { powerup: { type: 'string', effect: 'a powerups[] id given when collected' } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "archetypes", "component": "powerup", "kinds": ["pickup", "prop"], "min": 1, "placed": 2, "why": "power-ups are collected from pickup entities whose powerup component names a powerups[] id", "example": {"id": "star_pickup", "kind": "pickup", "components": {"powerup": "star"}}},
    ],
    intent: 'Power-ups: timed buffs (magnet, score multiplier, shield, invulnerability, slow motion, status, stat boosts) and tiered upgrades (weapon tiers with overflow points, extra lives, ability charges), collected from pickups or given by effects.',
    views: ['any'],
    params: {
      powerups: { type: 'list', min: 1, of: { type: 'object', fields: {
        id: { type: 'string', required: true }, kind: { type: 'string', options: KINDS, required: true }, name: { type: 'string' },
        sec: { type: 'number', default: 10, min: 0, max: 3600, unit: 's', effect: '0 = until used (shield) or permanent (weapon)' },
        value: { type: 'number', default: 2, effect: 'multiplier, magnet pull speed, slowmo scale, stat delta' },
        radius: { type: 'number', default: 4, min: 0, max: 1000, unit: 'units', effect: 'magnet radius / shield bullet-clear radius' },
        stat: { type: 'string' }, status: { type: 'ref', to: 'status' }, weapon: { type: 'string' }, ability: { type: 'string' },
        overflowPoints: { type: 'number', default: 1000, min: 0 },
        stack: { type: 'string', options: ['refresh', 'extend', 'none'], default: 'refresh' },
        pulls: { type: 'list', of: { type: 'string' }, default: ['pickup', 'collectible', 'powerup'] },
        onStart: { type: 'effects', default: [] }, onEnd: { type: 'effects', default: [] },
      } } },
      pickupRange: { type: 'number', default: 0.8, min: 0, max: 50, unit: 'units' },
      loseTierOnHit: { type: 'boolean', default: false, effect: 'taking damage drops the weapon one tier (shmup)' },
    },
    provides: { events: ['powerup', 'powerup:*', 'powerup_end', 'powerup_end:*', 'shield_break', 'overflow', 'tier_lost'], vars: ['score.mult', 'time.scale', 'powerup.*'], services: ['powerup'] },
    defines: [{ kind: 'powerup', in: 'powerups' }],
  },
  logic(logic) {
    logic.effect('give_powerup', { refs: e => [['powerup', e.powerup]], run: (e, rt, c) => { const t = e.who ? rt.resolve(e.who, c) : rt.player(); if (t) rt.service('powerup').give(t, e.powerup); } });
    logic.effect('end_powerup', { refs: e => [['powerup', e.powerup]], run: (e, rt, c) => { const t = e.who ? rt.resolve(e.who, c) : rt.player(); if (t) rt.service('powerup').end(t, e.powerup); } });
    logic.predicate('powerup', { refs: p => [['powerup', p.powerup]], test: (p, rt, c) => { const t = p.who ? rt.resolve(p.who, c) : rt.player(); return Boolean(t && rt.service('powerup').active(t, p.powerup)); } });
  },
  validate(config) {
    const errors = [];
    config.powerups.forEach((p, i) => {
      const path = `with.powerups[${i}]`;
      if (p.kind === 'stat' && !p.stat) errors.push(err('powerup_field_missing', `${path}.stat`, 'stat power-ups need `stat`'));
      if (p.kind === 'status' && !p.status) errors.push(err('powerup_field_missing', `${path}.status`, 'status power-ups need `status`'));
      if (p.kind === 'weapon' && !p.weapon) errors.push(err('powerup_field_missing', `${path}.weapon`, 'weapon power-ups need `weapon`'));
      if (p.kind === 'bomb' && !p.ability) errors.push(err('powerup_field_missing', `${path}.ability`, 'bomb power-ups need the active ability id'));
    });
    return errors;
  },
  install(rt, config) {
    const defs = new Map(config.powerups.map(p => [p.id, p]));
    const S = id => { const s = rt.store(KEY); return (s[id] ??= {}); };
    const sync = () => {
      const p = rt.player(); const act = p ? S(p.id) : {};
      let mult = 1, slow = null;
      for (const [id, left] of Object.entries(act)) { const d = defs.get(id); if (d?.kind === 'multiplier') mult *= d.value; if (d?.kind === 'slowmo') slow = Math.min(slow ?? 1, d.value); rt.state.vars[`powerup.${id}`] = left < 0 ? -1 : round(left / 60, 1e3); }
      for (const id of defs.keys()) if (!(id in act)) rt.state.vars[`powerup.${id}`] = 0;
      rt.state.vars['score.mult'] = mult;
      const flags = (rt.state.prim[`${KEY}#`] ??= {});
      if (slow !== null) { rt.state.vars['time.scale'] = slow; flags.slowing = true; } else if (flags.slowing) { rt.state.vars['time.scale'] = 1; flags.slowing = false; }
    };
    const statAdd = (e, d, sign) => { const st = (e.components.stats ??= {}); st[d.stat] = round((st[d.stat] ?? 0) + sign * d.value); };
    const begin = (e, d) => {
      if (d.kind === 'stat') statAdd(e, d, 1);
      if (d.kind === 'invulnerable') grantInvuln(e, d.sec ? frames(d.sec) : 60 * 3600);
      if (d.kind === 'status') service(rt, 'status')?.apply(e, d.status, { sec: d.sec || undefined, by: e.id });
    };
    const finish = (e, d) => {
      if (d.kind === 'stat') statAdd(e, d, -1);
      if (d.kind === 'invulnerable' && e.components.health) e.components.health.invulnerable = 0;
    };
    const api = {
      active: (e, id) => id in S(e.id),
      list: e => Object.keys(S(e.id)),
      give(e, id) {
        const d = defs.get(id); if (!d) return false;
        const act = S(e.id), dur = d.sec ? frames(d.sec) : -1;
        rt.emitTyped('powerup', id, { who: e.id, powerup: id, kind: d.kind, title: d.name ?? id });
        if (d.kind === 'weapon') {
          const proj = service(rt, 'projectiles'); if (!proj) return false;
          const r = (e.components.ranged ??= { weapon: d.weapon, tier: 0 }), max = proj.weapon(d.weapon)?.maxTier ?? 1;
          if (r.weapon === d.weapon && (r.tier ?? 1) >= max) { service(rt, 'score')?.add(d.overflowPoints, { on: 'overflow' }); rt.emit('overflow', { who: e.id, powerup: id, points: d.overflowPoints }); }
          else proj.setTier(e, d.weapon, r.weapon === d.weapon ? (r.tier ?? 0) + 1 : Math.max(1, r.tier ?? 1));
          rt.run(d.onStart, { self: e.id });
          return true;
        }
        if (d.kind === 'life') { service(rt, 'death')?.addLife(1); rt.run(d.onStart, { self: e.id }); return true; }
        if (d.kind === 'bomb') { service(rt, 'abilities')?.addCharge(e, d.ability, 1); rt.run(d.onStart, { self: e.id }); return true; }
        if (id in act) { if (d.stack === 'extend' && act[id] >= 0) act[id] += dur; else if (d.stack === 'refresh') act[id] = dur; }
        else { act[id] = dur; begin(e, d); rt.run(d.onStart, { self: e.id }); }
        sync(); return true;
      },
      end(e, id, reason = 'expired') {
        const act = S(e.id), d = defs.get(id); if (!(id in act)) return;
        delete act[id]; finish(e, d);
        rt.emitTyped('powerup_end', id, { who: e.id, powerup: id, reason });
        rt.run(d.onEnd, { self: e.id }); sync();
      },
    };
    rt.provide('powerup', api);
    // Shields absorb a hit; invulnerability is handled by health (health.invulnerable).
    intercept(rt, 55, (d, hit) => {
      const act = rt.store(KEY)[d.id]; if (!act || hit.source === 'status') return hit;
      const id = Object.keys(act).find(k => defs.get(k)?.kind === 'shield'); if (!id) return hit;
      const def = defs.get(id);
      api.end(d, id, 'broken');
      grantInvuln(d, 60);
      if (def.radius && posOf(d)) service(rt, 'projectiles')?.cancel({ notTeam: teamOf(rt, d), near: { at: posOf(d), r: def.radius }, space: d.space, by: d.id });
      rt.emit('shield_break', { who: d.id, by: hit.by ?? null });
      return { cancel: true, reason: 'shield' };
    }, KEY);
    if (config.loseTierOnHit) rt.on('damaged', ({ who, amount }) => {
      const e = rt.entity(who), r = e?.components.ranged; if (!r?.weapon || !(amount > 0) || who !== 'player') return;
      const base = config.powerups.find(p => p.kind === 'weapon' && p.weapon !== r.weapon && rt.service('projectiles').weapon(p.weapon)?.maxTier === 1)?.weapon;
      if (r.tier > 1) r.tier--; else if (base) { r.weapon = base; r.tier = 1; }
      rt.emit('tier_lost', { who, weapon: r.weapon, tier: r.tier });
    });
    rt.system('interaction', rt => {
      // Pickups touched by the player.
      const p = rt.player();
      if (p && !p.components.health?.dead) for (const e of Object.values(rt.state.entities)) {
        const id = typeof e.components.powerup === 'string' ? e.components.powerup : e.components.powerup?.id;
        if (!id || !defs.has(id) || e.space !== p.space) continue;
        if (distance(rt, p, e) <= config.pickupRange) { rt.despawn(e.id); api.give(p, id); }
      }
      for (const [who, act] of Object.entries(rt.store(KEY))) {
        const e = rt.entity(who); if (!e || typeof act !== 'object') continue;
        for (const [id, left] of Object.entries(act)) {
          const d = defs.get(id); if (!d) continue;
          if (d.kind === 'magnet' && posOf(e)) {
            for (const o of Object.values(rt.state.entities)) {
              if (o.id === e.id || o.space !== e.space || !d.pulls.some(k => k in o.components) || !posOf(o)) continue;
              const off = sub(posOf(e), posOf(o)), dist = len(off);
              if (dist > d.radius || dist < 1e-6) continue;
              const step = Math.min(dist, d.value / 60);
              spaceOf(rt, o)?.setPos?.(o, like(o.at, add(posOf(o), mul(norm(off), step)).map(v => round(v))), rt);
            }
          }
          if (left > 0) { act[id] = left - 1; if (act[id] === 0) api.end(e, id); }
        }
      }
      sync();
    }, KEY);
  },
};
export { v3, combat };
