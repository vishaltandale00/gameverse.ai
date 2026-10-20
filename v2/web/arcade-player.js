// Canvas host for generated 2D games (gameverse.v2.game-spec/0.1): fixed
// 60 Hz simulation, keyboard + gamepad input, follow camera, restart.
import { defaultRegistry } from '/v2/modules/index.js';
import { preflight } from '/v2/engine/spec.js';
import { compose, DT } from '/v2/engine/compose.js';
import { createRenderer } from '/v2/engine/render2d.js';

const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyZ', 'KeyX', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyR', 'KeyJ', 'KeyK']);

export function mountArcade(container, record) {
  const registry = defaultRegistry();
  const checked = preflight(record.doc, registry);
  if (!checked.ok) throw Object.assign(Error('This game failed checks in the browser.'), { errors: checked.errors });
  let game = compose(checked.spec, registry), render = createRenderer(game);
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `<canvas class="arcade" tabindex="0" aria-label="${checked.spec.title}"></canvas>
    <p class="arcade-help">Move: arrows or WASD · Jump/A: Space or Z · Fire/B: X or K · Restart: R · Gamepad supported</p>`);
  const canvas = container.querySelector('canvas'), ctx = canvas.getContext('2d');
  const keys = new Set();
  const down = e => { if (!KEYS.has(e.code)) return; if (document.activeElement === canvas || document.activeElement === document.body) { e.preventDefault(); keys.add(e.code); } };
  const up = e => keys.delete(e.code);
  addEventListener('keydown', down); addEventListener('keyup', up);
  const input = () => {
    const pad = [...(navigator.getGamepads?.() || [])].find(p => p?.connected);
    const k = c => keys.has(c), axis = i => (pad && Math.abs(pad.axes[i]) > 0.3 ? Math.sign(pad.axes[i]) : 0);
    return {
      x: ((k('ArrowRight') || k('KeyD') || pad?.buttons[15]?.pressed) ? 1 : 0) - ((k('ArrowLeft') || k('KeyA') || pad?.buttons[14]?.pressed) ? 1 : 0) || axis(0),
      y: ((k('ArrowDown') || k('KeyS') || pad?.buttons[13]?.pressed) ? 1 : 0) - ((k('ArrowUp') || k('KeyW') || pad?.buttons[12]?.pressed) ? 1 : 0) || axis(1),
      a: k('Space') || k('KeyZ') || k('KeyJ') || !!pad?.buttons[0]?.pressed,
      b: k('KeyX') || k('KeyK') || !!pad?.buttons[2]?.pressed,
    };
  };
  let state = game.createState(), last = performance.now(), acc = 0, raf = 0, disposed = false;
  const frame = now => {
    if (disposed) return;
    acc = Math.min(acc + (now - last) / 1000, 0.25); last = now;
    const i = input();
    if (keys.has('KeyR') || (state.status !== 'playing' && i.a)) { state = game.createState(); keys.delete('KeyR'); keys.delete('Space'); }
    while (acc >= DT) { game.step(state, i); acc -= DT; }
    const rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, state, { cssWidth: rect.width, cssHeight: rect.height });
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  canvas.focus();
  return {
    version: record.version,
    /** Hot-swap a newer version: same level and rules (e.g. new art) keeps the run going; otherwise restart. */
    update(next) {
      const nextChecked = preflight(next.doc, registry);
      if (!nextChecked.ok) return false;
      const same = JSON.stringify([next.doc.level, next.doc.modules, next.doc.win, next.doc.lose]) === JSON.stringify([record.doc.level, record.doc.modules, record.doc.win, record.doc.lose]);
      game = compose(nextChecked.spec, registry); render = createRenderer(game);
      if (!same) state = game.createState();
      record = next; this.version = next.version; return true;
    },
    dispose() { disposed = true; cancelAnimationFrame(raf); removeEventListener('keydown', down); removeEventListener('keyup', up); container.replaceChildren(); },
  };
}
