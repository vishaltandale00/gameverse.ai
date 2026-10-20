// Browser host for v2 games: preflight a published version, run the world at
// a fixed 60 Hz with graphics primitives mounted into a container, and
// hot-load newer versions of the same game while it is being played.
import { catalogue } from '/v2/primitives/index.js';
import { preflight, mergePatch } from '/v2/kernel/document.js';
import { createWorld, DT } from '/v2/kernel/world.js';
import * as THREE from '/runtime/three/three.module.js';

const DEFAULT_GRAPHICS = { 'engine.space.graph': [{ use: 'graphics.ui.story' }] };

export function mountGame(container, record, { onState } = {}) {
  const { registry, logic } = catalogue();
  const doc = structuredClone(record.doc);
  // Every game gets a renderer: use the document's graphics, else defaults for its spaces.
  if (!doc.graphics?.length) doc.graphics = doc.spaces.flatMap(s => DEFAULT_GRAPHICS[s.use] || []);
  const checked = preflight(doc, registry, logic);
  if (!checked.ok) throw Object.assign(Error('This version failed checks in the browser.'), { errors: checked.errors });
  container.replaceChildren();
  container.classList.add('gv-view'); // position: relative; renderers layer children, UI uses .gv-overlay
  const frames = [], pending = [];
  // Input is applied on the next step even if the display loop is throttled.
  // input(): set by engine.input.actions -> { actions, axes: { move: [x, y], look: [x, y] }, held }.
  const view = { container, THREE, act: actions => { pending.push(actions); queueMicrotask(() => tick(performance.now(), true)); }, onFrame: fn => frames.push(fn), input: null };
  const rt = createWorld(checked.doc, registry, logic, { headless: false, view });
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
    rt, get version() { return version; },
    /** Hot-load a newer version's additions without restarting. */
    update(next) {
      if (next.version <= version) return false;
      const added = next.report?.added;
      const nextDoc = structuredClone(next.doc);
      if (!nextDoc.graphics?.length) nextDoc.graphics = doc.graphics;
      const ok = preflight(nextDoc, registry, logic);
      if (!ok.ok) return false;
      rt.extend(ok.doc, added || mergePatch(rt.doc, {}).added);
      version = next.version; return true;
    },
    dispose() { disposed = true; cancelAnimationFrame(raf); container.replaceChildren(); },
  };
}
