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
    loop: { verbs: [], progress: ['journal_added'] },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "section", "at": "plot.entries", "min": 3, "why": "journal entries the player gains"},
    ],
    intent: 'Journal, codex and lore entries from plot.entries, learned by add_entry (or automatically when an entry\'s when holds); `known` and `entries` (count per tag) feed gates and endings.',
    views: ['any'],
    params: {},
    // What a person is told when these events fire (a story log, a toast): `label`, then the title of the document entry
    // the event names (`entry`: the section and the event field holding its id), then the entry's `detail` field when set.
    tells: { journal_added: { label: 'Noted', entry: { at: 'plot.entries', by: 'entry' } } },
    provides: { events: ['journal_added', 'journal_added:*'], services: ['journal'] },
    reads: ['plot.entries'],
    // Section shapes this primitive reads (planner: composition renames the references they hold, repair and forms use them).
    data: { 'plot.entries': { type: 'list', of: { type: 'object', fields: { id: { type: 'string', required: true }, title: { type: 'string', required: true }, text: { type: 'string', required: true }, tag: { type: 'string' }, when: { type: 'predicate' } } } } },
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
