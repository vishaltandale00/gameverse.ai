// @ts-check
// Content contracts: what a primitive needs in the document to be meaningful, read from the cards.
// A combat primitive with nothing to fight, a race with no racers or a dialogue runner with no lines
// all preflight, boot and even "complete", yet the game is hollow. Each card may declare
//
//   card.content = [
//     { need: 'archetypes', component: 'health', kinds?: [...], min: 2, placed?: n, zones?: n, why, example },
//     { need: 'section', at: 'plot.quests', min: 1, why, example },
//     { need: 'param', param: 'racers', min: 3, why, example },
//     { need: 'items', min: 2, why, example },
//   ]
//
//   archetypes  non-player archetypes carrying `component` (and of `kinds` when given): at least `min`
//               defined, `placed` instances put in the world (spawn rules, spawn effects, characters, any
//               param or generator naming them) across at least `zones` zones (capped by the zone count);
//   section     a plot/content section with at least `min` entries;
//   param       the primitive's own instance param (a list) with at least `min` entries;
//   items       content.items with at least `min` entries.
//
// Cards without a declaration get derived contracts: every plot/content section they read that the
// skeleton does not provide, and their engagement participants. Nothing here names a primitive.
//
// populateProblems(doc) lists what is missing as repair problems with the exact shape to add (the card's
// example); placeContent(doc) deterministically places archetypes that exist but nothing puts in the world.
import { placements, spawnRules, spawnEffects } from './census.js';
import { spawnerId } from './engage.js';
import { cardLoop } from './loop.js';
import { spaceExtent } from './world.js';
import { matches } from '../primitives/gameplay/modes-lib-util.js';
import { createWorld } from '../kernel/world.js';
import { preflight } from '../kernel/document.js';
import { standable } from '../primitives/engine/runtime-lib.js';
import { isObj, isStr, list, objects, prop } from '../kernel/guards.js';
import { sideDecl } from '../kernel/sides.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/**
 * A content need as a card declares it (card.content; cards are program code, see the header).
 * @typedef {{ need: string, component?: string, kinds?: string[], min?: number, placed?: number, zones?: number, at?: string, param?: string, why?: string, example?: unknown }} ContractSpec
 */
/** One primitive's contract: the spec plus its primitive and a stable key. @typedef {ContractSpec & { use: string, key: string }} Contract */
/** A contract merged over every primitive that asks for the same thing. @typedef {Contract & { uses: string[] }} MergedContract */
/**
 * A populate problem (repair feedback): stable code, document path, the shape to add in the hint.
 * @typedef {{ code: string, path: string, message: string, hint: string, severity: 'error', contract: string, uses: string[], missing: Record<string, unknown> }} ContentProblem
 */
/** A placement added by placeContent. @typedef {{ rule: string, archetype: unknown, zone: unknown, count: number, contract: string }} Placement */

export const CONTENT_VERSION = 'content/0.1';
/** The value at a dotted path (any JSON container; primitives box like property access does). @param {unknown} doc @param {string} path @returns {unknown} */
const at = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : /** @type {Record<string, unknown>} */ (Object(v))[k]), doc);
/** @param {unknown} v */
const size = v => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0);
// Sections the procedural skeleton always writes, and catalogue-wide ones a reader never needs filled.
// Sections the kernel itself consumes (spawning, characters, the story runner's own data): never "unread".
const KERNEL_SECTIONS = new Set(['content.archetypes', 'content.models', 'plot.characters', 'plot.storyboard', 'plot.endings']);
const SKELETON = new Set(['plot.characters', 'plot.storyboard', 'plot.endings', 'content.items', 'content.archetypes', 'content.models', 'content.blocks']);

/** Contracts of one primitive: declared, else derived. Each gets { use, key }. @param {RegistryLike} registry @param {string} id @returns {Contract[]} */
export function contractsOf(registry, id) {
  const card = registry.get(id)?.card; if (!card) return [];
  // card.content is written by primitive authors (program code), in the ContractSpec shape documented above.
  let list = Array.isArray(card.content) ? /** @type {ContractSpec[]} */ (card.content) : null;
  if (!list) {
    list = [];
    // Plot sections a gameplay/plot primitive runs on (quests, dialogue, clues...); content sections are often
    // optional overrides (prefabs, tables), so content needs are declared by the card itself.
    if (/^(gameplay|plot)\./.test(id)) for (const r of card.reads || []) if (typeof r === 'string' && !SKELETON.has(r) && /^plot\./.test(r)) list.push({ need: 'section', at: r, min: 1, why: `${id} reads ${r}` });
    const part = card.engage?.participants?.param;
    if (part) list.push({ need: 'param', param: part, min: 2, why: `${id} needs participants besides the player` });
  }
  // The mode's declared needs (card.mode.needs.content): document sections its loop cannot run without.
  const needs = /** @type {{ needs?: { content?: unknown } } | undefined} */ (card.mode)?.needs?.content;
  if (Array.isArray(needs)) for (const at of needs) {
    if (typeof at !== 'string' || at === 'spaces.zones' || list.some(c => c.at === at)) continue;
    if (at === 'content.archetypes') { if (!list.some(c => c.need === 'archetypes')) list.push({ need: 'archetypes', min: 1, placed: 1, why: `the ${id} loop needs its pieces, units or targets placed in the world` }); continue; }
    if (/^(plot|content)\.[a-zA-Z]+$/.test(at)) list.push({ need: 'section', at, min: 1, why: `the ${id} loop runs on ${at}` });
  }
  return list.map((c, i) => ({ ...c, use: id, key: `${id}#${c.need}:${c.component || c.at || c.param || i}` }));
}

/** Contracts of every primitive a document (or a selection) uses, deduplicated by what they ask for. @param {RegistryLike} registry @param {Iterable<string>} ids @returns {MergedContract[]} */
export function contractsFor(registry, ids) {
  /** @type {MergedContract[]} */
  const out = [];
  /** @type {Map<string, MergedContract>} */
  const seen = new Map();
  for (const id of [...new Set(ids)]) for (const c of contractsOf(registry, id)) {
    const k = `${c.need}|${c.component || ''}|${(c.kinds || []).join(',')}|${c.at || ''}|${c.need === 'param' ? c.use + '.' + c.param : ''}`;
    const prev = seen.get(k);
    if (prev) { prev.min = Math.max(prev.min || 0, c.min || 0); prev.placed = Math.max(prev.placed || 0, c.placed || 0) || undefined; prev.zones = Math.max(prev.zones || 0, c.zones || 0) || undefined; prev.uses.push(id); continue; }
    const entry = { ...c, uses: [id] }; seen.set(k, entry); out.push(entry);
  }
  return out;
}

/** Primitive ids a document (or a draft) uses. @param {unknown} doc @returns {string[]} */
const usedIds = doc => [...list(prop(doc, 'spaces')).flatMap(s => [prop(s, 'use'), ...list(prop(s, 'generators')).map(g => prop(g, 'use'))]), ...list(prop(doc, 'systems')).map(s => prop(s, 'use'))].filter(isStr).filter(Boolean);
/** @param {unknown} doc @returns {unknown[]} */
const zoneIds = doc => list(prop(doc, 'spaces')).flatMap(s => list(prop(s, 'zones')).map(z => prop(z, 'id')));

/** @typedef {Map<unknown, { count: number, zones: Set<unknown> }>} PlacementCounts */
/** archetype id -> { count, zones:Set } of placed instances (spawn rules count their max, others count one). @param {unknown} doc @param {RegistryLike} registry @returns {PlacementCounts} */
export function placementCounts(doc, registry) {
  /** @type {PlacementCounts} */
  const out = new Map();
  /** @param {unknown} id @param {number} n @param {unknown} zone */
  const add = (id, n, zone) => { let e = out.get(id); if (!e) { e = { count: 0, zones: new Set() }; out.set(id, e); } e.count += n; if (zone) e.zones.add(zone); };
  /** @type {Set<string>} */
  const covered = new Set();
  // Spawn rules and effects are document data: counts are coerced like Math.max coerces them.
  for (const r of spawnRules(doc, registry)) { const count = prop(r, 'count'); if (typeof prop(r, 'archetype') === 'string') { add(prop(r, 'archetype'), prop(r, 'unique') ? 1 : Math.max(1, Number((Array.isArray(count) ? count[count.length - 1] : count) || 1)), prop(r, 'zone')); covered.add(`${prop(r, '_path')}.archetype`); } }
  for (const e of spawnEffects(doc)) { add(prop(e, 'archetype'), Math.max(1, Number(prop(e, 'count') || 1)), prop(e, 'zone')); covered.add(`${prop(e, '_path')}.archetype`.replace(/^\./, '')); }
  for (const c of list(prop(prop(doc, 'plot'), 'characters'))) if (typeof prop(c, 'archetype') === 'string') add(prop(c, 'archetype'), 1, prop(c, 'home'));
  for (const [id, paths] of /** @type {Map<unknown, string[]>} */ (placements(doc))) for (const p of paths) {
    if (covered.has(p) || covered.has(p.replace(/^\./, '')) || /^plot\.characters\[\d+\]\.archetype$/.test(p)) continue;
    add(id, 1, null);
  }
  return out;
}

/** Non-player archetypes that satisfy a contract's component/kinds. @param {unknown} doc @param {ContractSpec} c @returns {Record<string, unknown>[]} */
const archetypesWith = (doc, c) => objects(prop(prop(doc, 'content'), 'archetypes')).filter(a => a.id && a.id !== prop(prop(doc, 'player'), 'archetype') && a.kind !== 'player'
  && (!c.component || (isObj(a.components) && a.components[c.component] !== undefined)) && (!c.kinds?.length || c.kinds.some(k => k === a.kind)));

/** @param {unknown} example */
const shape = example => (example === undefined ? '' : ` Shape: ${JSON.stringify(example).slice(0, 600)}`);

/**
 * What the document's primitives need and do not have. -> [{ code, path, message, hint, severity, contract, missing }]
 * Problems use stable codes: content_missing (nothing there), content_unplaced (defined, not in the world),
 * content_spread (placed in too few zones), content_thin (fewer than the minimum).
 * @param {unknown} doc @param {RegistryLike} registry @param {{ contracts?: MergedContract[] | null }} [options] @returns {ContentProblem[]}
 */
export function populateProblems(doc, registry, { contracts = null } = {}) {
  const needs = contracts || contractsFor(registry, usedIds(doc));
  const counts = placementCounts(doc, registry), zones = zoneIds(doc);
  /** @type {ContentProblem[]} */
  const problems = [];
  /** @param {string} code @param {string} path @param {MergedContract} c @param {string} message @param {Record<string, unknown>} missing */
  const push = (code, path, c, message, missing) => problems.push({ code, path, message, hint: `${c.why ? c.why + '.' : ''}${shape(c.example)}`, severity: 'error', contract: c.key, uses: c.uses, missing });
  for (const c of needs) {
    if (c.need === 'archetypes') {
      const have = archetypesWith(doc, c);
      const what = `archetypes${c.component ? ` with a "${c.component}" component` : ''}${c.kinds?.length ? ` (kind ${c.kinds.join('|')})` : ''}`;
      if (have.length < (c.min || 1)) { push(have.length ? 'content_thin' : 'content_missing', 'content.archetypes', c, `${c.uses.join(', ')} need${c.uses.length > 1 ? '' : 's'} at least ${c.min || 1} ${what}; the document has ${have.length}`, { kind: 'archetypes', count: (c.min || 1) - have.length }); continue; }
      if (!c.placed) continue;
      let total = 0, unknown = 0;
      /** @type {Set<unknown>} */
      const where = new Set();
      for (const a of have) { const p = counts.get(a.id); if (p) { total += p.count; p.zones.forEach(z => where.add(z)); if (!p.zones.size) unknown += p.count; } }
      if (total < c.placed) push(total ? 'content_thin' : 'content_unplaced', 'systems', c, `${have.map(a => a.id).join(', ')} ${have.length > 1 ? 'are' : 'is'} defined but only ${total} of at least ${c.placed} are placed in the world: add spawn rules (archetype, zone, count) in the zones where they belong`, { kind: 'placed', count: c.placed - total, archetypes: have.map(a => a.id) });
      // Spread is judged only on placements whose zone is known (a generator feature or a param may place them anywhere).
      else if (c.zones && zones.length > 1 && unknown < c.placed && where.size < Math.min(c.zones, zones.length)) push('content_spread', 'systems', c, `${what} are placed in ${where.size} zone(s); spread them over at least ${Math.min(c.zones, zones.length)} zones so each place has its own`, { kind: 'spread', zones: Math.min(c.zones, zones.length) - where.size, archetypes: have.map(a => a.id) });
    } else if (c.need === 'section') {
      const n = size(at(doc, String(c.at)));
      if (n < (c.min || 1)) push(n ? 'content_thin' : 'content_missing', String(c.at), c, `${c.uses.join(', ')} read${c.uses.length > 1 ? '' : 's'} ${c.at}, which has ${n} entr${n === 1 ? 'y' : 'ies'}; write at least ${c.min || 1}`, { kind: 'section', at: c.at, count: (c.min || 1) - n });
    } else if (c.need === 'param') {
      list(prop(doc, 'systems')).forEach((s, i) => {
        if (prop(s, 'use') !== c.use) return;
        const v = prop(prop(s, 'with'), String(c.param)), n = Array.isArray(v) ? v.length : v ? 1 : 0;
        if (n < (c.min || 1)) push(n ? 'content_thin' : 'content_missing', `systems[${i}].with.${c.param}`, c, `${c.use} ${c.param} has ${n} entr${n === 1 ? 'y' : 'ies'}; it needs at least ${c.min || 1}`, { kind: 'param', use: c.use, param: c.param, count: (c.min || 1) - n });
      });
    } else if (c.need === 'items') {
      const n = list(prop(prop(doc, 'content'), 'items')).length;
      if (n < (c.min || 1)) push(n ? 'content_thin' : 'content_missing', 'content.items', c, `${c.uses.join(', ')} need${c.uses.length > 1 ? '' : 's'} at least ${c.min || 1} items in content.items; the document has ${n}`, { kind: 'items', count: (c.min || 1) - n });
    }
  }
  return problems;
}

/**
 * Primitive ids whose sections hold data nothing installed reads (quests with no quest runner...): readers to add.
 * @param {unknown} doc a document or a draft @param {RegistryLike} registry @returns {Array<{ section: string, reader: string | null }>}
 */
export function unreadReaders(doc, registry) {
  const used = new Set(usedIds(doc));
  /** @type {Set<string>} */
  const reads = new Set();
  for (const id of used) for (const r of registry.get(id)?.card.reads || []) if (typeof r === 'string') reads.add(r);
  /** @type {Array<{ section: string, reader: string | null }>} */
  const out = [];
  for (const [root, section] of [['plot', prop(doc, 'plot')], ['content', prop(doc, 'content')]]) for (const [k, v] of Object.entries(isObj(section) ? section : {})) {
    const key = `${root}.${k}`;
    if (k === 'premise' || KERNEL_SECTIONS.has(key) || !size(v) || [...reads].some(r => key === r || key.startsWith(r + '.'))) continue;
    // The reader: a registered card that reads it and needs no capability (plot/data readers), fewest requirements first.
    const reader = registry.cards().filter(c => (c.reads || []).includes(key) && !(c.requires?.capabilities || []).length && !c.id.startsWith('graphics.'))
      .sort((a, b) => (a.requires?.primitives || []).length - (b.requires?.primitives || []).length || a.id.localeCompare(b.id))[0];
    out.push({ section: key, reader: reader?.id || null });
  }
  return out;
}

/**
 * Deterministic placement: archetypes a contract wants placed that the document defines but nothing puts in
 * the world get spawn rules through the spawner primitive, spread over the zones (hostile kinds skip the
 * player's start zone when there are others). Returns { doc, added: [{rule, archetype, zone}] }; input untouched.
 * The result keeps the input's type: it only gains a spawner instance and spawn rules.
 * @template T
 * @param {T} input @param {RegistryLike} registry @param {{ contracts?: MergedContract[] | null }} [options]
 * @returns {{ doc: T, added: Placement[] }}
 */
export function placeContent(input, registry, { contracts = null } = {}) {
  // Participants first: who takes part, on which side, is structure (placeParticipants); the rest goes zone by zone.
  const seated = placeParticipants(input, registry);
  input = seated.doc;
  const needs = (contracts || contractsFor(registry, usedIds(input))).filter(c => c.need === 'archetypes' && c.placed);
  const sid = spawnerId(registry);
  if (!needs.length || !sid) return { doc: input, added: seated.added };
  const copy = structuredClone(input);
  if (!isObj(copy)) return { doc: input, added: seated.added };
  /** @type {Record<string, unknown>} */
  const doc = copy;
  /** @type {Placement[]} */
  const added = [...seated.added];
  const counts = placementCounts(doc, registry);
  const space = list(doc.spaces)[0];
  const zones = list(prop(space, 'zones')).map(z => prop(z, 'id'));
  if (!zones.length) return { doc: input, added };
  const startAt = prop(doc.player, 'at');
  const startZone = typeof startAt === 'string' ? startAt : zones[0];
  /** The spawner's rules list, created on first use. @type {unknown[] | null} */
  let spawnerRules = null;
  const rules = () => {
    if (spawnerRules) return spawnerRules;
    const systems = Array.isArray(doc.systems) ? doc.systems : [];
    doc.systems = systems;
    const found = systems.find(s => prop(s, 'use') === sid);
    /** @type {Record<string, unknown>} */
    let spawner;
    if (isObj(found)) spawner = found; else { spawner = { use: sid, with: { rules: [] } }; systems.unshift(spawner); }
    const w = isObj(spawner.with) ? spawner.with : {};
    spawner.with = w;
    const r = Array.isArray(w.rules) ? w.rules : [];
    w.rules = r;
    spawnerRules = r;
    return r;
  };
  const taken = new Set(spawnRules(doc, registry).map((/** @type {unknown} */ r) => prop(r, 'id')));
  for (const c of needs) {
    const have = archetypesWith(doc, c); if (!have.length) continue;
    let total = have.reduce((n, a) => n + (counts.get(a.id)?.count || 0), 0);
    if (total >= (c.placed || 0)) continue;
    const hostile = have.some(a => a.kind === 'enemy' || a.kind === 'boss');
    const pool = hostile && zones.length > 1 ? zones.filter(z => z !== startZone) : zones;
    const unplaced = have.filter(a => !counts.get(a.id)?.count);
    const order = unplaced.length ? unplaced : have;
    const placed = c.placed || 0;
    const per = Math.max(1, Math.ceil((placed - total) / Math.max(1, Math.min(pool.length, Math.max(c.zones || 1, order.length)))));
    for (let k = 0; total < placed && k < Math.max(pool.length, order.length) * 2; k++) {
      const a = order[k % order.length], zone = pool[k % pool.length];
      let id = `place_${a.id}_${zone}`.slice(0, 60); while (taken.has(id)) id += '_b'; taken.add(id);
      const n = a.kind === 'boss' ? 1 : per;
      rules().push({ id, archetype: a.id, zone, count: [n, n], respawnSec: 0 });
      added.push({ rule: id, archetype: a.id, zone, count: n, contract: c.key });
      total += n; let e = counts.get(a.id); if (!e) { e = { count: 0, zones: new Set() }; counts.set(a.id, e); } e.count += n; e.zones.add(zone);
    }
  }
  return added.length ? { doc: /** @type {T} */ (/** @type {unknown} */ (doc)), added } : { doc: input, added };
}

// ---------- participants: who takes part, on which side, and where they start ----------
// A loop that declares its participants (card.loop / card.mode needs.participants) as a list param of groups
// ({ id }: sides, teams, factions) and the archetypes it plays with (its archetypes contract's component, e.g.
// turns {side}) is seated by code, never by the model: every such archetype is placed for its group, a group the
// archetypes name none of fields the rest (mirrored armies), each group at its own edge of the space's cells (or
// in its own zone). The model themes the pieces; it does not decide where they stand.
/** Spawn rule ids participant placement owns. */
export const SEAT = 'seat_';
/**
 * One loop's participant declaration as a document instance has it.
 * @typedef {{ use: string, path: string, param: string, groups: Array<{ id: string, members: string[] }>, component: string, field: string | null,
 *   members: string | null, placed: number, space: Record<string, unknown> | null }} Participants
 */
/**
 * The component field that names a participant's group: the field the card's side declaration names (card.sides
 * { param, component, field }: kernel/sides.js) for that param and component, else none.
 * @param {unknown} card @param {string} component @param {string} param @returns {string | null}
 */
export function groupField(card, component, param) {
  const d = sideDecl(card);
  return d && d.param === param && d.component === component && isStr(d.field) ? d.field : null;
}
/**
 * Every loop of a document that declares group participants and the archetypes they are made of.
 * @param {unknown} doc @param {RegistryLike} registry @returns {Participants[]}
 */
export function participantsOf(doc, registry) {
  /** @type {Participants[]} */
  const out = [];
  const spaces = objects(prop(doc, 'spaces'));
  list(prop(doc, 'systems')).forEach((s, i) => {
    const use = prop(s, 'use'); if (!isStr(use)) return;
    const card = registry.get(use)?.card, param = cardLoop(card)?.needs.participants;
    if (!card || !isStr(param)) return;
    const given = prop(prop(s, 'with'), param), groups = objects(given !== undefined ? given : card.params?.[param]?.default).filter(g => isStr(g.id))
      .map(g => ({ id: String(g.id), members: list(g.members).filter(isStr) }));
    const contract = contractsOf(registry, use).find(c => c.need === 'archetypes' && c.component);
    if (!groups.length || !contract?.component) return;
    const join = prop(card.engage, 'join');
    const sid = prop(s, 'space') ?? spaces[0]?.id;
    out.push({ use, path: `systems[${i}]`, param, groups, component: contract.component, field: groupField(card, contract.component, param),
      members: prop(join, 'param') === param && isStr(prop(join, 'field')) ? String(prop(join, 'field')) : null, placed: contract.placed || 0, space: spaces.find(x => x.id === sid) || null });
  });
  return out;
}
/**
 * Seat every loop's participants (participantsOf): their archetypes placed for their groups by spawn rules the
 * placement owns (ids `seat_...`); rules others wrote for those archetypes are replaced. A group's archetypes are
 * the ones whose group field (or the group's members) names it; a group named by none takes the archetypes no group
 * claims (their distinct group values matched to such groups in order when they line up), else all of them, with
 * the group field set on its entities. Each group gets at least its archetypes once and its share of the contract's
 * `placed`. An edge band of a cell space without enough zones (spawner rule.band, resolved on the generated world), else one zone per group. Idempotent; input untouched.
 * @template T @param {T} input @param {RegistryLike} registry @returns {{ doc: T, added: Placement[] }}
 */
export function placeParticipants(input, registry) {
  const sid = spawnerId(registry);
  const loops = sid ? participantsOf(input, registry) : [];
  if (!loops.length) return { doc: input, added: [] };
  const doc = /** @type {Record<string, any>} */ (structuredClone(input));
  /** @type {Placement[]} */
  const added = [];
  /** @type {Record<string, unknown>[]} */
  const rules = [];
  /** @type {Set<string>} */
  const seated = new Set();
  for (const L of loops) {
    const pieces = archetypesWith(doc, { need: 'archetypes', component: L.component });
    const space = L.space;
    if (!pieces.length || !space) continue;
    const value = (/** @type {Record<string, unknown>} */ a) => (L.field ? prop(prop(a.components, L.component), L.field) : undefined);
    const claims = (/** @type {Record<string, unknown>} */ a, /** @type {{ id: string, members: string[] }} */ g) => value(a) === g.id || g.members.includes(String(a.id));
    /** @type {Map<string, Record<string, unknown>[]>} */
    const of = new Map(L.groups.map(g => [g.id, pieces.filter(a => claims(a, g))]));
    const free = pieces.filter(a => !L.groups.some(g => claims(a, g)));
    const empty = L.groups.filter(g => !(of.get(g.id) || []).length);
    const values = [...new Set(free.map(value).filter(isStr))];
    empty.forEach((g, j) => of.set(g.id, values.length === empty.length && free.every(a => isStr(value(a))) ? free.filter(a => value(a) === values[j]) : free.length ? free : pieces));
    const zones = objects(space.zones).filter(z => isStr(z.id));
    // A cell space seats each group at its own edge band (spawner rule.band), resolved by the spawner on the world as
    // generated: which cells the space's generators leave open is the world's, never guessed here.
    const cellSpace = (registry.get(String(space.use))?.card.needs?.content || []).includes('cells') && Boolean(spaceExtent(registry, space));
    if (zones.length < L.groups.length && !cellSpace) continue;
    L.groups.forEach((g, gi) => {
      const mine = of.get(g.id) || [];
      const n = Math.max(mine.length, Math.ceil(L.placed / L.groups.length));
      const byZone = zones.length >= L.groups.length;
      for (let k = 0; k < n; k++) {
        const a = mine[k % mine.length], comp = prop(a.components, L.component);
        const id = `${SEAT}${g.id}_${a.id}_${k + 1}`.slice(0, 60);
        const own = L.field && value(a) !== g.id ? { components: { [L.component]: { ...(isObj(comp) ? comp : {}), [L.field]: g.id } } } : {};
        rules.push({ id, archetype: a.id, space: space.id, ...(byZone ? { zone: zones[gi].id } : { band: gi }), unique: true, activation: 'always', respawnSec: 0, ...own });
        added.push({ rule: id, archetype: a.id, zone: byZone ? zones[gi].id : null, count: 1, contract: `${L.use}#participants:${L.param}` });
        seated.add(String(a.id));
        // Without a group field, the group lists its entities (the loop's members field).
        if (!L.field && L.members) { const inst = list(doc.systems)[Number(L.path.slice(8, -1))], grp = list(prop(prop(inst, 'with'), L.param)).find(x => prop(x, 'id') === g.id); if (isObj(grp)) { const m = list(grp[L.members]); if (!m.includes(id)) grp[L.members] = [...m, id]; } }
      }
    });
  }
  if (!rules.length) return { doc: input, added: [] };
  doc.systems = Array.isArray(doc.systems) ? doc.systems : [];
  let spawner = doc.systems.find((/** @type {unknown} */ s) => prop(s, 'use') === sid);
  if (!isObj(spawner)) { spawner = { use: sid, with: { rules: [] } }; doc.systems.unshift(spawner); }
  spawner.with = isObj(spawner.with) ? spawner.with : {};
  // Participant placement is code's: earlier seats and any other rule for a seated archetype make way.
  spawner.with.rules = [...list(spawner.with.rules).filter(r => !String(prop(r, 'id')).startsWith(SEAT) && !seated.has(String(prop(r, 'archetype')))), ...rules];
  return { doc: /** @type {T} */ (doc), added };
}

/** A declared participant absent from the world at the start of play (absentParticipants). @typedef {{ use: string, path: string, param: string, entry: string, message: string }} AbsentParticipant */
/**
 * The participants a document's loops declare (card.loop needs.participants, card.engage.participants: sides, teams,
 * racers, fighters...) that no entity of the world stands for in any of `worlds` (the entity maps of the states at the
 * start of play). A group entry ({ id }) is present when an entity is on it: its group field (participantsOf) names the
 * group, or the group's members (card.engage.join.field) select it; a group neither reading can judge is left to the
 * loop check. A selector entry (an entity id, archetype or tag) is present when an entity matches it.
 * @param {unknown} doc @param {RegistryLike} registry @param {Array<Record<string, any>>} worlds @returns {AbsentParticipant[]}
 */
export function absentParticipants(doc, registry, worlds) {
  const seated = participantsOf(doc, registry);
  const entities = worlds.flatMap(w => Object.values(isObj(w) ? w : {})).filter(isObj);
  /** @type {AbsentParticipant[]} */
  const out = [];
  const visit = (/** @type {unknown} */ inst, /** @type {string} */ path) => {
    const use = prop(inst, 'use'), card = isStr(use) ? registry.get(use)?.card : null;
    if (!card || !isStr(use)) return;
    const params = new Set([cardLoop(card)?.needs.participants, prop(prop(card.engage, 'participants'), 'param')].filter(isStr).filter(P => card.params?.[P]));
    for (const P of params) {
      const given = prop(prop(inst, 'with'), P), entries = list(given !== undefined ? given : card.params?.[P]?.default);
      const S = seated.find(x => x.path === path && x.param === P);
      const join = prop(card.engage, 'join'), members = prop(join, 'param') === P && isStr(prop(join, 'field')) ? String(prop(join, 'field')) : null;
      for (const e of entries) {
        if (isStr(e)) {
          if (!entities.some(x => matches(x, e))) out.push({ use, path, param: P, entry: e, message: `${use}: '${e}' (with.${P}) is no entity of the world at the start of play` });
          continue;
        }
        const id = prop(e, 'id'); if (!isStr(id)) continue;
        const sel = members ? list(prop(e, members)).filter(isStr) : [];
        if (!(S?.field) && !sel.length && !members) continue;
        const on = (/** @type {Record<string, any>} */ x) => (S?.field ? prop(prop(prop(x, 'components'), S.component), S.field) === id : false) || sel.some(m => matches(x, m));
        if (!entities.some(on)) out.push({ use, path, param: P, entry: id, message: `${use}: ${P} '${id}' has no entity in the world at the start of play${S ? ` (none with ${S.component}.${S.field || '?'} '${id}')` : ''}${sel.length ? ` (none of its ${members}: ${sel.slice(0, 6).join(', ')})` : ''}` });
      }
    }
  };
  list(prop(doc, 'systems')).forEach((s, i) => visit(s, `systems[${i}]`));
  list(prop(doc, 'spaces')).forEach((sp, i) => list(prop(sp, 'generators')).forEach((g, j) => visit(g, `spaces[${i}].generators[${j}]`)));
  return out;
}

/** The frames of the start of play a participant must be in the world by (an intro or a countdown runs then). */
export const START_FRAMES = Object.freeze([0, 2, 30, 60]);
/**
 * The entity maps of a world at the start of play (START_FRAMES; idle input, while it plays); `seen(frame)` is called
 * at each of those frames with the world there.
 * @param {{ state: any, step: (input: {}) => void }} rt @param {(frame: number) => void} [seen] @returns {Array<Record<string, any>>}
 */
export function startOfPlay(rt, seen) {
  seen?.(0);
  const out = [structuredClone(rt.state.entities)];
  for (let f = 1; f <= START_FRAMES[START_FRAMES.length - 1] && rt.state.status === 'playing'; f++) { rt.step({}); if (START_FRAMES.includes(f)) { seen?.(f); out.push(structuredClone(rt.state.entities)); } }
  return out;
}
/** The player standing where it cannot at the start of play (engine runtime-lib standable). @typedef {{ id: string, space: string, at: unknown, message: string }} Misplaced */
/**
 * Boot a document on `seed` and judge its world at the start of play: the participants its loops declare that are
 * absent (absentParticipants), and the player when, once play has begun (START_FRAMES[1]), it stands outside its space
 * or in a cell it cannot stand in (a start carried from a world the composition replaced, a board filled with tiles).
 * A document that does not preflight has nothing to judge here (preflight reports it).
 * @param {unknown} doc @param {RegistryLike} registry @param {import('../kernel/types.js').LogicLike} logic @param {number} [seed]
 * @returns {{ absent: AbsentParticipant[], misplaced: Misplaced[] }}
 */
export function startProblems(doc, registry, logic, seed = 1) {
  const pre = preflight(structuredClone(doc), registry, logic);
  if (!pre.ok) return { absent: [], misplaced: [] };
  const rt = createWorld(pre.doc, registry, logic, { seed });
  /** @type {Misplaced[]} */
  const misplaced = [];
  const worlds = startOfPlay(rt, f => {
    if (f !== START_FRAMES[1]) return;
    const p = rt.player(), api = p?.space ? rt.space(p.space) : null;
    if (p && api && !standable(rt, api, p.space, p.at, p)) misplaced.push({ id: p.id, space: String(p.space), at: p.at, message: `the player stands at ${JSON.stringify(p.at)} in ${p.space}, outside it or in a cell it cannot stand in` });
  });
  return { absent: absentParticipants(pre.doc, registry, worlds), misplaced };
}

/** Problems as model-facing text, grouped (each with the shape to add). @param {Array<{ code: string, path: string, message: string, hint?: string }>} problems @param {number} [limit] */
export function describeContent(problems, limit = 12) {
  return problems.slice(0, limit).map(p => `- [${p.code}] ${p.path}: ${p.message}${p.hint ? `\n    ${p.hint}` : ''}`).join('\n');
}

/** Model-facing text: the content the chosen primitives need, with the exact shapes. @param {MergedContract[]} contracts @returns {string} */
export function contractText(contracts) {
  return contracts.map(c => {
    const what = c.need === 'archetypes' ? `≥${c.min || 1} archetypes${c.component ? ` with a "${c.component}" component` : ''}${c.kinds?.length ? ` (kind ${c.kinds.join('|')})` : ''}${c.placed ? `, ≥${c.placed} placed by spawns${c.zones ? ` across ≥${c.zones} zones` : ''}` : ''}`
      : c.need === 'section' ? `${c.at}: ≥${c.min || 1} entries` : c.need === 'param' ? `${c.use} with.${c.param}: ≥${c.min || 1} entries` : `content.items: ≥${c.min || 1} items`;
    return `- ${c.uses.join(', ')}: ${what}.${c.why ? ` ${c.why}.` : ''}${shape(c.example)}`;
  }).join('\n');
}

// ---------- references: where a declared field's values must come from ----------
// A card declares a reference as { type: 'ref', to: kind } (the kind's collection: a base section or a card.defines
// `at`), or as a string field (or a list of strings) whose declaration names the document section its values are
// ids of ("type names from content.types", "a content.moves id"). Zones are the spaces' zone ids. The strict forms
// offer these ids as enums and repair re-points or reports against them; nothing here names a primitive.
/** The pseudo-section a zone reference draws from. */
export const ZONES = 'zones';
/** The pseudo-section a section-path field draws from: the document's own content/plot section paths. */
export const SECTIONS = 'sections';
/** @type {Record<string, string>} */
const KIND_AT = { character: 'plot.characters', quest: 'plot.quests', ending: 'plot.endings', dialogue: 'plot.dialogue', item: 'content.items', recipe: 'content.recipes', archetype: 'content.archetypes', block: 'content.blocks', model: 'content.models' };
/** @param {unknown} effect @returns {string | null} the document section a declaration's text names */
const namedSection = effect => /\b((?:content|plot)\.[a-zA-Z]+)\b/.exec(String(effect || ''))?.[1] || null;
/** A declaration whose values are section paths ("source section path, e.g. content.species"), not ids in that section. @param {unknown} effect */
const pathOfSection = effect => /\bsection paths?\b/i.test(String(effect || ''));
/** @param {unknown} spec */
const free = spec => isObj(spec) && spec.type === 'string' && !(Array.isArray(spec.options) && spec.options.length);

/** Every document section whose entries are ids of a reference kind (the kernel's base kinds and card.defines `at`). @param {RegistryLike} registry @returns {string[]} */
export function definedSections(registry) {
  return [...new Set([...Object.values(KIND_AT), ...registry.ids().flatMap(id => (registry.get(id)?.card.defines || []).map(d => d.at).filter(isStr))])];
}

/** The document section holding ids of a reference kind, or null. @param {RegistryLike} registry @param {string} kind @returns {string | null} */
export function sectionOfKind(registry, kind) {
  if (KIND_AT[kind]) return KIND_AT[kind];
  for (const id of registry.ids()) for (const d of registry.get(id)?.card.defines || []) if (d.kind === kind && d.at) return d.at;
  return null;
}

/**
 * The section (or ZONES) a declared field's values are ids of, or null when the field is free. A list of strings
 * refers through its element's declaration or its own.
 * @param {RegistryLike} registry @param {unknown} spec a param/field spec as a card declares it @returns {string | null}
 */
export function referenceOf(registry, spec) {
  if (!isObj(spec)) return null;
  if (spec.type === 'ref' && isStr(spec.to)) return spec.to === 'zone' ? ZONES : sectionOfKind(registry, spec.to);
  if (free(spec)) return pathOfSection(spec.effect) ? SECTIONS : namedSection(spec.effect);
  if (spec.type === 'list' && isObj(spec.of)) return referenceOf(registry, spec.of) || (free(spec.of) ? namedSection(spec.effect) : null);
  return null;
}

/** The ids at a section of a (draft) document (list entries' ids or strings, or an id-keyed object's keys), or its zone ids. @param {unknown} doc @param {string} section @returns {string[]} */
export function idsAt(doc, section) {
  if (section === ZONES) return list(prop(doc, 'spaces')).flatMap(s => list(prop(s, 'zones')).map(z => prop(z, 'id'))).filter(isStr);
  if (section === SECTIONS) return sectionPaths(doc);
  const v = at(doc, section);
  if (Array.isArray(v)) return v.map(x => (isStr(x) ? x : prop(x, 'id'))).filter(isStr).filter(Boolean);
  return isObj(v) ? Object.keys(v) : [];
}

/** The document's content and plot sections that hold entries (a list or an id-keyed object), as paths. @param {unknown} doc @returns {string[]} */
export function sectionPaths(doc) {
  return ['content', 'plot'].flatMap(root => Object.entries(isObj(prop(doc, root)) ? /** @type {Record<string, unknown>} */ (prop(doc, root)) : {})
    .filter(([k, v]) => /^[A-Za-z0-9_]+$/.test(k) && size(v) > 0 && (Array.isArray(v) || isObj(v))).map(([k]) => `${root}.${k}`));
}

/**
 * The declared shape at a document data path (plot/content), from the card that declares the section (card.data),
 * walked through list elements and object fields; null when no card declares it.
 * @param {RegistryLike} registry @param {Array<string | number>} keys a parsed path @returns {Record<string, unknown> | null}
 */
export function declaredAt(registry, keys) {
  if ((keys[0] !== 'plot' && keys[0] !== 'content') || typeof keys[1] !== 'string') return null;
  const section = `${keys[0]}.${keys[1]}`;
  /** @type {unknown} */
  let spec = registry.cards().map(c => prop(c.data, section)).find(isObj);
  for (const k of keys.slice(2)) {
    if (!isObj(spec)) return null;
    spec = typeof k === 'number' ? (spec.type === 'list' ? spec.of : null) : (spec.type === 'object' ? prop(spec.fields, k) : null);
  }
  return isObj(spec) ? spec : null;
}
