// Endless courses from authored chunks streamed along an axis ahead of a
// followed entity (runners, flyers, climbers, lane games), ported from the
// runner kit's scheduler: a speed curve split into thirds of the ramp gives
// difficulty tiers 1-3; a tier draws chunks of its own tier and the one below
// (falling back to every lower tier, then all); the same chunk never repeats
// twice in a row and the first chunk is tier 1; breathing room between chunks
// is base / density, never below min. Chunks are pictures (rows of chars) whose
// legend maps chars to archetypes (spawned) or blocks (cells), so the look and
// the obstacle set are data. Proof at install: every chunk must keep a passable
// line through it (a cross position per progress step, shifting at most
// `maxShift` cells per step, never through a `blocks` char); impassable chunks
// are dropped from the pool with a problem, and an empty pool falls back to a
// plain gap. Runtime choice uses rt.random(), so courses replay exactly.
// The course owns the distance run along it: var `course.distance` is how far
// along the axis the followed entity has got from where it first stood, and a
// course with a `goal` distance is a run to win (the runner mode): reaching it
// emits course_goal and runs onGoal once.
import { withDefaults, spaceOf, cellWriter, addZones, publish, spawnAt, problem } from './generate2d-lib.js';

const ID = 'engine.generate.chunks';
const AX = { x: 0, y: 1, z: 2 };
const DEFAULT_LEGEND = { '.': {}, '#': { block: 'ground', blocks: true }, 'o': { archetype: 'coin' }, '*': { archetype: 'power_box' } };

/** Speed at time t along the curve; tier (1-3) by thirds of the ramp (or by distance thresholds). */
export const speedAt = (speed, t) => speed.start + (speed.max - speed.start) * Math.min(1, Math.max(0, t / speed.rampSeconds));
export const tierAt = (speed, t) => (t < speed.rampSeconds / 3 ? 1 : t < (speed.rampSeconds * 2) / 3 ? 2 : 3);
/** Chunks eligible in a tier: their own tier and one below; falls back to every lower tier, then all. */
export function eligible(chunks, tier) {
  const list = chunks.filter(c => c.tier === tier || c.tier === tier - 1);
  return list.length ? list : chunks.filter(c => c.tier <= tier).length ? chunks.filter(c => c.tier <= tier) : chunks;
}
/** Highest tier, time and speed each chunk can appear at, from the eligibility rule. */
export function chunkLimits(speed, chunks) {
  const R = speed.rampSeconds, end = [R / 3, (R * 2) / 3, Infinity];
  return chunks.map(c => { let last = 0; for (let t = 1; t <= 3; t++) if (eligible(chunks, t).includes(c)) last = t; const time = end[last - 1] === Infinity ? R : end[last - 1]; return { id: c.id, tier: last, time, speed: speedAt(speed, time) }; });
}

/** A chunk as a progress × cross grid of chars: along 'rows' reads bottom row first; along 'columns' reads left to right with the bottom row at cross 0. */
export function chunkGrid(chunk, along) {
  const rows = chunk.rows.map(r => [...r]), R = rows.length, C = Math.max(...rows.map(r => r.length));
  const at = (i, j) => (along === 'rows' ? rows[R - 1 - i]?.[j] : rows[R - 1 - j]?.[i]) ?? '.';
  return { P: along === 'rows' ? R : C, X: along === 'rows' ? C : R, at };
}

/** Is there a line through the chunk that avoids blocking chars, shifting ≤ maxShift cross cells per step? */
export function passable(chunk, along, legend, maxShift) {
  const g = chunkGrid(chunk, along), blocks = (i, j) => Boolean(legend[g.at(i, j)]?.blocks || legend[g.at(i, j)]?.hazard);
  let live = new Set(); for (let j = 0; j < g.X; j++) if (!blocks(0, j)) live.add(j);
  for (let i = 1; i < g.P && live.size; i++) {
    const next = new Set();
    for (const c of live) for (let d = -maxShift; d <= maxShift; d++) {
      const n = c + d; if (n < 0 || n >= g.X || blocks(i, n)) continue;
      let clear = true; for (let k = Math.min(c, n); k <= Math.max(c, n) && clear; k++) if (blocks(i - 1, k)) clear = false; // sidestep inside the row it leaves
      if (clear) next.add(n);
    }
    live = next;
  }
  return live.size > 0;
}

export default {
  id: ID,
  card: {
    intent: 'Streams authored chunks along an axis ahead of the player for endless runners, flyers and climbers: tiered by a speed curve, spaced by density, every chunk proven passable. Tracks the distance run along the course; with a goal distance the run is won on reaching it.',
    // The runner: an endless course run to a goal distance. Only a course with a goal is one (mode.applies); without
    // one the course is world, not a loop. The course owns the distance (var course.distance, written from the followed
    // entity's position), so the player changes it by moving.
    mode: { loop: 'runner', applies: { param: 'goal', given: true }, interaction: 'avatar-realtime', opponent: 'hazards', space: ['engine.space.tilemap'], progress: ['chunk_placed', 'course_goal'], needs: { content: [], participants: null }, win: { param: 'onGoal', reads: { var: 'course.distance', by: { movement: true } } }, lose: { param: null }, bot: 'beam' },
    views: ['side', 'td', '3p'],
    spaces: ['engine.space.track', 'engine.space.tilemap', 'engine.space.arena2d'],
    params: {
      chunks: { type: 'list', min: 1, required: true, of: { type: 'object', fields: {
        id: { type: 'string', required: true }, tier: { type: 'integer', min: 1, max: 3, default: 1 },
        spacing: { type: 'number', min: 0.1, max: 50, default: 1, effect: 'progress units per picture step' },
        rows: { type: 'list', of: { type: 'string' }, min: 1, required: true, effect: 'picture of the chunk, top row first' },
      } } },
      legend: { type: 'json', default: DEFAULT_LEGEND, effect: 'char → {archetype?, block?, blocks?, hazard?, components?}; "." is empty' },
      along: { type: 'string', options: ['rows', 'columns'], default: 'rows', effect: 'rows: the bottom row is met first (lanes, climb); columns: left to right (side view)' },
      axis: { type: 'string', options: ['x', 'y', 'z'], default: 'x', effect: 'progress axis in the space' },
      cross: { type: 'string', options: ['x', 'y', 'z'], default: 'y', effect: 'axis of the other picture dimension' },
      origin: { type: 'list', of: { type: 'number' }, default: [0, 0, 0], effect: 'space position of progress 0, cross 0' },
      firstAt: { type: 'number', default: 10, scale: 'world', effect: 'progress of the first chunk' },
      end: { type: 'number', min: 0, scale: 'world', effect: 'progress where the course ends: no chunk starts at or beyond it (default: endless)' },
      goal: { type: 'number', min: 1, scale: 'world', effect: 'distance to run along the axis, from where the followed entity starts, that wins: onGoal runs once on reaching it (unset: no distance win); it must end inside the space' },
      onGoal: { type: 'effects', default: [], effect: 'effects when the followed entity reaches goal (self = that entity); course_goal is always emitted' },
      speed: { type: 'object', default: {}, fields: { start: { type: 'number', min: 0, default: 10 }, max: { type: 'number', min: 0, default: 22 }, rampSeconds: { type: 'number', min: 1, default: 90 } }, effect: 'speed curve (units/s) that sets tiers' },
      tierBy: { type: 'string', options: ['time', 'distance'], default: 'time' },
      tierDistance: { type: 'list', of: { type: 'number' }, default: [300, 900], min: 2, max: 2, effect: 'distance thresholds for tiers 2 and 3' },
      density: { type: 'number', min: 0.25, max: 4, default: 1, effect: '0.5 sparse to 2 packed' },
      gap: { type: 'object', default: {}, fields: { base: { type: 'number', min: 0, default: 8 }, min: { type: 'number', min: 0, default: 4 } }, effect: 'breathing room between chunks = max(min, base / density)' },
      ahead: { type: 'number', min: 1, default: 60, effect: 'keep chunks placed this far ahead' },
      behind: { type: 'number', min: 0, default: 20, effect: 'remove what falls this far behind' },
      follow: { type: 'string', default: 'player', effect: 'entity whose progress drives streaming' },
      maxShift: { type: 'integer', min: 0, max: 8, default: 1, effect: 'cross cells a line may shift per step in the passability proof' },
      clearBehind: { type: 'boolean', default: true, effect: 'clear placed cells behind as well as entities' },
      chunkZones: { type: 'boolean', default: false, effect: 'add a zone chunk_<n> per placed chunk (x/y axes; spaces with addZone, which keep zones in state) so solvers can name the chunk a run fails in' },
    },
    provides: { content: ['course', 'cells', 'entities'], extent: 'overlay', events: ['generated', 'generated:*', 'generate_problem', 'chunk_placed', 'chunk_placed:*', 'course_goal'], vars: ['course.distance'], services: ['generation', 'chunks'] },
    requires: { capabilities: ['position'] },
    problems: ['chunk_impassable', 'chunk_tier_missing', 'chunks_fallback'],
    validates: ['chunk_duplicate', 'chunk_rows_ragged', 'chunk_char_unknown', 'chunk_axis_invalid', 'chunk_legend_invalid', 'chunk_goal_outside'],
  },
  /**
   * Planner hook (v2/planner/world.js), track spaces: a finite course over the zones' progress span (the track's
   * length, when it has none, becomes the end of its last zone), from just past the start zone to the end: lane
   * barriers (solid obstacles the leader passes) and pickups in three tiers, every chunk leaving a free lane line.
   */
  scaffold(space) {
    if (space.use !== 'engine.space.track') return null;
    const ranges = (space.zones || []).map(z => z.range).filter(r => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[1] > r[0]);
    const lanes = Math.max(1, Math.min(16, Math.round(space.with?.lanes ?? 3)));
    const given = Number(space.with?.length) || 0, end = given > 0 ? given : ranges.length ? Math.max(...ranges.map(r => r[1])) : 200;
    const start = ranges.length ? Math.min(...ranges.map(r => r[0])) : 0, first = ranges.length ? Math.min(...ranges.map(r => r[1])) : start + 20;
    const firstAt = Math.min(end - 8, start + Math.max(10, Math.min(first - start, 30)));
    if (!(end - firstAt >= 8)) return null;
    const row = f => Array.from({ length: lanes }, (_, j) => f(j)).join('');
    const free = (i, j) => (j === i % lanes);
    const chunks = [
      { id: 'pickups', tier: 1, spacing: 2, rows: [row(j => (j % 2 ? 'o' : '.')), row(() => '.'), row(j => (j % 2 ? '.' : 'o'))] },
      { id: 'barrier', tier: 1, spacing: 2, rows: [row(j => (lanes > 1 && !free(1, j) ? '#' : '.')), row(() => '.'), row(j => (j === (1 % lanes) ? 'o' : '.'))] },
      { id: 'slalom', tier: 2, spacing: 2, rows: [row(j => (lanes > 1 && !free(0, j) ? '#' : '.')), row(() => '.'), row(() => '.'), row(j => (lanes > 1 && !free(lanes - 1, j) ? '#' : 'o'))] },
      { id: 'gauntlet', tier: 3, spacing: 2, rows: [row(j => (lanes > 1 && !free(2, j) ? '#' : '.')), row(j => (j === (2 % lanes) ? 'o' : '.')), row(() => '.'), row(j => (lanes > 1 && !free(0, j) ? '#' : '.'))] },
    ];
    const size = [1, 0.8, 1];
    return {
      with: {
        chunks, along: 'rows', axis: 'x', cross: 'y', origin: [0, -size[1] / 2, 0], firstAt: +firstAt.toFixed(2), end: +end.toFixed(2), tierBy: 'distance',
        tierDistance: [+(firstAt + (end - firstAt) / 3).toFixed(2), +(firstAt + (2 * (end - firstAt)) / 3).toFixed(2)], gap: { base: 8, min: 4 },
        legend: { '.': {}, '#': { archetype: 'course_barrier', blocks: true }, o: { archetype: 'course_pickup', components: { collectible: { counter: 'pickups', value: 1 } } } },
      },
      content: { archetypes: [
        { id: 'course_barrier', components: { name: 'Barrier', body: { size, solid: true, obstacle: true } } },
        { id: 'course_pickup', components: { name: 'Pickup', body: { size: [0.8, 0.8, 0.8] } } },
      ] },
      ...(given > 0 ? {} : { space: { with: { length: +end.toFixed(2) } } }),
    };
  },
  validate(raw, doc, ctx, inst = {}) {
    const config = withDefaults(this.card, raw);
    const errors = [], legend = config.legend, ids = new Set();
    // A goal past the space's far edge along the axis can never be reached (run from the player's start when it is followed).
    const sp = (doc?.spaces || []).find(s => s.id === inst.space), size = sp?.with?.size, ax = AX[config.axis];
    const from = config.follow === 'player' && Array.isArray(doc?.player?.at) && Number.isFinite(doc.player.at[ax]) ? doc.player.at[ax] : (config.origin[ax] ?? 0);
    if (config.goal !== undefined && Array.isArray(size) && Number.isFinite(size[ax]) && from + config.goal >= size[ax]) errors.push(problem('chunk_goal_outside', 'goal', `a run of ${config.goal} from ${from} along ${config.axis} ends past the space's far edge (${size[ax]})`, { hint: `a goal below ${size[ax] - from}` }));
    if (config.axis === config.cross) errors.push(problem('chunk_axis_invalid', 'cross', 'cross must differ from axis'));
    for (const [ch, v] of Object.entries(legend || {})) if ([...ch].length !== 1 || !v || typeof v !== 'object') errors.push(problem('chunk_legend_invalid', `legend.${ch}`, 'legend keys are single chars mapping to {archetype?, block?, blocks?, hazard?}'));
    config.chunks.forEach((c, i) => {
      if (ids.has(c.id)) errors.push(problem('chunk_duplicate', `chunks[${i}].id`, `duplicate chunk '${c.id}'`)); ids.add(c.id);
      if (new Set(c.rows.map(r => [...r].length)).size > 1) errors.push(problem('chunk_rows_ragged', `chunks[${i}].rows`, `rows of '${c.id}' differ in length`));
      c.rows.forEach((r, j) => { for (const ch of r) if (!(ch in legend) && ch !== '.') { errors.push(problem('chunk_char_unknown', `chunks[${i}].rows[${j}]`, `char '${ch}' is not in the legend`, { hint: Object.keys(legend).join(' ') })); break; } });
    });
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(this.card, raw), space = spaceOf(rt, instance), legend = { '.': {}, ...config.legend };
    const problems = [];
    let pool = config.chunks.map((c, index) => ({ ...c, index }));
    pool = pool.filter((c, i) => { if (passable(c, config.along, legend, config.maxShift)) return true; problems.push(problem('chunk_impassable', `chunks[${i}]`, `chunk '${c.id}' has no passable line (maxShift ${config.maxShift})`, { chunk: c.id })); return false; });
    if (pool.length && !pool.some(c => c.tier === 1)) { const easiest = pool.reduce((a, b) => (b.tier < a.tier ? b : a)); problems.push(problem('chunk_tier_missing', `chunks[${easiest.index}].tier`, `no tier 1 chunk; '${easiest.id}' opens the course`)); easiest.tier = 1; }
    const fallback = !pool.length;
    if (fallback) { problems.push(problem('chunks_fallback', 'chunks', 'no passable chunk; the course is plain gaps')); pool = [{ id: 'plain', tier: 1, spacing: 1, rows: ['.'], index: -1 }]; }
    const ax = AX[config.axis], cx = AX[config.cross], join = Math.max(config.gap.min, config.gap.base / config.density);
    const st = () => { const s = rt.store(instance.key); s.nextAt ??= config.firstAt; s.chunkN ??= 0; s.lastChunk ??= null; s.log ??= []; s.placed ??= []; s.cells ??= []; s.from ??= null; s.best ??= null; s.goal ??= false; return s; };
    const progressOf = () => { const e = rt.entity(config.follow); return e?.space === space.sid && Array.isArray(e.at) ? e.at[ax] - (config.origin[ax] ?? 0) : null; };
    const place = (chunk, start) => {
      const g = chunkGrid(chunk, config.along), writer = cellWriter(rt, space), s = st(), ids = [];
      for (let i = 0; i < g.P; i++) for (let j = 0; j < g.X; j++) {
        const ch = g.at(i, j), def = legend[ch]; if (!def || ch === '.') continue;
        const at = [0, 0, 0].map((_, k) => config.origin[k] ?? 0); at[ax] += start + i * chunk.spacing; at[cx] += j;
        const pos = space.size && space.size.length === 2 ? at.slice(0, 2) : at;
        if (def.block) { writer.set(pos, def.block); s.cells.push({ at: pos, p: start + i * chunk.spacing }); }
        if (def.archetype) { const e = spawnAt(rt, space, def.archetype, pos, { ...(structuredClone(def.components || {})), chunk: { id: chunk.id, char: ch, n: s.chunkN } }); ids.push(e.id); s.placed.push({ id: e.id, p: start + i * chunk.spacing }); }
      }
      writer.flush();
      if (config.chunkZones && ax < 2 && cx < 2 && typeof space.api.addZone === 'function') { // the chunk's footprint as a zone: [progress span] × [cross span]
        const r = [0, 0, 0, 0], o = config.origin;
        r[ax] = (o[ax] ?? 0) + start; r[ax + 2] = r[ax] + g.P * chunk.spacing; r[cx] = o[cx] ?? 0; r[cx + 2] = r[cx] + g.X;
        addZones(rt, space, [{ id: `chunk_${s.chunkN + 1}`, name: chunk.id, rect: r, tags: ['chunk', chunk.id] }]);
      }
      return g.P * chunk.spacing;
    };
    const spawnChunk = () => {
      const s = st();
      const tier = config.tierBy === 'distance' ? 1 + config.tierDistance.filter(d => s.nextAt >= d).length : tierAt(config.speed, rt.state.time);
      let chunk;
      if (s.chunkN === 0) chunk = pool.find(c => c.tier === 1) || pool[0];
      else { let list = eligible(pool, tier); if (list.length > 1) list = list.filter(c => c.id !== s.lastChunk); chunk = list[Math.floor(rt.random() * list.length)]; }
      const start = s.nextAt + (s.chunkN === 0 ? 0 : join);
      const length = place(chunk, start);
      s.nextAt = start + length; s.lastChunk = chunk.id; s.chunkN++; s.log.push(chunk.id); if (s.log.length > 8) s.log.shift();
      rt.emitTyped('chunk_placed', chunk.id, { at: start, length, tier, n: s.chunkN });
    };
    /** The distance run: how far the followed entity has got from where it first stood; the goal once it is reached. */
    const track = p => {
      const s = st(); s.from ??= p;
      const d = Math.round((p - s.from) * 1e6) / 1e6;
      if (s.best === null || d > s.best) { s.best = d; rt.state.vars['course.distance'] = d; }
      if (config.goal !== undefined && !s.goal && s.best >= config.goal) { s.goal = true; rt.emit('course_goal', { who: config.follow, at: s.best, goal: config.goal }); rt.run(config.onGoal, { self: config.follow }); }
    };
    const stream = () => {
      const p = progressOf(); if (p === null) return;
      track(p);
      for (let guard = 0; st().nextAt < p + config.ahead && (config.end === undefined || st().nextAt + (st().chunkN ? join : 0) < config.end) && guard < 64; guard++) spawnChunk();
      const s = st(), cut = p - config.behind;
      if (s.placed.length && s.placed[0].p < cut) { const keep = []; for (const e of s.placed) { if (e.p < cut) rt.despawn(e.id); else keep.push(e); } s.placed = keep; }
      if (config.clearBehind && s.cells.length && s.cells[0].p < cut) { const writer = cellWriter(rt, space), keep = []; for (const c of s.cells) { if (c.p < cut) writer.set(c.at, null); else keep.push(c); } writer.flush(); s.cells = keep; }
    };
    rt.on('spawn', d => { if (d.id === config.follow) stream(); });
    rt.system('late', stream, ID);
    const limits = chunkLimits(config.speed, pool);
    publish(rt, instance, space, ID, { problems, pool: pool.map(c => c.id), limits, fallback, join }, {
      chunks: { distance: () => st().best ?? 0, goal: () => config.goal ?? null, pool: () => pool.map(c => c.id), limits: () => limits, tier: t => tierAt(config.speed, t ?? rt.state.time), speed: t => speedAt(config.speed, t ?? rt.state.time), nextAt: () => st().nextAt, log: () => st().log.slice(), problems: () => problems },
    });
  },
};
