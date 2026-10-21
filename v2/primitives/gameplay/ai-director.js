// gameplay.ai.director: a pacing director (Left 4 Dead style). Player
// intensity rises from events (damage taken, kills nearby, alarms) and decays;
// the director cycles build-up → peak → relax: during build-up it spends a
// spawn budget on enemies placed out of the player's sight at a reachable
// distance; when intensity crosses the peak it sustains briefly, then holds
// spawns off until the player has calmed down. Phases and intensity are vars
// so plot, music and UI can follow along.
import { v3, add, sub, mul, len, norm, r6, round6, spaceOf, can, continuous, randomPoint, weighted, onEvents, dead, clearLine, centerOf, between } from './ai-lib.js';

const ID = 'gameplay.ai.director';
const st = rt => rt.store(ID);
const n = (d, extra = {}) => ({ type: 'number', default: d, ...extra });
const PHASES = ['build', 'peak', 'relax', 'off'];

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['director_spawn'] },
    intent: 'Pacing director: player intensity from events (damage taken, nearby kills, alarms) with decay drives a build-up → peak → relax cycle; build-up spends a budget spawning enemies out of sight at reachable distances; vars director.intensity/director.phase for plot, music and UI.',
    views: ['any'],
    params: {
      sources: { type: 'list', default: [{ event: 'damaged', add: 3, scale: 'amount', who: 'player' }, { event: 'defeated', add: 6, near: 15 }, { event: 'alarm', add: 25 }],
        of: { type: 'object', fields: { event: { type: 'string', required: true }, add: n(5), scale: { type: 'string', options: ['amount'], effect: 'multiply by data.amount' }, who: { type: 'string', effect: "only when data.who is this ('player')" }, near: n(0, { min: 0, effect: 'only when the event happens this close to the player (0 = anywhere)' }) } } },
      decay: n(4, { min: 0, unit: '/s' }), max: n(100, { min: 1 }),
      peak: n(70, { min: 0 }), peakSec: n(5, { min: 0 }), relaxSec: n(20, { min: 0 }), calm: n(25, { min: 0, effect: 'relax lasts until intensity is below this (and relaxSec has passed)' }),
      budgetRate: n(1, { min: 0, unit: 'points/s' }), maxBudget: n(10, { min: 0 }),
      spawns: { type: 'list', min: 1, required: true, of: { type: 'object', fields: { archetype: { type: 'ref', to: 'archetype', required: true }, cost: n(1, { min: 0.01 }), weight: n(1, { min: 0 }), group: { type: 'list', of: { type: 'integer', min: 1 }, default: [1, 1], min: 2, max: 2 } } } },
      maxAlive: { type: 'integer', default: 12, min: 0, max: 500 },
      distance: { type: 'list', of: { type: 'number', min: 0 }, default: [15, 35], min: 2, max: 2 },
      hidden: { type: 'boolean', default: true, effect: 'only spawn out of the player\'s line of sight' },
      reachable: { type: 'boolean', default: true, effect: 'only spawn where a path to the player exists' },
      when: { type: 'predicate', effect: 'the director runs only while this holds' },
      start: { type: 'string', default: 'build', options: PHASES },
    },
    provides: { events: ['director_phase', 'director_phase:*', 'director_spawn'], vars: ['director.intensity', 'director.phase', 'director.alive'] },
    requires: { capabilities: ['position', 'distance'] },
    reads: ['content.archetypes'],
    rules: {
      director_distance: { fields: ['distance'], message: 'distance is [near, far] with near at most far' },
      director_group: { fields: ['spawns[].group'], message: 'group is [min, max] with min at most max', example: { spawns: [{ archetype: 'ball', cost: null, weight: null, group: [3, 1] }] } },
      director_thresholds: { fields: ['calm', 'peak'], message: 'calm is at or below peak' },
      // A set_director effect's phase (code and templates write effects; no form asks for them).
      director_phase: { fields: ['set_director.phase'], message: `phase is one of ${PHASES.join('|')}`, in: 'effect', kind: 'set_director', example: { do: 'set_director', phase: 'chaos' } },
    },
  },
  logic(logic) {
    logic.effect('set_director', { check: (e, path, errs) => { if (e.phase !== undefined && !PHASES.includes(e.phase)) errs.push({ code: 'director_phase', path: `${path}.phase`, message: `phase is one of ${PHASES.join('|')}` }); },
      run: (e, rt) => { const s = st(rt); if (e.intensity !== undefined) s.intensity = e.intensity; if (e.phase) setPhase(rt, s, e.phase); publish(rt, s); } });
  },
  validate(config) {
    const errors = [];
    if (config.distance[0] > config.distance[1]) errors.push({ code: 'director_distance', path: 'distance', message: 'min above max' });
    if (config.calm > config.peak) errors.push({ code: 'director_thresholds', path: 'calm', message: 'calm must be at or below peak' });
    (Array.isArray(config.spawns) ? config.spawns : []).forEach((x, i) => { if (Array.isArray(x?.group) && x.group[0] > x.group[1]) errors.push({ code: 'director_group', path: `spawns[${i}].group`, message: 'min above max' }); });
    return errors;
  },
  install(rt, config) {
    onEvents(rt, config.sources.map(x => x.event), (name, data, rt) => {
      const s = state(rt, config), p = rt.player();
      for (const src of config.sources) {
        if (!(src.event === name || (src.event.endsWith(':*') && name.startsWith(src.event.slice(0, -1))))) continue;
        if (src.who && data.who !== src.who) continue;
        if (src.near > 0) { const at = Array.isArray(data.at) ? data.at : rt.entity(data.who)?.at; if (!p || !at || len(sub(v3(at), v3(p.at))) > src.near) continue; }
        s.intensity = round6(Math.min(config.max, s.intensity + src.add * (src.scale === 'amount' ? (data.amount ?? 1) : 1)));
      }
    });
    rt.system('rules', rt => tick(rt, config), ID);
  },
};

function state(rt, config) { const s = st(rt); if (s.phase === undefined) { s.phase = config.start; s.intensity = 0; s.budget = 0; s.since = 0; } return s; }
function publish(rt, s) { rt.state.vars['director.intensity'] = Math.round(s.intensity * 100) / 100; rt.state.vars['director.phase'] = s.phase; }
function setPhase(rt, s, phase) { if (s.phase === phase) return; s.phase = phase; s.since = round6(rt.state.time); rt.emitTyped('director_phase', phase, { phase }); }

function tick(rt, config) {
  const s = state(rt, config), p = rt.player(); if (!p) return;
  if (config.when && !rt.test(config.when)) { publish(rt, s); return; }
  const now = rt.state.time;
  s.intensity = round6(Math.max(0, s.intensity - config.decay * rt.dt));
  const alive = Object.values(rt.state.entities).filter(e => e.components.directorSpawn && !dead(e)).length;
  rt.state.vars['director.alive'] = alive;
  if (s.phase === 'build') {
    s.budget = round6(Math.min(config.maxBudget, s.budget + config.budgetRate * rt.dt));
    if (s.intensity >= config.peak) setPhase(rt, s, 'peak');
    else if (alive < config.maxAlive) trySpawn(rt, config, s, p, alive);
  } else if (s.phase === 'peak') {
    if (now - s.since >= config.peakSec) setPhase(rt, s, 'relax');
  } else if (s.phase === 'relax') {
    s.budget = 0;
    if (now - s.since >= config.relaxSec && s.intensity <= config.calm) setPhase(rt, s, 'build');
  }
  publish(rt, s);
}

function trySpawn(rt, config, s, p, alive) {
  const affordable = config.spawns.filter(x => x.cost <= s.budget); if (!affordable.length) return;
  const pick = weighted(rt, affordable); if (!pick) return;
  const api = spaceOf(rt, p); if (!api) return;
  const at = spot(rt, config, api, p); if (at == null) return;
  const count = Math.min(config.maxAlive - alive, pick.group[0] + Math.floor(rt.random() * (pick.group[1] - pick.group[0] + 1)));
  s.budget = round6(s.budget - pick.cost);
  for (let k = 0; k < count; k++) {
    const q = continuous(p) ? r6(add(at, [between(rt, -1, 1), between(rt, -1, 1), 0].map((v, i) => (i < at.length ? v : 0)))) : at;
    const e = rt.spawn(pick.archetype, { space: p.space, at: continuous(p) && can(api, 'getCell') && api.getCell(q) ? at : q, components: { directorSpawn: true } });
    if (rt.hasService('ai.brain')) rt.service('ai.brain').remember(e.id, p.id);
    rt.emit('director_spawn', { who: e.id, archetype: pick.archetype, intensity: s.intensity });
  }
}

/** A spawn point at the configured distance, out of sight and reachable when asked. */
function spot(rt, config, api, p) {
  const [lo, hi] = config.distance;
  for (let tries = 0; tries < 10; tries++) {
    let at;
    if (continuous(p)) { const dir = norm(sub(randomPoint(rt, api, p.at, 1), p.at)); at = r6(add(p.at, mul(len(dir) > 0 ? dir : [1, 0, 0], lo + rt.random() * (hi - lo)))); }
    else { const nodes = (rt.doc.spaces.find(x => x.id === p.space)?.zones || []).map(z => z.id).filter(z => { const d = api.distance(p.at, z); return d >= lo && d <= hi; }); if (!nodes.length) return null; at = nodes[Math.floor(rt.random() * nodes.length)]; }
    if (continuous(p) && can(api, 'getCell') && api.getCell(at)) continue;
    if (config.hidden && continuous(p) && clearLine(api, centerOf(p, api), at)) continue;
    if (config.reachable && can(api, 'path') && continuous(p) && !api.path(at, p.at)) continue;
    return at;
  }
  return null;
}
