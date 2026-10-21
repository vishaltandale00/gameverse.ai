// Layer 1 of ARCHITECTURE.md §4: the outline document. A procedural skeleton is
// built from the decomposition and the primitive selection (zero model calls;
// valid by construction after deterministic repair). With a writer, the model
// rewrites that skeleton into the real outline (premise, characters, act/beat
// skeleton, zone graph, primitive instances and params), and each draft is
// preflighted; errors go to the deterministic repair first and the rest back
// to the model, by stable code, for a bounded number of rounds.
import { readFileSync, readdirSync } from 'node:fs';
import { DOC_SCHEMA } from '../kernel/document.js';
import { random, seedFrom } from '../kernel/rng.js';
import { cardText, vocabulary, isSpace, defaultsOf, dataShapes } from './catalog.js';
import { vocabIndex, selectPrimitives } from './select.js';
import { firstPlayable } from './first-playable.js';
import { engageDocument } from './engage.js';
import { repairDocument, describeErrors } from './repair.js';
import { parseReply } from './writer.js';
import { configureGenerators, furnishWorld, worldProblems } from './world.js';
import { coreLoopProblems } from './core-loop.js';
import { verifyDocument, newErrors, newErrorCodes, newProblems, staticPlot } from './verify-adapter.js';

export const OUTLINE_VERSION = 'outline/0.1';
const slug = (s, sep = '_') => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join(sep).slice(0, 40);
const STOP = new Set('a an the of in on with and or to for from by as at is are be it its into that this where who you your player game games like style meets world'.split(' '));
const PLACES = ['Gate', 'Hollow', 'Market', 'Spire', 'Vault', 'Ruins', 'Harbor', 'Grove', 'Keep', 'Crossing', 'Depths', 'Summit', 'Archive', 'Yard', 'Sanctum', 'Wilds'];

/**
 * Zone fields a space understands. Cards describe their zone shape in `card.zones` (e.g. "Zone = {id, rect:[x0,y0,x1,y1)...}");
 * without one, capabilities decide (graph-like spaces link zones by exits; positional ones bound them).
 */
function zoneShape(card, caps, config) {
  const text = typeof card.zones === 'string' ? card.zones : '';
  const extent = [config.size, config.bounds].find(v => Array.isArray(v) && v.length >= 2 && v.every(Number.isFinite)) || null;
  if (text) return { exits: /exits/.test(text), rect: /rect/.test(text), range: /range/.test(text), bounds: /bounds/.test(text), slot: /slot/.test(text), extent, length: config.length || 0 };
  return { exits: caps.includes('navigate') && !caps.includes('overlap'), rect: !caps.includes('navigate') || caps.includes('overlap'), bounds: (card.views || []).some(v => v === '1p' || v === '3p'), extent };
}
/** Lay n zones side by side across the space's extent (or 16-unit cells when it has none). */
function placeZone(z, i, n, shape) {
  const [W, H] = shape.extent || [16 * n, 16];
  if (shape.rect) { const w = Math.max(1, Math.floor(W / n)); z.rect = [i * w, 0, i === n - 1 ? W : (i + 1) * w, H]; }
  if (shape.range) { const L = shape.length || 40 * n, w = L / n; z.range = [+(i * w).toFixed(2), +((i + 1) * w).toFixed(2)]; }
  if (shape.bounds) z.bounds = { min: [i * 64, 0, 0], max: [i * 64 + 64, 64, 64] };
}

/**
 * The procedural skeleton: spaces from the selection with a zone graph, systems and graphics
 * bound as selected, a storyboard visiting every zone in act order, gated progression with key
 * items when the catalogue offers an item vocabulary and the space supports gated exits, and an ending.
 */
export function proceduralOutline({ decomposition, selection, registry, logic, seed, prompt = '' }) {
  const state = { rng: seed >>> 0 || 1 };
  const rand = () => random(state);
  const vocab = vocabIndex(registry);
  const hasItems = Boolean(vocab.effects.give_item && vocab.predicates.item);
  const hasStory = selection.systems.some(id => (registry.get(id)?.card.reads || []).includes('plot.storyboard'));
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
  const spaces = selection.spaces.map((s, si) => {
    const card = registry.get(s.use)?.card || {};
    const shape = zoneShape(card, s.caps, { ...defaultsOf(card), ...(s.with || {}) });
    const n = si === 0 ? decomposition.zones : 2;
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
  const actCount = Math.max(1, Math.min(decomposition.acts, primary.zones.length - 1));
  const perAct = Math.ceil((primary.zones.length - 1) / actCount);
  const guide = decomposition.references.find(r => r.kind === 'character')?.name || 'Guide';
  const characters = [{ id: slug(guide), name: guide, role: 'guide' }];
  if (hasStory) {
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
    for (const extra of spaces.slice(1)) {
      last.beats.push({ id: `enter_${extra.id}`, after: last.beats.length ? [last.beats.at(-1).id] : undefined, when: { zone: finalZone.id }, do: [{ do: 'teleport', space: extra.id, zone: extra.zones[0].id }] });
      for (const b of last.beats) if (b.after === undefined) delete b.after;
    }
    const endZone = spaces.length > 1 ? spaces.at(-1).zones[0] : finalZone;
    last.beats.push({ id: 'finale', title: 'Finale', after: last.beats.length ? [last.beats.at(-1).id] : undefined, ...(spaces.length > 1 ? {} : { when: { zone: endZone.id } }), do: [{ do: 'end_game', ending: 'victory' }] });
    for (const b of last.beats) if (b.after === undefined) delete b.after;
  }
  const primaryShape = primary._shape;
  for (const s of spaces) delete s._shape;
  const doc = {
    schema: DOC_SCHEMA, id: slug(decomposition.title, '-'), title: decomposition.title, logline: decomposition.premise.split(/(?<=\.)\s/)[0].slice(0, 160), seed,
    views: { primary: decomposition.views[0] || registry.get(primary.use)?.card.views?.[0] || 'any', alternates: decomposition.views.slice(1) },
    spaces,
    systems: selection.systems.map(id => ({ use: id, ...(selection.bind[id] ? { space: selection.bind[id] } : {}) })),
    graphics: selection.graphics.map(g => ({ use: g.id, ...(g.space ? { space: g.space } : {}) })),
    plot: { premise: decomposition.premise, characters, ...(hasStory ? { storyboard: { acts }, endings: [{ id: 'victory', title: 'Victory', text: `${decomposition.title}: the end.`, outcome: 'won' }] } : {}) },
    content: { ...(items.length ? { items } : {}), archetypes: [{ id: 'hero', components: { name: 'You' } }] },
    player: { archetype: 'hero', space: primary.id, at: primaryShape.exits ? primary.zones[0].id : zoneStart(primary.zones[0]) },
  };
  if (!doc.graphics.length) delete doc.graphics;
  // Generators the selection chose carry no params yet: each one's scaffold configures it from the zones and movement.
  const scaffolded = configureGenerators(doc, registry);
  const fallbackSpace = { id: primary.id, use: primary.use, with: primary.with || {} };
  const repaired = repairDocument(doc, { registry, logic, fallbackSpace, isolate: true });
  // A space still empty after repair (no generator selected, or it was isolated) gets one that fits.
  const world = repaired.ok ? furnishWorld(repaired.doc, registry, logic, { seed }) : null;
  return { doc: world?.doc ?? repaired.doc, ok: repaired.ok, errors: repaired.errors, fixes: [...scaffolded, ...repaired.fixes, ...(world?.fixes || [])], removed: repaired.removed, world: world && { added: world.added, problems: world.problems } };
}
const zoneStart = z => z.bounds ? [z.bounds.min[0] + 1, z.bounds.min[1] + 1, z.bounds.min[2] + 1] : z.rect ? [z.rect[0] + Math.min(1, (z.rect[2] - z.rect[0]) / 2), z.rect[1] + Math.min(1, (z.rect[3] - z.rect[1]) / 2)] : z.range ? [z.range[0] + 0.5, 0, 0] : null;

/**
 * Player agency, checked empirically: the skeleton is booted headless and must offer the player
 * at least one option (a way to act that solvers and playtesters can take). A space that offers none
 * with the chosen primitives (e.g. a continuous space and no movement primitive yet) is excluded and
 * the selection re-run, as long as no chosen primitive is lost. If nothing offers agency, the best
 * selection is kept and the lack is reported as a gap. Zero model calls; milliseconds.
 */
export async function ensureAgency({ decomposition, selection, registry, logic, seed, prompt = '', decisions = null, tries = 4 }) {
  const attempts = [];
  let current = selection, excluded = [];
  // Mechanics (systems) must survive a space change; generators build whichever space is chosen, so they may change with it.
  const kept = sel => new Set(sel.systems);
  for (let i = 0; i < tries; i++) {
    const o = proceduralOutline({ decomposition, selection: current, registry, logic, seed, prompt });
    const fp = o.ok ? firstPlayable(engageDocument(o.doc, registry, logic).doc, registry, logic, { seed }) : null;
    attempts.push({ spaces: current.spaces.map(s => s.use), options: fp?.options ?? null, ok: Boolean(fp?.ok) });
    if (fp?.ok && fp.options > 0) return { selection: current, attempts, agency: true };
    // The space may be right and only movement missing: add the movement primitive that fits it best (a card with a
    // movement envelope whose capabilities the space provides and whose views fit), before giving the space up.
    if (o.ok && !(fp?.errors || []).some(e => e.code !== 'no_options')) {
      const space = current.spaces[0], caps = new Set(space.caps || []);
      // The idea's primary view decides the kind of movement (td -> top-down, side -> platformer...): a mover must support
      // it. Ties go to the mover that asks least of the space, never to the one with the biggest jump.
      const primary = (decomposition.views || []).find(v => v !== 'ui') || null;
      // The medium the idea moves through (cards declare medium): ground unless the idea is about flying, swimming or a track.
      const text = JSON.stringify(decomposition.mechanics || []).toLowerCase();
      const wanted = /\b(fly|flying|flight|soar|jetpack)\b/.test(text) ? 'air' : /\b(swim|underwater|dive)\b/.test(text) ? 'water' : /\b(runner|lanes?)\b/.test(text) ? 'track' : 'ground';
      const movers = registry.cards('gameplay').filter(c => c.locomotion === 'base' && (c.envelope || registry.get(c.id).envelope) && !current.systems.includes(c.id) && (c.requires?.capabilities || []).every(x => caps.has(x))
          && (!primary || (c.views || []).includes(primary) || (c.views || []).includes('any')))
        .map(c => ({ id: c.id, score: ((c.views || []).includes(primary) ? 10 : 1) + (c.medium === wanted ? 5 : 0) - (c.requires?.capabilities || []).length * 0.1 }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 3);
      let moved = null;
      for (const m of movers) {
        const sel = { ...current, systems: [...current.systems, m.id].sort((a, b) => (a.startsWith('engine.') ? 0 : a.startsWith('gameplay.') ? 1 : 2) - (b.startsWith('engine.') ? 0 : b.startsWith('gameplay.') ? 1 : 2) || a.localeCompare(b)) };
        const o2 = proceduralOutline({ decomposition, selection: sel, registry, logic, seed, prompt });
        const fp2 = o2.ok ? firstPlayable(o2.doc, registry, logic, { seed }) : null;
        attempts.push({ spaces: sel.spaces.map(s => s.use), added: m.id, options: fp2?.options ?? null, ok: Boolean(fp2?.ok) });
        if (fp2?.ok && fp2.options > 0) { moved = sel; break; }
      }
      if (moved) return { selection: moved, attempts, agency: true };
    }
    excluded = [...excluded, current.spaces[0].use];
    const next = await selectPrimitives({ decomposition, registry, decisions: null, excludeSpaces: excluded });
    if (!next.spaces.length || [...kept(selection)].some(id => !kept(next).has(id))) break;
    current = { ...next, mechanics: selection.mechanics, provider: selection.provider };
  }
  const gap = { mechanic: 'player_agency', description: `move the player between places in ${selection.spaces[0]?.use || 'the world'}`, importance: 'core', kind: 'capability', why: 'no registered primitive gives the player a way to act or travel in a space that the chosen mechanics can use' };
  return { selection: { ...selection, gaps: [...selection.gaps, gap] }, attempts, agency: false };
}

// ---------- few-shot material from v2/games, filtered to what is registered ----------
let library = null;
export function fewShot(registry, { maxChars = 9000 } = {}) {
  library ??= readdirSync(new URL('../games/', import.meta.url)).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(new URL(`../games/${f}`, import.meta.url), 'utf8')));
  const out = [];
  for (const g of library.sort((a, b) => JSON.stringify(a).length - JSON.stringify(b).length)) {
    if (!(g.spaces || []).every(s => registry.has(s.use))) continue;
    const keep = list => (list || []).filter(x => registry.has(x.use));
    const ex = {
      schema: g.schema, id: g.id, title: g.title, logline: g.logline, views: g.views,
      spaces: g.spaces.map(s => ({ ...s, zones: (s.zones || []).slice(0, 4), generators: keep(s.generators) })),
      systems: keep(g.systems).slice(0, 16), graphics: keep(g.graphics).slice(0, 8),
      plot: { premise: g.plot?.premise, characters: (g.plot?.characters || []).slice(0, 3), storyboard: { acts: (g.plot?.storyboard?.acts || []).slice(0, 2).map(a => ({ ...a, beats: (a.beats || []).slice(0, 4) })) }, endings: (g.plot?.endings || []).slice(0, 2) },
      content: Object.fromEntries(Object.entries(g.content || {}).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 3) : v])), player: g.player,
    };
    const text = JSON.stringify(ex);
    if (out.join('').length + text.length > maxChars) continue;
    out.push(text);
  }
  return out;
}

export function outlineSystem(registry, logic, selection) {
  const chosen = new Set([...selection.spaces.map(s => s.use), ...selection.systems, ...selection.generators.map(g => g.id), ...selection.graphics.map(g => g.id)]);
  const v = vocabulary(logic);
  return `You write game documents (schema ${DOC_SCHEMA}) for a kernel where every game is JSON composed of primitives. There are no genre engines: mechanics come only from primitives in the catalogue below.

Document shape:
{ schema, id (lowercase slug), title, logline, seed, views:{primary,alternates},
  spaces:[{ id, use:"engine.space.*", with:{params}, zones:[...], generators:[{use:"engine.generate.*", with}] }],
  systems:[{ use, with, space? }]   // every engine.* (not spaces/generators), plot.* and gameplay.* instance, installed in order
  graphics:[{ use, with, space? }], // graphics.* instances
  plot:{ premise, characters:[{id,name,role,...}], storyboard:{acts:[{id,title,beats:[{id,title?,when?:predicate,after?:[beatId],do?:[effect],optional?:bool}]}]}, endings:[{id,title,text,outcome}], ...sections the chosen primitives read },
  content:{ items:[{id,name}], archetypes:[{id,components:{}}], models:{}, ...sections the chosen primitives read },
  player:{ archetype, space, at } }
Rules:
- Use only primitive ids listed below. Params must match the card's types, ranges and options; omit a param to use its default. Instances of a primitive with "needs capabilities" must sit on (or be bound with "space") a space that provides them.
- Every id is a lowercase slug and unique in its kind; every reference (zone, item, character, archetype, beat, ending, space...) must exist in the document.
- Predicates: objects whose first key names the kind (${v.predicates.join(', ')}); numbers take comparators gte lte gt lt eq ne, e.g. {"item":"key"}, {"zone":"hall"}, {"all":[...]}.
- Effects: {"do": kind, ...} with kind one of ${v.effects.join(', ')}.
- Zones: use the zone shape the space card describes ("zones" on space cards) and the skeleton uses (exits/gate, rect, range or bounds), inside the space's size. Generators that create zones list those zone ids in their own config, so references to them preflight.
- The story must be completable: every beat's trigger reachable, gated exits opened by items or flags the story grants, and a beat that ends the game with an ending.
- Do not pretend a mechanic exists: the request lists mechanics no primitive covers; leave them out of the document (they are built separately).

Chosen primitives (full cards):
${[...chosen].filter(id => registry.has(id)).map(id => cardText({ id, ...registry.get(id).card }, { full: true })).join('\n')}

Shapes of the document sections these primitives read:
${dataShapes(registry, [...chosen]).join('\n')}

Other primitives you may add if the idea needs them:
${registry.cards().filter(c => !chosen.has(c.id)).map(c => cardText(c)).join('\n') || '(none)'}

Example documents (excerpts):
${fewShot(registry).join('\n')}`;
}

export function outlineUser({ prompt, answers = [], decomposition, selection, skeleton }) {
  return `Idea: ${prompt}${answers.length ? `\nPreferences: ${answers.map(a => `${a.question}: ${a.answer}`).join('; ')}` : ''}

Decomposition: ${JSON.stringify({ references: decomposition.references, mechanics: decomposition.mechanics.map(m => `${m.importance}: ${m.description}`), spaces: decomposition.spaces, views: decomposition.views, tone: decomposition.tone })}
Mechanics → primitives: ${selection.mechanics.map(m => `${m.id} → ${m.primitives.join('+') || 'NONE'}`).join('; ')}
Mechanics no primitive covers (do not fake them): ${selection.gaps.map(g => g.description).join('; ') || 'none'}

A valid skeleton built from those primitives (structure only, placeholder names):
${JSON.stringify(skeleton)}

Write the outline document for this idea from the skeleton: an evocative title and premise, ${decomposition.acts} acts of beats, ${decomposition.zones} or more named zones with one-line descriptions, characters with roles, key items, params tuned to the idea, and an ending. Keep the skeleton's spaces/primitives unless the idea needs another listed primitive. Keep it an outline (zone content is detailed later). Reply with the complete document as one JSON object.`;
}

/**
 * writeOutline({ writer?, prompt, answers, decomposition, selection, registry, logic, seed, maxRounds })
 *   -> { doc, ok, source, rounds: [{ kind, ok, errors, fixes, ms }], firstPassOk, modelMs, removed }
 */
export async function writeOutline({ writer = null, prompt, answers = [], decomposition, selection, registry, logic, seed, maxRounds = 2, verify = true, verifyBudgetMs = 1200, playtestMs = 1500 }) {
  let lastProblems = null;
  // The publish gate (verify-adapter viability): what fails it goes back to the model with the agent's reason first.
  const gate = async doc => {
    // The publish gate: the game is the idea (core loop present, its content written, a win wired) and it runs without crashing.
    const core = coreLoopProblems(doc, selection?.mechanics, registry);
    const v = await verifyDocument(doc, registry, logic, { budgetMs: verifyBudgetMs, playtestMs });
    const problems = [...core, ...(v.viable ? [] : [{ code: 'not_playable', path: '$', message: v.viability, severity: 'error', hint: 'the game must run without crashing' },
      ...(v.problems || []).filter(p => p.severity === 'error').slice(0, 8)])];
    return { viable: Boolean(v.viable) && !core.length, problems, v };
  };
  const started = performance.now();
  const skeleton = proceduralOutline({ decomposition, selection, registry, logic, seed, prompt });
  if (skeleton.ok) skeleton.doc = engageDocument(skeleton.doc, registry, logic).doc;
  const rounds = [{ kind: 'procedural', ok: skeleton.ok, errors: skeleton.errors.length, fixes: skeleton.fixes.length, ms: Math.round(performance.now() - started) }];
  if (!writer) return { doc: skeleton.doc, ok: skeleton.ok, source: 'procedural', rounds, firstPassOk: skeleton.ok, modelMs: 0, removed: skeleton.removed, errors: skeleton.errors };
  const fallbackSpace = { id: skeleton.doc.spaces?.[0]?.id, use: skeleton.doc.spaces?.[0]?.use, with: skeleton.doc.spaces?.[0]?.with || {} };
  const system = outlineSystem(registry, logic, selection);
  let user = outlineUser({ prompt, answers, decomposition, selection, skeleton: skeleton.doc });
  let modelMs = 0, firstPassOk = null, last = null, model = null;
  for (let round = 0; round <= maxRounds; round++) {
    let draft;
    const t = performance.now();
    try {
      const reply = await writer.complete({ system, user });
      modelMs += reply.ms ?? Math.round(performance.now() - t); model = reply.model;
      draft = parseReply(reply.text);
    } catch (error) {
      rounds.push({ kind: 'model', ok: false, error: String(error.message || error).slice(0, 160), ms: Math.round(performance.now() - t) });
      if (error.code !== 'model_output_not_json') break;
      continue;
    }
    draft.schema = DOC_SCHEMA; draft.seed = seed;
    // A draft that drops the player (models do) would publish a world nobody plays: keep the skeleton's player,
    // placed at the start of the draft's first zone in its own space.
    if (!draft.player && skeleton.doc.player && Array.isArray(draft.spaces) && draft.spaces.length) {
      const sp = draft.spaces.find(s => s?.id === skeleton.doc.player.space) || draft.spaces[0], z = (Array.isArray(sp.zones) ? sp.zones : [])[0];
      const at = typeof skeleton.doc.player.at === 'string' ? z?.id ?? skeleton.doc.player.at : (z && zoneStart(z)) || skeleton.doc.player.at;
      draft.player = { ...structuredClone(skeleton.doc.player), space: sp.id, at };
      if (!(draft.content?.archetypes || []).some(a => a?.id === draft.player.archetype)) {
        const arch = (skeleton.doc.content?.archetypes || []).find(a => a.id === draft.player.archetype);
        if (arch && draft.content && typeof draft.content === 'object' && (draft.content.archetypes === undefined || Array.isArray(draft.content.archetypes))) (draft.content.archetypes ??= []).push(structuredClone(arch));
        else if (arch && !draft.content) draft.content = { archetypes: [structuredClone(arch)] };
      }
    }
    if (draft.spaces && Array.isArray(draft.spaces)) try { configureGenerators(draft, registry); } catch { /* malformed spaces: repair reports them */ }
    const repaired = repairDocument(draft, { registry, logic, fallbackSpace });
    // The world must not be empty: a draft whose cell space has no generator gets the best-fitting one (deterministic);
    // what no generator can fill goes back to the model as world_empty, unless the skeleton has the same limit.
    let worldLeft = [], worldAdded = [];
    if (repaired.ok) {
      const w = furnishWorld(repaired.doc, registry, logic, { seed });
      if (w.added.length) { repaired.doc = w.doc; worldAdded = w.added.map(a => a.use); }
      if (!skeleton.world?.problems?.length) worldLeft = w.problems;
      // Wire the player and AI participants into the chosen mechanics (card.engage) before booting and playtesting.
      repaired.doc = engageDocument(repaired.doc, registry, logic).doc;
      // Boot it (ms): a primitive that throws on install or on its first steps is isolated with what pointed at it;
      // when isolation cannot save the world, the error (naming the primitive, install or step) goes to the model.
      const fp = firstPlayable(repaired.doc, registry, logic, { seed, furnish: false });
      if (fp.ok && fp.removed.length) { repaired.doc = fp.doc; repaired.removed = [...(repaired.removed || []), ...fp.removed]; }
      else if (!fp.ok) { repaired.ok = false; repaired.errors = fp.errors.length ? fp.errors : fp.problems; }
    }
    const before = repaired.fixes.length ? repaired.fixes.length : 0;
    if (firstPassOk === null) firstPassOk = repaired.ok && before === 0;
    rounds.push({ kind: round ? 'model_repair' : 'model', ok: repaired.ok, errors: repaired.errors.length, codes: [...new Set(repaired.errors.map(e => e.code))].slice(0, 8), fixes: before, ...(worldAdded.length ? { worldAdded } : {}), ms: Math.round(performance.now() - t) });
    last = repaired;
    let problems = [];
    if (repaired.ok) {
      // Every round, the last included, must pass the publish gate: a playtest agent plays it to the end, nothing crashes.
      const g = verify ? await gate(repaired.doc) : { viable: true };
      rounds.at(-1).viable = g.viable;
      if (g.viable) return { doc: repaired.doc, ok: true, source: model, rounds, firstPassOk, modelMs, removed: repaired.removed, errors: [], verification: g.v };
      problems = g.problems;
    }
    lastProblems = problems.length ? problems : repaired.errors;
    user = `${outlineUser({ prompt, answers, decomposition, selection, skeleton: skeleton.doc })}

Your previous document failed ${problems.length ? 'verification' : 'preflight'} with these problems (stable codes; fix each at its path):
${describeErrors(problems.length ? problems : repaired.errors)}
Previous document:
${JSON.stringify(repaired.doc).slice(0, 30000)}
Return the corrected complete document.`;
  }
  // The model's last draft is usually one primitive away from valid: isolate that primitive (reported as a gap),
  // and keep it only if it passes the same gate.
  if (last?.doc) {
    const isolated = repairDocument(last.doc, { registry, logic, fallbackSpace, isolate: true });
    if (isolated.ok && firstPlayable(isolated.doc, registry, logic, { seed, furnish: false }).ok) {
      const g = verify ? await gate(isolated.doc) : { viable: true };
      rounds.push({ kind: 'isolate', ok: true, viable: g.viable, removed: isolated.removed.map(r => r.use) });
      if (g.viable) return { doc: isolated.doc, ok: true, source: model, isolated: true, rounds, firstPassOk, modelMs, removed: [...(last.removed || []), ...isolated.removed], errors: [], verification: g.v };
      lastProblems = g.problems;
    }
  }
  // The skeleton is published only if it passes the gate too; otherwise nothing playable came out of this idea.
  if (skeleton.ok) {
    const g = verify ? await gate(skeleton.doc) : { viable: true };
    rounds.push({ kind: 'procedural_fallback', viable: g.viable });
    if (g.viable) return { doc: skeleton.doc, ok: true, source: 'procedural', fellBack: true, rounds, firstPassOk: firstPassOk ?? false, modelMs, removed: skeleton.removed, errors: [], verification: g.v };
  }
  return { doc: last?.doc || skeleton.doc, ok: false, source: model || 'procedural', rounds, firstPassOk: firstPassOk ?? false, modelMs, removed: last?.removed || skeleton.removed, errors: lastProblems?.length ? lastProblems : (last?.errors || skeleton.errors) };
}

export { seedFrom, isSpace };
