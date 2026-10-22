// What the document calls things, for the text a person reads (KERNEL_API §2 rt.options `text`, §6): the display text
// the document declares (a character's, archetype's, zone's, side's or entry's `name`), or null when it declares none.
// Never an id, title-cased or not: a primitive or UI with no declared name for something says nothing about it rather
// than showing the id code wrote (tests/v2-option-text.test.js).

/** A declared display string, or null. @param {unknown} v @returns {string | null} */
export const declared = v => (typeof v === 'string' && v.trim() ? v : null);

/**
 * What an entity is called: its character's name (plot.characters, by entity id), its own components.name, else its
 * archetype's name (content.archetypes). @param {any} rt @param {string} id @returns {string | null}
 */
export function entityName(rt, id) {
  const doc = rt.doc || {}, e = rt.entity?.(id);
  return declared((doc.plot?.characters || []).find(c => c.id === id)?.name)
    ?? declared(e?.components?.name)
    ?? declared((doc.content?.archetypes || []).find(a => a.id === (e?.archetype ?? id))?.name);
}

/** What a zone is called (its declared `name` in the space that holds it). @param {any} doc @param {string} id @returns {string | null} */
export function zoneName(doc, id) {
  for (const s of doc?.spaces || []) { const z = (s.zones || []).find(x => x.id === id); if (z) return declared(z.name); }
  return null;
}

/** What an entry of a content section is called (content.<section>[].name). @param {any} doc @param {string} section @param {string} id */
export const entryName = (doc, section, id) => declared((doc?.content?.[section] || []).find(e => e?.id === id)?.name);

/** A list of names as a person reads it: 'A', 'A and B', 'A, B and C'. @param {string[]} names */
export const listed = names => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** A cell as a person reads it: its coordinates. @param {number[]} at */
export const cellText = at => (Array.isArray(at) ? at.slice(0, 2).map(n => Math.round(n)).join(', ') : String(at));
