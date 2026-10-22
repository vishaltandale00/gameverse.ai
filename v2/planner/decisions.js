// @ts-check
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
import { isObj, isList, isNum, isStr, obj, objects, prop, str, messageOf } from '../kernel/guards.js';

export const PROVIDERS = ['d1', 'openai'];

/**
 * A d1-shaped question. `type` is 'noul' | 'choice' | 'score' (typed string: callers build questions in
 * Object.fromEntries, where the literal widens). criteria: choice -> { option: description }, score -> levels.
 * @typedef {{ type: string, instructions: string, criteria?: Record<string, string> | string[] }} DecisionQuestion
 */
/** @typedef {Record<string, DecisionQuestion>} DecisionQuestions */
/**
 * A d1-shaped answer, narrowed from the provider's reply (fields of the wrong type are dropped).
 * probabilities: choice -> { option: p }, score -> [p per level].
 * @typedef {object} DecisionAnswer
 * @property {string} type
 * @property {number} [noul]
 * @property {string} [choice]
 * @property {number} [confidence]
 * @property {number} [score]
 * @property {Record<string, number> | number[]} [probabilities]
 */
/** @typedef {{ state: unknown, questions: DecisionQuestions, images?: string[] }} DecisionRequest */
/** @typedef {{ answers: Record<string, DecisionAnswer>, ms: number, model: string, provider: string }} DecisionResult */
/** @typedef {{ provider: string, url?: string, decide(request: DecisionRequest): Promise<DecisionResult> }} DecisionClient */
/** @typedef {typeof fetch} FetchLike */

/** @param {unknown} v @returns {number | undefined} */
const numOr = v => (isNum(v) ? v : undefined);
/** @param {unknown} v @returns {string | undefined} */
const strOr = v => (isStr(v) ? v : undefined);

/** d1 answers as the proxy returned them (network data), narrowed to DecisionAnswer. @param {unknown} raw @returns {Record<string, DecisionAnswer>} */
function answersOf(raw) {
  /** @type {Record<string, DecisionAnswer>} */
  const out = {};
  for (const [name, a] of Object.entries(obj(raw))) {
    if (!isObj(a)) continue;
    /** @type {DecisionAnswer} */
    const answer = { type: str(a.type) };
    if (isNum(a.noul)) answer.noul = a.noul;
    if (isStr(a.choice)) answer.choice = a.choice;
    if (isNum(a.confidence)) answer.confidence = a.confidence;
    if (isNum(a.score)) answer.score = a.score;
    if (isList(a.probabilities)) answer.probabilities = a.probabilities.filter(isNum);
    else if (isObj(a.probabilities)) {
      /** @type {Record<string, number>} */
      const probabilities = {};
      for (const [option, p] of Object.entries(a.probabilities)) if (isNum(p)) probabilities[option] = p;
      answer.probabilities = probabilities;
    }
    out[name] = answer;
  }
  return out;
}

/** @param {string} base */
const decisionsUrl = base => { const b = base.replace(/\/+$/, ''); return /\/v1$/.test(b) ? `${b}/decisions` : `${b}/v1/decisions`; };

/**
 * The parsed reply is network data: `unknown` until narrowed.
 * @param {FetchLike} fetchImpl @param {string} url @param {string | undefined} apiKey @param {unknown} body @param {number} timeoutMs
 * @returns {Promise<unknown>}
 */
async function post(fetchImpl, url, apiKey, body, timeoutMs) {
  const response = await fetchImpl(url, {
    method: 'POST', redirect: 'error', // never forward credentials through a redirect
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  /** @type {unknown} */
  const data = await response.json().catch(() => null);
  const message = prop(prop(data, 'error'), 'message');
  if (!response.ok || !prop(data, 'answers')) throw Object.assign(Error(`decisions returned HTTP ${response.status}${message ? ': ' + String(message).slice(0, 120) : ''}`), { status: 502 });
  return data;
}
/** @param {unknown} state @returns {string} */
const stateText = state => typeof state === 'string' ? state : JSON.stringify(state);

/**
 * d1 on the local proxy: the native wire format is already d1-shaped.
 * @param {{ base?: string, apiKey?: string, timeoutMs?: number, fetchImpl?: FetchLike }} [options]
 * @returns {DecisionClient & { url: string }}
 */
export function createD1Client({ base = 'http://rrh-llm-1:4000', apiKey = '', timeoutMs = 4000, fetchImpl = fetch } = {}) {
  const url = decisionsUrl(base);
  return {
    provider: 'd1', url,
    /** @param {DecisionRequest} request */
    async decide({ state, questions, images = [] }) {
      const started = performance.now();
      const data = await post(fetchImpl, url, apiKey, { state: stateText(state), questions, images }, timeoutMs);
      return { answers: answersOf(prop(data, 'answers')), ms: Math.round(performance.now() - started), model: str(prop(data, 'model')) || 'd1', provider: 'd1' };
    },
  };
}

/** @typedef {{ name: string, type: string, instructions: string, choices?: Array<{ value: string, description: string }>, levels?: Array<{ label: string, description: string }> }} OpenAIQuestion */

/**
 * OpenAI Decisions: translate d1-shaped questions to its list format and its answers back.
 * @param {DecisionQuestions} questions @returns {OpenAIQuestion[]}
 */
export function toOpenAI(questions) {
  return Object.entries(questions).map(([name, q]) => {
    /** @type {OpenAIQuestion} */
    const out = { name, type: q.type === 'noul' ? 'predicate' : q.type, instructions: q.instructions };
    if (q.type === 'noul' && q.criteria) out.instructions += '\n' + Object.entries(q.criteria).map(([side, text]) => `${side}: ${text}`).join('\n');
    // Our own question builders give choice questions an option map and score questions a level list.
    if (q.type === 'choice') out.choices = Object.entries(/** @type {Record<string, string>} */ (q.criteria)).map(([value, description]) => ({ value, description }));
    if (q.type === 'score') out.levels = /** @type {string[]} */ (q.criteria).map((description, i) => ({ label: `level_${i}`, description }));
    return out;
  });
}
/**
 * `list` is the provider's reply (network data): narrowed entry by entry.
 * @param {unknown} list @param {DecisionQuestions} questions @returns {Record<string, DecisionAnswer>}
 */
export function fromOpenAI(list, questions) {
  /** @type {Record<string, DecisionAnswer>} */
  const answers = {};
  for (const a of objects(list)) {
    const name = str(a.name);
    const q = Object.hasOwn(questions, name) ? questions[name] : undefined; if (!q) continue;
    if (a.type === 'refusal') { answers[name] = { type: 'refusal' }; continue; }
    if (q.type === 'noul') answers[name] = { type: 'noul', noul: numOr(a.probability) };
    else if (q.type === 'choice') {
      /** @type {Record<string, number>} */
      const probabilities = {};
      for (const p of objects(a.probabilities)) if (isNum(p.probability)) probabilities[String(p.value)] = p.probability;
      answers[name] = { type: 'choice', choice: strOr(a.choice), confidence: numOr(a.confidence), probabilities };
    } else answers[name] = { type: 'score', score: numOr(a.score), confidence: numOr(a.confidence), probabilities: objects(a.probabilities).sort((x, y) => Number(x.value) - Number(y.value)).flatMap(p => (isNum(p.probability) ? [p.probability] : [])) };
  }
  if (Object.keys(answers).length !== Object.keys(questions).length) throw Object.assign(Error('decisions answers do not match the questions'), { status: 502 });
  return answers;
}
/**
 * @param {{ apiKey?: string, base?: string, model?: string, timeoutMs?: number, fetchImpl?: FetchLike }} [options]
 * @returns {DecisionClient & { url: string }}
 */
export function createOpenAIDecisionsClient({ apiKey, base = 'https://api.openai.com', model = 'gpt-6-luna', timeoutMs = 8000, fetchImpl = fetch } = {}) {
  if (!apiKey) throw Error('OpenAI Decisions needs OPENAI_API_KEY');
  if (!/^https:\/\//.test(base)) throw Error('OpenAI Decisions must use HTTPS');
  const url = decisionsUrl(base);
  return {
    provider: 'openai', url,
    /** @param {DecisionRequest} request */
    async decide({ state, questions, images = [] }) {
      const started = performance.now();
      const input = images.length ? [{ role: 'user', content: [{ type: 'input_text', text: stateText(state) }, ...images.map(image_url => ({ type: 'input_image', image_url }))] }] : stateText(state);
      const data = await post(fetchImpl, url, apiKey, { model, input, questions: toOpenAI(questions) }, timeoutMs);
      return { answers: fromOpenAI(prop(data, 'answers'), questions), ms: Math.round(performance.now() - started), model: str(prop(data, 'model')) || model, provider: 'openai' };
    },
  };
}

/**
 * Prefer d1, but if its proxy can't be reached (no tailnet, a laptop without the
 * lab), switch to OpenAI Decisions for the rest of the process. HTTP errors from a
 * reachable d1 are returned as errors, not hidden by switching providers.
 * @param {{ d1: DecisionClient, openai: DecisionClient | null, log?: (msg: string) => void }} options
 * @returns {DecisionClient}
 */
export function createAutoDecisions({ d1, openai, log = () => {} }) {
  let active = d1;
  const unreachable = (/** @type {unknown} */ error) => prop(error, 'name') === 'TimeoutError' || prop(error, 'name') === 'AbortError' || error instanceof TypeError;
  return {
    get provider() { return active.provider; },
    /** @param {DecisionRequest} request */
    async decide(request) {
      try { return await active.decide(request); }
      catch (error) {
        if (active !== d1 || !openai || !unreachable(error)) throw error;
        log(`d1 at ${d1.url} is unreachable (${messageOf(error)}); using OpenAI Decisions from now on`);
        active = openai;
        return active.decide(request);
      }
    },
  };
}

/**
 * The decisions client for this environment. V2_DECISIONS picks the provider:
 * 'auto' (default: d1 when its proxy answers, else OpenAI Decisions), 'd1', 'openai', or 'off'.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ openaiKey?: string | null, log?: (msg: string) => void }} [options]
 * @returns {DecisionClient | null}
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
