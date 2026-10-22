// A tiny DOM stub for UI primitive tests (no dependencies): elements with
// attributes, classes, styles, text, events and a small selector engine, a
// recording 2D canvas context (calls in order with their arguments, a gradient's colour stops among them; style sets as ['=<prop>', value]), a window with keyboard dispatch, and a mount()
// harness that runs a document in a fake browser host (view.act/onFrame).
import { compile } from '../v2/kernel/testing.js';

class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
  get children() { return this.childNodes.filter(n => n instanceof Element); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); if (v !== '' && v != null) this.append(this.ownerDocument.createTextNode(String(v))); }
  append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n); }
  prepend(...nodes) { nodes.reverse().forEach(n => this.insertBefore(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n, this.firstChild)); }
  appendChild(n) { n.parentNode?.removeChildNode(n); n.parentNode = this; this.childNodes.push(n); return n; }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); n.parentNode?.removeChildNode(n); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; }
  removeChildNode(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; }
  removeChild(n) { this.removeChildNode(n); return n; }
  remove() { this.parentNode?.removeChildNode(this); }
  replaceChildren(...nodes) { for (const c of [...this.childNodes]) this.removeChildNode(c); this.append(...nodes); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
}
class Text extends Node {
  constructor(doc, text) { super(doc); this.data = String(text); }
  get textContent() { return this.data; } set textContent(v) { this.data = String(v); }
}
class ClassList {
  constructor(el) { this.el = el; }
  get list() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  set(list) { this.el.setAttribute('class', [...new Set(list)].join(' ')); }
  add(...c) { this.set([...this.list, ...c]); } remove(...c) { this.set(this.list.filter(x => !c.includes(x))); }
  contains(c) { return this.list.includes(c); }
  toggle(c, force) { const on = force === undefined ? !this.contains(c) : Boolean(force); on ? this.add(c) : this.remove(c); return on; }
}
class Style {
  constructor() { this._ = {}; }
  setProperty(k, v) { if (v === '' || v == null) delete this._[k]; else this._[k] = String(v); }
  getPropertyValue(k) { return this._[k] ?? ''; } removeProperty(k) { delete this._[k]; }
}
class Element extends Node {
  constructor(doc, tag, ns) { super(doc); this.tagName = tag.toUpperCase(); this.localName = tag; this.namespaceURI = ns || null; this.attributes = {}; this.style = new Style(); this.classList = new ClassList(this); this.listeners = {}; this.scrollTop = 0; this.value = ''; }
  setAttribute(k, v) { this.attributes[k] = String(v); } getAttribute(k) { return this.attributes[k] ?? null; }
  hasAttribute(k) { return k in this.attributes; } removeAttribute(k) { delete this.attributes[k]; }
  get id() { return this.getAttribute('id') || ''; } set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; } set className(v) { this.setAttribute('class', v); }
  get hidden() { return this.hasAttribute('hidden'); } set hidden(v) { v ? this.setAttribute('hidden', '') : this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); } set disabled(v) { v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }
  get dataset() { const el = this; return new Proxy({}, { get: (_, k) => el.getAttribute(`data-${String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`) ?? undefined, set: (_, k, v) => { el.setAttribute(`data-${String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`, v); return true; } }); }
  get offsetWidth() { return 0; } get clientWidth() { return 800; } get clientHeight() { return 600; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }; }
  addEventListener(t, fn, o) { if (!fn) return; const c = typeof o === 'boolean' ? o : Boolean(o?.capture), l = (this.listeners[t] ??= []); if (!l.some(x => x.fn === fn && x.capture === c)) l.push({ fn, capture: c }); }
  removeEventListener(t, fn, o) { const c = typeof o === 'boolean' ? o : Boolean(o?.capture); this.listeners[t] = (this.listeners[t] || []).filter(x => !(x.fn === fn && x.capture === c)); }
  dispatchEvent(ev) { ev.target ??= this; for (let el = this; el; el = el.parentNode) { ev.currentTarget = el; for (const x of [...(el.listeners?.[ev.type] || [])]) { x.fn(ev); if (ev._immediate) break; } if (ev._stop) break; } return !ev.defaultPrevented; }
  click() { this.dispatchEvent(event('click')); }
  focus() { this.ownerDocument.activeElement = this; } blur() {}
  scrollIntoView() {}
  getContext(kind) { return kind === '2d' ? (this._ctx ??= canvasContext()) : null; }
  matches(sel) { return sel.split(',').some(s => matchChain(this, parse(s.trim()))); }
  closest(sel) { for (let el = this; el instanceof Element; el = el.parentNode) if (el.matches(sel)) return el; return null; }
  querySelectorAll(sel) { const out = []; const walk = n => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const parse = s => s.split(/\s+|\s*>\s*/).filter(Boolean).map(part => {
  const tag = part.match(/^[a-z][a-z0-9-]*/i)?.[0];
  return { tag, classes: [...part.matchAll(/\.([\w-]+)/g)].map(m => m[1]), ids: [...part.matchAll(/#([\w-]+)/g)].map(m => m[1]), attrs: [...part.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)].map(m => [m[1], m[2]]) };
});
const matchOne = (el, c) => (!c.tag || el.localName.toLowerCase() === c.tag.toLowerCase()) && c.classes.every(x => el.classList.contains(x)) && c.ids.every(x => el.id === x) && c.attrs.every(([k, v]) => v === undefined ? el.hasAttribute(k) : el.getAttribute(k) === v);
function matchChain(el, chain) {
  if (!matchOne(el, chain[chain.length - 1])) return false;
  let i = chain.length - 2;
  for (let p = el.parentNode; p instanceof Element && i >= 0; p = p.parentNode) if (matchOne(p, chain[i])) i--;
  return i < 0;
}
export function event(type, init = {}) { return { type, ...init, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; }, stopImmediatePropagation() { this._stop = true; this._immediate = true; } }; }
export function canvasContext() {
  const calls = [];
  return new Proxy({ calls, canvas: { width: 300, height: 150 } }, { get: (t, k) => k in t ? t[k] : (...args) => { calls.push([k, ...args]); return k === 'measureText' ? { width: 10 } : k === 'createRadialGradient' || k === 'createLinearGradient' ? { addColorStop: (...stop) => calls.push(['addColorStop', ...stop]) } : undefined; }, set: (t, k, v) => { t[k] = v; if (typeof v === 'string' || typeof v === 'number') calls.push([`=${String(k)}`, v]); return true; } });
}

/**
 * An event target with the DOM's listener identity (type, listener, capture): adding the same one twice is one
 * listener, and removing needs the same capture flag. `listeners` is { type: [{ fn, capture, once }] }.
 */
export function eventTarget(obj = {}) {
  const listeners = {};
  const capture = o => (typeof o === 'boolean' ? o : Boolean(o?.capture));
  obj.listeners = listeners;
  obj.addEventListener = (t, fn, o) => { if (!fn) return; const l = (listeners[t] ??= []); if (!l.some(x => x.fn === fn && x.capture === capture(o))) l.push({ fn, capture: capture(o), once: Boolean(o?.once) }); };
  obj.removeEventListener = (t, fn, o) => { listeners[t] = (listeners[t] || []).filter(x => !(x.fn === fn && x.capture === capture(o))); };
  /** Run this target's listeners for one phase ('capture', 'bubble' or 'target': all, in order). */
  obj.fire = (ev, phase = 'target') => {
    for (const x of [...(listeners[ev.type] || [])]) {
      if (phase === 'capture' && !x.capture || phase === 'bubble' && x.capture) continue;
      if (x.once) obj.removeEventListener(ev.type, x.fn, x.capture);
      ev.currentTarget = obj; (typeof x.fn === 'function' ? x.fn : x.fn.handleEvent.bind(x.fn))(ev);
      if (ev._immediate) break;
    }
  };
  obj.dispatchEvent = ev => { ev.target ??= obj; obj.fire(ev); return !ev.defaultPrevented; };
  return obj;
}

/** KeyboardEvent.code for a key value ('a' -> 'KeyA', 'Enter', ' ' -> 'Space', '1' -> 'Digit1'). */
export function keyCode(key) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return { ' ': 'Space', Esc: 'Escape', Shift: 'ShiftLeft', Control: 'ControlLeft', Alt: 'AltLeft', ',': 'Comma', '.': 'Period', '-': 'Minus', '=': 'Equal', '/': 'Slash' }[key] ?? key;
}

export function createDocument() {
  const win = eventTarget({});
  const doc = eventTarget({ defaultView: win, activeElement: null, hidden: false, visibilityState: 'visible' });
  win.document = doc;
  doc.createElement = tag => new Element(doc, tag);
  doc.createElementNS = (ns, tag) => new Element(doc, tag, ns);
  doc.createTextNode = text => new Text(doc, text);
  doc.head = doc.createElement('head'); doc.body = doc.createElement('body');
  doc.getElementById = id => doc.head.querySelector(`#${id}`) || doc.body.querySelector(`#${id}`);
  /**
   * Dispatch a key event the way a browser does: window and document capture listeners, the focused element and its
   * ancestors, then document and window bubble listeners. `code` is derived from `key` unless given. Returns the event.
   */
  doc.key = (key, init = {}, type = 'keydown') => {
    const ev = event(type, { key, code: keyCode(key), ...init });
    ev.target = doc.activeElement || doc.body;
    win.fire(ev, 'capture'); if (!ev._stop) doc.fire(ev, 'capture');
    if (!ev._stop) ev.target.dispatchEvent(ev);
    if (!ev._stop) doc.fire(ev, 'bubble'); if (!ev._stop) win.fire(ev, 'bubble');
    return ev;
  };
  doc.keyup = (key, init = {}) => doc.key(key, init, 'keyup');
  /** Hide or show the page (visibilitychange on document) and blur or focus the window. */
  doc.setHidden = hidden => { doc.hidden = hidden; doc.visibilityState = hidden ? 'hidden' : 'visible'; doc.dispatchEvent(event('visibilitychange')); win.dispatchEvent(event(hidden ? 'blur' : 'focus')); };
  return doc;
}

/**
 * Run a document in a fake browser host with player.js's view contract (v2/web/player.js): view.act queues actions
 * the next frame() applies; view.pause holds the world (a held frame steps only for a queued action, one step each);
 * view.restart / view.load restore; view.now is the display clock in ms; view.onDispose collects what dispose()
 * releases. Returns { rt, doc, container, acts, frame(n, input), tick(seconds), q, qa, text, key, dispose }.
 */
export function mount(gameDoc, { primitives, seed, before } = {}) {
  const doc = createDocument();
  globalThis.document = doc;
  const container = doc.createElement('div'); doc.body.append(container);
  const frames = [], pending = [], acts = [], disposers = [];
  let clock = 0, held = false, first = null, rt = null;
  const view = {
    container, THREE: null, input: null, now: () => clock,
    act: a => { acts.push(a); pending.push(a); },
    onFrame: fn => frames.push(fn),
    onDispose: fn => { if (typeof fn === 'function') disposers.push(fn); },
    pause: on => { held = Boolean(on); },
    get paused() { return held; },
    restart: () => { rt.restore(first); pending.length = 0; },
    load: snapshot => { rt.restore(snapshot); pending.length = 0; },
  };
  before?.(view);
  const compiled = compile(gameDoc, { primitives, seed, headless: false, view });
  rt = compiled.rt; first = rt.snapshot();
  const frame = (n = 1, input = {}) => {
    for (let i = 0; i < n; i++) {
      if (held) { if (pending.length) rt.step({ actions: pending.shift() }); }
      else { const live = view.input?.() || {}; rt.step({ ...live, ...input, actions: { ...(live.actions || {}), ...(input.actions || {}), ...(pending.shift() || {}) } }); }
      clock += 1000 / 60; rt.read(() => { for (const fn of frames) fn(1); });
    }
  };
  rt.read(() => { for (const fn of frames) fn(1); }); // first display frame, as player.js does (drawing is a read)
  const dispose = () => { for (const fn of disposers.splice(0).reverse()) fn(); container.replaceChildren(); };
  const q = s => container.querySelector(s), qa = s => container.querySelectorAll(s);
  return { rt, checked: compiled.checked, doc, view, tick: s => { clock += s * 1000; }, container, acts, frame, q, qa, text: s => q(s)?.textContent ?? null, key: (k, init) => doc.key(k, init), dispose };
}
