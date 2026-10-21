// The publish gate (verify-adapter viability): crashes block; given the playbots' report, so does a game the
// player cannot act in, one whose primitives declare no loop, one whose declared loop never happens from play,
// and one where play makes no progress beyond idling. Bots are stronger players when present, never required.
import test from 'node:test';
import assert from 'node:assert/strict';
import { viability } from '../v2/planner/verify-adapter.js';
import { loopEvents } from '../v2/verify/objective.js';

const play = (over = {}) => ({ winnable: false, explored: 40, timeline: { score: { start: 0, high: 6 } }, idle: { score: 4, counts: { beat: 1 } }, eventsFired: { beat: 1, harvest: 2 }, ...over });
const loop = ['harvest', 'planted'];
const bots = (ran = []) => ({ ran });
const code = v => v.viability?.split(':')[0] ?? null;

test('crash-only callers keep the old verdict', () => {
  assert.deepEqual(viability(play({ explored: 1 }), []), { viable: true, viability: null });
  assert.equal(viability(play(), [{ code: 'runtime_error', message: 'boom', stage: 'playtest' }]).viable, false);
});

test('a game whose declared loop happens from play and progresses publishes, with or without a bot', () => {
  assert.deepEqual(viability(play(), [], bots(), loop), { viable: true, viability: null });
  assert.deepEqual(viability(play(), [], null, loop), { viable: true, viability: null });
});

test('wildcard loop events match by prefix', () => {
  assert.equal(viability(play({ eventsFired: { 'collected:coin': 3 } }), [], bots(), ['collected:']).viable, true);
});

test('a world the player cannot act in is blocked', () => {
  assert.equal(code(viability(play(), [{ code: 'stuck_state', message: 'no input changes state', severity: 'warning', stage: 'invariants' }], bots(), loop)), 'cannot_act');
});

test('an undeclared loop, a loop that only idling fires, no progress, or a bot that threw all block', () => {
  assert.equal(code(viability(play(), [], bots(), [])), 'loop_undeclared');
  assert.equal(code(viability(play({ eventsFired: { beat: 1 } }), [], bots(), ['beat'])), 'loop_absent');
  assert.equal(code(viability(play({ timeline: { score: { start: 0, high: 4 } } }), [], bots(), loop)), 'no_progress');
  assert.equal(code(viability(play(), [], bots([{ id: 'race', reason: 'card', error: 'boom' }]), loop)), 'bot_failed');
  assert.equal(code(viability(null, [], bots(), loop)), 'not_played');
});

test('a bot that proves a win counts as progress', () => {
  assert.equal(viability(play({ timeline: { score: { start: 0, high: 4 } } }), [], bots([{ id: 'race', reason: 'card', proven: ['won 2/3'] }]), loop).viable, true);
});

test('loopEvents reads the progress the document\'s primitives declare', () => {
  const registry = new Map([['a', { card: { loop: { progress: ['harvest'] } } }], ['b', { card: { mode: { progress: ['lap'] } } }], ['c', { card: {} }]]);
  const doc = { spaces: [], systems: [{ use: 'a' }, { use: 'b' }, { use: 'c' }] };
  assert.deepEqual(loopEvents(doc, registry).sort(), ['harvest', 'lap']);
});

test('an exhaustively unreachable ending blocks unless play actually won; the solver softlock report does not block', () => {
  assert.equal(code(viability(play(), [{ code: 'plot_uncompletable', message: 'no ending is reachable', severity: 'error', stage: 'plot' }], bots(), loop)), 'plot_uncompletable');
  assert.equal(viability(play({ winnable: true }), [{ code: 'plot_uncompletable', message: 'no ending is reachable', severity: 'error', stage: 'plot' }], bots(), loop).viable, true);
  assert.equal(viability(play(), [{ code: 'softlock', message: 'AI turn', severity: 'error', stage: 'plot' }], bots(), loop).viable, true);
});
