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
import { movementFrom } from './decompose.js';
import { cardText, vocabulary, isSpace, defaultsOf, dataShapes } from './catalog.js';
import { vocabIndex, selectPrimitives, baseLocomotion } from './select.js';
import { outlineForm, formPath } from './outline-form.js';
import { populateProblems, placeContent, unreadReaders, contractText } from './content.js';
import { firstPlayable } from './first-playable.js';
import { engageDocument } from './engage.js';
import { repairDocument, describeErrors } from './repair.js';
import { parseReply } from './writer.js';
import { configureGenerators, furnishWorld, worldProblems } from './world.js';
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
      const space = current.spaces[0];
      // The idea's primary view and the avatar's medium decide the kind of movement (td -> top-down, side -> platformer,
      // a walking dungeon -> ground): a mover must support the view; ties go to the medium, then to the fewest requirements.
      // An idea whose avatar does not move (cards, boards, falling pieces) gets no locomotion here.
      const primary = (decomposition.views || []).find(v => v !== 'ui') || null;
      const medium = decomposition.movement || movementFrom(JSON.stringify(decomposition.mechanics || []).toLowerCase());
      const movers = medium === 'none' ? [] : baseLocomotion(registry, { caps: space.caps || [], view: primary, medium, exclude: current.systems })
        .filter(c => registry.get(c.id).envelope || registry.get(c.id).card.envelope).slice(0, 3);
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
    // Never change the game's kind or view: a replacement space must support the idea's primary view.
    const view = (decomposition.views || []).find(v => v !== 'ui');
    const nextViews = registry.get(next.spaces[0].use)?.card.views || [];
    if (view && !nextViews.includes(view) && !nextViews.includes('any')) break;
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

/** Primitives bound to a core mechanic: never isolated or dropped; their errors go back to the model. */
export function coreOf(selection, registry = null) {
  const ids = new Set();
  for (const m of selection?.mechanics || []) if (m.importance === 'core') for (const id of m.primitives || []) if (!isSpace(id)) ids.add(id);
  // A core primitive's requirements are core too (removing melee's health would remove melee).
  if (registry) for (let grew = true; grew;) { grew = false; for (const id of [...ids]) for (const r of registry.get(id)?.card.requires?.primitives || []) { const s = [...(selection.systems || [])].find(x => x === r || x.startsWith(r + '.')); if (s && !ids.has(s)) { ids.add(s); grew = true; } } }
  return ids;
}

export function outlineSystem(registry, logic, selection, form = null) {
  const chosen = new Set([...selection.spaces.map(s => s.use), ...selection.systems, ...selection.generators.map(g => g.id), ...selection.graphics.map(g => g.id), ...(form?.systems || [])]);
  const v = vocabulary(logic);
  return `You write game outlines for a kernel where every game is JSON composed of primitives (document schema ${DOC_SCHEMA}). There are no genre engines: mechanics come only from primitives in the catalogue below, and a primitive with no content is a hollow game.

You fill a FORM (a JSON object matching the given schema exactly). The spaces, views and chosen primitives are fixed by the selection; you write everything that makes this idea a real, full game:
- spaces.<id>.zones: named zones, each different from the others in what is there (terrain, hazards, residents, enemies, treasures). Exits/gates only where the schema has them.
- systems.<primitive id>.with: each chosen primitive's params, tuned to the idea (null = the card's default). Primitives that keep data in their params (racers, waves, crops, stages, shops, bosses, areas...) need that data here.
- archetypes: EVERY kind of entity the game needs (enemies with health and behavior, creatures, pickups, props, vehicles, rivals), each with the components its role needs. An archetype with only a name is hollow.
- spawns: where those entities appear: each zone gets its own mix (count = min..max alive).
- items, characters (with home zones and their dialogue ids), dialogue (node graphs), quests (objectives use the goal kinds), and the plot/content sections the primitives read.
- acts/beats and endings: a completable story through the zones; the last beat ends the game (effect end_game).
JSON-text fields (*_json, and params the card types as json/predicate/effects) hold a JSON value encoded as a string, or null.
Rules:
- Every id is a lowercase slug, unique in its kind; every reference (zone, item, character, archetype, beat, ending, dialogue node) must exist.
- Predicates: objects whose first key names the kind (${v.predicates.join(', ')}); numbers take comparators gte lte gt lt eq ne, e.g. {"item":"key"}, {"zone":"hall"}, {"all":[...]}.
- Effects: {"do": kind, ...} with kind one of ${v.effects.join(', ')}.
- The story must be completable: every beat's trigger reachable, gated exits opened by items or flags the story grants.
- Do not pretend a mechanic exists: mechanics no primitive covers are left out (they are built separately).

Content this game must contain (from the chosen primitives' content contracts; shapes are exact):
${form?.contracts?.length ? contractText(form.contracts) : '(none declared)'}

Chosen primitives (full cards; for plot.storyboard and every other one):
${[...chosen].filter(id => registry.has(id)).map(id => cardText({ id, ...registry.get(id).card }, { full: true })).join('\n')}

Shapes of the document sections these primitives read:
${dataShapes(registry, [...chosen]).join('\n')}

Other primitives (add through extra_systems only if the idea needs one):
${registry.cards().filter(c => !chosen.has(c.id) && !c.id.startsWith('graphics.') && !c.id.startsWith('engine.space.') && !c.id.startsWith('engine.generate.')).map(c => `${c.id}: ${String(c.intent || '').slice(0, 110)}`).join('\n') || '(none)'}

Example documents (excerpts; the form maps onto this shape):
${fewShot(registry, { maxChars: 6000 }).join('\n')}`;
}

/** The scaffold as the model sees it: structure only (zone count and shape, acts, the chosen primitives). */
const scaffoldView = doc => ({ title: doc.title, views: doc.views, spaces: (doc.spaces || []).map(s => ({ id: s.id, use: s.use, zones: (s.zones || []).map(z => ({ id: z.id, ...(z.exits ? { exits: z.exits } : {}) })) })), systems: (doc.systems || []).map(s => s.use), acts: (doc.plot?.storyboard?.acts || []).map(a => ({ id: a.id, beats: (a.beats || []).map(b => b.id) })) });

export function outlineUser({ prompt, answers = [], decomposition, selection, skeleton }) {
  return `Idea: ${prompt}${answers.length ? `\nPreferences: ${answers.map(a => `${a.question}: ${a.answer}`).join('; ')}` : ''}

Decomposition: ${JSON.stringify({ references: decomposition.references, mechanics: decomposition.mechanics.map(m => `${m.importance}: ${m.description}`), spaces: decomposition.spaces, views: decomposition.views, movement: decomposition.movement, tone: decomposition.tone })}
Mechanics → primitives: ${selection.mechanics.map(m => `${m.id} → ${m.primitives.join('+') || 'NONE'}`).join('; ')}
Mechanics no primitive covers (do not fake them): ${selection.gaps.map(g => g.description).join('; ') || 'none'}

A valid skeleton built from those primitives (structure only, placeholder names; it is a scaffold, not the game):
${JSON.stringify(scaffoldView(skeleton))}

Write the outline for THIS idea: an evocative title and premise, ${decomposition.acts} acts of beats, ${decomposition.zones} or more distinct named zones, the archetypes and their spawns zone by zone, characters with roles and lines, items, quests where the primitives run them, params tuned to the idea, and an ending. Fill every content requirement listed in the instructions.`;
}

/** The draft's problems as repair text: stable code, document path, the form path to edit, message and hint. */
function describeProblems(problems, doc, limit = 16) {
  return problems.slice(0, limit).map(p => { const fp = formPath(p.path, doc); return `- [${p.code}] ${p.path}${fp && fp !== p.path ? ` (form: ${fp})` : ''}: ${p.message}${p.hint ? ` (hint: ${String(p.hint).slice(0, 500)})` : ''}`; }).join('\n');
}

const isDocShape = x => x && typeof x === 'object' && (Array.isArray(x.spaces) || x.schema === DOC_SCHEMA);

/**
 * writeOutline({ writer?, prompt, answers, decomposition, selection, registry, logic, seed, maxRounds })
 *   -> { doc, ok, source, rounds: [{ kind, ok, errors, fixes, ms, ... }], firstPassOk, modelMs, removed, content, errors }
 * The model fills the outline form (strict schema from the chosen cards). Each draft is converted, repaired by code,
 * furnished, populated (deterministic placement), engaged, booted and gated by the playtest agent; what is still wrong
 * (preflight errors, crashes, static plot errors, missing content) goes back to the model as targeted problems.
 * The published outline is always the model's draft: when no draft can be made to run, the result is ok:false with the
 * reason (no substitution with the procedural skeleton). Without a writer the procedural outline is the explicit
 * offline mode. Primitives of core mechanics are never isolated.
 */
export async function writeOutline({ writer = null, prompt, answers = [], decomposition, selection, registry, logic, seed, maxRounds = 2, verify = true, verifyBudgetMs = 1200, playtestMs = 1500, protect = null }) {
  const keep = protect || coreOf(selection, registry);
  const gate = async doc => {
    const v = await verifyDocument(doc, registry, logic, { budgetMs: verifyBudgetMs, playtestMs });
    const problems = v.viable ? [] : [{ code: 'not_playable', path: '$', message: v.viability, severity: 'error', hint: 'the game must run without crashing' },
      ...(v.problems || []).filter(p => p.severity === 'error').slice(0, 8)];
    return { viable: Boolean(v.viable), problems, v };
  };
  const started = performance.now();
  const skeleton = proceduralOutline({ decomposition, selection, registry, logic, seed, prompt });
  if (skeleton.ok) skeleton.doc = engageDocument(skeleton.doc, registry, logic).doc;
  const rounds = [{ kind: 'procedural', ok: skeleton.ok, errors: skeleton.errors.length, fixes: skeleton.fixes.length, ms: Math.round(performance.now() - started) }];
  if (!writer) return { doc: skeleton.doc, ok: skeleton.ok, source: 'procedural', rounds, firstPassOk: skeleton.ok, modelMs: 0, removed: skeleton.removed, errors: skeleton.errors };
  const fallbackSpace = { id: skeleton.doc.spaces?.[0]?.id, use: skeleton.doc.spaces?.[0]?.use, with: skeleton.doc.spaces?.[0]?.with || {} };
  const form = outlineForm({ registry, skeleton: skeleton.doc, selection });
  const system = outlineSystem(registry, logic, selection, form);
  const base = outlineUser({ prompt, answers, decomposition, selection, skeleton: skeleton.doc });
  const skeletonPlot = verify ? await staticPlot(skeleton.doc, logic) : { problems: [] };
  let user = base, modelMs = 0, firstPassOk = null, last = null, model = null, best = null, lastProblems = null;
  for (let round = 0; round <= maxRounds; round++) {
    let reply, value;
    const t = performance.now();
    try {
      reply = await writer.complete({ system, user, schema: form.schema });
      modelMs += reply.ms ?? Math.round(performance.now() - t); model = reply.model;
      value = parseReply(reply.text);
    } catch (error) {
      rounds.push({ kind: round ? 'model_repair' : 'model', ok: false, error: String(error.message || error).slice(0, 160), ms: Math.round(performance.now() - t) });
      lastProblems = [{ code: error.code || 'model_failed', path: '$', message: String(error.message || error).slice(0, 200) }];
      if (error.code !== 'model_output_not_json') break;
      user = `${base}\n\nYour previous reply was not one JSON object (${String(error.message || error).slice(0, 120)}). Reply with the form as one JSON object.`;
      continue;
    }
    // A reply in the document's own shape (older prompts, some writers) is a draft as is; otherwise it is the form.
    const draft = isDocShape(value) ? value : form.toDoc(value);
    draft.schema = DOC_SCHEMA; draft.seed = seed;
    keepPlayer(draft, skeleton.doc);
    // Data nobody reads (quests with no quest runner): add the primitive that reads it.
    for (const u of unreadReaders(draft, registry)) if (u.reader && Array.isArray(draft.systems) && !draft.systems.some(s => s?.use === u.reader)) draft.systems.push({ use: u.reader });
    if (draft.spaces && Array.isArray(draft.spaces)) try { configureGenerators(draft, registry); } catch { /* malformed spaces: repair reports them */ }
    const repaired = repairDocument(draft, { registry, logic, fallbackSpace, protect: keep });
    let worldAdded = [], placed = [], staticErrors = [];
    if (repaired.ok) {
      const w = furnishWorld(repaired.doc, registry, logic, { seed });
      if (w.added.length) { repaired.doc = w.doc; worldAdded = w.added.map(a => a.use); }
      // Archetypes the draft defines but never puts in the world are placed zone by zone (deterministic).
      const p = placeContent(repaired.doc, registry); repaired.doc = p.doc; placed = p.added;
      repaired.doc = engageDocument(repaired.doc, registry, logic).doc;
      // Boot it (ms): a primitive that throws is isolated with what pointed at it, unless it is a core mechanic's;
      // then the error (naming the primitive, install or step) goes to the model.
      const fp = firstPlayable(repaired.doc, registry, logic, { seed, furnish: false, protect: keep });
      if (fp.ok && fp.removed.length) { repaired.doc = fp.doc; repaired.removed = [...(repaired.removed || []), ...fp.removed]; }
      else if (!fp.ok) { repaired.ok = false; repaired.errors = fp.errors.length ? fp.errors : fp.problems; }
    }
    const fixes = repaired.fixes.length;
    if (firstPassOk === null) firstPassOk = repaired.ok && fixes === 0;
    const entry = { kind: round ? 'model_repair' : 'model', ok: repaired.ok, errors: repaired.errors.length, codes: [...new Set(repaired.errors.map(e => e.code))].slice(0, 8), fixes, form: !isDocShape(value), ...(worldAdded.length ? { worldAdded } : {}), ...(placed.length ? { placed: placed.length } : {}), ms: Math.round(performance.now() - t) };
    rounds.push(entry);
    last = repaired;
    let problems = [];
    if (repaired.ok) {
      const g = verify ? await gate(repaired.doc) : { viable: true };
      entry.viable = g.viable;
      // Static plot analysis (plotGraph): errors count against the draft; its warnings travel with them as the cause.
      let staticNew = [];
      if (verify) { const sp = await staticPlot(repaired.doc, logic); staticErrors = newErrors(skeletonPlot, sp); staticNew = staticErrors.length ? newProblems(skeletonPlot, sp) : []; }
      entry.staticErrors = staticErrors.length;
      const content = populateProblems(repaired.doc, registry);
      entry.content = content.length;
      if (g.viable) {
        const score = content.length + staticErrors.length * 2;
        if (!best || score < best.score) best = { score, doc: repaired.doc, removed: repaired.removed, verification: g.v, content, round };
        if (!score) break;
      }
      problems = g.viable ? [...staticNew, ...content] : [...g.problems, ...staticNew];
    } else problems = repaired.errors;
    lastProblems = problems;
    if (round === maxRounds) break;
    user = `${base}

Your previous outline failed ${repaired.ok ? (entry.viable === false ? 'verification' : 'the content and plot checks') : 'preflight'} with these problems (stable codes; fix each one in the form):
${describeProblems(problems, repaired.doc)}
Previous outline (your form):
${JSON.stringify(value).slice(0, 30000)}
Return the corrected complete form.`;
  }
  if (best) return { doc: best.doc, ok: true, source: model, rounds, firstPassOk, modelMs, removed: best.removed, errors: [], verification: best.verification, content: best.content, contentComplete: !best.content.length };
  // The model's last draft is often one non-core primitive away from running: isolate it (reported as a gap), but
  // never a core mechanic's primitive, and keep it only if it passes the same gate.
  if (last?.doc) {
    const isolated = repairDocument(last.doc, { registry, logic, fallbackSpace, isolate: true, protect: keep });
    const fp = isolated.ok ? firstPlayable(isolated.doc, registry, logic, { seed, furnish: false, protect: keep }) : null;
    if (fp?.ok) {
      const g = verify ? await gate(isolated.doc) : { viable: true };
      rounds.push({ kind: 'isolate', ok: true, viable: g.viable, removed: isolated.removed.map(r => r.use) });
      if (g.viable) return { doc: isolated.doc, ok: true, source: model, isolated: true, rounds, firstPassOk, modelMs, removed: [...(last.removed || []), ...isolated.removed], errors: [], verification: g.v, content: populateProblems(isolated.doc, registry) };
      lastProblems = g.problems;
    } else rounds.push({ kind: 'isolate', ok: false });
  }
  // No substitution: the procedural skeleton is a scaffold, never the shipped game. Nothing playable came out.
  return { doc: last?.doc || skeleton.doc, ok: false, source: model || 'procedural', rounds, firstPassOk: firstPassOk ?? false, modelMs, removed: last?.removed || [], errors: lastProblems?.length ? lastProblems : (last?.errors || [{ code: 'no_draft', path: '$', message: 'the model returned no usable outline' }]) };
}

/** A draft that drops the player (models do) would publish a world nobody plays: keep the skeleton's, in the draft's first zone. */
function keepPlayer(draft, skeleton) {
  if (draft.player || !skeleton.player || !Array.isArray(draft.spaces) || !draft.spaces.length) return;
  const sp = draft.spaces.find(s => s?.id === skeleton.player.space) || draft.spaces[0], z = (Array.isArray(sp.zones) ? sp.zones : [])[0];
  const at = typeof skeleton.player.at === 'string' ? z?.id ?? skeleton.player.at : (z && zoneStart(z)) || skeleton.player.at;
  draft.player = { ...structuredClone(skeleton.player), space: sp.id, at };
  if (!(draft.content?.archetypes || []).some(a => a?.id === draft.player.archetype)) {
    const arch = (skeleton.content?.archetypes || []).find(a => a.id === draft.player.archetype);
    if (arch && draft.content && typeof draft.content === 'object' && (draft.content.archetypes === undefined || Array.isArray(draft.content.archetypes))) (draft.content.archetypes ??= []).push(structuredClone(arch));
    else if (arch && !draft.content) draft.content = { archetypes: [structuredClone(arch)] };
  }
}

export { seedFrom, isSpace };
