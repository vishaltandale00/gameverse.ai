// How a person issues each player verb of a document, from card declarations only (ARCHITECTURE §6.3): the host's
// input defaults (v2/web/input-defaults.js), the UI defaults (graphics/ui-defaults.js), the headless input driver
// (v2/verify/controls.js) and the controls conformance test all read it here, so they agree on every verb.
//   card.loop.verbs      the verbs a loop is played with (each needs a control);
//   card.actionSpace     how a verb's value is given (none: a press; enum: one key per value; an input axis: held;
//                        choice, or a number or vector that is no input axis: a UI control);
//   card.controls        on UI primitives: { verbs: [verbs it sends through view.act], choice?: true, options?: true }
//                        (choice: it issues every choice verb the document's other mounted UIs do not, from the game's
//                        options; options: it lists the game's options and sends the chosen one's actions whole).

/** Verbs that are 2D input axes (held [x, y] inputs) when a card declares them as vectors or continuous inputs. */
export const AXIS_VERBS = new Set(['move', 'look', 'drive', 'steer', 'aim']);

/** Every primitive instance of a document that can provide player verbs: spaces, their generators, systems, graphics. */
export const verbInstances = doc => [...(doc.spaces || []), ...(doc.spaces || []).flatMap(s => s.generators || []), ...(doc.systems || []), ...(doc.graphics || [])];
/** A card's action space for one instance (a card may declare it as a function of the instance config). */
export function actionSpaceOf(card, inst) { const as = card?.actionSpace; return typeof as === 'function' ? as(inst?.with || {}) || {} : as || {}; }

/** How a person issues `verb` as one card's action space declares it (`spec`): the kinds of verbControl. */
export function specControl(verb, spec) {
  if (spec.type === 'choice') return { kind: 'choice' };
  if (spec.type === 'enum') return (spec.options || []).every(o => o === true) ? { kind: 'press' } : { kind: 'values', options: spec.options.slice() };
  if (spec.type === 'vector' || spec.kind === 'continuous') return AXIS_VERBS.has(verb) ? { kind: 'axis' } : { kind: 'choice' };
  if (spec.type === 'number') return { kind: 'choice' };
  return { kind: 'press' }; // an impulse: a press, its params optional refinements
}

/**
 * How a person issues one verb, from the declarations of the document's instances that provide it (card.provides.actions,
 * card.loop.verbs, card.actionSpace):
 *   { kind: 'axis' }              a held 2D input (a vector or continuous action space of an input axis verb: move, look...);
 *   { kind: 'values', options }   one of a closed set of values (actionSpace enum): one key per value;
 *   { kind: 'choice' }            a value chosen among what the primitive offers (actionSpace choice, or a number or vector
 *                                 that is no input axis): issued by a UI control (graphics.ui.*, card.controls);
 *   { kind: 'press' }             a key that sends true (no action space, an enum of [true], an impulse).
 * @param {any} registry @param {any[]} instances @param {string} verb
 */
export function verbControl(registry, instances, verb) {
  const kinds = [];
  for (const inst of instances) {
    const card = registry?.get(inst.use)?.card; if (!card) continue;
    const spec = actionSpaceOf(card, inst)[verb];
    if (spec) kinds.push(specControl(verb, spec));
  }
  const rank = ['axis', 'values', 'choice', 'press'];
  return kinds.sort((a, b) => rank.indexOf(a.kind) - rank.indexOf(b.kind))[0] ?? { kind: 'press' };
}

const defaultsOf = card => Object.fromEntries(Object.entries(card?.params || {}).filter(([, s]) => s && typeof s === 'object' && 'default' in s).map(([k, s]) => [k, s.default]));
/**
 * The loop verbs one instance offers: card.loop.verbsOf(config, doc) when the card declares that its verbs depend on
 * the instance (an auto-runner is not steered; an ability no one can grant gives no verb; a moveset without heavy
 * moves gives no heavy attack), else card.loop.verbs. config gets the card's defaults.
 * @param {any} card @param {any} inst @param {any} doc @returns {string[]}
 */
export function instanceVerbs(card, inst, doc) {
  const loop = card?.loop; if (!loop) return [];
  const all = Array.isArray(loop.verbs) ? loop.verbs : [];
  if (typeof loop.verbsOf !== 'function') return all;
  const own = loop.verbsOf({ ...defaultsOf(card), ...(inst?.with || {}) }, doc) || [];
  return all.filter(v => own.includes(v));
}
/** The player verbs a document's loops are played with (instanceVerbs of every instance), in document order. */
export function loopVerbs(doc, registry) {
  const out = [];
  for (const inst of verbInstances(doc)) for (const v of instanceVerbs(registry?.get(inst.use)?.card, inst, doc)) if (!out.includes(v)) out.push(v);
  return out;
}


/**
 * The UI primitives among a document's graphics that issue each verb through view.act: verb -> [primitive ids], from
 * their card.controls.verbs; `choice` lists the mounted ones that issue choice verbs (card.controls.choice).
 * @param {any} doc @param {any} registry @returns {{ verbs: Map<string, string[]>, choice: string[] }}
 */
export function uiControls(doc, registry) {
  const verbs = new Map(), choice = [], options = [];
  for (const g of doc.graphics || []) {
    const c = registry?.get(g.use)?.card?.controls; if (!c) continue;
    for (const v of c.verbs || []) (verbs.get(v) || verbs.set(v, []).get(v)).push(g.use);
    if (c.choice && !choice.includes(g.use)) choice.push(g.use);
    if (c.options && !options.includes(g.use)) options.push(g.use);
  }
  return { verbs, choice, options };
}

/** The loop verbs of a document whose value is a choice (verbControl kind 'choice'), in loop order. */
export function choiceVerbs(doc, registry) {
  const inst = verbInstances(doc);
  return loopVerbs(doc, registry).filter(v => verbControl(registry, inst, v).kind === 'choice');
}
/** The choice verbs no mounted UI primitive names in its card.controls.verbs: what graphics.ui.choices issues. */
export function unclaimedChoices(doc, registry) {
  const { verbs } = uiControls(doc, registry);
  return choiceVerbs(doc, registry).filter(v => !verbs.has(v));
}

// Where a choice verb's values come from. Every verb whose value is chosen (specControl kind 'choice') declares, on its
// card.actionSpace entry, its provider and what choosing a value produces:
//   from: 'options'      the values are the options the primitive offers for it now (rt.options entries whose actions
//                        carry the verb: the legal moves, the items to buy, the slots to swap);
//   selects: '<field>'   the values are the distinct `field` of the values of the verbs whose choice `pick`s it on the
//                        same card (select a unit: the units that have a move or an action);
//   emits: [events]      the events one of which a provided value fires when it is chosen (what a person sees happen):
//                        each declared by the card (provides.events, loop.progress) or a primitive it requires.
// graphics.ui.choices lists the provided values, the headless input driver issues them, and the feature checks press
// them; a choice verb without a provider is a type hole (choice_provider_undeclared), never an empty panel.
/** Problem codes of choice declarations (choiceDeclarationProblems). */
export const CHOICE_CODES = Object.freeze(['choice_provider_undeclared', 'choice_selects_unpicked', 'choice_emits_undeclared']);

/** The provider a choice verb's spec declares: 'options', { selects: field }, or null (undeclared). */
export function choiceProvider(spec) {
  if (!spec || typeof spec !== 'object') return null;
  if (typeof spec.selects === 'string' && spec.selects) return { selects: spec.selects };
  if (spec.from === 'options') return 'options';
  return null;
}

const eventMatches = (declared, name) => declared.some(d => d === name || (d.endsWith(':*') && name.startsWith(d.slice(0, -1))));
/**
 * The problems in one card's choice declarations, for an instance config (defaults when omitted): every loop verb
 * (card.loop.verbs, whatever the instance) whose value is chosen declares a provider, a `selects` names a field another of its choices `pick`s, and
 * `emits` lists events the card or a primitive it requires declares. -> [{ code, verb, message }]
 * @param {any} card @param {any} [registry] resolves card.requires.primitives @param {any} [inst]
 */
export function choiceDeclarationProblems(card, registry = null, inst = { with: {} }) {
  const as = actionSpaceOf(card, inst), out = [];
  const declared = [card, ...(card?.requires?.primitives || []).map(id => registry?.get(id)?.card)].flatMap(c => [...(c?.provides?.events || []), ...(c?.loop?.progress || [])]);
  const picks = new Set(Object.values(as).map(s => s?.pick).filter(f => typeof f === 'string'));
  for (const verb of Array.isArray(card?.loop?.verbs) ? card.loop.verbs : []) {
    const spec = as[verb];
    if (!spec || specControl(verb, spec).kind !== 'choice') continue;
    const p = choiceProvider(spec);
    if (!p) out.push({ code: 'choice_provider_undeclared', verb, message: `${card.id}: the choice verb '${verb}' declares no provider (actionSpace.${verb}.from 'options', or selects a field another choice picks)` });
    else if (p !== 'options' && !picks.has(p.selects)) out.push({ code: 'choice_selects_unpicked', verb, message: `${card.id}: '${verb}' selects '${p.selects}', which no other choice of the card picks` });
    const emits = Array.isArray(spec.emits) ? spec.emits : [];
    if (!emits.length || emits.some(e => typeof e !== 'string' || !eventMatches(declared, e))) out.push({ code: 'choice_emits_undeclared', verb, message: `${card.id}: '${verb}' must list in emits the events it fires, each one the card declares (provides.events or loop.progress); got ${JSON.stringify(spec.emits ?? null)}` });
  }
  return out;
}

/** The action-space entry each verb has in a document (the first instance that declares it). */
function specsOf(rt) {
  const specs = {};
  for (const inst of verbInstances(rt.doc)) for (const [v, s] of Object.entries(actionSpaceOf(rt.registry?.get(inst.use)?.card, inst))) if (!(v in specs)) specs[v] = s;
  return specs;
}

/**
 * The values a person can choose for a choice verb now, from the provider its card declares, as action records: the
 * options the game offers for it (from 'options'), or the distinct values of the selected field in the options of the
 * verbs whose choice picks it (selects). A verb with no declared provider has none.
 * @param {any} rt @param {string} verb @param {number} [max] @returns {Array<{ actions: Record<string, unknown>, steps?: number }>}
 */
export function choiceValues(rt, verb, max = 3) {
  const specs = specsOf(rt), p = choiceProvider(specs[verb]);
  if (!p) return [];
  const options = rt.availableOptions();
  if (p === 'options') return options.filter(o => o.actions?.[verb] !== undefined).slice(0, max).map(o => ({ actions: o.actions, ...(o.steps ? { steps: o.steps } : {}) }));
  const field = p.selects, out = [], seen = new Set();
  for (const o of options) for (const [v, x] of Object.entries(o.actions || {})) {
    if (specs[v]?.pick !== field || !x || typeof x !== 'object' || x[field] === undefined) continue;
    const k = JSON.stringify(x[field]); if (seen.has(k) || out.length >= max) continue;
    seen.add(k); out.push({ actions: { [verb]: structuredClone(x[field]) } });
  }
  return out;
}

// Refusals. A primitive that refuses a player's verb (nothing to place, out of range, not enough gold, not your turn)
// emits an event saying so, with a `reason`; its card declares those events in card.denials (each one of its
// provides.events), so the presentation can tell the person why a press did nothing (graphics.ui.hud shows them).
/** The denial events the primitives of a document declare (card.denials), in document order. */
export function declaredDenials(doc, registry) {
  const out = [];
  for (const inst of verbInstances(doc)) for (const ev of registry?.get(inst.use)?.card?.denials || []) if (!out.includes(ev)) out.push(ev);
  return out;
}
/** Does a denial answer the person: it names the player as the actor, or this step's input carried one of their verbs? */
export function deniesPlayer(rt, e) {
  if (e?.who === 'player') return true;
  return Object.values(rt.input?.actions || {}).some(v => v !== undefined && v !== null && v !== false);
}
/** Problems in a card's denials: each a declared event of the card. -> [{ code: 'denial_undeclared', message }] */
export function denialProblems(card) {
  const declared = card?.provides?.events || [];
  return (card?.denials || []).filter(ev => typeof ev !== 'string' || !eventMatches(declared, ev)).map(ev => ({ code: 'denial_undeclared', message: `${card.id}: denial '${ev}' is not one of its provides.events` }));
}
