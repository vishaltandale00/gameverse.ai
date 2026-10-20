import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readRegisteredPrefab } from '../scripts/prefab-manifest.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
test('registered prefab requires exact graph/receipt hashes and delivery-local research paths', async () => {
 const root = await mkdtemp(resolve(tmpdir(), 'gv-manifest-'));
 try {
  await mkdir(resolve(root, 'ontology/game-system-prefabs'), { recursive: true }); await mkdir(resolve(root, 'research/game'), { recursive: true });
  const graph = JSON.stringify({ schema: 'gameverse.mechanic-assembly/0.1' }), receipt = JSON.stringify({ valid: true });
  await writeFile(resolve(root, 'research/game/test.assembly.json'), graph); await writeFile(resolve(root, 'research/game/test.validation.json'), receipt);
  const row = { id: 'game.example', path: 'research/game/test.assembly.json', sha256: sha(graph), validation: 'research/game/test.validation.json', validationSha256: sha(receipt), descriptorRef: 'research/game/delivery.json' };
  const save = async value => writeFile(resolve(root, 'ontology/game-system-prefabs/manifest.json'), JSON.stringify({ schema: 'gameverse.prefab-allowlist/1', prefabs: [value] }));
  await save(row); assert.equal((await readRegisteredPrefab(root, row.id)).source.sha256, sha(graph)); assert.equal(await readRegisteredPrefab(root, 'unregistered'), null);
  for (const patch of [{ sha256: '0'.repeat(64) }, { validationSha256: '0'.repeat(64) }, { path: 'research/game/../game/test.assembly.json' }, { path: '/tmp/test.assembly.json' }, { validation: 'research/other/test.validation.json' }, { descriptorRef: 'local/ir/delivery.json' }]) { await save({ ...row, ...patch }); await assert.rejects(readRegisteredPrefab(root, row.id)); }
  await symlink(resolve(root, 'research/game/test.assembly.json'), resolve(root, 'research/game/link.assembly.json')); await save({ ...row, path: 'research/game/link.assembly.json' }); await assert.rejects(readRegisteredPrefab(root, row.id));
  const failed = JSON.stringify({ valid: false }); await writeFile(resolve(root, row.validation), failed); await save({ ...row, validationSha256: sha(failed) }); await assert.rejects(readRegisteredPrefab(root, row.id));
 } finally { await rm(root, { recursive: true, force: true }); }
});

test('immutable central descriptors require filename hash and exact prefab membership', async () => {
 const root = await mkdtemp(resolve(tmpdir(), 'gv-snapshot-'));
 try {
  const central = resolve(root, 'ontology/game-system-prefabs'); await mkdir(resolve(central, 'delivery-snapshots'), { recursive: true }); await mkdir(resolve(root, 'research/game'), { recursive: true });
  const graph = JSON.stringify({ schema: 'gameverse.mechanic-assembly/0.1' }), receipt = JSON.stringify({ valid: true });
  await writeFile(resolve(root, 'research/game/phase.assembly.json'), graph); await writeFile(resolve(root, 'research/game/phase.validation.json'), receipt);
  const entry = { id: 'game.phase', path: 'research/game/phase.assembly.json', sha256: sha(graph), validation: 'research/game/phase.validation.json', validationSha256: sha(receipt) };
  const snapshot = JSON.stringify({ prefabs: [entry] }), ref = `ontology/game-system-prefabs/delivery-snapshots/${sha(snapshot)}.json`;
  await writeFile(resolve(root, ref), snapshot);
  const save = async descriptorRef => writeFile(resolve(central, 'manifest.json'), JSON.stringify({ schema: 'gameverse.prefab-allowlist/1', prefabs: [{ ...entry, descriptorRef }] }));
  await save(ref); assert.equal((await readRegisteredPrefab(root, entry.id)).registration.descriptorRef, ref);
  await writeFile(resolve(root, ref), snapshot + ' '); await assert.rejects(readRegisteredPrefab(root, entry.id));
  const unrelated = JSON.stringify({ prefabs: [] }), other = `ontology/game-system-prefabs/delivery-snapshots/${sha(unrelated)}.json`; await writeFile(resolve(root, other), unrelated); await save(other); await assert.rejects(readRegisteredPrefab(root, entry.id));
  await save('ontology/game-system-prefabs/other.json'); await assert.rejects(readRegisteredPrefab(root, entry.id));
 } finally { await rm(root, { recursive: true, force: true }); }
});
