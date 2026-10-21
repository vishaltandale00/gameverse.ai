// A substantive first-playable world (ARCHITECTURE.md §4 step 2: "the world is generated procedurally
// from the outline's generator params"). A space the player moves through needs something in it: a
// document can be valid, verified and completable while its only space is an empty map or a flat void.
//
// What fits where is declared statically on the cards, like types, never discovered by running games:
//   - generator cards: `card.spaces: [space ids]` (the spaces it targets) and `card.provides.content:
//     [kinds]` (what it builds: 'cells', 'terrain', 'road-network', 'structures', 'course', 'rooms',
//     'zones', 'entities', 'water', 'props', 'biomes', 'caves', 'ores');
//   - space cards: `card.needs: { content: [kinds] }`, the world content the space needs to be playable
//     (every kind listed must be provided).
// generatorsFor and planWorld read only those declarations (plus the param schemas: a generator with
// required params is usable only through its `scaffold(space, doc, ctx)` hook). furnishWorld covers a
// space's unmet needs with the planned generators, each configured by its scaffold from the space's zones
// and the document's movement envelope, preflighted and booted; booting is the backstop that the world
// really has content (cells, terrain, objects, roads, entities, linked zones). Zero model calls.
import { preflight } from '../kernel/document.js';
import { createWorld } from '../kernel/world.js';
import { movementEnvelope } from '../primitives/gameplay/move-lib-envelope.js';
import { defaultsOf, isGenerator } from './catalog.js';

export const WORLD_VERSION = 'world/0.2';
const MAX_CELLS_SCANNED = 4e6;

/** Capabilities a space instance provides with its configuration. */
export function spaceCaps(registry, space) {
  const p = registry.get(space.use); if (!p) return [];
  const config = { ...defaultsOf(p.card), ...(space.with || {}) };
  try { return p.capabilities ? p.capabilities(config) : p.card.provides?.capabilities || []; } catch { return p.card.provides?.capabilities || []; }
}

// ---------- static declarations ----------
/** World content a space kind needs to be playable (space card `needs.content`). */
export const spaceNeeds = (registry, use) => registry.get(use)?.card.needs?.content || [];
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
 * Static plan for a space kind: generators (greedy, by generatorsFor's ranking) until every need not in
 * `have` is covered. -> { generators: [ids], unmet: [kinds] }
 */
export function planWorld(registry, space, { view = null, have = [], exclude = [] } = {}) {
  let left = spaceNeeds(registry, space.use).filter(c => !have.includes(c));
  const picks = [];
  while (left.length) {
    const best = generatorsFor(registry, space, view, left).find(g => g.covers.length && !picks.includes(g.id) && !exclude.includes(g.id));
    if (!best) break;
    picks.push(best.id); left = left.filter(c => !best.covers.includes(c));
  }
  return { generators: picks, unmet: left };
}
/** A space kind whose needs the registered generators can cover (zones are authored by the outline). -> unmet kinds */
export const unfurnishable = (registry, use) => planWorld(registry, { use }, { have: OUTLINE_AUTHORS }).unmet;

// ---------- which spaces need a world ----------
const hasEnvelope = p => Boolean(p && (p.card?.envelope || p.envelope));
/** Whether a primitive moves things through a space: a movement envelope, or a continuous control (walk, steer, drive). */
export const isMovement = (registry, id) => { const p = registry.get(id); return hasEnvelope(p) || Object.values(p?.card?.actionSpace || {}).some(a => a?.kind === 'continuous'); };
/** A space kind that declares world needs. */
export const needsWorld = (registry, space) => spaceNeeds(registry, space.use).length > 0;
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
  }
  const zones = [...(rt.doc.spaces.find(s => s.id === spaceId)?.zones || []), ...(Array.isArray(rt.state.spaces[spaceId]?.zones) ? rt.state.spaces[spaceId].zones : [])];
  const linked = linkedZones(zones);
  if (linked) out.linked = linked;
  return out;
}
/** Nothing measured in the space. */
export const isEmpty = c => !(c && (c.cells > 0 || c.entities > 0 || c.terrain || c.objects > 0 || c.roads > 0 || c.linked > 0));

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

/** world_empty (nothing in a space that needs a world, error) and world_incomplete (a declared need unmet, warning). */
export function worldProblems(rt, doc, registry) {
  const out = [];
  for (const { space, index } of spacesNeedingWorld(doc, registry)) {
    const c = contentOf(rt, space.id); if (!c) continue;
    const unmet = spaceNeeds(registry, space.use).filter(k => !worldContent(doc, registry, space, rt).includes(k));
    if (!unmet.length) continue;
    const plan = planWorld(registry, space, { view: doc.views?.primary, have: worldContent(doc, registry, space, rt) });
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
    let left = spaceNeeds(registry, s0.use).filter(k => !worldContent(current, registry, current.spaces[index], world).includes(k));
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
const grows = (a, b) => ['cells', 'entities', 'objects', 'roads', 'linked'].some(k => (b[k] ?? 0) > (a[k] ?? 0)) || (Boolean(b.terrain) && !a.terrain);

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

/**
 * Fill the params of generator instances that a selection added without them (the skeleton lists `{use}` only)
 * through each generator's `scaffold` hook. Mutates and returns `doc`; -> fixes.
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
  return fixes;
}
