// Codex / lore / journal entries (plot.entries: { id, title, text, tag? }).
// add_entry learns one (once); `known` and `entries` (count by tag) read them.
// Entries with `when` are learned automatically the first plot tick it holds.
import { err, checkKeys, checkPred, cached } from './story-lib.js';
import { compare } from '../../kernel/logic.js';

const ID = 'plot.journal';
const entries = rt => cached(rt, 'plot.journal.index', doc => new Map((doc.plot?.entries || []).map(e => [e.id, e])));
const st = rt => { const s = rt.store(ID); s.known ??= {}; s.order ??= []; return s; };

function learn(rt, id) {
  const s = st(rt), e = entries(rt).get(id);
  if (!e || s.known[id]) return false;
  s.known[id] = true; s.order.push(id);
  rt.emitTyped('journal_added', id, { entry: id, title: e.title ?? id, tag: e.tag ?? null });
  return true;
}

export default {
  id: ID,
  card: {
    intent: 'Journal, codex and lore entries from plot.entries, learned by add_entry (or automatically when an entry\'s when holds); `known` and `entries` (count per tag) feed gates and endings.',
    views: ['any'],
    params: {},
    provides: { events: ['journal_added', 'journal_added:*'], services: ['journal'] },
    reads: ['plot.entries'],
    defines: [{ kind: 'entry', at: 'plot.entries' }],
  },
  logic(logic) {
    logic.predicate('known', { refs: p => [['entry', p.known]], test: (p, rt) => Boolean(st(rt).known[p.known]) });
    logic.predicate('entries', { test: (p, rt) => { const s = st(rt); const n = Object.keys(s.known).filter(id => p.entries === '*' || entries(rt).get(id)?.tag === p.entries).length; return compare(n, ['gte', 'gt', 'lte', 'lt', 'eq', 'ne'].some(k => p[k] !== undefined) ? p : { gte: 1 }); },
      check: (p, path, errors, ctx) => { if (typeof p.entries !== 'string') errors.push(err('predicate_invalid', path, 'entries takes a tag (or "*")')); else if (p.entries !== '*' && !(ctx.doc.plot?.entries || []).some(e => e.tag === p.entries)) errors.push(err('ref_unknown', path, `no entry has tag '${p.entries}'`)); } });
    logic.effect('add_entry', { refs: e => [['entry', e.entry]], run: (e, rt) => { learn(rt, e.entry); } });
  },
  validate(config, doc, ctx) {
    const errors = [], list = doc.plot?.entries;
    if (list === undefined) return errors;
    if (!Array.isArray(list)) return [err('param_type', 'plot.entries', 'must be a list of entries')];
    list.forEach((e, i) => {
      const path = `plot.entries[${i}]`;
      checkKeys(e, ['id', 'title', 'text', 'tag', 'when'], path, errors);
      if (typeof e.title !== 'string' || typeof e.text !== 'string') errors.push(err('entry_invalid', path, 'entry needs title and text'));
      checkPred(e.when, `${path}.when`, errors, ctx);
    });
    return errors;
  },
  install(rt) {
    st(rt); // create the store at install: UI reads (view/list/known) must never write state
    rt.provide('journal', {
      known: id => Boolean(st(rt).known[id]),
      list: () => st(rt).order.map(id => ({ id, ...entries(rt).get(id) })).filter(e => e.title !== undefined),
      quests: () => (rt.hasService('quests') ? rt.service('quests').list() : []),
      add: id => learn(rt, id),
    });
    rt.system('plot', rt => { for (const e of entries(rt).values()) if (e.when && !st(rt).known[e.id] && rt.test(e.when)) learn(rt, e.id); }, ID);
  },
};
