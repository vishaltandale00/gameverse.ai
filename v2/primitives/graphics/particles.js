// graphics.particles — named particle presets bound to events and entities.
// Each binding spawns a preset at the event's subject (self, target, feet,
// source, player, a cell, or a field naming an entity); built-in juice (land
// and jump dust, run dust, pickup sparkles, impact sparks, defeat debris and
// rings, block-break debris, goal confetti) is on unless `defaults` is false.
// Ambient emitters keep weather and motes in view. 2D spaces draw here; 3D
// spaces hand the same config to the three workstream's adapter.
import { hubOf, ORDER, subjectOf, kindOfSpace } from './flat-stage.js';
import { createParticles, SHAPES, DEFAULT_PRESETS, DEFAULT_BINDS } from './flat-particles.js';
import { isHex, col, clamp, rng } from './flat-util.js';

const FLAT = ['tilemap', 'grid', 'physics2d', 'arena2d', 'track'];
const preset = { type: 'object', fields: {
  id: { type: 'string', required: true }, shape: { type: 'string', default: 'dust', options: SHAPES }, color: { type: 'string', default: '#ffffff' },
  count: { type: 'integer', default: 8, min: 1, max: 2000 }, life: { type: 'number', default: 0.6, min: 0.02, max: 30, unit: 's' }, speed: { type: 'number', default: 3, min: 0, max: 200, unit: 'units/s' },
  gravity: { type: 'number', default: 0, min: -100, max: 200, unit: 'units/s² (+ falls)' }, size: { type: 'number', min: 0.005, max: 4, unit: 'units' }, drag: { type: 'number', min: 0, max: 20 },
} };

/** Where an event happens: [x, y] and space, or null. */
export function eventPoint(H, ev, at = 'self') {
  if (Array.isArray(ev.at) && ev.at.every(Number.isFinite) && (at === 'cell' || at === 'self' || at === 'at')) {
    const space = ev.space || H.rt.player()?.space;
    const cell = Number.isInteger(ev.at[0]) && Number.isInteger(ev.at[1]) && kindOfSpace(H.rt.doc.spaces.find(s => s.id === space)) !== 'grid';
    return { p: cell ? [ev.at[0] + 0.5, ev.at[1] + 0.5] : ev.at.slice(0, 2), space };
  }
  const id = at === 'target' ? subjectOf(ev, 'victim') : at === 'player' ? 'player' : at === 'source' ? (ev.source || ev.pickup || subjectOf(ev, 'actor')) : ['self', 'who', 'feet', 'wheels', 'at'].includes(at) ? subjectOf(ev, 'actor') : (typeof ev[at] === 'string' ? ev[at] : null);
  const e = id ? H.seen(id) : null;
  if (!e?.at) return null;
  const size = e.components?.body?.size || [0.8, 1];
  const feet = (at === 'feet' || at === 'wheels') && kindOfSpace(H.rt.doc.spaces.find(s => s.id === e.space)) !== 'grid';
  return { p: [e.at[0], feet ? e.at[1] - size[1] / 2 : e.at[1]], space: e.space, id };
}

export function installParticles(rt, config, instance = {}) {
  const H = hubOf(rt);
  if (H.cfg.particles) return H.particles;
  H.cfg.particles = config;
  const P = (H.particles = createParticles({ budget: config.budget, seed: 11 }));
  const presets = new Map([...(config.defaults ? DEFAULT_PRESETS : []), ...config.presets].map(p => [p.id, p]));
  const binds = [...(config.defaults ? DEFAULT_BINDS : []), ...config.bind];
  const onlySpace = instance.space || null;
  const spawn = (pr, pt, opts = {}) => { if (!pt || !H.stages.has(pt.space) || (onlySpace && pt.space !== onlySpace)) return; P.emit(pr, pt.p, pt.space, opts); };
  rt.on('*', ev => {
    const name = String(ev.name || '');
    for (const b of binds) {
      const match = b.event === name || (b.event.endsWith(':*') && name.startsWith(b.event.slice(0, -1)));
      if (!match) continue;
      const pr = presets.get(b.preset); if (!pr) continue;
      const pt = eventPoint(H, ev, b.at || 'self');
      let dir = null;
      if (pr.shape === 'spark' && b.at === 'target') { const src = eventPoint(H, ev, 'self'); if (src && pt && src.id !== pt.id) { const d = [pt.p[0] - src.p[0], pt.p[1] - src.p[1]], l = Math.hypot(...d) || 1; dir = [d[0] / l, d[1] / l]; } }
      spawn(pr, pt, { dir, count: b.count, color: ev.color && isHex(ev.color) ? ev.color : undefined, scale: ev.big ? 2 : 1 });
    }
    // Broken cells burst into debris of their own color.
    if (config.defaults && name === 'cell_changed' && ev.from != null && ev.to == null && Array.isArray(ev.at)) {
      const block = rt.doc.content?.blocks?.find(x => x.id === ev.from);
      const pt = eventPoint(H, { ...ev, space: ev.space || rt.player()?.space }, 'cell');
      spawn({ ...presets.get(block?.transparent ? 'shards' : 'break'), color: col(block?.color, '#8a7a6a') }, pt);
    }
  });
  let runT = 0;
  const ambient = config.ambient.map(a => ({ ...a, acc: 0 })), ar = rng(5);
  H.update(dt => {
    const sdt = dt * (H.feedback.slowmo || 1) * (H.feedback.hitStop > 0 ? 0 : 1);
    P.update(sdt);
    // Run dust behind a fast grounded player, and ambient emitters in view.
    const p = rt.player(), F = H.lastFrame;
    if (config.defaults && p?.components?.body && H.stages.has(p.space)) {
      const b = p.components.body, vx = b.vel?.[0] || 0;
      if (b.grounded && Math.abs(vx) > 3.5 && (runT += dt) > 0.09) { runT = 0; const size = b.size || [0.8, 1]; P.emit(presets.get('run_dust'), [p.at[0] - Math.sign(vx) * size[0] * 0.3, p.at[1] - size[1] / 2], p.space, { dir: [-Math.sign(vx), 0.5] }); }
    }
    if (F && ambient.length) for (const a of ambient) {
      if (a.zone && F.zone !== a.zone) continue;
      const pr = presets.get(a.preset); if (!pr) continue;
      a.acc += a.rate * dt;
      const tl = F.toWorld([0, 0]), br = F.toWorld([F.w, F.h]);
      while (a.acc >= 1) {
        a.acc -= 1;
        const x = tl[0] + ar() * (br[0] - tl[0]);
        const y = a.area === 'bottom' ? br[1] : a.area === 'view' ? br[1] + ar() * (tl[1] - br[1]) : Math.max(tl[1], br[1]) + 0.5;
        P.emit(pr, [x, y], F.stage.space, { count: 1, dir: pr.shape === 'rain' || pr.shape === 'snow' || pr.shape === 'leaf' ? [0.15, -1] : null });
      }
    }
  });
  H.layer(ORDER.particles, F => P.draw(F, F.stage.space, 'normal'), { name: 'particles' });
  H.layer(ORDER.glow, F => P.draw(F, F.stage.space, 'additive'), { name: 'particles.glow' });
  H.onReset(why => { if (why === 'restore') P.clear(); });
  return P;
}

export default {
  id: 'graphics.particles',
  card: {
    intent: 'Particles with named presets (dust, spark, smoke, debris, rain, snow, ember, leaf, splash, glow, confetti, ring, star, shard, bubble) spawned by events at their subject, plus built-in juice and ambient weather emitters; 2D renders here, 3D via the three adapter.',
    views: ['any'],
    params: {
      presets: { type: 'list', default: [], of: preset, effect: 'named particle looks' },
      bind: { type: 'list', default: [], of: { type: 'object', fields: { event: { type: 'string', required: true, effect: "event name or 'prefix:*'" }, preset: { type: 'string', required: true }, at: { type: 'string', default: 'self', effect: "self | target | feet | source | player | cell, or an event field naming an entity" }, count: { type: 'integer', min: 1, max: 2000 } } }, effect: 'event → preset spawns' },
      budget: { type: 'integer', default: 3000, min: 100, max: 20000, effect: 'live particle cap' },
      defaults: { type: 'boolean', default: true, effect: 'built-in juice: landing/jump/run dust, pickup sparkles, impact sparks, defeat debris, block-break debris, goal confetti' },
      ambient: { type: 'list', default: [], of: { type: 'object', fields: { preset: { type: 'string', required: true }, rate: { type: 'number', default: 20, min: 0, max: 2000, unit: '/s' }, zone: { type: 'ref', to: 'zone' }, area: { type: 'string', default: 'top', options: ['top', 'view', 'bottom'] } } }, effect: 'continuous emitters across the view (weather, motes)' },
    },
  },
  validate(config) {
    const errs = [], ids = new Set([...(config.defaults ? DEFAULT_PRESETS.map(p => p.id) : [])]);
    config.presets.forEach((p, i) => { if (!isHex(p.color)) errs.push({ code: 'flat_color', path: `presets[${i}].color`, message: `'${p.color}' is not a hex color` }); ids.add(p.id); });
    config.bind.forEach((b, i) => { if (!ids.has(b.preset)) errs.push({ code: 'flat_preset_unknown', path: `bind[${i}].preset`, message: `unknown preset '${b.preset}'`, hint: [...ids].join(', ') }); });
    config.ambient.forEach((a, i) => { if (!ids.has(a.preset)) errs.push({ code: 'flat_preset_unknown', path: `ambient[${i}].preset`, message: `unknown preset '${a.preset}'` }); });
    return errs;
  },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt);
    const cfg = { ...config, budget: clamp(config.budget, 100, 20000) };
    if (!H.cfg.particles) installParticles(rt, cfg, instance);
    // 3D spaces: hand the same config to the three renderer's adapter (resolved lazily too).
    const has3d = (rt.doc.spaces || []).some(s => !FLAT.includes(kindOfSpace(s)) && /voxel|mesh3d/.test(s.use));
    if (has3d) { let done = false; const tryAdapt = () => { const a = rt.caches.three?.adapters?.['graphics.particles']; if (a && !done) { done = true; H.adapters3d.push(a(rt, cfg, instance)); } }; tryAdapt(); if (!done) H.update(tryAdapt); }
  },
};
