// Local agent seam. Registered native recipes remain the authority for supported edits.
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const workspace = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const fail = (status, code, message) => Object.assign(Error(message), { status, code });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
const recipes = [
  { id: 'aria-double-xp', command: 'mod-rom', file: 'tools/prefab_pipeline/requests/aria-double-xp.json', quality: 'bounded-native-corridor', description: 'Double defeat XP; 14,720 differential vectors and original/parity/modified native corridor are repeated.' },
  { id: 'aria-soulstride', command: 'build-mod', file: 'tools/prefab_pipeline/requests/aria-soulstride.json', quality: 'build-only', description: 'Connected native bone birth/lunge, moving-defeat MP refund and soul progression. Build does not certify gameplay or campaign.' },
];
const mechanismFiles = ['scripts/improvement-api.mjs', 'tools/prefab_pipeline/native_cli.py', 'tools/prefab_pipeline/mod_rom.py', 'tools/prefab_pipeline/native_mod.py', 'tools/composition/native_build.py', 'tools/composition/resolve.py', 'tools/prefab_pipeline/contract.py', 'tools/prefab_pipeline/momentum_strategy.py', 'tools/prefab_pipeline/reward_strategy.py', 'tools/prefab_pipeline/soulstride_movement.py', 'tools/prefab_pipeline/soulstride_progression.py', 'tools/prefab_pipeline/soul_eligibility.py', 'tools/re/session/bridge.py', 'tools/re/session/session.c'];
async function atomic(path, value) { const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(temp, path); }
export function createImprovementApi({ root = workspace, directory = resolve(root, 'local-data/improvement-runs'), timeoutMs = 90000, spawnImpl = spawn } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw Error('Invalid improvement worker timeout.');
  let active = null, submitting = false;
  const dir = id => resolve(directory, id);
  async function recipeInfo(recipe) {
    const bytes = await readFile(resolve(root, recipe.file)), request = JSON.parse(bytes), missing = [], visited = new Set(), actualRoot = await realpath(root);
    async function inspect(value) {
      if (!value || typeof value !== 'object') return;
      const reference = typeof value.path === 'string' ? value.path : value.ref;
      if (typeof reference === 'string' && digest(value.sha256) && !visited.has(reference)) {
        visited.add(reference);
        try {
          const file = await realpath(resolve(root, reference)), content = await readFile(file);
          if (!file.startsWith(actualRoot + sep) || sha(content) !== value.sha256) missing.push(reference);
          else if (file.endsWith('.json')) await inspect(JSON.parse(content));
        } catch { missing.push(reference); }
      }
      if (value.source_pins && typeof value.source_pins === 'object' && !Array.isArray(value.source_pins)) {
        for (const [path, sha256] of Object.entries(value.source_pins)) if (digest(sha256) && !path.endsWith('.plan.json')) await inspect({ path, sha256 }); // Historical qualification plans are independently repinned by backend admission.
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') await inspect(child);
    }
    let providerManifest;
    try { providerManifest = await readJson(resolve(root, 'contracts/improvement-provider-pack.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (providerManifest) {
      const declaredRecipe = providerManifest.recipes?.find(row => row.id === recipe.id);
      if (providerManifest.schema !== 'gameverse.improvement-provider-pack/1' || !Array.isArray(providerManifest.files)
        || declaredRecipe?.request_path !== recipe.file || declaredRecipe?.request_sha256 !== sha(bytes)) throw Error('Invalid provider manifest');
      const rows = providerManifest.files.filter(row => row.recipes?.includes(recipe.id));
      if (!rows.length) throw Error('Empty provider readset');
      for (const row of rows) {
        // The reviewed runtime readset excludes historical captures. Never follow
        // a metadata-only historical path or expose arbitrary absolute paths.
        if (typeof row.path !== 'string' || !row.path || row.path.startsWith('/') || row.path.split('/').includes('..') || !digest(row.sha256)) throw Error('Unsafe provider readset');
        try { const path = await realpath(resolve(root, row.path)); if (!path.startsWith(actualRoot + sep) || sha(await readFile(path)) !== row.sha256) missing.push(row.path); }
        catch { missing.push(row.path); }
      }
    } else await inspect(request);
    return { ...recipe, request, request_sha256: sha(bytes), installed: !missing.length, missing_inputs: [...new Set(missing)],
      prerequisite_basis: providerManifest ? 'reviewed-provider-runtime-readset' : 'recursive-declared-pins', provenance_warnings: providerManifest?.closure?.provenance_warnings?.filter(row => row.recipe === recipe.id) || [],
      game_id: 'castlevania-aria-of-sorrow', baseline_artifact_sha256: request.rom.sha256 };
  }
  async function capabilities() {
    const registered = await Promise.all(recipes.map(async recipe => { try { return await recipeInfo(recipe); } catch { return { ...recipe, installed: false, missing_inputs: [recipe.file] }; } }));
    const mechanisms = await Promise.all(mechanismFiles.map(async path => ({ path, sha256: sha(await readFile(resolve(root, path))) })));
    try { mechanisms.push({ path: 'contracts/improvement-provider-pack.json', sha256: sha(await readFile(resolve(root, 'contracts/improvement-provider-pack.json'))) }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { schema: 'gameverse.improvement-capabilities/1', adapter_version: 'native-recipe/1', loop_version: sha(canonical(mechanisms)), mechanisms,
      operations: ['native-mod'], recipes: registered, supports: { free_text_planning: false, whole_game_ir: false, reconstruction: false, player_activation: false, save_migration: false, cancel: true },
      resources: { concurrent_runs: 1, worker_timeout_ms: timeoutMs, queue: 'reject-when-busy', model_calls: 0 },
      boundary: 'Shishir produces candidate artifacts and evidence. Vishal owns hosting, discovery, accepted versions, saves and activation.' };
  }
  async function status(id) {
    if (!uuid(id)) throw fail(404, 'not_found', 'Run not found.');
    let record; try { record = await readJson(resolve(dir(id), 'run.json')); } catch (e) { if (e.code === 'ENOENT') throw fail(404, 'not_found', 'Run not found.'); throw e; }
    if (record.status === 'running' && active?.id !== id) return { ...record, status: 'interrupted', error: { code: 'worker_interrupted', message: 'Worker unavailable after server restart; evidence retained. Use a new request ID.' } };
    return record;
  }
  async function submit(body) {
    if (!uuid(body?.request_id) || body.schema !== 'gameverse.improvement-request/1') throw fail(400, 'invalid_request', 'Versioned request and UUID request_id required.');
    if (body.operation !== 'native-mod') throw fail(422, 'unsupported_operation', 'Only registered native-mod recipes are implemented.');
    if (typeof body.intent !== 'string' || !body.intent.trim() || body.intent.length > 4000) throw fail(400, 'invalid_intent', 'Reviewed intent text required (1–4,000 characters).');
    if (body.target?.role !== 'subgame' || body.target.game_id !== 'castlevania-aria-of-sorrow' || !body.target.game_version || !body.target.base_game_version || !digest(body.target.base_artifact_sha256)) throw fail(422, 'unsupported_target', 'Pin Aria subgame version and host base version/artifact.');
    if (typeof body.environment?.version !== 'string' || !digest(body.environment?.config_sha256)) throw fail(400, 'invalid_environment', 'Pin environment version and config digest.');
    const fingerprint = sha(canonical(body));
    try { const prior = await status(body.request_id); if (prior.request_sha256 !== fingerprint) throw fail(409, 'idempotency_conflict', 'Request ID already belongs to different input.'); return prior; } catch (e) { if (e.code !== 'not_found') throw e; }
    if (active || submitting) throw fail(409, 'busy', 'A bounded worker is already running.');
    submitting = true;
    try {
      const caps = await capabilities(), recipe = caps.recipes.find(r => r.id === body.plan?.recipe_id);
      if (!recipe) throw fail(422, 'unsupported_recipe', 'Choose a registered recipe; text is not interpreted as an executable plan.');
      if (body.plan.request_sha256 !== recipe.request_sha256 || body.loop_version !== caps.loop_version || body.target.artifact_sha256 !== recipe.baseline_artifact_sha256) throw fail(409, 'stale_pins', 'Recipe, loop or target artifact pin changed. Refresh capabilities and review the plan.');
      if (!recipe.installed) throw fail(422, 'missing_inputs', 'Registered recipe inputs are missing or stale. Inspect capabilities.missing_inputs.');
      if (body.voice_request_id) {
        if (!uuid(body.voice_request_id)) throw fail(400, 'invalid_voice_request', 'Invalid voice receipt ID.');
        let voice; try { voice = await readJson(resolve(root, 'local-data/voice-requests', `${body.voice_request_id}.json`)); } catch { throw fail(409, 'voice_unavailable', 'Durable voice receipt not found.'); }
        if (voice.status !== 'received' || voice.text !== body.intent || voice.context?.gameId !== body.target.game_id || voice.context?.role !== body.target.role || voice.context?.artifactSha256 !== body.target.artifact_sha256 || voice.context?.gameVersion !== body.target.game_version) throw fail(409, 'voice_context_conflict', 'Voice receipt text/target differs or is cancelled.');
      }
      const id = body.request_id; await mkdir(directory, { recursive: true }); await mkdir(dir(id));
      const record = { schema: 'gameverse.improvement-run/1', request_id: id, request_sha256: fingerprint, status: 'running', phase: 'native-worker', received_at: new Date().toISOString(), input: body, resolved_recipe: recipe,
        candidate_only: true, attempts: 1, repair_count: 0, timings: { queue_s: null, execution_wall_s: null, build_s: null, simulation_s: null, evaluation_s: null, accounting: 'Backend stages are nested in worker execution; queue unavailable (direct dispatch).' }, artifacts: {} };
      await atomic(resolve(dir(id), 'run.json'), record);
      await atomic(resolve(dir(id), 'request.json'), { ...recipe.request, request_id: id });
      const output = resolve(dir(id), 'result.json'), started = performance.now();
      const child = spawnImpl('python3', ['-B', '-m', 'tools.prefab_pipeline.native_cli', recipe.command, '--request', resolve(dir(id), 'request.json'), '--output-dir', resolve(dir(id), 'output'), '--output', output], { cwd: root, detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
      let reason = null, finished = false;
      const stop = why => { reason = why; try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
      active = { id, stop };
      const timer = setTimeout(() => stop('timeout'), timeoutMs);
      const finish = async (code, error) => {
        if (finished) return; finished = true; clearTimeout(timer);
        try {
          const result = await readJson(output).catch(() => null);
          record.status = reason === 'cancelled' ? 'cancelled' : !reason && !error && code === 0 && ['candidate-built', 'qualified-bounded-modification'].includes(result?.status) ? 'completed' : 'failed';
          record.phase = 'terminal'; record.finished_at = new Date().toISOString(); record.timings.execution_wall_s = (performance.now() - started) / 1000;
          const stages = result?.stages || [];
          const sum = predicate => { const rows = stages.filter(predicate); return rows.length ? rows.reduce((n, row) => n + row.wall_s, 0) : null; };
          record.timings.build_s = sum(row => row.name === 'build' || row.name?.startsWith('build-'));
          record.timings.simulation_s = sum(row => row.name?.startsWith('native-play-'));
          record.timings.evaluation_s = sum(row => ['compile-native-oracle', 'instruction-differential'].includes(row.name));
          record.timings.backend_total_s = result?.total_wall_s ?? null;
          record.result = result; record.error = record.status === 'failed' ? { code: reason || 'backend_failed', message: 'Native recipe did not complete. Inspect retained result evidence.' } : null;
          record.quality = { scope: recipe.quality, coverage: result?.coverage || null, witnesses: result?.witnesses || null, gaps: result?.gaps || (recipe.quality === 'build-only' ? ['Gameplay objective and full campaign untested; native build/ABI preservation only.'] : []), reconstruction_qc: 'unavailable', whole_game_equivalent: null, save_compatibility: 'unverified' };
          if (result) record.artifacts.result = `/api/improvement/runs/${id}/artifacts/result`;
          if (record.status === 'completed' && (!result?.artifact || !digest(result.artifact_sha256))) throw Error('Missing artifact');
          if (result?.artifact && digest(result.artifact_sha256)) {
            const file = await realpath(result.artifact); if (!file.startsWith(await realpath(dir(id)) + sep) || sha(await readFile(file)) !== result.artifact_sha256) throw Error('Invalid artifact');
            record.artifacts.rom = `/api/improvement/runs/${id}/artifacts/rom`; record.artifact_sha256 = result.artifact_sha256;
          }
          await atomic(resolve(dir(id), 'run.json'), record);
        } catch { record.status = 'failed'; record.error = { code: 'invalid_backend_result', message: 'Backend result could not be verified.' }; await atomic(resolve(dir(id), 'run.json'), record); }
        finally { if (active?.id === id) active = null; }
      };
      child.on('error', error => { void finish(null, error); }); child.on('close', code => { void finish(code); });
      return record;
    } finally { submitting = false; }
  }
  async function handle(req, res, path) {
    if (!path.startsWith('/api/improvement/')) return false;
    const json = (code, value) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    try {
      let host; try { host = new URL(`http://${req.headers.host}`).hostname; } catch { /* fail below */ }
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host) || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'local_origin_required', 'Use the local app origin.');
      const match = /^\/api\/improvement\/runs\/([^/]+)(?:\/artifacts\/(rom|result))?$/.exec(path);
      if (req.method === 'GET' && path === '/api/improvement/capabilities') json(200, await capabilities());
      else if (req.method === 'GET' && match) {
        const run = await status(match[1]);
        if (!match[2]) json(200, run);
        else {
          if (!run.artifacts[match[2]]) throw fail(404, 'not_found', 'Artifact unavailable.');
          const file = await realpath(match[2] === 'result' ? resolve(dir(match[1]), 'result.json') : run.result.artifact);
          if (!file.startsWith(await realpath(dir(match[1])) + sep)) throw fail(403, 'invalid_artifact', 'Artifact outside run.');
          const bytes = await readFile(file); if (match[2] === 'rom' && sha(bytes) !== run.artifact_sha256) throw fail(409, 'artifact_changed', 'Artifact digest changed.');
          res.writeHead(200, { 'Content-Type': match[2] === 'result' ? 'application/json' : 'application/octet-stream' }).end(bytes);
        }
      } else if (req.method === 'DELETE' && match && !match[2]) { const run = await status(match[1]); if (active?.id === match[1]) active.stop('cancelled'); json(202, { ...run, cancellation_requested: active?.id === match[1] }); }
      else if (req.method === 'POST' && path === '/api/improvement/runs') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'json_required', 'Send JSON.');
        let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > 32768) throw fail(413, 'too_large', 'Request exceeds 32 KiB.'); chunks.push(chunk); }
        let body; try { body = JSON.parse(Buffer.concat(chunks)); } catch { throw fail(400, 'invalid_json', 'Invalid JSON.'); }
        json(202, await submit(body));
      } else throw fail(404, 'not_found', 'Improvement endpoint not found.');
    } catch (error) { json(error.status || 500, { error: { code: error.status ? error.code : 'service_error', message: error.status ? error.message : 'Improvement service could not complete this operation.' } }); }
    return true;
  }
  return { handle, capabilities, submit, status };
}
