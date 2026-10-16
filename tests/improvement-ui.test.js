import test from 'node:test';
import assert from 'node:assert/strict';
import { createImprovementUi } from '../scripts/improvement-ui.mjs';
import { createImprovementApi } from '../scripts/improvement-api.mjs';
import { renderRecipeDetails, recipeAvailability, fixtureRequest, validateModRequest } from '../src/improvement-workbench-model.js';

function response() {
  return { headers: {}, status: null, body: null, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, writeHead(status, headers = {}) { this.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); return this; }, end(body) { this.body = body; } };
}
test('same-server recipe page serves every module import through explicit allowlist only', async () => {
  const ui = createImprovementUi(), page = response();
  assert.equal(await ui({ method: 'GET' }, page, '/improvement'), true);
  assert.equal(page.status, 200); assert.match(String(page.body), /id="improvement-workbench"/);
  for (const path of ['/improvement.css', '/src/improvement-page.js', '/src/improvement-workbench.js', '/src/improvement-workbench-model.js']) {
    const res = response(); assert.equal(await ui({ method: 'GET' }, res, path), true); assert.equal(res.status, 200); assert.ok(res.body.length > 0);
  }
  assert.equal(await ui({ method: 'GET' }, response(), '/contracts/improvement-provider-pack.json'), false);
  assert.equal(await ui({ method: 'GET' }, response(), '/src/../.env'), false);
  const denied = response(); await ui({ method: 'POST' }, denied, '/improvement'); assert.equal(denied.status, 405);
  const head = response(); await ui({ method: 'HEAD' }, head, '/improvement'); assert.equal(head.body, undefined);
});
test('actual capabilities route renders registered availability and unavailable inputs cannot submit', async () => {
  const api = createImprovementApi(), res = response();
  assert.equal(await api.handle({ method: 'GET', headers: { host: '127.0.0.1:4175' } }, res, '/api/improvement/capabilities'), true);
  assert.equal(res.status, 200);
  const capabilities = JSON.parse(res.body); assert.equal(capabilities.schema, 'gameverse.improvement-capabilities/1');
  assert.ok(capabilities.recipes.length > 0);
  for (const recipe of capabilities.recipes) {
    assert.match(renderRecipeDetails(recipe), /Input availability alone does not certify gameplay/);
    assert.equal(recipeAvailability(recipe).executable, recipe.availability?.status === 'ready' && recipe.availability?.execution_ready === true && recipe.availability?.executable === true);
    if (!recipeAvailability(recipe).executable) assert.throws(() => validateModRequest(capabilities, recipe, {}), /local setup/);
  }
  for (const fixture of capabilities.fixtures || []) {
    if (!recipeAvailability(fixture).executable) continue;
    const request = fixtureRequest(fixture, '11111111-1111-1111-1111-111111111111');
    assert.equal(request.operation, 'reference-fixture'); assert.equal(request.target, undefined);
    assert.equal(recipeAvailability(fixture).label, 'Runnable bundled example');
  }
});
