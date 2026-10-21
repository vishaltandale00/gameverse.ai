// graphics.ui.choices: the control a person has for every verb whose value is a choice (card.actionSpace type
// 'choice', or a number or vector that is no input axis) that no other mounted UI primitive issues (their
// card.controls.verbs): select a unit, see its legal targets, confirm (pieces), or choose an option (menu). The values
// it offers are the ones the game's primitives list for those verbs in their options (rt.options: the legal moves,
// orders, swaps, zones...), grouped by the declared `pick` field of the verb's choice (the unit a move is for), and
// sent exactly as the primitive defines them through view.act. Pointer, number keys (when no gameplay key uses them)
// and back while a group is open; more rows than `max` page on with a More button. Presentation only: it never writes
// rt.state.
import { uiHost, fill, setClass, setText, titleCase } from './ui-lib.js';
import { unclaimedChoices, verbInstances, actionSpaceOf, declaredDenials, deniesPlayer, uiControls } from '../engine/runtime-lib-controls.js';
import { INTERACTIONS } from '../gameplay/modes-lib-mode.js';

/** The choice verbs this primitive issues in a document: the loops' choice verbs no other mounted UI names. */
export const servedVerbs = (doc, registry) => unclaimedChoices(doc, registry);

/** The `pick` field each served verb declares on its card's choice (card.actionSpace[verb].pick), and the verb that selects it. */
export function picksOf(doc, registry, served) {
  const pick = {}, selects = {};
  for (const inst of verbInstances(doc)) {
    const as = actionSpaceOf(registry?.get(inst.use)?.card, inst);
    for (const v of served) {
      if (as[v]?.type !== 'choice') continue;
      if (typeof as[v].pick === 'string') pick[v] ??= as[v].pick;
      if (typeof as[v].selects === 'string') selects[as[v].selects] ??= v;
    }
  }
  return { pick, selects };
}

/**
 * The options a person can take through this control now: those whose actions use a served verb, with the group they
 * belong to (the value of the verb's declared `pick` field, e.g. the unit a move is for; null when it declares none).
 * Pure over (options, served, pick), for tests. @returns {Array<{ option: any, group: string | null, field: string | null, value: unknown }>}
 */
export function choiceEntries(options, served, pick = {}) {
  const out = [];
  for (const o of options || []) {
    const verbs = Object.keys(o.actions || {}).filter(v => served.includes(v));
    if (!verbs.length) continue;
    const f = pick[verbs[0]] ?? null, v = o.actions[verbs[0]];
    const has = f && v && typeof v === 'object' && v[f] !== undefined;
    out.push({ option: o, field: f, group: has ? (Array.isArray(v[f]) ? v[f].join(', ') : String(v[f])) : null, value: has ? v[f] : null });
  }
  return out;
}

/** The text an option shows: its label, else its verbs and scalar values. */
export const entryLabel = o => o.text || o.label || Object.entries(o.actions || {}).map(([v, x]) => `${titleCase(v)}${typeof x === 'object' ? '' : ` ${x}`}`).join(' ');

/**
 * The rows the panel shows for the options offered now, with `group` open (null: the top level): a row per group (the
 * units that have moves, the pieces that can be built) and per ungrouped option at the top level, and inside a group
 * Back then the group's options. Pure, for tests.
 * @returns {Array<{ text: string, kind: 'group' | 'option' | 'back', group?: string, field?: string | null, value?: unknown, actions?: Record<string, unknown> }>}
 */
export function panelRows(options, served, pick, group = null, { wholeOptions = true } = {}) {
  const entries = choiceEntries(options, served, pick);
  const groups = [...new Map(entries.filter(e => e.group !== null).map(e => [e.group, e])).entries()];
  if (group !== null && !groups.some(([g]) => g === group)) group = null;
  return group === null
    ? [...groups.map(([g, e]) => ({ text: titleCase(g), kind: /** @type {const} */ ('group'), group: g, field: e.field, value: e.value })),
      ...entries.filter(e => e.group === null && wholeOptions).map(e => ({ text: entryLabel(e.option), kind: /** @type {const} */ ('option'), actions: e.option.actions }))]
    : [{ text: '‹ Back', kind: /** @type {const} */ ('back') }, ...entries.filter(e => e.group === group).map(e => ({ text: entryLabel(e.option), kind: /** @type {const} */ ('option'), actions: e.option.actions }))];
}

/** The rows of one page of at most `max` buttons: when they do not fit, the last button pages on (More, wrapping). */
export function pageOf(rows, page, max) {
  if (rows.length <= max) return { rows, pages: 1, page: 0 };
  const per = Math.max(1, max - 1), pages = Math.ceil(rows.length / per), p = ((page % pages) + pages) % pages;
  return { rows: [...rows.slice(p * per, (p + 1) * per), { text: `More › (${p + 1}/${pages})`, kind: 'more' }], pages, page: p };
}

export default {
  id: 'graphics.ui.choices',
  card: {
    intent: 'Choices panel for any game: every action whose value is chosen among what the game offers (moves and targets of a unit, orders, swaps, zones to travel to, characters to talk to...) that no other UI issues: select a unit, see its legal targets, confirm; or choose an option. Pointer, number keys and back.',
    views: ['any'],
    interactions: INTERACTIONS.slice(),
    // Issues every choice verb of the document no other mounted UI primitive names (runtime-lib-controls.js unclaimedChoices).
    controls: { choice: true },
    // Says why a choice or press was refused: the denials the document's primitives declare (card.denials).
    feedback: { denials: true },
    params: {
      max: { type: 'integer', default: 9, min: 1, max: 24, effect: 'buttons shown at once; more entries page on with a More button (number keys pick the first nine)' },
    },
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el, served = servedVerbs(rt.doc, rt.registry), { pick, selects } = picksOf(rt.doc, rt.registry, served);
    if (!served.length) return;
    const list = el('div.gv-choice-list', { role: 'group', aria: { label: 'Choices' } });
    const head = el('div.gv-choice-head'), note = el('div.gv-choice-note', { aria: { live: 'polite' } });
    const root = el('section.gv-choice-panel.gv-panel', { style: { position: 'absolute', left: '12px', bottom: '12px', 'max-width': 'min(360px, 60vw)', 'pointer-events': 'auto' } }, head, note, list);
    // The last refusal that answered the person, shown for a few seconds.
    let refused = null;
    for (const ev of declaredDenials(rt.doc, rt.registry)) rt.on(ev, e => { if (deniesPlayer(rt, e)) { refused = { text: `${titleCase(ev)}${e.reason ? `: ${titleCase(e.reason)}` : ''}`, until: host.now() + 3 }; sig = ''; } });
    host.layer('hud').append(root);
    let group = null, page = 0, shown = [], sig = '';
    const bound = rt.hasService?.('input') ? Object.values(rt.service('input').bindings()).flat() : [];
    const digitsFree = !bound.some(k => /^[1-9]$/.test(k) || /^\d-\d$/.test(k));
    const reset = () => { sig = ''; };
    host.input.push({ id: 'choices', modal: false, takesInput: true, onVerb: verb => {
      const d = /^digit(\d)$/.exec(verb);
      if (d && digitsFree && shown[Number(d[1]) - 1]) { shown[Number(d[1]) - 1]._run(); return true; }
      if (verb === 'back' && group !== null) { group = null; page = 0; reset(); return true; }
      return false;
    } });
    // A UI that lists the game's options (card.controls.options: the story's choices) already lists every whole option: this
    // panel then lists only its selections (a unit to act with), so one number key never means two things on screen.
    const listedElsewhere = uiControls(rt.doc, rt.registry).options.some(u => u !== 'graphics.ui.choices');
    // Choosing a group (a unit) also issues the verb that selects it, when the document has one (card.actionSpace selects).
    const run = r => {
      if (r.kind === 'group') { group = r.group; page = 0; if (selects[r.field] && served.includes(selects[r.field])) rt.view.act({ [selects[r.field]]: r.value }); }
      else if (r.kind === 'back') { group = null; page = 0; }
      else if (r.kind === 'more') page++;
      else { rt.view.act(r.actions); group = null; page = 0; }
      reset();
    };
    function paint() {
      const options = rt.state.status === 'playing' ? rt.availableOptions() : [];
      const all = panelRows(options, served, pick, group, { wholeOptions: !listedElsewhere });
      if (group !== null && all[0]?.kind !== 'back') group = null; // the open group has nothing left to choose
      const { rows, page: p } = pageOf(all, page, config.max); page = p;
      if (refused && host.now() > refused.until) refused = null;
      setClass(root, 'gv-hide', !rows.length && !refused);
      const key = JSON.stringify([group, page, rows.map(r => r.text), refused?.text ?? null]);
      if (key === sig) return; sig = key;
      setText(head, group === null ? 'Choose' : titleCase(group));
      setText(note, refused?.text ?? ''); setClass(note, 'gv-hide', !refused);
      shown = rows.map((r, i) => {
        const b = el('button.gv-btn', { attrs: { type: 'button' }, text: `${digitsFree && i < 9 ? `${i + 1}. ` : ''}${r.text}` });
        b._run = () => { host.sound('confirm'); run(r); };
        b.addEventListener('click', () => b._run());
        return b;
      });
      fill(list, ...shown);
    }
    rt.view.onFrame(paint);
  },
};
