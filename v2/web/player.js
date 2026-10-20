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
import * as THREE from '/runtime/three/three.module.js';
import { experimentPrimitives } from '/v2/experiments/primitive-host.js';
import { createWorkerBox } from '/v2/experiments/primitive-runtime.js';

const DEFAULT_GRAPHICS = { 'engine.space.graph': [{ use: 'graphics.ui.story' }] };

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

export function mountGame(container, record, { onState, primitives = null } = {}) {
  let cat = catalogueFor(record.doc, primitives);
  const withGraphics = d => { const doc = structuredClone(d); if (!doc.graphics?.length) doc.graphics = doc.spaces.flatMap(s => DEFAULT_GRAPHICS[s.use] || []); return doc; };
  const doc = withGraphics(record.doc);
  // Every game gets a renderer: use the document's graphics, else defaults for its spaces.
  const checked = preflight(doc, cat.registry, cat.logic);
  if (!checked.ok) throw Object.assign(Error('This version failed checks in the browser.'), { errors: checked.errors });
  container.replaceChildren();
  container.classList.add('gv-view'); // position: relative; renderers layer children, UI uses .gv-overlay
  let frames = [];
  const pending = [];
  // Input is applied on the next step even if the display loop is throttled.
  // input(): set by engine.input.actions -> { actions, axes: { move: [x, y], look: [x, y] }, held }.
  const makeView = () => ({ container, THREE, act: actions => { pending.push(actions); queueMicrotask(() => tick(performance.now(), true)); }, onFrame: fn => frames.push(fn), input: null });
  let view = makeView();
  let rt = createWorld(checked.doc, cat.registry, cat.logic, { headless: false, view });
  let last = performance.now(), acc = 0, raf = 0, version = record.version, disposed = false;
  function tick(now, force = false) {
    if (disposed) return;
    acc = Math.min(acc + (now - last) / 1000, 0.25); last = now;
    if (force && acc < DT) acc = DT;
    while (acc >= DT) {
      const live = view.input?.() || {};
      rt.step({ ...live, actions: { ...(live.actions || {}), ...(pending.shift() || {}) } }); acc -= DT;
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
      const nextDoc = withGraphics(next.doc);
      const changedExperiments = JSON.stringify(next.doc.experiments || []) !== JSON.stringify(rt.doc.experiments || []);
      if (added && !changedExperiments) {
        const ok = preflight(nextDoc, cat.registry, cat.logic);
        if (!ok.ok) return false;
        rt.extend(ok.doc, added || mergePatch(rt.doc, {}).added);
        version = next.version; return true;
      }
      // Rebuild: new params or primitives apply on install, so install again and carry the state over.
      const nextCat = changedExperiments ? catalogueFor(next.doc, primitives) : cat;
      const ok = preflight(nextDoc, nextCat.registry, nextCat.logic);
      if (!ok.ok) return false;
      const state = rt.snapshot();
      for (const b of cat.boxes) if (nextCat !== cat) b.dispose?.();
      container.replaceChildren(); frames = []; view = makeView();
      cat = nextCat;
      rt = createWorld(ok.doc, cat.registry, cat.logic, { headless: false, view });
      try { rt.restore({ ...state, docId: ok.doc.id }); } catch { /* incompatible state: start fresh */ }
      version = next.version; return true;
    },
    dispose() { disposed = true; cancelAnimationFrame(raf); for (const b of cat.boxes) b.dispose?.(); container.replaceChildren(); },
  };
}
