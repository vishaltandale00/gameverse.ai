// Browser host for v2 games: preflight a published version, run the world at
// a fixed 60 Hz with graphics primitives mounted into a container, and
// hot-load newer versions of the same game while it is being played.
// - Additive versions (detail patches: report.added) extend the running world (rt.extend).
// - Other versions (tweaks, revisions, experiments) rebuild the world from the new
//   document and restore the running state into it, so play continues where it was.
// Experiment primitives a document carries run in sandboxed Workers (v2/experiments).
import { catalogue, PRIMITIVES } from '/v2/primitives/index.js';
import { preflight, mergePatch } from '/v2/kernel/document.js';
import { createWorld, DT } from '/v2/kernel/world.js';
import { experimentPrimitives } from '/v2/experiments/primitive-host.js';
import { createWorkerBox } from '/v2/experiments/primitive-runtime.js';
import { withDefaultGraphics } from '/v2/primitives/graphics/ui-defaults.js';
import { keyName, expand } from '/v2/primitives/engine/runtime-lib-input.js';
import { withDefaultInput } from '/v2/web/input-defaults.js';

const TOUCH = typeof window !== 'undefined' && ('ontouchstart' in window || window.matchMedia?.('(pointer: coarse)').matches);

// three.js is optional for the host: DOM and canvas renderers work without it (view.THREE is then null).
const THREE = await import('/runtime/three/three.module.js').catch(() => null);

let promoted = null;
/** Primitives promoted by the improvement loop, when that index exists (loaded once). */
export async function loadPromoted() {
  if (promoted) return promoted;
  try { promoted = (await import('/v2/primitives/promoted/index.js')).default || []; } catch { promoted = []; }
  return promoted;
}

function catalogueFor(doc, extra) {
  const boxes = [];
  const exp = experimentPrimitives(doc, code => { const b = createWorkerBox(code); boxes.push(b); return b; });
  const ids = new Set(PRIMITIVES.map(p => p.id));
  const { registry, logic } = catalogue([...(extra || promoted || []), ...exp].filter(p => !ids.has(p.id) && (ids.add(p.id), true)));
  return { registry, logic, boxes };
}

/**
 * The view a mounted game's graphics primitives receive (KERNEL_API.md §6, plus host additions):
 *   container, THREE (null when three.js is unavailable), act(actions), onFrame(fn(alpha)), input (set by engine.input.*),
 *   pause(on)        hold the simulation; actions sent with act() still apply, one step each (menus, inventory, title);
 *   paused           whether the simulation is held (by the game's UI, or by the host while the window is unfocused);
 *   setTimeScale(s)  wall-clock pacing of the fixed steps, s in [0, 1] (hit-stop, slow motion); 0 holds, inputs still queue;
 *   restart()        back to the world's first state;  load(snapshot) restore a saved state;
 *   now()            presentation clock in ms (animation only; simulation never reads it);
 *   createRenderer   optional factory from the host (e.g. headless GL in tests); undefined in the studio.
 */
export function mountGame(container, record, { onState, primitives = null, now = () => performance.now(), createRenderer = undefined } = {}) {
  let cat = catalogueFor(record.doc, primitives);
  // Every game gets input, UI, audio and renderers: the document's own plus defaults chosen from its systems, spaces and view.
  const withGraphics = (d, registry) => { const doc = structuredClone(d); doc.systems = withDefaultInput(doc, registry, { touch: TOUCH }); doc.graphics = withDefaultGraphics(doc, registry); return doc; };
  let doc = withGraphics(record.doc, cat.registry);
  let checked = preflight(doc, cat.registry, cat.logic);
  // Presentation never blocks play: drop graphics instances that fail checks and fall back to the defaults.
  const badGraphics = new Set((checked.errors || []).map(e => /^graphics\[(\d+)\]/.exec(e.path || '')?.[1]).filter(Boolean).map(Number));
  if (!checked.ok && badGraphics.size && checked.errors.every(e => /^graphics\[\d+\]/.test(e.path || ''))) {
    const listed = record.doc.graphics || [];
    const keep = listed.filter((g, i) => !badGraphics.has(i) || i >= listed.length);
    console.warn('Dropped graphics that failed checks:', checked.errors);
    doc = withGraphics({ ...record.doc, graphics: keep }, cat.registry);
    checked = preflight(doc, cat.registry, cat.logic);
  }
  if (!checked.ok) throw Object.assign(Error('This version failed checks in the browser.'), { errors: checked.errors });
  container.replaceChildren();
  container.classList.add('gv-view'); // position: relative; renderers layer children, UI uses .gv-overlay
  let frames = [];
  const pending = [];
  // Input is applied on the next step even if the display loop is throttled.
  // input(): set by engine.input.actions -> { actions, axes: { move: [x, y], look: [x, y] }, held }.
  // uiPaused: view.pause() from the game's UI; away: the window lost focus (the host holds the game until it returns).
  let uiPaused = false, away = false, timeScale = 1, first = null, last = performance.now(), acc = 0, raf = 0, version = record.version, disposed = false;
  const held = () => uiPaused || away;
  // Everything a mounted game holds outside its container (window listeners, audio, GL, workers) is
  // released through view.onDispose when the game is unloaded or rebuilt.
  let disposers = [];
  const release = () => { const list = disposers; disposers = []; for (const fn of list.reverse()) try { fn(); } catch (error) { console.warn('dispose failed', error); } };
  const makeView = () => ({
    container, THREE, input: null, now, createRenderer,
    onDispose: fn => { if (typeof fn === 'function') disposers.push(fn); },
    act: actions => { pending.push(actions); queueMicrotask(() => tick(performance.now(), true)); },
    onFrame: fn => frames.push(fn),
    pause: on => { uiPaused = Boolean(on); last = performance.now(); acc = 0; },
    get paused() { return held(); },
    setTimeScale: s => { const v = Number(s); timeScale = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1; },
    restart: () => { if (first) rt.restore(first); pending.length = 0; acc = 0; },
    load: snapshot => { rt.restore(snapshot); pending.length = 0; acc = 0; },
  });
  let view = makeView();
  let rt = createWorld(checked.doc, cat.registry, cat.logic, { headless: false, view });
  first = rt.snapshot();
  function tick(nowMs, force = false) {
    if (disposed) return;
    if (held()) {
      // Held: only UI actions advance the world, one step each.
      while (pending.length) rt.step({ actions: pending.shift() });
      last = nowMs; acc = 0;
    } else {
      acc = Math.min(acc + ((nowMs - last) / 1000) * timeScale, 0.25); last = nowMs;
      if (force && acc < DT) acc = DT;
      while (acc >= DT) {
        const live = view.input?.() || {};
        rt.step({ ...live, actions: { ...(live.actions || {}), ...(pending.shift() || {}) } }); acc -= DT;
      }
    }
    for (const fn of frames) fn(acc / DT);
    onState?.(rt.state);
  }
  const loop = now => { tick(now); if (!disposed) raf = requestAnimationFrame(loop); };
  const detachHost = attachHost(container, () => rt, on => { away = on; last = performance.now(); acc = 0; });
  tick(performance.now(), true); // first frame without waiting for the display loop
  raf = requestAnimationFrame(loop);
  return {
    get rt() { return rt; }, get version() { return version; },
    /** Hot-load a newer version without restarting: extend for additive versions, rebuild-and-restore otherwise. */
    update(next) {
      if (next.version <= version) return false;
      const added = next.report?.added;
      const nextDoc = withGraphics(next.doc, cat.registry);
      const changedExperiments = JSON.stringify(next.doc.experiments || []) !== JSON.stringify(rt.doc.experiments || []);
      if (added && !changedExperiments) {
        const ok = preflight(nextDoc, cat.registry, cat.logic);
        if (!ok.ok) return false;
        rt.extend(ok.doc, added || mergePatch(rt.doc, {}).added);
        version = next.version; return true;
      }
      // Rebuild: new params or primitives apply on install, so install again and carry the state over.
      const nextCat = changedExperiments ? catalogueFor(next.doc, primitives) : cat;
      const rebuilt = withGraphics(next.doc, nextCat.registry);
      const ok = preflight(rebuilt, nextCat.registry, nextCat.logic);
      if (!ok.ok) return false;
      const state = rt.snapshot();
      for (const b of cat.boxes) if (nextCat !== cat) b.dispose?.();
      release(); container.replaceChildren(); frames = []; view = makeView();
      cat = nextCat;
      rt = createWorld(ok.doc, cat.registry, cat.logic, { headless: false, view });
      first = rt.snapshot();
      try { rt.restore({ ...state, docId: ok.doc.id }); } catch { /* incompatible state: start fresh */ }
      version = next.version; return true;
    },
    dispose() { if (disposed) return; disposed = true; cancelAnimationFrame(raf); release(); detachHost(); for (const b of cat.boxes) b.dispose?.(); container.replaceChildren(); },
  };
}

/**
 * Page-level host behaviour around a mounted game:
 * - the game container is focusable and takes focus on mount and on pointer down, so keys go to the game
 *   rather than a studio text box that had focus;
 * - while focus is inside the game, keys bound to the game's verbs (engine.input.actions) have their default
 *   action prevented, so they neither scroll the page nor type into or trigger page controls;
 * - the simulation is held while the window is blurred or the page hidden, and resumes when it returns.
 */
function attachHost(container, getRt, setAway) {
  if (typeof window === 'undefined') return () => {};
  if (!container.hasAttribute?.('tabindex')) container.tabIndex = 0;
  const focusGame = () => { if (!container.contains(document.activeElement)) container.focus?.({ preventScroll: true }); };
  const typing = el => /^(input|textarea|select)$/i.test(el?.tagName || '') || el?.isContentEditable;
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
  const listeners = [[container, 'keydown', onKey], [container, 'keyup', onKey], [container, 'pointerdown', focusGame], [window, 'blur', away], [window, 'focus', back], [document, 'visibilitychange', onVisibility]];
  for (const [t, name, fn] of listeners) t.addEventListener(name, fn);
  queueMicrotask(focusGame);
  return () => { for (const [t, name, fn] of listeners) t.removeEventListener(name, fn); };
}
