// Snap-together building on an editCells space: pieces are cell shapes of a
// block with an item cost, placed on a grid with 90° rotations, inside owned
// plots when ownership is on. Structures are recorded (so they can be
// demolished for a refund) and settlement slots complete when a piece is built
// inside them. Library pieces: wall floor roof door stairs lamp pillar fence.
import { compare } from '../../kernel/logic.js';
import { give, take, count } from './inventory.js';
import { items as allItems, add, v3, whoKey } from './items-lib.js';

const KEY = 'gameplay.build.structure';
const box = (w, h, d) => { const out = []; for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) out.push([x, y, z]); return out; };
export const LIBRARY = {
  wall: { cells: box(3, 3, 1) }, floor: { cells: box(3, 1, 3) }, roof: { cells: box(3, 1, 3), lift: 3 },
  door: { cells: box(1, 2, 1), block: 'door' }, stairs: { cells: [[0, 0, 0], [0, 1, 1], [0, 2, 2]] },
  lamp: { cells: [[0, 0, 0]], block: 'lamp' }, pillar: { cells: box(1, 3, 1) }, fence: { cells: box(3, 1, 1) },
};
const rotate = ([x, y, z], r) => [[x, y, z], [z, y, -x], [-x, y, -z], [-z, y, x]][((r % 4) + 4) % 4];

export default {
  id: 'gameplay.build.structure',
  card: {
    intent: 'Snap-together building: pieces (cell shapes of a block with an item cost) placed on a grid with rotation, only inside owned plots when ownership is on, demolish for a refund, and settlement slots that complete when built in.',
    views: ['1p', '3p', 'td', 'iso'],
    params: {
      pieces: { type: 'list', default: ['wall', 'floor'], of: { type: 'json' }, effect: `library names (${Object.keys(LIBRARY).join(', ')}) or { id, cells: [[x,y,z]...] | size: [w,h,d], block?, cost?: [{item,count}], lift? }` },
      block: { type: 'ref', to: 'block', effect: 'block for pieces that do not name one' },
      costPerCell: { type: 'integer', default: 1, min: 0, max: 64, effect: 'pieces without a cost use this many of the item that places their block, per cell' },
      grid: { type: 'integer', default: 1, min: 1, max: 16, effect: 'anchor cells snap to multiples of this' },
      reach: { type: 'number', default: 8, min: 1, max: 64, unit: 'cells', effect: 'max distance from the builder to the anchor' },
      ownership: { type: 'boolean', default: false, effect: 'building only inside plots whose predicate holds' },
      plots: { type: 'list', default: [], of: { type: 'object', fields: { zone: { type: 'ref', to: 'zone', required: true }, when: { type: 'predicate', effect: "default {flag: 'owns.<zone>'}" } } }, effect: 'buildable plots when ownership is on' },
      slots: { type: 'list', default: [], of: { type: 'object', fields: { id: { type: 'string', required: true }, zone: { type: 'ref', to: 'zone', required: true }, piece: { type: 'string', effect: 'piece required (default any)' }, onFilled: { type: 'effects', default: [] } } }, effect: 'settlement slots filled by building in them' },
      refund: { type: 'number', default: 0.5, min: 0, max: 1, effect: 'fraction of the cost returned on demolish' },
    },
    provides: { events: ['built', 'built:*', 'build_denied', 'demolished', 'slot_filled', 'slot_filled:*'], actions: ['build', 'demolish'] },
    requires: { capabilities: ['editCells'] },
    reads: ['content.blocks', 'content.items'],
  },
  logic(logic) {
    logic.predicate('structures', { test: (p, rt, c) => compare(Object.values(rt.store(KEY).built || {}).filter(s => (p.structures === '*' || s.piece === p.structures) && (!p.who || s.owner === whoKey(p.who, c))).length, p) });
    logic.predicate('slot_filled', { test: (p, rt) => Boolean(rt.store(KEY).slots?.[p.slot_filled]) });
  },
  validate(config, doc) {
    const errors = [], blocksIn = new Set((doc.content?.blocks || []).map(b => b.id)), items = new Set((doc.content?.items || []).map(i => i.id)), ids = new Set();
    config.pieces.forEach((p, i) => {
      const id = typeof p === 'string' ? p : p?.id;
      if (typeof p === 'string' && !LIBRARY[p]) errors.push({ code: 'piece_unknown', message: `pieces[${i}]: '${p}' is not a library piece`, hint: Object.keys(LIBRARY).join(', ') });
      if (typeof p === 'object' && (!p?.id || (!Array.isArray(p.cells) && !Array.isArray(p.size)))) errors.push({ code: 'piece_invalid', message: `pieces[${i}] needs an id and cells or size` });
      if (ids.has(id)) errors.push({ code: 'id_duplicate', message: `duplicate piece '${id}'` }); ids.add(id);
      const blk = (typeof p === 'object' && p?.block) || LIBRARY[id]?.block || config.block;
      if (!blk) errors.push({ code: 'piece_invalid', message: `piece '${id}' has no block (set with.block)` });
      else if (blocksIn.size && !blocksIn.has(blk)) errors.push({ code: 'ref_unknown', message: `piece '${id}' uses unknown block '${blk}'` });
      for (const c of (typeof p === 'object' && p?.cost) || []) if (!items.has(c.item)) errors.push({ code: 'ref_unknown', message: `piece '${id}' costs unknown item '${c.item}'` });
    });
    for (const s of config.slots) if (s.piece && !ids.has(s.piece)) errors.push({ code: 'piece_unknown', message: `slot '${s.id}' wants unknown piece '${s.piece}'` });
    return errors;
  },
  install(rt, config) {
    const st = () => { const s = rt.store(KEY); s.built ??= {}; s.next ??= 1; s.slots ??= {}; return s; };
    st(); // created at install, so reads later never add state
    const pieces = new Map(config.pieces.map(p => {
      const base = typeof p === 'string' ? { id: p, ...LIBRARY[p] } : { ...LIBRARY[p.id], ...p };
      return [base.id, { ...base, cells: base.cells ?? box(...v3(base.size)), block: base.block ?? config.block }];
    }));
    const placer = blk => [...allItems(rt).values()].find(i => i.block === blk)?.id;
    const costOf = p => p.cost ?? (placer(p.block) && config.costPerCell ? [{ item: placer(p.block), count: p.cells.length * config.costPerCell }] : []);
    const snap = at => v3(at).map(v => Math.round(v / config.grid) * config.grid);
    function plotOk(sp, cells) {
      if (!config.ownership) return true;
      return cells.every(c => { const z = sp.zoneAt(c); const plot = config.plots.find(p => p.zone === z); return plot && rt.test(plot.when ?? { flag: `owns.${plot.zone}` }); });
    }
    function build(who, v) {
      const e = rt.entity(who), sp = e && rt.space(e.space), p = pieces.get(v?.piece);
      const deny = reason => { rt.emit('build_denied', { who, piece: v?.piece ?? null, reason }); return false; };
      if (!p) return deny('piece');
      if (!Array.isArray(v.at)) return deny('anchor');
      const anchor = add(snap(v.at), [0, p.lift ?? 0, 0]);
      const me = Array.isArray(e.at) ? v3(e.at) : null;
      if (me && Math.hypot(...anchor.map((x, i) => x - me[i])) > config.reach) return deny('range');
      const cells = p.cells.map(c => add(anchor, rotate(v3(c), v.rot ?? 0)));
      if (cells.some(c => sp.getCell(c) != null)) return deny('occupied');
      if (!plotOk(sp, cells)) return deny('plot');
      const cost = costOf(p);
      if (cost.some(c => count(rt, who, c.item) < c.count)) return deny('cost');
      const placed = [];
      for (const c of cells) { if (!sp.setCell(c, p.block, rt, who)) { for (const q of placed) sp.setCell(q, null, rt, who); return deny('bounds'); } placed.push(c); }
      for (const c of cost) take(rt, who, c.item, c.count);
      const s = st(), id = `s${s.next++}`;
      s.built[id] = { id, piece: p.id, space: e.space, at: anchor, rot: v.rot ?? 0, cells, block: p.block, cost, owner: who };
      rt.emitTyped('built', p.id, { who, id, piece: p.id, at: anchor });
      for (const slot of config.slots) {
        if (s.slots[slot.id] || (slot.piece && slot.piece !== p.id) || !cells.every(c => sp.zoneAt(c) === slot.zone)) continue;
        s.slots[slot.id] = id; rt.emitTyped('slot_filled', slot.id, { slot: slot.id, structure: id });
        if (slot.onFilled.length) rt.run(slot.onFilled, { actor: who });
      }
      return true;
    }
    function demolish(who, id) {
      const s = st(), b = s.built[id]; if (!b) return false;
      const sp = rt.space(b.space);
      for (const c of b.cells) if (sp.getCell(c) === b.block) sp.setCell(c, null, rt, who);
      for (const c of b.cost) { const n = Math.floor(c.count * config.refund); if (n) give(rt, who, c.item, n); }
      delete s.built[id];
      for (const [slot, sid] of Object.entries(s.slots)) if (sid === id) delete s.slots[slot];
      rt.emit('demolished', { who, id, piece: b.piece });
      return true;
    }
    rt.action('build', (v, rt) => build('player', v));
    rt.action('demolish', (id, rt) => demolish('player', id));
    rt.provide('structures', { list: () => structuredClone(Object.values(st().built)), pieces: () => [...pieces.keys()], cost: id => costOf(pieces.get(id)) });
  },
};
