// graphics.ui.battle: turn-based battle presentation for creature battles,
// RPG fights and tactics turns. A full battle screen (sides, sprites from
// models, HP bars that drain, status tags, a typewriter message box and the
// command menu Fight / Bag / Party / Run with submenus and targeting) or a
// command panel over the world for tactics. Reads the battle service view,
// else gameplay.turns' view; sends view.act({ battle: {kind,id,target} }) or
// view.act({ turn_act: {action,target} }) and end_turn.
import { THEMES, resolveTheme } from './ui-theme.js';
import { uiHost, fill, setText, setStyle, setClass, pulse, titleCase, clamp, isNum, fmtInt } from './ui-lib.js';
import { portrait, portraitColor } from './ui-portrait.js';
import { moveFocus } from './ui-input.js';
import { createDialogueMachine } from './ui-dialogue.js';
import * as S from './ui-sources.js';

const CATEGORY = { move: 'Fight', skill: 'Fight', attack: 'Fight', item: 'Bag', switch: 'Party', run: 'Run', defend: 'Defend', wait: 'Wait' };
const TYPE_COLOR = { fire: '#ff8a5a', water: '#5aa8ff', grass: '#6fd08c', electric: '#ffd23f', ice: '#9ad8ff', rock: '#c8a878', ground: '#d8b060', ghost: '#a08ad8', poison: '#c06cff', psychic: '#ff7ab8', dark: '#8a7a9a', steel: '#b8c0cc', normal: '#d8d0c0', fighting: '#e07050', flying: '#a8c0ff', bug: '#b0d040', dragon: '#7a6aff', fairy: '#ffb0d8', phys: '#d8d0c0', shock: '#ffd23f', void: '#8a6aff' };

/** Top-level categories for a battle menu: [{ id, label, items:[...] }] in Fight, Bag, Party, Run order. */
export function battleMenu(view) {
  const groups = new Map();
  for (const it of view?.menu || []) { const label = CATEGORY[it.kind] || titleCase(it.kind || 'Act'); if (!groups.has(label)) groups.set(label, []); groups.get(label).push(it); }
  const order = ['Fight', 'Bag', 'Party', 'Defend', 'Wait', 'Run'];
  return [...groups].sort((a, b) => (order.indexOf(a[0]) + 1 || 50) - (order.indexOf(b[0]) + 1 || 50)).map(([label, items]) => ({ id: label.toLowerCase(), label, items, direct: items.length === 1 && (items[0].kind === 'run' || items[0].kind === 'defend' || items[0].kind === 'wait') }));
}
/** Valid targets for a menu item: explicit targets, else living units on the other side (or own side for ally/heal). */
export function targetsFor(view, item) {
  if (Array.isArray(item?.targets) && item.targets.length) return item.targets.filter(t => typeof t === 'string');
  const t = item?.target;
  if (!t || t === 'none' || t === 'self' || t === 'cell') return [];
  const mine = view.sides.find(s => s.player), others = view.sides.filter(s => !s.player);
  const pool = t === 'ally' ? [mine] : others;
  return pool.flatMap(s => s?.units || []).filter(u => !u.down).map(u => u.id);
}
/** The action to send for a chosen item. */
export function battleAction(view, item, target) {
  if (item.action) return item.action; // options-derived menus send the option's own actions
  if (view.source === 'turns') return { turn_act: target ? { action: item.id, target } : { action: item.id } };
  return { battle: { kind: item.kind || 'move', id: item.id, ...(target ? { target } : {}) } };
}

export default {
  id: 'graphics.ui.battle',
  card: {
    intent: 'Turn-based battle UI for any battle or tactics system: sides with sprites, draining HP bars and statuses, a message box, and Fight/Bag/Party/Run menus with targeting; or a compact command panel over the world for tactics.',
    views: ['any'],
    // The interactions it gives a person controls for, and the verbs it sends through view.act (ARCHITECTURE §6.3).
    interactions: ['pieces-turns', 'menu'],
    controls: { verbs: ['battle', 'turn_act', 'end_turn'] },
    params: {
      layout: { type: 'string', default: 'auto', options: ['auto', 'screen', 'panel'], effect: 'full battle screen, or a command panel over the world (auto: screen in non-spatial battle spaces)' },
      style: { type: 'string', default: 'auto', options: ['auto', ...THEMES] },
      cps: { type: 'number', default: 60, min: 0, max: 400, unit: 'chars/s', effect: 'battle message typewriter speed' },
      showLevels: { type: 'boolean', default: true },
    },
    reads: ['content.archetypes', 'content.models'],
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el, theme = resolveTheme(rt.doc, config.style);
    const field = el('div.gv-battle-field'), menu = el('div.gv-bmenu.gv-panel'), msgText = el('div'), msg = el('div.gv-bmsg.gv-panel', {}, msgText);
    const screen = el('section.gv-screen.gv-battle.gv-hide', { attrs: { 'data-theme': theme }, aria: { label: 'Battle' } }, field, el('div.gv-bottom', {}, msg, menu));
    host.layer('screen').append(screen);
    const machine = createDialogueMachine({ cps: config.cps });
    const messages = [];
    let view = null, cats = [], level = 'root', cat = null, items = [], index = 0, targeting = null, unitNodes = new Map(), lastUnitsSig = '', lastMenuSig = '', lastT = host.now(), waitingSince = lastT;
    const layer = { id: 'battle', modal: true, onVerb: verb => press(verb) };

    rt.on('battle_message', e => say(e.text));
    rt.on('battle_log', e => { if (e.text) say(e.text); });
    rt.on('turn_start', e => { if (view?.source === 'turns') say(e.side && view.sides.find(s => s.id === e.side)?.player ? 'Your turn.' : `${titleCase(e.side || e.who || 'Enemy')}'s turn.`); });
    rt.on('battle_end', e => say(e.outcome === 'won' || e.outcome === 'win' ? 'You won the battle!' : e.outcome === 'lost' ? 'You were defeated…' : 'The battle is over.'));
    rt.on('damaged', e => { const n = unitNodes.get(e.who); if (n) pulse(n, 'is-hit'); });
    function say(text) { if (!text) return; messages.push(String(text)); if (!machine.open || machine.phase === 'waiting') nextMessage(); }
    function nextMessage() { const t = messages.shift(); if (t) machine.show({ key: `${rt.state.frame}:${t}:${messages.length}`, text: t, choices: [] }); }

    function press(verb) {
      if (!view) return false;
      if (verb === 'confirm' && (machine.phase === 'typing')) { machine.confirm(); return true; }
      if (verb === 'confirm' && machine.phase === 'waiting' && messages.length) { nextMessage(); return true; }
      if (targeting) {
        if (verb === 'left' || verb === 'up') { targeting.i = (targeting.i - 1 + targeting.ids.length) % targeting.ids.length; host.sound('move'); paintTargets(); }
        else if (verb === 'right' || verb === 'down') { targeting.i = (targeting.i + 1) % targeting.ids.length; host.sound('move'); paintTargets(); }
        else if (verb === 'confirm') { send(targeting.item, targeting.ids[targeting.i]); }
        else if (verb === 'back') { targeting = null; paintTargets(); host.sound('back'); }
        return true;
      }
      if (['up', 'down', 'left', 'right'].includes(verb)) { const i = moveFocus(index, verb, items.length, 2); if (i !== index && i >= 0) { index = i; focusMenu(); host.sound('move'); } return true; }
      if (verb === 'confirm') { items[index]?._run?.(); return true; }
      if (verb === 'back' && level !== 'root') { level = 'root'; cat = null; lastMenuSig = ''; paintMenu(); host.sound('back'); return true; }
      return true;
    }
    function choose(item) {
      if (item.enabled === false) { host.sound('error'); return; }
      const ids = targetsFor(view, item);
      if (ids.length > 1) { targeting = { item, ids, i: 0 }; paintTargets(); host.sound('confirm'); return; }
      send(item, ids[0]);
    }
    function send(item, target) { rt.view.act(battleAction(view, item, target)); host.sound('confirm'); targeting = null; level = 'root'; cat = null; lastMenuSig = ''; paintTargets(); }
    function focusMenu() { items.forEach((b, k) => setClass(b, 'is-focus', k === index)); }
    function paintMenu() {
      const sig = JSON.stringify([level, cat, view?.menu, view?.turn]);
      if (sig === lastMenuSig) return; lastMenuSig = sig;
      cats = battleMenu(view);
      const btn = (label, run, { sub, disabled, type } = {}) => { const b = el(`button.gv-btn${disabled ? '.is-disabled' : ''}`, { attrs: { type: 'button' } }, el('span.gv-row-main', {}, el('span', { text: label }), sub ? el('span.gv-row-sub', { text: sub }) : null), type ? el('span.gv-type', { text: type, style: { '--t': TYPE_COLOR[type] || '#bbb' } }) : null); b._run = run; b.addEventListener('click', run); b.addEventListener('pointerenter', () => { index = items.indexOf(b); focusMenu(); }); return b; };
      const mine = view?.menu?.length;
      if (!mine) { fill(menu, el('p.gv-dim', { text: view?.turn && view.turn !== 'player' ? 'Waiting…' : '' })); items = []; return; }
      if (cats.length === 1 && !cats[0].direct) { level = 'items'; cat = cats[0].id; }
      if (level === 'root') items = cats.map(c => btn(c.label, () => (c.direct ? choose(c.items[0]) : (level = 'items', cat = c.id, lastMenuSig = '', index = 0, paintMenu()))));
      else items = (cats.find(c => c.id === cat)?.items || []).map(it => btn(it.text || it.label || titleCase(it.id), () => choose(it), { disabled: it.enabled === false, type: it.type, sub: [isNum(it.pp) ? `PP ${it.pp}/${it.ppMax ?? it.pp}` : '', isNum(it.cost) && it.cost ? `${it.cost} AP` : '', isNum(it.count) ? `×${it.count}` : '', it.hit ? `${Math.round(Object.values(it.hit)[0])}% hit` : ''].filter(Boolean).join(' · ') }));
      if (S.canAct(rt, 'end_turn') && view.source === 'turns') items.push(btn('End turn', () => { rt.view.act({ end_turn: true }); host.sound('confirm'); }));
      index = clamp(index, 0, items.length - 1);
      fill(menu, ...items); focusMenu();
    }
    function paintUnits() {
      const sig = JSON.stringify(view.sides.map(s => [s.id, s.units.map(u => u.id)]));
      if (sig !== lastUnitsSig) {
        lastUnitsSig = sig; unitNodes = new Map();
        fill(field, ...view.sides.map(s => el(`div.gv-bside.${s.player ? 'is-player' : 'is-enemy'}`, {}, ...s.units.map(u => {
          const model = u.model || rt.entity(u.id)?.archetype || u.id;
          const n = el(`div.gv-bunit.${s.player ? 'is-player-in' : 'is-enemy-in'}`, { data: { unit: u.id }, style: { '--who': portraitColor(rt.doc, model) } },
            el('div.gv-bcard.gv-panel', {}, el('div.gv-bcard-top', {}, el('span.gv-bname'), el('span.gv-bcard-lv')), el('div.gv-meter', {}, el('span.gv-meter-label', { text: 'HP' }), el('div.gv-meter-track', {}, el('div.gv-meter-chip'), el('div.gv-meter-fill')), el('span.gv-meter-value')), el('div.gv-bcard-status')),
            el('div.gv-bsprite', {}, portrait(rt.doc, typeof model === 'string' ? model : u.id, { mode: 'full', flip: s.player })));
          n.addEventListener('click', () => { if (targeting) { const i = targeting.ids.indexOf(u.id); if (i >= 0) { targeting.i = i; send(targeting.item, u.id); } } });
          unitNodes.set(u.id, n); return n;
        }))));
      }
      for (const s of view.sides) for (const u of s.units) {
        const n = unitNodes.get(u.id); if (!n) continue;
        const frac = clamp((u.hp ?? 0) / (u.hpMax || 1), 0, 1);
        setText(n.querySelector('.gv-bname'), u.name || titleCase(u.id));
        setText(n.querySelector('.gv-bcard-lv'), config.showLevels && isNum(u.level) ? `Lv ${u.level}` : isNum(u.ap) ? `AP ${u.ap}/${u.apMax ?? u.ap}` : '');
        const fillEl = n.querySelector('.gv-meter-fill'), chip = n.querySelector('.gv-meter-chip');
        setStyle(fillEl, 'transform', `scaleX(${frac.toFixed(4)})`); setStyle(chip, 'transform', `scaleX(${frac.toFixed(4)})`);
        setStyle(n.querySelector('.gv-meter'), '--fill', frac > 0.5 ? '#6fd08c' : frac > 0.2 ? '#ffc04d' : '#ff5d5d');
        setText(n.querySelector('.gv-meter-value'), `${fmtInt(u.hp)}/${fmtInt(u.hpMax)}`);
        const st = n.querySelector('.gv-bcard-status');
        const statusList = u.status || S.statuses(rt, rt.entity(u.id)).map(x => x.id);
        if (st.getAttribute('data-sig') !== String(statusList)) { st.setAttribute('data-sig', String(statusList)); fill(st, ...statusList.map(x => el('span.gv-type', { text: String(x).slice(0, 3), title: titleCase(x), style: { '--t': TYPE_COLOR[x] || '#c8b0ff' } }))); }
        setClass(n, 'is-active', Boolean(u.active)); setClass(n, 'is-down', Boolean(u.down) || (u.hp ?? 1) <= 0);
      }
    }
    function paintTargets() { for (const [id, n] of unitNodes) setClass(n, 'is-target', Boolean(targeting) && targeting.ids[targeting.i] === id); }

    rt.view.onFrame(() => {
      const now = host.now(), dt = Math.min(0.1, now - lastT); lastT = now;
      const next = S.battleView(rt);
      const mode = config.layout === 'auto' ? (rt.doc.spaces.find(s => s.id === rt.player()?.space)?.use === 'engine.space.none' || next?.source === 'battle' ? 'screen' : 'panel') : config.layout;
      if (!next) {
        if (view) { view = null; screen.classList.add('gv-hide'); host.input.pop(layer); targeting = null; lastUnitsSig = ''; lastMenuSig = ''; messages.length = 0; machine.end(0); host.emit('music', { mode: 'play' }); }
        return;
      }
      if (!view) { screen.classList.remove('gv-hide'); pulse(screen, 'is-in'); host.input.push(layer); level = 'root'; host.sound('open'); }
      view = next;
      setClass(screen, 'gv-battle-panel', mode === 'panel');
      setStyle(field, 'display', mode === 'panel' ? 'none' : null);
      setStyle(screen, 'background', mode === 'panel' ? 'transparent' : null);
      if (mode === 'screen') paintUnits();
      paintMenu();
      machine.tick(dt);
      if (machine.phase !== 'waiting') waitingSince = now;
      else if (messages.length && now - waitingSince > 0.9) nextMessage();
      setText(msgText, machine.visible || (view.turn === 'player' && view.menu?.length ? `What will ${view.sides.find(s => s.player)?.units.find(u => u.active)?.name || 'you'} do?` : ''));
    });
  },
};
