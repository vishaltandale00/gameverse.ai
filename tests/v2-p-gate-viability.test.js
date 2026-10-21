// The publish gate (verify-adapter viability): crashes block; given the playbots' report, so does a game the
// player cannot act in, one no mode bot can play, and one where neither the mode bot nor the explorer progresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { viability } from '../v2/planner/verify-adapter.js';

const play = (over = {}) => ({ winnable: false, explored: 40, timeline: { score: { start: 4, high: 4 } }, idle: { score: 4 }, ...over });
const bot = (over = {}) => ({ id: 'turn-board', reason: "mode 'tactics' (gameplay.turns)", ok: true, proven: ['won 3/3'], metrics: {}, ...over });
const code = v => v.viability?.split(':')[0] ?? null;

test('crash-only callers keep the old verdict', () => {
  assert.deepEqual(viability(play({ explored: 1 }), []), { viable: true, viability: null });
  assert.equal(viability(play(), [{ code: 'runtime_error', message: 'boom', stage: 'playtest' }]).viable, false);
});

test('a game whose mode bot wins publishes', () => {
  assert.deepEqual(viability(play(), [], { ran: [bot()] }), { viable: true, viability: null });
});

test('progress without a win publishes (no time-to-finish rule); what idling reaches is not progress', () => {
  assert.equal(viability(play({ timeline: { score: { start: 4, high: 7 } } }), [], { ran: [bot({ proven: [] })] }).viable, true);
  assert.equal(viability(play({ timeline: { score: { start: 0, high: 4 } } }), [], { ran: [bot({ proven: [] })] }).viable, false);
});

test('a world the player cannot act in is blocked', () => {
  assert.equal(code(viability(play({ explored: 1 }), [], { ran: [bot()] })), 'cannot_act');
  assert.equal(code(viability(play(), [{ code: 'stuck_state', message: 'no input changes state', severity: 'warning', stage: 'invariants' }], { ran: [bot()] })), 'cannot_act');
});

test('no mode bot, a bot with nothing to play, a bot that threw, or no progress all block', () => {
  assert.equal(code(viability(play(), [], { ran: [{ id: 'dodge', reason: 'detected', ok: true, proven: [] }] })), 'no_mode_bot');
  assert.equal(code(viability(play(), [], { ran: [bot({ metrics: { skipped: 'no race' }, proven: [] })] })), 'mode_absent');
  assert.equal(code(viability(play(), [], { ran: [bot({ error: 'boom', proven: [] })] })), 'bot_failed');
  assert.equal(code(viability(play(), [], { ran: [bot({ proven: [] })] })), 'no_progress');
  assert.equal(code(viability(null, [], { ran: [bot()] })), 'not_played');
  assert.equal(code(viability(play(), [], null)), 'no_mode_bot');
});
