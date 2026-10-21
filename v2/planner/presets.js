// @ts-check
// Presets: the deterministic structure of a game, composed from what its collection of primitives declares
// (card.loop, card.mode the richer form; loop.js), never one shape stamped onto every idea and never a mode.
//   preset(spec) -> { doc, ok, errors, fixes, removed, gaps, world, structure }
// - The collection is the selection's primitives; its core is what the idea's core mechanics map to (coreOf).
// - The win: the first core primitive whose loop declares a game-ending win owns it; else another primitive of the
//   collection that does; else a catalogue primitive that declares one and fits the chosen spaces is added (the
//   structure says which and why). With none, the missing win is a core gap naming the collection (a type hole).
// - Win and lose declarations are wired to endings: an effects param gets end_game, an `end` boolean is set, a `when`
//   template becomes a plot ending, an `ending` declaration (the story) gets a victory ending its beats reach.
// - An avatar exists only for avatar interaction (the play spec's, else what the collection declares); otherwise the
//   player is a side/controller with no locomotion.
// - Zones exist only when the space is made of places (exits), the avatar travels, the story needs places, or a loop
//   of the collection needs them ('spaces.zones' in its needs.content).
// - A story exists only when the idea has narrative; the model writes it (the preset authors no acts or beats).
// - A core loop played elsewhere (its card has a space param and declares another space) gets its own sub-space.
// - Mashup relations of the play spec are realised by the adapters that declare them (card.adapts.relation): nested
//   (the joined mechanics' loops entered from the rest), skin (their content fills the rest's slots); union and any
//   space/primitive mismatch by the registered adapters that cover what the space lacks (adapters.js).
// - Participants are seated by code (content.js placeParticipants): a loop's declared groups (sides, teams,
//   factions) get its pieces on their own edge of the space's cells or in their own zone; a skin adapter's maps come
//   from the composition (configureSkins). A space's world is what the final collection needs (world.js planWorld).
// - Every loop's structure passes the static loop check (loop-check.js) from declarations alone (repairLoop): its
//   participants and their control (engage.join.where), the component its win reads on the opponents (with the declared
//   example value) and that component's owner, an action that changes it (the loop card's declared example), the win
//   and lose wired. What no declaration provides is reported (structure.loopCheck, `loop`) for the planner to re-plan.
// Nothing is isolated or dropped to make the structure pass: what does not fit is reported (gaps, errors) for the
// planner to re-plan, repair or have written. The model then fills content and tuning through the outline form.
import { DOC_SCHEMA } from '../kernel/document.js';
import { random } from '../kernel/rng.js';
import { defaultsOf } from './catalog.js';
import { relevance } from './select.js';
import { repairDocument } from './repair.js';
import { configureGenerators, furnishWorld, planWorld, needSets, isMovement, contentOfGenerator, OUTLINE_AUTHORS } from './world.js';
import { contractsOf, participantsOf, placeParticipants } from './content.js';
import { isAvatar, mashupSides } from './play-spec.js';
import { cardLoop, composeLoop, winProviders } from './loop.js';
import { engageDocument } from './engage.js';
import { resolveAdapters, adaptersFor, applySkins } from './adapters.js';
import { loopProblems, loopReport, readsOf, evaluatesEndings, effectsIn, ownersOf, logicOf } from './loop-check.js';
import { isList, isObj, isStr, list, objects, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('./loop.js').Loop} Loop */
/** @typedef {import('./loop.js').LoopEnd} LoopEnd */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** @typedef {import('./select.js').Selection} Selection */
/** How a space's zones are written. @typedef {{ exits: boolean, rect: boolean, range?: boolean, bounds: boolean, slot?: boolean, extent: number[] | null, length?: number }} ZoneShape */
/** @typedef {{ to: string, gate?: { item: string } }} Exit */
/** @typedef {{ id: string, name: string, description: string, rect?: number[], range?: number[], bounds?: { min: number[], max: number[] }, exits?: Exit[] }} OutlineZone */
/** @typedef {{ id: string, use: string, with?: Record<string, unknown>, zones: OutlineZone[], generators?: Array<{ use: string }>, _shape?: ZoneShape }} OutlineSpace */
/** @typedef {{ use: string, with?: Record<string, any>, space?: string }} SystemInstance */
/** @typedef {{ mechanic: string, description: string, importance: string, kind: 'adapter' | 'no_primitive' | 'capability' | 'win', why: string, primitive?: string }} PresetGap */
/**
 * What the collection composes: its core, its loops, which one owns the win, avatar, story and zones, and the
 * selection adjusted to the play spec (with why).
 * @typedef {{ core: string[], loops: Array<{ use: string, loop: Loop }>, win: { use: string, end: LoopEnd, added?: boolean } | null, lose: Array<{ use: string, end: LoopEnd }>,
 *   holes: Array<{ code: string, primitives: string[], message: string }>, avatar: boolean, narrative: boolean, zones: boolean, systems: string[],
 *   added: Array<{ use: string, why: string }>, removed: Array<{ use: string, why: string }> }} Structure
 */

export const PRESETS_VERSION = 'presets/0.3';
/** @param {unknown} s @param {string} [sep] */
const slug = (s, sep = '_') => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join(sep).slice(0, 40);
const STOP = new Set('a an the of in on with and or to for from by as at is are be it its into that this where who you your player game games like style meets world'.split(' '));
const PLACES = ['Gate', 'Hollow', 'Market', 'Spire', 'Vault', 'Ruins', 'Harbor', 'Grove', 'Keep', 'Crossing', 'Depths', 'Summit', 'Archive', 'Yard', 'Sanctum', 'Wilds'];
/** A win/lose `when` template names '$target': the number the content picks (here: a reachable default). */
const DEFAULT_TARGET = 10;

/**
 * Zone fields a space understands. Cards describe their zone shape in `card.zones` (e.g. "Zone = {id, rect:[x0,y0,x1,y1)...}");
 * without one, capabilities decide (graph-like spaces link zones by exits; positional ones bound them).
 * @param {{ zones?: unknown, views?: string[] }} card @param {string[]} caps @param {Record<string, unknown>} config @returns {ZoneShape}
 */
export function zoneShape(card, caps, config) {
  const text = typeof card.zones === 'string' ? card.zones : '';
  const extent = [config.size, config.bounds].find(/** @returns {v is number[]} */ (/** @type {unknown} */ v) => Array.isArray(v) && v.length >= 2 && v.every(Number.isFinite)) || null;
  if (text) return { exits: /exits/.test(text), rect: /rect/.test(text), range: /range/.test(text), bounds: /bounds/.test(text), slot: /slot/.test(text), extent, length: Number(config.length) || 0 };
  return { exits: caps.includes('navigate') && !caps.includes('overlap'), rect: !caps.includes('navigate') || caps.includes('overlap'), bounds: (card.views || []).some(v => v === '1p' || v === '3p'), extent };
}
/** Lay n zones side by side across the space's extent (or 16-unit cells when it has none). @param {OutlineZone} z @param {number} i @param {number} n @param {ZoneShape} shape */
export function placeZone(z, i, n, shape) {
  const [W, H] = shape.extent || [16 * n, 16];
  if (shape.rect) { const w = Math.max(1, Math.floor(W / n)); z.rect = [i * w, 0, i === n - 1 ? W : (i + 1) * w, H]; }
  if (shape.range) { const L = shape.length || 40 * n, w = L / n; z.range = [+(i * w).toFixed(2), +((i + 1) * w).toFixed(2)]; }
  if (shape.bounds) z.bounds = { min: [i * 64, 0, 0], max: [i * 64 + 64, 64, 64] };
}
/**
 * A start position inside a zone (bounds, rect or range), else null. Zones of a model draft are unchecked: a shape
 * that is not a list of coordinates is skipped.
 * @param {unknown} z @returns {number[] | null}
 */
export const zoneStart = z => {
  const min = prop(prop(z, 'bounds'), 'min'), rect = prop(z, 'rect'), range = prop(z, 'range');
  const nums = (/** @type {unknown[]} */ v) => v.map(Number);
  if (isList(min)) { const m = nums(min); return [m[0] + 1, m[1] + 1, m[2] + 1]; }
  if (isList(rect)) { const r = nums(rect); return [r[0] + Math.min(1, (r[2] - r[0]) / 2), r[1] + Math.min(1, (r[3] - r[1]) / 2)]; }
  if (isList(range)) return [Number(range[0]) + 0.5, 0, 0];
  return null;
};


/**
 * The core collection: the gameplay/plot primitives the idea's core mechanics map to (in the idea's order) and what
 * they require. Spaces, generators and engine runtime are the world and infrastructure around it.
 * @param {{ mechanics?: Array<{ importance?: string, primitives?: string[] }>, systems?: string[] } | null | undefined} selection
 * @param {RegistryLike | null} [registry] @returns {Set<string>}
 */
export function coreOf(selection, registry = null) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const m of selection?.mechanics || []) if (m.importance === 'core') for (const id of m.primitives || []) if (/^(gameplay|plot)\./.test(id)) ids.add(id);
  if (registry) for (let grew = true; grew;) { grew = false; for (const id of [...ids]) for (const r of registry.get(id)?.card.requires?.primitives || []) { const s = [...(selection?.systems || [])].find(x => x === r || x.startsWith(r + '.')); if (s && !ids.has(s)) { ids.add(s); grew = true; } } }
  return ids;
}

/** Does a space satisfy a declared space entry (a space primitive id, or a capability list)? @param {string | string[]} entry @param {{ use: string, caps: string[] }} space */
const spaceFits = (entry, space) => (Array.isArray(entry) ? entry.every(c => space.caps.includes(c)) : entry === space.use);
/** The primitive that runs the story (reads plot.storyboard), as the catalogue declares it. @param {RegistryLike} registry */
const storyRunner = registry => registry.cards().find(c => (c.reads || []).includes('plot.storyboard'))?.id || null;
/** @param {RegistryLike} registry @param {string} id */
const readsStory = (registry, id) => (registry.get(id)?.card.reads || []).includes('plot.storyboard');

/**
 * The joined (inner) side's mechanic ids of the play spec's mashup entries of a relation (play-spec.js mashupSides).
 * @param {Decomposition} decomposition @param {string} relation @returns {string[]}
 */
const joinedMechanics = (decomposition, relation) => (decomposition.core?.mashup || []).filter(m => m.relation === relation).flatMap(m => mashupSides(m, decomposition.mechanics || []).inner);
/**
 * The primitives of the mechanics a nested mashup relation joins (the loops entered from the rest).
 * @param {Decomposition} decomposition @param {Selection} selection @returns {Set<string>}
 */
const innerOf = (decomposition, selection) => new Set(joinedMechanics(decomposition, 'nested')
  .flatMap(id => (selection.mechanics || []).find(x => x.id === id)?.primitives || []).filter(id => /^(gameplay|plot)\./.test(id)));

/**
 * The core collection in the order its loops own the game's win: the idea's order, the loops a nested mashup relation
 * enters from the rest last (they never own the game's win). @param {Decomposition} decomposition @param {Selection} selection @param {RegistryLike} registry
 */
export function loopCore(decomposition, selection, registry) {
  const inner = innerOf(decomposition, selection);
  return [...coreOf(selection, registry)].sort((a, b) => Number(inner.has(a)) - Number(inner.has(b)));
}

/**
 * The structure a collection composes, from the cards and the play spec: its core and loops, the win (added from the
 * catalogue when the collection declares none), avatar or not, story or not, zones or not, and the selection
 * adjusted to the play spec (base locomotion out without an avatar, a story runner out without narrative and in
 * with it). @param {Decomposition} decomposition @param {Selection} selection @param {RegistryLike} registry @returns {Structure}
 */
export function structureOf(decomposition, selection, registry) {
  const spec = decomposition.core;
  let systems = [...selection.systems];
  // The joined idea's loops of a nested mashup are entered from the rest: they come last, so they never own the game's win.
  const core = loopCore(decomposition, selection, registry);
  /** @type {Array<{ use: string, why: string }>} */
  const added = [];
  /** @type {Array<{ use: string, why: string }>} */
  const removed = [];
  const add = (/** @type {string | null | undefined} */ id, /** @type {string} */ why) => { if (id && registry.has(id) && !systems.includes(id)) { systems.push(id); added.push({ use: id, why }); } };
  const drop = (/** @type {string} */ id, /** @type {string} */ why) => { systems = systems.filter(x => x !== id); removed.push({ use: id, why }); };
  // A loop played through another primitive (card.mode.via) brings it.
  for (const id of core) add(cardLoop(registry.get(id)?.card)?.via, `${id} plays through it`);
  const declared = core.map(id => cardLoop(registry.get(id)?.card)?.interaction).filter(/** @returns {x is string} */ x => typeof x === 'string');
  // Undecided by the spec: an avatar when a core loop declares avatar interaction or the collection moves a body (base locomotion).
  const avatar = spec?.interaction ? isAvatar(spec.interaction) : declared.some(isAvatar) || systems.some(id => registry.get(id)?.card.locomotion === 'base');
  const narrative = typeof spec?.narrative === 'boolean' ? spec.narrative : core.some(id => readsStory(registry, id));
  if (!avatar) for (const id of [...systems]) if (registry.get(id)?.card.locomotion === 'base') drop(id, 'no avatar: the player plays a side, not a walking character');
  if (!narrative) for (const id of [...systems]) if (readsStory(registry, id) && !core.includes(id)) drop(id, 'no narrative: the core loop ends the game, not a story');
  if (narrative && !systems.some(id => readsStory(registry, id))) add(storyRunner(registry), 'the idea has a story told in acts');
  // The win: declared by the collection, else added from the catalogue (the primitive that best fits the idea's win).
  let composed = composeLoop(systems, registry, { core });
  /** @type {Structure['win']} */
  let win = composed.win;
  if (!win) {
    const text = [spec?.win, ...(selection.mechanics || []).filter(m => m.importance === 'core').map(m => m.description)].filter(Boolean).join('. ');
    const caps = (selection.spaces || []).map(s => s.caps || []);
    const best = winProviders(registry, { caps: caps.length ? caps : [[]], exclude: systems, score: card => relevance({ verb: '', description: text || decomposition.premise }, card) })[0];
    if (best) {
      add(best.id, `the collection (${(core.length ? core : systems.filter(id => /^(gameplay|plot)\./.test(id))).join(', ')}) declares no way to win; ${best.id} declares one (card.loop.win)`);
      composed = composeLoop(systems, registry, { core });
      win = composed.win ? { ...composed.win, added: true } : null;
    }
  }
  const zones = avatar || narrative || composed.loops.some(l => core.includes(l.use) && l.loop.needs.content.includes('spaces.zones'));
  return { core, loops: composed.loops, win, lose: composed.lose, holes: win ? composed.holes.filter(h => h.code !== 'loop_win_undeclared') : composed.holes, avatar, narrative, zones, systems, added, removed };
}

/**
 * Make an instance satisfy a declared `applies` (the declaration exists only when its config matches, e.g. a counter
 * that clears the level). @param {SystemInstance} inst @param {LoopEnd['applies']} a @param {RegistryLike} registry
 */
function apply(inst, a, registry) {
  if (!a?.param) return;
  const spec = registry.get(inst.use)?.card.params?.[a.param];
  /** @type {Record<string, any>} */
  const w = inst.with ??= {};
  if (spec?.type === 'list') {
    /** @type {any[]} */
    const cur = Array.isArray(w[a.param]) ? w[a.param] : [];
    const field = a.field;
    if (!cur.some(x => (field ? x?.[field] : x) === a.is)) w[a.param] = [...cur, field ? { ...(spec.of?.fields?.id ? { id: 'win' } : {}), [field]: a.is } : a.is];
  } else w[a.param] = a.field ? { ...(w[a.param] || {}), [a.field]: a.is } : a.is;
}

/**
 * Wire a declared win/lose to an ending: an effects param ('onWin', or 'list.field' for the entries of a list param)
 * gets end_game; an `end` boolean param is set; a `when` template is returned for a plot ending.
 * @param {SystemInstance} inst @param {RegistryLike} registry @param {LoopEnd | null | undefined} spec @param {string} ending
 * @returns {{ wired: boolean, when: Record<string, unknown> | null }}
 */
function wire(inst, registry, spec, ending) {
  const params = registry.get(inst.use)?.card.params || {};
  let wired = false;
  /** @type {Record<string, any>} */
  const w = inst.with ??= {};
  const effects = (/** @type {unknown} */ cur) => { const list = Array.isArray(cur) ? cur : []; return list.some(e => prop(e, 'do') === 'end_game') ? list : [...list, { do: 'end_game', ending }]; };
  if (typeof spec?.param === 'string') {
    const [p, field] = spec.param.split('.');
    const s = params[p];
    if (s && !field && s.type === 'effects') { w[p] = effects(w[p]); wired = true; }
    else if (s && field && s.type === 'list' && Array.isArray(w[p]) && w[p].length) { w[p] = w[p].map((/** @type {unknown} */ e) => (isObj(e) ? { ...e, [field]: effects(e[field]) } : e)); wired = true; }
  }
  if (typeof spec?.end === 'string' && params[spec.end]?.type === 'boolean') { w[spec.end] = true; wired = true; }
  const when = isObj(spec?.when) ? JSON.parse(JSON.stringify(spec?.when).replace(/"\$target"/g, String(DEFAULT_TARGET))) : null;
  return { wired: wired || Boolean(when) || typeof spec?.ending === 'string', when };
}
/**
 * Content packs (card.pack): mechanically valid default content the installed primitives ship, put where the document
 * has none (a list section that already has entries only gets the pack entries whose ids it lacks, e.g. a ball item).
 * The model themes it later. Mutates `doc`; returns the sections filled.
 * @param {any} doc @param {RegistryLike} registry @returns {string[]}
 */
export function applyPacks(doc, registry) {
  /** @type {string[]} */
  const filled = [];
  for (const inst of doc.systems || []) {
    const pack = /** @type {Record<string, unknown> | undefined} */ (registry.get(inst?.use)?.card.pack);
    for (const [path, value] of Object.entries(pack || {})) {
      const [root, key] = path.split('.');
      if (!['plot', 'content'].includes(root) || !key) continue;
      doc[root] = isObj(doc[root]) ? doc[root] : {};
      const cur = doc[root][key];
      if (cur === undefined || (Array.isArray(cur) && !cur.length) || (isObj(cur) && !Object.keys(cur).length)) { doc[root][key] = structuredClone(value); filled.push(path); }
      else if (Array.isArray(cur) && Array.isArray(value)) { const have = new Set(cur.map(x => prop(x, 'id'))); const add = value.filter(x => !have.has(prop(x, 'id'))); if (add.length && path === 'content.items') { cur.push(...structuredClone(add)); filled.push(path); } }
    }
  }
  return filled;
}

/**
 * Wire the collection's declared win and losses into a document's instances and endings (an instance missing from
 * the document is left to the checks that report it). Mutates `doc`. -> { wired, endings }
 * @param {any} doc @param {Pick<Structure, 'win' | 'lose'>} structure @param {RegistryLike} registry
 * @param {{ win?: string, lose?: string, title?: string }} [text] ending texts
 */
function wireLoop(doc, structure, registry, text = {}) {
  /** @type {any[]} */
  const systems = Array.isArray(doc.systems) ? doc.systems : [];
  doc.plot = isObj(doc.plot) ? doc.plot : {};
  /** @type {any[]} */
  const endings = Array.isArray(doc.plot.endings) ? doc.plot.endings : [];
  const ensure = (/** @type {string} */ id, /** @type {string} */ outcome, /** @type {Record<string, unknown> | null} */ when, /** @type {string} */ words) => {
    const e = endings.find(x => x?.id === id);
    if (!e) endings.push({ id, title: id === 'victory' ? 'Victory' : 'Defeat', text: words, outcome, ...(when ? { when } : {}) });
    else if (when && !isObj(e.when)) e.when = when;
  };
  let wired = false;
  /** @param {string} use @param {LoopEnd} end @param {'victory' | 'defeat'} ending */
  const one = (use, end, ending) => {
    const loop = cardLoop(registry.get(use)?.card);
    const host = systems.find(s => s?.use === (loop?.via || use)) || systems.find(s => s?.use === use);
    const own = systems.find(s => s?.use === use);
    if (!host) return false;
    if (own) apply(own, end.applies, registry);
    const r = wire(host, registry, end, ending);
    if (r.wired) ensure(ending, ending === 'victory' ? 'won' : 'lost', r.when, ending === 'victory' ? `${text.title ? `${text.title}: ` : ''}${text.win || 'won'}.` : `${text.lose || 'lost'}.`);
    return r.wired;
  };
  if (structure.win) wired = one(structure.win.use, structure.win.end, 'victory');
  for (const l of structure.lose || []) one(l.use, l.end, 'defeat');
  doc.plot.endings = endings;
  // A `when` ending needs the primitive that evaluates plot.endings (the catalogue declares which one reads them):
  // a loop that reads them and declares no win of its own (the story also reads them, but declares its own win; a
  // view that shows them declares no loop).
  if (endings.some(e => isObj(e.when)) && !systems.some(s => evaluatesEndings(registry.get(s?.use)?.card))) {
    const reader = registry.cards().find(evaluatesEndings);
    if (reader) systems.push({ use: reader.id });
  }
  // Endings reached only through end_game (a lose wired by effects) next to the evaluator: the configuration its card
  // declares for them (card.untriggered: { param, is }).
  if (endings.some(e => !isObj(e.when))) for (const s of systems) {
    const u = prop(registry.get(s?.use)?.card, 'untriggered');
    if (!evaluatesEndings(registry.get(s?.use)?.card) || !isStr(prop(u, 'param'))) continue;
    s.with = { ...(isObj(s.with) ? s.with : {}), [String(prop(u, 'param'))]: prop(u, 'is') };
  }
  return { wired, endings: endings.map(e => String(e.id)) };
}

/**
 * Re-apply the collection's loop wiring to a document (a model draft may have rewritten the params the preset
 * wired): the declared win and losses end the game. Idempotent; the input is not modified. -> { doc, wired }
 * @param {any} input @param {Pick<Structure, 'win' | 'lose'> | null | undefined} structure @param {RegistryLike} registry
 */
export function wireCore(input, structure, registry) {
  if (!structure?.win || !input || !Array.isArray(input.systems)) return { doc: input, wired: false };
  const doc = structuredClone(input);
  const { wired } = wireLoop(doc, structure, registry);
  return { doc, wired };
}

/**
 * A skin adapter's maps, from the composition (never the model): `to` is the core loop's content contract section
 * (the owner of the win first: content.archetypes for an archetypes contract, else its section), `from` the first
 * content section another primitive of the collection needs that has entries (a skin mashup's mechanics first: the
 * source concept). Archetype targets get the contract's component (its example's values, the group field set to the
 * first participant group) and the source entry's name. Mutates `doc`; -> the maps written ([] when underivable).
 * @param {any} doc @param {Structure} st @param {Decomposition} decomposition @param {Selection} selection @param {RegistryLike} registry
 * @returns {Array<{ from: string, to: string }>}
 */
export function configureSkins(doc, st, decomposition, selection, registry) {
  /** @type {any[]} */
  const insts = (doc.systems || []).filter((/** @type {any} */ s) => registry.get(s?.use)?.card.adapts?.relation === 'skin');
  if (!insts.length) return [];
  const sectionOf = (/** @type {import('./content.js').Contract} */ c) => (c.need === 'archetypes' ? 'content.archetypes' : c.need === 'section' && /^content\./.test(String(c.at)) ? String(c.at) : null);
  const owners = [...new Set([st.win?.use, ...st.core].filter(/** @returns {x is string} */ x => typeof x === 'string'))];
  const owner = owners.find(id => contractsOf(registry, id).some(sectionOf));
  if (!owner) return [];
  const target = /** @type {import('./content.js').Contract} */ (contractsOf(registry, owner).find(sectionOf));
  const to = /** @type {string} */ (sectionOf(target));
  const entries = (/** @type {string} */ path) => { const v = path.split('.').reduce((/** @type {any} */ o, k) => o?.[k], doc); return Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0; };
  const skinned = new Set(joinedMechanics(decomposition, 'skin')
    .flatMap(id => (selection.mechanics || []).find(x => x.id === id)?.primitives || []));
  const others = st.systems.filter(id => id !== owner).sort((a, b) => Number(skinned.has(b)) - Number(skinned.has(a)));
  const from = others.flatMap(id => contractsOf(registry, id).map(c => (c.need === 'section' ? String(c.at) : '')))
    .find(path => /^content\.[A-Za-z0-9_]+$/.test(path) && path !== to && entries(path) > 0);
  if (!from) return [];
  /** @type {Record<string, unknown>} */
  let template = {};
  if (to === 'content.archetypes') {
    const ex = isObj(target.example) ? target.example : {}, C = target.component;
    const seat = participantsOf(doc, registry).find(p => p.use === owner);
    const comp = C ? { ...(isObj(prop(ex.components, C)) ? /** @type {Record<string, unknown>} */ (prop(ex.components, C)) : {}), ...(seat?.field && seat.groups[0] ? { [seat.field]: seat.groups[0].id } : {}) } : null;
    // The pieces also carry what the owner's win reads of them (win.reads.component), with its declared example value.
    const R = readsOf(cardLoop(registry.get(owner)?.card)?.win)?.component;
    const read = R && R !== C ? componentExample(registry.get(owner)?.card, R) ?? ownersOf(registry, R).map(o => componentExample(registry.get(o)?.card, R)).find(v => v !== undefined) : undefined;
    template = { kind: typeof ex.kind === 'string' ? ex.kind : 'npc', ...(C && comp ? { components: { [C]: comp, ...(R && read !== undefined ? { [R]: structuredClone(read) } : {}) } } : {}) };
  }
  const maps = [{ from, to, template, ...(to === 'content.archetypes' ? { fields: { 'components.name': 'name' } } : {}) }];
  for (const inst of insts) inst.with = { ...(isObj(inst.with) ? inst.with : {}), maps: structuredClone(maps) };
  return maps.map(m => ({ from: m.from, to: m.to }));
}

/** A fix the structural loop repair made. @typedef {{ code: string, path: string, what: string }} LoopFix */
/** The value of component C a card declares: its archetypes contract examples, then what it gives the player (card.engage.player). @param {unknown} card @param {string} C */
const componentExample = (card, C) => {
  for (const c of objects(prop(card, 'content'))) { const v = prop(prop(c.example, 'components'), C); if (v !== undefined) return v; }
  return prop(prop(prop(prop(card, 'engage'), 'player'), 'components'), C);
};
/** Entries of a declared list param's example and default (the example first). @param {unknown} spec @returns {unknown[]} */
const declaredEntries = spec => [...(isList(prop(spec, 'example')) ? /** @type {unknown[]} */ (prop(spec, 'example')) : prop(spec, 'example') !== undefined ? [prop(spec, 'example')] : []), ...list(prop(spec, 'default'))];
/** A fresh id among `taken` (id, id_2, ...). @param {string} id @param {Set<unknown>} taken */
const freshId = (id, taken) => { let out = id, n = 2; while (taken.has(out)) out = `${id}_${n++}`; return out; };

/**
 * Structural repair of a document's loops (loop-check.js), from declarations alone: every fix takes its value from a
 * card (a param's default or example, a content contract's example, card.engage, the owner that declares a
 * component), never from a genre or an idea. Participants missing -> the param's default/example entries; the player
 * unseated -> the engage.join.where values on the player's entry; no opponent -> the other entry gets the declared
 * field's other value; an empty group -> the loop's archetypes example, seated by placeParticipants; a component the
 * win reads -> the declared example value on the opponents; an unowned component -> its owner added; no action that
 * changes what the win reads -> the loop's declared example action whose effect the component's owner registers (the
 * owner added); an unwired win or lose -> wired (wireLoop). What it cannot fix is returned for the planner to re-plan.
 * The input is not modified.
 * @template T @param {T} input @param {RegistryLike} registry @param {{ logic?: LogicLike | null, core?: Iterable<string> | null }} [options]
 * @returns {{ doc: T, fixes: LoopFix[], problems: import('./loop-check.js').LoopProblem[] }}
 */
export function repairLoop(input, registry, { logic = null, core = null } = {}) {
  if (!isObj(input) || !Array.isArray(input.systems)) return { doc: input, fixes: [], problems: [] };
  const lg = logic || logicOf(registry);
  const coreIds = core ? [...core] : null;
  /** @type {Record<string, any>} */
  let doc = structuredClone(input);
  /** @type {LoopFix[]} */
  const fixes = [];
  /** @type {Set<string>} */
  const tried = new Set();
  for (let pass = 0; pass < 6; pass++) {
    const problems = loopProblems(doc, registry, { logic: lg, core: coreIds });
    let changed = false, seat = false;
    /** @type {any[]} */
    const systems = doc.systems;
    for (const p of problems) {
      const key = `${p.code}|${p.path}|${JSON.stringify(p.need)}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const inst = systems.find(s => s?.use === p.primitive);
      const card = registry.get(p.primitive)?.card;
      const loop = cardLoop(card);
      const n = p.need;
      const fix = (/** @type {string} */ what) => { fixes.push({ code: p.code, path: p.path, what }); changed = true; };
      const addSystem = (/** @type {string} */ use) => { if (!systems.some(s => s?.use === use)) { systems.push({ use }); return true; } return false; };
      if (!inst || !card || !loop) continue;
      inst.with = isObj(inst.with) ? inst.with : {};
      const spec = n.param ? card.params?.[n.param] : null;
      const current = () => (n.param && inst.with[n.param] !== undefined ? list(inst.with[n.param]) : list(prop(spec, 'default')));
      const idOf = (/** @type {unknown} */ e) => (isObj(e) ? e.id : e);
      if (n.kind === 'participants' && n.param) {
        const cur = current().map(e => structuredClone(e));
        const contract = contractsOf(registry, p.primitive).find(c => c.need === 'param' && c.param === n.param);
        for (const e of [...list(prop(spec, 'default')), ...list(contract?.example), ...list(prop(spec, 'example'))]) {
          if (cur.length >= (n.min ?? 2)) break;
          if (!cur.some(x => JSON.stringify(idOf(x)) === JSON.stringify(idOf(e)))) cur.push(structuredClone(e));
        }
        if (cur.length > current().length) { inst.with[n.param] = cur; fix(`${p.primitive} with.${n.param} from its declared default/example (${cur.length} entries)`); }
      } else if ((n.kind === 'seat' || n.kind === 'opponent') && n.param && n.where) {
        const groups = current().map(e => structuredClone(e));
        const objs = groups.filter(isObj);
        if (!objs.length) continue;
        const fields = /** @type {Record<string, any>} */ (prop(prop(spec, 'of'), 'fields') || {});
        if (n.kind === 'seat') {
          const g = objs.find(x => list(x.members).includes('player')) || objs[0];
          Object.assign(g, n.where);
          fix(`${p.primitive} with.${n.param} '${String(g.id)}' seats the player (${JSON.stringify(n.where)}, card.engage.join.where)`);
        } else {
          if (objs.length < 2) continue;
          const g = [...objs].reverse().find(x => !list(x.members).includes('player')) || objs[objs.length - 1];
          for (const [k, v] of Object.entries(n.where)) {
            const f = fields[k], alt = prop(f, 'default') !== v && prop(f, 'default') !== undefined ? prop(f, 'default') : list(prop(f, 'options')).find(o => o !== v);
            if (alt !== undefined) g[k] = alt;
          }
          fix(`${p.primitive} with.${n.param} '${String(g.id)}' plays against the player (its declared ${Object.keys(n.where).join(', ')})`);
        }
        inst.with[n.param] = groups;
      } else if (n.kind === 'group' && n.component) {
        const arches = (doc.content ??= {}).archetypes ??= [];
        const C = n.component;
        if (!objects(arches).some(a => a.kind !== 'player' && a.id !== prop(doc.player, 'archetype') && prop(a.components, C) !== undefined)) {
          const ex = contractsOf(registry, p.primitive).map(c => c.example).find(e => prop(prop(e, 'components'), C) !== undefined);
          if (!isObj(ex)) continue;
          const a = /** @type {Record<string, any>} */ (structuredClone(ex));
          a.id = freshId(String(a.id || C), new Set(objects(arches).map(x => x.id)));
          arches.push(a);
          fix(`${p.primitive}: the archetypes contract example '${a.id}' stands for the ${n.param} with no entities`);
        } else fix(`${p.primitive}: ${n.param} '${n.group}' seated from the ${C} archetypes`);
        seat = true;
      } else if (n.kind === 'component' && n.component) {
        const C = n.component;
        const value = [card, ...systems.map(s => registry.get(s?.use)?.card), ...ownersOf(registry, C).map(o => registry.get(o)?.card), ...registry.cards()]
          .map(c => componentExample(c, C)).find(v => v !== undefined);
        if (value === undefined) continue;
        for (const a of objects(prop(doc.content, 'archetypes'))) if ((n.archetypes || []).includes(String(a.id)) && prop(a.components, C) === undefined) { const comps = isObj(a.components) ? a.components : {}; comps[C] = structuredClone(value); a.components = comps; }
        fix(`${(n.archetypes || []).join(', ')} get the "${C}" component the ${p.primitive} win reads (declared example ${JSON.stringify(value)})`);
      } else if (n.kind === 'owner' && n.component) {
        const owners = n.owners || [];
        const wanted = owners.find(o => systems.some(s => (registry.get(s?.use)?.card.requires?.primitives || []).some(r => o === r || o.startsWith(r + '.'))))
          || [...owners].sort((a, b) => (registry.get(a)?.card.requires?.primitives || []).length - (registry.get(b)?.card.requires?.primitives || []).length || a.localeCompare(b))[0];
        if (wanted && addSystem(wanted)) fix(`+${wanted}: it owns the "${n.component}" component the ${p.primitive} win reads`);
      } else if (n.kind === 'action' && n.component) {
        const owners = new Set(n.owners || []);
        const hosts = [inst, ...(loop.via ? systems.filter(s => s?.use === loop.via) : [])];
        let done = false;
        for (const h of hosts) {
          const hcard = registry.get(h.use)?.card; if (!hcard || done) continue;
          for (const [k, ps] of Object.entries(hcard.params || {})) {
            if (done || ps.type !== 'list' || prop(ps.of, 'type') !== 'object' || [loop.win?.param, loop.lose?.param].some(w => isStr(w) && w.split('.')[0] === k)) continue;
            const entry = declaredEntries(ps).find(e => effectsIn(e).some(x => owners.has(String(lg.owners.effect.get(String(x.do))))));
            if (!isObj(entry)) continue;
            h.with = isObj(h.with) ? h.with : {};
            const cur = h.with[k] !== undefined ? list(h.with[k]) : list(ps.default);
            const add = /** @type {Record<string, any>} */ (structuredClone(entry));
            if (isStr(add.id)) add.id = freshId(add.id, new Set(cur.map(x => prop(x, 'id'))));
            h.with[k] = [...cur.map(x => structuredClone(x)), add];
            const effOwner = effectsIn(add).map(x => String(lg.owners.effect.get(String(x.do)))).find(o => owners.has(o));
            if (effOwner) addSystem(effOwner);
            fix(`${h.use} with.${k} gains its declared example '${String(add.id ?? k)}', whose effects change "${n.component}"${effOwner ? ` (owned by ${effOwner})` : ''}`);
            done = true;
          }
        }
      } else if ((n.kind === 'win' || n.kind === 'lose') && loop[n.kind]) {
        const end = /** @type {LoopEnd} */ (loop[n.kind]);
        const r = wireLoop(doc, n.kind === 'win' ? { win: { use: p.primitive, end }, lose: [] } : { win: null, lose: [{ use: p.primitive, end }] }, registry);
        if (r.wired || n.kind === 'lose') fix(`${p.primitive} ${n.kind} wired to ${n.kind === 'win' ? 'a won' : 'a lost'} ending (card.loop.${n.kind})`);
      }
    }
    if (seat) doc = placeParticipants(doc, registry).doc;
    if (!changed) break;
  }
  return { doc: /** @type {T} */ (/** @type {unknown} */ (doc)), fixes, problems: loopProblems(doc, registry, { logic: lg, core: coreIds }) };
}

/**
 * preset({ decomposition, selection, registry, logic, seed, prompt }) -> { doc, ok, errors, fixes, removed, gaps, world, structure }
 * @param {{ decomposition: Decomposition, selection: Selection, registry: RegistryLike, logic: LogicLike, seed: number, prompt?: string }} spec
 */
export function preset({ decomposition, selection, registry, logic, seed, prompt = '' }) {
  const st = structureOf(decomposition, selection, registry);
  const state = { rng: seed >>> 0 || 1 };
  const rand = () => random(state);
  const words = [...new Set((`${decomposition.title} ${decomposition.premise} ${prompt}`.match(/[A-Za-z]{4,}/g) || []).filter(w => !STOP.has(w.toLowerCase())))];
  const cap = (/** @type {string} */ w) => w[0].toUpperCase() + w.slice(1).toLowerCase();
  const usedNames = new Set();
  const placeName = (/** @type {number} */ i) => {
    for (let k = 0; k < 8; k++) {
      const n = `${words.length ? cap(words[Math.floor(rand() * words.length)]) + ' ' : ''}${PLACES[Math.floor(rand() * PLACES.length)]}`;
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
    }
    return `Place ${i + 1}`;
  };
  const capsOf = (/** @type {string} */ use, /** @type {Record<string, unknown>} */ w = {}) => {
    const p = registry.get(use); if (!p) return /** @type {string[]} */ ([]);
    const config = { ...defaultsOf(p.card), ...w };
    try { return [...(p.capabilities ? p.capabilities(config) : p.card.provides?.capabilities || [])]; } catch { return [...(p.card.provides?.capabilities || [])]; }
  };
  // The idea's space stays. A loop whose declared spaces do not fit it is reported (an adapter would project it), never swapped in.
  /** @type {Array<{ id: string, use: string, with?: Record<string, unknown>, role?: string, caps: string[] }>} */
  const selSpaces = selection.spaces.map(s => ({ ...s, caps: [...(s.caps || [])] }));
  /** @type {PresetGap[]} */
  const gaps = [];
  for (const p of decomposition.core?.problems || []) gaps.push({ mechanic: 'core', description: `play spec: ${p}`, importance: 'core', kind: 'no_primitive', why: p });
  for (const h of st.holes) gaps.push({ mechanic: h.code === 'loop_win_undeclared' ? 'win' : 'loop', description: h.message, importance: 'core', kind: h.code === 'loop_win_undeclared' ? 'win' : 'no_primitive', why: `${h.message}; no catalogue primitive that declares one fits the chosen spaces`, primitive: h.primitives[0] });
  // A core loop played elsewhere (its card has a space param and declares another space primitive) gets that space.
  /** @type {Array<{ use: string, space: string, param: string }>} */
  const nested = [];
  for (const { use, loop } of st.loops) {
    if (!st.core.includes(use) || use === st.win?.use) continue;
    const param = Object.entries(registry.get(use)?.card.params || {}).find(([, p]) => p.type === 'ref' && p.to === 'space')?.[0];
    const want = loop.space.find(e => typeof e === 'string' && registry.has(e));
    if (!param || typeof want !== 'string' || selSpaces.some(x => x.use === want)) continue;
    const id = slug(`${use.split('.').pop()}_space`);
    selSpaces.push({ id, use: want, role: use, caps: capsOf(want) });
    nested.push({ use, space: id, param });
  }
  // The win owner prefers other spaces than the idea's: an adapter would project its loop (reported; the world stays).
  const prefs = st.win ? st.loops.find(l => l.use === st.win?.use)?.loop.space || [] : [];
  if (st.win && prefs.length && selSpaces[0] && !prefs.some(e => spaceFits(e, selSpaces[0])))
    gaps.push({ mechanic: st.win.use, description: `needs adapter: ${st.win.use} on ${selSpaces[0].use}`, importance: 'supporting', kind: 'adapter', primitive: st.win.use, why: `${st.win.use} declares other spaces than ${selSpaces[0].use}; the idea's world is kept, an adapter would project the loop` });
  // The world each space gets is what the collection's declarations need (world.js planWorld), re-planned for the
  // final collection: a generator a mechanic named is kept; one the selection planned for a mover the structure took
  // out (a board whose pieces are seated, not walked) is not. A board that needs only cells gets no rooms generator.
  const intent = [decomposition.premise, ...(decomposition.mechanics || []).map(m => m.description)].filter(Boolean).join('. ');
  const worldFor = (/** @type {typeof selSpaces[number]} */ s, /** @type {number} */ si) => {
    const named = (selection.generators || []).filter(g => g.space === s.id && !g.auto).map(g => g.id);
    const moved = st.systems.some(id => isMovement(registry, id) && (selection.bind?.[id] ?? selSpaces[0]?.id) === s.id);
    if (!moved || !needSets(registry, s.use).length) return named;
    const have = [...OUTLINE_AUTHORS, ...named.flatMap(id => contentOfGenerator(registry, id))];
    return [...named, ...planWorld(registry, s, { view: si === 0 ? decomposition.views?.[0] ?? null : null, have, intent, exclude: named }).generators];
  };
  /** @type {OutlineSpace[]} */
  const spaces = selSpaces.map((s, si) => {
    const card = registry.get(s.use)?.card || { views: [] };
    const shape = zoneShape(card, s.caps, { ...defaultsOf(/** @type {any} */ (card)), ...(s.with || {}) });
    // Places are zones: a space made of exits always has them; elsewhere only when the structure needs them.
    const isNested = nested.some(n => n.space === s.id);
    const n = shape.exits || (st.zones && !isNested) ? (si === 0 ? decomposition.zones : 2) : 0;
    /** @type {string[]} */
    const ids = [];
    const zones = Array.from({ length: n }, (_, i) => {
      const name = placeName(i + si * 10);
      let id = slug(name); while (ids.includes(id)) id += '_b'; ids.push(id);
      /** @type {OutlineZone} */
      const z = { id, name, description: `${name}${decomposition.tone ? `, ${decomposition.tone}` : ''}.` };
      placeZone(z, i, n, shape);
      return z;
    });
    if (shape.exits) zones.forEach((z, i) => {
      z.exits = [];
      if (i > 0) z.exits.push({ to: zones[i - 1].id });
      if (i < zones.length - 1) z.exits.push({ to: zones[i + 1].id });
      if (i > 1 && i % 3 === 0) { z.exits.push({ to: zones[i - 2].id }); zones[i - 2].exits?.push({ to: z.id }); }
    });
    const generators = worldFor(s, si).map(use => ({ use }));
    return { id: s.id, use: s.use, ...(Object.keys(s.with || {}).length ? { with: s.with } : {}), zones, ...(generators.length ? { generators } : {}), _shape: shape };
  });
  const primary = spaces[0];
  const primaryShape = /** @type {ZoneShape} */ (primary._shape);
  for (const s of spaces) delete s._shape;
  // A primitive no space of this game can host stays in the collection and is reported with what it needs: the
  // planner re-plans (another primitive for the mechanic), or the gap layer writes the adapter. Never removed here.
  /** @type {import('./compose-check.js').AdapterInstance[]} */
  const adapters = (selection.adapters || []).map(a => structuredClone(a));
  const adapterIds = new Set(adapters.map(a => a.id).filter(/** @returns {x is string} */ x => typeof x === 'string'));
  const hosted = (/** @type {string} */ id) => { const need = registry.get(id)?.card.requires?.capabilities || []; const bound = selection.bind[id]; if (bound && adapterIds.has(bound)) return true; return selSpaces.some(sp => (!bound || sp.id === bound || !selSpaces.some(x => x.id === bound)) && need.every(c => sp.caps.includes(c))); };
  // What no chosen space hosts: a registered adapter that covers it is added (its config from its adapt() hook).
  if (st.systems.some(id => !hosted(id))) {
    /** @type {import('./adapters.js').AdapterResolution | null} */
    let r = null;
    try { r = resolveAdapters({ spaces: selSpaces, systems: st.systems, bind: selection.bind, adapters }, registry); } catch { r = null; }
    if (r && r.adapters.length) { for (const a of r.adapters) { adapters.push(a); if (a.id) adapterIds.add(a.id); } Object.assign(selection.bind, r.bind); }
  }
  for (const id of st.systems) {
    if (hosted(id)) continue;
    const missing = (registry.get(id)?.card.requires?.capabilities || []).filter(c => !selSpaces.some(sp => sp.caps.includes(c)));
    const m = (selection.mechanics || []).find(x => (x.primitives || []).includes(id));
    gaps.push({ mechanic: m?.id || id, description: `needs adapter: ${id} on ${selSpaces[0]?.use || 'the space'}${missing.length ? ` (${missing.join(', ')})` : ''}`, importance: m?.importance || 'core', kind: 'adapter', primitive: id, why: `needs ${missing.join(', ')}, which no space of this game provides` });
  }
  for (const g of gaps) if (Array.isArray(selection.gaps) && !selection.gaps.some(x => x.description === g.description)) selection.gaps.push(/** @type {any} */ (g));
  /** @type {SystemInstance[]} */
  const systems = st.systems.map(id => ({ use: id, ...(selection.bind[id] && (selSpaces.some(sp => sp.id === selection.bind[id]) || adapterIds.has(selection.bind[id])) ? { space: selection.bind[id] } : {}) }));
  // Adapter instances (with their config) the selection resolved and the ones resolved here.
  for (const a of adapters) systems.push(/** @type {SystemInstance} */ (structuredClone(a)));
  // Nested loops point at their space.
  for (const n of nested) { const own = systems.find(s => s.use === n.use); if (own) own.with = { ...(own.with || {}), [n.param]: n.space }; }
  // Mashup relations across concepts: the adapter that declares each one (card.adapts.relation) joins, its params
  // filled from declarations. nested: the joined side's loops are entered on the outer loop's declared progress event
  // (one that names its subject: a typed `event:*` it provides) and their declared win and lose (effects params) emit
  // the outcomes the adapter maps back; skin: its maps (configureSkins, below); union: a region of the space kind the
  // joined loop declares, projected by the adapter's own adapt() hook, when no chosen space is that kind (otherwise
  // both loops already run in one space). What cannot be derived is a gap, never a guess.
  const loopsOf = (/** @type {string[]} */ ids) => [...new Set(ids.flatMap(id => (selection.mechanics || []).find(x => x.id === id)?.primitives || []).filter(id => st.systems.includes(id) && cardLoop(registry.get(id)?.card)))];
  for (const m of decomposition.core?.mashup || []) {
    const use = adaptersFor(registry, m.relation)[0];
    const sides = mashupSides(m, decomposition.mechanics || []);
    const inner = loopsOf(sides.inner), outer = loopsOf(sides.outer).filter(id => !inner.includes(id));
    const gap = (/** @type {string} */ why) => gaps.push({ mechanic: m.mechanics[0] || 'mashup', description: `needs adapter: ${m.relation} mashup of ${m.mechanics.join(', ')}`, importance: 'core', kind: 'adapter', why });
    if (!use) { gap(`no registered adapter declares the ${m.relation} relation (card.adapts.relation)`); continue; }
    if (m.relation === 'nested') {
      if (!inner.length) continue;
      if (systems.some(s => s.use === use && JSON.stringify(s.with?.inner || null) === JSON.stringify(inner))) continue;
      const id = slug(m.mechanics.join('_'));
      const host = outer[0] || [st.win?.use, ...st.core].find(x => isStr(x) && !inner.includes(x) && cardLoop(registry.get(x)?.card)) || null;
      const hostCard = host ? registry.get(host)?.card : null;
      const progress = cardLoop(hostCard)?.progress || [];
      const on = progress.find(e => (hostCard?.provides?.events || []).includes(`${e}:*`)) || progress[0] || null;
      /** @type {Array<{ on: string, result: string, do: unknown[] }>} */
      const outcomes = [];
      for (const [side, result] of /** @type {const} */ ([['win', 'won'], ['lose', 'lost']])) for (const u of inner) {
        const p = cardLoop(registry.get(u)?.card)?.[side]?.param;
        const own = systems.find(s => s.use === u);
        if (!own || !isStr(p) || registry.get(u)?.card.params?.[p]?.type !== 'effects') continue;
        const event = `${id}_${result}`;
        own.with = { ...(own.with || {}), [p]: [...list(own.with?.[p]), { do: 'emit', event }] };
        if (!outcomes.some(o => o.on === event)) outcomes.push({ on: event, result, do: [] });
      }
      if (!on || !outcomes.length) { gap(`the nested encounter needs ${!on ? `an outer loop progress event to start it (${host || 'no outer loop'} declares none)` : `the inner loop's declared win or lose as effects (${inner.join(', ')})`}`); continue; }
      const space = nested.find(n => inner.includes(n.use))?.space;
      systems.push({ use, with: { id, inner, on, outcomes, ...(space ? { space } : {}) } });
    } else if (m.relation === 'skin') {
      if (systems.some(s => s.use === use)) continue;
      systems.push({ use, with: {} });
    } else {
      const proj = registry.get(use);
      for (const u of inner) {
        const want = (cardLoop(registry.get(u)?.card)?.space || []).filter(/** @returns {e is string} */ e => isStr(e) && registry.has(e));
        const host = selSpaces[0];
        if (!host || !want.length || want.some(w => selSpaces.some(sp => sp.use === w))) continue;
        const kind = want[0];
        const missing = { capabilities: capsOf(kind).filter(c => !host.caps.includes(c)), content: [], services: [] };
        if (typeof proj?.adapt !== 'function') continue;
        const proposal = proj.adapt({ space: { id: host.id, use: host.use, with: host.with || {}, caps: host.caps }, missing, neededBy: [{ use: u, card: /** @type {any} */ (registry.get(u)?.card) }], registry });
        if (!proposal) { gap(`${use} cannot project ${kind} onto ${host.use} for ${u}`); continue; }
        const rid = isStr(proposal.id) ? proposal.id : null;
        systems.push(/** @type {SystemInstance} */ ({ use, ...(rid ? { id: rid } : {}), space: host.id, with: isObj(proposal.with) ? proposal.with : {} }));
        const own = systems.find(s => s.use === u); if (own && rid) own.space = rid;
      }
    }
    st.added.push({ use, why: `${m.relation} mashup across ${sides.outer.length ? `${sides.outer.join(', ')} -> ` : ''}${sides.inner.join(', ')}: ${m.why || m.mechanics.join(', ')}` });
  }
  // The player: an avatar entity for avatar interaction; otherwise the side the player commands (no body, no locomotion).
  const playerArch = st.avatar ? { id: 'hero', components: { name: 'You' } } : { id: 'player_side', kind: 'player', components: { name: 'You' } };
  const extent = primaryShape.extent;
  const at = primary.zones.length ? (primaryShape.exits ? primary.zones[0].id : zoneStart(primary.zones[0])) : extent ? extent.map(v => Math.floor(v / 2)) : null;
  /** @type {any} */
  const doc = {
    schema: DOC_SCHEMA, id: slug(decomposition.title, '-'), title: decomposition.title, logline: decomposition.premise.split(/(?<=\.)\s/)[0].slice(0, 160), seed,
    views: { primary: decomposition.views[0] || registry.get(primary.use)?.card.views?.[0] || 'any', alternates: decomposition.views.slice(1) },
    spaces,
    systems,
    plot: { premise: decomposition.premise, characters: [] },
    content: { archetypes: [playerArch] },
    player: { archetype: playerArch.id, space: primary.id, ...(at !== null && at !== undefined ? { at } : {}) },
  };
  // The collection's declared win and losses end the game.
  const loopWired = wireLoop(doc, st, registry, { title: decomposition.title, win: decomposition.core?.win, lose: decomposition.core?.lose });
  const packed = applyPacks(doc, registry);
  // Generators the selection chose carry no params yet: each one's scaffold configures it from the zones and movement.
  const scaffolded = configureGenerators(doc, registry);
  // Adapter params are structure: a skin maps the source concept's content onto the core loop's contract section.
  const skins = configureSkins(doc, st, decomposition, selection, registry);
  // Participants are structure: the loop's sides (teams, factions) get their pieces seated on the space.
  const seated = placeParticipants(applySkins(doc, registry), registry);
  // The loops' structure passes the static loop check (loop-check.js) from the declarations: participants, the
  // components the win reads, an action that changes it, the win and lose wired. What cannot be derived is reported.
  const looped = repairLoop(seated.doc, registry, { logic, core: st.core });
  // Every primitive of the collection is kept: repair fixes fields and reports what it cannot fix.
  const keep = new Set((looped.doc.systems || []).map((/** @type {SystemInstance} */ s) => s.use));
  let repaired = repairDocument(looped.doc, { registry, logic, protect: keep });
  // Engagement fills what a loop needs from the content (a starting deck from the cards, sides from the units): when the
  // draft only fails for that, engage it and repair again.
  if (!repaired.ok) { const engaged = engageDocument(/** @type {any} */ (repaired.doc), registry, logic, { force: true }); if (engaged.applied.length) repaired = repairDocument(engaged.doc, { registry, logic, protect: keep }); }
  // Repair may have written what the loops' wiring runs through (a required list's first entry): wire it too.
  if (repaired.ok) { const again = repairLoop(repaired.doc, registry, { logic, core: st.core }); if (again.fixes.length) { looped.fixes.push(...again.fixes); repaired = repairDocument(again.doc, { registry, logic, protect: keep }); } }
  // A space still empty after repair (no generator selected) gets one that fits.
  const world = repaired.ok ? furnishWorld(repaired.doc, registry, logic, { seed }) : null;
  // The static loop check of the finished structure, before any model call: the planner re-plans what it reports.
  const loopCheck = loopReport(world?.doc ?? repaired.doc, registry, { logic, core: st.core });
  // (A win wired through list entries the model writes is pending content, not a structural failure yet.)
  const loop = loopCheck.problems.filter(p => p.severity === 'error' && !p.need.pending);
  const structure = { version: PRESETS_VERSION, packs: packed, core: st.core, loop: st.loops.filter(l => st.core.includes(l.use) || l.use === st.win?.use).map(l => ({ use: l.use, progress: l.loop.progress })),
    win: st.win ? { use: st.win.use, added: Boolean(st.win.added) } : null, lose: st.lose.map(l => l.use), avatar: st.avatar, narrative: st.narrative, zones: st.zones, added: st.added, removed: st.removed,
    endings: loopWired.endings, nested: nested.map(n => n.space), holes: st.holes, skins, seated: seated.added.map(a => a.rule),
    loopCheck: { owner: loopCheck.owner, fixes: looped.fixes.map(f => f.what), problems: loopCheck.problems.map(p => `${p.code} ${p.path}`) } };
  const rest = { gaps, errors: repaired.errors, fixes: [...scaffolded, ...repaired.fixes, ...(world?.fixes || [])], removed: repaired.removed, world: world && { added: world.added, problems: world.problems }, structure, st, loop };
  return repaired.ok ? { doc: world?.doc ?? repaired.doc, ok: /** @type {true} */ (true), ...rest } : { doc: /** @type {unknown} */ (repaired.doc), ok: /** @type {false} */ (false), ...rest };
}
