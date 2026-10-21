// @ts-check
// Writers: the generative models behind the layered pipeline, one interface for
// every provider. A writer is { provider, model, complete({ system, user, schema?, effort?, maxTokens? }) -> { text, ms, model, usage } }.
// Roles follow ARCHITECTURE.md §4 (outline/detail/revise: the spec model; gaps: the code model).
// Decisions (yes/no/choice/score) stay on v2/planner/decisions.js; writers only write text.
import { createOpenAIClient } from './openai.js';
import { modelRouting, hasClaudeCredentials } from './models.js';
import { messageOf } from '../kernel/guards.js';

/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./types.js').Writers} Writers */

/** Adapt the OpenAI Responses client. `schema` is { name, schema } (strict) or omitted for a JSON object.
 * @param {{ client: import('./openai.js').OpenAIClient, model: string, effort?: string }} options @returns {Writer} */
export function openAIWriter({ client, model, effort }) {
  return {
    provider: 'openai', model,
    async complete({ system, user, schema, effort: e, onDelta }) {
      const r = await client.complete({ model, system, user, json: true, schema, effort: e ?? effort, onDelta });
      return { text: r.text, ms: r.ms, model: r.model, usage: r.usage || null };
    },
  };
}

/** Adapt the Claude client (models.js). Strict schemas are described in the prompt; the reply is parsed as JSON by callers.
 * @param {{ client: import('./models.js').ClaudeClient, model: string, effort?: string, maxTokens?: number }} options @returns {Writer} */
export function claudeWriter({ client, model, effort, maxTokens = 16000 }) {
  return {
    provider: 'anthropic', model,
    async complete({ system, user, schema, effort: e }) {
      const ask = schema ? `${user}\n\nReply with one JSON object matching this JSON schema, and nothing else:\n${JSON.stringify(schema.schema)}` : `${user}\n\nReply with the JSON object only.`;
      const r = await client.complete({ model, system, messages: [{ role: 'user', content: ask }], maxTokens, effort: e ?? effort });
      const start = r.text.indexOf('{'), end = r.text.lastIndexOf('}');
      return { text: start >= 0 ? r.text.slice(start, end + 1) : r.text, ms: r.ms, model: r.model, usage: r.usage || null };
    },
  };
}

/**
 * Writers for this environment: Claude (Sonnet for specs, Opus for code) when Anthropic
 * credentials and the SDK are present, else OpenAI when a key is present, else none
 * (the pipeline then runs procedurally and says so). V2_WRITER=off disables both.
 * @param {Record<string, string | undefined>} [env] @param {{ openaiKey?: string | null }} [options] @returns {Promise<Writers>}
 */
export async function createWriters(env = process.env, { openaiKey = env.OPENAI_API_KEY } = {}) {
  if (env.V2_WRITER === 'off') return { spec: null, code: null };
  const routing = modelRouting(env);
  if (hasClaudeCredentials(env) && env.V2_WRITER !== 'openai') {
    try {
      const { createClaudeClient } = await import('./models.js');
      const client = await createClaudeClient({ routing });
      return { spec: claudeWriter({ client, model: routing.spec, effort: routing.specEffort }), code: claudeWriter({ client, model: routing.code }) };
    } catch { /* SDK not installed: fall through to OpenAI */ }
  }
  if (openaiKey) {
    const client = createOpenAIClient({ apiKey: openaiKey, timeoutMs: Number(env.V2_MODEL_TIMEOUT_MS) || 90000 });
    const codeClient = createOpenAIClient({ apiKey: openaiKey, timeoutMs: 120000 });
    const spec = env.V2_KERNEL_MODEL || env.V2_OPENAI_DESIGN_MODEL || 'gpt-4.1-mini';
    const code = env.V2_EXPERIMENT_MODEL || 'gpt-6-luna';
    return { spec: openAIWriter({ client, model: spec }), code: openAIWriter({ client: codeClient, model: code, effort: /^(o\d|gpt-5|gpt-6)/.test(code) ? 'low' : undefined }) };
  }
  return { spec: null, code: null };
}

/**
 * Parse a writer reply into an object, tolerating fences and prose around it. The result is model output:
 * `unknown` until narrowed (kernel/guards.js) or validated (kernel/document.js preflight for documents).
 * @param {string} text @returns {unknown}
 */
export function parseReply(text) {
  try { return JSON.parse(text); } catch {}
  const start = String(text).indexOf('{'), end = String(text).lastIndexOf('}');
  if (start < 0 || end <= start) throw Object.assign(Error('the model reply has no JSON object'), { code: 'model_output_not_json' });
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch (error) { throw Object.assign(Error(`the model reply is not valid JSON: ${messageOf(error)}`), { code: 'model_output_not_json' }); }
}
