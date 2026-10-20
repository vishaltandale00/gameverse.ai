// Browser box for a primitive experiment: the module runs in its own module Worker
// built from a Blob, hardened by the shared pure harness before its code runs. One
// call is in flight at a time; the host gets null until the reply arrives (one or two
// frames later), so the experiment's state chain never forks. A worker that stops
// answering is terminated and the experiment is disabled; the game plays on.
import { pureHarnessSource } from './harness.js';

export const WORKER_WATCHDOG_MS = 1500;

export function workerSource(code) {
  return `const post = self.postMessage.bind(self);
let api = null, meta = {};
self.addEventListener('message', event => {
  const m = event.data || {};
  let res;
  try {
    const out = JSON.parse(api[m.name](m.arg));
    res = out.error ? { ok: false, error: out.error } : { ok: true, value: out };
    if (m.name === 'step' && res.ok && meta.draws) {
      const d = JSON.parse(api.draw(JSON.stringify({ state: out.state, snapshot: JSON.parse(m.arg).snapshot })));
      res.draws = d.draws || [];
    }
  } catch (e) { res = { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
  post({ t: 'reply', name: m.name, res });
});
api = ${pureHarnessSource(code)};
meta = JSON.parse(api.meta());
post({ t: 'meta', meta });
`;
}

export function createWorkerBox(code, { watchdogMs = WORKER_WATCHDOG_MS, now = () => performance.now() } = {}) {
  let src;
  try { src = workerSource(code); } catch (error) { return { error: String(error.message || error) }; }
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(url, { type: 'module', name: 'gameverse-primitive-experiment' });
  let meta = null, error = null, inflight = null, sentAt = 0, reply = null, draws = [];
  worker.onmessage = event => {
    const m = event.data || {};
    if (m.t === 'meta') { meta = m.meta; if (meta?.error) error = meta.error; URL.revokeObjectURL(url); }
    else if (m.t === 'reply') { reply = { name: m.name, res: m.res }; inflight = null; if (m.res?.draws) draws = m.res.draws; }
  };
  worker.onerror = e => { error = String(e?.message || 'the worker failed'); };
  const call = (name, arg) => {
    if (error) return { ok: false, error };
    if (reply?.name === name) { const r = reply.res; reply = null; return r; }
    if (inflight) {
      if (now() - sentAt > watchdogMs) { error = 'it stopped answering'; worker.terminate(); return { ok: false, error }; }
      return null;
    }
    if (!meta) return null;
    inflight = name; sentAt = now();
    worker.postMessage({ name, arg: JSON.stringify(arg) });
    return null;
  };
  return {
    lagged: true,
    get meta() { return meta; }, get error() { return error; },
    init: arg => call('init', arg), step: arg => call('step', arg),
    draw: () => ({ ok: true, value: { draws } }),
    dispose() { worker.terminate(); },
  };
}
