// Whose side an entity is on, as a person needs to see it (the player's side or the other side), from what cards declare
// (card.sides on a primitive that puts entities on sides):
//   { param, control?, component?, field?, members? }
//   param      the list param of sides (turns `sides`, rts `factions`, sports `teams`), each entry with an `id`;
//   control    the value of an entry's `control` field that makes it the player's side ('player');
//   component, field   an entity's side id is components[component][field] (turns.side, rts.faction);
//   members    an entry's field listing its members (entity ids, archetypes or tags: modes-lib-util.js matches).
// A side with no `control` is the player's when its members include the player. Used by the renderers (an entity on
// the other side reads as an enemy, one on the player's side as an ally) and the HUD (the opponents a win counts).
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const matches = (e, sel) => Boolean(e) && (sel === e.id || sel === e.archetype || (Array.isArray(e.components?.tags) && e.components.tags.includes(sel)));

const cache = new WeakMap();
/** The side declarations of a document's primitives with their sides: [{ decl, sides: [{ id, members, mine }] }]. */
export function sidesOf(doc, registry) {
  if (!doc || !registry || typeof registry.get !== 'function') return [];
  let m = cache.get(doc);
  if (!m) { m = new WeakMap(); cache.set(doc, m); }
  if (m.has(registry)) return m.get(registry);
  const out = [];
  for (const inst of doc.systems || []) {
    const card = registry.get(inst?.use)?.card, d = card?.sides;
    if (!isObj(d) || typeof d.param !== 'string') continue;
    const list = Array.isArray(inst.with?.[d.param]) ? inst.with[d.param] : Array.isArray(card.params?.[d.param]?.default) ? card.params[d.param].default : [];
    out.push({ decl: d, sides: list.filter(isObj).map(s => ({ id: s.id, members: d.members && Array.isArray(s[d.members]) ? s[d.members] : [], control: s.control })) });
  }
  m.set(registry, out);
  return out;
}
/**
 * The side of an entity: { side, mine } (mine: the player's side), or null when no declaration puts it on one.
 * @param {{ doc: any, registry: any, player?: () => any }} rt @param {any} e
 */
export function sideOf(rt, e) {
  if (!e) return null;
  const player = rt.player?.();
  for (const { decl, sides } of sidesOf(rt.doc, rt.registry)) {
    const byComp = decl.component && decl.field ? e.components?.[decl.component]?.[decl.field] : undefined;
    const side = byComp != null ? sides.find(s => s.id === byComp) || { id: byComp, members: [], control: undefined } : sides.find(s => s.members.some(sel => matches(e, sel)));
    if (!side) continue;
    const mine = e.id === 'player' || (decl.control && side.control !== undefined ? side.control === decl.control : side.members.some(sel => matches(player, sel)));
    return { side: side.id, mine };
  }
  return null;
}
