// @ts-check
// Content census of a game document: how much of it is real, placed, read and varied.
// Used by the generation benchmark (v2/tools/generation-bench.mjs) and the populate check
// (content.js). Everything is read from the document and the cards, never a primitive list:
// - archetypes with real components (more than a name/model/label);
// - placement: an archetype counts as placed when something other than its own definition
//   names it (a spawn rule, a spawn effect, a character, a generator or any instance param);
// - spawn rules of every primitive that defines `spawn_rule`s, spawn effects, items, characters;
// - plot/content sections and whether an installed primitive reads them;
// - zones and how distinct they are (content signature: what is spawned, who lives, what is built there).
// Optionally boots the world for a few steps and counts the entities that actually exist.
//
// The document may be a draft (an outline before preflight, model output): it is read as `unknown` and
// narrowed with kernel/guards.js; the world boots only from what preflight accepts.
import { createWorld } from '../kernel/world.js';
import { preflight } from '../kernel/document.js';
import { isObj, isStr, obj, list, objects, prop, str, messageOf } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** A spawn rule as written in an instance param, with where it sits and which primitive owns it. @typedef {Record<string, unknown> & { _path: string, _use: string }} SpawnRule */
/** A `{ do: 'spawn' }` effect found in the document, with its path. @typedef {Record<string, unknown> & { archetype: string, _path: string }} SpawnEffect */
/** @typedef {Record<string, { count: number, readBy: string[] }>} Sections */
/** A zone with the id of the space it is in. @typedef {Record<string, unknown> & { space: unknown }} ZoneEntry */
/** @typedef {{ frames: number, entities: number, byKind: Record<string, number>, status: string } | { error: string }} CensusRuntime */
/**
 * @typedef {object} Census
 * @property {string} version
 * @property {number} archetypes
 * @property {number} archetypesReal
 * @property {number} archetypesPlaced
 * @property {unknown[]} hollowArchetypes  ids as written
 * @property {string[]} componentKinds
 * @property {number} spawnRules
 * @property {number} spawnRulesNonPlayer
 * @property {number} spawnEffects
 * @property {number} items
 * @property {number} characters
 * @property {number} charactersWithDialogue
 * @property {number} quests
 * @property {number} questsRead
 * @property {number} dialogue
 * @property {number} dialogueRead
 * @property {string[]} unreadSections
 * @property {number} zones
 * @property {number} zonesWithContent
 * @property {number} zonesDistinct
 * @property {number | null} zoneSimilarDescriptionPairs
 * @property {number} systems
 * @property {number} gameplaySystems
 * @property {CensusRuntime | null} runtime
 */

export const CENSUS_VERSION = 'census/0.1';
// Components that only label an entity; an archetype made only of these is hollow.
export const LABEL_COMPONENTS = new Set(['name', 'model', 'label', 'title', 'description', 'desc', 'sprite', 'color', 'faction', 'tags', 'kind']);
/** @param {unknown} a an archetype @returns {string[]} */
export const realComponents = a => Object.keys(obj(prop(a, 'components'))).filter(k => !LABEL_COMPONENTS.has(k));

/**
 * Every string value in a value tree, with the path it sits at.
 * @param {unknown} value @param {string} path @param {Array<[string, string]>} out @returns {Array<[string, string]>}
 */
function stringsIn(value, path, out) {
  if (typeof value === 'string') out.push([value, path]);
  else if (Array.isArray(value)) value.forEach((v, i) => stringsIn(v, `${path}[${i}]`, out));
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) stringsIn(v, path ? `${path}.${k}` : k, out);
  return out;
}

/** archetype id -> paths that name it (outside its own definition and the player's archetype pointer). @param {unknown} doc @returns {Map<string, string[]>} */
export function placements(doc) {
  const d = obj(doc), content = obj(d.content), archetypes = list(content.archetypes);
  const ids = new Set(archetypes.map(a => prop(a, 'id')).filter(isStr).filter(Boolean));
  /** @type {Map<string, string[]>} */
  const out = new Map([...ids].map(id => [id, []]));
  const scan = { ...d, content: { ...content, archetypes: undefined }, player: undefined };
  for (const [v, path] of stringsIn(scan, '', [])) out.get(v)?.push(path);
  // An archetype another archetype drops, splits into or summons counts as placed through it.
  archetypes.forEach((a, i) => { for (const [v, path] of stringsIn(prop(a, 'components'), `content.archetypes[${i}].components`, [])) if (v !== prop(a, 'id')) out.get(v)?.push(path); });
  return out;
}

/** Instances (systems, spaces, generators) whose card defines spawn rules in a list param, and their rules. @param {unknown} doc @param {RegistryLike} registry @returns {SpawnRule[]} */
export function spawnRules(doc, registry) {
  const d = obj(doc);
  /** @type {SpawnRule[]} */
  const rules = [];
  /** @param {unknown} inst @param {string} path */
  const visit = (inst, path) => {
    const use = prop(inst, 'use'); if (!isStr(use)) return;
    const card = registry.get(use)?.card; if (!card) return;
    for (const def of card.defines || []) {
      const entries = def.kind === 'spawn_rule' && def.in ? prop(prop(inst, 'with'), def.in) : undefined;
      if (Array.isArray(entries)) entries.forEach((r, i) => rules.push({ ...obj(r), _path: `${path}.with.${def.in}[${i}]`, _use: use }));
    }
  };
  list(d.systems).forEach((s, i) => visit(s, `systems[${i}]`));
  list(d.spaces).forEach((s, i) => list(prop(s, 'generators')).forEach((g, j) => visit(g, `spaces[${i}].generators[${j}]`)));
  return rules;
}

/** `{do:'spawn'}` effects anywhere in the document. @param {unknown} doc @returns {SpawnEffect[]} */
export function spawnEffects(doc) {
  /** @type {SpawnEffect[]} */
  const out = [];
  /** @param {unknown} v @param {string} path */
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (isObj(v)) { const archetype = v.archetype; if (v.do === 'spawn' && typeof archetype === 'string') out.push({ ...v, archetype, _path: path }); for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`); }
  };
  walk(doc, '');
  return out;
}

/** Sections of doc.plot / doc.content with data, and the installed primitives reading each. @param {unknown} doc @param {RegistryLike} registry @returns {Sections} */
export function sections(doc, registry) {
  const d = obj(doc);
  const installed = [...list(d.spaces).flatMap(s => [prop(s, 'use'), ...list(prop(s, 'generators')).map(g => prop(g, 'use'))]), ...list(d.systems).map(s => prop(s, 'use')), ...list(d.graphics).map(g => prop(g, 'use'))].filter(isStr);
  /** @type {Map<string, Set<string>>} */
  const reads = new Map();
  for (const id of installed) for (const r of registry.get(id)?.card.reads || []) if (typeof r === 'string') (reads.get(r) || /** @type {Set<string>} */ (reads.set(r, new Set()).get(r))).add(id);
  /** @param {unknown} v */
  const size = v => Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : v ? 1 : 0;
  /** @type {Sections} */
  const out = {};
  /** @type {Array<[string, unknown]>} */
  const roots = [['plot', d.plot], ['content', d.content]];
  for (const [root, value] of roots) for (const [k, v] of Object.entries(obj(value))) {
    if (k === 'premise') continue;
    const key = `${root}.${k}`, n = size(v); if (!n) continue;
    out[key] = { count: n, readBy: [...(reads.get(key) || [])] };
  }
  return out;
}

/** @param {unknown} s @returns {Set<string>} */
const words = s => new Set((String(s || '').toLowerCase().match(/[a-z]{4,}/g) || []));
/** @param {Set<string>} a @param {Set<string>} b */
const jaccard = (a, b) => { if (!a.size && !b.size) return 1; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };

/**
 * Per-zone content signature: archetypes placed there, residents, built features.
 * @param {unknown} doc @param {RegistryLike} registry @returns {{ zones: ZoneEntry[], sig: Map<unknown, Set<string>> }}
 */
export function zoneSignatures(doc, registry) {
  const d = obj(doc), plot = obj(d.plot);
  /** @type {Map<unknown, Set<string>>} */
  const sig = new Map();
  /** @type {ZoneEntry[]} */
  const zones = list(d.spaces).flatMap(s => list(prop(s, 'zones')).map(z => ({ space: prop(s, 'id'), ...obj(z) })));
  for (const z of zones) sig.set(z.id, new Set());
  /** @param {unknown} zone @param {string} tag */
  const add = (zone, tag) => { sig.get(zone)?.add(tag); };
  for (const r of spawnRules(doc, registry)) if (r.zone) add(r.zone, `spawn:${r.archetype}`);
  for (const e of spawnEffects(doc)) if (e.zone) add(e.zone, `spawn:${e.archetype}`);
  for (const c of list(plot.characters)) if (prop(c, 'home')) add(prop(c, 'home'), `char:${prop(c, 'id')}`);
  for (const q of list(plot.quests)) if (prop(q, 'zone')) add(prop(q, 'zone'), `quest:${prop(q, 'id')}`);
  // Generator configs that name a zone (rooms, structures, districts...): what they put there.
  for (const s of list(d.spaces)) for (const g of list(prop(s, 'generators'))) for (const [param, v] of Object.entries(obj(prop(g, 'with')))) {
    if (!Array.isArray(v)) continue;
    for (const entry of v) if (isObj(entry) && typeof entry.zone === 'string') {
      const bits = ['style', 'kind', 'theme', 'biome'].map(k => entry[k]).filter(isStr);
      const feats = list(entry.features).map(f => prop(f, 'kind') || f).filter(isStr);
      const hazards = list(entry.hazards).filter(isStr);
      for (const b of [...bits, ...feats.map(f => `feature:${f}`), ...hazards.map(h => `hazard:${h}`)]) add(entry.zone, `${param}:${b}`);
      if (Array.isArray(entry.spawns)) for (const a of entry.spawns) add(entry.zone, `spawn:${a}`);
    }
  }
  return { zones, sig };
}

/**
 * census(doc, registry, logic?, { boot }) -> counts plus lists (see the header).
 * boot: create the world and step it (default 30 frames) to count entities that really exist.
 * @param {unknown} doc @param {RegistryLike} registry @param {LogicLike | null} [logic] @param {{ boot?: number }} [options]
 * @returns {Census}
 */
export function census(doc, registry, logic = null, { boot = 30 } = {}) {
  const d = obj(doc), plot = obj(d.plot), content = obj(d.content);
  const playerArch = prop(d.player, 'archetype');
  const archetypes = objects(content.archetypes).filter(a => a.id && a.id !== playerArch);
  const placed = placements(doc);
  const real = archetypes.filter(a => realComponents(a).length);
  const rules = spawnRules(doc, registry), effects = spawnEffects(doc);
  const secs = sections(doc, registry);
  const characters = list(plot.characters);
  const dialogueIds = new Set(Object.keys(obj(plot.dialogue)));
  const { zones, sig } = zoneSignatures(doc, registry);
  const signatures = zones.map(z => [...(sig.get(z.id) || [])].sort().join('|'));
  const nonEmpty = signatures.filter(Boolean);
  const descs = zones.map(z => words(`${z.name} ${z.description || ''}`));
  let similarPairs = 0, pairs = 0;
  for (let i = 0; i < descs.length; i++) for (let j = i + 1; j < descs.length; j++) { pairs++; if (jaccard(descs[i], descs[j]) >= 0.5) similarPairs++; }
  /** @param {string} key */
  const read = key => (secs[key]?.readBy.length ? secs[key].count : 0);
  /** @param {unknown} c a character */
  const hasDialogue = c => {
    const dl = prop(c, 'dialogue');
    return (Array.isArray(dl) ? dl : dl ? [dl] : []).some(x => { const ref = typeof x === 'string' ? x : prop(x, 'id'); return isStr(ref) && dialogueIds.has(ref); });
  };
  /** @type {Census} */
  const out = {
    version: CENSUS_VERSION,
    archetypes: archetypes.length,
    archetypesReal: real.length,
    archetypesPlaced: real.filter(a => isStr(a.id) && placed.get(a.id)?.length).length,
    hollowArchetypes: archetypes.filter(a => !realComponents(a).length).map(a => a.id),
    componentKinds: [...new Set(real.flatMap(a => realComponents(a)))].sort(),
    spawnRules: rules.length,
    spawnRulesNonPlayer: rules.filter(r => !String(r.id || '').startsWith('player_')).length,
    spawnEffects: effects.length,
    items: list(content.items).length,
    characters: characters.length,
    charactersWithDialogue: characters.filter(hasDialogue).length,
    quests: list(plot.quests).length,
    questsRead: read('plot.quests'),
    dialogue: dialogueIds.size,
    dialogueRead: read('plot.dialogue'),
    unreadSections: Object.entries(secs).filter(([, v]) => !v.readBy.length).map(([k]) => k),
    zones: zones.length,
    zonesWithContent: nonEmpty.length,
    zonesDistinct: new Set(nonEmpty).size,
    zoneSimilarDescriptionPairs: pairs ? +(similarPairs / pairs).toFixed(2) : null,
    systems: list(d.systems).length,
    gameplaySystems: list(d.systems).filter(s => String(prop(s, 'use')).startsWith('gameplay.')).length,
    runtime: null,
  };
  if (boot && logic) {
    try {
      // Only a document preflight accepts boots (the census also runs on drafts).
      const checked = preflight(doc, registry, logic);
      if (!checked.ok) throw Error(`not a valid document: ${checked.errors[0]?.message || 'preflight failed'}`);
      const rt = createWorld(checked.doc, registry, logic, { seed: d.seed });
      for (let i = 0; i < boot && rt.state.status === 'playing'; i++) rt.step();
      const ents = Object.values(rt.state.entities).filter(e => e.id !== 'player');
      /** @type {Record<string, number>} */
      const byKind = {};
      for (const e of ents) { const k = String(archetypes.find(a => a.id === e.archetype)?.kind || 'other'); byKind[k] = (byKind[k] || 0) + 1; }
      out.runtime = { frames: rt.state.frame, entities: ents.length, byKind, status: rt.state.status };
    } catch (error) { out.runtime = { error: String(messageOf(error) || error).slice(0, 160) }; }
  }
  return out;
}

/** The idea's primary view: the first decomposed view that is not a pure UI overlay. @param {{ views?: string[] } | null | undefined} decomposition @returns {string | null} */
export const primaryView = decomposition => (decomposition?.views || [])[0] || null;

/**
 * Whether a document is still the kind of game the decomposition asked for (the genre and view survive
 * every stage): its primary view, its primary space and every base locomotion primitive must support
 * the idea's primary view. -> { ok, view, docView, space, movement: [ids], problems: [text] }
 * @param {{ views?: string[] } | null | undefined} decomposition @param {unknown} doc @param {RegistryLike} registry
 */
export function kindViewPreserved(decomposition, doc, registry) {
  const d = obj(doc);
  const want = primaryView(decomposition);
  /** @type {string[]} */
  const problems = [];
  /** @param {string} id */
  const supports = id => { const v = registry.get(id)?.card.views || []; return !want || v.includes(want) || v.includes('any'); };
  const space = str(prop(list(d.spaces)[0], 'use')) || null;
  // Base locomotion is a card field outside the kernel's CardInput (read through its index signature).
  const movement = list(d.systems).map(s => prop(s, 'use')).filter(isStr).filter(id => registry.get(id)?.card.locomotion === 'base');
  const docView = prop(d.views, 'primary');
  if (want && docView !== want) problems.push(`view ${docView ?? 'none'} instead of ${want}`);
  if (space && !supports(space)) problems.push(`space ${space} has no ${want} view`);
  for (const id of movement) if (!supports(id)) problems.push(`movement ${id} has no ${want} view`);
  return { ok: !problems.length, view: want, docView: docView ?? null, space, movement, problems };
}
