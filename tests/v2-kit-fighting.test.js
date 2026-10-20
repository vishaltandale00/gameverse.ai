import test from 'node:test';
import assert from 'node:assert/strict';
import kit from '../v2/kits/fighting/index.js';
import { loadKit } from '../v2/kits/registry.js';
import { knockback, hurtboxes } from '../v2/kits/fighting/sim.js';
import { motionFrames, toInput, CHARGE } from '../v2/kits/fighting/input.js';
import { ARENA } from '../v2/kits/fighting/arena.js';
import { advantage } from '../v2/kits/fighting/moves.js';

const N = { x: 0, y: 0, a: false, b: false };
const content = kit.validate(kit.content.sample).content;
const ids = Object.fromEntries(content.fighters.map((f, i) => [f.id, i]));

/** A fight already past the intro: slot 0 is driven by input, slot 1 is a passive dummy. */
function fight({ p1 = ids.rook, p2 = ids.brannoch, gap = 60, mode = 'traditional', seed = 1 } = {}) {
  const c = mode === 'traditional' ? content : kit.validate({ ...kit.content.sample, mode }).content;
  const game = kit.createGame(c, { seed }), s = game.createState();
  game.startMatch(s, { p1, p2, stage: 0 });
  game.debug.skipIntro(s);
  s.fighters[1].cpu = null;
  s.fighters[0].x = 500 - gap / 2; s.fighters[1].x = 500 + gap / 2;
  return { game, s };
}
const run = (game, s, n, inp = N, events = []) => { for (let i = 0; i < n; i++) { game.step(s, inp); events.push(...s.events); } return events; };
const feed = (game, s, frames, events = []) => { for (const fr of frames) { game.step(s, toInput(fr, s.fighters[0].facing)); events.push(...s.events); } return events; };
const hold = (n, fr) => Array.from({ length: n }, () => fr);
const sp = (game, fid, arch) => game.roster[fid].specials.find(x => x.archetype === arch);

function strictSchema(node, path = '$') {
  if (node.type === 'object') {
    assert.equal(node.additionalProperties, false, `${path} additionalProperties`);
    assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${path} required`);
    for (const [k, v] of Object.entries(node.properties)) strictSchema(v, `${path}.${k}`);
  }
  if (node.type === 'array') strictSchema(node.items, `${path}[]`);
  for (const bad of ['oneOf', 'anyOf', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength']) assert.ok(!(bad in node), `${path} uses ${bad}`);
}

test('the kit matches the contract and the sample validates', async () => {
  for (const k of ['id', 'name', 'version', 'summary', 'examples', 'content', 'validate', 'cast', 'createGame', 'createRenderer', 'verify', 'controls']) assert.ok(kit[k], k);
  assert.equal(await loadKit('fighting'), kit);
  strictSchema(kit.content.schema);
  const v = kit.validate(kit.content.sample);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const { brief, entities } = kit.cast(content);
  assert.ok(brief.player.name && brief.enemy.name);
  assert.ok(Object.values(entities).some(e => e.tags.includes('player')) && Object.values(entities).some(e => e.tags.includes('enemy')));
});

test('validation reports repairable errors and clamps numbers', () => {
  const bad = structuredClone(kit.content.sample);
  bad.fighters[0].specials[1].motion = 'qcf';           // collides with the fireball
  bad.ladder[0].fighter = 'nobody';
  bad.fighters[1].stats.health = 99999;
  const v = kit.validate(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.code === 'motion_conflict' && e.path === '$.fighters[0].specials[1].motion' && e.hint));
  assert.ok(v.errors.some(e => e.code === 'ref' && e.path === '$.ladder[0].fighter'));
  const ok = structuredClone(kit.content.sample); ok.fighters[1].stats.health = 99999; ok.roundTime = 500;
  const c = kit.validate(ok).content;
  assert.equal(c.fighters[1].stats.health, 1300); assert.equal(c.roundTime, 99);
  assert.equal(kit.validate({ ...kit.content.sample, fighters: [kit.content.sample.fighters[0]] }).errors[0].code, 'roster');
});

test('same seed and inputs give the same final state', () => {
  const play = () => {
    const game = kit.createGame(content, { seed: 42 }), s = game.createState();
    const script = [[0, 0, 1, 0], [0, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 0]];   // menu: arcade, cursor, select
    for (const [x, y, a, b] of script) game.step(s, { x, y, a: !!a, b: !!b });
    for (let i = 0; i < 4000; i++) { const t = i % 97; game.step(s, { x: t < 40 ? 1 : t < 50 ? -1 : 0, y: t > 80 ? 1 : 0, a: t % 13 === 0, b: t % 29 === 0 }); }
    return s;
  };
  const a = play(), b = play();
  assert.equal(a.phase === 'menu', false);
  assert.deepEqual(a, b);
  assert.doesNotThrow(() => structuredClone(a));
});

test('every motion is read from the buffer with leniency, and not confused', () => {
  const { game, s } = fight({ gap: 260 });
  const rook = game.roster[ids.rook], f = s.fighters[0];
  for (const special of rook.specials) for (const btn of ['a', 'b']) {
    const t = fight({ gap: 260 });
    feed(t.game, t.s, motionFrames(special.motion, btn));
    assert.equal(t.s.fighters[0].move, special[btn], `${special.name} ${btn}`);
  }
  // Two frames per direction still reads as a quarter circle.
  let t = fight({ gap: 260 });
  feed(t.game, t.s, [[0, 1, 0, 0], [0, 1, 0, 0], [1, 1, 0, 0], [1, 1, 0, 0], [1, 0, 0, 0], [1, 0, 1, 0]]);
  assert.equal(t.s.fighters[0].move, sp(t.game, ids.rook, 'fireball').a);
  // Walking forward into a quarter circle is still a fireball, not a dragon punch.
  t = fight({ gap: 260 });
  feed(t.game, t.s, [...hold(6, [1, 0, 0, 0]), [0, 1, 0, 0], [1, 1, 0, 0], [1, 0, 1, 0]]);
  assert.equal(t.s.fighters[0].move, sp(t.game, ids.rook, 'fireball').a);
  // The dragon punch shortcut (down-forward, down, down-forward) works.
  t = fight({ gap: 260 });
  feed(t.game, t.s, [[1, 1, 0, 0], [0, 1, 0, 0], [1, 1, 0, 1]]);
  assert.equal(t.s.fighters[0].move, sp(t.game, ids.rook, 'uppercut').b);
  // Charge moves need the full charge.
  t = fight({ p1: ids.mira, gap: 260 });
  feed(t.game, t.s, [...hold(CHARGE - 15, [-1, 1, 0, 0]), [1, 0, 1, 0]]);
  assert.notEqual(t.s.fighters[0].move, sp(t.game, ids.mira, 'charge_dash').a);
  t = fight({ p1: ids.mira, gap: 260 });
  feed(t.game, t.s, motionFrames('charge-bf', 'a'));
  assert.equal(t.s.fighters[0].move, sp(t.game, ids.mira, 'charge_dash').a);
  // Air-only specials come out in the air, the shared ground motion stays the ground move.
  t = fight({ p1: ids.tamsin, gap: 260 });
  feed(t.game, t.s, [[0, -1, 0, 0], ...hold(8, [0, 0, 0, 0]), ...motionFrames('qcf', 'b')]);
  assert.equal(t.s.fighters[0].move, sp(t.game, ids.tamsin, 'air_dive').b);
  // Super needs the meter.
  t = fight({ gap: 260 });
  feed(t.game, t.s, motionFrames('qcf2', 'b'));
  assert.notEqual(t.s.fighters[0].move, 'super');
  t = fight({ gap: 260 }); t.s.fighters[0].meter = 100;
  const ev = feed(t.game, t.s, motionFrames('qcf2', 'b'));
  assert.equal(t.s.fighters[0].move, 'super'); assert.equal(t.s.fighters[0].meter, 0);
  assert.ok(t.s.flash && ev.some(e => e.name === 'super'));
  void game; void s; void f;
});

test('frame data: advantage, hit-stop, counter hits and damage scaling', () => {
  const rook = kit.createGame(content).roster[ids.rook];
  assert.ok(advantage(rook.moves['5A']).hit > 0, 'jab is plus on hit');
  assert.ok(advantage(rook.moves['2B']).block < 0, 'sweep is punishable on block');
  // A jab into the startup of a heavy kick is a counter hit for 20% more.
  let { game, s } = fight({ gap: 50 });
  game.debug.startMove(s, 1, '5B');
  const ev = feed(game, s, [[0, 0, 1, 0], ...hold(8, [0, 0, 0, 0])]);
  const hit = ev.find(e => e.name === 'hit' && e.slot === 0);
  assert.ok(hit && hit.counter && ev.some(e => e.name === 'counter'));
  assert.equal(hit.dmg, Math.round(rook.moves['5A'].damage * 1.2));
  // Low chain: 2A, 2A, 2B is a 3-hit combo, the third hit scaled, with hit-stop on contact.
  ({ game, s } = fight({ gap: 50 }));
  const chain = [[0, 1, 1, 0], ...hold(11, [0, 1, 0, 0]), [0, 1, 1, 0], ...hold(11, [0, 1, 0, 0]), [0, 1, 0, 1], ...hold(40, [0, 1, 0, 0])];
  let stopped = false; const events = [];
  for (const fr of chain) { game.step(s, toInput(fr, s.fighters[0].facing)); events.push(...s.events); if (s.hitstop > 0) stopped = true; }
  const hits = events.filter(e => e.name === 'hit' && e.slot === 0);
  assert.ok(stopped, 'hit-stop froze the action');
  assert.equal(hits.length, 3);
  assert.equal(Math.max(...events.filter(e => e.name === 'combo').map(e => e.hits)), 3);
  assert.equal(hits[2].dmg, Math.round(rook.moves['2B'].damage * 0.85));
  assert.equal(s.fighters[1].st === 'launch' || s.fighters[1].st === 'knockdown' || s.fighters[1].st === 'wakeup', true, 'sweep knocks down');
});

test('blocking: lows need a crouch block, overheads a standing block; specials chip', () => {
  const tryBlock = (move, stand, air = false) => {
    const { game, s } = fight({ p1: ids.rook, p2: ids.rook, gap: 50 });
    const atk = s.fighters[1];
    if (air) { atk.air = true; atk.y = 40; atk.st = 'air'; }
    game.debug.startMove(s, 1, move);
    return run(game, s, 30, { x: -1, y: stand ? 0 : 1, a: false, b: false });
  };
  assert.ok(tryBlock('2B', false).some(e => e.name === 'block'), 'crouch blocks the sweep');
  assert.ok(tryBlock('2B', true).some(e => e.name === 'hit'), 'standing block loses to the sweep');
  assert.ok(tryBlock('jB', true, true).some(e => e.name === 'block'), 'standing blocks the jump-in');
  assert.ok(tryBlock('jB', false, true).some(e => e.name === 'hit'), 'crouch block loses to the jump-in');
  const { game, s } = fight({ p1: ids.rook, p2: ids.rook, gap: 160 });
  game.debug.startMove(s, 1, sp(game, ids.rook, 'fireball').b);
  const before = s.fighters[0].hp;
  const ev = run(game, s, 80, { x: -1, y: 1, a: false, b: false });
  assert.ok(ev.some(e => e.name === 'block'));
  assert.ok(s.fighters[0].hp < before, 'chip damage');
  assert.equal(s.fighters[0].combo, 0);
});

test('throws connect up close and can be teched', () => {
  let { game, s } = fight({ gap: 44 });
  let ev = feed(game, s, [[1, 0, 1, 1], ...hold(40, [0, 0, 0, 0])]);
  assert.ok(ev.some(e => e.name === 'throw' && e.slot === 0));
  assert.ok(s.fighters[1].hp < s.fighters[1].maxHp);
  ({ game, s } = fight({ gap: 44 }));
  game.debug.startMove(s, 1, 'throw');
  ev = feed(game, s, [...hold(4, [0, 0, 0, 0]), [0, 0, 1, 1], ...hold(30, [0, 0, 0, 0])]);
  assert.ok(ev.some(e => e.name === 'throw') && ev.some(e => e.name === 'tech'));
  assert.equal(s.fighters[0].hp, s.fighters[0].maxHp);
});

test('projectiles clash, counters answer strikes, and knockdowns give a safe wakeup', () => {
  let { game, s } = fight({ p1: ids.rook, p2: ids.zephyra, gap: 300 });
  game.debug.startMove(s, 0, sp(game, ids.rook, 'fireball').a);
  game.debug.startMove(s, 1, sp(game, ids.zephyra, 'fireball').a);
  let ev = run(game, s, 90);
  assert.ok(ev.some(e => e.name === 'clash'));
  assert.equal(s.projectiles.length, 0);
  ({ game, s } = fight({ p1: ids.rook, p2: ids.brannoch, gap: 60 }));
  game.debug.startMove(s, 1, sp(game, ids.brannoch, 'counter').b);
  ev = feed(game, s, [...hold(5, [0, 0, 0, 0]), [0, 0, 0, 1], ...hold(50, [0, 0, 0, 0])]);
  assert.ok(ev.some(e => e.name === 'parry'));
  assert.ok(ev.some(e => e.name === 'hit' && e.slot === 1), 'the counter strikes back');
  assert.ok(s.fighters[0].hp < s.fighters[0].maxHp && s.fighters[1].hp === s.fighters[1].maxHp);
  ({ game, s } = fight({ gap: 60 }));
  game.debug.startMove(s, 0, '2B');
  let woke = false;
  for (let i = 0; i < 120; i++) { game.step(s, N); if (s.fighters[1].st === 'wakeup') { woke = true; assert.ok(s.fighters[1].invuln > 0); assert.equal(hurtboxes(game, s.fighters[1]).length, 0); } }
  assert.ok(woke);
});

test('rounds: KO slow motion, best of three, finish window and flourish', () => {
  const { game, s } = fight({ gap: 50 });
  const ko = () => { s.fighters[1].hp = 1; game.debug.startMove(s, 0, '5A'); return run(game, s, 12); };
  let ev = ko();
  assert.ok(ev.some(e => e.name === 'ko'));
  assert.equal(s.phase, 'ko'); assert.ok(s.slow > 0); assert.equal(s.banner.text, 'K.O.');
  run(game, s, 600, N); // through the round end into round 2
  assert.equal(s.match.round, 2); assert.deepEqual(s.match.wins, [1, 0]);
  game.debug.skipIntro(s);
  s.fighters[0].x = 470; s.fighters[1].x = 520;
  ev = ko();
  assert.equal(s.phase, 'finish'); assert.equal(s.fighters[1].st, 'dazed');
  run(game, s, 20);   // let the jab recover first
  ev = feed(game, s, [[0, 0, 0, 0], ...motionFrames('tap-dd', 'b'), [0, 0, 0, 0]]);
  assert.ok(ev.some(e => e.name === 'finisher'));
  assert.equal(s.phase, 'flourish');
  run(game, s, 700, N);
  assert.equal(s.status, 'won');
  assert.equal(s.match.winner, 0);
});

test('time over awards the round on remaining health', () => {
  const { game, s } = fight({ gap: 200 });
  s.fighters[1].hp = 500; s.match.timer = 2;
  const ev = run(game, s, 4);
  assert.ok(ev.some(e => e.name === 'time_up'));
  assert.equal(s.match.wins[0], 1);
});

test('arcade flow: menu, select, VS, then a ladder without yourself ending at the boss', () => {
  const game = kit.createGame(content, { seed: 3 }), s = game.createState();
  assert.equal(s.phase, 'menu');
  const tap = inp => { game.step(s, inp); game.step(s, N); };
  tap({ ...N, a: true }); assert.equal(s.phase, 'select');
  tap({ ...N, x: 1 }); tap({ ...N, a: true });
  assert.equal(s.phase, 'vs');
  const p1 = game.selectable[1];
  assert.equal(s.arcade.p1, p1);
  assert.ok(s.arcade.list.every(r => r.fighter !== p1 || r.boss));
  assert.equal(s.arcade.list.at(-1).fighter, ids.vexis);
  assert.equal(s.arcade.list.at(-1).boss, true);
  run(game, s, 160);
  assert.equal(s.phase, 'intro');
  run(game, s, 110);
  assert.equal(s.phase, 'fight');
  assert.equal(s.fighters[1].cpu.level, s.arcade.list[0].difficulty);
});

test('harder CPUs beat easier ones', () => {
  let wins = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const game = kit.createGame(content, { seed }), s = game.createState();
    game.startMatch(s, { p1: ids.rook, p2: ids.rook, cpuBoth: true, levels: seed % 2 ? [5, 1] : [1, 5] });
    run(game, s, 20000);
    if ((s.match.winner === 0) === !!(seed % 2)) wins++;
  }
  assert.ok(wins >= 3, `level 5 won ${wins}/4`);
});

test('platform mode: percent, knockback scaling, ledges and stocks', () => {
  const { game, s } = fight({ mode: 'platform', gap: 50 });
  const d = s.fighters[1], m = game.roster[d.fid].moves['5B'];
  const low = knockback(game, d, m).v; d.percent = 120; const high = knockback(game, d, m).v;
  assert.ok(high > low * 2, 'knockback grows with percent');
  d.percent = 0;
  game.debug.startMove(s, 0, '5B'); run(game, s, 12);
  assert.ok(d.percent > 0 && d.hp === d.maxHp, 'damage is percent, not health');
  const v0 = Math.abs(d.vx) + Math.abs(d.pv);
  const t = fight({ mode: 'platform', gap: 50 }); t.s.fighters[1].percent = 150;
  t.game.debug.startMove(t.s, 0, '5B'); run(t.game, t.s, 12);
  assert.ok(Math.abs(t.s.fighters[1].vx) > v0 * 2, 'a hit at high percent launches farther');
  // Falling just past the edge grabs the ledge.
  t.s.hitstop = 0; const f = t.s.fighters[0]; Object.assign(f, { st: 'air', air: true, x: ARENA.P.main.x0 - 10, y: -20, vy: -2, vx: 0 });
  run(t.game, t.s, 2);
  assert.equal(f.st, 'ledge');
  run(t.game, t.s, 6, { x: 1, y: 0, a: false, b: false });
  run(t.game, t.s, 20);
  assert.equal(f.st === 'idle' || f.st === 'walk', true, 'climbs back up');
  // Leaving the blast zone costs a stock.
  const stocks = f.stocks; Object.assign(f, { st: 'launch', air: true, x: ARENA.P.blast.r + 5, y: 100, vx: 5, vy: 0 });
  const ev = run(t.game, t.s, 1);
  assert.ok(ev.some(e => e.name === 'blast'));
  assert.equal(f.stocks, stocks - 1); assert.equal(f.st, 'respawn');
});

test('verify proves the sample: frame data, motions, CPU KOs and a beatable easy CPU', () => {
  const r = kit.verify(kit.content.sample, { seed: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.report.motions.ok, r.report.motions.tried);
  assert.ok(r.report.cpuVsCpu.koRounds > 0 && r.report.cpuVsCpu.finished === r.report.cpuVsCpu.matches);
  assert.ok(r.report.scripted.wins > 0);
  assert.ok(r.report.ms < 2000);
  assert.equal(kit.verify({ ...kit.content.sample, fighters: [] }).ok, false);
});

test('the renderer draws every screen without a DOM', () => {
  const calls = { fill: 0, text: 0 };
  const grad = { addColorStop() {} };
  const ctx = new Proxy({ measureText: t => ({ width: String(t).length * 7 }), createLinearGradient: () => grad, createRadialGradient: () => grad, fill() { calls.fill++; }, fillText() { calls.text++; } }, { get: (o, k) => k in o ? o[k] : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
  const frame = (events = []) => ({ cssWidth: 960, cssHeight: 540, dt: 1 / 60, events, reducedMotion: false, paused: false, attract: false });
  for (const mode of ['traditional', 'platform']) {
    const c = kit.validate({ ...kit.content.sample, mode }).content, game = kit.createGame(c, { seed: 5 });
    const render = kit.createRenderer(game, { art: {} }), s = game.createState();
    render(ctx, s, frame());                                         // menu
    render(ctx, s, { ...frame(), attract: true });                   // exhibition behind the title
    game.step(s, { ...N, a: true }); game.step(s, N); render(ctx, s, frame());   // select
    game.step(s, { ...N, a: true }); render(ctx, s, frame());        // vs
    game.startMatch(s, { p1: 0, p2: 5, cpuBoth: true, levels: [4, 4] });
    for (let i = 0; i < 3000 && s.status === 'playing'; i++) { game.step(s, N); if (i % 7 === 0) render(ctx, s, frame(s.events)); }
    s.phase = 'continue'; s.arcade = { p1: 0, list: [{ fighter: 5 }], rung: 0 }; render(ctx, s, frame());
    s.phase = 'ending'; render(ctx, s, frame());
  }
  assert.ok(calls.fill > 1000 && calls.text > 100);
});

test('common change requests are real options: arena width, rounds, game speed', () => {
  const wide = structuredClone(kit.content.sample); wide.stages[0].width = 3000; wide.roundsToWin = 3; wide.gameSpeed = 1.5;
  const c = kit.validate(wide).content, game = kit.createGame(c, { seed: 2 }), s = game.createState();
  game.startMatch(s, { p1: ids.rook, p2: ids.mira, stage: 0 });
  game.debug.skipIntro(s); s.fighters[1].cpu = null;
  // Walk right for a long time: a 3000-unit stage keeps going far past the standard 960 wall.
  s.fighters[1].x = 2900;
  run(game, s, 600, { x: 1, y: 0, a: false, b: false });
  assert.ok(s.fighters[0].x > 1500, `walked to ${s.fighters[0].x}`);
  // 1.5x speed: 60 steps run 90 simulation frames.
  const t0 = s.match.timer; run(game, s, 60);
  assert.equal(t0 - s.match.timer, 90);
  // Three wins are needed: a KO at one win is not match point, at two wins it is (finish window).
  const koAt = wins => { const t = fight(); Object.assign(t.game, { toWin: game.toWin, maxRounds: game.maxRounds }); t.s.match.wins = [wins, 0]; t.s.fighters[1].hp = 1; t.game.debug.startMove(t.s, 0, '5A'); run(t.game, t.s, 12); return t.s.phase; };
  assert.equal(koAt(1), 'ko'); assert.equal(koAt(2), 'finish');
  const normal = kit.createGame(content); assert.equal(normal.toWin, 2); assert.equal(normal.speed, 1);
  // Platform stages scale with the width too.
  const pc = kit.validate({ ...wide, mode: 'platform' }).content, pg = kit.createGame(pc), ps = pg.createState();
  pg.startMatch(ps, { p1: 0, p2: 1, stage: 0 });
  assert.ok(ARENA.P.main.x1 - ARENA.P.main.x0 > 1400);
  assert.equal(kit.validate({ ...kit.content.sample, roundsToWin: 9, gameSpeed: 7 }).content.roundsToWin, 4);
  assert.match(kit.content.prompt, /stages\[\]\.width/);
});

test('world adapter: mods see the fighters in tile units and can hit or stun the rival', () => {
  assert.deepEqual(kit.world.buttons, ['a', 'b']);
  const { game, s } = fight({ gap: 200 });
  const w = kit.world.adapter(game);
  assert.equal(w.active(s), true);
  const p = w.player(s), [e] = w.enemies(s);
  assert.equal(p.facing.x, 1); assert.ok(e.x > p.x && e.hittable && e.radius > 0.5 && e.radius < 1.5);
  assert.equal(w.blocked(s, p.x, -0.1), true); assert.equal(w.blocked(s, p.x, 1), false);
  assert.equal(w.lives(s), 2);
  const hp = s.fighters[1].hp, points = w.defeat(s, e.id, { by: 'shot' });
  assert.ok(points > 0 && s.fighters[1].hp < hp && s.fighters[1].st === 'launch');
  const t = fight({ gap: 200 }); kit.world.adapter(t.game).stun(t.s, 1, 60);
  assert.equal(t.s.fighters[1].st, 'hit'); assert.equal(t.s.fighters[1].stun, 60);
  const render = kit.createRenderer(game, { art: {} });
  const ctx = new Proxy({ measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (o, k) => k in o ? o[k] : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
  render(ctx, s, { cssWidth: 960, cssHeight: 540, dt: 1 / 60, events: [], reducedMotion: false, paused: false, attract: false });
  assert.ok(render.view && render.view.s > 0 && Math.abs(render.view.X(p.x) - 480) < 480);
});
