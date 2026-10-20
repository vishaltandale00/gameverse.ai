import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../v2/kits/creature/content.js';
import { SAMPLE_CONTENT } from '../v2/kits/creature/fixtures/sample.js';
import {
  createCreature, statsOf, expToLevel, levelForExp, effectiveness, stageMult, accMult, calcDamage, captureOdds, attemptCapture,
  bestMove, bestMatchup, startBattle, chooseAction, resolveTurn, needsInput, battleResult, expFor, evolutionOf, evolve, moveOf,
} from '../v2/kits/creature/rules/index.js';

const content = validate(SAMPLE_CONTENT).content;
const fixed = (species, level, extra = {}) => ({ uid: `${species}-${level}`, species, name: species[0].toUpperCase() + species.slice(1), level, exp: 0, ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, hp: 999, status: null, sleep: 0, moves: [], ...extra });
const withMoves = (c, ids) => { c.moves = ids.map(id => ({ id, pp: moveOf(content, id).pp, max: moveOf(content, id).pp })); c.hp = statsOf(content, c).hp; return c; };

test('stats follow the contract formula and IVs come from the RNG', () => {
  // Sproutle base hp 45, atk 49 at level 10, IV 0: hp = floor(90*10/100)+10+10 = 29; atk = floor(98*10/100)+5 = 14.
  const s = statsOf(content, fixed('sproutle', 10));
  assert.equal(s.hp, 29); assert.equal(s.atk, 14); assert.equal(s.spa, 18);
  const a = createCreature(content, 'sproutle', 5, { rng: 7 }), b = createCreature(content, 'sproutle', 5, { rng: 7 });
  assert.deepEqual(a, b, 'same seed gives the same creature');
  for (const v of Object.values(a.ivs)) assert.ok(v >= 0 && v <= 31);
  assert.deepEqual(a.moves.map(m => m.id), ['tackle', 'growl', 'vine-lash']);
  assert.equal(a.hp, statsOf(content, a).hp);
  assert.deepEqual(createCreature(content, 'sproutle', 30, { rng: 1 }).moves.map(m => m.id), ['vine-lash', 'sap-drain', 'spore-cloud', 'thorn-storm'], 'keeps the four most recent');
});

test('experience curves: fast 0.8n³, medium n³, slow 1.25n³', () => {
  assert.equal(expToLevel('medium', 10), 1000);
  assert.equal(expToLevel('fast', 10), 800);
  assert.equal(expToLevel('slow', 10), 1250);
  assert.equal(expToLevel('medium', 1), 0);
  assert.equal(levelForExp('medium', 999), 9);
  assert.equal(levelForExp('medium', 1000), 10);
  // Exp yield: floor(expYield × level / 7), ×1.5 for trainers.
  assert.equal(expFor(content, 'wild', fixed('fluffin', 7)), 50);
  assert.equal(expFor(content, 'trainer', fixed('fluffin', 7)), 75);
});

test('type chart, stat stages and the damage formula', () => {
  assert.equal(effectiveness(content, 'tide', ['stone']), 2);
  assert.equal(effectiveness(content, 'leaf', ['normal', 'gust']), 0.5);
  assert.equal(effectiveness(content, 'spark', ['stone']), 0);
  assert.equal(effectiveness(content, 'tide', ['ember', 'stone']), 4);
  assert.equal(effectiveness(content, null, ['stone']), 1);
  assert.equal(stageMult(2), 2); assert.equal(stageMult(-2), 0.5); assert.equal(stageMult(6), 4);
  assert.equal(accMult(-3), 0.5); assert.equal(accMult(3), 2);

  const att = fixed('drizzlet', 10), def = fixed('pebblit', 10);
  const move = moveOf(content, 'bubble'); // special 40, tide: STAB and 2× on stone
  // A = spa 15, D = spd 13: floor(floor(6*40*15/13)/50)+2 = floor(276/50)+2 = 7; roll 100 → 7; STAB → 10; 2× → 20.
  assert.equal(calcDamage(content, { attacker: att, defender: def, move, crit: false, roll: 100 }).damage, 20);
  assert.equal(calcDamage(content, { attacker: att, defender: def, move, crit: true, roll: 100 }).damage, 30);
  assert.equal(calcDamage(content, { attacker: att, defender: def, move, crit: false, roll: 85 }).damage, 14);
  // Stages scale the attacking stat; burn halves physical damage only.
  assert.ok(calcDamage(content, { attacker: att, defender: def, move, attStages: { spa: 2 }, crit: false, roll: 100 }).damage > 30);
  const tackle = moveOf(content, 'tackle');
  const plain = calcDamage(content, { attacker: att, defender: fixed('fluffin', 10), move: tackle, crit: false, roll: 100 }).damage;
  const burned = calcDamage(content, { attacker: { ...att, status: 'burn' }, defender: fixed('fluffin', 10), move: tackle, crit: false, roll: 100 }).damage;
  assert.equal(burned, Math.max(1, Math.floor(plain / 2)));
  assert.equal(calcDamage(content, { attacker: fixed('voltmouse', 10), defender: def, move: moveOf(content, 'zap'), crit: false, roll: 100 }).damage, 0, 'immune');
});

test('capture odds rise as health falls and with status; shakes are reported', () => {
  const foe = fixed('fluffin', 5); foe.hp = statsOf(content, foe).hp;
  const full = captureOdds(content, foe, 1);
  const low = captureOdds(content, { ...foe, hp: 1 }, 1);
  const asleep = captureOdds(content, { ...foe, status: 'sleep' }, 1);
  assert.ok(low.a > full.a && asleep.a > full.a);
  // a = (3M − 2H) × rate × ball / 3M: full health → rate/3 = 85 for catchRate 255.
  assert.equal(full.a, 85);
  assert.equal(captureOdds(content, { ...foe, hp: 1 }, 1.5).a >= 255, true, 'guaranteed');
  assert.deepEqual(attemptCapture(content, { ...foe, hp: 1 }, 2, { rng: 1 }), { shakes: 4, success: true });
  const hard = fixed('sproutle', 5); hard.hp = statsOf(content, hard).hp;
  const tries = Array.from({ length: 200 }, (_, i) => attemptCapture(content, hard, 1, { rng: i + 1 }));
  const rate = tries.filter(t => t.success).length / tries.length;
  assert.ok(Math.abs(rate - captureOdds(content, hard, 1).probability) < 0.08, `observed ${rate}`);
  assert.ok(tries.some(t => !t.success && t.shakes > 0), 'failed throws can shake');
});

test('turn order: priority first, then speed; paralysis halves speed', () => {
  const slow = withMoves(fixed('pebblit', 20), ['tackle']), fast = withMoves(fixed('voltmouse', 20), ['quick-jab', 'zap']);
  const b = startBattle(content, { kind: 'trainer', player: [slow], foe: [fast], foeTrainer: { name: 'T', prize: 10 }, rng: { rng: 1 } });
  chooseAction(b, { kind: 'move', index: 0 });
  const { events } = resolveTurn(content, b, { rng: 3 });
  assert.match(events.find(e => e.type === 'move').text, /^Foe Voltmouse/);
  // Priority move goes first even when slower.
  const quick = withMoves(fixed('fluffin', 20), ['quick-jab']), speedy = withMoves(fixed('voltmouse', 30), ['zap']);
  const b2 = startBattle(content, { kind: 'trainer', player: [quick], foe: [speedy], foeTrainer: { name: 'T', prize: 10 }, rng: { rng: 1 } });
  chooseAction(b2, { kind: 'move', index: 0 });
  assert.match(resolveTurn(content, b2, { rng: 5 }).events.find(e => e.type === 'move').text, /^Fluffin used Quick Jab/);
});

test('statuses: poison ticks 1/8, sleep blocks moves, burn ticks 1/16', () => {
  const me = withMoves(fixed('pebblit', 20), ['harden']), foe = withMoves(fixed('fluffin', 20), ['growl']);
  me.status = 'poison';
  const max = statsOf(content, me).hp;
  const b = startBattle(content, { kind: 'trainer', player: [me], foe: [foe], foeTrainer: { name: 'T', prize: 1 }, rng: { rng: 1 } });
  chooseAction(b, { kind: 'move', index: 0 });
  const ev = resolveTurn(content, b, { rng: 2 }).events.find(e => e.cause === 'poison');
  assert.equal(ev.amount, Math.floor(max / 8));
  foe.status = 'sleep'; foe.sleep = 3;
  chooseAction(b, { kind: 'move', index: 0 });
  assert.ok(resolveTurn(content, b, { rng: 4 }).events.some(e => e.status === 'sleep' && e.blocked));
  me.status = 'burn';
  chooseAction(b, { kind: 'move', index: 0 });
  assert.equal(resolveTurn(content, b, { rng: 6 }).events.find(e => e.cause === 'burn').amount, Math.floor(max / 16));
});

test('escape always succeeds when faster; trainers forbid running', () => {
  const me = withMoves(fixed('voltmouse', 20), ['zap']), foe = withMoves(fixed('pebblit', 5), ['tackle']);
  const b = startBattle(content, { kind: 'wild', player: [me], foe: [foe], rng: { rng: 1 } });
  chooseAction(b, { kind: 'run' });
  resolveTurn(content, b, { rng: 1 });
  assert.equal(battleResult(b).outcome, 'run');
  const t = startBattle(content, { kind: 'trainer', player: [withMoves(fixed('voltmouse', 20), ['zap'])], foe: [withMoves(fixed('pebblit', 5), ['tackle'])], foeTrainer: { name: 'T' }, rng: { rng: 1 } });
  assert.equal(chooseAction(t, { kind: 'run' }).ok, false);
});

test('AI picks the best expected damage, useful status moves, and the best matchup after a faint', () => {
  const foe = withMoves(fixed('pebblit', 12), ['pebble-toss']);
  const me = { party: [withMoves(fixed('drizzlet', 12), ['tackle', 'growl', 'bubble', 'harden'])], active: 0, stages: {}, vol: { confusion: 0 } };
  const them = { party: [foe], active: 0, stages: {}, vol: { confusion: 0 } };
  assert.equal(bestMove(content, me, them), 2, 'Bubble: STAB and super effective');
  const sleeper = { party: [withMoves(fixed('sproutle', 15), ['tackle', 'spore-cloud'])], active: 0, stages: {}, vol: { confusion: 0 } };
  const target = { party: [withMoves(fixed('fluffin', 15), ['tackle'])], active: 0, stages: {}, vol: { confusion: 0 } };
  assert.equal(bestMove(content, sleeper, target), 1, 'sleep first');
  target.party[0].status = 'sleep';
  assert.equal(bestMove(content, sleeper, target), 0, 'no repeat of an applied status');
  const party = [withMoves(fixed('emberpup', 12), ['cinder']), withMoves(fixed('drizzlet', 12), ['bubble'])];
  assert.equal(bestMatchup(content, party, withMoves(fixed('blazehound', 12), ['cinder'])), 1);
});

test('a trainer battle awards experience, levels up, learns moves and pays the prize', () => {
  const me = createCreature(content, 'sproutle', 8, { rng: 11 });
  me.exp = expToLevel('medium', 9) - 10;
  const before = me.level;
  const foe = [createCreature(content, 'fluffin', 9, { rng: 12 })];
  const rng = { rng: 99 };
  const b = startBattle(content, { kind: 'trainer', player: [me], foe, foeTrainer: { name: 'Tim', prize: 120 }, rng });
  const all = [];
  for (let i = 0; i < 40 && !battleResult(b); i++) {
    const need = needsInput(b);
    if (need?.kind === 'learn') { all.push(...chooseAction(b, { kind: 'learn', forget: 1 }).events); continue; }
    chooseAction(b, { kind: 'move', index: bestMove(content, b.player, b.foe) });
    all.push(...resolveTurn(content, b, rng).events);
  }
  const r = battleResult(b);
  assert.equal(r.outcome, 'win');
  assert.equal(r.money, 120);
  assert.ok(all.some(e => e.type === 'exp'));
  assert.ok(me.level > before, 'leveled');
  assert.ok(me.moves.some(m => m.id === 'sap-drain'), 'learned Sap Drain at 9');
  const lvl = all.find(e => e.type === 'levelup');
  assert.ok(lvl.after.hp > lvl.before.hp);
});

test('evolution keeps the damage taken and follows the species name', () => {
  const c = createCreature(content, 'sproutle', 16, { rng: 3 });
  c.hp -= 10;
  assert.equal(evolutionOf(content, c), 'bramblet');
  evolve(content, c, 'bramblet');
  assert.equal(c.name, 'Bramblet');
  assert.equal(c.hp, statsOf(content, c).hp - 10);
  assert.equal(evolutionOf(content, createCreature(content, 'sproutle', 15, { rng: 3 })), null);
});

test('battles are deterministic for the same RNG state', () => {
  const run = seed => {
    const rng = { rng: seed };
    const b = startBattle(content, { kind: 'wild', player: [createCreature(content, 'emberpup', 10, rng)], foe: [createCreature(content, 'chirpip', 9, rng)], rng });
    const log = [];
    for (let i = 0; i < 30 && !battleResult(b); i++) { chooseAction(b, { kind: 'move', index: 0 }); log.push(...resolveTurn(content, b, rng).events.map(e => e.text || e.type)); }
    return JSON.stringify({ log, b });
  };
  assert.equal(run(5), run(5));
  assert.notEqual(run(5), run(6));
});
