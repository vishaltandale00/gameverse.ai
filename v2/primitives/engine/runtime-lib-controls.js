// How a person issues each player verb of a document, from card declarations only (ARCHITECTURE §6.3): the host's
// input defaults (v2/web/input-defaults.js), the UI defaults (graphics/ui-defaults.js), the headless input driver
// (v2/verify/controls.js) and the controls conformance test all read it here, so they agree on every verb.
//   card.loop.verbs      the verbs a loop is played with (each needs a control);
//   card.actionSpace     how a verb's value is given (none: a press; enum: one key per value; an input axis: held;
//                        choice, or a number or vector that is no input axis: a UI control);
//   card.controls        on UI primitives: { verbs: [verbs it sends through view.act], choice?: true } (choice: it
//                        issues every choice verb the document's other mounted UIs do not, from the game's options).

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

/** The player verbs a document's loops are played with (card.loop.verbs of every instance), in document order. */
export function loopVerbs(doc, registry) {
  const out = [];
  for (const inst of verbInstances(doc)) for (const v of registry?.get(inst.use)?.card?.loop?.verbs || []) if (!out.includes(v)) out.push(v);
  return out;
}


/**
 * The UI primitives among a document's graphics that issue each verb through view.act: verb -> [primitive ids], from
 * their card.controls.verbs; `choice` lists the mounted ones that issue choice verbs (card.controls.choice).
 * @param {any} doc @param {any} registry @returns {{ verbs: Map<string, string[]>, choice: string[] }}
 */
export function uiControls(doc, registry) {
  const verbs = new Map(), choice = [];
  for (const g of doc.graphics || []) {
    const c = registry?.get(g.use)?.card?.controls; if (!c) continue;
    for (const v of c.verbs || []) (verbs.get(v) || verbs.set(v, []).get(v)).push(g.use);
    if (c.choice && !choice.includes(g.use)) choice.push(g.use);
  }
  return { verbs, choice };
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
