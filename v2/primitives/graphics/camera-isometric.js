// graphics.camera.isometric — dimetric diamond view for grid boards and
// top-down tilemaps: the renderer's cells, walls (as prisms) and chunks are
// projected through an isometric transform with an adjustable angle; follows
// the target with a dead zone or frames the whole space; rotatable views turn
// in quarter steps with Q/E (presentation only, never the simulation).
import { hubOf, bindAny } from './flat-stage.js';
import { driveTopDown } from './flat-follow.js';

export default {
  id: 'graphics.camera.isometric',
  card: {
    intent: 'Isometric camera for grid boards and top-down tilemaps: diamond projection at an adjustable angle, follow with dead zone or whole-board framing, quarter-turn rotation with Q/E.',
    views: ['iso'],
    params: {
      angle: { type: 'number', default: 30, min: 15, max: 45, unit: 'deg', effect: 'view elevation (30 ≈ classic 2:1 pixel iso is 26.6)' },
      zoom: { type: 'number', default: 1, min: 0.25, max: 8, effect: "multiplier on the renderer's base zoom" },
      follow: { type: 'boolean', default: false, effect: 'follow the target (false: frame the whole space)' },
      rotatable: { type: 'boolean', default: false, effect: 'Q/E rotate the view a quarter turn' },
      smoothing: { type: 'number', default: 0.14, min: 0, max: 1 },
      target: { type: 'string', default: 'player' },
    },
  },
  validate(config, doc) {
    return (doc.spaces || []).some(s => s.use === 'engine.space.grid' || (s.use === 'engine.space.tilemap' && s.with?.mode === 'topdown')) ? [] : [{ code: 'flat_iso_space', message: 'graphics.camera.isometric needs a grid space or a top-down tilemap' }];
  },
  install(rt, config, instance) {
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
  },
};
