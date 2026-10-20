import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultRegistry } from '../v2/modules/index.js';
import { preflight } from '../v2/engine/spec.js';
import { compose, NEUTRAL_INPUT } from '../v2/engine/compose.js';
import {
  generatedCatalogEntries, encodeCheckpoint, decodeCheckpoint, canCarryState, generatedInput, progressLine, previewCells,
  isHostedRuntime, GENERATED_ADAPTER, GENERATED_SNAPSHOT_FORMAT,
} from '../src/generated-games.js';
import { validateGameBinding, configuredGames, GENERATED_GAME_ADAPTER } from '../src/application.js';
import { progressKey } from '../src/identity.js';
import { creatorVenues, nearestEntrance, CREATOR_LOT, CREATOR_KIOSK, CREATOR_VENUE_CAPACITY, PLAYER_RADIUS, WORLD_BOUNDS, SPORT_ENTRANCES, FIRE_RED_ENTRANCE } from '../src/neighborhood-math.js';

const registry = defaultRegistry();
const example = JSON.parse(readFileSync(new URL('../v2/examples/coin-cavern.json', import.meta.url)));
const build = spec => { const r = preflight(spec, registry); assert.ok(r.ok, JSON.stringify(r.errors)); return compose(r.spec, registry); };
const clone = value => structuredClone(value);

test('catalog keeps only published arcade games, oldest first, as generated entries', () => {
  const rows = [
    { id: 'newer-b', title: 'Newer', prompt: 'b', status: 'generating', versions: 2, latest: 2, kind: 'arcade2d', created: '2026-10-20T10:00:00Z' },
    { id: 'pending', title: 'Pending', prompt: 'p', status: 'generating', versions: 0, latest: null, kind: 'arcade2d', created: '2026-10-20T11:00:00Z' },
    { id: 'story', title: 'Story doc', prompt: 's', status: 'ready', versions: 1, latest: 1, created: '2026-10-20T09:30:00Z' },
    { id: 'older-a', title: 'Older', prompt: 'a', status: 'ready', versions: 1, latest: 1, kind: 'arcade2d', created: '2026-10-20T09:00:00Z' },
    { id: '../bad', title: 'Bad', latest: 1, kind: 'arcade2d', created: '2026-10-20T08:00:00Z' },
  ];
  const entries = generatedCatalogEntries(rows);
  assert.deepEqual(entries.map(e => e.id), ['gen-older-a', 'gen-newer-b']);
  assert.deepEqual({ ...entries[1], created: undefined }, { kind: 'generated', id: 'gen-newer-b', v2Id: 'newer-b', name: 'Newer', subtitle: 'Made in the Creator’s Lot',
    prompt: 'b', version: 2, versions: 2, status: 'generating', adapter: GENERATED_ADAPTER, snapshotFormat: GENERATED_SNAPSHOT_FORMAT,
    entryUrl: '/src/generated-adapter.js', created: undefined, ready: true });
  assert.ok(isHostedRuntime(entries[0]) && isHostedRuntime({ kind: 'custom-sports' }) && !isHostedRuntime({ id: 'firered' }));
  assert.deepEqual(generatedCatalogEntries(null), []);
});

test('checkpoints restore only onto the same version and never cross games', () => {
  const bytes = encodeCheckpoint({ gameId: 'gen-x', version: 3, frame: 120, state: { specId: 'x', entities: [] } });
  assert.deepEqual(decodeCheckpoint(bytes, { gameId: 'gen-x', version: 3 }), { restored: true, savedVersion: 3, state: { specId: 'x', entities: [] }, frame: 120 });
  const newer = decodeCheckpoint(bytes, { gameId: 'gen-x', version: 4 });
  assert.equal(newer.restored, false); assert.match(newer.reason, /v3.*v4/);
  assert.throws(() => decodeCheckpoint(bytes, { gameId: 'gen-y', version: 3 }), /different game/);
  assert.throws(() => decodeCheckpoint(new TextEncoder().encode('{nope'), { gameId: 'gen-x', version: 3 }), /unreadable/);
});

test('state carries over only when the level and rule shape are unchanged', () => {
  const tuned = clone(example); tuned.modules[0].with.jumpSpeed = 22; tuned.entities.coin.color = '#ffffff'; tuned.title = 'Coin Cavern II';
  tuned.art = { background: '/api/v2/games/x/assets/bg.webp' };
  assert.equal(canCarryState(example, tuned), true);
  const relaid = clone(example); relaid.level.rows[2] = relaid.level.rows[2].replace('C.C', 'C..');
  assert.equal(canCarryState(example, relaid), false);
  const extraModule = clone(example); extraModule.modules.push({ use: 'timer' });
  assert.equal(canCarryState(example, extraModule), false);
  const retagged = clone(example); retagged.entities.beetle.tags = ['hazard'];
  assert.equal(canCarryState(example, retagged), false);
  assert.equal(canCarryState(null, example), false);

  // A carried state keeps running under the new version's rules.
  const before = build(example), after = build(tuned);
  const state = before.createState();
  for (let i = 0; i < 90; i++) before.step(state, { x: 1, y: 0, a: i % 30 === 0, b: false });
  const frame = state.frame, x = state.entities.find(e => e.tags.includes('player')).x;
  for (let i = 0; i < 30; i++) after.step(state, NEUTRAL_INPUT);
  assert.equal(state.frame, frame + 30);
  assert.deepEqual(after.check(state), []);
  assert.ok(Number.isFinite(state.entities.find(e => e.tags.includes('player')).x) && x > 0);
});

test('keyboard and standard gamepad map to the v2 input contract', () => {
  assert.deepEqual(generatedInput(new Set()), { x: 0, y: 0, a: false, b: false });
  assert.deepEqual(generatedInput(new Set(['KeyD', 'KeyW', 'Space'])), { x: 1, y: -1, a: true, b: false });
  assert.deepEqual(generatedInput(new Set(['ArrowLeft', 'ArrowRight', 'KeyK'])), { x: 0, y: 0, a: false, b: true });
  const pad = { move: { x: 0.5, y: 0 }, buttons: [false, true, false, false, false, false, false, false, false, false, false, false, false, true, false, false] };
  assert.deepEqual(generatedInput(new Set(), pad), { x: 0.5, y: 1, a: false, b: true });
  assert.equal(generatedInput(new Set(), pad, { ownsB: true }).b, false, 'voice capture owns pad B');
  assert.equal(generatedInput(new Set(['KeyD']), { move: { x: 1, y: 0 }, buttons: [] }).x, 1, 'axes clamp to [-1, 1]');
});

test('build progress reads as short lines and drafts preview as tiles', () => {
  assert.equal(progressLine({ type: 'stage', stage: 'designing' }), 'Designing your game');
  assert.equal(progressLine({ type: 'stage', stage: 'playtested', winnable: true }), 'Playtested: the test player can win');
  assert.equal(progressLine({ type: 'stage', stage: 'art_sprites', task: 'hero' }), 'Art sprites · hero');
  assert.equal(progressLine({ type: 'version', version: 2 }), 'Version 2 is playable');
  assert.equal(progressLine({ type: 'job_failed', error: 'boom' }), 'Failed: boom');
  assert.equal(progressLine({ type: 'draft' }), null);
  const preview = previewCells({ rows: ['#..P', '#CC#'], legend: { '#': 'rock', P: 'hero', C: 'coin' }, entities: { rock: { solid: true, color: '#334455' }, hero: { color: 'red;' }, coin: {} } });
  assert.equal(preview.width, 4); assert.equal(preview.height, 2);
  assert.deepEqual(preview.cells, [{ x: 0, y: 0, color: '#334455' }, { x: 3, y: 0, color: '#f2e3b3' }, { x: 0, y: 1, color: '#334455' }, { x: 1, y: 1, color: '#f2e3b3' }, { x: 2, y: 1, color: '#f2e3b3' }, { x: 3, y: 1, color: '#334455' }]);
  assert.deepEqual(previewCells(null), { width: 0, height: 0, cells: [] });
});

test('only the neighborhood base binds generated games, through the generated adapter', () => {
  const v1 = { base: { kind: 'neighborhood' }, subgames: [{ id: 'firered', catalogId: 'firered', adapter: 'gameverse-gba-worker/0.1.0' }] };
  const v0 = { base: { kind: 'collection' }, subgames: v1.subgames };
  const game = generatedCatalogEntries([{ id: 'fox-run', title: 'Fox Run', latest: 1, kind: 'arcade2d' }])[0];
  assert.equal(GENERATED_GAME_ADAPTER, GENERATED_ADAPTER);
  assert.doesNotThrow(() => validateGameBinding(v1, game, game));
  assert.throws(() => validateGameBinding(v0, game, game), /Creator’s Lot/);
  assert.throws(() => validateGameBinding(v1, { ...game, adapter: 'other/1' }, { adapter: 'other/1' }), /adapter/);
  assert.throws(() => validateGameBinding(v1, { ...game, kind: 'custom-sports' }, game), /not available/, 'other kinds keep strict bindings');
  assert.deepEqual(configuredGames(v1, [game]).map(g => g.id), ['firered'], 'configured subgames are unchanged');
  const identity = { kind: 'generated', profileId: 'p', gameId: game.id, adapter: game.adapter, snapshotFormat: game.snapshotFormat };
  assert.equal(progressKey(identity), `generated-progress:p:gen-fox-run:${GENERATED_ADAPTER}:${GENERATED_SNAPSHOT_FORMAT}`);
  assert.equal(progressKey({ ...identity, version: 9 }), progressKey(identity), 'one progress line across versions');
});

test('Creator’s Lot venues fill a fixed grid inside the lot and stay reachable', () => {
  const games = Array.from({ length: CREATOR_VENUE_CAPACITY + 3 }, (_, i) => ({ id: `gen-game-${i}`, name: `Game ${i}`, version: 1 }));
  const venues = creatorVenues(games);
  assert.equal(venues.length, CREATOR_VENUE_CAPACITY);
  assert.equal(venues[0].gameId, 'gen-game-3', 'the newest games get venues');
  assert.deepEqual(creatorVenues(games.slice(0, 2)), creatorVenues(games.slice(0, 2)), 'deterministic layout');
  assert.deepEqual(creatorVenues(games.slice(0, 3)).slice(0, 2), creatorVenues(games.slice(0, 2)), 'adding a game never moves existing venues');
  const inLot = (x, z, margin = 0) => x - margin >= CREATOR_LOT.minX && x + margin <= CREATOR_LOT.maxX - 1.3 && Math.abs(z) + margin <= CREATOR_LOT.maxZ - 0.5;
  const seen = new Set();
  for (const venue of [...venues, CREATOR_KIOSK]) {
    assert.ok(inLot(venue.x, venue.z, venue.radius), `${venue.gameId} entrance inside the lot`);
    assert.ok(!seen.has(`${venue.x},${venue.z}`)); seen.add(`${venue.x},${venue.z}`);
    for (const other of venues) {
      const b = other.building, dx = Math.max(Math.abs(venue.x - b.x) - b.w / 2, 0), dz = Math.max(Math.abs(venue.z - b.z) - b.d / 2, 0);
      assert.ok(Math.hypot(dx, dz) > PLAYER_RADIUS + 1, `${venue.gameId} entrance clear of ${other.gameId}`);
    }
  }
  for (const a of venues) for (const b of venues) if (a !== b) {
    const A = a.building, B = b.building;
    assert.ok(Math.abs(A.x - B.x) >= (A.w + B.w) / 2 + 2 || Math.abs(A.z - B.z) >= (A.d + B.d) / 2 + 2, 'buildings keep walkable gaps');
  }
  assert.ok(WORLD_BOUNDS.maxX >= CREATOR_LOT.maxX && WORLD_BOUNDS.minX === -83 && WORLD_BOUNDS.maxZ === 59);
  // Extra entrances join the original venues without changing them.
  assert.equal(nearestEntrance(FIRE_RED_ENTRANCE, undefined, venues).gameId, 'firered');
  assert.equal(nearestEntrance(SPORT_ENTRANCES[0], undefined, venues).gameId, 'soccer');
  assert.equal(nearestEntrance(venues[5], ['firered'], venues).gameId, venues[5].gameId);
  assert.equal(nearestEntrance(CREATOR_KIOSK, ['firered'], [CREATOR_KIOSK, ...venues]).kind, 'kiosk');
});
