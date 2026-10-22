// @ts-check
// Primitive registry. A primitive:
// { id: 'family.domain[.name]', card: { intent, views?, params, provides?, requires?, conflicts?, reads? },
//   validate?(config, doc, ctx) -> errors, install?(rt, config, instance), capabilities?(config) (spaces) }
/** @typedef {import('./types.js').Primitive} Primitive */
/** @typedef {import('./types.js').RegisteredPrimitive} RegisteredPrimitive */
/** @typedef {import('./types.js').Card} Card */
/** @typedef {import('./types.js').RegistryLike} RegistryLike */

export const FAMILIES = ['engine', 'plot', 'graphics', 'gameplay'];
const ID = /^(engine|plot|graphics|gameplay)(\.[a-z0-9][a-z0-9-]*){1,3}$/;

/** @implements {RegistryLike} */
export class Registry {
  /** @param {Primitive[]} [primitives] */
  constructor(primitives = []) {
    /** @type {Map<string, RegisteredPrimitive>} */
    this.items = new Map();
    primitives.forEach(p => this.add(p));
  }
  /** @param {Primitive} primitive @returns {this} */
  add(primitive) {
    if (!ID.test(primitive?.id || '')) throw Error(`invalid primitive id '${primitive?.id}'`);
    if (!primitive.card?.intent) throw Error(`primitive '${primitive.id}' needs card.intent`);
    if (this.items.has(primitive.id)) throw Error(`duplicate primitive '${primitive.id}'`);
    this.items.set(primitive.id, { ...primitive, family: primitive.id.split('.')[0], card: { params: {}, provides: {}, requires: {}, ...primitive.card } });
    return this;
  }
  /** @param {string | undefined} id */
  get(id) { return this.items.get(/** @type {string} */ (id)); }
  /** @param {string | undefined} id */
  has(id) { return this.items.has(/** @type {string} */ (id)); }
  /** @param {string} [family] @returns {string[]} */
  ids(family) { return [...this.items.keys()].filter(id => !family || id.startsWith(family + '.')).sort(); }
  /** Model-facing catalogue: id, family and card for every primitive. */
  /** @param {string} [family] @returns {Array<Card & { id: string }>} */
  cards(family) { return this.ids(family).map(id => ({ id, .../** @type {RegisteredPrimitive} */ (this.get(id)).card })); }
}
