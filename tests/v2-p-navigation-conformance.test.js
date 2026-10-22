// Catalogue-wide conformance for three defect classes found building the maze-chase template:
// 1. walker searches must step through stepsFrom (neighbors is topology; canMove is passability for that walker);
// 2. a position's cell is the space's cellOf (anchors differ), never floored coordinates;
// 3. "touching it defeats it" has one definition (touchDefeats: stat.fright / stat.edible), never a status name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, run, stepsFrom } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { maker, threats, isVulnerable } from '../v2/verify/drive.js';
import { stepTo } from '../v2/verify/strategies/danger-field.js';
import { touchDefeats } from '../v2/primitives/gameplay/combat-lib.js';

const LIVE = ['v2/primitives', 'v2/verify', 'v2/planner'];
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.js') ? [join(dir, d.name)] : []));
const live = LIVE.flatMap(files);

test('walker searches step through stepsFrom: no live code walks api.neighbors without the walker\'s canMove', () => {
  const bad = [];
  for (const f of live) {
    // A space implements its own topology; kernel/testing.js defines stepsFrom.
    if (/engine\/space-[^/]+\.js$/.test(f)) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => { if (/\bapi\.neighbors\(/.test(l) && !/canMove/.test(l) && !/canMove/.test(lines[i - 1] || '')) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(bad, []);
});

test('verifiers never floor coordinates into cells where the space defines cellOf', () => {
  const bad = [];
  for (const f of files('v2/verify')) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (/(cellOf|keyOf)\s*=.*Math\.floor/.test(l) && !/api\??\.cellOf/.test(l)) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  assert.deepEqual(bad, []);
});

test('no live code decides fright or prey from a status name', () => {
  const bad = [];
  for (const f of live) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (/\[\s*'frightened'|components\.status\?*\.\[?\s*'?(frightened|fright|vulnerable)/.test(l)) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  assert.deepEqual(bad, []);
});

// A walled corridor with a door only hunters pass: row 1 is open, (2,2) is a hunter door, the rest of row 2 is wall.
const board = (move = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'nav', title: 'Nav', seed: 2,
  spaces: [{ id: 'g', use: 'engine.space.grid', with: { size: [5, 4], rules: { door: { pass: ['hunter'] } } } }],
  systems: [{ use: 'gameplay.move.grid', with: move }, { use: 'gameplay.combat.health' }, { use: 'gameplay.combat.status' }],
  content: { blocks: [{ id: 'wall', solid: true }, { id: 'door', solid: true }],
    statuses: [{ id: 'frightened', duration: 30, mods: { 'stat.fright': 1 } }, { id: 'scared', duration: 30 }],
    archetypes: [{ id: 'hero', components: { health: { max: 3 } } }, { id: 'hunter', kind: 'enemy', components: { body: { layer: 'hunter' }, health: { max: 1 }, touch: { damage: 1 }, ai: { brain: [] } } }] },
  player: { archetype: 'hero', at: [0, 1] },
});
const paint = rt => { const api = rt.space('g'); for (let x = 0; x < 5; x++) api.setCell([x, 2], x === 2 ? 'door' : 'wall', rt); };

test('stepsFrom: topology filtered by each walker\'s own passability (walls, class doors)', () => {
  const { rt } = compile(board(), { primitives: PRIMITIVES });
  paint(rt);
  const api = rt.space('g'), h = rt.spawn('hunter', { at: [2, 1] }), key = cs => cs.map(c => c.join(',')).sort();
  assert.deepEqual(key(api.neighbors([2, 1])), ['1,1', '2,0', '2,2', '3,1'], 'neighbors is topology');
  assert.deepEqual(key(stepsFrom(api, rt.player(), [2, 1], rt)), ['1,1', '2,0', '3,1'], 'the player cannot enter the door or walls');
  assert.deepEqual(key(stepsFrom(api, h, [2, 1], rt)), ['1,1', '2,0', '2,2', '3,1'], 'a hunter passes its door');
});

test('cells: in lane movement the bot\'s steps land on the cell it planned (the space\'s cellOf, not floors)', () => {
  const r = compile(board({ mode: 'lane' }), { primitives: PRIMITIVES });
  const rt = maker(r.checked.doc, r.registry, r.logic)(1);
  run(rt, 2); paint(rt);
  for (const want of [[1, 1], [2, 1], [3, 1]]) {
    assert.equal(stepTo(rt, want), true, `stepped to ${want}`);
    assert.equal(rt.space('g').cellOf(rt.player()), want.join(','));
  }
});

test('fright: a status whose mods set stat.fright makes touching defeat it, for contact, bots and AI alike; a status name alone does nothing', () => {
  const { rt } = compile(board(), { primitives: PRIMITIVES });
  const scared = rt.spawn('hunter', { at: [4, 0] }), fright = rt.spawn('hunter', { at: [0, 1] });
  rt.run([{ do: 'apply_status', status: 'scared', who: scared.id }, { do: 'apply_status', status: 'frightened', who: fright.id }], {});
  assert.equal(touchDefeats(rt, scared), false); assert.equal(isVulnerable(rt, scared), false);
  assert.equal(touchDefeats(rt, fright), true); assert.equal(isVulnerable(rt, fright), true);
  assert.deepEqual(threats(rt).map(e => e.id), [scared.id], 'the frightened hunter is prey, not a threat');
  run(rt, 10);
  assert.ok(fright.components.health.dead || !rt.entity(fright.id), 'the player touching a frightened hunter defeats it');
  assert.equal(rt.player().components.health.hp, 3, 'and is not hurt by it');
});
