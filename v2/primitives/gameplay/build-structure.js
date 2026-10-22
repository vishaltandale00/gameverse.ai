// Snap-together building on an editCells space: pieces are cell shapes of a
// block with an item cost, placed on a grid with 90° rotations, inside owned
// plots when ownership is on. Structures are recorded (so they can be
// demolished for a refund) and settlement slots complete when a piece is built
// inside them. Library pieces: wall floor roof door stairs lamp pillar fence.
import { compare } from '../../kernel/logic.js';
import { give, take, count } from './inventory.js';
import { items as allItems, add, v3, whoKey } from './items-lib.js';
import { ID_PATTERN } from '../../kernel/sections.js';

const KEY = 'gameplay.build.structure';
const box = (w, h, d) => { const out = []; for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) out.push([x, y, z]); return out; };
export const LIBRARY = {
  wall: { cells: box(3, 3, 1) }, floor: { cells: box(3, 1, 3) }, roof: { cells: box(3, 1, 3), lift: 3 },
  door: { cells: box(1, 2, 1), block: 'door' }, stairs: { cells: [[0, 0, 0], [0, 1, 1], [0, 2, 2]] },
  lamp: { cells: [[0, 0, 0]], block: 'lamp' }, pillar: { cells: box(1, 3, 1) }, fence: { cells: box(3, 1, 1) },
};
/** A cell offset or a size: three integers. */
const XYZ = { type: 'list', of: { type: 'integer' }, min: 3, max: 3 };
const rotate = ([x, y, z], r) => [[x, y, z], [z, y, -x], [-x, y, -z], [-z, y, x]][((r % 4) + 4) % 4];

export default {
  id: 'gameplay.build.structure',
  card: {
    loop: { verbs: ['build', 'demolish'], progress: ['built', 'slot_filled'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { build: { type: 'choice', of: 'a piece and the cell it is anchored at', pick: 'piece', from: 'options', emits: ['built'] }, demolish: { type: 'choice', of: 'a built structure', from: 'options', emits: ['demolished'] } },
    intent: 'Snap-together building: pieces (cell shapes of a block with an item cost) placed on a grid with rotation, only inside owned plots when ownership is on, demolish for a refund, and settlement slots that complete when built in.',
    views: ['1p', '3p', 'td', 'iso'],
    params: {
      pieces: { type: 'list', default: ['wall', 'floor'], of: { type: 'string', options: Object.keys(LIBRARY) }, effect: 'the library pieces offered' },
      custom: { type: 'list', default: [], of: { type: 'object', fields: {
        id: { type: 'string', pattern: ID_PATTERN, required: true, effect: 'its id (a library name overrides that library piece)' },
        cells: { type: 'list', of: XYZ, min: 1, effect: 'the cells it fills, offsets from its anchor' }, size: { ...XYZ, effect: '[w, h, d]: a box of cells, when cells is not given' },
        block: { type: 'ref', to: 'block', effect: 'its block (default with.block)' },
        cost: { type: 'list', of: { type: 'object', fields: { item: { type: 'ref', to: 'item', required: true }, count: { type: 'integer', min: 1, required: true } } }, effect: 'items it costs (default costPerCell of its block item per cell)' },
        lift: { type: 'integer', min: 0, effect: 'cells its anchor is raised' },
      } }, effect: 'pieces of the document: cell shapes with a block and a cost, offered beside the library pieces' },
      block: { type: 'ref', to: 'block', effect: 'block for pieces that do not name one' },
      costPerCell: { type: 'integer', default: 1, min: 0, max: 64, effect: 'pieces without a cost use this many of the item that places their block, per cell' },
      grid: { type: 'integer', default: 1, min: 1, max: 16, effect: 'anchor cells snap to multiples of this' },
      reach: { type: 'number', default: 8, min: 1, max: 64, unit: 'cells', effect: 'max distance from the builder to the anchor' },
      ownership: { type: 'boolean', default: false, effect: 'building only inside plots whose predicate holds' },
      plots: { type: 'list', default: [], of: { type: 'object', fields: { zone: { type: 'ref', to: 'zone', required: true }, when: { type: 'predicate', effect: "default {flag: 'owns.<zone>'}" } } }, effect: 'buildable plots when ownership is on' },
      slots: { type: 'list', default: [], of: { type: 'object', fields: { id: { type: 'string', pattern: ID_PATTERN, required: true }, zone: { type: 'ref', to: 'zone', required: true }, piece: { type: 'string', effect: 'piece required (a pieces name or a custom id; default any)' }, onFilled: { type: 'effects', default: [] } } }, effect: 'settlement slots filled by building in them' },
      refund: { type: 'number', default: 0.5, min: 0, max: 1, effect: 'fraction of the cost returned on demolish' },
    },
    // Events it emits when it refuses a player's verb, with a reason (graphics.ui.hud says why).
    denials: ['build_denied'],
    provides: { events: ['built', 'built:*', 'build_denied', 'demolished', 'slot_filled', 'slot_filled:*'], actions: ['build', 'demolish'] },
    requires: { capabilities: ['editCells'] },
    reads: ['content.blocks', 'content.items'],
    defines: [{ kind: 'piece', in: 'custom' }],
    rules: {
      piece_duplicate: { fields: ['pieces', 'custom[].id'], message: 'each piece is offered once: a library name is listed once and a custom id is not also in pieces', example: { pieces: ['wall', 'wall'] } },
      piece_invalid: { fields: ['custom[].cells', 'custom[].size', 'custom[].block', 'block'], message: 'a custom piece gives cells or size (unless it overrides a library piece), and every piece has a block: its own, its library piece\'s or with.block' },
      piece_block_unknown: { fields: ['pieces', 'block'], message: 'the block a piece uses is a content.blocks id (when the document declares blocks)' },
      piece_unknown: { fields: ['slots[].piece', 'pieces', 'custom[].id'], message: 'a slot\'s piece is one of the pieces offered (pieces or custom ids)',
        example: { doc: { spaces: [{ id: 'yard', use: 'engine.space.grid', with: { size: [8, 8] }, zones: [{ id: 'lot', name: 'Lot', rect: [0, 0, 4, 4] }] }], systems: [{ use: 'gameplay.build.structure', with: { block: 'pillar', slots: [{ id: 'gate', zone: 'lot', piece: 'tower' }] } }] } } },
    },
  },
  logic(logic) {
    logic.predicate('structures', { test: (p, rt, c) => compare(Object.values(rt.store(KEY).built || {}).filter(s => (p.structures === '*' || s.piece === p.structures) && (!p.who || s.owner === whoKey(p.who, c))).length, p) });
    logic.predicate('slot_filled', { test: (p, rt) => Boolean(rt.store(KEY).slots?.[p.slot_filled]) });
  },
  validate(config, doc) {
    const errors = [], blocksIn = new Set((doc.content?.blocks || []).map(b => b?.id)), ids = new Set();
    const list = v => (Array.isArray(v) ? v : []), customs = list(config.custom).filter(p => p && typeof p === 'object');
    list(config.pieces).forEach((name, i) => {
      if (ids.has(name)) errors.push({ code: 'piece_duplicate', path: `pieces[${i}]`, message: `'${name}' is listed twice` }); ids.add(name);
      if (!LIBRARY[name]?.block && !config.block && !customs.some(c => c.id === name)) errors.push({ code: 'piece_invalid', path: `pieces[${i}]`, message: `piece '${name}' has no block (set with.block)` });
    });
    customs.forEach((p, i) => {
      const at = `custom[${i}]`;
      if (list(config.pieces).includes(p.id)) errors.push({ code: 'piece_duplicate', path: `${at}.id`, message: `'${p.id}' is also listed in pieces` });
      ids.add(p.id);
      if (!LIBRARY[p.id] && !Array.isArray(p.cells) && !Array.isArray(p.size)) errors.push({ code: 'piece_invalid', path: at, message: `piece '${p.id}' needs cells or size` });
      if (!p.block && !LIBRARY[p.id]?.block && !config.block) errors.push({ code: 'piece_invalid', path: at, message: `piece '${p.id}' has no block (set its block or with.block)` });
    });
    // A library piece's own block (door, lamp) is no declared reference: it must be one of the document's blocks.
    list(config.pieces).forEach((name, i) => { const blk = LIBRARY[name]?.block; if (blk && blocksIn.size && !blocksIn.has(blk) && !customs.some(c => c.id === name)) errors.push({ code: 'piece_block_unknown', path: `pieces[${i}]`, message: `piece '${name}' uses block '${blk}', which content.blocks does not declare` }); });
    list(config.slots).forEach((s, i) => { if (s?.piece && !ids.has(s.piece)) errors.push({ code: 'piece_unknown', path: `slots[${i}].piece`, message: `slot '${s.id}' wants unknown piece '${s.piece}'` }); });
    return errors;
  },
  install(rt, config) {
    const st = () => { const s = rt.store(KEY); s.built ??= {}; s.next ??= 1; s.slots ??= {}; return s; };
    st(); // created at install, so reads later never add state
    const pieces = new Map([...config.pieces.map(id => ({ id, ...LIBRARY[id] })), ...config.custom.map(p => ({ ...LIBRARY[p.id], ...p }))].map(base =>
      [base.id, { ...base, cells: base.cells ?? box(...v3(base.size)), block: base.block ?? config.block }]));
    // What a person reads for a piece: its declared name, or the library's word for one of its own pieces (a wall).
    const pieceName = id => { const p = pieces.get(id); return p?.name ?? (LIBRARY[id] ? `a ${id}` : null); };
    const placer = blk => [...allItems(rt).values()].find(i => i.block === blk)?.id;
    const costOf = p => p.cost ?? (placer(p.block) && config.costPerCell ? [{ item: placer(p.block), count: p.cells.length * config.costPerCell }] : []);
    const snap = at => v3(at).map(v => Math.round(v / config.grid) * config.grid);
    function plotOk(sp, cells) {
      if (!config.ownership) return true;
      return cells.every(c => { const z = sp.zoneAt(c); const plot = config.plots.find(p => p.zone === z); return plot && rt.test(plot.when ?? { flag: `owns.${plot.zone}` }); });
    }
    // Cells outside the space's declared extent (api.size) cannot hold a piece.
    const inside = (sp, c) => !Array.isArray(sp.size) || sp.size.every((n, i) => c[i] >= 0 && c[i] < n);
    /** What building `v` would do now, without doing it: { piece, anchor, cells, cost } or { reason } (the denial). */
    function plan(who, v) {
      const e = rt.entity(who), sp = e && rt.space(e.space), p = pieces.get(v?.piece);
      if (!p) return { reason: 'piece' };
      if (!Array.isArray(v.at)) return { reason: 'anchor' };
      const anchor = add(snap(v.at), [0, p.lift ?? 0, 0]);
      const me = Array.isArray(e.at) ? v3(e.at) : null;
      if (me && Math.hypot(...anchor.map((x, i) => x - me[i])) > config.reach) return { reason: 'range' };
      const cells = p.cells.map(c => add(anchor, rotate(v3(c), v.rot ?? 0)));
      if (!cells.every(c => inside(sp, c))) return { reason: 'bounds' };
      if (cells.some(c => sp.getCell(c) != null)) return { reason: 'occupied' };
      if (!plotOk(sp, cells)) return { reason: 'plot' };
      const cost = costOf(p);
      if (cost.some(c => count(rt, who, c.item) < c.count)) return { reason: 'cost' };
      return { piece: p, anchor, cells, cost };
    }
    function build(who, v) {
      const e = rt.entity(who), sp = e && rt.space(e.space);
      const deny = reason => { rt.emit('build_denied', { who, piece: v?.piece ?? null, reason }); return false; };
      const pl = plan(who, v); if (pl.reason) return deny(pl.reason);
      const { piece: p, anchor, cells, cost } = pl;
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
    // The values a person chooses from: each piece at the free anchors two cells from the builder along the ground
    // plane (x and z with y up; x and y on a plane), and each structure the builder owns.
    rt.options(rt => {
      const e = rt.player(); if (!e || !Array.isArray(e.at)) return [];
      const flat = e.at.length < 3, here = v3(e.at), out = [];
      const ring = flat ? [[2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0]] : [[2, 0, 0], [-2, 0, 0], [0, 0, 2], [0, 0, -2]];
      for (const id of pieces.keys()) for (const d of ring) {
        const at = add(here, d).map(Math.round), v = { piece: id, at };
        if (!plan('player', v).reason) out.push({ label: `build ${id} at ${at.join(',')}`, ...(pieceName(id) ? { text: `Build ${pieceName(id)} at ${at.slice(0, flat ? 2 : 3).join(', ')}` } : {}), actions: { build: v } });
      }
      for (const b of Object.values(st().built)) if (b.owner === 'player') out.push({ label: `demolish ${b.piece} ${b.id}`, ...(pieceName(b.piece) ? { text: `Demolish ${pieceName(b.piece)}${Array.isArray(b.at) ? ` at ${b.at.slice(0, flat ? 2 : 3).join(', ')}` : ''}` } : {}), actions: { demolish: b.id } });
      return out;
    });
    rt.provide('structures', { list: () => structuredClone(Object.values(st().built)), pieces: () => [...pieces.keys()], cost: id => costOf(pieces.get(id)) });
  },
};
