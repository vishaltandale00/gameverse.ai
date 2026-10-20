// Client for d1, the decision model on the local LiteLLM proxy (see
// tools/decisions/README.md). d1 answers many questions about one state in a
// single call without generating tokens: `noul` (yes/no probability), `choice`
// (distribution over named options) and `score` (position on an ordered rubric).
// It is fast (~20 ms locally), so it suits routing, gating and classification.
const DEFAULT_BASE = 'http://rrh-llm-1:4000';

export function createD1Client({ base = process.env.LITELLM_BASE || DEFAULT_BASE, apiKey = process.env.LITELLM_API_KEY || '', timeoutMs = 4000, fetchImpl = fetch } = {}) {
  const url = `${base.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/decisions`;
  return {
    url,
    /**
     * questions: { name: { type: 'noul'|'choice'|'score', instructions, criteria? } }
     *   choice criteria: { option: description }; score criteria: [level descriptions, low → high]
     * Returns { answers, ms }; answers[name] has noul | choice+probabilities+confidence | score.
     */
    async decide({ state, questions, images = [] }) {
      const started = performance.now();
      const response = await fetchImpl(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ state: typeof state === 'string' ? state : JSON.stringify(state), questions, images }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.answers) throw Object.assign(Error(`d1 returned HTTP ${response.status}${body?.error?.message ? ': ' + String(body.error.message).slice(0, 120) : ''}`), { status: 502 });
      return { answers: body.answers, ms: Math.round(performance.now() - started), model: body.model || 'd1' };
    },
  };
}
