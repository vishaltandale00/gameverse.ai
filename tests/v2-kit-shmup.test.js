import test from 'node:test';
import assert from 'node:assert/strict';
import kit from '../v2/kits/shmup/index.js';
import { SAMPLE, validate } from '../v2/kits/shmup/content.js';
import { TIMING } from '../v2/kits/shmup/game.js';
import { botInput } from '../v2/kits/shmup/verify.js';

const IDLE = { x: 0, y: 0, a: false, b: false };
const base = () => structuredClone(SAMPLE);
const make = (patch = c => c, seed = 3) => { const c = patch(base()); const v = validate(c); assert.ok(v.ok, JSON.stringify(v.errors)); const g = kit.createGame(v.content, { seed }); return { g, s: g.createState(), c: v.content }; };
const run = (g, s, n, inp = IDLE) => { const ev = []; for (let i = 0; i < n && s.status === 'playing'; i++) { g.step(s, typeof inp === 'function' ? inp(i, s) : inp); ev.push(...s.events); } return ev; };
const toPlay = (g, s) => run(g, s, TIMING.intro + 1);
const stage = st => c => { c.stages = [{ name: 'Test', mode: 'vertical', intro: '', shields: false, march: false, rocks: 0, boss: '', waves: [], ...st }]; return c; };
const shootAt = (s, e) => s.pbullets.push({ x: e.x, y: e.y, vx: 0, vy: 0, dmg: 1, r: 3, k: 'shot', life: 5 });
const untilEnemy = (g, s, pred = () => true, max = 600) => { for (let i = 0; i < max; i++) { g.step(s, IDLE); const e = s.enemies.find(pred); if (e) return e; } return null; };

test('the sample validates, the schema is strict-mode shaped, and the kit has the contract shape', () => {
  const v = validate(SAMPLE);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.warnings, []);
  const walk = (node, path) => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
      for (const [k, p] of Object.entries(node.properties)) walk(p, `${path}.${k}`);
    } else if (node.type === 'array') walk(node.items, `${path}[]`);
    for (const bad of ['oneOf', 'anyOf', 'minimum', 'maximum', 'minItems', 'maxItems']) assert.ok(!(bad in node), `${path} uses ${bad}`);
  };
  walk(kit.content.schema, '$');
  for (const key of ['id', 'name', 'version', 'summary', 'examples', 'validate', 'cast', 'createGame', 'createRenderer', 'verify', 'controls']) assert.ok(kit[key], key);
  const { brief, entities } = kit.cast(v.content);
  assert.equal(brief.player.name, 'Vela Quill');
  assert.ok(entities.player.tags.includes('player') && entities.enemy.tags.includes('enemy'));
});

test('validation reports broken references and clamps numbers', () => {
  const c = base();
  c.stages[0].waves[0].enemy = 'nobody'; c.stages[1].boss = 'ghost'; c.enemies[0].hp = 999; c.stages.push({ name: 'Void', mode: 'twinstick', intro: '', shields: false, march: false, rocks: 0, boss: '', waves: [] });
  const v = validate(c);
  assert.equal(v.ok, false);
  const codes = v.errors.map(e => e.code);
  for (const code of ['unknown_enemy', 'unknown_boss', 'empty_stage']) assert.ok(codes.includes(code), code);
  assert.ok(v.errors.every(e => e.path && e.message));
  assert.equal(v.content.enemies[0].hp, 40);
  assert.ok(v.warnings.some(w => w.code === 'clamped'));
});

test('the same seed and inputs give the same final state, and state is plain JSON', () => {
  const script = (i) => ({ x: Math.sign(Math.sin(i / 37)), y: Math.sign(Math.cos(i / 53)), a: i % 90 < 70, b: i === 700 });
  const finals = [1, 2].map(() => { const { g, s } = make(c => c, 11); run(g, s, 1500, script); return s; });
  assert.deepEqual(finals[0], finals[1]);
  assert.deepEqual(structuredClone(finals[0]), JSON.parse(JSON.stringify(finals[0])));
  const other = make(c => c, 12); run(other.g, other.s, 1500, script);
  assert.notDeepEqual(other.s.enemies.map(e => [e.x, e.y]), finals[0].enemies.map(e => [e.x, e.y]));
});

test('the bot verifies the sample inside the budget', () => {
  const r = kit.verify(SAMPLE, { seed: 1, budgetMs: 2000 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.report.bot.cleared, true);
  assert.ok(r.report.bot.killPct >= 80, `kills ${r.report.bot.killPct}%`);
  assert.ok(r.report.ms < 2000);
  assert.ok(r.report.waves.every(w => w.spawned >= w.expected && w.seen >= w.spawned * 0.9));
  // A boss nobody can beat in time fails the structural check.
  const tough = base(); tough.player.fireRate = 3; tough.bosses[0].hp = 3000;
  const v = validate(tough); assert.ok(v.content.bosses[0].hp <= 3 * 0.5 * 80, 'validate lowers an unbeatable boss');
});

test('fixed mode: waves fly in to a swaying formation, then dive along curved paths', () => {
  const { g, s } = make();
  toPlay(g, s);
  const xs = new Set();
  let formation = 0, dove = false, diveDepth = 0;
  for (let i = 0; i < 900; i++) {
    g.step(s, IDLE);
    xs.add(Math.round(s.formation.x));
    formation = Math.max(formation, s.enemies.filter(e => e.st === 'formation').length);
    for (const e of s.enemies) if (e.st === 'dive') { dove = true; diveDepth = Math.max(diveDepth, e.y); }
  }
  assert.ok(formation >= 20, `formation held ${formation}`);
  assert.ok(xs.size > 20, 'formation sways');
  assert.ok(dove && diveDepth > s.H * 0.6, 'divers reach the ship row');
  assert.ok(s.bunkers.length === 4 && s.bunkers.some(b => b.cells.includes(0)), 'bunkers erode');
});

test('fixed mode with march: the formation steps sideways and descends at the edges', () => {
  const { g, s } = make(c => { c.stages[0].march = true; c.stages[0].shields = false; return c; });
  toPlay(g, s);
  const y0 = s.formation.y;
  const ev = run(g, s, 1500, (i, st) => { st.player.invuln = 999; return IDLE; });
  assert.ok(s.formation.y > y0, 'descended');
  assert.ok(ev.filter(e => e.name === 'march').length > 30);
});

test('vertical mode: boss warning, entry, phase changes at hp thresholds, ring pattern', () => {
  const { g, s } = make((c => { stage({ boss: 'bloom' })(c); c.bosses[0].phases = [{ pattern: 'ring', move: 'hover', rate: 1 }, { pattern: 'spiral', move: 'sweep', rate: 1 }]; return c; }));
  const ev = run(g, s, TIMING.intro + 5);
  assert.ok(ev.some(e => e.name === 'boss_warning'));
  run(g, s, TIMING.warn + 200);
  assert.equal(s.boss.st, 'fight');
  s.ebullets = []; s.boss.fireCd = 1; s.player.invuln = 999;
  g.step(s, IDLE);
  assert.equal(s.ebullets.length, 18);
  const angs = s.ebullets.map(b => Math.atan2(b.vy, b.vx)).sort((a, b) => a - b);
  for (let i = 1; i < angs.length; i++) assert.ok(Math.abs(angs[i] - angs[i - 1] - Math.PI * 2 / 18) < 1e-6);
  s.boss.hp = s.boss.maxHp * 0.45;
  const ph = run(g, s, 2);
  assert.ok(ph.some(e => e.name === 'boss_phase' && e.phase === 1));
  assert.equal(s.ebullets.length, 0, 'phase change cancels bullets');
  s.boss.hp = 0.5; s.boss.invuln = 0; shootAt(s, s.boss);
  const end = run(g, s, 200);
  assert.ok(end.some(e => e.name === 'boss_defeated') && end.some(e => e.name === 'stage_clear'));
});

test('twinstick: splitters split, black holes pull, snake tails block, fire auto-aims', () => {
  const { g, s } = make(stage({ mode: 'twinstick', waves: [{ at: 0, enemy: 'shard', count: 1, entry: 'portal' }, { at: 0, enemy: 'coil', count: 1, entry: 'edges' }, { at: 0, enemy: 'maw', count: 1, entry: 'portal' }] }));
  toPlay(g, s);
  run(g, s, 60);
  s.player.invuln = 9999;
  const shard = s.enemies.find(e => e.type === 'shard'), coil = s.enemies.find(e => e.type === 'coil'), maw = s.enemies.find(e => e.type === 'maw');
  assert.ok(shard && coil && maw);
  shard.hp = 0.5; shootAt(s, shard);
  const ev = run(g, s, 1);
  assert.ok(ev.some(e => e.name === 'split'));
  assert.equal(s.enemies.filter(e => e.mini && e.type === 'shard').length, 3);
  const hp = coil.hp; s.pbullets.push({ x: coil.segs[18], y: coil.segs[19], vx: 0, vy: 0, dmg: 1, r: 3, k: 'shot', life: 5 });
  assert.ok(run(g, s, 1).some(e => e.name === 'block'));
  assert.equal(coil.hp, hp);
  s.player.x = maw.x + 100; s.player.y = maw.y; s.enemies = [maw];
  const d0 = Math.hypot(s.player.x - maw.x, s.player.y - maw.y);
  run(g, s, 20);
  assert.ok(Math.hypot(s.player.x - maw.x, s.player.y - maw.y) < d0 - 5, 'pulled in');
  s.player.x = maw.x - 120; s.player.y = maw.y; s.pbullets = [];
  run(g, s, 12, { x: 0, y: 0, a: true, b: false });
  const b = s.pbullets[0];
  assert.ok(b && b.vx > 0 && Math.abs(b.vy) < Math.abs(b.vx), 'shots fly at the nearest enemy');
});

test('asteroids: inertia, wraparound and rocks that split twice', () => {
  const { g, s } = make(stage({ mode: 'asteroids', rocks: 1 }));
  toPlay(g, s);
  s.player.invuln = 9999;
  run(g, s, 20, { x: 0, y: -1, a: false, b: false });
  const v = Math.hypot(s.player.vx, s.player.vy);
  run(g, s, 20);
  assert.ok(v > 50 && Math.hypot(s.player.vx, s.player.vy) > v * 0.7, 'keeps drifting after thrust');
  s.player.x = s.W - 1; s.player.vx = 200; s.player.vy = 0;
  run(g, s, 2);
  assert.ok(s.player.x < 20, 'wrapped');
  const rock = s.enemies.find(e => e.mv === 'rock' && e.tier === 3);
  rock.hp = 0.5; shootAt(s, rock); run(g, s, 1);
  const mids = s.enemies.filter(e => e.tier === 2);
  assert.equal(mids.length, 2);
  mids[0].hp = 0.5; shootAt(s, mids[0]); run(g, s, 1);
  assert.equal(s.enemies.filter(e => e.tier === 1).length, 2);
  s.player.x = 50; s.player.y = 50; s.player.hyperCd = 0;
  const ev = run(g, s, 1, { x: 0, y: 1, a: false, b: false });
  assert.ok(ev.some(e => e.name === 'hyperspace'));
});

test('power-ups tier weapons; bombs clear bullets; shields absorb; respawn grants invulnerability', () => {
  const { g, s } = make(stage({ waves: [{ at: 30, enemy: 'dart', count: 1, entry: 'rain' }] }));
  toPlay(g, s);
  const p = s.player;
  for (const [tier, n] of [[1, 3], [2, 5], [3, 7]]) {
    s.pickups.push({ id: 900 + tier, x: p.x, y: p.y, vx: 0, vy: 0, kind: 'spread', t: 0 });
    const ev = run(g, s, 1);
    assert.ok(ev.some(e => e.name === 'power' && e.tier === tier));
    s.pbullets = []; p.fireCd = 0;
    run(g, s, 1, { x: 0, y: 0, a: true, b: false });
    assert.equal(s.pbullets.length, n, `spread tier ${tier}`);
  }
  for (let i = 0; i < 10; i++) s.ebullets.push({ x: 20 + i * 20, y: 100, vx: 0, vy: 0, r: 3, k: 'orb', src: 'dart', life: 0 });
  const bombs = s.bombs;
  const ev = run(g, s, 2, { x: 0, y: 0, a: false, b: true });
  assert.ok(ev.some(e => e.name === 'bomb') && ev.some(e => e.name === 'cancel'));
  assert.equal(s.ebullets.length, 0); assert.equal(s.bombs, bombs - 1);
  run(g, s, 100);
  p.invuln = 0; p.shield = true; const lives = s.lives;
  s.ebullets.push({ x: p.x, y: p.y, vx: 0, vy: 0, r: 3, k: 'orb', src: 'dart', life: 0 });
  assert.ok(run(g, s, 1).some(e => e.name === 'shield_break'));
  assert.equal(s.lives, lives); assert.equal(p.shield, false);
  run(g, s, 70);
  s.ebullets.push({ x: s.player.x, y: s.player.y, vx: 0, vy: 0, r: 3, k: 'orb', src: 'dart', life: 0 });
  const hurt = run(g, s, 1);
  assert.ok(hurt.some(e => e.name === 'hurt')); assert.equal(s.lives, lives - 1);
  assert.equal(s.weapon.tier, 2, 'dying costs a weapon tier');
  const back = run(g, s, TIMING.respawn + 12);
  assert.ok(back.some(e => e.name === 'respawn') && s.player.invuln > 0);
  s.ebullets.push({ x: s.player.x, y: s.player.y, vx: 0, vy: 0, r: 3, k: 'orb', src: 'dart', life: 0 });
  run(g, s, 1);
  assert.equal(s.lives, lives - 1, 'invulnerable after respawn');
});

test('chains raise the multiplier, extra ships come at thresholds, and the run ends', () => {
  const { g, s } = make(c => { stage({ waves: [{ at: 0, enemy: 'lantern', count: 8, entry: 'top-line' }] })(c); c.extraLifeEvery = 5000; c.player.lives = 1; return c; });
  toPlay(g, s);
  run(g, s, 60);
  s.player.invuln = 9999; s.score = 4990;
  const lives = s.lives;
  let ev = [];
  for (const e of s.enemies.slice(0, 7)) { e.hp = 0.5; shootAt(s, e); ev.push(...run(g, s, 1)); }
  assert.ok(s.chain >= 7 && ev.filter(e => e.name === 'defeated').some(e => e.mult >= 2), 'multiplier grows with the chain');
  assert.ok(ev.some(e => e.name === 'extra_life')); assert.equal(s.lives, lives + 1);
  run(g, s, 101);
  assert.equal(s.chain, 0, 'chain breaks after a pause');
  s.lives = 1; s.player.invuln = 0; s.player.shield = false;
  s.ebullets.push({ x: s.player.x, y: s.player.y, vx: 0, vy: 0, r: 3, k: 'orb', src: 'lantern', life: 0 });
  ev = run(g, s, 1);
  assert.equal(s.status, 'lost'); assert.match(s.reason, /Shot down by Lantern Pod/);
  assert.ok(ev.some(e => e.name === 'lost'));
});

test('the bot wins a one-stage game', () => {
  const { g, s } = make(stage({ waves: [{ at: 0, enemy: 'dart', count: 4, entry: 'top-line' }] }));
  for (let i = 0; i < 4000 && s.status === 'playing'; i++) g.step(s, botInput(s, g));
  assert.equal(s.status, 'won');
  assert.ok(s.clear.bonus >= 1000);
});
