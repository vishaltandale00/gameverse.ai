import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const formats = new Map([['audio/webm', 'webm'], ['audio/mp4', 'mp4'], ['audio/wav', 'wav']]);
const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const failure = (status, message) => Object.assign(new Error(message), { status });
const positive = (value, fallback, max) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw Error('Invalid voice resource limit.');
  return number;
};

export function voiceConfiguration(env = process.env) {
  return {
    provider: env.TRANSCRIPTION_PROVIDER || 'openai',
    model: env.TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
    realtimeModel: env.TRANSCRIPTION_REALTIME_MODEL || 'gpt-live-transcribe',
    mode: 'realtime',
    maxSeconds: positive(env.VOICE_MAX_SECONDS, 120, 600),
    maxBytes: positive(env.VOICE_MAX_BYTES, 10 * 1024 * 1024, 24 * 1024 * 1024),
    timeoutMs: positive(env.VOICE_TIMEOUT_MS, 30000, 120000),
    maxStreams: positive(env.VOICE_MAX_STREAMS, 2, 8),
    recordButton: positive(env.VOICE_RECORD_BUTTON, 11, 16),
  };
}

// Providers implement one audio -> text boundary. Credentials never reach the client.
export const transcriptionProviders = {
  async openai({ audio, mime, model, signal, apiKey, fetchImpl }) {
    if (!apiKey) throw failure(503, 'Voice input needs OPENAI_API_KEY on the local server.');
    const body = new FormData();
    body.append('file', new Blob([audio], { type: mime }), `recording.${formats.get(mime)}`);
    body.append('model', model);
    const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body, signal,
    });
    // Never echo provider error bodies, which may contain sensitive request details.
    if (!response.ok) throw failure(502, `Transcription provider returned HTTP ${response.status}. Try again.`);
    const result = await response.json();
    if (typeof result.text !== 'string' || !result.text.trim()) throw failure(422, 'No speech was recognized. Try recording again.');
    return result.text.trim();
  },
};

async function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw failure(413, 'Recording is too large. Try a shorter clip.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw failure(413, 'Recording is too large. Try a shorter clip.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function validateContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)
    || !['base', 'subgame'].includes(context.role) || typeof context.gameId !== 'string' || !context.gameId
    || JSON.stringify(context).length > 16384) throw failure(400, 'A captured game target is required.');
  return context;
}

export function createVoiceApi({ env = process.env, liveProviders = {}, directory = new URL('../local-data/voice-requests/', import.meta.url),
  fetchImpl = fetch, providers = transcriptionProviders, report = entry => console.log(JSON.stringify(entry)) } = {}) {
  const config = voiceConfiguration(env), locks = new Map();
  const provider = Object.hasOwn(providers, config.provider) && typeof providers[config.provider] === 'function' ? providers[config.provider] : null;
  const file = id => new URL(`${id}.json`, directory);
  async function read(id) { try { return JSON.parse(await readFile(file(id), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async function update(id, work) {
    const previous = locks.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      await mkdir(directory, { recursive: true });
      const result = await work(await read(id));
      const temporary = new URL(`${id}.${randomUUID()}.tmp`, directory);
      await writeFile(temporary, JSON.stringify(result, null, 2), { mode: 0o600 });
      await rename(temporary, file(id));
      return result;
    });
    locks.set(id, current);
    try { return await current; } finally { if (locks.get(id) === current) locks.delete(id); }
  }
  function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data)); }
  return async function handleVoice(req, res, path) {
    if (!path.startsWith('/api/voice/')) return false;
    const started = performance.now(), controller = new AbortController();
    let outcome = 'failed', requestId = null;
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)) throw failure(403, 'Voice requests require the local app host.');
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) throw failure(403, 'Voice requests must come from this app.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw failure(403, 'Voice requests must come from this app.');
      if (req.method === 'GET' && path === '/api/voice/config') {
        json(res, 200, { ...config, model: config.realtimeModel, fileModel: config.model,
          available: Boolean((provider || Object.hasOwn(liveProviders, config.provider)) && (config.provider !== 'openai' || env.OPENAI_API_KEY)) });
      } else if (req.method === 'POST' && path === '/api/voice/transcriptions') {
        if (!provider) throw failure(503, `Transcription provider '${config.provider}' is not installed.`);
        if (config.provider === 'openai' && !env.OPENAI_API_KEY) throw failure(503, 'Voice input needs OPENAI_API_KEY on the local server.');
        const mime = (req.headers['content-type'] || '').split(';')[0];
        if (!formats.has(mime)) throw failure(415, 'Unsupported recording format. Use a supported browser.');
        const audio = await readBody(req, config.maxBytes);
        if (!audio.length) throw failure(400, 'The recording is empty. Try again.');
        requestId = req.headers['x-request-id'];
        if (!validId(requestId)) throw failure(400, 'Invalid voice request ID.');
        const text = await provider({ audio, mime, model: config.model, signal: controller.signal, apiKey: env.OPENAI_API_KEY, fetchImpl });
        controller.signal.throwIfAborted();
        if (!text?.trim() || text.length > 32000) throw failure(422, 'The transcript is empty or too long. Try a shorter recording.');
        json(res, 200, { requestId, text, provider: config.provider, model: config.model, transcriptionMs: performance.now() - started });
      } else if (req.method === 'POST' && path === '/api/voice/requests') {
        let body;
        try { body = JSON.parse(await readBody(req, 65536)); } catch (error) { if (error.status) throw error; throw failure(400, 'Invalid voice request.'); }
        requestId = body.requestId;
        if (!validId(requestId) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 32000) throw failure(400, 'A request ID and transcript are required.');
        const context = validateContext(body.context);
        const receipt = await update(requestId, previous => {
          if (previous?.status === 'cancelled') return previous;
          if (previous) {
            if (previous.text !== body.text || JSON.stringify(previous.context) !== JSON.stringify(context)) throw failure(409, 'Request ID already belongs to different input.');
            return previous;
          }
          return { schemaVersion: 1, requestId, status: 'received', text: body.text, context,
            receivedAt: new Date().toISOString(), processing: 'not-connected',
            transcription: { provider: config.provider, model: body.transcriptionMode === 'realtime' ? config.realtimeModel : config.model,
              mode: body.transcriptionMode === 'realtime' ? 'realtime' : 'file', wallMs: Number.isFinite(body.transcriptionMs) ? body.transcriptionMs : null } };
        });
        json(res, 200, receipt);
      } else if (req.method === 'DELETE' && path.startsWith('/api/voice/requests/')) {
        requestId = path.slice('/api/voice/requests/'.length);
        if (!validId(requestId)) throw failure(400, 'Invalid voice request ID.');
        const receipt = await update(requestId, previous => ({ schemaVersion: 1, ...previous, requestId, status: 'cancelled', cancelledAt: new Date().toISOString() }));
        json(res, 200, receipt);
      } else throw failure(404, 'Voice endpoint not found.');
      outcome = 'passed';
    } catch (error) {
      const aborted = controller.signal.aborted;
      outcome = aborted ? 'cancelled-or-timed-out' : 'failed';
      if (!res.destroyed && !res.writableEnded) json(res, aborted ? 504 : error.status || 500,
        { error: aborted ? 'Transcription stopped or timed out. Try again.' : error.status ? error.message : 'Voice request could not be saved. Try again.' });
    } finally {
      clearTimeout(timeout); res.off('close', disconnected);
      report({ operation: 'voice', requestId, path, provider: config.provider, model: config.model, outcome,
        wallMs: performance.now() - started, queueMs: null, timestamp: new Date().toISOString() });
    }
    return true;
  };
}
