// Minimal v2 host: load a spec, preflight, compose, play and playtest.
import { defaultRegistry } from '/v2/modules/index.js';
import { preflight } from '/v2/engine/spec.js';
import { compose, DT } from '/v2/engine/compose.js';
import { createRenderer } from '/v2/engine/render2d.js';
import { playtest } from '/v2/engine/playtest.js';

const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status'), reportEl = document.getElementById('report');
const registry = defaultRegistry();
const keys = new Set();
addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault(); keys.add(e.code); });
addEventListener('keyup', e => keys.delete(e.code));
const input = () => {
  const pad = [...(navigator.getGamepads?.() || [])].find(p => p?.connected);
  const ax = pad ? (Math.abs(pad.axes[0]) > 0.3 ? pad.axes[0] : 0) : 0, ay = pad ? (Math.abs(pad.axes[1]) > 0.3 ? pad.axes[1] : 0) : 0;
  const k = c => keys.has(c);
  return {
    x: (k('ArrowRight') || k('KeyD') || pad?.buttons[15]?.pressed ? 1 : 0) - (k('ArrowLeft') || k('KeyA') || pad?.buttons[14]?.pressed ? 1 : 0) || Math.sign(ax),
    y: (k('ArrowDown') || k('KeyS') || pad?.buttons[13]?.pressed ? 1 : 0) - (k('ArrowUp') || k('KeyW') || pad?.buttons[12]?.pressed ? 1 : 0) || Math.sign(ay),
    a: k('Space') || k('KeyZ') || !!pad?.buttons[0]?.pressed, b: k('KeyX') || !!pad?.buttons[2]?.pressed,
  };
};

export async function load(spec) {
  const t0 = performance.now();
  const checked = preflight(spec, registry);
  if (!checked.ok) { statusEl.textContent = `Spec has ${checked.errors.length} problem(s)`; reportEl.textContent = JSON.stringify(checked.errors, null, 2); return; }
  const game = compose(checked.spec, registry), render = createRenderer(game);
  let state = game.createState();
  statusEl.textContent = `${checked.spec.title} · ready in ${(performance.now() - t0).toFixed(1)} ms`;
  // Playtest off the main loop's critical path; a worker is the next step.
  setTimeout(() => { const r = playtest(game, { budgetMs: 800 }); reportEl.textContent = JSON.stringify({ ok: r.ok, winnable: r.winnable, winSeconds: r.win?.seconds, explored: r.explored, wallMs: r.wallMs, speedup: r.speedup, issues: r.issues }, null, 2); }, 50);
  let last = performance.now(), acc = 0;
  const frame = now => {
    acc = Math.min(acc + (now - last) / 1000, 0.25); last = now;
    const i = input();
    if (state.status !== 'playing' && (i.a || keys.has('KeyR'))) { state = game.createState(); keys.delete('KeyR'); }
    else if (keys.has('KeyR')) { state = game.createState(); keys.delete('KeyR'); }
    while (acc >= DT) { game.step(state, i); acc -= DT; }
    const rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, state, { cssWidth: rect.width, cssHeight: rect.height });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  canvas.focus();
}

const name = new URLSearchParams(location.search).get('example') || 'coin-cavern';
fetch(`/v2/examples/${name}.json`).then(r => r.json()).then(load).catch(e => { statusEl.textContent = 'Could not load the example: ' + e.message; });
