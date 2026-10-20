// Decision models: many yes/no, choice or score questions about one state in a
// single call, with probabilities and no generated text. Two interchangeable
// providers sit behind one interface, so local runs use d1 and hosted runs use
// OpenAI's Decisions API (see tools/decisions/README.md for both wire formats):
//
//   d1      the local LiteLLM proxy (LITELLM_BASE, default http://rrh-llm-1:4000); no key locally
//   openai  OpenAI Decisions (OPENAI_DECISIONS_BASE_URL, default https://api.openai.com), OPENAI_API_KEY
//
// Callers always write d1-shaped questions and read d1-shaped answers:
//   questions: { name: { type: 'noul'|'choice'|'score', instructions, criteria } }
//     choice criteria: { option: description }; score criteria: [level descriptions, low → high]
//   answers:   { name: { type, noul } | { type, choice, probabilities: { option: p }, confidence } | { type, score, probabilities: [p] } }
export const PROVIDERS = ['d1', 'openai'];

const decisionsUrl = base => { const b = base.replace(/\/+$/, ''); return /\/v1$/.test(b) ? `${b}/decisions` : `${b}/v1/decisions`; };

async function post(fetchImpl, url, apiKey, body, timeoutMs) {
  const response = await fetchImpl(url, {
    method: 'POST', redirect: 'error', // never forward credentials through a redirect
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.answers) throw Object.assign(Error(`decisions returned HTTP ${response.status}${data?.error?.message ? ': ' + String(data.error.message).slice(0, 120) : ''}`), { status: 502 });
  return data;
}
const stateText = state => typeof state === 'string' ? state : JSON.stringify(state);

/** d1 on the local proxy: the native wire format is already d1-shaped. */
export function createD1Client({ base = 'http://rrh-llm-1:4000', apiKey = '', timeoutMs = 4000, fetchImpl = fetch } = {}) {
  const url = decisionsUrl(base);
  return {
    provider: 'd1', url,
    async decide({ state, questions, images = [] }) {
      const started = performance.now();
      const data = await post(fetchImpl, url, apiKey, { state: stateText(state), questions, images }, timeoutMs);
      return { answers: data.answers, ms: Math.round(performance.now() - started), model: data.model || 'd1', provider: 'd1' };
    },
  };
}

/** OpenAI Decisions: translate d1-shaped questions to its list format and its answers back. */
export function toOpenAI(questions) {
  return Object.entries(questions).map(([name, q]) => {
    const out = { name, type: q.type === 'noul' ? 'predicate' : q.type, instructions: q.instructions };
    if (q.type === 'noul' && q.criteria) out.instructions += '\n' + Object.entries(q.criteria).map(([side, text]) => `${side}: ${text}`).join('\n');
    if (q.type === 'choice') out.choices = Object.entries(q.criteria).map(([value, description]) => ({ value, description }));
    if (q.type === 'score') out.levels = q.criteria.map((description, i) => ({ label: `level_${i}`, description }));
    return out;
  });
}
export function fromOpenAI(list, questions) {
  const answers = {};
  for (const a of list || []) {
    const q = questions[a.name]; if (!q) continue;
    if (a.type === 'refusal') { answers[a.name] = { type: 'refusal' }; continue; }
    if (q.type === 'noul') answers[a.name] = { type: 'noul', noul: a.probability };
    else if (q.type === 'choice') answers[a.name] = { type: 'choice', choice: a.choice, confidence: a.confidence, probabilities: Object.fromEntries((a.probabilities || []).map(p => [p.value, p.probability])) };
    else answers[a.name] = { type: 'score', score: a.score, confidence: a.confidence, probabilities: (a.probabilities || []).sort((x, y) => x.value - y.value).map(p => p.probability) };
  }
  if (Object.keys(answers).length !== Object.keys(questions).length) throw Object.assign(Error('decisions answers do not match the questions'), { status: 502 });
  return answers;
}
export function createOpenAIDecisionsClient({ apiKey, base = 'https://api.openai.com', model = 'gpt-6-luna', timeoutMs = 8000, fetchImpl = fetch } = {}) {
  if (!apiKey) throw Error('OpenAI Decisions needs OPENAI_API_KEY');
  if (!/^https:\/\//.test(base)) throw Error('OpenAI Decisions must use HTTPS');
  const url = decisionsUrl(base);
  return {
    provider: 'openai', url,
    async decide({ state, questions, images = [] }) {
      const started = performance.now();
      const input = images.length ? [{ role: 'user', content: [{ type: 'input_text', text: stateText(state) }, ...images.map(image_url => ({ type: 'input_image', image_url }))] }] : stateText(state);
      const data = await post(fetchImpl, url, apiKey, { model, input, questions: toOpenAI(questions) }, timeoutMs);
      return { answers: fromOpenAI(data.answers, questions), ms: Math.round(performance.now() - started), model: data.model || model, provider: 'openai' };
    },
  };
}

/**
 * Prefer d1, but if its proxy can't be reached (no tailnet, a laptop without the
 * lab), switch to OpenAI Decisions for the rest of the process. HTTP errors from a
 * reachable d1 are returned as errors, not hidden by switching providers.
 */
export function createAutoDecisions({ d1, openai, log = () => {} }) {
  let active = d1;
  const unreachable = error => error?.name === 'TimeoutError' || error?.name === 'AbortError' || error instanceof TypeError;
  return {
    get provider() { return active.provider; },
    async decide(request) {
      try { return await active.decide(request); }
      catch (error) {
        if (active !== d1 || !openai || !unreachable(error)) throw error;
        log(`d1 at ${d1.url} is unreachable (${error.message}); using OpenAI Decisions from now on`);
        active = openai;
        return active.decide(request);
      }
    },
  };
}

/**
 * The decisions client for this environment. V2_DECISIONS picks the provider:
 * 'auto' (default: d1 when its proxy answers, else OpenAI Decisions), 'd1', 'openai', or 'off'.
 */
export function createDecisions(env = process.env, { openaiKey = env.OPENAI_API_KEY, log = msg => console.warn(`[v2] ${msg}`) } = {}) {
  const provider = env.V2_DECISIONS || 'auto';
  if (provider === 'off') return null;
  const openai = () => openaiKey ? createOpenAIDecisionsClient({ apiKey: openaiKey, base: env.OPENAI_DECISIONS_BASE_URL || undefined, model: env.V2_DECISIONS_MODEL || undefined }) : null;
  const d1 = () => createD1Client({ base: env.LITELLM_BASE || undefined, apiKey: env.LITELLM_API_KEY || '', timeoutMs: provider === 'auto' ? 1500 : 4000 });
  if (provider === 'openai') { const c = openai(); if (!c) throw Error('V2_DECISIONS=openai needs OPENAI_API_KEY'); return c; }
  if (provider === 'd1') return d1();
  if (provider === 'auto') return createAutoDecisions({ d1: d1(), openai: openai(), log });
  throw Error(`V2_DECISIONS must be auto, ${PROVIDERS.join(', ')} or off`);
}
