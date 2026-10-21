// gameplay.lanes.periodic: Crossy-Road lanes in any space (ported from the runner kit's hop mode).
// A lane is a row (a coordinate along `axis`) with movers that repeat every
// `period` units: road cars hit, river logs carry (missing them drowns, being
// carried off the edge too), rail trains pass after a flashing warning. Lanes
// are periodic, so every lane's state is analytic at any time: bots read the
// `lanes` service instead of simulating. Traffic speeds up over `ramp`. The
// eagle: idle too long without new forward progress, or fall behind a
// creeping line, and onIdle runs. Movers can also be spawned as entities so
// renderers and other primitives (combat, overlap) see them.

const ID = 'gameplay.lanes.periodic';
const mod = (a, n) => ((a % n) + n) % n;
/** Signed distance from x to the nearest mover centre of a road/river lane with accumulated shift. */
export const nearest = (lane, x, shift) => { const u = mod(x - lane.phase * lane.period - shift, lane.period); return u <= lane.period / 2 ? u : u - lane.period; };
/** Train at time t: { front: x | null, warn } (front null when no train is on the rails). */
export function trainAt(lane, t, [lo, hi], trainSpeed, warn) {
  const pass = (lane.size + (hi - lo) + 6) / trainSpeed, cyc = mod(t - lane.phase * lane.period, lane.period);
  if (cyc < pass) return { front: lane.dir > 0 ? lo - 6 + trainSpeed * cyc : hi + 6 - trainSpeed * cyc, warn: false };
  return { front: null, warn: cyc > lane.period - warn };
}

const LANE = { type: 'object', fields: {
  id: { type: 'string', required: true }, name: { type: 'string', default: '' },
  row: { type: 'number', required: true, effect: 'lane coordinate along axis' },
  kind: { type: 'string', required: true, options: ['road', 'river', 'rail'] },
  dir: { type: 'integer', default: 1, min: -1, max: 1 },
  speed: { type: 'number', default: 3, min: 0, max: 100, unit: 'u/s', effect: 'mover speed (road, river)' },
  period: { type: 'number', default: 6, min: 0.5, max: 1000, effect: 'spacing of movers (road/river: units; rail: seconds between trains)' },
  size: { type: 'number', default: 1, min: 0.1, max: 100, effect: 'mover length (car, log, train)' },
  phase: { type: 'number', default: 0, min: 0, max: 1 },
  archetype: { type: 'ref', to: 'archetype', effect: 'spawn movers as entities of this archetype' },
} };

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['progress', 'near_miss'], lose: { param: 'onHit' } },
    intent: 'Periodic hazard lanes (Crossy Road / Frogger): roads of cars, rivers of carrying logs, rails with warned trains, ramping speed, near misses, and an idle/creep "eagle" that catches dawdlers; analytic so bots can plan.',
    views: ['td', 'iso', 'side'],
    params: {
      lanes: { type: 'list', required: true, min: 1, of: LANE, effect: 'the lanes' },
      axis: { type: 'integer', default: 1, min: 0, max: 2, effect: 'space axis lanes are stacked along (forward)' },
      along: { type: 'integer', default: 0, min: 0, max: 2, effect: 'space axis movers travel along' },
      width: { type: 'list', default: [0, 9], min: 2, max: 2, of: { type: 'number' }, effect: '[min, max] playable extent along the lanes' },
      subjects: { type: 'list', default: ['player'], of: { type: 'string' }, effect: 'entity ids the lanes affect' },
      carHalf: { type: 'number', default: 0.32, min: 0, max: 5, effect: 'subject half-width against cars and trains' },
      nearMiss: { type: 'number', default: 0.4, min: 0, max: 5, effect: 'extra margin that counts as a near miss' },
      trainSpeed: { type: 'number', default: 30, min: 1, max: 500, unit: 'u/s' },
      warn: { type: 'number', default: 1.25, min: 0, max: 30, unit: 's', effect: 'rail warning before a train' },
      ramp: { type: 'object', default: { seconds: 60, factor: 0.5 }, fields: { seconds: { type: 'number', default: 60, min: 1, max: 3600 }, factor: { type: 'number', default: 0.5, min: 0, max: 10 } }, effect: 'speed ×(1 + factor·min(1, t/seconds))' },
      carry: { type: 'boolean', default: true, effect: 'river logs carry subjects standing on them' },
      cooldown: { type: 'number', default: 1, min: 0, max: 30, unit: 's', effect: 'no second hit on a subject within this time' },
      onHit: { type: 'effects', default: [{ do: 'end_game', outcome: 'lost' }], effect: 'run on a hit (self = the subject)' },
      idle: { type: 'object', default: { sec: 8, behind: 2.2, creep: 0, lead: 4 }, fields: { sec: { type: 'number', default: 8, min: 0, max: 600 }, behind: { type: 'number', default: 2.2, min: 0, max: 100 }, creep: { type: 'number', default: 0, min: 0, max: 100 }, lead: { type: 'number', default: 4, min: 0, max: 100 } }, effect: 'eagle: sec without new forward progress (0 = off); creep line speed (0 = off), how far behind it catches, how far the line trails progress' },
      onIdle: { type: 'effects', default: [{ do: 'end_game', outcome: 'lost' }], effect: 'run when the eagle catches a subject' },
    },
    provides: { events: ['lane_hit', 'lane_hit:*', 'near_miss', 'near_miss:*', 'train_warning', 'train_warning:*', 'carried', 'idle_caught', 'progress'], vars: ['lanes.progress', 'lanes.speed'], services: ['lanes'] },
    requires: { capabilities: ['position'] },
  },
  validate(config) {
    const errors = [];
    if (config.axis === config.along) errors.push({ code: 'lanes_axes', path: 'with.along', message: 'axis and along must differ' });
    if (config.width[0] >= config.width[1]) errors.push({ code: 'lanes_width', path: 'with.width', message: 'width is [min, max]' });
    const rows = new Set();
    config.lanes.forEach((l, i) => { if (rows.has(l.row)) errors.push({ code: 'lanes_row_duplicate', path: `with.lanes[${i}].row`, message: `two lanes on row ${l.row}` }); rows.add(l.row); if (l.dir === 0) errors.push({ code: 'lanes_dir', path: `with.lanes[${i}].dir`, message: 'dir is -1 or 1' }); });
    return errors;
  },
  progress: rt => rt.state.vars['lanes.progress'] ?? 0,
  install(rt, config) {
    const st = () => rt.store(ID);
    const factor = () => 1 + config.ramp.factor * Math.min(1, rt.state.time / config.ramp.seconds);
    const laneAt = row => config.lanes.find(l => l.row === Math.round(row)) || null;
    const coord = e => { const api = rt.space(e.space), c = api.pos ? api.pos(e) : e.at; return Array.isArray(c) ? c : null; };
    function init() {
      const s = st(); if (s.shift) return;
      Object.assign(s, { shift: Object.fromEntries(config.lanes.map(l => [l.id, 0])), movers: {}, warned: {}, subj: {} });
      for (const l of config.lanes) if (l.archetype) {
        const n = l.kind === 'rail' ? 1 : Math.ceil((config.width[1] - config.width[0]) / l.period) + 2;
        s.movers[l.id] = Array.from({ length: n }, () => rt.spawn(l.archetype, { at: null }).id);
      }
    }
    /** Danger at a position now (for bots): 'car' | 'water' | 'train' | null. */
    function dangerAt(at) {
      const l = laneAt(at[config.axis]); if (!l) return null;
      const x = at[config.along], s = st();
      if (l.kind === 'road') return Math.abs(nearest(l, x, s.shift[l.id])) < l.size / 2 + config.carHalf ? 'car' : null;
      if (l.kind === 'river') return Math.abs(nearest(l, x, s.shift[l.id])) > l.size / 2 + 0.05 ? 'water' : null;
      const tr = trainAt(l, rt.state.time, config.width, config.trainSpeed, config.warn);
      if (tr.front === null) return null;
      const back = l.dir > 0 ? tr.front - l.size : tr.front + l.size;
      return x > Math.min(tr.front, back) - config.carHalf && x < Math.max(tr.front, back) + config.carHalf ? 'train' : null;
    }
    rt.provide('lanes', { laneAt, dangerAt, nearest: (id, x) => nearest(config.lanes.find(l => l.id === id), x, st().shift[id]), trainAt: id => trainAt(config.lanes.find(l => l.id === id), rt.state.time, config.width, config.trainSpeed, config.warn), speedFactor: factor });
    init();
    function hit(e, l, why) {
      const ss = st().subj[e.id];
      if (rt.state.time - (ss.hitAt ?? -1e9) < config.cooldown) return;
      ss.hitAt = rt.state.time;
      rt.emitTyped('lane_hit', l.kind, { who: e.id, lane: l.id, reason: why });
      rt.run(config.onHit, { self: e.id });
    }
    rt.system('physics', rt => {
      const s = st(); init();
      const f = factor(), dt = rt.dt;
      rt.state.vars['lanes.speed'] = +f.toFixed(4);
      for (const l of config.lanes) if (l.kind !== 'rail') s.shift[l.id] += l.dir * l.speed * f * dt;
      // Rail warnings (one per approaching train).
      for (const l of config.lanes) if (l.kind === 'rail') {
        const tr = trainAt(l, rt.state.time, config.width, config.trainSpeed, config.warn), cycle = Math.floor((rt.state.time - l.phase * l.period) / l.period);
        if (tr.warn && s.warned[l.id] !== cycle) { s.warned[l.id] = cycle; rt.emitTyped('train_warning', l.id, { lane: l.id }); }
      }
      // Mover entities follow the analytic positions.
      for (const l of config.lanes) for (const [k, id] of (s.movers[l.id] || []).entries()) {
        const e = rt.entity(id); if (!e) continue;
        const api = rt.space(e.space), p = (api.pos ? api.pos(e) : e.at)?.slice() || [0, 0, 0];
        let x;
        if (l.kind === 'rail') { const tr = trainAt(l, rt.state.time, config.width, config.trainSpeed, config.warn); x = tr.front === null ? config.width[0] - 100 : tr.front - l.dir * l.size / 2; }
        else x = config.width[0] - l.period + mod(l.phase * l.period + s.shift[l.id] - config.width[0], l.period) + k * l.period;
        p[config.along] = x; p[config.axis] = l.row;
        api.setPos(e, p, rt);
      }
      for (const who of config.subjects) {
        const e = rt.resolve(who); if (!e || !e.space) continue;
        const at = coord(e); if (!at) continue;
        const ss = (s.subj[e.id] ??= { best: at[config.axis], bestAt: rt.state.time, cam: at[config.axis] - config.idle.lead, near: null });
        // Forward progress and the eagle.
        if (at[config.axis] > ss.best) { ss.best = at[config.axis]; ss.bestAt = rt.state.time; rt.state.vars['lanes.progress'] = ss.best; rt.emit('progress', { who: e.id, row: ss.best }); }
        if (config.idle.creep > 0) ss.cam = Math.max(ss.cam + config.idle.creep * dt, ss.best - config.idle.lead);
        if ((config.idle.sec > 0 && rt.state.time - ss.bestAt > config.idle.sec) || (config.idle.creep > 0 && at[config.axis] < ss.cam - config.idle.behind)) {
          ss.bestAt = rt.state.time; ss.cam = at[config.axis] - config.idle.lead;
          rt.emit('idle_caught', { who: e.id });
          rt.run(config.onIdle, { self: e.id });
          continue;
        }
        const l = laneAt(at[config.axis]);
        if (!l) { ss.near = null; continue; }
        const x = at[config.along];
        if (l.kind === 'road') {
          const d = Math.abs(nearest(l, x, s.shift[l.id]));
          if (d < l.size / 2 + config.carHalf) hit(e, l, 'car');
          else if (d < l.size / 2 + config.carHalf + config.nearMiss && ss.near !== l.id) { ss.near = l.id; rt.emitTyped('near_miss', l.id, { who: e.id }); }
        } else if (l.kind === 'river') {
          if (Math.abs(nearest(l, x, s.shift[l.id])) > l.size / 2 + 0.05) { hit(e, l, 'water'); continue; }
          if (config.carry) {
            const api = rt.space(e.space), p = at.slice(); p[config.along] += l.dir * l.speed * factor() * dt;
            api.setPos(e, p, rt); rt.emit('carried', { who: e.id, lane: l.id });
            if (p[config.along] < config.width[0] - 0.6 || p[config.along] > config.width[1] + 0.6) hit(e, l, 'edge');
          }
        } else if (dangerAt(at) === 'train') hit(e, l, 'train');
        if (l.id !== ss.near && l.kind !== 'road') ss.near = null;
      }
    }, ID);
    rt.options(() => [{ label: 'wait', actions: {} }]);
  },
};
