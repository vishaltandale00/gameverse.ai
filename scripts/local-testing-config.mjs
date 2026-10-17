import { readFile } from 'node:fs/promises';

// Inspect only a caller-selected credential reference. Never return credential values.
export async function testingServiceConfiguration(env = process.env) {
  if (!env.GAMEVERSE_SID_ENV_FILE) return {
    configured: Boolean(env.SID_LLM_KEY), source: env.SID_LLM_KEY ? 'process environment' : null,
    reason: env.SID_LLM_KEY ? null : 'Set SID_LLM_KEY or an explicit GAMEVERSE_SID_ENV_FILE reference for the separately authorized native bot service.',
  };
  const values = {};
  try {
    for (let line of (await readFile(env.GAMEVERSE_SID_ENV_FILE, 'utf8')).split(/\r?\n/)) {
      line = line.trim(); if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const at = line.indexOf('='), key = line.slice(0, at).replace(/^export /, '').trim();
      if (!['SID_LLM_URL', 'SID_LLM_KEY'].includes(key)) continue;
      let value = line.slice(at + 1).trim();
      if (value.length >= 2 && ['"', "'"].includes(value[0]) && value.at(-1) === value[0]) value = value.slice(1, -1);
      values[key] = value;
    }
  } catch { return { configured: false, source: 'explicit env-file reference', reason: 'GAMEVERSE_SID_ENV_FILE is not readable. Select the existing authorized native bot configuration.' }; }
  // Match tools.whole_game.model_config.load_sid_reference: environment wins;
  // an explicit file route requires both URL and key, and performs no expansion.
  const configured = Boolean((env.SID_LLM_URL ?? values.SID_LLM_URL) && (env.SID_LLM_KEY ?? values.SID_LLM_KEY));
  return { configured, source: 'explicit env-file reference', reason: configured ? null : 'The selected native bot configuration needs SID_LLM_URL and SID_LLM_KEY. Credential values are never displayed.' };
}
