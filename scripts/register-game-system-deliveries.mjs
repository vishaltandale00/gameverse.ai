#!/usr/bin/env node
// Register explicitly named, source-scoped deliveries after bounded binding checks.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, unlinkSync, linkSync, existsSync, realpathSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const outputDir = resolve(root, 'ontology/game-system-prefabs');
const registryPath = resolve(outputDir, 'deliveries.json');
const manifestPath = resolve(outputDir, 'manifest.json');
const proofDir = resolve(outputDir, 'registration-proofs');
const snapshotDir = resolve(outputDir, 'delivery-snapshots');
const modulePath = resolve(root, 'src/game-system-fleet-deliveries.js');
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/recovered-prefab-delivery.json')));
const blueprintRoles = contract.blueprints;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const unique = (values, label) => { if (new Set(values).size !== values.length) fail(`Duplicate ${label}.`); };
const expect = (condition, message) => { if (!condition) fail(message); };
const under = (base, path) => path === base || path.startsWith(`${base}${sep}`);
export const snapshotRef = digest => `ontology/game-system-prefabs/delivery-snapshots/${digest}.json`;

function safeRef(ref, label, { mustExist = true } = {}) {
  expect(nonempty(ref) && !isAbsolute(ref) && !ref.includes('\\') && !ref.split('/').some(part => !part || part === '.' || part === '..'), `Unsafe ${label}: ${ref}`);
  const full = resolve(root, ref);
  expect(under(root, full), `Outside repository: ${label}`);
  if (mustExist) {
    expect(existsSync(full), `Missing ${label}: ${ref}`);
    expect(realpathSync(full) === full, `Symlink in ${label}: ${ref}`);
  }
  return full;
}
function refArray(values, label) {
  expect(Array.isArray(values), `${label} must be an array.`);
  for (const ref of values) safeRef(ref, label);
}
function readJson(ref, label) { return JSON.parse(readFileSync(safeRef(ref, label), 'utf8')); }
function assemblyDescriptors(bundle) {
  const lists = [bundle.recoveredAssemblies, bundle.assemblyVariants].filter(value => value !== undefined);
  for (const list of lists) expect(Array.isArray(list), `Assembly variants must be arrays: ${bundle.id}`);
  return [bundle.recoveredAssembly, ...lists.flat()].filter(Boolean);
}
function validateCore(delivery, acceptedIds) {
  const core = delivery.coreLoop;
  expect(object(core) && nonempty(core.playerOutcome) && core.wholeGameReady === false, 'Core loop must describe an unqualified whole game.');
  expect(Array.isArray(core.phases) && core.phases.length > 0 && Array.isArray(core.edges) && Array.isArray(core.missingForCoreGame) && core.missingForCoreGame.length > 0, 'Incomplete core loop.');
  const phaseIds = core.phases.map(phase => phase.id);
  unique(phaseIds, 'core phase ID');
  for (const phase of core.phases) {
    expect(nonempty(phase.id) && nonempty(phase.label) && ['usable-prefab', 'source-only', 'missing', 'internal-consumed'].includes(phase.status), `Invalid core phase ${phase.id}`);
    expect(Array.isArray(phase.prefabIds) && Array.isArray(phase.requiredServices) && Array.isArray(phase.gaps), `Incomplete core phase ${phase.id}`);
    refArray(phase.sourceRefs, `phase ${phase.id} sourceRefs`);
    for (const id of phase.prefabIds) expect(acceptedIds.has(id), `Core phase ${phase.id} names unaccepted prefab ${id}`);
    expect(phase.status === 'usable-prefab' ? phase.prefabIds.length > 0 : phase.prefabIds.length === 0, `Core phase ${phase.id} status conflicts with prefab IDs.`);
    if (phase.status === 'internal-consumed') {
      expect(Array.isArray(phase.parentPrefabIds) && phase.parentPrefabIds.length > 0, `Internal phase ${phase.id} needs accepted parentPrefabIds.`);
      for (const id of phase.parentPrefabIds) expect(acceptedIds.has(id), `Internal phase ${phase.id} names unaccepted parent ${id}`);
    }
  }
  for (const edge of core.edges) expect(phaseIds.includes(edge.from) && phaseIds.includes(edge.to) && ['source-call', 'shared-state', 'event', 'host-required'].includes(edge.kind) && nonempty(edge.scope), 'Invalid core-loop edge.');
}
function validateReceipt(prefab) {
  const graphBytes = readFileSync(safeRef(prefab.path, `graph ${prefab.id}`));
  expect(sha(graphBytes) === prefab.sha256, `Graph SHA mismatch: ${prefab.id}`);
  const receiptBytes = readFileSync(safeRef(prefab.validation, `receipt ${prefab.id}`));
  expect(sha(receiptBytes) === prefab.validationSha256, `Receipt SHA mismatch: ${prefab.id}`);
  const graph = JSON.parse(graphBytes), receipt = JSON.parse(receiptBytes);
  expect(graph.schema === 'gameverse.mechanic-assembly/0.1', `Wrong graph schema: ${prefab.id}`);
  expect(receipt.schema === 'gameverse.mechanic-assembly-validation/0.1' && receipt.valid === true && Array.isArray(receipt.errors) && receipt.errors.length === 0, `Invalid validation receipt: ${prefab.id}`);
  const scratch = mkdtempSync(resolve(tmpdir(), 'gameverse-prefab-intake-'));
  try {
    const out = resolve(scratch, 'validation.json');
    execFileSync('python3', ['-B', resolve(root, 'tools/behavior_ir/assembly.py'), '--request', safeRef(prefab.path, 'graph'), '--out', out], { cwd: root, timeout: 10000, maxBuffer: 128 * 1024 });
    const currentBytes = readFileSync(out);
    const current = JSON.parse(currentBytes);
    expect(current.valid === true, `Current Composer rejects ${prefab.id}: ${JSON.stringify(current.errors)}`);
    expect(current.request_sha256 === receipt.request_sha256, `Receipt is for another graph: ${prefab.id}`);
    const composeSha256 = sha(readFileSync(resolve(root, 'tools/behavior_ir/compose.py')));
    const proofKey = sha(Buffer.from([prefab.sha256, current.validator_sha256, composeSha256, current.catalog_sha256].join('\n')));
    const currentReceiptRef = `ontology/game-system-prefabs/registration-proofs/${proofKey}.json`;
    const currentInterfacePins = Object.fromEntries(Object.entries(current.interfaces || {}).map(([id, item]) => [id, {
      packageId: item.package_id,
      packageSha256: item.package_sha256,
      behaviorSha256: item.behavior_sha256,
    }]));
    return { check: {
      receiptValidatorSha256: receipt.validator_sha256 || null,
      currentValidatorSha256: current.validator_sha256 || null,
      receiptCatalogSha256: receipt.catalog_sha256 || null,
      currentCatalogSha256: current.catalog_sha256 || null,
      composeSha256,
      statementSha256: current.statement_sha256 || null,
      currentInterfacePins,
      currentReceiptRef,
      currentReceiptSha256: sha(currentBytes),
    }, proof: { ref: currentReceiptRef, bytes: currentBytes, graphSha256: prefab.sha256, requestSha256: current.request_sha256, validatorSha256: current.validator_sha256, catalogSha256: current.catalog_sha256, composeSha256 } };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
function validateDelivery(ref) {
  expect(/\/delivery(?:-[A-Za-z0-9_-]+)?\.json$/.test(ref), `--delivery must name a delivery JSON revision: ${ref}`);
  expect(ref.startsWith('research/deep-extraction/') || ref.startsWith('research/ir-workshop/'), `Delivery outside worker research directories: ${ref}`);
  const bytes = readFileSync(safeRef(ref, 'delivery'));
  const delivery = JSON.parse(bytes);
  expect(delivery.schema === 'gameverse.game-prefab-delivery/1' && nonempty(delivery.gameId), `Invalid delivery: ${ref}`);
  expect(Array.isArray(delivery.blueprintIds) && delivery.blueprintIds.length > 0 && Array.isArray(delivery.bundles) && Array.isArray(delivery.prefabs), `Incomplete delivery: ${ref}`);
  unique(delivery.blueprintIds, 'blueprint ID');
  for (const id of delivery.blueprintIds) expect(blueprintRoles[id], `Unknown blueprint ${id}`);
  expect(object(delivery.timing) && nonempty(delivery.timing.runId) && nonempty(delivery.timing.sourceCommit) && nonempty(delivery.timing.environment) && nonempty(delivery.timing.accounting) && Object.hasOwn(delivery.timing, 'totalSeconds'), `Missing timing context: ${ref}`);
  const deliveryDirectory = ref.slice(0, ref.lastIndexOf('/') + 1);
  const revisionSuffix = ref.slice(ref.lastIndexOf('/') + 1).slice('delivery'.length);
  const allowRef = deliveryDirectory + 'prefab-allowlist' + revisionSuffix;
  const allow = readJson(allowRef, 'worker allowlist');
  expect(allow.schema === 'gameverse.prefab-allowlist/1' && Array.isArray(allow.prefabs), `Invalid worker allowlist: ${allowRef}`);
  unique(delivery.prefabs.map(prefab => prefab.id), 'prefab ID');
  unique(delivery.bundles.map(bundle => bundle.id), 'bundle ID');
  expect(allow.prefabs.length === delivery.prefabs.length, `Allowlist count mismatch: ${ref}`);
  const allowById = new Map(allow.prefabs.map(item => [item.id, item]));
  expect(allowById.size === allow.prefabs.length, `Duplicate worker allowlist ID: ${ref}`);
  const bundleByModule = new Map();
  for (const bundle of delivery.bundles) {
    expect(nonempty(bundle.id) && nonempty(bundle.label) && nonempty(bundle.moduleId) && bundle.sourceGame === delivery.gameId && Array.isArray(bundle.planIds) && bundle.planIds.length > 0, `Invalid bundle identity: ${bundle.id}`);
    expect(!bundleByModule.has(bundle.moduleId), `Duplicate physical module identity: ${bundle.moduleId}`);
    bundleByModule.set(bundle.moduleId, bundle);
    expect(nonempty(bundle.sourceSystemId) || nonempty(bundle.sourceContractRef), `Missing source lineage: ${bundle.id}`);
    if (bundle.sourceContractRef) safeRef(bundle.sourceContractRef, `bundle ${bundle.id} sourceContractRef`);
    expect(['published-subset', 'source-only'].includes(bundle.availability) && nonempty(bundle.scope) && Array.isArray(bundle.gaps) && Array.isArray(bundle.evidence) && object(bundle.canonicalState) && nonempty(bundle.canonicalState.identity) && nonempty(bundle.canonicalState.aliasRule), `Incomplete bundle: ${bundle.id}`);
    refArray(bundle.evidence, `bundle ${bundle.id} evidence`);
    expect(Array.isArray(bundle.roleFacets) && bundle.roleFacets.length > 0, `No role facets: ${bundle.id}`);
    for (const planId of bundle.planIds) expect(delivery.blueprintIds.includes(planId), `Undeclared bundle blueprint: ${planId}`);
    unique(bundle.roleFacets.map(facet => facet.roleId), `role facet in ${bundle.id}`);
    for (const facet of bundle.roleFacets) {
      expect(bundle.planIds.some(planId => blueprintRoles[planId].includes(facet.roleId)), `Role ${facet.roleId} outside bundle blueprint scopes.`);
      expect(nonempty(facet.capability) && nonempty(facet.scope) && ['published-subset', 'source-only', 'missing'].includes(facet.status), `Invalid role facet: ${bundle.id}/${facet.roleId}`);
      refArray(facet.evidence, `facet ${bundle.id}/${facet.roleId} evidence`);
    }
    for (const assembly of assemblyDescriptors(bundle)) {
      expect(nonempty(assembly.id) && assembly.descriptorRef === ref, `Recovered assembly descriptor mismatch: ${bundle.id}`);
    }
  }
  const validationChecks = [], proofs = [];
  for (const prefab of delivery.prefabs) {
    expect(nonempty(prefab.id) && nonempty(prefab.label) && nonempty(prefab.moduleId) && /^[a-f0-9]{64}$/.test(prefab.sha256) && /^[a-f0-9]{64}$/.test(prefab.validationSha256), `Invalid prefab: ${prefab.id}`);
    const bundle = bundleByModule.get(prefab.moduleId);
    const matching = bundle && assemblyDescriptors(bundle).filter(assembly => assembly.id === prefab.id);
    expect(bundle && bundle.availability === 'published-subset' && matching.length > 0, `Prefab ${prefab.id} has no matching published bundle.`);
    expect(matching.every(assembly => assembly.assemblyRef === prefab.path && assembly.validationRef === prefab.validation), `Bundle graph refs differ: ${prefab.id}`);
    const allowed = allowById.get(prefab.id);
    expect(allowed && allowed.path === prefab.path && allowed.sha256 === prefab.sha256 && allowed.validation === prefab.validation, `Worker allowlist differs: ${prefab.id}`);
    const segments = ref.split('/');
    const privateIndex = segments.findIndex(part => ['prefab-pass', 'prefab-reconstruction', 'system-prefab'].includes(part));
    const sourceIndex = segments.indexOf('source-game-prefabs');
    const privateRoot = privateIndex >= 0 ? segments.slice(0, privateIndex + 1).join('/') + '/' : sourceIndex >= 0 ? segments.slice(0, sourceIndex + 2).join('/') + '/' : deliveryDirectory;
    expect(prefab.path.startsWith(privateRoot) && prefab.validation.startsWith(privateRoot), `Prefab files leave private game delivery directory: ${prefab.id}`);
    expect(Array.isArray(prefab.inputs) && Array.isArray(prefab.outputs) && prefab.outputs.length > 0 && Array.isArray(prefab.phases) && prefab.phases.length > 0 && Array.isArray(prefab.requiredServices) && Array.isArray(prefab.gaps) && nonempty(prefab.qualificationScope), `Incomplete prefab: ${prefab.id}`);
    refArray(prefab.sourceRefs, `prefab ${prefab.id} sourceRefs`);
    const checked = validateReceipt(prefab);
    validationChecks.push({ id: prefab.id, ...checked.check });
    proofs.push(checked.proof);
  }
  validateCore(delivery, new Set(delivery.prefabs.map(prefab => prefab.id)));
  return { sourceRef: ref, ref: snapshotRef(sha(bytes)), sha256: sha(bytes), bytes, delivery, validationChecks, proofs };
}

export function render(entries, stagedSnapshots = new Map()) {
  const all = entries.map(item => {
    const bytes = stagedSnapshots.get(item.ref) || readFileSync(safeRef(item.ref, 'registered delivery snapshot'));
    expect(sha(bytes) === item.sha256, `Registered delivery snapshot changed: ${item.ref}`);
    return { ...item, delivery: JSON.parse(bytes) };
  });
  const prefabIds = new Set(), moduleIds = new Map(), gameIds = new Set();
  const prefabs = [], bundles = [], maps = [];
  for (const { ref, sourceRef, delivery } of all) {
    expect(!gameIds.has(delivery.gameId), `Conflicting game delivery: ${delivery.gameId}`);
    gameIds.add(delivery.gameId);
    for (const bundle of delivery.bundles) {
      const previous = moduleIds.get(bundle.moduleId);
      expect(!previous || previous === delivery.gameId, `Module lineage conflict: ${bundle.moduleId}`);
      moduleIds.set(bundle.moduleId, delivery.gameId);
    }
    for (const prefab of delivery.prefabs) {
      expect(!prefabIds.has(prefab.id), `Duplicate prefab ID: ${prefab.id}`);
      prefabIds.add(prefab.id);
      prefabs.push({ id: prefab.id, path: prefab.path, sha256: prefab.sha256, validation: prefab.validation, validationSha256: prefab.validationSha256, gameId: delivery.gameId, moduleId: prefab.moduleId, descriptorRef: ref, scope: prefab.qualificationScope });
    }
    for (const bundle of delivery.bundles) {
      const copy = structuredClone(bundle);
      for (const assembly of assemblyDescriptors(copy)) {
        const accepted = delivery.prefabs.find(prefab => prefab.id === assembly.id && prefab.moduleId === copy.moduleId);
        assembly.readyToAdd = Boolean(accepted);
        assembly.runtimeQualified = false;
        if (accepted && Object.hasOwn(accepted, 'proofFixtureInitialize')) assembly.proofFixtureInitialize = accepted.proofFixtureInitialize;
      }
      bundles.push(copy);
    }
    maps.push({ gameId: delivery.gameId, descriptorRef: ref, sourceRef, blueprintIds: delivery.blueprintIds, coreLoop: delivery.coreLoop });
  }
  prefabs.sort((a, b) => a.id.localeCompare(b.id));
  bundles.sort((a, b) => a.id.localeCompare(b.id));
  maps.sort((a, b) => a.gameId.localeCompare(b.gameId));
  return {
    manifest: { schema: 'gameverse.prefab-allowlist/1', prefabs },
    module: `// Generated by scripts/register-game-system-deliveries.mjs. Source-only facets stay source-only.\nexport const FLEET_CAPABILITY_BUNDLES = ${JSON.stringify(bundles, null, 2)};\nexport const GAME_RECONSTRUCTION_MAPS = ${JSON.stringify(maps, null, 2)};\n`,
  };
}

function atomicWrite(path, contents) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, contents); renameSync(temp, path); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}
function retainSnapshots(stagedSnapshots) {
  mkdirSync(snapshotDir, { recursive: true });
  for (const [ref, bytes] of stagedSnapshots) {
    expect(/^ontology\/game-system-prefabs\/delivery-snapshots\/[a-f0-9]{64}\.json$/.test(ref), `Unsafe delivery snapshot path: ${ref}`);
    expect(ref === snapshotRef(sha(bytes)), `Delivery snapshot hash mismatch: ${ref}`);
    const full = resolve(snapshotDir, basename(ref));
    if (!existsSync(full)) {
      const temp = `${full}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temp, bytes);
        try { linkSync(temp, full); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      } finally { if (existsSync(temp)) unlinkSync(temp); }
    }
    expect(realpathSync(full) === resolve(realpathSync(snapshotDir), basename(ref)) && sha(readFileSync(full)) === sha(bytes), `Delivery snapshot conflict: ${ref}`);
  }
}
export function retainProofs(incoming, entries, directory = proofDir) {
  mkdirSync(directory, { recursive: true });
  for (const delivery of incoming) {
    const registered = entries.find(item => item.sourceRef === delivery.sourceRef);
    for (let i = 0; i < delivery.proofs.length; i++) {
      const proof = delivery.proofs[i];
      expect(/^ontology\/game-system-prefabs\/registration-proofs\/[a-f0-9]{64}\.json$/.test(proof.ref), `Unsafe registration proof path: ${proof.ref}`);
      const full = resolve(directory, basename(proof.ref));
      expect(under(directory, full), `Unsafe registration proof path: ${proof.ref}`);
      if (!existsSync(full)) {
        const temp = `${full}.${randomUUID()}.tmp`;
        try {
          writeFileSync(temp, proof.bytes);
          try { linkSync(temp, full); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        } finally { if (existsSync(temp)) unlinkSync(temp); }
      }
      expect(realpathSync(full) === resolve(realpathSync(directory), basename(proof.ref)), `Symlink in registration proof: ${proof.ref}`);
      const retained = readFileSync(full);
      const result = JSON.parse(retained);
      expect(result.schema === 'gameverse.mechanic-assembly-validation/0.1' && result.valid === true && result.request_sha256 === proof.requestSha256 && result.validator_sha256 === proof.validatorSha256 && result.catalog_sha256 === proof.catalogSha256, `Registration proof conflict: ${proof.ref}`);
      expect(result.statement_sha256 === registered.validationChecks[i].statementSha256, `Registration proof statement conflict: ${proof.ref}`);
      const pinned = Object.fromEntries(Object.entries(result.interfaces || {}).map(([id, item]) => [id, { packageId: item.package_id, packageSha256: item.package_sha256, behaviorSha256: item.behavior_sha256 }]));
      expect(JSON.stringify(pinned) === JSON.stringify(registered.validationChecks[i].currentInterfacePins), `Registration proof pin conflict: ${proof.ref}`);
      registered.validationChecks[i].currentReceiptSha256 = sha(retained);
    }
  }
}
function main() {
  const args = process.argv.slice(2), refs = [];
  let replaceExisting = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--replace-existing') { replaceExisting = true; continue; }
    expect(args[i] === '--delivery' && args[i + 1], 'Use --delivery research/.../delivery.json (repeatable).');
    refs.push(args[++i]);
  }
  unique(refs, '--delivery argument');
  const previous = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath)) : { schema: 'gameverse.game-prefab-deliveries/1', deliveries: [] };
  expect(previous.schema === 'gameverse.game-prefab-deliveries/1' && Array.isArray(previous.deliveries), 'Invalid central registry.');
  unique(previous.deliveries.map(item => item.sourceRef || item.ref), 'registered delivery sourceRef');
  const incoming = refs.map(validateDelivery);
  const incomingBySource = new Map(incoming.map(item => [item.sourceRef, item]));
  unique(incoming.map(item => item.delivery.gameId), 'incoming game identity');
  const incomingByGame = new Map(incoming.map(item => [item.delivery.gameId, item]));
  const stagedSnapshots = new Map();
  const next = new Map();
  for (const old of previous.deliveries) {
    const sourceRef = old.sourceRef || old.ref;
    const priorGame = JSON.parse(readFileSync(safeRef(old.ref, 'prior delivery identity'))).gameId;
    const replacement = incomingBySource.get(sourceRef) || (replaceExisting ? incomingByGame.get(priorGame) : null);
    if (replacement && replaceExisting && (replacement.sha256 !== old.sha256 || replacement.sourceRef !== sourceRef)) continue;
    if (old.sourceRef) {
      expect(old.ref === snapshotRef(old.sha256) && sha(readFileSync(safeRef(old.ref, 'registered delivery snapshot'))) === old.sha256, `Registered delivery snapshot changed: ${old.ref}`);
      next.set(sourceRef, old);
    } else {
      const bytes = readFileSync(safeRef(old.ref, 'legacy registered delivery'));
      expect(sha(bytes) === old.sha256, `Legacy delivery changed; use --replace-existing for ${sourceRef}`);
      const ref = snapshotRef(old.sha256);
      stagedSnapshots.set(ref, bytes);
      next.set(sourceRef, { ...old, sourceRef, ref });
    }
  }
  for (const entry of incoming) {
    const prior = next.get(entry.sourceRef);
    expect(!prior || prior.sha256 === entry.sha256 || replaceExisting, `Changed registered delivery requires --replace-existing: ${entry.sourceRef}`);
    stagedSnapshots.set(entry.ref, entry.bytes);
    next.set(entry.sourceRef, { sourceRef: entry.sourceRef, ref: entry.ref, sha256: entry.sha256, validationChecks: entry.validationChecks });
  }
  const entries = [...next.values()].sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));
  const { manifest, module } = render(entries, stagedSnapshots);
  retainSnapshots(stagedSnapshots);
  retainProofs(incoming, entries);
  mkdirSync(outputDir, { recursive: true });
  // All validation and rendering precede publication. Registry is written last.
  atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  atomicWrite(modulePath, module);
  atomicWrite(registryPath, `${JSON.stringify({ schema: previous.schema, deliveries: entries }, null, 2)}\n`);
  console.log(`Registered ${entries.length} game deliveries and ${manifest.prefabs.length} prefabs.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
