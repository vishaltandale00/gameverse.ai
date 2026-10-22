// @ts-check
// OpenAI Responses client for the v2 planners (server-only; the key never
// reaches the browser, logs or stored versions). Mirrors scripts/agent-api.mjs.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { obj, objects, prop, str } from '../kernel/guards.js';

/** @typedef {import('./types.js').ReplySchema} ReplySchema */
/**
 * @typedef {{ model: string, system: string, user: string, json?: boolean, schema?: ReplySchema, effort?: string,
 *   onDelta?: (text: string) => void }} OpenAIRequest
 * @typedef {{ text: string, ms: number, firstMs?: number | null, usage: unknown, model: string }} OpenAIResult
 * @typedef {{ complete(request: OpenAIRequest): Promise<OpenAIResult> }} OpenAIClient
 */

/** Load OPENAI_API_KEY from .env / .env.local here or in the main checkout, without overriding the environment.
 * @param {Record<string, string | undefined>} [env] @param {string} [root] @returns {string | null} */
export function loadOpenAIKey(env = process.env, root = process.cwd()) {
  if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY;
  const roots = [root];
  try { roots.push(join(execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim(), '..')); } catch {}
  for (const dir of roots) for (const name of ['.env', '.env.local']) {
    try {
      const line = readFileSync(join(dir, name), 'utf8').split('\n').find(l => l.startsWith('OPENAI_API_KEY='));
      const value = line?.slice('OPENAI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
      if (value) { env.OPENAI_API_KEY = value; return value; }
    } catch {}
  }
  return null;
}

/** @param {{ apiKey?: string | null, url?: string, timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {OpenAIClient} */
export function createOpenAIClient({ apiKey, url = 'https://api.openai.com/v1/responses', timeoutMs = 90000, fetchImpl = fetch } = {}) {
  return {
    /** onDelta(textSoFar) streams partial output (used for live build previews). */
    async complete({ model, system, user, json = true, schema, effort, onDelta }) {
      const started = performance.now();
      const response = await fetchImpl(url, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, instructions: system, input: json ? `${user}\n\nReply with the JSON object only.` : user,
          ...(schema ? { text: { format: { type: 'json_schema', name: schema.name, schema: schema.schema, strict: true } } } : json ? { text: { format: { type: 'json_object' } } } : {}), ...(effort ? { reasoning: { effort } } : {}), ...(onDelta ? { stream: true } : {}) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (onDelta && response.ok) {
        const decoder = new TextDecoder(); let buffer = '', text = '', served = model;
        /** @type {unknown} */ let usage = null;
        /** @type {number | null} */ let firstMs = null;
        for await (const chunk of response.body ?? []) {
          buffer += decoder.decode(chunk, { stream: true });
          for (let i; (i = buffer.indexOf('\n\n')) >= 0;) {
            const data = buffer.slice(0, i).split('\n').find(l => l.startsWith('data: '))?.slice(6); buffer = buffer.slice(i + 2);
            if (!data || data === '[DONE]') continue;
            /** @type {Record<string, unknown>} */ let event; try { event = obj(JSON.parse(data)); } catch { continue; }
            if (event.type === 'response.output_text.delta') { firstMs ??= Math.round(performance.now() - started); text += str(event.delta); onDelta(text); }
            else if (event.type === 'response.completed') { usage = prop(event.response, 'usage') || null; served = str(prop(event.response, 'model')) || model; }
            else if (event.type === 'response.failed' || event.type === 'error') throw Object.assign(Error(`OpenAI stream failed: ${str(prop(prop(event.response, 'error'), 'message')) || str(event.message) || 'unknown'}`), { status: 502 });
          }
        }
        if (!text) throw Object.assign(Error('OpenAI response contained no text.'), { status: 502 });
        return { text, ms: Math.round(performance.now() - started), firstMs, usage, model: served };
      }
      if (!response.ok) {
        let detail = ''; try { detail = str(prop(prop(await response.json(), 'error'), 'message')); } catch {}
        throw Object.assign(Error(`OpenAI returned HTTP ${response.status}${detail ? ': ' + detail.slice(0, 200) : ''}`), { status: 502 });
      }
      const result = obj(await response.json());
      const text = typeof result.output_text === 'string' ? result.output_text
        : objects(result.output).flatMap(i => objects(i.content)).filter(p => p.type === 'output_text').map(p => str(p.text)).join('\n').trim();
      if (!text) throw Object.assign(Error('OpenAI response contained no text.'), { status: 502 });
      return { text, ms: Math.round(performance.now() - started), usage: result.usage || null, model: str(result.model) || model };
    },
  };
}
