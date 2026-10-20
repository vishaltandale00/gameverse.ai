// OpenAI Responses client for the v2 planners (server-only; the key never
// reaches the browser, logs or stored versions). Mirrors scripts/agent-api.mjs.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Load OPENAI_API_KEY from .env / .env.local here or in the main checkout, without overriding the environment. */
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

export function createOpenAIClient({ apiKey, url = 'https://api.openai.com/v1/responses', timeoutMs = 90000, fetchImpl = fetch } = {}) {
  return {
    async complete({ model, system, user, json = true }) {
      const started = performance.now();
      const response = await fetchImpl(url, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, instructions: system, input: json ? `${user}\n\nReply with the JSON object only.` : user, ...(json ? { text: { format: { type: 'json_object' } } } : {}) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        let detail = ''; try { detail = (await response.json())?.error?.message || ''; } catch {}
        throw Object.assign(Error(`OpenAI returned HTTP ${response.status}${detail ? ': ' + detail.slice(0, 200) : ''}`), { status: 502 });
      }
      const result = await response.json();
      const text = typeof result?.output_text === 'string' ? result.output_text
        : (result?.output || []).flatMap(i => i?.content || []).filter(p => p?.type === 'output_text').map(p => p.text).join('\n').trim();
      if (!text) throw Object.assign(Error('OpenAI response contained no text.'), { status: 502 });
      return { text, ms: Math.round(performance.now() - started), usage: result.usage || null, model: result.model || model };
    },
  };
}
