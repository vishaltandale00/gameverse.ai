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
 *   paused           whether the simulation is held;
 *   restart()        back to the world's first state;  load(snapshot) restore a saved state;
 *   now()            presentation clock in ms (animation only; simulation never reads it);
 *   createRenderer   optional factory from the host (e.g. headless GL in tests); undefined in the studio.
 */
export function mountGame(container, record, { onState, primitives = null, now = () => performance.now(), createRenderer = undefined } = {}) {
  let cat = catalogueFor(record.doc, primitives);
  // Every game gets UI, audio and renderers: the document's graphics plus defaults chosen from its systems and spaces.
  const withGraphics = (d, registry) => { const doc = structuredClone(d); doc.graphics = withDefaultGraphics(doc, registry); return doc; };
  const doc = withGraphics(record.doc, cat.registry);
  const checked = preflight(doc, cat.registry, cat.logic);
  if (!checked.ok) throw Object.assign(Error('This version failed checks in the browser.'), { errors: checked.errors });
  container.replaceChildren();
  container.classList.add('gv-view'); // position: relative; renderers layer children, UI uses .gv-overlay
  let frames = [];
  const pending = [];
  // Input is applied on the next step even if the display loop is throttled.
  // input(): set by engine.input.actions -> { actions, axes: { move: [x, y], look: [x, y] }, held }.
  let paused = false, first = null, last = performance.now(), acc = 0, raf = 0, version = record.version, disposed = false;
  const makeView = () => ({
    container, THREE, input: null, now, createRenderer,
    act: actions => { pending.push(actions); queueMicrotask(() => tick(performance.now(), true)); },
    onFrame: fn => frames.push(fn),
    pause: on => { paused = Boolean(on); last = performance.now(); acc = 0; },
    get paused() { return paused; },
    restart: () => { if (first) rt.restore(first); pending.length = 0; acc = 0; },
    load: snapshot => { rt.restore(snapshot); pending.length = 0; acc = 0; },
  });
  let view = makeView();
  let rt = createWorld(checked.doc, cat.registry, cat.logic, { headless: false, view });
  first = rt.snapshot();
  function tick(nowMs, force = false) {
    if (disposed) return;
    if (paused) {
      // Held: only UI actions advance the world, one step each.
      while (pending.length) rt.step({ actions: pending.shift() });
      last = nowMs; acc = 0;
    } else {
      acc = Math.min(acc + (nowMs - last) / 1000, 0.25); last = nowMs;
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
      container.replaceChildren(); frames = []; view = makeView();
      cat = nextCat;
      rt = createWorld(ok.doc, cat.registry, cat.logic, { headless: false, view });
      first = rt.snapshot();
      try { rt.restore({ ...state, docId: ok.doc.id }); } catch { /* incompatible state: start fresh */ }
      version = next.version; return true;
    },
    dispose() { disposed = true; cancelAnimationFrame(raf); for (const b of cat.boxes) b.dispose?.(); container.replaceChildren(); },
  };
}
