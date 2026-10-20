import test from 'node:test';
import assert from 'node:assert/strict';
import { doc, make, steps, check, codes, gameInstances } from './v2-p-items-fixtures.js';

const world = () => doc({
  systems: [{ use: 'gameplay.inventory' }, { use: 'gameplay.interact', with: { range: 2 } }],
  content: {
    items: [{ id: 'key', name: 'Key' }, { id: 'apple', name: 'Apple', stack: 5 }],
    archetypes: [
      { id: 'hero', kind: 'player', components: { body: { size: [1, 1, 1], facing: [1, 0, 0] } } },
      { id: 'sage', kind: 'npc', components: { body: { size: [1, 1, 1] }, interact: { prompt: 'Talk' } } },
      { id: 'key_pickup', kind: 'pickup', components: { body: { size: [1, 1, 1] }, pickup: { item: 'key' }, interact: { prompt: 'Take' } } },
      { id: 'vault', kind: 'prop', components: { body: { size: [1, 1, 1] }, interact: { prompt: 'Open', lockedPrompt: 'Locked', id: 'vault_door', when: { item: 'key' }, take: [{ item: 'key' }], once: true, do: [{ do: 'set_flag', flag: 'vault_open' }] } } },
      { id: 'tree', kind: 'prop', components: { body: { size: [1, 1, 1] }, interact: { kind: 'harvest', prompt: 'Pick', give: [{ item: 'apple', count: [1, 3] }], regrow: 1 } } },
      { id: 'crank', kind: 'prop', components: { body: { size: [1, 1, 1] }, interact: { kind: 'pull', prompt: 'Crank', hold: 0.25 } } },
    ],
  },
});

function setup() {
  const { rt, checked } = make(world());
  rt.spawn('sage', { id: 'sage', at: [2, 1, 0] });
  rt.spawn('key_pickup', { at: [8, 1, 0] });
  rt.spawn('vault', { id: 'vault1', at: [14, 1, 0] });
  rt.spawn('tree', { id: 'tree1', at: [20, 1, 0] });
  rt.spawn('crank', { id: 'crank1', at: [26, 1, 0] });
  return { rt, checked };
}
const goTo = (rt, at) => rt.space('world').setPos(rt.player(), at, rt);

test('interact: preflight accepts the document and its components', () => {
  const r = check(world());
  assert.ok(r.ok, JSON.stringify(r.errors));
});

test('interact: focus, talk, pickup, locked use, typed used events', () => {
  const { rt } = setup();
  rt.step();
  assert.equal(rt.service('interact').focus().target, 'sage');
  assert.equal(rt.state.counts.interact_focus, 1);
  rt.step({ actions: { interact: true } });
  assert.equal(rt.state.counts['talked:sage'], 1);
  assert.equal(rt.state.counts['used:sage'], 1);
  assert.ok(rt.test({ used: 'sage' }));
  // The vault is locked without the key: focus says so and use is denied.
  goTo(rt, [13, 1, 0]); rt.step();
  assert.equal(rt.service('interact').focus().label, 'Locked');
  rt.step({ actions: { interact: 'vault1' } });
  assert.equal(rt.state.events.find(e => e.name === 'interact_denied').reason, 'locked');
  // Out of reach is denied too.
  rt.step({ actions: { interact: 'tree1' } });
  assert.equal(rt.state.events.find(e => e.name === 'interact_denied').reason, 'range');
  // Pick up the key: item gained (typed), pickup despawned.
  goTo(rt, [7, 1, 0]); rt.step({ actions: { interact: true } });
  assert.equal(rt.state.counts['item_gained:key'], 1);
  assert.equal(Object.values(rt.state.entities).filter(e => e.archetype === 'key_pickup').length, 0);
  goTo(rt, [13, 1, 0]); rt.step({ actions: { interact: true } });
  assert.equal(rt.state.flags.vault_open, true);
  assert.equal(rt.state.counts['used:vault_door'], 1, 'interact.id alias');
  assert.equal(rt.state.counts['used:vault1'], 1, 'explicit entity id alias');
  assert.equal(rt.state.counts['used:vault'], 1, 'archetype alias');
  assert.equal(rt.test({ item: 'key' }), false, 'take consumed the key');
  rt.step({ actions: { interact: 'vault1' } });
  assert.equal(rt.state.events.find(e => e.name === 'interact_denied').reason, 'spent');
});

test('interact: harvest regrows, hold-to-use and scripted interact', () => {
  const { rt } = setup();
  goTo(rt, [19, 1, 0]); rt.step({ actions: { interact: true } });
  const first = rt.state.prim['gameplay.inventory'].player.apple;
  assert.ok(first >= 1 && first <= 3);
  rt.step({ actions: { interact: 'tree1' } });
  assert.equal(rt.state.events.find(e => e.name === 'interact_denied').reason, 'cooldown');
  steps(rt, 60);
  rt.step({ actions: { interact: 'tree1' } });
  assert.ok(rt.state.prim['gameplay.inventory'].player.apple > first);
  // Hold: the crank needs 0.25 s of holding; releasing early cancels.
  goTo(rt, [25, 1, 0]);
  rt.step({ actions: { interact: true } }); rt.step();
  assert.equal(rt.state.counts.interact_cancelled, 1);
  for (let i = 0; i < 20; i++) rt.step({ actions: { interact: true } });
  assert.equal(rt.state.counts['used:crank1'], 1);
  assert.equal(rt.state.prim['gameplay.interact'].on.crank1, true);
  // Scripted use ignores range; enable_interactable switches one off.
  rt.run([{ do: 'enable_interactable', id: 'sage', on: false }, { do: 'interact', target: 'sage' }]);
  assert.equal(rt.state.counts['talked:sage'] ?? 0, 0);
  rt.run([{ do: 'enable_interactable', id: 'sage', on: true }, { do: 'interact', target: 'sage' }]);
  assert.equal(rt.state.counts['talked:sage'], 1);
});

test('interact: solver options cover interactables in reach and reachable ones', () => {
  const { rt } = setup();
  rt.step();
  const opts = rt.availableOptions().filter(o => o.actions.interact);
  assert.ok(opts.some(o => o.actions.interact === 'sage' && !o.apply), 'in reach');
  const far = opts.find(o => o.actions.interact === 'tree1');
  assert.ok(far?.apply, 'reachable via path');
  far.apply(rt);
  for (let i = 0; i < far.steps; i++) rt.step({ actions: far.actions });
  assert.equal(rt.state.counts['used:tree1'], 1);
  assert.ok(!opts.some(o => o.actions.interact === 'vault1'), 'locked ones are not offered');
});

test('interact: deterministic replay', () => {
  const a = setup().rt, b = setup().rt;
  for (const rt of [a, b]) { goTo(rt, [19, 1, 0]); for (let i = 0; i < 90; i++) rt.step({ actions: { interact: i % 7 === 0 } }); }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('interact: preflight rejects bad config with stable codes', () => {
  const d = world();
  d.systems[1].with.range = -1;
  d.systems[1].with.wobble = true;
  d.content.archetypes[1].components.interact.kind = 'dance';
  d.content.archetypes[2].components.interact.do = [{ do: 'explode' }];
  d.content.archetypes[2].components.pickup.item = 'ghost_item';
  const c = codes(check(d));
  for (const code of ['param_range', 'param_unknown', 'interact_invalid', 'effect_unknown', 'ref_unknown']) assert.ok(c.includes(code), code);
});

test('interact: every instance in v2/games preflights without param errors', () => {
  const found = gameInstances('gameplay.interact');
  assert.ok(found.length >= 3);
  for (const x of found) assert.deepEqual(x.paramErrors, [], `${x.game} ${x.path}`);
});
