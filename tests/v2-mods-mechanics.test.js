// The defining behavior of each tier-2 mod, each on at least two kits (v2/kits/EXTENDING.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import maze from '../v2/kits/maze/index.js';
import physics from '../v2/kits/physics/index.js';
import shmup from '../v2/kits/shmup/index.js';
import runner from '../v2/kits/runner/index.js';
import fighting from '../v2/kits/fighting/index.js';
import { composeGame, tileCenter, snapshot, applyOps } from '../v2/kits/mods/compose.js';

const N = { x: 0, y: 0, a: false, b: false };
const mazeContent = maze.validate(maze.content.sample).content;
const physicsContent = physics.validate(physics.content.sample).content;
const run = (game, s, frames, input = N, each) => { const events = []; for (let i = 0; i < frames; i++) { each?.(s, i); game.step(s, input); events.push(...s.events); } return events; };

function mazeGame(mods, seed = 3) {
  const game = composeGame(maze, mazeContent, { seed, mods });
  const s = game.createState();
  s.phase = 'play'; s.phaseT = 0;
  return { game, s, world: maze.world.adapter(game) };
}
const parkHunters = s => { for (const h of s.hunters) if (!h.spawned) Object.assign(h, { state: 'house', fright: false }); };
function breakoutGame(mods, seed = 3) {
  const game = composeGame(physics, physicsContent, { seed, mods });
  const s = game.createState();
  s.phase = 'play'; s.phaseT = 0;
  return { game, s, world: physics.world.adapter(game) };
}
const bricks = s => s.world.bodies.filter(b => !b.dead && b.tag === 'brick' && b.data.kind !== 'm');
/** Open tiles reachable from the hero, by flood fill over the adapter's terrain. */
function reachable(world, s) {
  const { w, h } = world.size(s), seen = new Set(), p = world.player(s);
  const stack = [[((Math.round(p.x) % w) + w) % w, Math.round(p.y)]];
  while (stack.length) {
    const [x, y] = stack.pop(), k = y * w + x;
    if (seen.has(k) || y < 0 || y >= h || world.blocked(s, x, y)) continue;
    seen.add(k);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) stack.push([(x + dx + w) % w, y + dy]);
  }
  return seen;
}

// ---------- falling ----------
test('falling: pieces land in breakout and become bricks that must be broken to clear', () => {
  const { game, s, world } = breakoutGame({ falling: { pieces: 'tetromino', every: 2, speed: 12, steer: 'drift' } });
  const before = bricks(s).length;
  const events = run(game, s, 400);
  const land = events.filter(e => e.name === 'piece_land');
  assert.ok(land.length >= 1, 'a piece landed');
  const added = bricks(s).filter(b => b.data.spawned);
  assert.ok(added.length >= 1, 'landed cells became bricks');
  assert.equal(s.m.bricksLeft, before + added.length - events.filter(e => e.name === 'break').length, 'new bricks count toward the level');
  // Each new brick rests on something: a brick or the ceiling on the stacking side (breakout pieces rise).
  const size = world.size(s);
  for (const b of added) {
    const row = b.data.row;
    const [x, y] = tileCenter(size, b.data.col, row - 1);
    assert.ok(row === 0 || bricks(s).some(o => Math.abs(o.x - x) < 0.3 && Math.abs(o.y - y) < 0.3) || world.blocked(s, x, y) || added.some(o => o.data.row === row), `brick at row ${row} rests on something`);
  }
  // Break every original brick: the spawned ones still hold the clear until they break too.
  for (const b of bricks(s).filter(b => !b.data.spawned)) world.defeat(s, b.id, { by: 'test' });
  s.mods.falling.t = 1e9; s.mods.falling.piece = null; // no more pieces
  game.step(s, N);
  assert.equal(s.phase, 'play', 'spawned bricks hold the clear');
  for (const b of bricks(s)) world.defeat(s, b.id, { by: 'test' });
  game.step(s, N);
  assert.equal(s.phase, 'clear', 'clearing the spawned bricks clears the level');
});

test('falling: a full row of bricks clears for points in breakout', () => {
  const { game, s, world } = breakoutGame({ falling: { pieces: 'small', every: 30, speed: 12, steer: 'drift', clearRows: true } });
  const size = world.size(s);
  for (const b of bricks(s)) world.defeat(s, b.id, { by: 'test' });
  for (let i = 0; i < size.w; i++) if (i !== 4) assert.ok(world.spawn(s, { x: tileCenter(size, i, 0)[0], y: tileCenter(size, i, 0)[1] }) != null);
  s.mods.falling.piece = { cells: [[0, 0]], x: 4, y: size.h, k: 1, color: 0, steer: 0 };
  const score = s.score;
  const events = run(game, s, 120);
  assert.ok(events.some(e => e.name === 'piece_land'), 'the block rose into the gap');
  const clear = events.find(e => e.name === 'row_clear');
  assert.ok(clear && clear.row === 0, 'row 0 cleared');
  assert.equal(bricks(s).filter(b => b.data.row === 0).length, 0, 'its bricks are gone');
  assert.ok(s.score >= score + clear.points, 'points for the row');
});

test('falling: pieces become maze walls without ever cutting off a pellet', () => {
  const { game, s, world } = mazeGame({ falling: { pieces: 'small', every: 2, speed: 12, steer: 'drift' } });
  const walls = () => Object.values(s.terrain?.cells || {}).filter(v => v === 0).length;
  let landed = 0;
  for (let i = 0; i < 1500 && landed < 6; i++) {
    parkHunters(s);
    game.step(s, N);
    if (s.events.some(e => e.name === 'piece_land')) {
      landed++;
      const reach = reachable(world, s), w = world.size(s).w;
      s.pellets.forEach((v, k) => { if (v) assert.ok(reach.has(k), `pellet at ${k % w},${Math.floor(k / w)} still reachable after landing ${landed}`); });
    }
  }
  assert.ok(landed >= 3, `pieces landed (${landed})`);
  assert.ok(walls() >= landed, 'landed cells are walls');
  const [k] = Object.keys(s.terrain.cells).map(Number), w = world.size(s).w;
  assert.equal(world.blocked(s, k % w, Math.floor(k / w)), true, 'the adapter reports the new wall as blocked');
  assert.equal(s.pellets[k], 0, 'no pellet is left inside a wall');
  // A new level brings back the level's own walls.
  s.pellets.fill(0); s.pelletsLeft = 0;
  run(game, s, 260, N, parkHunters);
  assert.equal(s.level, 1);
  assert.equal(s.terrain, null);
});

// ---------- waves ----------
test('waves: timed, growing waves spawn in the maze and the shmup', () => {
  const cfg = { enabled: true, waves: 3, every: 4, size: 2, grow: 'more' };
  const { game, s } = mazeGame({ waves: cfg });
  s.invulnT = 1e6; // wave hunters bounce off instead of ending the test
  const spawned = () => s.hunters.filter(h => h.spawned).length;
  run(game, s, 4 * 60 - 2, N, parkHunters);
  assert.equal(spawned(), 0, 'nothing before the first wave');
  const first = run(game, s, 60, N, parkHunters);
  assert.ok(first.some(e => e.name === 'wave' && e.wave === 1));
  assert.equal(spawned(), 2, 'wave 1 has size enemies');
  run(game, s, 4 * 60, N, parkHunters);
  assert.equal(spawned(), 5, 'wave 2 has one more');

  const sh = composeGame(shmup, shmup.validate(shmup.content.sample).content, { seed: 2, mods: { waves: cfg } });
  const t = sh.createState();
  const keepAlive = st => { if (st.player) st.player.invuln = 999; };
  const events = run(sh, t, 150 + 9 * 60, N, keepAlive);
  const ids = t.mods.waves.ids;
  assert.deepEqual(events.filter(e => e.name === 'wave').map(e => e.count), [2, 3], 'two growing waves by now');
  assert.ok(t.enemies.filter(e => e.spawned).length >= 1 && ids.length >= 1, 'wave ships are flying');
});

// ---------- boss ----------
test('boss: a maze boss holds the level clear until it is beaten, and tires so it can be beaten', () => {
  const { game, s, world } = mazeGame({ boss: { enabled: true, toughness: 'normal', arrivesAfter: 0, mustBeat: true, reward: 1000 } });
  const ev1 = run(game, s, 3, N, parkHunters);
  assert.ok(ev1.some(e => e.name === 'boss_spawn'));
  const boss = world.enemies(s).find(e => e.kind === 'boss');
  assert.ok(boss && boss.maxHp >= 2, 'one big hunter with hp');
  s.pellets.fill(0); s.pelletsLeft = 0;
  s.invulnT = 1e6; // the hero survives the test
  const held = run(game, s, 5, N, parkHunters);
  assert.ok(held.some(e => e.name === 'clear_held'));
  assert.equal(s.phase, 'play', 'no clear while the boss lives');
  // Wait for it to tire, then walk into it.
  const events = [];
  for (let i = 0; i < 1400 && s.phase === 'play'; i++) {
    parkHunters(s);
    const b = s.hunters.find(h => h.big);
    if (b && s.mods.boss.daze > 0) Object.assign(s.player, { x: Math.round(b.x), y: Math.round(b.y) });
    game.step(s, N); events.push(...s.events);
  }
  assert.ok(events.some(e => e.name === 'boss_dazed'), 'it tired');
  assert.ok(events.some(e => e.name === 'boss_hit'), 'a touch while dazed hurt it');
  assert.ok(events.some(e => e.name === 'boss_beaten'));
  assert.ok(['clear', 'ready'].includes(s.phase) || s.level === 1, 'beating it clears the level');
});

test('boss: a breakout boss holds the clear; as a bonus it does not', () => {
  const { game, s, world } = breakoutGame({ boss: { enabled: true, toughness: 'easy', arrivesAfter: 0, mustBeat: true } });
  game.step(s, N);
  assert.ok(s.m.boss?.spawned, 'the kit\'s own boss block appeared');
  for (const b of bricks(s)) world.defeat(s, b.id, { by: 'test' });
  run(game, s, 3);
  assert.equal(s.phase, 'play', 'held by the boss');
  const id = s.m.boss.id;
  while (s.m.boss) world.defeat(s, id, { by: 'test' });
  const events = run(game, s, 3);
  assert.ok(events.some(e => e.name === 'boss_beaten'));
  assert.equal(s.phase, 'clear');

  const bonus = breakoutGame({ boss: { enabled: true, toughness: 'hard', arrivesAfter: 0, mustBeat: false } });
  bonus.game.step(bonus.s, N);
  for (const b of bricks(bonus.s)) bonus.world.defeat(bonus.s, b.id, { by: 'test' });
  run(bonus.game, bonus.s, 2);
  assert.equal(bonus.s.phase, 'clear', 'a bonus boss does not hold the clear');
});

// ---------- timer ----------
test('timer: running out ends the level in the maze (lose) and in breakout (finish)', () => {
  const { game, s } = mazeGame({ timer: { enabled: true, seconds: 10, onZero: 'lose', name: 'Oxygen' } });
  const events = run(game, s, 10 * 60 + 5, N, parkHunters);
  assert.ok(events.filter(e => e.name === 'tick').length >= 4, 'the last seconds tick');
  assert.equal(s.status, 'lost');
  assert.match(s.reason, /Oxygen ran out/);

  const b = breakoutGame({ timer: { enabled: true, seconds: 10, onZero: 'finish' } });
  run(b.game, b.s, 10 * 60 + 5);
  assert.equal(b.s.status, 'won', 'a score attack finishes with the score');
});

test('timer: clearing a level banks the seconds left', () => {
  const { game, s, world } = breakoutGame({ timer: { enabled: true, seconds: 60, pointsPerSecond: 100 } });
  run(game, s, 60);
  for (const b of bricks(s)) world.defeat(s, b.id, { by: 'test' });
  const score = s.score;
  const events = run(game, s, 4 * 60);
  const bonus = events.find(e => e.name === 'time_bonus');
  assert.ok(bonus, 'banked on the next level');
  assert.equal(bonus.seconds, 59);
  assert.ok(s.score >= score + 5900);
  assert.equal(s.mods.timer.level, 1);
  assert.ok(s.mods.timer.left > 55 * 60, 'the clock restarts for the next level');
});

// ---------- shield ----------
test('shield: a hunter bounces off the shielded hero; without it, the hero is caught', () => {
  const setup = () => {
    const g = mazeGame({ shield: { enabled: true, seconds: 2, cooldown: 4 } });
    parkHunters(g.s);
    return g;
  };
  const touch = g => Object.assign(g.s.hunters[0], { x: g.s.player.x, y: g.s.player.y, state: 'active', fright: false });
  const a = setup();
  a.game.step(a.s, { ...N, a: true });
  assert.ok(a.s.events.some(e => e.name === 'shield_up'));
  touch(a);
  const events = run(a.game, a.s, 20);
  assert.equal(a.s.phase, 'play', 'not caught');
  assert.ok(events.some(e => e.name === 'shielded'), 'the shield turned it away');
  assert.ok(a.s.mods.shield.saves >= 1);
  const b = setup();
  touch(b);
  b.game.step(b.s, N);
  assert.equal(b.s.phase, 'dying', 'caught without the shield');
});

test('shield: a lost ball bounces back in breakout; the cooldown stops spamming', () => {
  const { game, s } = breakoutGame({ shield: { enabled: true, seconds: 2, cooldown: 4 } });
  game.step(s, { ...N, a: true }); // b is the kit's alias; the mod owns it, so a here launches the ball
  const ball = s.world.bodies.find(b => b.tag === 'ball' && !b.dead);
  game.step(s, { ...N, b: true });
  assert.ok(s.events.some(e => e.name === 'shield_up'));
  Object.assign(ball, { x: 3, y: s.m.h - 0.6, vx: 0.5, vy: 9 });
  ball.data.held = false; s.m.held = null;
  const lives = s.lives, events = run(game, s, 30);
  assert.equal(s.lives, lives, 'no life lost');
  assert.ok(events.some(e => e.name === 'shielded'));
  game.step(s, { ...N, b: false }); game.step(s, { ...N, b: true });
  assert.ok(s.events.some(e => e.name === 'empty'), 'still recharging');
});

// ---------- zones ----------
test('zones: points scored inside an open zone are multiplied (maze, breakout)', () => {
  for (const [{ game, s, world }, label] of [[mazeGame({ zones: { enabled: true, multiplier: 3 } }), 'maze'], [breakoutGame({ zones: { enabled: true, multiplier: 3 } }), 'breakout']]) {
    game.step(s, N);
    const p = world.player(s);
    s.mods.zones.zone = { x: p.x, y: p.y, r: 1.6, t: 600 };
    const before = s.score;
    world.addScore(s, 100);
    game.step(s, N);
    assert.ok(s.score - before >= 300, `${label}: 100 points became at least 300 (got ${s.score - before})`);
    assert.ok(s.events.some(e => e.name === 'zone_points'));
  }
});

// ---------- the operations themselves ----------
test('world operations: fighting and runner take score, hurt, shields and endings; snapshots carry spawned hp', () => {
  const fc = fighting.validate(fighting.content.sample).content;
  const fg = composeGame(fighting, fc, { seed: 1, mods: { timer: { enabled: true, seconds: 10, onZero: 'lose' } } });
  const fs = fg.createState();
  fg.startMatch(fs, { p1: 0, p2: 1, stage: 0 }); fg.debug.skipIntro(fs);
  fs.fighters[1].cpu = null;
  const fw = fighting.world.adapter(fg);
  fw.invulnerable(fs, 30);
  assert.equal(fw.hurtPlayer(fs, { by: 'test' }), false, 'invulnerable fighter takes no hit');
  for (let i = 0; i < 40; i++) fg.step(fs, N);
  const hp = fs.fighters[0].hp;
  fw.hurtPlayer(fs, { by: 'test' });
  assert.ok(fs.fighters[0].hp < hp, 'a hurt is a real hit');
  run(fg, fs, 11 * 60);
  assert.ok(fs.status === 'lost' || fs.mods.timer.left === 0 || fs.mods.timer.level > 0, 'the timer ran out in the fight');

  const rc = runner.validate(runner.samples.climb).content;
  const rg = composeGame(runner, rc, { seed: 1, mods: {} }), rs = rg.createState(), rw = runner.world.adapter(rg);
  const id = rw.spawn(rs, {});
  assert.ok(rw.enemies(rs).some(e => e.id === id), 'a climb monster appeared');
  rw.invulnerable(rs, 60);
  assert.equal(rw.hurtPlayer(rs, { by: 'test' }), false);
  rw.addScore(rs, 500); rg.step(rs, N);
  assert.ok(rs.score >= 500);
  rw.end(rs, { won: true, reason: 'test' });
  assert.equal(rs.status, 'won');

  const { s, world } = mazeGame({});
  const caps = maze.world.capabilities;
  assert.ok(['spawn', 'terrain', 'score', 'hurt', 'invulnerable', 'end', 'grid'].every(c => caps.includes(c)));
  const r = applyOps(maze, world, s, [{ op: 'spawn', kind: 'boss', hp: 8 }, { op: 'invulnerable', frames: 30 }, { op: 'end', won: false }]);
  assert.deepEqual(r, { applied: 3, dropped: 0 });
  const snap = snapshot(maze, world, s);
  assert.ok(snap.enemies.some(e => e.kind === 'boss' && e.maxHp === 2), 'spawned enemies carry kind and hp');
  assert.equal(s.status, 'lost');
});
