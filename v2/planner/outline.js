// @ts-check
// Layer 1 of ARCHITECTURE.md §4: the outline document. The preset composes the structure from what the selected
// primitives declare (presets.js; zero model calls). With a writer, the model fills the content and tuning through
// small strict forms, and each draft is preflighted, booted and gated; errors go to the deterministic repair first
// (which fixes fields and never removes a primitive) and the rest back to the model, field by field, for a bounded
// number of rounds. What still fails is reported exactly, for the planner to re-plan (replan.js).
import { readFileSync, readdirSync } from 'node:fs';
import { DOC_SCHEMA, preflight } from '../kernel/document.js';
import { random, seedFrom } from '../kernel/rng.js';
import { movementFrom } from './decompose.js';
import { cardText, vocabulary, isSpace, defaultsOf, dataShapes } from './catalog.js';
import { vocabIndex, selectPrimitives, baseLocomotion } from './select.js';
import { outlineForm, formPath, groupOfPath, fieldForm, paramsGroupId } from './outline-form.js';
import { dependencyLayers, loopMechanicOf } from './build.js';
import { preset, coreOf, zoneStart, wireCore, repairLoop, loopIdea } from './presets.js';
import { loopProblems } from './loop-check.js';
import { isAvatar } from './play-spec.js';
import { populateProblems, placeContent, unreadReaders, contractText, contractsFor } from './content.js';
import { firstPlayable } from './first-playable.js';
import { engageDocument } from './engage.js';
import { repairDocument, describeErrors } from './repair.js';
import { applySkins } from './adapters.js';
import { parseReply } from './writer.js';
import { configureGenerators, furnishWorld, worldProblems } from './world.js';
import { coreLoopProblems } from './core-loop.js';
import { verifyDocument, newErrors, newErrorCodes, newProblems, staticPlot } from './verify-adapter.js';
import { isObj, isList, isStr, obj, list, objects, str, prop } from '../kernel/guards.js';

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
 * One small form of the first round, checked as soon as it was written: how many times it was asked (the first ask,
 * field re-asks, the escalation) and the problem codes left. @typedef {{ group: string, phase: string, asks: number, problems: string[] }} FormCheck
 */
/**
 * One entry of writeOutline's round log.
 * @typedef {{ kind: string, ok?: boolean, errors?: number, error?: string, codes?: string[], fixes?: number, form?: boolean, worldAdded?: string[], placed?: number,
 *   viable?: boolean, staticErrors?: number, content?: number, completed?: boolean | null, removed?: unknown[], ms?: number, checks?: FormCheck[] }} OutlineRound
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
 * proceduralOutline's result: `doc` is a Doc exactly when `ok` (else the repaired draft). `structure` reports what the
 * collection composed; `st` is the composition itself (its win and losses, re-wired into every model draft).
 * `loop` is the static loop check of the structure (loop-check.js errors).
 * @typedef {{ errors: import('../kernel/types.js').Problem[], fixes: Array<Fix | WorldFix>, removed: Removed[], gaps: import('./presets.js').PresetGap[], structure: Record<string, unknown>, st: import('./presets.js').Structure,
 *   loop: import('./loop-check.js').LoopProblem[], world: { added: Array<{ space: unknown, use: string, problems: string[] }>, problems: WorldProblem[] } | null } & ({ ok: true, doc: Doc } | { ok: false, doc: unknown })} ProceduralOutline
 */
/**
 * One model round's repaired draft. `ok` means `doc` passed repair and boot (it is then a Doc).
 * @typedef {{ ok: boolean, doc: unknown, errors: Array<import('../kernel/types.js').Problem | PlayableProblem>, fixes: Fix[], removed: Array<Removed | Removal> }} DraftRepair
 */
/**
 * writeOutline's result: `doc` is a Doc exactly when `ok`.
 * @typedef {{ source: string | null, rounds: OutlineRound[], firstPassOk: boolean | null, modelMs: number, removed: Array<Removed | Removal>, errors: ProblemLike[],
 *   verification?: Verification, content?: ContentProblem[], contentComplete?: boolean, structure?: unknown } & ({ ok: true, doc: Doc } | { ok: false, doc: unknown })} OutlineResult
 */

export const OUTLINE_VERSION = 'outline/0.1';
/** @param {unknown} s @param {string} [sep] @returns {string} */
const slug = (s, sep = '_') => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join(sep).slice(0, 40);
const STOP = new Set('a an the of in on with and or to for from by as at is are be it its into that this where who you your player game games like style meets world'.split(' '));
const PLACES = ['Gate', 'Hollow', 'Market', 'Spire', 'Vault', 'Ruins', 'Harbor', 'Grove', 'Keep', 'Crossing', 'Depths', 'Summit', 'Archive', 'Yard', 'Sanctum', 'Wilds'];

/**
 * The procedural structure: the preset the selected primitives' declarations and the play spec compose (presets.js).
 * It authors no story, cast or content: those are the model's (the offline mode publishes it only when the
 * collection needs none).
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
  // Agency is an avatar's question: without one, the player acts through the mode (moves, cards, cells), whose options
  // exist once the model has written its content. Nothing to add here, and no reason to change the space.
  if (decomposition.core?.interaction && !isAvatar(decomposition.core.interaction)) return { selection, attempts, agency: true };
  let current = selection;
  /** @type {string[]} */
  let excluded = [];
  // Mechanics (systems) must survive a space change; generators build whichever space is chosen, so they may change with it.
  const kept = (/** @type {{ systems: string[] }} */ sel) => new Set(sel.systems);
  for (let i = 0; i < tries; i++) {
    const o = proceduralOutline({ decomposition, selection: current, registry, logic, seed, prompt });
    // A structure that does not validate yet lacks content the model writes (crops, pieces, a story): agency is then
    // the publish gate's question on the written game (cannot_act), not a reason to change the world or report a gap.
    if (!o.ok) return { selection: current, attempts: [...attempts, { spaces: current.spaces.map(s => s.use), options: null, ok: false }], agency: null };
    const fp = firstPlayable(engageDocument(o.doc, registry, logic).doc, registry, logic, { seed });
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
    // A collection built on its space (build.js) keeps it: no offline re-selection swaps the world; the lack is a gap.
    if (selection.build) break;
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
- spaces.<id>.zones (only where the schema has them: a board or a card table has none): named zones, each different from the others in what is there (terrain, hazards, residents, enemies, treasures). Exits/gates only where the schema has them. On a space without zones, spawns name cells (at_json).
- systems.<primitive id>.with: each chosen primitive's params, tuned to the idea (null = the card's default). Primitives that keep data in their params (racers, waves, crops, stages, shops, bosses, areas...) need that data here.
- archetypes: EVERY kind of entity the game needs (enemies with health and behavior, creatures, pickups, props, vehicles, rivals), each with the components its role needs. An archetype with only a name is hollow.
- spawns: where those entities appear: each zone gets its own mix (count = [min, max] alive).
- items, characters (with home zones and their dialogue ids), dialogue (node graphs), quests (objectives use the goal kinds), and the plot/content sections the primitives read.
- acts/beats and endings: a completable story through the zones; the last beat ends the game (effect end_game).
JSON-text fields (zone gates, beat triggers and effects, dialogue effects: *_json) hold a JSON value encoded as a string, or null.
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

Write the outline for THIS idea: an evocative title and premise, ${decomposition.acts ? `${decomposition.acts} acts of beats, ` : ''}${decomposition.zones ? `${decomposition.zones} or more distinct named zones` : "the skeleton's zones as distinct named places"}, the archetypes and their spawns zone by zone, characters with roles and lines, items, quests where the primitives run them, params tuned to the idea, and an ending. Fill every content requirement listed in the instructions.`;
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
 * (preflight errors, crashes, static plot errors, missing content) goes back to the model as targeted problems: a
 * repair round re-asks only the failing fields (fieldForm), or a small form whose failing parts have no field slot.
 * Nothing is isolated, dropped or substituted to make a draft pass: every primitive of the collection is kept (repair
 * fixes fields; a primitive that throws at boot is a problem for the model, naming it). When no draft passes within
 * the rounds, the result is ok:false with the exact problems (and what of the core they leave missing), for the
 * planner to re-plan. A form the default model fails twice is asked of the escalation writer (that form only), with
 * a round to check its answer. Without a writer the preset is the explicit offline mode.
 * @param {{ writer?: Writer | null, prompt: string, answers?: Array<{ question?: unknown, answer?: unknown }>, decomposition: Decomposition, selection: Selection,
 *   registry: RegistryLike, logic: LogicLike, seed: number, maxRounds?: number, verify?: boolean, verifyBudgetMs?: number, playtestMs?: number,
 *   protect?: Set<string> | null, forms?: 'split' | 'single', escalate?: Writer | null }} args
 * @returns {Promise<OutlineResult>}
 */
export async function writeOutline({ writer = null, prompt, answers = [], decomposition, selection, registry, logic, seed, maxRounds = 2, verify = true, verifyBudgetMs = 1200, playtestMs = 1500, protect = null, forms = 'split', escalate = null }) {
  // The core: the core mechanics' gameplay/plot primitives (and what they require).
  const core = protect || coreOf(selection, registry);
  /** @param {Doc} doc @returns {Promise<Gate & { problems: VerifyProblem[], v: Verification }>} */
  const gate = async doc => {
    // The publish gate: the game is the idea (core loop present, its content written, a win wired) and it runs without crashing.
    const coreProblems = coreLoopProblems(doc, selection?.mechanics, registry);
    const v = await verifyDocument(doc, registry, logic, { budgetMs: verifyBudgetMs, playtestMs });
    const problems = [...coreProblems, ...(v.viable ? [] : [{ code: 'not_playable', path: '$', message: v.viability ?? 'verification reported no viability', severity: 'error', hint: 'the game must run without crashing, the player must act, and the loop its primitives declare must happen from play' },
      ...(v.problems || []).filter(p => p.severity === 'error').slice(0, 8)])];
    return { viable: Boolean(v.viable) && !coreProblems.length, problems, v };
  };
  const started = performance.now();
  const skeleton = proceduralOutline({ decomposition, selection, registry, logic, seed, prompt });
  if (skeleton.ok) skeleton.doc = engageDocument(skeleton.doc, registry, logic).doc;
  /** @type {OutlineRound[]} */
  const rounds = [{ kind: 'procedural', ok: skeleton.ok, errors: skeleton.errors.length, fixes: skeleton.fixes.length, ms: Math.round(performance.now() - started) }];
  // The static loop check, before any model call: a structure whose declared loop cannot be played out and won is
  // reported for the planner to re-plan (replan.js), never handed to the model to theme.
  const loopCore = skeleton.st?.core || [...core];
  // The play spec's opponent: an 'ai-*' opponent must be driven by a primitive (loop-check.js loop_opponent_inert).
  const loopOpponent = decomposition.core?.opponent ?? null;
  const structural = (skeleton.ok ? loopProblems(skeleton.doc, registry, { logic, core: loopCore, opponent: loopOpponent, structure: true }) : (skeleton.loop || [])).filter(p => !p.need.pending);
  if (structural.length) {
    rounds.push({ kind: 'loop_check', ok: false, errors: structural.length, codes: [...new Set(structural.map(p => p.code))], ms: 0 });
    return { doc: skeleton.doc, ok: false, structure: skeleton.structure, source: 'procedural', rounds, firstPassOk: false, modelMs: 0, removed: skeleton.removed, errors: [...structural, ...skeleton.errors] };
  }
  if (!writer) return { ...(skeleton.ok ? { doc: skeleton.doc, ok: skeleton.ok } : { doc: skeleton.doc, ok: skeleton.ok }), structure: skeleton.structure, source: 'procedural', rounds, firstPassOk: skeleton.ok, modelMs: 0, removed: skeleton.removed, errors: skeleton.errors };
  // The form and the prompts frame the model on the scaffold. The skeleton is built procedurally (never model output):
  // when repair rejected it, it is still the procedural draft, in the document's shape.
  const scaffold = /** @type {Doc} */ (skeleton.doc);
  // The form asks for every primitive of the collection, not those the structure took out for the play spec (with why).
  const out = new Set(list(prop(skeleton.structure, 'removed')).map(r => prop(r, 'use')));
  const form = outlineForm({ registry, skeleton: scaffold, selection: { ...selection, systems: selection.systems.filter(id => !out.has(id)) } });
  const system = outlineSystem(registry, logic, selection, form);
  const base = outlineUser({ prompt, answers, decomposition, selection, skeleton: scaffold });
  // The draft's static plot problems all count: the structure has no story of its own to compare against.
  /** @type {{ problems: VerifyProblem[] }} */
  const skeletonPlot = { problems: [] };
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
  // Small forms (forms 'split'): every group is its own short strict call, all of a wave in parallel; a repair round
  // re-asks only the failing fields of the groups its problems point at (fieldForm), or the whole small form when a
  // failing part has no field slot. forms 'single' asks the whole form in one call.
  /** @type {Record<string, unknown>} */
  let merged = {};
  /** @type {Record<string, number>} */
  const failures = {};
  /** @type {Set<string>} */
  const escalated = new Set();
  /** @type {Array<{ group: string, ms: number, model: string | null, escalated?: boolean, fields?: number, error?: string }>} */
  let calls = [];
  const groups = forms === 'split' ? form.groups : [];
  /** Ids the other parts use, so a small form keeps references consistent. */
  const known = () => JSON.stringify({ archetypes: list(prop(merged, 'archetypes')).map(a => prop(a, 'id')), items: list(prop(merged, 'items')).map(a => prop(a, 'id')), characters: list(prop(merged, 'characters')).map(a => prop(a, 'id')),
    zonesByScaffold: scaffold.spaces.map(sp => ({ space: sp.id, zones: (sp.zones || []).map(z => z.id) })) });
  /** The cast wave 1 wrote (and the scaffold's own), for the story form's enums. */
  const cast = () => ({
    characters: [...list(prop(merged, 'characters')).map(a => prop(a, 'id')), ...list(scaffold.plot?.characters).map(a => prop(a, 'id'))].filter(isStr),
    archetypes: [...list(prop(merged, 'archetypes')).map(a => prop(a, 'id')), ...list(scaffold.content?.archetypes).map(a => prop(a, 'id'))].filter(isStr),
    items: [...list(prop(merged, 'items')).map(a => prop(a, 'id')), ...list(scaffold.content?.items).map(a => prop(a, 'id'))].filter(isStr),
  });
  /** @param {import('./outline-form.js').FormGroup} g0 @param {ProblemLike[]} problems @param {Doc | unknown} draft the draft the problems' paths are in */
  const askGroup = async (g0, problems, draft) => {
    const t0 = performance.now();
    const g = g0.id === 'story' ? form.storyGroup(cast()) || g0 : g0;
    const w = (failures[g.id] || 0) >= 2 && escalate ? escalate : writer;
    if (w === escalate) escalated.add(g.id);
    // A params form is one primitive's slot: its current value is that slot only.
    const current = g.sub ? { systems: { [g.sub]: prop(prop(merged, 'systems'), g.sub) } } : Object.fromEntries(g.keys.map(k => [k, prop(merged, k)]).filter(([, v]) => v !== undefined));
    const part = g.use ? `the params of ${g.use} (systems.${g.sub})` : g.keys.join(', ');
    // Field-level repair: only the failing fields go back (each slot holds that field's schema, its enums included).
    const paths = problems.map(p => formPath(p.path, draft)).filter(fp => fp && groupOfPath([g], fp));
    const ff = problems.length && paths.length === problems.length ? fieldForm(g.schema, paths) : null;
    const fields = ff && ff.slots.length && !ff.unresolved.length ? ff : null;
    // Sections a content pack already fills: the model themes them (names, flavour, which ones), keeping the numbers valid.
    const pack = g.keys.filter(k => k.startsWith('section_')).map(k => { const [root, key] = k.slice(8).split('_'); return prop(prop(scaffold, root), key); }).find(v => v !== undefined);
    const ask = fields
      ? `${base}\n\nFix ONLY these fields of the outline (use these ids where you refer to other parts: ${known()}). Each failed checks:\n${describeProblems(problems, null)}\nCurrent values:\n${JSON.stringify(Object.fromEntries(fields.slots.map(s => [s.path, valueAt(merged, s.path)]))).slice(0, 8000)}`
      : `${base}

Fill ONLY this part of the outline now: ${part} (other parts are written separately; keep zone ids from the scaffold and use these ids where you refer to other parts: ${known()}).${pack !== undefined ? `\nA mechanically valid default is provided; keep its ids and numbers valid, theme its names and flavour to the idea, and add or drop entries only as the idea needs:\n${JSON.stringify(pack).slice(0, 6000)}` : ''}${problems.length ? `\n\nYour previous answer for this part failed checks (fix each one):\n${describeProblems(problems, null)}\nPrevious answer:\n${JSON.stringify(current).slice(0, 12000)}` : ''}`;
    try {
      const reply = await /** @type {Writer} */ (w).complete({ system, user: ask, schema: fields ? fields.schema : g.schema, ...(w === escalate ? { effort: 'low' } : {}) });
      const answer = parseReply(reply.text);
      model = reply.model;
      if (fields) merged = fields.apply(merged, answer);
      else if (g.sub) { const slot = prop(prop(answer, 'systems'), g.sub); if (slot !== undefined) merged.systems = { ...obj(merged.systems), [g.sub]: slot }; }
      else if (isObj(answer)) for (const k of g.keys) if (answer[k] !== undefined) merged[k] = answer[k];
      calls.push({ group: g.id, ms: reply.ms ?? Math.round(performance.now() - t0), model: reply.model || null, ...(w === escalate ? { escalated: true } : {}), ...(fields ? { fields: fields.slots.length } : {}) });
      return { ok: true, value: answer };
    } catch (error) {
      calls.push({ group: g.id, ms: Math.round(performance.now() - t0), model: null, error: String(prop(error, 'message') || error).slice(0, 120) });
      return { ok: false, error };
    }
  };
  /**
   * The draft a filled (or partly filled) form makes, as every round builds it before repair: the player and the
   * collection are the structure's, and so is the loop's wiring. @param {unknown} value
   */
  const draftOf = value => {
    const draft = isDocShape(value) ? structuredClone(value) : form.toDoc(value);
    draft.schema = DOC_SCHEMA; draft.seed = seed;
    keepPlayer(draft, skeleton.doc);
    keepCollection(draft, skeleton.doc);
    // The collection's loop wiring is code's: whatever the model wrote, the declared win and losses end the game.
    Object.assign(draft, wireCore(draft, skeleton.st, registry).doc);
    // So is the rest of the loops' structure (participants, what the win reads, an action that changes it): the model's
    // content is kept, what the declarations need and the draft lacks is put back (presets.js repairLoop).
    try { Object.assign(draft, repairLoop(draft, registry, { logic, core: loopCore, opponent: loopOpponent, idea: loopIdea(decomposition) }).doc); } catch { /* malformed draft: repair and the loop check report it */ }
    return draft;
  };
  // The core loop's primitives: their params forms come first, and problems no form owns go back to them and the cast.
  const loopMechanic = loopMechanicOf(decomposition);
  const loopIds = (selection.mechanics.find(m => m.id === loopMechanic)?.primitives || []).filter(id => groups.some(g => g.use === id));
  /** References into sections the content forms write later: a params form is not asked to fix those yet. */
  const LATER = /^unknown (archetype|item|character|quest|dialogue|recipe|beat|model|block) /;
  /**
   * One primitive's params, checked once its form is written: its instance against its card params (and its validator)
   * in a preflight of the partial document, and its param content contracts. Structure (capabilities, requirements,
   * vocabulary owners) is the collection's and is not the form's to fix. @param {string} id
   * @returns {{ problems: ProblemLike[], draft: unknown }}
   */
  const paramsCheck = id => {
    const draft = draftOf(merged);
    const i = list(draft.systems).findIndex(x => prop(x, 'use') === id);
    if (i < 0) return { problems: [], draft };
    const at = `systems[${i}].with`;
    const own = preflight(draft, registry, logic).errors.filter(e => (e.path === at || e.path.startsWith(`${at}.`) || e.path.startsWith(`${at}[`)) && e.code !== 'vocabulary_owner_missing' && !(e.code === 'ref_unknown' && LATER.test(e.message)));
    const contracts = contractsFor(registry, [id]).filter(c => c.need === 'param');
    return { problems: [...own, ...(contracts.length ? populateProblems(draft, registry, { contracts }) : [])], draft };
  };
  /**
   * A content form, checked once it is written: the content contracts whose section it writes (the cast: archetypes and
   * items; a section form: its section; the story: quests and the plot sections it writes), after the deterministic
   * placement of defined archetypes. @param {import('./outline-form.js').FormGroup} g @returns {{ problems: ProblemLike[], draft: unknown }}
   */
  const contentCheck = g => {
    const draft = placeContent(draftOf(merged), registry).doc;
    const contracts = form.contracts.filter(c => c.need !== 'param' && groupOfPath([g], formPath(c.need === 'section' ? String(c.at) : `content.${c.need}`, draft)));
    return { problems: contracts.length ? populateProblems(draft, registry, { contracts }) : [], draft };
  };
  /** @type {FormCheck[]} */
  const checks = [];
  /**
   * Ask one small form and check it at once; on problems re-ask only its failing fields (fieldForm), and a form the
   * default model failed twice goes to the escalation writer (that form only). What is left goes to the round's gate.
   * @param {import('./outline-form.js').FormGroup} g @param {(() => { problems: ProblemLike[], draft: unknown }) | null} check
   */
  const settle = async (g, check) => {
    /** @type {ProblemLike[]} */
    let problems = [];
    /** @type {unknown} */
    let draft = null;
    let asks = 0;
    while (asks < 2 + (escalate ? 1 : 0)) {
      asks++;
      const r = await askGroup(g, problems, draft);
      // A call that failed leaves the form as it was: the round's gate reports what is missing.
      if (!r.ok) { problems = [{ code: 'model_failed', path: '$', message: String(prop(r.error, 'message') || r.error).slice(0, 160) }]; break; }
      if (!check) break;
      ({ problems, draft } = check());
      if (!problems.length) break;
      failures[g.id] = (failures[g.id] || 0) + 1;
    }
    checks.push({ group: g.id, phase: g.phase, asks, problems: [...new Set(problems.map(p => p.code))] });
  };
  /**
   * The first round, built form by form: the frame; each primitive's params in dependency order (the loop's first, then
   * what it requires or what reads its outputs; independent ones in parallel), each checked before the next layer; then
   * each content contract section, checked at once; then the story.
   */
  const buildForms = async () => {
    const of = (/** @type {string} */ phase) => groups.filter(g => g.phase === phase);
    const frame = Promise.all(of('frame').map(g => settle(g, null)));
    const params = of('params');
    for (const layer of dependencyLayers(registry, params.map(g => String(g.use)), loopIds))
      await Promise.all(layer.flatMap(id => params.filter(g => g.use === id).map(g => settle(g, () => paramsCheck(id)))));
    await frame;
    await Promise.all(of('content').map(g => settle(g, () => contentCheck(g))));
    for (const g of of('story')) await settle(g, () => contentCheck(g));
  };
  /** @type {Map<string, ProblemLike[]>} */
  let pending = new Map();
  /** @type {unknown} */
  let pendingDraft = null;
  let limit = maxRounds;
  for (let round = 0; round <= limit; round++) {
    /** @type {unknown} */
    let value;
    const t = performance.now();
    calls = [];
    if (groups.length) {
      // Round 0 builds the forms one checked step at a time (buildForms); later rounds re-ask only the groups with
      // problems (wave 1 in parallel, then wave 2).
      if (round === 0) await buildForms();
      else {
        const todo = groups.filter(g => pending.has(g.id));
        for (const wave of [1, 2]) await Promise.all(todo.filter(g => g.wave === wave).map(g => askGroup(g, pending.get(g.id) || [], pendingDraft)));
      }
      // Round 0's forms run in sequence (its wall time); a repair round's in parallel (its longest call).
      modelMs += round === 0 ? Math.round(performance.now() - t) : calls.reduce((m, c) => Math.max(m, c.ms), 0);
      // A writer that answers with a whole document (older prompts and fakes) is a draft as is.
      const docShaped = calls.length && isDocShape(merged) ? merged : null;
      if (!calls.some(c => !c.error) && round === 0) {
        rounds.push({ kind: 'model', ok: false, error: calls[0]?.error || 'no answer', ms: Math.round(performance.now() - t) });
        lastProblems = [{ code: 'model_failed', path: '$', message: String(calls[0]?.error || 'no answer') }];
        break;
      }
      value = docShaped || merged;
    } else {
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
    }
    // A reply in the document's own shape (older prompts, some writers) is a draft as is; otherwise it is the form.
    const draft = draftOf(value);
    // Data nobody reads (quests with no quest runner): add the primitive that reads it.
    for (const u of unreadReaders(draft, registry)) if (u.reader && Array.isArray(draft.systems) && !draft.systems.some(x => prop(x, 'use') === u.reader)) draft.systems.push({ use: u.reader });
    if (draft.spaces && Array.isArray(draft.spaces)) try { configureGenerators(draft, registry); } catch { /* malformed spaces: repair reports them */ }
    // Every primitive the draft uses is kept: repair fixes fields; what it cannot fix goes back as a problem.
    const keep = new Set([...core, ...list(draft.systems).map(x => prop(x, 'use')).filter(isStr).filter(id => registry.has(id))]);
    const result = repairDocument(applySkins(/** @type {any} */ (draft), registry), { registry, logic, protect: keep });
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
      // The assembled draft (skins applied, participants seated) gets the loops' structure back where it lacks it.
      doc = repairLoop(doc, registry, { logic, core: loopCore, opponent: loopOpponent, idea: loopIdea(decomposition) }).doc;
      // Boot it (ms): a primitive that throws is never isolated; the error (naming the primitive, install or step) goes to the model.
      const fp = firstPlayable(doc, registry, logic, { seed, furnish: false, protect: keep, maxIsolations: 0 });
      if (!fp.ok) { repaired.ok = false; repaired.errors = fp.errors.length ? fp.errors : fp.problems; }
      // The static loop check of the draft: a loop that cannot be played out and won is not playable.
      const lp = repaired.ok ? loopProblems(doc, registry, { logic, core: loopCore, opponent: loopOpponent }) : [];
      if (lp.length) { repaired.ok = false; repaired.errors = lp; }
      repaired.doc = doc;
      if (repaired.ok) playable = doc;
    }
    const fixes = repaired.fixes.length;
    if (firstPassOk === null) firstPassOk = repaired.ok && fixes === 0;
    /** @type {OutlineRound} */
    const entry = { kind: round ? 'model_repair' : 'model', ...(round === 0 && checks.length ? { checks } : {}), ok: repaired.ok, errors: repaired.errors.length, codes: [...new Set(repaired.errors.map(e => e.code))].slice(0, 8), fixes, form: !isDocShape(value), ...(calls.length ? { groups: calls.map(c => `${c.group}${c.escalated ? '*' : ''}${c.fields ? `[${c.fields}]` : ''}:${c.error ? 'error' : c.ms}`) } : {}), ...(worldAdded.length ? { worldAdded } : {}), ...(placed.length ? { placed: placed.length } : {}), ms: Math.round(performance.now() - t) };
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
    } else problems = [...repaired.errors, ...populateProblems(repaired.doc, registry).slice(0, 8)];
    lastProblems = problems;
    if (groups.length) {
      // Field-level repair: each problem goes to the small form that owns its slot; unplaced problems to the cast and params.
      pending = new Map();
      pendingDraft = repaired.doc;
      for (const pr of problems) {
        const g = groupOfPath(groups, formPath(pr.path || '', repaired.doc)) || null;
        const ids = g ? [g.id] : ['cast', ...loopIds.map(paramsGroupId)];
        for (const id of ids) if (groups.some(x => x.id === id)) pending.set(id, [...(pending.get(id) || []), pr]);
      }
      for (const id of pending.keys()) failures[id] = (failures[id] || 0) + 1;
      // A form the default model failed twice goes to the escalation writer; it gets that round even after the last one.
      if (round === limit && escalate && limit === maxRounds && [...pending.keys()].some(id => (failures[id] || 0) >= 2 && !escalated.has(id))) limit++;
      if (round === limit) break;
      continue;
    }
    if (round === limit) break;
    user = `${base}

Your previous outline failed ${repaired.ok ? (entry.viable === false ? 'verification' : 'the content and plot checks') : 'preflight'} with these problems (stable codes; fix each one in the form):
${describeProblems(problems, repaired.doc)}
Previous outline (your form):
${JSON.stringify(value).slice(0, 30000)}
Return the corrected complete form.`;
  }
  if (best) return { doc: best.doc, ok: true, structure: skeleton.structure, source: model, rounds, firstPassOk, modelMs, removed: best.removed, errors: [], verification: best.verification, content: best.content, contentComplete: !best.content.length };
  // No substitution, no isolation: the procedural skeleton is a scaffold, never the shipped game. Nothing playable
  // came out, so the problems are reported as they are, with what of the core the last draft could not keep
  // (mechanic, primitive, failing fields) named first for the planner to re-plan.
  const loss = last?.doc ? coreLossProblems(last.doc, last.removed || [], selection?.mechanics, core, last.errors) : [];
  const errors = [...loss, ...(lastProblems?.length ? lastProblems : last?.errors?.length ? last.errors : [{ code: 'no_draft', path: '$', message: 'the model returned no usable outline' }])];
  return { doc: last?.doc || skeleton.doc, ok: false, structure: skeleton.structure, source: model || 'procedural', rounds, firstPassOk: firstPassOk ?? false, modelMs, removed: last?.removed || [], errors };
}

/** The value at a form path in a filled form (for a field-form re-ask). @param {unknown} form @param {string} path */
function valueAt(form, path) {
  /** @type {unknown} */
  let v = form;
  String(path).replace(/\["([^"]*)"\]|\[(\d+)\]|([^.[\]]+)/g, (_, q, i, n) => { v = i !== undefined ? (Array.isArray(v) ? v[Number(i)] : undefined) : prop(v, q !== undefined ? q : n); return ''; });
  return v;
}
/**
 * The collection is code's: a draft that leaves out a primitive the structure chose (a core loop, an adapter that
 * realises a mashup relation, the win owner) gets the structure's instance back, with its configuration. Instances are
 * matched by primitive and instance id: an adapter used twice (two encounters, two regions) keeps each instance.
 * @param {Record<string, unknown>} draft the model's draft (unchecked) @param {unknown} skeleton
 */
function keepCollection(draft, skeleton) {
  if (!Array.isArray(draft.systems)) return;
  const key = (/** @type {unknown} */ s) => `${prop(s, 'use')}#${typeof prop(s, 'id') === 'string' ? prop(s, 'id') : ''}`;
  const have = new Set(draft.systems.map(key)), uses = new Set(draft.systems.map(s => prop(s, 'use')));
  // An instance the scaffold gave an id is matched by it (a draft instance of that primitive the model wrote without an
  // id is that one: the id is the planner's); one without an id (a plain primitive) by its primitive.
  for (const s of list(prop(skeleton, 'systems'))) {
    const id = prop(s, 'id');
    if (typeof id !== 'string') { if (!uses.has(prop(s, 'use'))) draft.systems.push(structuredClone(s)); continue; }
    if (have.has(key(s))) continue;
    const bare = draft.systems.find(x => isObj(x) && x.use === prop(s, 'use') && typeof x.id !== 'string');
    if (bare) { bare.id = id; if (bare.space === undefined && prop(s, 'space') !== undefined) bare.space = prop(s, 'space'); }
    else draft.systems.push(structuredClone(s));
    have.add(key(s));
  }
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

/**
 * What a degraded result (isolated primitives, a fallback structure) lost of the idea: one problem per core primitive
 * (a core mechanic's, or the play mode's) that was removed or is not in the document, naming the mechanic, the primitive
 * and the failing fields (the errors that pointed at it). Empty when the core is intact. The game is the idea: a version
 * missing any of these is never published.
 * @param {unknown} doc @param {Array<{ use?: unknown, why?: unknown }>} removed @param {unknown} mechanics selection.mechanics
 * @param {Set<string>} keep coreOf(...) @param {Array<{ path?: string, message?: string }>} failing the errors left on the draft
 * @returns {Array<{ code: string, path: string, message: string }>}
 */
export function coreLossProblems(doc, removed, mechanics, keep, failing = []) {
  const have = new Set([...list(prop(doc, 'systems')), ...list(prop(doc, 'spaces'))].map(x => String(prop(x, 'use'))));
  const gone = new Map(removed.filter(r => r.use && keep.has(String(r.use))).map(r => [String(r.use), r.why ? String(r.why) : ""]));
  /** @type {Array<{ code: string, path: string, message: string }>} */
  const out = [];
  for (const id of keep) {
    if (have.has(id) && !gone.has(id)) continue;
    const mech = list(mechanics).find(m => list(prop(m, 'primitives')).includes(id));
    const fields = failing.filter(e => `${e.path ?? ''} ${e.message ?? ''}`.includes(id)).map(e => `${e.path}: ${e.message}`).slice(0, 3);
    const why = [gone.get(id), ...fields].filter(Boolean).join('; ');
    out.push({ code: 'core_degraded', path: 'systems', message: `${mech ? `core mechanic "${prop(mech, 'description') ?? prop(mech, 'id')}"` : 'the play mode'} lost primitive ${id} (${gone.has(id) ? 'removed' : 'missing from the document'}${why ? `: ${why}` : ''}); the game is the idea, so it is not published without it` });
  }
  return out;
}

export { seedFrom, isSpace, coreOf };
