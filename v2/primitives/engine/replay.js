// Input recording and ghosts. While recording, the player's per-step input
// is stored run-length encoded (replaying it from the same document and
// seed reproduces the run exactly, which verifiers and bug reports use) and
// the player's position is sampled into a trace. A saved trace, or one
// written in the document, plays back as a ghost entity (components.ghost)
// that follows the trace, interpolating between samples in vector spaces and
// changing spaces when the trace does. Ghosts are skipped by physics.
import { isVec, round } from './runtime-lib.js';

const ID = 'engine.replay';
const clean = input => {
  const out = {};
  for (const k of ['actions', 'held', 'axes']) if (input?.[k] && Object.keys(input[k]).length) out[k] = input[k];
  return out;
};

/** Expand a run-length recording [[count, input], ...] to one input per step. */
export const expandInputs = runs => runs.flatMap(([n, input]) => Array.from({ length: n }, () => structuredClone(input)));

export default {
  id: ID,
  card: {
    intent: 'Records the player\'s inputs (exact deterministic replays) and position traces, and plays traces back as ghost entities: time-trial ghosts, recorded demos, a past self to race or follow.',
    views: ['any'],
    params: {
      record: { type: 'boolean', default: true, effect: 'record from the first step' },
      maxSec: { type: 'number', default: 600, min: 1, max: 7200, unit: 's', effect: 'recording stops after this long' },
      sampleEvery: { type: 'integer', default: 2, min: 1, max: 60, unit: 'frames', effect: 'position trace resolution' },
      ghostArchetype: { type: 'ref', to: 'archetype', effect: 'default archetype for ghosts' },
      ghosts: { type: 'list', default: [], effect: 'traces authored in the document',
        of: { type: 'object', fields: {
          id: { type: 'string', required: true }, archetype: { type: 'ref', to: 'archetype' }, space: { type: 'ref', to: 'space' },
          every: { type: 'integer', default: 2, min: 1, max: 600, unit: 'frames' }, points: { type: 'list', min: 1, of: { type: 'json' }, required: true },
          autostart: { type: 'boolean', default: false }, loop: { type: 'boolean', default: false },
        } } },
    },
    provides: { events: ['recording_started', 'recording_stopped', 'ghost_saved', 'ghost_started', 'ghost_finished', 'ghost_finished:*'], services: ['replay'] },
    requires: { capabilities: ['position'] },
    defines: [{ kind: 'ghost', in: 'ghosts' }],
    rules: {
      replay_ghost_archetype: { fields: ['ghosts[].archetype', 'ghostArchetype'], message: 'every ghost has an archetype: its own, or ghostArchetype', example: { ghosts: [{ id: 'past', points: [[0, 0]] }] } },
      replay_points_invalid: { fields: ['ghosts[].points'], message: "every point is a position in the space's coordinates (never null)", example: { ghostArchetype: 'ball', ghosts: [{ id: 'past', points: [[0, 0], null] }] } },
    },
  },
  logic(logic) {
    const codes = kind => [{ code: 'replay_effect_invalid', fields: ['ghost'], message: 'ghost is a ghost id', example: { do: kind } }];
    const g = (e, path, errors) => { if (typeof e.ghost !== 'string') errors.push({ code: 'replay_effect_invalid', path, message: `${e.do} needs a ghost id` }); };
    logic.effect('start_recording', { run: (e, rt) => rt.service('replay').startRecording() });
    logic.effect('stop_recording', { run: (e, rt) => rt.service('replay').stopRecording() });
    logic.effect('save_ghost', { codes: codes('save_ghost'), check: g, run: (e, rt) => rt.service('replay').saveGhost(e.ghost) });
    logic.effect('start_ghost', { codes: codes('start_ghost'), check: g, run: (e, rt) => rt.service('replay').startGhost(e.ghost, { archetype: e.archetype, loop: e.loop, id: e.id }) });
    logic.effect('stop_ghost', { codes: codes('stop_ghost'), check: g, run: (e, rt) => rt.service('replay').stopGhost(e.ghost) });
  },
  validate(config) {
    const errors = [];
    config.ghosts.forEach((g, i) => {
      if (!g.archetype && !config.ghostArchetype) errors.push({ code: 'replay_ghost_archetype', path: `ghosts[${i}].archetype`, message: 'a ghost needs an archetype (or set ghostArchetype)' });
      if (g.points?.some(p => p === null || p === undefined)) errors.push({ code: 'replay_points_invalid', path: `ghosts[${i}].points`, message: 'points are positions in the space\'s coordinates' });
    });
    return errors;
  },
  install(rt, config) {
    const st = () => { const s = rt.store(ID); s.saved ??= {}; s.live ??= {}; return s; };
    const maxFrames = Math.round(config.maxSec * 60);
    const traceOf = id => st().saved[id] ?? (() => { const g = config.ghosts.find(x => x.id === id); return g && { every: g.every, space: g.space ?? rt.doc.spaces[0].id, points: g.points, spaces: null, archetype: g.archetype, loop: g.loop }; })();
    const api = {
      startRecording() { const s = st(); s.rec = { on: true, start: rt.state.frame, runs: [], points: [], spaces: [], space: rt.player()?.space ?? null }; rt.emit('recording_started', {}); },
      stopRecording() { const s = st(); if (s.rec?.on) { s.rec.on = false; rt.emit('recording_stopped', { frames: rt.state.frame - s.rec.start }); } },
      recording: () => Boolean(st().rec?.on),
      /** Inputs since recording started, one per step: feed them to a fresh world from the same document and seed. */
      inputs: () => expandInputs(st().rec?.runs || []),
      trace: () => structuredClone(st().rec ? { every: config.sampleEvery, space: st().rec.space, points: st().rec.points, spaces: st().rec.spaces } : null),
      saveGhost(id) {
        const s = st(), r = s.rec; if (!r || !r.points.length) return false;
        const multi = r.spaces.some(x => x !== r.spaces[0]);
        s.saved[id] = { every: config.sampleEvery, space: r.spaces[0] ?? r.space, points: structuredClone(r.points), spaces: multi ? r.spaces.slice() : null };
        rt.emit('ghost_saved', { ghost: id, points: r.points.length });
        return true;
      },
      startGhost(id, { archetype, loop, id: entityId } = {}) {
        const tr = traceOf(id), kind = archetype ?? tr?.archetype ?? config.ghostArchetype; if (!tr || !kind) return null;
        const e = rt.spawn(kind, { space: tr.spaces?.[0] ?? tr.space, at: structuredClone(tr.points[0]), id: entityId, components: { ghost: { ghost: id, t: 0, loop: Boolean(loop ?? tr.loop) } } });
        st().live[e.id] = id;
        rt.emit('ghost_started', { ghost: id, who: e.id });
        return e.id;
      },
      stopGhost(id) { const s = st(); for (const [eid, g] of Object.entries(s.live)) if (g === id) { delete s.live[eid]; rt.despawn(eid); } },
    };
    rt.provide('replay', api);
    rt.system('input', rt => {
      const s = st();
      if (s.rec === undefined) { if (config.record) api.startRecording(); else s.rec = null; for (const g of config.ghosts) if (g.autostart) api.startGhost(g.id); }
      const r = s.rec; if (!r?.on) return;
      if (rt.state.frame - r.start >= maxFrames) { api.stopRecording(); return; }
      const input = clean(rt.input), last = r.runs[r.runs.length - 1];
      if (last && JSON.stringify(last[1]) === JSON.stringify(input)) last[0]++; else r.runs.push([1, input]);
    }, ID);
    rt.system('late', rt => {
      const s = st(), r = s.rec, p = rt.player();
      if (r?.on && p && (rt.state.frame - r.start) % config.sampleEvery === 0) { r.points.push(structuredClone(p.at)); r.spaces.push(p.space); }
      for (const [eid, id] of Object.entries(s.live)) {
        const e = rt.entity(eid); if (!e) { delete s.live[eid]; continue; }
        const g = e.components.ghost, tr = traceOf(id); g.t++;
        const f = g.t / tr.every, i = Math.floor(f);
        if (i >= tr.points.length - 1) {
          if (g.loop) { g.t = 0; continue; }
          delete s.live[eid]; rt.despawn(eid); rt.emitTyped('ghost_finished', id, { ghost: id }); continue;
        }
        const space = tr.spaces?.[i] ?? tr.space, a = tr.points[i], b = tr.points[i + 1];
        const at = isVec(a) && isVec(b) && (tr.spaces?.[i + 1] ?? tr.space) === space ? a.map((v, k) => round(v + (b[k] - v) * (f - i), 1e6)) : structuredClone(a);
        if (e.space !== space) rt.moveToSpace(e, space, at); else rt.space(space).setPos(e, at, rt);
      }
    }, ID);
  },
};
