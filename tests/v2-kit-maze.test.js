import test from 'node:test';
import assert from 'node:assert/strict';
import kit, { cast } from '../v2/kits/maze/index.js';
import { buildMaze, checkMaze, isOpen, W, H, STYLE_NAMES, EXIT } from '../v2/kits/maze/maze.js';
import { DX, DY, UP, LEFT, RIGHT, NONE, CORNERS, FRIGHT_SECONDS, BASE_SPEED, READY_FIRST, DYING, CLEAR, BONUS_TIME } from '../v2/kits/maze/game.js';
import { wallLoops, cameraStep } from '../v2/kits/maze/render.js';
import { SIZES, SIZE_NAMES, powerCountFor, wrapX } from '../v2/kits/maze/maze.js';
import { composeGame } from '../v2/kits/mods/compose.js';
import { paintGameArt } from '../v2/art/paint.js';
import { fallbackDirection } from '../v2/art/direction.js';

const { content } = kit.validate(kit.content.sample);
const withContent = patch => ({ ...structuredClone(content), ...patch });
const names = events => events.map(e => e.name);
/** A level-1 state in play, with no hunters unless asked for. */
function playing(c = content, { hunters = false, seed = 'test' } = {}) {
  const game = kit.createGame(c, { seed });
  const s = game.createState();
  s.phase = 'play'; s.phaseT = 0;
  if (!hunters) s.hunters = [];
  return { game, s, maze: game.mazeFor(0) };
}
const steps = (game, s, n, input = {}) => { const events = []; for (let i = 0; i < n; i++) { game.step(s, input); events.push(...s.events); } return events; };
const place = (p, x, y, dir) => Object.assign(p, { x, y, dir, moving: true, want: NONE });
const CORNER_MAX = 0.45;
/** The longest straight horizontal corridor (away from the tunnel mouths). */
function longestRun(maze) {
  let best = { x0: 0, x1: -1, y: 0 };
  for (let y = 1; y < H - 1; y++) for (let x = 1, start = -1; x < W; x++) {
    if (y === 11 || y === 17) break; // the house ring, where the bonus sits
    if (x < W - 1 && isOpen(maze, x, y)) { if (start < 0) start = x; continue; }
    if (start >= 0 && x - 1 - start > best.x1 - best.x0) best = { x0: start, x1: x - 1, y };
    start = -1;
  }
  return best;
}

test('the sample validates and every content object is strict', () => {
  const v = kit.validate(kit.content.sample);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.errors, []);
  assert.equal(kit.id, 'maze');
  for (const k of ['schema', 'prompt', 'sample']) assert.ok(kit.content[k], k);
  const walk = (node, path) => {
    if (node?.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
      for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.${k}`);
    } else if (node?.type === 'array') walk(node.items, `${path}[]`);
  };
  walk(kit.content.schema, '$');
  for (const k of Object.keys(kit.content.schema.properties)) assert.ok(k in kit.content.sample, `sample has ${k}`);
});

test('validation reports coded errors and normalizes ranges', () => {
  const bad = withContent({ hunters: [{ name: 'A', personality: 'sneaky', color: 'red' }], levels: [{ maze: { style: 'spiral', density: 2, tunnels: 1, powerPellets: 3 }, speed: 3 }] });
  const v = kit.validate(bad);
  assert.equal(v.ok, false);
  const codes = v.errors.map(e => `${e.code}@${e.path}`);
  assert.ok(codes.includes('count@hunters'), codes.join());
  assert.ok(codes.includes('maze_style@levels[0].maze.style'), codes.join());
  const v2 = kit.validate(withContent({ hunters: [...content.hunters.slice(0, 1), { name: 'B', personality: 'sneaky', color: 'red' }], levels: [{ maze: { style: 'classic', density: 2, tunnels: 1, powerPellets: 3 }, speed: 3 }] }));
  const codes2 = v2.errors.map(e => `${e.code}@${e.path}`);
  assert.ok(codes2.includes('personality@hunters[1].personality'), codes2.join());
  assert.ok(codes2.includes('color@hunters[1].color'), codes2.join());
  for (const e of v2.errors) assert.ok(e.code && e.path && e.message, JSON.stringify(e));
  const ok = kit.validate(withContent({ levels: [{ maze: { style: 'classic', density: 2, tunnels: 1, powerPellets: 3 }, speed: 3 }] }));
  assert.equal(ok.ok, true);
  assert.equal(ok.content.levels[0].speed, 1.4);
  assert.equal(ok.content.levels[0].maze.density, 1);
  assert.equal(ok.content.levels[0].maze.powerPellets, 4);
  assert.ok(ok.warnings.some(w => w.code === 'clamped'));
});

test('the same seed and inputs give the same final state; saves resume exactly', () => {
  const script = n => { let r = 7; return Array.from({ length: n }, () => { r = (r * 1103515245 + 12345) >>> 0; const k = r >>> 28; return { x: [0, -1, 1, 0][k & 3], y: [0, 0, 0, -1, 1][k % 5], a: false, b: false }; }); };
  const inputs = script(3000);
  const runFrom = (game, s, list) => { for (const i of list) game.step(s, i); return s; };
  const g1 = kit.createGame(content, { seed: 'det' }), g2 = kit.createGame(content, { seed: 'det' });
  const a = runFrom(g1, g1.createState(), inputs), b = runFrom(g2, g2.createState(), inputs);
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'state is plain JSON');
  const g3 = kit.createGame(content, { seed: 'det' }), mid = runFrom(g3, g3.createState(), inputs.slice(0, 1500));
  const resumed = runFrom(g3, structuredClone(mid), inputs.slice(1500));
  assert.deepEqual(resumed, a);
  assert.notDeepEqual(kit.createGame(content, { seed: 'other' }).mazeFor(0).cells, g1.mazeFor(0).cells, 'another seed builds another maze');
});

test('generated mazes keep every invariant over many seeds and parameters', () => {
  let n = 0;
  for (let seed = 0; seed < 90; seed++) for (const style of STYLE_NAMES) {
    const params = { style, density: 0.3 + (seed % 8) / 10, tunnels: 1 + (seed % 2), powerPellets: 2 + 2 * (seed % 3) };
    const maze = buildMaze(params, seed);
    assert.deepEqual(checkMaze(maze, params), [], `seed ${seed} ${style}`);
    assert.ok(maze.pellets.length >= 100, `seed ${seed} has ${maze.pellets.length} pellets`);
    n++;
  }
  assert.equal(n, 270);
  // A broken maze is caught.
  const maze = buildMaze({ style: 'classic', density: 0.6, tunnels: 1, powerPellets: 4 }, 3);
  const broken = { ...maze, cells: [...maze.cells] };
  const open = broken.cells.findIndex((c, i) => c === 1 && i % W === 5);
  broken.cells[open] = 0;
  assert.ok(checkMaze(broken).some(p => p.code === 'maze_mirror'));
  // Levels get different mazes, and the wall outlines trace inside the maze.
  const game = kit.createGame(content, { seed: 1 });
  assert.notDeepEqual(game.mazeFor(0).cells, game.mazeFor(1).cells);
  const loops = wallLoops(game.mazeFor(0));
  assert.ok(loops.length > 10);
  for (const loop of loops) for (const p of loop) assert.ok(p.x >= -2 && p.x <= W + 2 && p.y >= -2 && p.y <= H + 2);
});

test('buffered turns: an early press is remembered and taken at the junction, cutting the corner', () => {
  const { game, s, maze } = playing();
  let j = null;
  for (let y = 1; y < H - 1 && !j; y++) for (let x = 1; x < W - 6 && !j; x++) {
    if (!isOpen(maze, x, y) || !isOpen(maze, x, y - 1)) continue;
    let ok = true;
    for (let k = 1; k <= 4; k++) if (!isOpen(maze, x + k, y) || isOpen(maze, x + k, y - 1)) ok = false;
    if (ok) j = { x, y };
  }
  assert.ok(j, 'found a junction');
  s.pellets.fill(0);
  place(s.player, j.x + 4, j.y, LEFT);
  game.step(s, { x: 0, y: -1 }); // a single early press, then nothing held
  assert.equal(s.player.dir, LEFT, 'the wall above blocks the turn for now, and the hero keeps moving');
  let turnedAt = null;
  for (let i = 0; i < 60 && s.player.y > j.y - 1; i++) {
    game.step(s, {});
    if (turnedAt === null && s.player.dir === UP) turnedAt = s.player.x;
    if (s.player.x > j.x + CORNER_MAX) assert.equal(s.player.y, j.y, 'no turn before the junction');
  }
  assert.ok(turnedAt !== null, 'turned up');
  assert.ok(turnedAt > j.x && turnedAt - j.x <= CORNER_MAX, `pre-turned ${turnedAt - j.x} tiles early`);
  assert.ok(s.player.y < j.y - 0.9 && Math.abs(s.player.x - j.x) < 1e-6, 'settled into the new lane');
});

test('speed is constant per level, slower while eating, and faster on later levels', () => {
  const { game, s, maze } = playing();
  const { x0, x1, y } = longestRun(maze);
  assert.ok(x1 - x0 >= 5, 'a long corridor');
  s.pellets.fill(0);
  place(s.player, x0, y, RIGHT);
  steps(game, s, 30);
  const clean = s.player.x - x0;
  assert.ok(Math.abs(clean - 30 * 0.8 * BASE_SPEED / 60) < 1e-6, `moved ${clean}`);
  for (let x = x0; x <= x1; x++) s.pellets[y * W + x] = 1;
  place(s.player, x0, y, RIGHT);
  steps(game, s, 30);
  assert.ok(s.player.x - x0 < clean - 0.1, 'eating pellets slows the hero');
  const l1 = game.levelInfo(0), l2 = game.levelInfo(1), l5 = game.levelInfo(4);
  assert.ok(l2.speed.pac > l1.speed.pac && l5.speed.ghost > l2.speed.ghost);
  assert.ok(l5.frightFrames < l1.frightFrames);
});

test('tunnels wrap around, and hunters slow down inside them', () => {
  const { game, s, maze } = playing();
  const t = maze.tunnels[0];
  place(s.player, 1, t, LEFT);
  let wrapped = false;
  for (let i = 0; i < 30; i++) { game.step(s, {}); if (s.player.x > W / 2) wrapped = true; assert.equal(s.player.y, t); }
  assert.ok(wrapped, 'the hero came out the other side');
  assert.ok(s.player.x < W - 1 && s.player.x > W - 4);
  // Hunter displacement over one frame: in the tunnel versus in the open.
  const { game: g2, s: s2 } = playing(content, { hunters: true });
  s2.hunters = s2.hunters.slice(0, 1);
  place(s2.player, s2.player.x, s2.player.y, LEFT); s2.player.moving = false;
  Object.assign(s2.hunters[0], { x: 0.5, y: t, dir: LEFT, state: 'active' });
  g2.step(s2, {});
  const tunnel = 0.5 - s2.hunters[0].x;
  Object.assign(s2.hunters[0], { x: EXIT.x, y: EXIT.y, dir: LEFT, state: 'active' });
  g2.step(s2, {});
  const open = EXIT.x - s2.hunters[0].x;
  assert.ok(Math.abs(tunnel - 0.40 * BASE_SPEED / 60) < 1e-6, `tunnel ${tunnel}`);
  assert.ok(Math.abs(open - 0.75 * BASE_SPEED / 60) < 1e-6, `open ${open}`);
});

test('power pellets frighten hunters: they turn, slow down, can be eaten in a chain, and recover', () => {
  const { game, s, maze } = playing(content, { hunters: true });
  const power = maze.power[0], px = power % W, py = Math.floor(power / W);
  const dir = [0, 1, 2, 3].find(d => isOpen(maze, px - DX[d], py - DY[d]));
  s.pellets.fill(0); s.pellets[power] = 2; s.pelletsLeft = 100;
  place(s.player, px - DX[dir] * 0.4, py - DY[dir] * 0.4, dir); // already over the pellet's tile
  for (const h of s.hunters.slice(1)) h.state = 'house';
  Object.assign(s.hunters[0], { x: EXIT.x, y: EXIT.y, dir: LEFT, state: 'active' });
  const events = steps(game, s, 1);
  assert.ok(names(events).includes('power'));
  assert.equal(s.score, 50);
  assert.ok(s.hunters.every(h => h.fright), 'every hunter turns blue, even in the house');
  assert.equal(s.hunters[0].dir, RIGHT, 'active hunters reverse');
  assert.ok(s.frightT >= FRIGHT_SECONDS[0] * 60 - 1 && s.frightT <= FRIGHT_SECONDS[0] * 60);
  const before = s.hunters[0].x;
  s.player.moving = false;
  game.step(s, {});
  assert.ok(Math.abs(s.hunters[0].x - before - 0.5 * BASE_SPEED / 60) < 1e-6, 'frightened hunters move at half speed');
  // Chain: every hunter on the hero at once scores 200, 400, 800, 1600.
  for (const h of s.hunters) Object.assign(h, { x: s.player.x, y: s.player.y, dir: s.player.dir, state: 'active', fright: true });
  const score = s.score;
  const chain = steps(game, s, 1).filter(e => e.name === 'defeated').map(e => e.points);
  assert.deepEqual(chain, [200, 400, 800, 1600]);
  assert.equal(s.score, score + 3000);
  assert.ok(s.hunters.every(h => h.state === 'eyes' && !h.fright));
  assert.ok(s.pauseT > 0, 'eating a hunter pauses the action');
  // The eyes go home and come back out.
  s.hunters = s.hunters.slice(0, 1);
  s.player.x = 1; s.player.y = maze.lattice.ys[0];
  const seen = new Set();
  for (let i = 0; i < 900 && !(seen.has('entering') && s.hunters[0].state === 'active'); i++) { game.step(s, {}); seen.add(s.hunters[0].state); }
  assert.ok(seen.has('entering') && seen.has('leaving'), [...seen].join());
  assert.equal(s.hunters[0].state, 'active');
  // The timer runs out.
  s.frightT = 1; for (const h of s.hunters) if (h.state === 'active') h.fright = true;
  assert.ok(names(steps(game, s, 1)).includes('fright_end'));
  assert.ok(s.hunters.every(h => !h.fright));
});

test('chains cap at 1600 with more than four hunters', () => {
  const six = withContent({ hunters: [...content.hunters, { name: 'Fern', personality: 'chaser', color: '#9cff3a' }, { name: 'Nettle', personality: 'shy', color: '#ffffff' }] });
  const { game, s } = playing(six, { hunters: true });
  assert.equal(s.hunters.length, 6);
  s.frightT = 300;
  for (const h of s.hunters) Object.assign(h, { x: s.player.x, y: s.player.y, state: 'active', fright: true });
  assert.deepEqual(steps(game, s, 1).filter(e => e.name === 'defeated').map(e => e.points), [200, 400, 800, 1600, 1600, 1600]);
});

test('each personality aims where the classic targeting says', () => {
  const { game, s } = playing(content, { hunters: true });
  const [chaser, ambusher, whimsical, shy] = s.hunters;
  s.mode = 'chase';
  Object.assign(s.player, { x: 10, y: 9, dir: UP });
  Object.assign(chaser, { x: 4, y: 1 });
  assert.deepEqual(game.targetFor(s, chaser), [10, 9]);
  assert.deepEqual(game.targetFor(s, ambusher), [10, 5], 'four tiles ahead');
  assert.deepEqual(game.targetFor(s, whimsical), [16, 13], 'the chaser-to-pivot vector doubled');
  Object.assign(shy, { x: 22, y: 25 });
  assert.deepEqual(game.targetFor(s, shy), [10, 9], 'shy chases from afar');
  Object.assign(shy, { x: 12, y: 11 });
  assert.deepEqual(game.targetFor(s, shy), CORNERS.shy, 'and retreats up close');
  s.mode = 'scatter';
  assert.deepEqual(game.targetFor(s, chaser), CORNERS.chaser);
  assert.deepEqual(game.targetFor(s, ambusher), CORNERS.ambusher);
  assert.deepEqual(game.targetFor(s, whimsical), CORNERS.whimsical);
  s.pelletsLeft = 5;
  assert.deepEqual(game.targetFor(s, chaser), [10, 9], 'the chaser keeps chasing when pellets run low');
  assert.ok(game.levelInfo(0).speed.elroy2 > game.levelInfo(0).speed.ghost);
});

test('hunters pick the open neighbour nearest their target, never reverse, and skip no-upward-turn tiles', () => {
  const check = noUpwardTurns => {
    const { game, s, maze } = playing(withContent({ noUpwardTurns }), { hunters: true });
    const t = maze.noUp[0], tx = t % W, ty = Math.floor(t / W);
    s.hunters = s.hunters.slice(0, 1);
    const h = s.hunters[0];
    const from = isOpen(maze, tx + 1, ty) ? LEFT : RIGHT;
    Object.assign(h, { x: tx, y: ty, dir: from, state: 'active', corner: [tx, ty - 12] });
    s.player.moving = false;
    game.step(s, {});
    return h.dir;
  };
  assert.notEqual(check(true), UP);
  assert.equal(check(false), UP);
});

test('the scatter/chase schedule switches with a reversal, and pauses while frightened', () => {
  const { game, s } = playing(content, { hunters: true });
  s.player.moving = false;
  const L = game.levelInfo(0);
  Object.assign(s.hunters[0], { x: EXIT.x, y: EXIT.y, dir: LEFT, state: 'active' });
  s.modeT = L.schedule[0] - 1;
  const ev = steps(game, s, 1);
  assert.ok(ev.some(e => e.name === 'mode' && e.mode === 'chase'));
  assert.equal(s.mode, 'chase');
  assert.equal(s.hunters[0].dir, RIGHT);
  s.frightT = 10; s.modeT = L.schedule[1] - 1;
  steps(game, s, 1);
  assert.equal(s.mode, 'chase', 'the schedule waits during frightened mode');
});

test('the house releases hunters by pellet counters and by an idle timer', () => {
  const { game, s } = playing(content, { hunters: true });
  s.player.moving = false;
  game.step(s, {});
  assert.equal(s.hunters[1].state, 'leaving', 'the second hunter needs no pellets');
  steps(game, s, 200);
  assert.equal(s.hunters[2].state, 'house', 'the third waits for 30 pellets');
  steps(game, s, 45);
  assert.equal(s.hunters[2].state, 'leaving', 'or 4 s without eating');
  s.hunters[3].dots = 60;
  steps(game, s, 1);
  assert.equal(s.hunters[3].state, 'leaving');
});

test('bonus prizes appear at 70 and 170 pellets, last 9.5 s and score by level', () => {
  const { game, s, maze } = playing();
  const { x0, x1, y } = longestRun(maze);
  s.pellets.fill(0); s.pelletsLeft = 300;
  for (let x = x0; x <= x1; x++) s.pellets[y * W + x] = 1;
  place(s.player, x0, y, RIGHT);
  s.pelletsEaten = 69;
  const ev = steps(game, s, 10);
  assert.ok(ev.some(e => e.name === 'bonus_spawn' && e.points === content.bonus[0].points));
  assert.ok(s.bonus && s.bonus.t <= BONUS_TIME && s.bonus.t >= BONUS_TIME - 10);
  assert.deepEqual(s.bonusAt, [70, 170]);
  Object.assign(s.player, { x: s.bonus.x, y: s.bonus.y, moving: false });
  const score = s.score;
  const got = steps(game, s, 1).find(e => e.name === 'collect' && e.item === 'bonus');
  assert.ok(got);
  assert.equal(s.score, score + content.bonus[0].points);
  assert.equal(s.bonus, null);
});

test('levels progress to faster mazes and the game is won after the last one (or loops when endless)', () => {
  const clearNow = (game, s) => {
    const t = Math.round(s.player.y) * W + Math.round(s.player.x);
    s.pellets.fill(0); s.pellets[t] = 1; s.pelletsLeft = 1;
    s.phase = 'play'; s.player.moving = false; s.player.want = NONE;
    const ev = steps(game, s, 1);
    assert.ok(names(ev).includes('level_clear'));
    assert.equal(s.phase, 'clear');
    return steps(game, s, CLEAR);
  };
  const { game, s } = playing(content, { hunters: true });
  const ev = clearNow(game, s);
  assert.ok(ev.some(e => e.name === 'level_up' && e.level === 2));
  assert.equal(s.level, 1);
  assert.equal(s.phase, 'ready');
  assert.equal(s.pelletsLeft, game.mazeFor(1).pellets.length);
  assert.equal(s.pelletsLeft, s.pelletsTotal);
  s.level = content.levels.length - 1;
  const end = clearNow(game, s);
  assert.ok(names(end).includes('won'));
  assert.equal(s.status, 'won');
  const { game: g2, s: s2 } = playing(withContent({ endless: true }), { hunters: true });
  s2.level = content.levels.length - 1;
  clearNow(g2, s2);
  assert.equal(s2.status, 'playing');
  assert.equal(s2.level, content.levels.length);
  assert.ok(g2.levelInfo(s2.level).speed.pac > g2.levelInfo(0).speed.pac);
});

test('getting caught costs a life after the death animation; the last one ends the game with a reason', () => {
  const { game, s } = playing(withContent({ lives: 2, extraLifeAt: 10000 }), { hunters: true });
  assert.equal(s.lives, 2);
  const catchHero = () => { s.phase = 'play'; Object.assign(s.hunters[0], { x: s.player.x, y: s.player.y, state: 'active', fright: false }); return steps(game, s, 1); };
  const first = catchHero();
  assert.ok(first.some(e => e.name === 'hurt' && e.by === 'Bramble'));
  assert.equal(s.phase, 'dying');
  steps(game, s, DYING);
  assert.equal(s.lives, 1);
  assert.equal(s.phase, 'ready');
  assert.equal(s.globalDots, 0, 'after a death the house uses the global counter');
  catchHero();
  const end = steps(game, s, DYING);
  assert.equal(s.status, 'lost');
  assert.equal(s.reason, 'Caught by Bramble');
  assert.ok(names(end).includes('lost'));
  // An extra life at the threshold, once.
  const { game: g2, s: s2, maze } = playing();
  const { x0, x1, y } = longestRun(maze);
  for (let x = x0; x <= x1; x++) s2.pellets[y * W + x] = 1;
  place(s2.player, x0, y, RIGHT);
  s2.score = 9990;
  const ev = steps(g2, s2, 30);
  assert.equal(ev.filter(e => e.name === 'extra_life').length, 1);
  assert.equal(s2.lives, content.lives + 1);
});

test('the game starts with a Ready pause and uses the shared event names', () => {
  const game = kit.createGame(content, { seed: 2 });
  const s = game.createState({ high: 1234 });
  assert.equal(s.status, 'playing');
  assert.equal(s.high, 1234);
  assert.equal(s.phase, 'ready');
  const ev = steps(game, s, READY_FIRST);
  assert.ok(names(ev).includes('start'));
  assert.equal(s.phase, 'play');
  for (const e of steps(game, s, 120, { x: -1, y: 0 })) assert.equal(typeof e.name, 'string');
});

test('the bot verifies the sample within budget', () => {
  const r = kit.verify(kit.content.sample, { seed: 1, budgetMs: 10000 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.ok(r.report.bot.clearedPct >= 60, JSON.stringify(r.report.bot));
  assert.ok(r.report.ms < 2000);
  assert.equal(r.report.levels.length, content.levels.length);
  assert.ok(r.report.proven.length >= 3);
  const bad = kit.verify({ ...kit.content.sample, hunters: [] });
  assert.equal(bad.ok, false);
});

test('cast feeds paintGameArt and the renderer draws every phase without art or with it', () => {
  const { brief, entities } = cast(kit.content.sample);
  assert.equal(brief.player.name, 'Pip');
  const painted = paintGameArt(fallbackDirection({ title: content.title, pitch: content.logline, view: 'topdown', cast: brief }), { id: 'maze-test', title: content.title, entities });
  const art = painted.assemble(k => `/${k}.svg`);
  assert.deepEqual(Object.keys(art.frames).sort(), ['hero', 'hunter']);
  for (const k of ['pellet', 'bonus', 'power']) assert.ok(art.sprites[k], k);
  // A canvas stub that accepts any call.
  const calls = { n: 0 };
  const stub = new Proxy({}, { get: (t, k) => k in t ? t[k] : (k === 'canvas' ? { width: 448, height: 576 } : k === 'getTransform' ? () => ({ a: 2 }) : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => { calls.n++; }), set: (t, k, v) => { t[k] = v; return true; } });
  for (const a of [{}, art]) {
    const game = kit.createGame(content, { seed: 3 }), s = game.createState(), render = kit.createRenderer(game, { art: a });
    for (let i = 0; i < 600; i++) {
      game.step(s, i % 7 ? { x: -1, y: 0 } : { x: 0, y: 1 });
      if (i === 300) { s.frightT = 100; s.frightTotal = 300; s.hunters[0].fright = true; s.hunters[1].state = 'eyes'; s.bonus = { t: 100, x: 13.5, y: 17, points: 100, name: 'x' }; }
      render(stub, s, { cssWidth: 448, cssHeight: 576, dt: 1 / 60, events: s.events, reducedMotion: i > 400, paused: false, attract: i < 50 });
    }
    for (const phase of ['dying', 'clear']) { s.phase = phase; for (let t = 0; t < 120; t += 7) { s.phaseT = t; render(stub, s, { cssWidth: 300, cssHeight: 900, dt: 1 / 60 }); } }
  }
  assert.ok(calls.n > 1000);
});

// ---------- map sizes and the scrolling camera ----------
const sized = (size, patch = {}) => { const c = structuredClone(content); for (const lv of c.levels) lv.maze.size = size; return kit.validate({ ...c, ...patch }).content; };
const stubCtx = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : k === 'canvas' ? { width: 375, height: 640 } : k === 'getTransform' ? () => ({ a: 2 }) : k === 'measureText' ? () => ({ width: 40 }) : typeof k === 'string' && k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}, set: (t, k, v) => { t[k] = v; return true; } });

test('the classic size still builds exactly the original mazes', () => {
  const fp = m => m.cells.reduce((h, c, i) => (Math.imul(h ^ (c + i * 7), 16777619) >>> 0), 2166136261);
  // Fingerprints of the generator before sizes existed: published games keep their mazes.
  assert.equal(fp(buildMaze({ style: 'classic', density: 0.6, tunnels: 2, powerPellets: 4 }, 1)), 2038070033);
  assert.equal(fp(buildMaze({ style: 'compact', density: 0.6, tunnels: 2, powerPellets: 4 }, 2)), 1799707197);
  assert.equal(fp(buildMaze({ size: 'classic', style: 'sprawling', density: 0.6, tunnels: 2, powerPellets: 4 }, 3)), 3031276409);
});

test('every size keeps every maze invariant, with more houses and power pellets as the area grows', () => {
  const houses = { classic: 1, large: 2, huge: 3, vast: 5 };
  for (const size of SIZE_NAMES) {
    const runs = size === 'vast' ? 6 : 15;
    for (let seed = 0; seed < runs; seed++) {
      const params = { size, style: STYLE_NAMES[seed % 3], density: 0.3 + (seed % 8) / 10, tunnels: 1 + (seed % 2), powerPellets: 2 + 2 * (seed % 3) };
      const maze = buildMaze(params, seed);
      assert.deepEqual(checkMaze(maze, params), [], `${size} seed ${seed}`);
      assert.equal(maze.w, SIZES[size].w); assert.equal(maze.h, SIZES[size].h);
      assert.equal(maze.houses.length, houses[size]);
      assert.equal(maze.power.length, powerCountFor(params));
      assert.ok(maze.start.x === maze.w / 2 - 0.5 && isOpen(maze, maze.w / 2, maze.start.y));
    }
  }
  assert.ok(powerCountFor({ size: 'vast', powerPellets: 4 }) > powerCountFor({ size: 'huge', powerPellets: 4 }));
  assert.ok(powerCountFor({ size: 'large', powerPellets: 4 }) > 4);
  // A broken big maze is caught too.
  const big = buildMaze({ size: 'huge', style: 'classic', density: 0.6, tunnels: 1, powerPellets: 4 }, 5);
  const cells = [...big.cells]; cells[cells.findIndex((c, i) => c === 1 && i % big.w === 7)] = 0;
  assert.ok(checkMaze({ ...big, cells }).some(p => p.code === 'maze_mirror'));
});

test('bigger mazes scale hunters (up to 8), spread them over the houses and keep classic tile speeds', () => {
  const counts = Object.fromEntries(SIZE_NAMES.map(size => [size, kit.createGame(sized(size), { seed: 1 }).rosterFor(0).length]));
  assert.deepEqual(counts, { classic: 4, large: 6, huge: 8, vast: 8 });
  const game = kit.createGame(sized('vast'), { seed: 2 }), s = game.createState(), maze = game.mazeFor(0);
  assert.equal(s.pellets.length, maze.w * maze.h);
  assert.equal(new Set(s.hunters.map(h => h.home)).size, maze.houses.length, 'every house has hunters');
  assert.equal(new Set(s.hunters.map(h => h.name)).size, s.hunters.length, 'copies are numbered');
  for (const h of s.hunters) {
    const q = maze.houses[h.home];
    if (h.state === 'active') assert.deepEqual([h.x, h.y], [q.exit.x, q.exit.y]);
    else assert.ok(Math.abs(h.y - q.center.y) < 1e-9 && h.x > q.x0 && h.x < q.x1);
  }
  assert.equal(game.levelInfo(0).speed.pac, kit.createGame(content, { seed: 2 }).levelInfo(0).speed.pac);
  assert.ok(game.levelInfo(0).frightFrames > kit.createGame(content).levelInfo(0).frightFrames, 'fright stretches a little');
  // Eaten hunters go home to their own house and come back out.
  s.phase = 'play'; s.hunters = [s.hunters.find(h => h.home === 1)];
  const h = s.hunters[0], q = maze.houses[1];
  Object.assign(h, { state: 'eyes', x: q.exit.x - 0.5, y: q.exit.y, dir: LEFT });
  s.player.moving = false; s.player.x = 1; s.player.y = 1;
  const seen = new Set();
  for (let i = 0; i < 1200 && !(seen.has('leaving') && h.state === 'active'); i++) { game.step(s, {}); seen.add(h.state); }
  assert.ok(seen.has('entering') && h.state === 'active', [...seen].join());
  assert.equal(h.y, q.exit.y);
  // Validation: 8 hunters need a huge or vast level; unknown sizes are errors; old content defaults to classic.
  const eight = [...content.hunters, ...content.hunters].map((x, i) => ({ ...x, name: `H${i}` }));
  assert.equal(kit.validate({ ...structuredClone(kit.content.sample), hunters: eight }).ok, false);
  assert.equal(kit.validate({ ...structuredClone(sized('huge')), hunters: eight }).ok, true);
  const bad = structuredClone(kit.content.sample); bad.levels[0].maze.size = 'galactic';
  assert.ok(kit.validate(bad).errors.some(e => e.code === 'maze_size' && e.path === 'levels[0].maze.size'));
  const old = structuredClone(kit.content.sample); delete old.levels[0].maze.size;
  assert.equal(kit.validate(old).content.levels[0].maze.size, 'classic');
});

test('the camera follows the hero with a dead zone and clamps at the edges', () => {
  const box = { vw: 30, vh: 34, w: 92, h: 95 };
  assert.deepEqual(cameraStep(null, { ...box, hx: 1, hy: 1 }), { x: 0, y: 0, tx: 0, ty: 0 }, 'clamped at the top-left');
  const end = cameraStep(null, { ...box, hx: 91, hy: 94 });
  assert.deepEqual([end.x, end.y], [92 - 30, 95 - 34], 'clamped at the bottom-right');
  assert.equal(cameraStep(null, { vw: 40, vh: 40, w: 28, h: 31, hx: 5, hy: 5 }).x, (28 - 40) / 2, 'a covered axis is centred');
  // Inside the dead zone the camera holds still.
  let cam = cameraStep(null, { ...box, hx: 46, hy: 47 });
  const still = cameraStep(cam, { ...box, hx: 48, hy: 47 });
  assert.equal(still.x, cam.x);
  // Walking right: the camera eases after, never backwards, keeps the hero in the middle band, and stops at the edge.
  let hx = 46, last = cam.x;
  for (let i = 0; i < 900; i++) {
    hx = Math.min(91.5, hx + 0.13);
    cam = cameraStep(cam, { ...box, hx, hy: 47 });
    assert.ok(cam.x >= last - 1e-9); last = cam.x;
    if (hx < 80) assert.ok(hx - cam.x > box.vw * 0.25 && hx - cam.x < box.vw * 0.75, `hero at ${hx - cam.x} in view`);
  }
  assert.ok(Math.abs(cam.x - (92 - 30)) < 0.01, 'settled against the right edge');
  // The renderer switches to the camera only when tiles would be unreadable, and mods get the camera in render.view.
  const vast = kit.createGame(sized('vast'), { seed: 3 }), vs = vast.createState(), r = kit.createRenderer(vast, { art: {} });
  r(stubCtx(), vs, { cssWidth: 375, cssHeight: 640, dt: 1 / 60 });
  assert.ok(r.view.camera, 'a vast maze on a phone scrolls');
  assert.ok(r.view.s >= 14, 'at a readable tile size');
  const px = r.view.X(vs.player.x), py = r.view.Y(vs.player.y), c = r.view.clip;
  assert.ok(px > c.x && px < c.x + c.w && py > c.y && py < c.y + c.h, 'the hero is in view');
  assert.ok(Math.abs(r.view.X(vs.player.x + 1) - px - r.view.s) < 1e-9);
  const classic = kit.createGame(content), cr = kit.createRenderer(classic, { art: {} });
  cr(stubCtx(), classic.createState(), { cssWidth: 448, cssHeight: 576, dt: 1 / 60 });
  assert.equal(cr.view.camera, null, 'a classic maze that fits does not scroll');
  // Render a stretch of a vast game on the stub, minimap included.
  for (let i = 0; i < 240; i++) { vast.step(vs, { x: i % 90 < 45 ? -1 : 0, y: i % 90 < 45 ? 0 : 1 }); r(stubCtx(), vs, { cssWidth: 375, cssHeight: 640, dt: 1 / 60, events: vs.events }); }
});

test('the world adapter (for mods) works at a non-classic size', () => {
  const game = composeGame(kit, sized('large'), { seed: 4, mods: { weapon: { kind: 'projectile', ammoFrom: 'unlimited', effect: 'defeat' } } });
  const s = game.createState(); s.phase = 'play';
  const maze = game.mazeFor(0), world = kit.world.adapter(game);
  assert.deepEqual(world.size(s), { w: 44, h: 47 });
  for (let i = 0; i < maze.cells.length; i += 13) assert.equal(world.blocked(s, i % 44, Math.floor(i / 44)), maze.cells[i] !== 1);
  const t = maze.tunnels[0];
  assert.deepEqual(world.wrap(s, -0.6, t), [43.4, t]);
  assert.equal(world.blocked(s, -1, t), false, 'the tunnel wraps across x = 0');
  assert.equal(world.enemies(s).length, 6);
  // A bolt fired along a corridor right of x = 28 (beyond the classic width) hits a hunter there.
  let run = null;
  for (let y = 1; y < 46 && !run; y++) for (let x = 29; x < 38 && !run; x++) if ([0, 1, 2, 3, 4, 5].every(k => isOpen(maze, x + k, y))) run = { x, y };
  assert.ok(run, 'a corridor beyond the classic width');
  for (const h of s.hunters) Object.assign(h, { state: 'house' });
  Object.assign(s.player, { x: run.x, y: run.y, dir: RIGHT, moving: false, want: NONE, face: 1 });
  const events = [], h = s.hunters[0];
  // Pin the target four tiles ahead until the bolt arrives.
  for (let i = 0; i < 30 && h.state === 'active' || i === 0; i++) { Object.assign(h, { x: run.x + 4, y: run.y, dir: LEFT, state: 'active', fright: false, stunT: 0 }); game.step(s, { a: i === 0 }); events.push(...s.events); }
  assert.ok(events.some(e => e.name === 'defeated' && e.by === 'shot'), 'the bolt hit');
  assert.equal(wrapX(-1, 44), 43);
});

test('verify proves large and vast (open-world) maps within budget', () => {
  const large = kit.verify(sized('large'), { seed: 1 });
  assert.equal(large.ok, true, JSON.stringify(large.problems));
  assert.equal(large.report.levels[0].size, 'large');
  assert.ok(large.report.bot.clearedPct >= 60);
  // Open world: one long vast level.
  const world = structuredClone(sized('vast')); world.levels = world.levels.slice(0, 1);
  const vast = kit.verify(world, { seed: 2 });
  assert.equal(vast.ok, true, JSON.stringify(vast.problems));
  assert.equal(vast.report.levels[0].width, 92);
  assert.ok(vast.report.bot.clearedPct >= 60, JSON.stringify(vast.report.bot));
  assert.ok(vast.report.ms < 2000, `${vast.report.ms} ms`);
});

test('the prompt and schema separate size from style and protect levels on revision', () => {
  const desc = kit.content.schema.properties.levels.items.properties.maze.properties;
  assert.deepEqual(desc.size.enum, SIZE_NAMES);
  assert.match(desc.size.description, /Bigger map/i);
  assert.match(desc.style.description, /never changes the map size/);
  assert.match(kit.content.prompt, /open world/i);
  assert.match(kit.content.prompt, /vast/);
  assert.match(kit.content.prompt, /never drop/);
});
