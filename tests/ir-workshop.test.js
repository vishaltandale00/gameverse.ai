import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { validateSubmission, createIrApi } from '../scripts/ir-api.mjs';
import { createIrSubmission, sourceGamesForSelections, selectionBlockers } from '../src/ir-workshop-model.js';

const catalog = {
  roles: {
    movement: [{ id: 'movement.hybrid', status: 'available', packages: ['move'] }, { id: 'movement.pending', status: 'pending', packages: [] }],
    combat: [{ id: 'combat.hit', status: 'available', packages: ['hit'] }],
    progression: [{ id: 'progression.equipment', status: 'available', packages: ['equipment'] }, { id: 'progression.skills', status: 'available', packages: ['skills'] }],
  },
  components: [
    ['move', 'sonic'], ['hit', 'metroid'], ['equipment', 'metroid'], ['skills', 'minish'],
  ].map(([id, source_game]) => ({ id, source_game, installed: true, qualification: { status: 'pass' }, package_sha256: id.repeat(8), behavior_sha256: id, ports: [], dependencies: [] })),
};
const choices = { movement: 'movement.hybrid', combat: 'combat.hit', progression: 'progression.equipment' };
const id = 'a12b34cd-1234-4567-8abc-123456789012';
const submit = (select = choices, parents = ['sonic', 'metroid']) => createIrSubmission(catalog, select, parents, 'RULE RELAY', '', id);

test('swapping progression changes the submitted executable selection and required source games', () => {
  const before = submit();
  const replacement = { ...choices, progression: 'progression.skills' };
  const parents = sourceGamesForSelections(catalog, replacement);
  const after = submit(replacement, parents);
  assert.notDeepEqual(before.request, after.request);
  assert.deepEqual(parents, ['sonic', 'metroid', 'minish']);
  const pinned = validateSubmission(after, catalog);
  assert.deepEqual(pinned.selected_packages.map(item => item.id), ['move', 'hit', 'skills']);
  assert.equal(pinned.request.qualification.run, true);
  assert.equal(pinned.selected_packages[2].package_sha256, catalog.components[3].package_sha256);
});

test('unsupported worlds, pending adapters and missing exact packages block a build', () => {
  assert.match(selectionBlockers(catalog, choices, ['sonic', 'metroid', 'pokemon'])[0], /no selected executable/);
  assert.throws(() => validateSubmission({ ...submit(), context: { parent_game_ids: ['sonic', 'pokemon'], intent: '' } }, catalog), /contribute/);
  assert.throws(() => submit({ ...choices, movement: 'movement.pending' }), /adapter/);
  const missing = structuredClone(catalog); missing.components[0].installed = false;
  assert.throws(() => validateSubmission(submit(), missing), /unavailable/);
});

test('server rejects malformed titles and request identities and resolves package pins itself', () => {
  const invalid = submit(); invalid.request.title = '<script>';
  assert.throws(() => validateSubmission(invalid, catalog), /title/);
  invalid.request.title = 'RELAY'; invalid.request.request_id = '../outside';
  assert.throws(() => validateSubmission(invalid, catalog), /request ID/);
  const request = submit(); request.selected_packages = [{ id: 'forged', package_sha256: 'forged' }];
  assert.equal(validateSubmission(request, catalog).selected_packages.some(item => item.id === 'forged'), false);
});

test('retained unfinished workers are marked interrupted and cannot be promoted to Play', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'gameverse-ir-test-'));
  try {
    const run = resolve(dir, id); await mkdir(run);
    await writeFile(resolve(run, 'job.json'), JSON.stringify({ id, state: 'running' }));
    const service = createIrApi({ directory: dir, catalogProvider: async () => catalog });
    const result = await service.readStatus(id);
    assert.equal(result.state, 'interrupted'); assert.equal(result.eligible_for_play, false);
    await assert.rejects(service.activate(id), /successful build/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('mutating HTTP endpoints require the same local origin', async () => {
  const service = createIrApi({ catalogProvider: async () => catalog });
  let code, body;
  const res = { writeHead(status) { code = status; return this; }, end(value) { body = JSON.parse(value); } };
  await service.handle({ method: 'POST', headers: { host: '127.0.0.1:4173', origin: 'https://unrelated.example' } }, res, '/api/ir/runs');
  assert.equal(code, 403); assert.match(body.error, /local Gameverse/);
});


test('reviewed per-game controls survive activation while absent or invalid notes retain fallback metadata', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gameverse-ir-notes-'));
  try {
    const directory = resolve(root, 'local-data/ir-runs'), run = resolve(directory, id), output = resolve(run, 'output');
    await mkdir(output, { recursive: true });
    const rom = Buffer.from('isolated test cartridge'), sha256 = createHash('sha256').update(rom).digest('hex');
    const romPath = resolve(output, 'game.gba'); await writeFile(romPath, rom);
    await writeFile(resolve(output, 'status.json'), JSON.stringify({ state: 'completed', outcome: 'pass', request_sha256: 'request-pin', qualification: { outcome: 'pass' }, artifacts: { rom: romPath, rom_sha256: sha256 } }));
    const service = createIrApi({ root, directory, catalogProvider: async () => catalog });
    for (const notes of ['Keyboard X jumps; Z throws fire. Reach the exit.', undefined, 'x'.repeat(1001), 42, '   ']) {
      await writeFile(resolve(run, 'job.json'), JSON.stringify({ id, title: 'CINDER RUN', state: 'completed', playNotes: notes }));
      await service.activate(id);
      const receipt = JSON.parse(await readFile(resolve(root, 'local-data/games/ir-workshop.json')));
      assert.equal(receipt.title, 'CINDER RUN'); assert.equal(receipt.sha256, sha256);
      if (typeof notes === 'string' && notes.trim() && notes.length <= 1000) assert.equal(receipt.playNotes, notes);
      else assert.equal(Object.hasOwn(receipt, 'playNotes'), false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('local creation route retains request validation without starting a build for invalid input', async () => {
  const service = createIrApi({ catalogProvider: async () => catalog });
  let code, body;
  const res = { writeHead(status) { code = status; return this; }, end(value) { body = JSON.parse(value); } };
  await service.handle({ method: 'POST', headers: { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' } }, res, '/api/ir/runs');
  assert.equal(code, 415); assert.match(body.error, /JSON IR request/);
});

test('mechanic graph route enforces transport/resource limits without invoking a build', async () => {
  let validations = 0;
  const graph = { schema: 'gameverse.mechanic-assembly/0.1', components: { one: { package_id: 'example', behavior_sha256: 'a'.repeat(64) } }, state: {}, invocations: [{ component: 'one', arguments: {} }] };
  const service = createIrApi({ assemblyValidator: async submitted => { validations++; assert.deepEqual(submitted, graph); return { schema: 'gameverse.mechanic-assembly-validation/0.1', valid: true, errors: [], interfaces: { one: {} }, normalized_graph: submitted }; } });
  const request = async (raw, origin = 'http://127.0.0.1:4173', type = 'application/json') => {
    let code, body;
    const req = { method: 'POST', headers: { host: '127.0.0.1:4173', origin, 'content-type': type }, async *[Symbol.asyncIterator]() { yield Buffer.from(raw); } };
    const res = { writeHead(status) { code = status; return this; }, end(value) { body = JSON.parse(value); } };
    await service.handle(req, res, '/api/ir/assembly/validate'); return { code, body };
  };
  const accepted = await request(JSON.stringify(graph)); assert.equal(accepted.code, 200); assert.equal(accepted.body.valid, true); assert.equal(validations, 1);
  assert.equal((await request(JSON.stringify(graph), 'https://other.example')).code, 403);
  assert.equal((await request(JSON.stringify(graph), undefined, 'text/plain')).code, 415);
  assert.equal((await request('{broken')).code, 400);
  assert.equal((await request(JSON.stringify({ extra: 'x'.repeat(262145) }))).code, 413);
  assert.equal((await request(JSON.stringify({ ...graph, extra: 'x'.repeat(4097) }))).code, 413);
  let deep = 0; for (let i = 0; i < 25; i++) deep = { child: deep };
  assert.equal((await request(JSON.stringify({ ...graph, extra: deep }))).code, 413);
  assert.equal((await request(JSON.stringify({ ...graph, initialize: { counter: 1e30 } }))).code, 400);
  assert.equal((await request(JSON.stringify({ ...graph, components: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`instance${i}`, {}])) }))).code, 413);
  assert.equal((await request(JSON.stringify({ ...graph, state: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`slot${i}`, {}])) }))).code, 413);
  assert.equal((await request(JSON.stringify({ ...graph, invocations: Array(129).fill({ component: 'one', arguments: {} }) }))).code, 413);
  assert.equal((await request(JSON.stringify({ ...graph, extra: Array(20001).fill(0) }))).code, 413);
  assert.equal(validations, 1, 'Rejected envelopes never invoke the validator or generator.');
});

test('mechanic graph validation bounds concurrent compiler work and releases its slot', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const service = createIrApi({ assemblyValidator: async () => { calls++; entered(); await held; return { valid: true }; } });
  const request = async () => {
    let code;
    const req = { method: 'POST', headers: { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173', 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from('{}'); } };
    const res = { writeHead(status) { code = status; }, end() {} };
    await service.handle(req, res, '/api/ir/assembly/validate'); return code;
  };
  const first = request(); await started;
  assert.equal(await request(), 409); assert.equal(calls, 1);
  release(); assert.equal(await first, 200);
  assert.equal(await request(), 200); assert.equal(calls, 2);
});

test('recovered system endpoint accepts only bounded numeric inputs and one active inspection', async () => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createIrApi({ systemRunner: async input => { calls++; await gate; return { schema: 'gameverse.recovered-system-trace/1', inputs: input, trace: [] }; } });
  const request = async (raw, origin = 'http://127.0.0.1:4173', type = 'application/json') => {
    let code, body;
    const req = { method: 'POST', headers: { host: '127.0.0.1:4173', origin, 'content-type': type }, async *[Symbol.asyncIterator]() { yield Buffer.from(raw); } };
    const res = { writeHead(status) { code = status; }, end(value) { body = JSON.parse(value); } };
    await service.handle(req, res, '/api/ir/systems/mzm-damage-reaction'); return { code, body };
  };
  for (const raw of ['null', '[]', '{broken', '{"hp":-1}', '{"hp":65536}', '{"damage":1.5}', '{"ticks":65}', '{"path":"/tmp/x"}', '{"code":"anything"}']) assert.equal((await request(raw)).code, 400);
  assert.equal((await request('{}', 'https://other.example')).code, 403);
  assert.equal((await request('{}', undefined, 'text/plain')).code, 415);
  assert.equal((await request(JSON.stringify({ damage: 'x'.repeat(8193) }))).code, 413);
  assert.equal(calls, 0);
  const first = request('{"damage":65535,"hp":0,"ticks":64}');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request('{}')).code, 409); assert.equal(calls, 1);
  release(); assert.equal((await first).code, 200);
  assert.equal((await request('{}')).code, 200); assert.equal(calls, 2);
});

test('recovered system readiness uses current binding validation and fails closed', async () => {
  let fail = true, executions = 0;
  const service = createIrApi({ systemRunner: async () => { executions++; }, systemReadiness: async () => { if (fail) throw Error('stale private path'); return { ready: true, scope: 'Binding readiness; no execution.' }; } });
  const request = async () => { let code, body; await service.handle({ method: 'GET', headers: {} }, { writeHead(status) { code = status; }, end(value) { body = JSON.parse(value); } }, '/api/ir/systems/mzm-damage-reaction'); return { code, body }; };
  const unavailable = await request(); assert.equal(unavailable.code, 200); assert.equal(unavailable.body.ready, false); assert.ok(!JSON.stringify(unavailable).includes('private path'));
  fail = false; assert.equal((await request()).body.ready, true); assert.equal(executions, 0);
});

test('prefab reads are allowlisted and require current graph admission before import', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gameverse-prefab-route-'));
  try {
    const dir = resolve(root, 'research/ir-workshop/game-system-assembly-20261016/progression'); await mkdir(dir, { recursive: true });
    const graph = { schema: 'gameverse.mechanic-assembly/0.1', components: {}, state: {}, invocations: [] };
    await writeFile(resolve(dir, 'learning.assembly.json'), JSON.stringify(graph));
    let valid = true, validations = 0;
    const service = createIrApi({ root, assemblyValidator: async input => { validations++; assert.deepEqual(input, graph); return { valid, normalized_graph: { ...input, checked: true }, errors: [] }; } });
    const request = async id => { let code, body; await service.handle({ method: 'GET', headers: {} }, { writeHead(status) { code = status; }, end(value) { body = JSON.parse(value); } }, '/api/ir/system-prefabs/' + id); return { code, body }; };
    assert.equal((await request('../../outside')).code, 404); assert.equal(validations, 0);
    assert.equal((await request('mzm.enemy.accepted-damage-and-reaction')).body.ready, false); assert.equal(validations, 0);
    const admitted = await request('tmc.learned_sword_charge_release'); assert.equal(admitted.body.ready, true); assert.equal(admitted.body.graph.checked, true); assert.equal(admitted.body.source.sha256, createHash('sha256').update(JSON.stringify(graph)).digest('hex'));
    valid = false; assert.equal((await request('tmc.learned_sword_charge_release')).body.ready, false); assert.equal(validations, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
