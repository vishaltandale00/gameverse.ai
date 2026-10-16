import test from 'node:test';
import assert from 'node:assert/strict';
import { SportsFeedback, feedbackProfile, mergePendingInput } from '../src/sports-feedback.js';

test('high refresh frames retain skill direction and release until a simulation tick', () => {
  const direction = { x: 0, y: -1 };
  const pending = { pressed: { skill: true }, released: { shoot: true }, gesture: direction, skillDirection: direction };
  const sampled = { pressed: { skill: false }, released: { shoot: false }, move: { x: 1, y: 0 }, gesture: null, skillDirection: null };
  assert.equal(mergePendingInput(sampled, pending), sampled);
  assert.equal(sampled.pressed.skill, true); assert.equal(sampled.released.shoot, true);
  assert.deepEqual(sampled.gesture, direction); assert.deepEqual(sampled.skillDirection, direction);
  assert.deepEqual(sampled.move, { x: 1, y: 0 }, 'movement remains the newest analog sample');
});

test('event feedback is bounded and malformed presentation events are ignored', () => {
  assert.equal(feedbackProfile({ id: 1, kind: 'teleport' }), null);
  assert.equal(feedbackProfile({ id: NaN, kind: 'kick' }), null);
  const a = feedbackProfile({ id: 1, kind: 'tackle', strength: 99 });
  assert.ok(a.strongMagnitude <= 1 && a.weakMagnitude <= 1 && a.duration < 600);
  const b = feedbackProfile({ id: 2, kind: 'pass', strength: -4 });
  assert.equal(b.strongMagnitude, 0); assert.equal(b.weakMagnitude, 0);
});

test('quick receiver taps preserve left-stick lead and voice cancellation between fixed ticks', () => {
  const pending = { pressed: { receiverB: true }, released: {}, held: { receiverB: true }, aim: { x: 1, y: 0 }, cancelled: { receiverB: true } };
  const next = { pressed: {}, released: { receiverB: true }, held: {}, aim: { x: 0, y: 0 }, move: { x: 0, y: 0 } };
  const input = mergePendingInput(next, pending);
  assert.deepEqual(input.aim, { x: 1, y: 0 }, 'preserve sampled left-stick lead on a short tap');
  assert.equal(input.pressed.receiverB, true);
  assert.equal(input.released.receiverB, true);
  assert.equal(input.cancelled.receiverB, true, 'voice cancellation must survive until the model tick');
  assert.deepEqual(input.move, { x: 0, y: 0 }, 'do not continue movement after the stick centers');
});

test('each contact rumbles once and checkpoint resume cannot replay old contact', () => {
  const effects = []; let resets = 0;
  const pad = { vibrationActuator: { playEffect: (...args) => { effects.push(args); return Promise.resolve(); }, reset: () => { resets++; return Promise.resolve(); } } };
  const feedback = new SportsFeedback({ getPad: () => pad, audioFactory: () => { throw Error('No audio device'); } });
  const event = { id: 4, kind: 'tackle', strength: .8 };
  feedback.resume({ id: 3 }); feedback.consume(event); feedback.consume(event);
  assert.equal(effects.length, 1); assert.equal(effects[0][0], 'dual-rumble');
  feedback.pause(); feedback.consume({ ...event, id: 5 }); assert.equal(effects.length, 1); assert.equal(resets, 1);
  feedback.resume(event); feedback.consume(event); assert.equal(effects.length, 1);
  feedback.consume({ id: 5, kind: 'skill', strength: .4 }); assert.equal(effects.length, 2);
  feedback.dispose(); feedback.resume(); feedback.consume({ ...event, id: 6 }); assert.equal(effects.length, 2);
});

test('missing or throwing output devices cannot break simulation feedback', () => {
  for (const pad of [null, {}, { vibrationActuator: { playEffect() { throw Error('unsupported'); }, reset() { throw Error('gone'); } } }]) {
    const feedback = new SportsFeedback({ getPad: () => pad, audioFactory: () => { throw Error('blocked'); } });
    assert.doesNotThrow(() => { feedback.resume(); feedback.consume({ id: 1, kind: 'kick', strength: .5 }); feedback.dispose(); });
    assert.equal(feedback.observed, 1);
  }
});

test('disconnect still stops the actuator that last received an effect', () => {
  let resets = 0, pad = { vibrationActuator: { playEffect: () => Promise.resolve(), reset: () => { resets++; return Promise.resolve(); } } };
  const feedback = new SportsFeedback({ getPad: () => pad, audioFactory: () => null });
  feedback.resume(); feedback.consume({ id: 1, kind: 'tackle', strength: 1 });
  pad = null; feedback.pause(); assert.equal(resets, 1);
});
