import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialVault } from '../../infra/cloudflare/credential-vault.js';

process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_LOG_PATH = join(tmpdir(), 'gameverse-connections-test-wrangler.log');
const { unstable_dev } = await import('wrangler');
const key = '12'.repeat(32); // Public fixture key; never a deployable credential.

test('credential encryption rejects substitution, tampering, oversized values and missing keys', async () => {
  const vault = new CredentialVault(key);
  const scope = { owner: 'vishal', provider: 'codex', auth_method: 'browser', generation: 1, revision: 1 };
  const a = await vault.seal('fixture-auth-state', scope), b = await vault.seal('fixture-auth-state', scope);
  assert.notEqual(a.nonce, b.nonce);
  assert.equal(await vault.open(a, scope), 'fixture-auth-state');
  for (const change of [{ owner: 'shishir' }, { provider: 'claude' }, { auth_method: 'api-key' }, { generation: 2 }, { revision: 2 }]) {
    await assert.rejects(vault.open(a, { ...scope, ...change }), /credential_unavailable/);
  }
  const tampered = { ...a, ciphertext: `${a.ciphertext[0] === 'A' ? 'B' : 'A'}${a.ciphertext.slice(1)}` };
  await assert.rejects(vault.open(tampered, scope), /credential_unavailable/);
  await assert.rejects(vault.seal('x'.repeat(65537), scope), /invalid_credential/);
  await assert.rejects(new CredentialVault().seal('fixture', scope), /credential_key_not_configured/);
  const largest = 'é'.repeat(32768); // Byte limit, rather than JavaScript string length.
  assert.equal(await vault.open(await vault.seal(largest, scope), scope), largest);
});

test('account connection lifecycle retains refreshes, fences cancellation and survives restart', { timeout: 60000 }, async t => {
  const state = await mkdtemp(join(tmpdir(), 'gameverse-connections-'));
  let worker;
  const start = async () => {
    worker = await unstable_dev('tests/hosting/fixtures/connections-worker.js', {
      config: 'tests/hosting/fixtures/wrangler.connections.jsonc', local: true,
      ip: '127.0.0.1', port: 0, persistTo: state, vars: { AGENT_CREDENTIAL_KEY: key },
      logLevel: 'error', inspect: false,
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
    });
  };
  t.after(async () => { await worker?.stop(); await rm(state, { recursive: true, force: true }); });
  await start();
  const call = async (owner, operation, ...args) => {
    const response = await worker.fetch(`http://localhost/${owner}/${operation}`, { method: 'POST', body: JSON.stringify(args) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return body;
  };
  const login = async (owner, provider, credential, method = 'browser') => {
    const { login_id } = await call(owner, 'startConnection', provider, method);
    return call(owner, 'completeConnection', provider, login_id, credential);
  };
  const waitForSeal = async owner => {
    for (let i = 0; i < 25; i++) if (await call(owner, 'sealIsHeld')) return;
    assert.fail('fixture encryption barrier was not reached');
  };

  await t.test('both providers, default selection and account isolation', async () => {
    await login('vishal', 'codex', 'vishal-fixture-auth');
    const settings = await login('vishal', 'claude', 'vishal-fixture-key', 'api-key');
    assert.equal(settings.default_provider, 'codex');
    assert.equal(settings.connections.length, 2);
    assert.ok(settings.connections.every(row => row.status === 'connected' && row.active_run === null));
    assert.equal((await call('vishal', 'setDefault', 'claude')).default_provider, 'claude');
    await login('shishir', 'codex', 'shishir-fixture-auth');
    const use = await call('shishir', 'claimUse', 'codex', 'shishir-run', 300000);
    assert.equal(use.credential, 'shishir-fixture-auth');
    await call('shishir', 'finishUse', 'codex', use.lease_id);
    const stored = JSON.stringify(await call('vishal', 'inspectStorage'));
    assert.ok(!stored.includes('vishal-fixture-auth') && !stored.includes('vishal-fixture-key'));
    assert.ok(!JSON.stringify(settings).includes('credential'));
    await assert.rejects(call('vishal', 'tryOtherOwner', 'shishir'), /account_mismatch/);
    await assert.rejects(call('vishal', 'startConnection', 'unknown', 'browser'), /invalid_provider/);
  });

  await t.test('refresh writeback is serialized, versioned and reusable by a new run', async () => {
    const use = await call('vishal', 'claimUse', 'codex', 'run-one', 300000);
    assert.equal((await call('vishal', 'claimUse', 'codex', 'run-one', 300000)).lease_id, use.lease_id);
    await assert.rejects(call('vishal', 'claimUse', 'codex', 'run-two', 300000), /connection_in_use/);
    assert.equal((await call('vishal', 'saveRefreshedCredential', 'codex', use.lease_id, 1, 'refreshed-fixture-auth')).revision, 2);
    await assert.rejects(call('vishal', 'saveRefreshedCredential', 'codex', use.lease_id, 1, 'stale-fixture-auth'), /credential_revision_conflict/);
    await call('vishal', 'finishUse', 'codex', use.lease_id);
    const next = await call('vishal', 'claimUse', 'codex', 'run-two', 300000);
    assert.equal(next.credential, 'refreshed-fixture-auth');
    await call('vishal', 'finishUse', 'codex', use.lease_id);
    await assert.rejects(call('vishal', 'claimUse', 'codex', 'run-three', 300000), /connection_in_use/);
    await call('vishal', 'finishUse', 'codex', next.lease_id);
  });

  await t.test('disconnect during refresh cannot restore credentials and requires cleanup acknowledgement', async () => {
    const use = await call('vishal', 'claimUse', 'codex', 'cancelled-run', 300000);
    await call('vishal', 'holdNextSeal');
    const pending = call('vishal', 'saveRefreshedCredential', 'codex', use.lease_id, 2, 'late-fixture-auth');
    const rejected = assert.rejects(pending, /connection_use_revoked/);
    await waitForSeal('vishal');
    const disconnected = await call('vishal', 'disconnect', 'codex');
    assert.equal(disconnected.connections.find(row => row.provider === 'codex').active_run.status, 'cancel_requested');
    await call('vishal', 'releaseSeal');
    await rejected;
    await assert.rejects(call('vishal', 'claimUse', 'codex', 'new-run', 300000), /connection_required/);
    await assert.rejects(call('vishal', 'startConnection', 'codex', 'browser'), /connection_in_use/);
    assert.equal((await call('vishal', 'inspectStorage')).find(row => row.provider === 'codex').credential, null);
    await call('vishal', 'finishUse', 'codex', use.lease_id);
    await login('vishal', 'codex', 'reconnected-fixture-auth');
  });

  await t.test('cancelled and superseded browser callbacks cannot reconnect or select defaults', async () => {
    await call('shishir', 'holdNextSeal');
    const old = await call('shishir', 'startConnection', 'claude', 'browser');
    const pending = call('shishir', 'completeConnection', 'claude', old.login_id, 'obsolete-fixture-auth');
    const rejected = assert.rejects(pending, /login_superseded/);
    await waitForSeal('shishir');
    const latest = await call('shishir', 'startConnection', 'claude', 'browser');
    await call('shishir', 'releaseSeal');
    await rejected;
    await call('shishir', 'cancelConnection', 'claude', old.login_id);
    assert.equal((await call('shishir', 'getConnections')).connections.find(row => row.provider === 'claude').status, 'connecting');
    await call('shishir', 'cancelConnection', 'claude', latest.login_id);
    await assert.rejects(call('shishir', 'completeConnection', 'claude', latest.login_id, 'cancelled-fixture-auth'), /login_superseded/);
    assert.equal((await call('shishir', 'getConnections')).default_provider, 'codex');
  });

  await t.test('expired login pauses the selected provider without fallback', async () => {
    await call('vishal', 'setDefault', 'codex');
    const use = await call('vishal', 'claimUse', 'codex', 'expired-login-run', 300000);
    const settings = await call('vishal', 'requireReconnect', 'codex', use.lease_id);
    assert.equal(settings.default_provider, 'codex');
    assert.equal(settings.connections.find(row => row.provider === 'codex').status, 'reconnect_required');
    assert.equal(settings.connections.find(row => row.provider === 'claude').status, 'connected');
    await assert.rejects(call('vishal', 'claimUse', 'codex', 'next-run', 300000), /connection_required/);
    await call('vishal', 'finishUse', 'codex', use.lease_id);
    await login('vishal', 'codex', 'restart-fixture-auth');
  });

  await t.test('an expired use blocks fresh work and late refresh until cleanup is confirmed', async () => {
    const use = await call('vishal', 'claimUse', 'codex', 'uncertain-old-run', 300000);
    await call('vishal', 'expireUse', 'codex');
    assert.equal((await call('vishal', 'getConnections')).connections.find(row => row.provider === 'codex').active_run.lease_expired, true);
    await assert.rejects(call('vishal', 'claimUse', 'codex', 'replacement-run', 300000), /connection_in_use/);
    await assert.rejects(call('vishal', 'saveRefreshedCredential', 'codex', use.lease_id, 1, 'too-late-fixture-auth'), /connection_use_expired/);
    await call('vishal', 'finishUse', 'codex', use.lease_id);
    const next = await call('vishal', 'claimUse', 'codex', 'replacement-run', 300000);
    assert.equal(next.credential, 'restart-fixture-auth');
    await call('vishal', 'finishUse', 'codex', next.lease_id);
  });

  await t.test('encrypted state, default and active-use lock survive actual workerd restart', async () => {
    const use = await call('vishal', 'claimUse', 'codex', 'restart-run', 300000);
    await worker.stop(); worker = undefined;
    await start();
    const settings = await call('vishal', 'getConnections');
    assert.equal(settings.default_provider, 'codex');
    await assert.rejects(call('vishal', 'claimUse', 'codex', 'duplicate-run', 300000), /connection_in_use/);
    assert.equal((await call('vishal', 'claimUse', 'codex', 'restart-run', 300000)).credential, 'restart-fixture-auth');
    await call('vishal', 'finishUse', 'codex', use.lease_id);
  });
});
