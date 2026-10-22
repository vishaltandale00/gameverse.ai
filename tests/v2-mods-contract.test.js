// Every mod × every kit that can host it: composes, plays 600 frames of random input, renders on a
// stub canvas without throwing, and replays to the same state from the same seed. Short timers
// make each mod's mechanic actually fire inside the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { availableKits } from '../v2/kits/registry.js';
import { MODS } from '../v2/kits/mods/index.js';
import { modsFor, modsSchema, activeMods, composeGame, composeRenderer } from '../v2/kits/mods/compose.js';
import { random, seedFrom } from '../v2/kernel/rng.js';

export const ON = {
  weapon: { kind: 'projectile', ammoFrom: 'unlimited' },
  falling: { pieces: 'mixed', every: 2, speed: 12, steer: 'follow', rotate: true, clearRows: true },
  waves: { enabled: true, waves: 4, every: 4, size: 2, grow: 'both', mustClear: true },
  boss: { enabled: true, arrivesAfter: 0, toughness: 'easy', mustBeat: true },
  timer: { enabled: true, seconds: 10, onZero: 'lose' },
  shield: { enabled: true, seconds: 1, cooldown: 2 },
  zones: { enabled: true, every: 5, lasts: 3 },
};
const strict = (node, path = '$') => {
  if (node?.type === 'object') {
    assert.equal(node.additionalProperties, false, path);
    assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
    for (const [k, v] of Object.entries(node.properties)) strict(v, `${path}.${k}`);
  }
  for (const bad of ['oneOf', 'anyOf', 'minimum', 'maximum']) assert.ok(!(bad in (node || {})), `${path}: ${bad}`);
};
const stubCanvas = () => new Proxy({}, { get: (t, k) => k === 'canvas' ? { width: 640, height: 480 } : k === 'measureText' ? () => ({ width: 40 }) : k === 'getTransform' ? () => ({ a: 1 }) : k === 'getImageData' || k === 'createImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k in t ? t[k] : (typeof k === 'string' && k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });

const kits = (await availableKits()).filter(({ kit }) => kit.world);
// The kits' own samples, plus runner modes that host different operations (climb spawns monsters).
const cases = kits.flatMap(({ id, kit }) => {
  const list = [[id, kit, kit.content.sample]];
  if (id === 'runner') list.push([`${id}:climb`, kit, kit.samples.climb]);
  return list;
});

test('every mod has a strict schema fragment that is off by default, a summary, and declared requirements', () => {
  assert.ok(MODS.length >= 7);
  for (const mod of MODS) {
    strict(mod.schema, mod.id);
    assert.ok(mod.summary.length > 40, `${mod.id} summary`);
    assert.ok(Array.isArray(mod.requires) && mod.requires.length, `${mod.id} requires`);
    assert.equal(mod.enabled(mod.normalize(undefined)), false, `${mod.id} is off unless asked`);
    assert.equal(mod.enabled(mod.normalize({})), false, `${mod.id} is off for an empty config`);
    assert.ok(mod.enabled(mod.normalize(ON[mod.id])), `${mod.id} test config switches it on`);
    assert.deepEqual(mod.normalize(mod.normalize(ON[mod.id])), mod.normalize(ON[mod.id]), `${mod.id} normalize is idempotent`);
  }
  for (const { id, kit } of kits) strict(modsSchema(kit), `${id}.mods`);
});

for (const [id, kit, sample] of cases) {
  const content = kit.validate(sample).content;
  for (const mod of modsFor(kit, content)) {
    test(`${mod.id} on ${id}: 600 random frames compose, play and render deterministically`, () => {
      const play = () => {
        const game = composeGame(kit, content, { seed: 5, mods: { [mod.id]: ON[mod.id] } });
        assert.equal(game.mods.length, 1, 'the mod is active');
        const s = game.createState(), render = composeRenderer(kit, game, { art: {} }), ctx = stubCanvas();
        const rng = { rng: seedFrom(`${id}:${mod.id}`) };
        let input = { x: 0, y: 0, a: false, b: false };
        for (let i = 0; i < 600; i++) {
          if (i % 8 === 0) input = { x: Math.floor(random(rng) * 3) - 1, y: Math.floor(random(rng) * 3) - 1, a: random(rng) < 0.3, b: random(rng) < 0.3 };
          // Game rules (kit and mods) never use Math.random: randomness lives in state (kernel/rng.js).
          const real = Math.random;
          Math.random = () => { throw new Error('Math.random in a game step'); };
          try { game.step(s, input); } finally { Math.random = real; }
          assert.ok(['playing', 'won', 'lost'].includes(s.status));
          if (i % 10 === 0) render(ctx, s, { cssWidth: 640, cssHeight: 480, dt: 1 / 60, events: s.events });
        }
        return JSON.stringify(s);
      };
      assert.equal(play(), play(), 'same seed and inputs give the same state');
    });
  }
}

test('activeMods drops a mod whose capability the content lacks; button mods need a free button', () => {
  const physics = kits.find(k => k.id === 'physics').kit;
  const pinball = { ...physics.content.sample, levels: physics.content.sample.levels.filter(l => l.mode === 'pinball') };
  assert.ok(activeMods(physics, { falling: ON.falling }, physics.validate(physics.content.sample).content).length, 'breakout levels host falling pieces');
  if (pinball.levels.length) assert.deepEqual(activeMods(physics, { falling: ON.falling }, pinball), [], 'a pinball-only game has no brick grid');
  const fighting = kits.find(k => k.id === 'fighting').kit;
  assert.deepEqual(activeMods(fighting, { shield: ON.shield }), [], 'both fighting buttons are taken');
});
