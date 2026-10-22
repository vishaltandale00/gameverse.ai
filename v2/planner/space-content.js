// @ts-check
// The one reading of "a space has its world content" (ARCHITECTURE.md §3: a space card's needs.content, the world
// content cards declare they provide), shared by the static composition check (compose-check.js: the content check and
// a loop's world needs) and the gate's world check (world.js worldContent / worldProblems). Both judge the same
// declarations the same way, so a world one of them accepts the other never reports as lacking.
//
// A space of a composition has world content kind K when:
//   - the space card declares it carries K itself (card.provides.content: a track is a course);
//   - it is a region a sub-space adapter defines, given K by its host (card.adapts.subspace.content);
//   - its card declares params that carry K (card.provides.contentParams: arena2d solids and platforms are its
//     structures) and the instance sets one of them (in a selection, whose params the document will write, the
//     declaration suffices);
//   - K is authored by the outline (OUTLINE_AUTHORS: zones) and the space has it: one zone, or zones joined by exits (a
//     selection's zones are written with the document);
//   - a unit on the space gives it (unitGives): a generator or a mechanic whose card.provides.content has K for that
//     space kind (card.spaces, when it declares them), or an active adapter projecting K (card.adapts.provides.content).
import { isList, isObj, list, prop, str } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Card} Card */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */

/** Content kinds the outline itself authors in every space it writes (zones with their exits). @type {string[]} */
export const OUTLINE_AUTHORS = ['zones'];

/** How many zones of a list are joined to another by exits. @param {unknown} zones */
export const linkedZones = (/** @type {unknown} */ zones) => list(zones).filter(z => { const exits = prop(z, 'exits'); return Array.isArray(exits) && exits.length > 0; }).length;
/** Whether a space's zones are world content: a single zone, or zones joined by exits. @param {unknown} zones */
export const zonesAuthored = (/** @type {unknown} */ zones) => list(zones).length === 1 || linkedZones(zones) > 0;

/** A param value that carries something: a non-empty list or object, or any other set value. @param {unknown} v */
const setValue = (/** @type {unknown} */ v) => (isList(v) ? v.length > 0 : isObj(v) ? Object.keys(v).length > 0 : v != null);

/**
 * World content a space instance carries itself: its card's provides.content, what its host gives a region
 * (`given`), the contentParams kinds whose params it sets, and the outline-authored kinds it has.
 * @param {Card | null | undefined} card the space primitive's card
 * @param {{ with?: unknown, zones?: unknown, given?: string[] }} space the instance (with: its params; zones: its zone list)
 * @param {{ written?: boolean }} [opts] written: a document (false: a selection, whose params and zones are yet to be written)
 * @returns {string[]}
 */
export function carriedContent(card, space, { written = true } = {}) {
  const have = new Set([...(card?.provides?.content || []), ...(space.given || [])]);
  for (const [kind, params] of Object.entries(card?.provides?.contentParams || {})) {
    if (isList(params) && params.length && (!written || params.some(p => setValue(prop(space.with, p))))) have.add(kind);
  }
  for (const kind of OUTLINE_AUTHORS) if (!written || zonesAuthored(space.zones)) have.add(kind);
  return [...have];
}

/**
 * Does a unit on a space of kind `spaceUse` give it world content `item`: its card declares provides.content with it
 * for that space kind (card.spaces, when it declares them: a generator, or a mechanic that fills its space itself), or
 * it is an active adapter (`adapter`) projecting it (card.adapts.provides.content)?
 * @param {Card | null | undefined} card @param {string} item @param {string} spaceUse @param {{ adapter?: boolean }} [opts]
 */
export function unitGives(card, item, spaceUse, { adapter = false } = {}) {
  if (!card) return false;
  if ((card.provides?.content || []).includes(item) && (!isList(card.spaces) || card.spaces.includes(spaceUse))) return true;
  return adapter && (card.adapts?.provides?.content || []).includes(item);
}

/**
 * The world content a document's space has from declarations: what it carries (carriedContent) and what the units on
 * it give (unitGives): its generators, and the systems bound to it (a system without `space` is bound to the first
 * space), adapters among them active as preflight admits them.
 * @param {RegistryLike} registry @param {{ spaces?: unknown, systems?: unknown }} doc
 * @param {{ id?: unknown, use?: unknown, with?: unknown, zones?: unknown, generators?: unknown }} space
 * @returns {string[]}
 */
export function spaceContent(registry, doc, space) {
  const use = str(space.use), card = registry.get(use)?.card;
  const have = new Set(carriedContent(card, space));
  const first = prop(list(doc.spaces)[0], 'id');
  const units = [...list(space.generators), ...list(doc.systems).filter(s => (prop(s, 'space') ?? first) === space.id)];
  for (const u of units) {
    const c = registry.get(str(prop(u, 'use')))?.card;
    for (const item of [...(c?.provides?.content || []), ...(c?.adapts?.provides?.content || [])]) if (unitGives(c, item, use, { adapter: Boolean(c?.adapts) })) have.add(item);
  }
  return [...have];
}
