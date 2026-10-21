#!/usr/bin/env node
// Host-owned gate for a promoted primitive, run by the job in the job's worktree (never by the agent):
//   node v2/improve/check-primitive.mjs --root <worktree> --doc <game.json> --primitive <id>
// - v2/primitives/promoted/index.js registers a native primitive with that id (no experimental flag);
// - its source uses no wall clock, Math.random, timers, network, dynamic imports, kits or the 2D engine;
// - the original game, with the native primitive in place of the experiment, preflights, plays 600
//   scripted frames without throwing, replays deterministically and restores snapshots exactly.
//   node v2/improve/check-primitive.mjs --root <worktree> --conformance
// - the catalogue conformance tests (v2/improve/conformance.js) pass in the worktree, the candidate included.
// Prints one JSON line and exits 1 on any failure.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const root = resolve(arg('root') || '.'), docFile = arg('doc'), id = arg('primitive');
const problems = [];
const load = rel => import(pathToFileURL(join(root, rel)).href);
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const done = extra => { console.log(JSON.stringify({ ok: !problems.length, primitive: id, problems, ...extra })); process.exit(problems.length ? 1 : 0); };

// --conformance: the catalogue conformance tests (./conformance.js, the host's list) run in the worktree, where the
// candidate sits in v2/primitives/promoted/ and so is part of the live catalogue those tests build.
if (process.argv.includes('--conformance')) {
  const { CATALOGUE_CONFORMANCE, conformanceArgv } = await import('./conformance.js');
  const { spawnSync } = await import('node:child_process');
  // Each entry is its own test run (never a child of a test runner that started this checker).
  const { NODE_TEST_CONTEXT, ...inherited } = process.env, env = { ...inherited, NO_COLOR: '1' };
  const conformance = CATALOGUE_CONFORMANCE.map(entry => {
    const t0 = performance.now();
    const r = spawnSync(process.execPath, conformanceArgv(entry), { cwd: root, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
    const ok = r.status === 0;
    if (!ok) problems.push(`conformance ${entry.file}${entry.name ? ` (${entry.name})` : ''} failed: ${String(r.stdout || r.error?.message || '').split('\n').filter(l => /^not ok|^# fail|Error|assert/i.test(l.trim())).slice(0, 8).join(' | ').slice(0, 800)}`);
    return { file: entry.file, name: entry.name ?? null, ok, ms: Math.round(performance.now() - t0) };
  });
  done({ conformance });
}
if (!id || !docFile) { problems.push('usage: --root <dir> --doc <game.json> --primitive <id> | --root <dir> --conformance'); done(); }
const slug = id.replace(/\./g, '-');
let source = '';
try { source = readFileSync(join(root, `v2/primitives/promoted/${slug}.js`), 'utf8'); } catch { problems.push(`missing v2/primitives/promoted/${slug}.js`); done(); }
for (const [re, why] of [[/Math\.random/, 'Math.random'], [/\bDate\b/, 'Date'], [/\bperformance\b/, 'performance'], [/set(Timeout|Interval)/, 'timers'], [/\bfetch\s*\(/, 'network'], [/\bimport\s*\(/, 'dynamic import'], [/from\s+['"][^'"]*\/(kits|engine)\//, 'imports from v2/kits or v2/engine']])
  if (re.test(source)) problems.push(`the primitive source uses ${why}`);

const [{ PRIMITIVES }, promoted, { Registry }, { Logic }, { buildLogic, createWorld }, { preflight }] = await Promise.all([
  load('v2/primitives/index.js'), load('v2/primitives/promoted/index.js').catch(e => ({ default: [], error: e })), load('v2/kernel/registry.js'), load('v2/kernel/logic.js'), load('v2/kernel/world.js'), load('v2/kernel/document.js')]);
if (promoted.error) { problems.push(`v2/primitives/promoted/index.js does not load: ${promoted.error.message}`); done(); }
const list = promoted.default || [];
const native = list.find(p => p.id === id);
if (!native) { problems.push(`v2/primitives/promoted/index.js does not register '${id}'`); done(); }
if (native.card?.experimental) problems.push('the native card still carries experimental: true');
if (typeof native.install !== 'function') problems.push('the primitive has no install()');

const doc = JSON.parse(readFileSync(resolve(docFile), 'utf8'));
const others = (doc.experiments || []).filter(e => e.card?.id !== id);
let hosted = [];
if (others.length) {
  const [{ experimentPrimitives }, { loadPureVm }] = await Promise.all([load('v2/experiments/primitive-host.js'), load('v2/experiments/vm-pure.js')]);
  hosted = experimentPrimitives({ experiments: others }, code => loadPureVm(code));
}
const nativeDoc = { ...doc, experiments: others };
if (!(nativeDoc.systems || []).some(s => s.use === id)) nativeDoc.systems = [...(nativeDoc.systems || []), { use: id }];
let registry;
try {
  const ids = new Set(PRIMITIVES.map(p => p.id));
  registry = new Registry([...PRIMITIVES, ...list.filter(p => !ids.has(p.id)), ...hosted]);
} catch (error) { problems.push(`the registry refuses it: ${error.message}`); done(); }
const logic = buildLogic(registry, Logic);
const pre = preflight(nativeDoc, registry, logic);
if (!pre.ok) { problems.push(...pre.errors.slice(0, 6).map(e => `preflight ${e.code} ${e.path}: ${e.message}`)); done(); }
const actions = native.card?.provides?.actions || [];
const input = (rt, i) => actions.length && i % 7 === 3 ? { actions: { [actions[(i / 7 | 0) % actions.length]]: true } } : i % 23 === 11 ? (opts => opts.length ? { actions: opts[(i / 23 | 0) % opts.length].actions } : {})(rt.availableOptions().filter(o => o.actions)) : { axes: { move: [Math.sin(i / 30), Math.cos(i / 45)] } };
const play = (frames, snapAt = null) => {
  const rt = createWorld(pre.doc, registry, logic, { seed: doc.seed });
  let snap = null, i = 0;
  for (; i < frames && rt.state.status === 'playing'; i++) { if (i === snapAt) snap = rt.snapshot(); rt.step(input(rt, i)); }
  return { rt, snap, frames: i };
};
let a, b;
try { a = play(600, 300); b = play(600); }
catch (error) { problems.push(`the game threw with the native primitive: ${String(error?.message || error).slice(0, 200)}`); done(); }
const deterministic = hash(a.rt.snapshot()) === hash(b.rt.snapshot());
if (!deterministic) problems.push('two runs with the same seed and inputs ended in different states');
let restoreExact = null;
if (a.snap) {
  const rt = createWorld(pre.doc, registry, logic, { seed: doc.seed });
  rt.restore(a.snap);
  for (let i = 300; i < a.frames && rt.state.status === 'playing'; i++) rt.step(input(rt, i));
  restoreExact = hash(rt.snapshot()) === hash(a.rt.snapshot());
  if (!restoreExact) problems.push('restoring a snapshot and replaying did not reach the same state');
}
done({ frames: a.frames, deterministic, restoreExact });
