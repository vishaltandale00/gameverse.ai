import test from 'node:test';
import assert from 'node:assert/strict';
import kit from '../v2/kits/puzzle/index.js';
import { SAMPLES } from '../v2/kits/puzzle/sample.js';
import { validate, SCHEMA } from '../v2/kits/puzzle/content.js';
import { LOCK_DELAY, MOVE_RESETS, GARBAGE } from '../v2/kits/puzzle/falling.js';
import { VIRUS, popScore } from '../v2/kits/puzzle/chain.js';
import { seedFrom } from '../v2/kernel/rng.js';
import { computeClear, comboClear, findRuns, hasMove, reshuffle, SP, spOf, col, gem } from '../v2/kits/puzzle/swap.js';
import { slideGrid } from '../v2/kits/puzzle/slide.js';

const content = key => validate(SAMPLES[key]).content;
const I = (o = {}) => ({ x: 0, y: 0, a: false, b: false, ...o });
const run = (game, s, inputs) => { const events = []; for (const i of inputs) { game.step(s, i); events.push(...s.events); } return events; };
const idle = n => Array.from({ length: n }, () => I());
function untilPhase(game, s, phase, max = 400) { const events = []; for (let k = 0; k < max && s.phase !== phase; k++) { game.step(s, I()); events.push(...s.events); } return events; }

test('every sample validates and the schema is strict-mode shaped', () => {
  for (const [key, c] of Object.entries(SAMPLES)) {
    const v = validate(c);
    assert.equal(v.ok, true, `${key}: ${JSON.stringify(v.errors)}`);
    assert.deepEqual(validate(v.content).content, v.content, `${key} normalization is idempotent`);
  }
  const strict = (node, path) => {
    if (node.type === 'object') { assert.equal(node.additionalProperties, false, path); assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path); for (const [k, v] of Object.entries(node.properties)) strict(v, `${path}.${k}`); }
    if (node.type === 'array') strict(node.items, `${path}[]`);
    for (const bad of ['oneOf', 'anyOf', 'minimum', 'maximum', 'minItems', 'maxItems']) assert.equal(node[bad], undefined, `${path} uses ${bad}`);
  };
  strict(SCHEMA, '$');
  assert.equal(kit.id, 'puzzle');
  assert.deepEqual(Object.keys(kit.cast(content('falling')).entities).sort(), ['blocker', 'hero', 'item', 'prize', 'rival']);
});

test('validation reports repairable errors and keeps sizes real', () => {
  const codes = c => validate(c).errors.map(e => e.code);
  assert.ok(codes({ ...SAMPLES.falling, mode: 'golf' }).includes('mode_unknown'));
  assert.ok(codes({ ...SAMPLES.falling, rules: { ...SAMPLES.falling.rules, pieceSet: 'custom' }, customPieces: [{ name: 'Gap', color: '#fff', rows: ['#.#'] }] }).includes('piece_disconnected'));
  assert.ok(codes({ ...SAMPLES.falling, rules: { ...SAMPLES.falling.rules, pieceSet: 'custom' }, customPieces: [{ name: 'Big', color: '#fff', rows: ['###', '###'] }] }).includes('piece_too_big'));
  assert.ok(codes({ ...SAMPLES.falling, levels: [{ ...SAMPLES.falling.levels[0], goal: 'jelly' }] }).includes('goal_mode'));
  assert.ok(codes({ ...SAMPLES.swap, rules: { ...SAMPLES.swap.rules, width: 10, height: 10 } }).includes('layout_size'));
  const e = validate({ ...SAMPLES.swap, levels: [{ ...SAMPLES.swap.levels[1], layout: ['........'] }] }).errors[0];
  assert.ok(e.code && e.path && e.message && e.hint);
  assert.deepEqual([validate({ ...SAMPLES.falling, rules: { ...SAMPLES.falling.rules, width: 14, height: 24 } }).content.rules.width, validate({ ...SAMPLES.slide, rules: { ...SAMPLES.slide.rules, width: 5 } }).content.rules.height], [14, 5]);
  assert.equal(validate({ ...SAMPLES.falling, rules: { ...SAMPLES.falling.rules, width: 99 } }).content.rules.width, 16);
});

test('the same seed and inputs give the same final state in every mode', () => {
  for (const key of Object.keys(SAMPLES)) {
    const play = seed => {
      const game = kit.createGame(SAMPLES[key], { seed }), s = game.createState();
      let r = 12345;
      for (let f = 0; f < 1500; f++) { r = (r * 1103515245 + 12345) >>> 0; const v = r >>> 16; game.step(s, { x: (v % 3) - 1, y: ((v >> 2) % 5 === 0) ? -1 : ((v >> 4) % 4 === 0 ? 1 : 0), a: !!(v & 64), b: !!(v & 1024) && !(v & 64) }); }
      return JSON.stringify(s);
    };
    assert.equal(play(9), play(9), key);
    assert.notEqual(play(9), play(10), `${key} seeds differ`);
  }
});

// ---------- falling ----------
function fallingAt(over = {}) {
  const game = kit.createGame({ ...SAMPLES.falling, ...over }, { seed: 4 }), s = game.createState();
  run(game, s, idle(120));
  assert.equal(s.phase, 'play');
  return { game, s };
}
const rowOf = (game, str) => [...str].map(ch => ch === 'X' ? GARBAGE : 0);
function setRows(game, s, rows) { s.board.fill(0); rows.forEach((str, k) => rowOf(game, str).forEach((v, x) => { s.board[(game.H - rows.length + k) * game.W + x] = v; })); }
const typeIndex = (game, key) => game.types.findIndex(t => t.key === key);

test('falling: 7-bag randomizer deals every piece once per bag', () => {
  const game = kit.createGame(SAMPLES.falling, { seed: 11 }), s = game.createState();
  assert.deepEqual([...s.queue].sort(), [0, 1, 2, 3, 4, 5, 6]);
  run(game, s, idle(120));
  assert.deepEqual([s.piece.t, ...s.queue.slice(0, 6)].sort(), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...s.queue.slice(6), ...s.bag].sort(), [0, 1, 2, 3, 4, 5, 6]);
});

test('falling: DAS/ARR shift, SRS wall kick, hold once per piece, hard drop points', () => {
  let { game, s } = fallingAt();
  const T = typeIndex(game, 'T');
  s.piece = { t: T, r: 0, x: 3, y: 5, id: 900 }; s.lowest = 5;
  run(game, s, [I({ x: 1 })]); assert.equal(s.piece.x, 4, 'moves once on press');
  run(game, s, Array.from({ length: 9 }, () => I({ x: 1 }))); assert.equal(s.piece.x, 4, 'waits for DAS');
  run(game, s, [I({ x: 1 })]); assert.equal(s.piece.x, 5, 'auto-shift starts');
  run(game, s, [I({ x: 1 }), I({ x: 1 })]); assert.equal(s.piece.x, 6, 'auto-repeat every ARR frames');
  // A T pointing right against the left wall kicks one column out when it rotates back.
  s.piece = { t: T, r: 1, x: -1, y: 8, id: 901 };
  const ev = run(game, s, [I(), I({ b: true })]);
  assert.deepEqual([s.piece.r, s.piece.x], [0, 0]);
  assert.equal(ev.find(e => e.name === 'rotate').kick, 1);
  // Hold: A+B together; only once until the piece locks.
  const before = s.piece.t, next = s.queue[0];
  run(game, s, [I(), I({ a: true, b: true })]);
  assert.deepEqual([s.hold, s.piece.t, s.holdUsed], [before, next, true]);
  run(game, s, [I(), I({ a: true, b: true })]);
  assert.equal(s.piece.t, next, 'second hold is ignored');
  // Hard drop: 2 points per row and an immediate lock.
  const score = s.score, dist = game.ghostY(s) - s.piece.y, pieces = s.stats.pieces;
  run(game, s, [I(), I({ y: -1 })]);
  assert.equal(s.score - score, 2 * dist);
  assert.equal(s.stats.pieces, pieces + 1);
  assert.equal(s.holdUsed, false);
});

test('falling: lock delay with move reset is capped', () => {
  let { game, s } = fallingAt();
  const O = typeIndex(game, 'O'), bottom = game.H - 2;
  s.piece = { t: O, r: 0, x: 4, y: bottom, id: 950 }; s.lowest = bottom; s.lockT = 0; s.lockMoves = 0;
  const pieces = s.stats.pieces;
  run(game, s, idle(LOCK_DELAY - 1)); assert.equal(s.stats.pieces, pieces, 'still sliding');
  run(game, s, idle(1)); assert.equal(s.stats.pieces, pieces + 1, 'locks after the delay');
  s.board.fill(0);
  s.piece = { t: O, r: 0, x: 4, y: bottom, id: 951 }; s.lowest = bottom; s.lockT = 0; s.lockMoves = 0;
  let frames = 0; // nudge left and right every 20 frames, each time before the delay runs out
  while (s.stats.pieces === pieces + 1 && frames < 1000) { game.step(s, I({ x: frames % 40 === 0 ? 1 : frames % 40 === 20 ? -1 : 0 })); frames++; }
  assert.ok(frames > 4 * LOCK_DELAY, `moving resets the timer (locked after ${frames})`);
  assert.ok(frames <= MOVE_RESETS * 20 + 2, `but only ${MOVE_RESETS} times (locked after ${frames})`);
});

test('falling: T-spin double, tetris and back-to-back score by the guideline', () => {
  let { game, s } = fallingAt();
  setRows(game, s, ['XXXX......', 'XXX...XXXX', 'XXXX.XXXXX']);
  s.piece = { t: typeIndex(game, 'T'), r: 1, x: 3, y: game.H - 3, id: 960 }; s.lowest = s.piece.y;
  let score = s.score;
  const ev = run(game, s, [I(), I({ a: true }), I(), I({ y: -1 })]);
  const lines = ev.find(e => e.name === 'lines');
  assert.equal(lines.spin, 'full'); assert.equal(lines.count, 2); assert.equal(lines.label, 'T-Spin Double');
  assert.equal(s.score - score, 1200);
  untilPhase(game, s, 'play');
  const tetris = (keep = []) => {
    setRows(game, s, [...keep, '.XXXXXXXXX', '.XXXXXXXXX', '.XXXXXXXXX', '.XXXXXXXXX']);
    s.piece = { t: typeIndex(game, 'I'), r: 1, x: -2, y: game.H - 4, id: 970 + s.stats.pieces }; s.lowest = s.piece.y;
    score = s.score;
    const e = run(game, s, [I(), I({ y: -1 })]).find(x => x.name === 'lines');
    untilPhase(game, s, 'play');
    return e;
  };
  const first = tetris(['..XX......']);
  assert.equal(first.label, 'Tetris'); assert.equal(first.b2b, true, 'T-spin then tetris is back-to-back');
  assert.equal(first.points, 800 * 1.5 + 50 * first.combo);
  const second = tetris();
  assert.equal(second.b2b, true); assert.equal(second.combo, 2); assert.equal(second.perfect, true);
  assert.equal(second.points, 1200 + 100 + 2000, 'back-to-back tetris, combo 2 and a perfect clear');
  assert.equal(s.stats.tetrises, 2);
});

test('falling: custom polyomino sets and wider wells play', () => {
  const c = { ...SAMPLES.falling, rules: { ...SAMPLES.falling.rules, pieceSet: 'custom', width: 12, height: 22 }, customPieces: [{ name: 'Plus', color: '#ff66aa', rows: ['.#.', '###', '.#.'] }, { name: 'Bar', color: '#66aaff', rows: ['###'] }] };
  const game = kit.createGame(c, { seed: 2 });
  assert.deepEqual([game.W, game.H, game.types.length, game.types[0].size], [12, 26, 2, 5]);
  const s = game.createState(); run(game, s, idle(120));
  assert.ok([0, 1].includes(s.piece.t));
});

// ---------- chain ----------
test('chain: groups of four pop and cascades score as chains', () => {
  const game = kit.createGame(SAMPLES.chain, { seed: 3 }), s = game.createState();
  untilPhase(game, s, 'play');
  const { W, H } = game, at = (x, y, v) => { s.board[y * W + x] = v; };
  s.board.fill(0);
  at(0, H - 1, 2); at(0, H - 2, 1); at(0, H - 3, 1); at(0, H - 4, 1); at(1, H - 1, 2); at(1, H - 2, 2);
  s.pair = { a: 1, b: 2, x: 0, y: 1, r: 0, id: 77 }; // the 1 completes four; the 2 then falls into three more 2s
  const ev = [...run(game, s, [I({ y: -1 })]), ...untilPhase(game, s, 'play')];
  const pops = ev.filter(e => e.name === 'pop');
  assert.deepEqual(pops.map(p => p.chain), [1, 2]);
  assert.deepEqual(pops.map(p => p.points), [popScore([{ color: 1, size: 4 }], 1), popScore([{ color: 2, size: 4 }], 2)]);
  assert.deepEqual(pops.map(p => p.points), [40, 320]);
  assert.equal(s.board.some(Boolean), false, 'both groups are gone');
});

test('chain: virus capsules clear lines through viruses and finish the level', () => {
  const game = kit.createGame(SAMPLES.virus, { seed: 3 }), s = game.createState();
  untilPhase(game, s, 'play');
  const { W, H } = game;
  s.board.fill(0); s.board[(H - 1) * W] = 1 | VIRUS; s.board[(H - 2) * W] = 1 | VIRUS; s.virusesLeft = 2;
  s.pair = { a: 1, b: 1, x: 0, y: 1, r: 0, id: 78 };
  const ev = [...run(game, s, [I({ y: -1 })]), ...untilPhase(game, s, 'intro')];
  assert.ok(ev.some(e => e.name === 'defeated' && e.count === 2));
  assert.ok(ev.some(e => e.name === 'level_up'));
  assert.equal(s.level, 1);
  assert.equal(s.virusesLeft, SAMPLES.virus.levels[1].obstacles);
});

// ---------- swap ----------
const board = (W, H, f) => ({ W, H, gems: Array.from({ length: W * H }, (_, i) => f(i % W, Math.floor(i / W))), jelly: new Array(W * H).fill(0), block: new Array(W * H).fill(0), hole: new Array(W * H).fill(0) });
const base = (x, y) => 1 + ((x + 2 * y) % 5); // no runs of three anywhere

test('swap: line 4 makes a stripe, line 5 a color bomb, L/T an area bomb', () => {
  const four = board(8, 8, (x, y) => y === 0 && x < 4 ? 6 : base(x, y));
  const r4 = computeClear(four, [1]);
  assert.deepEqual(r4.creates, [[1, gem(6, SP.VSTRIPE)]]);
  const five = board(8, 8, (x, y) => y === 0 && x < 5 ? 6 : base(x, y));
  assert.equal(spOf(computeClear(five).creates[0][1]), SP.BOMB);
  const ell = board(8, 8, (x, y) => (y === 2 && x <= 2) || (x === 0 && y <= 2) ? 6 : base(x, y));
  const rl = computeClear(ell);
  assert.equal(spOf(rl.creates[0][1]), SP.AREA); assert.equal(rl.creates[0][0], 2 * 8);
  // A striped gem caught in a match clears its whole column.
  const striped = board(8, 8, (x, y) => y === 0 && x < 3 ? (x === 1 ? gem(6, SP.VSTRIPE) : 6) : base(x, y));
  assert.equal(computeClear(striped).clear.filter(i => i % 8 === 1).length, 8);
});

test('swap: specials combine, and dead boards reshuffle', () => {
  const b = board(8, 8, (x, y) => x === 0 && y === 0 ? gem(0, SP.BOMB) : base(x, y));
  [b.gems[0], b.gems[1]] = [b.gems[1], b.gems[0]]; // the bomb moves right onto a color-3 gem's spot
  const target = col(b.gems[0]);
  const res = comboClear(b, 0, 1, { rng: 5 });
  assert.equal(res.combo, 'bomb');
  const count = b.gems.filter(g => col(g) === target).length;
  assert.equal(res.clear.length, count + 1);
  const twoStripes = board(8, 8, (x, y) => x === 3 && y === 3 ? gem(2, SP.HSTRIPE) : x === 4 && y === 3 ? gem(4, SP.VSTRIPE) : base(x, y));
  assert.equal(comboClear(twoStripes, 3 * 8 + 3, 3 * 8 + 4, { rng: 5 }).clear.length, 15);
  const dead = board(8, 8, (x, y) => 1 + (x % 2) + 2 * (y % 2));
  assert.equal(hasMove(dead), false);
  assert.equal(reshuffle(dead, { rng: 9 }, 4), true);
  assert.equal(hasMove(dead), true); assert.equal(findRuns(dead).length, 0);
});

test('swap: select and push swaps; invalid swaps revert without costing a move', () => {
  const game = kit.createGame(SAMPLES.swap, { seed: 5 }), s = game.createState();
  untilPhase(game, s, 'idle');
  s.gems = s.gems.map((_, i) => base(i % 8, Math.floor(i / 8)));
  s.gems[0] = 1; s.gems[1] = 1; s.gems[2] = 2; s.gems[3] = 1;
  const moves = s.moves;
  s.cursor = { x: 5, y: 5 };
  let ev = [...run(game, s, [I({ a: true }), I(), I({ x: 1 }), I()]), ...untilPhase(game, s, 'idle')];
  assert.ok(ev.some(e => e.name === 'invalid')); assert.equal(s.moves, moves);
  s.cursor = { x: 2, y: 0 };
  ev = [...run(game, s, [I({ a: true }), I(), I({ x: 1 }), I()]), ...untilPhase(game, s, 'idle', 600)];
  assert.ok(ev.some(e => e.name === 'match'));
  assert.equal(s.moves, moves - 1); assert.ok(s.score > 0);
});

test('swap: board size is a real option', () => {
  const c = { ...SAMPLES.swap, rules: { ...SAMPLES.swap.rules, width: 10, height: 9 }, levels: [SAMPLES.swap.levels[0]] };
  const game = kit.createGame(c, { seed: 1 }), s = game.createState();
  assert.deepEqual([game.W, game.H, s.gems.length], [10, 9, 90]);
  assert.ok(hasMove(s));
});

// ---------- slide ----------
test('slide: tiles merge once per move, spawn only after a real move, and targets level up', () => {
  const row = (vals, dir = 0) => slideGrid([...vals, ...new Array(12).fill(0)], 4, dir).grid.slice(0, 4);
  assert.deepEqual(row([2, 2, 2, 2]), [4, 4, 0, 0]);
  assert.deepEqual(row([2, 2, 4, 0]), [4, 4, 0, 0]);
  assert.deepEqual(row([4, 0, 4, 4]), [8, 4, 0, 0]);
  assert.deepEqual(row([2, 2, 2, 0], 1), [0, 0, 2, 4]);
  assert.deepEqual(row([2, -1, 2, 2]), [2, -1, 4, 0], 'rocks split lines');
  const game = kit.createGame(SAMPLES.slide, { seed: 2 }), s = game.createState();
  untilPhase(game, s, 'play');
  s.tiles = [{ id: 90, v: 32, x: 0, y: 0, fx: 0, fy: 0 }, { id: 91, v: 32, x: 0, y: 1, fx: 0, fy: 1 }];
  run(game, s, [I({ x: -1 })]);
  assert.equal(s.tiles.length, 2, 'no spawn when nothing moved');
  const ev = run(game, s, [I(), I({ y: -1 })]);
  assert.ok(ev.some(e => e.name === 'merge')); assert.ok(ev.some(e => e.name === 'level_up'));
  assert.equal(s.level, 1); assert.equal(s.maxTile, 64); assert.equal(s.tiles.length, 2);
});

// ---------- verification ----------
test('the bots verify every sample within budget', () => {
  const r = kit.verify(kit.content.sample, { seed: 1, budgetMs: 2000 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.ok(r.report.bot.levels[0].pieces >= 150 && r.report.bot.levels[0].lines > 0);
  assert.ok(r.report.proven.length && Number.isFinite(r.report.ms));
  for (const key of ['chain', 'virus', 'swap', 'slide']) {
    const v = kit.verify(SAMPLES[key], { seed: 1, budgetMs: 300 });
    assert.equal(v.ok, true, `${key}: ${JSON.stringify(v.problems)}`);
  }
  const hard = kit.verify({ ...SAMPLES.swap, levels: [{ ...SAMPLES.swap.levels[0], target: 12000, moves: 10 }] }, { seed: 1, budgetMs: 500 });
  assert.equal(hard.ok, false);
  assert.equal(hard.problems[0].code, 'goal_unreached');
});

test('falling verification passes fair content on every seed and blames the level at fault', () => {
  const F = SAMPLES.falling, lv = o => ({ ...F.levels[0], ...o });
  const fair = { ...F, title: 'Cat Stack', levels: [lv({ target: 5 }), lv({ target: 8, speed: 12, obstacles: 2 })] };
  for (let k = 0; k < 20; k++) {
    const r = kit.verify(fair, { seed: seedFrom(`tetris but the pieces are cats ${k}`), budgetMs: 2000 });
    assert.equal(r.ok, true, `seed ${k}: ${JSON.stringify(r.problems)}`);
    assert.equal(r.report.bot.levels[0].speed, 1);
    assert.ok(r.report.bot.levels[0].pieces >= 150, 'level 1 is survived at its own speed');
  }
  const impossible = kit.verify({ ...fair, levels: [fair.levels[0], lv({ target: 150, timeSec: 30, speed: 3 })] }, { seed: 5, budgetMs: 2000 });
  assert.equal(impossible.ok, false);
  assert.equal(impossible.problems.length, 1);
  const [p] = impossible.problems;
  assert.equal(p.path, 'levels[1]'); assert.match(p.message, /level 2/); assert.match(p.hint, /timeSec|target/);
});
