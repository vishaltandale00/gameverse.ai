// Browser runtime for an experiment (v2/kits/EXTENDING.md, tier 3): the module runs in its own
// module Worker built from a Blob. The worker's first code captures postMessage and its message
// listener, then the shared harness strips network, storage, timers, clocks, code generation and
// nested workers from the realm and freezes the intrinsics before the experiment code runs.
// The host posts { snapshot, input } once per step and applies the operations from the previous
// reply (one frame of lag). A watchdog terminates a worker that is silent for too long or keeps
// throwing; the experiment is then disabled with a visible note and the base game plays on.
import { applyOps } from '../kits/mods/compose.js';
import { harnessSource, cleanOps, cleanDraws } from './sandbox.js';

export const WATCHDOG = { replyMs: 400, loadMs: 1500, maxErrors: 3 };

/** Source of the worker module for an experiment's code (throws when the code can't be hosted). */
export function workerSource(code, { seed = 1 } = {}) {
  return `const post = self.postMessage.bind(self);
let api = null;
self.addEventListener('message', event => {
  const m = event.data || {};
  try {
    if (m.t === 'init') { const r = JSON.parse(api.init(JSON.stringify(m.snapshot))); post(r.error ? { t: 'error', id: m.id, where: 'init', message: r.error } : { t: 'ready', id: m.id }); return; }
    if (m.t === 'step') {
      const s = JSON.parse(api.step(JSON.stringify({ snapshot: m.snapshot, input: m.input })));
      if (s.error) { post({ t: 'error', id: m.id, where: 'step', message: s.error }); return; }
      const d = JSON.parse(api.draw(JSON.stringify(m.snapshot)));
      if (d.error) { post({ t: 'error', id: m.id, where: 'draw', message: d.error }); return; }
      post({ t: 'step', id: m.id, ops: s.ops, draws: d.draws });
    }
  } catch (e) { post({ t: 'error', id: m.id, where: 'host', message: String(e && e.message || e).slice(0, 200) }); }
});
api = ${harnessSource(code, { seed })};
{ const meta = JSON.parse(api.meta()); post(meta.error ? { t: 'error', where: 'load', message: meta.error } : { t: 'loaded', meta }); }
`;
}

/**
 * Host an experiment in a Worker. Returns the sandbox interface the composer drives:
 * { label, button, reset(snapshot), applyPending(state, emit), post(snapshot, input), draws, status, dispose() }.
 */
export function createSandboxedExperiment(experiment, { kit, world, seed = 1, watchdog = WATCHDOG, onNote = () => {}, now = () => performance.now() } = {}) {
  const status = { disabled: false, note: '', label: String(experiment.label || 'Experiment').slice(0, 40), errors: 0, steps: 0, applied: 0, dropped: 0, malformed: 0 };
  let worker = null, url = null, pending = null, waiting = null, ready = false, draws = [], seq = 0;
  const disable = note => {
    if (status.disabled) return;
    status.disabled = true; status.note = note; draws = []; pending = null; waiting = null;
    try { worker?.terminate(); } catch {}
    worker = null;
    if (url) { try { URL.revokeObjectURL(url); } catch {} url = null; }
    try { onNote(`Experiment “${status.label}” stopped: ${note}`); } catch {}
  };
  const failed = (where, message) => {
    status.errors++;
    if (where === 'load' || where === 'init' || status.errors >= watchdog.maxErrors) disable(where === 'load' ? `it did not load (${message})` : `it kept failing (${message})`);
  };
  try {
    if (typeof Worker !== 'function' || typeof Blob !== 'function') throw Error('this browser has no Workers');
    url = URL.createObjectURL(new Blob([workerSource(experiment.code, { seed })], { type: 'text/javascript' }));
    worker = new Worker(url, { type: 'module', name: `experiment ${status.label}` });
  } catch (error) {
    disable(/security|content security|csp/i.test(String(error?.message || error)) ? 'this host does not allow sandboxed workers' : `it could not start (${String(error?.message || error).slice(0, 120)})`);
  }
  if (worker) {
    worker.onerror = event => { event.preventDefault?.(); disable(`it crashed (${String(event.message || 'worker error').slice(0, 120)})`); };
    worker.onmessageerror = () => failed('step', 'unreadable message');
    worker.onmessage = event => {
      const m = event.data || {};
      if (m.t === 'loaded') { if (url) { URL.revokeObjectURL(url); url = null; } return; }
      if (m.id !== undefined && waiting && m.id !== waiting.id) return; // a stale reply after a reset
      waiting = null;
      if (m.t === 'ready') { ready = true; status.errors = 0; return; }
      if (m.t === 'error') { failed(m.where, String(m.message || 'error').slice(0, 160)); return; }
      if (m.t === 'step') {
        status.steps++; status.errors = 0;
        const ops = cleanOps(m.ops), list = cleanDraws(m.draws);
        status.malformed += ops.malformed + list.malformed;
        pending = pending ? [...pending, ...ops.ops].slice(-64) : ops.ops;
        draws = list.draws;
      }
    };
  }
  const send = message => {
    if (!worker || status.disabled) return false;
    waiting = { id: message.id, at: now(), load: message.t === 'init' };
    try { worker.postMessage(message); return true; } catch (error) { disable(`it could not receive the game (${String(error?.message || error).slice(0, 80)})`); return false; }
  };
  // A worker that doesn't answer in time is stopped. The first reply allows for module loading.
  const overdue = () => waiting && now() - waiting.at > (waiting.load ? watchdog.loadMs : watchdog.replyMs);

  return {
    label: status.label, button: experiment.button === true, status,
    get draws() { return status.disabled ? [] : draws; },
    reset(snapshot) {
      if (status.disabled) return;
      ready = false; pending = null; draws = [];
      send({ t: 'init', id: ++seq, snapshot });
    },
    /** Apply the operations from the latest reply to this state. */
    applyPending(state, emit) {
      if (status.disabled || !pending?.length) return { applied: 0, dropped: 0 };
      const ops = pending; pending = null;
      try { const r = applyOps(kit, world, state, ops, emit); status.applied += r.applied; status.dropped += r.dropped; return r; }
      catch (error) { failed('apply', String(error?.message || error)); return { applied: 0, dropped: ops.length }; }
    },
    /** Send this step's snapshot. Skipped while the previous one is unanswered; the watchdog fires when that lasts too long. */
    post(snapshot, input) {
      if (status.disabled) return;
      if (waiting) { if (overdue()) disable(waiting.load ? 'it took too long to start' : `it stopped answering (over ${watchdog.replyMs} ms)`); return; }
      if (!ready) return;
      send({ t: 'step', id: ++seq, snapshot, input });
    },
    dispose() { if (!status.disabled) { status.disabled = true; status.note = 'closed'; } try { worker?.terminate(); } catch {} worker = null; if (url) { try { URL.revokeObjectURL(url); } catch {} url = null; } },
  };
}
