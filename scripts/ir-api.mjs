import { readRegisteredPrefab } from './prefab-manifest.mjs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, realpath, copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = (status, message) => Object.assign(new Error(message), { status });
const json = (res, status, value, head = false) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(head ? undefined : JSON.stringify(value)); };
const writeJson = async (path, value) => {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
};
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

const exec = promisify(execFile);
const assemblyRoute = '/api/ir/assembly/validate';
function checkAssemblyEnvelope(graph) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw failure(400, 'Send a mechanic graph object.');
  const pending = [[graph, 0]]; let nodes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (++nodes > 20000 || depth > 24) throw failure(413, 'The mechanic graph exceeds the structural limit.');
    if (typeof value === 'string' && value.length > 4096) throw failure(413, 'Keep graph literals within 4,096 characters.');
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw failure(400, 'Use finite, safely represented numeric graph literals.');
    if (value && typeof value === 'object') for (const child of Object.values(value)) pending.push([child, depth + 1]);
  }
  if (Object.keys(graph.components || {}).length > 32 || Object.keys(graph.state || {}).length > 128 || (Array.isArray(graph.invocations) && graph.invocations.length > 128)) throw failure(413, 'Use at most 32 components, 128 state slots and 128 invocations.');
}
async function validateAssemblyGraph(root, graph) {
  const directory = await mkdtemp(resolve(tmpdir(), 'gameverse-assembly-'));
  try {
    const request = resolve(directory, 'request.json'), output = resolve(directory, 'result.json');
    await writeFile(request, JSON.stringify(graph), { mode: 0o600 });
    await exec('python3', [resolve(root, 'tools/behavior_ir/assembly.py'), '--request', request, '--out', output], {
      cwd: root, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024,
    });
    if ((await stat(output)).size > 4 * 1024 * 1024) throw failure(502, 'The mechanic graph validation response exceeds its limit.');
    const result = await readJson(output);
    if (result.schema !== 'gameverse.mechanic-assembly-validation/0.1' || typeof result.valid !== 'boolean' || !Array.isArray(result.errors)) throw failure(502, 'The mechanic graph validator returned an invalid result.');
    return result;
  } catch (error) {
    if (error.status) throw error;
    throw failure(503, error.killed || error.signal === 'SIGKILL' ? 'Mechanic graph validation exceeded its 10-second limit.' : 'Mechanic graph validation could not complete. Existing graphs and games are unchanged.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}

const prefabSources = new Map([
  ['mzm.enemy.accepted-damage-and-reaction', 'closure/damage-reaction-compat-20261016.assembly.json'],
  ['tmc.learned_sword_charge_release', 'progression/learning.assembly.json'],
  ['sonic.usa.character_traversal.air_phase', 'traversal/air-advance.assembly.json'],
  ['aria.soul.acquire.category0', 'combat-progression-bundles/aria-category0.assembly.json'],
  ['aria.soul.acquire.category1', 'combat-progression-bundles/aria-category1.assembly.json'],
  ['aria.soul.acquire.category2', 'combat-progression-bundles/aria-category2.assembly.json'],
  ['aria.soul.acquire.category3', 'combat-progression-bundles/aria-category3.assembly.json'],
  ['wl4.protection.query_subset', 'combat-progression-bundles/wario-protection.assembly.json'],
  ['tekken.actor.geometry_publication_reset', 'combat-progression-bundles/tekken-geometry.assembly.json'],
]);
const recoveredSystemRoute = '/api/ir/systems/mzm-damage-reaction';
function checkRecoveredSystemInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['damage', 'hp', 'ticks'].includes(key))) throw failure(400, 'Use only damage, hp and ticks.');
  for (const key of Object.keys(input)) if (!Number.isInteger(input[key]) || input[key] < 0 || input[key] > (key === 'ticks' ? 64 : 65535)) throw failure(400, `${key} must be an integer from 0 to ${key === 'ticks' ? 64 : 65535}.`);
}
async function runRecoveredSystem(root, input, readiness = false) {
  return new Promise((accept, reject) => {
    const child = execFile('python3', ['-B', resolve(root, 'research/ir-workshop/game-system-assembly-20261016/closure/run.py'), ...(readiness ? ['--readiness'] : [])], {
      cwd: root, timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024,
    }, (error, stdout) => {
      if (error) return reject(failure(503, error.killed ? 'System inspection exceeded its 15-second limit.' : 'System inspection could not complete. Existing games are unchanged.'));
      try {
        const result = JSON.parse(stdout);
        if (readiness ? result.ready !== true : (result.schema !== 'gameverse.recovered-system-trace/1' || !Array.isArray(result.trace) || result.trace.length > 66)) throw Error('Invalid system response.');
        accept(result);
      } catch { reject(failure(502, 'The recovered system returned an invalid trace.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(readiness ? undefined : JSON.stringify(input));
  });
}

async function compilerOptions(root) {
  return new Promise((accept, reject) => {
    const child = spawn('python3', [resolve(root, 'tools/behavior_ir/generate.py'), '--options'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let data = '', error = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 10000);
    child.stdout.on('data', b => { if (data.length < 1024 * 1024) data += b; });
    child.stderr.on('data', b => { if (error.length < 8192) error += b; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); if (code) reject(failure(503, 'The IR compiler options are unavailable.')); else { try { accept(JSON.parse(data)); } catch { reject(failure(503, 'The IR compiler returned invalid options.')); } } });
  });
}

export async function executableCatalog(root = workspace) {
  const index = await readJson(resolve(root, 'ontology/executable-components/index.json'));
  const options = await compilerOptions(root);
  const components = await Promise.all(index.entries.map(async item => {
    if (!/^[a-z0-9._-]+\.json$/.test(item.record)) throw failure(503, 'Invalid executable catalog record.');
    const record = await readJson(resolve(root, 'ontology/executable-components', item.record));
    let installed = false;
    try { installed = sha(await readFile(resolve(root, record.package_ref))) === record.package_sha256; } catch { /* absent private package */ }
    return { ...record, installed, availability: installed ? 'installed' : 'private_package_missing_or_changed' };
  }));
  return { schema: 'gameverse.ir.workshop-catalog/0.1', scope: index.scope, roles: options.roles, components,
    generation: { request_schema: 'gameverse.ir.generation-request/0.1', target: 'clean_native_gba_rom', requires_model_keys: false,
      authored_boundary: 'Recovered executable mechanics; explicitly authored world, input, projectile, gate and presentation IR. This builder is a bounded connected game slice.' } };
}

export function validateSubmission(body, catalog) {
  if (body?.schema !== 'gameverse.ir.ui-submission/0.1' || !body.request || typeof body.request !== 'object') throw failure(400, 'Unsupported IR submission.');
  const request = body.request;
  if (request.schema !== 'gameverse.ir.generation-request/0.1' || !uuid(request.request_id)) throw failure(400, 'A versioned request and unique request ID are required.');
  if (typeof request.title !== 'string' || !/^[A-Za-z0-9 _-]{1,12}$/.test(request.title)) throw failure(400, 'Use a cartridge title of 1–12 letters, numbers, spaces, hyphens or underscores.');
  if (!request.selections || Object.keys(request.selections).sort().join(',') !== 'combat,movement,progression') throw failure(400, 'Choose movement, combat and progression components.');
  const selected = [];
  for (const [role, values] of Object.entries(catalog.roles)) {
    const option = values.find(x => x.id === request.selections[role]);
    if (!option || option.status !== 'available') throw failure(422, `${role}: this component is awaiting an executable adapter or qualification.`);
    for (const id of option.packages) {
      const component = catalog.components.find(x => x.id === id);
      if (!component?.installed || component.qualification?.status !== 'pass') throw failure(422, `${id}: its pinned private executable package is unavailable.`);
      selected.push(component);
    }
  }
  const parents = body.context?.parent_game_ids;
  if (!Array.isArray(parents) || parents.length < 2 || parents.length > 4 || new Set(parents).size !== parents.length || parents.some(x => typeof x !== 'string' || !/^[a-z0-9-]{1,100}$/.test(x))) throw failure(400, 'Choose two to four distinct source games.');
  const used = new Set(selected.map(x => x.source_game));
  if (parents.some(x => !used.has(x)) || [...used].some(x => !parents.includes(x))) throw failure(422, 'Every selected source game must contribute a concrete executable component. Update the parent games or component choices.');
  if (typeof body.context?.intent !== 'string' || body.context.intent.length > 4000) throw failure(400, 'Keep design notes within 4,000 characters.');
  // Server resolves exact versions. Notes never replace selectors, bindings or IR.
  return { schema: body.schema, request: { schema: request.schema, request_id: request.request_id, title: request.title,
    selections: { ...request.selections }, qualification: { run: true } }, context: { parent_game_ids: parents, intent: body.context.intent },
    selected_packages: [...new Map(selected.map(x => [x.id, { id: x.id, package_ref: x.package_ref, package_sha256: x.package_sha256,
      behavior_sha256: x.behavior_sha256, source_game: x.source_game, ports: x.ports, dependencies: x.dependencies, qualification: x.qualification }])).values()] };
}

export function createIrApi({ root = workspace, directory = resolve(root, 'local-data/ir-runs'), timeoutMs = 60000,
  catalogProvider = () => executableCatalog(root), spawnImpl = spawn, assemblyValidator = graph => validateAssemblyGraph(root, graph), systemRunner = input => runRecoveredSystem(root, input), systemReadiness = () => runRecoveredSystem(root, null, true) } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw Error('IR_BUILD_TIMEOUT_MS must be 1000..300000.');
  let active = null, assemblyActive = false, systemActive = false;
  const jobDir = id => resolve(directory, id);
  const metaPath = id => resolve(jobDir(id), 'job.json');
  async function readStatus(id) {
    if (!uuid(id)) throw failure(404, 'IR run not found.');
    let meta;
    try { meta = await readJson(metaPath(id)); } catch (e) { if (e.code === 'ENOENT') throw failure(404, 'IR run not found.'); throw e; }
    let compiler;
    try { compiler = await readJson(resolve(jobDir(id), 'output/status.json')); } catch { compiler = null; }
    const result = { ...meta, compiler, active: active === id };
    result.state = meta.state === 'failed' ? 'failed' : compiler?.state || meta.state;
    // A restarted server does not invent a live worker for a retained running job.
    if (!result.active && !['completed', 'failed'].includes(result.state)) { result.state = 'interrupted'; result.diagnostic = 'The server stopped before a final compiler receipt was recorded. Start a new request; prior artifacts are retained.'; }
    result.eligible_for_play = result.state === 'completed' && compiler?.outcome === 'pass' && compiler?.qualification?.outcome === 'pass';
    result.artifacts = {};
    if (compiler?.artifacts?.rom) result.artifacts.rom = `/api/ir/runs/${id}/artifacts/rom`;
    for (const [key, name] of [['composition', 'composition.json'], ['build_receipt', 'build-receipt.json']]) if (compiler?.artifacts?.[key]) result.artifacts[key] = `/api/ir/runs/${id}/artifacts/${name}`;
    result.artifacts.request = `/api/ir/runs/${id}/artifacts/request.json`;
    result.artifacts.submission = `/api/ir/runs/${id}/artifacts/submission.json`;
    if (compiler?.qualification?.receipt) result.artifacts.qualification = `/api/ir/runs/${id}/artifacts/route-receipt.json`;
    if (compiler?.artifacts?.video) result.artifacts.video = `/api/ir/runs/${id}/artifacts/video.mp4`;
    result.artifacts.screenshots = (compiler?.artifacts?.screenshots || []).map((_, i) => `/api/ir/runs/${id}/artifacts/screenshot-${i}.png`);
    return result;
  }
  async function submit(body) {
    const catalog = await catalogProvider(), submission = validateSubmission(body, catalog), id = submission.request.request_id;
    const bytes = `${JSON.stringify(submission, null, 2)}\n`, fingerprint = sha(bytes);
    try {
      const prior = await readJson(metaPath(id));
      if (prior.submission_sha256 !== fingerprint) throw failure(409, 'This request ID already belongs to different selections.');
      return readStatus(id);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (active) throw failure(409, 'Another IR build is running. Let it finish before submitting another.');
    active = id;
    const dir = jobDir(id), requestPath = resolve(dir, 'request.json');
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, 'submission.json'), bytes, { mode: 0o600 });
      await writeJson(requestPath, submission.request);
      const meta = { schema: 'gameverse.ir.ui-run/0.1', id, state: 'running', started_utc: new Date().toISOString(),
        title: submission.request.title, selections: submission.request.selections, submission_sha256: fingerprint,
        qualification_required_for_play: true, timeout_ms: timeoutMs, queue_s: null };
      await writeJson(metaPath(id), meta);
      const child = spawnImpl('python3', [resolve(root, 'tools/behavior_ir/generate.py'), '--request', requestPath, '--out', resolve(dir, 'output')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      const started = performance.now(); let stderr = '', stdout = '', timedOut = false, finished = false;
      child.stdout.on('data', b => { if (stdout.length < 1024 * 1024) stdout += b; });
      child.stderr.on('data', b => { if (stderr.length < 16384) stderr += b; });
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
      async function finish(code, error) {
        if (finished) return; finished = true; clearTimeout(timer);
        try {
          await writeFile(resolve(dir, 'compiler.stdout.txt'), stdout, { mode: 0o600 });
          await writeFile(resolve(dir, 'compiler.stderr.txt'), stderr, { mode: 0o600 });
          const compiler = await readJson(resolve(dir, 'output/status.json')).catch(() => null);
          meta.state = !timedOut && !error && code === 0 && compiler?.state === 'completed' ? 'completed' : 'failed';
          meta.diagnostic = timedOut ? 'The bounded IR build exceeded its wall-time limit.' : error ? 'The IR worker could not start.' : compiler?.diagnostic || (meta.state === 'failed' ? 'The IR worker exited without a successful receipt.' : null);
          meta.execution_wall_s = (performance.now() - started) / 1000; meta.exit_code = code; meta.finished_utc = new Date().toISOString();
          await writeJson(metaPath(id), meta);
        } finally { if (active === id) active = null; }
      }
      child.on('error', error => { void finish(null, error); });
      child.on('close', code => { void finish(code); });
      return await readStatus(id);
    } catch (error) { if (active === id) active = null; throw error; }
  }
  async function activate(id) {
    const status = await readStatus(id);
    if (!status.eligible_for_play) throw failure(409, 'A successful build and native route receipt are required before adding to Play.');
    const bytes = await readFile(await artifactPath(id, 'rom'));
    if (sha(bytes) !== status.compiler.artifacts.rom_sha256) throw failure(409, 'The generated ROM does not match its immutable build receipt.');
    const games = resolve(root, 'local-data/games'); await mkdir(games, { recursive: true });
    await copyFile(await artifactPath(id, 'rom'), resolve(games, `${sha(bytes)}.gba`));
    const receipt = { schema: 'gameverse.ir.play-registration/0.1', gameId: 'ir-workshop', runId: id, sha256: sha(bytes),
      title: status.title, requestSha256: status.compiler.request_sha256, submissionSha256: status.submission_sha256,
      qualification: status.compiler.qualification, selectedAt: new Date().toISOString(),
      ...(typeof status.playNotes === 'string' && status.playNotes.trim() && status.playNotes.length <= 1000 ? { playNotes: status.playNotes.trim() } : {}) };
    await writeJson(resolve(games, 'ir-workshop.json'), receipt);
    return { outcome: 'registered', game_id: 'ir-workshop', artifact_sha256: receipt.sha256, play_url: '/v0?view=play&game=ir-workshop' };
  }
  async function artifactPath(id, name) {
    const status = await readStatus(id), a = status.compiler?.artifacts || {}, files = {
      rom: a.rom, 'video.mp4': a.video, 'composition.json': a.composition, 'build-receipt.json': a.build_receipt,
      'route-receipt.json': status.compiler?.qualification?.receipt, 'request.json': resolve(jobDir(id), 'request.json'),
      'submission.json': resolve(jobDir(id), 'submission.json'),
    };
    const image = /^screenshot-(\d+)\.png$/.exec(name);
    const target = image ? a.screenshots?.[Number(image[1])] : files[name];
    if (!target) throw failure(404, 'This run has no such artifact.');
    const path = await realpath(target), dir = await realpath(jobDir(id));
    if (!path.startsWith(dir + sep)) throw failure(403, 'Artifact is outside this run.');
    return path;
  }
  async function handle(req, res, path) {
    if (!path.startsWith('/api/ir/')) return false;
    try {
      const method = req.method, match = /^\/api\/ir\/runs\/([^/]+)(?:\/(activate|artifacts\/([^/]+)))?$/.exec(path);
      if (method === 'GET' || method === 'HEAD') {
        if (path.startsWith('/api/ir/system-prefabs/')) {
          const id = path.slice('/api/ir/system-prefabs/'.length), relative = prefabSources.get(id);
          let registered;
          if (!relative) {
            try { registered = await readRegisteredPrefab(root, id); }
            catch { json(res, 200, { ready: false, id, error: 'The registered source assembly is unavailable or its artifact pins changed.' }, method === 'HEAD'); return true; }
            if (!registered) throw failure(404, 'Recovered system prefab not found.');
          }
          if (assemblyActive) { json(res, 409, { ready: false, error: 'Another mechanic graph validation is running.' }, method === 'HEAD'); return true; }
          assemblyActive = true;
          try {
            let graph, source, registration;
            if (registered) { ({ graph, source, registration } = registered); }
            else {
              const sourceRef = 'research/ir-workshop/game-system-assembly-20261016/' + relative, file = resolve(root, sourceRef);
              if ((await stat(file)).size > 256 * 1024) throw Error('Prefab graph exceeds limit.');
              const bytes = await readFile(file); graph = JSON.parse(bytes); source = { ref: sourceRef, sha256: sha(bytes) };
            }
            checkAssemblyEnvelope(graph);
            const validation = await assemblyValidator(graph);
            json(res, 200, validation.valid ? { ready: true, id, graph: validation.normalized_graph, validation, source, ...(registration ? { registration } : {}), scope: 'Current structural binding admission only; runtime and source-system obligations remain unproven.' } : { ready: false, id, error: 'Current published components do not admit this source assembly.', validation }, method === 'HEAD');
          } catch { json(res, 200, { ready: false, id, error: 'The source assembly is not currently available for binding.' }, method === 'HEAD'); }
          finally { assemblyActive = false; }
        } else if (path === recoveredSystemRoute) {
          if (systemActive) json(res, 200, { ready: false, error: 'A recovered system inspection is running.' }, method === 'HEAD');
          else {
            systemActive = true;
            try { json(res, 200, await systemReadiness(), method === 'HEAD'); }
            catch { json(res, 200, { ready: false, error: 'Current source packages and core bindings are not ready for inspection.' }, method === 'HEAD'); }
            finally { systemActive = false; }
          }
        } else if (path === '/api/ir/catalog') json(res, 200, await catalogProvider(), method === 'HEAD');
        else if (match && !match[2]) json(res, 200, await readStatus(match[1]), method === 'HEAD');
        else if (match?.[3]) {
          const file = await artifactPath(match[1], match[3]), bytes = await readFile(file);
          const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.mp4') ? 'video/mp4' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length }); res.end(method === 'HEAD' ? undefined : bytes);
        } else throw failure(404, 'IR endpoint not found.');
      } else if (method === 'POST') {
        const host = req.headers.host;
        let hostname; try { hostname = new URL(`http://${host}`).hostname; } catch { throw failure(403, 'Local origin required.'); }
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname) || req.headers.origin !== `http://${host}`) throw failure(403, 'Use the local Gameverse page to submit IR requests.');
        if (path === recoveredSystemRoute) {
          if (!req.headers['content-type']?.startsWith('application/json')) throw failure(415, 'Send JSON damage, hp and ticks.');
          let bytes = 0; const chunks = [];
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) throw failure(413, 'Keep system inputs within 8 KiB.'); chunks.push(chunk); }
          let input; try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw failure(400, 'System input JSON is invalid.'); }
          checkRecoveredSystemInput(input);
          if (systemActive) throw failure(409, 'Another recovered system inspection is running.');
          systemActive = true;
          try { json(res, 200, await systemRunner(input)); }
          finally { systemActive = false; }
          return true;
        }
        if (path === assemblyRoute) {
          if (!req.headers['content-type']?.startsWith('application/json')) throw failure(415, 'Send a JSON mechanic graph.');
          let bytes = 0; const chunks = [];
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 256 * 1024) throw failure(413, 'Keep the mechanic graph within 256 KiB.'); chunks.push(chunk); }
          let graph; try { graph = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw failure(400, 'The mechanic graph JSON is invalid.'); }
          checkAssemblyEnvelope(graph);
          if (assemblyActive) throw failure(409, 'Another mechanic graph validation is running. Try again when it finishes.');
          assemblyActive = true;
          try { json(res, 200, await assemblyValidator(graph)); }
          finally { assemblyActive = false; }
          return true;
        }
        if (match?.[2] === 'activate') json(res, 200, await activate(match[1]));
        else if (path === '/api/ir/runs') {
          if (!req.headers['content-type']?.startsWith('application/json')) throw failure(415, 'Send a JSON IR request.');
          let bytes = 0; const chunks = [];
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 32768) throw failure(413, 'IR request is too large.'); chunks.push(chunk); }
          let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw failure(400, 'IR request JSON is invalid.'); }
          json(res, 202, await submit(body));
        } else throw failure(404, 'IR endpoint not found.');
      } else throw failure(405, 'Method not supported.');
    } catch (error) { json(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.status ? error.message : 'The local IR service could not complete the request. Existing runs are retained.' }); }
    return true;
  }
  return { handle, submit, readStatus, activate };
}
