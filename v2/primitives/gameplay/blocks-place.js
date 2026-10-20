// Placing: put a held block item (content.items[].block) into an empty cell,
// or spawn a prop for items with `place: archetype` (workbenches, beds). The
// target is the empty cell in front of the looked-at face, or an explicit cell
// within reach. Protected zones, entities in the way, and archetypes listed in
// forbidNear refuse; `snap` requires a solid neighbour. set_blocks fills a box
// from plot or scripts.
import { take, bag } from './inventory.js';
import { item as itemDef, lookDir, eyeOf, cellDist, cellOf, isVec, api as spaceApi, inBox, add, v3 } from './items-lib.js';

const KEY = 'gameplay.blocks.place';
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export default {
  id: 'gameplay.blocks.place',
  card: {
    intent: 'Place held block items into cells (or props from items with `place`), aimed at the looked-at face or an explicit cell; protected zones, occupancy and forbidNear checks; ghost preview; set_blocks for scripted edits.',
    views: ['1p', '3p', 'side', 'td', 'iso'],
    params: {
      reach: { type: 'number', default: 5, min: 0.5, max: 64, unit: 'cells', effect: 'placing distance from the eye' },
      protect: { type: 'list', default: [], of: { type: 'ref', to: 'zone' }, effect: 'zones where nothing can be placed' },
      snap: { type: 'boolean', default: false, effect: 'a placed block needs a solid face-neighbour' },
      forbidNear: { type: 'list', default: [], of: { type: 'string' }, effect: 'archetype ids or kinds (npc, enemy...) that may not be within forbidRadius of the cell' },
      forbidRadius: { type: 'number', default: 1.5, min: 0, max: 20, unit: 'cells' },
      allowInside: { type: 'boolean', default: false, effect: 'allow placing a cell that overlaps an entity' },
      preview: { type: 'boolean', default: true, effect: 'keep the target cell of the selected item in state for a ghost preview' },
    },
    provides: { events: ['block_placed', 'block_placed:*', 'prop_placed', 'prop_placed:*', 'place_denied', 'blocks_set'], actions: ['place', 'select_item'] },
    requires: { capabilities: ['editCells', 'raycast'] },
    reads: ['content.items', 'content.blocks'],
  },
  logic(logic) {
    logic.effect('set_blocks', {
      refs: e => (e.block ? [['block', e.block]] : []),
      check: (e, path, errors) => {
        const box = e.box, cells = e.cells;
        if (!(Array.isArray(box) && box.length === 2 && box.every(Array.isArray)) && !Array.isArray(cells)) errors.push({ code: 'effect_invalid', path, message: 'set_blocks needs box [[x,y,z],[x,y,z]] or cells [[x,y,z]...]' });
      },
      run: (e, rt, c) => {
        const sid = e.space ?? rt.resolve(c?.self)?.space ?? rt.player()?.space ?? rt.doc.spaces[0].id, sp = rt.space(sid);
        if (e.box) sp.fill(e.box.map(v3), e.block ?? null, rt); else for (const cell of e.cells) sp.setCell(v3(cell), e.block ?? null, rt, 'script');
        rt.emit('blocks_set', { space: sid, block: e.block ?? null, box: e.box ?? null, cells: e.cells?.length ?? null });
      },
    });
  },
  validate(config, doc) {
    const errors = [], bl = new Set((doc.content?.blocks || []).map(b => b.id)), arch = new Set((doc.content?.archetypes || []).map(a => a.id));
    (doc.content?.items || []).forEach((it, i) => {
      if (it.block != null && !bl.has(it.block)) errors.push({ code: 'ref_unknown', path: `content.items[${i}].block`, message: `unknown block '${it.block}'` });
      if (it.place != null && !arch.has(it.place)) errors.push({ code: 'ref_unknown', path: `content.items[${i}].place`, message: `unknown archetype '${it.place}'` });
    });
    return errors;
  },
  install(rt, config) {
    const st = () => { const s = rt.store(KEY); s.selected ??= {}; s.ghost ??= {}; return s; };
    st(); // created at install, so reads later never add state
    const placeable = id => { const d = itemDef(rt, id); return Boolean(d?.block || d?.place); };
    const heldItem = (who, want) => {
      if (want) return bag(rt, who)[want] ? want : null;
      const sel = st().selected[who]; if (sel && bag(rt, who)[sel] && placeable(sel)) return sel;
      return Object.keys(bag(rt, who)).sort().find(placeable) ?? null;
    };
    /** The empty cell the entity aims at: the last empty cell before the looked-at solid one. */
    function aimed(e) {
      const sp = spaceApi(rt, e), dir = lookDir(e); if (!sp || !dir) return null;
      const from = eyeOf(rt, e), hit = sp.raycast(from, dir, config.reach);
      if (hit?.hit !== 'cell') return null;
      const hc = v3(hit.cell).join(',');
      for (let t = hit.dist; t >= 0; t -= 0.05) { const c = cellOf(add(from, dir.map(x => x * t))); if (c.join(',') !== hc) return sp.getCell(c) == null ? c : null; }
      return null;
    }
    function where(e, value) {
      const cell = isVec(value) ? cellOf(value) : isVec(value?.cell) ? cellOf(value.cell) : aimed(e);
      return cell && cellDist(rt, e, cell) <= config.reach + 0.5 ? cell : null;
    }
    function place(who, value) {
      const e = rt.entity(who), sp = e && spaceApi(rt, e); if (!sp) return false;
      const id = heldItem(who, value?.item), cell = where(e, value);
      const deny = reason => { rt.emit('place_denied', { who, item: id, at: cell, reason }); return false; };
      if (!id || !placeable(id)) return deny('nothing');
      if (!cell) return deny('range');
      if (sp.getCell(cell) != null) return deny('occupied');
      if (config.protect.length && config.protect.includes(sp.zoneAt(cell))) return deny('protected');
      const box = { min: cell, max: add(cell, [1, 1, 1]) };
      const def = itemDef(rt, id);
      if (def.block && !config.allowInside && inBox(rt, e.space, box, o => o.components.body || o.id === 'player').length) return deny('blocked');
      if (config.forbidNear.length) {
        const near = inBox(rt, e.space, { min: add(cell, [-config.forbidRadius, -config.forbidRadius, -config.forbidRadius]), max: add(cell, [1 + config.forbidRadius, 1 + config.forbidRadius, 1 + config.forbidRadius]) }, o => config.forbidNear.includes(o.archetype) || config.forbidNear.includes(rt.archetype(o.archetype)?.kind));
        if (near.length) return deny('forbidden');
      }
      if (config.snap && def.block && !N6.some(d => sp.getCell(add(cell, d)) != null)) return deny('unsupported');
      if (def.block) {
        if (!sp.setCell(cell, def.block, rt, who)) return deny('blocked');
        take(rt, who, id, 1);
        rt.emitTyped('block_placed', def.block, { who, at: cell, item: id, block: def.block });
      } else {
        take(rt, who, id, 1);
        const prop = rt.spawn(def.place, { space: e.space, at: cell.slice(0, isVec(e.at) ? Math.max(2, e.at.length) : 3) });
        rt.emitTyped('prop_placed', def.place, { who, at: cell, item: id, id: prop.id });
      }
      return true;
    }
    rt.action('place', (v, rt) => place('player', v));
    rt.action('select_item', (id, rt) => { if (bag(rt, 'player')[id]) st().selected.player = id; });
    if (config.preview) rt.system('late', rt => { const p = rt.player(); if (!p) return; const id = heldItem('player'); const s = st(); if (id) s.ghost.player = { item: id, at: where(p, null) }; else delete s.ghost.player; }, KEY);
    rt.options(rt => { const p = rt.player(); return p && heldItem('player') && where(p, null) ? [{ label: `place ${heldItem('player')}`, actions: { place: true } }] : []; });
  },
};
