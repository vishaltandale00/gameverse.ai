// A tiny DOM stub for UI primitive tests (no dependencies): elements with
// attributes, classes, styles, text, events and a small selector engine, a
// recording 2D canvas context (calls in order with their arguments; style sets as ['=<prop>', value]), a window with keyboard dispatch, and a mount()
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
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); } removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
  dispatchEvent(ev) { ev.target ??= this; for (let el = this; el; el = el.parentNode) { ev.currentTarget = el; for (const fn of el.listeners?.[ev.type] || []) fn(ev); if (ev._stop) break; } return !ev.defaultPrevented; }
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
export function event(type, init = {}) { return { type, ...init, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; } }; }
export function canvasContext() {
  const calls = [];
  return new Proxy({ calls, canvas: { width: 300, height: 150 } }, { get: (t, k) => k in t ? t[k] : (...args) => { calls.push([k, ...args]); return k === 'measureText' ? { width: 10 } : k === 'createRadialGradient' || k === 'createLinearGradient' ? { addColorStop() {} } : undefined; }, set: (t, k, v) => { t[k] = v; if (typeof v === 'string' || typeof v === 'number') calls.push([`=${String(k)}`, v]); return true; } });
}

export function createDocument() {
  const listeners = {};
  const win = { addEventListener: (t, fn) => (listeners[t] ??= []).push(fn), removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); }, listeners };
  const doc = { defaultView: win, activeElement: null };
  doc.createElement = tag => new Element(doc, tag);
  doc.createElementNS = (ns, tag) => new Element(doc, tag, ns);
  doc.createTextNode = text => new Text(doc, text);
  doc.head = doc.createElement('head'); doc.body = doc.createElement('body');
  doc.getElementById = id => doc.head.querySelector(`#${id}`) || doc.body.querySelector(`#${id}`);
  /** Dispatch a keydown to window listeners (capture order). Returns the event. */
  doc.key = (key, init = {}) => { const ev = event('keydown', { key, ...init }); for (const fn of listeners.keydown || []) fn(ev); return ev; };
  return doc;
}

/**
 * Run a document in a fake browser host. Returns { rt, doc, container, acts, frame(n, input), q, qa, text, key }.
 * view.act queues actions that the next frame() applies, like the real host.
 */
export function mount(gameDoc, { primitives, seed, before } = {}) {
  const doc = createDocument();
  globalThis.document = doc;
  const container = doc.createElement('div'); doc.body.append(container);
  const frames = [], pending = [], acts = [];
  let clock = 0;
  const view = { container, THREE: null, act: a => { acts.push(a); pending.push(a); }, onFrame: fn => frames.push(fn), input: null, now: () => clock };
  before?.(view);
  const { rt, checked } = compile(gameDoc, { primitives, seed, headless: false, view });
  const frame = (n = 1, input = {}) => { for (let i = 0; i < n; i++) { const live = view.input?.() || {}; rt.step({ ...live, ...input, actions: { ...(live.actions || {}), ...(input.actions || {}), ...(pending.shift() || {}) } }); clock += 1 / 60; for (const fn of frames) fn(1); } };
  for (const fn of frames) fn(1); // first display frame, as player.js does
  const q = s => container.querySelector(s), qa = s => container.querySelectorAll(s);
  return { rt, checked, doc, view, tick: s => { clock += s; }, container, acts, frame, q, qa, text: s => q(s)?.textContent ?? null, key: (k, init) => doc.key(k, init) };
}
