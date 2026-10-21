// Weighted text/choice events (FTL, Reigns, radiant encounters) from
// plot.randomEvents: { id, title?, text, weight?, when?, once?, cooldown?,
// do?, choices?: [{ text, if?, do?, then?: eventId }] }. Once a second, with
// probability rate/60 and when the last event is minGap behind, one eligible
// event is drawn by weight with rt.random(). An event without choices applies
// its effects at once; one with choices waits for `event_choice: {index}`
// (each open choice is a solver option). `then` chains into another event.
import { err, checkKeys, checkPred, checkEffects, ticks, weightedPick, cached } from './story-lib.js';

const ID = 'plot.events.random';
const events = rt => cached(rt, 'plot.events.random.index', doc => new Map((doc.plot?.randomEvents || []).map(e => [e.id, e])));
const st = rt => { const s = rt.store(ID); s.pending ??= null; s.seen ??= {}; s.next ??= {}; s.last ??= null; s.tick ??= 0; return s; };

export default {
  id: ID,
  solverKey,
  card: {
    loop: { verbs: ['event_choice'], progress: ['random_event_choice'] },
    intent: 'Random text events with weighted draws, conditions, cooldowns and once-only events; choices with conditions and effects can chain into further events (FTL, Reigns, radiant encounters).',
    views: ['any'],
    params: {
      rate: { type: 'number', default: 0.5, min: 0, max: 60, unit: 'per min', effect: 'expected events per minute while none is pending' },
      minGap: { type: 'number', default: 20, min: 0, max: 3600, unit: 's', effect: 'least time between two drawn events' },
      pauseInDialogue: { type: 'boolean', default: true, effect: 'no draws while a dialogue or cutscene plays' },
    },
    provides: { events: ['random_event', 'random_event:*', 'random_event_end', 'random_event_choice'], services: ['randomEvents'], actions: ['event_choice'] },
    reads: ['plot.randomEvents'],
    defines: [{ kind: 'random_event', at: 'plot.randomEvents' }],
  },
  logic(logic) {
    logic.effect('trigger_event', { refs: e => [['random_event', e.event]], run: (e, rt) => rt.service('randomEvents').trigger(e.event) });
    logic.predicate('random_event', { refs: p => [['random_event', p.random_event]], test: (p, rt) => { const n = st(rt).seen[p.random_event] || 0; return ['gte', 'gt', 'lte', 'lt', 'eq', 'ne'].some(k => p[k] !== undefined) ? ['gte', 'gt', 'lte', 'lt', 'eq', 'ne'].every(k => p[k] === undefined || (k === 'gte' ? n >= p[k] : k === 'gt' ? n > p[k] : k === 'lte' ? n <= p[k] : k === 'lt' ? n < p[k] : k === 'eq' ? n === p[k] : n !== p[k])) : n > 0; } });
  },
  validate(config, doc, ctx) {
    const errors = [], list = doc.plot?.randomEvents;
    if (list === undefined) return errors;
    if (!Array.isArray(list)) return [err('param_type', 'plot.randomEvents', 'must be a list of events')];
    const ids = new Set(list.map(e => e?.id));
    list.forEach((e, i) => {
      const path = `plot.randomEvents[${i}]`;
      checkKeys(e, ['id', 'title', 'text', 'weight', 'when', 'once', 'cooldown', 'do', 'choices', 'draw'], path, errors);
      if (typeof e.text !== 'string') errors.push(err('random_event_invalid', `${path}.text`, 'event needs text'));
      for (const k of ['weight', 'cooldown']) if (e[k] !== undefined && !(typeof e[k] === 'number' && e[k] >= 0)) errors.push(err('random_event_invalid', `${path}.${k}`, `${k} must be a non-negative number`));
      checkPred(e.when, `${path}.when`, errors, ctx); checkEffects(e.do, `${path}.do`, errors, ctx);
      (e.choices || []).forEach((c, j) => {
        const cp = `${path}.choices[${j}]`;
        checkKeys(c, ['text', 'if', 'do', 'then'], cp, errors);
        if (typeof c.text !== 'string') errors.push(err('random_event_invalid', `${cp}.text`, 'choice needs text'));
        checkPred(c.if, `${cp}.if`, errors, ctx); checkEffects(c.do, `${cp}.do`, errors, ctx);
        if (c.then !== undefined && !ids.has(c.then)) errors.push(err('ref_unknown', `${cp}.then`, `unknown event '${c.then}'`));
      });
    });
    return errors;
  },
  install(rt, config) {
    st(rt); // create the store at install: UI reads (view/list/known) must never write state
    const open = e => (e.choices || []).map((c, index) => ({ c, index })).filter(({ c }) => !c.if || rt.test(c.if));
    const end = () => { const s = st(rt), id = s.pending; s.pending = null; if (id) rt.emit('random_event_end', { event: id }); };
    const trigger = id => {
      const s = st(rt), e = events(rt).get(id); if (!e) return false;
      if (s.pending) end();
      s.seen[id] = (s.seen[id] || 0) + 1; s.last = rt.state.frame;
      if (e.cooldown) s.next[id] = rt.state.frame + ticks(rt, e.cooldown);
      s.pending = id;
      rt.emitTyped('random_event', id, { event: id, title: e.title ?? null, text: e.text, choices: open(e).map(({ c, index }) => ({ index, text: c.text })) });
      rt.run(e.do || [], { event: id });
      if (s.pending === id && !open(e).length) end();
      return true;
    };
    const choose = index => {
      const s = st(rt), e = events(rt).get(s.pending); if (!e) return false;
      const pick = open(e).find(o => o.index === index); if (!pick) return false;
      rt.emit('random_event_choice', { event: e.id, index, text: pick.c.text });
      end();
      rt.run(pick.c.do || [], { event: e.id });
      if (pick.c.then && rt.state.status === 'playing') trigger(pick.c.then);
      return true;
    };
    const eligible = () => { const s = st(rt); return [...events(rt).values()].filter(e => e.draw !== false && !(e.once && s.seen[e.id]) && (s.next[e.id] ?? -1) <= rt.state.frame && (!e.when || rt.test(e.when))); };
    rt.provide('randomEvents', { trigger, choose, pending: () => st(rt).pending, eligible: () => eligible().map(e => e.id) });
    rt.action('event_choice', v => choose(Number(v && typeof v === 'object' ? v.index : v)));
    rt.system('plot', rt => {
      const s = st(rt);
      if (s.tick > 0) { s.tick--; return; }
      s.tick = ticks(rt, 1) - 1;
      if (s.pending || !config.rate) return;
      if (config.pauseInDialogue && ((rt.hasService('dialogue') && rt.service('dialogue').active()) || (rt.hasService('cutscene') && rt.service('cutscene').playing()))) return;
      if (s.last !== null && rt.state.frame - s.last < ticks(rt, config.minGap)) return;
      if (rt.random() >= config.rate / 60) return;
      const pick = weightedPick(rt, eligible().map(e => ({ e, weight: e.weight ?? 1 })));
      if (pick) trigger(pick.e.id);
    }, ID);
    rt.options(rt => { const e = events(rt).get(st(rt).pending); return e ? open(e).map(({ c, index }) => ({ label: `event ${e.id}.${index}: ${c.text}`, actions: { event_choice: { index } } })) : []; });
  },
};

export function solverKey(rt) { const s = rt.store(ID); return { pending: s.pending, seen: s.seen }; }
