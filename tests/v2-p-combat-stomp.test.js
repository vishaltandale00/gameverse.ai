// Stomps (gameplay.combat.health components.touch.stomp): a hostile body falling onto a stompable toucher from above
// defeats it instead of being hurt (stomped {who, by}); touching it from the side still hurts. gameplay.move.platformer
// bounces the stomper it drives (stompBounce × jump).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace, run } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const floor = []; for (let x = 0; x < 24; x++) floor.push([x, 0, 0]);
const doc = ({ stomp = true, at = [2, 1, 0], bounce } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'stomptest', title: 'Stomp test', seed: 3,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [24, 12, 1], gravity: 60, solid: floor } }],
  systems: [{ use: 'gameplay.move.platformer', with: bounce === undefined ? {} : { stompBounce: bounce } }, { use: 'gameplay.combat.health', with: { iframes: 0 } },
    { use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'w1', archetype: 'walker', at: [8, 1, 0], unique: true, activation: 'always', respawnSec: 0 }] } }],
  content: { archetypes: [{ id: 'hero', components: { health: { max: 3 }, body: { size: [0.8, 0.95, 1] } } },
    { id: 'walker', kind: 'enemy', components: { health: { max: 1 }, touch: { damage: 1, stomp }, body: { size: [0.9, 0.9, 1] } } }] },
  player: { archetype: 'hero', at },
});
const make = d => compile(d, { primitives: [testSpace, ...PRIMITIVES] }).rt;
const registry = new Registry([testSpace, ...PRIMITIVES]), logic = buildLogic(registry, Logic);

test('stomp: falling onto a stompable body defeats it and bounces the stomper; the stomper is not hurt', () => {
  assert.ok(preflight(doc(), registry, logic).ok);
  const rt = make(doc({ at: [8.05, 5, 0] }));
  let rose = false;
  for (let i = 0; i < 60; i++) { rt.step({}); if (rt.state.counts.stomped && (rt.player().components.body.vel[1] > 5)) rose = true; }
  assert.equal(rt.state.counts.stomped, 1);
  assert.ok(rt.state.counts['defeated:walker'] >= 1, 'the walker is defeated');
  assert.equal(rt.state.vars.hp, 3, 'the stomper took no damage');
  assert.ok(rose, 'the platformer bounced the stomper up');
});

test('stomp: walking into its side hurts; without stomp a fall onto it hurts too; stompBounce 0 does not bounce; replay', () => {
  const side = make(doc());
  run(side, 120, { axes: { move: [1, 0] } });
  assert.equal(side.state.counts.stomped ?? 0, 0);
  assert.ok(side.state.vars.hp < 3, 'touching its side hurts');
  const plain = make(doc({ stomp: false, at: [8.05, 5, 0] }));
  run(plain, 60, {});
  assert.equal(plain.state.counts.stomped ?? 0, 0);
  assert.ok(plain.state.vars.hp < 3, 'a body that is not stompable hurts whoever lands on it');
  const flat = make(doc({ at: [8.05, 5, 0], bounce: 0 }));
  for (let i = 0; i < 60; i++) { flat.step({}); if (flat.state.counts.stomped) assert.ok(flat.player().components.body.vel[1] <= 0, 'no bounce'); }
  assert.equal(flat.state.counts.stomped, 1);
  const a = make(doc({ at: [8.05, 5, 0] })), b = make(doc({ at: [8.05, 5, 0] }));
  run(a, 90, {}); run(b, 90, {});
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('stomp: preflight rejects an out-of-range stompBounce with its stable code', () => {
  assert.deepEqual(preflight(doc({ bounce: 3 }), registry, logic).errors.map(e => `${e.code}@${e.path}`), ['param_range@systems[0].with.stompBounce']);
});
