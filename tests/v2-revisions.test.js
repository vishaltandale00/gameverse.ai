// Revisions and every other new version pass the version gate (v2/planner/version-gate.js; ARCHITECTURE §4: each
// change is a new immutable version checked like a new game): the template's tune ranges, composition, loop, controls,
// the publish gate with its feature checks, no feature verb that worked stops working, every named bot that won the base
// still wins. Fake writers only (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, templateById } from '../v2/templates/registry.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { hashOf } from '../v2/server/store.js';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import { createJobs } from '../v2/server/jobs.js';
import { tweakDocument } from '../v2/planner/doc-revise.js';
import { gateVersion, tuneSlots, tuneLimits, tuneRangeProblems, instanceValue, versionTemplate, featureRegressions, botRegressions, proofHolds, GATE_CODES, GATE_STAGES } from '../v2/planner/version-gate.js';
import { fakeWriter } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const cat = { registry, logic };

/** A value the slot's schema does not allow (null when every value of its type is allowed: a boolean, an open number). */
function outside(schema) {
  if (Array.isArray(schema.enum)) return `${schema.enum.join('_')}_not_one_of_them`;
  if (typeof schema.maximum === 'number') return schema.maximum + 1;
  if (typeof schema.minimum === 'number') return schema.minimum - 1;
  return null;
}
/** A value the slot's schema allows that differs from `current` (null when there is none to name). */
function inside(schema, current) {
  if (Array.isArray(schema.enum)) return schema.enum.find(v => v !== current) ?? null;
  for (const v of [schema.minimum, schema.maximum]) if (typeof v === 'number' && v !== current) return schema.type === 'integer' ? Math.round(v) : v;
  return null;
}
/** The document with one instance param set. */
function withValue(doc, at, param, value) {
  const d = structuredClone(doc);
  const path = at.match(/[a-z]+|\d+/g);
  let inst = d;
  for (let i = 0; i < path.length; i += 2) inst = inst[path[i]][Number(path[i + 1])];
  inst.with = { ...(inst.with || {}), [param]: value };
  return d;
}

test('tune: every template\'s tune slot bounds a change to its param exactly as it bounds the content form (catalogue-wide)', () => {
  let outCases = 0, inCases = 0;
  for (const t of TEMPLATES) {
    const base = preflight(structuredClone(t.doc), registry, logic).doc;
    const slots = tuneSlots(t, base, cat);
    assert.equal(slots.length, t.tune.length, `${t.id}: every tune path names one instance of its template document`);
    const limits = tuneLimits(t, base, cat);
    for (const s of slots) {
      const key = `${s.at}.with.${s.param}`;
      assert.deepEqual(limits.get(key), { ...(typeof s.schema.minimum === 'number' ? { minimum: s.schema.minimum } : {}), ...(typeof s.schema.maximum === 'number' ? { maximum: s.schema.maximum } : {}) }, `${t.id} ${s.path}: a tweak's limits are the slot's range`);
      const bad = outside(s.schema);
      if (bad !== null) {
        outCases++;
        const problems = tuneRangeProblems(t, withValue(base, s.at, s.param, bad), base, cat);
        assert.deepEqual(problems.map(p => [p.code, p.path]), [['tune_out_of_range', key]], `${t.id} ${s.path} = ${JSON.stringify(bad)}`);
      }
      const ok = inside(s.schema, instanceValue(base, s.at, s.param, s.spec.default));
      if (ok !== null) { inCases++; assert.deepEqual(tuneRangeProblems(t, withValue(base, s.at, s.param, ok), base, cat), [], `${t.id} ${s.path} = ${JSON.stringify(ok)} is in range`); }
    }
    // A value the change left alone is never judged again (a template narrowed later does not refuse other changes).
    assert.deepEqual(tuneRangeProblems(t, base, base, cat), [], t.id);
  }
  assert.ok(outCases > 0 && inCases > 0, `${outCases} out-of-range and ${inCases} in-range cases`);
});

test('the version gate\'s static stages pass every template as it is verified (no gate rule stricter than the template contract; catalogue-wide)', async () => {
  for (const t of TEMPLATES) {
    const g = await gateVersion(structuredClone(t.doc), { ...cat, template: t, through: 'controls' });
    assert.ok(g.ok, `${t.id}: ${g.stage} ${JSON.stringify(g.problems.slice(0, 3))}`);
    assert.equal(g.verification, null, 'nothing simulated');
  }
});

test('versionTemplate: the template a version was made from, with every composed part\'s tune paths', () => {
  for (const t of TEMPLATES) assert.deepEqual(versionTemplate({ templates: [t.id] }, TEMPLATES)?.tune, t.tune, t.id);
  const [a, b] = TEMPLATES;
  assert.deepEqual(versionTemplate({ templates: [a.id, b.id] }, TEMPLATES).tune, [...new Set([...a.tune, ...b.tune])]);
  assert.equal(versionTemplate({ templates: ['no-such-template'] }, TEMPLATES), null);
  assert.equal(versionTemplate({}, TEMPLATES), null, 'a version no template made');
});

test('a tweak of a template game chooses its value within the template\'s tune range', async () => {
  const t = templateById('race'), base = preflight(structuredClone(t.doc), registry, logic).doc;
  const key = [...tuneLimits(t, base, cat).keys()].find(k => k.endsWith('.with.speed'));
  const narrow = new Map([[key, { maximum: 18 }]]);
  const r = await tweakDocument(base, 'make the rivals much faster: set the speed to 400', { registry, limits: narrow });
  const op = r.ops.find(o => o.path === key);
  assert.ok(op && op.to === 18, JSON.stringify(r.ops));
});

test('regression rules: a feature verb that worked must still work; a named bot that won must still win', () => {
  const table = works => ({ features: { table: [{ use: 'gameplay.x', verbs: { jump: { works } } }] } });
  assert.deepEqual(featureRegressions(table(true), table(false)).map(p => p.code), ['feature_regressed']);
  assert.deepEqual(featureRegressions(table(false), table(false)), [], 'a verb that never worked is not a regression');
  assert.deepEqual(featureRegressions(table(true), { features: { table: [] } }), [], 'a removed feature is the structure the change made');
  const proof = (won, extra = {}) => ({ bots: [{ id: 'race', won, undecided: false, status: won ? 'won' : 'lost', frames: 10, ms: 1, proven: [], ...extra }] });
  assert.deepEqual(botRegressions(proof(true), proof(false)).map(p => p.code), ['bot_regressed']);
  assert.deepEqual(botRegressions(proof(true), proof(false, { undecided: true, status: 'playing' })).map(p => p.code), ['bot_unproven']);
  assert.deepEqual(botRegressions(proof(false), proof(false)), [], 'no win to keep');
  assert.deepEqual(botRegressions(proof(true), proof(true)), []);
  for (const stage of GATE_STAGES) assert.ok(GATE_CODES[stage].length, stage);
});

/** A game made from a template: its first version as the template path publishes it (the template's document, preflighted). */
function templateGame(id, seed = 3) {
  const doc = preflight({ ...structuredClone(templateById(id).doc), seed }, registry, logic).doc;
  const versions = [{ version: 1, stage: 'first_playable', doc, report: { kind: 'kernel', path: 'template', templates: [id] }, provenance: { pipeline: 'test', templates: [id], seed, prompt: id, outlineHash: hashOf(doc) } }];
  const checkpoints = {};
  const ctx = {
    stage() {}, draft() {}, checkpoint(name, value) { checkpoints[name] = value; },
    async publish(p) { const r = { version: versions.length + 1, ...p }; versions.push(r); return r; },
    store: { async updateMeta() {}, async version(_, v) { return versions[v - 1]; }, async latest() { return versions.at(-1); } },
  };
  return { versions, checkpoints, ctx };
}
const opsWriter = ops => fakeWriter([() => JSON.stringify({ ops, unsupported: [], summary: 'done' })]);

test('a revision that makes the named bot lose is refused: race rivals ten times faster', async () => {
  const g = templateGame('race');
  const speed = g.versions[0].doc.systems.find(s => s.use === 'gameplay.ai.seek').with.speed;
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: opsWriter([{ op: 'set', path: 'systems[gameplay.ai.seek].with.speed', value: speed * 10 }]) } });
  await assert.rejects(pipeline({ gameId: 'g', kind: 'revise', change: 'rivals 10x faster' }, g.ctx), e => e.status === 422 && e.code === 'bot_regressed' && e.report.stage === 'bots');
  assert.equal(g.versions.length, 1, 'nothing published');
  assert.equal(g.checkpoints.versionGate.stage, 'bots');
});

test('a revision out of the template\'s tune range is refused before anything simulates', async () => {
  const g = templateGame('race');
  const t = templateById('race'), s = tuneSlots(t, g.versions[0].doc, cat).find(x => outside(x.schema) !== null);
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: opsWriter([{ op: 'set', path: `${s.at}.with.${s.param}`, value: outside(s.schema) }]) } });
  const started = performance.now();
  await assert.rejects(pipeline({ gameId: 'g', kind: 'revise', change: 'the one the writer answers' }, g.ctx), e => e.status === 422);
  assert.equal(g.versions.length, 1, 'nothing published');
  assert.ok(!g.checkpoints.versionGate || ['preflight', 'tune'].includes(g.checkpoints.versionGate.stage), JSON.stringify(g.checkpoints.versionGate));
  assert.ok(performance.now() - started < 2000, 'refused statically');
});

test('a revision publishes the revised document, keeps its themed names, and its provenance reproduces it from its base', async () => {
  const g = templateGame('race');
  const base = g.versions[0];
  const ops = [{ op: 'set', path: 'title', value: 'Cart Rally' }];
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: opsWriter(ops) } });
  const r = await pipeline({ gameId: 'g', kind: 'revise', change: 'call it Cart Rally' }, g.ctx);
  assert.equal(r.doc.title, 'Cart Rally');
  // The version is the revised document, not the document the host mounts (the host adds its input and UI itself).
  assert.deepEqual(r.doc.systems.map(s => s.use), base.doc.systems.map(s => s.use));
  assert.deepEqual(r.doc.graphics ?? [], base.doc.graphics ?? []);
  assert.deepEqual(r.doc.content, base.doc.content, 'every themed name kept');
  // Provenance: the origin carried, this version's own facts (never the base's document hash).
  const p = r.provenance;
  assert.deepEqual([p.base, p.baseHash, p.change, p.revisePath, p.templates], [1, hashOf(base.doc), 'call it Cart Rally', 'model', ['race']]);
  assert.equal(p.outlineHash, undefined, 'the base\'s document hash is not this version\'s');
  assert.equal(p.catalogHash.length, 64);
  const { applyOps } = await import('../v2/planner/doc-revise.js');
  assert.equal(hashOf(preflight(applyOps(base.doc, p.ops).doc, registry, logic).doc), hashOf(r.doc), 'base + ops reproduce the version');
  // A running session restarts on it; the named bot's proof of it is kept for its next revision.
  assert.equal(r.report.hot, 'restart');
  assert.ok(proofHolds(r.report.proof, r.doc, registry) && r.report.proof.bots.some(b => b.id === 'race' && b.won), JSON.stringify(r.report.proof));
  assert.equal(r.report.base, 1);
});

test('one game\'s jobs run one at a time, in order (a queued change builds on what the one before it published)', async () => {
  const log = [];
  let release;
  const first = new Promise(res => { release = res; });
  const pipeline = async job => { log.push(`start ${job.change}`); if (job.change === 'a') await first; log.push(`end ${job.change}`); };
  const store = { async updateMeta() {}, async appendRun() {}, async recordFailure() { return null; } };
  const jobs = createJobs({ store, pipeline, maxConcurrent: 4 });
  const done = new Promise(res => { let n = 0; jobs.subscribe(e => { if (e.type === 'job_done' && ++n === 3) res(); }); });
  jobs.submit({ gameId: 'g', kind: 'revise', change: 'a' });
  jobs.submit({ gameId: 'g', kind: 'revise', change: 'b' });
  jobs.submit({ gameId: 'other', kind: 'revise', change: 'c' });
  await new Promise(res => setTimeout(res, 10));
  assert.deepEqual(log, ['start a', 'start c', 'end c'], 'another game runs alongside; the same game waits');
  release();
  await done;
  assert.deepEqual(log, ['start a', 'start c', 'end c', 'end a', 'start b', 'end b']);
});
