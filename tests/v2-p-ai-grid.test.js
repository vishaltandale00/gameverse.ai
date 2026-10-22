// AI on the real grid space (engine.space.grid): maze ghosts with wrap tunnels,
// class doors, one-way cells and tunnel slowdown from the space's cell rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
import AI from '../v2/primitives/gameplay/ai.index.js';

const painter = { id: 'engine.generate.aiboard', card: { ambient: true, intent: 'test board painter', params: { rows: { type: 'list', of: { type: 'string' }, default: [] }, legend: { type: 'object', open: true, default: {} } } },
  install(rt, cfg, inst) { const H = cfg.rows.length; rt.space(inst.space).bake(cfg.rows.flatMap((line, i) => [...line].map((ch, x) => ({ at: [x, H - 1 - i], block: cfg.legend[ch] ?? null })).filter(c => c.block)), rt); } };
const P = [...spaces2d, painter, ...AI];
// Top line = highest row (grid yAxis up). House (4,1) behind a ghost-only door (4,2); tunnel row 3 wraps; no-up tile at (2,4).
const MAZE = ['#########', '#.......#', '#.u.....#', 'tt.....tt', '#..#d#..#', '#..#.#..#', '#########'];
const doc = (ghost, player = [1, 5], brain = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'maze', title: 'Maze', seed: 5,
  spaces: [{ id: 'board', use: 'engine.space.grid', with: { size: [9, 7], wrap: 'x', rules: { door: { pass: ['ghost'] }, noup: { noExit: ['up'], appliesTo: ['ghost'] }, tunnel: { speed: 0.5, appliesTo: ['ghost'] } } },
    generators: [{ use: 'engine.generate.aiboard', with: { rows: MAZE, legend: { '#': 'wall', d: 'door', t: 'tunnel', u: 'noup' } } }] }],
  systems: [{ use: 'gameplay.ai.brain', with: { tick: 0.05, ...brain } }],
  content: { blocks: [{ id: 'wall', solid: true }, { id: 'door', solid: true }, { id: 'tunnel', solid: false }, { id: 'noup', solid: false }],
    archetypes: [{ id: 'pac', components: {} }, { id: 'ghost', kind: 'enemy', components: { body: { layer: 'ghost' }, ai: { brain: [{ do: 'target-tile', ...ghost }], speed: 4 } } }] },
  player: { archetype: 'pac', at: player },
});

test('grid ghosts leave the house through a class door and the player cannot follow', () => {
  const { rt } = compile(doc({ personality: 'chaser', scatter: [8, 6] }), { primitives: P });
  const g = rt.spawn('ghost', { at: [4, 1] });
  run(rt, 60);
  assert.ok(g.at[1] >= 3, `ghost came out through the door: ${g.at}`);
  assert.equal(rt.space('board').canMove(rt.player(), [4, 2], rt), false);
});

test('wrap tunnels: a ghost crosses the seam, slowed by the tunnel rule', () => {
  const { rt } = compile(doc({ personality: 'chaser', scatter: [-3, 3], aim: 'fixed' }, [6, 5]), { primitives: P });
  const g = rt.spawn('ghost', { at: [1, 3] });
  const xs = [];
  for (let i = 0; i < 60; i++) { rt.step(); xs.push(g.at[0]); }
  assert.ok(xs.some(x => x > 7), `wrapped to the far side: ${xs.slice(0, 60).map(x => x.toFixed(2)).join(' ')}`);
  // In tunnel cells (x 0,1 and 7,8) a ghost moves at half speed: 2 cells/s instead of 4.
  const { rt: r2 } = compile(doc({ personality: 'chaser', aim: 'fixed', scatter: [-3, 3] }, [6, 5]), { primitives: P });
  const g2 = r2.spawn('ghost', { at: [1, 3] }); run(r2, 2);
  const x0 = g2.at[0]; run(r2, 6);
  assert.ok(Math.abs((x0 - g2.at[0]) - 2 * 6 / 60) < 0.02, `tunnel speed ${(x0 - g2.at[0]) * 10}`);
});

test('one-way cells: no upward turn out of a no-up tile unless frightened (stat.fright: touching it defeats it)', () => {
  // From (2,4) heading right toward a target straight up-left: up is barred, so the ghost keeps going.
  const { rt } = compile(doc({ aim: 'fixed', scatter: [2, 9] }), { primitives: P });
  const g = rt.spawn('ghost', { at: [2, 4] });
  run(rt, 4);
  const a = rt.state.prim['gameplay.ai.brain'].agents[g.id];
  assert.notEqual(a.dir, 0, 'did not turn up out of the no-up tile');
  const { rt: r2 } = compile(doc({ aim: 'fixed', scatter: [2, 9] }), { primitives: P });
  const g2 = r2.spawn('ghost', { at: [2, 4], components: { stats: { 'stat.fright': 1 } } });
  run(r2, 30);
  assert.ok(r2.state.prim['gameplay.ai.brain'].agents[g2.id].dir >= 0, 'frightened ghosts wander (random turns)');
});

test('ambusher aims four cells ahead of the player\'s movement direction', () => {
  const { rt } = compile(doc({ personality: 'ambusher', scatter: [8, 6] }, [3, 5]), { primitives: P });
  const g = rt.spawn('ghost', { at: [6, 3] });
  const api = rt.space('board');
  // The player walks right along row 5.
  api.setPos(rt.player(), [3, 5], rt); rt.step(); api.setPos(rt.player(), [4, 5], rt); run(rt, 3);
  const a = rt.state.prim['gameplay.ai.brain'].agents[g.id];
  assert.deepEqual(a.tile.slice(0, 2), [8, 5], 'player (4,5) heading right → target (8,5)');
  void g;
});

test('grid ghosts replay deterministically', () => {
  const make = () => { const { rt } = compile(doc({ personality: 'vector', scatter: [8, 0] }, [1, 5], { modeSchedule: { table: [[0.5, 1, 0.5, -1]] } }), { primitives: P }); rt.spawn('ghost', { at: [4, 1] }); rt.spawn('ghost', { at: [1, 3] }); return rt; };
  const a = make(), b = make(); run(a, 240); run(b, 240);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('grid navigation inside a read (entity obstacles indexed once per read) answers as outside one', () => {
  const { rt } = compile(doc({ personality: 'chaser', scatter: [8, 6] }), { primitives: P });
  const crate = rt.spawn('pac', { at: [2, 5], components: { body: { solid: true } } });
  const api = rt.space('board'), p = rt.player();
  const moves = () => [[2, 5], [1, 4], [1, 6]].map(c => api.canMove(p, c, rt));
  const outside = moves();
  assert.equal(outside[0], false, 'the solid crate blocks its cell');
  assert.deepEqual(rt.read(moves), outside);
  api.setPos(crate, [3, 5], rt); rt.step();
  assert.equal(rt.read(() => api.canMove(p, [2, 5], rt)), true, 'a read after the crate moved sees where it is now');
  assert.equal(api.canMove(p, [2, 5], rt), true);
});
