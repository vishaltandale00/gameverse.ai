import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';

const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const problem = message => Object.assign(Error(message), { status: 503 });

// The CLI owns its credentials. Never read its auth files or forward tokens to the browser.
export function createCodexAgent({ cwd = process.cwd(), binary = process.env.CODEX_BIN || (existsSync(bundled) ? bundled : 'codex'), timeoutMs = Number(process.env.MASHUP_AGENT_TIMEOUT_MS || 900000), spawnImpl = spawn } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000) throw Error('MASHUP_AGENT_TIMEOUT_MS must be an integer from 1 to 1800000.');
  let child, ready, nextId = 0, active = false;
  const pending = new Map(), events = new EventEmitter();
  function send(message) { child.stdin.write(`${JSON.stringify(message)}\n`); }
  function fail(error) { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); child = null; ready = null; events.emit('transportError', error); }
  function request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(problem('Local Codex did not respond. Restart it and reconnect.')); }, 15000);
      pending.set(id, { resolve, reject, timer });
      send({ id, method, params });
    });
  }
  async function connect() {
    if (ready) return ready;
    ready = (async () => {
      const env = { ...process.env };
      for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'SID_LLM_KEY', 'SID_LLM_URL', 'GAMEVERSE_SID_ENV_FILE', 'LITELLM_API_KEY', 'PLAYTEST_LLM_API_KEY']) delete env[key];
      const proc = child = spawnImpl(binary, ['app-server', '--listen', 'stdio://', '-c', 'model_provider="openai"'], { cwd, stdio: ['pipe', 'pipe', 'ignore'], env });
      proc.on('error', () => child === proc && fail(problem('Codex CLI is unavailable. Install or repair Codex CLI, or set CODEX_BIN to its executable.')));
      proc.on('exit', () => child === proc && fail(problem('Local Codex stopped. Reconnect and try again.')));
      proc.stdin.on('error', () => child === proc && fail(problem('Local Codex connection closed. Reconnect and try again.')));
      readline.createInterface({ input: child.stdout }).on('line', line => {
        let message; try { message = JSON.parse(line); } catch { return; }
        if (message.id !== undefined && pending.has(message.id)) {
          const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer);
          message.error ? item.reject(problem(`Codex rejected ${message.error.code ?? 'the request'}. Check your local Codex configuration.`)) : item.resolve(message.result);
        } else if (message.id !== undefined && message.method) {
          // This unattended bridge cannot grant extra permissions or answer elicitation.
          send({ id: message.id, error: { code: -32601, message: 'Interactive approval is unavailable in the local Gameverse bridge.' } });
        } else events.emit('notification', message);
      });
      await request('initialize', { clientInfo: { name: 'gameverse_local', title: 'Gameverse local', version: '0.1.0' } });
      send({ method: 'initialized', params: {} });
    })();
    return ready;
  }
  async function status() {
    try {
      await connect(); const { account } = await request('account/read', { refreshToken: false });
      const authenticated = account?.type === 'chatgpt';
      return { available: true, authenticated, authMode: authenticated ? 'chatgpt' : null, planType: authenticated ? account.planType ?? null : null,
        reason: authenticated ? null : account ? 'Connect a ChatGPT account. API-key and other provider accounts are not used by this app.' : 'Sign in with ChatGPT through local Codex.', transport: 'codex-app-server', billing: 'chatgpt-subscription' };
    } catch (error) { return { available: false, authenticated: false, authMode: null, planType: null, reason: error.message, transport: 'codex-app-server', billing: 'chatgpt-subscription' }; }
  }
  async function login() {
    await connect(); const result = await request('account/login/start', { type: 'chatgpt' });
    const url = new URL(result.authUrl);
    if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com'].includes(url.hostname)) throw problem('Codex returned an unsupported sign-in address. Update Codex CLI.');
    return { type: 'chatgpt', loginId: result.loginId, authUrl: result.authUrl };
  }
  async function run({ prompt, cwd: runCwd = cwd, signal, onEvent = () => {}, model } = {}) {
    if (active) throw Object.assign(Error('Another coding turn is running.'), { status: 409 });
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 64000) throw Object.assign(Error('A coding request under 64,000 characters is required.'), { status: 400 });
    active = true;
    const started = performance.now(); let threadId, turnId, text = '';
    try {
      if (!(await status()).authenticated) throw problem('Connect local Codex with a ChatGPT account before creating a mashup.');
      signal?.throwIfAborted();
      const result = await request('thread/start', { cwd: runCwd, modelProvider: 'openai', approvalPolicy: 'never', sandbox: 'workspace-write', ...(model ? { model } : {}) });
      threadId = result.thread.id;
      onEvent({ type: 'agent-session', threadId, message: `Local Codex construction thread ${threadId}` });
      signal?.throwIfAborted();
      return await new Promise((resolve, reject) => {
        let settled = false, cancelling = false, cancelTimer;
        const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(cancelTimer); events.off('notification', notify); events.off('transportError', transportError); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
        const cancelled = () => Object.assign(Error('Coding turn cancelled or timed out.'), { status: 504 });
        const interrupt = () => { if (turnId) request('turn/interrupt', { threadId, turnId }).catch(() => {}); };
        const abort = () => {
          if (cancelling || settled) return; cancelling = true;
          interrupt();
          // Keep the turn lock until completion. If Codex cannot acknowledge the stop,
          // stop this transport before permitting a new coding request.
          cancelTimer = setTimeout(() => { const proc = child; fail(cancelled()); proc?.kill(); finish(cancelled()); }, 2000);
        };
        const timer = setTimeout(abort, timeoutMs);
        const transportError = error => finish(cancelling ? cancelled() : error);
        const notify = message => {
          const p = message.params || {};
          if (p.threadId !== threadId) return;
          if (message.method === 'turn/started') { turnId = p.turn?.id; onEvent({ type: 'agent-session', threadId, turnId, message: `Local Codex construction turn ${turnId}` }); }
          if (message.method === 'item/agentMessage/delta') { text = (text + (p.delta || '')).slice(-128000); onEvent({ type: 'text', delta: p.delta || '' }); }
          if (message.method === 'item/started') onEvent({ type: 'activity', itemType: p.item?.type || 'working' });
          if (message.method === 'turn/completed') {
            if (cancelling) return finish(cancelled());
            const status = p.turn?.status;
            if (status !== 'completed') return finish(problem(`Coding turn ${status || 'failed'}. Review local Codex and retry.`));
            finish(null, { threadId, turnId: p.turn.id, status, text, wallMs: performance.now() - started });
          }
        };
        events.on('notification', notify); events.on('transportError', transportError); signal?.addEventListener('abort', abort, { once: true });
        request('turn/start', { threadId, input: [{ type: 'text', text: prompt }] }).then(value => { turnId = value.turn?.id || turnId; if (cancelling) interrupt(); else if (signal?.aborted) abort(); }, error => finish(error));
      });
    } catch (error) { error.threadId = threadId || null; error.turnId = turnId || null; throw error; } finally { active = false; }
  }
  return { status, login, run, async cancelLogin(loginId) { await connect(); return request('account/login/cancel', { loginId }); }, async logout() { await connect(); await request('account/logout'); return status(); }, close() { child?.kill(); } };
}
