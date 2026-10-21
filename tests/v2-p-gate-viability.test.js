// The publish gate (verify-adapter viability): crashes block; given the playbots' report, so does a game the
// player cannot act in, one whose primitives declare no loop, one whose declared loop never happens from play,
// and one where play never wins and never moves the quantity the core loop's win reads (card.loop.win.reads)
// beyond what idling moves it. Bots are stronger players when present, never required.
import test from 'node:test';
import assert from 'node:assert/strict';
import { viability, winQuantity } from '../v2/planner/verify-adapter.js';
import { playtest } from '../v2/verify/playtest.js';
import { loopEvents, winMeasure } from '../v2/verify/objective.js';
import { preset } from '../v2/planner/presets.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { testCatalogue } from './v2-p-pipeline-fixtures.js';

const play = (over = {}) => ({ winnable: false, explored: 40, timeline: { score: { start: 0, high: 6 } }, idle: { score: 4, counts: { beat: 1 } }, eventsFired: { beat: 1, harvest: 2 }, progress: { quantity: 'event harvest', target: 10, idle: 0, high: 2 }, ...over });
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
  assert.equal(code(viability(play({ progress: { quantity: 'event harvest', target: 10, idle: 1, high: 1 } }), [], bots(), loop)), 'no_progress');
  assert.equal(code(viability(play(), [], bots([{ id: 'race', reason: 'card', error: 'boom' }]), loop)), 'bot_failed');
  assert.equal(code(viability(null, [], bots(), loop)), 'not_played');
});

test('progress is the win quantity, not the objective score: a rising score with an unmoved win quantity blocks, a moved one passes unfinished', () => {
  const still = viability(play({ timeline: { score: { start: 0, high: 60 } }, progress: { quantity: 'event harvest', target: 10, idle: 0, high: 0 } }), [], bots(), loop);
  assert.equal(code(still), 'no_progress');
  assert.match(String(still.viability), /win quantity \(event harvest, target 10\) never moved/);
  assert.equal(viability(play({ timeline: { score: { start: 0, high: 0 } }, progress: { quantity: 'event harvest', target: 10, idle: 0, high: 1 } }), [], bots(), loop).viable, true);
  // No declared win quantity: nothing to measure progress on, and no win seen.
  assert.match(String(viability(play({ progress: null }), [], bots(), loop).viability), /^no_progress: .*declares no quantity/);
});

test('a win (the explorer\'s or a bot\'s) counts as progress', () => {
  const none = { quantity: 'event harvest', idle: 0, high: 0 };
  assert.equal(viability(play({ progress: none }), [], bots([{ id: 'race', reason: 'card', proven: ['won 2/3'] }]), loop).viable, true);
  assert.equal(viability(play({ progress: none, winnable: true }), [], bots(), loop).viable, true);
});

test('a bot\'s play that moves the win quantity beyond idling counts as progress; a bot that never moves it does not', () => {
  const none = { quantity: 'var stage.advance', idle: 0, high: 0 };
  assert.equal(viability(play({ progress: none }), [], bots([{ id: 'stages', reason: 'card', proven: [], progress: 0.5 }]), loop).viable, true);
  assert.equal(code(viability(play({ progress: none }), [], bots([{ id: 'stages', reason: 'card', proven: [], progress: 0 }]), loop)), 'no_progress');
  assert.equal(code(viability(play({ progress: { ...none, idle: 1 } }), [], bots([{ id: 'stages', reason: 'card', proven: [], progress: 1 }]), loop)), 'no_progress', 'idling moves it as far');
});

test('winMeasure measures events, vars toward their target, and the components of the entities a win reads', () => {
  const rt = state => ({ state });
  const ev = winMeasure({ event: 'lap', cmp: 'gte', target: 3 });
  const c0 = ev.start(rt({ counts: {}, vars: {}, entities: {} }));
  assert.equal(ev.advance(rt({ counts: { 'lap:p1': 2 }, vars: {}, entities: {} }), c0), 2);
  const down = winMeasure({ var: 'heat', cmp: 'lte', target: 0 });
  const d0 = down.start(rt({ counts: {}, vars: { heat: 5 }, entities: {} }));
  assert.equal(down.advance(rt({ counts: {}, vars: { heat: 3 }, entities: {} }), d0), 2);
  assert.equal(down.advance(rt({ counts: {}, vars: { heat: 7 }, entities: {} }), d0), -2);
  const hp = winMeasure({ component: 'health', of: 'opponents' });
  const ents = h => ({ player: { id: 'player', components: { health: { hp: 1 } } }, a: { id: 'a', components: { health: { hp: h } } }, b: { id: 'b', components: { health: { hp: 3 } } } });
  const s0 = rt({ counts: {}, vars: {}, entities: ents(3) });
  let carry = hp.start(s0);
  assert.equal(hp.advance(s0, carry), 0);
  assert.equal(hp.advance(rt({ counts: {}, vars: {}, entities: ents(2) }), carry), 1, 'one opponent worn down');
  const ids = hp.track(s0);
  const gone = rt({ counts: {}, vars: {}, entities: { player: ents(3).player, a: ents(3).a } });
  carry = hp.carry(carry, ids, gone);
  assert.equal(hp.advance(gone, carry), 1, 'one opponent removed');
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

// ---------- the gate on real play (the playtest agent and viability): score is not progress ----------
/**
 * A tally loop: each stroke marks the board (a loop progress event the objective scores) and the win counts goals.
 * `goals`: the strokes that score one (none: play marks and marks, the score rises, and the win quantity never moves; the first only:
 * the win quantity moves and the game cannot be finished).
 */
const tallyOf = (id, goals) => ({
  id,
  card: { intent: 'Tally: stroke the board to mark it; goals count toward the win.', params: {}, provides: { actions: ['stroke'], events: ['marked', 'goal'] },
    loop: { verbs: ['stroke'], progress: ['marked'], interaction: 'avatar-realtime', opponent: 'none', win: { when: { count: 'goal', gte: '$target' }, reads: { event: 'goal', by: { actions: ['stroke'] } } } } },
  install(rt) { rt.action('stroke', (v, r) => { if (!v) return; const s = r.store(id); s.n = (s.n || 0) + 1; r.emit('marked', {}); if (goals(s.n)) r.emit('goal', {}); }); },
});
const busy = tallyOf('gameplay.test.busy', () => false);
const opener = tallyOf('gameplay.test.opener', n => n === 1);
const real = id => PRIMITIVES.find(p => p.id === id);
const gameOf = (cat, use) => {
  const description = 'stroke the board to score goals';
  const selection = { systems: [use], spaces: [{ id: 'field', use: 'engine.space.graph', with: {}, role: 'field', caps: [...cat.registry.get('engine.space.graph').card.provides.capabilities] }], generators: [], graphics: [], bind: {}, gaps: [], adapters: [],
    mechanics: [{ id: 'core', verb: 'stroke', description, importance: 'core', primitives: [use], candidates: [], source: 'test', score: 1, from: '' }] };
  const decomposition = { version: 'test', title: 'Tally', premise: `${description}.`, tone: 'brisk', references: [], views: ['ui'], spaces: [], movement: 'none', acts: 1, zones: 2,
    mechanics: [{ id: 'core', verb: 'stroke', description, from: '', importance: 'core' }], core: { theme: '', narrative: false, mashup: [], lose: '', interaction: 'avatar-realtime', opponent: 'none', win: 'score goals' } };
  const p = preset({ decomposition, selection, registry: cat.registry, logic: cat.logic, seed: 3 });
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  return p.doc;
};

test('the gate blocks a game whose objective score rises while the win quantity never moves, and passes one where it moves without finishing', () => {
  const cat = testCatalogue([real('engine.spawner'), real('plot.ending'), real('engine.input.actions'), busy, opener]);
  // The playtest agent steers by and measures the win quantity; the gate reads its report. (verifyDocument runs the same
  // two with the plot solver first, whose exhaustive proof that no ending is reachable would block `busy` on its own.)
  const run = doc => { const pt = playtest(doc, cat.registry, cat.logic, { seed: 3, budgetMs: 500, win: winQuantity(doc, cat.registry) }); return { playtest: pt, ...viability(pt, pt.problems, { ran: [] }, loopEvents(doc, cat.registry)) }; };
  const stuck = gameOf(cat, 'gameplay.test.busy');
  assert.deepEqual(winQuantity(stuck, cat.registry), { use: 'gameplay.test.busy', event: 'goal', cmp: 'gte', target: 10 });
  const a = run(stuck);
  assert.equal(a.playtest?.winnable, false);
  // The old gate's measure rose (the loop's progress events score), but the win quantity never moved.
  assert.ok(Number(a.playtest?.timeline?.score?.high) > Number(a.playtest?.idle?.score), JSON.stringify(a.playtest?.timeline?.score));
  assert.deepEqual(a.playtest?.progress, { quantity: 'event goal', target: 10, idle: 0, high: 0 });
  assert.equal(a.viable, false);
  assert.match(String(a.viability), /^no_progress: .*event goal/);
  const moving = run(gameOf(cat, 'gameplay.test.opener'));
  assert.equal(moving.playtest?.winnable, false, 'one goal of ten: it can never be finished');
  assert.equal(moving.playtest?.progress?.high, 1);
  assert.equal(moving.viable, true, String(moving.viability));
});

test('verify measures the bots on the win quantity the playtest steers by: their progress reaches the gate', async () => {
  const { buildCatalogue } = await import('../v2/planner/catalog.js');
  const { verify } = await import('../v2/verify/index.js');
  const { registry, logic } = buildCatalogue();
  // A well whose win (forty lines) no 0.4 s of play finishes: the placement bot still clears lines toward it.
  const doc = { schema: 'gameverse.v2.game/0.2', id: 'well', title: 'Well', seed: 2, spaces: [{ id: 'g', use: 'engine.space.grid', with: { size: [10, 22] } }],
    systems: [{ use: 'gameplay.falling.pieces', with: { board: { name: 'board', at: [0, 0], size: [10, 22], axes: [0, 1], fall: -1 }, clearFrames: 0, next: 1 } }, { use: 'plot.ending' }],
    content: { archetypes: [] }, plot: { endings: [{ id: 'cleared', title: 'Cleared', when: { var: 'falling.lines', gte: 40 }, outcome: 'won' }] } };
  const win = winQuantity(doc, registry);
  assert.deepEqual(win, { use: 'gameplay.falling.pieces', var: 'falling.lines', cmp: 'gte', target: 40 });
  const r = await verify(doc, registry, logic, { seed: 2, budgetMs: 400, plot: false, spatial: false, invariants: false, playtest: { budgetMs: 50, win }, strategies: { budgetMs: 2000, only: ['placement'], placement: { depth: 1, seeds: [2] } } });
  const bot = r.strategies.ran.find(b => b.id === 'placement');
  assert.ok(bot.progress > 0, `the bot's lines count toward the win: ${JSON.stringify(bot.progress)}`);
  assert.ok(bot.progress >= Math.max(...bot.metrics.runs.map(x => x.cleared)), 'at least the lines its kept play cleared (its lookahead may reach further)');
  const without = await verify(doc, registry, logic, { seed: 2, budgetMs: 400, plot: false, spatial: false, invariants: false, playtest: { budgetMs: 50 }, strategies: { budgetMs: 300, only: ['placement'], placement: { depth: 1, seeds: [2] } } });
  assert.equal('progress' in without.strategies.ran[0], false, 'no win quantity: nothing measured');
});
