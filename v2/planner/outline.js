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
import { repairDocument, describeErrors } from './repair.js';
import { parseReply } from './writer.js';
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
  const fallbackSpace = { id: primary.id, use: primary.use, with: primary.with || {} };
  const repaired = repairDocument(doc, { registry, logic, fallbackSpace, isolate: true });
  return { doc: repaired.doc, ok: repaired.ok, errors: repaired.errors, fixes: repaired.fixes, removed: repaired.removed };
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
  const kept = sel => new Set([...sel.systems, ...sel.generators.map(g => g.id)]);
  for (let i = 0; i < tries; i++) {
    const o = proceduralOutline({ decomposition, selection: current, registry, logic, seed, prompt });
    const fp = o.ok ? firstPlayable(o.doc, registry, logic, { seed }) : null;
    attempts.push({ spaces: current.spaces.map(s => s.use), options: fp?.options ?? null, ok: Boolean(fp?.ok) });
    if (fp?.ok && fp.options > 0) return { selection: current, attempts, agency: true };
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
export async function writeOutline({ writer = null, prompt, answers = [], decomposition, selection, registry, logic, seed, maxRounds = 2, verify = true, verifyBudgetMs = 1200 }) {
  let skeletonVerify = null, skeletonStatic = null;
  const started = performance.now();
  const skeleton = proceduralOutline({ decomposition, selection, registry, logic, seed, prompt });
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
    const repaired = repairDocument(draft, { registry, logic, fallbackSpace });
    const before = repaired.fixes.length ? repaired.fixes.length : 0;
    if (firstPassOk === null) firstPassOk = repaired.ok && before === 0;
    rounds.push({ kind: round ? 'model_repair' : 'model', ok: repaired.ok, errors: repaired.errors.length, codes: [...new Set(repaired.errors.map(e => e.code))].slice(0, 8), fixes: before, ms: Math.round(performance.now() - t) });
    last = repaired;
    let problems = [];
    if (repaired.ok) {
      // Verification problems (v2/verify: softlocks, unreachable targets, uncompletable plot...) drive the next round too,
      // except those the valid skeleton has as well (limits of the catalogue, not of this draft).
      if (verify && round < maxRounds) {
        // Static plot analysis first (ms): gate cycles, unobtainable items, unreachable endings, quests that never start...
        skeletonStatic ??= await staticPlot(skeleton.doc, logic);
        const draftStatic = await staticPlot(repaired.doc, logic);
        const errs = newErrorCodes(skeletonStatic, draftStatic);
        rounds.at(-1).staticErrors = errs.length;
        // With an error, the warnings beside it usually name the cause (an unobtainable item behind an unreachable ending).
        problems = errs.length ? [...errs, ...newProblems(skeletonStatic, draftStatic).filter(p => p.severity !== 'error')] : [];
      }
      if (verify && round < maxRounds && !problems.length) {
        skeletonVerify ??= await verifyDocument(skeleton.doc, registry, logic, { budgetMs: verifyBudgetMs });
        const v = await verifyDocument(repaired.doc, registry, logic, { budgetMs: verifyBudgetMs });
        problems = newErrorCodes(skeletonVerify, v).filter(p => p.stage !== 'preflight');
        rounds.at(-1).verifyErrors = problems.length;
      }
      if (!problems.length) return { doc: repaired.doc, ok: true, source: model, rounds, firstPassOk, modelMs, removed: repaired.removed, errors: [] };
      last = { ...repaired, verified: repaired.doc };
    }
    user = `${outlineUser({ prompt, answers, decomposition, selection, skeleton: skeleton.doc })}

Your previous document failed ${problems.length ? 'verification' : 'preflight'} with these problems (stable codes; fix each at its path):
${describeErrors(problems.length ? problems : repaired.errors)}
Previous document:
${JSON.stringify(repaired.doc).slice(0, 30000)}
Return the corrected complete document.`;
  }
  // A valid draft that still has verification problems beats the skeleton: keep it, the report shows them.
  if (last?.verified) return { doc: last.verified, ok: true, source: model, rounds, firstPassOk, modelMs, removed: last.removed, errors: [] };
  // The model never produced a valid outline: the skeleton is valid and playable; say so in the report.
  return { doc: skeleton.doc, ok: skeleton.ok, source: 'procedural', fellBack: true, rounds, firstPassOk: firstPassOk ?? false, modelMs, removed: skeleton.removed, errors: last?.errors || [] };
}

export { seedFrom, isSpace };
