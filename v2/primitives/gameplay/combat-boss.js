// gameplay.combat.boss: authored encounters over any entity with health.
// A boss starts when the player enters its arena (or by start_boss / on spawn),
// locks the arena, publishes boss.hp / boss.hp.max / boss.phase, and walks a
// phase table keyed on hp fraction (`at`) and/or a predicate (`when`). Each phase
// sets components.boss.pattern (attack ids for gameplay.ai.attacks) and speed,
// can summon adds, run effects, grant phase invulnerability and cancel the
// boss's live bullets. Optional time limit (the boss escapes), enrage, and tiring
// (from the boss mod: every few seconds it is dazed, harmless, and a touch hurts
// it, so it can always be beaten). Required bosses gate progress; a player death
// mid-fight resets the encounter when retryReset is on.
import { frames, sub, len, posOf, like, spaceOf, distance, resolveWho, combat, service, intercept, teamOf, round, err, archetypes } from './combat-lib.js';

const KEY = 'gameplay.combat.boss';
const STATES = ['idle', 'active', 'defeated', 'escaped'];

const PHASE = {
  at: { type: 'number', default: 1, min: 0, max: 1, effect: 'phase starts when hp fraction falls to this' },
  when: { type: 'predicate', effect: 'extra condition for the phase (boss is self)' },
  pattern: { type: 'list', of: { type: 'string' }, default: [], effect: 'attack ids the boss uses in this phase' },
  speed: { type: 'number', default: 1, min: 0.1, max: 10, unit: '×' },
  move: { type: 'string', effect: 'movement style hint for AI (hover, sweep, charge, circle...)' },
  summon: { type: 'list', of: { type: 'ref', to: 'archetype' }, default: [] },
  fx: { type: 'effects', default: [] },
  invulnSec: { type: 'number', min: 0, max: 30, unit: 's' },
};
const BOSS = {
  id: { type: 'string', required: true },
  archetype: { type: 'ref', to: 'archetype', required: true },
  name: { type: 'string', display: true, effect: 'the name a person reads on the boss bar' },
  arena: { type: 'ref', to: 'zone' },
  entity: { type: 'string', effect: 'an existing entity id (a character) to use as the boss' },
  start: { type: 'string', options: ['zone', 'effect', 'spawn', 'sight'], default: 'zone' },
  sightRange: { type: 'number', default: 12, min: 0, max: 1000 },
  spawnAt: { type: 'json', effect: 'where to spawn the boss if none exists' },
  hp: { type: 'number', min: 1, effect: 'override the archetype max hp' },
  phases: { type: 'list', min: 1, of: { type: 'object', fields: PHASE } },
  phaseInvulnSec: { type: 'number', default: 0, min: 0, max: 30, unit: 's' },
  cancelBullets: { type: 'boolean', default: false, effect: 'phase changes and defeat clear the boss side’s live shots' },
  timeLimit: { type: 'number', default: 0, min: 0, max: 3600, unit: 's', effect: '0 = none; when it runs out the boss escapes' },
  onTimeout: { type: 'effects', default: [] },
  onStart: { type: 'effects', default: [] },
  onDefeat: { type: 'effects', default: [] },
  rewards: { type: 'object', fields: {}, open: true },
  gate: { type: 'boolean', default: false, effect: 'progress waits on this boss (sets flag boss_<id>_defeated)' },
  required: { type: 'boolean', default: false, effect: 'counts toward var bosses.remaining for stage clears' },
  lockArena: { type: 'boolean', default: true },
  tire: { type: 'object', fields: { every: { type: 'number', default: 9, min: 0.5 }, daze: { type: 'number', default: 2.5, min: 0.1 }, touchDamage: { type: 'number', default: 0, min: 0 }, touchFrac: { type: 'number', default: 0.08, min: 0, max: 1 }, touchCooldown: { type: 'number', default: 0.8, min: 0 } } },
  enrage: { type: 'object', fields: { afterSec: { type: 'number', default: 120, min: 0 }, speed: { type: 'number', default: 1.5, min: 1 } } },
};

export default {
  id: KEY,
  card: {
    loop: { verbs: [], progress: ['boss_hit', 'boss_phase', 'boss_defeated'], win: { param: 'bosses.onDefeat', reads: { component: 'health', of: 'opponents', by: { events: ['died'], effects: ['damage'] } } } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "archetypes", "component": "health", "kinds": ["boss"], "min": 1, "placed": 1, "why": "a boss encounter needs a boss archetype with health (and attacks) that bosses[].archetype names", "example": {"id": "gate_golem", "kind": "boss", "components": {"health": {"max": 60}, "attacks": [{"id": "stomp", "range": 4, "windup": 0.9, "active": 0.3, "recover": 1.2, "damage": 2, "shape": "circle", "weight": 2}]}}},
    ],
    intent: 'Boss encounters: arena lock, boss health bar vars, phases by hp fraction or predicate that switch attack patterns and speed, summon adds, run effects, phase invulnerability and bullet cancels, time limits, enrage, tiring/dazed windows, required bosses and retry reset.',
    views: ['any'],
    params: {
      bosses: { type: 'list', min: 1, required: true, of: { type: 'object', fields: BOSS } },
      retryReset: { type: 'boolean', default: true, effect: 'the player dying mid-fight resets the boss' },
    },
    provides: { events: ['boss_start', 'boss_start:*', 'boss_phase', 'boss_phase:*', 'boss_defeated', 'boss_defeated:*', 'boss_escaped', 'boss_reset', 'boss_dazed', 'boss_hit', 'boss_invulnerable', 'boss_enraged', 'arena_locked'], vars: ['boss.hp', 'boss.hp.max', 'boss.phase', 'boss.id', 'bosses.remaining'] },
    requires: { primitives: ['gameplay.combat.health'] },
    defines: [{ kind: 'boss', in: 'bosses' }],
    rules: {
      boss_phase_order: { fields: ['bosses[].phases[].at'], message: 'phases are listed from the highest hp fraction to the lowest (a phase with a when condition may break the order)',
        example: { doc: { systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.combat.boss', with: { bosses: [{ id: 'warden', archetype: 'warden', phases: [{ at: 0.5 }, { at: 1 }] }] } }] } } },
      boss_pattern_unknown: { fields: ['bosses[].phases[].pattern', 'bosses[].archetype'], message: "each pattern id names an attack of the boss archetype (components.attacks ids, components.melee moves) or a gameplay.combat.melee move",
        example: { doc: { systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.combat.boss', with: { bosses: [{ id: 'warden', archetype: 'warden', phases: [{ at: 1, pattern: ['no_such_attack'] }] }] } }] } } },
      boss_health_missing: { fields: ['bosses[].archetype', 'bosses[].hp'], message: 'the boss archetype has a health component, or the boss gives hp',
        example: { bosses: [{ id: 'key', archetype: 'key', name: null, entity: null, start: null, sightRange: null, hp: null, phaseInvulnSec: null, cancelBullets: null, timeLimit: null, gate: null, required: null, lockArena: null, tire: null, enrage: null }] } },
    },
  },
  logic(logic) {
    logic.predicate('boss', { refs: p => [['boss', p.boss]], test: (p, rt) => { const s = rt.store(KEY)[p.boss]?.state ?? 'idle'; return p.state ? s === p.state : s === 'active'; } });
    logic.effect('start_boss', { refs: e => [['boss', e.boss]], run: (e, rt) => rt.service('boss').start(e.boss) });
    logic.effect('end_boss', { refs: e => [['boss', e.boss]], run: (e, rt) => rt.service('boss').escape(e.boss) });
  },
  validate(config, doc) {
    const errors = [], arch = new Map(archetypes(doc).map(a => [a.id, a]));
    const lib = new Set((doc.systems || []).filter(s => s.use === 'gameplay.combat.melee').flatMap(s => (s.with?.moves || []).map(m => m.id)));
    (config.bosses || []).forEach((b, i) => {
      const path = `with.bosses[${i}]`, a = arch.get(b.archetype);
      (b.phases || []).forEach((p, j) => { if (j && p.at > b.phases[j - 1].at && !p.when) errors.push(err('boss_phase_order', `${path}.phases[${j}].at`, 'phases must be listed from highest hp fraction to lowest')); });
      if (!a) return;
      const moves = new Set([...(a.components?.attacks || []).map(x => x.id), ...(Array.isArray(a.components?.melee?.moves) ? a.components.melee.moves : Object.keys(a.components?.melee?.moves || {})), ...lib]);
      (b.phases || []).forEach((p, j) => (p.pattern || []).forEach((id, k) => { if (!moves.has(id)) errors.push(err('boss_pattern_unknown', `${path}.phases[${j}].pattern[${k}]`, `'${b.archetype}' has no attack '${id}'`, `attacks: ${[...moves].slice(0, 12).join(', ') || 'none'}`)); }));
      if (!a.components?.health && b.hp === undefined) errors.push(err('boss_health_missing', `${path}.archetype`, `boss archetype '${b.archetype}' has no health component`));
    });
    return errors;
  },
  install(rt, config) {
    const defs = new Map(config.bosses.map(b => [b.id, b]));
    const S = id => { const s = (rt.store(KEY)[id] ??= { state: 'idle' }); return s; };
    const entityOf = id => { const s = S(id); return s.entity ? rt.entity(s.entity) : null; };
    const findOrSpawn = b => {
      if (b.entity && rt.entity(b.entity)) return rt.entity(b.entity);
      const p = rt.player();
      const live = Object.values(rt.state.entities).filter(e => e.archetype === b.archetype && !e.components.health?.dead);
      const inArena = live.find(e => b.arena && e.zone === b.arena);
      if (inArena || live[0]) return inArena || live[0];
      const space = p?.space ?? rt.doc.spaces[0].id;
      const e = rt.spawn(b.archetype, { space, at: b.spawnAt ?? null });
      if (!b.spawnAt && b.arena) rt.space(space).teleport?.(e, { zone: b.arena }, rt);
      return e;
    };
    const sync = () => {
      const active = [...defs.keys()].find(id => S(id).state === 'active'), e = active && entityOf(active);
      if (e?.components.health) { rt.state.vars['boss.hp'] = round(e.components.health.hp ?? 0); rt.state.vars['boss.hp.max'] = round(combat(rt).maxHp(e)); rt.state.vars['boss.phase'] = S(active).phase; rt.state.vars['boss.id'] = active; }
      else { rt.state.vars['boss.id'] = ''; }
      rt.state.vars['bosses.remaining'] = config.bosses.filter(b => (b.required || b.gate) && S(b.id).state !== 'defeated').length;
    };
    const setPhase = (b, i, first = false) => {
      const s = S(b.id), e = entityOf(b.id), ph = b.phases[i]; s.phase = i;
      const enr = s.enraged ? b.enrage?.speed ?? 1 : 1;
      e.components.boss = { id: b.id, phase: i, pattern: ph.pattern.slice(), speed: ph.speed * enr, move: ph.move ?? null, dazed: false };
      if (!first) {
        const inv = frames(ph.invulnSec ?? b.phaseInvulnSec); if (inv) s.invuln = inv;
        if (b.cancelBullets) service(rt, 'projectiles')?.cancel({ team: teamOf(rt, e), space: e.space, by: e.id });
        rt.emitTyped('boss_phase', b.id, { boss: b.id, phase: i, at: e.at });
      }
      for (const a of ph.summon) { const add = rt.spawn(a, { space: e.space, at: Array.isArray(e.at) ? e.at.slice() : e.at }); (add.components.health ??= add.components.health); s.adds = [...(s.adds || []), add.id]; }
      rt.run(ph.fx, { self: e.id });
    };
    const api = {
      state: id => S(id).state,
      entity: id => entityOf(id),
      start(id) {
        const b = defs.get(id); if (!b) return false;
        const s = S(id); if (s.state === 'active' || s.state === 'defeated') return false;
        const e = findOrSpawn(b); if (!e) return false;
        if (b.hp && e.components.health) { e.components.health.max = b.hp; e.components.health.hp = b.hp; }
        Object.assign(s, { state: 'active', entity: e.id, phase: 0, t: 0, invuln: 0, tire: b.tire ? frames(b.tire.every) : 0, daze: 0, touchCd: 0, enraged: false, adds: [], arenaAt: null });
        setPhase(b, 0, true);
        rt.emitTyped('boss_start', id, { boss: id, title: b.name ?? rt.archetype(b.archetype)?.name ?? b.archetype, who: e.id });
        if (b.lockArena && b.arena) rt.emit('arena_locked', { boss: id, zone: b.arena });
        rt.run(b.onStart, { self: e.id });
        sync(); return true;
      },
      escape(id) {
        const b = defs.get(id), s = S(id); if (s.state !== 'active') return;
        s.state = 'escaped'; rt.emitTyped('boss_escaped', id, { boss: id }); rt.run(b.onTimeout, { self: s.entity });
        const e = entityOf(id); if (e) rt.despawn(e.id);
        sync();
      },
      reset(id) {
        const b = defs.get(id), s = S(id), e = entityOf(id); if (s.state !== 'active') return;
        s.state = 'idle';
        if (e?.components.health) { if (e.components.health.dead) combat(rt).revive(e); else combat(rt).heal(e, Infinity); if (e.components.health.home) rt.space(e.space).setPos?.(e, e.components.health.home.slice(), rt); }
        for (const a of s.adds || []) if (rt.entity(a)) rt.despawn(a);
        if (e) delete e.components.boss;
        rt.emitTyped('boss_reset', id, { boss: id }); sync();
      },
    };
    rt.provide('boss', api);

    // Start triggers.
    for (const b of config.bosses) {
      if (b.start === 'zone' && b.arena) rt.on(`enter_zone:${b.arena}`, ({ who }) => { if (who === 'player') api.start(b.id); });
      if (b.start === 'spawn') rt.on('spawn', ({ archetype }) => { if (archetype === b.archetype) api.start(b.id); });
      if (b.arena && b.lockArena) rt.on('leave_zone', ({ who, zone }) => {
        const s = S(b.id); if (who !== 'player' || zone !== b.arena || s.state !== 'active' || !s.arenaAt) return;
        const p = rt.player(); rt.space(p.space).setPos?.(p, s.arenaAt.slice(), rt);
      });
    }
    rt.on('died', ({ who }) => {
      for (const b of config.bosses) {
        const s = S(b.id);
        if (s.state === 'active' && s.entity === who) {
          s.state = 'defeated';
          const e = rt.entity(who);
          if (b.cancelBullets && e) service(rt, 'projectiles')?.cancel({ team: teamOf(rt, e), space: e.space, by: who });
          if (b.gate || b.required) rt.state.flags[`boss_${b.id}_defeated`] = true;
          rt.emitTyped('boss_defeated', b.id, { boss: b.id, who, rewards: b.rewards ?? null });
          rt.run(b.onDefeat, { self: who });
          sync();
        } else if (s.state === 'active' && who === 'player' && config.retryReset) api.reset(b.id);
      }
    });
    // Phase invulnerability and dazed state.
    intercept(rt, 5, (d, hit) => {
      const id = d.components.boss?.id, s = id && S(id);
      if (s?.state === 'active' && s.entity === d.id && s.invuln > 0) { rt.emit('boss_invulnerable', { boss: id }); return { cancel: true, reason: 'boss_invulnerable' }; }
      return hit;
    }, KEY);

    rt.system('rules', rt => {
      const p = rt.player();
      for (const b of config.bosses) {
        const s = S(b.id);
        if (s.state === 'idle' && b.start === 'sight' && p) { const e = Object.values(rt.state.entities).find(x => x.archetype === b.archetype && !x.components.health?.dead); if (e && distance(rt, e, p) <= b.sightRange) api.start(b.id); }
        if (s.state !== 'active') continue;
        const e = entityOf(b.id);
        if (!e) { s.state = 'escaped'; rt.emitTyped('boss_escaped', b.id, { boss: b.id, reason: 'gone' }); continue; }
        s.t++; if (s.invuln > 0) s.invuln--;
        if (p && b.arena && p.zone === b.arena && Array.isArray(p.at)) s.arenaAt = p.at.slice();
        // Phase table: the furthest phase whose hp threshold is reached and predicate holds.
        const frac = (e.components.health?.hp ?? 0) / Math.max(1e-9, combat(rt).maxHp(e));
        let next = s.phase;
        for (let i = s.phase + 1; i < b.phases.length; i++) { const ph = b.phases[i]; if (frac <= ph.at + 1e-9 && (!ph.when || rt.test(ph.when, { self: e.id }))) next = i; else if (!ph.when) break; }
        if (next !== s.phase) setPhase(b, next);
        if (b.enrage && !s.enraged && s.t >= frames(b.enrage.afterSec)) { s.enraged = true; e.components.boss.speed = b.phases[s.phase].speed * b.enrage.speed; rt.emit('boss_enraged', { boss: b.id }); }
        if (b.timeLimit && s.t >= frames(b.timeLimit)) { api.escape(b.id); continue; }
        if (b.tire) {
          if (s.touchCd > 0) s.touchCd--;
          if (s.daze > 0) {
            s.daze--; e.components.boss.dazed = s.daze > 0;
            if (e.components.health) { e.components.health.stun = Math.max(e.components.health.stun || 0, 2); e.components.health.stunKind = 'dazed'; }
            if (p && s.touchCd === 0 && distance(rt, p, e) <= (e.components.body?.size ? Math.max(...e.components.body.size) : 1) + 0.55) {
              s.touchCd = frames(b.tire.touchCooldown);
              const amount = b.tire.touchDamage || Math.max(1, combat(rt).maxHp(e) * b.tire.touchFrac);
              combat(rt).hit(e, { amount, by: p.id, source: 'stomp', ignoreIframes: true, unblockable: true });
              rt.emit('boss_hit', { boss: b.id, by: p.id, how: 'stomp' });
            }
          } else if (--s.tire <= 0) { s.tire = frames(b.tire.every); s.daze = frames(b.tire.daze); e.components.boss.dazed = true; rt.emit('boss_dazed', { boss: b.id, at: e.at }); }
        }
      }
      sync();
    }, KEY);
  },
};
export { STATES };
