// Browser host for v2 games: preflight a published version, run the world at
// a fixed 60 Hz with graphics primitives mounted into a container, and
// hot-load newer versions of the same game while it is being played.
// - Additive versions (detail patches: report.added) extend the running world (rt.extend).
// - Other versions (tweaks, revisions, experiments) build a world from the new document and start it from its
//   first state: a version is checked like a new game from its start (ARCHITECTURE §4), so the state of another
//   version is never carried into it and a revised start (lives, seed counts) applies at once. The running world is
//   replaced only once the new one is built.
// Experiment primitives a document carries run in sandboxed Workers (v2/experiments).
//
// Each world the host runs is a session: its runtime, its view, the per-frame draws its graphics
// registered, and everything it holds outside the container (view.onDispose: window and document
// listeners, timers, audio, GL, workers). Unloading, a failed mount or a failed hot-load releases
// exactly that session (ARCHITECTURE §1.7: nothing keeps running behind the game on screen).
import { catalogue, PRIMITIVES } from '../primitives/index.js';
import { preflight } from '../kernel/document.js';
import { createWorld, DT } from '../kernel/world.js';
import { experimentPrimitives } from '../experiments/primitive-host.js';
import { createWorkerBox } from '../experiments/primitive-runtime.js';
import { keyName, expand } from '../primitives/engine/runtime-lib-input.js';
import { hostDocument } from './host-doc.js';

const touchDevice = () => typeof window !== 'undefined' && ('ontouchstart' in window || Boolean(window.matchMedia?.('(pointer: coarse)').matches));

// three.js is optional for the host: DOM and canvas renderers work without it (view.THREE is then null).
const THREE = await import('/runtime/three/three.module.js').catch(() => null);

let promoted = null;
/** Primitives promoted by the improvement loop, when that index exists (loaded once). */
export async function loadPromoted() {
  if (promoted) return promoted;
  try { promoted = (await import('../primitives/promoted/index.js')).default || []; } catch { promoted = []; }
  return promoted;
}

/** The catalogue a document runs on: the built-in primitives, promoted ones, and the document's experiments. */
function catalogueFor(doc, extra) {
  const exp = experimentPrimitives(doc, code => createWorkerBox(code));
  const ids = new Set(PRIMITIVES.map(p => p.id));
  return catalogue([...(extra || promoted || []), ...exp].filter(p => !ids.has(p.id) && (ids.add(p.id), true)));
}

/**
 * The view a mounted game's graphics primitives receive (KERNEL_API.md §6, plus host additions):
 *   container, THREE (null when three.js is unavailable), act(actions), onFrame(fn(alpha)), input (set by engine.input.*),
 *   onDispose(fn)    release something held outside the container when this world is unloaded or replaced;
 *   pause(on)        hold the simulation; actions sent with act() still apply, one step each (menus, inventory, title);
 *   paused           whether the simulation is held (by the game's UI, or by the host while the window is unfocused);
 *   setTimeScale(s)  wall-clock pacing of the fixed steps, s in [0, 1] (hit-stop, slow motion); 0 holds, inputs still queue;
 *   restart()        back to the world's first state;  load(snapshot) restore a saved state;
 *   continuing       true for a world built by a hot-load to carry on a game in play (no title screen);
 *   now()            the host's display clock in ms (presentation; simulation never reads it);
 *   createRenderer   optional factory from the host (e.g. headless GL in tests); undefined in the studio.
 * Options: onState(state) after every display frame; primitives (instead of the promoted ones); now (the clock the
 * host paces steps and presentation by, ms); createRenderer; seed (the world seed; the document's when omitted).
 */
export function mountGame(container, record, { onState, primitives = null, now = () => performance.now(), createRenderer = undefined, seed = undefined } = {}) {
  const touch = touchDevice();
  // Every game gets input, UI, audio and renderers: the document's own plus defaults chosen from its systems, spaces and view.
  const hosted = (d, registry) => hostDocument(d, registry, { touch });
  const pending = [];
  // Input is applied on the next step even if the display loop is throttled.
  // away: the window lost focus (the host holds the game until it returns); a session's paused: its UI holds it.
  let away = false, timeScale = 1, last = now(), acc = 0, raf = 0, version = record.version, disposed = false;
  /** @type {any} */ let cur = null;
  const held = () => Boolean(cur?.paused) || away;
  const reset = () => { last = now(); acc = 0; };

  /** Build a world for a preflighted document on a catalogue; on failure everything it installed is released. */
  function session(cat, doc, { continuing = false } = {}) {
    const s = { cat, frames: [], disposers: [], nodes: [], rt: null, first: null, paused: false, view: null };
    const live = () => s === cur && !disposed;
    s.view = {
      container, THREE, input: null, now, createRenderer, continuing,
      onDispose: fn => { if (typeof fn === 'function') s.disposers.push(fn); },
      act: actions => { if (!live()) return; pending.push(actions); queueMicrotask(() => tick(now(), true)); },
      onFrame: fn => s.frames.push(fn),
      pause: on => { s.paused = Boolean(on); if (live()) reset(); },
      get paused() { return s === cur ? held() : s.paused; },
      setTimeScale: v => { if (!live()) return; const n = Number(v); timeScale = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1; },
      restart: () => { if (!live()) return; s.rt.restore(s.first); pending.length = 0; acc = 0; },
      load: snapshot => { if (!live()) return; s.rt.restore(snapshot); pending.length = 0; acc = 0; },
    };
    const before = new Set(container.childNodes);
    try {
      s.rt = createWorld(doc, cat.registry, cat.logic, { seed, headless: false, view: s.view });
      s.first = s.rt.snapshot();
    } catch (error) { close(s); throw error; }
    s.nodes = [...container.childNodes].filter(n => !before.has(n));
    return s;
  }
  /** Release what a session holds outside the container, and take its nodes out of the container. */
  function close(s) {
    const list = s.disposers.splice(0);
    for (const fn of list.reverse()) try { fn(); } catch (error) { console.warn('dispose failed', error); }
    for (const n of s.nodes) n.remove?.();
    s.frames.length = 0;
  }

  function tick(nowMs, force = false) {
    if (disposed) return;
    const { rt, view } = cur;
    if (held()) {
      // Held: only UI actions advance the world, one step each.
      while (pending.length) rt.step({ actions: pending.shift() });
      last = nowMs; acc = 0;
    } else {
      acc = Math.min(acc + ((nowMs - last) / 1000) * timeScale, 0.25); last = nowMs;
      if (force && acc < DT) acc = DT;
      while (acc >= DT) {
        const input = view.input?.() || {};
        rt.step({ ...input, actions: { ...(input.actions || {}), ...(pending.shift() || {}) } }); acc -= DT;
      }
    }
    // Drawing is a read: graphics never change the state (rt.read keeps their service reads from creating any).
    const alpha = acc / DT;
    rt.read(() => { for (const fn of cur.frames) fn(alpha); onState?.(rt.state); });
  }
  const loop = () => { if (disposed) return; tick(now()); if (!disposed) raf = requestAnimationFrame(loop); };

  let detachHost = () => {};
  try {
    const cat = catalogueFor(record.doc, primitives);
    const checked = preflight(hosted(record.doc, cat.registry), cat.registry, cat.logic);
    if (!checked.ok) throw Object.assign(Error('This version failed checks in the browser.'), { errors: checked.errors });
    container.replaceChildren();
    container.classList.add('gv-view'); // position: relative; renderers layer children, UI uses .gv-overlay
    cur = session(cat, checked.doc);
    detachHost = attachHost(container, () => cur?.rt, on => { away = on; reset(); });
    reset();
    tick(now(), true); // first frame without waiting for the display loop
    raf = requestAnimationFrame(loop);
  } catch (error) {
    disposed = true; detachHost(); if (cur) close(cur); cur = null; container.replaceChildren();
    throw error;
  }

  return {
    get rt() { return cur?.rt ?? null; }, get version() { return version; },
    /**
     * Load a newer version: extend the running world for additive versions ('extended'); otherwise build the new world
     * from its own first state and only then replace the running one ('restarted'). Returns false (the running game is
     * untouched) when the version is not newer, fails checks, or its world cannot be built.
     */
    update(next) {
      if (disposed || !(next.version > version)) return false;
      const added = next.report?.added;
      const changedExperiments = JSON.stringify(next.doc.experiments || []) !== JSON.stringify(cur.rt.doc.experiments || []);
      if (added && !changedExperiments) {
        const ok = preflight(hosted(next.doc, cur.cat.registry), cur.cat.registry, cur.cat.logic);
        if (!ok.ok) return false;
        try { cur.rt.extend(ok.doc, added); } catch (error) { console.warn('hot-load extend failed', error); return false; }
        version = next.version; return 'extended';
      }
      // Rebuild: the new version's params and primitives apply on install, from its own first state.
      const cat = changedExperiments ? catalogueFor(next.doc, primitives) : cur.cat;
      const ok = preflight(hosted(next.doc, cat.registry), cat.registry, cat.logic);
      if (!ok.ok) return false;
      let s;
      try { s = session(cat, ok.doc, { continuing: true }); } catch (error) { console.warn('hot-load build failed', error); return false; }
      const old = cur;
      cur = s; pending.length = 0; reset();
      close(old);
      for (const n of [...container.childNodes]) if (!s.nodes.includes(n)) n.remove();
      version = next.version; return 'restarted';
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(raf); pending.length = 0;
      close(cur); detachHost(); container.replaceChildren(); cur = null;
    },
  };
}

/**
 * Page-level host behaviour around a mounted game:
 * - the game container is focusable and takes focus on mount (unless the person is typing in a text field) and on
 *   pointer down, so keys go to the game rather than a studio control that had focus;
 * - while focus is inside the game, keys bound to the game's verbs (engine.input.actions) have their default
 *   action prevented, so they neither scroll the page nor type into or trigger page controls;
 * - the simulation is held while the window is blurred or the page hidden, and resumes when it returns.
 */
function attachHost(container, getRt, setAway) {
  if (typeof window === 'undefined') return () => {};
  if (!container.hasAttribute?.('tabindex')) container.tabIndex = 0;
  const typing = el => /^(input|textarea|select)$/i.test(el?.tagName || '') || Boolean(el?.isContentEditable);
  const focusGame = () => { if (!container.contains(document.activeElement)) container.focus?.({ preventScroll: true }); };
  const boundKeys = () => {
    const rt = getRt();
    if (!rt?.hasService?.('input')) return null;
    const keys = new Set();
    for (const list of Object.values(rt.service('input').bindings?.() || {})) for (const k of list) for (const x of expand(k) || []) keys.add(x);
    return keys;
  };
  const onKey = ev => {
    if (ev.metaKey || ev.ctrlKey || typing(ev.target)) return;
    const k = keyName(ev.code);
    if (k && boundKeys()?.has(k)) ev.preventDefault();
  };
  const away = () => setAway(true);
  const back = () => { if (!document.hidden) setAway(false); };
  const onVisibility = () => (document.hidden ? away() : back());
  let attached = true;
  const listeners = [[container, 'keydown', onKey], [container, 'keyup', onKey], [container, 'pointerdown', focusGame], [window, 'blur', away], [window, 'focus', back], [document, 'visibilitychange', onVisibility]];
  for (const [t, name, fn] of listeners) t.addEventListener(name, fn);
  queueMicrotask(() => { if (attached && !typing(document.activeElement)) focusGame(); });
  if (document.hidden) away();
  return () => { attached = false; for (const [t, name, fn] of listeners) t.removeEventListener(name, fn); };
}
