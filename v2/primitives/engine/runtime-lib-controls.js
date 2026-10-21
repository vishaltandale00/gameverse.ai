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
    if (!spec) continue;
    if (spec.type === 'choice') kinds.push({ kind: 'choice' });
    else if (spec.type === 'enum') kinds.push((spec.options || []).every(o => o === true) ? { kind: 'press' } : { kind: 'values', options: spec.options.slice() });
    else if (spec.type === 'vector' || spec.kind === 'continuous') kinds.push(AXIS_VERBS.has(verb) ? { kind: 'axis' } : { kind: 'choice' });
    else if (spec.type === 'number') kinds.push({ kind: 'choice' });
    else kinds.push({ kind: 'press' }); // an impulse: a press, its params optional refinements
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

/**
 * The values a person can choose for a choice verb now, as action records: the actions of the options the game offers
 * for it, or, for a verb whose choice `selects` a field (select a unit), the distinct values of that field in the
 * options of the verbs whose choice `pick`s it (the units that have a move or an action).
 * @param {any} rt @param {string} verb @param {number} [max] @returns {Array<{ actions: Record<string, unknown>, steps?: number }>}
 */
export function choiceValues(rt, verb, max = 3) {
  const options = rt.availableOptions();
  const own = options.filter(o => o.actions?.[verb] !== undefined).slice(0, max).map(o => ({ actions: o.actions, ...(o.steps ? { steps: o.steps } : {}) }));
  if (own.length) return own;
  const specs = {};
  for (const inst of verbInstances(rt.doc)) Object.assign(specs, Object.fromEntries(Object.entries(actionSpaceOf(rt.registry?.get(inst.use)?.card, inst)).filter(([v]) => !(v in specs))));
  const field = specs[verb]?.selects; if (typeof field !== 'string') return [];
  const out = [], seen = new Set();
  for (const o of options) for (const [v, x] of Object.entries(o.actions || {})) {
    if (specs[v]?.pick !== field || !x || typeof x !== 'object' || x[field] === undefined) continue;
    const k = JSON.stringify(x[field]); if (seen.has(k) || out.length >= max) continue;
    seen.add(k); out.push({ actions: { [verb]: structuredClone(x[field]) } });
  }
  return out;
}
