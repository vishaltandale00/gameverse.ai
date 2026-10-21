// Presets (FABLE design, step 4): the deterministic skeleton of a game, composed from the play spec
// (decomposition.core) and what the chosen cards declare, never one default shape for every idea.
//   preset(spec, registry) -> { doc, ok, errors, fixes, removed, world, structure }
// - The mode (card.mode of the loop primitive) is installed; its space comes from mode.space when declared.
// - An avatar exists only for avatar interaction; otherwise the player is a side/controller with no locomotion.
// - Zones exist only when the space is made of places (exits), the avatar travels, or a chosen card needs them
//   (mode.needs.zones, a required list of zone refs such as race checkpoints).
// - A storyboard exists only when the idea has narrative; then today's story shape (plot.storyboard's preset:
//   zones visited in act order, gated progression, a finale) applies.
// - Endings come from the core loop: mode.win / mode.lose params are wired to victory / defeat.
// The model then fills content and tuning through the outline form; code owns this structure.
// A decomposition without a play spec (older callers) gets the story preset, as before.
import { DOC_SCHEMA } from '../kernel/document.js';
import { random } from '../kernel/rng.js';
import { defaultsOf } from './catalog.js';
import { vocabIndex } from './select.js';
import { repairDocument } from './repair.js';
import { configureGenerators, furnishWorld } from './world.js';
import { modeOf, isAvatar, STORY } from './modes.js';

export const PRESETS_VERSION = 'presets/0.1';
const slug = (s, sep = '_') => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join(sep).slice(0, 40);
const STOP = new Set('a an the of in on with and or to for from by as at is are be it its into that this where who you your player game games like style meets world'.split(' '));
const PLACES = ['Gate', 'Hollow', 'Market', 'Spire', 'Vault', 'Ruins', 'Harbor', 'Grove', 'Keep', 'Crossing', 'Depths', 'Summit', 'Archive', 'Yard', 'Sanctum', 'Wilds'];

/**
 * Zone fields a space understands. Cards describe their zone shape in `card.zones` (e.g. "Zone = {id, rect:[x0,y0,x1,y1)...}");
 * without one, capabilities decide (graph-like spaces link zones by exits; positional ones bound them).
 */
export function zoneShape(card, caps, config) {
  const text = typeof card.zones === 'string' ? card.zones : '';
  const extent = [config.size, config.bounds].find(v => Array.isArray(v) && v.length >= 2 && v.every(Number.isFinite)) || null;
  if (text) return { exits: /exits/.test(text), rect: /rect/.test(text), range: /range/.test(text), bounds: /bounds/.test(text), slot: /slot/.test(text), extent, length: config.length || 0 };
  return { exits: caps.includes('navigate') && !caps.includes('overlap'), rect: !caps.includes('navigate') || caps.includes('overlap'), bounds: (card.views || []).some(v => v === '1p' || v === '3p'), extent };
}
/** Lay n zones side by side across the space's extent (or 16-unit cells when it has none). */
export function placeZone(z, i, n, shape) {
  const [W, H] = shape.extent || [16 * n, 16];
  if (shape.rect) { const w = Math.max(1, Math.floor(W / n)); z.rect = [i * w, 0, i === n - 1 ? W : (i + 1) * w, H]; }
  if (shape.range) { const L = shape.length || 40 * n, w = L / n; z.range = [+(i * w).toFixed(2), +((i + 1) * w).toFixed(2)]; }
  if (shape.bounds) z.bounds = { min: [i * 64, 0, 0], max: [i * 64 + 64, 64, 64] };
}
export const zoneStart = z => z.bounds ? [z.bounds.min[0] + 1, z.bounds.min[1] + 1, z.bounds.min[2] + 1] : z.rect ? [z.rect[0] + Math.min(1, (z.rect[2] - z.rect[0]) / 2), z.rect[1] + Math.min(1, (z.rect[3] - z.rect[1]) / 2)] : z.range ? [z.range[0] + 0.5, 0, 0] : null;

/** Primitives bound to a core mechanic (and what they require): never isolated or dropped; their errors go to the model. */
export function coreOf(selection, registry = null) {
  const ids = new Set();
  // Mechanics live in gameplay/plot primitives; spaces, generators and engine runtime are infrastructure the planner may
  // reconfigure or replace (a mis-mapped generator is furnished differently, never a reason to fail the game).
  for (const m of selection?.mechanics || []) if (m.importance === 'core') for (const id of m.primitives || []) if (/^(gameplay|plot)\./.test(id)) ids.add(id);
  if (selection?.mode?.use) ids.add(selection.mode.use);
  if (registry) for (let grew = true; grew;) { grew = false; for (const id of [...ids]) for (const r of registry.get(id)?.card.requires?.primitives || []) { const s = [...(selection.systems || [])].find(x => x === r || x.startsWith(r + '.')); if (s && !ids.has(s)) { ids.add(s); grew = true; } } }
  return ids;
}

/**
 * The structure a play spec asks for, from the cards: which mode, avatar or not, zones or not, story or not, and
 * the selection adjusted to it (mode primitives in; base locomotion out without an avatar; the story runner out
 * without narrative). -> { mode, secondary, avatar, narrative, zones, systems, removed, added }
 */
export function structureOf(decomposition, selection, registry) {
  const core = decomposition.core;
  const mode = core ? modeOf(registry, core.mode) : null;
  const avatar = core ? isAvatar(core.interaction) : true;
  const narrative = core ? Boolean(core.narrative) || core.mode === STORY : true;
  const secondary = (core?.secondary || []).map(s => ({ ...s, entry: modeOf(registry, s.mode) })).filter(s => s.entry);
  let systems = [...selection.systems];
  const added = [], removed = [];
  const add = id => { if (id && registry.has(id) && !systems.includes(id)) { systems.push(id); added.push(id); } };
  add(mode?.use);
  for (const s of secondary) if (s.relation !== 'skin') add(s.entry.use);
  const drop = (id, why) => { systems = systems.filter(x => x !== id); removed.push({ use: id, why }); };
  if (!avatar) for (const id of [...systems]) if (registry.get(id)?.card.locomotion === 'base') drop(id, 'no avatar: the player plays as a side, not a walking character');
  if (!narrative) for (const id of [...systems]) if ((registry.get(id)?.card.reads || []).includes('plot.storyboard') && !(registry.get(id)?.card.mode)) drop(id, 'no narrative: the core loop ends the game, not a story');
  const zoneRef = id => Object.values(registry.get(id)?.card.params || {}).some(p => (p.required || (p.min || 0) > 0) && (p.to === 'zone' || (p.type === 'list' && p.of?.to === 'zone')));
  const zones = avatar || narrative || Boolean(mode?.needs?.zones) || secondary.some(s => s.entry.needs?.zones) || systems.some(zoneRef);
  return { mode, secondary, avatar, narrative, zones, systems, added, removed };
}

/** Wire a loop primitive's declared win/lose param to an ending (effects get end_game, booleans true). */
function wire(inst, card, spec, ending) {
  const param = spec?.param; const schema = param && card.params?.[param];
  if (!schema) return false;
  inst.with ??= {};
  if (schema.type === 'effects') { const cur = Array.isArray(inst.with[param]) ? inst.with[param] : []; if (!cur.some(e => e?.do === 'end_game')) inst.with[param] = [...cur, { do: 'end_game', ending }]; return true; }
  if (schema.type === 'boolean') { inst.with[param] = true; return true; }
  if (schema.type === 'string' || schema.type === 'ref') { inst.with[param] = ending; return true; }
  return false;
}

/**
 * preset({ decomposition, selection, registry, logic, seed, prompt }) -> { doc, ok, errors, fixes, removed, world, structure }
 */
export function preset({ decomposition, selection, registry, logic, seed, prompt = '' }) {
  const st = structureOf(decomposition, selection, registry);
  const state = { rng: seed >>> 0 || 1 };
  const rand = () => random(state);
  const vocab = vocabIndex(registry);
  const hasItems = Boolean(vocab.effects.give_item && vocab.predicates.item);
  const hasStory = st.narrative && st.systems.some(id => (registry.get(id)?.card.reads || []).includes('plot.storyboard'));
  const words = [...new Set((`${decomposition.title} ${decomposition.premise} ${prompt}`.match(/[A-Za-z]{4,}/g) || []).filter(w => !STOP.has(w.toLowerCase())))];
  const cap = w => w[0].toUpperCase() + w.slice(1).toLowerCase();
  const usedNames = new Set();
  const placeName = i => {
    for (let k = 0; k < 8; k++) {
      const n = `${words.length ? cap(words[Math.floor(rand() * words.length)]) + ' ' : ''}${PLACES[Math.floor(rand() * PLACES.length)]}`;
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
    }
    return `Place ${i + 1}`;
  };
  // The mode's declared space (a space primitive id, or {use, with}) leads when the selection did not already pick it.
  let selSpaces = selection.spaces;
  const want = st.mode?.space;
  const wantUse = typeof want === 'string' ? want : want?.use;
  if (wantUse && registry.has(wantUse) && selSpaces[0]?.use !== wantUse) {
    const card = registry.get(wantUse).card, w = typeof want === 'object' ? want.with || {} : {};
    const p = registry.get(wantUse);
    const caps = p.capabilities ? (() => { try { return p.capabilities({ ...defaultsOf(card), ...w }); } catch { return card.provides?.capabilities || []; } })() : card.provides?.capabilities || [];
    selSpaces = [{ id: selSpaces[0]?.id || 'world', use: wantUse, with: w, role: 'board', caps: [...caps] }, ...selSpaces.slice(1).filter(s => s.use !== wantUse)];
  }
  const spaces = selSpaces.map((s, si) => {
    const card = registry.get(s.use)?.card || {};
    const shape = zoneShape(card, s.caps, { ...defaultsOf(card), ...(s.with || {}) });
    // Places are zones: a space made of exits always has them; elsewhere only when the structure needs them.
    const n = shape.exits || st.zones ? (si === 0 ? decomposition.zones : 2) : 0;
    const ids = [];
    const zones = Array.from({ length: n }, (_, i) => {
      const name = placeName(i + si * 10);
      let id = slug(name); while (ids.includes(id)) id += '_b'; ids.push(id);
      const z = { id, name, description: `${name}${decomposition.tone ? `, ${decomposition.tone}` : ''}.` };
      placeZone(z, i, n, shape);
      return z;
    });
    if (shape.exits) zones.forEach((z, i) => {
      z.exits = [];
      if (i > 0) z.exits.push({ to: zones[i - 1].id });
      if (i < zones.length - 1) z.exits.push({ to: zones[i + 1].id });
      if (i > 1 && i % 3 === 0) { z.exits.push({ to: zones[i - 2].id }); zones[i - 2].exits.push({ to: z.id }); }
    });
    const generators = selection.generators.filter(g => g.space === s.id).map(g => ({ use: g.id }));
    return { id: s.id, use: s.use, ...(Object.keys(s.with || {}).length ? { with: s.with } : {}), zones, ...(generators.length ? { generators } : {}), _shape: shape };
  });
  const primary = spaces[0];
  const items = [], acts = [];
  const characters = [];
  if (hasStory && primary.zones.length) {
    const actCount = Math.max(1, Math.min(decomposition.acts, primary.zones.length - 1));
    const perAct = Math.ceil((primary.zones.length - 1) / actCount);
    const guide = decomposition.references.find(r => r.kind === 'character')?.name || 'Guide';
    characters.push({ id: slug(guide), name: guide, role: 'guide' });
    acts.push({ id: 'act_1', title: 'Arrival', beats: [{ id: 'arrival', title: decomposition.title, do: [{ do: 'say', character: characters[0].id, text: decomposition.premise.slice(0, 220) }] }] });
    primary.zones.slice(1).forEach((z, i) => {
      const a = Math.min(actCount - 1, Math.floor(i / perAct));
      acts[a] ??= { id: `act_${a + 1}`, title: `Act ${a + 1}`, beats: [] };
      const beat = { id: `reach_${z.id}`, title: z.name, when: { zone: z.id }, do: [{ do: 'say', character: characters[0].id, text: `${z.name}. Keep going.` }] };
      // Key items gate the next act's first exit on spaces with gated exits.
      const lastOfAct = (i + 1) % perAct === 0 && i + 1 < primary.zones.length - 1;
      if (hasItems && primary._shape.exits && lastOfAct) {
        const key = `${z.id}_key`, next = primary.zones[i + 2];
        items.push({ id: key, name: `${z.name} key` });
        beat.do.push({ do: 'give_item', item: key });
        const exit = z.exits.find(x => x.to === next.id); if (exit) exit.gate = { item: key };
      }
      acts[a].beats.push(beat);
    });
    for (let a = 0; a < actCount; a++) acts[a] ??= { id: `act_${a + 1}`, title: `Act ${a + 1}`, beats: [] };
    const last = acts[acts.length - 1], finalZone = primary.zones.at(-1);
    // A second space (one primary can't host a chosen primitive) is visited before the end.
    for (const extra of spaces.slice(1)) if (extra.zones.length) {
      last.beats.push({ id: `enter_${extra.id}`, after: last.beats.length ? [last.beats.at(-1).id] : undefined, when: { zone: finalZone.id }, do: [{ do: 'teleport', space: extra.id, zone: extra.zones[0].id }] });
      for (const b of last.beats) if (b.after === undefined) delete b.after;
    }
    // The story's own finale only when no loop owns the win (a mode's win ends the game instead).
    if (!st.mode?.win) {
      const endZone = spaces.length > 1 && spaces.at(-1).zones.length ? spaces.at(-1).zones[0] : finalZone;
      last.beats.push({ id: 'finale', title: 'Finale', after: last.beats.length ? [last.beats.at(-1).id] : undefined, ...(spaces.length > 1 ? {} : { when: { zone: endZone.id } }), do: [{ do: 'end_game', ending: 'victory' }] });
      for (const b of last.beats) if (b.after === undefined) delete b.after;
    }
  }
  const primaryShape = primary._shape;
  for (const s of spaces) delete s._shape;
  const systems = st.systems.map(id => ({ use: id, ...(selection.bind[id] ? { space: selection.bind[id] } : {}) }));
  // Endings from the core loop: the mode's win and lose params end the game.
  const endings = [];
  for (const m of [st.mode, ...st.secondary.filter(s => s.relation !== 'skin').map(s => s.entry)].filter(Boolean)) {
    const inst = systems.find(s => s.use === m.use), card = registry.get(m.use)?.card;
    if (!inst || !card) continue;
    if (wire(inst, card, m.win, 'victory') && !endings.some(e => e.id === 'victory')) endings.push({ id: 'victory', title: 'Victory', text: `${decomposition.title}: ${decomposition.core?.win || 'won'}.`, outcome: 'won' });
    if (wire(inst, card, m.lose, 'defeat') && !endings.some(e => e.id === 'defeat')) endings.push({ id: 'defeat', title: 'Defeat', text: `${decomposition.core?.lose || 'lost'}.`, outcome: 'lost' });
    if (m === st.mode) break; // secondaries never end the game on their own
  }
  if (hasStory && !endings.length) endings.push({ id: 'victory', title: 'Victory', text: `${decomposition.title}: the end.`, outcome: 'won' });
  // The player: an avatar entity for avatar interaction; otherwise the side the player commands (no body, no locomotion).
  const playerArch = st.avatar ? { id: 'hero', components: { name: 'You' } } : { id: 'player_side', kind: 'player', components: { name: 'You' } };
  const extent = primaryShape.extent;
  const at = primary.zones.length ? (primaryShape.exits ? primary.zones[0].id : zoneStart(primary.zones[0])) : extent ? extent.map(v => Math.floor(v / 2)) : primaryShape.exits ? undefined : null;
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
  const structure = { version: PRESETS_VERSION, mode: st.mode?.id || (decomposition.core ? STORY : null), avatar: st.avatar, narrative: st.narrative, zones: st.zones, added: st.added, removed: st.removed, endings: endings.map(e => e.id) };
  return { doc: world?.doc ?? repaired.doc, ok: repaired.ok, errors: repaired.errors, fixes: [...scaffolded, ...repaired.fixes, ...(world?.fixes || [])], removed: repaired.removed, world: world && { added: world.added, problems: world.problems }, structure };
}
