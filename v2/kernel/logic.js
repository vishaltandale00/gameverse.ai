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
    this.owners = { predicate: new Map(), effect: new Map() };
    this.duplicates = [];
    this.owner = 'kernel';
    this.predicate('all', { check: (p, path, errors, ctx) => listCheck(p.all, `${path}.all`, errors, ctx), test: (p, rt, c) => p.all.every(q => this.test(q, rt, c)) });
    this.predicate('any', { check: (p, path, errors, ctx) => listCheck(p.any, `${path}.any`, errors, ctx), test: (p, rt, c) => p.any.some(q => this.test(q, rt, c)) });
    this.predicate('not', { check: (p, path, errors, ctx) => ctx.checkPredicate(p.not, `${path}.not`, errors), test: (p, rt, c) => !this.test(p.not, rt, c) });
    this.predicate('var', { refs: p => [['var', p.var]], test: (p, rt) => compare(rt.state.vars[p.var] ?? 0, p) });
    this.predicate('count', { refs: p => [['event', p.count]], test: (p, rt) => compare(rt.state.counts[p.count] ?? 0, p) });
    this.predicate('flag', { refs: p => [['flag', p.flag]], test: (p, rt) => compare(Boolean(rt.state.flags[p.flag]), { eq: p.eq ?? true }) });
    this.predicate('time', { test: (p, rt) => compare(rt.state.time, p) });
    this.effect('set_flag', { refs: e => [['flag', e.flag]], run: (e, rt) => { rt.state.flags[e.flag] = e.value ?? true; } });
    this.effect('clear_flag', { refs: e => [['flag', e.flag]], run: (e, rt) => { delete rt.state.flags[e.flag]; } });
    this.effect('set_var', { refs: e => [['var', e.var]], run: (e, rt) => { rt.state.vars[e.var] = e.value; } });
    this.effect('add_var', { refs: e => [['var', e.var]], run: (e, rt) => { rt.state.vars[e.var] = (rt.state.vars[e.var] ?? 0) + (e.value ?? 1); } });
    this.effect('emit', { run: (e, rt) => rt.emit(e.event, e.data || {}) });
    // Spatial vocabulary shared by every space. The kernel dispatches to the
    // subject's space API (KERNEL_API.md §3), so no space registers these itself.
    this.predicate('zone', { refs: p => [['zone', p.zone]], test: (p, rt, c) => { const e = rt.resolve(p.who, c); return Boolean(e?.space) && rt.space(e.space).inZone(e, p.zone, rt); } });
    this.predicate('near', { test: (p, rt, c) => {
      const e = rt.resolve(p.who, c); if (!e?.space) return false;
      const api = rt.space(e.space), d = api.nearest(e, p.near, rt);
      return d !== null && d <= (p.within ?? 1);
    } });
    this.predicate('cell', { test: (p, rt, c) => { const sid = p.space ?? rt.resolve(p.who, c)?.space; return sid != null && rt.space(sid).getCell(p.cell, p.layer) === p.block; } });
    this.effect('teleport', { refs: e => e.zone ? [['zone', e.zone]] : [], run: (e, rt, c) => {
      const ent = rt.resolve(e.who, c); if (!ent) return;
      if (e.space && e.space !== ent.space) rt.moveToSpace(ent, e.space, e.at ?? null, e.zone);
      else rt.space(ent.space).teleport(ent, { zone: e.zone, at: e.at }, rt);
    } });
    // Intent only: movement primitives (ai, move.*) consume components.moveTo.
    this.effect('move_to', { refs: e => e.zone ? [['zone', e.zone]] : [], run: (e, rt, c) => { const ent = rt.resolve(e.who, c); if (ent) ent.components.moveTo = { zone: e.zone ?? null, at: e.at ?? null, run: Boolean(e.run) }; } });
    this.effect('end_game', { refs: e => e.ending ? [['ending', e.ending]] : [], run: (e, rt) => { rt.state.status = e.outcome || 'won'; rt.state.ending = e.ending || null; rt.emit('game_end', { ending: e.ending || null, outcome: rt.state.status }); } });
  }
  /** Register a predicate kind: { check?(p, path, errors, ctx), refs?(p) -> [[kind, id]], test(p, rt) }. */
  predicate(kind, def) { this.claim('predicate', kind); this.predicates.set(kind, def); }
  claim(type, kind) {
    const owner = this.owner ?? 'kernel', first = this.owners[type].get(kind);
    if (first !== undefined && first !== owner) this.duplicates.push({ type, kind, first, second: owner });
    this.owners[type].set(kind, owner);
  }
  /** Register an effect kind: { check?(e, path, errors, ctx), refs?(e), run(e, rt) }. */
  effect(kind, def) { this.claim('effect', kind); this.effects.set(kind, def); }
  kindOf(p) { return p && typeof p === 'object' ? Object.keys(p).find(k => this.predicates.has(k)) : undefined; }
  /** context: { self?, ...} carried from the caller (ai rule owner, interactable, beat). */
  test(p, rt, context = {}) { const kind = this.kindOf(p); if (!kind) throw Error(`unknown predicate ${JSON.stringify(p)}`); return this.predicates.get(kind).test(p, rt, context); }
  run(effects, rt, context = {}) { for (const e of effects || []) { this.effects.get(e.do).run(e, rt, context); if (rt.state.status !== 'playing') break; } }

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
