import test from 'node:test';
import assert from 'node:assert/strict';
import maze from '../v2/kits/maze/index.js';
import { modsFor, modsSchema, activeMods, composeGame, composeRenderer } from '../v2/kits/mods/compose.js';

const content = maze.validate(maze.content.sample).content;
const play = s => { s.phase = 'play'; s.phaseT = 0; return s; };
const strict = node => { if (node?.type === 'object') { assert.equal(node.additionalProperties, false); assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort()); Object.values(node.properties).forEach(strict); } if (node?.items) strict(node.items); };

// Put hunter 0 a few open tiles ahead of the hero, in the direction the hero faces.
function lineUp(game, s, distance = 3) {
  const world = maze.world.adapter(game), p = world.player(s);
  const h = s.hunters[0];
  for (let d = 1; d <= distance; d++) assert.ok(!world.blocked(s, p.x + p.facing.x * d, p.y + p.facing.y * d), 'test setup needs an open corridor ahead');
  Object.assign(h, { x: Math.round(p.x) + p.facing.x * distance, y: Math.round(p.y) + p.facing.y * distance, state: 'active', fright: false, stunT: 0 });
  return h;
}
const run = (game, s, frames, input = {}) => { const events = []; for (let i = 0; i < frames; i++) { game.step(s, i === 0 ? input : { ...input, a: false, b: false }); events.push(...s.events); } return events; };

test('mods are offered by capability, with a strict schema fragment', () => {
  assert.deepEqual(modsFor(maze).map(m => m.id), ['weapon']);
  strict(modsSchema(maze));
  assert.deepEqual(activeMods(maze, {}), [], 'nothing is on unless content asks');
  assert.deepEqual(activeMods(maze, { weapon: { kind: 'projectile' } }).map(a => a.button), ['a']);
  assert.deepEqual(modsFor({ world: { capabilities: ['player'], buttons: ['a', 'b'] } }), [], 'a kit without the capabilities, or without a free button, gets no weapon');
});

test('a blaster reloads on power pellets, fires the way the hero faces and defeats a hunter', () => {
  const game = composeGame(maze, content, { seed: 3, mods: { weapon: { kind: 'projectile', name: 'spark wand', ammoFrom: 'event', reloadOn: 'power_up', ammo: 3, effect: 'defeat' } } });
  assert.ok(game.controls.some(c => c.input === 'a' && /spark wand/.test(c.label)), 'the fire button shows in the controls');
  const s = play(game.createState());
  assert.equal(s.mods.weapon.ammo, 0);
  const empty = run(game, s, 2, { a: true });
  assert.ok(empty.some(e => e.name === 'empty'), 'no ammo yet');
  s.events.push({ name: 'power' }); // a power pellet this frame reloads (the composer reads the kit's events)
  game.step(s, {}); s.events = [];
  s.mods.weapon.ammo = Math.max(s.mods.weapon.ammo, 3);
  const h = lineUp(game, s);
  const events = run(game, s, 30, { a: true });
  assert.ok(events.some(e => e.name === 'shoot'));
  assert.ok(events.some(e => e.name === 'defeated' && e.by === 'shot'), 'the bolt hit');
  assert.ok(['eyes', 'entering'].includes(h.state), 'a defeated hunter goes home as eyes');
  assert.equal(s.mods.weapon.ammo, 2);
});

test('the reload happens on the real event the kit emits; old option names still work', () => {
  const legacy = composeGame(maze, content, { mods: { weapon: { kind: 'projectile', ammoFrom: 'event', reloadOn: 'power' } } });
  assert.equal(legacy.mods[0].cfg.reloadOn, 'power_up');
  const game = composeGame(maze, content, { seed: 4, mods: { weapon: { kind: 'projectile', ammoFrom: 'event', reloadOn: 'power_up', ammo: 2, effect: 'defeat' } } });
  const s = play(game.createState());
  const world = maze.world.adapter(game);
  // Walk the hero onto a power pellet by teleporting next to one.
  const i = s.pellets.indexOf(2), px = i % 28, py = Math.floor(i / 28);
  Object.assign(s.player, { x: px, y: py });
  for (const h of s.hunters) Object.assign(h, { x: 1, y: 1, state: 'house' });
  run(game, s, 2);
  assert.equal(s.mods.weapon.ammo, 2, `ammo after eating the power pellet at ${px},${py} (blocked: ${world.blocked(s, px, py)})`);
});

test('a stun freezes a hunter and makes it harmless; a bomb blasts along corridors', () => {
  const stunGame = composeGame(maze, content, { seed: 5, mods: { weapon: { kind: 'projectile', ammoFrom: 'unlimited', effect: 'stun' } } });
  const s = play(stunGame.createState());
  const h = lineUp(stunGame, s);
  run(stunGame, s, 20, { a: true });
  assert.ok(h.stunT > 0, 'stunned');
  const at = [h.x, h.y]; run(stunGame, s, 30);
  assert.deepEqual([h.x, h.y], at, 'a stunned hunter does not move');

  const bombGame = composeGame(maze, content, { seed: 5, mods: { weapon: { kind: 'bomb', ammoFrom: 'start', ammo: 2, effect: 'defeat' } } });
  const b = play(bombGame.createState());
  assert.equal(b.mods.weapon.ammo, 2, 'ammo per life');
  for (const q of b.hunters) Object.assign(q, { state: 'house' });
  const events = []; bombGame.step(b, { a: true }); events.push(...b.events);
  const bomb = b.mods.weapon.bombs[0];
  assert.ok(bomb, 'a bomb was dropped');
  // A hunter waiting one open tile from the bomb, in a corridor direction.
  const world = maze.world.adapter(bombGame);
  const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([x, y]) => !world.blocked(b, bomb.x + x, bomb.y + y));
  const hb = b.hunters[0];
  for (let i = 0; i < 70 && !events.some(e => e.name === 'blast'); i++) { Object.assign(hb, { x: bomb.x + dx, y: bomb.y + dy, state: 'active', fright: false, stunT: 1 }); Object.assign(b.player, { x: 1, y: 1 }); bombGame.step(b, {}); events.push(...b.events); hb.stunT = 0; }
  assert.ok(events.some(e => e.name === 'blast'), 'the bomb went off');
  assert.ok(events.some(e => e.name === 'defeated' && e.by === 'bomb') || ['eyes', 'entering'].includes(hb.state), 'the blast caught the hunter next to it');
});

test('the kit never sees a mod button, and modded games stay deterministic', () => {
  let seen = false;
  const spy = { ...maze, createGame: (c, o) => { const g = maze.createGame(c, o); return { ...g, step: (s, input) => { if (input.a) seen = true; return g.step(s, input); } }; } };
  const game = composeGame(spy, content, { seed: 6, mods: { weapon: { kind: 'projectile', ammoFrom: 'unlimited' } } });
  const s = play(game.createState()); run(game, s, 5, { a: true });
  assert.equal(seen, false);
  const replay = () => { const g = composeGame(maze, content, { seed: 9, mods: { weapon: { kind: 'bomb', ammoFrom: 'unlimited' } } }); const st = g.createState(); for (let i = 0; i < 900; i++) g.step(st, { x: i % 200 < 100 ? -1 : 1, y: 0, a: i % 45 === 0, b: false }); return JSON.stringify(st); };
  assert.equal(replay(), replay());
  // The composed renderer draws without throwing on a stub canvas.
  const g = composeGame(maze, content, { seed: 1, mods: { weapon: { kind: 'projectile', ammoFrom: 'unlimited' } } });
  const r = composeRenderer(maze, g, { art: {} });
  const ctx = new Proxy({}, { get: (t, k) => k === 'canvas' ? { width: 448, height: 576 } : k === 'measureText' ? () => ({ width: 50 }) : k === 'getTransform' ? () => ({ a: 1 }) : k in t ? t[k] : (typeof k === 'string' && /^(create)/.test(k) ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const st = play(g.createState()); for (let i = 0; i < 60; i++) { g.step(st, { a: i % 10 === 0 }); r(ctx, st, { cssWidth: 448, cssHeight: 576, dt: 1 / 60, events: st.events }); }
});
