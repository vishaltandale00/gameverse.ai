// Verb targeting follows the view (ARCHITECTURE.md §6.3): a verb that acts on a cell without naming one acts on the
// cell the player faces when the world is seen from above or behind, and below the feet only in a side view, from the
// space's declared frame (card.frame) and the document's view. Every space card declares its frame; every primitive
// that targets a cell by itself (farming's ground verbs; mine and place along the look/facing ray) is checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { templateById } from '../v2/templates/registry.js';
import { actionCellAt, lookDir, faceDir } from '../v2/primitives/gameplay/items-lib.js';
import { frameOfCard, turnSign } from '../v2/primitives/engine/runtime-lib-frame.js';
import { hostPreflight, controlledMaker } from '../v2/verify/controls.js';
import { doc, make } from './v2-p-items-fixtures.js';

const { registry, logic } = await liveCatalogue();

test('frames: every space card declares its frame (null only without geometry), and turning follows its handedness', () => {
  for (const id of registry.ids('engine').filter(i => i.startsWith('engine.space.'))) {
    const card = registry.get(id).card;
    assert.ok('frame' in card, `${id} declares card.frame`);
    const defaults = Object.fromEntries(Object.entries(card.params || {}).filter(([, s]) => 'default' in s).map(([k, s]) => [k, s.default]));
    const f = frameOfCard(card, defaults);
    if (f !== null) assert.ok((f.up === null || [0, 1, 2].includes(f.up)) && ['right', 'left'].includes(f.handed), `${id}: ${JSON.stringify(f)}`);
  }
  assert.equal(turnSign({ up: null, handed: 'right' }, 'xy'), 1, 'a top-down plane: counterclockwise positive');
  assert.equal(turnSign({ up: 2, handed: 'left' }, 'xy'), -1, 'a track: lanes count to the right of progress');
  assert.equal(turnSign({ up: 1, handed: 'right' }, 'xz'), -1, 'a y-up 3D world: x toward z is clockwise from above');
});

test('actionCellAt: faced cell from above, below the feet from the side, the ground in front in 3D views', () => {
  assert.deepEqual(actionCellAt({ up: null, handed: 'right' }, 'td', [3, 3, 0], [0, 1, 0]), [3, 4, 0]);
  assert.deepEqual(actionCellAt({ up: null, handed: 'right' }, 'td', [3, 3, 0], [-1, 0, 0]), [2, 3, 0]);
  assert.deepEqual(actionCellAt({ up: null, handed: 'right' }, 'board', [3, 3, 0], [0.2, -0.9, 0]), [3, 2, 0], 'the dominant axis of the facing');
  assert.equal(actionCellAt({ up: null, handed: 'right' }, 'td', [3, 3, 0], null), null, 'facing nothing: no cell');
  assert.deepEqual(actionCellAt({ up: 1, handed: 'right' }, 'side', [3, 3, 0], [1, 0, 0]), [3, 2, 0], 'side: below the feet');
  assert.deepEqual(actionCellAt({ up: 1, handed: 'right' }, '3p', [3, 5, 3], [0, 0, 1]), [3, 4, 4], '3D: the ground cell in front');
});

test('farming on the top-down farm: a press tills the cell the farmer faces after walking, never the one south of it', () => {
  const r = hostPreflight(templateById('farm').doc, registry, logic), rt = controlledMaker(r.doc, registry, logic)(1);
  const api = rt.space(rt.player().space), cell = () => api.cellOf(rt.player()).split(',').map(Number);
  rt.step({});
  for (const d of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    const before = cell();
    for (let i = 0; i < 40 && cell().join() === before.join(); i++) rt.step({ axes: { move: d } });
    for (let i = 0; i < 10; i++) rt.step({});
    rt.step({ actions: { till: true } });
    const ev = rt.state.events.find(e => (e.name === 'tilled' || e.name === 'farm_denied') && Array.isArray(e.at));
    const dir = faceDir(rt.player()).map(Math.round);
    assert.ok(ev, `pressing till after moving ${d} acted or was denied at a cell`);
    assert.deepEqual(ev.at.slice(0, 2), [cell()[0] + dir[0], cell()[1] + dir[1]], `after moving ${d}: the faced cell (${dir})`);
  }
});

test('farming without a cell in a side view acts below the feet; mine and place aim along the full facing in a plane', () => {
  const side = doc({ systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'hoe' }] } }, { use: 'gameplay.farming', with: { crops: [{ item: 'wheat', seed: 'seeds' }, { item: 'oat', seed: 'oat_seeds' }], tillable: ['dirt'] } }],
    space: { gravity: -20 }, at: [2, 1, 0], content: { items: [{ id: 'hoe', name: 'Hoe', kind: 'tool', tool: { kind: 'hoe' } }, { id: 'seeds', name: 'S' }, { id: 'wheat', name: 'W' }, { id: 'oat_seeds', name: 'S' }, { id: 'oat', name: 'O' }],
      blocks: [{ id: 'dirt', name: 'Dirt' }, { id: 'farmland', name: 'Farmland' }], archetypes: [{ id: 'hero', kind: 'player', components: { body: { size: [1, 1, 1] } } }] } });
  side.views = { primary: 'side' };
  const { rt } = make(side);
  rt.space('world').setCell([2, 0, 0], 'dirt', rt);
  rt.step({ actions: { till: true } });
  assert.deepEqual(rt.state.events.find(e => e.name === 'tilled')?.at, [2, 0, 0], 'below the feet');
  // In a plane seen from above, body.facing is only the sign of x; the look ray of mine and place follows body.dir.
  assert.deepEqual(lookDir({ components: { body: { facing: 1, dir: [0, 1] } } }), [0, 1, 0]);
});
