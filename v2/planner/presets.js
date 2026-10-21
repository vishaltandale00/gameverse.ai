// @ts-check
// Presets (FABLE design, step 4): the deterministic skeleton of a game, composed from the play spec
// (decomposition.core) and what the chosen cards declare (card.mode), never one default shape for every idea.
//   preset(spec) -> { doc, ok, errors, fixes, removed, world, structure }
// - The mode's primitive (and the one its params live on, `via`) is installed and configured so the mode applies.
// - The space follows mode.space (a listed space primitive, or any space with the listed capabilities).
// - An avatar exists only for avatar interaction; otherwise the player is a side/controller with no locomotion.
// - Zones exist only when the space is made of places (exits), the avatar travels, the story needs places, or a
//   chosen mode needs them ('spaces.zones' in needs.content).
// - A storyboard exists only when the idea has narrative; then the story preset (zones visited in act order, gated
//   progression, a finale) applies, ending the game unless a loop owns the win.
// - Endings come from the core loop: mode.win / mode.lose (an effects param gets end_game, an `end` boolean is set,
//   a `when` template becomes a plot ending) are wired to victory / defeat.
// - A nested secondary mode gets its own sub-space when it plays elsewhere (a battle screen).
// The model then fills content and tuning through the outline form; code owns this structure.
// A decomposition without a play spec (older callers) gets the story preset, as before.
import { DOC_SCHEMA } from '../kernel/document.js';
import { random } from '../kernel/rng.js';
import { defaultsOf } from './catalog.js';
import { vocabIndex } from './select.js';
import { repairDocument } from './repair.js';
import { configureGenerators, furnishWorld } from './world.js';
import { modeOf, isAvatar, STORY } from './modes.js';
import { isList, isObj, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('./modes.js').Mode} Mode */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** @typedef {import('./select.js').Selection} Selection */
/** How a space's zones are written. @typedef {{ exits: boolean, rect: boolean, range?: boolean, bounds: boolean, slot?: boolean, extent: number[] | null, length?: number }} ZoneShape */
/** @typedef {{ to: string, gate?: { item: string } }} Exit */
/** @typedef {{ id: string, name: string, description: string, rect?: number[], range?: number[], bounds?: { min: number[], max: number[] }, exits?: Exit[] }} OutlineZone */
/** @typedef {{ id: string, use: string, with?: Record<string, unknown>, zones: OutlineZone[], generators?: Array<{ use: string }>, _shape?: ZoneShape }} OutlineSpace */
/** @typedef {{ id: string, title?: string, when?: Record<string, unknown>, after?: string[], do: any[] }} OutlineBeat */
/** @typedef {{ id: string, title: string, beats: OutlineBeat[] }} OutlineAct */
/** @typedef {{ use: string, with?: Record<string, any>, space?: string }} SystemInstance */
/** @typedef {{ mode: string, relation: string, why: string, entry: Mode }} SecondaryMode */
/**
 * What the play spec asks the document to be.
 * @typedef {{ mode: Mode | null, secondary: SecondaryMode[], avatar: boolean, narrative: boolean, zones: boolean, systems: string[], added: string[], removed: Array<{ use: string, why: string }> }} Structure
 */

export const PRESETS_VERSION = 'presets/0.2';
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
 * Primitives bound to a core mechanic (and what they require), plus the mode's: never isolated or dropped; their
 * errors go back to the model. Spaces, generators and engine runtime are infrastructure the planner may replace.
 * @param {{ mechanics?: Array<{ importance?: string, primitives?: string[] }>, systems?: string[], mode?: { use?: string, via?: string } | null } | null | undefined} selection
 * @param {RegistryLike | null} [registry] @returns {Set<string>}
 */
export function coreOf(selection, registry = null) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const m of selection?.mechanics || []) if (m.importance === 'core') for (const id of m.primitives || []) if (/^(gameplay|plot)\./.test(id)) ids.add(id);
  for (const id of [selection?.mode?.use, selection?.mode?.via]) if (id) ids.add(id);
  if (registry) for (let grew = true; grew;) { grew = false; for (const id of [...ids]) for (const r of registry.get(id)?.card.requires?.primitives || []) { const s = [...(selection?.systems || [])].find(x => x === r || x.startsWith(r + '.')); if (s && !ids.has(s)) { ids.add(s); grew = true; } } }
  return ids;
}

/** Does a space satisfy a mode.space entry (a space primitive id, or a capability list)? @param {string | string[]} entry @param {{ use: string, caps: string[] }} space */
const spaceFits = (entry, space) => (Array.isArray(entry) ? entry.every(c => space.caps.includes(c)) : entry === space.use);
/** @param {Mode | null | undefined} m */
const needsZones = m => Boolean(m?.needs?.content?.includes('spaces.zones'));

/**
 * The structure a play spec asks for, from the cards: which mode, avatar or not, zones or not, story or not, and the
 * selection adjusted to it (mode primitives in; base locomotion out without an avatar; the story runner out without
 * narrative). @param {Decomposition} decomposition @param {Selection} selection @param {RegistryLike} registry @returns {Structure}
 */
export function structureOf(decomposition, selection, registry) {
  const core = decomposition.core;
  const mode = core ? modeOf(registry, core.mode) : null;
  const avatar = core ? isAvatar(core.interaction) : true;
  const narrative = core ? Boolean(core.narrative) || core.mode === STORY : true;
  /** @type {SecondaryMode[]} */
  const secondary = [];
  for (const s of core?.secondary || []) { const entry = modeOf(registry, s.mode); if (entry) secondary.push({ ...s, entry }); }
  let systems = [...selection.systems];
  /** @type {string[]} */
  const added = [];
  /** @type {Array<{ use: string, why: string }>} */
  const removed = [];
  const add = (/** @type {string | undefined} */ id) => { if (id && registry.has(id) && !systems.includes(id) && !id.startsWith('engine.space.')) { systems.push(id); added.push(id); } };
  if (mode && mode.id !== STORY) { add(mode.use); add(mode.via); }
  for (const s of secondary) if (s.relation !== 'skin' && s.entry.id !== STORY) { add(s.entry.use); add(s.entry.via); }
  const drop = (/** @type {string} */ id, /** @type {string} */ why) => { systems = systems.filter(x => x !== id); removed.push({ use: id, why }); };
  if (!avatar) for (const id of [...systems]) if (registry.get(id)?.card.locomotion === 'base') drop(id, 'no avatar: the player plays a side, not a walking character');
  if (!narrative) for (const id of [...systems]) { const c = registry.get(id)?.card; if (c && c.mode?.loop === STORY) drop(id, 'no narrative: the core loop ends the game, not a story'); }
  const zones = avatar || narrative || needsZones(mode) || secondary.some(s => s.relation !== 'skin' && needsZones(s.entry));
  return { mode: mode && mode.id !== STORY ? mode : null, secondary, avatar, narrative, zones, systems, added, removed };
}

/**
 * Make an instance satisfy a mode's `applies` (the mode exists only when its config matches, e.g. a counter that clears
 * the level). @param {SystemInstance} inst @param {Mode} mode @param {RegistryLike} registry
 */
function apply(inst, mode, registry) {
  const a = mode.applies; if (!a?.param) return;
  const spec = registry.get(inst.use)?.card.params?.[a.param];
  /** @type {Record<string, any>} */
  const w = inst.with ??= {};
  if (spec?.type === 'list') {
    /** @type {any[]} */
    const cur = Array.isArray(w[a.param]) ? w[a.param] : [];
    const field = a.field;
    if (!cur.some(x => (field ? x?.[field] : x) === a.is)) w[a.param] = [...cur, field ? { ...(spec.of?.fields?.id ? { id: mode.id.replace(/[^a-z0-9]+/g, '_') } : {}), [field]: a.is } : a.is];
  } else w[a.param] = a.field ? { ...(w[a.param] || {}), [a.field]: a.is } : a.is;
}

/**
 * Wire a declared win/lose to an ending: an effects param ('onWin', or 'list.field' for the entries of a list param)
 * gets end_game; an `end` boolean param is set; a `when` template is returned for a plot ending.
 * @param {SystemInstance} inst @param {RegistryLike} registry @param {Record<string, any> | undefined} spec @param {string} ending
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
  return { wired: wired || Boolean(when), when };
}

/**
 * Re-apply the play spec's loop wiring to a document (a model draft may have rewritten the params the preset wired):
 * the mode applies, and its win/lose end the game. Idempotent; the input is not modified. -> { doc, wired }
 * @param {any} input @param {Decomposition} decomposition @param {RegistryLike} registry
 */
export function wireCore(input, decomposition, registry) {
  const mode = decomposition.core ? modeOf(registry, decomposition.core.mode) : null;
  if (!mode || mode.id === STORY || !input || !Array.isArray(input.systems)) return { doc: input, wired: false };
  const doc = structuredClone(input);
  const own = doc.systems.find((/** @type {any} */ s) => s?.use === mode.use);
  if (own) apply(own, mode, registry);
  const host = doc.systems.find((/** @type {any} */ s) => s?.use === (mode.via || mode.use)) || own;
  if (!host) return { doc: input, wired: false };
  const win = wire(host, registry, mode.win, 'victory'), lose = wire(host, registry, mode.lose, 'defeat');
  doc.plot = isObj(doc.plot) ? doc.plot : {};
  /** @type {any[]} */
  const endings = Array.isArray(doc.plot.endings) ? doc.plot.endings : [];
  const ensure = (/** @type {string} */ id, /** @type {string} */ outcome, /** @type {Record<string, unknown> | null} */ when) => {
    const e = endings.find(x => x?.id === id);
    if (!e) endings.push({ id, title: id === 'victory' ? 'Victory' : 'Defeat', text: '', outcome, ...(when ? { when } : {}) });
    else if (when && !isObj(e.when)) e.when = when;
  };
  if (win.wired) ensure('victory', 'won', win.when);
  if (lose.wired) ensure('defeat', 'lost', lose.when);
  doc.plot.endings = endings;
  return { doc, wired: win.wired };
}

/**
 * preset({ decomposition, selection, registry, logic, seed, prompt }) -> { doc, ok, errors, fixes, removed, world, structure }
 * @param {{ decomposition: Decomposition, selection: Selection, registry: RegistryLike, logic: LogicLike, seed: number, prompt?: string }} spec
 */
export function preset({ decomposition, selection, registry, logic, seed, prompt = '' }) {
  const st = structureOf(decomposition, selection, registry);
  const state = { rng: seed >>> 0 || 1 };
  const rand = () => random(state);
  const vocab = vocabIndex(registry);
  const hasItems = Boolean(vocab.effects.give_item && vocab.predicates.item);
  const hasStory = st.narrative && st.systems.some(id => (registry.get(id)?.card.reads || []).includes('plot.storyboard'));
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
  // The mode's preferred space leads when the selection's primary space does not fit any of its entries.
  /** @type {Array<{ id: string, use: string, with?: Record<string, unknown>, role?: string, caps: string[] }>} */
  let selSpaces = selection.spaces.map(s => ({ ...s, caps: [...(s.caps || [])] }));
  const prefs = Array.isArray(st.mode?.space) ? st.mode.space : [];
  if (prefs.length && selSpaces[0] && !prefs.some(e => spaceFits(e, selSpaces[0]))) {
    const use = prefs.find(e => typeof e === 'string' && registry.has(e));
    if (typeof use === 'string') selSpaces = [{ id: selSpaces[0].id, use, role: selSpaces[0].role || 'world', caps: capsOf(use) }, ...selSpaces.slice(1).filter(s => s.use !== use)];
  }
  // A nested secondary mode that plays in another space (a battle screen) gets that space.
  /** @type {Array<{ mode: Mode, space: string }>} */
  const nested = [];
  for (const s of st.secondary) {
    if (s.relation !== 'nested') continue;
    const want = (Array.isArray(s.entry.space) ? s.entry.space : []).find(e => typeof e === 'string' && registry.has(e));
    if (typeof want !== 'string' || selSpaces.some(x => x.use === want)) continue;
    const id = slug(`${s.entry.id}_space`);
    selSpaces.push({ id, use: want, role: s.entry.id, caps: capsOf(want) });
    nested.push({ mode: s.entry, space: id });
  }
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
    const generators = selection.generators.filter(g => g.space === s.id).map(g => ({ use: g.id }));
    return { id: s.id, use: s.use, ...(Object.keys(s.with || {}).length ? { with: s.with } : {}), zones, ...(generators.length ? { generators } : {}), _shape: shape };
  });
  const primary = spaces[0];
  /** @type {Array<{ id: string, name: string }>} */
  const items = [];
  /** @type {OutlineAct[]} */
  const acts = [];
  /** @type {Array<{ id: string, name: string, role: string }>} */
  const characters = [];
  const loopWins = Boolean(st.mode?.win && (st.mode.win.param || st.mode.win.end || st.mode.win.when));
  if (hasStory && primary.zones.length) {
    const actCount = Math.max(1, Math.min(decomposition.acts, primary.zones.length - 1));
    const perAct = Math.ceil((primary.zones.length - 1) / actCount);
    const guide = decomposition.references.find(r => r.kind === 'character')?.name || 'Guide';
    characters.push({ id: slug(guide), name: guide, role: 'guide' });
    acts.push({ id: 'act_1', title: 'Arrival', beats: [{ id: 'arrival', title: decomposition.title, do: [{ do: 'say', character: characters[0].id, text: decomposition.premise.slice(0, 220) }] }] });
    primary.zones.slice(1).forEach((z, i) => {
      const a = Math.min(actCount - 1, Math.floor(i / perAct));
      acts[a] ??= { id: `act_${a + 1}`, title: `Act ${a + 1}`, beats: [] };
      /** @type {OutlineBeat} */
      const beat = { id: `reach_${z.id}`, title: z.name, when: { zone: z.id }, do: [{ do: 'say', character: characters[0].id, text: `${z.name}. Keep going.` }] };
      // Key items gate the next act's first exit on spaces with gated exits.
      const lastOfAct = (i + 1) % perAct === 0 && i + 1 < primary.zones.length - 1;
      if (hasItems && primary._shape?.exits && lastOfAct) {
        const key = `${z.id}_key`, next = primary.zones[i + 2];
        items.push({ id: key, name: `${z.name} key` });
        beat.do.push({ do: 'give_item', item: key });
        const exit = z.exits?.find(x => x.to === next.id); if (exit) exit.gate = { item: key };
      }
      acts[a].beats.push(beat);
    });
    for (let a = 0; a < actCount; a++) acts[a] ??= { id: `act_${a + 1}`, title: `Act ${a + 1}`, beats: [] };
    const last = acts[acts.length - 1], finalZone = primary.zones[primary.zones.length - 1];
    // A second space (one primary can't host a chosen primitive) is visited before the end; nested modes have their own entry.
    const tail = spaces.slice(1).filter(x => x.zones.length && !nested.some(n => n.space === x.id));
    for (const extra of tail) {
      last.beats.push({ id: `enter_${extra.id}`, after: last.beats.length ? [last.beats[last.beats.length - 1].id] : undefined, when: { zone: finalZone.id }, do: [{ do: 'teleport', space: extra.id, zone: extra.zones[0].id }] });
      for (const b of last.beats) if (b.after === undefined) delete b.after;
    }
    // The story's own finale only when no loop owns the win.
    if (!loopWins) {
      const endZone = tail.length ? tail[tail.length - 1].zones[0] : finalZone;
      last.beats.push({ id: 'finale', title: 'Finale', after: last.beats.length ? [last.beats[last.beats.length - 1].id] : undefined, ...(tail.length ? {} : { when: { zone: endZone.id } }), do: [{ do: 'end_game', ending: 'victory' }] });
      for (const b of last.beats) if (b.after === undefined) delete b.after;
    }
  }
  const primaryShape = /** @type {ZoneShape} */ (primary._shape);
  for (const s of spaces) delete s._shape;
  /** @type {SystemInstance[]} */
  const systems = st.systems.map(id => ({ use: id, ...(selection.bind[id] ? { space: selection.bind[id] } : {}) }));
  // The mode applies (its config matches), nested modes point at their space, and the core loop's win/lose end the game.
  /** @type {Array<{ id: string, title: string, text: string, outcome: string, when?: Record<string, unknown> }>} */
  const endings = [];
  /** @type {Mode[]} */
  const loops = [...(st.mode ? [st.mode] : []), ...st.secondary.filter(s => s.relation !== 'skin' && s.entry.id !== STORY).map(s => s.entry)];
  for (const m of loops) {
    const own = systems.find(s => s.use === m.use);
    if (own) apply(own, m, registry);
    const n = nested.find(x => x.mode.id === m.id);
    if (own && n) for (const [k, p] of Object.entries(registry.get(m.use)?.card.params || {})) if (p.type === 'ref' && p.to === 'space') { own.with = { ...(own.with || {}), [k]: n.space }; break; }
    if (m !== st.mode) continue; // secondaries never end the game on their own
    const host = systems.find(s => s.use === (m.via || m.use)) || own;
    if (!host) continue;
    const win = wire(host, registry, m.win, 'victory'), lose = wire(host, registry, m.lose, 'defeat');
    if (win.wired) endings.push({ id: 'victory', title: 'Victory', text: `${decomposition.title}: ${decomposition.core?.win || 'won'}.`, outcome: 'won', ...(win.when ? { when: win.when } : {}) });
    if (lose.wired) endings.push({ id: 'defeat', title: 'Defeat', text: `${decomposition.core?.lose || 'lost'}.`, outcome: 'lost', ...(lose.when ? { when: lose.when } : {}) });
    // A `when` ending needs the primitive that evaluates plot.endings.
    if (endings.some(e => e.when)) { const reader = registry.cards().find(c => (c.reads || []).includes('plot.endings') && !c.mode && !(c.requires?.capabilities || []).length); if (reader && !systems.some(s => s.use === reader.id)) systems.push({ use: reader.id }); }
  }
  if (hasStory && !endings.some(e => e.id === 'victory')) endings.push({ id: 'victory', title: 'Victory', text: `${decomposition.title}: the end.`, outcome: 'won' });
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
    graphics: selection.graphics.map(g => ({ use: g.id, ...(g.space ? { space: g.space } : {}) })),
    plot: { premise: decomposition.premise, characters, ...(hasStory ? { storyboard: { acts } } : {}), ...(endings.length ? { endings } : {}) },
    content: { ...(items.length ? { items } : {}), archetypes: [playerArch] },
    player: { archetype: playerArch.id, space: primary.id, ...(at !== null && at !== undefined ? { at } : {}) },
  };
  if (!doc.graphics.length) delete doc.graphics;
  // Generators the selection chose carry no params yet: each one's scaffold configures it from the zones and movement.
  const scaffolded = configureGenerators(doc, registry);
  const fallbackSpace = { id: primary.id, use: primary.use, with: primary.with || {} };
  const repaired = repairDocument(doc, { registry, logic, fallbackSpace, isolate: true, protect: coreOf({ ...selection, systems: st.systems, mode: st.mode }, registry) });
  // A space still empty after repair (no generator selected, or it was isolated) gets one that fits.
  const world = repaired.ok ? furnishWorld(repaired.doc, registry, logic, { seed }) : null;
  const structure = { version: PRESETS_VERSION, mode: st.mode?.id || (decomposition.core ? STORY : null), avatar: st.avatar, narrative: st.narrative, zones: st.zones, added: st.added, removed: st.removed, endings: endings.map(e => e.id), nested: nested.map(n => n.space) };
  const rest = { errors: repaired.errors, fixes: [...scaffolded, ...repaired.fixes, ...(world?.fixes || [])], removed: repaired.removed, world: world && { added: world.added, problems: world.problems }, structure };
  return repaired.ok ? { doc: world?.doc ?? repaired.doc, ok: /** @type {true} */ (true), ...rest } : { doc: /** @type {unknown} */ (repaired.doc), ok: /** @type {false} */ (false), ...rest };
}
