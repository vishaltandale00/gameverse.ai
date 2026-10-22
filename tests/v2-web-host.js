// A fake browser for the real host (v2/web/player.js mountGame) over the DOM stub (tests/v2-p-ui-dom.js): window and
// document event targets, a display loop driven by hand (requestAnimationFrame), a display clock, and recorders for
// everything a mounted game can hold outside its container: listeners on window, document and the container, live
// timers and intervals, animation frames, AudioContexts and Workers. `held()` lists what is still held, so a test can
// assert that unloading a game releases all of it (ARCHITECTURE §1.7).
import { createDocument, event } from './v2-p-ui-dom.js';

/** Minimal WebAudio stand-in: any node, any param; counts contexts and closes. No sound. */
class FakeAudioContext {
  constructor() { FakeAudioContext.made.push(this); this.currentTime = 0; this.sampleRate = 4000; this.state = 'running'; this.destination = FakeAudioContext.node(); }
  static node(extra = {}) {
    const param = v => ({ value: v, setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(x) { this.value = x; }, cancelScheduledValues() {}, cancelAndHoldAtTime() {} });
    return new Proxy({ connect() {}, disconnect() {}, start() {}, stop() {}, ...extra }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? (t[k] = param(0)) : undefined) });
  }
  createGain() { return FakeAudioContext.node(); } createBiquadFilter() { return FakeAudioContext.node({ type: 'lowpass' }); }
  createDynamicsCompressor() { return FakeAudioContext.node(); } createOscillator() { return FakeAudioContext.node({ type: 'sine' }); }
  createBufferSource() { return FakeAudioContext.node(); } createStereoPanner() { return FakeAudioContext.node(); } createDelay() { return FakeAudioContext.node(); }
  createConvolver() { return FakeAudioContext.node(); } createWaveShaper() { return FakeAudioContext.node(); }
  createBuffer(ch, len) { const data = new Float32Array(len); return { getChannelData: () => data, length: len }; }
  resume() { this.state = 'running'; return Promise.resolve(); } suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
FakeAudioContext.made = [];

class FakeWorker {
  constructor(url) { FakeWorker.made.push(this); this.url = String(url); this.terminated = false; this.posted = []; }
  postMessage(m) { this.posted.push(m); } terminate() { this.terminated = true; }
  addEventListener() {} removeEventListener() {}
}
FakeWorker.made = [];

const listenerCount = target => Object.values(target.listeners || {}).reduce((n, l) => n + l.length, 0);
const describe = target => Object.entries(target.listeners || {}).flatMap(([type, l]) => l.map(x => `${type}${x.capture ? ' (capture)' : ''}`));

/**
 * Install the fake browser on globalThis. -> { doc, win, container, clock, frame(ms), key, keyup, focusGame, held(),
 * listeners(), restore() }. frame(ms) advances the clock and runs the pending animation frames once.
 */
export function installBrowser() {
  const saved = {};
  for (const k of ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'AudioContext', 'Worker', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const doc = createDocument(), win = doc.defaultView;
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = doc.createElement('div'); doc.body.append(container);
  const raf = new Map(); let rafId = 0;
  const timers = new Set(), intervals = new Set();
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
  const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  define('window', win); define('document', doc);
  define('requestAnimationFrame', fn => { const id = ++rafId; raf.set(id, fn); return id; });
  define('cancelAnimationFrame', id => { raf.delete(id); });
  define('AudioContext', FakeAudioContext); define('Worker', FakeWorker);
  define('setTimeout', (fn, ms, ...a) => { const t = real.setTimeout(() => { timers.delete(t); fn(...a); }, ms); timers.add(t); return t; });
  define('clearTimeout', t => { timers.delete(t); real.clearTimeout(t); });
  define('setInterval', (fn, ms, ...a) => { const t = real.setInterval(fn, ms, ...a); intervals.add(t); return t; });
  define('clearInterval', t => { intervals.delete(t); real.clearInterval(t); });
  FakeAudioContext.made.length = 0; FakeWorker.made.length = 0;
  const clock = { ms: 0 };
  const base = { window: listenerCount(win), document: listenerCount(doc), container: listenerCount(container) };
  return {
    doc, win, container, clock, now: () => clock.ms,
    /** Advance the display clock by `ms` and run the animation frames that were requested. */
    frame(ms = 1000 / 60) { clock.ms += ms; const list = [...raf.values()]; raf.clear(); for (const fn of list) fn(clock.ms); },
    key: (k, init) => doc.key(k, init), keyup: (k, init) => doc.keyup(k, init),
    focusGame() { container.focus(); },
    hide: hidden => doc.setHidden(hidden),
    /** Listener counts on window, document and the container (beyond what was there before any game). */
    listeners: () => ({ window: listenerCount(win) - base.window, document: listenerCount(doc) - base.document, container: listenerCount(container) - base.container }),
    /** Everything a game still holds outside the container: [] when nothing is left. */
    held() {
      const out = [];
      for (const [name, t] of [['window', win], ['document', doc], ['container', container]]) for (const d of describe(t)) out.push(`${name} listener ${d}`);
      if (raf.size) out.push(`${raf.size} animation frame(s)`);
      if (timers.size) out.push(`${timers.size} timer(s)`);
      if (intervals.size) out.push(`${intervals.size} interval(s)`);
      for (const c of FakeAudioContext.made) if (c.state !== 'closed') out.push('an open AudioContext');
      for (const w of FakeWorker.made) if (!w.terminated) out.push(`a running Worker (${w.url.slice(0, 40)})`);
      if (container.childNodes.length) out.push(`${container.childNodes.length} node(s) in the container`);
      return out;
    },
    audioContexts: () => FakeAudioContext.made.length, workers: () => FakeWorker.made,
    restore() {
      for (const t of timers) real.clearTimeout(t);
      for (const t of intervals) real.clearInterval(t);
      for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    },
  };
}

export { event };
