// graphics.ui.choices: the control a person has for every verb whose value is a choice (card.actionSpace type
// 'choice', or a number or vector that is no input axis) that no other mounted UI primitive issues (their
// card.controls.verbs): select a unit, see its legal targets, confirm (pieces), or choose an option (menu). The values
// it offers are the ones the game's primitives list for those verbs in their options (rt.options: the legal moves,
// orders, swaps, zones...), grouped by the declared `pick` field of the verb's choice (the unit a move is for), and
// sent exactly as the primitive defines them through view.act. Pointer, number keys (when no gameplay key uses them)
// and back while a group is open. Presentation only: it never writes rt.state.
import { uiHost, fill, setClass, setText, titleCase } from './ui-lib.js';
import { unclaimedChoices, verbInstances, actionSpaceOf } from '../engine/runtime-lib-controls.js';
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

export default {
  id: 'graphics.ui.choices',
  card: {
    intent: 'Choices panel for any game: every action whose value is chosen among what the game offers (moves and targets of a unit, orders, swaps, zones to travel to, characters to talk to...) that no other UI issues: select a unit, see its legal targets, confirm; or choose an option. Pointer, number keys and back.',
    views: ['any'],
    interactions: INTERACTIONS.slice(),
    // Issues every choice verb of the document no other mounted UI primitive names (runtime-lib-controls.js unclaimedChoices).
    controls: { choice: true },
    params: {
      max: { type: 'integer', default: 9, min: 1, max: 24, effect: 'entries shown at once (number keys pick the first nine)' },
    },
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el, served = servedVerbs(rt.doc, rt.registry), { pick, selects } = picksOf(rt.doc, rt.registry, served);
    if (!served.length) return;
    const list = el('div.gv-choice-list', { role: 'group', aria: { label: 'Choices' } });
    const head = el('div.gv-choice-head');
    const root = el('section.gv-choice-panel.gv-panel', { style: { position: 'absolute', left: '12px', bottom: '12px', 'max-width': 'min(360px, 60vw)', 'pointer-events': 'auto' } }, head, list);
    host.layer('hud').append(root);
    let group = null, field = null, shown = [], sig = '';
    const bound = rt.hasService?.('input') ? Object.values(rt.service('input').bindings()).flat() : [];
    const digitsFree = !bound.some(k => /^[1-9]$/.test(k) || /^\d-\d$/.test(k));
    host.input.push({ id: 'choices', modal: false, takesInput: true, onVerb: verb => {
      const d = /^digit(\d)$/.exec(verb);
      if (d && digitsFree && shown[Number(d[1]) - 1]) { shown[Number(d[1]) - 1]._run(); return true; }
      if (verb === 'back' && group !== null) { group = null; sig = ''; return true; }
      return false;
    } });
    const label = o => o.label || Object.entries(o.actions || {}).map(([v, x]) => `${titleCase(v)}${typeof x === 'object' ? '' : ` ${x}`}`).join(' ');
    // Choosing a group (a unit) also issues the verb that selects it, when the document has one (card.actionSpace selects).
    const choose = (g, f, value) => { group = g; field = f; if (selects[f] && served.includes(selects[f])) rt.view.act({ [selects[f]]: value }); sig = ''; };
    function paint() {
      const entries = rt.state.status === 'playing' ? choiceEntries(rt.availableOptions(), served, pick) : [];
      const groups = [...new Map(entries.filter(e => e.group !== null).map(e => [e.group, e])).entries()];
      if (group !== null && !groups.some(([g]) => g === group)) group = null;
      const rows = group === null
        ? [...groups.map(([g, e]) => ({ text: titleCase(g), run: () => choose(g, e.field, e.value) })),
          ...entries.filter(e => e.group === null).map(e => ({ text: label(e.option), run: () => rt.view.act(e.option.actions) }))]
        : [{ text: '‹ Back', run: () => { group = null; sig = ''; } }, ...entries.filter(e => e.group === group).map(e => ({ text: label(e.option), run: () => { rt.view.act(e.option.actions); group = null; sig = ''; } }))];
      setClass(root, 'gv-hide', !rows.length);
      const key = JSON.stringify([group, field, rows.map(r => r.text)]);
      if (key === sig) return; sig = key;
      setText(head, group === null ? 'Choose' : titleCase(group));
      shown = rows.slice(0, config.max).map((r, i) => {
        const b = el('button.gv-btn', { attrs: { type: 'button' }, text: `${digitsFree && i < 9 ? `${i + 1}. ` : ''}${r.text}` });
        b._run = () => { host.sound('confirm'); r.run(); };
        b.addEventListener('click', () => b._run());
        return b;
      });
      fill(list, ...shown);
    }
    rt.view.onFrame(paint);
  },
};
