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
import { createWorld } from '../kernel/world.js';

export const CENSUS_VERSION = 'census/0.1';
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
// Components that only label an entity; an archetype made only of these is hollow.
export const LABEL_COMPONENTS = new Set(['name', 'model', 'label', 'title', 'description', 'desc', 'sprite', 'color', 'faction', 'tags', 'kind']);
export const realComponents = a => Object.keys(isObj(a?.components) ? a.components : {}).filter(k => !LABEL_COMPONENTS.has(k));

/** Every string value in a value tree, with the path it sits at. */
function strings(value, path, out) {
  if (typeof value === 'string') out.push([value, path]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) strings(v, path ? `${path}.${k}` : k, out);
  return out;
}

/** archetype id -> paths that name it (outside its own definition and the player's archetype pointer). */
export function placements(doc) {
  const ids = new Set((doc.content?.archetypes || []).map(a => a?.id).filter(Boolean));
  const out = new Map([...ids].map(id => [id, []]));
  const scan = { ...doc, content: { ...(doc.content || {}), archetypes: undefined }, player: undefined };
  for (const [v, path] of strings(scan, '', [])) if (out.has(v)) out.get(v).push(path);
  // An archetype another archetype drops, splits into or summons counts as placed through it.
  (doc.content?.archetypes || []).forEach((a, i) => { for (const [v, path] of strings(a?.components, `content.archetypes[${i}].components`, [])) if (out.has(v) && v !== a.id) out.get(v).push(path); });
  return out;
}

/** Instances (systems, spaces, generators) whose card defines spawn rules in a list param, and their rules. */
export function spawnRules(doc, registry) {
  const rules = [];
  const visit = (inst, path) => {
    const card = registry.get(inst?.use)?.card; if (!card) return;
    for (const d of card.defines || []) if (d.kind === 'spawn_rule' && d.in && Array.isArray(inst.with?.[d.in])) inst.with[d.in].forEach((r, i) => rules.push({ ...r, _path: `${path}.with.${d.in}[${i}]`, _use: inst.use }));
  };
  (doc.systems || []).forEach((s, i) => visit(s, `systems[${i}]`));
  (doc.spaces || []).forEach((s, i) => (s.generators || []).forEach((g, j) => visit(g, `spaces[${i}].generators[${j}]`)));
  return rules;
}

/** `{do:'spawn'}` effects anywhere in the document. */
export function spawnEffects(doc) {
  const out = [];
  const walk = (v, path) => { if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`)); else if (isObj(v)) { if (v.do === 'spawn' && typeof v.archetype === 'string') out.push({ ...v, _path: path }); for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`); } };
  walk(doc, '');
  return out;
}

/** Sections of doc.plot / doc.content with data, and the installed primitives reading each. */
export function sections(doc, registry) {
  const installed = [...(doc.spaces || []).flatMap(s => [s.use, ...(s.generators || []).map(g => g.use)]), ...(doc.systems || []).map(s => s.use), ...(doc.graphics || []).map(g => g.use)];
  const reads = new Map();
  for (const id of installed) for (const r of registry.get(id)?.card.reads || []) if (typeof r === 'string') (reads.get(r) || reads.set(r, new Set()).get(r)).add(id);
  const size = v => Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : v ? 1 : 0;
  const out = {};
  for (const [root, obj] of [['plot', doc.plot], ['content', doc.content]]) for (const [k, v] of Object.entries(isObj(obj) ? obj : {})) {
    if (k === 'premise') continue;
    const key = `${root}.${k}`, n = size(v); if (!n) continue;
    out[key] = { count: n, readBy: [...(reads.get(key) || [])] };
  }
  return out;
}

const words = s => new Set((String(s || '').toLowerCase().match(/[a-z]{4,}/g) || []));
const jaccard = (a, b) => { if (!a.size && !b.size) return 1; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };

/** Per-zone content signature: archetypes placed there, residents, built features. */
export function zoneSignatures(doc, registry) {
  const sig = new Map();
  const zones = (doc.spaces || []).flatMap(s => (s.zones || []).map(z => ({ space: s.id, ...z })));
  for (const z of zones) sig.set(z.id, new Set());
  const add = (zone, tag) => { if (sig.has(zone)) sig.get(zone).add(tag); };
  for (const r of spawnRules(doc, registry)) if (r.zone) add(r.zone, `spawn:${r.archetype}`);
  for (const e of spawnEffects(doc)) if (e.zone) add(e.zone, `spawn:${e.archetype}`);
  for (const c of doc.plot?.characters || []) if (c?.home) add(c.home, `char:${c.id}`);
  for (const q of doc.plot?.quests || []) if (q?.zone) add(q.zone, `quest:${q.id}`);
  // Generator configs that name a zone (rooms, structures, districts...): what they put there.
  for (const s of doc.spaces || []) for (const g of s.generators || []) for (const [param, v] of Object.entries(g.with || {})) {
    if (!Array.isArray(v)) continue;
    for (const entry of v) if (isObj(entry) && typeof entry.zone === 'string') {
      const bits = ['style', 'kind', 'theme', 'biome'].map(k => entry[k]).filter(x => typeof x === 'string');
      const feats = Array.isArray(entry.features) ? entry.features.map(f => f?.kind || f).filter(x => typeof x === 'string') : [];
      const hazards = Array.isArray(entry.hazards) ? entry.hazards.filter(x => typeof x === 'string') : [];
      for (const b of [...bits, ...feats.map(f => `feature:${f}`), ...hazards.map(h => `hazard:${h}`)]) add(entry.zone, `${param}:${b}`);
      if (Array.isArray(entry.spawns)) for (const a of entry.spawns) add(entry.zone, `spawn:${a}`);
    }
  }
  return { zones, sig };
}

/**
 * census(doc, registry, logic?, { boot }) -> counts plus lists (see the header).
 * boot: create the world and step it (default 30 frames) to count entities that really exist.
 */
export function census(doc, registry, logic = null, { boot = 30 } = {}) {
  const playerArch = doc.player?.archetype;
  const archetypes = (doc.content?.archetypes || []).filter(a => a?.id && a.id !== playerArch);
  const placed = placements(doc);
  const real = archetypes.filter(a => realComponents(a).length);
  const rules = spawnRules(doc, registry), effects = spawnEffects(doc);
  const secs = sections(doc, registry);
  const characters = doc.plot?.characters || [];
  const dialogueIds = new Set(Object.keys(isObj(doc.plot?.dialogue) ? doc.plot.dialogue : {}));
  const { zones, sig } = zoneSignatures(doc, registry);
  const signatures = zones.map(z => [...sig.get(z.id)].sort().join('|'));
  const nonEmpty = signatures.filter(Boolean);
  const descs = zones.map(z => words(`${z.name} ${z.description || ''}`));
  let similarPairs = 0, pairs = 0;
  for (let i = 0; i < descs.length; i++) for (let j = i + 1; j < descs.length; j++) { pairs++; if (jaccard(descs[i], descs[j]) >= 0.5) similarPairs++; }
  const read = key => (secs[key]?.readBy.length ? secs[key].count : 0);
  const out = {
    version: CENSUS_VERSION,
    archetypes: archetypes.length,
    archetypesReal: real.length,
    archetypesPlaced: real.filter(a => placed.get(a.id)?.length).length,
    hollowArchetypes: archetypes.filter(a => !realComponents(a).length).map(a => a.id),
    componentKinds: [...new Set(real.flatMap(realComponents))].sort(),
    spawnRules: rules.length,
    spawnRulesNonPlayer: rules.filter(r => !String(r.id || '').startsWith('player_')).length,
    spawnEffects: effects.length,
    items: (doc.content?.items || []).length,
    characters: characters.length,
    charactersWithDialogue: characters.filter(c => (Array.isArray(c?.dialogue) ? c.dialogue : c?.dialogue ? [c.dialogue] : []).some(d => dialogueIds.has(typeof d === 'string' ? d : d?.id))).length,
    quests: (doc.plot?.quests || []).length,
    questsRead: read('plot.quests'),
    dialogue: dialogueIds.size,
    dialogueRead: read('plot.dialogue'),
    unreadSections: Object.entries(secs).filter(([, v]) => !v.readBy.length).map(([k]) => k),
    zones: zones.length,
    zonesWithContent: nonEmpty.length,
    zonesDistinct: new Set(nonEmpty).size,
    zoneSimilarDescriptionPairs: pairs ? +(similarPairs / pairs).toFixed(2) : null,
    systems: (doc.systems || []).length,
    gameplaySystems: (doc.systems || []).filter(s => String(s.use).startsWith('gameplay.')).length,
    runtime: null,
  };
  if (boot && logic) {
    try {
      const rt = createWorld(doc, registry, logic, { seed: doc.seed });
      for (let i = 0; i < boot && rt.state.status === 'playing'; i++) rt.step();
      const ents = Object.values(rt.state.entities).filter(e => e.id !== 'player');
      const byKind = {};
      for (const e of ents) { const k = archetypes.find(a => a.id === e.archetype)?.kind || 'other'; byKind[k] = (byKind[k] || 0) + 1; }
      out.runtime = { frames: rt.state.frame, entities: ents.length, byKind, status: rt.state.status };
    } catch (error) { out.runtime = { error: String(error?.message || error).slice(0, 160) }; }
  }
  return out;
}

/** The idea's primary view: the first decomposed view that is not a pure UI overlay. */
export const primaryView = decomposition => (decomposition?.views || []).find(v => v !== 'ui') || (decomposition?.views || [])[0] || null;

/**
 * Whether a document is still the kind of game the decomposition asked for (the genre and view survive
 * every stage): its primary view, its primary space and every base locomotion primitive must support
 * the idea's primary view. -> { ok, view, docView, space, movement: [ids], problems: [text] }
 */
export function kindViewPreserved(decomposition, doc, registry) {
  const want = primaryView(decomposition), problems = [];
  const supports = id => { const v = registry.get(id)?.card.views || []; return !want || v.includes(want) || v.includes('any'); };
  const space = doc.spaces?.[0]?.use || null;
  const movement = (doc.systems || []).map(s => s.use).filter(id => registry.get(id)?.card.locomotion === 'base');
  if (want && doc.views?.primary !== want) problems.push(`view ${doc.views?.primary ?? 'none'} instead of ${want}`);
  if (space && !supports(space)) problems.push(`space ${space} has no ${want} view`);
  for (const id of movement) if (!supports(id)) problems.push(`movement ${id} has no ${want} view`);
  return { ok: !problems.length, view: want, docView: doc.views?.primary ?? null, space, movement, problems };
}
