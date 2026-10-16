import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createImprovementApi } from '../scripts/improvement-api.mjs';
const root = process.cwd();
async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'improvement-contract-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const fixtureRoot = resolve(directory, 'workspace'); await mkdir(fixtureRoot);
  const realCaps = await createImprovementApi({ root }).capabilities();
  for (const ref of realCaps.mechanisms.filter(row => row.path !== 'contracts/improvement-provider-pack.json')) { const path = resolve(fixtureRoot, ref.path); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, await readFile(resolve(root, ref.path))); }
  const rom = { path: 'fixture.bin', sha256: createHash('sha256').update('fixture').digest('hex') }; await writeFile(resolve(fixtureRoot, rom.path), 'fixture');
  for (const recipe of realCaps.recipes) { const path = resolve(fixtureRoot, recipe.file); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify({ schema: 'synthetic-contract-fixture/1', rom })); }
  let child;
  const api = createImprovementApi({ root: fixtureRoot, directory, spawnImpl: (_command, args) => {
    child = new EventEmitter(); child.kill = () => {}; child.pid = undefined;
    child.args = args; return child;
  } });
  const caps = await api.capabilities(); const recipe = caps.recipes.find(r => r.id === 'aria-double-xp');
  const body = { schema: 'gameverse.improvement-request/1', request_id: randomUUID(), operation: 'native-mod', intent: 'Double defeat XP',
    target: { role: 'subgame', game_id: recipe.game_id, game_version: 'aria-usa-1', artifact_sha256: recipe.baseline_artifact_sha256, base_game_version: 'host-1', base_artifact_sha256: 'a'.repeat(64) },
    environment: { version: 'test-host/1', config_sha256: 'b'.repeat(64) }, loop_version: caps.loop_version, plan: { recipe_id: recipe.id, request_sha256: recipe.request_sha256 } };
  return { api, body, recipe, directory, child: () => child };
}
test('reports precise supported recipes and unsupported reconstruction/activation', async t => {
  const { api } = await fixture(t); const caps = await api.capabilities();
  assert.equal(caps.supports.reconstruction, false); assert.equal(caps.supports.player_activation, false);
  assert.equal(caps.recipes.find(r => r.id === 'aria-soulstride').quality, 'build-only');
});
test('rejects unsupported operation, target and stale immutable pins before dispatch', async t => {
  const { api, body, child } = await fixture(t);
  for (const change of [{ operation: 'reconstruct' }, { plan: { ...body.plan, request_sha256: 'c'.repeat(64) } }, { target: { ...body.target, game_id: 'pokemon-firered-version' } }]) {
    await assert.rejects(api.submit({ ...body, ...change }), error => [409, 422].includes(error.status));
  }
  assert.equal(child(), undefined);
});
test('durable receipt deduplicates and preserves backend evidence', async t => {
  const { api, body, recipe, directory, child } = await fixture(t);
  if (!recipe.installed) { t.skip('Private pinned recipe prerequisites unavailable'); return; }
  await api.submit(body); assert.equal((await api.submit(structuredClone(body))).request_id, body.request_id);
  await assert.rejects(api.submit({ ...body, intent: 'different' }), { status: 409 });
  const output = resolve(directory, body.request_id, 'result.json');
  const artifact = resolve(directory, body.request_id, 'candidate.gba'); await writeFile(artifact, 'candidate');
  await writeFile(output, JSON.stringify({ artifact, artifact_sha256: createHash('sha256').update('candidate').digest('hex'), status: 'qualified-bounded-modification', coverage: 'bounded', witnesses: { modified_xp: 2 }, stages: [{ name: 'build-modified', wall_s: 0.1 }] }));
  child().emit('close', 0);
  let done; for (let i=0;i<100;i++) { done = await api.status(body.request_id); if (done.status !== 'running') break; await new Promise(r => setTimeout(r, 5)); }
  assert.equal(done.status, 'completed'); assert.equal(done.quality.whole_game_equivalent, null); assert.equal(done.quality.reconstruction_qc, 'unavailable'); assert.equal(done.timings.build_s, 0.1);
  const restarted = createImprovementApi({ directory }); assert.equal((await restarted.status(body.request_id)).status, 'completed');
});
test('restart never advertises an orphan worker as running', async t => {
  const { api, body, recipe, directory, child } = await fixture(t); if (!recipe.installed) { t.skip('Private prerequisites unavailable'); return; }
  await api.submit(body); const restarted = createImprovementApi({ directory }); assert.equal((await restarted.status(body.request_id)).status, 'interrupted'); child().emit('close', 2);
  await new Promise(r => setTimeout(r, 20));
});
test('cancelled worker retains terminal receipt and never claims activation', async t => {
  const { api, body, child } = await fixture(t); await api.submit(body);
  const request = { method: 'DELETE', headers: { host: 'localhost:4175' } };
  let response; const res = { writeHead(code) { this.code = code; return this; }, end(bytes) { response = JSON.parse(bytes); } };
  assert.equal(await api.handle(request, res, `/api/improvement/runs/${body.request_id}`), true);
  assert.equal(response.cancellation_requested, true); child().emit('close', null);
  let run; for (let i=0;i<100;i++) { run=await api.status(body.request_id); if(run.status!=='running')break; await new Promise(r=>setTimeout(r,5)); }
  assert.equal(run.status, 'cancelled'); assert.equal(run.candidate_only, true); assert.equal(run.timings.build_s, null);
});
test('cross-origin HTTP requests fail before capability disclosure or dispatch', async t => {
  const { api } = await fixture(t); let response;
  const res = { writeHead(code) { this.code = code; return this; }, end(bytes) { response=JSON.parse(bytes); } };
  await api.handle({ method:'GET', headers:{host:'localhost:4175',origin:'https://external.example'} },res,'/api/improvement/capabilities');
  assert.equal(res.code,403); assert.equal(response.error.code,'local_origin_required');
});
test('reviewed provider readset gates runtime inputs without requiring historical captures', async t => {
  const { api, directory } = await fixture(t); const fixtureRoot = resolve(directory, 'workspace');
  let caps = await api.capabilities(); const recipe = caps.recipes.find(row => row.id === 'aria-soulstride');
  const requestPath = resolve(fixtureRoot, recipe.file), request = JSON.parse(await readFile(requestPath));
  request.historical_video = { path: '/private/prior-machine/capture.mp4', sha256: 'a'.repeat(64) };
  const requestBytes = JSON.stringify(request); await writeFile(requestPath, requestBytes);
  const manifest = { schema:'gameverse.improvement-provider-pack/1', recipes:[{id:recipe.id,request_path:recipe.file,request_sha256:createHash('sha256').update(requestBytes).digest('hex')}], files:[{path:request.rom.path,sha256:request.rom.sha256,recipes:[recipe.id]}], closure:{provenance_warnings:[{recipe:recipe.id,code:'historical-capture-unavailable'}]} };
  await mkdir(resolve(fixtureRoot,'contracts'),{recursive:true}); await writeFile(resolve(fixtureRoot,'contracts/improvement-provider-pack.json'),JSON.stringify(manifest));
  caps=await api.capabilities(); const installed=caps.recipes.find(row=>row.id===recipe.id);
  assert.equal(installed.installed,true); assert.equal(installed.prerequisite_basis,'reviewed-provider-runtime-readset');
  assert.equal(installed.provenance_warnings[0].code,'historical-capture-unavailable');
  assert.ok(caps.mechanisms.some(row=>row.path==='contracts/improvement-provider-pack.json'));
  await writeFile(resolve(fixtureRoot,request.rom.path),'tampered');
  const stale=(await api.capabilities()).recipes.find(row=>row.id===recipe.id);
  assert.equal(stale.installed,false); assert.deepEqual(stale.missing_inputs,[request.rom.path]);
});
