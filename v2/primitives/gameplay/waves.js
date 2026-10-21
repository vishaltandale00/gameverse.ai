// gameplay.waves: scripted and generated enemy waves for shooters, arenas,
// tower defense and survival modes. Waves start at fixed times, after delays,
// when a predicate holds, or only once the previous wave is cleared. Spawns
// pour in staggered, can be telegraphed (a warning marker and event first),
// placed in formations (point/line/v/ring/random) at named lanes, zones or the
// player, and fly an entry path before AI takes over. A cap on live wave
// enemies holds the queue back. Generated waves grow (more / tougher / both),
// loops repeat the script harder, and clears bank a bonus.
import { compare } from '../../kernel/logic.js';
import { alive, has, spaceOf, err, runBound, r6, r6v, v3, instancesOf, sub, len } from './modes-lib-util.js';

const ID = 'gameplay.waves';
const PATTERNS = ['point', 'line', 'v', 'ring', 'random'];
const SPAWN = { type: 'object', fields: {
  archetype: { type: 'ref', to: 'archetype', required: true }, count: { type: 'integer', default: 1, min: 1, max: 200 },
  lane: { type: 'string', effect: 'named lane spawn point' }, zone: { type: 'ref', to: 'zone' }, at: { type: 'json', effect: 'explicit position' }, around: { type: 'string', effect: "'player' or an entity id: anchor on it" },
  pattern: { type: 'string', options: PATTERNS, default: 'point' }, spacing: { type: 'number', default: 1, min: 0, max: 1000 },
  entry: { type: 'string', effect: 'entry path id' }, telegraph: { type: 'number', min: 0, max: 30, unit: 's' }, stagger: { type: 'number', min: 0, max: 30, unit: 's' },
  hpMult: { type: 'number', default: 1, min: 0.01, max: 100 }, components: { type: 'object', open: true, default: {} },
} };

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['wave_clear', 'waves_complete'], win: { param: 'onComplete', reads: { component: 'health', of: 'opponents', by: { effects: ['damage'] } } } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "param", "param": "waves", "min": 3, "why": "scripted waves list which archetypes arrive, how many and when", "example": [{"id": "w1", "spawn": [{"archetype": "grunt", "count": 4}]}]},
      {"need": "archetypes", "component": "health", "kinds": ["enemy", "boss", "creature"], "min": 2, "why": "waves need enemy archetypes with health to send", "example": {"id": "thornling", "kind": "enemy", "components": {"health": {"max": 6}, "touch": {"damage": 1}, "ai": {"brain": [{"do": "chase", "when": {"near": "player", "within": 6}}, {"do": "patrol", "range": 5}], "speed": 2.5}}}},
    ],
    intent: 'Enemy waves: scripted wave lists (time, delay, predicate or clear-gated), staggered and telegraphed spawns in formations at lanes, zones or around the player, entry flight paths, a live-enemy cap, must-clear gating, generated growing waves, loop scaling and clear bonuses.',
    views: ['any'],
    params: {
      id: { type: 'string', default: 'waves', effect: 'name used by the wave predicate and start_waves' },
      waves: { type: 'list', default: [], of: { type: 'object', fields: {
        id: { type: 'string' }, at: { type: 'number', min: 0, max: 36000, unit: 's', effect: 'start this long after the waves start' }, delay: { type: 'number', min: 0, max: 3600, unit: 's', effect: 'start this long after the previous wave started (or cleared, with mustClear)' },
        when: { type: 'predicate' }, spawn: { type: 'list', of: SPAWN, min: 1, required: true }, mustClear: { type: 'boolean' }, boss: { type: 'boolean', default: false }, bonus: { type: 'effects', default: [] },
      } }, effect: 'scripted waves in order' },
      generate: { type: 'object', default: { count: 0, every: 15, size: 2, grow: 'more', cap: 8, archetypes: [], lanes: [], pattern: 'line', spacing: 1.5 }, fields: {
        count: { type: 'integer', default: 0, min: 0, max: 99 }, every: { type: 'number', default: 15, min: 0.5, max: 600, unit: 's' }, size: { type: 'integer', default: 2, min: 1, max: 50 },
        grow: { type: 'string', options: ['none', 'more', 'tougher', 'both'], default: 'more' }, cap: { type: 'integer', default: 8, min: 1, max: 200 },
        archetypes: { type: 'list', of: { type: 'ref', to: 'archetype' }, default: [] }, lanes: { type: 'list', of: { type: 'string' }, default: [] }, entry: { type: 'string' }, pattern: { type: 'string', options: PATTERNS, default: 'line' }, spacing: { type: 'number', default: 1.5 },
      }, effect: 'procedural waves appended after the script (mods/waves port: size grows by one per wave and/or hp by +1 every two waves)' },
      lanes: { type: 'list', default: [], of: { type: 'object', fields: { id: { type: 'string', required: true }, at: { type: 'json', required: true } } }, effect: 'named spawn points' },
      entries: { type: 'list', default: [], of: { type: 'object', fields: { id: { type: 'string', required: true }, points: { type: 'list', of: { type: 'json' }, min: 1, required: true }, speed: { type: 'number', default: 4, min: 0.01, max: 1000 }, relative: { type: 'boolean', default: true }, mirror: { type: 'boolean', default: false, effect: 'odd spawns fly the mirrored path (x flipped)' } } }, effect: 'entry flight paths' },
      stagger: { type: 'number', default: 0.2, min: 0, max: 30, unit: 's', effect: 'gap between spawns of one wave' },
      telegraph: { type: 'number', default: 0, min: 0, max: 30, unit: 's', effect: 'warning time before each spawn appears' },
      maxAlive: { type: 'integer', default: 12, min: 1, max: 1000, effect: 'live wave enemies above this hold the queue' },
      mustClear: { type: 'boolean', default: false, effect: 'each wave waits for the previous to be cleared' },
      startDelay: { type: 'number', default: 0, min: 0, max: 3600, unit: 's' },
      autoStart: { type: 'boolean', default: true }, startWhen: { type: 'predicate' },
      loop: { type: 'boolean', default: false, effect: 'restart the script after the last wave, harder each loop' },
      loopScale: { type: 'object', default: { count: 0.25, hp: 0.3 }, fields: { count: { type: 'number', default: 0.25, min: 0, max: 10 }, hp: { type: 'number', default: 0.3, min: 0, max: 10 } }, effect: 'per-loop growth of counts and hp' },
      bonus: { type: 'object', default: { points: 250, var: 'score' }, fields: { points: { type: 'number', default: 250, min: 0 }, var: { type: 'string', default: 'score' } }, effect: 'points per cleared wave added to a var' },
      onWave: { type: 'effects', default: [] }, onComplete: { type: 'effects', default: [] },
    },
    provides: { events: ['wave_start', 'wave_start:*', 'wave_telegraph', 'wave_spawn', 'wave_entered', 'wave_clear', 'wave_clear:*', 'waves_complete', 'waves_loop'], vars: ['waves.wave', 'waves.alive', 'waves.next'] },
    requires: { capabilities: ['position'] },
    reads: [],
  },
  logic(logic) {
    logic.predicate('wave', {
      check: (p, path, errors) => { if (p.state !== undefined && !['idle', 'running', 'complete'].includes(p.state)) errors.push(err('wave_state', `${path}.state`, 'state must be idle|running|complete')); },
      test: (p, rt) => {
        const s = rt.state.prim[`${ID}:${typeof p.wave === 'string' ? p.wave : 'waves'}`]; if (!s) return false;
        if (p.state && s.state !== p.state) return false;
        if (p.cleared !== undefined) return Boolean(s.cleared?.[p.cleared]);
        return ['gte', 'lte', 'gt', 'lt', 'eq', 'ne'].some(k => p[k] !== undefined) ? compare(s.started ?? 0, p) : p.state ? true : s.state !== 'idle';
      },
    });
    logic.effect('start_waves', { run: (e, rt) => { rt.store(`${ID}:${e.waves ?? 'waves'}`).request = 'start'; } });
    logic.effect('stop_waves', { run: (e, rt) => { rt.store(`${ID}:${e.waves ?? 'waves'}`).request = 'stop'; } });
  },
  validate(config, doc) {
    const errors = [], lanes = new Set(config.lanes.map(l => l.id)), entries = new Set(config.entries.map(e => e.id));
    if (!config.waves.length && !config.generate.count) errors.push(err('waves_empty', 'with.waves', 'no scripted waves and generate.count is 0'));
    if (config.generate.count && !config.generate.archetypes.length) errors.push(err('waves_generate', 'with.generate.archetypes', 'generated waves need archetypes'));
    const checkSpawn = (sp, path) => {
      if (sp.lane && !lanes.has(sp.lane)) errors.push(err('waves_lane_unknown', `${path}.lane`, `unknown lane '${sp.lane}'`, `lanes: ${[...lanes].join(', ') || 'none'}`));
      if (sp.entry && !entries.has(sp.entry)) errors.push(err('waves_entry_unknown', `${path}.entry`, `unknown entry path '${sp.entry}'`));
      if ([sp.lane, sp.zone, sp.at, sp.around].filter(x => x !== undefined).length > 1) errors.push(err('waves_spawn_place', path, 'use one of lane, zone, at or around'));
    };
    config.waves.forEach((w, i) => (w.spawn || []).forEach((sp, j) => checkSpawn(sp, `with.waves[${i}].spawn[${j}]`)));
    config.generate.lanes.forEach((l, i) => { if (!lanes.has(l)) errors.push(err('waves_lane_unknown', `with.generate.lanes[${i}]`, `unknown lane '${l}'`)); });
    if (config.generate.entry && !entries.has(config.generate.entry)) errors.push(err('waves_entry_unknown', 'with.generate.entry', `unknown entry path '${config.generate.entry}'`));
    const ids = instancesOf(doc, ID).map(x => x.s.with?.id ?? 'waves');
    if (ids.filter(i => i === config.id).length > 1) errors.push(err('waves_duplicate', 'with.id', `two wave instances share id '${config.id}'`));
    return errors;
  },
  /** Solver progress: waves cleared. */
  progress(rt, config) { const s = rt.state.prim[`${ID}:${config.id}`]; return s ? Object.keys(s.cleared || {}).length : 0; },
  install(rt, config, instance) {
    const key = `${ID}:${config.id}`, F = sec => Math.round(sec * 60);
    const LANE = new Map(config.lanes.map(l => [l.id, l])), ENTRY = new Map(config.entries.map(e => [e.id, e]));
    const st = () => { const s = rt.store(key); s.state ??= 'idle'; s.alive ??= {}; s.cleared ??= {}; s.queue ??= []; s.warnings ??= []; return s; };
    const spaceId = () => instance.space ?? rt.doc.spaces?.[0]?.id;

    /** Scripted waves then generated ones; generated wave k grows per mods/waves. */
    const waveList = () => {
      const g = config.generate, out = config.waves.map((w, i) => ({ ...w, id: w.id ?? `w${i + 1}` }));
      for (let k = 0; k < g.count; k++) {
        const more = g.grow === 'more' || g.grow === 'both', tougher = g.grow === 'tougher' || g.grow === 'both';
        const count = Math.min(g.cap, g.size + (more ? k : 0)), hpMult = 1 + (tougher ? Math.floor(k / 2) : 0);
        const lane = g.lanes.length ? g.lanes[k % g.lanes.length] : undefined;
        out.push({ id: `g${k + 1}`, delay: g.every, mustClear: undefined, boss: false, bonus: [], generated: true,
          spawn: [{ archetype: g.archetypes[k % g.archetypes.length], count, lane, entry: g.entry, pattern: g.pattern, spacing: g.spacing, hpMult, components: {} }] });
      }
      return out;
    };
    const anchorFor = sp => {
      if (sp.around) { const e = rt.resolve(sp.around); return e?.at ? v3(e.at) : null; }
      if (sp.lane) return v3(LANE.get(sp.lane).at);
      if (sp.at) return v3(sp.at);
      return null;
    };
    const dims = () => { const p = rt.player(); return Array.isArray(p?.at) ? p.at.length : 3; };
    const axis2 = () => { const api = rt.space(spaceId()); return dims() === 3 && has(api, 'groundAt') ? 2 : 1; };
    const offset = (sp, k, n) => {
      const o = [0, 0, 0], a2 = axis2(), c = k - (n - 1) / 2;
      if (sp.pattern === 'line') o[0] = c * sp.spacing;
      else if (sp.pattern === 'v') { o[0] = c * sp.spacing; o[a2] = -Math.abs(c) * sp.spacing; }
      else if (sp.pattern === 'ring') { const t = (k / n) * Math.PI * 2; o[0] = Math.cos(t) * sp.spacing; o[a2] = Math.sin(t) * sp.spacing; }
      else if (sp.pattern === 'random') { const t = rt.random() * Math.PI * 2, r = Math.sqrt(rt.random()) * sp.spacing; o[0] = Math.cos(t) * r; o[a2] = Math.sin(t) * r; }
      return o;
    };
    function startWave(s, list, i) {
      const w = list[i], loop = s.loop ?? 0, scale = 1 + config.loopScale.count * loop, hpScale = 1 + config.loopScale.hp * loop;
      s.started = i + 1; s.lastStart = s.t; s.current = i; s.alive[i] = []; s.pending ??= {}; s.pending[i] = 0;
      let k = 0;
      for (const sp of w.spawn) {
        const n = Math.max(1, Math.round(sp.count * scale)), anchor = anchorFor(sp), stagger = F(sp.stagger ?? config.stagger), tele = F(sp.telegraph ?? config.telegraph);
        for (let j = 0; j < n; j++, k++) {
          const at = anchor ? r6v(anchor.map((x, d) => x + offset(sp, j, n)[d])).slice(0, dims()) : null;
          s.queue.push({ wave: i, archetype: sp.archetype, at, zone: sp.zone ?? null, entry: sp.entry ?? null, mirror: j % 2 === 1, d: k * stagger, tele, warned: false, hp: sp.hpMult * hpScale, comps: sp.components ?? {} });
          s.pending[i]++;
        }
      }
      rt.emitTyped('wave_start', w.id, { waves: config.id, wave: i + 1, id: w.id, of: list.length, count: s.pending[i], boss: w.boss, loop });
      runBound(rt, config.onWave, {});
    }
    function spawnOne(s, q) {
      const base = rt.archetype(q.archetype)?.components?.health;
      const comps = structuredClone(q.comps);
      if (base && q.hp !== 1) comps.health = { ...base, ...(comps.health || {}), max: r6((comps.health?.max ?? base.max ?? 1) * q.hp) };
      comps.wave = { waves: config.id, wave: q.wave + 1 };
      const e = rt.spawn(q.archetype, { space: spaceId(), at: q.at ?? undefined, components: comps });
      if (q.zone) rt.space(e.space).teleport(e, { zone: q.zone }, rt);
      if (q.entry) {
        const path = ENTRY.get(q.entry), origin = v3(e.at);
        const pts = path.points.map(p => { const v = v3(p); if (path.mirror && q.mirror) v[0] = -v[0]; return r6v(path.relative ? origin.map((x, d) => x + v[d]) : v).slice(0, e.at.length); });
        e.components.waveEntry = { points: pts, i: 0, speed: path.speed };
      }
      s.alive[q.wave].push(e.id); s.pending[q.wave]--;
      rt.emit('wave_spawn', { waves: config.id, wave: q.wave + 1, id: e.id, archetype: q.archetype, at: e.at });
    }
    function step(s) {
      const list = waveList();
      s.t++;
      // Live counts (despawned or dead wave enemies drop out).
      let live = 0;
      for (const [w, ids] of Object.entries(s.alive)) { s.alive[w] = ids.filter(id => alive(rt.entity(id))); live += s.alive[w].length; }
      // Start the next wave when due.
      const i = s.started ?? 0;
      if (i < list.length) {
        const w = list[i], prev = i - 1, gate = w.mustClear ?? config.mustClear;
        const prevClear = prev < 0 || s.cleared[list[prev].id];
        const base = gate && prev >= 0 ? s.clearedAt?.[prev] ?? null : prev < 0 ? F(config.startDelay) : s.lastStart;
        const due = w.at !== undefined ? s.t >= F(w.at) + F(config.startDelay) : base !== null && s.t >= base + F(w.delay ?? 0);
        if (due && (!gate || prevClear) && (!w.when || rt.test(w.when))) startWave(s, list, i);
        else rt.state.vars['waves.next'] = w.at !== undefined ? Math.max(0, Math.ceil((F(w.at) - s.t) / 60)) : 0;
      }
      // Queue: telegraph, then spawn under the live cap.
      s.warnings = s.warnings.filter(x => --x.t > 0);
      const keep = [];
      for (const q of s.queue) {
        if (q.d > 0) { q.d--; keep.push(q); continue; }
        if (q.tele && !q.warned) { q.warned = true; q.d = q.tele; s.warnings.push({ at: q.at, archetype: q.archetype, t: q.tele }); rt.emit('wave_telegraph', { waves: config.id, wave: q.wave + 1, at: q.at, archetype: q.archetype, sec: r6(q.tele / 60) }); keep.push(q); continue; }
        if (live >= config.maxAlive) { keep.push(q); continue; }
        spawnOne(s, q); live++;
      }
      s.queue = keep;
      // Clears.
      for (let w = 0; w < (s.started ?? 0); w++) {
        const id = list[w].id;
        if (s.cleared[id] || s.pending[w] > 0 || s.alive[w]?.length) continue;
        s.cleared[id] = true; (s.clearedAt ??= {})[w] = s.t;
        rt.emitTyped('wave_clear', id, { waves: config.id, wave: w + 1, id });
        if (config.bonus.points) rt.state.vars[config.bonus.var] = (rt.state.vars[config.bonus.var] ?? 0) + config.bonus.points * (1 + (s.loop ?? 0));
        runBound(rt, list[w].bonus, {});
      }
      if ((s.started ?? 0) >= list.length && list.every(w => s.cleared[w.id])) {
        rt.emit('waves_complete', { waves: config.id, loop: s.loop ?? 0, count: list.length });
        runBound(rt, config.onComplete, {});
        if (config.loop) { s.loop = (s.loop ?? 0) + 1; s.started = 0; s.cleared = {}; s.clearedAt = {}; s.alive = {}; s.pending = {}; s.t = 0; rt.emit('waves_loop', { waves: config.id, loop: s.loop }); }
        else s.state = 'complete';
      }
      rt.state.vars['waves.wave'] = s.started ?? 0; rt.state.vars['waves.alive'] = live;
    }

    rt.system('rules', rt => {
      const s = st();
      if (s.request === 'stop') { s.request = null; s.state = 'idle'; s.queue = []; }
      if (s.request === 'start') { s.request = null; if (s.state !== 'running') Object.assign(s, { state: 'running', t: 0, started: 0, cleared: {}, clearedAt: {}, alive: {}, pending: {}, queue: [], loop: 0 }); }
      if (s.state === 'idle' && ((config.autoStart && !s.auto) || (config.startWhen && rt.test(config.startWhen)))) { s.auto = true; Object.assign(s, { state: 'running', t: 0, started: 0, loop: 0 }); }
      if (s.state === 'running') step(s);
    }, ID);

    // Entry paths: fly to each waypoint, then hand the entity back to its AI.
    rt.system('movement', rt => {
      for (const e of Object.values(rt.state.entities)) {
        const w = e.components.waveEntry; if (!w || !Array.isArray(e.at) || e.components.wave?.waves !== config.id) continue;
        const api = spaceOf(rt, e); if (!api) continue;
        let budget = w.speed * rt.dt, at = v3(e.at);
        while (budget > 0 && w.i < w.points.length) {
          const target = v3(w.points[w.i]), d = sub(target, at), l = len(d);
          if (l <= budget) { at = target; budget -= l; w.i++; } else { at = at.map((x, k) => x + (d[k] / l) * budget); budget = 0; }
        }
        api.setPos(e, r6v(at).slice(0, e.at.length), rt);
        if (w.i >= w.points.length) { delete e.components.waveEntry; rt.emit('wave_entered', { id: e.id }); }
      }
    }, ID);
  },
};
