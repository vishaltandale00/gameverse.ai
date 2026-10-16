import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applicationConfigPath, validateApplicationConfig, configuredGames, validateGameBinding } from '../src/application.js';
import { progressKey } from '../src/identity.js';

const configs = await Promise.all(['v0', 'v1'].map(async version => validateApplicationConfig(JSON.parse(await readFile(new URL(`../games/configs/gameverse-${version}.json`, import.meta.url))))));
test('root and explicit version routes select separate source configurations', () => {
  assert.equal(applicationConfigPath('/'), '/games/configs/gameverse-v1.json');
  assert.equal(applicationConfigPath('/v1/'), applicationConfigPath('/'));
  assert.equal(applicationConfigPath('/v0'), '/games/configs/gameverse-v0.json');
  assert.equal(applicationConfigPath('/v0/'), applicationConfigPath('/v0'));
  assert.throws(() => applicationConfigPath('/v2'), /unavailable/);
  assert.deepEqual(configs.map(config => config.base.kind), ['collection', 'neighborhood']);
});
test('both configurations bind the same catalog game and preserve its progress identity', () => {
  const catalogGame = { id: 'firered', ready: true, receipt: { sha256: 'cartridge' } };
  const catalog = [catalogGame, { id: 'deferred-game', ready: true }];
  const keys = configs.map(config => {
    const games = configuredGames(config, catalog);
    assert.deepEqual(games, [catalogGame]); assert.equal(games[0], catalogGame);
    validateGameBinding(config, catalogGame, { adapter: 'gameverse-gba-worker/0.1.0' });
    return progressKey({ profileId: 'same-player', gameId: games[0].id, cartridgeSha256: 'cartridge', wasmSha256: 'core', loaderSha256: 'loader', adapter: 'gameverse-gba-worker/0.1.0', snapshotFormat: 'format' });
  });
  assert.equal(keys[0], keys[1]);
});
test('configuration mistakes cannot silently redirect progress or use the wrong adapter', () => {
  assert.throws(() => validateApplicationConfig({ ...configs[0], subgames: [{ id: 'new-save-key', catalogId: 'firered', adapter: 'adapter' }] }), /Preserve the catalog/);
  assert.throws(() => validateGameBinding(configs[1], { id: 'firered' }, { adapter: 'wrong-core-adapter' }), /different adapter/);
  assert.throws(() => validateGameBinding(configs[1], { id: 'unknown' }, { adapter: 'gameverse-gba-worker/0.1.0' }), /not available/);
  assert.equal(configuredGames(configs[1], [])[0].ready, false);
});
