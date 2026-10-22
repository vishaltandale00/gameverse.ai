// Every quest type from one primitive (plot.quest): quests in plot.quests are
// lists of objectives built from the kinds in story-objectives.js (catalog
// §4.2), completed in sequence or any order, with fail predicates, time
// limits, giver death, branches (the first branch whose `when` holds at
// completion is the outcome), rewards (as effects), repeatable quests and
// an active cap.
//
// Quest life cycle: locked -> available (prereq quests complete, `gate`
// holds, no plot.gate `quest:<id>` lock) -> active -> complete | failed.
// How an available quest starts is `offer`:
//   auto   - starts by itself (default when autoStart)
//   accept - the player takes it with `accept_quest` from its giver (in talk
//            range) or anywhere when it has no giver; a solver option
//   script - only a start_quest effect starts it
// Default for non-autoStart quests: script when any effect in the document
// starts the quest, otherwise accept. start_quest always starts (story wins
// over maxActive and gate); accept_quest respects maxActive.
import { err, cached, allEffects, service, isObj, TEXT, LINE, KEY_ID, plotExample } from './story-lib.js';
import { OBJECTIVES, BASE_FIELDS, needOf } from './story-objectives.js';

const ID = 'plot.quest';
const KINDS = ['main', 'side', 'contract', 'bounty', 'challenge'];
const STATES = ['locked', 'available', 'active', 'complete', 'failed'];
const OBJ_STATES = ['inactive', 'active', 'done', 'failed'];

const st = rt => { const s = rt.store(ID); s.q ??= {}; s.tracked ??= null; return s; };
const index = rt => cached(rt, 'plot.quest.index', doc => {
  const quests = new Map((doc.plot?.quests || []).map(q => [q.id, q]));
  const scripted = new Set(allEffects(doc).filter(x => x.e.do === 'start_quest').map(x => x.e.quest));
  return { quests, scripted };
});
export const offerOf = (q, scripted) => q.offer ?? (q.autoStart ? 'auto' : scripted.has(q.id) ? 'script' : 'accept');

function rewardEffects(r = {}) {
  const fx = [];
  if (r.xp) fx.push({ do: 'give_xp', amount: r.xp });
  if (r.money) fx.push({ do: 'give_money', amount: r.money.amount, ...(r.money.currency ? { currency: r.money.currency } : {}) });
  for (const it of r.items || []) fx.push({ do: 'give_item', item: it.item, count: it.count ?? 1 });
  for (const rep of r.rep || []) fx.push({ do: 'add_rep', faction: rep.faction, delta: rep.delta });
  return [...fx, ...(r.do || [])];
}

export default {
  id: ID,
  solverKey, progress,
  card: {
    loop: { shows: [], verbs: ['accept_quest', 'track_quest'], progress: ['objective_done', 'quest_complete'], win: { when: { count: 'quest_complete', gte: '$target' }, reads: { event: 'quest_complete', by: { actions: ['accept_quest'], effects: ['complete_quest', 'set_objective'], events: ['*'] } } } },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { accept_quest: { type: 'choice', of: 'an offered quest', from: 'options', emits: ['quest_started'] }, track_quest: { type: 'choice', of: 'an active quest', from: 'options', emits: ['quest_tracked'] } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "section", "at": "plot.quests", "min": 2, "why": "quests are objectives built from goal kinds (reach, collect, deliver, defeat, talk, escort, survive, build, drive, craft, use, discover) with rewards", "example": {"id": "q_lamp", "title": "Light the lamp", "kind": "main", "giver": "keeper", "zone": "lighthouse", "summary": "Find the brass key and open the lamp room.", "autoStart": true, "objectives": [{"id": "o_talk", "kind": "talk", "character": "keeper", "text": "Speak to the keeper."}, {"id": "o_key", "kind": "collect", "item": "brass_key", "count": 1, "text": "Find the brass key."}, {"id": "o_room", "kind": "reach", "zone": "lamp_room", "text": "Open the lamp room."}], "rewards": {"items": [{"item": "lens", "count": 1}]}}},
    ],
    intent: 'Quests of any type from plot.quests: objectives of kinds reach, collect, deliver, defeat, talk, escort, survive, build, drive, craft, use, discover, until; sequential or any order; fail predicates, time limits, branches, rewards, repeatable quests. Offered quests are taken with accept_quest.',
    views: ['any'],
    params: {
      maxActive: { type: 'integer', default: 20, min: 1, max: 50, effect: 'accept_quest refuses beyond this many active quests (story starts are never refused)' },
      trackOne: { type: 'boolean', default: true, effect: 'one tracked quest; a newly started main quest is tracked when none is' },
      failOnDeathOfGiver: { type: 'boolean', default: false, effect: 'active quests fail when their giver dies' },
    },
    // Events it emits when it refuses a player's verb, with a reason (graphics.ui.hud says why).
    denials: ['quest_blocked'],
    provides: { events: ['quest_branch', 'quest_available', 'quest_available:*', 'quest_started', 'quest_started:*', 'quest_updated', 'objective_done', 'objective_done:*', 'objective_failed', 'quest_complete', 'quest_complete:*', 'quest_failed', 'quest_failed:*', 'quest_tracked', 'quest_blocked', 'delivered'], vars: ['quests.active', 'quests.complete'], services: ['quests'], actions: ['accept_quest', 'track_quest'] },
    // What a person is told when these events fire (a story log, a toast): `label`, then the title of the document entry
    // the event names (`entry`: the section and the event field holding its id), then the entry's `detail` field when set.
    tells: { objective_done: { label: 'Objective done', entry: { at: 'plot.quests', by: 'quest' } }, quest_started: { label: 'New task', entry: { at: 'plot.quests', by: 'quest' }, detail: 'summary' }, quest_complete: { label: 'Task done', entry: { at: 'plot.quests', by: 'quest' } }, quest_failed: { label: 'Task failed', entry: { at: 'plot.quests', by: 'quest' } } },
    reads: ['plot.quests'],
    // Section shapes this primitive reads (planner: composition renames the references they hold, repair and forms use them).
    // An objective's fields are its kind's (story-objectives.js, the same fields the validator checks): `variants`.
    // An entry has only the fields declared here (open: false); an objective's fields are its kind's (story-objectives.js,
    // `variants`: the kernel checks each objective against its kind's fields).
    data: { 'plot.quests': { type: 'list', of: { type: 'object', open: false, fields: {
      title: LINE({ required: true, effect: 'the quest\'s title a person reads' }), kind: { type: 'string', options: KINDS }, summary: TEXT({ effect: 'what the quest asks, as the quest log tells it' }),
      giver: { type: 'ref', to: 'character' }, zone: { type: 'ref', to: 'zone' }, gate: { type: 'predicate' }, prereq: { type: 'list', of: { type: 'ref', to: 'quest' }, effect: 'other quests completed first' },
      autoStart: { type: 'boolean' }, offer: { type: 'string', options: ['auto', 'accept', 'script'] }, order: { type: 'string', options: ['sequential', 'any'] },
      fail: { type: 'predicate' }, timeLimit: { type: 'number', min: 0, unit: 's', effect: 'the quest fails this long after it starts (0: no limit)' }, onStart: { type: 'effects' }, onComplete: { type: 'effects' }, onFail: { type: 'effects' },
      rewards: { type: 'object', fields: { xp: { type: 'number', min: 0 }, money: { type: 'object', fields: { amount: { type: 'number', min: 0, required: true }, currency: { type: 'string', effect: 'an economy currency (default: the economy\'s first)' } } }, items: { type: 'list', of: { type: 'object', fields: { item: { type: 'ref', to: 'item', required: true }, count: { type: 'integer', min: 1 } } } }, rep: { type: 'list', of: { type: 'object', fields: { faction: { type: 'ref', to: 'faction', required: true }, delta: { type: 'number', required: true } } } }, do: { type: 'effects' } } },
      repeatable: { type: 'boolean' }, branches: { type: 'list', of: { type: 'object', fields: { id: KEY_ID, label: TEXT({ effect: 'the outcome as a person reads it' }), when: { type: 'predicate' }, do: { type: 'effects' } } } },
      tags: { type: 'list', of: { type: 'string' } }, hidden: { type: 'boolean' },
      objectives: { type: 'list', min: 1, required: true, of: { type: 'object', fields: { ...BASE_FIELDS, kind: { type: 'string', required: true, options: Object.keys(OBJECTIVES) } }, variants: { by: 'kind', of: Object.fromEntries(Object.entries(OBJECTIVES).map(([k, o]) => [k, o.fields || {}])) } } },
    } } } },
    rules: {
      quest_invalid: { fields: ['plot.quests[].objectives[].optional'], message: 'a quest has at least one objective that is not optional (else it could never complete)',
        example: plotExample({ quests: [{ id: 'q', title: 'Wait', objectives: [{ id: 'wait', kind: 'until', when: { time: 0 }, optional: true }] }] }, 'plot.quests[0].objectives') },
      quest_cycle: { fields: ['plot.quests[].prereq'], message: 'a quest never requires itself, directly or through other quests\' prereq',
        example: plotExample({ quests: [{ id: 'q', title: 'Wait', prereq: ['q'], objectives: [{ id: 'wait', kind: 'until', when: { time: 0 } }] }] }, 'plot.quests[0].prereq[0]') },
      objective_duplicate: { fields: ['plot.quests[].objectives[].id'], message: 'objective ids are unique within their quest',
        example: plotExample({ quests: [{ id: 'q', title: 'Wait', objectives: [{ id: 'wait', kind: 'until', when: { time: 0 } }, { id: 'wait', kind: 'until', when: { time: 0 } }] }] }, 'plot.quests[0].objectives[1].id') },
      objective_invalid: { fields: ['plot.quests[].objectives[]'], message: 'reach gives zone or at; defeat archetype or target; survive seconds or until; build block or structure; drive to or distance; use interactable or tag; talk gives dialogue when it gives node',
        example: plotExample({ quests: [{ id: 'q', title: 'Hold on', objectives: [{ id: 'hold', kind: 'survive' }] }] }, 'plot.quests[0].objectives[0]') },
      objective_target_unknown: { fields: ['plot.quests[].objectives[].to', 'plot.quests[].objectives[].who'], message: 'a deliver objective\'s to is a character or a zone id; an escort objective\'s who is a character or an archetype id',
        example: plotExample({ quests: [{ id: 'q', title: 'Escort', objectives: [{ id: 'walk', kind: 'escort', who: 'nobody', to: 'harbour' }] }] }, 'plot.quests[0].objectives[0].who') },
      dialogue_node_unknown: { fields: ['plot.quests[].objectives[].node', 'plot.quests[].objectives[].dialogue'], message: 'a talk objective\'s node is a node of its dialogue' },
    },
  },
  logic(logic) {
    // `{quest, objective, state}` written quest-first is still an objective test.
    const objectiveTest = (p, rt) => { const o = st(rt).q[p.quest]?.objectives?.[p.objective]; const s = o?.state ?? 'inactive'; return p.state === undefined ? s === 'done' : s === p.state; };
    const questState = (rt, id) => rt.service('quests').state(id);
    logic.predicate('quest', {
      refs: p => [['quest', p.quest]],
      check: (p, path, errors) => {
        if (p.objective !== undefined) { if (p.state !== undefined && !OBJ_STATES.includes(p.state)) errors.push(err('predicate_invalid', `${path}.state`, `objective state must be ${OBJ_STATES.join('|')}`)); return; }
        if (p.state !== undefined && !STATES.includes(p.state)) errors.push(err('predicate_invalid', `${path}.state`, `quest state must be ${STATES.join('|')}`));
      },
      test: (p, rt) => {
        if (p.objective !== undefined) return objectiveTest(p, rt);
        const s = questState(rt, p.quest);
        if (p.branch !== undefined && st(rt).q[p.quest]?.branch !== p.branch) return false;
        if (p.times !== undefined || ['gte', 'gt', 'lte', 'lt', 'eq', 'ne'].some(k => p[k] !== undefined)) { const n = st(rt).q[p.quest]?.completions ?? 0; return ['gte', 'gt', 'lte', 'lt', 'eq', 'ne'].every(k => p[k] === undefined || (k === 'gte' ? n >= p[k] : k === 'gt' ? n > p[k] : k === 'lte' ? n <= p[k] : k === 'lt' ? n < p[k] : k === 'eq' ? n === p[k] : n !== p[k])); }
        if ((p.state ?? 'complete') === 'complete') return (st(rt).q[p.quest]?.completions ?? 0) > 0; // repeatable quests stay complete once done
        return s === p.state;
      },
    });
    logic.predicate('objective', {
      refs: p => [['quest', p.quest]],
      check: (p, path, errors, ctx) => {
        if (p.state !== undefined && !OBJ_STATES.includes(p.state)) errors.push(err('predicate_invalid', `${path}.state`, `objective state must be ${OBJ_STATES.join('|')}`));
        const q = (ctx.doc.plot?.quests || []).find(x => x.id === p.quest);
        if (q && !(q.objectives || []).some(o => o.id === p.objective)) errors.push(err('ref_unknown', `${path}.objective`, `quest '${p.quest}' has no objective '${p.objective}'`));
      },
      test: objectiveTest,
    });
    const svc = rt => rt.service('quests');
    logic.effect('start_quest', { refs: e => [['quest', e.quest]], run: (e, rt) => svc(rt).start(e.quest, { force: true }) });
    logic.effect('complete_quest', { refs: e => [['quest', e.quest]], run: (e, rt) => svc(rt).complete(e.quest) });
    logic.effect('fail_quest', { refs: e => [['quest', e.quest]], run: (e, rt) => svc(rt).fail(e.quest, e.reason || 'effect') });
    logic.effect('track_quest', { refs: e => [['quest', e.quest]], run: (e, rt) => svc(rt).track(e.quest) });
    logic.effect('set_objective', {
      refs: e => [['quest', e.quest]],
      check: (e, path, errors, ctx) => {
        if (!['active', 'done', 'failed'].includes(e.state ?? 'done')) errors.push(err('effect_invalid', `${path}.state`, 'state must be active|done|failed'));
        const q = (ctx.doc.plot?.quests || []).find(x => x.id === e.quest);
        if (q && !(q.objectives || []).some(o => o.id === e.objective)) errors.push(err('ref_unknown', `${path}.objective`, `quest '${e.quest}' has no objective '${e.objective}'`));
      },
      run: (e, rt) => svc(rt).setObjective(e.quest, e.objective, e.state ?? 'done'),
    });
  },
  // The shape of plot.quests (and of each objective, by its kind) is declared (card.data); what is left are the rules
  // across fields and entries: prerequisite cycles, objective ids, an objective kind's either/or fields.
  validate(config, doc, ctx) {
    const errors = [], list = doc.plot?.quests;
    if (!Array.isArray(list)) return errors;
    list.forEach((q, i) => {
      if (!isObj(q)) return;
      const path = `plot.quests[${i}]`;
      if (Array.isArray(q.prereq)) q.prereq.forEach((p, j) => { if (p === q.id) errors.push(err('quest_cycle', `${path}.prereq[${j}]`, 'a quest cannot require itself')); });
      // The reward effects need their owners' vocabulary (give_xp, give_money, give_item, add_rep).
      if (isObj(q.rewards)) rewardEffects({ ...q.rewards, money: isObj(q.rewards.money) ? q.rewards.money : undefined, items: Array.isArray(q.rewards.items) ? q.rewards.items : [], rep: Array.isArray(q.rewards.rep) ? q.rewards.rep : [], do: [] }).forEach(e => ctx.checkEffect(e, `${path}.rewards`, errors));
      if (!Array.isArray(q.objectives) || !q.objectives.length) return;
      const oids = new Set();
      q.objectives.forEach((o, j) => {
        if (!isObj(o)) return;
        const op = `${path}.objectives[${j}]`;
        if (oids.has(o.id)) errors.push(err('objective_duplicate', `${op}.id`, `duplicate objective id '${o.id}'`));
        oids.add(o.id);
        if (typeof o.kind === 'string' && Object.hasOwn(OBJECTIVES, o.kind)) OBJECTIVES[o.kind].check?.(o, op, errors, ctx);
      });
      if (q.objectives.every(o => isObj(o) && o.optional)) errors.push(err('quest_invalid', `${path}.objectives`, 'every objective is optional: the quest could never complete'));
    });
    // prereq cycles
    const byId = new Map(list.filter(isObj).map(q => [q.id, q])), color = new Map();
    const visit = (id, trail) => {
      if (color.get(id) === 2) return; if (color.get(id) === 1) { errors.push(err('quest_cycle', `plot.quests[${list.indexOf(byId.get(id))}].prereq`, `prerequisite cycle: ${[...trail, id].join(' -> ')}`)); return; }
      color.set(id, 1); for (const p of Array.isArray(byId.get(id)?.prereq) ? byId.get(id).prereq : []) if (byId.has(p) && p !== id) visit(p, [...trail, id]); color.set(id, 2);
    };
    for (const q of byId.values()) visit(q.id, []);
    return errors;
  },
  install(rt, config) {
    st(rt); // create the store at install: UI reads (view/list/known) must never write state
    const quests = () => index(rt).quests;
    const rec = id => st(rt).q[id];
    const setVars = () => { const all = Object.values(st(rt).q); rt.state.vars['quests.active'] = all.filter(r => r.state === 'active').length; rt.state.vars['quests.complete'] = all.filter(r => r.completions > 0).length; };
    const locked = id => service(rt, 'gates')?.locked(`quest:${id}`) ?? false;
    const available = id => {
      const q = quests().get(id); if (!q) return false;
      const r = rec(id);
      if (r && (r.state === 'active' || ((r.state === 'complete' || r.state === 'failed') && !q.repeatable))) return false;
      return (q.prereq || []).every(p => rec(p)?.completions > 0) && (!q.gate || rt.test(q.gate)) && !locked(id);
    };
    const state = id => {
      const r = rec(id), q = quests().get(id);
      if (r && r.state !== 'available' && !(q?.repeatable && r.state !== 'active')) return r.state;
      return available(id) ? 'available' : r && r.state !== 'available' ? r.state : 'locked';
    };
    const activeCount = () => Object.values(st(rt).q).filter(r => r.state === 'active').length;
    const objState = (qid, oid) => rec(qid)?.objectives?.[oid];
    const activateObjective = (q, o) => {
      const r = rec(q.id), p = r.objectives[o.id];
      if (p.state !== 'inactive') return;
      const def = OBJECTIVES[o.kind];
      p.state = 'active'; p.n = 0;
      if (o.since === 'start' && def.typed?.(o)) p.n = rt.state.counts[def.typed(o)] || 0;
      def.activate?.(p, o, rt);
      rt.emit('quest_updated', { quest: q.id, objective: o.id, state: 'active' });
    };
    const refreshActive = q => { // which objectives are live under the quest's order
      const r = rec(q.id); if (r.state !== 'active') return;
      if (q.order === 'any') { for (const o of q.objectives) activateObjective(q, o); return; }
      for (const o of q.objectives) if (o.optional) activateObjective(q, o);
      const next = q.objectives.find(o => !o.optional && r.objectives[o.id].state !== 'done');
      if (next) activateObjective(q, next);
    };
    const start = (id, { force = false, via = 'effect' } = {}) => {
      const q = quests().get(id); if (!q) return false;
      const r0 = rec(id);
      if (r0?.state === 'active') return false;
      if (!force && !available(id)) return false;
      if ((r0?.state === 'complete' || r0?.state === 'failed') && !q.repeatable && !force) return false;
      if (r0?.state === 'complete' && !q.repeatable) return false; // a finished quest never restarts
      st(rt).q[id] = { state: 'active', ...(q.timeLimit ? { t0: rt.state.frame } : {}), completions: r0?.completions ?? 0, fails: r0?.fails ?? 0, branch: null, via, objectives: Object.fromEntries(q.objectives.map(o => [o.id, { state: 'inactive', n: 0 }])) };
      rt.emitTyped('quest_started', id, { quest: id, kind: q.kind ?? 'side' });
      if (config.trackOne && (!st(rt).tracked || rec(st(rt).tracked)?.state !== 'active') && (q.kind === 'main' || !st(rt).tracked)) track(id);
      setVars();
      rt.run(q.onStart || [], { quest: id });
      if (rec(id)?.state === 'active') refreshActive(q);
      return true;
    };
    const finishIfDone = q => {
      const r = rec(q.id); if (r?.state !== 'active') return;
      if (q.objectives.every(o => o.optional || r.objectives[o.id].state === 'done')) complete(q.id);
    };
    const complete = id => {
      const q = quests().get(id); if (!q) return false;
      const r = rec(id) ?? (st(rt).q[id] = { state: 'locked', completions: 0, fails: 0, objectives: {}, branch: null });
      if (r.state === 'complete' && !q.repeatable) return false;
      r.state = 'complete'; r.completions = (r.completions || 0) + 1;
      if (q.repeatable) r.offered = null;
      const branch = (q.branches || []).find(b => !b.when || rt.test(b.when));
      r.branch = branch?.id ?? null;
      setVars();
      rt.emitTyped('quest_complete', id, { quest: id, branch: r.branch });
      if (branch) rt.emit('quest_branch', { quest: id, branch: branch.id });
      rt.run([...rewardEffects(q.rewards), ...(branch?.do || []), ...(q.onComplete || [])], { quest: id });
      if (st(rt).tracked === id) autoTrack();
      return true;
    };
    const fail = (id, reason) => {
      const q = quests().get(id), r = rec(id); if (!q || r?.state !== 'active') return false;
      r.state = 'failed'; r.fails = (r.fails || 0) + 1; r.reason = reason;
      setVars();
      rt.emitTyped('quest_failed', id, { quest: id, reason });
      rt.run(q.onFail || [], { quest: id });
      if (st(rt).tracked === id) autoTrack();
      return true;
    };
    const track = id => { if (rec(id)?.state !== 'active') return false; st(rt).tracked = id; rt.emit('quest_tracked', { quest: id }); return true; };
    const autoTrack = () => { const s = st(rt); s.tracked = null; const next = [...quests().values()].find(q => rec(q.id)?.state === 'active' && q.kind === 'main') || [...quests().values()].find(q => rec(q.id)?.state === 'active'); if (next && config.trackOne) track(next.id); };
    const objectiveDone = (q, o) => {
      const p = rec(q.id).objectives[o.id]; if (p.state === 'done') return;
      p.state = 'done';
      rt.emitTyped('objective_done', q.id, { quest: q.id, objective: o.id });
      refreshActive(q); finishIfDone(q);
    };
    const objectiveFailed = (q, o, reason) => {
      const p = rec(q.id).objectives[o.id]; if (p.state === 'failed' || p.state === 'done') return;
      p.state = 'failed';
      rt.emit('objective_failed', { quest: q.id, objective: o.id, reason });
      if (!o.optional) fail(q.id, `objective:${o.id}`);
    };
    const setObjective = (qid, oid, s) => {
      const q = quests().get(qid), r = rec(qid), o = q?.objectives.find(x => x.id === oid);
      if (!q || !o || r?.state !== 'active') return false;
      if (s === 'done') objectiveDone(q, o); else if (s === 'failed') objectiveFailed(q, o, 'effect');
      else if (r.objectives[oid].state !== 'active') { r.objectives[oid].state = 'inactive'; activateObjective(q, o); }
      return true;
    };
    const accept = id => {
      const q = quests().get(id); if (!q || !available(id)) return false;
      if (offerOf(q, index(rt).scripted) !== 'accept') return false;
      if (q.giver && !(service(rt, 'character')?.isPlayer(q.giver)) && service(rt, 'character') && !service(rt, 'character').inRange().includes(q.giver)) return false;
      if (activeCount() >= config.maxActive) { rt.emit('quest_blocked', { quest: id, reason: 'max_active' }); return false; }
      return start(id, { via: 'accept' });
    };
    const api = {
      state, start, complete, fail, track, setObjective, accept, available,
      tracked: () => st(rt).tracked,
      objective: objState,
      offered: () => [...quests().values()].filter(q => offerOf(q, index(rt).scripted) === 'accept' && available(q.id)).map(q => q.id),
      /** Quest log read model for UI: progress counts included. */
      list: () => [...quests().values()].map(q => {
        const r = rec(q.id);
        return { id: q.id, title: q.title, kind: q.kind ?? 'side', state: state(q.id), tracked: st(rt).tracked === q.id, branch: r?.branch ?? null,
          objectives: q.objectives.map(o => { const p = r?.objectives?.[o.id]; return { id: o.id, text: o.text ?? '', kind: o.kind, state: p?.state ?? 'inactive', progress: p?.n ?? 0, count: needOf(o), hidden: Boolean(o.hidden) && (p?.state ?? 'inactive') === 'inactive', optional: Boolean(o.optional) }; }) };
      }),
    };
    rt.provide('quests', api);
    rt.action('accept_quest', id => accept(id));
    rt.action('track_quest', id => track(id));
    // Event-driven objective progress: one dispatcher over the base events objectives listen to.
    rt.on('*', ev => {
      const s = st(rt);
      for (const [qid, r] of Object.entries(s.q)) {
        if (r.state !== 'active') continue;
        const q = quests().get(qid); if (!q) continue;
        for (const o of q.objectives) {
          const p = r.objectives[o.id], def = OBJECTIVES[o.kind];
          if (p?.state !== 'active' || !def.onEvent || !def.events(o).includes(ev.name)) continue;
          const got = def.onEvent(o, p, ev, rt, ev.name);
          if (got === 'fail') { p.pendingFail = true; continue; }
          if (got > 0) { p.n = (p.n || 0) + got; rt.emit('quest_updated', { quest: qid, objective: o.id, progress: p.n, count: needOf(o) }); }
        }
      }
    });
    rt.system('plot', rt => {
      const s = st(rt), { quests: all, scripted } = index(rt);
      for (const q of all.values()) {
        const r = s.q[q.id];
        if (r?.state === 'active') {
          const elapsed = (rt.state.frame - r.t0) * rt.dt;
          if (q.timeLimit && elapsed >= q.timeLimit) { fail(q.id, 'time'); continue; }
          if (q.fail && rt.test(q.fail)) { fail(q.id, 'fail'); continue; }
          if (q.giver && config.failOnDeathOfGiver && service(rt, 'character') && !service(rt, 'character').alive(q.giver)) { fail(q.id, 'giver_dead'); continue; }
          refreshActive(q);
          for (const o of q.objectives) {
            const p = r.objectives[o.id]; if (p?.state !== 'active' || r.state !== 'active') continue;
            if (p.pendingFail) { objectiveFailed(q, o, o.kind); continue; }
            const def = OBJECTIVES[o.kind];
            let done = false;
            if (def.poll) { const res = def.poll(o, p, rt); if (res === 'fail') { objectiveFailed(q, o, o.kind); continue; } done = res === true; }
            else done = (p.n || 0) >= needOf(o);
            if (done) objectiveDone(q, o);
          }
          finishIfDone(q);
        } else if (available(q.id)) {
          const offer = offerOf(q, scripted);
          if (!r?.offered && (!r || q.repeatable)) { (s.q[q.id] ??= { state: 'available', completions: 0, fails: 0, objectives: {}, branch: null }).offered = true; rt.emitTyped('quest_available', q.id, { quest: q.id, offer }); }
          if (offer === 'auto' && (!r || r.state === 'available' || (q.repeatable && r.state === 'complete'))) start(q.id, { via: 'auto' });
        }
        if (rt.state.status !== 'playing') return;
      }
      setVars();
    }, ID);
    rt.options(rt => (service(rt, 'dialogue')?.active() || service(rt, 'cutscene')?.playing() ? [] : [...api.offered().filter(id => {
      const g = quests().get(id).giver, ch = service(rt, 'character');
      return !g || !ch || ch.isPlayer(g) || ch.inRange().includes(g);
    }).map(id => ({ label: `accept ${id}`, text: `Take on: ${quests().get(id).title || id}`, actions: { accept_quest: id } })),
    // Any active quest other than the tracked one can be tracked.
    ...[...quests().keys()].filter(id => rec(id)?.state === 'active' && st(rt).tracked !== id).map(id => ({ label: `track ${id}`, text: `Track: ${quests().get(id).title || id}`, actions: { track_quest: id } }))]));
  },
};

/** Solver key: quest and objective states only (timers and counters are not progress). */
export function solverKey(rt) {
  const s = rt.store(ID);
  return Object.fromEntries(Object.entries(s.q || {}).sort().map(([id, r]) => [id, [r.state, r.branch, Object.entries(r.objectives || {}).map(([o, p]) => `${o}:${p.state}:${p.n || 0}`).join(',')]]));
}
export function progress(rt) {
  const s = rt.store(ID);
  return Object.values(s.q || {}).reduce((n, r) => n + (r.completions || 0) * 4 + Object.values(r.objectives || {}).filter(p => p.state === 'done').length, 0);
}
