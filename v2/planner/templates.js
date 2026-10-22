// @ts-check
// The template path (ARCHITECTURE.md §5): one strict model call picks the templates and relations the idea names,
// code composes the primary template's verified document, and parallel strict content forms derived from that
// document theme its named entries and set its declared `tune` params. Every answer is checked; a failing form
// re-asks only its failing fields, then that form alone goes once to the escalation writer, then the build fails
// saying what is wrong. Nothing here reads the idea's words: structure comes from the templates' documents and the
// cards in them, judgement from the model's small checked choices.
import { specSchema, decode, fieldForm, formKey, answerProblems, obj as strictObj, arr as strictArr } from './outline-form.js';
import { cardLoop } from './loop.js';
import { modesIn } from '../primitives/gameplay/modes-lib-mode.js';
import { parseReply } from './writer.js';
import { preflight } from '../kernel/document.js';
import { isObj, isStr, objects, prop, messageOf } from '../kernel/guards.js';
import { buildLogic } from '../kernel/world.js';
import { Logic } from '../kernel/logic.js';
import { composeNested, composeUnion, entryTriggers, innerLoops, definedIds, prefixOf } from './compose.js';
import { instanceVerbs } from '../primitives/engine/runtime-lib-controls.js';
import { rulesOn } from '../kernel/rules.js';
import { sectionShape, NAME_PATTERN } from '../kernel/sections.js';
import { variantFields } from '../kernel/params.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('../kernel/types.js').ParamSchema} ParamSchema */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./types.js').ReplySchema} ReplySchema */
/**
 * A tune entry: '<primitive id>.<param>' (the card's whole range is playable), or the playable range where it is narrower
 * than the card's: { path, min?, max? } for a number or integer, { path, options } for a closed set of strings.
 * @typedef {string | TuneRange} TuneEntry
 */
/** @typedef {{ path: string, min?: number, max?: number, options?: string[] }} TuneRange */
/** A template (v2/templates/<id>.js). @typedef {{ id: string, concept: string, doc: Record<string, any>, tune: TuneEntry[] }} Template */
/** The primary: the one game or genre played. @typedef {{ name: string, kind: string, template: string }} PickPrimary */
/** Another game or genre the idea plays, nested in or united with the primary. @typedef {PickPrimary & { relation: string }} PickGame */
/**
 * Another way the idea reads one of its concepts (the pick names it by its name): a game read as a theme, setting or
 * character, a theme read as a game, or a game joined the other way. @typedef {{ name: string, kind: string, template: string, relation: string }} PickReading
 */
/** A player-facing mechanic the idea names: a short verb phrase, the idea's own words for it (says), the declared verb that is it (or none), how much the idea needs it. @typedef {{ name: string, says?: string, verb: string, importance: string }} PickMechanic */
/**
 * The pick as the model wrote it (strings kept as written: the check reports an unknown value).
 * @typedef {{ title: string, premise: string, primary: PickPrimary, games: PickGame[], themes: Theme[], readings: PickReading[], mechanics: PickMechanic[] }} Pick
 */
/** A question the template path stops with: one choice between the readings of one concept (options[i] reads as picks[i]). @typedef {{ id: string, question: string, options: string[], picks: Pick[] }} ReadingQuestion */
/** A finding with the form field it names (a fieldForm path). @typedef {{ code: string, field: string, message: string }} FormProblem */
/** @typedef {{ code: string, path: string, message: string }} TemplateProblem */
/** One model call of the template path. @typedef {{ form: string, fields?: string[], model: string | null, ms: number, escalated?: boolean, problems?: string[], error?: string }} TemplateCall */
/** @typedef {{ name: string, kind: string }} Theme */
/** @typedef {{ use: string, param: string, spec: ParamSchema, instances: Array<Record<string, any>> }} TuneTarget */
/** Time spent in code (narrowing, checks, composition), excluding model calls. @typedef {{ codeMs: number }} Clock */

export const TEMPLATE_PATH_VERSION = 'template-path/0.1';
/** The kinds that bring a loop of their own (§1.3): the primary and the other games are these. */
export const LOOP_KINDS = Object.freeze(['game', 'genre']);
/** The kinds that only theme the content forms (§1.3): the themes are these. */
export const THEME_KINDS = Object.freeze(['theme', 'setting', 'character']);
export const PICK_KINDS = Object.freeze([...LOOP_KINDS, ...THEME_KINDS]);
/** How another game joins the primary. */
export const PLAYED_RELATIONS = Object.freeze(['nested', 'union']);
/** How a theme read as a game joins the primary (`none` for a reading that is a theme, setting or character). */
export const READING_RELATIONS = Object.freeze(['none', ...PLAYED_RELATIONS]);
/** How much the idea needs a mechanic it names: neither is ever dropped (an extension that cannot be built fails the build). */
export const IMPORTANCE = Object.freeze(['core', 'extra']);
/** A themed name: the kernel's name rule (kernel/sections.js NAME_PATTERN), re-exported for the forms' callers. */
export { NAME_PATTERN };
/** Free text the model must write (title, premise, logline, a concept's name): at least one non-space character. */
export const TEXT_PATTERN = '\\S';
const TEXT_RE = new RegExp(TEXT_PATTERN, 'u');

/** @param {string} description @returns {Record<string, unknown>} */
const text = description => ({ type: 'string', pattern: TEXT_PATTERN, description });
/** @param {readonly string[]} values @param {string} description @returns {Record<string, unknown>} */
const choice = (values, description) => ({ type: 'string', enum: [...values], description });

/** Every primitive instance in a document (systems, spaces, their generators) with its document path. @param {Record<string, any>} doc */
export function instancesWithPaths(doc) {
  /** @type {Array<{ inst: Record<string, any>, path: string }>} */
  const out = [];
  (Array.isArray(doc.systems) ? doc.systems : []).forEach((/** @type {Record<string, any>} */ s, /** @type {number} */ i) => out.push({ inst: s, path: `systems[${i}]` }));
  (Array.isArray(doc.spaces) ? doc.spaces : []).forEach((/** @type {Record<string, any>} */ s, /** @type {number} */ i) => {
    out.push({ inst: s, path: `spaces[${i}]` });
    (Array.isArray(s.generators) ? s.generators : []).forEach((/** @type {Record<string, any>} */ g, /** @type {number} */ j) => out.push({ inst: g, path: `spaces[${i}].generators[${j}]` }));
  });
  return out;
}
/** @param {Record<string, any>} doc */
export const instancesIn = doc => instancesWithPaths(doc).map(x => x.inst);

/**
 * A tune path '<primitive id>.<param>' resolved against the document's instances and the primitive's card (the longest
 * primitive id that prefixes the path); null when no instance's card declares that param.
 * @param {Record<string, any>} doc @param {string} path @param {RegistryLike} registry @returns {TuneTarget | null}
 */
export function tuneTarget(doc, path, registry) {
  const uses = new Set(instancesIn(doc).map(i => String(i.use)));
  const use = [...uses].filter(u => path.startsWith(`${u}.`)).sort((a, b) => b.length - a.length)[0];
  if (!use) return null;
  const param = path.slice(use.length + 1), spec = /** @type {ParamSchema | undefined} */ (registry.get(use)?.card?.params?.[param]);
  return spec ? { use, param, spec, instances: instancesIn(doc).filter(i => i.use === use) } : null;
}

/** A template's tune entries as ranges ({ path } where the card's whole range is playable). @param {{ tune: readonly TuneEntry[] }} template @returns {TuneRange[]} */
export const tuneRanges = template => template.tune.map(e => (typeof e === 'string' ? { path: e } : { ...e }));
/** @param {TuneEntry} e */
const pathOfEntry = e => (typeof e === 'string' ? e : e.path);
/** A template's tune paths. @param {{ tune: readonly TuneEntry[] }} template @returns {string[]} */
export const tunePaths = template => tuneRanges(template).map(e => e.path);

/**
 * The spec a tune slot allows: the card's param narrowed by the template's playable range (ARCHITECTURE §5: the values
 * the model may set keep the game playable; the template contract's bounds stage proves its bot wins at every bound).
 * @param {ParamSchema} spec @param {TuneRange} range @returns {ParamSchema}
 */
export function tunedSpec(spec, range) {
  return { ...spec, ...(range.min !== undefined ? { min: range.min } : {}), ...(range.max !== undefined ? { max: range.max } : {}), ...(range.options ? { options: [...range.options] } : {}) };
}

/** The templates code can compose in this catalogue: every primitive their document uses is registered. @param {readonly Template[]} templates @param {RegistryLike} registry */
export const offeredTemplates = (templates, registry) => templates.filter(t => instancesIn(t.doc).every(i => registry.has(String(i.use))));

// ---------------------------------------------------------------------------------------------------------------
// 1. The pick: one strict form whose structure makes every structurally invalid pick inexpressible, checked by code
//    against that same schema plus the rules that need the catalogue.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The pick's rules, each with its stable code. The form's schema guarantees the structure (exactly one primary, a
 * game or genre; other games only nested or union; themes, settings and characters only themes, with no template);
 * `pick_form` is that same schema held against the answer (outline-form answerProblems), for writers that do not
 * enforce it. The template enum is the offered templates' ids, so a template that does not exist is a `pick_form`
 * problem at its field. The rules below it need the catalogue.
 */
export const PICK_RULES = Object.freeze({
  pick_form: 'the answer satisfies the pick form\'s schema: its fields, enums (kinds, template ids, relations, verbs) and patterns',
  pick_nested_no_entry: 'a nested game needs a primary whose template\'s loops declare an entry event (card.loop.involves)',
  pick_nested_no_outcome: 'a nested game\'s template plays a loop that declares an encounter outcome (card.loop.outcome) and how an encounter starts it (card.engage.encounter.start)',
  pick_reading_unknown: 'a reading names a concept of the pick (the primary, a game or a theme) by its name, exactly as written',
  pick_reading_duplicate: 'a concept has at most one other reading',
  pick_reading_invalid: 'a reading is the concept\'s other kind or relation: a theme, setting or character read as a game or genre joined nested or union (with its template); a game or genre read as a theme, setting or character (template none, relation none); a joined game read with its other relation (its own template); never the primary read as a game again',
  pick_reading_no_primary: 'the primary read as a theme, setting or character leaves exactly one other game to be the primary',
  pick_reading_fails: 'the pick read the other way passes the pick\'s own rules',
  pick_mechanic_unsaid: 'a mechanic is one the idea names: its `says` is the idea\'s own words, copied exactly',
  pick_mechanic_is_concept: 'a mechanic\'s words are not a concept\'s: the words of the primary, a game or a theme are that concept\'s (a theme restyles, it is never played)',
});

/** @type {WeakMap<object, string[]>} */
const verbsCache = new WeakMap();
/**
 * Every player verb a card of the catalogue declares (card.loop.verbs, via cardLoop), sorted: the closed set a mechanic's
 * verb is named from. @param {RegistryLike} registry @returns {string[]}
 */
export function catalogueVerbs(registry) {
  let v = verbsCache.get(registry);
  if (!v) { v = [...new Set(registry.cards().flatMap(c => cardLoop(c)?.verbs ?? []))].sort(); verbsCache.set(registry, v); }
  return v;
}

/**
 * The player verbs a document's primitives give the player (card.loop.verbs; card.loop.verbsOf when a card declares its
 * verbs depend on the instance: runtime-lib-controls.js instanceVerbs), each with the primitives giving it.
 * @param {Record<string, any>} doc @param {RegistryLike} registry @returns {Map<string, string[]>}
 */
export function declaredVerbs(doc, registry) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const inst of instancesIn(doc)) {
    const use = String(inst.use), card = registry.get(use)?.card;
    const verbs = typeof prop(prop(card, 'loop'), 'verbsOf') === 'function' ? /** @type {string[]} */ (instanceVerbs(card, inst, doc)) : cardLoop(card)?.verbs ?? [];
    for (const verb of verbs) if (!(out.get(verb) ?? []).includes(use)) out.set(verb, [...(out.get(verb) ?? []), use]);
  }
  return out;
}

/** The pick's strict form. @param {readonly Template[]} templates @param {RegistryLike} registry @returns {ReplySchema} */
export function pickForm(templates, registry) {
  const ids = [...templates.map(t => t.id), 'none'];
  const template = (/** @type {string} */ what) => choice(ids, `the template whose concept IS ${what}; none when no template is (never the closest one)`);
  return { name: 'pick_templates', schema: strictObj({
    title: text('the game\'s title'),
    premise: text('two or three sentences: the world, the player, the goal'),
    primary: strictObj({
      name: text('the one game or genre the player plays, as the idea names it; a named game and its genre are this one concept: name the game'),
      kind: choice(LOOP_KINDS, 'game: a game the idea names; genre: a kind of game'),
      template: template('this game or its genre'),
    }, 'the primary: the one game or genre the player plays'),
    games: strictArr(strictObj({
      name: text('the game or genre as the idea names it'),
      kind: choice(LOOP_KINDS, 'game: a game the idea names; genre: a kind of game'),
      template: template('this game or genre'),
      relation: choice(PLAYED_RELATIONS, 'nested: a game entered from inside the primary; union: a game played alongside the primary on the same space'),
    }), 'every OTHER game or genre the idea also plays, each with its own loop (never the primary\'s own genre); [] when the idea plays one game'),
    themes: strictArr(strictObj({
      name: text('the theme, setting or character as the idea names it'),
      kind: choice(THEME_KINDS, 'theme, setting or character: restyles the primary\'s content, never played'),
    }), 'every theme, setting and character the idea names or implies; [] when none'),
    readings: strictArr(strictObj({
      name: text('the name of ONE concept above (the primary, a game or a theme), exactly as written there'),
      kind: choice(PICK_KINDS, 'the concept read the other way: a game or genre (its loop is played) for a theme, setting or character; a theme, setting or character for a game or genre; a game or genre again for a joined game read with its other relation'),
      template: template('this concept read as a game or genre (a joined game keeps its own); none when it is read as a theme, setting or character'),
      relation: choice(READING_RELATIONS, 'how the concept read as a game joins the primary (nested or union); none when it is read as a theme, setting or character'),
    }), 'every concept the idea can ALSO mean another way, so the player is asked instead of guessed for: a name that is both a game (its loop is played) and a character or theme in another game, or a game that could join the primary the other way; [] when the idea reads one way'),
    mechanics: strictArr(strictObj({
      name: text('the mechanic as a short verb phrase, as the idea says it'),
      says: text('the idea\'s own words that ask for this mechanic, copied exactly from the idea (never a theme\'s, a setting\'s, a character\'s or a game\'s words)'),
      verb: choice([...catalogueVerbs(registry), 'none'], 'the player verb a primitive declares (card.loop.verbs) that IS this mechanic; none when no declared verb is'),
      importance: choice(IMPORTANCE, 'core: the idea is not itself without it; extra: it adds to the idea'),
    }), 'every player-facing mechanic the idea names (what the player can DO) that the chosen templates\' loops do not declare (each template lists its verbs); [] when the templates give the idea all it names'),
  }) };
}

/**
 * The loops a template carries, as their cards declare them (card.mode via modesIn; how it is played and who plays
 * against the player via cardLoop): its own loops, and the wrapper modes that sequence them. A template carrying no
 * loop of its own is a template defect (422 'template_defect').
 * @param {Template} template @param {RegistryLike} registry
 * @returns {{ loops: Array<{ loop: string, interactions: string[], opponent: string | null }>, wrappers: string[] }}
 */
export function templateLoops(template, registry) {
  const modes = modesIn(template.doc, registry).map(m => ({ m, loop: cardLoop(registry.get(m.use)?.card) }));
  const loops = modes.filter(x => !x.m.mode.wraps).map(x => ({ loop: String(x.m.mode.loop), interactions: x.loop?.interactions ?? [], opponent: x.loop?.opponent ?? null }));
  if (!loops.length) throw Object.assign(Error(`template '${template.id}' carries no loop of its own (card.mode)`), { status: 422, code: 'template_defect', problems: [{ code: 'template_loop_undeclared', path: template.id, message: 'a template carries at least one card.mode loop that is not a wrapper' }] });
  return { loops, wrappers: modes.filter(x => x.m.mode.wraps).map(x => String(x.m.mode.loop)) };
}

/**
 * The pick's instructions: the templates grouped by the loops their cards declare (loop id, how it is played, who
 * plays against the player), each template as `id: concept`. Derived from the cards in the templates' documents.
 * @param {readonly Template[]} templates @param {RegistryLike} registry
 */
export function pickSystem(templates, registry) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const t of templates) {
    const { loops, wrappers } = templateLoops(t, registry);
    const family = loops.map(l => `${l.loop} (played ${l.interactions.join(' or ') || 'in the interaction it wraps'}; opponent: ${l.opponent ?? 'undeclared'})`).join(' + ');
    const verbs = [...declaredVerbs(t.doc, registry).keys()];
    groups.set(family, [...(groups.get(family) ?? []), `- ${t.id}: ${t.concept}${wrappers.length ? ` (sequenced by ${wrappers.join(', ')})` : ''} [verbs: ${verbs.join(', ') || 'none'}]`]);
  }
  const listing = [...groups].map(([family, lines]) => `Loop ${family}:\n${lines.join('\n')}`).join('\n') || '(no templates in this catalogue)';
  return `You pick how a game idea is built from verified game templates.
Templates, grouped by the loop they are played with (the loop, how the player plays it, who plays against the player), each as id: concept:
${listing}

Fill the form:
- primary: the ONE game or genre the player plays. A named game and its genre are one concept: a game named with its genre ("a Mario game", "a Zelda-style dungeon") is that game (kind game) with the template of its genre, never the game and its genre as two concepts. template: the template whose concept IS that game or its genre, or none when no template is (never the closest one).
- games: every OTHER game or genre the idea also plays, with its own loop: nested (entered from inside the primary) or union (played alongside it on the same space); [] when the idea plays one game.
- themes: every theme, setting and character the idea names or implies (a character the player plays as, a place, a look): it restyles the primary's content and is never played.
- readings: never guess between meanings. When the idea can mean a concept another way (a name that is both a game and a character: "Sonic" may be the platformer game, or the character racing in a kart game; a game that could be entered from the primary or played alongside it), write the pick for one reading and list the other here: the player chooses. [] when the idea reads one way.
- mechanics: what the player can DO that the idea names and the chosen templates' verbs do not give ("has a gun" in a racing game), each with the idea's own words that ask for it (says, copied exactly), the declared verb that is it (none when no verb is) and whether the idea needs it (core) or it adds to it (extra). Each is built onto the template, never dropped. A theme, setting or character is not a mechanic: what it might suggest the player does ("a sunken city" suggests swimming) is never one unless the idea says it. [] when the templates give it all.
Also write the game's title and premise.`;
}

/** @param {unknown} v @returns {PickPrimary} */
const narrowPrimary = v => ({ name: String(prop(v, 'name') ?? ''), kind: String(prop(v, 'kind') ?? ''), template: String(prop(v, 'template') ?? '') });
/** The pick as written, narrowed (strings kept as written; the check reports what is wrong). @param {unknown} v @returns {Pick} */
export const narrowPick = v => ({
  title: String(prop(v, 'title') ?? ''), premise: String(prop(v, 'premise') ?? ''),
  primary: narrowPrimary(prop(v, 'primary')),
  games: objects(prop(v, 'games')).map(c => ({ ...narrowPrimary(c), relation: String(c.relation ?? '') })),
  themes: objects(prop(v, 'themes')).map(c => ({ name: String(c.name ?? ''), kind: String(c.kind ?? '') })),
  readings: objects(prop(v, 'readings')).map(c => ({ name: String(c.name ?? ''), kind: String(c.kind ?? ''), template: String(c.template ?? ''), relation: String(c.relation ?? '') })),
  mechanics: objects(prop(v, 'mechanics')).map(c => ({ name: String(c.name ?? ''), says: String(c.says ?? ''), verb: String(c.verb ?? ''), importance: String(c.importance ?? '') })),
});

/** The entry events a document's loops declare (card.loop.involves; compose.js entryTriggers). @param {Record<string, any>} doc @param {RegistryLike} registry */
export function entryEvents(doc, registry) {
  return entryTriggers(doc, registry).map(t => ({ use: t.use, event: t.event }));
}

/** Text compared as written, case and runs of spaces aside. @param {string} t */
const plain = t => t.toLowerCase().replace(/\s+/g, ' ').trim();
/** Where `part` is written in `text` ([start, end), compared plain), or null. @param {string} text @param {string} part */
const spanOf = (text, part) => { const p = plain(part), i = p ? plain(text).indexOf(p) : -1; return i < 0 ? null : [i, i + p.length]; };

/**
 * The mechanics' words held to the idea (pick_mechanic_unsaid, pick_mechanic_is_concept): each mechanic's `says` is
 * written in the idea, and none of it is the words of a concept the pick names (the primary, a game, a theme) where the
 * idea writes them. The pick partitions the idea's words: a concept's are that concept's, a mechanic's its own.
 * @param {Pick} pick @param {string} prompt @returns {FormProblem[]}
 */
export function mechanicProblems(pick, prompt) {
  /** @type {FormProblem[]} */
  const out = [];
  const concepts = [pick.primary, ...pick.games, ...pick.themes].map(c => ({ name: c.name, span: spanOf(prompt, c.name) }));
  pick.mechanics.forEach((m, i) => {
    const at = spanOf(prompt, m.says ?? '');
    if (!at) { out.push({ code: 'pick_mechanic_unsaid', field: `mechanics[${i}].says`, message: `the idea does not say "${m.says ?? ''}": a mechanic is one the idea names, its words copied exactly; remove it from mechanics when the idea does not name it (mechanics: [] when the idea names none)` }); return; }
    // A concept's words: where the idea writes its name, or (a name not written as such) the name itself.
    const c = concepts.find(x => (x.span ? x.span[0] < at[1] && at[0] < x.span[1] : false) || (plain(x.name) !== '' && (plain(x.name).includes(plain(m.says ?? '')) || plain(m.says ?? '').includes(plain(x.name)))));
    if (c) out.push({ code: 'pick_mechanic_is_concept', field: `mechanics[${i}].says`, message: `"${m.says}" is words of '${c.name}', a concept the pick names: a game is played by its template and a theme, setting or character restyles it, neither is a mechanic; remove it from mechanics when the idea names no other` });
  });
  return out;
}

/**
 * The pick's mechanics split by the idea's words (mechanicProblems): `kept`, the ones the idea names; `removed`, each
 * entry that is no mechanic the idea names (its words not in the idea, or a concept's), with why. Code repairs the pick
 * before its check (an entry outside the field's definition is not a mechanic of the idea, so nothing the idea names is
 * dropped); the removed entries go into the build's report.
 * @param {Pick} pick @param {string} prompt
 * @returns {{ kept: PickMechanic[], removed: Array<{ name: string, says: string, why: string }> }}
 */
export function namedMechanics(pick, prompt) {
  const bad = new Map(mechanicProblems(pick, prompt).map(p => [Number(/\[(\d+)\]/.exec(p.field)?.[1]), p]));
  return { kept: pick.mechanics.filter((_, i) => !bad.has(i)),
    removed: pick.mechanics.flatMap((m, i) => { const p = bad.get(i); return p ? [{ name: m.name, says: m.says ?? '', why: `${p.code}: ${p.message}`.slice(0, 240) }] : []; }) };
}

/**
 * The pick's readings split by their rules (checkPick's problems at readings[i]): `kept`, the other readings the
 * player can be asked about; `removed`, each reading no rule admits (the primary read as a theme with no other game to
 * play, a template or relation its kind does not take...), with why. An inadmissible reading is no other meaning of
 * the idea (it cannot be built), so code removes it before the check, never guessing between meanings: a valid
 * reading is still the player's question. The removed ones go into the build's report.
 * @param {Pick} pick @param {{ templates: readonly Template[], registry: RegistryLike }} ctx
 * @returns {{ kept: PickReading[], removed: Array<{ name: string, kind: string, why: string }> }}
 */
export function validReadings(pick, ctx) {
  const problems = checkPick(pick, ctx).problems, bad = new Map();
  for (const p of problems) { const i = /^readings\[(\d+)\]/.exec(p.field)?.[1]; if (i !== undefined && !bad.has(Number(i))) bad.set(Number(i), p); }
  return { kept: pick.readings.filter((_, i) => !bad.has(i)),
    removed: pick.readings.flatMap((r, i) => { const p = bad.get(i); return p ? [{ name: r.name, kind: r.kind, why: `${p.code}: ${p.message}`.slice(0, 240) }] : []; }) };
}

/**
 * The pick's code checks (PICK_RULES). Problems carry stable codes and the form field they name. A game or genre
 * with template 'none' is not a problem: it goes to the step path (`stepPath`: those concepts' names). With the idea
 * (`prompt`: the pick as asked, or resumed), its mechanics are held to its words (mechanicProblems).
 * @param {Pick} pick @param {{ templates: readonly Template[], registry: RegistryLike, prompt?: string }} ctx
 * @returns {{ problems: FormProblem[], stepPath: string[] }}
 */
export function checkPick(pick, { templates, registry, prompt }) {
  /** @type {FormProblem[]} */
  const problems = answerProblems(pickForm(templates, registry).schema, pick).map(p => ({ code: 'pick_form', field: p.path, message: p.message }));
  const outer = templates.find(t => t.id === pick.primary.template) ?? null;
  if (outer && !entryEvents(outer.doc, registry).length) pick.games.forEach((g, i) => {
    if (g.relation === 'nested') problems.push({ code: 'pick_nested_no_entry', field: `games[${i}].relation`, message: `'${g.name}' cannot be nested in '${outer.id}': no loop of its document declares an entry event (card.loop.involves)` });
  });
  pick.games.forEach((g, i) => {
    const inner = templates.find(t => t.id === g.template);
    if (g.relation === 'nested' && inner && !innerLoops(inner.doc, registry).length) problems.push({ code: 'pick_nested_no_outcome', field: `games[${i}].relation`, message: `'${g.name}' cannot be nested: no loop of '${inner.id}' declares an encounter outcome and how an encounter starts it (card.loop.outcome, card.engage.encounter.start)` });
  });
  // Every other reading is a pick of its own: the concept flipped, held to the same rules.
  pick.readings.forEach((r, i) => {
    if (pick.readings.findIndex(x => x.name === r.name) !== i) { problems.push({ code: 'pick_reading_duplicate', field: `readings[${i}].name`, message: `'${r.name}' already has another reading (readings[${pick.readings.findIndex(x => x.name === r.name)}])` }); return; }
    const alt = otherReading(pick, r);
    if (!alt.pick) { problems.push({ code: alt.code, field: `readings[${i}].${alt.field}`, message: alt.message }); return; }
    for (const p of checkPick(alt.pick, { templates, registry }).problems) problems.push({ code: 'pick_reading_fails', field: `readings[${i}]`, message: `read this way ('${r.name}' as ${r.kind}), ${p.field}: ${p.message}` });
  });
  if (prompt !== undefined) problems.push(...mechanicProblems(pick, prompt));
  const stepPath = [pick.primary, ...pick.games].filter(c => c.template === 'none').map(c => c.name);
  return { problems, stepPath };
}

/** The pick without its other readings: one reading of the idea. @param {Pick} pick @returns {Pick} */
const oneReading = pick => ({ ...structuredClone(pick), readings: [] });

/**
 * The pick read the other way for one concept (see PICK_RULES): a theme, setting or character read as a game joined
 * nested or union; a game or genre read as a theme, setting or character (the primary's only other game becomes the
 * primary); a joined game with its other relation. -> { pick } (its readings left out), or the problem with its field.
 * @param {Pick} pick @param {PickReading} r
 * @returns {{ pick: Pick, code?: undefined, field?: undefined, message?: undefined } | { pick: null, code: string, field: string, message: string }}
 */
export function otherReading(pick, r) {
  const bad = (/** @type {string} */ code, /** @type {string} */ field, /** @type {string} */ message) => ({ pick: null, code, field, message });
  const out = oneReading(pick);
  const asLoop = LOOP_KINDS.includes(r.kind), asTheme = THEME_KINDS.includes(r.kind);
  const game = pick.games.findIndex(g => g.name === r.name), theme = pick.themes.findIndex(t => t.name === r.name);
  if (pick.primary.name === r.name) {
    if (!asTheme) return bad('pick_reading_invalid', 'kind', `'${r.name}' is the primary, played already: its other reading is a theme, setting or character`);
    if (r.template !== 'none' || r.relation !== 'none') return bad('pick_reading_invalid', r.template !== 'none' ? 'template' : 'relation', `read as a ${r.kind}, '${r.name}' has no template and no relation`);
    if (pick.games.length !== 1) return bad('pick_reading_no_primary', 'kind', `read as a ${r.kind}, '${r.name}' leaves ${pick.games.length} other games and no single primary: the other reading needs exactly one other game to be played`);
    const [next] = pick.games;
    out.primary = { name: next.name, kind: next.kind, template: next.template };
    out.games = [];
    out.themes = [...out.themes, { name: r.name, kind: r.kind }];
    return { pick: out };
  }
  if (game >= 0) {
    const g = pick.games[game];
    if (asTheme) {
      if (r.template !== 'none' || r.relation !== 'none') return bad('pick_reading_invalid', r.template !== 'none' ? 'template' : 'relation', `read as a ${r.kind}, '${r.name}' has no template and no relation`);
      out.games.splice(game, 1);
      out.themes = [...out.themes, { name: r.name, kind: r.kind }];
      return { pick: out };
    }
    if (r.template !== g.template) return bad('pick_reading_invalid', 'template', `'${r.name}' read with its other relation keeps its template '${g.template}'`);
    if (!PLAYED_RELATIONS.includes(r.relation) || r.relation === g.relation) return bad('pick_reading_invalid', 'relation', `'${r.name}' joins ${g.relation} in the pick: its other reading joins the other way (${PLAYED_RELATIONS.filter(x => x !== g.relation).join(' or ')})`);
    out.games[game] = { ...g, kind: r.kind, relation: r.relation };
    return { pick: out };
  }
  if (theme >= 0) {
    if (!asLoop) return bad('pick_reading_invalid', 'kind', `'${r.name}' is a ${pick.themes[theme].kind} in the pick: its other reading is a game or genre`);
    if (!PLAYED_RELATIONS.includes(r.relation)) return bad('pick_reading_invalid', 'relation', `read as a ${r.kind}, '${r.name}' joins the primary nested or union`);
    out.themes.splice(theme, 1);
    out.games = [...out.games, { name: r.name, kind: r.kind, template: r.template, relation: r.relation }];
    return { pick: out };
  }
  return bad('pick_reading_unknown', 'name', `'${r.name}' is not the name of a concept of the pick (${[pick.primary, ...pick.games, ...pick.themes].map(c => `'${c.name}'`).join(', ')})`);
}

/** One reading of the idea in a line, as the player is asked: the game played, the games joined to it, its themes. @param {Pick} pick */
export function readingLabel(pick) {
  const games = pick.games.map(g => ` + ${g.name} (${g.template}, ${g.relation})`).join('');
  const themes = pick.themes.length ? ` with ${pick.themes.map(t => `${t.name} as the ${t.kind}`).join(', ')}` : '';
  return `${pick.primary.name} (${pick.primary.template})${games}${themes}`.slice(0, 200);
}

/**
 * The questions a pick with other readings stops with (ARCHITECTURE §1.1: never guess the game): one per concept the
 * idea can mean two ways, its options the pick as written and the pick read the other way (a pick whose readings fail
 * their checks asks nothing: its problems fail the pick first).
 * @param {Pick} pick @returns {ReadingQuestion[]}
 */
export function readingQuestions(pick) {
  return pick.readings.flatMap((r, i) => {
    const alt = otherReading(pick, r);
    if (!alt.pick) return [];
    const picks = [oneReading(pick), alt.pick];
    return [{ id: `reading_${i + 1}`, question: `"${r.name}": which game did you mean?`.slice(0, 200), options: picks.map(readingLabel), picks }];
  });
}

/**
 * The reading the player chose: each question answered by one of its options (answers by the question's text) flips its
 * concept or keeps it; the chosen pick is held to the pick's rules. -> { pick (null while a question is unanswered),
 * questions, unanswered, problems }
 * @param {Pick} pick @param {ReadonlyArray<{ question: string, answer: string }>} answers @param {{ templates: readonly Template[], registry: RegistryLike }} ctx
 */
export function chooseReading(pick, answers, ctx) {
  const questions = readingQuestions(pick);
  const answerOf = (/** @type {ReadingQuestion} */ q) => answers.find(a => a.question === q.question && q.options.includes(a.answer))?.answer;
  const unanswered = questions.filter(q => answerOf(q) === undefined);
  if (unanswered.length) return { pick: null, questions, unanswered, problems: [] };
  let chosen = oneReading(pick);
  /** @type {FormProblem[]} */
  const problems = [];
  pick.readings.forEach((r, i) => {
    const q = questions.find(x => x.id === `reading_${i + 1}`);
    if (!q || answerOf(q) !== q.options[1]) return;
    const alt = otherReading(chosen, r);
    if (alt.pick) chosen = alt.pick; else problems.push({ code: alt.code, field: `readings[${i}].${alt.field}`, message: `with the other answers: ${alt.message}` });
  });
  problems.push(...checkPick(chosen, ctx).problems);
  return { pick: problems.length ? null : chosen, questions, unanswered, problems };
}

// ---------------------------------------------------------------------------------------------------------------
// Asking: one form, its check, field re-asks, one escalation (decompose.js askStep's convention).
// ---------------------------------------------------------------------------------------------------------------

/** The value at a fieldForm path ('a.b[0].c'). @param {unknown} v @param {string} path @returns {unknown} */
function valueAt(v, path) {
  /** @type {unknown} */
  let cur = v;
  for (const m of path.matchAll(/\[(\d+)\]|([^.[\]]+)/g)) cur = m[1] !== undefined ? (Array.isArray(cur) ? cur[Number(m[1])] : undefined) : prop(cur, m[2]);
  return cur;
}

/**
 * Ask one strict form and check its answer; a failing check re-asks only the failing fields (fieldForm), up to
 * `attempts` calls of the default writer, then once of the escalation writer (effort low, this form only). Still
 * failing: a 422 with `code` and every finding. -> { value, calls (this form's calls, made one after another) }
 * @template T
 * @param {{ writer: Writer, escalate: Writer | null, attempts: number, calls: TemplateCall[], system: string, user: string, schema: ReplySchema,
 *   narrow: (value: unknown) => T, check: (value: T) => FormProblem[], code: string, what: string, clock: Clock }} args
 * @returns {Promise<{ value: T, calls: number }>}
 */
export async function askForm({ writer, escalate, attempts, calls, system, user, schema, narrow, check, code, what, clock }) {
  /** @type {{ v: T } | null} */
  let value = null;
  /** @type {FormProblem[]} */
  let problems = [];
  /** @type {string[]} */
  const failed = [];
  const own = Math.max(1, attempts);
  let n = 0;
  for (let i = 0; i < own + (escalate ? 1 : 0); i++) {
    const w = i >= own && escalate ? escalate : writer;
    const current = value;
    const fields = current && problems.length ? fieldForm(schema, [...new Set(problems.map(p => p.field))]) : null;
    const ask = fields && current
      ? `${user}\n\nYour answer failed these checks:\n${problems.map(p => `- ${p.field}: ${p.message}`).join('\n')}\nFix ONLY these fields. Current values: ${JSON.stringify(Object.fromEntries(fields.slots.map(s => [s.path, valueAt(current.v, s.path) ?? null])))}`
      : failed.length ? `${user}\n\nYour previous reply failed (${failed[failed.length - 1]}). Reply with one JSON object.` : user;
    const form = fields ? fields.schema : schema;
    const t0 = performance.now();
    /** @type {TemplateCall} */
    const call = { form: schema.name, ...(fields ? { fields: fields.slots.map(s => s.path) } : {}), model: null, ms: 0, ...(w === escalate ? { escalated: true } : {}) };
    calls.push(call); n++;
    try {
      const reply = await w.complete({ system, user: ask, schema: form, ...(w === escalate ? { effort: 'low' } : {}) });
      call.model = reply.model || w.model; call.ms = Math.round(performance.now() - t0);
      const tc = performance.now();
      const parsed = parseReply(reply.text);
      const next = narrow(fields && current ? fields.apply(current.v, parsed) : parsed);
      value = { v: next };
      problems = check(next);
      clock.codeMs += performance.now() - tc;
      if (!problems.length) return { value: next, calls: n };
      call.problems = problems.map(p => `${p.code} ${p.field}: ${p.message}`.slice(0, 300));
      failed.push(call.problems.join('; '));
    } catch (error) {
      call.ms = Math.round(performance.now() - t0);
      call.error = messageOf(error).slice(0, 160);
      failed.push(call.error);
    }
  }
  throw Object.assign(Error(`${what} failed its checks after ${failed.length} call(s): ${failed.join(' | ')}`),
    { status: 422, code, attempts: failed, problems: problems.map(p => ({ code: p.code, path: p.field, message: p.message })) });
}

/**
 * The pick, asked and checked; a pick still failing is a 422 'template_pick_failed' with its problems.
 * @param {{ writer: Writer, escalate: Writer | null, attempts: number, prompt: string, templates: readonly Template[], registry: RegistryLike, calls: TemplateCall[], clock: Clock }} args
 * @returns {Promise<{ pick: Pick, stepPath: string[], calls: number, unnamed: Array<{ name: string, says: string, why: string }>, unreadable: Array<{ name: string, kind: string, why: string }> }>}
 */
export async function askPick({ writer, escalate, attempts, prompt, templates, registry, calls, clock }) {
  /** The answer's entries that are no mechanic the idea names (namedMechanics), removed by code before the check. @type {Array<{ name: string, says: string, why: string }>} */
  let unnamed = [];
  /** The answer's readings no rule admits (validReadings), removed by code before the check. @type {Array<{ name: string, kind: string, why: string }>} */
  let unreadable = [];
  const narrow = (/** @type {unknown} */ v) => {
    const pick = narrowPick(v), named = namedMechanics(pick, prompt), withNamed = { ...pick, mechanics: named.kept }, read = validReadings(withNamed, { templates, registry });
    unnamed = named.removed; unreadable = read.removed;
    return { ...withNamed, readings: read.kept };
  };
  const r = await askForm({ writer, escalate, attempts, calls, clock, system: pickSystem(templates, registry), user: `Idea: ${prompt}`, schema: pickForm(templates, registry), narrow,
    check: pick => checkPick(pick, { templates, registry, prompt }).problems, code: 'template_pick_failed', what: 'The template pick' });
  return { pick: r.value, stepPath: checkPick(r.value, { templates, registry }).stepPath, calls: r.calls, unnamed, unreadable };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Composition (code).
// ---------------------------------------------------------------------------------------------------------------

/** One template's share of a composed document: the ids it defines there (by domain, compose.js definedIds). @typedef {{ template: Template, ids: Map<string, string[]> }} ComposedPart */
/** @type {WeakMap<object, LogicLike>} */
const logicCache = new WeakMap();
/** The registry's vocabulary when the caller has none at hand. @param {RegistryLike} registry @returns {LogicLike} */
const logicOf = registry => { let l = logicCache.get(registry); if (!l) { l = buildLogic(registry, Logic); logicCache.set(registry, l); } return l; };

/**
 * Compose the picked templates: the primary template's document (a deep clone) with the pick's title and premise;
 * every other game joined in pick order, nested (compose.js composeNested: the inner template appended with prefixed
 * ids and engine.adapt.nested wired from declarations, plus engine.adapt.skin when declarations decide it) or united
 * (compose.js composeUnion: on the primary's space, only when the composition check passes, else the adapter it
 * names). Theme concepts are collected for the content forms (no adapter, §1.3). A game that does not compose is a
 * problem with its code and what is missing; it is never dropped or substituted. With step-path concepts or pick
 * problems there is nothing to compose (doc null). `template` is the primary with the composed `tune` (every part's
 * tune paths); `parts` says which ids each template contributed (the content forms are one per part).
 * @param {Pick} pick @param {{ templates: readonly Template[], registry: RegistryLike, logic?: LogicLike }} ctx
 * @returns {{ doc: Record<string, any> | null, template: Template | null, parts: ComposedPart[], themes: Theme[], stepPath: string[], problems: TemplateProblem[], joins: Array<Record<string, unknown>> }}
 */
export function composeTemplates(pick, { templates, registry, logic = logicOf(registry) }) {
  const { problems: checks, stepPath } = checkPick(pick, { templates, registry });
  /** @type {TemplateProblem[]} */
  const problems = checks.map(p => ({ code: p.code, path: p.field, message: p.message }));
  const themes = pick.themes.map(c => ({ name: c.name, kind: c.kind }));
  if (stepPath.length || problems.length) return { doc: null, template: null, parts: [], themes, stepPath, problems, joins: [] };
  const outer = /** @type {Template} */ (templates.find(t => t.id === pick.primary.template));
  let doc = structuredClone(outer.doc);
  /** @type {ComposedPart[]} */
  const parts = [{ template: outer, ids: definedIds(outer.doc, registry) }];
  /** @type {Array<Record<string, unknown>>} */
  const joins = [];
  pick.games.forEach((c, i) => {
    const t = /** @type {Template} */ (templates.find(x => x.id === c.template));
    if (parts.some(p => p.template.id === t.id)) { problems.push({ code: 'compose_id_collision', path: `games[${i}].template`, message: `'${c.name}' plays template '${t.id}', which the game already composes: its ids would repeat` }); return; }
    const host = { id: outer.id, doc };
    const r = c.relation === 'nested' ? composeNested(host, { id: t.id, doc: t.doc }, { registry, logic }) : composeUnion(host, { id: t.id, doc: t.doc }, { registry, logic });
    if (!r.doc) { for (const p of r.problems) problems.push({ code: p.code, path: `games[${i}]`, message: `'${c.name}' (template '${t.id}') ${c.relation} in '${pick.primary.name}' (template '${outer.id}'): ${p.path}: ${p.message}` }); return; }
    doc = r.doc;
    const prefix = prefixOf(t.id);
    // Its share: the ids its document defines, as the composition named them (a union's spaces and zones are the host's).
    const own = definedIds(t.doc, registry);
    const ids = new Map([...own].filter(([d]) => c.relation === 'nested' || (d !== 'spaces' && d !== 'zones')).map(([d, list]) => [d, list.map(id => `${prefix}${id}`)]));
    parts.push({ template: t, ids });
    joins.push({ relation: c.relation, template: t.id, ...(/** @type {any} */ (r).nested || /** @type {any} */ (r).union || {}) });
  });
  if (problems.length) return { doc: null, template: outer, parts, themes, stepPath, problems, joins };
  doc.title = pick.title;
  doc.plot = { ...(isObj(doc.plot) ? doc.plot : {}), premise: pick.premise };
  // The composed tune: every part's entries whose path still names one declared param of one instance (a path named by
  // two parts, a shared instance, is one: the first part's; a path whose instance the composition no longer has, the
  // joined template's own space in a union, is gone with it).
  const tune = parts.flatMap(p => p.template.tune).filter((e, i, all) => all.findIndex(x => pathOfEntry(x) === pathOfEntry(e)) === i)
    .filter(e => (tuneTarget(doc, pathOfEntry(e), registry)?.instances.length ?? 0) > 0);
  return { doc, template: parts.length > 1 ? { ...outer, tune } : outer, parts, themes, stepPath, problems, joins };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Content forms, derived from the composed document.
// ---------------------------------------------------------------------------------------------------------------

/**
 * One display-text field of an entry: its path inside the entry, its form key, the template's text and the declared
 * spec (a string the cards declare `display: true`). @typedef {{ key: string, path: Array<string | number>, text: string, spec: ParamSchema }} TextSlot
 */
/** An entry of a section and its display-text fields. @typedef {{ id: string, key: string, slots: TextSlot[] }} TextEntry */
/** A section of the document with display text: its form key, where it is, its entries. @typedef {{ form: string, at: string, label: string, entries: TextEntry[] }} TextSection */

/** A form property name from an id or a path token (strict schemas want plain names). @param {string | number} s */
const keyOf = s => String(s).replace(/[^A-Za-z0-9_]/g, '_');

/**
 * The display text of a value under its declared shape: every string the shape declares `display: true` that the
 * value has, with its path (through object fields, map values and list elements).
 * @param {unknown} spec @param {unknown} value @param {Array<string | number>} [path] @returns {Array<{ path: Array<string | number>, text: string, spec: ParamSchema }>}
 */
export function displayText(spec, value, path = []) {
  if (!isObj(spec) || value === undefined || value === null) return [];
  const s = /** @type {ParamSchema} */ (spec);
  if (s.type === 'string') return s.display && isStr(value) ? [{ path, text: value, spec: s }] : [];
  if (s.type === 'list') return Array.isArray(value) ? value.flatMap((v, i) => displayText(s.of, v, [...path, i])) : [];
  if (s.type === 'object' && isObj(value)) {
    const fields = variantFields(s, value) ?? (isObj(s.fields) ? s.fields : {});
    return Object.entries(value).flatMap(([k, v]) => (k in fields ? displayText(fields[k], v, [...path, k]) : s.values ? displayText(s.values, v, [...path, k]) : []));
  }
  return [];
}

/** Every primitive a document instantiates (systems, spaces, generators, graphics). @param {Record<string, any>} doc */
const usesIn = doc => [...instancesIn(doc).map(i => String(i.use)), ...(Array.isArray(doc.graphics) ? doc.graphics.map((/** @type {any} */ g) => String(g.use)) : [])];

/**
 * The document's sections with display text (ARCHITECTURE §5: the content forms theme the text a person reads): every
 * content.* and plot.* section of entries (a list of { id } or an id-keyed object) and every space's zones, each entry
 * with the strings its declared shape marks display text (kernel/sections.js sectionShape: the kernel's base, the used
 * cards' card.data and card.components). Ids and structure are fixed by code; the forms only rewrite that text.
 * @param {Record<string, any>} doc @param {RegistryLike} registry @returns {TextSection[]}
 */
export function textSections(doc, registry) {
  const uses = usesIn(doc);
  /** @type {TextSection[]} */
  const out = [];
  /** @param {string} form @param {string} at @param {string} label @param {string} shapeOf @param {unknown} v */
  const section = (form, at, label, shapeOf, v) => {
    const shape = sectionShape(registry, uses, shapeOf).shape;
    if (!shape) return;
    const pairs = Array.isArray(v) ? objects(v).filter(e => isStr(e.id) && e.id).map(e => /** @type {[string, unknown, unknown]} */ ([String(e.id), e, shape.of])) : isObj(v) ? Object.entries(v).map(([id, e]) => /** @type {[string, unknown, unknown]} */ ([id, e, shape.values ?? null])) : [];
    const entries = pairs.map(([id, e, entry]) => ({ id, key: keyOf(id), slots: displayText(entry, e).map(t => ({ ...t, key: t.path.map(keyOf).join('__') })) })).filter(e => e.slots.length > 0);
    if (entries.length) out.push({ form: form.slice(0, 64), at, label, entries });
  };
  for (const root of ['content', 'plot']) for (const [k, v] of Object.entries(isObj(doc[root]) ? doc[root] : {})) if (/^[A-Za-z0-9_]+$/.test(k)) section(`${root}_${k}`, `${root}.${k}`, `${root}.${k}`, `${root}.${k}`, v);
  (Array.isArray(doc.spaces) ? doc.spaces : []).forEach((/** @type {Record<string, any>} */ s, /** @type {number} */ i) => section(`zones_${keyOf(s.id)}`, `spaces[${i}].zones`, `zones of the space '${s.id}'`, 'zones', s.zones));
  return out;
}

/** The entry objects at a section path (list entries by id, or an id-keyed object's values), by id. @param {Record<string, any>} doc @param {string} at @returns {Map<string, Record<string, any>>} */
function entriesById(doc, at) {
  const v = valueAt(doc, at);
  return new Map(Array.isArray(v) ? objects(v).filter(e => isStr(e.id)).map(e => [String(e.id), e]) : isObj(v) ? Object.entries(v).filter(([, e]) => isObj(e)).map(([id, e]) => [id, /** @type {Record<string, any>} */ (e)]) : []);
}

/**
 * The text sections one template contributed to a composed document: the entries whose ids that template's own
 * document has in that section (prefixed as the composition prefixed a joined template's ids).
 * @param {Record<string, any>} doc @param {ComposedPart} part @param {number} index the part's place in the composition (0: the primary) @param {RegistryLike} registry @returns {TextSection[]}
 */
export function partSections(doc, part, index, registry) {
  const prefix = index === 0 ? '' : prefixOf(part.template.id);
  const own = textSections(part.template.doc, registry);
  const zones = new Set(own.filter(o => o.at.startsWith('spaces[')).flatMap(o => o.entries.map(e => `${prefix}${e.id}`)));
  return textSections(doc, registry).map(s => {
    const ids = s.at.startsWith('spaces[') ? zones : new Set((own.find(o => o.at === s.at)?.entries ?? []).map(e => `${prefix}${e.id}`));
    return { ...s, entries: s.entries.filter(e => ids.has(e.id)) };
  }).filter(s => s.entries.length > 0);
}

/**
 * One content form per template of the composition (its concept themed together, in its own theme): a slot per
 * display-text field of every entry it contributed, grouped by section and entry ({ <section form>: { <entry>:
 * { <field>: text } } }); null when it contributed none. A slot allows what its declaration allows (its pattern, else
 * any text with a non-space). A failing field is re-asked alone (field '<section form>.<entry>.<field>').
 * @param {Record<string, any>} doc @param {ComposedPart} part @param {number} index @param {RegistryLike} registry
 */
export function conceptForm(doc, part, index, registry) {
  const sections = partSections(doc, part, index, registry);
  if (!sections.length) return null;
  const pattern = (/** @type {TextSlot} */ t) => (isStr(t.spec.pattern) ? t.spec.pattern : TEXT_PATTERN);
  const slotSchema = (/** @type {TextSection} */ s, /** @type {TextEntry} */ e, /** @type {TextSlot} */ t) => ({ type: 'string', pattern: pattern(t), description: `themed ${t.path.join('.')} of the ${s.label} entry '${e.id}' (template text: ${JSON.stringify(t.text).slice(0, 160)})` });
  /** @type {ReplySchema} */
  const schema = { name: `names_${part.template.id}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64), schema: strictObj(Object.fromEntries(sections.map(s => [s.form, strictObj(Object.fromEntries(s.entries.map(e => [e.key, strictObj(Object.fromEntries(e.slots.map(t => [t.key, slotSchema(s, e, t)])))])))]))) };
  /** @param {unknown} v @returns {Record<string, Record<string, Record<string, string>>>} */
  const narrow = v => Object.fromEntries(sections.map(s => [s.form, Object.fromEntries(s.entries.map(e => [e.key, Object.fromEntries(e.slots.map(t => [t.key, String(prop(prop(prop(v, s.form), e.key), t.key) ?? '')]))]))]));
  /** @param {Record<string, Record<string, Record<string, string>>>} v @returns {FormProblem[]} */
  const check = v => sections.flatMap(s => s.entries.flatMap(e => e.slots.filter(t => !new RegExp(pattern(t), 'u').test(v[s.form][e.key][t.key]))
    .map(t => ({ code: 'text_invalid', field: `${s.form}.${e.key}.${t.key}`, message: `text matching ${pattern(t)}, not '${v[s.form][e.key][t.key].slice(0, 60)}'` }))));
  /** @param {Record<string, any>} d @param {Record<string, Record<string, Record<string, string>>>} v */
  const apply = (d, v) => {
    for (const s of sections) {
      const byId = entriesById(d, s.at);
      for (const e of s.entries) {
        const entry = byId.get(e.id);
        if (!entry) continue;
        for (const t of e.slots) {
          /** @type {any} */
          let at = entry;
          for (const k of t.path.slice(0, -1)) at = at?.[k];
          if (at && typeof at === 'object') at[/** @type {string | number} */ (t.path[t.path.length - 1])] = v[s.form][e.key][t.key];
        }
      }
    }
  };
  return { schema, narrow, check, apply, sections, template: part.template };
}

/**
 * The frame and tune form: the logline, and one slot per `tune` path whose schema the card's param spec derives
 * (outline-form specSchema: closed sets as enums, ranges as minimum/maximum). Its check applies the decoded values to
 * the document and preflights it: a finding at a tuned param (or elsewhere on its instance) is that slot's problem.
 * A tune path naming no single declared param is a template defect (422 'template_defect').
 * @param {Template} template @param {Record<string, any>} doc the composed document @param {{ registry: RegistryLike, logic: LogicLike }} cat
 */
export function frameTuneForm(template, doc, { registry, logic }) {
  const paths = instancesWithPaths(doc);
  const slots = tuneRanges(template).map(range => {
    const path = range.path, target = tuneTarget(doc, path, registry);
    if (!target || target.instances.length !== 1) throw Object.assign(Error(`template '${template.id}': tune '${path}' names ${target ? `${target.instances.length} instances` : 'no declared param of an instance'} in its document`), { status: 422, code: 'template_defect', problems: [{ code: 'tune_unknown', path, message: 'a tune path names one declared param of one instance' }] });
    const inst = target.instances[0], at = /** @type {{ path: string }} */ (paths.find(p => p.inst === inst)).path;
    // The slot allows the template's playable range of the param (tunedSpec), and names the card's rules on it.
    const spec = tunedSpec(target.spec, range);
    const { schema, codec } = specSchema(spec);
    const current = inst.with?.[target.param] ?? target.spec.default;
    const rules = rulesOn(registry.get(target.use)?.card, target.param).map(r => `rule ${r.code}: ${r.message}`);
    return { key: formKey(path), path, param: target.param, at, codec, spec, schema: { ...schema, description: `${path}: ${[String(schema.description || ''), ...rules].filter(Boolean).join('; ')}; now ${JSON.stringify(current)}`.slice(0, 400) } };
  });
  /** @type {ReplySchema} */
  const schema = { name: 'frame_tune', schema: strictObj({ logline: text('one sentence that sells the game'), ...Object.fromEntries(slots.map(s => [s.key, s.schema])) }) };
  /** @param {unknown} v @returns {Record<string, unknown>} */
  const narrow = v => ({ logline: String(prop(v, 'logline') ?? ''), ...Object.fromEntries(slots.map(s => [s.key, decode(prop(v, s.key), s.codec)])) });
  /** @param {Record<string, any>} d @param {Record<string, unknown>} v */
  const apply = (d, v) => {
    d.logline = v.logline;
    const at = instancesWithPaths(d);
    for (const s of slots) { const inst = /** @type {{ inst: Record<string, any> }} */ (at.find(p => p.path === s.at)).inst; inst.with = { ...(inst.with || {}), [s.param]: v[s.key] }; }
  };
  /** @param {Record<string, unknown>} v @returns {FormProblem[]} */
  const check = v => {
    /** @type {FormProblem[]} */
    const problems = [];
    if (!TEXT_RE.test(String(v.logline))) problems.push({ code: 'text_missing', field: 'logline', message: 'write a one-sentence logline' });
    for (const s of slots) {
      if (v[s.key] === undefined) problems.push({ code: 'tune_missing', field: s.key, message: `${s.path} needs a value` });
      // The slot's own schema (the playable range) holds for writers that do not enforce it.
      else for (const p of answerProblems(s.schema, v[s.key])) problems.push({ code: 'tune_range', field: s.key, message: `${s.path}: ${p.message}` });
    }
    if (problems.length) return problems;
    const d = structuredClone(doc);
    apply(d, v);
    for (const e of preflight(d, registry, logic).errors) {
      const param = slots.filter(s => e.path === `${s.at}.with.${s.param}` || e.path.startsWith(`${s.at}.with.${s.param}.`) || e.path.startsWith(`${s.at}.with.${s.param}[`));
      // The composed document preflighted before these values were set (the caller checks it), so any finding is
      // theirs: a finding elsewhere on a tuned instance (a cross-field rule) belongs to that instance's slots, any
      // other to every slot.
      const inst = param.length ? param : slots.filter(s => e.path === s.at || e.path.startsWith(`${s.at}.`));
      for (const s of inst.length ? inst : slots) problems.push({ code: e.code, field: s.key, message: `${s.path}: ${e.message}${e.hint ? ` (${e.hint})` : ''}` });
    }
    return problems;
  };
  return { schema, narrow, check, apply, slots };
}

/**
 * Ask every content form of the composed document in parallel (Promise.all), each checked and repaired on its own,
 * and apply the answers to a copy of the document: frame_tune, and one names form per template of the composition
 * (conceptForm). The themes and the premise are in every form's prompt. `parts` defaults to the template alone.
 * `extra`: the params forms of the primitives extensions added (extend.js paramsForm), asked in the same round; their
 * answers, like every other, are applied to `onto` (the document with the extensions; default `doc`, the composed one
 * the frame and names forms are derived from and checked against).
 * `reuse`: the frame and names answers of an earlier round on the same composed document (its `answers`): kept, not
 * asked again, when only the extensions changed (a retry redoes only what changed).
 * -> { doc, forms: [{ form, calls }], rounds (the most calls any one form made: they run side by side), answers }
 * @param {{ writer: Writer, escalate: Writer | null, attempts: number, template: Template, doc: Record<string, any>, pick: Pick, themes: Theme[],
 *   registry: RegistryLike, logic: LogicLike, calls: TemplateCall[], clock: Clock, parts?: ComposedPart[], onto?: Record<string, any>,
 *   extra?: Array<{ schema: ReplySchema, narrow: (v: unknown) => Record<string, unknown>, check: (v: Record<string, unknown>) => FormProblem[], apply: (d: Record<string, any>, v: Record<string, unknown>) => void, use: string, intent: string, mechanic: string }>,
 *   reuse?: { frame: { value: any, calls: number }, named: Array<{ value: any, calls: number }> } | null }} args
 */
export async function writeContent({ writer, escalate, attempts, template, doc, pick, themes, registry, logic, calls, clock, parts = [{ template, ids: definedIds(doc, registry) }], onto = doc, extra = [], reuse = null }) {
  const tc = performance.now();
  const named = parts.map((part, i) => conceptForm(doc, part, i, registry)).filter(/** @returns {f is NonNullable<typeof f>} */ f => f !== null);
  const frame = frameTuneForm(template, doc, { registry, logic });
  clock.codeMs += performance.now() - tc;
  const composed = parts.length > 1 ? `\nIt composes the verified templates ${parts.map(p => `'${p.template.id}' (${p.template.concept})`).join(' and ')}.` : '';
  const system = `You write the content of a game built from the verified template '${template.id}' (${template.concept}).${composed}
Title: ${pick.title}
Premise: ${pick.premise}
Themes: ${themes.length ? themes.map(t => `${t.name} (${t.kind})`).join('; ') : 'none beyond the premise'}
Write only what the form asks, in the game's theme. Ids and structure are fixed.`;
  const base = { writer, escalate, attempts, calls, clock, system, code: 'template_content_failed' };
  // Every form of the round runs side by side.
  const kept = (/** @type {{ value: any, calls: number }} */ a) => Promise.resolve({ value: a.value, calls: 0 });
  const [frameAnswer, answers, extras] = await Promise.all([
    reuse ? kept(reuse.frame) : askForm({ ...base, user: `Write the logline of '${pick.title}' and set its tuning (each slot names its current value).`, schema: frame.schema, narrow: frame.narrow, check: frame.check, what: 'The frame_tune form' }),
    Promise.all(named.map((f, i) => reuse ? kept(reuse.named[i]) : askForm({ ...base, user: `Rewrite the text a person reads (names, titles, lines, descriptions) of every entry of '${pick.title}' that the template '${f.template.id}' (${f.template.concept}) brings, for its theme: ${f.sections.map(s => s.label).join('; ')}. Keep each one's role in the game.`, schema: f.schema, narrow: f.narrow, check: f.check, what: `The ${f.schema.name} form` }))),
    Promise.all(extra.map(f => askForm({ ...base, user: `'${pick.title}' also has "${f.mechanic}", given by ${f.use} (${f.intent}). Set its params for the idea (null keeps a param as the primitive declares it).`, schema: f.schema, narrow: f.narrow, check: f.check, what: `The ${f.schema.name} form` }))),
  ]);
  const ta = performance.now();
  const out = structuredClone(onto);
  frame.apply(out, frameAnswer.value);
  named.forEach((f, i) => f.apply(out, answers[i].value));
  extra.forEach((f, i) => f.apply(out, extras[i].value));
  clock.codeMs += performance.now() - ta;
  const forms = [{ form: 'frame_tune', calls: frameAnswer.calls }, ...named.map((f, i) => ({ form: f.schema.name, calls: answers[i].calls })), ...extra.map((f, i) => ({ form: f.schema.name, calls: extras[i].calls }))];
  return { doc: out, forms, rounds: Math.max(...forms.map(f => f.calls)), answers: { frame: frameAnswer, named: answers } };
}
