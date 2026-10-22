// A full-screen modal "sheet" shared by the journal, inventory and map: title,
// tabs (prev/next or click), a body that the owning primitive fills, a
// footer of device-aware hints, open/close animation, a hotkey that toggles
// it, optional simulation hold while open, and roving focus over whatever
// focusable items the body registers (lists or grids).
import { setClass, setText, fill } from './ui-lib.js';
import { glyph, moveFocus } from './ui-input.js';

/**
 * opts: { id, title, theme, hotkey?, pause?, tabs(): [{id,label,badge?}], renderTab(tabId, body, sheet), refresh?(tabId, body, sheet) per frame, hints?(tabId) -> [[verb,label]] }
 * Returns { open(tab?), close(), toggle(), isOpen, tab, setItems(els, {columns, onFocus, onConfirm, index}), focus, rerender() }.
 */
export function createSheet(host, opts) {
  const el = host.el;
  const tabsEl = el('div.gv-tabs', { role: 'tablist' });
  const title = el('h2.gv-sheet-title.gv-display', { text: opts.title });
  const extra = el('div.gv-sheet-extra');
  const body = el('div.gv-sheet-main');
  const hints = el('div.gv-hints');
  const panel = el('section.gv-sheet.gv-panel', { role: 'dialog', aria: { modal: 'true', label: opts.title } },
    el('header.gv-sheet-head', {}, title, extra, tabsEl), body, el('footer.gv-sheet-foot', {}, hints));
  const scrim = el('div.gv-scrim', { on: { click: () => sheet.close() } });
  const root = el('div.gv-hide', { attrs: { 'data-theme': opts.theme }, data: { sheet: opts.id } }, scrim, panel);
  host.layer('panel').append(root);
  let items = [], nav = { columns: 1 }, index = 0, tab = null, tabList = [];

  const layer = {
    id: opts.id, modal: true,
    onVerb(verb) {
      if (verb === 'back' || verb === opts.hotkey) { sheet.close(); return true; }
      // Another sheet's hotkey switches straight to it.
      if (['inventory', 'journal', 'map'].includes(verb)) { sheet.close(); host.input.press(verb); return true; }
      if (verb === 'prev' || verb === 'next') { if (tabList.length < 2 && nav.onVerb) return nav.onVerb(verb) ?? true; switchTab(verb === 'next' ? 1 : -1); return true; }
      if (['up', 'down', 'left', 'right'].includes(verb)) {
        if (nav.onMove?.(verb) === true) return true;
        const i = moveFocus(index, verb, items.length, nav.columns || 1);
        if (i !== index && i >= 0) { focusAt(i); host.sound('move'); }
        return true;
      }
      if (verb === 'confirm') { if (items[index]) { nav.onConfirm?.(index, items[index]); } return true; }
      if (/^digit/.test(verb)) return true;
      return nav.onVerb?.(verb) ?? true;
    },
  };
  function switchTab(d) {
    if (tabList.length < 2) return;
    const i = tabList.findIndex(t => t.id === tab);
    show(tabList[(i + d + tabList.length) % tabList.length].id); host.sound('move');
  }
  function focusAt(i) {
    index = i;
    items.forEach((it, k) => setClass(it, 'is-focus', k === i));
    const it = items[i];
    if (it) { it.scrollIntoView?.({ block: 'nearest' }); nav.onFocus?.(i, it); }
  }
  function paintTabs() {
    tabList = opts.tabs();
    fill(tabsEl, ...tabList.map(t => el(`button.gv-tab${t.id === tab ? '.is-active' : ''}`, { attrs: { type: 'button', role: 'tab', 'aria-selected': String(t.id === tab) }, on: { click: () => show(t.id) } }, t.label, t.badge ? el('span.gv-badge', { text: t.badge }) : null)));
    setClass(tabsEl, 'gv-hide', tabList.length < 2);
  }
  function paintHints() {
    const list = [...(opts.hints?.(tab) || [['confirm', 'Select']]), ...(tabList.length > 1 ? [['prev', 'Tab'], ['next', '']] : []), ['back', 'Close']];
    fill(hints, ...list.filter(([, l]) => l !== '').map(([v, l]) => el('span', {}, el('span.gv-kbd', { text: v === 'prev' ? `${glyph(host, 'prev')}/${glyph(host, 'next')}` : glyph(host, v) }), l)));
  }
  function show(tabId) {
    tab = tabId ?? tab ?? opts.tabs()[0]?.id;
    paintTabs();
    items = []; nav = { columns: 1 }; index = 0;
    fill(body);
    opts.renderTab(tab, body, sheet);
    paintHints();
  }
  const sheet = {
    get isOpen() { return host.input.isOpen(layer); },
    get tab() { return tab; },
    get index() { return index; },
    body, extra, root,
    open(tabId) {
      if (!host.input.isOpen(layer)) { host.input.push(layer); host.sound('open'); if (opts.pause !== false) host.hold(opts.id, true); }
      root.classList.remove('gv-hide'); panel.classList.remove('is-out');
      show(tabId); opts.onOpen?.(sheet);
    },
    close() {
      if (!host.input.isOpen(layer)) return;
      host.input.pop(layer); host.sound('close'); host.hold(opts.id, false);
      panel.classList.add('is-out'); host.later(() => { if (!host.input.isOpen(layer)) root.classList.add('gv-hide'); }, 200);
      opts.onClose?.(sheet);
    },
    toggle(tabId) { if (sheet.isOpen) sheet.close(); else sheet.open(tabId); },
    /** Register the focusable elements of the current body (in reading order). */
    setItems(els, o = {}) {
      items = els; nav = { columns: 1, ...o };
      els.forEach((it, k) => it.addEventListener?.('pointerenter', () => { if (index !== k) focusAt(k); }));
      els.forEach((it, k) => it.addEventListener?.('click', () => { focusAt(k); nav.onConfirm?.(k, it); }));
      focusAt(Math.max(0, Math.min(els.length - 1, o.index ?? 0)));
    },
    focus: i => focusAt(i),
    rerender() { const keep = index; show(tab); if (items.length) focusAt(Math.min(keep, items.length - 1)); },
    retitle(t) { setText(title, t); },
  };
  if (opts.hotkey) host.input.hotkey(opts.hotkey, () => sheet.toggle());
  if (opts.refresh) host.view.onFrame(() => { if (sheet.isOpen) opts.refresh(tab, body, sheet); });
  return sheet;
}
