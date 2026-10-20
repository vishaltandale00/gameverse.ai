// 2D implementation of graphics.camera.isometric: dimetric diamond view for grid boards and
// top-down tilemaps: the renderer's cells, walls (as prisms) and chunks are
// projected through an isometric transform with an adjustable angle; follows
// the target with a dead zone or frames the whole space; rotatable views turn
// in quarter steps with Q/E (presentation only, never the simulation).
import { hubOf, bindAny } from './flat-stage.js';
import { driveTopDown } from './flat-follow.js';

export function installIso2d(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt), space = bindAny(rt, instance);
    let rot = 0;
    const set = () => H.projOpts.set(space, { ...(H.projOpts.get(space) || {}), kind: 'iso', angle: config.angle, rot, flipY: rt.doc.spaces.find(s => s.id === space)?.with?.yAxis !== 'down' });
    set();
    if (config.rotatable && typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', e => { if (e.key === 'q' || e.key === 'Q') { rot = (rot + 3) % 4; set(); } if (e.key === 'e' || e.key === 'E') { rot = (rot + 1) % 4; set(); } });
    H.cameras.set(space, (F, cam) => {
      const base = (F.stage.renderer?.baseZoom?.(F) ?? 32) * config.zoom;
      if (config.follow && F.player) driveTopDown(F, cam, { smoothing: config.smoothing, target: config.target, deadzone: [2, 2] }, base);
      else {
        let api = null; try { api = rt.space(space); } catch { /* */ }
        const [W, Hh] = api?.size || [8, 8];
        const off = api?.kind === 'grid' ? 0.5 : 0;
        cam.x = W / 2 - off; cam.y = Hh / 2 - off; cam.ready = true;
        cam.zoom = Math.min(base * 2, F.w / ((W + Hh) * 0.5 + 1), F.h / ((W + Hh) * 0.5 * (F.proj.ratio || 0.6) + 2));
      }
    });
  }
