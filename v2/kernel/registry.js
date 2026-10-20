// Primitive registry. A primitive:
// { id: 'family.domain[.name]', card: { intent, views?, params, provides?, requires?, conflicts?, reads? },
//   validate?(config, doc, ctx) -> errors, install?(rt, config, instance), capabilities?(config) (spaces) }
export const FAMILIES = ['engine', 'plot', 'graphics', 'gameplay'];
const ID = /^(engine|plot|graphics|gameplay)(\.[a-z0-9][a-z0-9-]*){1,3}$/;

export class Registry {
  constructor(primitives = []) { this.items = new Map(); primitives.forEach(p => this.add(p)); }
  add(primitive) {
    if (!ID.test(primitive?.id || '')) throw Error(`invalid primitive id '${primitive?.id}'`);
    if (!primitive.card?.intent) throw Error(`primitive '${primitive.id}' needs card.intent`);
    if (this.items.has(primitive.id)) throw Error(`duplicate primitive '${primitive.id}'`);
    this.items.set(primitive.id, { ...primitive, family: primitive.id.split('.')[0], card: { params: {}, provides: {}, requires: {}, ...primitive.card } });
    return this;
  }
  get(id) { return this.items.get(id); }
  has(id) { return this.items.has(id); }
  ids(family) { return [...this.items.keys()].filter(id => !family || id.startsWith(family + '.')).sort(); }
  /** Model-facing catalogue: id, family and card for every primitive. */
  cards(family) { return this.ids(family).map(id => ({ id, ...this.get(id).card })); }
}
