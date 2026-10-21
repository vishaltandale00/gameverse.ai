// Clues and deductions. plot.clues: { id, title, text?, tags?, when? } (a clue
// with `when` is found automatically the first plot tick it holds; others by
// add_clue). plot.deductions: { id, title?, clues: [clueId], when?, do?,
// conclusion?, wrong?, auto? }: once every listed clue is known (and `when`
// holds) the player can `deduce` it — a solver option — or it resolves itself
// when `auto` (or the autoDeduce param) is set. A `wrong` deduction is a false
// theory: it still runs its effects and counts toward maxWrong; the case fails
// (investigation_failed, no further deductions) when that many are made.
import { err, checkKeys, checkPred, checkEffects, cached } from './story-lib.js';

const ID = 'plot.investigation';
const idx = rt => cached(rt, 'plot.investigation.index', doc => ({ clues: new Map((doc.plot?.clues || []).map(c => [c.id, c])), deductions: new Map((doc.plot?.deductions || []).map(d => [d.id, d])) }));
const st = rt => { const s = rt.store(ID); s.found ??= {}; s.deduced ??= {}; s.wrong ??= 0; s.failed ??= false; return s; };
const CMP = ['gte', 'gt', 'lte', 'lt', 'eq', 'ne'];
const cmp = (n, p) => (CMP.some(k => p[k] !== undefined) ? CMP.every(k => p[k] === undefined || (k === 'gte' ? n >= p[k] : k === 'gt' ? n > p[k] : k === 'lte' ? n <= p[k] : k === 'lt' ? n < p[k] : k === 'eq' ? n === p[k] : n !== p[k])) : n > 0);
function find(rt, id) {
  const s = st(rt), c = idx(rt).clues.get(id); if (!c || s.found[id]) return;
  s.found[id] = true; rt.state.vars['clues.found'] = Object.keys(s.found).length;
  rt.emitTyped('clue_found', id, { clue: id, title: c.title ?? id });
}

export default {
  id: ID,
  card: {
    loop: { verbs: ['deduce'], progress: ['clue_found', 'deduced'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { deduce: { type: 'choice', of: 'a deduction whose clues are found', from: 'options', emits: ['deduced'] } },
    // Section shapes this primitive reads (the planner's strict content form uses them).
    data: {
      'plot.clues': { type: 'list', min: 1, of: { type: 'object', fields: { id: { type: 'string', required: true }, title: { type: 'string', required: true }, text: { type: 'string' }, tags: { type: 'list', of: { type: 'string' } }, when: { type: 'predicate', effect: 'found automatically when this holds; else given by add_clue effects' } } } },
      'plot.deductions': { type: 'list', min: 1, of: { type: 'object', fields: { id: { type: 'string', required: true }, title: { type: 'string', required: true }, clues: { type: 'list', min: 1, required: true, of: { type: 'string' }, effect: 'the plot.clues ids that prove it' }, conclusion: { type: 'string' }, wrong: { type: 'boolean', effect: 'a false theory' }, auto: { type: 'boolean' }, when: { type: 'predicate' }, do: { type: 'effects', effect: 'e.g. end the game when the culprit is named' } } } },
    },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "section", "at": "plot.clues", "min": 4, "why": "a mystery is solved from clues the player finds"},
      {"need": "section", "at": "plot.deductions", "min": 1, "why": "deductions combine clues into an answer"},
    ],
    intent: 'Investigation: clues found by effects or conditions, and deductions that open once their clue set is known; the player deduces (right or wrong theories) and the case can fail after too many wrong ones.',
    views: ['any'],
    params: {
      autoDeduce: { type: 'boolean', default: false, effect: 'every deduction resolves as soon as its clues are known' },
      maxWrong: { type: 'integer', default: 0, min: 0, max: 100, effect: 'the case fails (investigation_failed) on this many wrong deductions (0 = never)' },
    },
    // What a person is told when these events fire (a story log, a toast): `label`, then the title of the document entry
    // the event names (`entry`: the section and the event field holding its id), then the entry's `detail` field when set.
    tells: { clue_found: { label: 'Clue', entry: { at: 'plot.clues', by: 'clue' }, detail: 'text' }, deduced: { label: 'Concluded', entry: { at: 'plot.deductions', by: 'deduction' }, detail: 'conclusion' }, investigation_failed: { label: 'Too many wrong theories: the case is lost' } },
    provides: { events: ['clue_found', 'clue_found:*', 'deduced', 'deduced:*', 'investigation_failed'], vars: ['clues.found'], services: ['investigation'], actions: ['deduce'] },
    reads: ['plot.clues', 'plot.deductions'],
    defines: [{ kind: 'clue', at: 'plot.clues' }, { kind: 'deduction', at: 'plot.deductions' }],
  },
  logic(logic) {
    logic.predicate('clue', { refs: p => [['clue', p.clue]], test: (p, rt) => Boolean(st(rt).found[p.clue]) });
    logic.predicate('clues', { test: (p, rt) => cmp(Object.keys(st(rt).found).filter(id => p.clues === '*' || (idx(rt).clues.get(id)?.tags || []).includes(p.clues)).length, p) });
    logic.predicate('deduced', { refs: p => [['deduction', p.deduced]], test: (p, rt) => Boolean(st(rt).deduced[p.deduced]) });
    logic.effect('add_clue', { refs: e => [['clue', e.clue]], run: (e, rt) => find(rt, e.clue) });
    logic.effect('deduce', { refs: e => [['deduction', e.deduction]], run: (e, rt) => rt.service('investigation').deduce(e.deduction, { force: true }) });
  },
  validate(config, doc, ctx) {
    const errors = [], clues = doc.plot?.clues, deds = doc.plot?.deductions;
    if (clues !== undefined && !Array.isArray(clues)) errors.push(err('param_type', 'plot.clues', 'must be a list of clues'));
    if (deds !== undefined && !Array.isArray(deds)) errors.push(err('param_type', 'plot.deductions', 'must be a list of deductions'));
    const ids = new Set((Array.isArray(clues) ? clues : []).map(c => c?.id));
    (Array.isArray(clues) ? clues : []).forEach((c, i) => {
      const path = `plot.clues[${i}]`;
      checkKeys(c, ['id', 'title', 'text', 'tags', 'when', 'zone'], path, errors);
      if (typeof c.title !== 'string') errors.push(err('clue_invalid', `${path}.title`, 'clue needs a title'));
      checkPred(c.when, `${path}.when`, errors, ctx);
    });
    (Array.isArray(deds) ? deds : []).forEach((d, i) => {
      const path = `plot.deductions[${i}]`;
      checkKeys(d, ['id', 'title', 'clues', 'when', 'do', 'conclusion', 'wrong', 'auto'], path, errors);
      if (!Array.isArray(d.clues) || !d.clues.length) errors.push(err('deduction_invalid', `${path}.clues`, 'deduction needs a non-empty clue list'));
      else d.clues.forEach((c, j) => { if (!ids.has(c)) errors.push(err('ref_unknown', `${path}.clues[${j}]`, `unknown clue '${c}'`)); });
      checkPred(d.when, `${path}.when`, errors, ctx); checkEffects(d.do, `${path}.do`, errors, ctx);
    });
    return errors;
  },
  install(rt, config) {
    st(rt); // create the store at install: UI reads (view/list/known) must never write state
    const ready = d => { const s = st(rt); return !s.failed && !s.deduced[d.id] && d.clues.every(c => s.found[c]) && (!d.when || rt.test(d.when)); };
    const deduce = (id, { force = false } = {}) => {
      const s = st(rt), d = idx(rt).deductions.get(id); if (!d || s.deduced[id] || (!force && !ready(d))) return false;
      s.deduced[id] = true;
      rt.emitTyped('deduced', id, { deduction: id, wrong: Boolean(d.wrong), conclusion: d.conclusion ?? null });
      rt.run(d.do || [], { deduction: id });
      if (d.wrong) { s.wrong++; if (config.maxWrong && s.wrong >= config.maxWrong && !s.failed) { s.failed = true; rt.emit('investigation_failed', { wrong: s.wrong }); } }
      return true;
    };
    rt.provide('investigation', { deduce, found: id => Boolean(st(rt).found[id]), ready: () => [...idx(rt).deductions.values()].filter(ready).map(d => d.id), clues: () => Object.keys(st(rt).found) });
    rt.action('deduce', id => deduce(id));
    rt.system('plot', rt => {
      const s = st(rt);
      for (const c of idx(rt).clues.values()) if (c.when && !s.found[c.id] && rt.test(c.when)) find(rt, c.id);
      for (const d of idx(rt).deductions.values()) if ((d.auto || config.autoDeduce) && ready(d)) deduce(d.id);
    }, ID);
    rt.options(rt => [...idx(rt).deductions.values()].filter(d => !d.auto && !config.autoDeduce && ready(d)).map(d => ({ label: `deduce ${d.id}`, text: `Conclude: ${d.title || d.id}`, actions: { deduce: d.id } })));
  },
};
