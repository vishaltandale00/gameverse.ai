// Mining: break cells of an editCells space with the `mine` verb, held over
// steps for hardness × hardnessScale ÷ tool speed seconds. content.blocks give
// hardness, the tool kind and tier needed to harvest (wrong tool: slower and no
// drops), drops [{item, count?, p?}] (default: the item whose `block` is this
// block) and the `unbreakable` tag. Drops go to the bag or into the world as
// pickups; tools wear through tool_used events; protected zones refuse.
import { compare } from '../../kernel/logic.js';
import { give, bag } from './inventory.js';
import { item as itemDef, items as allItems, blocks, roll, lookCell, cellDist, cellKey, cellOf, isVec, api as spaceApi, center } from './items-lib.js';

const KEY = 'gameplay.blocks.mine';
export const UNBREAKABLE = 9999;

/** The best tool in `who`'s bag (or equipped, with toolFrom 'equipped') for a block: {item, tier, kind} | null. */
export function bestTool(rt, who, block, from = 'best') {
  const candidates = from === 'equipped'
    ? Object.values(rt.entity(who)?.components?.equipment?.worn || {}).flat()
    : Object.keys(bag(rt, who));
  let best = null;
  for (const id of candidates) {
    const t = itemDef(rt, id)?.tool; if (!t || (block?.tool && t.kind !== block.tool)) continue;
    if (!best || (t.tier ?? 0) > best.tier || ((t.tier ?? 0) === best.tier && id < best.item)) best = { item: id, tier: t.tier ?? 0, kind: t.kind };
  }
  return best;
}
/** Drops for a block: its `drops`, else the item that places it. */
export function dropsOf(rt, id) {
  const b = blocks(rt).get(id);
  if (Array.isArray(b?.drops)) return b.drops;
  const it = [...allItems(rt).values()].find(i => i.block === id);
  return it ? [{ item: it.id, count: 1 }] : [];
}

export default {
  id: 'gameplay.blocks.mine',
  card: {
    intent: 'Break cells with tool tiers and hardness time (hold the mine verb), drops into the bag or as world pickups, tool wear, protected zones; block_mined:<block> events.',
    views: ['1p', '3p', 'side', 'td', 'iso'],
    params: {
      reach: { type: 'number', default: 5, min: 0.5, max: 64, unit: 'cells', effect: 'mining distance from the eye' },
      hardnessScale: { type: 'number', default: 1, min: 0, max: 100, unit: 's per hardness', effect: 'seconds per point of hardness by hand' },
      tierSpeed: { type: 'list', default: [2, 4, 6, 8, 12, 16], of: { type: 'number', min: 0.1 }, effect: 'speed multiplier of a matching tool by tier (0 = wood...)' },
      wrongToolPenalty: { type: 'number', default: 3.3, min: 1, max: 100, effect: 'time multiplier when the tool tier is too low (no drops then)' },
      drops: { type: 'boolean', default: true, effect: 'broken blocks drop items' },
      autoCollect: { type: 'boolean', default: true, effect: 'drops go straight into the bag (else world pickups)' },
      toolFrom: { type: 'string', default: 'best', options: ['best', 'equipped'], effect: 'which tool mines: the best matching tool carried, or only equipped items' },
      protect: { type: 'list', default: [], of: { type: 'ref', to: 'zone' }, effect: 'zones where cells cannot be broken' },
      fx: { type: 'boolean', default: true, effect: 'emit mine_hit events each step while mining (particles and sounds)' },
    },
    provides: { events: ['block_mined', 'block_mined:*', 'mine_denied', 'mine_hit', 'tool_used'], actions: ['mine'] },
    requires: { capabilities: ['editCells', 'raycast'] },
    reads: ['content.blocks', 'content.items'],
  },
  logic(logic) {
    logic.predicate('mined', { refs: p => [['block', p.mined]], test: (p, rt) => compare(rt.state.counts[`block_mined:${p.mined}`] ?? 0, p) });
  },
  validate(config, doc) {
    const errors = [], items = new Set((doc.content?.items || []).map(i => i.id));
    (doc.content?.blocks || []).forEach((b, i) => {
      if (b.hardness !== undefined && !(Number.isFinite(b.hardness) && b.hardness >= 0)) errors.push({ code: 'block_invalid', path: `content.blocks[${i}].hardness`, message: 'hardness must be a non-negative number' });
      if (b.drops !== undefined && !Array.isArray(b.drops)) errors.push({ code: 'block_invalid', path: `content.blocks[${i}].drops`, message: 'drops must be a list' });
      (Array.isArray(b.drops) ? b.drops : []).forEach((d, k) => {
        if (!items.has(d.item)) errors.push({ code: 'ref_unknown', path: `content.blocks[${i}].drops[${k}].item`, message: `unknown item '${d.item}'` });
        if (d.p !== undefined && !(d.p >= 0 && d.p <= 1)) errors.push({ code: 'block_invalid', path: `content.blocks[${i}].drops[${k}].p`, message: 'p must be in [0, 1]' });
      });
    });
    return errors;
  },
  /** Solver key: which cell is being mined (progress is replayed by the option's steps). */
  solverKey(rt) { return Object.entries(rt.state.prim[KEY]?.work || {}).map(([w, j]) => [w, j.cell]); },
  install(rt, config) {
    const st = () => { const s = rt.store(KEY); s.work ??= {}; return s; };
    st(); // created at install, so reads later never add state
    const spaceOf = e => spaceApi(rt, e);
    function timeFor(who, blockId) {
      const b = blocks(rt).get(blockId), h = b?.hardness ?? 1;
      if (h >= UNBREAKABLE || (b?.tags || []).includes('unbreakable')) return { time: Infinity };
      const tool = bestTool(rt, who, b, config.toolFrom), need = b?.tier ?? 0;
      const ok = !b?.tool ? true : Boolean(tool) && tool.tier >= need;
      const speed = ok && tool && b?.tool && tool.kind === b.tool ? config.tierSpeed[Math.min(tool.tier, config.tierSpeed.length - 1)] : 1;
      return { time: (h * config.hardnessScale / speed) * (ok ? 1 : config.wrongToolPenalty), harvest: ok, tool };
    }
    function target(e, value) {
      if (isVec(value)) { const c = cellOf(value); return cellDist(rt, e, c) <= config.reach + 0.5 ? c : null; }
      return lookCell(rt, e, config.reach)?.cell ?? null;
    }
    function mine(who, value) {
      const e = rt.entity(who), sp = e && spaceOf(e); if (!sp || typeof sp.getCell !== 'function') return;
      const cell = target(e, value), s = st();
      if (!cell) { delete s.work[who]; return; }
      const blockId = sp.getCell(cell);
      if (blockId == null) { delete s.work[who]; return; }
      const deny = reason => { delete s.work[who]; rt.emit('mine_denied', { who, at: cell, block: blockId, reason }); };
      if (config.protect.length && config.protect.includes(sp.zoneAt(cell))) return deny('protected');
      const { time, harvest, tool } = timeFor(who, blockId);
      if (!Number.isFinite(time)) return deny('unbreakable');
      const k = cellKey(cell), w = s.work[who];
      if (!w || w.cell !== k || w.block !== blockId) s.work[who] = { cell: k, block: blockId, t: 0, seen: rt.state.frame };
      const job = s.work[who]; job.t += rt.dt; job.seen = rt.state.frame;
      if (config.fx) rt.emit('mine_hit', { who, at: cell, block: blockId, progress: Math.min(1, time ? job.t / time : 1) });
      if (job.t + 1e-9 < time) return;
      delete s.work[who];
      sp.setCell(cell, null, rt, who);
      rt.emitTyped('block_mined', blockId, { who, at: cell, block: blockId, tool: tool?.item ?? null });
      if (tool) rt.emit('tool_used', { who, item: tool.item, block: blockId });
      if (!config.drops || !harvest) return;
      for (const d of dropsOf(rt, blockId)) {
        if (d.p != null && rt.random() >= d.p) continue;
        const n = roll(rt, d.count, 1);
        if (config.autoCollect) { const got = give(rt, who, d.item, n); if (got < n) rt.spawn(null, { space: e.space, at: cell.slice(), components: { pickup: { item: d.item, count: n - got } } }); }
        else rt.spawn(null, { space: e.space, at: cell.slice(), components: { pickup: { item: d.item, count: n } } });
      }
    }
    rt.action('mine', (v, rt) => mine('player', v));
    // Releasing the verb (a step without it) loses progress.
    rt.system('late', rt => { const s = st(); for (const [who, w] of Object.entries(s.work)) if (w.seen < rt.state.frame) delete s.work[who]; }, KEY);
    rt.options(rt => {
      const p = rt.player(), sp = p && spaceOf(p); if (!sp || typeof sp.cellsIn !== 'function' || !isVec(p.at)) return [];
      const c = center(rt, p).map(Math.floor), r = Math.floor(config.reach);
      const byBlock = new Map();
      for (const { at, block } of sp.cellsIn([c.map(v => v - r), c.map(v => v + r)])) {
        if (cellDist(rt, p, at) > config.reach || (config.protect.length && config.protect.includes(sp.zoneAt(at)))) continue;
        const { time, harvest } = timeFor('player', block); if (!Number.isFinite(time) || !harvest || !dropsOf(rt, block).length) continue;
        const d = cellDist(rt, p, at), prev = byBlock.get(block);
        if (!prev || d < prev.d) byBlock.set(block, { at, d, steps: Math.ceil(time / rt.dt) + 1 });
      }
      return [...byBlock].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, 8).map(([block, o]) => ({ label: `mine ${block}`, actions: { mine: o.at }, steps: o.steps }));
    });
  },
};
