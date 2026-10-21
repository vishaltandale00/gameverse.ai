// A musical clock for rhythm mechanics. Music time advances with the
// simulation (paused by pauseWhen), mapped to beats through a tempo map
// (bpm plus tempo changes at bars, plus runtime set_tempo). Each beat,
// bar and subdivision crossing fires events and effects deterministically,
// so obstacles, enemy attacks and lights can land on the beat. The
// beat_window predicate and the judge verbs grade player timing against the
// nearest beat (perfect / great / good / miss) with a combo var. Audio
// primitives read the `beat` service to align music to the same clock.
import { round, checkFx } from './runtime-lib.js';

const ID = 'engine.beat';

export default {
  id: ID,
  card: {
    intent: 'Tempo clock aligned to music: beat, bar and sub-beat events and effects, a tempo map with changes, a beat-window predicate and timing judgement of player verbs (perfect/great/good/miss, combo).',
    views: ['any'],
    params: {
      bpm: { type: 'number', default: 120, min: 20, max: 400, unit: 'beats/min' },
      beatsPerBar: { type: 'integer', default: 4, min: 1, max: 16 },
      offsetSec: { type: 'number', default: 0, min: -10, max: 60, unit: 's', effect: 'music time of beat 0 (song intro / audio latency)' },
      subdivisions: { type: 'integer', default: 1, min: 1, max: 8, effect: 'sub-beat events per beat (2 = eighths)' },
      swing: { type: 'number', default: 0, min: 0, max: 0.5, effect: 'delays odd sub-beats by this fraction of a sub-beat' },
      tempoChanges: { type: 'list', default: [], of: { type: 'object', fields: { bar: { type: 'integer', min: 1, required: true }, bpm: { type: 'number', min: 20, max: 400, required: true } } }, effect: 'tempo map: from bar N (1-based) on, this bpm' },
      startOn: { type: 'string', effect: 'event that starts the clock (default: running from the start)' },
      pauseWhen: { type: 'predicate', effect: 'music time stops while it holds' },
      loopBars: { type: 'integer', default: 0, min: 0, max: 1024, effect: 'bar numbers wrap after this many bars (0 = never)' },
      windowMs: { type: 'number', default: 90, min: 5, max: 500, unit: 'ms', effect: 'default beat_window tolerance' },
      grades: { type: 'list', default: [{ id: 'perfect', ms: 45 }, { id: 'great', ms: 90 }, { id: 'good', ms: 135 }], of: { type: 'object', fields: { id: { type: 'string', required: true }, ms: { type: 'number', min: 1, required: true } } }, effect: 'judgement windows, tightest first' },
      judge: { type: 'list', of: { type: 'string' }, default: [], effect: 'player verbs whose presses are graded against the beat' },
      onBeat: { type: 'effects', default: [], effect: 'run every beat' },
      onBar: { type: 'effects', default: [], effect: 'run every bar' },
    },
    provides: { events: ['beat', 'beat:*', 'bar', 'sub_beat', 'beat_hit', 'beat_hit:*', 'beat_miss', 'tempo_changed'], vars: ['beat.bpm', 'beat.index', 'beat.bar', 'beat.in_bar', 'beat.phase', 'beat.combo', 'beat.grade'], services: ['beat'] },
    requires: {},
    rules: {
      beat_tempo_invalid: { fields: ['tempoChanges[].bar'], message: 'at most one tempo change per bar', example: { tempoChanges: [{ bar: 2, bpm: 100 }, { bar: 2, bpm: 140 }] } },
      beat_grades_invalid: { fields: ['grades[].ms'], message: 'grades widen: each window (ms) is wider than the one before it, tightest first' },
    },
  },
  logic(logic) {
    // {beat_window: 'beat'|'bar'|'sub', ms?: n, in_bar?: n}: now is within ms of the nearest grid point.
    logic.predicate('beat_window', {
      codes: [{ code: 'beat_predicate_invalid', fields: ['beat_window'], message: "beat_window is 'beat', 'bar' or 'sub'", example: { beat_window: 'measure' } }],
      check: (p, path, errors) => { if (!['beat', 'bar', 'sub'].includes(p.beat_window)) errors.push({ code: 'beat_predicate_invalid', path, message: 'beat_window is beat, bar or sub' }); },
      test: (p, rt) => { const b = rt.service('beat'), n = b.nearest(p.beat_window); return b.running() && Math.abs(n.offsetMs) <= (p.ms ?? b.windowMs) && (p.in_bar === undefined || n.inBar === p.in_bar); },
    });
    logic.effect('set_tempo', { codes: [{ code: 'beat_effect_invalid', fields: ['bpm'], message: 'bpm is a number in [20, 400]', example: { do: 'set_tempo', bpm: 1000 } }], check: (e, path, errors) => { if (!(e.bpm >= 20 && e.bpm <= 400)) errors.push({ code: 'beat_effect_invalid', path, message: 'bpm must be in [20, 400]' }); }, run: (e, rt) => rt.service('beat').setTempo(e.bpm) });
    logic.effect('start_beat', { run: (e, rt) => rt.service('beat').start(e.restart !== false) });
    logic.effect('stop_beat', { run: (e, rt) => rt.service('beat').stop() });
  },
  validate(config, doc, ctx) {
    const errors = [];
    const bars = config.tempoChanges.map(t => t.bar);
    if (new Set(bars).size !== bars.length) errors.push({ code: 'beat_tempo_invalid', path: 'tempoChanges', message: 'two tempo changes at the same bar' });
    const ms = config.grades.map(g => g.ms);
    if (ms.some((v, i) => i && v <= ms[i - 1])) errors.push({ code: 'beat_grades_invalid', path: 'grades', message: 'grades must widen: tightest window first' });
    checkFx(config.onBeat, 'onBeat', errors, ctx);
    return errors;
  },
  install(rt, config) {
    const bpb = config.beatsPerBar;
    const st = () => { const s = rt.store(ID); if (s.t === undefined) Object.assign(s, { t: 0, running: !config.startOn, last: null, lastSub: null, tempo: [], combo: 0 }); return s; };
    // Tempo segments [{beat, time, bpm}] from the document's changes and runtime set_tempo calls.
    const segments = () => {
      const s = st(), out = [{ beat: 0, time: config.offsetSec, bpm: config.bpm }];
      const changes = [...config.tempoChanges.map(c => ({ beat: (c.bar - 1) * bpb, bpm: c.bpm })), ...s.tempo].sort((a, b) => a.beat - b.beat);
      for (const c of changes) { const prev = out[out.length - 1]; if (c.beat <= prev.beat) { prev.bpm = c.bpm; continue; } out.push({ beat: c.beat, time: prev.time + (c.beat - prev.beat) * 60 / prev.bpm, bpm: c.bpm }); }
      return out;
    };
    const beatAt = (t, segs = segments()) => { let g = segs[0]; for (const x of segs) if (x.time <= t) g = x; return g.beat + (t - g.time) * g.bpm / 60; };
    const timeOf = (b, segs = segments()) => { let g = segs[0]; for (const x of segs) if (x.beat <= b) g = x; return g.time + (b - g.beat) * 60 / g.bpm; };
    const bpmAt = (t, segs = segments()) => { let g = segs[0]; for (const x of segs) if (x.time <= t) g = x; return g.bpm; };
    const subFrac = k => (k / config.subdivisions) + (k % 2 === 1 && config.subdivisions % 2 === 0 ? config.swing / config.subdivisions : 0);
    const barOf = i => { const bar = Math.floor(i / bpb) + 1; return config.loopBars ? ((bar - 1) % config.loopBars) + 1 : bar; };
    const api = {
      windowMs: config.windowMs,
      running: () => st().running,
      time: () => st().t,
      position: () => beatAt(st().t),
      bpm: () => bpmAt(st().t),
      timeOf,
      /** Nearest grid point of `kind` to now: { index, offsetMs (now - grid), inBar }. */
      nearest(kind = 'beat') {
        const t = st().t, segs = segments(), b = beatAt(t, segs);
        if (kind === 'bar') { const bar = Math.round(b / bpb); return { index: bar, offsetMs: round((t - timeOf(bar * bpb, segs)) * 1000, 100), inBar: 1 }; }
        if (kind === 'sub') {
          const base = Math.floor(b); let best = null;
          for (let k = -1; k <= config.subdivisions; k++) { const bi = base + Math.floor(k / config.subdivisions), kk = ((k % config.subdivisions) + config.subdivisions) % config.subdivisions; const tt = timeOf(bi + subFrac(kk), segs); const off = (t - tt) * 1000; if (!best || Math.abs(off) < Math.abs(best.offsetMs)) best = { index: bi * config.subdivisions + kk, offsetMs: round(off, 100), inBar: (((bi % bpb) + bpb) % bpb) + 1 }; }
          return best;
        }
        const i = Math.round(b); return { index: i, offsetMs: round((t - timeOf(i, segs)) * 1000, 100), inBar: (((i % bpb) + bpb) % bpb) + 1 };
      },
      judge(offsetMs) { const a = Math.abs(offsetMs); return config.grades.find(g => a <= g.ms)?.id ?? null; },
      setTempo(bpm) { const s = st(), b = beatAt(s.t); s.tempo.push({ beat: round(b, 1e6), bpm }); rt.emit('tempo_changed', { bpm }); },
      start(restart = true) { const s = st(); if (restart) Object.assign(s, { t: 0, last: null, lastSub: null }); s.running = true; },
      stop() { st().running = false; },
    };
    rt.provide('beat', api);
    if (config.startOn) rt.on(config.startOn, () => api.start(true));
    rt.system('input', rt => {
      const s = st(), v = rt.state.vars;
      const paused = config.pauseWhen ? rt.test(config.pauseWhen) : false;
      if (s.running && !paused) {
        const segs = segments(), before = s.t; s.t = round(s.t + rt.dt, 1e9);
        const b0 = Math.floor(beatAt(before, segs)), b1 = Math.floor(beatAt(s.t, segs));
        const from = s.last === null ? Math.max(b0, 0) : s.last + 1;
        for (let i = from; i <= b1 && i - from < 64; i++) {
          if (i < 0) continue;
          const inBar = (i % bpb) + 1, bar = barOf(i);
          rt.emitTyped('beat', inBar, { index: i, bar, inBar });
          if (inBar === 1) { rt.emit('bar', { bar, index: Math.floor(i / bpb) }); rt.run(config.onBar, { beat: i }); }
          rt.run(config.onBeat, { beat: i });
          s.last = i;
        }
        if (config.subdivisions > 1) {
          const pos = beatAt(s.t, segs), base = Math.floor(pos);
          for (let k = 1; k < config.subdivisions; k++) { const idx = base * config.subdivisions + k; if (pos >= base + subFrac(k) && (s.lastSub === null || idx > s.lastSub) && base >= 0) { s.lastSub = idx; rt.emit('sub_beat', { index: idx, beat: base, sub: k }); } }
        }
      }
      const pos = beatAt(s.t), i = Math.max(0, Math.floor(pos));
      v['beat.bpm'] = bpmAt(s.t); v['beat.index'] = s.last ?? 0; v['beat.bar'] = barOf(i); v['beat.in_bar'] = (i % bpb) + 1; v['beat.phase'] = round(pos - Math.floor(pos), 1000);
      // Judge player presses of the configured verbs.
      if (!config.judge.length || !s.running) return;
      const input = rt.hasService('input') ? rt.service('input') : null;
      for (const verb of config.judge) {
        const pressed = input ? input.pressed('player', verb) : Boolean(rt.input.actions?.[verb]);
        if (!pressed) continue;
        const n = api.nearest(config.subdivisions > 1 ? 'sub' : 'beat'), grade = api.judge(n.offsetMs);
        if (grade) { s.combo++; rt.emitTyped('beat_hit', grade, { verb, grade, offsetMs: n.offsetMs, beat: n.index }); }
        else { s.combo = 0; rt.emit('beat_miss', { verb, offsetMs: n.offsetMs, beat: n.index }); }
        v['beat.combo'] = s.combo; v['beat.grade'] = grade ?? 'miss';
      }
    }, ID);
  },
};
