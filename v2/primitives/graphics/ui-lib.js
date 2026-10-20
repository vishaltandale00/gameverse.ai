// Shared runtime for every graphics.ui.* primitive (and graphics.audio.synth):
// - h()/patch helpers that build DOM without innerHTML (works on a test stub);
// - one host per view: the `.gv-overlay` root, z-ordered layers, the injected
//   theme stylesheet, a small event bus between UI primitives, persisted
//   settings, and host holds (pause) / restart with feature detection;
// - small formatting and colour helpers.
// UI never writes rt.state. Everything here is presentation.
import { THEME_CSS, resolveTheme } from './ui-theme.js';
import { createUiInput } from './ui-input.js';
import { hslToRgb, rgbToHex } from '../../art/color.js';

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** setTimeout that never keeps a Node test process alive. */
export function later(fn, ms) { const t = setTimeout(fn, ms); t?.unref?.(); return t; }
export const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Stable 0..359 hue from a string (names, ids). */
export function hashHue(s) { let h = 0; for (const c of String(s ?? '')) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0; return h % 360; }
/** Stable '#rrggbb' colour from a string: sat/light in percent. */
export const hueColor = (s, sat = 62, light = 58) => rgbToHex(hslToRgb([hashHue(s), sat / 100, light / 100]));

/** Human label from an id: 'harbor_row' -> 'Harbor row'. */
export const titleCase = id => { const s = String(id ?? '').replace(/[_-]+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : ''; };
export const fmtInt = n => isNum(n) ? Math.round(n).toLocaleString('en-US') : '–';
export function fmtClock(seconds) { const s = Math.max(0, Math.floor(seconds || 0)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; }
export function fmtHour(hour) { if (!isNum(hour)) return '--:--'; const h = ((hour % 24) + 24) % 24; const m = Math.floor((h % 1) * 60); return `${String(Math.floor(h)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

// ------------------------------------------------------------------ DOM
const docOf = el => el?.ownerDocument || globalThis.document;

/**
 * h('div.card.big', { text, attrs, style, data, on, title, aria }, ...children)
 * Children may be nodes, strings, arrays, null/false (skipped).
 */
export function h(spec, props = {}, ...children) {
  const doc = props.doc || globalThis.document;
  const [tag, ...classes] = String(spec).split('.');
  const svg = tag === 'svg' || props.svg;
  const el = svg ? doc.createElementNS('http://www.w3.org/2000/svg', tag || 'g') : doc.createElement(tag || 'div');
  if (classes.length) el.setAttribute('class', classes.join(' '));
  if (props.class) el.setAttribute('class', [el.getAttribute('class'), props.class].filter(Boolean).join(' '));
  for (const [k, v] of Object.entries(props.attrs || {})) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
  for (const [k, v] of Object.entries(props.data || {})) if (v !== undefined && v !== null) el.setAttribute(`data-${k}`, String(v));
  for (const [k, v] of Object.entries(props.aria || {})) if (v !== undefined && v !== null) el.setAttribute(`aria-${k}`, String(v));
  for (const [k, v] of Object.entries(props.style || {})) if (v !== undefined && v !== null) el.style.setProperty(k, String(v));
  for (const [k, v] of Object.entries(props.on || {})) el.addEventListener(k, v);
  if (props.title) el.setAttribute('title', props.title);
  if (props.role) el.setAttribute('role', props.role);
  if (props.text !== undefined) el.textContent = String(props.text);
  append(el, children, doc);
  return el;
}
function append(el, children, doc) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'object' ? c : doc.createTextNode(String(c)));
  }
}
/** Replace all children (keeps the element). */
export function fill(el, ...children) { el.replaceChildren(); append(el, children, docOf(el)); return el; }

// Change-detecting setters: per-frame updates touch the DOM only when a value changes.
const memo = new WeakMap();
const changed = (el, key, v) => { let m = memo.get(el); if (!m) memo.set(el, (m = {})); if (m[key] === v) return false; m[key] = v; return true; };
export function setText(el, v) { const s = String(v ?? ''); if (changed(el, 'text', s)) el.textContent = s; return el; }
export function setStyle(el, prop, v) { const s = v === null || v === undefined ? '' : String(v); if (changed(el, `s:${prop}`, s)) el.style.setProperty(prop, s); return el; }
export function setAttr(el, name, v) { const s = v === null || v === undefined || v === false ? null : String(v); if (!changed(el, `a:${name}`, s)) return el; if (s === null) el.removeAttribute(name); else el.setAttribute(name, s); return el; }
export function setClass(el, name, on) { if (changed(el, `c:${name}`, Boolean(on))) el.classList.toggle(name, Boolean(on)); return el; }
export function setHidden(el, hidden) { return setClass(el, 'gv-hide', hidden); }
/** Re-render a subtree only when key (any JSON-able value) changes. */
export function keyed(el, key, render) { const k = typeof key === 'string' ? key : JSON.stringify(key); if (changed(el, 'key', k)) render(el); return el; }
/** Restart a CSS animation class (pop, shake, flash). */
export function pulse(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

// ------------------------------------------------------------------ host
const HOSTS = new WeakMap();
export const Z = { world: 1, hud: 10, subtitles: 20, screen: 25, dialogue: 30, toasts: 35, panel: 40, menu: 50, fade: 60 };
const SETTINGS_KEY = 'gv.ui.settings';
const DEFAULT_SETTINGS = { master: 0.8, music: 0.55, sfx: 0.8, muted: false, textSpeed: 1, reducedMotion: false, hudScale: 1, subtitles: true };

function storage() { try { return globalThis.localStorage || null; } catch { return null; } }
function loadSettings() {
  const s = { ...DEFAULT_SETTINGS };
  try { Object.assign(s, JSON.parse(storage()?.getItem(SETTINGS_KEY) || '{}')); } catch { /* corrupt or unavailable */ }
  const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (mq?.matches && storage()?.getItem(SETTINGS_KEY) == null) s.reducedMotion = true;
  return s;
}

/**
 * The shared UI host for this runtime's view (created on first use).
 * Returns null when there is no DOM view (headless or a host without a container).
 */
export function uiHost(rt) {
  const view = rt.view; if (!view?.container) return null;
  let host = HOSTS.get(view);
  if (host) return host;
  const doc = docOf(view.container);
  injectStyles(doc);
  const root = h('div.gv-overlay', { doc, attrs: { 'data-theme': resolveTheme(rt.doc, 'auto') } });
  view.container.append(root);
  const layers = {};
  const handlers = new Map();
  const holds = new Set();
  const settings = loadSettings();
  let first = null, origStep = null;
  host = {
    rt, view, doc, root, settings,
    /** Presentation clock in seconds (a host or test may supply view.now()). */
    now: () => (typeof view.now === 'function' ? view.now() : (globalThis.performance?.now?.() ?? Date.now()) / 1000),
    /** A z-ordered full-size layer; elements inside opt into pointer events. */
    layer(name) {
      if (layers[name]) return layers[name];
      const el = h('div.gv-layer', { doc, data: { layer: name }, style: { 'z-index': Z[name] ?? 15 } });
      root.append(el); layers[name] = el; return el;
    },
    el: (spec, props = {}, ...kids) => h(spec, { doc, ...props }, ...kids),
    on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); return () => handlers.set(name, handlers.get(name).filter(f => f !== fn)); },
    emit(name, data = {}) { for (const fn of handlers.get(name) || []) fn(data); },
    setSettings(patch) {
      Object.assign(settings, patch);
      try { storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
      root.classList.toggle('gv-reduced', Boolean(settings.reducedMotion));
      root.style.setProperty('--gv-hud-scale', String(settings.hudScale));
      host.emit('settings', settings);
    },
    /** Hold or release the simulation (pause, title screen). Prefers a host-provided view.pause. */
    hold(key, on) {
      if (on) holds.add(key); else holds.delete(key);
      if (typeof view.pause === 'function') { view.pause(holds.size > 0); return; }
      // Workaround until the host exposes view.pause (kernel request ui.md #1):
      // stop stepping the world in the browser only. No state is written.
      // While held, a step that carries UI actions (equip, buy, choose...) still runs one frame so they apply.
      if (!origStep && holds.size) { origStep = rt.step; rt.step = (input = {}) => (holds.size && !Object.values(input.actions || {}).some(Boolean) ? rt.state : origStep(input)); }
    },
    held: () => holds.size > 0,
    holds: () => [...holds],
    /** Restart from the first displayed frame. Prefers a host-provided view.restart. */
    restart() {
      if (typeof view.restart === 'function') { view.restart(); host.emit('restarted'); return true; }
      if (!first) return false;
      rt.restore(first); host.emit('restarted'); return true; // host-level reset (kernel request ui.md #2)
    },
    snapshotFirst() { if (!first && rt.state.frame <= 1) first = rt.snapshot(); },
    /** Play a UI sound through graphics.audio.synth when present. */
    sound(name, data) { host.emit('ui_sound', { name, ...data }); },
  };
  host.input = createUiInput(host);
  root.classList.toggle('gv-reduced', Boolean(settings.reducedMotion));
  root.style.setProperty('--gv-hud-scale', String(settings.hudScale));
  view.onFrame?.(() => { host.snapshotFirst(); host.input.sync(); host.input.poll(); });
  HOSTS.set(view, host);
  return host;
}

function injectStyles(doc) {
  if (!doc?.head || doc.getElementById?.('gv-ui-theme')) return;
  const style = doc.createElement('style');
  style.id = 'gv-ui-theme'; style.setAttribute('id', 'gv-ui-theme');
  style.textContent = THEME_CSS;
  doc.head.append(style);
}

// ------------------------------------------------------------------ doc lookups
export const docCharacter = (doc, id) => doc.plot?.characters?.find(c => c.id === id);
export const docItem = (doc, id) => doc.content?.items?.find(i => i.id === id);
export const docZone = (doc, id) => { for (const s of doc.spaces || []) { const z = (s.zones || []).find(x => x.id === id); if (z) return { ...z, space: s.id }; } return null; };
export const charName = (doc, id) => id === 'player' ? (docCharacter(doc, doc.player?.archetype)?.name || 'You') : (docCharacter(doc, id)?.name || titleCase(id));
export const itemName = (doc, id) => docItem(doc, id)?.name || titleCase(id);
export const zoneName = (doc, id) => docZone(doc, id)?.name || titleCase(id);
/** The document instance of a system primitive (first match), for reading its configuration. */
export const docSystem = (doc, use) => (doc.systems || []).find(s => s.use === use || s.use.startsWith(use + '.'));
