// @ts-check
// Static composition checker: decides from card declarations alone (no simulation, milliseconds) whether a
// set of primitives composes on its spaces. Cards' requires/provides are the type system; this is its checker.
//
// Verdicts (in precedence order: a decided failure beats a hole):
//   incompatible                 a failure no adapter can fix (a conflict, a requirement nobody registers,
//                                an engagement contract nothing in the catalogue can satisfy);
//   incompatible-needs-adapter   capabilities, content or services are missing on a space; `signature` is the
//                                exact adapter card that would fix it (adapterSignature);
//   undeclared                   a card lacks a declaration needed to decide (a type hole): never "compatible";
//   compatible-via-adapter       composes because an adapter projects what the space lacks (`adapters` names it);
//   compatible                   composes as declared.
//
// Checks: capabilities (requires.capabilities ⊆ the bound space variant's capabilities, plus adapted ones),
// services (requires.services have a provider), required primitives, conflicts, content (the space's
// card.needs.content, and any card's own needs.content, covered by a generator whose card.spaces includes the
// space and whose provides.content covers it), engagement (card.engage is satisfiable: config sources, spawn
// roles need the spawner, enter effects need their owner, named params exist), data (card.reads sections have
// a declaring source: kernel base kinds, a card's defines/data/dataShapes, or a documented shape).
//
// Card fields read (besides KERNEL_API.md §1):
//   space      card.needs = { content: ['terrain', ...] }      ([] = needs nothing; absent = type hole)
//              card.provides.content = ['course']             (optional: content the space itself has)
//   generator  card.spaces = ['engine.space.tilemap', ...]     (absent = type hole)
//              card.provides.content = ['terrain', 'rooms']   (absent = type hole)
//   any card   card.needs.content                              (optional: content this mechanic needs on its space)
//   adapter    card.adapts = {
//                provides: { capabilities?: [...], content?: [...], services?: [...] },
//                from: { spaces?: [space primitive ids], capabilities?: [caps the space must already have] },
//                projection: 'one line: how the concept is projected onto the space',
//              }
//              An adapter is an ordinary systems primitive bound to a space (instance.space). When the space
//              matches `from`, everything in adapts.provides counts as provided there. Examples: a 2D
//              side-scroller on a mesh3d plane (capabilities gravity/navigate on a chosen plane); a race course
//              from a tilemap's zones (content 'course'); turn-based battles in a real-time space (a modal
//              sub-space: capability 'turns').
//              adapts.subspace = { kind: param, config: param, content?: [...] }: an instance WITH an id defines a
//              region space of that id (engine.adapt.projection): units bound to the id get the capabilities of
//              the space kind its with[kind] names, configured by with[config], and the region has `content`
//              from its host; the host itself gains nothing. Without an id (a compact selection that only asks
//              whether an adapter exists) its adapts.provides count on the host as above; never in a document,
//              where an instance without an id defines no region and gives its host nothing (as preflight).
//              adapts.relation = 'union' | 'nested' | 'skin' names the play-spec mashup relation it realises.
//              Preflight (v2/kernel/document.js) applies the same rules. planner/adapters.js resolveAdapters
//              turns an incompatible-needs-adapter verdict into adapter instances (or adapterSignature gaps).
//   mode       card.loop = { verbs, progress, win, lose, needs } and card.mode = { loop, interaction, opponent, space,
//                needs: { content, participants }, win: { param }, lose: { param }, bot } (the richer form), read
//                merged (loop.js cardLoop) on any primitive that declares either. The `mode` check confirms, for a selection or
//                a document: every core mechanic (selection.mechanics importance 'core') has a primitive;
//                mode.needs.content document sections ('content.cards') are declared by a card and non-empty in
//                the document (or opts.content, the content form), while entries without a '.' are world
//                content checked like card.needs.content; mode.needs.participants ({ param, min } or a number)
//                are present in a document; mode.space (space primitive ids) is the bound space or can be
//                reached through an adapter for the capabilities it lacks; mode.bot is a registered strategy
//                (v2/verify/strategies); mode.win.param (and lose.param) exist and, in a document, win is
//                wired to an ending (an end_game effect or a plot.endings id); and an input primitive whose
//                card.interactions includes the interaction the loop is played in is present: the play spec's
//                (opts.interaction) when the loop's declared interactions include it, else one of them (input
//                cards without card.interactions are a type hole).
//
// Planner use (select.js is owned elsewhere; the one call site to add, at the end of selectPrimitives just
// before `return`, with `selection` the object it is about to return):
//     const screen = screenSpaces(selection, registry, { documented: documentedBy(dataShapes) });
//     if (screen.reject.length && !excludeSpaces.length)
//       return selectPrimitives({ decomposition, registry, decisions, writer, log, excludeSpaces: screen.reject });
// screenSpaces only rejects spaces for decided failures attributable to the space (never for holes), so it
// can only replace a space the composition can't use with another one.
import { checkFields } from '../kernel/params.js';
import { subspaceCaps } from '../kernel/document.js';
import { Logic } from '../kernel/logic.js';
import { buildLogic } from '../kernel/world.js';
import { Registry } from '../kernel/registry.js';
import { strategies as STRATEGIES } from '../verify/strategies/index.js';
import { OUTLINE_AUTHORS } from './world.js';
import { cardLoop } from './loop.js';
import { list, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Card} Card */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').RegisteredPrimitive} RegisteredPrimitive */
/** @typedef {'compatible' | 'compatible-via-adapter' | 'incompatible-needs-adapter' | 'incompatible' | 'undeclared'} Verdict */
/** @typedef {'capabilities' | 'services' | 'primitives' | 'conflicts' | 'content' | 'engage' | 'data' | 'adapter' | 'mode'} CheckName */
/** @typedef {'ok' | 'fail' | 'needs-adapter' | 'undeclared'} CheckState */
/** @typedef {{ card: string, field: string, code: string, message: string }} Hole */
/** @typedef {{ kind: keyof Needs, item: string }} Need  what an adaptable failure lacks */
/** @typedef {{ check: CheckName, code: string, unit: string, space?: string, message: string, hint?: string, adaptable: boolean, need?: Need }} Failure */
/** @typedef {{ capabilities: string[], content: string[], services: string[] }} Needs */
/** @typedef {{ use: string, with: Record<string, any>, caps: Set<string>, base: Set<string>, zones: number, projected?: string, given?: string[] }} SpaceUnit  projected: the sub-space adapter defining it; given: content it has from its host */
/** @typedef {{ use: string, space: string, slot: 'space' | 'generator' | 'system' | 'graphics', added?: string, id?: string, with?: Record<string, any> }} Unit */
/** @typedef {{ use: string, id?: string, space?: string, with?: Record<string, any> }} AdapterInstance  an adapter systems instance (resolveAdapters output) */
/**
 * @typedef {object} Selection  a planner selection (select.js output) or a compact composition
 * @property {Array<{ id?: string, use: string, with?: Record<string, any>, zones?: unknown }>} [spaces]
 * @property {{ use: string, with?: Record<string, any> }} [space]   compact: a single space
 * @property {Array<string | { use?: string, id?: string, space?: string }>} [systems]
 * @property {Array<string | { use?: string, id?: string, space?: string }>} [generators]
 * @property {string[]} [primitives]                                   compact: systems/generators by id
 * @property {Array<{ id: string, importance?: string, primitives?: string[] }>} [mechanics]  select.js mechanics (core ones must map)
 * @property {Record<string, string>} [bind]                            primitive id -> space id
 * @property {AdapterInstance[]} [adapters]                              adapter instances (planner/adapters.js resolveAdapters)
 */
/**
 * @typedef {object} CheckOptions
 * @property {LogicLike} [logic]       vocabulary owners (built from the registry when omitted)
 * @property {boolean} [resolve]       add registered providers for missing requirements (default: true for a
 *                                     selection, false for a document, which must be complete as written)
 * @property {(section: string) => boolean} [documented]  extra data-shape oracle (e.g. documentedBy(dataShapes))
 * @property {Record<string, unknown>} [content]  the content form for a selection: document sections by path
 *                                     ('content.cards') or as a document-shaped object, for mode needs
 * @property {Iterable<string>} [strategies]  registered bot strategy ids (default: v2/verify/strategies)
 * @property {string | null} [interaction]  the play spec's interaction: a loop that serves it is played in it
 */
/**
 * @typedef {object} CompositionResult
 * @property {Verdict} verdict
 * @property {Record<CheckName, CheckState>} checks
 * @property {Failure[]} failures
 * @property {Hole[]} holes          type holes that left a check undeclared
 * @property {string[]} adapters     adapter primitives the composition relies on
 * @property {string[]} added        primitives resolve mode added (with resolve: true)
 * @property {AdapterSpec | null} signature  the adapter that would fix an incompatible-needs-adapter verdict
 * @property {string} reason         one line
 * @property {number} ms
 */
/**
 * @typedef {object} AdapterSpec
 * @property {string} id                 suggested primitive id
 * @property {{ intent: string, views: string[], params: {}, provides: { capabilities: string[], services: string[], events: string[] },
 *              requires: { capabilities: string[] }, adapts: { provides: Needs, from: { spaces: string[], capabilities: string[] }, projection: string } }} card
 * @property {string[]} neededBy
 */

export const COMPOSE_CHECK_VERSION = 'compose-check/0.2';

/** @type {Set<string>} Document sections the kernel itself indexes (BASE_DEFINES in kernel/document.js, plus beats). */
const KERNEL_SECTIONS = new Set(['plot.characters', 'plot.quests', 'plot.endings', 'plot.dialogue', 'plot.storyboard',
  'content.items', 'content.recipes', 'content.archetypes', 'content.blocks', 'content.models', 'spaces.zones']);
/** @type {CheckName[]} */
const CHECKS = ['capabilities', 'services', 'primitives', 'conflicts', 'content', 'engage', 'data', 'adapter', 'mode'];

const isSpace = (/** @type {string} */ id) => id.startsWith('engine.space.');
const isGenerator = (/** @type {string} */ id) => id.startsWith('engine.generate.');
const isGraphics = (/** @type {string} */ id) => id.startsWith('graphics.');
const short = (/** @type {string} */ id) => id.split('.').slice(isSpace(id) || isGenerator(id) ? 2 : 1).join('.');
/** @param {unknown} v @returns {v is any[]} */
const isList = v => Array.isArray(v);
/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** @type {WeakMap<object, LogicLike>} */
const logicCache = new WeakMap();
/** @param {RegistryLike} registry @returns {LogicLike} */
function logicOf(registry) {
  let l = logicCache.get(registry);
  if (!l) { l = /** @type {LogicLike} */ (/** @type {unknown} */ (buildLogic(registry, Logic))); logicCache.set(registry, l); }
  return l;
}

/** @param {RegistryLike} registry @param {string} id @returns {Card | null} */
const cardOf = (registry, id) => registry.get(id)?.card ?? null;

/** Capabilities of a space primitive with a configuration (card.capabilities(config) when params matter). */
export function capsOf(/** @type {RegistryLike} */ registry, /** @type {string} */ use, /** @type {Record<string, any>} */ config = {}) {
  const p = registry.get(use); if (!p) return new Set();
  /** @type {Record<string, any>} */
  const full = { ...checkFields(p.card.params || {}, {}, '', [], null), ...config };
  try { return new Set(p.capabilities ? p.capabilities(full) : p.card.provides.capabilities || []); } catch { return new Set(p.card.provides.capabilities || []); }
}

/**
 * Space kinds: every space primitive's default configuration plus each configuration whose capabilities
 * differ (one enumerated string/boolean param at a time), labelled `tilemap` / `tilemap{mode:side}`.
 * @param {RegistryLike} registry
 * @returns {Array<{ key: string, use: string, with: Record<string, any>, caps: string[] }>}
 */
export function spaceKinds(registry) {
  /** @type {Array<{ key: string, use: string, with: Record<string, any>, caps: string[] }>} */
  const out = [];
  for (const use of registry.ids('engine').filter(isSpace)) {
    const p = /** @type {RegisteredPrimitive} */ (registry.get(use));
    const base = capsOf(registry, use);
    const seen = [[...base].sort().join(',')];
    out.push({ key: short(use), use, with: {}, caps: [...base].sort() });
    if (!p.capabilities) continue;
    const defaults = checkFields(p.card.params || {}, {}, '', [], null);
    for (const [name, schema] of Object.entries(p.card.params || {})) {
      const values = schema.type === 'string' && schema.options ? schema.options : schema.type === 'boolean' ? [true, false] : [];
      for (const v of values) {
        if (v === defaults[name]) continue;
        const caps = [...capsOf(registry, use, { [name]: v })].sort(), sig = caps.join(',');
        if (seen.includes(sig)) continue;
        seen.push(sig);
        out.push({ key: `${short(use)}{${name}:${v}}`, use, with: { [name]: v }, caps });
      }
    }
  }
  return out;
}

/** The registered id satisfying a requires.primitives entry (exact or a child id). */
function satisfier(/** @type {RegistryLike} */ registry, /** @type {string} */ req) {
  if (registry.has(req)) return req;
  return registry.ids().find(id => id.startsWith(req + '.')) || null;
}
const satisfies = (/** @type {string} */ id, /** @type {string} */ req) => id === req || id.startsWith(req + '.');

/** The spawner: the primitive owning start spawns (params.rules + a spawn_rule define), as engage.js finds it. */
function spawnerOf(/** @type {RegistryLike} */ registry) {
  for (const id of registry.ids()) { const c = cardOf(registry, id); if (c?.params?.rules && (c.defines || []).some(d => d.kind === 'spawn_rule')) return id; }
  return null;
}

/** Whether an adapter's `from` matches a space (its primitive id and its native capabilities). */
export function adapterFits(/** @type {Card} */ card, /** @type {SpaceUnit} */ space) {
  const from = card.adapts?.from || {};
  return (!from.spaces || from.spaces.includes(space.use)) && (from.capabilities || []).every(c => space.base.has(c));
}

/**
 * Turn the planner's gap layer input into the adapter that would make a composition compatible: what it must
 * provide, which space it projects from, and the capabilities it may build on. Hand `card` to the gap
 * writer (ARCHITECTURE.md §4 step 4); it is gated like any new primitive (preflight, unit tests, playtest).
 * @param {{ space?: string, spaceCaps?: string[], capabilities?: string[], content?: string[], services?: string[], neededBy?: string[] }} missing
 * @returns {AdapterSpec}
 */
export function adapterSignature(missing) {
  const space = missing.space || 'engine.space.none';
  const provides = { capabilities: [...new Set(missing.capabilities || [])].sort(), content: [...new Set(missing.content || [])].sort(), services: [...new Set(missing.services || [])].sort() };
  const what = [...provides.capabilities, ...provides.content, ...provides.services];
  const slug = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'x';
  const parts = [provides.capabilities.length ? 'capabilities ' + provides.capabilities.join(', ') : '', provides.content.length ? 'content ' + provides.content.join(', ') : '', provides.services.length ? 'services ' + provides.services.join(', ') : ''].filter(Boolean);
  return {
    id: `engine.adapt.${slug(short(space))}.${slug(what[0] || 'concept')}`,
    card: {
      intent: `Projects ${parts.join('; ')} onto ${space}${missing.neededBy?.length ? ` so ${missing.neededBy.join(', ')} can run there` : ''}.`,
      views: ['any'], params: {},
      provides: { capabilities: provides.capabilities, services: provides.services, events: [] },
      requires: { capabilities: (missing.spaceCaps || []).includes('position') ? ['position'] : [] },
      adapts: { provides, from: { spaces: [space], capabilities: [...(missing.spaceCaps || [])].sort() }, projection: `TODO: how ${what.join(', ') || 'the concept'} is projected onto ${short(space)}` },
    },
    neededBy: [...new Set(missing.neededBy || [])].sort(),
  };
}

/**
 * A data-shape oracle from catalog.js's dataShapes(registry, ids): a section counts as documented when
 * dataShapes returns a shape for it that the base sections don't. Lets callers outside the strict-typed
 * kernel (which must not import the planner catalogue) pass PRIMITIVE_CATALOG.md shapes in.
 * @param {(registry: any, ids: string[]) => string[]} dataShapes
 * @returns {(section: string) => boolean}
 */
export function documentedBy(dataShapes) {
  const stub = (/** @type {string[]} */ reads) => ({ get: () => ({ card: { reads } }) });
  const base = new Set(dataShapes(stub([]), ['x']));
  /** @type {Map<string, boolean>} */
  const memo = new Map();
  return section => {
    if (!memo.has(section)) memo.set(section, dataShapes(stub([section]), ['x']).some(s => !base.has(s)));
    return Boolean(memo.get(section));
  };
}

/** @type {WeakMap<object, Map<string, string>>} */
const declaredCache = new WeakMap();
/** Section path -> the card that declares its shape (defines.at, card.data, card.dataShapes). */
function declarers(/** @type {RegistryLike} */ registry) {
  let m = declaredCache.get(registry);
  if (m) return m;
  m = new Map();
  for (const id of registry.ids()) {
    const c = /** @type {Card} */ (cardOf(registry, id));
    for (const d of c.defines || []) if (d.at && !m.has(d.at)) m.set(d.at, id);
    for (const k of [...Object.keys(c.data || {}), ...Object.keys(c.dataShapes || {})]) if (!m.has(k)) m.set(k, id);
  }
  declaredCache.set(registry, m);
  return m;
}
/** True when the section (or a parent section) has a declaring source. */
/** A card param by path: 'onWin', or 'counters.onComplete' (a field of a list or object param's entries). */
function paramSpec(/** @type {Record<string, any>} */ params, /** @type {string} */ path) {
  const [head, ...rest] = path.split('.');
  let spec = params?.[head];
  for (const k of rest) { const fields = spec?.of?.fields || spec?.fields; spec = fields?.[k]; }
  return spec || null;
}

function sectionDeclared(/** @type {RegistryLike} */ registry, /** @type {string} */ section, /** @type {((s: string) => boolean) | undefined} */ documented) {
  const parts = section.split('.');
  for (let i = parts.length; i >= 2; i--) {
    const s = parts.slice(0, i).join('.');
    if (KERNEL_SECTIONS.has(s) || declarers(registry).has(s) || documented?.(s)) return true;
  }
  return false;
}

/**
 * Normalize a document, a select.js selection or a compact { space, primitives } into spaces and units.
 * @param {Doc | Selection} input
 * @param {RegistryLike} registry
 */
function normalize(input, registry) {
  /** @type {Map<string, SpaceUnit>} */
  const spaces = new Map();
  /** @type {Unit[]} */
  const units = [];
  const sel = /** @type {Selection & Partial<Doc>} */ (input);
  // A document has a schema or instance objects in systems; a selection lists system ids.
  const isDoc = typeof sel.schema === 'string' || (isList(sel.systems) && sel.systems.some(s => isObj(s) && typeof s.use === 'string'));
  const spaceList = isList(sel.spaces) ? sel.spaces : sel.space ? [{ id: 'world', ...sel.space }] : [];
  spaceList.forEach((s, i) => {
    const id = s.id || `space${i}`, base = capsOf(registry, s.use, s.with || {});
    spaces.set(id, { use: s.use, with: s.with || {}, base, caps: new Set(base), zones: list(s.zones).length });
    units.push({ use: s.use, space: id, slot: 'space' });
    for (const g of /** @type {any} */ (s).generators || []) if (g?.use) units.push({ use: g.use, space: id, slot: 'generator' });
  });
  const first = [...spaces.keys()][0] ?? 'world';
  const bind = sel.bind || {};
  const add = (/** @type {string | { use?: string, id?: string, space?: string, with?: Record<string, any> }} */ x, /** @type {Unit['slot']} */ slot) => {
    const use = typeof x === 'string' ? x : x.use ?? x.id;
    if (!use) return;
    const space = (typeof x === 'string' ? undefined : x.space) ?? bind[use] ?? first;
    const extra = typeof x === 'string' ? {} : { ...(typeof x.id === 'string' && x.use ? { id: x.id } : {}), ...(isObj(x.with) ? { with: x.with } : {}) };
    units.push({ use, space, slot: isGenerator(use) ? 'generator' : isGraphics(use) ? 'graphics' : slot, ...extra });
  };
  for (const g of sel.generators || []) add(g, 'generator');
  for (const s of sel.systems || []) add(s, 'system');
  for (const p of sel.primitives || []) add(p, 'system');
  for (const a of isList(sel.adapters) ? sel.adapters : []) add(a, 'system');
  for (const g of /** @type {any[]} */ (isDoc ? sel.graphics || [] : [])) add(g, 'graphics');
  // Sub-space adapter instances with an id define a region space of the kind they project (card.adapts.subspace).
  for (const u of units) {
    const sub = cardOf(registry, u.use)?.adapts?.subspace;
    if (!sub || typeof u.id !== 'string' || spaces.has(u.id)) continue;
    const w = u.with || {}, kind = typeof w[sub.kind] === 'string' ? w[sub.kind] : '';
    const caps = subspaceCaps(registry, sub, w);
    spaces.set(u.id, { use: kind || u.use, with: (sub.config && isObj(w[sub.config]) ? w[sub.config] : {}), base: caps, caps: new Set(caps), zones: list(w.zones).length, projected: u.use, given: [...(sub.content || [])] });
  }
  const mechanics = isList(sel.mechanics) ? sel.mechanics.filter(isObj) : [];
  return { spaces, units, isDoc, mechanics };
}

/**
 * The spaces of a composition (document, selection or compact form), with the capabilities each provides
 * natively, including the regions sub-space adapter instances define.
 * @param {Doc | Selection} input @param {RegistryLike} registry
 * @returns {Array<{ id: string, use: string, with: Record<string, any>, caps: string[], projected?: string }>}
 */
export function compositionSpaces(input, registry) {
  return [...normalize(input, registry).spaces].map(([id, s]) => ({ id, use: s.use, with: s.with, caps: [...s.base].sort(), ...(s.projected ? { projected: s.projected } : {}) }));
}

/**
 * Whether a space carries world content `item` in its own params (card.provides.contentParams): in a document, when
 * one of those params is non-empty; in a selection, the document will write them (as the outline writes zones).
 * @param {Card} card @param {SpaceUnit} space @param {string} item @param {boolean} isDoc
 */
function inParams(card, space, item, isDoc) {
  const params = card.provides.contentParams?.[item];
  if (!isList(params) || !params.length) return false;
  return !isDoc || params.some(p => { const v = space.with?.[p]; return isList(v) ? v.length > 0 : isObj(v) ? Object.keys(v).length > 0 : v != null; });
}

/**
 * checkComposition(doc | selection, registry, opts?) -> CompositionResult. Pure and static: card declarations only.
 * @param {Doc | Selection} input
 * @param {RegistryLike} registry
 * @param {CheckOptions} [opts]
 * @returns {CompositionResult}
 */
export function checkComposition(input, registry, opts = {}) {
  const started = performance.now();
  const logic = opts.logic || logicOf(registry);
  const { spaces, units, isDoc, mechanics } = normalize(input, registry);
  const strategyIds = new Set(opts.strategies ?? STRATEGIES.keys());
  const resolve = opts.resolve ?? !isDoc;
  /** @type {string[]} */
  const added = [];
  let result = evaluate();
  // Resolve: add registered providers (required primitives, services, content generators, engagement owners,
  // adapters) and re-evaluate until nothing new is added. Bounded: each pass adds at least one new primitive.
  for (let pass = 0; resolve && result.additions.length && pass < 12; pass++) {
    for (const a of result.additions) if (!units.some(u => u.use === a.use && u.space === a.space)) { units.push(a); added.push(a.use); }
    result = evaluate();
  }

  function evaluate() {
    /** @type {Failure[]} */
    const failures = [];
    /** @type {Hole[]} */
    const holes = [];
    /** @type {Unit[]} */
    const additions = [];
    /** @type {Record<CheckName, CheckState>} */
    const checks = /** @type {any} */ (Object.fromEntries(CHECKS.map(c => [c, 'ok'])));
    const mark = (/** @type {CheckName} */ c, /** @type {CheckState} */ s) => { const rank = { ok: 0, undeclared: 1, 'needs-adapter': 2, fail: 3 }; if (rank[s] > rank[checks[c]]) checks[c] = s; };
    const hole = (/** @type {CheckName} */ c, /** @type {Hole} */ h) => { mark(c, 'undeclared'); if (!holes.some(x => x.card === h.card && x.code === h.code && x.field === h.field)) holes.push(h); };
    const fail = (/** @type {Failure} */ f) => { mark(f.check, f.adaptable ? 'needs-adapter' : 'fail'); failures.push(f); };
    const propose = (/** @type {string} */ use, /** @type {string} */ space, /** @type {string} */ why) => {
      if (!resolve || units.some(u => u.use === use && u.space === space) || additions.some(a => a.use === use && a.space === space)) return false;
      additions.push({ use, space, slot: isGenerator(use) ? 'generator' : 'system', added: why });
      return true;
    };
    const known = units.filter(u => registry.has(u.use));
    for (const u of units) if (!registry.has(u.use)) fail({ check: 'primitives', code: 'primitive_unknown', unit: u.use, message: `'${u.use}' is not registered`, adaptable: false });
    const used = new Set(known.map(u => u.use));
    /** @type {string[]} */
    const adapters = [];

    // Adapted capabilities per space (adapters bound to a space they fit).
    for (const s of spaces.values()) s.caps = new Set(s.base);
    for (const u of known) {
      const c = /** @type {Card} */ (cardOf(registry, u.use)); if (!c.adapts) continue;
      const s = spaces.get(u.space); if (!s) continue;
      if (!isList(c.adapts.provides?.capabilities) && !isList(c.adapts.provides?.content) && !isList(c.adapts.provides?.services)) { hole('adapter', { card: u.use, field: 'card.adapts.provides', code: 'adapter_malformed', message: 'card.adapts needs provides.{capabilities,content,services}' }); continue; }
      if (!adapterFits(c, s)) { fail({ check: 'adapter', code: 'adapter_from_mismatch', unit: u.use, space: u.space, message: `adapter '${u.use}' does not project from '${s.use}'`, hint: `adapts.from: ${JSON.stringify(c.adapts.from || {})}`, adaptable: false }); continue; }
      adapters.push(u.use);
      // A sub-space adapter's region has them; in a document one without an id defines no region and lends its host
      // nothing (preflight's rule: the host never gains what a projection could project).
      if (c.adapts.subspace && (typeof u.id === 'string' ? spaces.get(u.id)?.projected === u.use : isDoc)) continue;
      for (const cap of c.adapts.provides.capabilities || []) s.caps.add(cap);
    }
    /** @param {(c: NonNullable<Card['adapts']>) => string[] | undefined} pick @param {string} item @param {SpaceUnit} space */
    const adapterFor = (pick, item, space) => registry.ids().filter(id => { const c = cardOf(registry, id); return c?.adapts && (pick(c.adapts) || []).includes(item) && adapterFits(c, space); })
      .sort((a, b) => ((cardOf(registry, a)?.requires.capabilities || []).every(x => space.base.has(x)) ? 0 : 1) - ((cardOf(registry, b)?.requires.capabilities || []).every(x => space.base.has(x)) ? 0 : 1) || a.localeCompare(b))[0] || null;
    /** @type {Map<string, Needs & { neededBy: string[] }>} space id -> what an adapter would have to provide */
    const missing = new Map();
    const need = (/** @type {string} */ space, /** @type {keyof Needs} */ kind, /** @type {string} */ item, /** @type {string} */ by) => {
      const m = missing.get(space) || { capabilities: [], content: [], services: [], neededBy: [] };
      if (!m[kind].includes(item)) m[kind].push(item);
      if (!m.neededBy.includes(by)) m.neededBy.push(by);
      missing.set(space, m);
    };

    // Capabilities and required primitives.
    for (const u of known) {
      const c = /** @type {Card} */ (cardOf(registry, u.use)), s = spaces.get(u.space);
      if (!s) { fail({ check: 'capabilities', code: 'space_unknown', unit: u.use, space: u.space, message: `'${u.use}' is bound to unknown space '${u.space}'`, adaptable: false }); continue; }
      for (const cap of c.requires.capabilities || []) {
        if (s.caps.has(cap)) continue;
        const a = adapterFor(x => x.provides.capabilities, cap, s);
        if (a && propose(a, u.space, `adapts ${cap} for ${u.use}`)) continue;
        need(u.space, 'capabilities', cap, u.use);
        fail({ check: 'capabilities', code: 'capability_missing', unit: u.use, space: u.space, message: `'${u.use}' needs ${cap} from ${s.use}`, hint: `${short(s.use)} provides: ${[...s.caps].join(', ') || 'nothing'}`, adaptable: true, need: { kind: 'capabilities', item: cap } });
      }
      for (const req of c.requires.primitives || []) {
        if ([...used].some(id => satisfies(id, req))) continue;
        const sat = satisfier(registry, req);
        if (sat && propose(sat, u.space, `required by ${u.use}`)) continue;
        if (!sat) hole('primitives', { card: u.use, field: 'card.requires.primitives', code: 'requires_unregistered', message: `requires '${req}', which no registered primitive satisfies` });
        else fail({ check: 'primitives', code: 'requires_unmet', unit: u.use, message: `'${u.use}' requires a '${req}' primitive`, hint: `add ${sat}`, adaptable: false });
      }
      for (const x of c.conflicts || []) {
        if (!registry.has(x)) hole('conflicts', { card: u.use, field: 'card.conflicts', code: 'conflict_unregistered', message: `conflicts with unregistered '${x}'` });
        else if (used.has(x)) fail({ check: 'conflicts', code: 'primitive_conflict', unit: u.use, message: `'${u.use}' conflicts with '${x}'`, adaptable: false });
      }
    }

    // Services: provided by a used primitive or an active adapter.
    const services = new Set(known.flatMap(u => cardOf(registry, u.use)?.provides.services || []));
    for (const a of adapters) for (const sv of cardOf(registry, a)?.adapts?.provides.services || []) services.add(sv);
    for (const u of known) for (const sv of cardOf(registry, u.use)?.requires.services || []) {
      if (services.has(sv)) continue;
      const s = /** @type {SpaceUnit} */ (spaces.get(u.space) || [...spaces.values()][0]);
      // Providers that can live on this space: capabilities fit and, for declared generators, card.spaces includes it.
      const providers = registry.ids().filter(id => !isSpace(id) && (cardOf(registry, id)?.provides.services || []).includes(sv));
      const fits = providers.filter(id => { const c = /** @type {Card} */ (cardOf(registry, id)); return (c.requires.capabilities || []).every(x => s.caps.has(x)) && (!isGenerator(id) || !c.spaces || c.spaces.includes(s.use)); });
      if (fits[0] && propose(fits[0], u.space, `provides service ${sv} for ${u.use}`)) continue;
      const a = s && adapterFor(x => x.provides.services, sv, s);
      if (a && propose(a, u.space, `adapts service ${sv} for ${u.use}`)) continue;
      if (!providers.length && !a) hole('services', { card: u.use, field: 'card.requires.services', code: 'service_unprovided', message: `requires service '${sv}', which no registered card provides` });
      need(u.space, 'services', sv, u.use);
      fail({ check: 'services', code: 'service_missing', unit: u.use, space: u.space, message: `'${u.use}' needs service '${sv}'`, hint: providers.length ? `providers: ${providers.join(', ')}${resolve ? ` (none fits ${short(s.use)})` : ''}` : 'no card provides it', adaptable: true, need: { kind: 'services', item: sv } });
    }

    // Content: each space's needs (card.needs.content, or any one of card.needs.alternatives), plus any bound
    // card's own needs.content, covered on that space. Outline-authored kinds (world.js OUTLINE_AUTHORS: zones)
    // need no generator; in a document the space must have them.
    for (const [sid, s] of spaces) {
      const sc = cardOf(registry, s.use); if (!sc) continue;
      const here = known.filter(u => u.space === sid);
      const gens = resolve ? registry.ids('engine').filter(isGenerator) : here.filter(u => u.slot === 'generator').map(u => u.use);
      const fitsCaps = (/** @type {string} */ id) => (cardOf(registry, id)?.requires.capabilities || []).every(x => s.caps.has(x));
      const declared = gens.filter(id => { const c = cardOf(registry, id); return c && isList(c.spaces) && isList(c.provides.content); });
      /**
       * How `item` is covered on this space: 'have' (already), a generator or adapter id to add, 'holes' (an
       * undeclared generator might cover it), or null (nothing can).
       * @param {string} item @returns {{ how: 'have' } | { how: 'add', id: string, adapter: boolean } | { how: 'holes', ids: string[] } | null}
       */
      const coverOf = item => {
        if ((sc.provides.content || []).includes(item) || (s.given || []).includes(item)) return { how: 'have' }; // a space may carry it (a track is a course; a region has it from its host)
        if (inParams(sc, s, item, isDoc)) return { how: 'have' };
        if (OUTLINE_AUTHORS.includes(item) && (!isDoc || s.zones > 0)) return { how: 'have' };
        if (here.some(u => { const c = cardOf(registry, u.use); return (u.slot === 'generator' && (c?.provides.content || []).includes(item) && (!c?.spaces || c.spaces.includes(s.use))) || (adapters.includes(u.use) && (c?.adapts?.provides.content || []).includes(item)); })) return { how: 'have' };
        // A generator that carries a loop of its own (card.loop / card.mode: a crawl with its boss) is a mechanic, not
        // filler: content coverage never adds one (loop.js winProviders keeps the same rule for wins).
        const cand = declared.find(id => { const c = /** @type {Card} */ (cardOf(registry, id)); return !cardLoop(c) && /** @type {string[]} */ (c.spaces).includes(s.use) && /** @type {string[]} */ (c.provides.content).includes(item) && fitsCaps(id); });
        if (cand && resolve) return { how: 'add', id: cand, adapter: false };
        const a = adapterFor(x => x.provides.content, item, s);
        if (a && resolve) return { how: 'add', id: a, adapter: true };
        const unknown = gens.filter(id => !declared.includes(id) && fitsCaps(id) && (!isList(cardOf(registry, id)?.spaces) || /** @type {string[]} */ (cardOf(registry, id)?.spaces).includes(s.use)));
        return unknown.length ? { how: 'holes', ids: unknown } : null;
      };
      /** @type {Array<{ item: string, by: string }>} */
      const wanted = [];
      if (!sc.needs || !isList(sc.needs.content)) hole('content', { card: s.use, field: 'card.needs.content', code: 'space_needs_undeclared', message: 'space does not declare the content it needs (card.needs.content; [] for none)' });
      else {
        const sets = [sc.needs.content, ...list(prop(sc.needs, 'alternatives')).filter(/** @returns {a is string[]} */ a => isList(a) && a.length > 0 && a.every(x => typeof x === 'string'))];
        // The first set every item of which can be covered; else the first set, whose gaps are then reported.
        const pick = sets.find(set => set.every(item => { const c = coverOf(item); return c !== null && c.how !== 'holes'; })) || sets[0];
        for (const item of pick) wanted.push({ item, by: s.use });
      }
      for (const u of here) if (u.slot !== 'space') for (const item of cardOf(registry, u.use)?.needs?.content || []) wanted.push({ item, by: u.use });
      for (const { item, by } of wanted) {
        const c = coverOf(item);
        if (c?.how === 'have') continue;
        if (c?.how === 'add' && propose(c.id, sid, `${c.adapter ? 'adapts content' : 'generates'} ${item} for ${by}`)) continue;
        if (c?.how === 'holes') {
          for (const g of c.ids) {
            const gc = /** @type {Card} */ (cardOf(registry, g));
            if (!isList(gc.spaces)) hole('content', { card: g, field: 'card.spaces', code: 'generator_spaces_undeclared', message: 'generator does not declare which spaces it fills (card.spaces)' });
            if (!isList(gc.provides.content)) hole('content', { card: g, field: 'card.provides.content', code: 'generator_content_undeclared', message: 'generator does not declare the content it provides (card.provides.content)' });
          }
          continue;
        }
        need(sid, 'content', item, by);
        const authoredMsg = OUTLINE_AUTHORS.includes(item) ? `the document gives ${short(s.use)} no ${item}` : `no generator provides '${item}' on ${short(s.use)}`;
        fail({ check: 'content', code: 'content_missing', unit: by, space: sid, message: `${authoredMsg} (needed by ${by})`, hint: declared.filter(id => (cardOf(registry, id)?.provides.content || []).includes(item)).map(id => `${id} provides it on ${(cardOf(registry, id)?.spaces || []).map(short).join(', ')}`).join('; ') || `no generator declares '${item}'`, adaptable: !OUTLINE_AUTHORS.includes(item), need: { kind: 'content', item } });
      }
    }

    // Engagement: card.engage must be satisfiable by this composition (or the catalogue, when resolving).
    const reading = new Set(known.flatMap(u => [...(cardOf(registry, u.use)?.reads || []), ...(cardOf(registry, u.use)?.defines || []).map(d => d.at).filter(Boolean)]));
    for (const u of known) {
      const c = /** @type {Card} */ (cardOf(registry, u.use)), e = c.engage; if (!e) continue;
      const param = (/** @type {string | undefined} */ p, /** @type {string} */ field) => { if (p && !c.params[p]) hole('engage', { card: u.use, field, code: 'engage_param_unknown', message: `engage names param '${p}', which the card does not have` }); };
      param(e.participants?.param, 'card.engage.participants.param');
      param(e.join?.param, 'card.engage.join.param');
      const sources = JSON.stringify(e.config || {}).match(/\$(?:first|ids):[A-Za-z0-9_.]+/g) || [];
      for (const src of sources) {
        const path = src.slice(src.indexOf(':') + 1);
        if (path.startsWith('with.')) { param(path.slice(5).split('.')[0], 'card.engage.config'); continue; }
        if (reading.has(path) || KERNEL_SECTIONS.has(path)) continue;
        const definer = declarers(registry).get(path);
        if (definer && propose(definer, u.space, `defines ${path} for ${u.use}`)) continue;
        if (!definer) hole('engage', { card: u.use, field: 'card.engage.config', code: 'engage_source_undeclared', message: `engage fills a param from ${path}, which no card declares` });
        else fail({ check: 'engage', code: 'engage_source_missing', unit: u.use, message: `'${u.use}' is engaged from ${path}, which nothing in the composition reads or defines`, hint: `add ${definer}`, adaptable: false });
      }
      if (e.player?.spawn || e.actors?.spawn || e.participants) {
        const sp = spawnerOf(registry);
        if (!sp) fail({ check: 'engage', code: 'engage_spawner_missing', unit: u.use, message: `'${u.use}' spawns participants, but no primitive owns start spawns`, adaptable: false });
        else if (!used.has(sp) && !propose(sp, u.space, `spawns participants for ${u.use}`)) fail({ check: 'engage', code: 'engage_spawner_missing', unit: u.use, message: `'${u.use}' spawns participants; add ${sp}`, adaptable: false });
      }
      for (const eff of [...(e.player?.enter || []), ...(e.actors?.enter || [])]) {
        const owner = logic.owners.effect.get(eff.do);
        if (!owner) { hole('engage', { card: u.use, field: 'card.engage.*.enter', code: 'engage_effect_unowned', message: `engage runs effect '${eff.do}', which nobody registers` }); continue; }
        if (owner === 'kernel' || used.has(owner) || cardOf(registry, owner)?.ambient) continue;
        if (!propose(owner, u.space, `owns ${eff.do} for ${u.use}`)) fail({ check: 'engage', code: 'engage_owner_missing', unit: u.use, message: `'${u.use}' is engaged with '${eff.do}', owned by '${owner}'`, hint: `add ${owner}`, adaptable: false });
      }
    }

    // Mode: a mechanic's card.mode (see the header) must be satisfiable by this composition.
    for (const m of mechanics) if (m.importance === 'core' && !(m.primitives || []).some(id => registry.has(id)))
      fail({ check: 'mode', code: 'core_mechanic_unmapped', unit: String(m.id), message: `core mechanic '${m.id}' has no primitive`, hint: 'map it to a catalogue primitive or write one (gap layer)', adaptable: false });
    const docLike = isDoc ? /** @type {Record<string, any>} */ (input) : null;
    const form = opts.content || null;
    const sectionValue = (/** @type {string} */ path) => {
      // A path through a list reads every entry ('spaces.zones': the zones of every space).
      /** @param {any} o @param {string} k @returns {unknown} */
      const step = (o, k) => (isList(o) ? o.flatMap(x => { /** @type {unknown} */ const v = step(x, k); return v === undefined ? [] : isList(v) ? v : [v]; }) : isObj(o) ? o[k] : undefined);
      const at = (/** @type {unknown} */ root) => path.split('.').reduce(step, root);
      return docLike ? at(docLike) : form ? (path in form ? form[path] : at(form)) : undefined;
    };
    const nonEmpty = (/** @type {unknown} */ v) => isList(v) ? v.length > 0 : isObj(v) ? Object.keys(v).length > 0 : false;
    const inputs = known.filter(u => u.use.startsWith('engine.input.'));
    for (const u of known) {
      // The loop declaration: card.loop merged over card.mode (the richer form), as loop.js reads it.
      const c = /** @type {Card} */ (cardOf(registry, u.use));
      const malformed = ['loop', 'mode'].find(k => c[k] !== undefined && !isObj(c[k]));
      if (malformed) { hole('mode', { card: u.use, field: `card.${malformed}`, code: 'mode_malformed', message: `card.${malformed} must be an object` }); continue; }
      const md = /** @type {Record<string, any> | null} */ (cardLoop(c));
      if (!md) continue;
      const s = spaces.get(u.space);
      const inst = docLike ? [...(docLike.systems || []), ...(docLike.graphics || [])].find((/** @type {any} */ x) => isObj(x) && x.use === u.use) : null;
      // needs.content: document sections (declared, non-empty) and world content (generators / adapters).
      for (const item of isList(md.needs?.content) ? md.needs.content : []) {
        if (typeof item !== 'string') continue;
        if (!item.includes('.')) {
          if (!s) continue;
          const sc = cardOf(registry, s.use);
          const has = (sc?.provides.content || []).includes(item) || (s.given || []).includes(item) || (sc ? inParams(sc, s, item, isDoc) : false) || known.some(g => g.space === u.space && ((g.slot === 'generator' && (cardOf(registry, g.use)?.provides.content || []).includes(item)) || (adapters.includes(g.use) && (cardOf(registry, g.use)?.adapts?.provides.content || []).includes(item))));
          if (has) continue;
          const gen = registry.ids('engine').filter(isGenerator).find(id => { const gc = cardOf(registry, id); return gc && !cardLoop(gc) && isList(gc.spaces) && gc.spaces.includes(s.use) && (gc.provides.content || []).includes(item) && (gc.requires.capabilities || []).every(x => s.caps.has(x)); });
          if (gen && propose(gen, u.space, `generates ${item} for ${u.use}'s mode`)) continue;
          const a = adapterFor(x => x.provides.content, item, s);
          if (a && propose(a, u.space, `adapts content ${item} for ${u.use}'s mode`)) continue;
          need(u.space, 'content', item, u.use);
          fail({ check: 'mode', code: 'mode_content_missing', unit: u.use, space: u.space, message: `'${u.use}' mode needs '${item}' on ${short(s.use)}`, adaptable: true, need: { kind: 'content', item } });
          continue;
        }
        if (!sectionDeclared(registry, item, opts.documented)) { hole('mode', { card: u.use, field: 'card.mode.needs.content', code: 'mode_section_undeclared', message: `mode needs ${item}, whose shape no card declares` }); continue; }
        if (!reading.has(item) && !KERNEL_SECTIONS.has(item)) {
          const definer = declarers(registry).get(item);
          if (definer && definer !== u.use && propose(definer, u.space, `defines ${item} for ${u.use}'s mode`)) continue;
        }
        if ((docLike || form) && !nonEmpty(sectionValue(item))) fail({ check: 'mode', code: 'mode_section_empty', unit: u.use, message: `'${u.use}' needs ${item}, which is empty`, hint: `write ${item} in the document`, adaptable: false });
      }
      // needs.participants: { param, min } or a number (the player counts as one).
      const part = md.needs?.participants;
      if (part !== undefined && part !== null) {
        const p = isObj(part) && typeof part.param === 'string' ? part.param : c.engage?.participants?.param;
        const min = isObj(part) ? (typeof part.min === 'number' ? part.min : 1) : typeof part === 'number' ? part : 1;
        if (p && !c.params[p]) hole('mode', { card: u.use, field: 'card.mode.needs.participants', code: 'mode_param_unknown', message: `mode names param '${p}', which the card does not have` });
        else if (inst && p) {
          const listed = isList(inst.with?.[p]) ? inst.with[p].length : 0;
          const count = listed + (typeof part === 'number' ? 1 : 0);
          if (count < min) fail({ check: 'mode', code: 'mode_participants_missing', unit: u.use, message: `'${u.use}' needs ${min} participant(s) in with.${p}, has ${count}`, adaptable: false });
        }
      }
      // space: the bound space, or the capabilities it lacks through an adapter. An alternative is a space id or a
      // capability list any space providing them satisfies (card.mode.space).
      const alts = (isList(md.space) ? md.space : typeof md.space === 'string' ? [md.space] : []).filter((/** @type {unknown} */ x) => typeof x === 'string' || (isList(x) && x.every(c => typeof c === 'string')));
      const fits = (/** @type {string | string[]} */ a) => !s ? true : typeof a === 'string' ? a === s.use : a.every(c => s.caps.has(c));
      if (alts.length && s && !alts.some(fits)) {
        const ids = /** @type {string[]} */ (alts.filter(a => typeof a === 'string'));
        const target = ids.find(id => registry.has(id));
        const capList = /** @type {string[][]} */ (alts.filter(a => isList(a)))[0];
        const lacking = target ? [...capsOf(registry, target)].filter(x => !s.caps.has(x)) : capList ? capList.filter(x => !s.caps.has(x)) : null;
        if (!lacking) hole('mode', { card: u.use, field: 'card.mode.space', code: 'mode_space_unregistered', message: `mode.space names no registered space (${ids.join(', ')})` });
        else for (const cap of lacking) {
          const a = adapterFor(x => x.provides.capabilities, cap, s);
          if (a && propose(a, u.space, `adapts ${cap} for ${u.use}'s mode space`)) continue;
          need(u.space, 'capabilities', cap, u.use);
          fail({ check: 'mode', code: 'mode_space_mismatch', unit: u.use, space: u.space, message: `'${u.use}' plays on ${target ? short(target) : `a space with ${capList.join(', ')}`}; ${short(s.use)} lacks ${cap}`, adaptable: true, need: { kind: 'capabilities', item: cap } });
        }
      }
      // bot: a registered strategy.
      if (md.bot !== undefined && md.bot !== null && !(typeof md.bot === 'string' && strategyIds.has(md.bot)))
        fail({ check: 'mode', code: 'mode_bot_unregistered', unit: u.use, message: `'${u.use}' mode.bot '${String(md.bot)}' is not a registered strategy`, hint: `strategies: ${[...strategyIds].join(', ')}`, adaptable: false });
      // win/lose params exist; in a document, win is wired to an ending.
      for (const side of ['win', 'lose']) {
        const param = md[side]?.param;
        if (param == null) continue;
        // A mode played through another primitive (card.mode.via) names that primitive's params.
        const owner = /** @type {Record<string, any>} */ ((typeof md.via === 'string' ? cardOf(registry, md.via)?.params : c.params) || {});
        if (typeof param !== 'string' || !paramSpec(owner, param)) { hole('mode', { card: u.use, field: `card.mode.${side}.param`, code: 'mode_param_unknown', message: `mode.${side}.param '${String(param)}' is not a card param` }); continue; }
        if (side !== 'win' || !docLike || param.includes('.')) continue;
        const value = inst?.with?.[param] ?? c.params[param].default;
        const endings = new Set((isList(docLike.plot?.endings) ? docLike.plot.endings : []).map((/** @type {any} */ e) => e?.id).filter((/** @type {unknown} */ x) => typeof x === 'string'));
        const text = JSON.stringify(value ?? null);
        const wired = /"do":"end_game"/.test(text) || (typeof value === 'string' && endings.has(value)) || [...endings].some(id => text.includes(`"${id}"`));
        if (!wired) fail({ check: 'mode', code: 'mode_win_unwired', unit: u.use, message: `'${u.use}' with.${param} reaches no ending`, hint: 'end the game (end_game) or name a plot.endings id there', adaptable: false });
      }
      // interaction: an input primitive that serves the interaction the loop is played in (the play spec's when the
      // loop serves it, else any it declares).
      const own = /** @type {string[]} */ (md.interactions).filter(x => x !== 'none');
      const played = opts.interaction && own.includes(opts.interaction) ? [opts.interaction] : own;
      if (played.length) {
        const pool = inputs.length ? inputs.map(i => i.use) : registry.ids('engine').filter(id => id.startsWith('engine.input.'));
        const declared = pool.filter(id => isList(cardOf(registry, id)?.interactions));
        const servedBy = (/** @type {string} */ id) => played.find(x => /** @type {unknown[]} */ (cardOf(registry, id)?.interactions).includes(x));
        const match = declared.find(id => servedBy(id));
        // An input the host supplies when a document leaves it out (card.hostDefault) needs no instance.
        if (match) { if (!inputs.some(i => i.use === match) && !propose(match, u.space, `input for ${u.use}'s ${servedBy(match)} interaction`) && !cardOf(registry, match)?.hostDefault) fail({ check: 'mode', code: 'mode_input_missing', unit: u.use, message: `'${u.use}' needs input ${match}`, adaptable: false }); continue; }
        const undeclared = pool.filter(id => !declared.includes(id));
        if (undeclared.length) for (const id of undeclared) hole('mode', { card: id, field: 'card.interactions', code: 'input_interactions_undeclared', message: 'input primitive does not declare the interactions it supports (card.interactions)' });
        else fail({ check: 'mode', code: 'mode_input_mismatch', unit: u.use, message: `no input primitive supports the ${played.map(x => `'${x}'`).join(' or ')} interaction`, hint: `inputs: ${pool.join(', ') || 'none'}`, adaptable: false });
      }
    }

    // Data: every section a used card reads has a declaring source.
    for (const u of known) for (const section of cardOf(registry, u.use)?.reads || [])
      if (!sectionDeclared(registry, section, opts.documented)) hole('data', { card: u.use, field: 'card.reads', code: 'data_undeclared', message: `reads ${section}, whose shape no card declares (card.defines/data/dataShapes)` });

    // An adaptable failure whose adapter the composition would add is not final; the next pass decides it.
    const adaptable = failures.filter(f => f.adaptable);
    const space0 = [...missing.keys()][0];
    const m = space0 !== undefined ? missing.get(space0) : undefined;
    const sm = space0 !== undefined ? spaces.get(space0) : undefined;
    const signature = m && sm ? adapterSignature({ space: sm.use, spaceCaps: [...sm.base], capabilities: m.capabilities, content: m.content, services: m.services, neededBy: m.neededBy }) : null;
    /** @type {Verdict} */
    const verdict = failures.some(f => !f.adaptable) ? 'incompatible' : adaptable.length ? 'incompatible-needs-adapter' : holes.length ? 'undeclared' : adapters.length ? 'compatible-via-adapter' : 'compatible';
    const reason = verdict === 'incompatible' ? failures.filter(f => !f.adaptable).map(f => `${f.check}: ${f.message}`).join('; ')
      : verdict === 'incompatible-needs-adapter' ? adaptable.map(f => `${f.check}: ${f.message}`).join('; ')
      : verdict === 'undeclared' ? `undeclared ${[...new Set(holes.map(h => h.code))].join(', ')}: ${holes.slice(0, 3).map(h => `${h.card} ${h.field}`).join('; ')}`
      : verdict === 'compatible-via-adapter' ? `via ${adapters.join(', ')}` : 'all checks pass';
    return { verdict, checks, failures, holes, adapters, signature, reason, additions };
  }

  const { additions, ...rest } = result;
  return { ...rest, added, ms: +(performance.now() - started).toFixed(3) };
}

/**
 * For select.js, before outlining: which chosen spaces this selection cannot use. A space is rejected only
 * for decided failures on it (capabilities, content, services an adapter would have to supply, or an
 * adapter that does not fit), never for holes. Pass `reject` back as selectPrimitives' excludeSpaces.
 * @param {Selection} selection
 * @param {RegistryLike} registry
 * @param {CheckOptions} [opts]
 * @returns {{ ok: boolean, reject: string[], result: CompositionResult }}
 */
export function screenSpaces(selection, registry, opts = {}) {
  const result = checkComposition(selection, registry, { resolve: true, ...opts });
  const ids = new Map((selection.spaces || []).map((s, i) => [s.id || `space${i}`, s.use]));
  const reject = [...new Set(result.failures.filter(f => f.space !== undefined && (f.adaptable || f.check === 'adapter')).map(f => ids.get(/** @type {string} */ (f.space))).filter(/** @returns {x is string} */ x => typeof x === 'string'))];
  return { ok: !reject.length, reject, result };
}

/**
 * Bundles the planner commonly produces: the primitives, and the space kind they are meant for.
 * Every bundle is also checked against every other space kind (mesh3d + racing, track + platformer).
 * @type {Record<string, { space: { use: string, with?: Record<string, any> }, primitives: string[] }>}
 */
export const BUNDLES = {
  platformer: { space: { use: 'engine.space.tilemap', with: { mode: 'side' } }, primitives: ['gameplay.move.platformer', 'gameplay.collectible', 'gameplay.hazard', 'gameplay.combat.health', 'gameplay.checkpoint', 'gameplay.score'] },
  'kart racing': { space: { use: 'engine.space.track' }, primitives: ['gameplay.vehicle.car', 'gameplay.race', 'gameplay.powerup', 'gameplay.score'] },
  'creature rpg': { space: { use: 'engine.space.tilemap', with: { mode: 'topdown' } }, primitives: ['gameplay.move.walk', 'gameplay.creature.party', 'gameplay.creature.battle', 'gameplay.creature.catch', 'gameplay.encounter', 'gameplay.interact', 'plot.dialogue', 'plot.quest'] },
  'top-down action': { space: { use: 'engine.space.arena2d' }, primitives: ['gameplay.move.walk', 'gameplay.combat.melee', 'gameplay.combat.health', 'gameplay.ai.brain', 'gameplay.loot', 'gameplay.inventory'] },
  'puzzle board': { space: { use: 'engine.space.grid' }, primitives: ['gameplay.match', 'gameplay.score'] },
  'card game': { space: { use: 'engine.space.none' }, primitives: ['gameplay.cards', 'gameplay.turns', 'gameplay.combat.health'] },
  narrative: { space: { use: 'engine.space.graph' }, primitives: ['plot.storyboard', 'plot.character', 'plot.dialogue', 'plot.quest', 'plot.ending', 'gameplay.inventory'] },
};

/**
 * A registry whose cards carry extra declarations, to preview what a card change would decide before it
 * lands: { 'engine.space.mesh3d': { needs: { content: ['terrain'] } }, 'engine.generate.roads': { spaces: [...],
 * provides: { content: ['roads'] } } }. Each key merges into the card; provides/requires/needs merge one
 * level deep. `extra` primitives (adapter stubs, say) are registered too.
 * @param {RegistryLike} registry
 * @param {Record<string, Partial<Card>>} overlay
 * @param {import('../kernel/types.js').Primitive[]} [extra]
 */
export function withDeclarations(registry, overlay, extra = []) {
  const merged = registry.ids().map(id => {
    const p = /** @type {RegisteredPrimitive} */ (registry.get(id)), o = overlay[id];
    if (!o) return p;
    /** @type {Record<string, any>} */
    const card = { ...p.card };
    for (const [k, v] of Object.entries(o)) card[k] = ['provides', 'requires', 'needs'].includes(k) && isObj(v) ? { ...(card[k] || {}), ...v } : v;
    return { ...p, card: /** @type {Card} */ (card) };
  });
  return new Registry([...merged, ...extra]);
}

/** The gameplay and plot primitives the matrix pairs with each space kind. */
export const pairable = (/** @type {RegistryLike} */ registry) => registry.ids().filter(id => id.startsWith('gameplay.') || id.startsWith('plot.'));

/**
 * Every card's declaration holes, from the cards alone (strict mode): what is missing for the checker to
 * decide the compositions the card takes part in.
 * @param {RegistryLike} registry
 * @param {{ documented?: (section: string) => boolean }} [opts]
 * @returns {Hole[]}
 */
export function typeHoles(registry, opts = {}) {
  /** @type {Hole[]} */
  const out = [];
  const allCaps = new Set(spaceKinds(registry).flatMap(k => k.caps));
  const adapted = new Set(registry.ids().flatMap(id => cardOf(registry, id)?.adapts?.provides.capabilities || []));
  const services = new Set(registry.ids().flatMap(id => [...(cardOf(registry, id)?.provides.services || []), ...(cardOf(registry, id)?.adapts?.provides.services || [])]));
  const logic = logicOf(registry);
  for (const id of registry.ids()) {
    const c = /** @type {Card} */ (cardOf(registry, id));
    const h = (/** @type {string} */ field, /** @type {string} */ code, /** @type {string} */ message) => out.push({ card: id, field, code, message });
    if (isSpace(id) && (!c.needs || !isList(c.needs.content))) h('card.needs.content', 'space_needs_undeclared', 'space does not declare the content it needs');
    if (isGenerator(id)) {
      if (!isList(c.spaces)) h('card.spaces', 'generator_spaces_undeclared', 'generator does not declare which spaces it fills');
      if (!isList(c.provides.content)) h('card.provides.content', 'generator_content_undeclared', 'generator does not declare the content it provides');
    }
    for (const r of c.requires.primitives || []) if (!satisfier(registry, r)) h('card.requires.primitives', 'requires_unregistered', `requires unregistered '${r}'`);
    for (const sv of c.requires.services || []) if (!services.has(sv)) h('card.requires.services', 'service_unprovided', `requires service '${sv}' nobody provides`);
    for (const cap of c.requires.capabilities || []) if (!allCaps.has(cap) && !adapted.has(cap)) h('card.requires.capabilities', 'capability_unprovided', `requires capability '${cap}' that no space or adapter provides`);
    for (const x of c.conflicts || []) if (!registry.has(x)) h('card.conflicts', 'conflict_unregistered', `conflicts with unregistered '${x}'`);
    for (const s of c.reads || []) if (!sectionDeclared(registry, s, opts.documented)) h('card.reads', 'data_undeclared', `reads ${s}, whose shape no card declares`);
    if (c.adapts && (!c.adapts.from || !c.adapts.provides || typeof c.adapts.projection !== 'string')) h('card.adapts', 'adapter_malformed', 'card.adapts needs provides, from and projection');
    const e = c.engage;
    if (e) {
      for (const [p, f] of /** @type {Array<[string | undefined, string]>} */ ([[e.participants?.param, 'participants'], [e.join?.param, 'join']])) if (p && !c.params[p]) h(`card.engage.${f}.param`, 'engage_param_unknown', `engage names unknown param '${p}'`);
      for (const eff of [...(e.player?.enter || []), ...(e.actors?.enter || [])]) if (!logic.owners.effect.has(eff.do)) h('card.engage.*.enter', 'engage_effect_unowned', `engage runs effect '${eff.do}' nobody registers`);
    }
  }
  return out;
}

/**
 * The whole matrix: every space kind × every gameplay/plot primitive, and every bundle × every space kind.
 * @param {RegistryLike} registry
 * @param {CheckOptions} [opts]
 */
export function compositionMatrix(registry, opts = {}) {
  const started = performance.now();
  const kinds = spaceKinds(registry), prims = pairable(registry);
  const pairs = [], bundles = [];
  for (const k of kinds) for (const p of prims) {
    const r = checkComposition({ space: { use: k.use, with: k.with }, primitives: [p] }, registry, { resolve: true, ...opts });
    pairs.push({ space: k.key, primitive: p, ...r });
  }
  for (const [name, b] of Object.entries(BUNDLES)) for (const k of kinds) {
    const r = checkComposition({ space: { use: k.use, with: k.with }, primitives: b.primitives.filter(id => registry.has(id)) }, registry, { resolve: true, ...opts });
    bundles.push({ bundle: name, space: k.key, native: k.use === b.space.use && k.caps.join(',') === [...capsOf(registry, b.space.use, b.space.with || {})].sort().join(','), ...r });
  }
  return { version: COMPOSE_CHECK_VERSION, kinds, primitives: prims, pairs, bundles, holes: typeHoles(registry, opts), ms: +(performance.now() - started).toFixed(1) };
}
