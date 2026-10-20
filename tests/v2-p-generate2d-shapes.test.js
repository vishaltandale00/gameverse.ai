import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace, run, bodyBox } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import shapes, { layout, groupPoints, sealedCells } from '../v2/primitives/engine/generate-layout-shapes.js';
import { withDefaults, stream } from '../v2/primitives/engine/generate2d-lib.js';

const ALL = [...PRIMITIVES, testSpace];
const KEY = 'spaces.board.generators[0]';
const PEGS = [{ shape: 'arc', x: 50, y: 40, size: 25, count: 16, span: 160, angle: 90 }, { shape: 'circle', x: 30, y: 80, size: 8, count: 10 }, { shape: 'grid', x: 70, y: 85, size: 24, count: 18 }, { shape: 'spiral', x: 50, y: 100, size: 10, count: 9, span: 540 }, { shape: 'wave', x: 50, y: 60, size: 70, count: 12, span: 720, bricks: true }];
const doc = ({ space = 'engine.space.test', groups = PEGS, w = {}, seed = 3 } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'shapes', title: 'Shapes', seed,
  spaces: [{ id: 'board', use: space, with: space === 'engine.space.test' ? { size: [64, 64, 1] } : { size: [30, 30] }, generators: [{ use: 'engine.generate.layout.shapes', with: { groups, scale: 0.2, yDown: true, origin: [0, 26], minSpacing: 2.6, roles: [{ role: 'orange', fraction: 0.25 }, { role: 'green', count: 2 }], ...w } }] }],
  content: { archetypes: [{ id: 'hero', components: {} }, { id: 'piece', components: {} }] },
  player: { archetype: 'hero', at: [1, 1] },
});

test('layout.shapes: peg groups are placed by shape, crowding pegs skipped, roles dealt by the seed', () => {
  const { rt } = compile(doc(), { primitives: ALL });
  run(rt, 1);
  const st = rt.store(KEY), pieces = rt.query('piece');
  assert.deepEqual(st.problems, []);
  assert.equal(pieces.length + st.skipped, PEGS.reduce((n, g) => n + g.count, 0));
  assert.equal(st.roles.orange, Math.round(pieces.length / 4));
  assert.equal(st.roles.green, 2);
  assert.equal(rt.service('layout').byRole('green').length, 2);
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    const a = pieces[i].components.piece.center, b = pieces[j].components.piece.center;
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= 2.6 * 0.2 - 1e-9, 'no two pieces crowd each other');
  }
  assert.ok(pieces.some(p => p.components.piece.shape === 'box' && p.components.piece.ang !== 0), 'brick waves follow the tangent');
  // Arc points sit on their circle.
  for (const p of groupPoints({ ...PEGS[0], pieceSize: [0.44, 0.44] })) assert.ok(Math.abs(Math.hypot(p.x - 50, p.y - 40) - 25) < 1e-9);
});

test('layout.shapes: brick pictures report bricks sealed in by unbreakable ones', () => {
  assert.deepEqual(sealedCells(['nnn', 'mmm'], new Set(['m'])), [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(sealedCells(['nnn', 'm.m'], new Set(['m'])), []);
  const { rt } = compile(doc({ groups: [{ shape: 'rows', x: 2, y: 2, pieceSize: [1, 0.5], rows: ['n2x.', 'mmmm', 'ssns'] }], w: { roles: [], yDown: false, scale: 1, origin: [0, 0] } }), { primitives: ALL });
  const st = rt.store(KEY), bricks = rt.query('piece');
  assert.deepEqual(st.problems.map(p => p.code), ['piece_sealed', 'piece_sealed', 'piece_sealed']);
  assert.equal(st.problems[0].path, 'spaces[0].generators[0].with.groups[0].rows[0]', 'paths point into the document');
  assert.equal(bricks.find(b => b.components.piece.kind === 'brick' && b.components.piece.hp === 2) !== undefined, true, 'digits are hit points');
  assert.equal(bricks.filter(b => b.components.piece.kind === 'unbreakable').length, 4);
});

test('layout.shapes: structures stand on the ground or each other, never overlap', () => {
  const cfg = groups => withDefaults(shapes.card, { groups });
  const ok = layout(cfg([{ shape: 'tower', x: 20, y: 0, count: 3, size: 3, pieceSize: [0.3, 2], material: 'wood' }, { shape: 'pyramid', x: 30, y: 0, count: 3, pieceSize: [1, 1], material: 'stone' }]), stream(1));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.pieces.length, 9 + 6);
  assert.ok(ok.pieces.every(p => p.hp > 0), 'materials give hit points');
  const bad = layout(cfg([{ shape: 'pieces', pieces: [{ x: 10, y: 0, w: 2, h: 1 }, { x: 10.5, y: 0.5, w: 2, h: 1 }, { x: 30, y: 4, w: 1, h: 1 }, { x: 40, y: 0, w: 4, h: 1, material: 'rock' }] }]), stream(1));
  assert.deepEqual(bad.problems.map(p => p.code).sort(), ['piece_overlap', 'piece_unsupported', 'piece_unsupported']);
});

test('layout.shapes: on a centre-anchored space bodies land where the layout says', () => {
  const { rt } = compile(doc({ space: 'engine.space.arena2d' }), { primitives: ALL });
  const api = rt.space('board');
  assert.equal(api.anchor, 'center');
  for (const p of rt.query('piece')) { const box = bodyBox(p, api), c = p.components.piece.center; assert.ok(Math.abs((box.min[0] + box.max[0]) / 2 - c[0]) < 1e-9 && Math.abs((box.min[1] + box.max[1]) / 2 - c[1]) < 1e-9); }
});

test('layout.shapes: same seed replays exactly; another seed deals roles differently', () => {
  const a = compile(doc(), { primitives: ALL }).rt, b = compile(doc(), { primitives: ALL }).rt, c = compile(doc({ seed: 11 }), { primitives: ALL }).rt;
  run(a, 3); run(b, 3); run(c, 3);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.notDeepEqual(a.service('layout').byRole('orange'), c.service('layout').byRole('orange'));
});

test('layout.shapes: preflight rejects bad configs with stable codes', () => {
  const r = new Registry(ALL), logic = buildLogic(r, Logic), codes = d => preflight(d, r, logic).errors.map(e => e.code);
  assert.ok(codes(doc({ groups: [{ shape: 'rows' }] })).includes('shape_data_missing'));
  assert.ok(codes(doc({ groups: [{ shape: 'stack', material: 'jelly' }] })).includes('material_unknown'));
  assert.ok(codes(doc({ w: { roles: [{ role: 'a', fraction: 0.7 }, { role: 'b', fraction: 0.6 }] } })).includes('roles_overfull'));
  assert.ok(codes(doc({ groups: [{ shape: 'hexagon' }] })).includes('param_option'));
});
