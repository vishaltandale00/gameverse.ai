import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeAvailability, requestStarter, fixtureRequest, validateModRequest, renderRecipeDetails, renderRetainedRun } from '../src/improvement-workbench-model.js';
import { createImprovementWorkbench } from '../src/improvement-workbench.js';

const id = '11111111-1111-1111-1111-111111111111';
function fixture() {
  const recipe = { id: 'reviewed-mod', game_id: 'game', quality: 'build-only', request_sha256: 'a'.repeat(64), baseline_artifact_sha256: 'b'.repeat(64), installed: true,
    availability: { status: 'ready', input_mode: 'original-required', execution_ready: true, executable: true, prerequisites: [], setup: [] },
    request_template: { schema: 'gameverse.improvement-request/1', operation: 'native-mod', intent: 'Reviewed change', target: { role: 'subgame', game_id: 'game', artifact_sha256: 'b'.repeat(64), game_version: null, base_game_version: null, base_artifact_sha256: null }, environment: { version: null, config_sha256: null }, loop_version: 'c'.repeat(64), plan: { recipe_id: 'reviewed-mod', request_sha256: 'a'.repeat(64) } } };
  return { recipe, capabilities: { schema: 'gameverse.improvement-capabilities/1', recipes: [recipe], loop_version: 'c'.repeat(64), supports: { free_text_planning: false } } };
}
function complete(request) {
  request.target.game_version = 'game-v1'; request.target.base_game_version = 'host-v1'; request.target.base_artifact_sha256 = 'd'.repeat(64);
  request.environment = { version: 'host/1', config_sha256: 'e'.repeat(64) }; return request;
}
test('installed pins never imply executable availability; public and source-required modes stay distinct', () => {
  assert.equal(recipeAvailability({ installed: true }).executable, false);
  const { recipe } = fixture();
  recipe.availability.status = 'setup-required';
  assert.equal(recipeAvailability(recipe).executable, false);
  assert.equal(recipeAvailability(recipe).label, 'Local setup needed');
  recipe.availability = { status: 'original-required', input_mode: 'original-required', execution_ready: false, executable: false };
  assert.match(renderRecipeDetails(recipe), /Supply original inputs locally/);
  assert.doesNotMatch(renderRecipeDetails(recipe), /Runnable bundled/);
  recipe.availability = { status: 'ready', input_mode: 'authored-fixture', execution_ready: true, executable: true };
  assert.match(renderRecipeDetails(recipe), /Runnable bundled example/);
});
test('starter preserves missing context and exact pins; stale or unready submissions fail', () => {
  const { recipe, capabilities } = fixture(), starter = requestStarter(capabilities, recipe, id);
  assert.equal(starter.request_id, id); assert.equal(starter.target.base_artifact_sha256, null);
  assert.throws(() => validateModRequest(capabilities, recipe, starter), /Supply the exact/);
  complete(starter); assert.equal(validateModRequest(capabilities, recipe, starter), starter);
  starter.loop_version = 'f'.repeat(64); assert.throws(() => validateModRequest(capabilities, recipe, starter), /pins changed/);
  recipe.availability.execution_ready = false; assert.throws(() => validateModRequest(capabilities, recipe, starter), /local setup/);
  assert.equal(recipe.request_template.request_id, undefined);
});
test('result separates worker, objective and activation and links only retained local evidence', () => {
  const html = renderRetainedRun({ request_id: id, status: 'completed', artifact_sha256: 'a'.repeat(64), quality: { scope: 'build-only', gaps: ['Full campaign unverified'] }, artifacts: { rom: `/api/improvement/runs/${id}/artifacts/rom`, result: 'https://external.example/result' } });
  assert.match(html, /Worker: <strong>completed/); assert.match(html, /Objective qualification: build-only/);
  assert.match(html, /activation: unavailable/); assert.match(html, /Candidate .gba/);
  assert.doesNotMatch(html, /href="https:\/\/external/);
  assert.match(renderRecipeDetails({ description: '<script>bad</script>', missing_inputs: ['<img>'] }), /&lt;script&gt;/);
});
test('public fixture uses its actual pinned operation without native context or a cartridge claim', () => {
  const fixture = { id: 'reference-key-door', availability: { status: 'ready', input_mode: 'authored-fixture', execution_ready: true, executable: true }, request_template: { schema: 'gameverse.improvement-request/1', operation: 'reference-fixture', plan: { fixture_id: 'reference-key-door', request_sha256: 'a'.repeat(64), executor_sha256: 'b'.repeat(64) } } };
  const request = fixtureRequest(fixture, id);
  assert.equal(request.request_id, id); assert.equal(request.target, undefined);
  const html = renderRetainedRun({ request_id: id, input: request, status: 'completed', artifacts: { result: `/api/improvement/runs/${id}/artifacts/result`, rom: `/api/improvement/runs/${id}/artifacts/rom` } });
  assert.match(html, /not a GBA cartridge/); assert.match(html, /result receipt/); assert.doesNotMatch(html, /Candidate .gba/);
  fixture.availability.execution_ready = false;
  assert.throws(() => fixtureRequest(fixture, id), /not executable/);
});

// Minimal event surface verifies actual component fetch/submission wiring without a browser or dependencies.
function elementStub() {
  const nodes = new Map();
  return { html: '', classList: { add() {} }, set innerHTML(value) { this.html = value; nodes.clear(); }, get innerHTML() { return this.html; }, querySelectorAll(selector) {
    if (selector !== '[data-improvement-fixture]') return [];
    return [...this.html.matchAll(/data-improvement-fixture="([^"]+)"/g)].map(match => {
      const node = this.querySelector(`fixture-${match[1]}`); node.dataset = { improvementFixture: match[1] }; return node;
    });
  }, querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', textContent: '', addEventListener(type, handler) { this[type] = handler; } });
    return nodes.get(selector);
  } };
}
test('workbench loads capability endpoint, submits reviewed starter, and loads actual retained result', async () => {
  const { capabilities } = fixture(), element = elementStub(), calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return { ok: true, json: async () => path.endsWith('/capabilities') ? capabilities : { request_id: id, status: 'running', candidate_only: true, artifacts: {} } };
  };
  createImprovementWorkbench({ element, fetchImpl });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].path, '/api/improvement/capabilities');
  assert.match(element.innerHTML, /unsupported by this provider/);
  const request = complete(requestStarter(capabilities, capabilities.recipes[0], id));
  element.querySelector('[data-improvement-request]').input({ target: { value: JSON.stringify(request) } });
  await element.querySelector('[data-improvement-submit]').click();
  assert.equal(calls[1].path, '/api/improvement/runs');
  assert.equal(JSON.parse(calls[1].options.body).target.base_artifact_sha256, 'd'.repeat(64));
  element.querySelector('[data-improvement-run-id]').value = id;
  await element.querySelector('[data-improvement-lookup]').onsubmit({ preventDefault() {} });
  assert.equal(calls[2].path, `/api/improvement/runs/${id}`);
  assert.match(element.innerHTML, /No verified artifact reported/);
});
test('public demonstration button sends server-pinned fixture request with no native context', async () => {
  const { capabilities } = fixture(), element = elementStub(), calls = [];
  capabilities.fixtures = [{ id: 'reference-key-door', availability: { status: 'ready', input_mode: 'authored-fixture', execution_ready: true, executable: true }, request_template: { schema: 'gameverse.improvement-request/1', operation: 'reference-fixture', plan: { fixture_id: 'reference-key-door', request_sha256: 'a'.repeat(64), executor_sha256: 'b'.repeat(64) } } }];
  createImprovementWorkbench({ element, fetchImpl: async (path, options) => {
    calls.push({ path, options }); return { ok: true, json: async () => path.endsWith('/capabilities') ? capabilities : { request_id: id, status: 'completed', input: JSON.parse(options.body), artifacts: { result: `/api/improvement/runs/${id}/artifacts/result` } } };
  } });
  await new Promise(resolve => setImmediate(resolve));
  await element.querySelectorAll('[data-improvement-fixture]')[0].onclick();
  const request = JSON.parse(calls[1].options.body);
  assert.equal(calls[1].path, '/api/improvement/runs'); assert.equal(request.operation, 'reference-fixture');
  assert.equal(request.target, undefined); assert.equal(request.plan.executor_sha256, 'b'.repeat(64));
  assert.match(element.innerHTML, /Public engine demonstration/); assert.match(element.innerHTML, /result receipt/);
});
