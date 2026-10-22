// @ts-check
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
//     world is terrain + a road network, or rooms). Among declared sets: the first the content already meets, else the
//     step path's model choice (select.js pick_world), else the card's own needs.content; never the idea's words.
// generatorsFor and planWorld read only those declarations (plus the param schemas: a generator with
// required params is usable only through its `scaffold(space, doc, ctx)` hook). furnishWorld covers a
// space's unmet needs with the planned generators, each configured by its scaffold from the space's zones
// and the document's movement envelope, preflighted and booted; booting is the backstop that the world
// really has content (cells, terrain, objects, roads, entities, linked zones). Zero model calls.
import { preflight } from '../kernel/document.js';
import { createWorld } from '../kernel/world.js';
import { movementEnvelope } from '../primitives/gameplay/move-lib-envelope.js';
import { defaultsOf, isGenerator } from './catalog.js';
import { isList, isObj, isStr, list, obj, objects, prop, str } from '../kernel/guards.js';
import { OUTLINE_AUTHORS, linkedZones, spaceContent, carriedContent } from './space-content.js';

export { OUTLINE_AUTHORS };

/**
 * The world content a selected space already has before any generator is planned: what the space carries itself or
 * through params the document will write, and the outline's zones (space-content.js carriedContent, the composition
 * check's reading). A mechanic on the space is not counted: a board it fills is a region of the space, not its world.
 * @param {RegistryLike} registry @param {SpaceLike} space @returns {string[]}
 */
export function selectedContent(registry, space) {
  return carriedContent(registry.get(str(space.use))?.card, /** @type {any} */ (space), { written: false });
}

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').Card} Card */
/** @typedef {import('../kernel/types.js').Params} Params */
/** @typedef {import('../kernel/types.js').ParamSchema} ParamSchema */
/** @typedef {import('../kernel/types.js').Runtime} Runtime */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').RegisteredPrimitive} RegisteredPrimitive */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/**
 * A space instance as this module reads it: a preflighted document's, a selection's (select.js), or a draft's
 * (configureGenerators runs before preflight), so every field is checked before use.
 * @typedef {{ id?: unknown, use?: unknown, with?: unknown, zones?: unknown, generators?: unknown, [k: string]: unknown }} SpaceLike
 */
/**
 * world_empty / world_incomplete (worldProblems) and world_extent_outside / world_extent_mismatch (extentProblems).
 * @typedef {{ code: string, path: string, severity: 'error' | 'warning', stage: 'world', space: unknown, message: string, hint: string, missing?: string[], uncovered?: number }} WorldProblem
 */
/** @typedef {{ code: string, path: string, action: string }} WorldFix */
/** A generator furnishWorld added. @typedef {{ space: unknown, use: string, covers: string[], problems: string[] }} WorldAdded */
/**
 * What a generator's scaffold hook returns: its config, content additions, the player start and space params.
 * @typedef {{ with?: Record<string, unknown>, content?: Record<string, unknown[]>, start?: unknown, space?: { with?: Record<string, unknown> } }} Scaffold
 */
/** @typedef {{ envelope: unknown, reserve: number[][], registry: RegistryLike }} ScaffoldOptions */
/**
 * A generator primitive's optional hooks (called as methods: hooks read this.card). The kernel types carry them as
 * unknown extras; each is checked with typeof before it is called.
 * @typedef {RegisteredPrimitive & {
 *   scaffold?(space: SpaceLike, doc: Record<string, unknown>, opts: ScaffoldOptions): Scaffold | null | undefined,
 *   extentOf?(config: Record<string, unknown>, space: SpaceLike): unknown,
 *   fit?(config: Record<string, unknown>, area: number[], space: SpaceLike): Record<string, unknown> | null | undefined,
 * }} GeneratorPrimitive
 */
/** A booted space's measured content (contentOf). @typedef {{ cells: number | null, entities: number, terrain?: boolean, objects?: number, roads?: number, fields?: number, layers?: number, linked?: number }} WorldMeasure */
/** A 3D world model, as contentOf reads it. @typedef {{ has?(field: string): boolean, objects?: unknown[], data?: { roads?: { edges?: unknown[] } }, fields?: { size?: number }, layers?: unknown[], objectLayers?: unknown[] }} WorldModel */
/** A generator instance's declared extent. @typedef {{ kind: string, rect: number[] | null }} Extent */
/** @typedef {{ g: Record<string, unknown>, j: number } & Extent} GenExtent */

/** A registered primitive with its generator hooks typed. @param {RegistryLike} registry @param {unknown} id @returns {GeneratorPrimitive | undefined} */
const generator = (registry, id) => registry.get(str(id));
/** The document's primary view (documents write views as { primary, alternates }), or null. @param {Record<string, unknown>} doc */
const primaryView = doc => { const v = prop(doc.views, 'primary'); return isStr(v) ? v : null; };
/** Space `index` of a document's spaces as plain data ({} when absent or not an object). @param {Record<string, unknown>} doc @param {number} index */
const spaceAt = (doc, index) => obj(list(doc.spaces)[index]);

export const WORLD_VERSION = 'world/0.2';
const MAX_CELLS_SCANNED = 4e6;

/** Capabilities a space instance provides with its configuration. @param {RegistryLike} registry @param {SpaceLike} space @returns {string[]} */
export function spaceCaps(registry, space) {
  const p = registry.get(str(space.use)); if (!p) return [];
  const config = { ...defaultsOf(p.card), ...obj(space.with) };
  try { return p.capabilities ? p.capabilities(config) : p.card.provides?.capabilities || []; } catch { return p.card.provides?.capabilities || []; }
}

// ---------- static declarations ----------
/** World content a space kind needs to be playable by default (space card `needs.content`). */
export const spaceNeeds = (/** @type {RegistryLike} */ registry, /** @type {unknown} */ use) => registry.get(str(use))?.card.needs?.content || [];
/** Every content set that makes a space kind playable: needs.content first, then needs.alternatives. @param {RegistryLike} registry @param {unknown} use @returns {string[][]} */
export const needSets = (registry, use) => { const n = registry.get(str(use))?.card.needs; return n?.content?.length ? [n.content, ...list(prop(n, 'alternatives')).filter(/** @returns {a is string[]} */ (/** @type {unknown} */ a) => Array.isArray(a) && a.length > 0)] : []; };
/** World content a generator builds (generator card `provides.content`). @param {RegistryLike} registry @param {unknown} id @returns {string[]} */
export const contentOfGenerator = (registry, id) => registry.get(str(id))?.card.provides?.content || [];
/** Whether a generator's card declares this space kind among its targets (generator card `spaces`). @param {RegistryLike} registry @param {string} id @param {unknown} use */
export const targets = (registry, id, use) => (registry.get(id)?.card.spaces || []).some(s => s === use);
/** @param {Card} card @returns {string[]} */
const requiredParams = card => Object.entries(card.params || {}).filter(([, s]) => s.required && s.default === undefined).map(([k]) => k);
/** A generator the planner can configure on its own: a scaffold hook, or no required params. @param {RegistryLike} registry @param {string} id */
export const configurable = (registry, id) => { const p = generator(registry, id); return Boolean(p) && (typeof p?.scaffold === 'function' || !requiredParams(/** @type {GeneratorPrimitive} */ (p).card).length); };

/** @typedef {{ id: string, covers: string[], rank: number[], score: number }} Ranked */
/**
 * Whether an own-extent generator fits the space's extent (its `fit` hook gives params for the whole area). A
 * generator that declares no own extent, has no fit hook, or a space without an extent is not excluded here.
 * @param {RegistryLike} registry @param {string} id @param {SpaceLike} space
 */
export function fitsSpace(registry, id, space) {
  const p = generator(registry, id), area = spaceExtent(registry, space);
  if (!p || !area || declaredExtent(p) !== 'own' || typeof p.fit !== 'function') return true;
  try { return Boolean(p.fit(defaultsOf(p.card), area, space)); } catch { return false; }
}
/**
 * Generators that target this space kind (card.spaces), configurable by the planner and fitting the space's extent
 * (fitsSpace: rooms that need more room than the board has are not offered), ranked by the declarations: most of
 * `want` (default: the space's needs) covered, then the least content nobody asked for (provides.content outside
 * `allowed`, default `want`: a board that needs cells gets a board, not a dungeon's rooms), then a scaffold hook
 * (configures itself from the document), then views that include `view`, then the narrowest target list, then id.
 * -> [{ id, covers: [kinds], score }]
 * @param {RegistryLike} registry @param {SpaceLike} space @param {string | null} [view] @param {string[] | null} [want] @param {string[] | null} [allowed]
 * @returns {Array<{ id: string, covers: string[], score: number }>}
 */
export function generatorsFor(registry, space, view = null, want = null, allowed = null) {
  const need = want ?? spaceNeeds(registry, space.use), ok = allowed ?? need;
  return registry.ids('engine').filter(id => isGenerator(id) && targets(registry, id, space.use) && configurable(registry, id) && fitsSpace(registry, id, space)).map(id => {
    const p = /** @type {GeneratorPrimitive} */ (generator(registry, id)), card = p.card, made = contentOfGenerator(registry, id), covers = made.filter(c => need.includes(c)); // id comes from registry.ids
    const surplus = made.filter(c => !ok.includes(c)).length;
    const views = card.views || ['any'], fitsView = view && (views.includes(view) || views.includes('any')) ? 1 : 0;
    return { id, covers, rank: [covers.length, -surplus, typeof p.scaffold === 'function' ? 1 : 0, fitsView, -(card.spaces || []).length], score: covers.length * 100 - surplus * 20 + (typeof p.scaffold === 'function' ? 10 : 0) + fitsView * 4 - (card.spaces || []).length };
  }).sort(cmpRank).map(({ rank, ...g }) => g);
}
/** @param {Ranked} a @param {Ranked} b */
const cmpRank = (a, b) => { for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return b.rank[i] - a.rank[i]; return a.id.localeCompare(b.id); };

/**
 * The need set a space's world aims at: the first declared set `have` already satisfies; else the card's own
 * needs.content (its first declared set). Never chosen by the idea's words.
 * @param {RegistryLike} registry @param {SpaceLike} space @param {{ have?: string[] }} [opts] @returns {string[]}
 */
export function needSetFor(registry, space, { have = [] } = {}) {
  const sets = needSets(registry, space.use);
  if (!sets.length) return [];
  return sets.find(set => set.every(k => have.includes(k))) ?? sets[0];
}

/**
 * Static plan for a space: generators (greedy, by generatorsFor's ranking) until every kind of its need set not in
 * `have` is covered: `set` when given (the step path's choice among the space's declared alternatives: select.js
 * pick_world), else needSetFor. -> { generators: [ids], unmet: [kinds], set: [kinds] }
 * @param {RegistryLike} registry @param {SpaceLike} space
 * @param {{ view?: string | null, have?: string[], exclude?: string[], set?: string[] | null }} [opts]
 * @returns {{ generators: string[], unmet: string[], set: string[] }}
 */
export function planWorld(registry, space, { view = null, have = [], exclude = [], set: chosen = null } = {}) {
  const set = chosen ?? needSetFor(registry, space, { have });
  let left = set.filter(c => !have.includes(c));
  /** @type {string[]} */
  const picks = [];
  while (left.length) {
    // Surplus is judged against the whole need set (and what the space has): covering one kind of it is not surplus.
    const best = generatorsFor(registry, space, view, left, [...set, ...have]).find(g => g.covers.length && !picks.includes(g.id) && !exclude.includes(g.id));
    if (!best) break;
    picks.push(best.id); left = left.filter(c => !best.covers.includes(c));
  }
  return { generators: picks, unmet: left, set };
}
/** A space kind whose needs the registered generators can cover (zones are authored by the outline). -> unmet kinds */
export const unfurnishable = (/** @type {RegistryLike} */ registry, /** @type {string} */ use) => planWorld(registry, { use }, { have: OUTLINE_AUTHORS }).unmet;

// ---------- which spaces need a world ----------
/** @param {RegisteredPrimitive | undefined} p */
const hasEnvelope = p => Boolean(p && (p.card?.envelope || p.envelope));
/** Whether a primitive moves things through a space: a movement envelope, or a continuous control (walk, steer, drive). */
export const isMovement = (/** @type {RegistryLike} */ registry, /** @type {unknown} */ id) => { const p = registry.get(str(id)); return hasEnvelope(p) || Object.values(p?.card?.actionSpace || {}).some(a => prop(a, 'kind') === 'continuous'); };
/** A space kind that declares world needs. */
export const needsWorld = (/** @type {RegistryLike} */ registry, /** @type {SpaceLike} */ space) => needSets(registry, space.use).length > 0;
/**
 * Spaces whose world must not be empty: spaces that declare needs and that a movement primitive moves
 * something through (bound to that space or to the first one). A board or card game with no movement
 * primitive may legitimately start empty.
 * @param {Doc} doc @param {RegistryLike} registry @returns {Array<{ space: Doc['spaces'][number], index: number }>}
 */
export function spacesNeedingWorld(doc, registry) {
  const first = doc.spaces?.[0]?.id;
  const moved = new Set((doc.systems || []).filter(s => isMovement(registry, s.use)).map(s => s.space ?? first));
  return (doc.spaces || []).map((space, index) => ({ space, index })).filter(({ space }) => moved.has(space.id) && needsWorld(registry, space));
}

// ---------- what a space has ----------
/**
 * Content a document space has: statically, the one reading the composition check makes of the declarations
 * (space-content.js spaceContent: what the space carries, its contentParams set, its authored zones, what its
 * generators and bound systems provide); with a booted world, measured cells and entities count too.
 * @param {Doc} doc @param {RegistryLike} registry @param {SpaceLike} space @param {Runtime | null} [rt] @returns {string[]}
 */
export function worldContent(doc, registry, space, rt = null) {
  const have = new Set(spaceContent(registry, doc, space));
  if (rt) { const c = contentOf(rt, str(space.id)); if ((c?.cells ?? 0) > 0) have.add('cells'); if ((c?.entities ?? 0) > 0) have.add('entities'); }
  return [...have];
}

/**
 * Measured content of a booted space (the backstop): non-empty cells (cell spaces), entities other than the
 * player, generated terrain, placed objects and road edges (3D world models), zones joined by exits.
 * null when the space does not exist. `cells` is null where cells can't be measured.
 * @param {Runtime} rt @param {string} spaceId @returns {WorldMeasure | null}
 */
export function contentOf(rt, spaceId) {
  const api = rt.space(spaceId);
  if (!api) return null;
  const entities = Object.values(rt.state.entities).filter(e => e.space === spaceId && e.id !== 'player').length;
  /** @type {number | null} */
  let cells = null;
  const b = typeof api.bounds === 'function' ? api.bounds() : api.size ? { min: api.size.map(() => 0), max: api.size } : null;
  if (typeof api.cellsIn === 'function' && b?.min && b?.max && b.max.every(Number.isFinite)) {
    const min = b.min, volume = b.max.reduce((/** @type {number} */ v, /** @type {number} */ x, /** @type {number} */ i) => v * Math.max(0, x - min[i]), 1);
    if (volume <= MAX_CELLS_SCANNED) {
      const box = [b.min, b.max.map((/** @type {number} */ x) => x - 1)];
      const layers = Array.isArray(api.layers) ? api.layers : [undefined];
      cells = 0;
      for (const l of layers) { cells += api.cellsIn(box, l).length; if (cells) break; }
    }
  }
  /** @type {WorldMeasure} */
  const out = { cells, entities };
  if (typeof api.model === 'function') { // a 3D world model: terrain field, placed objects, road network
    const m = /** @type {WorldModel | null | undefined} */ (api.model());
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
/** Nothing measured in the space. @param {WorldMeasure | null | undefined} c */
export const isEmpty = c => !(c && ((c.cells ?? 0) > 0 || c.entities > 0 || c.terrain || (c.objects ?? 0) > 0 || (c.roads ?? 0) > 0 || (c.linked ?? 0) > 0 || (c.layers ?? 0) > 0));

/** @typedef {{ code: string, path?: string, severity?: string, [k: string]: unknown }} GenerationProblem */
/**
 * Generation problems for one booted space: 2D generators (the shared `generation` service) and the 3D world model.
 * @param {Runtime} rt @param {Doc} doc @param {string} spaceId @returns {GenerationProblem[]}
 */
export function generationProblems(rt, doc, spaceId) {
  const index = doc.spaces.findIndex(s => s.id === spaceId);
  const flat = rt.hasService?.('generation') ? /** @type {GenerationProblem[]} */ (rt.service('generation').problems() || []).filter(p => String(p.path || '').startsWith(`spaces[${index}]`)) : [];
  const model = /** @type {GenerationProblem[]} */ (rt.state.spaces[spaceId]?.generated?.problems || []).map(p => ({ severity: 'error', ...p }));
  return [...flat, ...model];
}

/** @param {Doc} doc @param {RegistryLike} registry @param {LogicLike} logic @param {unknown} seed @returns {Runtime} */
const boot = (doc, registry, logic, seed, frames = 3) => {
  const rt = createWorld(doc, registry, logic, { seed });
  for (let i = 0; i < frames && rt.state.status === 'playing'; i++) rt.step();
  return rt;
};

/**
 * world_empty (nothing in a space that needs a world, error), world_incomplete (a declared need unmet, warning)
 * and the extent checks (extentProblems: generated content that misses part of its cell space or leaves it).
 * @param {Runtime} rt @param {Doc} doc @param {RegistryLike} registry @returns {WorldProblem[]}
 */
export function worldProblems(rt, doc, registry) {
  const out = extentProblems(doc, registry);
  for (const { space, index } of spacesNeedingWorld(doc, registry)) {
    const c = contentOf(rt, space.id); if (!c) continue;
    // The need set judged is the composition check's: the first one the space meets, else needs.content (never chosen
    // from the idea's words).
    const have = worldContent(doc, registry, space, rt), unmet = needSetFor(registry, space, { have }).filter(k => !have.includes(k));
    if (!unmet.length) continue;
    const plan = planWorld(registry, space, { view: primaryView(doc), have });
    const hint = plan.generators.length ? `add ${plan.generators.join(' + ')} in spaces[${index}].generators (it builds ${unmet.join(', ')})` : `no registered generator targets ${space.use} with ${unmet.join(', ')}: author that content`;
    if (isEmpty(c)) out.push({ code: 'world_empty', path: `spaces[${index}]`, severity: 'error', stage: 'world', space: space.id, missing: unmet,
      message: `space '${space.id}' (${space.use}) is empty: it needs ${unmet.join(' and ')} and nothing builds it, so the player moves through a void`, hint });
    else out.push({ code: 'world_incomplete', path: `spaces[${index}]`, severity: 'warning', stage: 'world', space: space.id, missing: unmet,
      message: `space '${space.id}' (${space.use}) lacks ${unmet.join(' and ')}, which ${space.use} declares it needs`, hint });
  }
  return out;
}

/** @param {Record<string, unknown>} doc @param {RegistryLike} registry @param {SpaceLike} space */
const envelopeFor = (doc, registry, space) => {
  const g = prop(space.with, 'gravity');
  const gravity = Math.abs(Number(Array.isArray(g) ? g[1] : g)) || undefined;
  return movementEnvelope(doc, registry, list(prop(doc.player, 'abilities')), gravity ? { gravity } : {});
};

/**
 * furnishWorld(doc, registry, logic, { seed, rt? }) -> { doc, added: [{ space, use, problems }], fixes, problems, ms }
 * Covers every unmet need of every space that needs a world with the planned generators (planWorld's
 * ranking), each configured by its scaffold. A candidate whose scaffold declines, that fails preflight or
 * whose world does not grow is skipped for the next one covering the same need; among those that work, the
 * first with a clean generation proof wins, else the one with the fewest generation errors. Never mutates
 * its input. `problems` are the world problems left. A world that does not boot is returned unchanged.
 * `doc` is `input` or a copy of it with generators added.
 * @template T
 * @param {T} input @param {RegistryLike} registry @param {LogicLike} logic
 * @param {{ seed?: unknown, rt?: Runtime | null }} [opts]
 * @returns {{ doc: T, added: WorldAdded[], fixes: WorldFix[], problems: WorldProblem[], ms: number, version: string }}
 */
export function furnishWorld(input, registry, logic, { seed, rt = null } = {}) {
  const started = performance.now();
  /** @param {T} doc @param {WorldAdded[]} added @param {WorldFix[]} fixes @param {WorldProblem[]} problems */
  const done = (doc, added, fixes, problems) => ({ doc, added, fixes, problems, ms: Math.round(performance.now() - started), version: WORLD_VERSION });
  const pre = preflight(input, registry, logic);
  if (!pre.ok || !spacesNeedingWorld(pre.doc, registry).length) return done(input, [], [], []);
  try { rt ??= boot(pre.doc, registry, logic, seed); } catch { return done(input, [], [], []); }
  if (!worldProblems(rt, pre.doc, registry).length) return done(input, [], [], []);
  // input passed preflight: an object whose spaces are objects. Edited as plain data, returned as the caller's type.
  let doc = obj(structuredClone(input)), current = pre.doc, world = rt;
  /** @type {WorldAdded[]} */
  const added = [];
  /** @type {WorldFix[]} */
  const fixes = [];
  for (const { space: s0, index } of spacesNeedingWorld(pre.doc, registry)) {
    const had = worldContent(current, registry, current.spaces[index], world);
    const aim = needSetFor(registry, s0, { have: had });
    let left = aim.filter(k => !had.includes(k));
    /** @type {Set<string>} */
    const tried = new Set();
    while (left.length) {
      const space = spaceAt(doc, index), before = contentOf(world, str(space.id));
      const envelope = envelopeFor(current, registry, space);
      /** @type {{ trial: Record<string, unknown>, pre: Doc, rt: Runtime, use: string, covers: string[], generation: GenerationProblem[] } | null} */
      let kept = null;
      for (const cand of generatorsFor(registry, space, primaryView(doc), left, [...aim, ...had]).filter(g => g.covers.length && !tried.has(g.id))) {
        tried.add(cand.id);
        const p = generator(registry, cand.id);
        /** @type {Scaffold | null | undefined} */
        let made;
        try { made = typeof p?.scaffold === 'function' ? p.scaffold(space, doc, { envelope, reserve: reservedRegions(current, registry, space.id), registry }) : { with: {} }; } catch { made = null; }
        if (!made) continue;
        const trial = structuredClone(doc), gen = /** @type {{ use: string, with?: unknown }} */ ({ use: cand.id });
        const trialSpace = spaceAt(trial, index);
        (isList(trialSpace.generators) ? trialSpace.generators : (trialSpace.generators = /** @type {unknown[]} */ ([]))).push(gen);
        applyScaffold(trial, index, gen, made, { registry });
        const p2 = preflight(trial, registry, logic);
        if (!p2.ok) continue;
        let grew = false, generation = /** @type {GenerationProblem[]} */ ([]), booted = null;
        try {
          booted = boot(p2.doc, registry, logic, seed);
          const c = contentOf(booted, str(space.id));
          grew = Boolean(c) && (isEmpty(before) ? !isEmpty(c) : grows(before, c));
          generation = generationProblems(booted, p2.doc, str(space.id)).filter(x => x.severity === 'error');
        } catch { grew = false; }
        if (!grew || !booted) continue;
        if (!kept || generation.length < kept.generation.length) kept = { trial, pre: p2.doc, rt: booted, use: cand.id, covers: cand.covers, generation };
        if (!generation.length) break;
      }
      if (!kept) break;
      const k = kept;
      doc = k.trial; current = k.pre; world = k.rt;
      left = left.filter(x => !k.covers.includes(x));
      added.push({ space: s0.id, use: k.use, covers: k.covers, problems: k.generation.map(x => x.code) });
      fixes.push({ code: 'world_empty', path: `spaces[${index}].generators`, action: `added ${k.use} to build ${k.covers.join(', ')} in space '${s0.id}'` });
    }
  }
  return done(/** @type {T} */ (/** @type {unknown} */ (doc)), added, fixes, worldProblems(world, current, registry));
}
/** Whether measured content b has more of anything than a. @param {WorldMeasure | null | undefined} a @param {WorldMeasure | null | undefined} b */
export const grows = (a, b) => /** @type {const} */ (['cells', 'entities', 'objects', 'roads', 'linked', 'fields', 'layers']).some(k => (b?.[k] ?? 0) > (a?.[k] ?? 0)) || (Boolean(b?.terrain) && !a?.terrain);

/**
 * Add one generator instance to spaces[index] of a copy of doc: with `config`, or configured by its scaffold
 * (null when the scaffold declines). -> doc | null
 * @template T
 * @param {T} input @param {RegistryLike} registry @param {number} index @param {string} use @param {unknown} [config]
 * @returns {T | null}
 */
export function addGenerator(input, registry, index, use, config = undefined) {
  const doc = obj(structuredClone(input)), space = list(doc.spaces)[index], p = generator(registry, use);
  // A space entry that is not an object cannot take a generator.
  if (!isObj(space) || !p) return null;
  const gen = /** @type {{ use: string, with?: unknown }} */ ({ use });
  (isList(space.generators) ? space.generators : (space.generators = /** @type {unknown[]} */ ([]))).push(gen);
  const out = /** @type {T} */ (/** @type {unknown} */ (doc));
  if (config !== undefined) { gen.with = structuredClone(config); return out; }
  if (typeof p.scaffold !== 'function') return out;
  /** @type {Scaffold | null | undefined} */
  let made = null;
  try { made = p.scaffold(space, doc, { envelope: envelopeFor(doc, registry, space), reserve: reservedRegions(doc, registry, space.id), registry }); } catch { made = null; }
  if (!made) return null;
  applyScaffold(doc, index, gen, made, { registry });
  return out;
}

/**
 * Cell regions of a space that other primitives own (a falling-piece board, a match grid...), as rects
 * [x0,y0,x1,y1) in space cells, from param metadata: a param schema with `region: 'board'` ({at, size, axes, fall},
 * as puzzle-lib-board's boardParam) or `region: 'rect'` ([x0,y0,x1,y1)), or card.regions: [{ param, kind }].
 * Generators leave them clear and keep them reachable.
 * @param {Record<string, unknown>} doc @param {RegistryLike} registry @param {unknown} spaceId @returns {number[][]}
 */
export function reservedRegions(doc, registry, spaceId) {
  const first = prop(list(doc.spaces)[0], 'id');
  /** @type {number[][]} */
  const out = [];
  for (const inst of objects(doc.systems)) {
    if ((inst.space ?? first) !== spaceId) continue;
    const card = registry.get(str(inst.use))?.card; if (!card) continue;
    const defaults = defaultsOf(card), given = obj(inst.with);
    const config = Object.fromEntries(Object.keys({ ...defaults, ...given }).map(k => [k, given[k] && typeof given[k] === 'object' && !Array.isArray(given[k]) && defaults[k] && typeof defaults[k] === 'object' ? { ...defaults[k], ...given[k] } : given[k] ?? defaults[k]]));
    const claims = [...objects(card.regions).map(r => [r.param, r.kind]), ...Object.entries(card.params || {}).filter(([, s]) => s.region).map(([k, s]) => [k, s.region])];
    for (const [param, kind] of claims) {
      const rect = regionRect(kind, config[String(param)]);
      if (rect && !out.some(r => r.join() === rect.join())) out.push(rect);
    }
  }
  return out;
}
/** @param {unknown} kind @param {unknown} v @returns {number[] | null} */
function regionRect(kind, v) {
  if (kind === 'rect') return Array.isArray(v) && v.length === 4 && v.every(Number.isFinite) && v[2] > v[0] && v[3] > v[1] ? v.slice() : null;
  if (kind !== 'board' || !isObj(v) || !Array.isArray(v.at) || !Array.isArray(v.size)) return null;
  const axes = v.axes || [0, 1]; if (!isList(axes)) return null;
  const [a, b] = axes, [w, h] = v.size;
  if (!(a === 0 || a === 1) || !(b === 0 || b === 1) || a === b || !(w > 0 && h > 0)) return null;
  const across = [v.at[a], v.at[a] + w], vertical = Number(v.fall ?? -1) < 0 ? [v.at[b], v.at[b] + h] : [v.at[b] - h + 1, v.at[b] + 1];
  const [xs, ys] = a === 0 ? [across, vertical] : [vertical, across];
  return [xs[0], ys[0], xs[1], ys[1]];
}

/**
 * Apply a scaffold result to one generator instance of a document: `with` (generator config), `content`
 * (sections appended by id), `start` (the player's start in that space) and `space.with` (space params the
 * document leaves unset or at their card default, e.g. a track's length from its zones).
 * @param {Record<string, unknown>} doc @param {number} spaceIndex @param {{ with?: unknown }} gen @param {Scaffold} made
 * @param {{ start?: boolean, registry?: RegistryLike | null }} [opts]
 */
function applyScaffold(doc, spaceIndex, gen, made, { start = true, registry = null } = {}) {
  if (Object.keys(made.with || {}).length) gen.with = { ...made.with, ...obj(gen.with) };
  for (const [section, items] of Object.entries(made.content || {})) {
    doc.content ??= {};
    // A draft's content may not be an object (configureGenerators runs before preflight): nothing to add to then.
    const content = doc.content; if (!isObj(content)) break;
    const have = Array.isArray(content[section]) ? content[section] : (content[section] = []);
    for (const x of items) if (!have.some(h => prop(h, 'id') === prop(x, 'id'))) have.push(x);
  }
  const space = spaceAt(doc, spaceIndex);
  if (made.space?.with) {
    const defaults = registry ? defaultsOf(registry.get(str(space.use))?.card || {}) : {};
    for (const [k, v] of Object.entries(made.space.with)) {
      const cur = prop(space.with, k);
      if (cur === undefined || JSON.stringify(cur) === JSON.stringify(defaults[k])) {
        // A draft's space.with that is not an object takes no params.
        const sw = space.with ?? (space.with = {}); if (isObj(sw)) sw[k] = v;
      }
    }
  }
  const player = doc.player;
  if (start && Array.isArray(made.start) && isObj(player) && (player.space ?? spaceAt(doc, 0).id) === space.id) player.at = made.start;
}

// ---------- extents: what part of a space its generators fill ----------
// A generator card declares `provides.extent`: 'space' (it fills the whole space: terrain fields, graph maps),
// 'own' (it fills a rect given by its params: the primitive's `extentOf(config, space)` -> [x0, y0, x1, y1), and
// `fit(config, rect, space)` -> params that make it fill rect, or null) or 'overlay' (it adds to what others lay
// down and fills nothing of its own: roads, props, courses, pieces). A space's extent is its param declared
// `scale: 'world'` (a [w, h] list: [0, 0, w, h)).

/** The extent a generator card declares (provides.extent; 'overlay' when none). @param {GeneratorPrimitive | undefined} p @returns {string} */
const declaredExtent = p => { const e = prop(p?.card.provides, 'extent'); return isStr(e) && e ? e : 'overlay'; };
/** [0, 0, w, h) from the space's world-scale list param; null when it has none (voxel, graph, none, a track's length). @param {RegistryLike} registry @param {SpaceLike} space @returns {number[] | null} */
export function spaceExtent(registry, space) {
  const card = registry.get(str(space.use))?.card; if (!card) return null;
  const entry = Object.entries(card.params || {}).find(([, s]) => s.scale === 'world'); if (!entry) return null;
  const v = prop(space.with, entry[0]) ?? entry[1].default;
  return Array.isArray(v) && v.length >= 2 && v.slice(0, 2).every(x => Number.isFinite(x) && x > 0) ? [0, 0, v[0], v[1]] : null;
}
/** A generator instance's declared extent: { kind: 'space'|'own'|'overlay', rect } (rect for 'own' when its params give one). @param {RegistryLike} registry @param {Record<string, unknown>} gen @param {SpaceLike} space @returns {Extent} */
export function extentOfGenerator(registry, gen, space) {
  const p = generator(registry, gen.use), kind = declaredExtent(p);
  if (kind !== 'own') return { kind, rect: null };
  let rect = null; try { rect = typeof p?.extentOf === 'function' ? p.extentOf(obj(gen.with), space) : null; } catch { rect = null; }
  return { kind, rect: Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) ? rect : null };
}
/** @param {RegistryLike} registry @param {SpaceLike} space */
const cellWorld = (registry, space) => spaceNeeds(registry, space.use).includes('cells');
/** An own-extent generator with a rect. @param {GenExtent} e @returns {e is GenExtent & { rect: number[] }} */
const ownWithRect = e => e.kind === 'own' && Boolean(e.rect);
/** @param {GenExtent} e @param {number[]} area */
const outsideOf = (e, area) => Boolean(e.rect && (e.rect[0] < area[0] || e.rect[1] < area[1] || e.rect[2] > area[2] || e.rect[3] > area[3]));
/** Cells of rect `area` covered by none of `rects` (counted on the integer grid; capped). @param {number[]} area @param {number[][]} rects */
function uncovered(area, rects) {
  const [x0, y0, x1, y1] = area.map(Math.round); let n = 0;
  if ((x1 - x0) * (y1 - y0) > MAX_CELLS_SCANNED) return 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!rects.some(r => x >= r[0] && x < r[2] && y >= r[1] && y < r[3])) n++;
  return n;
}
/** The generators of a space with their extents (entries that are not objects are skipped, indices kept). @param {RegistryLike} registry @param {SpaceLike} space @returns {GenExtent[]} */
const extentsOf = (registry, space) => list(space.generators).flatMap((g, j) => (isObj(g) ? [{ g, j, ...extentOfGenerator(registry, g, space) }] : []));
/**
 * The composition check for extents (static): a generator's own extent must lie inside its space, and in a cell
 * space whose content comes from own-extent generators those extents must cover the whole space, otherwise the
 * rest is an empty void that tunnels, exits and edges open into. -> problems (world_extent_outside, world_extent_mismatch)
 * @param {Doc} doc @param {RegistryLike} registry @returns {WorldProblem[]}
 */
export function extentProblems(doc, registry) {
  /** @type {WorldProblem[]} */
  const out = [];
  (doc.spaces || []).forEach((space, i) => {
    const area = spaceExtent(registry, space), gens = extentsOf(registry, space);
    if (!area || !gens.length) return;
    for (const e of gens) if (e.rect && outsideOf(e, area))
      out.push({ code: 'world_extent_outside', path: `spaces[${i}].generators[${e.j}]`, severity: 'error', stage: 'world', space: space.id,
        message: `${e.g.use} fills [${e.rect.join(', ')}), outside the ${area[2]}×${area[3]} space '${space.id}'`, hint: `fit it to the space (its fit hook) or enlarge the space` });
    if (!cellWorld(registry, space) || gens.some(e => e.kind === 'space')) return;
    const own = gens.filter(ownWithRect);
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
 * @param {Record<string, unknown>} doc a document or a draft (not preflighted) @param {RegistryLike} registry @returns {WorldFix[]}
 */
export function fitExtents(doc, registry) {
  /** @type {WorldFix[]} */
  const fixes = [];
  // A draft may hold anything where a space or generator belongs: entries that are not objects are skipped.
  list(doc.spaces).forEach((space, i) => {
    if (!isObj(space)) return;
    const area = spaceExtent(registry, space); if (!area) return;
    const gens = extentsOf(registry, space);
    const own = gens.filter(ownWithRect);
    const outside = own.filter(e => outsideOf(e, area));
    const short = cellWorld(registry, space) && !gens.some(e => e.kind === 'space') && own.length === 1 && uncovered(area, [own[0].rect]) > 0;
    for (const e of short ? own : outside) {
      const p = generator(registry, e.g.use);
      /** @type {Record<string, unknown> | null | undefined} */
      let fit = null;
      try { fit = typeof p?.fit === 'function' ? p.fit(obj(e.g.with), area, space) : null; } catch { fit = null; }
      if (fit) { e.g.with = { ...obj(e.g.with), ...fit }; fixes.push({ code: 'world_extent_fit', path: `spaces[${i}].generators[${e.j}]`, action: `fitted ${String(e.g.use)} from [${e.rect.join(', ')}) to the ${area[2]}×${area[3]} space` }); continue; }
      // spaceExtent found the space's card, so it is registered.
      const [x0, y0, x1, y1] = e.rect, key = Object.entries(/** @type {RegisteredPrimitive} */ (registry.get(str(space.use))).card.params || {}).find(([, s]) => s.scale === 'world')?.[0];
      const inside = list(space.zones).every(z => { const r = prop(z, 'rect'); return !Array.isArray(r) || (r[0] >= x0 && r[1] >= y0 && r[2] <= x1 && r[3] <= y1); });
      if (key && x0 === 0 && y0 === 0 && own.length === 1 && inside) { space.with = { ...obj(space.with), [key]: [x1, y1] }; fixes.push({ code: 'world_extent_resize', path: `spaces[${i}].with.${key}`, action: `sized space '${String(space.id)}' to the ${x1}×${y1} that ${String(e.g.use)} fills` }); }
    }
  });
  return fixes;
}

// ---------- scaling a world ----------
/** @param {unknown} v @param {number} k @param {ParamSchema | undefined} s @returns {unknown} */
function mulDeep(v, k, s) {
  if (Array.isArray(v)) { const item = s?.type === 'list' ? s.of : s; return v.map(x => mulDeep(x, k, item)); }
  if (typeof v !== 'number') return v;
  let x = v * k;
  if (s?.type === 'integer') x = Math.round(x);
  if (typeof s?.min === 'number') x = Math.max(s.min, x);
  if (typeof s?.max === 'number') x = Math.min(s.max, x);
  return +x.toFixed(4);
}
/**
 * Scale every param a schema declares `scale: 'world'` (lengths ×f; `per: 'area'` counts ×f²), recursing into list items and object fields.
 * @param {Params | undefined} params @param {Record<string, unknown>} config @param {number} f @param {{ defaults?: boolean }} [opts]
 * @returns {{ config: Record<string, unknown>, changed: string[] }}
 */
function scaleParams(params, config, f, { defaults = true } = {}) {
  /** @type {Record<string, unknown>} */
  const out = { ...config };
  /** @type {string[]} */
  const changed = [];
  for (const [k, s] of Object.entries(params || {})) {
    const has = out[k] !== undefined, v = has ? out[k] : defaults ? s.default : undefined;
    if (v === undefined) continue;
    const next = scaleValue(s, v, f);
    if (JSON.stringify(next) !== JSON.stringify(v)) { out[k] = next; changed.push(k); }
  }
  return { config: out, changed };
}
/** @param {ParamSchema | undefined} s @param {unknown} v @param {number} f @returns {unknown} */
function scaleValue(s, v, f) {
  if (s?.scale === 'world') return mulDeep(v, s.per === 'area' ? f * f : f, s);
  if (s?.type === 'list' && s.of && Array.isArray(v)) { const of = s.of; return v.map(x => scaleValue(of, x, f)); }
  if (s?.type === 'object' && s.fields && isObj(v)) return { ...v, ...scaleParams(s.fields, v, f, { defaults: false }).config };
  return v;
}
/** Which axes of a position scale with the world: a track's progress, a 3D world's x and z, every axis of a 2D one. @param {RegistryLike} registry @param {SpaceLike} space @returns {number[] | null} */
function posAxes(registry, space) {
  const entry = Object.entries(registry.get(str(space.use))?.card.params || {}).find(([, s]) => s.scale === 'world');
  if (entry && entry[1].type === 'number') return [0];
  const caps = spaceCaps(registry, space);
  return caps.includes('heightfield') || caps.includes('chunks') ? [0, 2] : null;
}
/** @param {unknown} p @param {number} f @param {number[] | null | undefined} axes */
const scalePos = (p, f, axes) => (Array.isArray(p) ? p.map((v, i) => (typeof v === 'number' && (!axes || axes.includes(i)) ? +(v * f).toFixed(4) : v)) : p);
/** @param {Record<string, unknown>} z @param {number} f @param {number[] | null} axes @returns {Record<string, unknown>} */
function scaleZone(z, f, axes) {
  const out = { ...z };
  if (Array.isArray(z.rect)) out.rect = z.rect.map(v => +(v * f).toFixed(4));
  if (Array.isArray(z.range)) out.range = z.range.map(v => +(v * f).toFixed(4));
  const b = z.bounds;
  if (isObj(b) && b.min && b.max) out.bounds = { ...b, min: scalePos(b.min, f, prop(b.min, 'length') === 3 ? [0, 2] : null), max: scalePos(b.max, f, prop(b.max, 'length') === 3 ? [0, 2] : null) };
  if (Array.isArray(z.center)) { out.center = z.center.map(v => +(v * f).toFixed(4)); if (typeof z.r === 'number') out.r = +(z.r * f).toFixed(4); }
  if (Array.isArray(z.polygon)) out.polygon = z.polygon.map(p => p.map((/** @type {number} */ v) => +(v * f).toFixed(4)));
  for (const k of ['spawn', 'at']) { const at = z[k]; if (Array.isArray(at)) out[k] = scalePos(at, f, at.length === 3 ? axes ?? [0, 2] : null); }
  return out;
}
/**
 * scaleWorld(doc, registry, factor) -> { doc, changes: [{ path, params }], unscaled: [generator ids] }
 * "A bigger world": grows the content, not only the container. Every space's world-scale param (its extent),
 * its zones and the player's start scale by `factor` along the world's axes; every generator's params declared
 * `scale: 'world'` scale with it (lengths ×factor, `per: 'area'` counts ×factor²); a generator that fills its own
 * extent is then re-fitted to the grown space (`fit`). Generators with nothing to scale are listed in `unscaled`.
 * Never mutates its input. Zero model calls.
 * @template T
 * @param {T} input @param {RegistryLike} registry @param {unknown} factor
 * @returns {{ doc: T, changes: Array<{ path: string, params: string[] }>, unscaled: unknown[] }}
 */
export function scaleWorld(input, registry, factor) {
  const doc = obj(structuredClone(input)), f = Number(factor);
  /** @type {Array<{ path: string, params: string[] }>} */
  const changes = [];
  /** @type {unknown[]} */
  const unscaled = [];
  const result = () => ({ doc: /** @type {T} */ (/** @type {unknown} */ (doc)), changes, unscaled });
  if (!(f > 0) || f === 1) return result();
  // Entries that are not objects (a space, zone or generator) are left as they are.
  list(doc.spaces).forEach((space, i) => {
    if (!isObj(space)) return;
    const card = registry.get(str(space.use))?.card; if (!card) return;
    const axes = posAxes(registry, space);
    const s = scaleParams(Object.fromEntries(Object.entries(card.params || {}).filter(([, x]) => x.scale === 'world')), obj(space.with), f);
    if (s.changed.length) { space.with = s.config; changes.push({ path: `spaces[${i}].with`, params: s.changed }); }
    if (Array.isArray(space.zones) && space.zones.length) { space.zones = space.zones.map(z => (isObj(z) ? scaleZone(z, f, axes) : z)); changes.push({ path: `spaces[${i}].zones`, params: ['geometry'] }); }
    const player = doc.player;
    if (isObj(player) && (player.space ?? spaceAt(doc, 0).id) === space.id && Array.isArray(player.at)) { player.at = scalePos(player.at, f, axes); changes.push({ path: 'player.at', params: ['at'] }); }
    const area = spaceExtent(registry, space);
    list(space.generators).forEach((gen, j) => {
      if (!isObj(gen)) return;
      const p = generator(registry, gen.use); if (!p) return;
      const g = scaleParams(p.card.params, obj(gen.with), f, { defaults: false }), done = [...g.changed];
      gen.with = g.config;
      if (declaredExtent(p) === 'own' && area && typeof p.fit === 'function') {
        /** @type {Record<string, unknown> | null | undefined} */
        let fit = null; try { fit = p.fit(g.config, area, space); } catch { fit = null; }
        if (fit) { gen.with = { ...g.config, ...fit }; done.push(...Object.keys(fit).filter(k => !done.includes(k))); }
      }
      if (done.length) changes.push({ path: `spaces[${i}].generators[${j}].with`, params: done }); else unscaled.push(gen.use);
    });
  });
  return result();
}

/**
 * Fill the params of generator instances that a selection added without them (the skeleton lists `{use}` only)
 * through each generator's `scaffold` hook, then fit generated extents to their spaces (fitExtents).
 * Mutates and returns `doc`; -> fixes.
 * @param {Record<string, unknown>} doc a document or a draft (not preflighted) @param {RegistryLike} registry @returns {WorldFix[]}
 */
export function configureGenerators(doc, registry) {
  /** @type {WorldFix[]} */
  const fixes = [];
  // A draft may hold anything where a space or generator belongs: entries that are not objects are skipped.
  list(doc.spaces).forEach((space, i) => isObj(space) && list(space.generators).forEach((gen, j) => {
    if (!isObj(gen)) return;
    const p = generator(registry, gen.use);
    if (!p) return;
    // An own-extent generator the scaffold does not configure takes its size-dependent params (room count, area) from
    // the space's extent through its fit hook (provides.extent), never its card defaults.
    const fitted = () => {
      const area = spaceExtent(registry, space);
      if (!area || declaredExtent(p) !== 'own' || typeof p.fit !== 'function') return;
      /** @type {Record<string, unknown> | null | undefined} */
      let fit = null; try { fit = p.fit(obj(gen.with), area, space); } catch { fit = null; }
      if (!fit || Object.entries(fit).every(([k, v]) => JSON.stringify(obj(gen.with)[k]) === JSON.stringify(v))) return;
      gen.with = { ...obj(gen.with), ...fit };
      fixes.push({ code: 'world_extent_fit', path: `spaces[${i}].generators[${j}]`, action: `fitted ${String(gen.use)} to the ${area[2]}×${area[3]} space` });
    };
    if (typeof p.scaffold !== 'function') { fitted(); return; }
    const card = p.card, given = obj(gen.with);
    // Missing required params: the scaffold configures the instance (and its start). Otherwise it only fills params
    // the instance leaves unset (regions to keep clear, the proof's movement...), never overriding what is there.
    const missing = requiredParams(card).some(k => given[k] === undefined);
    /** @type {Scaffold | null | undefined} */
    let made = null;
    try { made = p.scaffold(space, doc, { envelope: envelopeFor(doc, registry, space), reserve: reservedRegions(doc, registry, space.id), registry }); } catch { made = null; }
    if (!made) { if (missing || !Object.keys(given).length) fitted(); return; }
    const unset = Object.keys(made.with || {}).filter(k => given[k] === undefined);
    if (!missing && !unset.length) return;
    applyScaffold(doc, i, gen, made, { start: missing, registry });
    fixes.push({ code: 'generator_scaffold', path: `spaces[${i}].generators[${j}]`, action: missing ? `configured ${String(gen.use)} from the zones` : `filled ${unset.join(', ')} of ${String(gen.use)}` });
  }));
  if (Array.isArray(doc.spaces)) fixes.push(...fitExtents(doc, registry));
  return fixes;
}
