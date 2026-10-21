// Job isolation: a runaway generation job (infinite loop, unbounded allocation) fails
// that job only; the server keeps answering, published versions stay playable, the
// queue moves on, and every failure leaves a record that is enough to reproduce it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { createGameService } from '../v2/server/api.mjs';
import { createJobs } from '../v2/server/jobs.js';
import { createStore } from '../v2/server/store.js';
import { isolationLimits, ISOLATION_DEFAULTS } from '../v2/server/isolate.js';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { mazeWriter } from './v2-p-pipeline-fixtures.js';

const tmp = () => mkdtempSync(join(os.tmpdir(), 'gv-isolation-'));
const runner = new URL('./v2-server-fixture-runner.mjs', import.meta.url).href;

function service(isolation, config = {}) {
  const svc = createGameService({ root: tmp(), env: { V2_IMPROVE: 'off' }, writers: { spec: null, code: null }, decisions: null, improve: null, experiments: null, isolation: { runner, forwardStderr: false, ...isolation }, config });
  const call = async (method, path, body) => {
    const res = { code: 0, body: null, writeHead(c) { this.code = c; return this; }, end(b) { this.body = b; } };
    try { await svc.handle({ method, url: path }, res, path, async () => body); }
    catch (error) { return { code: error.status || 500, json: { error: error.message } }; }
    return { code: res.code, json: JSON.parse(res.body) };
  };
  const ended = new Map();
  svc.jobs.subscribe(e => { if (e.type === 'job_done' || e.type === 'job_failed') ended.set(e.gameId, e); });
  const done = id => new Promise(resolve => {
    if (ended.has(id)) return resolve(ended.get(id));
    const off = svc.jobs.subscribe(e => { if (e.gameId === id && (e.type === 'job_done' || e.type === 'job_failed')) { off(); resolve(e); } });
  });
  return { svc, call, done };
}

test('limits come from options, then V2_JOB_HEAP_MB / V2_JOB_TIMEOUT_MS, then defaults', () => {
  assert.deepEqual(isolationLimits({}), { ...ISOLATION_DEFAULTS });
  assert.deepEqual(isolationLimits({ V2_JOB_HEAP_MB: '512', V2_JOB_TIMEOUT_MS: '60000' }), { heapMb: 512, timeoutMs: 60000 });
  assert.deepEqual(isolationLimits({ V2_JOB_HEAP_MB: 'lots' }, { timeoutMs: 5 }), { heapMb: ISOLATION_DEFAULTS.heapMb, timeoutMs: 5 });
});

test('an endless loop is stopped by the timeout; the server answers meanwhile and the published version stays playable', async () => {
  const { call, done } = service({ heapMb: 128, timeoutMs: 1000 });
  const { json: created } = await call('POST', '/api/v2/games', { prompt: 'publish-loop: a game whose primitive never returns' });
  // While the job spins, the server's event loop is free.
  await new Promise(resolve => setTimeout(resolve, 400));
  const t = performance.now();
  const listed = await call('GET', '/api/v2/games');
  assert.ok(performance.now() - t < 250, 'the server answers while a job spins');
  assert.equal(listed.json.running[0]?.gameId, created.gameId);
  const failed = await done(created.gameId);
  assert.equal(failed.type, 'job_failed');
  assert.equal(failed.code, 'job_timeout');
  const { json: game } = await call('GET', `/api/v2/games/${created.gameId}`);
  assert.equal(game.meta.status, 'failed');
  assert.equal(game.meta.errorCode, 'job_timeout');
  assert.match(game.meta.error, /longer than 1\.0 s/);
  assert.equal(game.latest.version, 1, 'the version published before the runaway is still the playable one');
  assert.equal(game.latest.doc.title, 'Published before the runaway');
  assert.equal(game.latest.provenance.runner.isolation, 'process');
  // The failure record: stage reached, error, intermediate results sent before the kill, limits.
  const { json: record } = await call('GET', `/api/v2/games/${created.gameId}/failures/${game.meta.lastFailure}`);
  assert.equal(record.stageReached, 'outlining');
  assert.equal(record.error.code, 'job_timeout');
  assert.equal(record.decomposition.premise.startsWith('publish-loop'), true);
  assert.deepEqual(record.selection.systems, ['gameplay.runaway']);
  assert.deepEqual(record.published, [1]);
  assert.equal(record.runner.timeoutMs, 1000);
  assert.equal(typeof record.runner.setupMs, 'number');
  const { json: runs } = await call('GET', `/api/v2/games/${created.gameId}/runs`);
  assert.equal(runs.runs.length, 1);
  assert.equal(runs.runs[0].outcome, 'failed');
  assert.equal(runs.runs[0].code, 'job_timeout');
});

test('unbounded allocation hits the heap limit; queued jobs still run and the server still answers', async () => {
  const { svc, call, done } = service({ heapMb: 64, timeoutMs: 20000 });
  // Three at once with two slots: the third waits in the queue behind two runaways.
  const ids = [];
  for (const prompt of ['alloc: small objects forever', 'bigalloc: 40 MB arrays forever', 'throw: an ordinary failure']) ids.push((await call('POST', '/api/v2/games', { prompt })).json.gameId);
  const [small, big, plain] = await Promise.all(ids.map(done));
  for (const e of [small, big]) { assert.equal(e.type, 'job_failed'); assert.equal(e.code, 'job_out_of_memory'); }
  assert.equal(plain.code, 'fixture_code');
  const record = await svc.store.failure(ids[1], 1);
  assert.equal(record.error.code, 'job_out_of_memory');
  assert.match(record.error.stack, /heap/i, 'V8\'s fatal error line is kept');
  assert.equal(record.runner.heapMb, 64);
  const ordinary = await svc.store.failure(ids[2], 1);
  assert.equal(ordinary.error.status, 422);
  assert.match(ordinary.error.stack, /fixture-runner/, 'the stack comes back from the child');
  const cat = await call('GET', '/api/v2/catalog');
  assert.equal(cat.code, 200);
  assert.deepEqual(cat.json.jobs, { isolation: 'process', heapMb: 64, timeoutMs: 20000 });
  assert.ok(process.memoryUsage().heapUsed < 512 * 1048576, 'the server heap is untouched');
});

test('a normal job builds and publishes through the child process', async () => {
  const { call, done } = service({ heapMb: 512, timeoutMs: 60000 }, { maxDetailTasks: 1, solveBudgetMs: 300 });
  // No live model: the runner's scripted spec writer plans the idea and answers the build's questions (nothing is picked without one).
  const { json: created } = await call('POST', '/api/v2/games', { prompt: 'collect coins in a maze' });
  const finished = await done(created.gameId);
  assert.equal(finished.type, 'job_done', finished.error);
  assert.equal(finished.runner.isolation, 'process');
  const { json: game } = await call('GET', `/api/v2/games/${created.gameId}`);
  assert.equal(game.meta.status, 'ready');
  assert.equal(game.meta.kind, 'kernel', 'updateMeta from the child reached the store');
  const { json: first } = await call('GET', `/api/v2/games/${created.gameId}/v/1`);
  assert.equal(first.stage, 'first_playable');
  assert.equal(first.doc.schema, 'gameverse.v2.game/0.2');
  assert.equal(typeof first.report.timings.jobSetupMs, 'number');
  assert.equal(typeof first.report.timings.jobStartMs, 'number');
  assert.deepEqual(first.provenance.runner, { isolation: 'process', heapMb: 512, timeoutMs: 60000 });
  const { json: runs } = await call('GET', `/api/v2/games/${created.gameId}/runs`);
  assert.equal(runs.runs[0].outcome, 'done');
  assert.ok(runs.runs[0].published.length >= 1);
  assert.equal(typeof runs.runs[0].runner.memory.maxRssMb, 'number');
});

test('a pipeline failure keeps decomposition, selection, outline, provenance, stage timings and the stack', async () => {
  const store = createStore(tmp());
  const base = buildCatalogue();
  const kernel = createKernelPipeline({ catalogue: async () => base, writers: { spec: mazeWriter() }, decisions: null });
  // Fails where the live "first playable would not start" failure did: after the outline, at the first version.
  const pipeline = (job, ctx) => kernel(job, { ...ctx, publish: async () => { throw Object.assign(Error('The first playable would not start: test'), { status: 422 }); } });
  const jobs = createJobs({ store, pipeline });
  await store.createGame({ id: 'lamp', prompt: 'collect coins in a maze' });
  const failed = new Promise(resolve => jobs.subscribe(e => { if (e.type === 'job_failed') resolve(e); }));
  jobs.submit({ gameId: 'lamp', prompt: 'collect coins in a maze', kind: 'create', seed: 7 });
  const e = await failed;
  assert.equal(e.failure, 1);
  const meta = await store.meta('lamp');
  assert.equal(meta.status, 'failed');
  assert.equal(meta.lastFailure, 1);
  const r = await store.failure('lamp', 1);
  assert.equal(r.stageReached, 'outlined');
  assert.match(r.error.message, /first playable/);
  assert.match(r.error.stack, /v2-server-isolation\.test\.js/);
  assert.ok(r.error.stack.split('\n').length <= 21);
  assert.ok(r.decomposition.mechanics.length >= 1);
  assert.ok(Array.isArray(r.selection.systems));
  assert.equal(r.outline.doc.schema, 'gameverse.v2.game/0.2', 'the outline document is kept for replay');
  assert.equal(r.provenance.seed, 7);
  assert.equal(r.provenance.pipeline, kernel.version);
  assert.match(r.provenance.catalogHash, /^[0-9a-f]{64}$/);
  for (const name of ['decomposed', 'selected', 'outlined']) assert.equal(typeof r.stages.find(s => s.name === name)?.ms, 'number', name);
  assert.equal(r.runner.isolation, 'in-process');
  assert.equal((await store.runs('lamp'))[0].outcome, 'failed');
});
