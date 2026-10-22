// @ts-check
// Who is on whose side: the one reading of the side declarations primitives make (KERNEL_API.md §2 Sides). Every
// consumer that asks whether an entity is the player's or an opponent reads it here: the win a loop reads of its
// 'opponents' or of the 'player' (verify/objective.js winMeasure, planner/loop-check.js, planner/loop.js
// playerSubjects), the bots (verify/drive.js foes), combat's teams (gameplay/combat-lib.js teamOf: friendly fire, shots
// and contact), AI hostility (gameplay/ai-brain.js hostile), and what a person sees (renderers, the HUD).
//
// A primitive that puts entities on sides declares, as data (card.sides):
//   { param, control?, component?, field?, members?, each? }
//   param      the list param of its instance holding the sides (turns `sides`, rts `factions`, sports `teams`), each
//              entry with an `id`; with `each`, a list of participant selectors (race `racers`, rounds `fighters`)
//              whose every matching entity is a side of its own;
//   control    the value of an entry's `control` field (the card's field default when the entry omits it) that makes
//              it the player's side ('player');
//   component, field   an entity's side id is components[component][field] (turns.side, rts.faction);
//   members    an entry's field listing its members (entity ids, archetypes or tags).
// A side with no `control` declared is the player's when its members include the player. The player is always on its
// own side. An entity no declaration places has no side (null): it is not the player's side, and consumers read it as
// an opponent when they ask for opponents.
//
// The reading works on runtime entities ({ id, archetype, components }) and, for the static checks, on archetype
// entries read as entities (staticSides): the same function decides both.
import { isObj, isStr, list, objects, prop } from './guards.js';

/** @typedef {{ param: string, control?: string, component?: string, field?: string, members?: string, each?: boolean }} SideDecl */
/** @typedef {{ id: string, members: string[], control: unknown }} Side */
/** @typedef {{ use: string, decl: SideDecl, sides: Side[] }} SideSet */
/** An entity as the reading sees it. @typedef {{ id?: unknown, archetype?: unknown, components?: Record<string, any> }} SidedEntity */
/** What the reading needs of a world: its document, registry and player. @typedef {{ doc: any, registry: any, player?: () => SidedEntity | null | undefined }} SideWorld */

/** @param {SidedEntity | null | undefined} e @param {unknown} sel */
const matches = (e, sel) => Boolean(e) && isStr(sel) && (sel === e?.id || sel === e?.archetype || (Array.isArray(e?.components?.tags) && e.components.tags.includes(sel)));

/** The well-formed side declaration of a card, or null. @param {unknown} card @returns {SideDecl | null} */
export function sideDecl(card) {
  const d = prop(card, 'sides');
  return isObj(d) && isStr(d.param) ? /** @type {SideDecl} */ (d) : null;
}

/** @type {WeakMap<object, WeakMap<object, SideSet[]>>} */
const cache = new WeakMap();
/**
 * The side declarations of a document's systems with their sides: [{ use, decl, sides: [{ id, members, control }] }]
 * (`each`: one entry per selector, its id the selector). Cached per document and registry.
 * @param {any} doc @param {any} registry @returns {SideSet[]}
 */
export function sidesOf(doc, registry) {
  if (!isObj(doc) || !registry || typeof registry.get !== 'function') return [];
  let m = cache.get(doc);
  if (!m) { m = new WeakMap(); cache.set(doc, m); }
  const hit = m.get(registry);
  if (hit) return hit;
  /** @type {SideSet[]} */
  const out = [];
  for (const inst of list(doc.systems)) {
    const card = registry.get(prop(inst, 'use'))?.card, d = sideDecl(card);
    if (!d) continue;
    const spec = card.params?.[d.param], given = prop(prop(inst, 'with'), d.param), entries = list(given !== undefined ? given : spec?.default);
    const controlDefault = d.control ? spec?.of?.fields?.control?.default : undefined;
    const sides = d.each
      ? entries.filter(isStr).map(sel => ({ id: sel, members: [sel], control: undefined }))
      : objects(entries).filter(s => isStr(s.id)).map(s => ({ id: String(s.id), members: d.members ? list(s[d.members]).filter(isStr) : [], control: s.control ?? controlDefault }));
    out.push({ use: String(prop(inst, 'use')), decl: d, sides });
  }
  m.set(registry, out);
  return out;
}

/** Is a side the player's (its control, else its members naming the player)? @param {SideDecl} decl @param {Side} side @param {SidedEntity | null | undefined} player */
const isPlayers = (decl, side, player) => (decl.control ? side.control === decl.control : !decl.each && side.members.some(sel => matches(player, sel)));

/**
 * The side of an entity: { side, mine } (mine: the player's side), or null when no declaration places it. The player
 * is on its own side whenever the document declares sides (its side id: the player's side it is placed on, else
 * 'player'). With `each`, every participant is a side of its own (its id).
 * @param {SideWorld} world @param {SidedEntity | null | undefined} e @returns {{ side: string, mine: boolean } | null}
 */
export function sideOf(world, e) {
  if (!e) return null;
  const sets = sidesOf(world.doc, world.registry);
  if (!sets.length) return null;
  const isPlayer = e.id === 'player', player = isPlayer ? e : world.player?.();
  for (const { decl, sides } of sets) {
    const byComp = decl.component && decl.field ? e.components?.[decl.component]?.[decl.field] : undefined;
    const side = byComp != null ? sides.find(s => s.id === byComp) || { id: String(byComp), members: [], control: undefined } : sides.find(s => s.members.some(sel => matches(e, sel)));
    if (!side) continue;
    if (decl.each) return { side: isStr(e.id) ? e.id : side.id, mine: isPlayer };
    return { side: side.id, mine: isPlayer || isPlayers(decl, side, player) };
  }
  return isPlayer ? { side: playerSides(world.doc, world.registry)[0] ?? 'player', mine: true } : null;
}

/** Is the entity the player or on the player's side? @param {SideWorld} world @param {SidedEntity | null | undefined} e */
export const onPlayerSide = (world, e) => Boolean(e) && (e?.id === 'player' || Boolean(sideOf(world, e)?.mine));

/**
 * Are two entities on opposed declared sides? true / false when both are placed on sides (the player counts as placed
 * whenever the document declares sides), null when either is on none: the declarations do not say.
 * @param {SideWorld} world @param {SidedEntity | null | undefined} a @param {SidedEntity | null | undefined} b @returns {boolean | null}
 */
export function opposed(world, a, b) {
  const sa = sideOf(world, a), sb = sideOf(world, b);
  if (!sa || !sb) return null;
  return sa.mine !== sb.mine || (!sa.mine && sa.side !== sb.side);
}

/**
 * The ids of the declared sides the player is on (control, or members naming the player or its archetype), in
 * document order; `use` limits it to one primitive's sides.
 * @param {any} doc @param {any} registry @param {string} [use] @returns {string[]}
 */
export function playerSides(doc, registry, use) {
  const player = { id: 'player', archetype: prop(prop(doc, 'player'), 'archetype') };
  /** @type {string[]} */
  const out = [];
  for (const { use: u, decl, sides } of sidesOf(doc, registry)) {
    if (use !== undefined && u !== use) continue;
    for (const s of sides) if (isPlayers(decl, s, player) && !out.includes(s.id)) out.push(s.id);
  }
  return out;
}

/**
 * The static reading for checks that run before any world exists: a world over the document whose player is the
 * document's player archetype, and archetype entries read as entities (with a spawn rule's component overrides when
 * given).
 * @param {any} doc @param {any} registry
 */
export function staticSides(doc, registry) {
  const arches = objects(prop(prop(doc, 'content'), 'archetypes'));
  const playerArch = prop(prop(doc, 'player'), 'archetype');
  const comps = (/** @type {unknown} */ id) => /** @type {Record<string, any>} */ (prop(arches.find(a => a.id === id), 'components') || {});
  /** @type {SideWorld} */
  const world = { doc, registry, player: () => ({ id: 'player', archetype: playerArch, components: comps(playerArch) }) };
  return {
    world,
    /** The side of an archetype's entities (with spawn overrides when given). @param {string} id @param {Record<string, any>} [components] */
    archetype: (/** @type {string} */ id, /** @type {Record<string, any> | undefined} */ components) => sideOf(world, { id, archetype: id, components: { ...comps(id), ...(components || {}) } }),
  };
}
