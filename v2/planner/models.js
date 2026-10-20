// Model routing for v2 (user decision): Haiku for exploration and quick
// tweaks, Sonnet for writing and repairing game specs, Opus for writing code.

export function modelRouting(env = process.env) {
  return {
    explore: env.V2_EXPLORE_MODEL || 'claude-haiku-5-5',
    spec: env.V2_SPEC_MODEL || 'claude-sonnet-5-5',
    code: env.V2_CODE_MODEL || 'claude-opus-5-5',
    // Spec writing is latency-bound; low effort keeps a first draft to seconds.
    specEffort: env.V2_SPEC_EFFORT || 'low',
    timeoutMs: Number(env.V2_MODEL_TIMEOUT_MS) || 45000,
  };
}

export const hasClaudeCredentials = (env = process.env) => Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);

// Server-side refusal fallback is available for Sonnet 5.5 / Opus on the Claude API, not for Haiku.
const SUPPORTS_FALLBACK = model => /^claude-(sonnet|opus)-/.test(model);

/** Thin client: complete({ model, system, messages, maxTokens, effort }) -> { text, ms, usage, model }.
 *  The SDK is imported lazily so hosts without it (no Anthropic credentials) still load this module. */
export async function createClaudeClient({ client = null, routing = modelRouting() } = {}) {
  if (!client) { const { default: Anthropic } = await import('@anthropic-ai/sdk'); client = new Anthropic(); }
  return {
    routing,
    async complete({ model, system, messages, maxTokens = 8000, effort }) {
      const started = performance.now();
      const fallback = SUPPORTS_FALLBACK(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
      const response = await client.beta.messages.create({
        model, max_tokens: maxTokens,
        // The system prompt (cards + examples) is stable across requests: cache it.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
        ...(effort ? { output_config: { effort } } : {}),
        ...fallback,
      }, { timeout: routing.timeoutMs });
      if (response.stop_reason === 'refusal') throw Object.assign(Error('The model declined this request.'), { status: 422, code: 'refusal' });
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      return { text, ms: Math.round(performance.now() - started), usage: response.usage, model: response.model, stopReason: response.stop_reason };
    },
  };
}

/** Parse the first top-level JSON object in model text. */
export function parseJsonObject(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw Object.assign(Error('no JSON object in model output'), { code: 'model_output_not_json' });
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch (error) { throw Object.assign(Error('model output is not valid JSON: ' + error.message), { code: 'model_output_not_json' }); }
}
