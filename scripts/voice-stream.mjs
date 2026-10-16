import WebSocket, { WebSocketServer } from 'ws';
import { voiceConfiguration } from './voice-api.mjs';

const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value || '');
export const realtimeTranscriptionProviders = {
  openai: {
    connect: ({ env }) => new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, maxPayload: 1024 * 1024,
    }),
    configure: config => ({ type: 'session.update', session: {
      type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 },
        transcription: { model: config.realtimeModel, delay: 'low' }, turn_detection: null } },
    } }),
    audio: data => ({ type: 'input_audio_buffer.append', audio: data.toString('base64') }),
    stop: () => ({ type: 'input_audio_buffer.commit' }),
    event: event => {
      if (['session.updated', 'transcription_session.updated'].includes(event.type)) return { type: 'ready' };
      if (event.type === 'input_audio_buffer.committed') return { type: 'committed', itemId: event.item_id };
      if (event.type === 'conversation.item.input_audio_transcription.delta') return { type: 'transcript', itemId: event.item_id, delta: event.delta || '' };
      if (event.type === 'conversation.item.input_audio_transcription.completed') return { type: 'final', itemId: event.item_id, text: event.transcript };
      if (['error', 'conversation.item.input_audio_transcription.failed'].includes(event.type)) return { type: 'error', code: event.error?.code || event.code || null };
      return null;
    },
  },
};

// The browser protocol is provider-independent: PCM16 binary, stop/cancel JSON,
// then ready/transcript/final/error events. Only this adapter speaks OpenAI events.
export function attachVoiceStream(server, { env = process.env, providers = realtimeTranscriptionProviders,
  report = entry => console.log(JSON.stringify(entry)) } = {}) {
  const config = voiceConfiguration(env), clients = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  let active = 0;
  server.on('upgrade', (req, socket, head) => {
    let url, hostname;
    const host = req.headers.host;
    try { url = new URL(req.url, 'http://localhost'); hostname = new URL(`http://${host}`).hostname; }
    catch { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    if (url.pathname !== '/api/voice/stream') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)
      || req.headers.origin !== `http://${host}` || !validId(url.searchParams.get('requestId')) || active >= config.maxStreams) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    clients.handleUpgrade(req, socket, head, client => {
      active++;
      const requestId = url.searchParams.get('requestId'), started = performance.now();
      let upstream, ready = false, finishing = false, ended = false, bytes = 0, firstTextMs = null, outcome = 'cancelled';
      let deadline, duration, providerErrorCode = null, committedItemId = null;
      const send = value => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value)); };
      function cleanup() {
        if (ended) return;
        ended = true; active--; clearTimeout(deadline); clearTimeout(duration);
        if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
        report({ operation: 'live-transcription', requestId, provider: config.provider, model: config.realtimeModel,
          outcome, providerErrorCode, wallMs: performance.now() - started, firstTextMs, audioBytes: bytes, queueMs: null, timestamp: new Date().toISOString() });
      }
      function fail(message) { if (ended) return; outcome = 'failed'; send({ type: 'error', message }); cleanup(); client.close(); }
      function timeout(message) { clearTimeout(deadline); deadline = setTimeout(() => fail(message), config.timeoutMs); }
      client.on('close', cleanup);
      client.on('error', () => fail('The voice connection was interrupted. Try again.'));
      const provider = Object.hasOwn(providers, config.provider) && providers[config.provider];
      if (!provider || (config.provider === 'openai' && !env.OPENAI_API_KEY)) {
        fail(!provider ? `Live transcription provider '${config.provider}' is not installed.` : 'Voice input needs OPENAI_API_KEY on the local server.'); return;
      }
      timeout('Live transcription could not connect in time. Try again.');
      try { upstream = provider.connect({ env, config }); } catch { fail('Live transcription could not connect. Try again.'); return; }
      upstream.on('error', () => fail('The transcription provider connection failed. Check the server configuration.'));
      upstream.on('close', () => { if (!ended) fail('The transcription provider disconnected before the final transcript. Try again.'); });
      upstream.on('open', () => upstream.send(JSON.stringify(provider.configure(config))));
      upstream.on('message', raw => {
        if (ended) return;
        let event;
        try { event = provider.event(JSON.parse(raw.toString())); } catch { fail('The transcription provider returned an invalid event.'); return; }
        if (!event) return;
        if (event.type === 'ready') {
          if (ready) return;
          ready = true; clearTimeout(deadline);
          duration = setTimeout(() => fail('The recording reached its time limit. Please try a shorter request.'), (config.maxSeconds + 5) * 1000);
          send({ type: 'ready', provider: config.provider, model: config.realtimeModel });
        } else if (event.type === 'committed') {
          committedItemId = event.itemId;
        } else if (event.type === 'transcript') {
          if (firstTextMs === null && event.delta) firstTextMs = performance.now() - started;
          send({ type: 'transcript', itemId: event.itemId, delta: event.delta || '' });
        } else if (event.type === 'final' && finishing) {
          if (committedItemId && event.itemId !== committedItemId) return;
          const text = event.text?.trim();
          if (!text) { fail('No speech was recognized. Try recording again.'); return; }
          outcome = 'passed';
          send({ type: 'final', text, itemId: event.itemId, transcriptionMs: performance.now() - started, firstTextMs,
            provider: config.provider, model: config.realtimeModel });
          cleanup(); client.close();
        } else if (event.type === 'error') {
          providerErrorCode = event.code;
          // Never forward raw provider error payloads or request details.
          fail('Live transcription was rejected by the provider. Check the configured realtime model and account access.');
        }
      });
      client.on('message', (data, binary) => {
        if (ended) return;
        if (binary) {
          if (!ready || finishing) { fail('Audio arrived outside the recording session.'); return; }
          bytes += data.length;
          if (!data.length || data.length % 2 || bytes > Math.min(config.maxBytes, config.maxSeconds * 48000)
            || upstream.bufferedAmount > 1024 * 1024) { fail('The audio stream exceeded its resource limit. Try a shorter request.'); return; }
          upstream.send(JSON.stringify(provider.audio(data)));
        } else {
          let command;
          try { command = JSON.parse(data.toString()); } catch { fail('Invalid voice command.'); return; }
          if (command.type === 'cancel') { cleanup(); client.close(); }
          else if (command.type === 'stop' && ready && !finishing) {
            if (bytes < 4800) { fail('The recording was too short. Try again.'); return; }
            finishing = true; clearTimeout(duration); timeout('The final transcript did not arrive in time. Try again.');
            // WebSocket ordering guarantees every earlier audio frame precedes commit.
            upstream.send(JSON.stringify(provider.stop()));
          } else fail('Invalid voice command for the current session.');
        }
      });
    });
  });
  return clients;
}
