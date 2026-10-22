// gameplay.race: checkpoint races over any space with zones. Ordered
// checkpoints (the first is the start/finish line), laps, a countdown, live
// positions (lap, checkpoint, then distance to the next checkpoint), wrong-way
// detection, an arcade time limit extended by checkpoints, a DNF window after
// the winner, lap/best-lap times, and ghosts: the player's best lap is
// recorded as a position trace, published with `ghost_saved` (for
// engine.replay and renderers) and optionally replayed by a ghost entity.
import { ENTITY_KINDS } from '../../kernel/params.js';
import { compare } from '../../kernel/logic.js';
import { matchesAny, sortedEntities, has, spaceOf, r6, r6v, err, runBound, instancesOf } from './modes-lib-util.js';

const ID = 'gameplay.race';
const STATES = ['idle', 'countdown', 'running', 'finished'];

export default {
  id: ID,
  card: {
    loop: { shows: ['entities', 'zones'], verbs: [], progress: ['checkpoint', 'lap', 'race_finished'],
      // As an encounter (engine.adapt.nested): finishing first beats the rivals; finishing below first, timing out or a DNF loses to them.
      outcome: { sides: ['player', 'opponent'], results: { won: { param: 'onWin', player: 'keeps', opponent: 'defeated' }, lost: { param: 'onLose', player: 'defeated', opponent: 'keeps' } } } },
    // Whose side its entities are on, for every consumer: wins, bots, combat teams, AI, renderers (kernel/sides.js):
    // every racer races for itself (each racers entry a side of its own).
    sides: { param: 'racers', each: true },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "param", "param": "racers", "min": 3, "why": "a race needs rivals: racers lists the player and at least two other racer ids or archetypes", "example": ["player", "rival_1", "rival_2", "rival_3"]},
      {"need": "param", "param": "checkpoints", "min": 3, "why": "laps run through ordered checkpoint zones", "example": ["start_straight", "harbor_turn", "summit_loop"]},
    ],
    intent: 'Checkpoint racing: laps through ordered checkpoint zones with a countdown, live race positions, lap and best-lap times, wrong-way warnings, optional arcade time limit with checkpoint time bonuses, DNF after the winner, and best-lap ghosts. Works on foot, in vehicles or on mounts.',
    views: ['any'],
    params: {
      id: { type: 'string', default: 'race', effect: 'race id used by the race predicate and start_race/reset_race' },
      laps: { type: 'integer', default: 3, min: 1, max: 99, effect: 'laps to finish' },
      checkpoints: { type: 'list', of: { type: 'ref', to: 'zone' }, min: 1, required: true, effect: 'ordered checkpoint zones; the first is the start/finish line' },
      racers: { type: 'list', of: { type: 'string', selects: ENTITY_KINDS }, default: [], effect: 'rival entity ids, archetypes or tags' },
      includePlayer: { type: 'boolean', default: true, effect: 'the player races' },
      vehicleOnly: { type: 'boolean', default: false, effect: 'checkpoints only count for racers seated in a vehicle' },
      autoStart: { type: 'boolean', default: true, effect: 'arm the race at game start (otherwise use start_race or startWhen)' },
      startWhen: { type: 'predicate', effect: 'arm the race when this holds' },
      countdown: { type: 'number', default: 3, min: 0, max: 30, unit: 's', effect: 'countdown before the start' },
      timeLimit: { type: 'number', default: 0, min: 0, max: 3600, unit: 's', effect: 'arcade timer for the player (0 = none)' },
      checkpointBonus: { type: 'number', default: 0, min: 0, max: 600, unit: 's', effect: 'seconds added to the timer per checkpoint' },
      wrongWaySec: { type: 'number', default: 2, min: 0, max: 30, unit: 's', effect: 'moving away from the next checkpoint this long warns wrong way (0 = off)' },
      dnfAfter: { type: 'number', default: 30, min: 0, max: 600, unit: 's', effect: 'after the first finisher, others have this long (0 = wait forever)' },
      ghost: { type: 'boolean', default: true, effect: "record the player's best lap" },
      ghostEvery: { type: 'integer', default: 6, min: 1, max: 60, unit: 'frames', effect: 'ghost sample interval' },
      ghostArchetype: { type: 'ref', to: 'archetype', effect: 'spawn a ghost entity replaying the best lap' },
      onFinish: { type: 'effects', default: [], effect: 'run when the player finishes ($position is not available; read var race.position)' },
      onWin: { type: 'effects', default: [], effect: 'run when the player finishes first' },
      onLose: { type: 'effects', default: [], effect: 'run when the player finishes below first, runs out of time or DNFs' },
    },
    provides: {
      events: ['race_countdown', 'race_start', 'checkpoint', 'checkpoint:*', 'lap', 'lap:*', 'best_lap', 'race_finished', 'race_finished:*', 'wrong_way', 'race_timeout', 'race_dnf', 'ghost_saved', 'position_changed'],
      vars: ['race.position', 'race.lap', 'race.time', 'race.timer', 'race.best'],
      actions: [],
      services: ['race.targets'],
    },
    requires: { capabilities: ['position'] },
    reads: [],
    // Rivals named in `racers` exist at the start (spawned beside the player when missing) and are equipped by the other mechanics' actors contracts.
    // As an encounter's inner loop: the race waits (autoStart off) and the encounter starts it.
    engage: { participants: { param: 'racers' }, encounter: { start: [{ do: 'start_race' }], config: { autoStart: false } } },
    // Race mode: laps through checkpoint zones against rivals (and the clock with timeLimit).
    // Its target service (mode.targets): each AI-controlled racer's next checkpoint zone while the race runs.
    mode: { loop: 'race', interaction: 'avatar-realtime', opponent: 'ai-rival', space: ['engine.space.track', 'engine.space.mesh3d', ['position', 'distance']], needs: { content: ['spaces.zones'], participants: 'racers' }, targets: 'race.targets', win: { param: 'onWin', shown: { var: 'race.lap', max: 'race.laps' }, reads: { event: 'lap', of: 'player', by: { movement: true } } }, lose: { param: 'onLose', once: true, reads: { event: 'race_finished', by: { movement: true } } }, bot: 'race' },
  },
  logic(logic) {
    logic.predicate('race', {
      check: (p, path, errors, ctx) => {
        if (p.state !== undefined && !STATES.includes(p.state)) errors.push(err('race_state', `${path}.state`, `state must be ${STATES.join('|')}`));
        if (p.metric !== undefined && !['position', 'lap', 'time', 'best'].includes(p.metric)) errors.push(err('race_metric', `${path}.metric`, 'metric must be position|lap|time|best'));
        const races = instancesOf(ctx.doc, ID).map(x => x.s.with?.id ?? 'race');
        if (typeof p.race === 'string' && !races.includes(p.race)) errors.push(err('ref_unknown', `${path}.race`, `unknown race '${p.race}'`, `races: ${races.join(', ') || 'none'}`));
      },
      test: (p, rt, c) => {
        const s = rt.state.prim[`${ID}:${typeof p.race === 'string' ? p.race : 'race'}`]; if (!s) return false;
        if (p.state && s.state !== p.state) return false;
        if (!p.metric) return p.state ? true : s.state !== 'idle';
        const who = rt.resolve(p.who, c)?.id, r = s.racers?.[who]; if (!r) return false;
        const value = p.metric === 'position' ? r.place ?? s.order.indexOf(who) + 1 : p.metric === 'lap' ? r.lap : p.metric === 'best' ? r.best ?? Infinity : r.time ?? 0;
        const cmp = ['gte', 'lte', 'gt', 'lt', 'eq', 'ne'].find(k => p[k] !== undefined);
        return cmp ? compare(value, p) : true;
      },
    });
    const sel = e => `${ID}:${e.race ?? 'race'}`;
    logic.effect('start_race', { run: (e, rt) => rt.store(sel(e)).request = 'start' });
    logic.effect('reset_race', { run: (e, rt) => rt.store(sel(e)).request = 'reset' });
  },
  validate(config, doc) {
    const errors = [], ids = instancesOf(doc, ID).map(x => x.s.with?.id ?? 'race');
    if (ids.filter(i => i === config.id).length > 1) errors.push(err('race_duplicate', 'with.id', `two races share id '${config.id}'`, 'give each gameplay.race a distinct id'));
    if (config.checkpoints?.length === 1 && config.laps < 1) errors.push(err('race_checkpoints', 'with.laps', 'a single checkpoint needs laps'));
    if (new Set(config.checkpoints || []).size !== (config.checkpoints || []).length) errors.push(err('race_checkpoints', 'with.checkpoints', 'checkpoints repeat a zone'));
    if (!config.includePlayer && !config.racers.length) errors.push(err('race_racers', 'with.racers', 'a race needs the player or racers'));
    return errors;
  },
  /** Solver progress: the player's checkpoints passed over the whole race, 0..1. */
  progress(rt, config) {
    const r = rt.state.prim[`${ID}:${config.id}`]?.racers?.player; if (!r) return 0;
    const N = config.checkpoints.length; return r.finished ? 1 : Math.min(1, (r.lap * N + ((r.next - 1 + N) % N)) / (config.laps * N));
  },
  install(rt, config) {
    const key = `${ID}:${config.id}`, CP = config.checkpoints, N = CP.length;
    const st = () => { const s = rt.store(key); s.state ??= 'idle'; s.racers ??= {}; s.order ??= []; s.finishers ??= []; return s; };
    const frames = sec => Math.round(sec * 60);
    const racerIds = () => {
      const ids = sortedEntities(rt).filter(e => !e.components.ghost && matchesAny(e, config.racers)).map(e => e.id);
      if (config.includePlayer && rt.player() && !ids.includes('player')) ids.unshift('player');
      return ids;
    };
    const inZone = (e, z) => { const api = spaceOf(rt, e); return Boolean(api) && api.inZone(e, z, rt); };
    const distTo = (e, z) => { const api = spaceOf(rt, e); if (!has(api, 'nearest')) return 0; const d = api.nearest(e, z, rt); return d == null ? 1e9 : d; };
    const arm = s => {
      s.state = config.countdown > 0 ? 'countdown' : 'running'; s.t = 0; s.countT = frames(config.countdown); s.finishers = []; s.firstFinish = null;
      s.racers = {}; enter(s);
      s.timer = config.timeLimit ? frames(config.timeLimit) : null; s.trace = [];
      lapVars(null);
      if (s.state === 'running') begin(s); else rt.emit('race_countdown', { race: config.id, sec: config.countdown });
    };
    // Everyone on the grid when the race starts races: racers that appear during the countdown (spawned on the first
    // step by a spawner listed after the race) join it at the start.
    const enter = s => { for (const id of racerIds()) if (!s.racers[id]) { const e = rt.entity(id); s.racers[id] = { lap: 0, next: 1 % N, inside: e ? inZone(e, CP[1 % N]) : false, lapStart: 0, laps: [], best: null, finished: false, place: null, time: 0, last: null, away: 0 }; } };
    // The player's lap (the one running, of the laps to finish): what a person watches for the win (card.loop.win.shown).
    const lapVars = r => { rt.state.vars['race.lap'] = Math.min((r?.lap ?? 0) + 1, config.laps); rt.state.vars['race.laps'] = config.laps; };
    const begin = s => { enter(s); lapVars(s.racers.player); s.state = 'running'; s.t = 0; rt.emit('race_start', { race: config.id, racers: Object.keys(s.racers) }); spawnGhost(s); };
    const spawnGhost = s => {
      if (!config.ghostArchetype || !s.ghost) return;
      const gid = `ghost-${config.id}`, p = rt.player(); if (!p) return;
      if (!rt.entity(gid)) rt.spawn(config.ghostArchetype, { id: gid, space: p.space, at: s.ghost.trace[0], components: { ghost: { race: config.id } } });
      s.ghostT = 0;
    };
    const finish = (s, id, r, how) => {
      r.finished = true; r.time = s.t; if (how === 'finish') { s.finishers.push(id); r.place = s.finishers.length; } else r.place = null;
      if (how === 'finish') { s.firstFinish ??= s.t; rt.emitTyped('race_finished', id, { race: config.id, who: id, position: r.place, time: r6(s.t / 60) }); }
      else rt.emit(how === 'timeout' ? 'race_timeout' : 'race_dnf', { race: config.id, who: id });
      if (id === 'player') {
        rt.state.vars['race.position'] = r.place ?? 0;
        if (how === 'finish') runBound(rt, config.onFinish, { actor: 'player' });
        runBound(rt, how === 'finish' && r.place === 1 ? config.onWin : config.onLose, { actor: 'player' });
      }
    };
    const pass = (s, id, r, e) => {
      const cp = CP[r.next];
      rt.emitTyped('checkpoint', cp, { race: config.id, who: id, index: r.next, lap: r.lap + 1 });
      if (id === 'player' && s.timer !== null) s.timer += frames(config.checkpointBonus);
      if (r.next === 0) {
        const time = s.t - r.lapStart; r.laps.push(time); r.lapStart = s.t; r.lap++;
        rt.emitTyped('lap', id, { race: config.id, who: id, lap: r.lap, time: r6(time / 60) });
        if (id === 'player') lapVars(r);
        if (r.best === null || time < r.best) {
          r.best = time;
          if (id === 'player') {
            rt.emit('best_lap', { race: config.id, time: r6(time / 60) });
            if (config.ghost && s.trace.length > 1) { s.ghost = { trace: s.trace, every: config.ghostEvery, time }; rt.emit('ghost_saved', { race: config.id, time: r6(time / 60), samples: s.trace.length, every: config.ghostEvery, trace: s.trace }); }
          }
        }
        if (id === 'player') { s.trace = []; spawnGhost(s); }
        if (r.lap >= config.laps) { finish(s, id, r, 'finish'); return; }
      }
      r.next = (r.next + 1) % N;
    };
    // The target service (card.mode.targets): every race of the document answers for its own racers.
    const races = (rt.caches.raceTargets ??= []);
    races.push({
      participants: () => Object.entries(rt.state.prim[key]?.racers || {}).filter(([id]) => id !== 'player').map(([id]) => id),
      target: id => { const s = rt.state.prim[key], r = s?.racers?.[id]; return s?.state === 'running' && r && !r.finished ? { zone: CP[r.next] } : null; },
    });
    if (!rt.hasService('race.targets')) rt.provide('race.targets', {
      participants: () => [...new Set(races.flatMap(x => x.participants()))],
      target: id => races.map(x => x.target(id)).find(Boolean) ?? null,
    });
    rt.system('rules', rt => {
      const s = st();
      if (s.request === 'reset') { s.state = 'idle'; s.racers = {}; s.order = []; s.request = null; if (rt.entity(`ghost-${config.id}`)) rt.despawn(`ghost-${config.id}`); }
      if (s.request === 'start') { s.request = null; arm(s); }
      if (s.state === 'idle') { if ((config.autoStart && !s.armedOnce) || (config.startWhen && rt.test(config.startWhen))) { s.armedOnce = true; arm(s); } return; }
      if (s.state === 'countdown') {
        if (s.countT % 60 === 0 && s.countT > 0) rt.emit('race_countdown', { race: config.id, sec: s.countT / 60 });
        if (--s.countT <= 0) begin(s);
        return;
      }
      if (s.state !== 'running') return;
      s.t++;
      for (const [id, r] of Object.entries(s.racers)) {
        const e = rt.entity(id); if (!e || r.finished) continue;
        // Edge-triggered checkpoint pass: entering the next checkpoint zone.
        const inside = inZone(e, CP[r.next]), counts = !config.vehicleOnly || Boolean(e.components.seat);
        if (inside && !r.inside && counts) pass(s, id, r, e);
        r.inside = inZone(e, CP[r.next]);
        // Wrong way: distance to the next checkpoint growing while moving.
        if (config.wrongWaySec > 0 && !r.finished) {
          const d = distTo(e, CP[r.next]);
          if (r.last !== null && d > r.last + 1e-6) { if (++r.away === frames(config.wrongWaySec)) rt.emit('wrong_way', { race: config.id, who: id }); }
          else if (r.last !== null && d < r.last - 1e-6) r.away = 0;
          r.last = r6(d);
        }
      }
      // Player timer and ghost trace.
      const pr = s.racers.player, p = rt.player();
      if (pr && !pr.finished && s.timer !== null && --s.timer <= 0) finish(s, 'player', pr, 'timeout');
      if (pr && !pr.finished && config.ghost && p && s.t % config.ghostEvery === 0 && Array.isArray(p.at)) s.trace.push(r6v(p.at));
      // Ghost replay along the best lap.
      const g = rt.entity(`ghost-${config.id}`);
      if (g && s.ghost) {
        s.ghostT = (s.ghostT ?? 0) + 1;
        const i = Math.min(s.ghost.trace.length - 1, Math.floor(s.ghostT / s.ghost.every)), j = Math.min(s.ghost.trace.length - 1, i + 1), u = (s.ghostT % s.ghost.every) / s.ghost.every;
        g.at = s.ghost.trace[i].map((v, k) => r6(v + (s.ghost.trace[j][k] - v) * u));
      }
      // Positions.
      const prev = s.order.slice();
      s.order = Object.keys(s.racers).sort((a, b) => {
        const A = s.racers[a], B = s.racers[b];
        if (A.place || B.place) return (A.place ?? 1e9) - (B.place ?? 1e9);
        const progA = A.lap * N + ((A.next - 1 + N) % N), progB = B.lap * N + ((B.next - 1 + N) % N);
        if (progA !== progB) return progB - progA;
        return (A.last ?? 0) - (B.last ?? 0) || (a < b ? -1 : 1);
      });
      if (prev.length && prev.join() !== s.order.join()) rt.emit('position_changed', { race: config.id, order: s.order.slice() });
      if (pr) {
        const v = rt.state.vars;
        v['race.position'] = pr.place ?? s.order.indexOf('player') + 1; v['race.lap'] = Math.min(config.laps, pr.lap + (pr.finished ? 0 : 1));
        v['race.time'] = r6(s.t / 60); v['race.best'] = pr.best === null ? 0 : r6(pr.best / 60);
        if (s.timer !== null) v['race.timer'] = Math.max(0, Math.ceil(s.timer / 60));
      }
      // DNF window after the winner; finish when everyone is done.
      if (s.firstFinish !== null && config.dnfAfter > 0 && s.t - s.firstFinish >= frames(config.dnfAfter)) for (const [id, r] of Object.entries(s.racers)) if (!r.finished) finish(s, id, r, 'dnf');
      if (Object.values(s.racers).every(r => r.finished)) s.state = 'finished';
    }, ID);
  },
};
