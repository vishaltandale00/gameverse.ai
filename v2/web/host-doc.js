// The document a person plays: the published document plus the host's defaults, the input mapping
// (input-defaults.js: every verb the loops declare gets a binding) and the presentation (graphics/ui-defaults.js:
// renderers, camera, the UI primitives that issue the verbs keys cannot). The browser host (player.js) mounts it, and
// the publish gate and the headless input driver (v2/verify/controls.js) verify and play it: one function, so what is
// checked is what is mounted.
import { withDefaultInput } from './input-defaults.js';
import { withDefaultGraphics } from '../primitives/graphics/ui-defaults.js';

/**
 * @param {any} doc a game document (not mutated) @param {any} registry the primitive registry
 * @param {{ touch?: boolean }} [opts] touch: the host is a touch device
 * @returns {any} the document with the host's default input and graphics added
 */
export function hostDocument(doc, registry, { touch = false } = {}) {
  const d = structuredClone(doc);
  d.systems = withDefaultInput(d, registry, { touch });
  d.graphics = withDefaultGraphics(d, registry);
  return d;
}
