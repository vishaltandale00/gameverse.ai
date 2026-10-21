// gameplay.ai.brain: one behavior selector for every NPC in any space.
// Each entity with an `ai` component carries an ordered behavior list; the
// first behavior whose `when` predicate holds (evaluated with context.self =
// the agent) runs. Perception (sight cone with line of sight, hearing, memory),
// factions with provocation, aggro leashes, group alert, a global mode schedule
// (scatter/chase tables per tier, as in maze games) and distance LOD are shared
// by every behavior. Behaviors only write movement intents (KERNEL_API §2,
// ai-lib.js); nothing is ever teleported.
import {
  objectParam, v3, add, sub, mul, len, norm, dot, r6, round6, spaceOf, can, continuous, upAt, planar, distBetween, distTo, facingOf, sees,
  centerOf, clearLine, deltaTo, moverOwned, attacking, headingOf, randomPoint, firstHop, selfRelative, ensureLocomotion, cleanupOnDespawn, zonePoint, dead, between,
} from './ai-lib.js';

const ID = 'gameplay.ai.brain';
export const KINDS = ['wander', 'patrol', 'chase', 'flee', 'follow', 'guard', 'flyer', 'circle', 'ambush', 'sit', 'work', 'target-tile', 'sight-challenge', 'goto'];
const NEEDS_TARGET = new Set(['chase', 'flee', 'ambush']);

// Maze-ghost personalities as data: each is a target rule for `target-tile`.
export const PERSONALITIES = {
  chaser: { aim: 'target' },                          // the target's tile
  ambusher: { aim: 'ahead', ahead: 4 },               // 4 tiles ahead of the target
  vector: { aim: 'vector', ahead: 2, partner: 'chaser' }, // reflect the partner through 2 ahead
  shy: { aim: 'shy', within: 8 },                     // chase until 8 tiles away, then scatter
};
// Grid directions in classic tie order U, L, D, R. 'screen' = y grows downward.
const GRID = { screen: [[0, -1, 0], [-1, 0, 0], [0, 1, 0], [1, 0, 0]], world: [[0, 1, 0], [-1, 0, 0], [0, -1, 0], [1, 0, 0]], xz: [[0, 0, -1], [-1, 0, 0], [0, 0, 1], [1, 0, 0]] };
const rev = d => (d < 0 ? d : (d + 2) % 4);

const n = (d, extra = {}) => ({ type: 'number', ...(d === undefined ? {} : { default: d }), ...extra });
const at = { type: 'json', effect: 'a position in the space (array) or node id' };
const BEHAVIOR = {
  do: { type: 'string', options: KINDS, required: true, effect: 'behavior kind' },
  when: { type: 'predicate', effect: 'run this behavior while it holds (context.self = agent; near/zone default to who:self)' },
  target: { type: 'string', effect: "'player', an entity/character id, or 'hostile' (nearest remembered hostile)" },
  range: n(undefined, { min: 0, effect: 'wander/patrol radius, flee distance, circle radius, sight-challenge reach' }),
  speed: n(undefined, { min: 0, effect: 'speed multiplier for this behavior (×ai.speed); absolute tiles/s for target-tile' }),
  run: { type: 'boolean', effect: 'use the run multiplier' },
  distance: n(undefined, { min: 0, effect: 'follow/chase stop distance' }),
  radius: n(undefined, { min: 0, effect: 'guard radius' }),
  at, route: { type: 'list', of: { type: 'json' }, effect: 'patrol waypoints (positions or zone ids)' },
  loop: { type: 'boolean', effect: 'patrol loops instead of ping-pong' },
  pause: { type: 'json', effect: 'seconds (or [min,max]) to wait at wander/patrol points' },
  height: n(undefined, { effect: 'flyer hover height above the target' }),
  burst: n(undefined, { min: 0, effect: 'ambush speed multiplier for burstSec' }), burstSec: n(undefined, { min: 0 }),
  leash: n(undefined, { min: 0, effect: 'override the agent leash for this behavior' }),
  activity: { type: 'string', effect: 'work/sit activity label' },
  // target-tile
  personality: { type: 'string', options: Object.keys(PERSONALITIES) },
  aim: { type: 'string', options: ['target', 'ahead', 'vector', 'shy', 'fixed'] },
  ahead: n(undefined), partner: { type: 'string', effect: 'personality or entity id used by the vector aim' }, within: n(undefined, { min: 0 }),
  scatter: at, home: at, grid: { type: 'string', options: Object.keys(GRID) },
  frightWhen: { type: 'predicate' }, homeWhen: { type: 'predicate' }, frightSpeed: n(undefined, { min: 0 }), homeSpeed: n(undefined, { min: 0 }),
  elroy: { type: 'list', of: { type: 'object', fields: { when: { type: 'predicate', required: true }, speed: n(1, { min: 0 }), chaseInScatter: { type: 'boolean', default: true } } } },
  slow: { type: 'list', of: { type: 'object', fields: { zone: { type: 'ref', to: 'zone', required: true }, speed: n(0.5, { min: 0 }) } }, effect: 'speed multipliers inside zones (tunnels)' },
  noUp: { type: 'list', of: { type: 'json' }, effect: 'cells where an upward turn is forbidden unless frightened' },
  // sight-challenge
  then: { type: 'effects', effect: 'effects run when a sight-challenge reaches its target (start_dialogue, start a battle...)' },
  once: { type: 'boolean' }, fov: n(undefined, { min: 0, max: 360 }), stop: n(undefined, { min: 0 }),
};
const PERCEPTION = { sight: n(undefined, { min: 0, unit: 'space units' }), fov: n(undefined, { min: 0, max: 360, unit: 'deg' }), hearing: n(undefined, { min: 0 }), memory: n(undefined, { min: 0, unit: 's' }) };
export const AI_COMPONENT = {
  brain: { type: 'list', required: true, min: 1, of: { type: 'object', fields: BEHAVIOR } },
  perception: { type: 'object', fields: PERCEPTION },
  speed: n(undefined, { min: 0, effect: 'walk speed, space units/s' }), run: n(undefined, { min: 1, effect: 'run multiplier' }),
  faction: { type: 'string' }, leash: n(undefined, { min: 0 }), alert: n(undefined, { min: 0, effect: 'group alert radius' }),
  pack: { type: 'object', fields: { size: { type: 'json' }, alert: n(undefined, { min: 0 }) } },
  home: at, plane: { type: 'string', options: ['auto', 'xy', 'xz', 'xyz'] }, fly: { type: 'boolean' },
  drive: { type: 'string', options: ['self', 'intent'], effect: "'intent' = only write intents (a move.* primitive executes them)" },
  crowd: { type: 'boolean', effect: 'pedestrian handled by gameplay.ai.crowd' },
  climbs: { type: 'boolean' }, medium: { type: 'string' }, burnsInSun: { type: 'boolean' },
};

const DEFAULT_FACTIONS = {
  player: { hostile: ['enemy', 'boss', 'hostile'] }, ally: { hostile: ['enemy', 'boss', 'hostile'] },
  enemy: { hostile: ['player', 'ally'] }, boss: { hostile: ['player', 'ally'] }, hostile: { hostile: ['player', 'ally'] },
};

const st = rt => rt.store(ID);
const agentOf = (rt, id) => st(rt).agents?.[id];

export function factionOf(rt, e) {
  if (!e) return null;
  if (e.components?.ai?.faction) return e.components.ai.faction;
  if (e.id === 'player') return 'player';
  return rt.archetype(e.archetype)?.kind ?? 'neutral';
}
/** Is b hostile to a? Faction table, dynamic overrides (wanted, scripts) and provocation grudges. */
export function hostile(rt, a, b) {
  if (!a || !b || a.id === b.id) return false;
  const s = st(rt), fa = factionOf(rt, a), fb = factionOf(rt, b);
  if (s.grudges?.[a.id]?.[b.id] !== undefined) return true;
  const o = s.overrides?.[`${fa}>${fb}`];
  if (o !== undefined) return o;
  const table = rt.caches.aiFactions || DEFAULT_FACTIONS;
  return Boolean(table[fa]?.hostile?.includes(fb));
}

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['aggro', 'spotted', 'lost_target'] },
    // Shapes of the archetype components this primitive owns (the planner's schemas and repair read them).
    components: { ai: { type: 'object', fields: AI_COMPONENT, effect: 'behavior list (first whose when holds runs), perception, speed' } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "archetypes", "component": "ai", "min": 1, "placed": 2, "why": "the AI runs on archetypes with an ai component (a behavior list), placed in the world", "example": {"id": "patroller", "kind": "enemy", "components": {"ai": {"brain": [{"do": "chase", "when": {"near": "player", "within": 6}}, {"do": "wander", "range": 6}], "speed": 2}}}},
    ],
    intent: 'NPC behavior: each `ai` component lists behaviors (wander patrol chase flee follow guard flyer circle ambush sit work goto target-tile sight-challenge) with predicates; shared perception (sight cone + line of sight, hearing, memory), factions, aggro leash, group alert, a scatter/chase mode schedule, and distance LOD. Agents only write movement intents.',
    views: ['any'],
    params: {
      tick: n(0.2, { min: 0.016, max: 5, unit: 's', effect: 'how often each agent re-thinks (perception + behavior choice)' }),
      maxActive: { type: 'integer', default: 120, min: 1, max: 5000, effect: 'distance LOD: only the N agents nearest the player think and move' },
      perception: objectParam({ type: 'object', fields: { sight: n(20, { min: 0 }), fov: n(150, { min: 0, max: 360 }), hearing: n(10, { min: 0 }), memory: n(8, { min: 0 }) }, effect: 'defaults for agents whose ai component omits perception' }),
      leash: n(40, { min: 0, effect: 'agents give up a target once this far from home (0 = never)' }),
      alertRadius: n(0, { min: 0, effect: 'default group alert radius (ai.alert / ai.pack.alert override)' }),
      speed: n(2, { min: 0, effect: 'default walk speed, space units/s' }),
      plane: { type: 'string', default: 'auto', options: ['auto', 'xy', 'xz', 'xyz'], effect: 'movement plane; auto = perpendicular to gravity (xy when there is none)' },
      factions: { type: 'object', open: true, default: {}, effect: 'faction → {hostile:[factions]}; merged over the defaults (player/ally vs enemy/boss/hostile)' },
      noise: { type: 'list', default: [{ event: 'fired', radius: 25 }, { event: 'attack_started', radius: 6 }, { event: 'crime', radius: 25 }, { event: 'noise', radius: 10 }],
        of: { type: 'object', fields: { event: { type: 'string', required: true }, radius: n(10, { min: 0 }) } }, effect: 'events heard as noise at the emitter (data.at, or data.who/by position)' },
      modeSchedule: { type: 'object', fields: {
        modes: { type: 'list', default: ['scatter', 'chase'], of: { type: 'string' }, min: 1 },
        table: { type: 'list', required: true, min: 1, of: { type: 'list', of: { type: 'number' }, min: 1 }, effect: 'per tier: seconds of each phase in order; -1 = forever' },
        tierBy: { type: 'object', fields: { var: { type: 'string', required: true }, above: { type: 'list', of: { type: 'number' }, default: [] } }, effect: 'tier = how many thresholds the var exceeds' },
        pauseWhen: { type: 'predicate', effect: 'the clock stops while this holds (fright)' },
        resetOn: { type: 'list', of: { type: 'string' }, default: [], effect: 'events that restart the schedule (level start, life lost)' },
        var: { type: 'string', default: 'ai.mode' }, reverse: { type: 'boolean', default: true, effect: 'target-tile agents reverse on every mode change' },
      }, effect: 'global mode clock (maze scatter/chase); publishes var ai.mode' },
    },
    provides: { events: ['aggro', 'lost_target', 'alerted', 'leashed', 'ambush', 'spotted', 'challenge', 'challenge:*', 'ai_mode', 'ai_mode:*', 'arrived', 'arrived:*', 'move_failed'], vars: ['ai.mode'], services: ['ai.brain'] },
    requires: { capabilities: ['position', 'distance'] },
    reads: ['content.archetypes'],
  },
  logic(logic) {
    const target = (rt, c, who) => rt.resolve(who ?? 'self', c);
    // {aware: 'player'|'hostile'|id, who?}: the agent remembers such a target.
    logic.predicate('aware', { test: (p, rt, c) => {
      const e = target(rt, c, p.who), a = e && agentOf(rt, e.id); if (!a) return false;
      return Object.keys(a.mem || {}).some(id => p.aware === 'hostile' ? hostile(rt, e, rt.entity(id)) : p.aware === 'any' || id === p.aware || rt.entity(id)?.archetype === p.aware);
    } });
    // {behavior: kind, who?}: the agent's current behavior kind.
    logic.predicate('behavior', { check: (p, path, errs) => { if (!KINDS.includes(p.behavior)) errs.push({ code: 'ai_behavior_unknown', path, message: `unknown behavior '${p.behavior}'`, hint: KINDS.join(', ') }); },
      test: (p, rt, c) => { const e = target(rt, c, p.who); return agentOf(rt, e?.id)?.kind === p.behavior; } });
    logic.effect('set_ai', { check: (e, path, errs) => { if (e.mode != null && !KINDS.includes(e.mode)) errs.push({ code: 'ai_behavior_unknown', path: `${path}.mode`, message: `unknown behavior '${e.mode}'` }); },
      run: (e, rt, c) => { const ent = rt.resolve(e.who, c); if (!ent) return; const a = ensureAgent(rt, ent); a.mode = e.mode ?? null; a.next = 0; } });
    const orderOf = o => (typeof o === 'string' ? { do: o } : o); // `order: 'follow'` is shorthand for { do: 'follow' }
    logic.effect('command', { check: (e, path, errs) => { if (!orderOf(e.order) || !KINDS.includes(orderOf(e.order).do)) errs.push({ code: 'ai_order_invalid', path: `${path}.order`, message: 'order needs {do: <behavior kind>, ...}', hint: KINDS.join(', ') }); },
      run: (e, rt, c) => { const ent = rt.resolve(e.who, c); if (!ent) return; const a = ensureAgent(rt, ent); const order = orderOf(e.order); a.order = order.do === 'clear' ? null : { ...order, until: e.sec ? rt.state.time + e.sec : null }; a.next = 0; } });
    logic.effect('make_noise', { run: (e, rt, c) => { const src = rt.resolve(e.who, c); hear(rt, { at: e.at ?? src?.at, space: e.space ?? src?.space, who: src?.id ?? null, radius: e.radius ?? 10 }); } });
    logic.effect('set_hostile', { run: (e, rt) => { (st(rt).overrides ??= {})[`${e.faction}>${e.toward}`] = e.on ?? true; } });
  },
  validate(config, doc, ctx) {
    const errors = [];
    (doc.content?.archetypes || []).forEach((a, i) => {
      const ai = a.components?.ai; if (ai === undefined) return;
      const path = `content.archetypes[${i}].components.ai`;
      validateAi(ai, path, errors, ctx);
    });
    const ms = config.modeSchedule;
    if (ms?.tierBy && ms.table.length !== (ms.tierBy.above?.length ?? 0) + 1) errors.push({ code: 'ai_schedule_tiers', path: 'modeSchedule.table', message: `table needs ${ms.tierBy.above.length + 1} rows (one per tier)` });
    return errors;
  },
  install(rt, config, instance) {
    rt.caches.aiFactions = { ...DEFAULT_FACTIONS, ...config.factions };
    rt.caches.aiBrainConfig = config;
    ensureLocomotion(rt);
    cleanupOnDespawn(rt, [ID]);
    for (const { event, radius } of config.noise) rt.on(event, (data, rt) => {
      const src = rt.entity(data.who ?? data.by);
      hear(rt, { at: data.at ?? src?.at, space: data.space ?? src?.space, who: src?.id ?? null, radius });
    });
    // Provocation: whoever damages an agent becomes its target and enemy.
    rt.on('damaged', (data, rt) => {
      const victim = rt.entity(data.who), by = rt.entity(data.by);
      if (!victim?.components?.ai || !by) return;
      ((st(rt).grudges ??= {})[victim.id] ??= {})[by.id] = true;
      const a = ensureAgent(rt, victim); remember(rt, victim, a, by, true); a.next = 0;
    });
    if (config.modeSchedule) for (const ev of config.modeSchedule.resetOn) rt.on(ev, (_, rt) => { st(rt).mode = null; });
    rt.provide('ai.brain', {
      agent: id => agentOf(rt, id) || null,
      targetOf: id => { const a = agentOf(rt, id); return a?.target ? rt.entity(a.target) : null; },
      remember: (id, targetId) => { const e = rt.entity(id), t = rt.entity(targetId); if (e?.components?.ai && t) remember(rt, e, ensureAgent(rt, e), t, true); },
      forget: id => { const a = agentOf(rt, id); if (a) { a.mem = {}; a.target = null; } },
      hostile: (a, b) => hostile(rt, rt.entity(a), rt.entity(b)),
      setHostile: (faction, toward, on = true) => { (st(rt).overrides ??= {})[`${faction}>${toward}`] = on; },
      factionOf: id => factionOf(rt, rt.entity(id)),
      mode: () => st(rt).mode?.mode ?? null,
    });
    rt.system('ai', rt => {
      if (config.modeSchedule) modeClock(rt, config.modeSchedule);
      trackHeading(rt);
      const s = st(rt), now = rt.state.time;
      const agents = Object.values(rt.state.entities).filter(e => e.components.ai?.brain && e.id !== 'player' && !dead(e));
      // Distance LOD, refreshed twice a second or whenever the agent population changes.
      if (!s.lodAt || now >= s.lodAt || !s.active || s.lodN !== agents.length) { s.active = lod(rt, agents, config.maxActive); s.lodAt = round6(now + 0.5); s.lodN = agents.length; }
      const active = new Set(s.active);
      for (const e of agents) {
        if (!active.has(e.id)) { if (!moverOwned(e)) { delete e.components.steer; if (e.components.moveTo?.by === 'ai') delete e.components.moveTo; } continue; }
        if (e.components.mount?.rider || e.components.mount?.called) continue; // gameplay.mount drives ridden/called mounts
        if (e.components.crowdAgent || e.components.traffic || e.components.boid) continue; // ambient agents owned by crowd/traffic/flock
        const a = ensureAgent(rt, e);
        if (now >= (a.next ?? 0)) { think(rt, e, a, config); a.next = round6(now + config.tick); }
        act(rt, e, a, config);
      }
      if (s.noise?.length) s.noise = s.noise.filter(x => now - x.t <= Math.max(1, config.tick * 2));
    }, ID);
  },
};

function validateAi(ai, path, errors, ctx) {
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) { errors.push({ code: 'param_type', path, message: 'ai component must be an object' }); return; }
  // Field checks (types, ranges, behavior kinds) through the kernel's param checker; open for other primitives' flags.
  for (const [k, schema] of Object.entries(AI_COMPONENT)) if (schema.required && ai[k] === undefined) errors.push({ code: 'param_missing', path: `${path}.${k}`, message: `required ${schema.type}` });
  (Array.isArray(ai.brain) ? ai.brain : []).forEach((b, j) => {
    const bp = `${path}.brain[${j}]`;
    if (!b || typeof b !== 'object') { errors.push({ code: 'param_type', path: bp, message: 'behavior must be an object' }); return; }
    if (!KINDS.includes(b.do)) errors.push({ code: 'ai_behavior_unknown', path: `${bp}.do`, message: `unknown behavior '${b.do}'`, hint: KINDS.join(', ') });
    for (const k of Object.keys(b)) if (!(k in BEHAVIOR)) errors.push({ code: 'param_unknown', path: `${bp}.${k}`, message: `unknown behavior parameter '${k}'`, hint: `known: ${Object.keys(BEHAVIOR).join(', ')}` });
    for (const k of ['when', 'frightWhen', 'homeWhen']) if (b[k] !== undefined) ctx.checkPredicate(b[k], `${bp}.${k}`, errors);
    (b.elroy || []).forEach((x, q) => x?.when && ctx.checkPredicate(x.when, `${bp}.elroy[${q}].when`, errors));
    (b.then || []).forEach((x, q) => ctx.checkEffect(x, `${bp}.then[${q}]`, errors));
    for (const k of ['range', 'speed', 'distance', 'radius', 'height', 'burst', 'leash', 'within', 'stop']) if (b[k] !== undefined && !(Number.isFinite(b[k]) && b[k] >= 0)) errors.push({ code: 'param_range', path: `${bp}.${k}`, message: `${k} must be a number ≥ 0` });
    if (b.do === 'target-tile' && !b.personality && !b.aim) errors.push({ code: 'ai_target_rule', path: bp, message: 'target-tile needs a personality or an aim', hint: Object.keys(PERSONALITIES).join(', ') });
    if (b.do === 'sight-challenge' && !Array.isArray(b.then)) errors.push({ code: 'ai_challenge_then', path: `${bp}.then`, message: 'sight-challenge needs `then` effects' });
    if (b.do === 'patrol' && b.route !== undefined && (!Array.isArray(b.route) || !b.route.length)) errors.push({ code: 'param_range', path: `${bp}.route`, message: 'route needs at least one point' });
  });
  const p = ai.perception;
  if (p !== undefined) for (const [k, v] of Object.entries(p)) {
    if (!(k in PERCEPTION)) errors.push({ code: 'param_unknown', path: `${path}.perception.${k}`, message: `unknown perception field '${k}'` });
    else if (!(Number.isFinite(v) && v >= 0) || (k === 'fov' && v > 360)) errors.push({ code: 'param_range', path: `${path}.perception.${k}`, message: `${k} out of range` });
  }
  for (const k of ['speed', 'leash', 'alert']) if (ai[k] !== undefined && !(Number.isFinite(ai[k]) && ai[k] >= 0)) errors.push({ code: 'param_range', path: `${path}.${k}`, message: `${k} must be a number ≥ 0` });
}

// ---------- agent state ----------
function ensureAgent(rt, e) {
  const s = st(rt); s.agents ??= {};
  if (!s.agents[e.id]) s.agents[e.id] = { home: e.components.ai?.home ?? (Array.isArray(e.at) ? r6(v3(e.at)) : e.at), mem: {}, target: null, kind: null, i: -1, next: round6(rt.state.time + rt.random() * (rt.caches.aiBrainConfig?.tick ?? 0.2)), dir: -1 };
  return s.agents[e.id];
}
const perceptionOf = (e, config) => ({ ...config.perception, ...(e.components.ai.perception || {}) });
const baseSpeed = (e, config) => e.components.ai.speed ?? config.speed;

/** The player's last movement direction (maze ghosts aim ahead of it), wrap-aware. */
function trackHeading(rt) {
  const p = rt.player(); if (!p || !continuous(p)) return;
  const s = st(rt), tr = (s.track ??= {});
  const api = spaceOf(rt, p);
  if (tr.at && tr.space === p.space) { const d = deltaTo(api, tr.at, p.at); if (len(d) > 1e-6) tr.dir = r6(norm(d)); }
  tr.at = r6(v3(p.at)).slice(0, p.at.length); tr.space = p.space;
}

function lod(rt, agents, max) {
  if (agents.length <= max) return agents.map(e => e.id);
  const p = rt.player();
  const d = e => (p && e.space === p.space ? distBetween(rt, e, p) : Infinity);
  return agents.map(e => [e.id, d(e)]).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).slice(0, max).map(x => x[0]);
}

function hear(rt, noise) {
  if (noise.at == null || !noise.space) return;
  (st(rt).noise ??= []).push({ ...noise, at: Array.isArray(noise.at) ? r6(v3(noise.at)) : noise.at, t: rt.state.time });
}

function remember(rt, e, a, t, seen) {
  const fresh = !Object.keys(a.mem).some(id => hostile(rt, e, rt.entity(id)));
  a.mem[t.id] = { at: Array.isArray(t.at) ? r6(v3(t.at)) : t.at, t: rt.state.time, seen };
  if (fresh && hostile(rt, e, t)) { rt.emit('aggro', { who: e.id, target: t.id }); return true; }
  return false;
}

// ---------- think: perception and behavior choice ----------
function think(rt, e, a, config) {
  const P = perceptionOf(e, config), now = rt.state.time, facing = facingOf(e, headingOf(rt, e.id) || a.face);
  const player = rt.player();
  const candidates = Object.values(rt.state.entities).filter(o => o !== e && o.space === e.space && !dead(o) && (o.id === 'player' || (o.components.ai && hostile(rt, e, o)) || st(rt).grudges?.[e.id]?.[o.id]));
  let newlyAware = null;
  for (const o of candidates) {
    if (a.calm?.[o.id] > now) continue;
    if (P.sight > 0 && sees(rt, e, o, { range: P.sight, fov: P.fov, facing })) { if (remember(rt, e, a, o, true)) newlyAware = o; }
  }
  if (P.hearing > 0) for (const x of st(rt).noise || []) {
    if (x.t < (a.heardAt ?? -1) || x.space !== e.space || !x.who || x.who === e.id) continue;
    const src = rt.entity(x.who); if (!src || a.calm?.[src.id] > now) continue;
    const d = continuous(e) ? len(sub(x.at, e.at)) : distTo(rt, e, x.at);
    if (d <= Math.min(x.radius, P.hearing) && (src.id === 'player' || hostile(rt, e, src))) { const was = a.mem[src.id]; a.mem[src.id] = { at: x.at, t: now, seen: false }; if (!was && hostile(rt, e, src)) { rt.emit('aggro', { who: e.id, target: src.id, heard: true }); newlyAware = src; } }
  }
  a.heardAt = now;
  for (const [id, m] of Object.entries(a.mem)) {
    const o = rt.entity(id);
    if (!o || dead(o) || o.space !== e.space || now - m.t > P.memory) { const wasHostile = o && hostile(rt, e, o); delete a.mem[id]; if (wasHostile && !Object.keys(a.mem).some(k => hostile(rt, e, rt.entity(k)))) rt.emit('lost_target', { who: e.id, target: id }); }
    else if (m.seen && now - m.t > config.tick * 1.5) m.seen = false;
  }
  if (newlyAware) groupAlert(rt, e, newlyAware, config);
  choose(rt, e, a, config, player);
}

function groupAlert(rt, e, target, config) {
  const r = e.components.ai.alert ?? e.components.ai.pack?.alert ?? config.alertRadius;
  if (!(r > 0)) return;
  const f = factionOf(rt, e);
  for (const o of Object.values(rt.state.entities)) {
    if (o === e || !o.components.ai?.brain || o.space !== e.space || dead(o) || factionOf(rt, o) !== f) continue;
    if (distBetween(rt, e, o) > r) continue;
    const b = ensureAgent(rt, o);
    if (b.mem[target.id]) continue;
    b.mem[target.id] = { at: Array.isArray(target.at) ? r6(v3(target.at)) : target.at, t: rt.state.time, seen: false };
    b.next = 0;
    rt.emit('alerted', { who: o.id, by: e.id, target: target.id });
  }
}

/** Entities a behavior's `when` refers to (aware:/near: values), used to pick its target. */
function whenTargets(p, out = []) {
  if (!p || typeof p !== 'object') return out;
  for (const k of ['all', 'any']) if (Array.isArray(p[k])) p[k].forEach(q => whenTargets(q, out));
  if (p.aware !== undefined) out.push(p.aware);
  if (p.near !== undefined) out.push(p.near);
  return out;
}
function pickTarget(rt, e, a, b) {
  const nearestOf = ids => ids.map(id => rt.entity(id)).filter(Boolean).sort((x, y) => distBetween(rt, e, x) - distBetween(rt, e, y) || (x.id < y.id ? -1 : 1))[0] || null;
  const want = b.target ?? whenTargets(b.when)[0];
  if (want === 'hostile' || want === undefined) {
    const h = nearestOf(Object.keys(a.mem).filter(id => hostile(rt, e, rt.entity(id))));
    if (h || want === 'hostile') return h;
    return a.mem.player ? rt.player() : null;
  }
  if (want === 'self') return e;
  const t = rt.resolve(want, { self: e.id });
  if (t) return t;
  return nearestOf(Object.keys(a.mem).filter(id => rt.entity(id)?.archetype === want)); // an archetype
}

function choose(rt, e, a, config, player) {
  const brain = e.components.ai.brain, ctx = { self: e.id };
  let b = null, i = -1;
  if (a.order && a.order.until != null && rt.state.time > a.order.until) a.order = null;
  if (a.order) { b = a.order; i = -2; }
  else if (a.mode) { i = brain.findIndex(x => x.do === a.mode); b = i >= 0 ? brain[i] : { do: a.mode }; }
  else for (let j = 0; j < brain.length; j++) {
    const x = brain[j];
    if (x.when && !rt.test(selfRelative(x.when), ctx)) continue;
    if (NEEDS_TARGET.has(x.do) && !pickTarget(rt, e, a, x)) continue;
    b = x; i = j; break;
  }
  if (!b) b = { do: 'sit' };
  const t = b.do === 'sight-challenge' ? null : pickTarget(rt, e, a, b);
  if (a.i !== i || a.kind !== b.do) { a.phase = null; a.t0 = rt.state.time; if (b.do === 'ambush' && a.kind !== 'ambush') a.ambushed = false; }
  a.i = i; a.kind = b.do; a.target = t?.id ?? null;
}

// ---------- act: per-frame behavior execution (intents only) ----------
function behaviorOf(e, a) { return a.i === -2 ? (a.order || { do: 'sit' }) : a.i >= 0 ? e.components.ai.brain[a.i] : { do: a.kind || 'sit' }; }

function intendMove(e, goal, speed, extra = {}) { delete e.components.steer; e.components.moveTo = { at: Array.isArray(goal) ? r6(goal) : goal, zone: null, run: false, speed, by: 'ai', ...extra }; }
function intendSteer(e, dir, speed, extra = {}) { delete e.components.moveTo; e.components.steer = { dir: r6(norm(dir)), speed, ...extra }; }
function idle(e, a, face) { const c = e.components; delete c.steer; if (c.moveTo?.by === 'ai') delete c.moveTo; if (face) a.face = r6(norm(face)); }

function act(rt, e, a, config) {
  const c = e.components;
  if (c.moveTo && c.moveTo.by !== 'ai') { delete c.steer; return; } // scripted move_to has priority (plot, cutscenes)
  if (attacking(rt, e.id)) { if (c.moveTo?.by === 'ai') delete c.moveTo; return; } // gameplay.ai.attacks owns steer while attacking
  const b = behaviorOf(e, a), api = spaceOf(rt, e); if (!api) return;
  const t = a.target ? rt.entity(a.target) : null;
  const mem = t ? a.mem[t.id] : null;
  const tAt = t && (mem?.seen || !a.mem[t.id] || b.do === 'follow') ? t.at : mem?.at ?? t?.at;
  const speed = baseSpeed(e, config) * (b.speed ?? 1) * (b.run ? (c.ai.run ?? 1.6) : 1);
  const plane = c.ai.plane ?? config.plane;
  const leash = b.leash ?? c.ai.leash ?? config.leash;
  const home = a.home;
  const fromHome = () => (continuous(e) && Array.isArray(home) ? len(planar(api, e.at, sub(e.at, home), plane)) : distTo(rt, e, home));
  const pauseFor = () => { const p = b.pause ?? [0.5, 2]; return Array.isArray(p) ? between(rt, p[0], p[1]) : p; };
  switch (b.do) {
    case 'sit': idle(e, a, t && continuous(e) ? sub(t.at, e.at) : null); return;
    case 'wander': {
      if (a.waitUntil > rt.state.time) { idle(e, a); return; }
      const range = b.range ?? 8;
      if (!continuous(e)) { if (!a.goal || e.at === a.goal) { const ns = can(api, 'neighbors') ? api.neighbors(e.at) : []; a.goal = ns.length ? ns[Math.floor(rt.random() * ns.length)] : e.at; a.waitUntil = round6(rt.state.time + pauseFor()); } intendMove(e, a.goal, speed); return; }
      if (!a.goal || len(sub(a.goal, e.at)) <= Math.max(0.15, speed * rt.dt * 2) || a.goalUntil < rt.state.time) {
        if (a.goal) { a.waitUntil = round6(rt.state.time + pauseFor()); a.goal = null; idle(e, a); return; }
        a.goal = randomPoint(rt, api, home, range, plane); a.goalUntil = round6(rt.state.time + range / Math.max(0.1, speed) * 2 + 1);
      }
      intendMove(e, a.goal, speed); return;
    }
    case 'patrol': {
      const route = patrolRoute(rt, e, a, b, api, plane);
      a.pi ??= 0; a.pdir ??= 1;
      if (a.waitUntil > rt.state.time) { idle(e, a); return; }
      const goal = route[a.pi];
      const reached = continuous(e) ? len(planar(api, e.at, sub(goal, e.at), plane)) <= Math.max(0.15, speed * rt.dt * 2) : e.at === goal;
      if (reached) {
        if (b.loop || route.length < 2) a.pi = (a.pi + 1) % route.length;
        else { if (a.pi + a.pdir < 0 || a.pi + a.pdir >= route.length) a.pdir = -a.pdir; a.pi += a.pdir; }
        if (b.pause !== undefined) a.waitUntil = round6(rt.state.time + pauseFor());
        idle(e, a); return;
      }
      intendMove(e, goal, speed); return;
    }
    case 'chase': case 'ambush': case 'guard': {
      let tgt = t, at2 = tAt;
      if (b.do === 'guard') {
        const post = b.at ?? home, radius = b.radius ?? b.range ?? 8;
        const intruder = tgt && hostile(rt, e, tgt) && (continuous(e) ? len(sub(tgt.at, post)) : distTo(rt, tgt, post)) <= radius;
        if (!intruder) { goHome(rt, e, a, post, speed, api, plane, t); return; }
      }
      if (!tgt) { idle(e, a); return; }
      if (leash > 0 && Array.isArray(home) && fromHome() > leash) {
        a.calm = { ...(a.calm || {}), [tgt.id]: round6(rt.state.time + perceptionOf(e, config).memory) };
        delete a.mem[tgt.id]; a.target = null; a.next = 0;
        rt.emit('leashed', { who: e.id, target: tgt.id });
        intendMove(e, home, speed); return;
      }
      let sp = speed;
      if (b.do === 'ambush') {
        if (!a.ambushed) { a.ambushed = true; a.burstUntil = round6(rt.state.time + (b.burstSec ?? 1)); rt.emit('ambush', { who: e.id, target: tgt.id }); }
        if (a.burstUntil > rt.state.time) sp *= b.burst ?? 1.8;
      }
      const stop = b.distance ?? attackReach(e) ?? 1;
      const d = continuous(e) ? len(planar(api, e.at, sub(at2, e.at), plane)) : distTo(rt, e, at2);
      if (d <= stop) { idle(e, a, continuous(e) ? sub(tgt.at, e.at) : null); return; }
      intendMove(e, at2, sp, { run: true }); return;
    }
    case 'flee': {
      if (!t) { idle(e, a); return; }
      const range = b.range ?? perceptionOf(e, config).sight ?? 10;
      if (distBetween(rt, e, t) >= range) { idle(e, a); return; }
      const sp = speed * (b.speed === undefined ? (c.ai.run ?? 1.6) : 1);
      if (!continuous(e)) { const ns = (can(api, 'neighbors') ? api.neighbors(e.at) : []).sort((x, y) => api.distance(y, t.at) - api.distance(x, t.at) || (x < y ? -1 : 1)); if (ns[0] !== undefined) intendMove(e, ns[0], sp); return; }
      let away = norm(planar(api, e.at, sub(e.at, t.at), plane));
      if (len(away) < 1e-6) away = [1, 0, 0];
      intendSteer(e, fleeDir(api, e, away, plane), sp, { plane }); return;
    }
    case 'follow': {
      if (!t) { idle(e, a); return; }
      const keep = b.distance ?? 2, d = distBetween(rt, e, t);
      if (d <= keep) { idle(e, a, continuous(e) ? sub(t.at, e.at) : null); return; }
      intendMove(e, t.at, d > keep * 3 ? speed * (c.ai.run ?? 1.6) : speed); return;
    }
    case 'flyer': return flyer(rt, e, a, b, t, api, speed);
    case 'circle': {
      if (!continuous(e)) { idle(e, a); return; }
      const center = t ? t.at : home, R = b.range ?? 6, up = upAt(api, e.at);
      const axisA = up ? norm(planar(api, e.at, [1, 0, 0])) : [1, 0, 0], axisB = up ? norm(planar(api, e.at, len(planar(api, e.at, [0, 0, 1])) > 0.5 ? [0, 0, 1] : [0, 1, 0])) : [0, 1, 0];
      if (a.ang === undefined) { const rel = sub(e.at, center); a.ang = Math.atan2(dot(rel, axisB), dot(rel, axisA)); }
      a.ang = round6(a.ang + (speed / Math.max(0.5, R)) * rt.dt);
      const goal = add(center, add(mul(axisA, Math.cos(a.ang) * R), mul(axisB, Math.sin(a.ang) * R)));
      intendSteer(e, sub(goal, e.at), Math.min(speed * 1.5, len(sub(goal, e.at)) / rt.dt), { plane, fly: c.ai.fly }); return;
    }
    case 'work': case 'goto': {
      const sch = c.schedule?.at ? c.schedule : null;
      const spot = b.do === 'goto' ? (b.at ?? (b.target ? rt.resolve(b.target, { self: e.id })?.at : null)) : (sch?.at ?? b.at ?? home);
      a.activity = sch?.doing ?? b.activity ?? (b.do === 'work' ? 'work' : null);
      if (spot == null) { idle(e, a); return; }
      const there = continuous(e) ? len(planar(api, e.at, sub(spot, e.at), plane)) <= Math.max(0.2, speed * rt.dt * 2) : e.at === spot;
      if (there) { idle(e, a); if (b.do === 'goto' && a.i === -2) { a.order = null; rt.emit('order_done', { who: e.id, order: 'goto' }); } return; }
      intendMove(e, spot, speed); return;
    }
    case 'target-tile': return targetTile(rt, e, a, b, api, config);
    case 'sight-challenge': return sightChallenge(rt, e, a, b, api, speed);
    default: idle(e, a);
  }
}

/** Best open direction away from a threat: the escape vector, else the most-away of 16 probes with a clear line. */
function fleeDir(api, e, away, plane) {
  const probe = 2.5, from = centerOf(e, api), up = upAt(api, e.at);
  const open = d => clearLine(api, from, add(from, mul(d, probe)));
  if (open(away)) return away;
  const ax = up ? norm(planar(api, e.at, len(planar(api, e.at, [1, 0, 0])) > 0.5 ? [1, 0, 0] : [0, 0, 1], plane)) : [1, 0, 0];
  const bx = up ? norm(sub(planar(api, e.at, [0, 0, 1], plane), mul(ax, dot(planar(api, e.at, [0, 0, 1], plane), ax)))) : [0, 1, 0];
  let best = null, score = -Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, d = norm(add(mul(ax, Math.cos(a)), mul(len(bx) > 0.5 ? bx : [0, 1, 0], Math.sin(a))));
    const sc = dot(d, away);
    if (sc > score + 1e-9 && open(d)) { score = sc; best = d; }
  }
  return best ?? away;
}

function attackReach(e) {
  const list = e.components.attacks; if (!Array.isArray(list) || !list.length) return null;
  const rs = list.map(x => x.range).filter(r => Number.isFinite(r) && r > 0);
  return rs.length ? Math.max(0.5, Math.min(...rs) * 0.8) : null;
}

function goHome(rt, e, a, post, speed, api, plane, t) {
  const d = continuous(e) ? len(planar(api, e.at, sub(post, e.at), plane)) : (e.at === post ? 0 : 1);
  if (d <= Math.max(0.2, speed * rt.dt * 2)) { idle(e, a, t && continuous(e) ? sub(t.at, e.at) : null); return; }
  intendMove(e, post, speed);
}

function patrolRoute(rt, e, a, b, api, plane) {
  if (a.route) return a.route;
  if (Array.isArray(b.route) && b.route.length) {
    a.route = b.route.map(p => (typeof p === 'string' && continuous(e) ? zonePoint(rt, e.space, p) ?? a.home : Array.isArray(p) ? v3(p) : p));
  } else if (continuous(e)) {
    const range = b.range ?? 6, axis = norm(planar(api, e.at, [1, 0, 0], plane));
    a.route = [r6(add(a.home, mul(axis, -range / 2))), r6(add(a.home, mul(axis, range / 2)))];
  } else {
    const ns = can(api, 'neighbors') ? api.neighbors(e.at) : [];
    a.route = [e.at, ...(ns.length ? [ns[0]] : [])];
  }
  return a.route;
}

function flyer(rt, e, a, b, t, api, speed) {
  if (!continuous(e)) { if (t) intendMove(e, t.at, speed); return; }
  const up = upAt(api, e.at) || [0, 1, 0], h = b.height ?? 3, now = rt.state.time;
  const anchor = t ? t.at : a.home;
  a.phase ??= 'hover'; a.pt ??= now;
  const hoverAt = add(anchor, mul(up, h));
  if (a.phase === 'hover') {
    const toHover = sub(hoverAt, e.at);
    if (t && now - a.pt > 1.5 && len(toHover) < h * 1.5 && distBetween(rt, e, t) <= (b.range ?? h * 4)) { a.phase = 'dive'; a.pt = now; a.diveAt = r6(v3(t.at)); }
    if (len(toHover) > 0.1) intendSteer(e, toHover, Math.min(speed, len(toHover) / rt.dt), { fly: true }); else idle(e, a);
  } else if (a.phase === 'dive') {
    const toT = sub(a.diveAt, e.at);
    if (len(toT) < 0.5 || now - a.pt > 1.2) { a.phase = 'climb'; a.pt = now; }
    else intendSteer(e, toT, speed * 1.8, { fly: true });
  } else {
    intendSteer(e, up, speed, { fly: true });
    if (now - a.pt > 0.8) { a.phase = 'hover'; a.pt = now; }
  }
}

// ---------- maze ghosts: greedy target cell, never reversing, tie order U L D R ----------
function tileOf(at) { return v3(at).map(Math.round); }
function targetFor(rt, e, a, b, mode, frightened, homing) {
  const rule = { ...(b.personality ? PERSONALITIES[b.personality] : {}), ...Object.fromEntries(['aim', 'ahead', 'partner', 'within'].filter(k => b[k] !== undefined).map(k => [k, b[k]])) };
  const home = b.home ?? a.home;
  if (homing) return tileOf(home);
  const t = rt.resolve(b.target ?? 'player', { self: e.id });
  const elroy = (b.elroy || []).find(x => rt.test(selfRelative(x.when), { self: e.id }));
  if (mode === 'scatter' && !(elroy?.chaseInScatter) && b.scatter) return tileOf(b.scatter);
  if (!t || t.space !== e.space) return tileOf(b.scatter ?? home);
  const p = tileOf(t.at), dirs = GRID[b.grid ?? 'screen'];
  const heading = (t.id === 'player' && st(rt).track?.dir) || facingOf(t, headingOf(rt, t.id));
  // Snap the target's heading to the closest grid direction.
  const pd = dirs.map((d, k) => [dot(d, heading), k]).sort((x, y) => y[0] - x[0] || x[1] - y[1])[0][1];
  const ahead = k => add(p, mul(dirs[pd], k));
  switch (rule.aim) {
    case 'ahead': return ahead(rule.ahead ?? 4);
    case 'vector': {
      const pivot = ahead(rule.ahead ?? 2);
      const partner = Object.values(rt.state.entities).find(o => o !== e && o.space === e.space && (o.id === rule.partner || o.components.ai?.brain?.some(x => x.do === 'target-tile' && x.personality === rule.partner))) || e;
      const c = tileOf(partner.at);
      return sub(mul(pivot, 2), c);
    }
    case 'shy': return len(sub(tileOf(e.at), p)) > (rule.within ?? 8) ? p : tileOf(b.scatter ?? home);
    case 'fixed': return tileOf(b.scatter ?? home);
    default: return p;
  }
}
function targetTile(rt, e, a, b, api, config) {
  const ctx = { self: e.id }, EPS = 1e-6;
  const dirs = gridDirs(api, e, b);
  // Fright: an explicit predicate, else the frozen status component (frightened/vulnerable seconds left).
  const frightened = b.frightWhen ? rt.test(selfRelative(b.frightWhen), ctx) : FRIGHT.some(k => (e.components.status?.[k] ?? 0) > 0);
  const homing = b.homeWhen ? rt.test(selfRelative(b.homeWhen), ctx) : false;
  const mode = st(rt).mode?.mode ?? 'chase';
  // Reversals: on every mode change (when the schedule asks) and on entering fright.
  const flips = st(rt).mode?.flips ?? 0;
  if ((a.flips ?? flips) !== flips || (frightened && !a.wasFright)) { if (a.dir >= 0) a.dir = rev(a.dir); }
  a.flips = flips; a.wasFright = frightened;
  const elroy = (b.elroy || []).find(x => rt.test(selfRelative(x.when), ctx));
  let speed = b.speed ?? baseSpeed(e, config);
  if (homing) speed *= b.homeSpeed ?? 2;
  else if (frightened) speed *= b.frightSpeed ?? 0.67;
  else if (elroy) speed *= elroy.speed;
  for (const s of b.slow || []) if (api.inZone?.(e, s.zone, rt)) { speed *= s.speed; break; }
  if (can(api, 'speedAt')) speed *= api.speedAt(tileOf(e.at).slice(0, e.at.length), e) ?? 1; // cell rules (tunnels)
  const wrap = c => (can(api, 'wrapPos') ? v3(api.wrapPos(c.slice(0, e.at.length))).map(Math.round) : c);
  // Openness of the cell next to `from` (the entity stands at `from` when asked):
  // canMove honours the space's rules (class doors, one-way cells), then neighbors, then getCell.
  const open = (cell, from) => {
    const c = cell.slice(0, e.at.length);
    if (can(api, 'canMove')) return api.canMove(e, can(api, 'wrapPos') ? api.wrapPos(c) : c, rt);
    if (can(api, 'neighbors')) { const k = wrap(cell).join(','); return api.neighbors(from.slice(0, e.at.length)).some(q => v3(q).map(Math.round).join(',') === k); }
    if (can(api, 'getCell')) return !api.getCell(c);
    return true;
  };
  const noUp = new Set((b.noUp || []).map(c => tileOf(c).slice(0, 2).join(',')));
  const atCentre = () => len(sub(v3(e.at), tileOf(e.at))) < EPS;
  if (moverOwned(e)) { // a move.* primitive executes: steer toward the chosen next cell
    if (atCentre() || a.dir < 0) decideDir(rt, e, a, b, tileOf(e.at), dirs, open, noUp, frightened, homing, mode);
    if (a.dir >= 0) e.components.steer = { dir: dirs[a.dir], speed, lane: true, by: 'ai' }; return;
  }
  delete e.components.steer; if (e.components.moveTo?.by === 'ai') delete e.components.moveTo;
  // Lane-locked movement: decide at cell centres, then advance to the next centre ahead.
  let rem = speed * rt.dt;
  const pos = v3(e.at);
  for (let guard = 0; rem > EPS && guard < 4; guard++) {
    let centre = tileOf(pos);
    if (len(sub(pos, centre)) < EPS) {
      centre = wrap(centre);
      for (let k = 0; k < 3; k++) pos[k] = centre[k];
      if (len(sub(v3(e.at), pos)) > EPS) api.setPos(e, pos.slice(0, e.at.length), rt); // stand on the centre before asking the space
      decideDir(rt, e, a, b, centre, dirs, open, noUp, frightened, homing, mode);
      if (a.dir < 0 || !open(add(centre, dirs[a.dir]), centre)) break;
    }
    const d = dirs[a.dir]; if (!d) break;
    const axis = d.findIndex(v => v !== 0), sg = d[axis];
    for (let k = 0; k < 3; k++) if (k !== axis) pos[k] = Math.round(pos[k]);
    const cur = pos[axis], next = sg > 0 ? Math.floor(cur + EPS) + 1 : Math.ceil(cur - EPS) - 1;
    const step = Math.min(rem, Math.abs(next - cur));
    pos[axis] = round6(cur + sg * step); rem -= step;
  }
  if (len(sub(pos, v3(e.at))) > 0) { api.setPos(e, r6(pos).slice(0, e.at.length), rt); a.face = dirs[a.dir] ?? a.face; }
}
const FRIGHT = ['frightened', 'vulnerable', 'fright'];
/** U, L, D, R for this space: an explicit preset, else the space's own direction names, else screen axes. */
function gridDirs(api, e, b) {
  if (b.grid) return GRID[b.grid];
  if (can(api, 'step')) {
    const c = tileOf(e.at).slice(0, e.at.length);
    const ds = ['up', 'left', 'down', 'right'].map(n => { const q = api.step(c, n); return q ? v3(deltaTo(api, c, q)).map(Math.round) : null; });
    if (ds.every(d => d && len(d) === 1)) return ds;
  }
  return GRID.screen;
}
function decideDir(rt, e, a, b, cell, dirs, open, noUp, frightened, homing, mode) {
  const options = [];
  for (let d = 0; d < 4; d++) {
    if (a.dir >= 0 && d === rev(a.dir)) continue;
    if (d === 0 && !frightened && noUp.has(cell.slice(0, 2).join(','))) continue;
    if (open(add(cell, dirs[d]), cell)) options.push(d);
  }
  if (!options.length) { a.dir = a.dir >= 0 ? rev(a.dir) : 1; return; }
  if (frightened && !homing) { a.dir = options[Math.floor(rt.random() * options.length)]; return; }
  const tgt = targetFor(rt, e, a, b, mode, frightened, homing);
  let best = options[0], bestD = Infinity;
  for (const d of options) { const nx = add(cell, dirs[d]), dist = (nx[0] - tgt[0]) ** 2 + (nx[1] - tgt[1]) ** 2 + (nx[2] - tgt[2]) ** 2; if (dist < bestD - 1e-6) { bestD = dist; best = d; } }
  a.dir = best; a.tile = r6(tgt);
}

// ---------- trainer sight: spot along the facing line, walk up, then run effects ----------
function sightChallenge(rt, e, a, b, api, speed) {
  const s = st(rt), done = (s.challenged ??= {});
  const t = rt.resolve(b.target ?? 'player', { self: e.id });
  if (!t || t.space !== e.space) { idle(e, a); return; }
  if (done[e.id] && (b.once ?? true)) { idle(e, a); return; }
  const stop = b.stop ?? 1;
  if (a.phase !== 'approach') {
    const range = b.range ?? 4, facing = facingOf(e, a.face);
    const d = distBetween(rt, e, t);
    let spotted = d <= range;
    if (spotted && continuous(e)) {
      const rel = sub(t.at, e.at), along = dot(rel, facing), across = len(sub(rel, mul(facing, along)));
      spotted = along > 0 && (b.fov ? dot(norm(rel), facing) >= Math.cos(b.fov / 2 * Math.PI / 180) : across < 0.5) && clearLine(api, centerOf(e, api), centerOf(t, api));
    }
    if (!spotted) { idle(e, a); return; }
    a.phase = 'approach';
    rt.emit('spotted', { who: e.id, target: t.id });
  }
  const d = continuous(e) ? len(sub(t.at, e.at)) : distBetween(rt, e, t);
  if (d > stop + 0.05) {
    // Walk up to the point `stop` short of the target along the line.
    if (continuous(e)) {
      const goal = r6(sub(t.at, mul(norm(sub(t.at, e.at)), stop)));
      if (len(sub(goal, e.at)) > Math.max(0.05, speed * rt.dt)) { intendMove(e, goal, speed); return; }
    } else {
      const next = firstHop(rt, api, e, t.at);
      if (next != null && next !== t.at) { intendMove(e, next, speed); return; }
    }
  }
  idle(e, a, continuous(e) ? sub(t.at, e.at) : null);
  done[e.id] = rt.state.frame + 1; a.phase = null;
  rt.emitTyped('challenge', e.archetype ?? e.id, { who: e.id, target: t.id });
  rt.run(b.then || [], { self: e.id, target: t.id });
}

// ---------- mode schedule (scatter/chase) ----------
function modeClock(rt, ms) {
  const s = st(rt);
  if (!s.mode) {
    s.mode = { idx: 0, t: 0, mode: ms.modes[0], flips: (s.flipsKept ?? 0) };
    rt.state.vars[ms.var] = ms.modes[0];
  }
  const m = s.mode;
  if (ms.pauseWhen && rt.test(ms.pauseWhen)) return;
  const tier = ms.tierBy ? (ms.tierBy.above || []).filter(x => (rt.state.vars[ms.tierBy.var] ?? 0) > x).length : 0;
  const row = ms.table[Math.min(tier, ms.table.length - 1)];
  const dur = row[Math.min(m.idx, row.length - 1)];
  m.t = round6(m.t + rt.dt);
  if (dur >= 0 && m.t >= dur - 1e-9 && m.idx < row.length - 1) {
    m.idx++; m.t = 0;
    m.mode = ms.modes[m.idx % ms.modes.length];
    if (ms.reverse) m.flips++;
    s.flipsKept = m.flips;
    rt.state.vars[ms.var] = m.mode;
    rt.emitTyped('ai_mode', m.mode, { mode: m.mode, index: m.idx });
  }
}

export { validateAi };
