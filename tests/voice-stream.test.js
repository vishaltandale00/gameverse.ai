import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { attachVoiceStream, realtimeTranscriptionProviders } from '../scripts/voice-stream.mjs';

async function fixture(t, { env = {}, upstreamEvent, silent = false } = {}) {
  const provider = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(provider, 'listening');
  const upstreamEvents = [], reports = [], peerSockets = [];
  provider.on('connection', peer => {
    peerSockets.push(peer);
    peer.on('message', raw => {
      const event = JSON.parse(raw.toString()); upstreamEvents.push(event);
      if (silent) return;
      if (upstreamEvent) { upstreamEvent(event, peer); return; }
      if (event.type === 'session.update') peer.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'input_audio_buffer.append') peer.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'one', delta: 'Live words ' }));
      if (event.type === 'input_audio_buffer.commit') {
        peer.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'one' }));
        peer.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'wrong-item', transcript: 'Wrong final' }));
        peer.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: 'Final corrected request' }));
      }
    });
  });
  const server = http.createServer((req, res) => res.writeHead(404).end());
  const clients = attachVoiceStream(server, { env: { OPENAI_API_KEY: 'server-secret', VOICE_TIMEOUT_MS: '100', ...env },
    providers: { openai: { ...realtimeTranscriptionProviders.openai, connect: () => new WebSocket(`ws://127.0.0.1:${provider.address().port}`) } }, report: entry => reports.push(entry) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  t.after(async () => {
    for (const client of clients.clients) client.terminate(); for (const peer of peerSockets) peer.terminate();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => provider.close(resolve))]);
    clients.close();
  });
  function connect(origin = `http://127.0.0.1:${port}`, id = randomUUID()) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice/stream?requestId=${id}`, { origin }), events = [];
    ws.on('message', raw => events.push(JSON.parse(raw.toString())));
    const wait = async type => {
      const existing = events.find(event => event.type === type); if (existing) return existing;
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.off('message', listener); reject(Error(`Missing ${type}`)); }, 1000);
        const listener = raw => { const event = JSON.parse(raw.toString()); if (event.type === type) { clearTimeout(timer); ws.off('message', listener); resolve(event); } };
        ws.on('message', listener);
      });
    };
    return { ws, wait, events };
  }
  return { connect, upstreamEvents, reports };
}

test('relay emits partial text before stop, orders PCM before commit, and matches the final item', async t => {
  const f = await fixture(t), c = f.connect(); await c.wait('ready');
  c.ws.send(Buffer.alloc(4800)); const partial = await c.wait('transcript'); assert.equal(partial.delta, 'Live words ');
  assert.equal(f.upstreamEvents.some(event => event.type === 'input_audio_buffer.commit'), false);
  c.ws.send(Buffer.alloc(100)); c.ws.send(JSON.stringify({ type: 'stop' }));
  const final = await c.wait('final'); assert.equal(final.text, 'Final corrected request');
  const commands = f.upstreamEvents.map(event => event.type);
  assert.deepEqual(commands.slice(-3), ['input_audio_buffer.append', 'input_audio_buffer.append', 'input_audio_buffer.commit']);
  const configured = f.upstreamEvents[0].session; assert.equal(configured.audio.input.transcription.model, 'gpt-live-transcribe'); assert.equal(configured.audio.input.turn_detection, null);
  await once(c.ws, 'close'); assert.equal(f.reports[0].outcome, 'passed'); assert.ok(f.reports[0].firstTextMs >= 0);
  assert.equal(JSON.stringify(c.events).includes('server-secret'), false);
});

test('B-style cancellation closes the provider without committing partial audio', async t => {
  const f = await fixture(t), c = f.connect(); await c.wait('ready'); c.ws.send(Buffer.alloc(4800)); await c.wait('transcript');
  c.ws.send(JSON.stringify({ type: 'cancel' })); await once(c.ws, 'close');
  assert.equal(f.upstreamEvents.some(event => event.type === 'input_audio_buffer.commit'), false); assert.equal(f.reports[0].outcome, 'cancelled');
});

test('rejects cross-origin websocket creation and invalid request IDs', async t => {
  const f = await fixture(t);
  for (const [origin, id] of [['https://example.org', randomUUID()], [undefined, '../bad']]) {
    const c = f.connect(origin, id); const [error] = await once(c.ws, 'error'); assert.match(error.message, /403/);
  }
});

test('stream size, provider timeout and unsupported provider fail visibly without a final transcript', async t => {
  for (const options of [{ env: { VOICE_MAX_BYTES: '10' } }, { silent: true, env: { VOICE_TIMEOUT_MS: '10' } }, { env: { TRANSCRIPTION_PROVIDER: 'not-installed' } }]) {
    const f = await fixture(t, options), c = f.connect();
    if (options.env.VOICE_MAX_BYTES) { await c.wait('ready'); c.ws.send(Buffer.alloc(4800)); }
    const failure = await c.wait('error'); assert.ok(failure.message); await once(c.ws, 'close');
    assert.equal(c.events.some(event => event.type === 'final'), false); assert.equal(f.reports[0].outcome, 'failed');
  }
});

test('provider errors are sanitized and invalid provider configuration cannot leak server data', async t => {
  const f = await fixture(t, { upstreamEvent(event, peer) { peer.send(JSON.stringify({ type: 'error', error: { code: 'invalid_model', message: 'server-secret' } })); } });
  const c = f.connect(); const result = await c.wait('error'); assert.equal(result.message.includes('server-secret'), false); await once(c.ws, 'close');
  assert.equal(f.reports[0].providerErrorCode, 'invalid_model');
});
