// Server-only provider boundary for voice-triggered takeover. Credentials stay
// in this process: the browser calls these local endpoints, never a provider,
// and no key reaches client source, logs or receipts.
//
// Gameplay decisions and the one-shot planner use the Decisions API
// (https://developers.openai.com/api/docs/guides/decisions, POST /v1/decisions,
// question types predicate|choice|score, answers[].choice). Reflections use the
// Responses API (https://developers.openai.com/api/docs/guides/text,
// POST /v1/responses, text inside output[].content[].text). Speech uses the
// documented audio/speech endpoint. Schedules, prompts and freshness rules stay
// in the browser-side versioned harness; this file only executes one call.
const failure = (status, message) => Object.assign(Error(message), { status });
const positive = (value, fallback, max) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw Error('Invalid agent resource limit.');
  return number;
};
const SPEECH_FORMATS = new Map([['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['opus', 'audio/ogg']]);

export function agentConfiguration(env = process.env) {
  return {
    provider: env.AGENT_PROVIDER || 'openai',
    decisionsModel: env.DECISIONS_MODEL || 'gpt-6-luna',
    plannerModel: env.AGENT_PLANNER_MODEL || env.DECISIONS_MODEL || 'gpt-6-luna',
    reflectionModel: env.AGENT_REFLECTION_MODEL || 'gpt-6-astra',
    speechModel: env.AGENT_SPEECH_MODEL || 'gpt-4o-mini-tts',
    speechVoice: env.AGENT_SPEECH_VOICE || 'alloy',
    speechFormat: SPEECH_FORMATS.has(env.AGENT_SPEECH_FORMAT) ? env.AGENT_SPEECH_FORMAT : 'wav',
    decisionsUrl: env.DECISIONS_URL || 'https://api.openai.com/v1/decisions',
    responsesUrl: env.AGENT_RESPONSES_URL || 'https://api.openai.com/v1/responses',
    speechUrl: env.AGENT_SPEECH_URL || 'https://api.openai.com/v1/audio/speech',
    timeoutMs: positive(env.AGENT_TIMEOUT_MS, 20000, 120000),
    maxDecisionsPerMinute: positive(env.AGENT_MAX_DECISIONS_PER_MINUTE, 240, 3000),
    maxReflectionsPerMinute: positive(env.AGENT_MAX_REFLECTIONS_PER_MINUTE, 20, 300),
    maxSpeechPerMinute: positive(env.AGENT_MAX_SPEECH_PER_MINUTE, 12, 120),
    maxBytes: positive(env.AGENT_MAX_BYTES, 256 * 1024, 4 * 1024 * 1024),
  };
}

// One call per boundary. Provider error bodies are never echoed back.
export const agentProviders = {
  openai: {
    async decisions({ body, config, apiKey, fetchImpl, signal }) {
      const response = await fetchImpl(config.decisionsUrl, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal,
      });
      if (!response.ok) throw failure(502, `Decisions provider returned HTTP ${response.status}.`);
      const result = await response.json();
      if (!Array.isArray(result?.answers)) throw failure(502, 'Decisions response has no answers array.');
      return { answers: result.answers, usage: result.usage || null };
    },
    async reflect({ body, config, apiKey, fetchImpl, signal }) {
      const response = await fetchImpl(config.responsesUrl, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal,
      });
      if (!response.ok) throw failure(502, `Reflection provider returned HTTP ${response.status}.`);
      const result = await response.json();
      // output[0].content[0].text is explicitly not guaranteed; aggregate instead.
      const text = typeof result?.output_text === 'string' ? result.output_text
        : (result?.output || []).flatMap(item => item?.content || [])
          .filter(part => part?.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('\n').trim();
      if (!text) throw failure(502, 'Reflection response contained no text.');
      return { text, usage: result.usage || null };
    },
    async speech({ body, config, apiKey, fetchImpl, signal }) {
      const response = await fetchImpl(config.speechUrl, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal,
      });
      if (!response.ok) throw failure(502, `Speech provider returned HTTP ${response.status}.`);
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length) throw failure(502, 'Speech provider returned empty audio.');
      return { audio, mime: SPEECH_FORMATS.get(config.speechFormat) };
    },
  },
};

async function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw failure(413, 'Agent request is too large.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw failure(413, 'Agent request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw failure(400, 'Invalid agent request body.'); }
}

// Predicate criteria are part of the portable contract, not the provider wire
// format: tools/decisions/client.py folds them into the instructions for the
// openai provider, and sending them raw returns HTTP 400.
export function toDecisionsWire(questions) {
  return questions.map(question => {
    if (question.type !== 'predicate') return question;
    const { true_description: yes, false_description: no, ...rest } = question;
    const criteria = [yes ? `true: ${yes}` : null, no ? `false: ${no}` : null].filter(Boolean);
    return criteria.length ? { ...rest, instructions: `${rest.instructions}\n${criteria.join('\n')}` } : rest;
  });
}

// Request shapes are validated here so a compromised page cannot turn the local
// server into an arbitrary provider proxy.
function validateQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length || questions.length > 24) throw failure(400, 'A question list is required.');
  const names = new Set();
  for (const question of questions) {
    if (!question || typeof question.name !== 'string' || !question.name || names.has(question.name)) throw failure(400, 'Invalid or duplicate question name.');
    names.add(question.name);
    if (!['choice', 'predicate', 'score'].includes(question.type)) throw failure(400, `Unsupported question type '${question.type}'.`);
    if (typeof question.instructions !== 'string' || !question.instructions) throw failure(400, 'Each question needs instructions.');
    const rows = question.type === 'choice' ? question.choices : question.type === 'score' ? question.levels : null;
    if (rows !== null && (!Array.isArray(rows) || rows.length < 2 || rows.length > 255)) throw failure(400, 'Invalid choice or level list.');
  }
  return questions;
}
const limited = (bucket, perMinute, now) => {
  const cutoff = now - 60000;
  while (bucket.length && bucket[0] < cutoff) bucket.shift();
  if (bucket.length >= perMinute) throw failure(429, 'Agent provider rate limit reached. Stop a run or wait.');
  bucket.push(now);
};

// Global qualification caps. Every attempt counts, including failures and
// timeouts, and there are no automatic retries anywhere in this path.
export const QUALIFICATION_CAPS = { decisions: 600, reflect: 6, plan: 4, speech: 4, transcription: 4 };

// Global caps exist for a bounded qualification run only. In ordinary play there
// is no global ceiling here: finite per-run policy lives in the versioned
// harness, so the app is not permanently exhausted until a restart.
export function qualificationCaps(env = process.env) {
  if (env.QUALIFICATION_MODE !== '1') return null;
  const capFor = (name, fallback) => {
    if (env[name] === undefined) return fallback;
    const value = Number(env[name]);
    if (!Number.isInteger(value) || value < 0 || value > 10000) throw Error(`Invalid ${name}.`);
    return value;
  };
  return {
    decisions: capFor('QUALIFICATION_DECISION_CAP', QUALIFICATION_CAPS.decisions),
    reflect: capFor('QUALIFICATION_REFLECT_CAP', QUALIFICATION_CAPS.reflect),
    plan: capFor('QUALIFICATION_PLAN_CAP', QUALIFICATION_CAPS.plan),
    speech: capFor('QUALIFICATION_SPEECH_CAP', QUALIFICATION_CAPS.speech),
    transcription: capFor('QUALIFICATION_TRANSCRIPTION_CAP', QUALIFICATION_CAPS.transcription),
  };
}

export function createAgentApi({ env = process.env, fetchImpl = fetch, providers = agentProviders,
  caps = qualificationCaps(env), ledger = { decisions: 0, reflect: 0, plan: 0, speech: 0, transcription: 0, aborted: null, attempts: [] },
  report = entry => console.log(JSON.stringify(entry)) } = {}) {
  const config = agentConfiguration(env);
  const capped = kind => {
    const limit = caps?.[kind];
    if (!Number.isFinite(limit)) return;
    if (ledger[kind] >= limit) {
      ledger.aborted = ledger.aborted || { kind, at: new Date().toISOString() };
      throw failure(429, `Qualification cap reached for ${kind} (${limit}). The run is aborted; no retry is attempted.`);
    }
    ledger[kind] += 1;
    ledger.attempts.push({ kind, at: new Date().toISOString() });
  };
  const provider = Object.hasOwn(providers, config.provider) ? providers[config.provider] : null;
  const buckets = { decisions: [], reflect: [], speech: [] };
  const key = () => {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw failure(503, 'Agent gameplay needs OPENAI_API_KEY on the local server.');
    return apiKey;
  };
  const json = (res, status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  return async function handleAgent(req, res, path) {
    if (!path.startsWith('/api/agent/')) return false;
    const started = performance.now(), controller = new AbortController();
    let outcome = 'failed', operation = path.slice('/api/agent/'.length), runId = null;
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)) throw failure(403, 'Agent requests require the local app host.');
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) throw failure(403, 'Agent requests must come from this app.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw failure(403, 'Agent requests must come from this app.');
      if (req.method === 'GET' && path === '/api/agent/config') {
        // Never expose credentials: only whether the server can call out.
        json(res, 200, { sourceCommit: env.SOURCE_COMMIT || null, caps, qualificationMode: env.QUALIFICATION_MODE === '1',
          provider: config.provider, decisionsModel: config.decisionsModel, plannerModel: config.plannerModel,
          reflectionModel: config.reflectionModel, speechModel: config.speechModel, speechFormat: config.speechFormat,
          timeoutMs: config.timeoutMs, limits: { decisionsPerMinute: config.maxDecisionsPerMinute, reflectionsPerMinute: config.maxReflectionsPerMinute, speechPerMinute: config.maxSpeechPerMinute },
          available: Boolean(provider && (config.provider !== 'openai' || env.OPENAI_API_KEY)),
          documentation: { decisions: 'https://developers.openai.com/api/docs/guides/decisions', reflections: 'https://developers.openai.com/api/docs/guides/text' } });
      } else if (req.method === 'GET' && path === '/api/agent/ledger') {
        json(res, 200, { caps, qualificationMode: env.QUALIFICATION_MODE === '1',
          ledger: { ...ledger, attempts: ledger.attempts.slice(-200) } });
      } else if (req.method === 'POST' && (path === '/api/agent/decisions' || path === '/api/agent/plan')) {
        if (!provider) throw failure(503, `Agent provider '${config.provider}' is not installed.`);
        const body = await readBody(req, config.maxBytes);
        runId = typeof body.runId === 'string' ? body.runId.slice(0, 64) : null;
        if (typeof body.state !== 'string' || !body.state.trim()) throw failure(400, 'An observation state string is required.');
        limited(buckets.decisions, config.maxDecisionsPerMinute, Date.now());
        capped(path === '/api/agent/plan' ? 'plan' : 'decisions');
        const model = path === '/api/agent/plan' ? config.plannerModel : config.decisionsModel;
        const result = await provider.decisions({ body: { model, input: body.state, questions: toDecisionsWire(validateQuestions(body.questions)) },
          config, apiKey: key(), fetchImpl, signal: controller.signal });
        controller.signal.throwIfAborted();
        json(res, 200, { answers: result.answers, provider: config.provider, model, usage: result.usage, wallMs: performance.now() - started });
      } else if (req.method === 'POST' && path === '/api/agent/reflect') {
        if (!provider) throw failure(503, `Agent provider '${config.provider}' is not installed.`);
        const body = await readBody(req, config.maxBytes);
        runId = typeof body.runId === 'string' ? body.runId.slice(0, 64) : null;
        if (typeof body.input !== 'string' || !body.input.trim()) throw failure(400, 'Reflection input text is required.');
        limited(buckets.reflect, config.maxReflectionsPerMinute, Date.now());
        capped('reflect');
        const result = await provider.reflect({ body: { model: config.reflectionModel, input: body.input },
          config, apiKey: key(), fetchImpl, signal: controller.signal });
        controller.signal.throwIfAborted();
        json(res, 200, { text: result.text, provider: config.provider, model: config.reflectionModel, usage: result.usage, wallMs: performance.now() - started });
      } else if (req.method === 'POST' && path === '/api/agent/speech') {
        if (!provider) throw failure(503, `Agent provider '${config.provider}' is not installed.`);
        const body = await readBody(req, config.maxBytes);
        runId = typeof body.runId === 'string' ? body.runId.slice(0, 64) : null;
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1000) throw failure(400, 'Speech text is required and must be short.');
        limited(buckets.speech, config.maxSpeechPerMinute, Date.now());
        capped('speech');
        const result = await provider.speech({ body: { model: config.speechModel, voice: body.voice || config.speechVoice, input: body.text, response_format: config.speechFormat },
          config, apiKey: key(), fetchImpl, signal: controller.signal });
        controller.signal.throwIfAborted();
        res.writeHead(200, { 'Content-Type': result.mime, 'Content-Length': result.audio.length,
          'X-Agent-Model': config.speechModel, 'Cache-Control': 'no-store' }).end(result.audio);
      } else throw failure(404, 'Agent endpoint not found.');
      outcome = 'passed';
    } catch (error) {
      const aborted = controller.signal.aborted;
      outcome = aborted ? 'cancelled-or-timed-out' : 'failed';
      if (!res.destroyed && !res.writableEnded) json(res, aborted ? 504 : error.status || 500,
        { error: aborted ? 'The agent provider call stopped or timed out.' : error.status ? error.message : 'The agent request could not be completed.' });
    } finally {
      clearTimeout(timeout); res.off('close', disconnected);
      report({ operation: `agent:${operation}`, runId, provider: config.provider, outcome, wallMs: performance.now() - started, queueMs: null, timestamp: new Date().toISOString() });
    }
    return true;
  };
}
