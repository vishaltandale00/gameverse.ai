// Only a server-owned, explicitly registered manifest can introduce graph paths.
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,191}$/.test(value);
const snapshotRef = value => typeof value === 'string' && /^ontology\/game-system-prefabs\/delivery-snapshots\/[a-f0-9]{64}\.json$/.test(value);
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function sourceRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('research/') || !ref.endsWith('.json') || ref.includes('\\') || ref.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Invalid registered source reference.');
  return ref;
}
async function boundedSource(root, ref, maximum) {
  const canonicalRoot = await realpath(root), expected = resolve(canonicalRoot, ref), actual = await realpath(expected);
  if (actual !== expected || !actual.startsWith(canonicalRoot + sep) || (await stat(actual)).size > maximum) throw Error('Invalid registered source file.');
  return readFile(actual);
}
export async function readRegisteredPrefab(root, id) {
  if (!identity(id)) return null;
  let bytes;
  try { bytes = await boundedSource(root, 'ontology/game-system-prefabs/manifest.json', 1024 * 1024); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 'gameverse.prefab-allowlist/1' || !Array.isArray(manifest.prefabs) || manifest.prefabs.length > 512) throw Error('Invalid registered prefab manifest.');
  const entries = manifest.prefabs.filter(row => row?.id === id);
  if (!entries.length) return null;
  if (entries.length !== 1) throw Error('Ambiguous registered prefab identity.');
  const row = entries[0], graphRef = sourceRef(row.path), receiptRef = sourceRef(row.validation), descriptorRef = snapshotRef(row.descriptorRef) ? row.descriptorRef : sourceRef(row.descriptorRef);
  if (!sha256(row.sha256) || !sha256(row.validationSha256) || !graphRef.endsWith('.assembly.json') || dirname(graphRef) !== dirname(receiptRef) || (!snapshotRef(descriptorRef) && dirname(graphRef) !== dirname(descriptorRef))) throw Error('Invalid registered prefab artifact identities.');
  if (snapshotRef(descriptorRef)) {
    const descriptorBytes = await boundedSource(root, descriptorRef, 4 * 1024 * 1024);
    if (hash(descriptorBytes) !== descriptorRef.slice(-69, -5)) throw Error('Registered delivery snapshot changed.');
    const descriptor = JSON.parse(descriptorBytes);
    if (!Array.isArray(descriptor.prefabs) || !descriptor.prefabs.some(prefab => prefab.id === id && prefab.path === graphRef && prefab.sha256 === row.sha256 && prefab.validation === receiptRef && prefab.validationSha256 === row.validationSha256)) throw Error('Prefab does not belong to its delivery snapshot.');
  }
  const graphBytes = await boundedSource(root, graphRef, 256 * 1024), receiptBytes = await boundedSource(root, receiptRef, 4 * 1024 * 1024);
  if (hash(graphBytes) !== row.sha256 || hash(receiptBytes) !== row.validationSha256) throw Error('Registered prefab artifacts changed.');
  const receipt = JSON.parse(receiptBytes);
  if (receipt.valid !== true) throw Error('Registered prefab lacks retained binding admission.');
  return { graph: JSON.parse(graphBytes), source: { ref: graphRef, sha256: row.sha256, validationRef: receiptRef, validationSha256: row.validationSha256, manifestSha256: hash(bytes) }, registration: { id, gameId: row.gameId, moduleId: row.moduleId, descriptorRef, scope: row.scope } };
}
