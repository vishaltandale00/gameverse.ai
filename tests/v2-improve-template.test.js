// Improvement target 'template' (v2/improve/template.js, promote.js, check-template.mjs) and its route
// (POST /api/v2/games/:id/promote-template): a published version becomes a template, checked by the whole template
// contract in its own process against the live catalogue, and written under v2/templates/promoted/ with provenance only
// when it passes. Fake template writers only: nothing is written into the checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { deriveTemplate, derivedTune, templatePaths, DERIVE_CODES } from '../v2/improve/template.js';
import { createImprovementService } from '../v2/improve/promote.js';
import { createFakeRunner } from '../v2/improve/runners/fake.js';
import { tuneProblems, formatProblems, CONTRACT_VERSION } from '../v2/templates/contract.js';
import { templateById, loadTemplates, PROMOTED_SCHEMA } from '../v2/templates/registry.js';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { instancesIn } from '../v2/planner/templates.js';
import { createGameService } from '../v2/server/api.mjs';

const { registry } = await liveCatalogue();
const tmp = mkdtempSync(join(os.tmpdir(), 'gv-improve-template-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const dir = name => { const d = join(tmp, `${name}-${++n}`); mkdirSync(d, { recursive: true }); return d; };
/** A published farm game: the farm template's document as a build would publish it (a premise, its own id). */
const published = (change = () => {}) => { const doc = structuredClone(templateById('farm').doc); doc.id = 'harvest-moon-lx1'; doc.plot.premise = 'A farmer works a small rocky field:\n till, plant and water every day, and bring in the harvest.'; change(doc); return doc; };
const fakeWriter = () => { const writes = []; return { writes, write(path, text) { writes.push({ path, text }); } }; };
const service = (writer = fakeWriter()) => ({ writer, svc: createImprovementService({ root: dir('root'), runner: createFakeRunner(), dataDir: dir('jobs'), templateWriter: writer }) });

test('derive: concept from the premise, the document under the template id, tune from declared params set on a once-used primitive', () => {
  const doc = published();
  const { template, problems } = deriveTemplate({ doc }, { id: 'harvest', registry });
  assert.deepEqual(problems, []);
  assert.equal(template.concept, 'A farmer works a small rocky field: till, plant and water every day, and bring in the harvest.');
  assert.equal(template.doc.id, 'harvest');
  assert.equal(doc.id, 'harvest-moon-lx1', 'the version is not changed');
  assert.deepEqual(formatProblems(template), []);
  assert.deepEqual(tuneProblems(template, registry), [], 'every derived tune path passes the contract\'s tune stage');
  assert.ok(template.tune.includes('gameplay.farming.daySec') && template.tune.includes('engine.generate.grid.board.density'), template.tune.join(', '));
  for (const path of template.tune) {
    const inst = instancesIn(template.doc).find(i => path.startsWith(`${i.use}.`) && path.slice(i.use.length + 1) in (i.with || {}));
    assert.ok(inst, `${path}: the document sets it`);
  }
  assert.ok(!template.tune.includes('gameplay.farming.crops') && !template.tune.includes('gameplay.farming.farmland'), 'lists and open strings are structure, not tuning');
  const twice = published(d => { d.systems.push(structuredClone(d.systems.find(s => s.use === 'gameplay.farming'))); });
  assert.ok(!derivedTune(twice, registry).some(p => p.startsWith('gameplay.farming.')), 'a primitive instantiated twice is never tuned');
});

test('derive: a version without a document, with experiments or without a premise is refused with its code', () => {
  assert.deepEqual(DERIVE_CODES, ['derive_doc_invalid', 'derive_has_experiments', 'derive_premise_missing']);
  const code = doc => deriveTemplate({ doc }, { id: 'x-game', registry }).problems.map(p => p.code);
  assert.deepEqual(code(null), ['derive_doc_invalid']);
  assert.deepEqual(code(published(d => { d.experiments = [{ id: 'pexp', card: { id: 'gameplay.exp.stamina' } }]; })), ['derive_has_experiments']);
  assert.deepEqual(code(published(d => { delete d.plot.premise; })), ['derive_premise_missing']);
});

test('promotion: a passing version is checked out of process and written once with its provenance; discovery loads the file', async () => {
  const { svc, writer } = service();
  const job = await svc.start({ target: 'template', gameId: 'harvest-moon-lx1', gameVersion: 2, doc: published(), registry, templateId: 'harvest' });
  assert.equal(job.templateId, 'harvest');
  const done = await svc.wait(job.id);
  assert.equal(done.state, 'succeeded', `${done.reason} ${JSON.stringify(done.result?.problems)}`);
  assert.deepEqual(done.attempts.map(a => a.verify.checks.map(c => [c.id, c.ok])), [[['template-contract', true]]]);
  assert.equal(writer.writes.length, 1);
  assert.equal(writer.writes[0].path, templatePaths('harvest').file);
  const file = JSON.parse(writer.writes[0].text);
  assert.equal(file.schema, PROMOTED_SCHEMA);
  assert.equal(file.template.id, 'harvest');
  assert.equal(file.provenance.job, job.id);
  assert.equal(file.provenance.contract, CONTRACT_VERSION);
  assert.equal(file.provenance.gameVersion, 2);
  assert.ok(file.provenance.catalogHash && file.provenance.evidence.bots.length, JSON.stringify(file.provenance).slice(0, 300));
  assert.equal(done.report.codingMs, null);
  assert.match(done.report.unavailable.codingMs, /no coding phase/);
  assert.ok(done.report.verifyingMs > 0);
  const templates = dir('templates');
  mkdirSync(join(templates, 'promoted'));
  writeFileSync(join(templates, 'promoted', 'harvest.json'), writer.writes[0].text);
  assert.deepEqual((await loadTemplates({ dir: templates })).map(t => t.id), ['harvest']);
  assert.match((await svc.apply(job.id)).reason, /nothing to apply/);
  await assert.rejects(svc.start({ target: 'template', gameId: 'harvest-moon-lx1', doc: published(), registry, templateId: 'harvest' }), /already running or done/);
});

test('promotion: a version the contract fails, or that cannot be derived, fails with its problems and writes nothing', async () => {
  const { svc, writer } = service();
  const unwinnable = published(d => { d.systems.find(s => s.use === 'gameplay.inventory').with.start = [{ item: 'hoe' }]; });
  const failed = await svc.wait((await svc.start({ target: 'template', gameId: 'barren-lx2', doc: unwinnable, registry })).id);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.templateId, 'barren-lx2', 'the game\'s id when the request names none');
  assert.ok(failed.result.problems.some(p => p.code === 'gate_not_viable') && failed.result.problems.some(p => p.code === 'bot_not_won'), JSON.stringify(failed.result.problems).slice(0, 400));
  assert.match(failed.reason, /template contract failed: .*gate_not_viable/);
  const underived = await svc.wait((await svc.start({ target: 'template', gameId: 'nameless-lx3', doc: published(d => { delete d.plot.premise; }), registry })).id);
  assert.equal(underived.state, 'failed');
  assert.deepEqual(underived.result.problems.map(p => p.code), ['derive_premise_missing']);
  assert.equal(writer.writes.length, 0);
  await assert.rejects(svc.start({ target: 'template', gameId: 'g-1', doc: published(), registry, templateId: 'farm' }), /template 'farm' already exists/);
  await assert.rejects(svc.start({ target: 'template', gameId: 'g-1', doc: published(), registry, templateId: 'Not A Slug' }), /not a lowercase slug/);
  await assert.rejects(svc.start({ target: 'template', gameId: 'g-1', doc: published() }), /registry is required/);
});

test('route: POST /api/v2/games/:id/promote-template promotes the published version it names', async () => {
  const { svc: improve, writer } = service();
  const api = createGameService({ root: dir('store'), env: { V2_DECISIONS: 'off' }, writers: { spec: null, code: null }, decisions: null, improve, experiments: null });
  const call = async (method, path, body) => {
    const res = { code: 0, body: null, writeHead(c) { this.code = c; return this; }, end(b) { this.body = b; } };
    try { await api.handle({ method, url: path }, res, path, async () => body); }
    catch (error) { return { code: error.status || 500, json: { error: error.message } }; }
    return { code: res.code, json: JSON.parse(res.body) };
  };
  assert.equal((await call('POST', '/api/v2/games/nothing-here/promote-template', {})).code, 404);
  await api.store.createGame({ id: 'harvest-moon-lx1', prompt: 'a farming game' });
  await api.store.publish('harvest-moon-lx1', { doc: published(), report: {}, provenance: {}, stage: 'first_playable' });
  const { code, json } = await call('POST', '/api/v2/games/harvest-moon-lx1/promote-template', { version: 1, templateId: 'harvest-route' });
  assert.equal(code, 200, JSON.stringify(json));
  const done = await improve.wait(json.job.id);
  assert.equal(done.state, 'succeeded', done.reason);
  assert.equal(done.gameVersion, 1);
  assert.deepEqual(writer.writes.map(w => w.path), [templatePaths('harvest-route').file]);
  const off = createGameService({ root: dir('store'), env: { V2_DECISIONS: 'off' }, writers: { spec: null, code: null }, decisions: null, improve: null, experiments: null });
  const res = { writeHead() { return this; }, end() {} };
  await assert.rejects(off.handle({ method: 'POST', url: '/x' }, res, '/api/v2/games/harvest-moon-lx1/promote-template', async () => ({})), e => e.status === 503);
});
