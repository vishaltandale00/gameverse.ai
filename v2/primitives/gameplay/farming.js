// Farming on an editCells space: till tillable cells into farmland (with a hoe),
// plant seeds, water, grow one stage per day in season (var time.day, or an
// internal day of `daySec` seconds; var time.season), harvest a rolled yield,
// regrow perennials, wither out of season. Growing crops can show stage blocks
// in the cell above the farmland.
import { compare } from '../../kernel/logic.js';
import { give, take, count, bag } from './inventory.js';
import { item as itemDef, tokens, roll, cellDist, cellKey, cellOf, isVec, api as spaceApi, add, whoKey, actionCell } from './items-lib.js';

const KEY = 'gameplay.farming';
const parse = v => (isVec(v) ? { cell: v } : v || {});
const ABOVE = [0, 1, 0];
// Harvesting a target number of crops wins: a plot ending tests the count ('$target' is a number the content picks).
const WIN = { when: { count: 'harvested', gte: '$target' }, reads: { event: 'harvested', by: { actions: ['harvest'] } } };

export default {
  id: 'gameplay.farming',
  card: {
    // Its plots live in its store, not in cells or entities: the renderers draw them from its service (graphics/presentation.js).
    marks: { service: 'farming' },
    loop: { shows: ['cells', 'marks'], verbs: ['till', 'plant', 'water', 'harvest'], progress: ['tilled', 'planted', 'watered', 'harvested'], win: WIN },
    // The farm loop, played by an avatar on a cell space against the day clock (crops grow one stage a watered day and
    // wither out of season); no lose of its own. Its bot (v2/verify/strategies/farm.js) tills, plants, waters and
    // harvests through the controls a person uses.
    mode: { loop: 'farm', interaction: ['avatar-grid', 'avatar-realtime'], opponent: 'clock', space: ['engine.space.grid', 'engine.space.tilemap', 'engine.space.voxel', ['editCells']], needs: { content: ['content.items'], participants: null }, win: WIN, lose: { param: null }, bot: 'farm' },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "param", "param": "crops", "min": 2, "why": "farming needs crops: each names its produce item (and seed item) from content.items", "example": [{"item": "turnip", "seed": "turnip_seed", "days": 3}]},
      {"need": "items", "min": 4, "why": "crops need produce and seed items"},
    ],
    intent: 'Till soil with a hoe, plant seeds, water, grow crops one stage a day in season, harvest rolled yields, regrow perennials and wither crops out of season, on an editCells space.',
    views: ['1p', '3p', 'side', 'td', 'iso'],
    params: {
      crops: { type: 'list', default: [], min: 0, of: { type: 'object', fields: {
        item: { type: 'ref', to: 'item', required: true, effect: 'harvested produce' },
        seed: { type: 'ref', to: 'item', effect: 'item planted (default the produce itself)' },
        days: { type: 'integer', default: 3, min: 1, max: 365, effect: 'growing days to ripen' },
        seasons: { type: 'list', default: [], of: { type: 'string' }, effect: 'seasons it grows in (var time.season); [] = all' },
        yield: { type: 'json', default: 1, effect: 'count n or range [a, b]' },
        regrow: { type: 'integer', default: 0, min: 0, max: 365, effect: 'days to ripen again after harvest; 0 = harvesting removes it' },
        water: { type: 'boolean', default: true, effect: 'needs watering each day to grow' },
        block: { type: 'ref', to: 'block', effect: 'block shown above the farmland while it grows' },
        ripeBlock: { type: 'ref', to: 'block', effect: 'block shown when ripe (default block)' },
      } }, effect: 'crops' },
      tillable: { type: 'list', default: ['dirt', 'grass'], of: { type: 'string' }, effect: 'block ids (content.blocks ids) a hoe turns into farmland' },
      farmland: { type: 'string', default: 'farmland', effect: 'block of tilled soil (a content.blocks id)' },
      tool: { type: 'string', default: 'tool:hoe', effect: "item token needed to till ('' = bare hands)" },
      reach: { type: 'number', default: 4, min: 0.5, max: 32, unit: 'cells' },
      daySec: { type: 'number', default: 0, min: 0, unit: 's', effect: 'internal day length when no engine.time writes time.day; 0 = use time.day only' },
      seasonNames: { type: 'list', default: ['spring', 'summer', 'autumn', 'winter'], of: { type: 'string' }, effect: 'names for a numeric time.season' },
      rainWaters: { type: 'boolean', default: true, effect: "var weather = 'rain' waters every crop" },
      wither: { type: 'boolean', default: true, effect: 'crops die when the season leaves their seasons' },
    },
    provides: { events: ['tool_used', 'tilled', 'planted', 'planted:*', 'watered', 'ripened', 'ripened:*', 'harvested', 'harvested:*', 'withered', 'farm_denied'], actions: ['till', 'plant', 'water', 'harvest'], services: ['farming'] },
    requires: { capabilities: ['editCells'] },
    reads: ['content.items', 'content.blocks'],
  },
  logic(logic) {
    logic.predicate('crops', { test: (p, rt, c) => {
      const plots = Object.values(rt.store(KEY).plots || {}).filter(x => (!p.crop || x.crop === p.crop) && (!p.who || x.owner === whoKey(p.who, c)));
      return compare(plots.filter(x => p.crops === 'ripe' ? x.ripe : p.crops === 'growing' ? !x.ripe : true).length, p);
    } });
  },
  validate(config, doc, ctx, inst = {}) {
    const P = inst.path ? `${inst.path}.with` : undefined; // errors about this instance point at its `with`
    const errors = [], bl = new Set((doc.content?.blocks || []).map(b => b.id));
    if (bl.size && !bl.has(config.farmland)) errors.push({ code: 'farming_invalid', path: P, message: `farmland block '${config.farmland}' is not in content.blocks` });
    for (const t of config.tillable) if (bl.size && !bl.has(t)) errors.push({ code: 'farming_invalid', path: P, message: `tillable block '${t}' is not in content.blocks` });
    const y = c => c.yield; for (const c of config.crops) { const v = y(c); if (!(Number.isInteger(v) && v >= 0) && !(Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && v[0] <= v[1])) errors.push({ code: 'farming_invalid', path: P, message: `crop '${c.item}' yield must be n or [a, b]` }); }
    const seeds = config.crops.map(c => c.seed ?? c.item); if (new Set(seeds).size !== seeds.length) errors.push({ code: 'farming_invalid', path: P, message: 'two crops share a seed item' });
    return errors;
  },
  install(rt, config) {
    const st = () => { const s = rt.store(KEY); s.plots ??= {}; s.day ??= null; return s; };
    st(); // created at install, so reads later never add state
    const bySeed = new Map(config.crops.map(c => [c.seed ?? c.item, c])), byItem = new Map(config.crops.map(c => [c.item, c]));
    const day = () => (config.daySec > 0 ? Math.floor(rt.state.time / config.daySec) : rt.state.vars['time.day'] ?? 0);
    const season = () => { const s = rt.state.vars['time.season']; return typeof s === 'number' ? config.seasonNames[s % config.seasonNames.length] : s ?? null; };
    const inSeason = c => !c.seasons.length || season() == null || c.seasons.includes(season());
    const deny = (who, action, reason, at) => { rt.emit('farm_denied', { who, action, reason, at }); return false; };
    // Stage blocks sit above the farmland; only crop blocks are ever replaced or cleared.
    const isCrop = b => config.crops.some(k => k.block === b || k.ripeBlock === b);
    function show(sp, cell, plot) {
      const above = add(cell, ABOVE), cur = sp.getCell(above), c = plot && byItem.get(plot.crop);
      const want = c ? (plot.ripe ? c.ripeBlock ?? c.block : c.block) ?? null : null;
      if (want != null && cur !== want && (cur == null || isCrop(cur))) sp.setCell(above, want, rt, 'farming');
      else if (want == null && cur != null && isCrop(cur)) sp.setCell(above, null, rt, 'farming');
    }
    function at(who, v, action) {
      const e = rt.entity(who), sp = e && spaceApi(rt, e); if (!sp) return {};
      // No cell named: the ground cell the view puts in front of the player (actionCell: faced from above, below the feet from the side).
      const cell = isVec(v.cell) ? cellOf(v.cell) : isVec(e.at) ? actionCell(rt, e) : null;
      if (!cell) { deny(who, action, 'facing', null); return {}; }
      if (cellDist(rt, e, cell) > config.reach + 0.5) { deny(who, action, 'range', cell); return {}; }
      return { e, sp, cell, key: `${e.space}|${cellKey(cell)}` };
    }
    const hasTool = who => !config.tool || Object.keys(bag(rt, who)).find(id => tokens(itemDef(rt, id) || { id }).has(config.tool));
    function till(who, v) {
      const { sp, cell } = at(who, parse(v), 'till'); if (!sp) return false;
      const tool = hasTool(who); if (!tool) return deny(who, 'till', 'tool', cell);
      if (!config.tillable.includes(sp.getCell(cell))) return deny(who, 'till', 'soil', cell);
      sp.setCell(cell, config.farmland, rt, who);
      if (typeof tool === 'string') rt.emit('tool_used', { who, item: tool });
      rt.emit('tilled', { who, at: cell });
      return true;
    }
    function plant(who, v) {
      const p = parse(v), { e, sp, cell, key } = at(who, p, 'plant'); if (!sp) return false;
      const seed = p.item ?? Object.keys(bag(rt, who)).sort().find(id => bySeed.has(id));
      const crop = bySeed.get(seed); if (!crop || !count(rt, who, seed)) return deny(who, 'plant', 'seed', cell);
      if (sp.getCell(cell) !== config.farmland) return deny(who, 'plant', 'soil', cell);
      if (st().plots[key]) return deny(who, 'plant', 'occupied', cell);
      if (!inSeason(crop)) return deny(who, 'plant', 'season', cell);
      take(rt, who, seed, 1);
      st().plots[key] = { space: e.space, at: cell, crop: crop.item, growth: 0, watered: false, ripe: false, planted: day(), owner: who };
      show(sp, cell, st().plots[key]);
      rt.emitTyped('planted', crop.item, { who, at: cell, crop: crop.item });
      return true;
    }
    function water(who, v) {
      const { sp, cell, key } = at(who, parse(v), 'water'); if (!sp) return false;
      const plot = st().plots[key]; if (!plot) return deny(who, 'water', 'empty', cell);
      plot.watered = true; rt.emit('watered', { who, at: cell, crop: plot.crop });
      return true;
    }
    function harvest(who, v) {
      const { sp, cell, key } = at(who, parse(v), 'harvest'); if (!sp) return false;
      const plot = st().plots[key]; if (!plot) return deny(who, 'harvest', 'empty', cell);
      if (!plot.ripe) return deny(who, 'harvest', 'unripe', cell);
      const crop = byItem.get(plot.crop), n = roll(rt, crop.yield, 1);
      give(rt, who, crop.item, n);
      rt.emitTyped('harvested', crop.item, { who, at: cell, crop: crop.item, count: n });
      if (crop.regrow > 0) { plot.ripe = false; plot.growth = Math.max(0, crop.days - crop.regrow); show(sp, cell, plot); }
      else { delete st().plots[key]; show(sp, cell, null); }
      return true;
    }
    rt.action('till', (v, rt) => till('player', v));
    rt.action('plant', (v, rt) => plant('player', v));
    rt.action('water', (v, rt) => water('player', v));
    rt.action('harvest', (v, rt) => harvest('player', v));
    rt.system('rules', rt => {
      const s = st(), d = day();
      if (s.day == null) { s.day = d; return; }
      if (d <= s.day) return;
      const passed = d - s.day; s.day = d;
      const rain = config.rainWaters && rt.state.vars.weather === 'rain';
      for (const [key, plot] of Object.entries(s.plots).sort()) {
        const crop = byItem.get(plot.crop), sp = rt.space(plot.space);
        for (let i = 0; i < passed && s.plots[key]; i++) {
          if (!inSeason(crop) && config.wither) { delete s.plots[key]; show(sp, plot.at, null); rt.emit('withered', { at: plot.at, crop: plot.crop }); break; }
          if (!plot.ripe && (!crop.water || plot.watered || rain)) {
            plot.growth++;
            if (plot.growth >= crop.days) { plot.ripe = true; show(sp, plot.at, plot); rt.emitTyped('ripened', plot.crop, { at: plot.at, crop: plot.crop }); }
          }
          plot.watered = false;
        }
      }
    }, KEY);
    rt.options(rt => {
      const out = [];
      for (const plot of Object.values(st().plots).sort((a, b) => (a.at.join() < b.at.join() ? -1 : 1))) {
        if (plot.space !== rt.player()?.space) continue;
        if (plot.ripe) out.push({ label: `harvest ${plot.crop} at ${plot.at.join(',')}`, actions: { harvest: { cell: plot.at } } });
        else if (!plot.watered && byItem.get(plot.crop).water) out.push({ label: `water ${plot.crop} at ${plot.at.join(',')}`, actions: { water: { cell: plot.at } } });
      }
      return out.slice(0, 8);
    });
    // marks (card.marks): each plot of a space as a person sees it: its crop, growth stage of the days to ripen, ripe, watered.
    const marks = sid => Object.values(st().plots).filter(p => p.space === sid).sort((a, b) => (a.at.join() < b.at.join() ? -1 : 1))
      .map(p => ({ at: p.at.slice(), kind: p.crop, stage: Math.min(p.growth, byItem.get(p.crop)?.days ?? p.growth), stages: byItem.get(p.crop)?.days ?? 1, ready: p.ripe, watered: p.watered }));
    rt.provide('farming', { plots: () => structuredClone(Object.values(st().plots)), day, marks });
  },
};
