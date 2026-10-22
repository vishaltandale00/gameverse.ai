// Conformance: no primitive's action may hang, throw, flood events, corrupt state or diverge on malformed values
// (KERNEL_API.md §5: only undefined/null/false mean "no action"; 0, '' and true are delivered, so every action
// handler must tolerate any JSON value). Each primitive is fuzzed in its own worker_thread with a small heap
// and a timeout, so a runaway loop is reported against the primitive and action instead of hanging the runner.
//
// Per action x value in VALUES: 3 steps with the action held, then 2 empty steps, in two identical worlds.
//   - no throw escapes             - events per step <= EVENT_CAP (5000; a legitimate step emits tens)
//   - snapshot has no new NaN/Inf  - both worlds end in the same snapshot (determinism)
//   - hang/OOM: worker killed after TIMEOUT_MS or when its heap exceeds HEAP_MB; reported with the last action tried
// Documents: a per-primitive recipe where required params need content, else a synthetic document (the first
// space that compiles + the primitive and its required primitives), plus the first v2/games|examples document using it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { loadCatalogue } from '../v2/planner/catalog.js';

const HEAP_MB = 256, TIMEOUT_MS = 20000, POOL = 4;

function fuzzInWorker(id) {
  return new Promise(resolve => {
    let last = null, done = false;
    const worker = new Worker(new URL('./v2-kernel-action-fuzz-worker.js', import.meta.url), { workerData: { id }, resourceLimits: { maxOldGenerationSizeMb: HEAP_MB, maxYoungGenerationSizeMb: 32 } });
    const finish = r => { if (done) return; done = true; clearTimeout(timer); worker.terminate(); resolve(r); };
    const where = () => last ? `${last.source} action '${last.action}' value ${last.value}` : 'before the first trial';
    const timer = setTimeout(() => finish({ id, failures: [{ kind: 'hang', action: last?.action, message: `no result in ${TIMEOUT_MS} ms; last trial: ${where()}` }], ran: [], verbs: [] }), TIMEOUT_MS);
    worker.on('message', m => { if (m.progress) last = m.progress; else finish(m.result); });
    worker.on('error', e => finish({ id, failures: [{ kind: /heap|memory/i.test(String(e?.code || e?.message)) ? 'oom' : 'crash', action: last?.action, message: `${e?.code || e?.message}; last trial: ${where()}` }], ran: [], verbs: [] }));
    worker.on('exit', code => finish({ id, failures: [{ kind: 'exit', action: last?.action, message: `worker exited ${code}; last trial: ${where()}` }], ran: [], verbs: [] }));
  });
}

const { registry } = await loadCatalogue();
// Primitives that register actions, or read declared input axes (card.actionSpace) such as the vehicle drive models.
const ids = registry.ids().filter(id => registry.get(id).card.provides?.actions?.length || Object.keys(registry.get(id).card.actionSpace || {}).length);
const started = performance.now();
const results = new Map();
{
  const queue = [...ids];
  await Promise.all(Array.from({ length: POOL }, async () => { while (queue.length) { const id = queue.shift(); results.set(id, await fuzzInWorker(id)); } }));
}
const elapsed = performance.now() - started;

for (const id of ids) {
  const r = results.get(id);
  test(`${id}: actions survive malformed values`, t => {
    if (r.skipped) { t.skip(r.skipped); return; }
    assert.deepEqual(r.failures.slice(0, 5).map(f => `${f.kind} action '${f.action}' value ${f.value} [${f.source || ''}]: ${f.message}`), []);
    assert.ok(r.ran.some(x => x.trials), `no document could be fuzzed: ${r.ran.map(x => x.error).join('; ')}`);
  });
  test(`${id}: actionSpace (if declared) is well-formed`, () => {
    // KERNEL_API section 2 solver conventions: continuous verbs are declared as {type: number|vector|enum, min?, max?, options?}
    // (legacy cards use {kind: continuous|impulse, params}). Keys may be actions or input axes.
    for (const [verb, spec] of Object.entries(registry.get(id).card.actionSpace || {})) {
      assert.ok(spec && typeof spec === 'object', `actionSpace.${verb}`);
      assert.ok(['number', 'vector', 'enum', 'choice'].includes(spec.type) || ['continuous', 'impulse'].includes(spec.kind), `actionSpace.${verb} needs a type or kind`);
      if (spec.type === 'choice') assert.ok(typeof spec.of === 'string' && spec.of.length > 3, `actionSpace.${verb}: a choice says what its value names (of)`);
      if (spec.type === 'enum') assert.ok(Array.isArray(spec.options) && spec.options.length, `actionSpace.${verb}.options`);
    }
  });
}

test('action fuzz coverage and runtime', () => {
  const skipped = ids.filter(id => results.get(id).skipped), fuzzed = ids.filter(id => results.get(id).ran.some(x => x.trials));
  const blind = fuzzed.filter(id => !results.get(id).ran.some(x => x.effective));
  console.log(`action fuzz: primitives where no trial changed state vs a no-input control (actions need richer context): ${blind.join(', ') || 'none'}`);
  console.log(`action fuzz: ${fuzzed.length}/${ids.length} primitives fuzzed in ${(elapsed / 1000).toFixed(1)} s; skipped: ${skipped.map(id => `${id} (${results.get(id).skipped.slice(0, 80)})`).join('; ') || 'none'}`);
  assert.ok(fuzzed.length >= ids.length * 0.7, 'most action-registering primitives must be fuzzable');
});
