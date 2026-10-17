import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createChatgptAuthApi } from '../scripts/chatgpt-auth-api.mjs';
async function call(api, path, { method = 'GET', host = '127.0.0.1:4173', origin, body = '' } = {}) {
  const req = Readable.from([body]); req.method = method; req.headers = { host, ...(origin ? { origin } : {}) };
  const res = { writeHead(code) { this.code = code; return this; }, end(data) { this.body = JSON.parse(data); } };
  await api.handle(req, res, path); return res;
}
test('local account status is returned without exposing raw account credentials', async () => {
  const api = createChatgptAuthApi({ agent: { status: async () => ({ authenticated: true, authMode: 'chatgpt' }) } });
  const res = await call(api, '/api/chatgpt/status'); assert.equal(res.code, 200); assert.equal(res.body.authenticated, true);
});
test('cross-origin and DNS-rebound login requests are rejected before touching credentials', async () => {
  let calls = 0; const api = createChatgptAuthApi({ agent: { login: async () => { calls++; } } });
  assert.equal((await call(api, '/api/chatgpt/login', { method: 'POST', origin: 'https://evil.example' })).code, 403);
  assert.equal((await call(api, '/api/chatgpt/login', { method: 'POST', host: 'evil.example' })).code, 403); assert.equal(calls, 0);
});
test('malformed cancellation body returns a controlled client error', async () => {
  const api = createChatgptAuthApi({ agent: {} });
  assert.equal((await call(api, '/api/chatgpt/cancel', { method: 'POST', body: '{' })).code, 400);
});
