// Example agent client: reviewed voice/text intent -> registered structured plan.
import { randomUUID } from 'node:crypto';
export async function submitImprovement({ server = 'http://127.0.0.1:4173', recipeId, intent, target, environment, voiceRequestId, requestId = randomUUID() }) {
  const get = async path => { const response = await fetch(`${server}${path}`); const body = await response.json(); if (!response.ok) throw Error(JSON.stringify(body)); return body; };
  const capabilities = await get('/api/improvement/capabilities');
  const recipe = capabilities.recipes.find(row => row.id === recipeId);
  if (!recipe?.installed) throw Error('Recipe unavailable. Inspect capabilities missing_inputs.');
  const request = { schema: 'gameverse.improvement-request/1', request_id: requestId, operation: 'native-mod', intent,
    target, environment, loop_version: capabilities.loop_version,
    plan: { recipe_id: recipe.id, request_sha256: recipe.request_sha256 }, ...(voiceRequestId ? { voice_request_id: voiceRequestId } : {}) };
  const response = await fetch(`${server}/api/improvement/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  const receipt = await response.json(); if (!response.ok) throw Error(JSON.stringify(receipt));
  return { request, receipt, status: () => get(`/api/improvement/runs/${requestId}`) };
}
