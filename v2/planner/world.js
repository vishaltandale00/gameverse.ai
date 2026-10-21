// A substantive first-playable world (ARCHITECTURE.md §4 step 2: "the world is generated procedurally
// from the outline's generator params"). A space the player moves through needs something in it: a
// document can be valid, verified and completable while its only space is an empty map or a flat void.
//
// What fits where is declared statically on the cards, like types, never discovered by running games:
//   - generator cards: `card.spaces: [space ids]` (the spaces it targets) and `card.provides.content:
//     [kinds]` (what it builds: 'cells', 'terrain', 'road-network', 'structures', 'course', 'rooms',
//     'zones', 'entities', 'water', 'props', 'biomes', 'caves', 'ores');
//   - space cards: `card.needs: { content: [kinds], alternatives?: [[kinds]...] }`, the world content the space
//     needs to be playable: every kind of `content` (the default), or every kind of one alternative set (a mesh3d
//     world is terrain + a road network, or rooms). The idea chooses among declared sets only: an alternative is
//     planned when a generator providing it is lexically relevant to the idea (the selection's own relevance).
// generatorsFor and planWorld read only those declarations (plus the param schemas: a generator with
// required params is usable only through its `scaffold(space, doc, ctx)` hook). furnishWorld covers a
// space's unmet needs with the planned generators, each configured by its scaffold from the space's zones
// and the document's movement envelope, preflighted and booted; booting is the backstop that the world
// really has content (cells, terrain, objects, roads, entities, linked zones). Zero model calls.
import { preflight } from '../kernel/document.js';
import { createWorld } from '../kernel/world.js';
import { movementEnvelope } from '../primitives/gameplay/move-lib-envelope.js';
import { defaultsOf, isGenerator } from './catalog.js';
import { relevance, LEXICAL_ACCEPT } from './select.js';

export const WORLD_VERSION = 'world/0.2';
const MAX_CELLS_SCANNED = 4e6;

/** Capabilities a space instance provides with its configuration. */
export function spaceCaps(registry, space) {
  const p = registry.get(space.use); if (!p) return [];
  const config = { ...defaultsOf(p.card), ...(space.with || {}) };
  try { return p.capabilities ? p.capabilities(config) : p.card.provides?.capabilities || []; } catch { return p.card.provides?.capabilities || []; }
}

// ---------- static declarations ----------
/** World content a space kind needs to be playable by default (space card `needs.content`). */
export const spaceNeeds = (registry, use) => registry.get(use)?.card.needs?.content || [];
/** Every content set that makes a space kind playable: needs.content first, then needs.alternatives. */
export const needSets = (registry, use) => { const n = registry.get(use)?.card.needs; return n?.content?.length ? [n.content, ...(n.alternatives || []).filter(a => Array.isArray(a) && a.length)] : []; };
/** The idea a document states (title, logline, premise): text for choosing among declared need sets. */
export const intentOf = doc => [doc?.title, doc?.logline, doc?.plot?.premise].filter(x => typeof x === 'string').join('. ');
/** World content a generator builds (generator card `provides.content`). */
export const contentOfGenerator = (registry, id) => registry.get(id)?.card.provides?.content || [];
/** Whether a generator's card declares this space kind among its targets (generator card `spaces`). */
export const targets = (registry, id, use) => (registry.get(id)?.card.spaces || []).includes(use);
const requiredParams = card => Object.entries(card.params || {}).filter(([, s]) => s.required && s.default === undefined).map(([k]) => k);
/** A generator the planner can configure on its own: a scaffold hook, or no required params. */
export const configurable = (registry, id) => { const p = registry.get(id); return Boolean(p) && (typeof p.scaffold === 'function' || !requiredParams(p.card).length); };
/** Content kinds the outline itself authors in every space it writes (zones with their exits). */
export const OUTLINE_AUTHORS = ['zones'];

/**
 * Generators that target this space kind (card.spaces), configurable by the planner, ranked by the
 * declarations: most of `want` (default: the space's needs) covered, then a scaffold hook (configures
 * itself from the document), then views that include `view`, then the narrowest target list, then id.
 * -> [{ id, covers: [kinds], score }]
 */
export function generatorsFor(registry, space, view = null, want = null) {
  const need = want ?? spaceNeeds(registry, space.use);
  return registry.ids('engine').filter(id => isGenerator(id) && targets(registry, id, space.use) && configurable(registry, id)).map(id => {
    const p = registry.get(id), card = p.card, covers = contentOfGenerator(registry, id).filter(c => need.includes(c));
    const views = card.views || ['any'], fitsView = view && (views.includes(view) || views.includes('any')) ? 1 : 0;
    return { id, covers, rank: [covers.length, typeof p.scaffold === 'function' ? 1 : 0, fitsView, -(card.spaces || []).length], score: covers.length * 100 + (typeof p.scaffold === 'function' ? 10 : 0) + fitsView * 4 - (card.spaces || []).length };
  }).sort(cmpRank).map(({ rank, ...g }) => g);
}
const cmpRank = (a, b) => { for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return b.rank[i] - a.rank[i]; return a.id.localeCompare(b.id); };

/**
 * The need set a space's world aims at: the first set `have` already satisfies; else a declared alternative whose
 * best generator is relevant to `intent` (≥ LEXICAL_ACCEPT and above the default's); else needs.content.
 */
export function needSetFor(registry, space, { have = [], intent = '' } = {}) {
  const sets = needSets(registry, space.use);
  if (!sets.length) return [];
  const met = sets.find(set => set.every(k => have.includes(k)));
  if (met) return met;
  if (!intent || sets.length < 2) return sets[0];
  const score = set => Math.max(0, ...generatorsFor(registry, space, null, set).filter(g => g.covers.length).map(g => relevance({ verb: '', description: intent }, { id: g.id, ...registry.get(g.id).card })));
  const base = score(sets[0]), best = sets.slice(1).map(set => ({ set, s: score(set) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s >= LEXICAL_ACCEPT && best.s > base ? best.set : sets[0];
}

/**
 * Static plan for a space: generators (greedy, by generatorsFor's ranking) until every kind of its need set
 * (needSetFor) not in `have` is covered. -> { generators: [ids], unmet: [kinds], set: [kinds] }
 */
export function planWorld(registry, space, { view = null, have = [], exclude = [], intent = '' } = {}) {
  const set = needSetFor(registry, space, { have, intent });
  let left = set.filter(c => !have.includes(c));
  const picks = [];
  while (left.length) {
    const best = generatorsFor(registry, space, view, left).find(g => g.covers.length && !picks.includes(g.id) && !exclude.includes(g.id));
    if (!best) break;
    picks.push(best.id); left = left.filter(c => !best.covers.includes(c));
  }
  return { generators: picks, unmet: left, set };
}
/** A space kind whose needs the registered generators can cover (zones are authored by the outline). -> unmet kinds */
export const unfurnishable = (registry, use) => planWorld(registry, { use }, { have: OUTLINE_AUTHORS }).unmet;

// ---------- which spaces need a world ----------
const hasEnvelope = p => Boolean(p && (p.card?.envelope || p.envelope));
/** Whether a primitive moves things through a space: a movement envelope, or a continuous control (walk, steer, drive). */
export const isMovement = (registry, id) => { const p = registry.get(id); return hasEnvelope(p) || Object.values(p?.card?.actionSpace || {}).some(a => a?.kind === 'continuous'); };
/** A space kind that declares world needs. */
export const needsWorld = (registry, space) => needSets(registry, space.use).length > 0;
/**
 * Spaces whose world must not be empty: spaces that declare needs and that a movement primitive moves
 * something through (bound to that space or to the first one). A board or card game with no movement
 * primitive may legitimately start empty.
 */
export function spacesNeedingWorld(doc, registry) {
  const first = doc.spaces?.[0]?.id;
  const moved = new Set((doc.systems || []).filter(s => isMovement(registry, s.use)).map(s => s.space ?? first));
  return (doc.spaces || []).map((space, index) => ({ space, index })).filter(({ space }) => moved.has(space.id) && needsWorld(registry, space));
}

// ---------- what a space has ----------
const linkedZones = zones => (zones || []).filter(z => Array.isArray(z.exits) && z.exits.length).length;
/**
 * Content a document space has, statically: what its generators declare, plus what the document authors
 * ('zones': a single zone or zones joined by exits). With a booted world, authored cells and entities count too.
 */
export function worldContent(doc, registry, space, rt = null) {
  const have = new Set((space.generators || []).flatMap(g => contentOfGenerator(registry, g.use)));
  const zones = space.zones || [];
  if (zones.length === 1 || linkedZones(zones)) have.add('zones');
  if (rt) { const c = contentOf(rt, space.id); if (c?.cells > 0) have.add('cells'); if (c?.entities > 0) have.add('entities'); }
  return [...have];
}

/**
 * Measured content of a booted space (the backstop): non-empty cells (cell spaces), entities other than the
 * player, generated terrain, placed objects and road edges (3D world models), zones joined by exits.
 * null when the space does not exist. `cells` is null where cells can't be measured.
 */
export function contentOf(rt, spaceId) {
  const api = rt.space(spaceId);
  if (!api) return null;
  const entities = Object.values(rt.state.entities).filter(e => e.space === spaceId && e.id !== 'player').length;
  let cells = null;
  const b = typeof api.bounds === 'function' ? api.bounds() : api.size ? { min: api.size.map(() => 0), max: api.size } : null;
  if (typeof api.cellsIn === 'function' && b?.min && b?.max && b.max.every(Number.isFinite)) {
    const volume = b.max.reduce((v, x, i) => v * Math.max(0, x - b.min[i]), 1);
    if (volume <= MAX_CELLS_SCANNED) {
      const box = [b.min, b.max.map(x => x - 1)];
      const layers = Array.isArray(api.layers) ? api.layers : [undefined];
      cells = 0;
      for (const l of layers) { cells += api.cellsIn(box, l).length; if (cells) break; }
    }
  }
  const out = { cells, entities };
  if (typeof api.model === 'function') { // a 3D world model: terrain field, placed objects, road network
    const m = api.model();
    out.terrain = Boolean(m?.has?.('height'));
    out.objects = m?.objects?.length ?? 0;
    out.roads = m?.data?.roads?.edges?.length ?? 0;
    out.fields = m?.fields?.size ?? 0; // height, water, biome... fields generators defined
    out.layers = (m?.layers?.length ?? 0) + (m?.objectLayers?.length ?? 0); // voxel cell passes and lazy object layers (scatter...)
  }
  const zones = [...(rt.doc.spaces.find(s => s.id === spaceId)?.zones || []), ...(Array.isArray(rt.state.spaces[spaceId]?.zones) ? rt.state.spaces[spaceId].zones : [])];
  const linked = linkedZones(zones);
  if (linked) out.linked = linked;
  return out;
}
/** Nothing measured in the space. */
export const isEmpty = c => !(c && (c.cells > 0 || c.entities > 0 || c.terrain || c.objects > 0 || c.roads > 0 || c.linked > 0 || c.layers > 0));

/** Generation problems for one booted space: 2D generators (the shared `generation` service) and the 3D world model. */
export function generationProblems(rt, doc, spaceId) {
  const index = doc.spaces.findIndex(s => s.id === spaceId);
  const flat = rt.hasService?.('generation') ? (rt.service('generation').problems() || []).filter(p => String(p.path || '').startsWith(`spaces[${index}]`)) : [];
  const model = (rt.state.spaces[spaceId]?.generated?.problems || []).map(p => ({ severity: 'error', ...p }));
  return [...flat, ...model];
}

const boot = (doc, registry, logic, seed, frames = 3) => {
  const rt = createWorld(doc, registry, logic, { seed });
  for (let i = 0; i < frames && rt.state.status === 'playing'; i++) rt.step();
  return rt;
};

/**
 * world_empty (nothing in a space that needs a world, error), world_incomplete (a declared need unmet, warning)
 * and the extent checks (extentProblems: generated content that misses part of its cell space or leaves it).
 */
export function worldProblems(rt, doc, registry) {
  const out = extentProblems(doc, registry);
  for (const { space, index } of spacesNeedingWorld(doc, registry)) {
    const c = contentOf(rt, space.id); if (!c) continue;
    const have = worldContent(doc, registry, space, rt), unmet = needSetFor(registry, space, { have, intent: intentOf(doc) }).filter(k => !have.includes(k));
    if (!unmet.length) continue;
    const plan = planWorld(registry, space, { view: doc.views?.primary, have, intent: intentOf(doc) });
    const hint = plan.generators.length ? `add ${plan.generators.join(' + ')} in spaces[${index}].generators (it builds ${unmet.join(', ')})` : `no registered generator targets ${space.use} with ${unmet.join(', ')}: author that content`;
    if (isEmpty(c)) out.push({ code: 'world_empty', path: `spaces[${index}]`, severity: 'error', stage: 'world', space: space.id, missing: unmet,
      message: `space '${space.id}' (${space.use}) is empty: it needs ${unmet.join(' and ')} and nothing builds it, so the player moves through a void`, hint });
    else out.push({ code: 'world_incomplete', path: `spaces[${index}]`, severity: 'warning', stage: 'world', space: space.id, missing: unmet,
      message: `space '${space.id}' (${space.use}) lacks ${unmet.join(' and ')}, which ${space.use} declares it needs`, hint });
  }
  return out;
}

const envelopeFor = (doc, registry, space) => {
  const gravity = Math.abs(Number(Array.isArray(space.with?.gravity) ? space.with.gravity[1] : space.with?.gravity)) || undefined;
  return movementEnvelope(doc, registry, doc.player?.abilities || [], gravity ? { gravity } : {});
};

/**
 * furnishWorld(doc, registry, logic, { seed, rt? }) -> { doc, added: [{ space, use, problems }], fixes, problems, ms }
 * Covers every unmet need of every space that needs a world with the planned generators (planWorld's
 * ranking), each configured by its scaffold. A candidate whose scaffold declines, that fails preflight or
 * whose world does not grow is skipped for the next one covering the same need; among those that work, the
 * first with a clean generation proof wins, else the one with the fewest generation errors. Never mutates
 * its input. `problems` are the world problems left. A world that does not boot is returned unchanged.
 */
export function furnishWorld(input, registry, logic, { seed, rt = null } = {}) {
  const started = performance.now();
  const done = (doc, added, fixes, problems) => ({ doc, added, fixes, problems, ms: Math.round(performance.now() - started), version: WORLD_VERSION });
  const pre = preflight(input, registry, logic);
  if (!pre.ok || !spacesNeedingWorld(pre.doc, registry).length) return done(input, [], [], []);
  try { rt ??= boot(pre.doc, registry, logic, seed); } catch { return done(input, [], [], []); }
  if (!worldProblems(rt, pre.doc, registry).length) return done(input, [], [], []);
  let doc = structuredClone(input), current = pre.doc, world = rt;
  const added = [], fixes = [];
  for (const { space: s0, index } of spacesNeedingWorld(pre.doc, registry)) {
    const had = worldContent(current, registry, current.spaces[index], world);
    let left = needSetFor(registry, s0, { have: had, intent: intentOf(current) }).filter(k => !had.includes(k));
    const tried = new Set();
    while (left.length) {
      const space = doc.spaces[index], before = contentOf(world, space.id);
      const envelope = envelopeFor(current, registry, space);
      let kept = null;
      for (const cand of generatorsFor(registry, space, doc.views?.primary, left).filter(g => g.covers.length && !tried.has(g.id))) {
        tried.add(cand.id);
        const p = registry.get(cand.id);
        let made;
        try { made = typeof p.scaffold === 'function' ? p.scaffold(space, doc, { envelope, reserve: reservedRegions(current, registry, space.id), registry }) : { with: {} }; } catch { made = null; }
        if (!made) continue;
        const trial = structuredClone(doc), gen = { use: cand.id };
        (trial.spaces[index].generators ??= []).push(gen);
        applyScaffold(trial, index, gen, made, { registry });
        const p2 = preflight(trial, registry, logic);
        if (!p2.ok) continue;
        let grew = false, generation = [], booted = null;
        try {
          booted = boot(p2.doc, registry, logic, seed);
          const c = contentOf(booted, space.id);
          grew = Boolean(c) && (isEmpty(before) ? !isEmpty(c) : grows(before, c));
          generation = generationProblems(booted, p2.doc, space.id).filter(x => x.severity === 'error');
        } catch { grew = false; }
        if (!grew) continue;
        if (!kept || generation.length < kept.generation.length) kept = { trial, pre: p2.doc, rt: booted, use: cand.id, covers: cand.covers, generation };
        if (!generation.length) break;
      }
      if (!kept) break;
      doc = kept.trial; current = kept.pre; world = kept.rt;
      left = left.filter(k => !kept.covers.includes(k));
      added.push({ space: s0.id, use: kept.use, covers: kept.covers, problems: kept.generation.map(x => x.code) });
      fixes.push({ code: 'world_empty', path: `spaces[${index}].generators`, action: `added ${kept.use} to build ${kept.covers.join(', ')} in space '${s0.id}'` });
    }
  }
  return done(doc, added, fixes, worldProblems(world, current, registry));
}
/** Whether measured content b has more of anything than a. */
export const grows = (a, b) => ['cells', 'entities', 'objects', 'roads', 'linked', 'fields', 'layers'].some(k => (b?.[k] ?? 0) > (a?.[k] ?? 0)) || (Boolean(b?.terrain) && !a?.terrain);

/**
 * Add one generator instance to spaces[index] of a copy of doc: with `config`, or configured by its scaffold
 * (null when the scaffold declines). -> doc | null
 */
export function addGenerator(input, registry, index, use, config = undefined) {
  const doc = structuredClone(input), space = doc.spaces[index], p = registry.get(use);
  if (!space || !p) return null;
  const gen = { use };
  (space.generators ??= []).push(gen);
  if (config !== undefined) { gen.with = structuredClone(config); return doc; }
  if (typeof p.scaffold !== 'function') return doc;
  let made = null;
  try { made = p.scaffold(space, doc, { envelope: envelopeFor(doc, registry, space), reserve: reservedRegions(doc, registry, space.id), registry }); } catch { made = null; }
  if (!made) return null;
  applyScaffold(doc, index, gen, made, { registry });
  return doc;
}

/**
 * Cell regions of a space that other primitives own (a falling-piece board, a match grid...), as rects
 * [x0,y0,x1,y1) in space cells, from param metadata: a param schema with `region: 'board'` ({at, size, axes, fall},
 * as puzzle-lib-board's boardParam) or `region: 'rect'` ([x0,y0,x1,y1)), or card.regions: [{ param, kind }].
 * Generators leave them clear and keep them reachable.
 */
export function reservedRegions(doc, registry, spaceId) {
  const first = doc.spaces?.[0]?.id, out = [];
  for (const inst of doc.systems || []) {
    if ((inst.space ?? first) !== spaceId) continue;
    const card = registry.get(inst.use)?.card; if (!card) continue;
    const defaults = defaultsOf(card), given = inst.with || {};
    const config = Object.fromEntries(Object.keys({ ...defaults, ...given }).map(k => [k, given[k] && typeof given[k] === 'object' && !Array.isArray(given[k]) && defaults[k] && typeof defaults[k] === 'object' ? { ...defaults[k], ...given[k] } : given[k] ?? defaults[k]]));
    const claims = [...(card.regions || []).map(r => [r.param, r.kind]), ...Object.entries(card.params || {}).filter(([, s]) => s.region).map(([k, s]) => [k, s.region])];
    for (const [param, kind] of claims) {
      const rect = regionRect(kind, config[param]);
      if (rect && !out.some(r => r.join() === rect.join())) out.push(rect);
    }
  }
  return out;
}
function regionRect(kind, v) {
  if (kind === 'rect') return Array.isArray(v) && v.length === 4 && v.every(Number.isFinite) && v[2] > v[0] && v[3] > v[1] ? v.slice() : null;
  if (kind !== 'board' || !v || !Array.isArray(v.at) || !Array.isArray(v.size)) return null;
  const [a, b] = v.axes || [0, 1], [w, h] = v.size;
  if (![a, b].every(i => i === 0 || i === 1) || a === b || !(w > 0 && h > 0)) return null;
  const across = [v.at[a], v.at[a] + w], vertical = (v.fall ?? -1) < 0 ? [v.at[b], v.at[b] + h] : [v.at[b] - h + 1, v.at[b] + 1];
  const [xs, ys] = a === 0 ? [across, vertical] : [vertical, across];
  return [xs[0], ys[0], xs[1], ys[1]];
}

/**
 * Apply a scaffold result to one generator instance of a document: `with` (generator config), `content`
 * (sections appended by id), `start` (the player's start in that space) and `space.with` (space params the
 * document leaves unset or at their card default, e.g. a track's length from its zones).
 */
function applyScaffold(doc, spaceIndex, gen, made, { start = true, registry = null } = {}) {
  if (Object.keys(made.with || {}).length) gen.with = { ...made.with, ...(gen.with || {}) };
  for (const [section, list] of Object.entries(made.content || {})) {
    doc.content ??= {};
    const have = Array.isArray(doc.content[section]) ? doc.content[section] : (doc.content[section] = []);
    for (const x of list) if (!have.some(h => h?.id === x.id)) have.push(x);
  }
  const space = doc.spaces[spaceIndex];
  if (made.space?.with) {
    const defaults = registry ? defaultsOf(registry.get(space.use)?.card || {}) : {};
    for (const [k, v] of Object.entries(made.space.with)) {
      const cur = space.with?.[k];
      if (cur === undefined || JSON.stringify(cur) === JSON.stringify(defaults[k])) (space.with ??= {})[k] = v;
    }
  }
  if (start && Array.isArray(made.start) && doc.player && (doc.player.space ?? doc.spaces[0].id) === space.id) doc.player.at = made.start;
}

// ---------- extents: what part of a space its generators fill ----------
// A generator card declares `provides.extent`: 'space' (it fills the whole space: terrain fields, graph maps),
// 'own' (it fills a rect given by its params: the primitive's `extentOf(config, space)` -> [x0, y0, x1, y1), and
// `fit(config, rect, space)` -> params that make it fill rect, or null) or 'overlay' (it adds to what others lay
// down and fills nothing of its own: roads, props, courses, pieces). A space's extent is its param declared
// `scale: 'world'` (a [w, h] list: [0, 0, w, h)).

/** [0, 0, w, h) from the space's world-scale list param; null when it has none (voxel, graph, none, a track's length). */
export function spaceExtent(registry, space) {
  const card = registry.get(space.use)?.card; if (!card) return null;
  const entry = Object.entries(card.params || {}).find(([, s]) => s.scale === 'world'); if (!entry) return null;
  const v = space.with?.[entry[0]] ?? entry[1].default;
  return Array.isArray(v) && v.length >= 2 && v.slice(0, 2).every(x => Number.isFinite(x) && x > 0) ? [0, 0, v[0], v[1]] : null;
}
/** A generator instance's declared extent: { kind: 'space'|'own'|'overlay', rect } (rect for 'own' when its params give one). */
export function extentOfGenerator(registry, gen, space) {
  const p = registry.get(gen.use), kind = p?.card.provides?.extent || 'overlay';
  if (kind !== 'own') return { kind, rect: null };
  let rect = null; try { rect = typeof p.extentOf === 'function' ? p.extentOf(gen.with || {}, space) : null; } catch { rect = null; }
  return { kind, rect: Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) ? rect : null };
}
const cellWorld = (registry, space) => spaceNeeds(registry, space.use).includes('cells');
/** Cells of rect `area` covered by none of `rects` (counted on the integer grid; capped). */
function uncovered(area, rects) {
  const [x0, y0, x1, y1] = area.map(Math.round); let n = 0;
  if ((x1 - x0) * (y1 - y0) > MAX_CELLS_SCANNED) return 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!rects.some(r => x >= r[0] && x < r[2] && y >= r[1] && y < r[3])) n++;
  return n;
}
/**
 * The composition check for extents (static): a generator's own extent must lie inside its space, and in a cell
 * space whose content comes from own-extent generators those extents must cover the whole space, otherwise the
 * rest is an empty void that tunnels, exits and edges open into. -> problems (world_extent_outside, world_extent_mismatch)
 */
export function extentProblems(doc, registry) {
  const out = [];
  (doc.spaces || []).forEach((space, i) => {
    const area = spaceExtent(registry, space), gens = (space.generators || []).map((g, j) => ({ g, j, ...extentOfGenerator(registry, g, space) }));
    if (!area || !gens.length) return;
    for (const e of gens) if (e.rect && (e.rect[0] < area[0] || e.rect[1] < area[1] || e.rect[2] > area[2] || e.rect[3] > area[3]))
      out.push({ code: 'world_extent_outside', path: `spaces[${i}].generators[${e.j}]`, severity: 'error', stage: 'world', space: space.id,
        message: `${e.g.use} fills [${e.rect.join(', ')}), outside the ${area[2]}×${area[3]} space '${space.id}'`, hint: `fit it to the space (its fit hook) or enlarge the space` });
    if (!cellWorld(registry, space) || gens.some(e => e.kind === 'space')) return;
    const own = gens.filter(e => e.kind === 'own' && e.rect);
    if (!own.length) return;
    const gap = uncovered(area, own.map(e => e.rect));
    if (gap > 0) out.push({ code: 'world_extent_mismatch', path: `spaces[${i}]`, severity: 'error', stage: 'world', space: space.id, uncovered: gap,
      message: `${own.map(e => `${e.g.use} fills [${e.rect.join(', ')})`).join('; ')} of the ${area[2]}×${area[3]} space '${space.id}': ${gap} cells are an empty void its openings lead into`,
      hint: 'fit the generator to the space extent, or size the space to the generated extent' });
  });
  return out;
}
/**
 * Make generated extents match their spaces (mutates doc): a cell space filled by one own-extent generator that
 * misses part of it, or one that reaches outside it, is re-fitted through the generator's `fit` hook; when the
 * generator can't be fitted, a space whose zones all lie inside the generated extent is resized to it. -> fixes
 */
export function fitExtents(doc, registry) {
  const fixes = [];
  (doc.spaces || []).forEach((space, i) => {
    const area = spaceExtent(registry, space); if (!area) return;
    const gens = (space.generators || []).map((g, j) => ({ g, j, ...extentOfGenerator(registry, g, space) }));
    const own = gens.filter(e => e.kind === 'own' && e.rect);
    const outside = own.filter(e => e.rect[0] < area[0] || e.rect[1] < area[1] || e.rect[2] > area[2] || e.rect[3] > area[3]);
    const short = cellWorld(registry, space) && !gens.some(e => e.kind === 'space') && own.length === 1 && uncovered(area, [own[0].rect]) > 0;
    for (const e of short ? own : outside) {
      const p = registry.get(e.g.use); let fit = null;
      try { fit = typeof p.fit === 'function' ? p.fit(e.g.with || {}, area, space) : null; } catch { fit = null; }
      if (fit) { e.g.with = { ...(e.g.with || {}), ...fit }; fixes.push({ code: 'world_extent_fit', path: `spaces[${i}].generators[${e.j}]`, action: `fitted ${e.g.use} from [${e.rect.join(', ')}) to the ${area[2]}×${area[3]} space` }); continue; }
      const [x0, y0, x1, y1] = e.rect, key = Object.entries(registry.get(space.use).card.params || {}).find(([, s]) => s.scale === 'world')?.[0];
      const inside = (space.zones || []).every(z => !Array.isArray(z.rect) || (z.rect[0] >= x0 && z.rect[1] >= y0 && z.rect[2] <= x1 && z.rect[3] <= y1));
      if (key && x0 === 0 && y0 === 0 && own.length === 1 && inside) { space.with = { ...(space.with || {}), [key]: [x1, y1] }; fixes.push({ code: 'world_extent_resize', path: `spaces[${i}].with.${key}`, action: `sized space '${space.id}' to the ${x1}×${y1} that ${e.g.use} fills` }); }
    }
  });
  return fixes;
}

// ---------- scaling a world ----------
function mulDeep(v, k, s) {
  if (Array.isArray(v)) { const item = s?.type === 'list' ? s.of : s; return v.map(x => mulDeep(x, k, item)); }
  if (typeof v !== 'number') return v;
  let x = v * k;
  if (s?.type === 'integer') x = Math.round(x);
  if (typeof s?.min === 'number') x = Math.max(s.min, x);
  if (typeof s?.max === 'number') x = Math.min(s.max, x);
  return +x.toFixed(4);
}
/** Scale every param a schema declares `scale: 'world'` (lengths ×f; `per: 'area'` counts ×f²), recursing into list items and object fields. */
function scaleParams(params, config, f, { defaults = true } = {}) {
  const out = { ...config }, changed = [];
  for (const [k, s] of Object.entries(params || {})) {
    const has = out[k] !== undefined, v = has ? out[k] : defaults ? s.default : undefined;
    if (v === undefined) continue;
    const next = scaleValue(s, v, f);
    if (JSON.stringify(next) !== JSON.stringify(v)) { out[k] = next; changed.push(k); }
  }
  return { config: out, changed };
}
function scaleValue(s, v, f) {
  if (s?.scale === 'world') return mulDeep(v, s.per === 'area' ? f * f : f, s);
  if (s?.type === 'list' && s.of && Array.isArray(v)) return v.map(x => scaleValue(s.of, x, f));
  if (s?.type === 'object' && s.fields && v && typeof v === 'object' && !Array.isArray(v)) return { ...v, ...scaleParams(s.fields, v, f, { defaults: false }).config };
  return v;
}
/** Which axes of a position scale with the world: a track's progress, a 3D world's x and z, every axis of a 2D one. */
function posAxes(registry, space) {
  const entry = Object.entries(registry.get(space.use)?.card.params || {}).find(([, s]) => s.scale === 'world');
  if (entry && entry[1].type === 'number') return [0];
  const caps = spaceCaps(registry, space);
  return caps.includes('heightfield') || caps.includes('chunks') ? [0, 2] : null;
}
const scalePos = (p, f, axes) => (Array.isArray(p) ? p.map((v, i) => (typeof v === 'number' && (!axes || axes.includes(i)) ? +(v * f).toFixed(4) : v)) : p);
function scaleZone(z, f, axes) {
  const out = { ...z };
  if (Array.isArray(z.rect)) out.rect = z.rect.map(v => +(v * f).toFixed(4));
  if (Array.isArray(z.range)) out.range = z.range.map(v => +(v * f).toFixed(4));
  if (z.bounds?.min && z.bounds?.max) out.bounds = { ...z.bounds, min: scalePos(z.bounds.min, f, z.bounds.min.length === 3 ? [0, 2] : null), max: scalePos(z.bounds.max, f, z.bounds.max.length === 3 ? [0, 2] : null) };
  if (Array.isArray(z.center)) { out.center = z.center.map(v => +(v * f).toFixed(4)); if (typeof z.r === 'number') out.r = +(z.r * f).toFixed(4); }
  if (Array.isArray(z.polygon)) out.polygon = z.polygon.map(p => p.map(v => +(v * f).toFixed(4)));
  for (const k of ['spawn', 'at']) if (Array.isArray(z[k])) out[k] = scalePos(z[k], f, z[k].length === 3 ? axes ?? [0, 2] : null);
  return out;
}
/**
 * scaleWorld(doc, registry, factor) -> { doc, changes: [{ path, params }], unscaled: [generator ids] }
 * "A bigger world": grows the content, not only the container. Every space's world-scale param (its extent),
 * its zones and the player's start scale by `factor` along the world's axes; every generator's params declared
 * `scale: 'world'` scale with it (lengths ×factor, `per: 'area'` counts ×factor²); a generator that fills its own
 * extent is then re-fitted to the grown space (`fit`). Generators with nothing to scale are listed in `unscaled`.
 * Never mutates its input. Zero model calls.
 */
export function scaleWorld(input, registry, factor) {
  const doc = structuredClone(input), changes = [], unscaled = [], f = Number(factor);
  if (!(f > 0) || f === 1) return { doc, changes, unscaled };
  (doc.spaces || []).forEach((space, i) => {
    const card = registry.get(space.use)?.card; if (!card) return;
    const axes = posAxes(registry, space);
    const s = scaleParams(Object.fromEntries(Object.entries(card.params || {}).filter(([, x]) => x.scale === 'world')), space.with || {}, f);
    if (s.changed.length) { space.with = s.config; changes.push({ path: `spaces[${i}].with`, params: s.changed }); }
    if (Array.isArray(space.zones) && space.zones.length) { space.zones = space.zones.map(z => scaleZone(z, f, axes)); changes.push({ path: `spaces[${i}].zones`, params: ['geometry'] }); }
    if (doc.player && (doc.player.space ?? doc.spaces[0].id) === space.id && Array.isArray(doc.player.at)) { doc.player.at = scalePos(doc.player.at, f, axes); changes.push({ path: 'player.at', params: ['at'] }); }
    const area = spaceExtent(registry, space);
    (space.generators || []).forEach((gen, j) => {
      const p = registry.get(gen.use); if (!p) return;
      const g = scaleParams(p.card.params, gen.with || {}, f, { defaults: false }), done = [...g.changed];
      gen.with = g.config;
      if (p.card.provides?.extent === 'own' && area && typeof p.fit === 'function') {
        let fit = null; try { fit = p.fit(gen.with, area, space); } catch { fit = null; }
        if (fit) { gen.with = { ...gen.with, ...fit }; done.push(...Object.keys(fit).filter(k => !done.includes(k))); }
      }
      if (done.length) changes.push({ path: `spaces[${i}].generators[${j}].with`, params: done }); else unscaled.push(gen.use);
    });
  });
  return { doc, changes, unscaled };
}

/**
 * Fill the params of generator instances that a selection added without them (the skeleton lists `{use}` only)
 * through each generator's `scaffold` hook, then fit generated extents to their spaces (fitExtents).
 * Mutates and returns `doc`; -> fixes.
 */
export function configureGenerators(doc, registry) {
  const fixes = [];
  (doc.spaces || []).forEach((space, i) => (space.generators || []).forEach((gen, j) => {
    const p = registry.get(gen.use), card = p?.card;
    if (typeof p?.scaffold !== 'function') return;
    // Missing required params: the scaffold configures the instance (and its start). Otherwise it only fills params
    // the instance leaves unset (regions to keep clear, the proof's movement...), never overriding what is there.
    const missing = requiredParams(card).some(k => gen.with?.[k] === undefined);
    let made = null;
    try { made = p.scaffold(space, doc, { envelope: envelopeFor(doc, registry, space), reserve: reservedRegions(doc, registry, space.id), registry }); } catch { made = null; }
    if (!made) return;
    const unset = Object.keys(made.with || {}).filter(k => gen.with?.[k] === undefined);
    if (!missing && !unset.length) return;
    applyScaffold(doc, i, gen, made, { start: missing, registry });
    fixes.push({ code: 'generator_scaffold', path: `spaces[${i}].generators[${j}]`, action: missing ? `configured ${gen.use} from the zones` : `filled ${unset.join(', ')} of ${gen.use}` });
  }));
  if (Array.isArray(doc.spaces)) fixes.push(...fitExtents(doc, registry));
  return fixes;
}
