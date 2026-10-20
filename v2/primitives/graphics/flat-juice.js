// Default juice (POLISH.md 12-15): every flat renderer makes sure the game has
// particles (landing/jump/run dust, pickup sparkles, impact sparks, defeat
// debris) and feedback (shake, hit-stop, damage flash, popups) even when the
// document lists neither primitive. Installed on the first frame, after every
// graphics instance has had its turn, so explicit configs always win.
import { hubOf } from './flat-stage.js';
import particles, { installParticles } from './particles.js';
import feedback, { installFeedback } from './fx-feedback.js';

const defaults = card => Object.fromEntries(Object.entries(card.params).map(([k, p]) => [k, structuredClone(p.default)]));

export function ensureJuice(rt) {
  const H = hubOf(rt);
  if (H.juice) return;
  H.juice = true;
  let done = false;
  H.update(() => {
    if (done) return; done = true;
    const uses = new Set((rt.doc.graphics || []).map(g => g.use));
    if (!H.cfg.particles && !uses.has('graphics.particles')) installParticles(rt, defaults(particles.card));
    if (!H.cfg.feedback && !uses.has('graphics.fx.feedback')) installFeedback(rt, defaults(feedback.card));
  });
}
