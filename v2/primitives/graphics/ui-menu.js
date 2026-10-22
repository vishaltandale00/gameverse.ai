// graphics.ui.menu: the game's screens around play. Title (key art from the
// game's own palette, title set large, pitch, press start, controls card),
// pause (resume, restart, save/load slots, settings, controls, quit), settings
// (volumes, mute, text speed, reduced motion, HUD scale, subtitles),
// character/stage select, VS intro, round/stage banners and results.
// Simulation is held while a screen is open; choices go out through
// view.act (select_character, select_stage, save_game, load_game).
import { THEMES, resolveTheme } from './ui-theme.js';
import { uiHost, fill, setClass, setText, titleCase, zoneName, docSystem, fmtClock, fmtInt, isNum, clamp } from './ui-lib.js';
import { glyph, moveFocus, docBindings } from './ui-input.js';
import { portrait, portraitColor } from './ui-portrait.js';
import { icon } from './ui-icons.js';
import * as S from './ui-sources.js';
import { uiControls, unclaimedChoices, loopVerbs } from '../engine/runtime-lib-controls.js';

const VERB_LABEL = { move: 'Move', look: 'Look', jump: 'Jump', sprint: 'Sprint', crouch: 'Crouch', use: 'Use', interact: 'Interact', attack: 'Attack', alt_attack: 'Heavy attack', block: 'Block', dodge: 'Dodge', aim: 'Aim', mine: 'Mine', place: 'Place', drive: 'Drive', brake: 'Brake', handbrake: 'Handbrake', talk: 'Talk', dash: 'Dash', heal: 'Heal', cast: 'Cast', lockon: 'Lock on', fire: 'Fire', shoot: 'Shoot' };
const UI_VERBS = [['menu', 'Pause'], ['inventory', 'Inventory'], ['journal', 'Journal'], ['map', 'Map']];

/** Split "Name: Subtitle" (or dash) titles into a large name and a smaller line. */
export function titleParts(title = '') {
  const m = String(title).match(/^(.{2,}?)\s*[:–—]\s+(.+)$/) || String(title).match(/^(.{2,}?)\s+-\s+(.+)$/);
  return m ? [m[1], m[2]] : [String(title), ''];
}

/**
 * Controls card rows: every verb the primary view's engine.input.actions bindings give a key (one row per value of a
 * verb bound per value), then, with the registry, every loop verb a UI primitive issues instead (its row names that
 * control), then the UI keys whose primitives are present. Every verb a person plays the game's loops with is listed.
 */
export function controlRows(doc, registryHas = () => true, registry = null) {
  const b = docBindings(doc), rows = [];
  const fmt = k => ({ arrows: '←↑↓→', wasd: 'WASD', space: 'Space', esc: 'Esc', shift: 'Shift', enter: 'Enter', up: '↑', down: '↓', left: '←', right: '→', tab: 'Tab', comma: ',', period: '.', lmb: 'LMB', rmb: 'RMB', mouse: 'Mouse' }[k] || String(k).toUpperCase());
  const input = (doc.systems || []).find(s => s.use === 'engine.input.actions')?.with;
  const all = input?.bindings || {}, raw = all[doc.views?.primary] || Object.values(all)[0] || {};
  for (const [verb, keys] of Object.entries(raw)) {
    if (UI_VERBS.some(([v]) => v === verb)) continue;
    if (Array.isArray(keys)) rows.push({ verb, label: VERB_LABEL[verb] || titleCase(verb), keys: keys.map(fmt) });
    else for (const [value, ks] of Object.entries(keys || {})) rows.push({ verb, value, label: `${VERB_LABEL[verb] || titleCase(verb)}: ${titleCase(value)}`, keys: (ks || []).map(fmt) });
  }
  if (registry) {
    const ui = uiControls(doc, registry), choice = ui.choice.length ? new Set(unclaimedChoices(doc, registry)) : new Set();
    for (const verb of loopVerbs(doc, registry)) {
      if (raw[verb] || UI_VERBS.some(([v]) => v === verb)) continue;
      const by = ui.verbs.get(verb)?.[0] ?? (choice.has(verb) ? ui.choice[0] : null);
      if (by) rows.push({ verb, label: VERB_LABEL[verb] || titleCase(verb), keys: [`${titleCase(by.split('.').pop())} panel`], via: by });
    }
  }
  if (!rows.length) rows.push({ verb: 'move', label: 'Move', keys: ['WASD', '←↑↓→'] }, { verb: 'interact', label: 'Interact', keys: ['E'] });
  for (const [verb, label] of UI_VERBS) {
    const owner = { menu: 'graphics.ui.menu', inventory: 'graphics.ui.inventory', journal: 'graphics.ui.journal', map: 'graphics.ui.map' }[verb];
    if (!(doc.graphics || []).some(g => g.use === owner) || !registryHas(owner)) continue;
    rows.push({ verb, label, keys: (b[verb] ? [...b[verb]] : { menu: ['esc'], inventory: ['i'], journal: ['j'], map: ['m'] }[verb]).map(fmt) });
  }
  return rows;
}

/** Selectable options for a select screen: [{ id, name, desc, model?, tags? }] */
export function selectOptions(doc, sel) {
  // Each entry by its declared name ('' when it declares none: never its id); a stage without one by its number.
  if (sel.options?.length) return sel.options.map(o => ({ ...o, name: o.name || '' }));
  const from = sel.from || (sel.kind === 'stage' ? 'zones' : 'archetypes');
  if (from === 'archetypes') return (doc.content?.archetypes || []).filter(a => a.kind === 'player' || (a.tags || []).includes('selectable')).map(a => ({ id: a.id, name: a.name || doc.plot?.characters?.find(c => c.archetype === a.id || c.id === a.id)?.name || '', desc: a.desc || '', model: a.id }));
  if (from === 'characters') return (doc.plot?.characters || []).filter(c => (c.tags || []).includes('playable') || /player|playable/.test(c.role || '')).map(c => ({ id: c.id, name: c.name || '', desc: c.bio || '', model: c.id }));
  if (from === 'stages') return (docSystem(doc, 'gameplay.stage.sequence')?.with?.stages || []).map((s, i) => ({ id: s.id, name: s.name || s.title || `Stage ${i + 1}`, desc: s.desc || '' }));
  return (doc.spaces || []).flatMap(s => s.zones || []).filter(z => !sel.tag || (z.tags || []).includes(sel.tag)).map(z => ({ id: z.id, name: z.name || '', desc: z.description || '', tags: z.tags }));
}

/** Results summary for game_end: { won, title, text, stats: [[label, value]] } */
export function resultsModel(rt, ev = {}) {
  const st = rt.state, ending = rt.doc.plot?.endings?.find(e => e.id === (ev.ending ?? st.ending));
  const won = (ev.outcome ?? st.status) === 'won';
  const stats = [['Time', fmtClock(st.time)]];
  const c = k => st.counts[k] || 0;
  if (isNum(st.vars.score)) stats.push(['Score', fmtInt(st.vars.score)]);
  if (c('defeated')) stats.push(['Defeated', fmtInt(c('defeated'))]);
  if (c('quest_complete')) stats.push(['Quests completed', fmtInt(c('quest_complete'))]);
  if (c('item_gained')) stats.push(['Items found', fmtInt(c('item_gained'))]);
  if (c('collected')) stats.push(['Collected', fmtInt(c('collected'))]);
  if (c('discovered') || c('enter_zone')) stats.push(['Places visited', fmtInt(new Set(Object.keys(st.counts).filter(k => /^(discovered|enter_zone):/.test(k)).map(k => k.split(':')[1])).size || c('enter_zone'))]);
  if (c('player_died') || c('died')) stats.push(['Deaths', fmtInt(c('player_died') || 0)]);
  return { won, outcome: ev.outcome ?? st.status, title: ending?.title || (won ? 'Victory' : st.status === 'lost' ? 'Game over' : 'The end'), text: ending?.epilogue || ending?.text || '', stats };
}

const card = {
  intent: 'Screens around play for any game: title with press start and controls, pause with restart, save/load slots, settings and controls, character and stage select, VS intro, round and stage banners, and a results screen at the end.',
  views: ['any'],
  // The interactions it gives a person controls for, and the verbs it sends through view.act (ARCHITECTURE §6.3).
  interactions: ['avatar-realtime', 'avatar-grid', 'pieces-turns', 'cursor-board', 'menu'],
  controls: { verbs: ['save_game', 'load_game'] },
  params: {
    style: { type: 'string', default: 'auto', options: ['auto', ...THEMES], effect: 'visual theme' },
    title: { type: 'boolean', default: true, effect: 'show a title screen before play starts' },
    pause: { type: 'boolean', default: true, effect: 'pause menu on the menu key' },
    autoPause: { type: 'boolean', default: true, effect: 'pause when the page is hidden' },
    slots: { type: 'integer', default: 3, min: 0, max: 12, effect: 'save slots in the pause menu (0 hides saving)' },
    settings: { type: 'boolean', default: true, effect: 'settings screen' },
    results: { type: 'boolean', default: true, effect: 'results screen when the game ends' },
    banners: { type: 'boolean', default: true, effect: 'round, fight, KO and stage banners' },
    select: { type: 'list', default: [], of: { type: 'object', fields: {
      id: { type: 'string', required: true }, kind: { type: 'string', default: 'character', options: ['character', 'stage', 'custom'] },
      title: { type: 'string' }, action: { type: 'string', required: true, effect: 'verb receiving the chosen id (select_character, select_stage...)' },
      from: { type: 'string', options: ['archetypes', 'characters', 'zones', 'stages'], effect: 'where options come from when none are listed' },
      tag: { type: 'string', effect: 'zones: only those with this tag' },
      on: { type: 'string', default: 'start', effect: "'start' (after the title) or an event name that opens it" },
      options: { type: 'list', default: [], of: { type: 'object', open: true, fields: { id: { type: 'string', required: true }, name: { type: 'string' }, desc: { type: 'string' }, model: { type: 'string' } } } },
    } }, effect: 'select screens' },
    vs: { type: 'boolean', default: true, effect: 'VS intro on match_start' },
  },
  reads: ['plot.endings', 'content.models'],
};

export default {
  id: 'graphics.ui.menu',
  card,
  validate(config) {
    const errors = [], ids = new Set();
    config.select?.forEach((s, i) => { if (ids.has(s.id)) errors.push({ code: 'ui_select_duplicate', path: `with.select[${i}].id`, message: `select '${s.id}' is listed twice` }); ids.add(s.id); if (s.kind === 'custom' && !s.options?.length) errors.push({ code: 'ui_select_empty', path: `with.select[${i}]`, message: 'a custom select needs options' }); });
    return errors;
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el, theme = resolveTheme(rt.doc, config.style);
    const root = el('div.gv-hide', { attrs: { 'data-theme': theme }, data: { menu: '' } });
    const banner = el('div.gv-banner', { attrs: { 'data-theme': theme } });
    const fade = el('div.gv-fade');
    host.layer('menu').append(root);
    host.layer('toasts').append(banner);
    host.layer('fade').append(fade);
    const stack = []; // screen names
    // A world the host builds to carry on a game in play (a hot-loaded version: view.continuing) is already started.
    const continuing = Boolean(rt.view.continuing);
    let items = [], index = 0, columns = 1, onBack = null, started = !config.title || continuing, selectQueue = [], ended = false;
    const layer = { id: 'menu', modal: true, onVerb: verb => {
      if (verb === 'back') { onBack?.(); return true; }
      if (verb === 'menu' && stack.at(-1) === 'pause') { resume(); return true; }
      if (['up', 'down', 'left', 'right'].includes(verb)) {
        if (items[index]?._adjust && (verb === 'left' || verb === 'right')) { items[index]._adjust(verb === 'left' ? -1 : 1); return true; }
        const i = moveFocus(index, verb, items.length, columns); if (i !== index && i >= 0) { focus(i); host.sound('move'); } return true;
      }
      if (verb === 'confirm') { items[index]?._run?.(); return true; }
      return true;
    } };
    function focus(i) { index = i; items.forEach((b, k) => setClass(b, 'is-focus', k === i)); items[i]?._onFocus?.(); }
    function setItems(list, { cols = 1, start = 0, back = null } = {}) { items = list; columns = cols; onBack = back; list.forEach((b, k) => { b.addEventListener('pointerenter', () => { if (index !== k) focus(k); }); b.addEventListener('click', () => { focus(k); b._run?.(); }); }); focus(Math.min(start, list.length - 1)); }
    const button = (label, run, { cls = '', disabled = false, sub } = {}) => { const b = el(`button.gv-btn${cls}`, { attrs: { type: 'button', disabled } }, sub ? el('span.gv-row-main', {}, el('span', { text: label }), el('span.gv-row-sub', { text: sub })) : label); b._run = () => { if (disabled) { host.sound('error'); return; } host.sound('confirm'); run(); }; return b; };

    function open(name, render) {
      if (!host.input.isOpen(layer)) host.input.push(layer);
      host.hold('menu', true);
      if (stack.at(-1) !== name) stack.push(name);
      root.classList.remove('gv-hide');
      fill(root); render(); root.firstChild?.classList.add('is-in');
    }
    function closeAll() {
      stack.length = 0; items = []; onBack = null;
      host.input.pop(layer); host.hold('menu', false);
      root.classList.add('gv-hide'); fill(root);
      host.emit('music', { mode: 'play' });
    }
    const back = () => { stack.pop(); const prev = stack.pop(); if (prev && SCREENS[prev]) SCREENS[prev](); else closeAll(); };

    // ------------------------------------------------------------- screens
    const SCREENS = {
      title() {
        open('title', () => {
          const [name, sub] = titleParts(rt.doc.title);
          const press = el('button.gv-press', { attrs: { type: 'button' }, text: host.input.device === 'gamepad' ? `Press ${glyph(host, 'confirm')}` : `Press ${glyph(host, 'confirm')} to start` });
          press._run = start;
          root.append(el('section.gv-menu.gv-title-screen', { aria: { label: `${rt.doc.title} title screen` } }, el('div.gv-title-bg'), el('div.gv-title-motes'),
            el('div.gv-title-main', {}, el('h1.gv-title-name', { text: name }), sub ? el('div.gv-title-sub', { text: sub }) : null, rt.doc.logline ? el('p.gv-title-pitch', { text: rt.doc.logline }) : null, press),
            controlsCard()));
          setItems([press], { back: null });
          host.emit('music', { mode: 'title' });
        });
      },
      pause() {
        open('pause', () => {
          const list = [button('Resume', resume)];
          if (config.slots > 0) { list.push(button('Save game', () => SCREENS.slots('save'))); list.push(button('Load game', () => SCREENS.slots('load'))); }
          if (config.settings) list.push(button('Settings', SCREENS.settings));
          list.push(button('Controls', SCREENS.controls));
          list.push(button('Restart', () => confirmThen('Restart from the beginning?', () => { host.restart(); fadeIn(); closeAll(); })));
          if (config.title) list.push(button('Quit to title', () => confirmThen('Quit to the title screen? Unsaved progress is lost.', () => { host.restart(); started = false; stack.length = 0; SCREENS.title(); })));
          root.append(el('section.gv-menu', { role: 'dialog', aria: { modal: 'true', label: 'Paused' } }, el('div.gv-scrim'), el('div.gv-menu-card.gv-panel', {}, el('h2.gv-display', { text: 'Paused' }), ...list, el('div.gv-hints', { style: { 'margin-top': '10px' } }, hint('confirm', 'Select'), hint('back', 'Resume')))));
          setItems(list, { back: resume });
          host.emit('music', { mode: 'pause' });
        });
      },
      settings() {
        open('settings', () => {
          const s = host.settings, list = [];
          const slider = (label, key, min, max, step, fmt = v => `${Math.round(v * 100)}%`) => {
            const fillEl = el('i'), val = el('span', { text: fmt(s[key]) });
            const b = el('button.gv-btn.gv-slider', { attrs: { type: 'button', role: 'slider', 'aria-label': label } }, el('span', { text: label }), val, el('div.gv-slider-track', {}, fillEl));
            const paint = () => { fillEl.style.setProperty('width', `${((host.settings[key] - min) / (max - min)) * 100}%`); setText(val, fmt(host.settings[key])); b.setAttribute('aria-valuenow', String(host.settings[key])); };
            b._adjust = d => { host.setSettings({ [key]: +clamp(host.settings[key] + d * step, min, max).toFixed(2) }); paint(); host.sound('move'); };
            b._run = () => b._adjust(host.settings[key] >= max ? -(max - min) / step : 1);
            paint(); return b;
          };
          const toggle = (label, key) => { const b = el('button.gv-btn', { attrs: { type: 'button', role: 'switch' } }); const paint = () => { fill(b, el('span', { text: label }), el('span.gv-price', { text: host.settings[key] ? 'On' : 'Off' })); b.setAttribute('aria-checked', String(Boolean(host.settings[key]))); }; b._run = () => { host.setSettings({ [key]: !host.settings[key] }); paint(); host.sound('confirm'); }; b._adjust = () => b._run(); paint(); return b; };
          list.push(slider('Master volume', 'master', 0, 1, 0.1), slider('Music', 'music', 0, 1, 0.1), slider('Effects', 'sfx', 0, 1, 0.1), toggle('Mute', 'muted'),
            slider('Text speed', 'textSpeed', 0.5, 3, 0.25, v => `${v}×`), slider('HUD size', 'hudScale', 0.8, 1.4, 0.1, v => `${Math.round(v * 100)}%`), toggle('Subtitles', 'subtitles'), toggle('Reduced motion', 'reducedMotion'), button('Back', back));
          root.append(el('section.gv-menu', {}, el('div.gv-scrim'), el('div.gv-menu-card.gv-panel', {}, el('h2.gv-display', { text: 'Settings' }), ...list, el('div.gv-hints', {}, hint('left', '−'), hint('right', '+'), hint('back', 'Back')))));
          setItems(list, { back });
        });
      },
      controls() {
        open('controls', () => {
          const b = button('Back', back);
          root.append(el('section.gv-menu', {}, el('div.gv-scrim'), el('div.gv-menu-card.gv-panel', { style: { width: 'min(520px,92vw)' } }, el('h2.gv-display', { text: 'Controls' }), controlsList(), b)));
          setItems([b], { back });
        });
      },
      slots(mode) {
        open(`slots`, () => {
          const known = S.saveSlots(rt), list = [];
          for (let i = 1; i <= config.slots; i++) {
            const info = known ? known.find(x => x.slot === i) : localSlot(i);
            const sub = info ? [info.label || (info.zone ? zoneName(rt.doc, info.zone) : ''), isNum(info.time) ? fmtClock(info.time) : '', info.saved ? new Date(info.saved).toLocaleString() : ''].filter(Boolean).join(' · ') : 'Empty';
            list.push(button(`Slot ${i}`, () => (mode === 'save' ? save(i) : load(i)), { cls: '.gv-slot-row', disabled: mode === 'load' && !info, sub }));
          }
          list.push(button('Back', back));
          root.append(el('section.gv-menu', {}, el('div.gv-scrim'), el('div.gv-menu-card.gv-panel', {}, el('h2.gv-display', { text: mode === 'save' ? 'Save game' : 'Load game' }), el('div.gv-slots', {}, ...list))));
          setItems(list, { back });
        });
      },
      select(sel) {
        open(`select:${sel.id}`, () => {
          const options = selectOptions(rt.doc, sel);
          const cols = clamp(Math.ceil(Math.sqrt(options.length * 1.6)), 1, 6);
          const cards = options.map((o, i) => { const b = el('button.gv-select-card', { attrs: { type: 'button' }, style: { 'animation-delay': `${i * 40}ms`, '--who': o.model ? portraitColor(rt.doc, o.model) : null } }, o.model ? el('div.gv-bsprite', {}, portrait(rt.doc, o.model, { mode: 'full' })) : el('div.gv-bsprite', { style: { display: 'grid', 'place-items': 'center' } }, icon(sel.kind === 'stage' ? 'map' : 'star')), el('b', { text: o.name }), o.desc ? el('small', { text: o.desc }) : null); b._run = () => { host.sound('confirm'); rt.view.act({ [sel.action]: o.id }); host.emit('selected', { select: sel.id, id: o.id }); nextSelect(); }; return b; });
          root.append(el('section.gv-select', { aria: { label: sel.title || 'Select' } }, el('h2.gv-display', { text: sel.title || (sel.kind === 'stage' ? 'Choose a stage' : 'Choose your character') }), el('div.gv-select-grid', { style: { '--cols': cols } }, ...cards), el('div.gv-hints', {}, hint('confirm', 'Choose'))));
          if (!cards.length) { nextSelect(); return; }
          setItems(cards, { cols, back: null });
        });
      },
      results(ev) {
        open('results', () => {
          const r = resultsModel(rt, ev), list = [button('Play again', () => { host.restart(); ended = false; fadeIn(); closeAll(); if (config.title) { started = false; SCREENS.title(); } })];
          if (config.title) list.push(button('Title screen', () => { host.restart(); ended = false; started = false; stack.length = 0; SCREENS.title(); }));
          const best = bestScore(r);
          root.append(el('section.gv-menu', {}, el('div.gv-scrim'), el(`div.gv-results.gv-panel.is-${r.won ? 'won' : r.outcome === 'lost' ? 'lost' : 'neutral'}`, { role: 'dialog', aria: { label: r.title } },
            el('h2.gv-display', { text: r.title }), r.text ? el('p.gv-epilogue', { text: r.text }) : null,
            el('dl.gv-stats', {}, ...r.stats.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]), ...(best ? [el('dt', { text: 'Best score' }), el('dd', { text: best })] : [])),
            el('div.gv-buttons', {}, ...list))));
          setItems(list, { cols: list.length, back: null });
        });
      },
      vs(fighters) {
        open('vs', () => {
          const [a, b] = fighters, side = (id, cls) => el(`div.gv-vs-side.${cls}`, { style: { '--who': portraitColor(rt.doc, id) } }, el('div.gv-bsprite', {}, portrait(rt.doc, id, { mode: 'full', flip: cls === 'is-right' })), el('b', { text: S.entityName(rt, id) }));
          root.append(el('section.gv-vs', { aria: { label: 'Versus' } }, side(a, 'is-left'), el('div.gv-vs-mark', { text: 'VS' }), side(b, 'is-right')));
          setItems([], { back: null });
          host.later(() => { if (stack.at(-1) === 'vs') closeAll(); }, 2400);
        });
      },
    };

    // ------------------------------------------------------------- helpers
    const hint = (verb, label) => el('span', {}, el('span.gv-kbd', { text: glyph(host, verb) }), label);
    function controlsList() { return el('dl', {}, ...controlRows(rt.doc, id => rt.registry.has(id), rt.registry).flatMap(r => [el('dt', { text: r.label }), el('dd', {}, ...r.keys.map(k => el('span.gv-kbd', { text: k })))])); }
    function controlsCard() { return el('aside.gv-controls.gv-panel', { aria: { label: 'Controls' } }, el('h4', { text: 'How to play' }), controlsList()); }
    function confirmThen(question, yes) {
      open('confirm', () => {
        const list = [button('Yes', yes), button('No', back)];
        root.append(el('section.gv-menu', {}, el('div.gv-scrim'), el('div.gv-menu-card.gv-panel', {}, el('h2.gv-display', { text: 'Are you sure?', style: { 'font-size': '1.4em' } }), el('p.gv-dim', { text: question, style: { 'text-align': 'center' } }), ...list)));
        setItems(list, { start: 1, back });
      });
    }
    function start() {
      if (started) return;
      started = true; host.emit('unlock'); fadeIn();
      selectQueue = config.select.filter(s => s.on === 'start');
      nextSelect();
    }
    function nextSelect() { const s = selectQueue.shift(); if (s) SCREENS.select(s); else closeAll(); }
    function resume() { closeAll(); }
    function fadeIn() { fade.classList.add('is-on'); host.later(() => fade.classList.remove('is-on'), 180); }
    const slotKey = i => `gv.save.${rt.doc.id}.${i}`;
    function localSlot(i) { try { const raw = globalThis.localStorage?.getItem(slotKey(i)); return raw ? JSON.parse(raw).info : null; } catch { return null; } }
    function save(i) {
      if (S.canAct(rt, 'save_game')) rt.view.act({ save_game: i });
      else try { globalThis.localStorage?.setItem(slotKey(i), JSON.stringify({ info: { slot: i, time: rt.state.time, zone: rt.player()?.zone ?? null, saved: Date.now() }, snapshot: rt.snapshot() })); } catch { host.sound('error'); }
      host.emit('notify', { text: `Saved to slot ${i}` });
      closeAll();
    }
    function load(i) {
      if (S.canAct(rt, 'load_game')) rt.view.act({ load_game: i });
      else { try { const raw = globalThis.localStorage?.getItem(slotKey(i)); if (raw) rt.view.load(JSON.parse(raw).snapshot); } catch { host.sound('error'); } } // host-level load (view.load)
      fadeIn(); closeAll();
    }
    function bestScore(r) {
      if (!isNum(rt.state.vars.score)) return null;
      const key = `gv.best.${rt.doc.id}`;
      try { const prev = Number(globalThis.localStorage?.getItem(key) || 0); if (rt.state.vars.score > prev) { globalThis.localStorage?.setItem(key, String(rt.state.vars.score)); return `${fmtInt(rt.state.vars.score)} (new)`; } return fmtInt(prev); } catch { return null; }
    }
    function showBanner(text, kicker = '') { if (!config.banners) return; fill(banner, kicker ? el('div.gv-banner-kicker', { text: kicker }) : null, el('div.gv-banner-line'), el('div.gv-banner-title', { text }), el('div.gv-banner-line')); }

    // ------------------------------------------------------------- wiring
    if (config.pause) host.input.hotkey('menu', () => { if (!stack.length && started && !ended) SCREENS.pause(); }, { overModal: true });
    if (config.autoPause) host.listen(host.doc, 'visibilitychange', () => { if (host.doc.visibilityState === 'hidden' && !stack.length && started && !ended && config.pause) SCREENS.pause(); });
    for (const s of config.select.filter(x => x.on !== 'start')) rt.on(s.on, () => { if (!stack.length) SCREENS.select(s); else selectQueue.push(s); });
    if (config.vs) rt.on('match_start', e => { const f = e.fighters || e.sides; if (f?.length >= 2) SCREENS.vs(f); });
    rt.on('round_start', e => showBanner(`Round ${e.round}`));
    rt.on('fight', () => showBanner('Fight!'));
    rt.on('round_end', e => showBanner(e.how === 'ko' ? 'K.O.' : e.how === 'time' ? 'Time' : e.how === 'perfect' ? 'Perfect' : e.winner ? (S.entityName(rt, e.winner) ? `${S.entityName(rt, e.winner)} wins` : e.winner === 'player' ? 'You win' : 'You lose') : 'Draw'));
    // A stage by its declared name (stage_intro `title`), else its number: never its id.
    rt.on('stage_intro', e => showBanner(e.title || (isNum(rt.state.vars['stage.number']) ? `Stage ${rt.state.vars['stage.number']}` : 'Get ready'), 'Stage'));
    rt.on('stage_clear', () => showBanner('Stage clear'));
    rt.on('wave_start', e => showBanner(`Wave ${e.wave ?? e.index ?? ''}`.trim()));
    let resultsAt = null, endEvent = null;
    rt.on('game_end', e => { ended = true; endEvent = e; if (config.results) resultsAt = host.now() + 0.9; });
    rt.view.onFrame(() => { if (resultsAt !== null && host.now() >= resultsAt) { resultsAt = null; SCREENS.results(endEvent); } });
    if (continuing) { /* play goes on where it was: no title or start selects */ }
    else if (config.title) SCREENS.title(); else { started = true; selectQueue = config.select.filter(s => s.on === 'start'); if (selectQueue.length) nextSelect(); }
    host.on('open', ({ panel }) => { if (panel === 'pause' && !stack.length) SCREENS.pause(); if (panel === 'settings') SCREENS.settings(); });
  },
};
