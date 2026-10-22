// Module registry. A module is a plain object:
//   { id, card, init?(state, cfg, api), step?(state, cfg, api), on?: { event(state, data, cfg, api) },
//     requiresTags?(cfg), providesVars?(cfg), providesEvents?(cfg) }
// card = { intent, phase: input|motion|interaction|rules, tunables: { name: { default, min, max, unit, effect } |
//          { type: 'string'|'boolean', default, options? } }, provides: { vars, events }, requires: { tags }, conflicts? }
// The functional hooks default to the card's static lists; override them when
// what a module provides depends on its tunables (e.g. a configurable var name).
export class Registry {
  constructor(modules = []) { this.modules = new Map(); modules.forEach(m => this.add(m)); }
  add(mod) {
    if (!mod?.id || !mod.card) throw Error('module needs id and card');
    if (this.modules.has(mod.id)) throw Error(`duplicate module '${mod.id}'`);
    this.modules.set(mod.id, {
      requiresTags: () => mod.card.requires?.tags || [],
      providesVars: () => mod.card.provides?.vars || [],
      providesEvents: () => mod.card.provides?.events || [],
      ...mod,
    });
    return this;
  }
  get(id) { return this.modules.get(id); }
  ids() { return [...this.modules.keys()].sort(); }
  /** Compact card list for planners: id, intent, tunables with ranges, provides/requires. */
  cards() {
    return this.ids().map(id => { const { card } = this.get(id); return { id, ...card }; });
  }
}
