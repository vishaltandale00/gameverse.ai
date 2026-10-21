// Contextual interaction. Any entity whose archetype (or spawn) carries an
// `interact` component is an interactable:
//   interact: { prompt, kind?: talk|pickup|open|sit|pull|read|harvest|loot|use, id?, range?, hold? (s),
//               facing?: b, when?: pred, do?: fx, once?: b, uses?: i, cooldown?: s, regrow?: s,
//               give?: [{item, count|[a,b]}], take?: [{item, count}], consume?: b, text?, dialogue?, lockedPrompt? }
// The player's focus is the nearest enabled interactable in reach (and in
// front, when facing is required); `interact` uses it. Every use emits
// `interacted {who, target, kind, id}` (owners of other components react to it:
// containers open, shops open, checkpoints activate...) and `used:<id>` for each
// of the interactable's ids (interact.id, its mechanism id, an explicit entity id,
// its archetype), so `{used: "chime"}` counts every chime.
import { compare } from '../../kernel/logic.js';
import { give, take, count, room } from './inventory.js';
import { dist, facing, sub, center, isVec, norm, dot, runIf, roll, entityByRef, whoKey, checkItem } from './items-lib.js';

const KEY = 'gameplay.interact';
export const KINDS = ['talk', 'pickup', 'open', 'sit', 'pull', 'read', 'harvest', 'loot', 'use'];
const AUTO_ID = /^e\d+$/;

/** Ids an interactable answers to, primary first. */
export function aliases(e) {
  const c = e.components.interact || {}, out = [];
  for (const id of [c.id, typeof e.components.mechanism === 'string' ? e.components.mechanism : null, AUTO_ID.test(e.id) ? null : e.id, e.archetype]) if (id && !out.includes(id)) out.push(id);
  return out;
}
function kindOf(rt, e) {
  const c = e.components.interact || {};
  if (c.kind) return c.kind;
  const k = rt.archetype(e.archetype)?.kind;
  if (e.components.container) return 'open';
  if (e.components.pickup || e.components.collectible) return 'pickup';
  if (k === 'npc' || rt.doc.plot?.characters?.some(ch => ch.id === e.id)) return 'talk';
  return 'use';
}

export function install(rt, config) {
  const st = () => { const s = rt.store(KEY); s.uses ??= {}; s.ready ??= {}; s.disabled ??= {}; s.hold ??= {}; s.focus ??= {}; s.seated ??= {}; s.on ??= {}; return s; };
  st(); // created at install, so reads later never add state
  const rangeOf = e => e.components.interact.range ?? config.range;
  const holdOf = e => e.components.interact.hold ?? config.holdMs / 1000;
  const enabled = e => !aliases(e).some(id => st().disabled[id]) && !st().disabled[e.id];
  const spent = e => { const c = e.components.interact, n = st().uses[e.id] || 0; return (c.once && n >= 1) || (c.uses != null && n >= c.uses); };
  // plot.gate locks ('interactable:<id>') are enforced here through the gates service.
  const gateTargets = e => [...aliases(e), e.id].map(id => `interactable:${id}`);
  const gated = e => rt.hasService('gates') && gateTargets(e).some(t => rt.service('gates').locked(t));
  const allowed = (e, who) => !gated(e) && (!e.components.interact.when || rt.test(e.components.interact.when, { self: e.id, actor: who }));

  function inReach(actor, e) {
    if (actor.space !== e.space || dist(rt, actor, e) > rangeOf(e)) return false;
    if (config.facingOnly || e.components.interact.facing) {
      const f = facing(actor), a = center(rt, actor), b = center(rt, e);
      if (f && isVec(a) && isVec(b)) { const d = sub(b, a); if (Math.hypot(...d) > 1e-6 && dot(norm(d), f) < Math.cos(Math.PI / 180 * config.facingDeg)) return false; }
    }
    return true;
  }
  const candidates = actor => Object.values(rt.state.entities).filter(e => e !== actor && e.components.interact && e.space === actor.space && enabled(e) && !spent(e) && (st().ready[e.id] ?? -1) <= rt.state.frame);
  function focusOf(actor) {
    let best = null, bd = Infinity;
    for (const e of candidates(actor)) { if (!inReach(actor, e)) continue; const d = dist(rt, actor, e); if (d < bd || (d === bd && e.id < best.id)) { best = e; bd = d; } }
    return best;
  }

  /** Perform an interaction; returns true on success. Emits interact_denied {reason} otherwise. */
  function use(who, target, { force = false } = {}) {
    const actor = rt.entity(who), c = target?.components?.interact;
    if (!actor || !c) return false;
    const deny = reason => { rt.emit('interact_denied', { who, target: target.id, reason }); return false; };
    if (!enabled(target)) return deny('disabled');
    if (spent(target)) return deny('spent');
    if ((st().ready[target.id] ?? -1) > rt.state.frame) return deny('cooldown');
    if (!force && !inReach(actor, target)) return deny('range');
    if (!allowed(target, who)) { if (gated(target)) for (const t of gateTargets(target)) rt.service('gates').allows(t, { who }); return deny('locked'); }
    for (const t of c.take || []) if (count(rt, who, t.item) < (t.count ?? 1)) return deny('missing');
    const kind = kindOf(rt, target), ids = aliases(target);
    const gives = (c.give || []).map(g => ({ item: g.item, count: roll(rt, g.count, 1) }));
    if (target.components.pickup) gives.push({ item: target.components.pickup.item, count: target.components.pickup.count ?? 1 });
    if (gives.some(g => room(rt, who, g.item) < g.count)) { rt.emit('inventory_full', { item: gives[0].item, who }); return deny('full'); }
    for (const t of c.take || []) take(rt, who, t.item, t.count ?? 1);
    for (const g of gives) give(rt, who, g.item, g.count);
    const s = st();
    if (kind === 'talk') { rt.emitTyped('talked', target.id, { who, target: target.id }); if (c.dialogue) runIf(rt, { do: 'start_dialogue', dialogue: c.dialogue, with: target.id }, { self: target.id, actor: who }); }
    else if (kind === 'sit') { if (s.seated[who] === target.id) { delete s.seated[who]; rt.emit('stood', { who, target: target.id }); } else { s.seated[who] = target.id; rt.emit('sat', { who, target: target.id }); } }
    else if (kind === 'pull') { s.on[target.id] = !s.on[target.id]; rt.emit('toggled', { who, target: target.id, on: s.on[target.id] }); }
    else if (kind === 'read') rt.emitTyped('read', ids[0], { who, target: target.id, text: c.text ?? c.prompt ?? '' });
    else if (kind === 'harvest') rt.emitTyped('harvested', ids[0], { who, target: target.id, items: gives });
    s.uses[target.id] = (s.uses[target.id] || 0) + 1;
    const wait = c.regrow ?? c.cooldown;
    if (wait) s.ready[target.id] = rt.state.frame + Math.max(1, Math.round(wait / rt.dt));
    const data = { who, target: target.id, kind, id: ids[0], archetype: target.archetype };
    rt.emit('interacted', data);
    rt.emitTyped('used', ids[0], data);
    for (const id of ids.slice(1)) rt.emit(`used:${id}`, data);
    if (c.do?.length) rt.run(c.do, { self: target.id, actor: who });
    const consume = c.consume ?? (kind === 'pickup');
    if (consume && rt.entity(target.id)) rt.despawn(target.id);
    return true;
  }

  rt.action('interact', (value, rt) => {
    const p = rt.player(); if (!p) return;
    const target = value === true ? focusOf(p) : rt.entity(value);
    if (!target) { rt.emit('interact_denied', { who: 'player', target: value === true ? null : value, reason: 'none' }); return; }
    if (holdOf(target) > 0) { const h = st().hold.player; if (!h || h.target !== target.id) { st().hold.player = { target: target.id, t: 0 }; rt.emit('interact_hold', { who: 'player', target: target.id, sec: holdOf(target) }); } st().hold.player.pressed = rt.state.frame; return; }
    use('player', target);
  });

  rt.system('interaction', rt => {
    const s = st(), p = rt.player();
    // Holds advance while the verb is pressed or held and the target stays in reach.
    for (const [who, h] of Object.entries(s.hold)) {
      const actor = rt.entity(who), target = rt.entity(h.target);
      const held = (who === 'player' && (rt.input.held?.interact || h.pressed === rt.state.frame));
      if (!actor || !target || !held || !inReach(actor, target)) { delete s.hold[who]; rt.emit('interact_cancelled', { who, target: h.target }); continue; }
      h.t += rt.dt;
      if (h.t + 1e-9 >= holdOf(target)) { delete s.hold[who]; use(who, target); }
    }
    if (!p) return;
    const f = focusOf(p), prev = s.focus.player?.target ?? null;
    s.focus.player = f ? { target: f.id, label: allowed(f, 'player') ? f.components.interact.prompt ?? kindOf(rt, f) : f.components.interact.lockedPrompt ?? 'Locked', verb: 'interact', kind: kindOf(rt, f), id: aliases(f)[0], locked: !allowed(f, 'player'), ...(holdOf(f) > 0 ? { hold: holdOf(f) } : {}) } : null;
    if (config.prompts && (f?.id ?? null) !== prev) { if (f) rt.emit('interact_focus', { target: f.id, label: s.focus.player.label }); else rt.emit('interact_blur', { target: prev }); }
  }, KEY);

  rt.provide('interact', { focus: (who = 'player') => st().focus[who] ?? null, use: (who, id, opts) => use(who, rt.entity(id), opts), inReach: (who, id) => inReach(rt.entity(who), rt.entity(id)), seated: who => st().seated[who] ?? null, aliases: id => aliases(rt.entity(id)) });
  rt.caches.interactUse = use;
  rt.onRestore(rt => { delete rt.caches.interactReach; }); // a restored state may differ at the same frame and cell

  // Solver options: every usable interactable in reach, plus the nearest reachable ones
  // (macro travel through the pathfind capability, then interact).
  rt.options(rt => {
    const p = rt.player(); if (!p) return [];
    const out = [], far = [];
    for (const e of candidates(p)) {
      if (!allowed(e, 'player')) continue;
      const steps = Math.max(1, Math.ceil(holdOf(e) / rt.dt) + 1);
      if (inReach(p, e)) out.push({ label: `interact ${aliases(e)[0]}${e.id !== aliases(e)[0] ? ` (${e.id})` : ''}`, actions: { interact: e.id }, steps });
      else if (isVec(p.at) && isVec(e.at)) far.push({ e, d: dist(rt, p, e), steps });
    }
    const sp = p.space && rt.space(p.space);
    if (far.length && config.macroOptions && sp && typeof sp.path === 'function' && typeof sp.reachable === 'function') {
      // Listing is cheap: one reachable() set per frame and player cell, membership per target.
      // path() runs only when an option is applied.
      const reach = reachableSet(rt, sp, p);
      far.sort((a, b) => a.d - b.d || (a.e.id < b.e.id ? -1 : 1));
      let macros = 0;
      for (const { e, steps } of far) {
        if (!reachedBy(reach, sp, e)) continue;
        out.push({ label: `go to and interact ${aliases(e)[0]}${e.id !== aliases(e)[0] ? ` (${e.id})` : ''}`, actions: { interact: e.id }, steps,
          apply(rt) { const q = rt.player(), s = rt.space(q.space), t = rt.entity(e.id); if (!t) return; const path = s.path(s.pos(q), s.pos(t), { who: q }); if (path?.length) s.setPos(q, path.length > 1 ? path[path.length - 2] : path[0], rt); } });
        if (++macros >= config.macroOptions) break;
      }
    }
    return out;
  });
}

/** Membership key of an entity's cell: the space's cellOf when it has one, else its floored position joined by commas. */
const keyOf = (sp, e) => (typeof sp.cellOf === 'function' ? sp.cellOf(e) : sp.pos(e).map(Math.floor).join(','));
/** The reachable set from the player's cell, cached in rt.caches by frame, space and cell. */
function reachableSet(rt, sp, p) {
  const k = `${rt.state.frame}|${p.space}|${keyOf(sp, p)}|${rt.state.spaces[p.space]?.log?.length ?? 0}`, c = rt.caches.interactReach;
  if (c?.key === k) return c.set;
  const set = sp.reachable(sp.pos(p), rt, { who: p });
  rt.caches.interactReach = { key: k, set };
  return set;
}
/** Reached when the target's cell, or a face neighbour of it (interactables often sit against walls), is in the set. */
function reachedBy(set, sp, e) {
  const k = keyOf(sp, e); if (set.has(k)) return true;
  const n = String(k).split(',').map(Number); if (!n.length || n.some(x => !Number.isFinite(x))) return false;
  for (let i = 0; i < n.length; i++) for (const d of [-1, 1]) { const m = n.slice(); m[i] += d; if (set.has(m.join(','))) return true; }
  return false;
}

export default {
  id: 'gameplay.interact',
  card: {
    // The participants an event names (role -> data field): who used something and what it used.
    loop: { verbs: ['interact'], progress: ['interacted', 'used', 'read'], involves: { interacted: { user: 'who', used: 'target' } } },
    // Shapes of the archetype components this primitive owns (the planner's schemas and repair read them).
    components: { interact: { type: 'object', fields: { prompt: { type: 'string' }, range: { type: 'number', min: 0 }, kind: { type: 'string' }, id: { type: 'string', effect: 'interactable id (used:<id> events)' } }, effect: 'something the player can use' } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "archetypes", "component": "interact", "min": 1, "placed": 2, "why": "interactables are entities with an interact component {prompt, range}, placed where the player can use them", "example": {"id": "old_lever", "kind": "prop", "components": {"interact": {"prompt": "Pull", "range": 1.5}}}},
    ],
    intent: 'Contextual use of interactables (archetype `interact` components): talk, pick up, open, sit, pull, read, harvest, loot. Range, facing and hold-to-use; prompts for the HUD; used:<id> events for quests; solver options for every interactable in reach or reachable.',
    views: ['any'],
    params: {
      range: { type: 'number', default: 2.5, min: 0, max: 50, unit: 'space units', effect: 'default reach (components.interact.range overrides); graph spaces need the same node' },
      facingOnly: { type: 'boolean', default: false, effect: 'only interactables in front of the actor (components.body.facing) are usable' },
      facingDeg: { type: 'number', default: 60, min: 1, max: 180, unit: 'deg', effect: 'half-angle of the facing cone' },
      holdMs: { type: 'number', default: 0, min: 0, max: 10000, unit: 'ms', effect: 'default hold time to use (components.interact.hold in s overrides); 0 = press' },
      prompts: { type: 'boolean', default: true, effect: 'emit interact_focus/interact_blur as the focused interactable changes' },
      macroOptions: { type: 'integer', default: 8, min: 0, max: 64, effect: 'reachable-but-not-in-reach interactables offered to solvers as travel-then-interact options' },
    },
    provides: { events: ['interacted', 'used', 'used:*', 'interact_denied', 'interact_focus', 'interact_blur', 'interact_hold', 'interact_cancelled', 'talked', 'talked:*', 'sat', 'stood', 'toggled', 'read', 'read:*', 'harvested', 'harvested:*'], actions: ['interact'], services: ['interact'] },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
  },
  logic(logic) {
    logic.predicate('used', { refs: p => [['event', `used:${p.used}`]], test: (p, rt) => compare(rt.state.counts[`used:${p.used}`] ?? 0, p) });
    logic.predicate('seated', { test: (p, rt, c) => { const s = rt.store(KEY).seated?.[whoKey(p.who, c)]; return p.seated === true ? Boolean(s) : s === p.seated; } });
    logic.effect('interact', {
      check: (e, path, errors) => { if (!e.target) errors.push({ code: 'effect_invalid', path, message: 'interact needs a target (entity id or archetype)' }); },
      run: (e, rt, c) => { const t = entityByRef(rt, e.target, c); if (t && rt.caches.interactUse) rt.caches.interactUse(whoKey(e.who, c), t, { force: true }); },
    });
    logic.effect('enable_interactable', {
      check: (e, path, errors) => { if (!e.id) errors.push({ code: 'effect_invalid', path, message: 'enable_interactable needs an id' }); },
      run: (e, rt) => { const d = (rt.store(KEY).disabled ??= {}); if (e.on === false) d[e.id] = true; else delete d[e.id]; },
    });
  },
  validate(config, doc, ctx) {
    const errors = [];
    (doc.content?.archetypes || []).forEach((a, i) => {
      const c = a.components?.interact; if (!c) return;
      const path = `content.archetypes[${i}].components.interact`;
      if (typeof c !== 'object' || Array.isArray(c)) { errors.push({ code: 'interact_invalid', path, message: 'interact must be an object' }); return; }
      if (c.kind !== undefined && !KINDS.includes(c.kind)) errors.push({ code: 'interact_invalid', path: `${path}.kind`, message: `kind '${c.kind}' is not one of ${KINDS.join('|')}` });
      for (const k of ['range', 'hold', 'cooldown', 'regrow']) if (c[k] !== undefined && !(Number.isFinite(c[k]) && c[k] >= 0)) errors.push({ code: 'interact_invalid', path: `${path}.${k}`, message: `${k} must be a non-negative number` });
      if (c.when) ctx.checkPredicate(c.when, `${path}.when`, errors);
      (c.do || []).forEach((e, k) => ctx.checkEffect(e, `${path}.do[${k}]`, errors));
      [...(c.give || []), ...(c.take || [])].forEach((g, k) => checkItem(doc, g.item, `${path}.items[${k}]`, errors));
      if (a.components.pickup) checkItem(doc, a.components.pickup.item, `content.archetypes[${i}].components.pickup.item`, errors);
    });
    return errors;
  },
  /** Solver key: uses only where they are limited (once / uses), switches and seats; cooldowns as booleans, not frame numbers. */
  solverKey(rt) {
    const s = rt.state.prim[KEY] || {}, uses = {};
    for (const [id, n] of Object.entries(s.uses || {}).sort()) { const c = rt.entity(id)?.components.interact; const cap = c?.uses ?? (c?.once ? 1 : 0); if (cap) uses[id] = Math.min(n, cap); }
    return [uses, s.disabled || {}, s.on || {}, s.seated || {}, Object.keys(s.ready || {}).filter(id => s.ready[id] > rt.state.frame).sort(), Object.keys(s.hold || {})];
  },
  install,
};
