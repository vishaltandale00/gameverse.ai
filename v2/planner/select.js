// @ts-check
// Primitive selection for the step path (ARCHITECTURE.md §5): the collection is built iteratively (build.js): the space
// first, then one mechanic at a time, each a small model choice among the options code proved valid by declarations,
// with the checks after every pick. Then the requirements closure, the spaces the collection needs (an adapter, or a
// gap, for what the space lacks), base locomotion for an avatar, and the world's generators. Mechanics nothing covers
// become gaps. The choices are the model's: without one nothing is chosen (no lexical ranking, no word lists, no
// default stands in), and selection fails saying so.
import { Logic } from '../kernel/logic.js';
import { isSpace, isGenerator, spaceVariants, requirementsOf, satisfying } from './catalog.js';
import { isAvatar, mashupProblem, unplayedLoops } from './play-spec.js';
import { askMashup } from './decompose.js';
import { resolveAdapters, keepMashupAdapters } from './adapters.js';
import { planWorld, needSets, contentOfGenerator, targets, selectedContent } from './world.js';
import { str, isStr, prop } from '../kernel/guards.js';
import { buildSelection } from './build.js';
import { makeAsk } from './build-steps.js';
import { checkComposition } from './compose-check.js';

/** @typedef {import('../kernel/types.js').CardInput} CardInput */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').RegisteredPrimitive} RegisteredPrimitive */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** @typedef {import('./decompose.js').Mechanic} Mechanic */
/** @typedef {CardInput & { id: string }} IdCard */
/** @typedef {{ id: string, score: number }} Candidate */
/** A decomposed mechanic with what selection made of it. @typedef {Mechanic & { candidates: Candidate[], primitives: string[], source: string, score: number }} SelectedMechanic */
/** A chosen space: instance id, primitive, its configuration, the role it plays and the capabilities it then provides. @typedef {{ id: string, use: string, with: Record<string, unknown>, role: string, caps: string[] }} SpaceChoice */
/** @typedef {{ id: string, missing: string[], why: string }} Unmet */
/** @typedef {import('./compose-check.js').AdapterSpec} AdapterSpec */
/** @typedef {import('./compose-check.js').AdapterInstance} AdapterInstance */
/**
 * An uncovered mechanic ('win': the collection declares no way to win). 'adapter' gaps name the primitive no chosen space can host and the adapter that would
 * project it (`signature` a one-line description; `adapter` compose-check's adapter card when it produced one).
 * @typedef {{ mechanic: string, description: string, importance: string, kind: 'no_primitive' | 'capability' | 'adapter' | 'win', why: string, primitive?: string, signature?: string, verdict?: string, adapter?: AdapterSpec }} Gap
 */
/** @typedef {{ view: string | null, medium: string | null, removed: string[], added: string | null, gap?: string }} LocomotionResult */
/** The play spec's mashup post-check (play-spec.js mashupProblem) and its field re-ask. @typedef {{ problem: string, asked: number, mashup: import('./play-spec.js').Mashup[], model?: string, ms?: number, unresolved?: boolean }} MashupCheck */
/** @typedef {{ id: string, space: string | undefined, auto?: boolean }} GeneratorChoice */
/**
 * The iterative build as the selection report keeps it: the space step, every mechanic step (candidates, asks, checks,
 * outcome), the content contracts recorded, model calls and time. @typedef {Omit<import('./build.js').BuildResult, 'mapping' | 'systems' | 'adapters' | 'bind' | 'mashupAdapters' | 'gaps' | 'space' | 'win'>} BuildReport
 */
/** A space kind not offered because no registered generator can furnish what it needs. @typedef {{ use: string, missing: string[], why: string }} ExcludedSpace */
/** A generator a mechanic named that targets none of the chosen spaces. @typedef {{ id: string, why: string }} DroppedGenerator */
/**
 * selectPrimitives()'s result.
 * @typedef {object} Selection
 * @property {string} version
 * @property {SelectedMechanic[]} mechanics
 * @property {string[]} systems
 * @property {GeneratorChoice[]} generators
 * @property {Array<{ id: string, space?: string }>} graphics
 * @property {SpaceChoice[]} spaces
 * @property {Record<string, string>} bind  primitive id -> space id (primitives not on the first space)
 * @property {Gap[]} gaps
 * @property {string | null} provider
 * @property {{ locomotion: LocomotionResult, mashup?: MashupCheck }} completeness
 * @property {BuildReport} build  the iterative build's step log (build.js)
 * @property {DroppedGenerator[]} [droppedGenerators]
 * @property {ExcludedSpace[]} [excludedSpaces]
 * @property {AdapterInstance[]} [adapters]  adapter instances (with their config) the preset writes into the document's systems
 * @property {import('./build-steps.js').WinDecision} [win]  the game's win when several primitives declare one (build-steps.js
 *   askWins): it owns the game's win; the others' wins are left unwired
 * @property {Record<string, string[]>} [worlds]  space id -> the need set its world builds, when the space declares
 *   alternatives and the model chose one (pick_world); a space whose set the collection already meets is not listed
 * @property {import('./adapters.js').MashupRealisation[]} [mashupAdapters]  how the build's mashup adapter steps realised each
 *   core.mashup entry (the instances among `adapters`): every later re-resolution of `adapters` keeps them (adapters.js keepMashupAdapters)
 * @property {number} ms
 */

export const SELECT_VERSION = 'select/0.1';
/**
 * Does a card serve the play spec's interaction, by its declarations? Locomotion cards (card.locomotion) move an
 * avatar: they serve avatar interactions only. Cards that list the interactions they serve (card.interactions, e.g.
 * input) serve those. Nothing else is constrained here; an undecided interaction constrains nothing.
 * @param {any} card @param {string | null | undefined} interaction
 */
export function servesInteraction(card, interaction) {
  if (!interaction || !card) return true;
  if (card.locomotion) return isAvatar(interaction);
  if (Array.isArray(card.interactions)) return card.interactions.includes(interaction);
  return true;
}

/** @typedef {{ predicates: Record<string, string>, effects: Record<string, string> }} VocabIndex */
/** @type {WeakMap<object, VocabIndex>} */
const vocabCache = new WeakMap();
/** Which primitive registers each predicate and effect kind (kernel built-ins excluded). @param {RegistryLike} registry @returns {VocabIndex} */
export function vocabIndex(registry) {
  const cached = vocabCache.get(registry); if (cached) return cached;
  const base = new Logic(), builtinP = new Set(base.predicates.keys()), builtinE = new Set(base.effects.keys());
  /** @type {VocabIndex} */
  const out = { predicates: {}, effects: {} };
  for (const id of registry.ids()) {
    const p = /** @type {RegisteredPrimitive} */ (registry.get(id)); if (!p.logic) continue;
    const l = new Logic();
    try { p.logic(l); } catch { continue; }
    for (const k of l.predicates.keys()) if (!builtinP.has(k)) out.predicates[k] ??= id;
    for (const k of l.effects.keys()) if (!builtinE.has(k)) out.effects[k] ??= id;
  }
  vocabCache.set(registry, out);
  return out;
}

/** @param {unknown} role @param {number} i */
export const spaceSlug = (role, i) => ((String(role || 'world').toLowerCase().match(/[a-z0-9]+/g) || ['world']).join('_').slice(0, 30) || 'world') + (i ? `_${i}` : '');

/** Why selection asks nothing without a model (the step path's choices are the model's). */
export const MODEL_MISSING = 'step_path_model_missing';

/**
 * The step path's selection (see the header). A writer is required: without one nothing is chosen, and selection fails
 * (422 step_path_model_missing) saying so.
 * @param {{ decomposition: Decomposition, registry: RegistryLike, writer?: Writer | null, log?: (msg: string) => void, excludeSpaces?: string[], attempts?: number, deadline?: number | null }} options
 *   deadline: the step path's time box (performance.now() it must not run past; build.js stops asking after it)
 * @returns {Promise<Selection>}
 */
export async function selectPrimitives({ decomposition, registry, writer = null, log = () => {}, excludeSpaces = [], attempts = 2, deadline = null }) {
  const started = performance.now();
  if (!writer?.complete) throw Object.assign(Error('The step path needs a model: its choices (the space, the primitive for each mechanic among the options the declarations prove valid, the loop steps) are the model\'s, and nothing stands in for them.'), { status: 422, code: MODEL_MISSING });
  // A concept's loop the idea does not play (a skin relation marked it flavor) is never selected: no candidates, no pick.
  const unplayed = unplayedLoops(decomposition);
  // The collection is built iteratively (build.js): the space first, then one mechanic at a time, each pick checked
  // (composition, closure, adapters) before the next.
  const built = await buildSelection({ decomposition, registry, writer, log, excludeSpaces, attempts, deadline });
  /** @type {SelectedMechanic[]} */
  const mechanics = decomposition.mechanics.map(m => {
    const map = unplayed.has(m.id) ? null : built.mapping[m.id];
    return { ...m, candidates: map?.candidates ?? [], primitives: [...(map?.primitives ?? [])], source: unplayed.has(m.id) ? 'unplayed' : 'build', score: map?.primitives.length ? 1 : 0 };
  });
  /** @type {Set<string>} */
  const chosen = new Set(built.systems);
  /** @type {Gap[]} */
  const gaps = [...built.gaps];
  // The play spec's post-check: joined ideas whose loops each declare their own win need a mashup relation. Only that
  // field goes back to the model (askMashup, field-level).
  /** @type {MashupCheck | undefined} */
  let mashupCheck;
  const core = decomposition.core;
  const primitivesOf = (/** @type {string} */ id) => mechanics.find(m => m.id === id)?.primitives || [];
  const problem = core ? mashupProblem(decomposition, primitivesOf, registry) : null;
  if (core && problem) {
    const r = await askMashup({ writer, decomposition, registry, problem, attempts, recheck: mashup => mashupProblem({ mechanics: decomposition.mechanics, core: { ...core, mashup } }, primitivesOf, registry) });
    core.mashup = r.mashup;
    mashupCheck = { problem: problem.message, asked: r.attempts, mashup: r.mashup, model: r.model, ms: r.ms };
  }
  // Requirements closure and conflicts (card.requires, card.conflicts). Nothing else joins the collection here: a
  // primitive joins as a step's pick or as a declared requirement (the host supplies the input mapping: card.hostDefault).
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...chosen]) for (const req of requirementsOf(registry, id).primitives) {
      if ([...chosen].some(x => x === req || x.startsWith(req + '.'))) continue;
      const s = satisfying(registry, req); if (s) { chosen.add(s); changed = true; }
    }
  }
  for (const id of [...chosen]) for (const c of registry.get(id)?.card.conflicts || []) if (chosen.has(c) && c !== id) chosen.delete(c);
  for (const id of [...chosen].filter(isSpace)) chosen.delete(id);
  // A built collection keeps the space it was built on (never swapped): what joined after it (its requirements) is
  // checked against it here.
  const spaces = [built.space], bind = { ...built.bind };
  const unmet = unhosted(registry, [...chosen], built.space, built.bind, built.adapters);
  // A primitive no chosen space can host stays the user's intent: a core mechanic's primitive becomes an adapter gap
  // (the gap layer writes the adapter that projects it onto the space, gated by tests and the playtest agent), never
  // a quiet downgrade. The document published meanwhile leaves it out (it could not install).
  /** @type {AdapterInstance[]} */
  const adapters = [...built.adapters];
  const mashupAdapters = structuredClone(built.mashupAdapters);
  // Bindings to the chosen spaces (not to adapter regions): adapters are resolved from them, for the whole collection.
  const spaceIds = new Set(spaces.map(s => s.id));
  for (const u of unmet) {
    chosen.delete(u.id);
    // A registered adapter that projects what the space lacks keeps the primitive: its instances (with their config)
    // replace the ones resolved for what the spaces lack, and the primitive is bound to the adapter's region
    // (adapters.js resolveAdapters, run on the whole collection so the adapters already chosen are resolved again with
    // it). The instances realising the mashup relations (the build's adapter steps) and their bindings are kept.
    /** @type {import('./adapters.js').AdapterResolution | null} */
    let r = null;
    const own = Object.fromEntries(Object.entries(bind).filter(([, s]) => spaceIds.has(s)));
    try { r = resolveAdapters({ spaces, systems: [...chosen, u.id], bind: own }, registry); } catch { r = null; }
    if (r?.verdict === 'compatible-via-adapter') {
      chosen.add(u.id);
      const kept = keepMashupAdapters(r, { adapters, bind, mashupAdapters });
      for (const k of Object.keys(bind)) delete bind[k];
      Object.assign(bind, own, kept.bind);
      adapters.splice(0, adapters.length, ...kept.adapters);
      continue;
    }
    // An adapter projects a primitive onto a space that lacks what it needs; when NO registered space provides it,
    // the missing piece is a space capability (a capability gap), not an adapter.
    const hostable = registry.ids('engine').filter(isSpace).some(id => spaceVariants(registry, id).some(v => u.missing.every(c => v.caps.has(c))));
    const coreUse = hostable && mechanics.some(m => m.importance === 'core' && m.primitives.includes(u.id));
    // The adapter that would fix it (adapterSignature, an AdapterSpec card) goes to the gap layer; it is described in one line.
    const adapter = r?.gaps[0] || r?.before.signature || undefined;
    const signature = `${u.id} -> ${spaces[0]?.use || 'space'} (${u.missing.join(', ')})${adapter?.id ? ` as ${adapter.id}` : ''}`;
    const verdict = r ? { verdict: r.verdict } : null;
    for (const m of mechanics) if (m.primitives.includes(u.id)) {
      m.primitives = m.primitives.filter(x => x !== u.id);
      if (coreUse && m.importance === 'core') gaps.push({ mechanic: m.id, description: `needs adapter: ${signature}`, importance: 'core', kind: 'adapter', primitive: u.id, signature, ...(adapter ? { adapter } : {}), verdict: verdict?.verdict || 'incompatible-needs-adapter', why: `${u.id} needs ${u.missing.join(', ')}, which ${spaces[0]?.use || 'the space'} does not provide; an adapter primitive can project it` });
      else if (!m.primitives.length) gaps.push({ mechanic: m.id, description: m.description, importance: m.importance, kind: 'capability', why: `${u.id} needs ${u.missing.join(', ')}, which no registered space provides` });
    }
  }
  // Base locomotion follows the idea: the primary view and the avatar's medium (cards declare locomotion and medium).
  const loco = locomotionCompleteness({ decomposition, registry, chosen, space: spaces[0], mechanics });
  if (loco.gap) gaps.push({ mechanic: 'movement', description: `needs movement: ${loco.gap}`, importance: 'core', kind: 'no_primitive', why: `${loco.gap}; the world is kept, not swapped` });
  // A generator a mechanic named goes to the first chosen space its card targets (card.spaces); one that targets
  // none of them is dropped, never bound to a space it can't build.
  /** @type {GeneratorChoice[]} */
  const generators = [];
  /** @type {DroppedGenerator[]} */
  const dropped = [];
  for (const id of [...chosen].filter(isGenerator)) {
    const s = spaces.find(x => targets(registry, id, x.use));
    if (s) generators.push({ id, space: s.id }); else { dropped.push({ id, why: `targets ${(/** @type {RegisteredPrimitive} */ (registry.get(id)).card.spaces || []).join(', ') || 'no space'}; chosen: ${spaces.map(x => x.use).join(', ')}` }); chosen.delete(id); }
  }
  for (const d of dropped) for (const m of mechanics) m.primitives = m.primitives.filter(x => x !== d.id);
  const systems = [...chosen].filter(id => !isGenerator(id) && !isSpace(id)).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  // Every space gets the world its card declares it needs (card.needs.content), as the composition check reads it
  // (space-content.js): what it lacks once what it carries, the outline's zones and the collection give it are counted
  // is built by the generators whose cards declare that content (planWorld), even when no mechanic named one; the
  // outline's scaffold pass fills each generator's params. A space that declares
  // alternative worlds (card.needs.alternatives: terrain and roads, or rooms) none of which the collection already
  // meets gets one small model choice among them (pick_world): the idea's words never decide it.
  /** @type {Record<string, string[]>} */
  const worlds = {};
  const ask = makeAsk({ writer, attempts, log, deadline });
  for (const s of spaces) {
    const sets = needSets(registry, s.use);
    if (!sets.length) continue;
    const have = [...selectedContent(registry, s, systems), ...generators.filter(g => g.space === s.id).flatMap(g => contentOfGenerator(registry, g.id))];
    const exclude = generators.filter(g => g.space === s.id).map(g => g.id);
    let set = sets.find(x => x.every(k => have.includes(k))) ?? null;
    if (!set && sets.length > 1) {
      const name = (/** @type {string[]} */ x) => x.join('+');
      const a = await ask({ name: 'pick_world', field: 'world', options: sets.map(name),
        system: 'You choose what the world of a game is built from. The space declares the worlds it can be; pick the ONE the idea is played in.',
        user: `Game idea: ${decomposition.premise}\nSpace: ${s.use}\nCollection: ${systems.join(', ')}\n\nWorlds this space declares (what its generators build):\n${sets.map(x => `- ${name(x)}: ${planWorld(registry, s, { view: decomposition.views?.[0], have, exclude, set: x }).generators.join(', ') || 'no registered generator'}`).join('\n')}` });
      set = sets.find(x => name(x) === a.pick) ?? null;
      if (set) worlds[s.id] = set;
    }
    const plan = planWorld(registry, s, { view: decomposition.views?.[0], have, exclude, set });
    for (const id of plan.generators) generators.push({ id, space: s.id, auto: true });
  }
  return {
    version: SELECT_VERSION, mechanics: mechanics.map(({ candidates, ...m }) => ({ ...m, candidates: candidates.slice(0, 3) })),
    // Renderers, UI and audio are chosen by the host from the document's systems and spaces
    // (graphics/ui-defaults.js withDefaultGraphics); the planner adds graphics only when a mechanic needs one.
    systems, generators, graphics: [], spaces, bind, gaps, provider: 'build', ...(Object.keys(worlds).length ? { worlds } : {}), ...(built.win && systems.includes(built.win.use) ? { win: built.win } : {}), ...(adapters.length ? { adapters } : {}), ...(mashupAdapters.length ? { mashupAdapters } : {}), completeness: { locomotion: loco, ...(mashupCheck ? { mashup: mashupCheck } : {}) }, ...(dropped.length ? { droppedGenerators: dropped } : {}),
    build: { version: built.version, loop: built.loop, spaceStep: built.spaceStep, steps: built.steps, contracts: built.contracts, calls: built.calls, ms: built.ms }, ms: Math.round(performance.now() - started),
  };
}
/**
 * Primitives of a collection the space does not host (capabilities it lacks, with the adapters already chosen), from
 * the composition check's capability failures. @param {RegistryLike} registry @param {string[]} ids @param {SpaceChoice} space
 * @param {Record<string, string>} bind @param {AdapterInstance[]} adapters @returns {Unmet[]}
 */
function unhosted(registry, ids, space, bind, adapters) {
  const r = checkComposition({ spaces: [space], systems: ids.filter(id => !isSpace(id)), bind, adapters }, registry, { resolve: false });
  /** @type {Map<string, string[]>} */
  const missing = new Map();
  for (const f of r.failures) if (f.code === 'capability_missing' && f.need && ids.includes(f.unit)) missing.set(f.unit, [...(missing.get(f.unit) || []), f.need.item]);
  return [...missing].map(([id, caps]) => ({ id, missing: caps, why: `${space.use} does not provide ${caps.join(', ')}` }));
}
// Install order inside systems[]: engine runtime first, then gameplay, then plot (catalog §0 convention).
/** @param {string} id */
const order = id => id.startsWith('engine.') ? 0 : id.startsWith('gameplay.') ? 1 : 2;

// ---------- selection completeness ----------

/** @param {{ views?: string[] }} decomposition @returns {string | null} */
const primaryOf = decomposition => (decomposition.views || []).find(v => v !== 'ui') || null;
/** @param {{ views?: string[] }} card @param {string | null} view */
const supportsView = (card, view) => !view || (card.views || []).includes(view) || (card.views || []).includes('any');

/**
 * How a movement card moves, from its own envelope declaration ('discrete' = cell by cell, else continuous); null when
 * the card declares no envelope. @param {any} card @returns {string | null}
 */
export function movementStyle(card) {
  try { const m = typeof card?.envelope === 'function' ? card.envelope({}, new Set(), {})?.mode : null; return typeof m === 'string' ? m : null; } catch { return null; }
}
/**
 * Does a movement card match the play spec's interaction? avatar-grid steps cell by cell (a discrete envelope);
 * any other avatar interaction (avatar-realtime) never does. Other interactions and unknown styles do not constrain.
 * @param {any} card @param {string | null | undefined} interaction
 */
export function fitsInteraction(card, interaction) {
  if (!interaction || !interaction.startsWith('avatar')) return true;
  const style = movementStyle(card);
  if (!style) return true;
  return interaction === 'avatar-grid' ? style === 'discrete' : style !== 'discrete';
}

/**
 * Base locomotion cards that fit a space, a primary view and a medium, best first. Hard filters: base locomotion,
 * capabilities the space provides, the primary view. Preference: the wanted medium, then specialisation.
 * Cards declare `locomotion` and `medium` outside the kernel's CardInput fields (read through its index signature).
 * @param {RegistryLike} registry
 * @param {{ caps?: string[], view?: string | null, medium?: string | null, exclude?: string[], interaction?: string | null }} [options]
 * @returns {Array<{ id: string, medium: string | null, score: number }>}
 */
export function baseLocomotion(registry, { caps = [], view = null, medium = null, exclude = [], interaction = null } = {}) {
  const have = new Set(caps);
  return registry.cards('gameplay').filter(c => c.locomotion === 'base' && !exclude.includes(c.id) && fitsInteraction(c, interaction) && (c.requires?.capabilities || []).every(x => have.has(x)) && supportsView(c, view))
    // Specialisation breaks ties: a card that needs more of what this space provides (gravity for jumping) and is made
    // for fewer views fits it better than a general one (the side-view platformer over walking, on a side-view tilemap).
    .map(c => ({ id: c.id, medium: str(c.medium) || null, score: ((c.views || []).includes(/** @type {string} */ (view)) ? 10 : 1) + (medium && c.medium === medium ? 5 : 0) + (c.requires?.capabilities || []).length + 2 / Math.max(1, (c.views || []).length) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * The avatar moves the way the idea says: a base locomotion that lacks the primary view is replaced; a lone base
 * locomotion in the wrong medium (flying through a walking dungeon) is replaced by one in the right medium; an idea
 * whose avatar moves but has no base locomotion gets one. movement 'none' (cards, boards, falling pieces) adds nothing.
 * Mutates `chosen` and the mechanics' primitive lists; returns what it did.
 * @param {{ decomposition: { views?: string[], movement?: string, core?: { interaction?: string | null, loop?: string } | null }, registry: RegistryLike, chosen: Set<string>, space: SpaceChoice | undefined, mechanics?: SelectedMechanic[] }} options
 * @returns {LocomotionResult}
 */
export function locomotionCompleteness({ decomposition, registry, chosen, space, mechanics = [] }) {
  const view = primaryOf(decomposition), medium = decomposition.movement || null;
  const interaction = decomposition.core?.interaction || null;
  /** @type {LocomotionResult} */
  const out = { view, medium, removed: [], added: null };
  // ids below come from `chosen`, which holds registered ids only.
  const cardOf = (/** @type {string} */ id) => /** @type {RegisteredPrimitive} */ (registry.get(id)).card;
  if (!space) return out;
  const present = [...chosen].filter(id => registry.get(id)?.card.locomotion === 'base');
  const drop = (/** @type {string} */ id) => { chosen.delete(id); out.removed.push(id); for (const m of mechanics) if (Array.isArray(m.primitives)) m.primitives = m.primitives.filter(x => x !== id); };
  for (const id of present) if (!supportsView(cardOf(id), view) || !fitsInteraction(cardOf(id), interaction)) drop(id);
  let left = present.filter(id => chosen.has(id));
  // Exactly one base locomotion: the best fit stays, the rest were guesses.
  if (left.length > 1) {
    const rank = baseLocomotion(registry, { caps: space.caps, view, medium, interaction }).map(c => c.id);
    const at = (/** @type {string} */ id) => rank.includes(id) ? rank.indexOf(id) : Infinity;
    const keep = [...left].sort((a, b) => at(a) - at(b) || a.localeCompare(b))[0];
    for (const id of left) if (id !== keep) drop(id);
    left = [keep];
  }
  // No avatar (cards, boards, falling pieces): nothing to add.
  if (interaction && !interaction.startsWith('avatar')) return out;
  const wrongMedium = Boolean(medium && medium !== 'none' && left.length && left.every(id => cardOf(id).medium && cardOf(id).medium !== medium));
  if (medium === 'none' || (left.length && !wrongMedium)) return out;
  const best = baseLocomotion(registry, { caps: space.caps, view, medium, exclude: left, interaction }).find(c => !medium || c.medium === medium || !c.medium);
  // A space that navigates its own places (travel between zones) moves the avatar itself; agency is then checked on the
  // built game (the publish gate: cannot_act). Otherwise no fitting base movement is a gap.
  if (!best) { if (!left.length && !space.caps.includes('navigate')) out.gap = `no base movement fits ${space.id || 'the space'}${interaction ? ` for ${interaction}` : ''}${medium ? ` (${medium})` : ''}`; return out; }
  if (wrongMedium) for (const id of left) drop(id);
  chosen.add(best.id); out.added = best.id;
  // It joins the core loop mechanic the play spec names (core.loop), else no mechanic: the collection has it either way.
  const loop = prop(decomposition.core, 'loop');
  const host = isStr(loop) ? mechanics.find(m => m.id === loop) : undefined;
  if (host && Array.isArray(host.primitives) && !host.primitives.includes(best.id)) host.primitives.push(best.id);
  return out;
}
