import { DurableObject } from 'cloudflare:workers';
import { CredentialVault } from './credential-vault.js';

const providers = new Set(['codex', 'claude']);
const methods = new Set(['browser', 'api-key']);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
const checkProvider = provider => { if (!providers.has(provider)) throw new Error('invalid_provider'); };

// One object per canonical Gameverse account. RPC is server-only: a future session
// adapter must derive the object name from a verified principal, never a body field.
// There is intentionally no public or staging-admin credential HTTP route.
export class AgentConnections extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.vault = new CredentialVault(env.AGENT_CREDENTIAL_KEY);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS connection_account (
        id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, default_provider TEXT
      );
      CREATE TABLE IF NOT EXISTS agent_connection (
        provider TEXT PRIMARY KEY, auth_method TEXT NOT NULL, status TEXT NOT NULL,
        generation INTEGER NOT NULL, revision INTEGER NOT NULL,
        login_id TEXT, credential TEXT
      );
      CREATE TABLE IF NOT EXISTS connection_use (
        provider TEXT PRIMARY KEY, run_id TEXT NOT NULL, lease_id TEXT NOT NULL,
        generation INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL
      );
    `);
  }

  initialize(owner) {
    if (!identifier(owner)) throw new Error('invalid_account');
    this.sql.exec('INSERT OR IGNORE INTO connection_account (id, owner) VALUES (1, ?)', owner);
    if (this.owner() !== owner) throw new Error('account_mismatch');
    return this.getConnections();
  }

  owner() {
    const row = this.sql.exec('SELECT owner FROM connection_account WHERE id = 1').toArray()[0];
    if (!row) throw new Error('account_not_initialized');
    return row.owner;
  }

  connection(provider) {
    this.owner(); checkProvider(provider);
    return this.sql.exec('SELECT * FROM agent_connection WHERE provider = ?', provider).toArray()[0];
  }

  use(provider) {
    return this.sql.exec('SELECT * FROM connection_use WHERE provider = ?', provider).toArray()[0];
  }

  scope(row) {
    return { owner: this.owner(), provider: row.provider, auth_method: row.auth_method,
      generation: row.generation, revision: row.revision };
  }

  getConnections() {
    this.owner();
    const account = this.sql.exec('SELECT default_provider FROM connection_account WHERE id = 1').toArray()[0];
    const connections = this.sql.exec(`SELECT provider, auth_method, status, revision
      FROM agent_connection ORDER BY provider`).toArray().map(row => {
      const use = this.use(row.provider);
      return { ...row, active_run: use ? { run_id: use.run_id, status: use.status,
        expires_at: use.expires_at, lease_expired: use.expires_at <= Date.now() } : null };
    });
    return { schema: 'gameverse.agent-connections/1', default_provider: account.default_provider, connections };
  }

  startConnection(provider, authMethod, loginId = crypto.randomUUID()) {
    const existing = this.connection(provider);
    if (!methods.has(authMethod)) throw new Error('invalid_auth_method');
    if (!identifier(loginId)) throw new Error('invalid_login_id');
    if(existing?.status === 'connecting' && existing.login_id === loginId && existing.auth_method === authMethod) {
      return {login_id:loginId,provider,auth_method:authMethod};
    }
    if (this.use(provider)) throw new Error('connection_in_use');
    this.sql.exec(`INSERT INTO agent_connection
      (provider, auth_method, status, generation, revision, login_id, credential)
      VALUES (?, ?, 'connecting', ?, 0, ?, NULL)
      ON CONFLICT(provider) DO UPDATE SET auth_method=excluded.auth_method,
      status=excluded.status, generation=excluded.generation, revision=0,
      login_id=excluded.login_id, credential=NULL`,
    provider, authMethod, (existing?.generation || 0) + 1, loginId);
    return { login_id: loginId, provider, auth_method: authMethod };
  }

  async completeConnection(provider, loginId, credential) {
    const row = this.connection(provider);
    if (!row || row.status !== 'connecting' || row.login_id !== loginId) throw new Error('login_superseded');
    const envelope = await this.vault.seal(credential, this.scope({ ...row, revision: 1 }));
    // Encryption yields to other RPCs. Compare the login again at the write.
    const changed = this.sql.exec(`UPDATE agent_connection SET status='connected', revision=1,
      credential=?, login_id=NULL WHERE provider=? AND status='connecting' AND login_id=? AND generation=?
      RETURNING provider`, JSON.stringify(envelope), provider, loginId, row.generation).toArray();
    if (!changed.length) throw new Error('login_superseded');
    this.sql.exec('UPDATE connection_account SET default_provider=? WHERE id=1 AND default_provider IS NULL', provider);
    return this.getConnections();
  }

  cancelConnection(provider, loginId) {
    this.connection(provider);
    this.sql.exec(`UPDATE agent_connection SET status='disconnected', login_id=NULL,
      credential=NULL, generation=generation+1 WHERE provider=? AND status='connecting' AND login_id=?`, provider, loginId);
    return this.getConnections();
  }

  setDefault(provider) {
    if (this.connection(provider)?.status !== 'connected') throw new Error('connection_required');
    this.sql.exec('UPDATE connection_account SET default_provider=? WHERE id=1', provider);
    return this.getConnections();
  }

  disconnect(provider) {
    this.connection(provider);
    this.sql.exec(`UPDATE agent_connection SET status='disconnected', credential=NULL,
      login_id=NULL, generation=generation+1 WHERE provider=?`, provider);
    this.sql.exec("UPDATE connection_use SET status='cancel_requested' WHERE provider=?", provider);
    // Keep the selected default. Never silently fall back to the other account.
    return this.getConnections();
  }

  assertUse(provider, leaseId, expectedRevision) {
    const row = this.connection(provider), use = this.use(provider);
    if (!use || use.lease_id !== leaseId || use.status !== 'active' || row?.status !== 'connected'
      || row.generation !== use.generation) throw new Error('connection_use_revoked');
    if (use.expires_at <= Date.now()) throw new Error('connection_use_expired');
    if (expectedRevision !== undefined && row.revision !== expectedRevision) throw new Error('credential_revision_conflict');
    return { row, use };
  }

  async claimUse(provider, runId, durationMs) {
    const row = this.connection(provider);
    if (!identifier(runId) || !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 300000) {
      throw new Error('invalid_connection_use');
    }
    if (row?.status !== 'connected' || !row.credential) throw new Error('connection_required');
    let use = this.use(provider);
    if (use && (use.run_id !== runId || use.status !== 'active' || use.expires_at <= Date.now())) {
      // Expiry is a recovery signal, not proof the previous sandbox stopped.
      throw new Error('connection_in_use');
    }
    if (!use) {
      use = { provider, run_id: runId, lease_id: crypto.randomUUID(), generation: row.generation,
        expires_at: Date.now() + durationMs, status: 'active' };
      this.sql.exec(`INSERT INTO connection_use
        (provider, run_id, lease_id, generation, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)`,
      use.provider, use.run_id, use.lease_id, use.generation, use.expires_at, use.status);
    }
    const credential = await this.vault.open(JSON.parse(row.credential), this.scope(row));
    this.assertUse(provider, use.lease_id, row.revision);
    // Private RPC result for a trusted runtime adapter only. Never send to the UI,
    // write to R2, serialize into run metadata, or log this result.
    return { lease_id: use.lease_id, expires_at: use.expires_at, revision: row.revision,
      auth_method: row.auth_method, credential };
  }

  // API-key inference is concurrent and task-scoped. It never claims or copies
  // the exclusive lease used for rotating subscription credentials.
  apiKeyStatus(provider = 'codex') {
    const row = this.connection(provider);
    return {available: row?.status === 'connected' && row.auth_method === 'api-key' && !!row.credential,
      provider, generation: row?.generation ?? null, revision: row?.revision ?? null};
  }

  async apiKeyCredential(scope) {
    const {provider, generation, revision, task_id, parent_id, service, expires_at} = scope || {};
    if (provider !== 'codex' || !identifier(task_id) || task_id !== parent_id ||
        !['transcribe','plan','decisions','reflect'].includes(service) ||
        !Number.isSafeInteger(expires_at) || expires_at <= Date.now() || expires_at > Date.now()+300000) {
      throw Error('invalid_api_key_grant');
    }
    const check = () => {
      const row = this.connection(provider);
      if (!this.apiKeyStatus(provider).available || row.generation !== generation || row.revision !== revision)
        throw Error('api_key_grant_revoked');
      return row;
    };
    const row = check(), credential = await this.vault.open(JSON.parse(row.credential), this.scope(row));
    check();
    // Trusted server-only RPC. Never pass this result to the sandbox or browser.
    return credential;
  }

  async saveRefreshedCredential(provider, leaseId, expectedRevision, credential) {
    const { row } = this.assertUse(provider, leaseId, expectedRevision);
    const envelope = await this.vault.seal(credential, this.scope({ ...row, revision: row.revision + 1 }));
    this.assertUse(provider, leaseId, expectedRevision);
    this.sql.exec('UPDATE agent_connection SET credential=?, revision=revision+1 WHERE provider=?', JSON.stringify(envelope), provider);
    return { revision: row.revision + 1 };
  }

  requireReconnect(provider, leaseId) {
    this.assertUse(provider, leaseId);
    this.sql.exec(`UPDATE agent_connection SET status='reconnect_required', credential=NULL,
      login_id=NULL, generation=generation+1 WHERE provider=?`, provider);
    this.sql.exec("UPDATE connection_use SET status='cancel_requested' WHERE provider=?", provider);
    return this.getConnections();
  }

  finishUse(provider, leaseId) {
    this.connection(provider);
    // Only the hosting coordinator may call after confirmed runtime termination
    // and any credential writeback. A stale acknowledgement cannot release a new use.
    this.sql.exec('DELETE FROM connection_use WHERE provider=? AND lease_id=?', provider, leaseId);
    return this.getConnections();
  }

  finishRunUse(provider, runId) {
    this.connection(provider);
    // Recovery after the coordinator lost the claim response. Still requires
    // confirmed sandbox deletion; never release by expiry alone.
    this.sql.exec('DELETE FROM connection_use WHERE provider=? AND run_id=?', provider, runId);
    return this.getConnections();
  }
}
