import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareProvider } from '../scripts/improvement-provider.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'provider-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = resolve(root, 'source'), target = resolve(root, 'target');
  await mkdir(source); await mkdir(target); await writeFile(resolve(source, 'evidence.json'), '{}');
  return { source, target, manifest: { schema: 'gameverse.improvement-provider-pack/1', files: [{ path: 'evidence.json', sha256: sha('{}'), bytes: 2 }] } };
}
test('validates the complete provider before an explicit immutable install', async t => {
  const f = await fixture(t);
  assert.equal((await prepareProvider(f)).status, 'validated');
  await assert.rejects(readFile(resolve(f.target, 'evidence.json')), { code: 'ENOENT' });
  assert.equal((await prepareProvider({ ...f, install: true })).copied, 1);
  assert.equal((await prepareProvider({ ...f, install: true })).copied, 0);
  await writeFile(resolve(f.target, 'evidence.json'), 'changed');
  await assert.rejects(prepareProvider({ ...f, install: true }), /target differs/);
});
test('rejects stale sources, traversal and symlink escapes before writes', async t => {
  const f = await fixture(t);
  f.manifest.files.push({ path: 'missing', sha256: sha('') });
  await assert.rejects(prepareProvider({ ...f, install: true }), { code: 'ENOENT' });
  await assert.rejects(readFile(resolve(f.target, 'evidence.json')), { code: 'ENOENT' });
  f.manifest.files = [{ path: '../escape', sha256: sha('') }];
  await assert.rejects(prepareProvider(f), /Invalid/);
  await symlink(f.source, resolve(f.target, 'link'));
  f.manifest.files = [{ path: 'link/evidence.json', sha256: sha('{}') }];
  await mkdir(resolve(f.source, 'link')); await writeFile(resolve(f.source, 'link/evidence.json'), '{}');
  await assert.rejects(prepareProvider(f), /escapes root/);
});

test('checkout-owned matching runtime files need no duplicate in the private source pack', async t => {
  const f = await fixture(t);
  await writeFile(resolve(f.target, 'runtime.py'), 'project runtime');
  f.manifest.files.push({ path: 'runtime.py', sha256: sha('project runtime') });
  const result = await prepareProvider({ ...f, install: true });
  assert.equal(result.files, 2); assert.equal(result.copied, 1);
  assert.equal(await readFile(resolve(f.target, 'runtime.py'), 'utf8'), 'project runtime');
});
