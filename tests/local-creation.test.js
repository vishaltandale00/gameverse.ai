import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveMashupRuntime, importMashupRuntime, capturedBaseline } from '../scripts/import-mashup-runtime.mjs';
test('runtime selection preserves explicit errors and prefers installed runtime over captures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gameverse-runtime-resolver-'));
  try {
    const capture = join(root, capturedBaseline); await mkdir(capture, { recursive: true }); await writeFile(join(capture,'composition.lock.json'),'{}');
    assert.equal((await resolveMashupRuntime({ appRoot: root, env: {} })).source, 'current checkout');
    await mkdir(join(root,'local-data/mashup-runtime'), { recursive: true });
    assert.equal((await resolveMashupRuntime({ appRoot: root, env: {} })).source, 'installed local runtime');
    const explicit = join(root,'missing-explicit-runtime');
    assert.equal((await resolveMashupRuntime({ appRoot: root, env: { GAMEVERSE_MASHUP_RUNTIME_ROOT: explicit } })).path, explicit);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('importer refuses to replace an existing installation', async () => {
  const root = await mkdtemp(join(tmpdir(),'gameverse-runtime-existing-'));
  try { await assert.rejects(importMashupRuntime({ source: root, destination: root }), /already exists/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
