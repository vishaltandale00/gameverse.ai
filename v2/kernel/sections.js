// @ts-check
// The kernel's base shapes of the document's data sections (ARCHITECTURE.md §1.4): what every entry of a section the
// kernel indexes has, in the params dialect (kernel/params.js). Each card declares the parts of a section it reads or
// writes (card.data, the same dialect; an archetype's components are card.components of their owners), and the shape
// of a section in a document is this base merged with the declarations of the cards the document uses (sectionShape).
// That one shape is the section's schema for everything: preflight checks entries against it, the content forms are
// derived from it, repair re-asks its fields. There is no other source: no constants in forms.
//
// Entry objects are open: a field no card of the document declares is nobody's to check (it means nothing to the
// game), and no form asks for it.
import { isObj } from './guards.js';

/** @typedef {import('./types.js').ParamSchema} ParamSchema */
/** @typedef {import('./types.js').RegistryLike} RegistryLike */

/** A name a person reads: 1-40 characters starting with a non-space (the forms' pattern and the kernel check). */
export const NAME_PATTERN = '^\\S.{0,39}$';
/** The id of an indexed entry (preflight's id indexes): a lowercase slug. The form pattern and the kernel check are this rule. */
export const ID_PATTERN = '^[a-z0-9][a-z0-9_-]{0,63}$';
/**
 * A name a person reads. `display: true` marks a string a person reads (a name, a title, a line, a description): the
 * template path's content forms theme exactly the display text of the sections a document has.
 */
const NAME = /** @type {ParamSchema} */ ({ type: 'string', display: true, pattern: NAME_PATTERN, effect: 'the name a person reads: 1-40 characters, starting with a non-space' });
const ID = /** @type {ParamSchema} */ ({ type: 'string', pattern: ID_PATTERN, required: true, effect: 'a lowercase slug, unique in its section' });
/** A list of entries with ids and names, plus the fields given. @param {Record<string, ParamSchema>} [fields] @returns {ParamSchema} */
const entries = (fields = {}) => ({ type: 'list', of: { type: 'object', open: true, fields: { id: ID, name: NAME, ...fields } } });

/**
 * The base shapes, by section path. `content.archetypes[].components` holds one value per component, whose shape the
 * owning card declares (card.components). `zones` are every space's zones (spaces[].zones).
 */
export const SECTIONS = Object.freeze({
  'content.archetypes': entries({ components: { type: 'object', open: true, default: {}, effect: 'components keyed by the primitive that owns each (card.components)' } }),
  'content.items': entries(),
  'content.blocks': entries(),
  'content.recipes': entries(),
  'plot.characters': entries(),
  'plot.quests': entries(),
  'plot.endings': entries(),
  zones: entries(),
});
/** Section paths whose base shape the kernel declares. */
export const BASE_SECTIONS = Object.freeze(Object.keys(SECTIONS));

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merge two declarations of one value (a base and a card's, or two cards'): objects merge their fields (recursively),
 * lists merge their elements; anything else must be declared the same way twice, else it is a conflict.
 * @param {ParamSchema} a @param {ParamSchema} b @param {string} path @param {Array<{ path: string, message: string }>} conflicts @returns {ParamSchema}
 */
export function mergeShape(a, b, path, conflicts) {
  if (a.type === 'object' && b.type === 'object') {
    /** @type {Record<string, ParamSchema>} */
    const fields = { ...(a.fields || {}) };
    for (const [k, f] of Object.entries(b.fields || {})) fields[k] = fields[k] ? mergeShape(fields[k], f, `${path}.${k}`, conflicts) : f;
    const values = a.values && b.values ? mergeShape(a.values, b.values, `${path}.*`, conflicts) : a.values ?? b.values;
    return { ...a, ...b, fields, open: Boolean(a.open || b.open) && !(a.open === false || b.open === false) ? true : Boolean(a.open && b.open), ...(values ? { values } : {}), required: Boolean(a.required || b.required) || undefined };
  }
  if (a.type === 'list' && b.type === 'list' && a.of && b.of) return { ...a, ...b, of: mergeShape(a.of, b.of, `${path}[]`, conflicts), min: Math.max(a.min ?? 0, b.min ?? 0) || undefined };
  if (!same(strip(a), strip(b))) conflicts.push({ path, message: `declared as ${JSON.stringify(strip(a)).slice(0, 120)} and as ${JSON.stringify(strip(b)).slice(0, 120)}` });
  return a;
}
/** A declaration without its prose (two cards may describe one field in their own words). @param {ParamSchema} s */
const strip = s => Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'effect' && k !== 'example'));

/**
 * The shape of a section in a document that uses `uses`: the kernel's base (when it declares the section) merged with
 * every used card's card.data for it, and for content.archetypes the components the used cards own. null when neither
 * the kernel nor a used card declares the section. Conflicting declarations are returned with it (a catalogue defect).
 * @param {RegistryLike} registry @param {Iterable<string>} uses @param {string} section
 * @returns {{ shape: ParamSchema | null, conflicts: Array<{ path: string, message: string }>, by: string[] }}
 */
export function sectionShape(registry, uses, section) {
  const ids = [...new Set(uses)].sort(), key = `${section}|${ids.join(',')}`;
  let memo = shapes.get(registry);
  if (!memo) { memo = new Map(); shapes.set(registry, memo); }
  const hit = memo.get(key);
  if (hit) return hit;
  const out = mergedShape(registry, ids, section);
  memo.set(key, out);
  return out;
}
/** Merged shapes by registry, then section and used primitives (cards are fixed once registered). @type {WeakMap<object, Map<string, ReturnType<typeof mergedShape>>>} */
const shapes = new WeakMap();

/** @param {RegistryLike} registry @param {string[]} ids sorted @param {string} section */
function mergedShape(registry, ids, section) {
  /** @type {Array<{ path: string, message: string }>} */
  const conflicts = [];
  /** @type {ParamSchema | null} */
  let shape = /** @type {Record<string, ParamSchema>} */ (SECTIONS)[section] ?? null;
  /** @type {string[]} */
  const by = [];
  for (const id of ids) {
    const card = registry.get(id)?.card;
    const own = isObj(card?.data) ? /** @type {ParamSchema | undefined} */ (card.data[section]) : undefined;
    if (!isObj(own)) continue;
    by.push(id);
    shape = shape ? mergeShape(shape, own, section, conflicts) : own;
  }
  if (section === 'content.archetypes' && shape) {
    /** @type {Record<string, ParamSchema>} */
    const components = {};
    for (const id of ids) for (const [k, spec] of Object.entries(registry.get(id)?.card.components || {})) {
      if (!components[k]) { components[k] = /** @type {ParamSchema} */ (spec); continue; }
      components[k] = mergeShape(components[k], /** @type {ParamSchema} */ (spec), `${section}[].components.${k}`, conflicts);
    }
    const entry = /** @type {ParamSchema} */ (shape.of);
    shape = { ...shape, of: { ...entry, fields: { ...entry.fields, components: { ...(entry.fields?.components ?? { type: 'object' }), type: 'object', open: true, fields: components } } } };
  }
  return { shape, conflicts, by };
}
