// Block registry for cell spaces (voxel, tilemap, grid) and for anything that
// talks about materials: normalized definitions from content.blocks, tool
// tiers, harvest rules and break times, and block light computed on demand
// through the space's editCells capability. Hot-loaded blocks appear on the
// next lookup (the index is rebuilt when rt.doc changes).
import { compare } from '../../kernel/logic.js';

const ID = 'engine.blocks';

export function normalizeBlock(b, tiers) {
  const tier = b.tier ?? 0;
  return {
    id: b.id, name: b.name ?? b.id, color: b.color ?? '#888888', solid: b.solid !== false, hardness: b.hardness ?? 1,
    tool: b.tool ?? null, tier, tierName: tiers[tier] ?? null, drops: b.drops ?? [{ item: b.id, count: 1 }],
    light: b.light ?? 0, transparent: Boolean(b.transparent), unbreakable: (b.tags || []).includes('unbreakable') || b.hardness >= 9999,
    tags: b.tags ?? [], tile: b.tile ?? null, liquid: Boolean(b.liquid), friction: b.friction ?? null,
  };
}

export default {
  id: ID,
  card: {
    intent: 'Block and material registry from content.blocks: solidity, hardness, tool kind and tier, drops, light and tags. Provides harvest rules, break times and block light so mining, building, physics and lighting agree on what each cell is.',
    views: ['any'],
    params: {
      tiers: { type: 'list', of: { type: 'string' }, min: 1, default: ['hand', 'wood', 'stone', 'iron', 'steel'], effect: 'tool tiers in ascending strength; block.tier (index or name) is the minimum to harvest' },
      lightLevels: { type: 'integer', default: 15, min: 0, max: 31, effect: 'maximum light level; light falls off by 1 per cell' },
      breakSeconds: { type: 'number', default: 0.5, min: 0.01, max: 60, unit: 's', effect: 'seconds per hardness point with the right tool at the required tier' },
      wrongToolFactor: { type: 'number', default: 3.3, min: 1, max: 20, effect: 'break-time multiplier with the wrong tool or too low a tier' },
      tierSpeedup: { type: 'number', default: 0.25, min: 0, max: 2, effect: 'break-time reduction per tier above the requirement' },
    },
    provides: { events: ['block_changed', 'block_changed:*', 'light_changed'], services: ['blockDef', 'blocks'] },
    requires: {},
    reads: ['content.blocks'],
    data: {
      'content.blocks': { type: 'list', of: { type: 'object', open: true, fields: {
        color: { type: 'string', effect: 'CSS colour of the block (default #888888)' },
        solid: { type: 'boolean', effect: 'blocks movement (default true)' },
        hardness: { type: 'number', min: 0, effect: 'break-time points; 9999 or more is unbreakable' },
        tool: { type: 'string', effect: 'tool kind that harvests it (content.items[].tool.kind); none: any' },
        tier: { type: 'integer', min: 0, effect: 'index of the lowest tool tier (params.tiers) that harvests it' },
        drops: { type: 'list', of: { type: 'object', fields: { item: { type: 'ref', to: 'item', required: true }, count: { type: 'list', of: { type: 'integer', min: 0 }, min: 2, max: 2, effect: '[min, max] dropped (default 1)' }, p: { type: 'number', min: 0, max: 1, effect: 'drop chance (default always)' } } }, effect: 'what harvesting it gives (default the block itself)' },
        light: { type: 'integer', min: 0, max: 31, effect: 'light level it emits (at most params.lightLevels)' },
        transparent: { type: 'boolean' },
        tags: { type: 'list', of: { type: 'string' } },
        liquid: { type: 'boolean' },
        friction: { type: 'number', min: 0 },
      } } },
    },
    rules: {
      block_tier_unknown: { fields: ['content.blocks[].tier', 'tiers'], message: 'a block tier is an index of tiers (below its length)' },
      block_light_range: { fields: ['content.blocks[].light', 'lightLevels'], message: 'a block light is at most lightLevels' },
    },
  },
  logic(logic) {
    // {block_tag: 'ore', at: [x,y,z], space?}: the cell at `at` holds a block carrying the tag.
    logic.predicate('block_tag', {
      codes: [{ code: 'block_predicate_invalid', fields: ['block_tag', 'at'], message: 'block_tag is a tag (a string) and at a position [x, y, z]', example: { block_tag: 'ore' } }],
      check: (p, path, errors) => { if (typeof p.block_tag !== 'string' || !Array.isArray(p.at)) errors.push({ code: 'block_predicate_invalid', path, message: 'block_tag needs a tag and at: [x,y,z]' }); },
      test: (p, rt) => { const id = rt.space(p.space).getCell?.(p.at); return Boolean(id) && (rt.service('blockDef')(id)?.tags || []).includes(p.block_tag); },
    });
    // {block_light: [x,y,z], gte: 8, space?}: block light at a position (numbers compare).
    logic.predicate('block_light', {
      codes: [{ code: 'block_predicate_invalid', fields: ['block_light'], message: 'block_light is a position [x, y, z]', example: { block_light: 3, gte: 8 } }],
      check: (p, path, errors) => { if (!Array.isArray(p.block_light)) errors.push({ code: 'block_predicate_invalid', path, message: 'block_light needs a position [x,y,z]' }); },
      test: (p, rt) => { return compare(rt.service('blocks').lightAt(p.block_light, p.space), p); },
    });
  },
  validate(config, doc) {
    const errors = [], blocks = Array.isArray(doc.content?.blocks) ? doc.content.blocks : [];
    blocks.forEach((b, i) => {
      const path = `content.blocks[${i}]`;
      if (Number.isInteger(b?.tier) && b.tier >= config.tiers.length) errors.push({ code: 'block_tier_unknown', path: `${path}.tier`, message: `tier ${b.tier} is not one of ${config.tiers.map((t, k) => `${k}:${t}`).join(', ')}` });
      if (Number.isInteger(b?.light) && b.light > config.lightLevels) errors.push({ code: 'block_light_range', path: `${path}.light`, message: `light must be an integer in [0, ${config.lightLevels}]` });
    });
    return errors;
  },
  install(rt, config) {
    let indexed = null, defs = new Map();
    const index = () => { if (indexed !== rt.doc) { indexed = rt.doc; defs = new Map((rt.doc.content?.blocks || []).map(b => [b.id, normalizeBlock(b, config.tiers)])); } return defs; };
    const def = id => (id == null ? null : index().get(id) ?? null);
    const tierOf = t => (typeof t === 'string' ? config.tiers.indexOf(t) : (t ?? 0));
    const api = {
      def, all: () => [...index().values()], tiers: () => config.tiers.slice(), tierOf,
      /** Can a tool {kind, tier} harvest (get drops from) this block? Blocks with no tool need none. */
      canHarvest(id, tool = {}) { const d = def(id); if (!d || d.unbreakable) return false; return !d.tool || (tool.kind === d.tool && tierOf(tool.tier) >= d.tier); },
      /** Seconds to break with tool {kind, tier, speed}. Infinity when unbreakable. */
      breakTime(id, tool = {}) {
        const d = def(id); if (!d || d.unbreakable) return Infinity;
        const right = !d.tool || (tool.kind === d.tool && tierOf(tool.tier) >= d.tier);
        const above = right && d.tool ? Math.max(0, tierOf(tool.tier) - d.tier) : 0;
        return (d.hardness * config.breakSeconds * (right ? 1 : config.wrongToolFactor)) / ((tool.speed ?? 1) * (1 + above * config.tierSpeedup));
      },
      /** Drops for a harvested block, rolled with rt.random for p < 1. */
      drops(id, tool = {}) {
        const d = def(id); if (!d || !api.canHarvest(id, tool)) return [];
        return d.drops.filter(x => x.p === undefined || rt.random() < x.p).map(x => ({ item: x.item, count: x.count ?? 1 }));
      },
      solidAt(at, space) { const s = rt.space(space); if (!s.getCell) return false; const id = s.getCell(at); return id != null && (def(id)?.solid ?? true); },
      /** Block light at `at`: max over emitters of (light - manhattan distance), searched within lightLevels cells. */
      lightAt(at, space) {
        const s = rt.space(space); if (!s.cellsIn || !Array.isArray(at)) return 0;
        const n = config.lightLevels, c = at.map(Math.floor), lo = c.map(v => v - n), hi = c.map(v => v + n);
        let best = 0;
        for (const { at: p, block } of s.cellsIn([lo, hi])) { const l = def(block)?.light || 0; if (l > best) { const d = p.reduce((a, v, i) => a + Math.abs(v - (c[i] ?? 0)), 0); best = Math.max(best, l - d); } }
        return Math.max(0, Math.min(n, best));
      },
    };
    rt.provide('blockDef', def);
    rt.provide('blocks', api);
    rt.on('cell_changed', (e, rt) => {
      const from = def(e.from), to = def(e.to);
      rt.emitTyped('block_changed', e.to ?? 'air', { at: e.at, from: e.from ?? null, to: e.to ?? null, by: e.by ?? null });
      if ((from?.light || 0) !== (to?.light || 0)) rt.emit('light_changed', { at: e.at, radius: Math.max(from?.light || 0, to?.light || 0) });
    });
  },
};
