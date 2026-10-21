// The primitive target's catalogue conformance (v2/improve/conformance.js, check-primitive.mjs --conformance): the
// listed catalogue-wide tests read the live catalogue, so a candidate in v2/primitives/promoted/ is held to them; the
// job runs them as its own verification command; a failing entry fails the check and names itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import { CATALOGUE_CONFORMANCE, conformanceArgv } from '../v2/improve/conformance.js';
import { resolveConfig } from '../v2/improve/config.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const checker = join(repo, 'v2/improve/check-primitive.mjs');
const tmp = mkdtempSync(join(os.tmpdir(), 'gv-conformance-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
// The checker and the tests it runs are their own test runs, not children of this one.
const { NODE_TEST_CONTEXT, ...env } = process.env;
const gate = root => { try { return { code: 0, out: JSON.parse(execFileSync('node', [checker, '--root', root, '--conformance'], { encoding: 'utf8', env })) }; } catch (e) { return { code: e.status, out: JSON.parse(e.stdout) }; } };

test('the list: every entry exists and builds the live catalogue (or scans v2/primitives, promoted included)', () => {
  assert.ok(CATALOGUE_CONFORMANCE.length >= 4);
  for (const e of CATALOGUE_CONFORMANCE) {
    const text = readFileSync(join(repo, e.file), 'utf8');
    assert.ok(/liveCatalogue\(/.test(text) || /'v2\/primitives'/.test(text), `${e.file}: reads the live catalogue`);
    assert.ok(!/buildCatalogue\(\)/.test(text), `${e.file}: never the registered primitives alone`);
    if (e.name) assert.ok(text.includes(e.name.replace(/^\^/, '').replace(/\\/g, '')), `${e.file}: a test named ${e.name}`);
  }
  assert.deepEqual(conformanceArgv({ file: 'a.test.js', name: '^x' }), ['--test', '--test-name-pattern', '^x', 'a.test.js']);
});

test('the job runs it: the primitive target verifies conformance with the checker, under its own configured limit', () => {
  const cfg = resolveConfig();
  const cmd = cfg.targets.primitive.verification.find(c => c.id === 'conformance');
  assert.deepEqual(cmd.argv, ['node', '{primitiveChecker}', '--root', '{workdir}', '--conformance']);
  assert.ok(cfg.limits[cmd.timeoutLimit] > 0);
  assert.throws(() => resolveConfig({ limits: { conformanceTimeoutMs: 0 } }), /conformanceTimeoutMs/);
});

test('check-primitive --conformance: runs every entry in the worktree; a failing one fails the check and is named', () => {
  const root = join(tmp, 'stubs');
  const stub = (file, body) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), `import test from 'node:test';\n${body}\n`); };
  for (const e of CATALOGUE_CONFORMANCE) stub(e.file, "test('stub passes', () => {});");
  const named = CATALOGUE_CONFORMANCE.find(e => e.name);
  stub(named.file, `test(${JSON.stringify(named.name.replace(/^\^/, '').replace(/\\/g, ''))}, () => {});\ntest('another test in the file', () => { throw Error('not run'); });`);
  const good = gate(root);
  assert.equal(good.code, 0, JSON.stringify(good.out));
  assert.deepEqual(good.out.conformance.map(c => [c.file, c.ok]), CATALOGUE_CONFORMANCE.map(e => [e.file, true]), 'the name pattern runs only the catalogue-wide test');
  stub(CATALOGUE_CONFORMANCE[1].file, "test('loops', () => { throw Error('a promoted card breaks it'); });");
  const bad = gate(root);
  assert.equal(bad.code, 1);
  assert.equal(bad.out.ok, false);
  assert.match(bad.out.problems.join('\n'), new RegExp(CATALOGUE_CONFORMANCE[1].file.replace(/[.]/g, '\\.')));
});

test('a candidate in v2/primitives/promoted/ is part of the catalogue the conformance tests check', () => {
  // A copy of the code the tests load (symlinks would resolve to this checkout and its own promoted directory).
  const root = join(tmp, 'copy');
  for (const d of ['kernel', 'planner', 'primitives', 'verify', 'server', 'templates', 'experiments', 'art']) if (existsSync(join(repo, 'v2', d))) cpSync(join(repo, 'v2', d), join(root, 'v2', d), { recursive: true });
  cpSync(join(repo, 'v2/PRIMITIVE_CATALOG.md'), join(root, 'v2/PRIMITIVE_CATALOG.md'));
  const entry = CATALOGUE_CONFORMANCE.find(e => e.file.endsWith('modes-bots.test.js'));
  cpSync(join(repo, entry.file), join(root, entry.file));
  for (const f of ['package.json']) cpSync(join(repo, f), join(root, f));
  const run = () => spawnSync(process.execPath, conformanceArgv(entry), { cwd: root, encoding: 'utf8', env });
  rmSync(join(root, 'v2/primitives/promoted'), { recursive: true, force: true });
  const clean = run();
  assert.equal(clean.status, 0, clean.stdout.slice(-1500));
  mkdirSync(join(root, 'v2/primitives/promoted'), { recursive: true });
  writeFileSync(join(root, 'v2/primitives/promoted/index.js'), `export default [{ id: 'gameplay.contract.moded', card: { intent: 'Test candidate that declares a game mode with no bot and no document.', params: {}, mode: { loop: 'contract-mode' } }, install() {} }];\n`);
  const withCandidate = run();
  assert.notEqual(withCandidate.status, 0, 'the candidate is checked');
  assert.match(withCandidate.stdout, /contract-mode|gameplay\.contract\.moded/);
});
