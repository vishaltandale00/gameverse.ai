// graphics.ui.story: narrative presentation for any game: the current scene
// (zone name and description), a running story log of dialogue, beats, acts
// and events, what the player carries, and the player's available options as
// focusable choices (keyboard, gamepad, pointer and number keys). The default
// renderer for graph and none spaces, and a readable overlay elsewhere.
// Endings are left to graphics.ui.menu's results screen when it is present.
import { THEMES, resolveTheme } from './ui-theme.js';
import { uiHost, fill, setText, setClass, pulse, charName, itemName, docZone, zoneName, titleCase, tellsOf, tellWords } from './ui-lib.js';
import { portraitColor } from './ui-portrait.js';
import { moveFocus } from './ui-input.js';
import * as S from './ui-sources.js';

/** Button label for an option: graph moves read as "Go to <zone>". */
// What a person reads for an option: the text its primitive writes for people (KERNEL_API §2 rt.options `text`);
// `label` is the solvers' unique key (ids), shown only for an option whose primitive writes no text.
export function optionLabel(doc, o) {
  return o.text || o.label;
}

export default {
  id: 'graphics.ui.story',
  card: {
    // The quantities it shows a person: the story's beats as its scenes (graphics/ui-defaults.js hudGoals).
    displays: [{ count: 'beat' }],
    intent: 'Shows the current scene, a running story log of dialogue and events, the inventory, and the available choices as focusable buttons (keyboard, gamepad, pointer, number keys); renders endings when no results screen exists.',
    views: ['text', 'overlay'],
    // It lists the game's options as its choices and sends the chosen one's actions (ARCHITECTURE §6.3: menu, choose an option).
    interactions: ['menu', 'avatar-grid', 'avatar-realtime'],
    controls: { options: true },
    params: {
      log: { type: 'integer', default: 40, min: 5, max: 400, unit: 'lines', effect: 'story lines kept on screen' },
      style: { type: 'string', default: 'book', options: ['book', 'terminal', 'comic', ...THEMES.filter(t => !['book', 'terminal', 'comic'].includes(t)), 'auto'], effect: 'typography and framing' },
    },
    reads: ['plot.characters', 'plot.endings', 'content.items'],
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el, doc = () => rt.doc;
    const kicker = el('p.gv-kicker'), title = el('h2'), desc = el('p.gv-desc');
    const scene = el('header.gv-scene', {}, kicker, title, desc);
    const log = el('ol.gv-log', { aria: { live: 'polite' } });
    const choices = el('div.gv-choices', { role: 'group', aria: { label: 'Choices' } });
    const bagList = el('ul');
    const bag = el('footer.gv-bag', {}, el('span', { text: 'Carrying' }), bagList);
    const ending = el('div.gv-story-ending.gv-hide');
    const theme = resolveTheme(rt.doc, config.style);
    const root = el('section.gv-story', { attrs: { 'data-theme': theme } }, scene, log, choices, bag, ending);
    host.layer('world').append(root);
    let options = [], focus = 0, lastKey = '', lastBag = {}, lastZone = null;
    const buttons = [];
    // Non-modal: it takes UI keys, but open hotkeys (pause, inventory) still win.
    host.input.push({ id: 'story', modal: false, takesInput: true, onVerb: verb => {
      if (rt.state.status !== 'playing' || !buttons.length) return false;
      if (['up', 'down', 'left', 'right'].includes(verb)) { const i = moveFocus(focus, verb, buttons.length, 1); if (i !== focus) { focus = i; paintFocus(); host.sound('move'); } return true; }
      if (verb === 'confirm') { choose(focus); return true; }
      const d = /^digit(\d)$/.exec(verb); if (d && buttons[Number(d[1]) - 1]) { choose(Number(d[1]) - 1); return true; }
      return false;
    } });
    function choose(i) { const o = options[i]; if (!o) return; host.sound('confirm'); pulse(buttons[i], 'is-pop'); rt.view.act(o.actions); }
    function paintFocus() { buttons.forEach((b, k) => setClass(b, 'is-focus', k === focus)); }
    const lines = [];
    function push(kind, ...content) {
      const li = el(`li.gv-${kind}`, {}, ...content);
      lines.push(li); log.append(li);
      while (lines.length > config.log) lines.shift().remove();
      log.scrollTop = 1e9;
    }
    const sayLine = (who, text) => { const color = who ? portraitColor(doc(), who) : null; push('say', ...(who ? [el('b', { text: charName(doc(), who), style: color ? { '--who': color } : {} })] : []), text); };
    rt.on('say', e => sayLine(e.character, e.text));
    rt.on('dialogue_line', e => sayLine(e.who, e.text));
    rt.on('bark', e => push('note', e.character ? `${charName(doc(), e.character)}: ${e.text ?? e.line}` : String(e.text ?? e.line ?? '')));
    rt.on('blocked', () => push('note', 'That way is closed to you, for now.'));
    rt.on('gate_blocked', e => push('note', e.hint || 'Something bars the way.'));
    rt.on('beat', e => { const b = doc().plot?.storyboard?.acts?.flatMap(a => a.beats || []).find(x => x.id === e.beat); if (b?.title) push('beat', b.title); });
    rt.on('act_start', e => { const a = doc().plot?.storyboard?.acts?.find(x => x.id === e.act); push('act', a?.title || titleCase(e.act)); });
    // What the document's primitives declare they tell a person (card.tells): clues, conclusions, tasks, notes.
    // An event naming who it happened to (`who`) is told only when that is the player.
    for (const t of tellsOf(rt.doc, rt.registry)) rt.on(t.event, e => { if (e?.who !== undefined && e.who !== 'player') return; const w = tellWords(doc(), t, e); push('note', w.title ? `${w.label}: ` : w.label, ...(w.title ? [el('b', { text: w.title })] : []), ...(w.detail ? [` ${w.detail}`] : [])); });
    rt.on('content_added', e => push('note', `The world grows: ${e.zones} new places, ${e.beats} new story beats.`));
    rt.on('game_end', e => {
      const end = doc().plot?.endings?.find(x => x.id === (e.ending ?? rt.state.ending));
      push('act', end?.title || (rt.state.status === 'won' ? 'The end' : 'Game over'));
      if (end?.epilogue || end?.text) push('say', end.epilogue || end.text);
      if (!(doc().graphics || []).some(g => g.use === 'graphics.ui.menu')) { fill(ending, el('div.gv-results.gv-panel', {}, el('h2.gv-display', { text: end?.title || (rt.state.status === 'won' ? 'The end' : 'Game over') }), el('p.gv-epilogue', { text: end?.epilogue || end?.text || '' }))); host.later(() => ending.classList.remove('gv-hide'), 600); }
    });

    rt.view.onFrame(() => {
      const p = rt.player(), space = p?.space ? rt.space(p.space) : null;
      const zoneId = typeof p?.at === 'string' ? p.at : p?.zone ?? null;
      const zone = zoneId ? (space?.zones?.get?.(zoneId) || docZone(doc(), zoneId)) : null;
      // The options no other mounted UI owns (ui-sources.js unownedOptions): a battle's commands are the battle screen's.
      options = rt.state.status === 'playing' && !host.input.modal ? S.unownedOptions(rt, 'graphics.ui.story', rt.availableOptions()) : [];
      const items = Object.entries(S.bag(rt)).filter(([, n]) => n > 0);
      const key = JSON.stringify([zoneId, options.map(o => o.label), items, rt.state.status]);
      if (key === lastKey) return; lastKey = key;
      setText(kicker, doc().title || '');
      setText(title, zone?.name || zoneName(doc(), zoneId) || '');
      setText(desc, zone?.description || '');
      if (zoneId !== lastZone) { pulse(scene, 'is-new'); lastZone = zoneId; }
      buttons.length = 0;
      fill(choices, ...options.map((o, i) => { const b = el('button.gv-btn', { attrs: { type: 'button' }, style: { 'animation-delay': `${i * 30}ms` }, on: { click: () => { focus = i; paintFocus(); choose(i); }, pointerenter: () => { focus = i; paintFocus(); } } }, el('span.gv-num', { text: i + 1 }), el('span', { text: optionLabel(doc(), o) })); buttons.push(b); return b; }));
      focus = Math.min(focus, Math.max(0, buttons.length - 1)); paintFocus();
      fill(bagList, ...(items.length ? items.map(([id, n]) => el(`li${(lastBag[id] || 0) < n ? '.is-new' : ''}`, { text: `${itemName(doc(), id)}${n > 1 ? ` ×${n}` : ''}` })) : [el('li.gv-empty', { text: 'nothing' })]));
      lastBag = Object.fromEntries(items);
    });
  },
};
