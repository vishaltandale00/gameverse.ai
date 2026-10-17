import { createCodexAgent } from './codex-agent.mjs';
const json = (res, status, body) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
export function createChatgptAuthApi({ agent = createCodexAgent() } = {}) {
  return { agent, async handle(req, res, path) {
    if (!path.startsWith('/api/chatgpt/')) return false;
    try {
      const host = new URL(`http://${req.headers.host}`);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) || (req.headers.origin && req.headers.origin !== host.origin) || req.headers['sec-fetch-site'] === 'cross-site') throw Object.assign(Error('Connect through this local app.'), { status: 403 });
      if (path === '/api/chatgpt/status' && req.method === 'GET') json(res, 200, await agent.status());
      else if (path === '/api/chatgpt/login' && req.method === 'POST') json(res, 200, await agent.login());
      else if (path === '/api/chatgpt/logout' && req.method === 'POST') json(res, 200, await agent.logout());
      else if (path === '/api/chatgpt/cancel' && req.method === 'POST') {
        let input = ''; for await (const chunk of req) { input += chunk; if (input.length > 1024) throw Object.assign(Error('Invalid login request.'), { status: 400 }); }
        let body; try { body = JSON.parse(input); } catch { throw Object.assign(Error('Invalid login request.'), { status: 400 }); }
        if (typeof body.loginId !== 'string' || body.loginId.length > 128) throw Object.assign(Error('Invalid login request.'), { status: 400 });
        await agent.cancelLogin(body.loginId); json(res, 200, { cancelled: true });
      } else json(res, 404, { error: 'ChatGPT endpoint not found.' });
    } catch (error) { json(res, error.status || 503, { error: error.status ? error.message : 'Local Codex is unavailable. Check its installation and reconnect.' }); }
    return true;
  } };
}
