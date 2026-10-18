import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stagingSecretsPath } from './hosting-secrets.mjs';

const root = new URL('../', import.meta.url);
const target = new URL(process.argv[2]);
const allowedOrigins = new Set(['https://gameverse-host-staging.gameverse-environment.workers.dev', 'https://gameverse.build']);
if (!allowedOrigins.has(target.origin) || target.username || target.password) {
  throw Error('Expected an approved Gameverse pilot HTTPS origin.');
}
const { STAGING_API_TOKEN } = JSON.parse(await readFile(stagingSecretsPath, 'utf8'));
assert.equal(typeof STAGING_API_TOKEN, 'string');
const started = performance.now();
let requests = 0;
const call = async (path, { authenticated = true, headers = {}, ...options } = {}) => {
  requests++;
  return fetch(new URL(path, target.origin), {
    ...options, headers: { ...(authenticated ? { Authorization: `Bearer ${STAGING_API_TOKEN}` } : {}), ...headers },
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
};
const id = randomUUID(), other = randomUUID();
const path = `/api/admin/projects/${id}`;
const body = Buffer.from('Gameverse staging infrastructure fixture; no game or user data.\n');
const sha = createHash('sha256').update(body).digest('hex');
const checks = [];
const check = async (name, action) => { await action(); checks.push({ name, outcome: 'passed' }); };
await check('public liveness and denied anonymous administration', async () => {
  assert.equal((await call('/health', { authenticated: false })).status, 200);
  assert.equal((await call(path, { authenticated: false })).status, 401);
  assert.equal((await call(path, { headers: { Authorization: 'Bearer invalid-fixture-token' } })).status, 401);
});
await check('secret binding presence and bounded pilot dispatch configuration', async () => {
  const response = await call('/api/admin/status');
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.daytona_key_configured, true);
  assert.equal(status.job_dispatch_enabled, status.player_authentication==='phone-sms-pilot');
  assert.equal(status.job_scope,status.job_dispatch_enabled?'invited-connected-agent-probe':'disabled');
  assert.equal(status.environment, 'staging');
  assert.ok(!JSON.stringify(status).includes(STAGING_API_TOKEN));
});
await check('project creation and idempotent retry', async () => {
  const created = await call(path, { method: 'PUT' });
  assert.equal(created.status, 201);
  const project = await created.json();
  const retry = await call(path, { method: 'PUT' });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), project);
  assert.deepEqual(await (await call(path)).json(), project);
  assert.equal(project.accepted_version, null);
  assert.equal((await call(`/api/admin/projects/${other}`)).status, 404);
});
await check('R2 round trip, immutable retry, digest and project boundaries', async () => {
  const object = `${path}/objects/${sha}`;
  assert.equal((await call(`${path}/objects/${'0'.repeat(64)}`, { method: 'PUT', body })).status, 422);
  assert.equal((await call(object, { method: 'PUT', body })).status, 201);
  assert.equal((await call(object, { method: 'PUT', body })).status, 200);
  const download = await call(object);
  assert.equal(download.status, 200);
  assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'), sha);
  assert.equal((await call(object, { method: 'HEAD' })).headers.get('content-length'), String(body.length));
  assert.equal((await call(`/api/admin/projects/${other}`, { method: 'PUT' })).status, 201);
  assert.equal((await call(`/api/admin/projects/${other}/objects/${sha}`)).status, 404);
});
const files = ['infra/cloudflare/worker.js', 'infra/cloudflare/project-state.js', 'wrangler.staging.jsonc', 'package-lock.json'];
const sourceDigests = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(new URL(file, root))).digest('hex')])));
const receipt = {
  schema: 'gameverse.hosting-smoke/1', run_id: id, recorded_at: new Date().toISOString(),
  origin: target.origin, source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim(),
  source_files_sha256: sourceDigests, checks, requests, wall_ms: performance.now() - started,
  wall_scope: 'HTTP smoke only; excludes dependency setup, bundle, deployment and queue time',
  machine: { node: process.version, platform: process.platform, architecture: process.arch },
  queue_ms: null,
  native_gameplay: 'not-tested', runtime_restart: 'local-only', daytona_jobs: 0, model_calls: 0,
  retained_fixture_project_ids: [id, other], retained_fixture_bytes: body.length,
};
await writeFile(new URL('local-data/hosting/staging-smoke.json', root), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
await writeFile(new URL(`local-data/hosting/smoke-${id}.json`, root), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ origin: receipt.origin, checks: checks.length, requests, wall_ms: receipt.wall_ms, daytona_jobs: 0, outcome: 'passed' }));
