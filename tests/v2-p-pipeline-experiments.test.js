// Gap filling (ARCHITECTURE.md §4 step 4): a new primitive written as a sandboxed experiment,
// gated headless, hosted as a kernel primitive, then promoted through v2/improve (target 'primitive').
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { PRIMITIVE_EXPERIMENT_SCHEMA, cardProblems, cleanEffects, hostPrimitive } from '../v2/experiments/primitive-host.js';
import { checkPrimitiveExperiment, generatePrimitiveExperiment, withExperiment, withoutExperiment, catalogueForDoc, vmBox } from '../v2/experiments/primitive.js';
import { createPrimitiveExperimentService } from '../v2/experiments/primitive-service.js';
import { createImprovementService, scopeCheck } from '../v2/improve/promote.js';
import { resolveConfig } from '../v2/improve/config.js';
import { createFakeRunner, goodPrimitiveChanges } from '../v2/improve/runners/fake.js';
import { primitivePaths } from '../v2/improve/prompt.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { fakeWriter } from './v2-p-pipeline-fixtures.js';

const manor = () => JSON.parse(readFileSync(new URL('../v2/games/quiet-manor.json', import.meta.url), 'utf8'));
const STAMINA = `export default {
  label: 'Stamina',
  init(snapshot, rng, config) { return { stamina: config.max }; },
  step(state, { input, config }) {
    const ops = []; let s = state.stamina;
    if (input.actions && input.actions.sprint) { if (s >= config.cost) { s -= config.cost; ops.push({ do: 'emit', event: 'sprinted' }); } }
    else s = Math.min(config.max, s + config.regen);
    ops.push({ do: 'set_var', var: 'stamina', value: s });
    return { state: { stamina: s }, ops };
  },
  draw(state) { return [{ t: 'text', x: 0.02, y: 0.05, text: 'Stamina ' + Math.round(state.stamina), color: '#fff' }]; },
};`;
const card = (over = {}) => ({ id: 'gameplay.exp.stamina', intent: 'Stamina meter: sprinting spends it, resting regenerates it.', params: { max: { type: 'number', default: 100, min: 10, max: 500, effect: 'meter size' }, cost: { type: 'number', default: 20, min: 1, max: 100 }, regen: { type: 'number', default: 0.5, min: 0, max: 10 } }, provides: { actions: ['sprint'], vars: ['stamina'], events: ['sprinted'] }, ...over });
const exp = (code = STAMINA, c = card()) => ({ schema: PRIMITIVE_EXPERIMENT_SCHEMA, id: 'pexp-test', kind: 'primitive', label: 'Stamina', request: 'a stamina meter for sprinting', card: c, code, instance: { with: { cost: 25 } } });

test('a primitive experiment is hosted as a real kernel primitive: verbs, vars, events, snapshots and restores', async () => {
  const doc = withExperiment(manor(), exp());
  const { registry, logic } = await catalogueForDoc(doc);
  assert.ok(registry.get('gameplay.exp.stamina').card.experimental);
  const pre = preflight(doc, registry, logic);
  assert.ok(pre.ok, JSON.stringify(pre.errors));
  const rt = createWorld(pre.doc, registry, logic, { seed: 1 });
  rt.step(); rt.step();
  assert.equal(rt.state.vars.stamina, 100);
  rt.step({ actions: { sprint: true } }); rt.step();
  assert.equal(rt.state.counts.sprinted, 1);
  assert.equal(rt.state.vars.stamina, 75.5, 'cost 25 from the instance config, then regen 0.5');
  const snap = rt.snapshot();
  for (let i = 0; i < 10; i++) rt.step();
  const after = rt.state.vars.stamina;
  rt.restore(snap);
  for (let i = 0; i < 10; i++) rt.step();
  assert.equal(rt.state.vars.stamina, after, 'its state lives in the snapshot');
  assert.ok(rt.availableOptions().some(o => o.actions.sprint), 'its verb is a player option for solvers');
});

test('the gate passes a sound experiment and reports what it measured', async () => {
  const r = await checkPrimitiveExperiment(exp(), { doc: manor() });
  assert.ok(r.ok, JSON.stringify(r.problems));
  assert.ok(r.report.deterministic && r.report.restoreExact);
  assert.ok(r.report.applied > 0 && r.report.frames > 0);
  assert.equal(r.report.verify.after, true, JSON.stringify(r.report));
});

test('the gate rejects broken experiments with stable codes', async () => {
  const doc = manor();
  const codes = async e => (await checkPrimitiveExperiment(e, { doc })).problems.map(p => p.code);
  assert.deepEqual(await codes(exp(STAMINA, card({ id: 'Stamina' }))), ['card_invalid']);
  assert.deepEqual(await codes(exp(STAMINA, card({ id: 'gameplay.inventory' }))), ['card_collision']);
  assert.ok((await codes(exp('export default { init() { return {}; }, step(s) { return { state: s, ops: [] }; } };'))).includes('no_effect'));
  assert.ok((await codes(exp('export default { init() { return {}; }, step(s) { return { state: s, ops: [{ do: "explode" }] }; } };'))).includes('bad_ops'));
  assert.ok((await codes(exp('export default { init() { return {}; }, step() { throw new Error("nope"); } };'))).includes('disabled'));
  assert.deepEqual(await codes(exp('import x from "fs"; export default {};')), ['load']);
  assert.ok((await codes(exp('export default { init() { return { n: Math.random() }; }, step(s) { return { state: s, ops: [] }; } };'))).includes('disabled'), 'Math.random is blocked');
  assert.deepEqual(cardProblems({ id: 'gameplay.x.y', intent: 'A mechanic for tests.', params: { r: { type: 'ref', to: 'item' } } }).map(p => p.code), ['card_invalid'], 'no refs in experiment params');
});

test('effects an experiment returns are validated against the registered vocabulary', () => {
  const { logic } = buildCatalogue();
  const r = cleanEffects([{ do: 'set_var', var: 'x', value: 1 }, { do: 'nope' }, 'junk', { do: 'emit', event: 'e' }], logic);
  assert.deepEqual(r.effects.map(e => e.do), ['set_var', 'emit']);
  assert.equal(r.dropped, 2);
});

test('generation: the code model sees the contract and the gate result, and repairs until the gate passes', async () => {
  const writer = fakeWriter([
    { label: 'Stamina', card: card(), code: 'export default { init() { return {}; }, step(s) { return { state: s, ops: [] }; } };', instance: { with: {} } },
    { label: 'Stamina', card: card(), code: STAMINA, instance: { with: { cost: 25 } } },
  ], { model: 'fake-coder' });
  const { experiment, report } = await generatePrimitiveExperiment({ writer, doc: manor(), request: 'a stamina meter for sprinting' });
  assert.ok(experiment.check.ok && report.ok);
  assert.equal(report.attempts.length, 2);
  assert.match(writer.calls[0].system, /set_var/, 'the effect vocabulary is in the contract');
  assert.match(writer.calls[1].user, /\[no_effect\]/, 'the repair round names the gate code');
  const svc = createPrimitiveExperimentService({ writer: fakeWriter([{ label: 'Stamina', card: card(), code: STAMINA }]) });
  const filled = await svc.fill({ doc: manor(), request: 'stamina' });
  assert.ok(filled.ok && filled.doc.systems.some(s => s.use === 'gameplay.exp.stamina'));
  assert.deepEqual(withoutExperiment(filled.doc, filled.experiment.id).systems, manor().systems, 'removal restores the document');
});

test('promotion target "primitive": scope, deliverables and the job-owned gate', async () => {
  const id = 'gameplay.exp.stamina', p = primitivePaths(id);
  assert.equal(p.primitive, 'v2/primitives/promoted/gameplay-exp-stamina.js');
  const cfg = resolveConfig();
  const scope = cfg.targets.primitive.scope;
  assert.ok(scopeCheck(goodPrimitiveChanges(id), scope, id, 'primitive').ok);
  assert.match(scopeCheck([{ path: 'v2/kernel/world.js', status: 'M' }], scope, id, 'primitive').problems.join('\n'), /outside the allowed paths/);
  const root = mkdtempSync(join(os.tmpdir(), 'gv-promote-'));
  const runner = createFakeRunner();
  const svc = createImprovementService({ root, runner, dataDir: join(root, 'jobs') });
  const doc = withExperiment(manor(), exp());
  const job = await svc.start({ target: 'primitive', experiment: doc.experiments[0], doc, gameId: 'manor', gameVersion: 3, registry: buildCatalogue().registry });
  const done = await svc.wait(job.id);
  assert.equal(done.state, 'succeeded', done.reason);
  assert.equal(done.primitiveId, id);
  const argv = runner.calls.exec.map(a => a.join(' '));
  assert.ok(argv.some(a => a.includes(`--test ${p.test}`)));
  assert.ok(argv.some(a => /check-primitive\.mjs --root .* --doc .*game\.json --primitive gameplay\.exp\.stamina/.test(a)), argv.join('\n'));
  assert.ok(existsSync(join(root, 'jobs', job.id, 'game.json')));
  assert.match(runner.calls.code[0].prompt, /native primitive 'gameplay\.exp\.stamina'/);
  await assert.rejects(svc.start({ target: 'primitive', experiment: { ...doc.experiments[0], card: { ...card(), id: 'gameplay.inventory' } }, doc, gameId: 'manor', registry: buildCatalogue().registry }), /already registered/);
});

test('the primitive gate script accepts a native port and rejects nondeterministic code', () => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const root = mkdtempSync(join(os.tmpdir(), 'gv-gate-'));
  mkdirSync(join(root, 'v2', 'primitives', 'promoted'), { recursive: true });
  for (const d of ['kernel', 'experiments', 'planner', 'server', 'verify']) symlinkSync(join(repo, 'v2', d), join(root, 'v2', d));
  for (const d of ['engine', 'plot', 'graphics', 'gameplay', 'index.js']) symlinkSync(join(repo, 'v2', 'primitives', d), join(root, 'v2', 'primitives', d));
  const native = ok => `export default {
  id: 'gameplay.exp.stamina',
  card: { intent: 'Stamina meter: sprinting spends it.', params: { cost: { type: 'number', default: 20, min: 1, max: 100 } }, provides: { actions: ['sprint'], vars: ['stamina'] } },
  install(rt, config) {
    rt.action('sprint', (v, rt) => { const s = rt.store('gameplay.exp.stamina'); s.pending = true; });
    rt.system('rules', rt => { const s = rt.store('gameplay.exp.stamina'); s.v ??= 100; if (s.pending) { s.v -= config.cost; s.pending = false; } else s.v = Math.min(100, s.v + 0.5); rt.state.vars.stamina = ${ok ? 's.v' : 's.v + (globalThis.__n = (globalThis.__n || 0) + 1)'}; });
  },
};`;
  const doc = join(root, 'game.json');
  writeFileSync(doc, JSON.stringify(withExperiment(manor(), exp())));
  writeFileSync(join(root, 'v2/primitives/promoted/index.js'), "import s from './gameplay-exp-stamina.js';\nexport default [s];\n");
  const run = () => { try { return { code: 0, out: execFileSync('node', [join(repo, 'v2/improve/check-primitive.mjs'), '--root', root, '--doc', doc, '--primitive', 'gameplay.exp.stamina'], { encoding: 'utf8' }) }; } catch (e) { return { code: e.status, out: e.stdout }; } };
  writeFileSync(join(root, 'v2/primitives/promoted/gameplay-exp-stamina.js'), native(true));
  const good = run();
  assert.equal(good.code, 0, good.out);
  assert.ok(JSON.parse(good.out).deterministic);
  writeFileSync(join(root, 'v2/primitives/promoted/gameplay-exp-stamina.js'), native(false));
  const bad = run();
  assert.equal(bad.code, 1);
  assert.match(bad.out, /different states|restoring a snapshot/);
});
