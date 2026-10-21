// Human-rate hands (v2/verify/human.js, HUMAN_INPUT in v2/templates/contract.js): what a world receives when a bot
// plays it with a person's edge rate. Held input changes only at window starts, acts go out one per window at window
// starts (a mashed key is one act, nothing is dropped that a person could press), and a restore resumes the hands of
// the frame restored to, so a bot's lookahead simulates the same hands it plays with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { humanRate, windowFrames } from '../v2/verify/human.js';
import { HUMAN_INPUT } from '../v2/templates/contract.js';

/** A stand-in world: frame counter, the inputs it received, snapshot/restore of the frame. */
const fake = () => {
  const rt = { dt: 1 / 60, state: { frame: 0 }, got: [] };
  rt.step = input => { rt.got[rt.state.frame] = input; rt.state.frame++; };
  rt.snapshot = () => rt.state.frame;
  rt.restore = f => { rt.state.frame = f; };
  return rt;
};

test('human rate: 10 changes a second is a window of 6 frames at 60 Hz', () => {
  assert.equal(HUMAN_INPUT.changesPerSecond, 10);
  assert.equal(windowFrames(HUMAN_INPUT.changesPerSecond, 1 / 60), 6);
});

test('human rate: held input changes only at window starts; acts go out one per window, mashing is one act', () => {
  const rt = humanRate(fake, 10)(1);
  for (let f = 0; f < 24; f++) rt.step({ axes: { move: [f % 2 ? 1 : -1, 0] }, ...(f < 12 ? { actions: { jump: true } } : {}), ...(f === 13 ? { actions: { fire: true } } : {}) });
  const axes = rt.got.map(x => x.axes?.move?.[0]);
  for (let f = 0; f < 24; f++) assert.equal(axes[f], axes[f - (f % 6)], `frame ${f} holds what frame ${f - (f % 6)} chose`);
  const acts = rt.got.map((x, f) => (x.actions ? `${f}:${Object.keys(x.actions)}` : null)).filter(Boolean);
  assert.deepEqual(acts, ['0:jump', '6:jump', '18:fire'], 'a press per window at its start; the act asked for mid-window waits for the next');
  assert.deepEqual(rt.got[3].held, { jump: true }, 'a pressed key stays down for its window');
});

test('human rate: a restore resumes the hands of the frame restored to', () => {
  const rt = humanRate(fake, 10)(1);
  for (let f = 0; f < 6; f++) rt.step({ axes: { move: [1, 0] } });
  const snap = rt.snapshot();
  for (let f = 0; f < 6; f++) rt.step({ axes: { move: [-1, 0] } });
  const a = rt.got.slice(6, 12).map(x => x.axes.move[0]);
  rt.restore(snap);
  for (let f = 0; f < 6; f++) rt.step({ axes: { move: [-1, 0] } });
  assert.deepEqual(rt.got.slice(6, 12).map(x => x.axes.move[0]), a);
  assert.deepEqual(a, [-1, -1, -1, -1, -1, -1]);
});
