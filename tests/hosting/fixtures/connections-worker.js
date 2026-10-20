import { AgentConnections } from '../../../infra/cloudflare/agent-connections.js';

// Local workerd fixture only. Never use this entrypoint or its HTTP RPC bridge in
// a deployment: it intentionally bypasses sessions and uses synthetic credentials.
export class TestAgentConnections extends AgentConnections {
  async invoke(operation, args) {
    try { return { ok: true, value: await this[operation](...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  }

  inspectStorage() {
    return this.sql.exec('SELECT * FROM agent_connection ORDER BY provider').toArray();
  }

  expireUse(provider) {
    this.sql.exec('UPDATE connection_use SET expires_at=0 WHERE provider=?', provider);
    return true;
  }

  tryOtherOwner(owner) { return this.initialize(owner); }

  holdNextSeal() {
    const seal = this.vault.seal.bind(this.vault);
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    this.release = release;
    this.held = false;
    this.vault.seal = async (...args) => {
      this.vault.seal = seal;
      const envelope = await seal(...args);
      this.held = true;
      await wait;
      return envelope;
    };
    return true;
  }

  sealIsHeld() { return this.held || false; }
  releaseSeal() { this.release(); return true; }
}

const operations = new Set(['apiKeyStatus','apiKeyCredential','getConnections', 'startConnection', 'completeConnection',
  'cancelConnection', 'setDefault', 'disconnect', 'claimUse', 'saveRefreshedCredential',
  'requireReconnect', 'finishUse', 'inspectStorage', 'holdNextSeal', 'sealIsHeld', 'releaseSeal',
  'expireUse', 'tryOtherOwner']);

export default {
  async fetch(request, env) {
    const [, account, operation] = new URL(request.url).pathname.split('/');
    if (!operations.has(operation)) return new Response(null, { status: 404 });
    try {
      const object = env.CONNECTIONS.getByName(account);
      await object.initialize(account);
      const args = await request.json();
      const result = await object.invoke(operation, args);
      return Response.json(result.ok ? result.value : { error: result.error }, { status: result.ok ? 200 : 409 });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 409 });
    }
  },
};
