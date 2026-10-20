// Predicates and effects shared by plot and gameplay. Both are extensible:
// primitives register new kinds (has item, in zone, quest state; give item,
// spawn, teleport…) with a validator and an implementation.
//
// Predicate: an object whose first registered key names its kind, plus an
// optional comparator: { "var": "gold", "gte": 10 }, { "flag": "met_mayor" },
// { "all": [...] }, { "any": [...] }, { "not": {...} }.
// Effect: { "do": "<kind>", ...fields }.
const COMPARATORS = ['gte', 'lte', 'gt', 'lt', 'eq', 'ne'];

export function compare(value, predicate) {
  const c = COMPARATORS.find(k => predicate[k] !== undefined);
  if (!c) return Boolean(value);
  const target = predicate[c];
  return c === 'gte' ? value >= target : c === 'lte' ? value <= target : c === 'gt' ? value > target : c === 'lt' ? value < target : c === 'eq' ? value === target : value !== target;
}

export class Logic {
  constructor() {
    this.predicates = new Map();
    this.effects = new Map();
    this.predicate('all', { check: (p, path, errors, ctx) => listCheck(p.all, `${path}.all`, errors, ctx), test: (p, rt) => p.all.every(q => this.test(q, rt)) });
    this.predicate('any', { check: (p, path, errors, ctx) => listCheck(p.any, `${path}.any`, errors, ctx), test: (p, rt) => p.any.some(q => this.test(q, rt)) });
    this.predicate('not', { check: (p, path, errors, ctx) => ctx.checkPredicate(p.not, `${path}.not`, errors), test: (p, rt) => !this.test(p.not, rt) });
    this.predicate('var', { refs: p => [['var', p.var]], test: (p, rt) => compare(rt.state.vars[p.var] ?? 0, p) });
    this.predicate('count', { refs: p => [['event', p.count]], test: (p, rt) => compare(rt.state.counts[p.count] ?? 0, p) });
    this.predicate('flag', { refs: p => [['flag', p.flag]], test: (p, rt) => compare(Boolean(rt.state.flags[p.flag]), { eq: p.eq ?? true }) });
    this.predicate('time', { test: (p, rt) => compare(rt.state.time, p) });
    this.effect('set_flag', { refs: e => [['flag', e.flag]], run: (e, rt) => { rt.state.flags[e.flag] = e.value ?? true; } });
    this.effect('clear_flag', { refs: e => [['flag', e.flag]], run: (e, rt) => { delete rt.state.flags[e.flag]; } });
    this.effect('set_var', { refs: e => [['var', e.var]], run: (e, rt) => { rt.state.vars[e.var] = e.value; } });
    this.effect('add_var', { refs: e => [['var', e.var]], run: (e, rt) => { rt.state.vars[e.var] = (rt.state.vars[e.var] ?? 0) + (e.value ?? 1); } });
    this.effect('emit', { run: (e, rt) => rt.emit(e.event, e.data || {}) });
    this.effect('end_game', { refs: e => e.ending ? [['ending', e.ending]] : [], run: (e, rt) => { rt.state.status = e.outcome || 'won'; rt.state.ending = e.ending || null; rt.emit('game_end', { ending: e.ending || null, outcome: rt.state.status }); } });
  }
  /** Register a predicate kind: { check?(p, path, errors, ctx), refs?(p) -> [[kind, id]], test(p, rt) }. */
  predicate(kind, def) { this.predicates.set(kind, def); }
  /** Register an effect kind: { check?(e, path, errors, ctx), refs?(e), run(e, rt) }. */
  effect(kind, def) { this.effects.set(kind, def); }
  kindOf(p) { return p && typeof p === 'object' ? Object.keys(p).find(k => this.predicates.has(k)) : undefined; }
  test(p, rt) { const kind = this.kindOf(p); if (!kind) throw Error(`unknown predicate ${JSON.stringify(p)}`); return this.predicates.get(kind).test(p, rt); }
  run(effects, rt, context = {}) { for (const e of effects || []) this.effects.get(e.do).run(e, rt, context); }

  checkPredicate(p, path, errors, ctx) {
    const kind = this.kindOf(p);
    if (!kind) { errors.push({ code: 'predicate_unknown', path, message: `unknown predicate ${JSON.stringify(p)?.slice(0, 80)}`, hint: `kinds: ${[...this.predicates.keys()].join(', ')}` }); return; }
    const def = this.predicates.get(kind);
    def.check?.(p, path, errors, ctx);
    for (const [refKind, id] of def.refs?.(p) || []) ctx?.noteRef?.(refKind, id, path, 'read');
  }
  checkEffect(e, path, errors, ctx) {
    const def = this.effects.get(e?.do);
    if (!def) { errors.push({ code: 'effect_unknown', path, message: `unknown effect '${e?.do}'`, hint: `effects: ${[...this.effects.keys()].join(', ')}` }); return; }
    def.check?.(e, path, errors, ctx);
    for (const [refKind, id] of def.refs?.(e) || []) ctx?.noteRef?.(refKind, id, path, 'write');
  }
}

function listCheck(list, path, errors, ctx) {
  if (!Array.isArray(list) || !list.length) { errors.push({ code: 'predicate_invalid', path, message: 'needs a non-empty list' }); return; }
  list.forEach((q, i) => ctx.checkPredicate(q, `${path}[${i}]`, errors));
}
