import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputLifecycle, createCombatLifecycle, createProgressionLifecycle } from '../src/playable-mashup-lifecycle.js';

test('held attack cannot authorize another new contact; movement still repeats', () => {
  const input = createInputLifecycle({ actions: { attack: 'press', right: 'hold' } });
  const first = input.sample({ attack: true, right: true });
  const second = input.sample({ attack: true, right: true });
  assert.equal(first.actions.attack, 'attack:1');
  assert.equal(second.actions.attack, undefined);
  assert.ok(second.actions.right);
  input.sample({ attack: false });
  assert.ok(input.sample({ attack: true }).actions.attack);
  input.reset();
  assert.equal(input.sample({ attack: true }).actions.attack, 'attack:1');
});

test('disabled physical press is consumed and release remains explicit', () => {
  const input = createInputLifecycle({ actions: { attack: 'press', charge: 'release' } });
  assert.deepEqual(input.sample({ attack: true, charge: true }, { disabled: true }).actions, {});
  assert.deepEqual(input.sample({ attack: true, charge: true }).actions, {});
  assert.ok(input.sample({}).actions.charge);
});

test('lethal contact settles cleanup/reward once and cannot reset dead reaction', () => {
  const source = { hp: 3, reaction: 0 };
  const calls = [];
  const combat = createCombatLifecycle({ onDeath: id => calls.push(`death:${id}`), onCleanup: id => calls.push(`cleanup:${id}`), onReward: id => calls.push(`reward:${id}`) });
  combat.addActor('enemy', { getHp: () => source.hp });
  combat.beginStep();
  const sourceHit = () => { source.hp = Math.max(0, source.hp - 3); source.reaction = 17; };
  assert.equal(combat.contact({ actorId: 'enemy', actionId: 'attack:1', applyHit: sourceHit }).accepted, true);
  source.reaction -= 1; // Later eligible source reaction prepass.
  combat.endStep();
  combat.beginStep();
  assert.equal(combat.contact({ actorId: 'enemy', actionId: 'attack:2', applyHit: sourceHit }).reason, 'terminal');
  combat.endStep();
  assert.equal(source.reaction, 16);
  assert.deepEqual(calls, ['death:enemy', 'cleanup:enemy', 'reward:enemy']);
  assert.deepEqual(combat.drainEvents().map(event => event.type), ['accepted-hit', 'death', 'cleanup', 'reward']);
  assert.deepEqual(combat.drainEvents(), []);
});

test('action-target identity is selective and protection expires after declared steps', () => {
  let hp = 20;
  const combat = createCombatLifecycle({ protectionTicks: 2 });
  combat.addActor('enemy', { getHp: () => hp });
  const hit = actionId => combat.contact({ actorId: 'enemy', actionId, applyHit: () => { hp -= 3; } });
  combat.beginStep(); assert.equal(hit('a').accepted, true); combat.endStep();
  combat.beginStep(); assert.equal(hit('b').reason, 'protected'); combat.endStep();
  combat.beginStep(); assert.equal(hit('b').reason, 'protected'); combat.endStep();
  combat.beginStep(); assert.equal(hit('a').reason, 'duplicate-contact'); assert.equal(hit('b').accepted, true); combat.endStep();
  assert.equal(hp, 14);
});

test('fresh game reset permits same identities against fresh canonical actors', () => {
  let hp = 3, rewards = 0;
  const combat = createCombatLifecycle({ onReward: () => rewards++ });
  const run = () => {
    combat.addActor('enemy', { getHp: () => hp }); combat.beginStep();
    combat.contact({ actorId: 'enemy', actionId: 'a', applyHit: () => { hp = 0; } }); combat.endStep();
  };
  run(); assert.equal(rewards, 1);
  combat.reset(); hp = 3; run(); assert.equal(rewards, 2);
  assert.equal(combat.observe('enemy').tick, 1);
});

test('duplicate confirmation does not undo exchange; new confirmed command exchanges again', () => {
  let owned = false, cache = false, refreshes = 0;
  const actions = [2, 9], battlers = [3, 0];
  const progression = createProgressionLifecycle({
    mutate: value => { owned = value; },
    refresh: () => { refreshes++; cache = owned; return cache; },
    canUse: capability => capability,
    consume: () => { actions.reverse(); battlers.reverse(); },
  });
  progression.change(true);
  assert.equal(cache, true);
  assert.equal(progression.use({ commandId: 'confirm:1' }).accepted, true);
  assert.equal(progression.use({ commandId: 'confirm:1' }).reason, 'duplicate-command');
  assert.deepEqual(actions, [9, 2]); assert.deepEqual(battlers, [0, 3]);
  assert.equal(progression.use({ commandId: 'confirm:2' }).accepted, true);
  assert.deepEqual(actions, [2, 9]);
  progression.change(false);
  assert.equal(cache, false);
  assert.equal(progression.use({ commandId: 'confirm:3' }).reason, 'unavailable');
  owned = true; // Even external canonical writes are refreshed before consuming.
  assert.equal(progression.use({ commandId: 'confirm:4' }).accepted, true);
  assert.equal(refreshes, 6);
  progression.reset();
  assert.equal(progression.use({ commandId: 'confirm:1' }).accepted, true);
});

test('external terminal source HP excludes contact before death continuation', () => {
  let hp = 0, hits = 0;
  const combat = createCombatLifecycle();
  combat.addActor('enemy', { getHp: () => hp }); combat.beginStep();
  assert.equal(combat.contact({ actorId: 'enemy', actionId: 'a', applyHit: () => hits++ }).reason, 'terminal');
  combat.endStep(); assert.equal(hits, 0);
  assert.throws(() => combat.contact({ actorId: 'enemy', actionId: 'b' }), /beginStep/);
});

test('a source callback cannot reenter another hit on the same target', () => {
  let hp = 10, nested;
  const combat = createCombatLifecycle({ protectionTicks: 1 });
  combat.addActor('enemy', { getHp: () => hp }); combat.beginStep();
  combat.contact({ actorId: 'enemy', actionId: 'outer', applyHit: () => {
    nested = combat.contact({ actorId: 'enemy', actionId: 'inner', applyHit: () => { hp -= 3; } });
    hp -= 3;
  } });
  combat.endStep();
  assert.equal(nested.reason, 'hit-in-progress'); assert.equal(hp, 7);
});
