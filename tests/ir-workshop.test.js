import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
