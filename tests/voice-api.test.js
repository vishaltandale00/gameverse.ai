import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createVoiceApi, voiceConfiguration } from '../scripts/voice-api.mjs';

async function fixture(t, options = {}) {
  const path = await mkdtemp(`${tmpdir()}/gameverse-voice-`), directory = pathToFileURL(`${path}/`), calls = [], reports = [];
  const handler = createVoiceApi({ directory, env: { OPENAI_API_KEY: 'test-secret', VOICE_MAX_BYTES: '100' },
    fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ text: 'Make the forest darker.' })); }, report: entry => reports.push(entry), ...options });
  const server = http.createServer(async (req, res) => { if (!await handler(req, res, new URL(req.url, 'http://localhost').pathname)) res.writeHead(404).end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(path, { recursive: true, force: true }); });
  return { base, directory, calls, reports, fetch: (route, init) => fetch(base + route, init) };
}
const transcription = id => ({ method: 'POST', headers: { 'Content-Type': 'audio/webm;codecs=opus', 'X-Request-ID': id }, body: 'audio bytes' });
const request = id => ({ requestId: id, text: 'Make the forest darker.', context: { role: 'subgame', gameId: 'firered', identity: { cartridgeSha256: 'abc' }, progressRevision: 3 }, transcriptionMs: 12 });
const submission = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('OpenAI upload, durable idempotent receipt, original context and server-only key', async t => {
  const f = await fixture(t), id = randomUUID();
  const configuration = await (await f.fetch('/api/voice/config')).json();
  assert.equal(configuration.available, true); assert.equal(JSON.stringify(configuration).includes('test-secret'), false);
  const response = await f.fetch('/api/voice/transcriptions', transcription(id)); assert.equal(response.status, 200);
  assert.equal((await response.json()).text, 'Make the forest darker.');
  assert.equal(f.calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer test-secret');
  assert.equal(f.calls[0].init.body.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(await f.calls[0].init.body.get('file').text(), 'audio bytes');
  const body = request(id), first = await (await f.fetch('/api/voice/requests', submission(body))).json();
  const second = await (await f.fetch('/api/voice/requests', submission(body))).json();
  assert.deepEqual(second, first); assert.equal(first.status, 'received'); assert.equal(first.processing, 'not-connected');
  const stored = JSON.parse(await readFile(new URL(`${id}.json`, f.directory), 'utf8'));
  assert.deepEqual(stored.context, body.context); assert.equal('audio' in stored, false);
  assert.ok(f.reports.every(report => report.wallMs >= 0 && report.queueMs === null));
  const conflict = await f.fetch('/api/voice/requests', submission({ ...body, text: 'Different request' })); assert.equal(conflict.status, 409);
});

test('cancellation before, during and after submission always leaves a cancelled receipt', async t => {
  const f = await fixture(t);
  for (const order of ['before', 'during', 'after']) {
    const id = randomUUID(), post = () => f.fetch('/api/voice/requests', submission(request(id))), cancel = () => f.fetch(`/api/voice/requests/${id}`, { method: 'DELETE' });
    if (order === 'before') { await cancel(); await post(); }
    if (order === 'during') await Promise.all([post(), cancel()]);
    if (order === 'after') { await post(); await cancel(); }
    assert.equal(JSON.parse(await readFile(new URL(`${id}.json`, f.directory), 'utf8')).status, 'cancelled');
    assert.equal((await (await post()).json()).status, 'cancelled');
  }
});

test('rejects oversized/empty uploads, invalid context, cross-origin calls and invalid IDs', async t => {
  const f = await fixture(t), id = randomUUID();
  assert.equal((await f.fetch('/api/voice/transcriptions', { ...transcription(id), body: 'x'.repeat(101) })).status, 413);
  assert.equal((await f.fetch('/api/voice/transcriptions', { ...transcription(id), body: '' })).status, 400);
  assert.equal((await f.fetch('/api/voice/transcriptions', { ...transcription(id), headers: { ...transcription(id).headers, Origin: 'https://example.org' } })).status, 403);
  assert.equal((await f.fetch('/api/voice/transcriptions', transcription('../file'))).status, 400);
  assert.equal((await f.fetch('/api/voice/transcriptions', { ...transcription(id), headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.fetch('/api/voice/requests', submission({ ...request(id), context: {} }))).status, 400);
  assert.equal((await f.fetch('/api/voice/requests', submission({ ...request(id), context: { role: 'base', gameId: 'world', extra: 'x'.repeat(20000) } }))).status, 400);
  assert.equal(f.calls.length, 0);
});

test('missing key and unavailable providers fail honestly; provider failures do not leak secrets', async t => {
  const missing = await fixture(t, { env: {} });
  assert.equal((await missing.fetch('/api/voice/transcriptions', transcription(randomUUID()))).status, 503);
  const unsupported = await fixture(t, { env: { TRANSCRIPTION_PROVIDER: 'future-provider' } });
  assert.equal((await (await unsupported.fetch('/api/voice/config')).json()).available, false);
  assert.equal((await unsupported.fetch('/api/voice/transcriptions', transcription(randomUUID()))).status, 503);
  const failed = await fixture(t, { fetchImpl: async () => new Response('test-secret', { status: 401 }) });
  const response = await failed.fetch('/api/voice/transcriptions', transcription(randomUUID()));
  assert.equal(response.status, 502); assert.equal((await response.text()).includes('test-secret'), false);
});

test('provider/model selection and timeout are configurable without changing the client', async t => {
  let selected;
  const f = await fixture(t, { env: { TRANSCRIPTION_PROVIDER: 'fixture', TRANSCRIPTION_MODEL: 'fixture-model', VOICE_TIMEOUT_MS: '10' },
    providers: { fixture: async options => { selected = options.model; await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })); } } });
  assert.equal((await f.fetch('/api/voice/transcriptions', transcription(randomUUID()))).status, 504);
  assert.equal(selected, 'fixture-model'); assert.equal(f.reports.at(-1).outcome, 'cancelled-or-timed-out');
  assert.throws(() => voiceConfiguration({ VOICE_MAX_SECONDS: '0' }));
});
