import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../v2/kits/creature/content.js';
import { SAMPLE_CONTENT } from '../v2/kits/creature/fixtures/sample.js';
import { generateMaps, checkMap } from '../v2/kits/creature/world/maps.js';
import { createGame } from '../v2/kits/creature/game.js';
import { createBot } from '../v2/kits/creature/verify/bot.js';
import { test as storyTest, storyRules, rivalParty, counterStarter } from '../v2/kits/creature/world/story.js';
import { T } from '../v2/kits/creature/world/tiles.js';

const content = validate(SAMPLE_CONTENT).content;

test('every area gets a checked map; exits pair up; towns have their services', () => {
  for (const seed of [1, 2, 3, 99]) {
    const { maps, spawns } = generateMaps(content, seed);
    for (const a of content.areas) assert.ok(maps[a.id], `${a.id} has a map`);
    for (const m of Object.values(maps)) {
      assert.deepEqual(checkMap(m), [], `${m.id} (seed ${seed})`);
      for (const w of m.warps) {
        const dest = maps[w.to];
        assert.ok(dest, `${m.id} warp to ${w.to}`);
        const ch = dest.tiles[w.ty][w.tx];
        assert.ok([T.path, T.ground, T.floor, T.grass, T.carpet, T.flower].includes(ch), `${m.id} → ${w.to} lands on walkable '${ch}'`);
      }
    }
    // Every route and cave can be walked back: each warp out of a map has a warp back in.
    for (const m of Object.values(maps)) for (const w of m.warps) assert.ok(maps[w.to].warps.some(b => b.to === m.id), `${w.to} links back to ${m.id}`);
    assert.ok(maps['brookside/center'] && maps['brookside/mart'], 'brookside has a center and a mart');
    assert.ok(maps['brookside'].doors.some(d => d.to === 'brookside-gym'), 'the gym is a building in town');
    assert.equal(maps[spawns.start.map].room, 'lab');
    const route = maps['route-1'];
    assert.ok(route.h >= 40 && route.h <= 80, 'routes are 40–80 tiles long');
    assert.ok(route.tiles.join('').includes(T.grass));
    assert.ok(route.entities.some(e => e.kind === 'trainer' && e.sight === 4));
    const gym = maps['brookside-gym'];
    assert.ok(gym.puzzle && gym.entities.some(e => e.kind === 'leader'));
  }
});

test('map generation is deterministic per seed', () => {
  const a = generateMaps(content, 7), b = generateMaps(content, 7), c = generateMaps(content, 8);
  assert.deepEqual(a.maps['route-1'].tiles, b.maps['route-1'].tiles);
  assert.notDeepEqual(a.maps['route-1'].tiles, c.maps['route-1'].tiles);
});

test('badge gates hold the way until the badge is earned', () => {
  const game = createGame(content, { seed: 1 });
  const s = game.createState();
  const guard = game.maps.brookside.entities.find(e => e.kind === 'guard');
  assert.ok(guard, 'brookside guards the road to route 2');
  assert.equal(game.gateOpen(s, guard.gate), false);
  s.badges.push('pebble-badge');
  assert.equal(game.gateOpen(s, guard.gate), true);
});

test('story predicates and default beats', () => {
  const game = createGame(content, { seed: 1 });
  const s = game.createState();
  s.player.map = 'route-1';
  assert.equal(storyTest({ all: [{ area: 'route-1' }, { not: { flag: 'rival-1' } }] }, s, game), true);
  s.flags['rival-1'] = true;
  assert.equal(storyTest({ any: [{ flag: 'rival-1' }, { badges: { gte: 3 } }] }, s, game), true);
  assert.equal(storyTest({ caught: { gte: 1 } }, s, game), false);
  // Content without rival battles gets the three default rival beats.
  const bare = structuredClone(content); bare.story = [];
  assert.deepEqual(storyRules(bare).map(r => r.id), ['rival-1', 'rival-2', 'rival-3']);
  assert.equal(counterStarter(content, 'drizzlet'), 'sproutle', 'leaf beats tide');
  const p = rivalParty(content, 'sproutle', 2, 2);
  assert.equal(p[p.length - 1].species, 'bramblet', 'the ace evolves on the level curve');
  assert.ok(p.length >= 2);
});

function earlyGame(seed) {
  const game = createGame(content, { seed });
  const s = game.createState();
  const bot = createBot(game, s, { catchSpecies: 'any', starter: 2 });
  bot.settle();
  return { game, s, bot };
}

test('scripted early game: pick a starter, reach the first route, battle and catch', () => {
  const { s, bot } = earlyGame(1);
  assert.equal(s.starter, 'drizzlet');
  assert.equal(s.rivalStarter, 'sproutle');
  assert.equal(s.party.length, 1);
  assert.ok(s.bag.orb >= 5, 'the mentor hands over balls');
  assert.ok(bot.goTo('route-1'), 'walked out of the lab, through town, to route 1');
  bot.settle();
  assert.equal(bot.battles[0]?.trainer, 'rival', 'the rival battles on the first route');
  let tries = 0;
  while (!Object.keys(s.caught).some(k => k !== s.starter) && tries++ < 12) bot.grind(300);
  assert.ok(bot.battles.some(b => b.kind === 'wild'), 'tall grass gives wild battles');
  assert.ok(bot.battles.some(b => b.outcome === 'capture'), 'caught a wild creature');
  assert.equal(s.party.length, 2);
  assert.ok(Object.keys(s.caught).length >= 2);
  assert.ok(bot.goTo('brookside'), 'reached the next town');
  assert.equal(bot.stuck, 0);
});

test('the same seed and inputs give the same final state', () => {
  const run = () => { const { s, bot } = earlyGame(5); bot.goTo('route-1'); bot.grind(80); return JSON.stringify(s); };
  assert.equal(run(), run());
});

test('tapping B opens the start menu; holding B runs', () => {
  const { game, s } = earlyGame(2);
  game.step(s, { b: true }); game.step(s, {});
  assert.equal(s.mode, 'menu');
  game.step(s, { b: true }); game.step(s, {});
  assert.equal(s.mode, 'overworld');
  // Run: hold B with a direction; steps take half the frames.
  game.step(s, { y: 1, b: true });
  assert.ok(s.player.move?.run || s.player.turnT, 'running step or turning');
  for (let i = 0; i < 8; i++) game.step(s, { y: 1, b: true });
  assert.equal(s.mode, 'overworld', 'running did not open the menu');
  for (let i = 0; i < 6; i++) game.step(s, {});
  assert.equal(s.mode, 'overworld');
});

test('saves restore across versions, keeping party, bag, badges and flags', () => {
  const { game, s, bot } = earlyGame(3);
  bot.goTo('route-1'); bot.settle();
  const old = JSON.parse(JSON.stringify(s));
  old.version = '0.0.1'; old.player.map = 'gone';
  const back = game.restore(JSON.stringify(old));
  assert.deepEqual(back.party, s.party);
  assert.deepEqual(back.bag, s.bag);
  assert.deepEqual(back.flags, s.flags);
  assert.ok(game.maps[back.player.map]);
  const same = game.restore(JSON.stringify(s));
  assert.deepEqual(same, JSON.parse(JSON.stringify(s)));
});
