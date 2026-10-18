import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

// Test only local workerd storage; never load developer credentials or call cloud APIs.
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_LOG_PATH = join(tmpdir(), 'gameverse-hosting-test-wrangler.log');
const { unstable_dev } = await import('wrangler');
const token = 'local-fixture-token-with-at-least-32-characters';
const headers = { Authorization: `Bearer ${token}` };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('staging auth, SQLite project isolation, private immutable R2 and restart persistence', { timeout: 60000 }, async t => {
  const state = await mkdtemp(join(tmpdir(), 'gameverse-hosting-'));
  let worker;
  const start = async () => {
    worker = await unstable_dev('infra/cloudflare/worker.js', {
      config: 'tests/hosting/fixtures/wrangler.platform.jsonc', local: true, ip: '127.0.0.1', port: 0,
      persistTo: state, vars: { STAGING_API_TOKEN: token, DAYTONA_API_KEY: 'fake-not-used' },
      logLevel: 'error', inspect: false,
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
    });
  };
  const request = (path, init = {}) => worker.fetch(`http://localhost${path}`, { ...init, headers: { ...headers, ...init.headers } });
  t.after(async () => { await worker?.stop(); await rm(state, { recursive: true, force: true }); });
  await start();
  const a = `/api/admin/projects/${randomUUID()}`, b = `/api/admin/projects/${randomUUID()}`;
  const bytes = Buffer.from('public infrastructure fixture\n'), sha = digest(bytes);

  await t.test('authentication and origin fail closed', async () => {
    assert.equal((await worker.fetch('http://localhost/health')).status, 200);
    assert.equal((await worker.fetch(`http://localhost${a}`)).status, 401);
    assert.equal((await request(a, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await request(a, { headers: { Origin: 'https://attacker.example' } })).status, 403);
    const status = await (await request('/api/admin/status')).json();
    assert.equal(status.job_dispatch_enabled, false);
    assert.equal(status.player_authentication, 'not-configured');
    assert.ok(!JSON.stringify(status).includes(token));
  });
  let created;
  await t.test('creation is durable and retries do not replace identity', async () => {
    assert.equal((await request(a)).status, 404);
    assert.equal((await request(a, { method: 'PUT', body: '{"accepted_version":"forged"}' })).status, 400);
    const response = await request(a, { method: 'PUT' });
    assert.equal(response.status, 201);
    created = await response.json();
    assert.equal(created.accepted_version, null);
    const retries = await Promise.all(Array.from({ length: 3 }, () => request(a, { method: 'PUT' })));
    for (const retry of retries) { assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), created); }
    assert.equal((await request(b)).status, 404);
    assert.equal((await request(b, { method: 'PUT' })).status, 201);
  });
  await t.test('uploads enforce size, digest and project boundaries', async () => {
    assert.equal((await request(`${a}/objects/${'0'.repeat(64)}`, { method: 'PUT', body: bytes })).status, 422);
    assert.equal((await request(`${a}/objects/${sha}`, { method: 'PUT', body: Buffer.alloc(1048577) })).status, 413);
    assert.equal((await request(`${a}/objects/${sha}`)).status, 404);
    assert.equal((await request(`${a}/objects/${sha}`, { method: 'PUT', body: bytes })).status, 201);
    assert.equal((await request(`${a}/objects/${sha}`, { method: 'PUT', body: bytes })).status, 200);
    assert.equal((await request(`${b}/objects/${sha}`)).status, 404);
    assert.equal((await worker.fetch(`http://localhost${a}/objects/${sha}`)).status, 401);
    const download = await request(`${a}/objects/${sha}`);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal(download.headers.get('content-type'), 'application/octet-stream');
    assert.equal(download.headers.get('cache-control'), 'no-store');
    const head = await request(`${a}/objects/${sha}`, { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), String(bytes.length));
    assert.equal((await head.text()).length, 0);
  });
  await t.test('state and files survive a real local runtime restart', async () => {
    await worker.stop(); worker = undefined;
    await start();
    assert.deepEqual(await (await request(a)).json(), created);
    assert.deepEqual(Buffer.from(await (await request(`${a}/objects/${sha}`)).arrayBuffer()), bytes);
  });
});
