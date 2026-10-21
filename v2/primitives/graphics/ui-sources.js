// Read-only adapters from UI primitives to the gameplay/plot primitives they
// present. Each reader prefers the owning primitive's service (the contracts
// agreed with each workstream), then its documented state or predicates, then
// events/document data. Nothing here writes rt.state.
//
// Contracts consumed (owner):
//   inventory  service inventory.bag(who) | state.prim['gameplay.inventory'][who]   (items)
//   equipment  service equipment.slots(who) / budget(who); predicate equipped       (items)
//   crafting   service crafting.station(who) / craftable(who); predicate knows      (items)
//   shop       service shop.open(who); actions buy/sell/close_shop                 (items)
//   container  service container.open(who); actions take/store/take_all/close_container (items)
//   interact   service interact.focus(who); events interact_focus/interact_blur; nearest components.interact {prompt, range} (items, frozen)
//   status     service status.list(entity) | components.status {id: secondsLeft}   (combat, frozen)
//   boss       vars boss.hp boss.hp.max boss.phase boss.id; events boss_*          (combat)
//   quests     service quests.list() | predicates quest/objective                  (story)
//   dialogue   service dialogue.view() | events dialogue_line/dialogue_end         (story)
//   journal    service journal.known(id) | predicate known{entry} over plot.entries (story)
//   turns      service turns.view(); verbs turn_act/end_turn                       (modes)
//   cards      service cards.view(owner); verbs play_card/end_turn                 (modes)
//   battle     service battle.view() | gameplay.creature.battle store + battle options (puzzle)
//   input      service input.glyph(verb) / device()                                (runtime)
//   save       service save.slots(); actions save_game/load_game                  (runtime)
import { docSystem, titleCase } from './ui-lib.js';

/**
 * What an entity is called on screen: its character's declared name (plot.characters), else its archetype's
 * (content.archetypes): the names the content forms theme. A view's own name for it (a primitive's fallback to the
 * entity id) and the title-cased archetype id come only after the declarations.
 */
export function entityName(rt, id, viewName = null) {
  const e = rt.entity(id), doc = rt.doc || {};
  const declared = (doc.plot?.characters || []).find(c => c.id === id)?.name || (doc.content?.archetypes || []).find(a => a.id === e?.archetype)?.name;
  if (declared) return declared;
  return viewName && viewName !== id ? viewName : titleCase(e?.archetype || id);
}

export const vars = (rt, name) => rt.state.vars[name];
export const num = (rt, name, d = 0) => { const v = rt.state.vars[name]; return typeof v === 'number' && Number.isFinite(v) ? v : d; };
export const count = (rt, name) => rt.state.counts[name] || 0;
export const canAct = (rt, verb) => rt.actions().includes(verb);

/** A service method result, or undefined when the service or method is missing or throws. */
export function svc(rt, name, method, ...args) {
  if (!rt.hasService?.(name)) return undefined;
  try { const s = rt.service(name); return typeof s[method] === 'function' ? s[method](...args) : undefined; } catch { return undefined; }
}
/** Predicate test that is false (not a crash) when the vocabulary is not registered. */
export function safeTest(rt, pred) {
  const kind = rt.logic?.kindOf?.(pred); if (!kind || (rt.canTest && !rt.canTest(kind))) return false; // owner must be installed (KERNEL_API vocabulary rules)
  try { return Boolean(rt.test(pred)); } catch { return false; }
}
export const hasPredicate = (rt, kind) => (rt.canTest ? rt.canTest(kind) : Boolean(rt.logic?.predicates?.has?.(kind)));

// ---------------------------------------------------------------- items
export function bag(rt, who = 'player') {
  const s = svc(rt, 'inventory', 'bag', who);
  if (s && typeof s === 'object') return s;
  return rt.state.prim['gameplay.inventory']?.[who] || {};
}
export function equipment(rt, who = 'player') {
  const slots = svc(rt, 'equipment', 'slots', who);
  if (Array.isArray(slots)) return { slots: slots.map(s => ({ id: s.id, accepts: s.accepts || [], items: s.items || (s.item ? [s.item] : []), max: s.max ?? 1 })), budget: svc(rt, 'equipment', 'budget', who) || null };
  // Fallback: the document's slot definitions, filled through the `equipped` predicate.
  const cfg = docSystem(rt.doc, 'gameplay.equipment')?.with;
  if (!cfg) return null;
  const owned = Object.keys(bag(rt, who));
  const items = rt.doc.content?.items || [];
  const out = (cfg.slots || []).map(s => ({ id: s.id, accepts: s.accepts || [], max: s.max ?? 1,
    items: owned.filter(id => safeTest(rt, { equipped: id, slot: s.id, who }) || (safeTest(rt, { equipped: id, who }) && accepts(s, items.find(i => i.id === id)))) }));
  return { slots: out, budget: cfg.budget ? { pool: cfg.budget.pool, total: cfg.budget.total, used: out.flatMap(s => s.items).reduce((n, id) => n + (items.find(i => i.id === id)?.charm?.cost || 0), 0) } : null };
}
/** Whether an equipment slot accepts an item ('weapon', 'armor:head', 'charm' match kind or kind:slot or tags). */
export function accepts(slot, item) {
  if (!item) return false;
  const keys = new Set([item.kind, ...(item.tags || []), item.armor?.slot && `armor:${item.armor.slot}`, item.armor?.slot && `${item.kind}:${item.armor.slot}`].filter(Boolean));
  return (slot.accepts || []).some(a => keys.has(a));
}
export const shop = (rt, who = 'player') => svc(rt, 'shop', 'open', who) || null;
export const container = (rt, who = 'player') => svc(rt, 'container', 'open', who) || null;
export const station = (rt, who = 'player') => svc(rt, 'crafting', 'station', who) || null;
export function craftable(rt, who = 'player') { const list = svc(rt, 'crafting', 'craftable', who); return Array.isArray(list) ? new Set(list) : null; }
export function money(rt) {
  const cfg = docSystem(rt.doc, 'gameplay.economy')?.with;
  const cur = cfg?.currencies?.length ? cfg.currencies : Object.keys(rt.state.vars).filter(k => k.startsWith('money.')).map(k => ({ id: k.slice(6), name: k.slice(6), var: k }));
  return cur.map(c => ({ id: c.id, name: c.name || c.id, var: c.var || `money.${c.id}`, value: num(rt, c.var || `money.${c.id}`) }));
}

// ---------------------------------------------------------------- combat
export function health(entity) { const h = entity?.components?.health; if (!h) return null; return { hp: h.hp ?? h.max ?? 0, max: h.max ?? h.hp ?? 1, dead: Boolean(h.dead) }; }
export function statuses(rt, entity) {
  if (!entity) return [];
  const list = svc(rt, 'status', 'list', entity);
  if (Array.isArray(list)) return list;
  // Frozen field (KERNEL_API §2): components.status = { statusId: secondsLeft }.
  const st = entity.components?.status || {};
  if (st.active && typeof st.active === 'object') return Object.entries(st.active).map(([id, s]) => ({ id, remaining: (s.left ?? 0) / 60, stacks: s.stacks ?? 1 }));
  return Object.entries(st).filter(([, v]) => typeof v === 'number' && v > 0).map(([id, v]) => ({ id, remaining: v, stacks: 1 }));
}
export function boss(rt) {
  const hp = vars(rt, 'boss.hp'), id = vars(rt, 'boss.id');
  if (typeof hp !== 'number' || (!id && hp <= 0)) return null;
  const max = num(rt, 'boss.hp.max', hp <= 1 ? 1 : hp);
  return { id: id || null, hp, max: Math.max(max, 1e-6), phase: num(rt, 'boss.phase', 0) };
}

// ---------------------------------------------------------------- interact
export function interactFocus(rt, who = 'player', last = null) {
  const f = svc(rt, 'interact', 'focus', who);
  if (f !== undefined) return f || null;
  if (last) return last; // event-driven fallback tracked by the HUD
  return nearestInteractable(rt, who);
}
/** Presentation-only fallback: the nearest entity with an interact component in range (frozen fields id, kind, prompt, range). */
export function nearestInteractable(rt, who = 'player') {
  const p = rt.resolve(who); if (!p?.space) return null;
  let api; try { api = rt.space(p.space); } catch { return null; }
  if (typeof api.distance !== 'function') return null;
  let best = null, bestD = Infinity;
  for (const e of Object.values(rt.state.entities)) {
    const it = e.components?.interact; if (!it || e === p || e.space !== p.space) continue;
    let d; try { d = api.distance(p.at, e.at); } catch { continue; }
    if (Number.isFinite(d) && d <= (it.range ?? 1.5) && d < bestD) { bestD = d; best = { target: e.id, label: it.prompt || `${String(it.kind || 'use').replace(/^./, c => c.toUpperCase())}`, verb: 'interact', kind: it.kind || null }; }
  }
  return best;
}

// ---------------------------------------------------------------- plot
const QUEST_STATES = ['active', 'available', 'complete', 'failed'];
/** Quest list with states and objectives: [{id,title,kind,summary,giver,zone,state,tracked,objectives:[{id,text,state,progress,count,hidden}]}] */
export function quests(rt) {
  const list = svc(rt, 'quests', 'list');
  const defs = rt.doc.plot?.quests || [];
  if (Array.isArray(list)) return list.map(q => ({ ...(defs.find(d => d.id === q.id) || {}), ...q, objectives: (q.objectives || []).map(o => ({ ...((defs.find(d => d.id === q.id)?.objectives || []).find(x => x.id === o.id) || {}), ...o })) }));
  if (!hasPredicate(rt, 'quest')) return [];
  const tracked = vars(rt, 'quests.tracked');
  return defs.map(q => {
    const state = QUEST_STATES.find(s => safeTest(rt, { quest: q.id, state: s })) || 'locked';
    const objectives = (q.objectives || []).map(o => ({ ...o, state: safeTest(rt, { objective: o.id, quest: q.id, state: 'done' }) ? 'done' : (state === 'active' && safeTest(rt, { objective: o.id, quest: q.id, state: 'active' }) ? 'active' : 'pending') }));
    return { ...q, state, tracked: tracked === q.id, objectives };
  });
}
/** The quest the HUD tracks: explicitly tracked, else the first active main quest, else the first active one. */
export function trackedQuest(list) {
  const active = list.filter(q => q.state === 'active');
  return active.find(q => q.tracked) || active.find(q => q.kind === 'main') || active[0] || null;
}
export const objectiveProgress = o => (typeof o.progress === 'number' && o.count > 1 ? ` ${Math.min(o.progress, o.count)}/${o.count}` : '');

export function dialogueView(rt) { const v = svc(rt, 'dialogue', 'view'); return v === undefined ? undefined : (v?.active ? v : null); }
export function known(rt, entry) { const k = svc(rt, 'journal', 'known', entry.id); if (typeof k === 'boolean') return k; return hasPredicate(rt, 'known') ? safeTest(rt, { known: entry.id }) : !docSystem(rt.doc, 'plot.journal'); }
export function met(rt, id) { return safeTest(rt, { met: id }) || count(rt, `talked:${id}`) > 0; }
/** Discovered: engine.zones' discovered:<zone> count or predicate, the player's current zone, or a UI-local visited set (enter_zone counts include every entity, so they are not used). */
export const discovered = (rt, zone, visited) => count(rt, `discovered:${zone}`) > 0 || safeTest(rt, { discovered: zone }) || rt.player()?.zone === zone || rt.player()?.at === zone || Boolean(visited?.has(zone));

// ---------------------------------------------------------------- modes
export function battleView(rt) {
  const b = svc(rt, 'battle', 'view');
  if (b?.active) return { source: 'battle', ...b };
  const cb = rt.has?.('gameplay.creature.battle') && rt.state.prim['gameplay.creature.battle']?.battle;
  if (cb && !cb.over) return { source: 'options', ...fromCreatureBattle(rt, cb) };
  const t = svc(rt, 'turns', 'view');
  if (t?.active) return { source: 'turns', ...fromTurns(rt, t) };
  return null;
}
/**
 * gameplay.creature.battle has no view service yet: read its documented store for the two active
 * creatures, and build the command menu from the solver options that use the `battle` verb, so
 * every legal answer is offered and sent exactly as the primitive defines it.
 */
function fromCreatureBattle(rt, b) {
  const unit = (side, c, i, active) => { const max = svc(rt, 'creatures', 'stats', c)?.hp ?? c.maxHp ?? c.hp; const sp = rt.doc.content?.species?.find?.(x => x.id === c.species); return { id: `${side}:${c.uid ?? i}`, name: c.name || sp?.name || c.species, model: sp?.model || c.species, hp: c.hp, hpMax: max || 1, level: c.level, status: c.status ? [c.status] : [], active, down: c.hp <= 0 }; };
  const me = b.player.party[b.player.active], foe = b.foe.party[b.foe.active];
  const opts = rt.availableOptions().filter(o => o.actions?.battle);
  const pretty = o => { const v = o.actions.battle; if (v.kind === 'move') { const m = me?.moves?.[v.index]; const def = rt.doc.content?.moves?.find?.(x => x.id === m?.id); return { label: def?.name || String(m?.id || o.label.replace(/^use /, '')).replace(/[_-]+/g, ' ').replace(/^./, x => x.toUpperCase()), pp: m?.pp, ppMax: def?.pp, type: def?.type }; } if (v.kind === 'item') return { label: rt.doc.content?.items?.find(x => x.id === v.item)?.name || o.label }; if (v.kind === 'switch') return { label: `Send ${b.player.party[v.index]?.name || o.label}` }; if (v.kind === 'run') return { label: 'Run' }; return { label: o.label }; };
  return { active: true, turn: 'player', sides: [{ id: 'player', player: true, units: me ? [unit('player', me, b.player.active, true)] : [] }, { id: 'foe', units: foe ? [unit('foe', foe, b.foe.active, false)] : [] }],
    menu: opts.map(o => ({ id: o.label, kind: o.actions.battle.kind === 'learn' ? 'move' : o.actions.battle.kind, enabled: true, action: o.actions, target: 'none', ...pretty(o) })) };
}
/** Map gameplay.turns' view onto the battle view shape. */
function fromTurns(rt, t) {
  const myTurn = (t.sides || []).find(s => s.id === t.side)?.control === 'player';
  return {
    active: true, turn: myTurn ? 'player' : t.side, round: t.round,
    sides: (t.sides || []).map(s => ({ id: s.id, player: s.control === 'player', units: (s.units || []).map(u => { const e = rt.entity(u.id), hp = health(e); return { id: u.id, name: entityName(rt, u.id, u.name), model: e?.components?.model, hp: hp?.hp ?? 0, hpMax: hp?.max ?? 1, active: u.id === t.unit, down: u.downed || hp?.dead, ap: u.ap, apMax: u.apMax }; }) })),
    menu: myTurn ? (t.legal || []).map(a => ({ id: a.id, label: a.label || a.id, kind: 'move', enabled: true, cost: a.cost, target: a.target, targets: a.targets, hit: a.hit })) : [],
    ap: t.ap, apMax: t.apMax,
  };
}
export function cardsView(rt, owner = 'player') { const v = svc(rt, 'cards', 'view', owner); return v && (v.hand || v.board) ? v : null; }
export const saveSlots = rt => svc(rt, 'save', 'slots') || null;
