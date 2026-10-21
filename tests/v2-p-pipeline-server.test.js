// The whole pipeline end to end (stubbed models), the server API the studio drives, and the benchmark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { createGameService } from '../v2/server/api.mjs';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { runBench } from '../v2/tools/kernel-bench.mjs';
import { fakeWriter } from './v2-p-pipeline-fixtures.js';

const tmp = () => mkdtempSync(join(os.tmpdir(), 'gv-pipeline-'));

function memoryCtx() {
  const versions = [], stages = [];
  return { versions, stages, ctx: {
    stage(name, detail = {}) { stages.push({ name, ...detail }); }, draft() {},
    async publish(p) { const r = { version: versions.length + 1, ...p }; versions.push(r); return r; },
    store: { async updateMeta() {}, async version(_, v) { return versions[v - 1]; } },
  } };
}

/** A stand-in spec model: answers each layer's request from the prompt it is given. */
function scriptedModel() {
  return fakeWriter([(req) => {
    if (req.schema?.name === 'decomposition') return JSON.stringify({ title: 'Lamp of the Drowned', premise: 'A keeper lost the lamp. Find it.', tone: 'salt and fog', references: [{ name: 'a lighthouse mystery', kind: 'genre', keeps: ['clues'] }], mechanics: [{ id: 'collect', verb: 'collect', description: 'find and collect items', from: '', importance: 'core' }, { id: 'tides', verb: 'flood', description: 'tides flood the lower rooms on a timer', from: '', importance: 'core' }], spaces: [{ role: 'lighthouse', kind: 'locations', description: '' }], views: ['text'], acts: 2, zones: 4 });
    if (/A valid skeleton/.test(req.user)) {
      const doc = JSON.parse(req.user.split('placeholder names):\n')[1].split('\n\nWrite the outline')[0]);
      doc.title = 'Lamp of the Drowned'; doc.plot.premise = 'A keeper lost the lamp.';
      // A model fills the content its core mechanics play with (the core-loop gate requires it).
      doc.content ??= {}; if (!(doc.content.items || []).length) doc.content.items = [{ id: 'lamp', name: 'The lamp' }, { id: 'tide_chart', name: 'Tide chart' }];
      return JSON.stringify(doc);
    }
    if (/Write the detail patch for zone "([^"]+)"/.test(req.user)) {
      const zone = req.user.match(/zone "([^"]+)"/)[1];
      return JSON.stringify({ plot: { characters: [{ id: 'gull', name: 'A gull' }], storyboard: { acts: [{ id: 'act_1', beats: [{ id: 'gull', when: { zone }, do: [{ do: 'say', character: 'gull', text: 'Kee!' }] }] }] } } });
    }
    if (/Change request:/.test(req.user)) return JSON.stringify({ ops: [{ op: 'set', path: 'title', value: 'Lamp of the Deep' }], unsupported: [], summary: 'renamed' });
    return '{}';
  }]);
}

test('end to end with a stubbed model: decompose, select, outline, first playable, parallel detail, revise', async () => {
  const base = buildCatalogue();
  const spec = scriptedModel();
  const pipeline = createKernelPipeline({ catalogue: async () => base, writers: { spec }, decisions: null });
  const { ctx, versions, stages } = memoryCtx();
  const out = await pipeline({ gameId: 'g', prompt: 'a lighthouse mystery with tides', kind: 'create', seed: 5 }, ctx);
  assert.equal(versions[0].stage, 'first_playable');
  assert.equal(versions[0].doc.title, 'Lamp of the Drowned');
  assert.equal(versions[0].report.outline.source, 'fake-writer');
  assert.ok(versions[0].report.timings.firstPlayableBuildMs < 1000);
  for (const m of versions[0].report.selection.mechanics) assert.ok(m.primitives.length || versions[0].report.gaps.some(g => g.mechanic === m.id), `${m.id} is either mapped or reported as a gap, never faked`);
  assert.ok(out.detail.accepted >= 1 && out.detail.proposed >= out.detail.accepted);
  assert.ok(versions.slice(1).every(v => v.stage.startsWith('detail:') && v.report.added));
  for (const k of ['decomposeMs', 'selectMs', 'outlineMs', 'firstPlayableBuildMs', 'requestToFirstPlayableMs', 'totalMs']) assert.equal(typeof out.timings[k], 'number', k);
  assert.ok(stages.some(s => s.name === 'complete'));
  // Revise: a parameter tweak takes no model call; a content change goes to the model as targeted ops.
  const calls = spec.calls.length;
  const tweaked = await pipeline({ gameId: 'g', kind: 'revise', base: versions.length, change: 'more inventory slots' }, ctx);
  assert.equal(tweaked.report.path, 'tweak');
  assert.equal(spec.calls.length, calls, 'no model call for a tweak');
  assert.equal(tweaked.report.hot, 'params');
  const renamed = await pipeline({ gameId: 'g', kind: 'revise', base: versions.length, change: 'rename the game to Lamp of the Deep' }, ctx);
  assert.equal(renamed.report.path, 'model');
  assert.equal(renamed.doc.title, 'Lamp of the Deep');
  assert.deepEqual(renamed.report.changes, ['title']);
});

test('the server builds kernel games, revises them, and refuses to route anything to a kit', async () => {
  const svc = createGameService({ root: tmp(), env: { V2_IMPROVE: 'off', V2_DECISIONS: 'off' }, writers: { spec: null, code: null }, decisions: null, improve: null, experiments: null });
  const call = async (method, path, body) => {
    const res = { code: 0, body: null, writeHead(c) { this.code = c; return this; }, end(b) { this.body = b; } };
    // index.mjs turns thrown { status } errors into responses; mirror that here.
    try { await svc.handle({ method, url: path }, res, path, async () => body); }
    catch (error) { return { code: error.status || 500, json: { error: error.message } }; }
    return { code: res.code, json: JSON.parse(res.body) };
  };
  const done = id => new Promise(resolve => { const off = svc.jobs.subscribe(e => { if (e.gameId === id && (e.type === 'job_done' || e.type === 'job_failed')) { off(); resolve(e); } }); });
  const cat = await call('GET', '/api/v2/catalog');
  assert.ok(cat.json.primitives.some(p => p.id === 'plot.storyboard'));
  assert.equal(cat.json.writers.spec, null);
  const { json: created } = await call('POST', '/api/v2/games', { prompt: 'a mystery in a lighthouse: find the key' });
  const finished = done(created.gameId);
  assert.equal((await finished).type, 'job_done');
  const { json: game } = await call('GET', `/api/v2/games/${created.gameId}`);
  assert.equal(game.latest.doc.schema, 'gameverse.v2.game/0.2');
  assert.equal(game.meta.kind, 'kernel');
  const { json: versions } = await call('GET', `/api/v2/games/${created.gameId}/versions`);
  assert.equal(versions.versions[0].stage, 'first_playable');
  assert.ok(versions.versions.length > 1, 'detail versions follow');
  // A tweak, then a request nothing in this game (and no model) can carry out: reported as a gap.
  let wait = done(created.gameId);
  await call('POST', `/api/v2/games/${created.gameId}/revise`, { change: 'more inventory slots' });
  await wait;
  let latest = (await call('GET', `/api/v2/games/${created.gameId}`)).json.latest;
  assert.equal(latest.report.path, 'tweak');
  wait = done(created.gameId);
  await call('POST', `/api/v2/games/${created.gameId}/revise`, { change: 'add a dragon that breathes fire' });
  await wait;
  latest = (await call('GET', `/api/v2/games/${created.gameId}`)).json.latest;
  assert.equal(latest.report.gaps[0].kind, 'unsupported');
  assert.equal((await call('POST', `/api/v2/games/${created.gameId}/experiments`, { request: 'dragons' })).code, 503);
  // A stored kit game still loads but is never revised through a kit.
  await svc.store.createGame({ id: 'old-kit', prompt: 'old' });
  await svc.store.publish('old-kit', { doc: { schema: 'gameverse.v2.kit-game/0.1', kit: 'maze', id: 'old', title: 'Old' }, report: {}, provenance: {}, stage: 'playable' });
  const refused = await call('POST', '/api/v2/games/old-kit/revise', { change: 'faster' });
  assert.equal(refused.code, 409);
  assert.match(refused.json.error, /retired genre engine/);
});

test('the benchmark records latency, pass rates, detail acceptance and determinism with its context', async () => {
  const r = await runBench({ prompts: ['a mystery in a lighthouse: find the key'], n: 1, offline: true });
  assert.equal(r.summary.succeeded, 1);
  assert.equal(typeof r.summary.requestToFirstPlayableMs.p50, 'number');
  assert.equal(r.summary.replayDeterministicRate, 1);
  assert.equal(r.summary.preflightFirstPassRate, null, 'not measured offline: null with a reason, never zero');
  assert.ok(r.summary.preflightFirstPassUnavailable);
  assert.ok(r.context.catalogHash && r.context.machine.node && Array.isArray(r.context.machine.loadavg));
  assert.ok(r.summary.detailAcceptance.proposed >= 1);
});
