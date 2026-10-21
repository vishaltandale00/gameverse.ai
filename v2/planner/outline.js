// @ts-check
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
import { preset, coreOf, zoneStart, wireCore } from './presets.js';
import { populateProblems, placeContent, unreadReaders, contractText } from './content.js';
import { firstPlayable } from './first-playable.js';
import { engageDocument } from './engage.js';
import { repairDocument, describeErrors } from './repair.js';
import { parseReply } from './writer.js';
import { configureGenerators, furnishWorld, worldProblems } from './world.js';
import { coreLoopProblems } from './core-loop.js';
import { verifyDocument, newErrors, newErrorCodes, newProblems, staticPlot } from './verify-adapter.js';
import { isObj, isList, obj, list, objects, str, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').Effect} Effect */
/** @typedef {import('../kernel/types.js').Instance} Instance */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('../kernel/types.js').RegisteredPrimitive} RegisteredPrimitive */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./verify-adapter.js').Verification} Verification */
/** @typedef {import('./verify-adapter.js').VerifyProblem} VerifyProblem */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** @typedef {import('./select.js').Selection} Selection */
/** How a space's zones are written. @typedef {{ exits: boolean, rect: boolean, range?: boolean, bounds: boolean, slot?: boolean, extent: number[] | null, length?: number }} ZoneShape */
/** @typedef {{ to: string, gate?: { item: string } }} Exit */
/** A skeleton zone. @typedef {{ id: string, name: string, description: string, rect?: number[], range?: number[], bounds?: { min: number[], max: number[] }, exits?: Exit[] }} OutlineZone */
/** A skeleton space (`_shape` is dropped before the document is built). @typedef {{ id: string, use: string, with?: Record<string, unknown>, zones: OutlineZone[], generators?: Array<{ use: string }>, _shape?: ZoneShape }} OutlineSpace */
/** @typedef {{ id: string, title?: string, when?: Record<string, unknown>, after?: string[], do: Effect[] }} OutlineBeat */
/** @typedef {{ id: string, title: string, beats: OutlineBeat[] }} OutlineAct */
/**
 * One entry of writeOutline's round log.
 * @typedef {{ kind: string, ok?: boolean, errors?: number, error?: string, codes?: string[], fixes?: number, form?: boolean, worldAdded?: string[], placed?: number,
 *   viable?: boolean, staticErrors?: number, content?: number, completed?: boolean | null, removed?: unknown[], ms?: number }} OutlineRound
 */
/** A problem as repair feedback reads it (preflight, boot, verification, content). @typedef {{ code: string, path?: string, message: string, hint?: unknown }} ProblemLike */
/** @typedef {import('./content.js').ContentProblem} ContentProblem */
/** @typedef {import('./content.js').MergedContract} MergedContract */
/** @typedef {import('./content.js').Placement} Placement */
/** The publish gate's verdict (verify off: viable). @typedef {{ viable: boolean, problems?: VerifyProblem[], v?: Verification }} Gate */
/** @typedef {import('./repair.js').Fix} Fix */
/** @typedef {import('./repair.js').Removed} Removed */
/** @typedef {import('./first-playable.js').Removal} Removal */
/** @typedef {import('./first-playable.js').PlayableProblem} PlayableProblem */
/** @typedef {import('./world.js').WorldFix} WorldFix */
/** @typedef {import('./world.js').WorldProblem} WorldProblem */
/**
 * proceduralOutline's result: `doc` is a Doc exactly when `ok` (else the repaired draft).
 * @typedef {{ errors: import('../kernel/types.js').Problem[], fixes: Array<Fix | WorldFix>, removed: Removed[],
 *   world: { added: Array<{ space: unknown, use: string, problems: string[] }>, problems: WorldProblem[] } | null } & ({ ok: true, doc: Doc } | { ok: false, doc: unknown })} ProceduralOutline
 */
/**
 * One model round's repaired draft. `ok` means `doc` passed repair, boot and isolation (it is then a Doc).
 * @typedef {{ ok: boolean, doc: unknown, errors: Array<import('../kernel/types.js').Problem | PlayableProblem>, fixes: Fix[], removed: Array<Removed | Removal> }} DraftRepair
 */
/**
 * writeOutline's result: `doc` is a Doc exactly when `ok`.
 * @typedef {{ source: string | null, rounds: OutlineRound[], firstPassOk: boolean | null, modelMs: number, removed: Array<Removed | Removal>, errors: ProblemLike[],
 *   verification?: Verification, isolated?: boolean, fellBack?: boolean, content?: ContentProblem[], contentComplete?: boolean } & ({ ok: true, doc: Doc } | { ok: false, doc: unknown })} OutlineResult
 */

export const OUTLINE_VERSION = 'outline/0.1';
/** @param {unknown} s @param {string} [sep] @returns {string} */
const slug = (s, sep = '_') => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join(sep).slice(0, 40);
const STOP = new Set('a an the of in on with and or to for from by as at is are be it its into that this where who you your player game games like style meets world'.split(' '));
const PLACES = ['Gate', 'Hollow', 'Market', 'Spire', 'Vault', 'Ruins', 'Harbor', 'Grove', 'Keep', 'Crossing', 'Depths', 'Summit', 'Archive', 'Yard', 'Sanctum', 'Wilds'];

/**
 * The procedural skeleton: the preset the play spec and the chosen cards compose (presets.js). Without a play spec
 * it is the story preset (zones visited in act order, gated progression, a finale), as before.
 */
/** @param {{ decomposition: Decomposition, selection: Selection, registry: RegistryLike, logic: LogicLike, seed: number, prompt?: string }} spec @returns {ProceduralOutline} */
export function proceduralOutline(spec) { return /** @type {ProceduralOutline} */ (/** @type {unknown} */ (preset(spec))); }

/**
 * Player agency, checked empirically: the skeleton is booted headless and must offer the player
 * at least one option (a way to act that solvers and playtesters can take). A space that offers none
 * with the chosen primitives (e.g. a continuous space and no movement primitive yet) is excluded and
 * the selection re-run, as long as no chosen primitive is lost. If nothing offers agency, the best
 * selection is kept and the lack is reported as a gap. Zero model calls; milliseconds.
 * @param {{ decomposition: Decomposition, selection: Selection, registry: RegistryLike, logic: LogicLike, seed: number, prompt?: string, decisions?: unknown, tries?: number }} args
 */
export async function ensureAgency({ decomposition, selection, registry, logic, seed, prompt = '', decisions = null, tries = 4 }) {
  /** @type {Array<{ spaces: string[], added?: string, options: number | null, ok: boolean }>} */
  const attempts = [];
  let current = selection;
  /** @type {string[]} */
  let excluded = [];
  // Mechanics (systems) must survive a space change; generators build whichever space is chosen, so they may change with it.
  const kept = (/** @type {{ systems: string[] }} */ sel) => new Set(sel.systems);
  for (let i = 0; i < tries; i++) {
    const o = proceduralOutline({ decomposition, selection: current, registry, logic, seed, prompt });
    const fp = o.ok ? firstPlayable(engageDocument(o.doc, registry, logic).doc, registry, logic, { seed }) : null;
    attempts.push({ spaces: current.spaces.map(s => s.use), options: fp?.options ?? null, ok: Boolean(fp?.ok) });
    if (fp?.ok && (fp.options ?? 0) > 0) return { selection: current, attempts, agency: true };
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
        .filter(c => registry.get(c.id)?.envelope || registry.get(c.id)?.card.envelope).slice(0, 3);
      let moved = null;
      for (const m of movers) {
        /** @type {Selection} */
        const sel = { ...current, systems: [...current.systems, m.id].sort((a, b) => (a.startsWith('engine.') ? 0 : a.startsWith('gameplay.') ? 1 : 2) - (b.startsWith('engine.') ? 0 : b.startsWith('gameplay.') ? 1 : 2) || a.localeCompare(b)) };
        const o2 = proceduralOutline({ decomposition, selection: sel, registry, logic, seed, prompt });
        const fp2 = o2.ok ? firstPlayable(o2.doc, registry, logic, { seed }) : null;
        attempts.push({ spaces: sel.spaces.map(s => s.use), added: m.id, options: fp2?.options ?? null, ok: Boolean(fp2?.ok) });
        if (fp2?.ok && (fp2.options ?? 0) > 0) { moved = sel; break; }
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
/** Example game files (JSON read from v2/games: unchecked). @type {Record<string, unknown>[] | null} */
let library = null;
/** @param {RegistryLike} registry @param {{ maxChars?: number }} [options] @returns {string[]} */
export function fewShot(registry, { maxChars = 9000 } = {}) {
  library ??= readdirSync(new URL('../games/', import.meta.url)).filter(f => f.endsWith('.json')).map(f => obj(JSON.parse(readFileSync(new URL(`../games/${f}`, import.meta.url), 'utf8'))));
  /** @type {string[]} */
  const out = [];
  for (const g of library.sort((a, b) => JSON.stringify(a).length - JSON.stringify(b).length)) {
    if (!list(g.spaces).every(s => registry.has(str(prop(s, 'use'))))) continue;
    const keep = (/** @type {unknown} */ items) => objects(items).filter(x => registry.has(str(x.use)));
    const plot = obj(g.plot);
    const ex = {
      schema: g.schema, id: g.id, title: g.title, logline: g.logline, views: g.views,
      spaces: objects(g.spaces).map(s => ({ ...s, zones: list(s.zones).slice(0, 4), generators: keep(s.generators) })),
      systems: keep(g.systems).slice(0, 16), graphics: keep(g.graphics).slice(0, 8),
      plot: { premise: plot.premise, characters: list(plot.characters).slice(0, 3), storyboard: { acts: objects(prop(plot.storyboard, 'acts')).slice(0, 2).map(a => ({ ...a, beats: list(a.beats).slice(0, 4) })) }, endings: list(plot.endings).slice(0, 2) },
      content: Object.fromEntries(Object.entries(obj(g.content)).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 3) : v])), player: g.player,
    };
    const text = JSON.stringify(ex);
    if (out.join('').length + text.length > maxChars) continue;
    out.push(text);
  }
  return out;
}

/**
 * @param {RegistryLike} registry @param {LogicLike} logic @param {Selection} selection
 * @param {{ systems?: string[], contracts?: MergedContract[] } | null} [form] the outline form (outline-form.js) @returns {string}
 */
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
${[...chosen].filter(id => registry.has(id)).map(id => cardText({ id, .../** @type {RegisteredPrimitive} */ (registry.get(id)).card }, { full: true })).join('\n')}

Shapes of the document sections these primitives read:
${dataShapes(registry, [...chosen]).join('\n')}

Other primitives (add through extra_systems only if the idea needs one):
${registry.cards().filter(c => !chosen.has(c.id) && !c.id.startsWith('graphics.') && !c.id.startsWith('engine.space.') && !c.id.startsWith('engine.generate.')).map(c => `${c.id}: ${String(c.intent || '').slice(0, 110)}`).join('\n') || '(none)'}

Example documents (excerpts; the form maps onto this shape):
${fewShot(registry, { maxChars: 6000 }).join('\n')}`;
}

/** The scaffold as the model sees it: structure only (zone count and shape, acts, the chosen primitives). @param {Doc} doc */
const scaffoldView = doc => ({ title: doc.title, views: doc.views, spaces: (doc.spaces || []).map(s => ({ id: s.id, use: s.use, zones: (s.zones || []).map(z => ({ id: z.id, ...(z.exits ? { exits: z.exits } : {}) })) })), systems: (doc.systems || []).map(s => s.use), acts: (doc.plot?.storyboard?.acts || []).map(a => ({ id: a.id, beats: (a.beats || []).map(b => b.id) })) });

/**
 * @param {{ prompt: string, answers?: Array<{ question?: unknown, answer?: unknown }>, decomposition: Decomposition, selection: Selection, skeleton: Doc }} args
 * @returns {string}
 */
export function outlineUser({ prompt, answers = [], decomposition, selection, skeleton }) {
  return `Idea: ${prompt}${answers.length ? `\nPreferences: ${answers.map(a => `${a.question}: ${a.answer}`).join('; ')}` : ''}

Decomposition: ${JSON.stringify({ references: decomposition.references, mechanics: decomposition.mechanics.map(m => `${m.importance}: ${m.description}`), spaces: decomposition.spaces, views: decomposition.views, movement: decomposition.movement, tone: decomposition.tone })}
Mechanics → primitives: ${selection.mechanics.map(m => `${m.id} → ${m.primitives.join('+') || 'NONE'}`).join('; ')}
Mechanics no primitive covers (do not fake them): ${selection.gaps.map(g => g.description).join('; ') || 'none'}

A valid skeleton built from those primitives (structure only, placeholder names; it is a scaffold, not the game):
${JSON.stringify(scaffoldView(skeleton))}

Write the outline for THIS idea: an evocative title and premise, ${decomposition.acts} acts of beats, ${decomposition.zones} or more distinct named zones, the archetypes and their spawns zone by zone, characters with roles and lines, items, quests where the primitives run them, params tuned to the idea, and an ending. Fill every content requirement listed in the instructions.`;
}

/**
 * The draft's problems as repair text: stable code, document path, the form path to edit, message and hint.
 * @param {ProblemLike[]} problems @param {unknown} doc @param {number} [limit]
 */
function describeProblems(problems, doc, limit = 16) {
  return problems.slice(0, limit).map(p => { const fp = formPath(p.path, doc); return `- [${p.code}] ${p.path}${fp && fp !== p.path ? ` (form: ${fp})` : ''}: ${p.message}${p.hint ? ` (hint: ${String(p.hint).slice(0, 500)})` : ''}`; }).join('\n');
}

/** A reply in the document's own shape (rather than the form's). @param {unknown} x @returns {x is Record<string, unknown>} */
const isDocShape = x => isObj(x) && (Array.isArray(x.spaces) || x.schema === DOC_SCHEMA);

/**
 * writeOutline({ writer?, prompt, answers, decomposition, selection, registry, logic, seed, maxRounds })
 *   -> { doc, ok, source, rounds: [{ kind, ok, errors, fixes, ms, ... }], firstPassOk, modelMs, removed, content, errors }
 * The model fills the outline form (strict schema from the chosen cards). Each draft is converted, repaired by code,
 * furnished, populated (deterministic placement), engaged, booted and gated by the playtest agent; what is still wrong
 * (preflight errors, crashes, static plot errors, missing content) goes back to the model as targeted problems.
 * The published outline is always the model's draft: when no draft can be made to run, the result is ok:false with the
 * reason (no substitution with the procedural skeleton). Without a writer the procedural outline is the explicit
 * offline mode. Primitives of core mechanics are never isolated.
 * @param {{ writer?: Writer | null, prompt: string, answers?: Array<{ question?: unknown, answer?: unknown }>, decomposition: Decomposition, selection: Selection,
 *   registry: RegistryLike, logic: LogicLike, seed: number, maxRounds?: number, verify?: boolean, verifyBudgetMs?: number, playtestMs?: number,
 *   protect?: Set<string> | null }} args
 * @returns {Promise<OutlineResult>}
 */
export async function writeOutline({ writer = null, prompt, answers = [], decomposition, selection, registry, logic, seed, maxRounds = 2, verify = true, verifyBudgetMs = 1200, playtestMs = 1500, protect = null }) {
  const keep = protect || coreOf(selection, registry);
  /** @param {Doc} doc @returns {Promise<Gate & { problems: VerifyProblem[], v: Verification }>} */
  const gate = async doc => {
    // The publish gate: the game is the idea (core loop present, its content written, a win wired) and it runs without crashing.
    const core = coreLoopProblems(doc, selection?.mechanics, registry);
    const v = await verifyDocument(doc, registry, logic, { budgetMs: verifyBudgetMs, playtestMs });
    const problems = [...core, ...(v.viable ? [] : [{ code: 'not_playable', path: '$', message: v.viability ?? 'verification reported no viability', severity: 'error', hint: 'the game must run without crashing' },
      ...(v.problems || []).filter(p => p.severity === 'error').slice(0, 8)])];
    return { viable: Boolean(v.viable) && !core.length, problems, v };
  };
  const started = performance.now();
  const skeleton = proceduralOutline({ decomposition, selection, registry, logic, seed, prompt });
  if (skeleton.ok) skeleton.doc = engageDocument(skeleton.doc, registry, logic).doc;
  /** @type {OutlineRound[]} */
  const rounds = [{ kind: 'procedural', ok: skeleton.ok, errors: skeleton.errors.length, fixes: skeleton.fixes.length, ms: Math.round(performance.now() - started) }];
  if (!writer) return { ...(skeleton.ok ? { doc: skeleton.doc, ok: skeleton.ok } : { doc: skeleton.doc, ok: skeleton.ok }), source: 'procedural', rounds, firstPassOk: skeleton.ok, modelMs: 0, removed: skeleton.removed, errors: skeleton.errors };
  // The skeleton is a Doc when it is ok; otherwise it is the repaired draft, read through guards.
  const skeletonSpace = list(prop(skeleton.doc, 'spaces'))[0];
  const fallbackSpace = { id: prop(skeletonSpace, 'id'), use: prop(skeletonSpace, 'use'), with: prop(skeletonSpace, 'with') || {} };
  // The form and the prompts frame the model on the scaffold. The skeleton is built procedurally (never model output):
  // when repair rejected it, it is still the procedural draft, in the document's shape.
  const scaffold = /** @type {Doc} */ (skeleton.doc);
  const form = outlineForm({ registry, skeleton: scaffold, selection });
  const system = outlineSystem(registry, logic, selection, form);
  const base = outlineUser({ prompt, answers, decomposition, selection, skeleton: scaffold });
  const skeletonPlot = verify ? await staticPlot(scaffold, logic) : { problems: [] };
  let user = base, modelMs = 0;
  /** @type {boolean | null} */
  let firstPassOk = null;
  /** @type {DraftRepair | null} */
  let last = null;
  /** @type {string | null} */
  let model = null;
  /** @type {{ score: number, doc: Doc, removed: Array<Removed | Removal>, verification: Verification | undefined, content: ContentProblem[], round: number } | null} */
  let best = null;
  /** @type {ProblemLike[] | null} */
  let lastProblems = null;
  for (let round = 0; round <= maxRounds; round++) {
    /** @type {unknown} */
    let value;
    const t = performance.now();
    try {
      const reply = await writer.complete({ system, user, schema: form.schema });
      modelMs += reply.ms ?? Math.round(performance.now() - t); model = reply.model;
      value = parseReply(reply.text);
    } catch (error) {
      const message = String(prop(error, 'message') || error), code = prop(error, 'code');
      rounds.push({ kind: round ? 'model_repair' : 'model', ok: false, error: message.slice(0, 160), ms: Math.round(performance.now() - t) });
      lastProblems = [{ code: typeof code === 'string' && code ? code : 'model_failed', path: '$', message: message.slice(0, 200) }];
      if (code !== 'model_output_not_json') break;
      user = `${base}\n\nYour previous reply was not one JSON object (${message.slice(0, 120)}). Reply with the form as one JSON object.`;
      continue;
    }
    // A reply in the document's own shape (older prompts, some writers) is a draft as is; otherwise it is the form.
    const draft = isDocShape(value) ? value : form.toDoc(value);
    draft.schema = DOC_SCHEMA; draft.seed = seed;
    keepPlayer(draft, skeleton.doc);
    // The core loop's wiring is code's: whatever the model wrote, the mode applies and its win/lose end the game.
    Object.assign(draft, wireCore(draft, decomposition, registry).doc);
    // Data nobody reads (quests with no quest runner): add the primitive that reads it.
    for (const u of unreadReaders(draft, registry)) if (u.reader && Array.isArray(draft.systems) && !draft.systems.some(x => prop(x, 'use') === u.reader)) draft.systems.push({ use: u.reader });
    if (draft.spaces && Array.isArray(draft.spaces)) try { configureGenerators(draft, registry); } catch { /* malformed spaces: repair reports them */ }
    const result = repairDocument(draft, { registry, logic, fallbackSpace, protect: keep });
    /** @type {DraftRepair} */
    const repaired = result;
    /** The draft while it is still valid (repaired.ok), for the gate. @type {Doc | null} */
    let playable = null;
    /** @type {string[]} */
    let worldAdded = [];
    /** @type {Placement[]} */
    let placed = [];
    /** @type {VerifyProblem[]} */
    let staticErrors = [];
    if (result.ok) {
      let doc = result.doc;
      const w = furnishWorld(doc, registry, logic, { seed });
      if (w.added.length) { doc = w.doc; worldAdded = w.added.map(a => a.use); }
      // Archetypes the draft defines but never puts in the world are placed zone by zone (deterministic).
      const p = placeContent(doc, registry); doc = p.doc; placed = p.added;
      doc = engageDocument(doc, registry, logic).doc;
      // Boot it (ms): a primitive that throws is isolated with what pointed at it, unless it is a core mechanic's;
      // then the error (naming the primitive, install or step) goes to the model.
      const fp = firstPlayable(doc, registry, logic, { seed, furnish: false, protect: keep });
      if (fp.ok && fp.removed.length && fp.doc) { doc = fp.doc; repaired.removed = [...(repaired.removed || []), ...fp.removed]; }
      else if (!fp.ok) { repaired.ok = false; repaired.errors = fp.errors.length ? fp.errors : fp.problems; }
      repaired.doc = doc;
      if (repaired.ok) playable = doc;
    }
    const fixes = repaired.fixes.length;
    if (firstPassOk === null) firstPassOk = repaired.ok && fixes === 0;
    /** @type {OutlineRound} */
    const entry = { kind: round ? 'model_repair' : 'model', ok: repaired.ok, errors: repaired.errors.length, codes: [...new Set(repaired.errors.map(e => e.code))].slice(0, 8), fixes, form: !isDocShape(value), ...(worldAdded.length ? { worldAdded } : {}), ...(placed.length ? { placed: placed.length } : {}), ms: Math.round(performance.now() - t) };
    rounds.push(entry);
    last = repaired;
    /** @type {ProblemLike[]} */
    let problems = [];
    if (playable) {
      /** @type {Gate} */
      const g = verify ? await gate(playable) : { viable: true };
      entry.viable = g.viable;
      // Static plot analysis (plotGraph): errors count against the draft; its warnings travel with them as the cause.
      /** @type {VerifyProblem[]} */
      let staticNew = [];
      if (verify) { const sp = await staticPlot(playable, logic); staticErrors = newErrors(skeletonPlot, sp); staticNew = staticErrors.length ? newProblems(skeletonPlot, sp) : []; }
      entry.staticErrors = staticErrors.length;
      const content = populateProblems(playable, registry);
      entry.content = content.length;
      // Completion is a quality signal, not the gate: a game the playtest agent cannot finish goes back to the model with
      // what the agent saw (no ending reached, events that never happened, a stuck opponent...).
      const play = /** @type {any} */ (g.v)?.playtest;
      const unfinished = verify && g.viable && play && !play.winnable ? [{ code: 'playtest_not_completed', path: 'plot.endings', message: `the playtest agent explored ${play.explored ?? '?'} states and reached no winning ending`,
        hint: `what it found: ${[...new Set((/** @type {any} */ (g.v)?.problems || []).filter((/** @type {any} */ p) => ['playtest', 'strategy', 'plot', 'spatial'].includes(p.stage)).map((/** @type {any} */ p) => `${p.code}${p.message ? ` (${String(p.message).slice(0, 80)})` : ''}`))].slice(0, 6).join('; ') || 'no goal progress'}; make the core loop winnable: reachable targets, an opponent that acts, legal moves, a win wired to an ending` }] : [];
      entry.completed = play ? Boolean(play.winnable) : null;
      if (g.viable) {
        const score = content.length + staticErrors.length * 2 + unfinished.length * 3;
        if (!best || score < best.score) best = { score, doc: playable, removed: repaired.removed, verification: g.v, content, round };
        if (!score) break;
      }
      problems = g.viable ? [...staticNew, ...unfinished, ...content] : [...(g.problems || []), ...staticNew];
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
    if (isolated.ok && fp?.ok) {
      /** @type {Gate} */
      const g = verify ? await gate(isolated.doc) : { viable: true };
      rounds.push({ kind: 'isolate', ok: true, viable: g.viable, removed: isolated.removed.map(r => r.use) });
      if (g.viable) return { doc: isolated.doc, ok: true, source: model, isolated: true, rounds, firstPassOk, modelMs, removed: [...(last.removed || []), ...isolated.removed], errors: [], verification: g.v, content: populateProblems(isolated.doc, registry) };
      lastProblems = g.problems || null;
    } else rounds.push({ kind: 'isolate', ok: false });
  }
  // No substitution: the procedural skeleton is a scaffold, never the shipped game. Nothing playable came out.
  return { doc: last?.doc || skeleton.doc, ok: false, source: model || 'procedural', rounds, firstPassOk: firstPassOk ?? false, modelMs, removed: last?.removed || [], errors: lastProblems?.length ? lastProblems : (last?.errors || [{ code: 'no_draft', path: '$', message: 'the model returned no usable outline' }]) };
}

/**
 * A draft that drops the player (models do) would publish a world nobody plays: keep the skeleton's, in the draft's first zone.
 * @param {Record<string, unknown>} draft the model's draft (unchecked) @param {unknown} skeleton
 */
function keepPlayer(draft, skeleton) {
  const skeletonPlayer = prop(skeleton, 'player');
  if (draft.player || !isObj(skeletonPlayer) || !Array.isArray(draft.spaces) || !draft.spaces.length) return;
  const sp = draft.spaces.find(s => prop(s, 'id') === skeletonPlayer.space) || draft.spaces[0], z = list(prop(sp, 'zones'))[0];
  const at = typeof skeletonPlayer.at === 'string' ? prop(z, 'id') ?? skeletonPlayer.at : (z && zoneStart(z)) || skeletonPlayer.at;
  draft.player = { ...structuredClone(skeletonPlayer), space: prop(sp, 'id'), at };
  if (!list(prop(draft.content, 'archetypes')).some(a => prop(a, 'id') === skeletonPlayer.archetype)) {
    const arch = list(prop(prop(skeleton, 'content'), 'archetypes')).find(a => prop(a, 'id') === skeletonPlayer.archetype);
    const content = draft.content;
    if (arch && isObj(content) && (content.archetypes === undefined || Array.isArray(content.archetypes))) (content.archetypes = isList(content.archetypes) ? content.archetypes : /** @type {unknown[]} */ ([])).push(structuredClone(arch));
    else if (arch && !draft.content) draft.content = { archetypes: [structuredClone(arch)] };
  }
}

export { seedFrom, isSpace, coreOf };
