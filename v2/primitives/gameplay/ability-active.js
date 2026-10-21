// gameplay.ability.active: button abilities with cooldowns, charges, recharge
// and resource costs, for the player and any entity (NPCs use the use_ability
// effect). Kinds:
//   bomb        clears hostile shots, damages hostiles in radius (0 = the whole
//               space; bosses take bossFrac of their max at most), grants i-frames
//   shield      invulnerability for `sec`
//   hyperspace  jump to a random spot in `area` (or the space bounds), keeping
//               clear of hostiles, with a `risk` of dying on re-entry
//   blink       short teleport along facing, stopped by walls
//   effects     runs `fx` only
import { ID_PATTERN } from '../../kernel/sections.js';
import { frames, grantInvuln, v3, add, mul, len, sub, posOf, facingOf, like, spaceOf, distance, hostile, teamOf, resolveWho, combat, service, displace, round, err } from './combat-lib.js';

const KEY = 'gameplay.ability.active';
const KINDS = ['bomb', 'shield', 'hyperspace', 'blink', 'effects'];

export default {
  id: KEY,
  card: {
    loop: { verbs: [], progress: ['ability_used'] },
    intent: 'Active abilities on a button with cooldowns, charges and resource costs: screen-clearing bombs with i-frames, timed shields, hyperspace jumps with risk, blinks, or any effects.',
    views: ['any'],
    params: {
      abilities: { type: 'list', min: 1, required: true, of: { type: 'object', fields: {
        id: { type: 'string', pattern: ID_PATTERN, required: true }, kind: { type: 'string', options: KINDS, required: true }, action: { type: 'string', pattern: ID_PATTERN, effect: 'player verb (default: the id)' },
        cooldown: { type: 'number', default: 1, min: 0, max: 600, unit: 's' }, charges: { type: 'integer', default: 0, min: 0, max: 99, effect: 'starting charges; 0 = unlimited (cooldown only)' },
        maxCharges: { type: 'integer', default: 5, min: 1, max: 99 }, rechargeSec: { type: 'number', default: 0, min: 0, max: 3600, unit: 's', effect: 'one charge back every N seconds (0 = only from pickups)' },
        cost: { type: 'object', fields: { resource: { type: 'ref', to: 'pool', required: true, effect: 'the gameplay.resource pool spent' }, amount: { type: 'number', default: 10, min: 0 } } },
        iframes: { type: 'number', default: 0, min: 0, max: 30, unit: 's' }, sec: { type: 'number', default: 2, min: 0, max: 60, unit: 's' },
        radius: { type: 'number', default: 0, min: 0, max: 10000, unit: 'units' }, damage: { type: 'number', default: 8, min: 0 }, bossFrac: { type: 'number', default: 0.05, min: 0, max: 1 },
        cancelBullets: { type: 'boolean', default: true }, distance: { type: 'number', default: 3, min: 0, max: 1000 }, risk: { type: 'number', default: 0, min: 0, max: 1 },
        area: { type: 'list', min: 2, max: 2, of: { type: 'list', min: 2, max: 3, of: { type: 'number' } }, effect: '[[x0,y0(,z0)],[x1,y1(,z1)]] for hyperspace' }, safeRadius: { type: 'number', default: 3, min: 0 },
        fx: { type: 'effects', default: [] },
      } } },
    },
    provides: { events: ['ability_used', 'ability_used:*', 'ability_empty', 'ability_ready', 'bomb', 'shield_up', 'hyperspace', 'blink'], vars: ['ability.*'], services: ['abilities'] },
    defines: [{ kind: 'active_ability', in: 'abilities' }],
    rules: {
      ability_action_duplicate: { fields: ['abilities[].action', 'abilities[].id'], message: 'each ability has its own player verb (its action, else its id): no two abilities share one' },
      ability_charges_invalid: { fields: ['abilities[].charges', 'abilities[].maxCharges'], message: 'charges (the starting charges) is at most maxCharges',
        example: { abilities: [{ id: 'bomb', kind: 'bomb', action: null, cooldown: null, charges: 3, maxCharges: 1, rechargeSec: null, iframes: null, sec: null, radius: null, damage: null, bossFrac: null, cancelBullets: null, distance: null, risk: null, safeRadius: null }] } },
    },
  },
  logic(logic) {
    logic.effect('use_ability', { refs: e => [['active_ability', e.ability]], run: (e, rt, c) => { const t = resolveWho(rt, e.who, c); if (t) rt.service('abilities').use(t, e.ability, { free: Boolean(e.free) }); } });
    logic.effect('give_charge', { refs: e => [['active_ability', e.ability]], run: (e, rt, c) => { const t = resolveWho(rt, e.who, c); if (t) rt.service('abilities').addCharge(t, e.ability, e.count ?? 1); } });
  },
  validate(config) {
    const errors = [], actions = new Set();
    (Array.isArray(config.abilities) ? config.abilities : []).forEach((a, i) => {
      if (!a || typeof a !== 'object') return;
      const verb = a.action ?? a.id;
      if (actions.has(verb)) errors.push(err('ability_action_duplicate', `with.abilities[${i}].action`, `two abilities on '${verb}'`)); actions.add(verb);
      if (a.charges > a.maxCharges) errors.push(err('ability_charges_invalid', `with.abilities[${i}].charges`, 'charges exceed maxCharges'));
    });
    return errors;
  },
  install(rt, config) {
    const defs = new Map(config.abilities.map(a => [a.id, a]));
    const S = (e, id) => { const s = (rt.store(KEY)[e.id] ??= {}); const d = defs.get(id); return (s[id] ??= { charges: d.charges, cd: 0, recharge: frames(d.rechargeSec) }); };
    const sync = () => { const p = rt.player(); if (!p) return; for (const [id, d] of defs) { const s = S(p, id); rt.state.vars[`ability.${id}`] = counted(d) ? s.charges : -1; rt.state.vars[`ability.${id}.cd`] = round(s.cd / 60, 1e3); } };
    const counted = d => d.charges > 0 || d.rechargeSec > 0;
    const foes = (e, r) => Object.values(rt.state.entities).filter(o => o.space === e.space && o.id !== e.id && o.components.health && combat(rt)?.alive(o) && hostile(rt, e, o) && (!r || distance(rt, e, o) <= r));
    const effect = {
      bomb(e, d) {
        if (d.cancelBullets) service(rt, 'projectiles')?.cancel({ notTeam: teamOf(rt, e), space: e.space, near: d.radius && posOf(e) ? { at: posOf(e), r: d.radius } : undefined, by: e.id });
        for (const o of foes(e, d.radius)) {
          const boss = Boolean(o.components.boss);
          const amount = boss ? Math.max(d.damage, Math.min(combat(rt).maxHp(o) * d.bossFrac, d.damage * 10)) : d.damage;
          combat(rt).hit(o, { amount, by: e.id, source: 'bomb', unblockable: true, ignoreIframes: true });
        }
        rt.emit('bomb', { who: e.id, at: e.at, radius: d.radius });
      },
      shield(e, d) { grantInvuln(e, frames(d.sec)); rt.emit('shield_up', { who: e.id, sec: d.sec }); },
      hyperspace(e, d) {
        const api = spaceOf(rt, e); if (!api?.setPos || !Array.isArray(e.at)) return;
        const [lo, hi] = d.area ? d.area.map(v3) : [[0, 0, 0], v3(api.size ?? [16, 16, 1]).map(v => Math.max(0, v - 1))];
        let at = null;
        for (let k = 0; k < 8; k++) {
          const p = lo.map((v, i) => round(v + rt.random() * Math.max(0, hi[i] - v)));
          if (!foes(e).some(o => posOf(o) && len(sub(posOf(o), p)) < d.safeRadius)) { at = p; break; }
          at = p;
        }
        api.setPos(e, like(e.at, at), rt);
        rt.emit('hyperspace', { who: e.id, at: e.at });
        if (d.risk > 0 && rt.random() < d.risk) combat(rt)?.kill(e, { by: e.id, source: 'hyperspace' });
      },
      blink(e, d) { displace(rt, e, mul(facingOf(e), d.distance)); rt.emit('blink', { who: e.id, at: e.at }); },
      effects() {},
    };
    const api = {
      charges: (e, id) => (defs.has(id) ? S(e, id).charges : 0),
      ready: (e, id) => { const d = defs.get(id); const s = d && S(e, id); return Boolean(d && s.cd <= 0 && (!counted(d) || s.charges > 0)); },
      addCharge(e, id, n = 1) { const d = defs.get(id); if (!d) return; const s = S(e, id); s.charges = Math.min(d.maxCharges, s.charges + n); sync(); },
      use(e, id, { free = false } = {}) {
        const d = defs.get(id); if (!d || !e || e.components.health?.dead) return false;
        const s = S(e, id);
        if (!free) {
          if (s.cd > 0) return false;
          if (counted(d) && s.charges <= 0) { rt.emit('ability_empty', { who: e.id, ability: id }); return false; }
          if (d.cost && service(rt, 'resources')?.has(e, d.cost.resource) && !rt.service('resources').spend(e, d.cost.resource, d.cost.amount, { partial: false })) { rt.emit('ability_empty', { who: e.id, ability: id, reason: 'cost' }); return false; }
          if (counted(d)) s.charges--;
          s.cd = frames(d.cooldown);
        }
        if (d.iframes) grantInvuln(e, frames(d.iframes));
        effect[d.kind](e, d);
        rt.run(d.fx, { self: e.id });
        rt.emitTyped('ability_used', id, { who: e.id, ability: id, kind: d.kind, charges: s.charges });
        sync(); return true;
      },
    };
    rt.provide('abilities', api);
    for (const d of config.abilities) rt.action(d.action ?? d.id, (v, rt) => { const p = rt.player(); if (p) api.use(p, d.id); });
    rt.system('rules', rt => {
      for (const [who, all] of Object.entries(rt.store(KEY))) {
        const e = rt.entity(who); if (!e) continue;
        for (const [id, s] of Object.entries(all)) {
          const d = defs.get(id); if (!d) continue;
          if (s.cd > 0 && --s.cd === 0) rt.emit('ability_ready', { who, ability: id });
          if (d.rechargeSec && s.charges < d.maxCharges && --s.recharge <= 0) { s.charges++; s.recharge = frames(d.rechargeSec); }
        }
      }
      sync();
    }, KEY);
    rt.on('game_start', sync);
  },
};
export { add };
