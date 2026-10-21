// graphics.post — screen post-processing. In 2D spaces: soft bloom on bright
// areas, a filmic or ACES-like tone curve, palette quantization with ordered
// dithering (retro), vignette, film grain and CRT scanlines, applied to the
// finished frame. In 3D spaces the same config goes to the three renderer's
// adapter (bloom, tonemap, outline, ssao...).
import { hubOf, ORDER } from './flat-stage.js';
import { rgba, surface, ctx2d, rng, clamp, isHex } from './flat-util.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5);
/** Posterize RGBA data in place to `levels` per channel with 4×4 ordered dithering. Pure. */
export function quantizeData(data, w, h, levels) {
  const L = Math.max(2, levels) - 1, step = 255 / L;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, d = BAYER[(y & 3) * 4 + (x & 3)] * step;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(clamp((data[i + c] + d) / step, 0, L)) * step;
  }
  return data;
}
export const levelsFor = colors => Math.max(2, Math.round(Math.cbrt(Math.max(8, colors))));
const bayer = n => { // ordered-dither threshold matrix (n = 4 or 8), values centered on 0
  let m = [[0]];
  while (m.length < n) { const k = m.length; m = Array.from({ length: 2 * k }, (_, y) => Array.from({ length: 2 * k }, (_, x) => 4 * m[y % k][x % k] + [[0, 2], [3, 1]][Math.floor(y / k)][Math.floor(x / k)])); }
  return m.flat().map(v => (v + 0.5) / (n * n) - 0.5);
};
const BAYER_N = { bayer4: [4, bayer(4)], bayer8: [8, bayer(8)] };
/**
 * Map RGBA data in place to the nearest color of a locked palette (an art look's, art/look.js), with optional
 * ordered dithering ('bayer4' | 'bayer8') that spreads each pixel's error over the matrix before matching. Pure.
 */
export function quantizeToPalette(data, w, h, palette, dither = 'none') {
  const pal = palette.map(c => { const n = parseInt(String(c).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  if (!pal.length) return data;
  const [n, m] = BAYER_N[dither] || [1, [0]];
  // Dither amplitude: about the typical gap between palette colors, so flat areas stay flat.
  let gap = 0; for (const a of pal) { let best = Infinity; for (const b of pal) if (a !== b) best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); gap += Number.isFinite(best) ? best : 0; }
  const amp = n > 1 ? (gap / pal.length) * 0.6 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, d = m[(y % n) * n + (x % n)] * amp;
    const r = data[i] + d, g = data[i + 1] + d, b = data[i + 2] + d;
    let best = pal[0], bd = Infinity;
    for (const p of pal) { const e = (r - p[0]) ** 2 * 0.3 + (g - p[1]) ** 2 * 0.59 + (b - p[2]) ** 2 * 0.11; if (e < bd) { bd = e; best = p; } }
    data[i] = best[0]; data[i + 1] = best[1]; data[i + 2] = best[2];
  }
  return data;
}

export default {
  id: 'graphics.post',
  card: {
    intent: 'Screen post-processing: bloom, tone mapping, palette quantization with dithering, vignette, grain and scanlines on 2D frames; bloom, tonemap, outline and SSAO handed to the 3D renderer.',
    views: ['any'],
    params: {
      bloom: { type: 'number', default: 0, min: 0, max: 2, effect: 'glow around bright areas' },
      tonemap: { type: 'string', default: 'none', options: ['none', 'aces', 'filmic'], effect: 'contrast/saturation curve' },
      outline: { type: 'number', default: 0, min: 0, max: 8, unit: 'px', effect: '3D: edge outlines (2D sprites are outlined already)' },
      quantize: { type: 'integer', default: 0, min: 0, max: 4096, unit: 'colors', effect: 'approximate palette size with ordered dithering (0 = off)' },
      palette: { type: 'list', default: [], of: { type: 'string' }, effect: "a locked palette (an art look's colors): frames map to these exact colors instead of an approximate size" },
      dither: { type: 'string', default: 'bayer4', options: ['none', 'bayer4', 'bayer8'], effect: 'ordered dithering used with a locked palette' },
      vignette: { type: 'number', default: 0.25, min: 0, max: 1, effect: 'darken the frame edges' },
      grain: { type: 'number', default: 0, min: 0, max: 1, effect: 'animated film grain' },
      scanlines: { type: 'boolean', default: false, effect: 'CRT scanlines' },
      ssao: { type: 'boolean', default: false, effect: '3D: screen-space ambient occlusion' },
    },
  },
  validate(config) {
    return (config.palette || []).flatMap((c, i) => (isHex(c) ? [] : [{ code: 'flat_color', path: `palette[${i}]`, message: `'${c}' is not a hex color` }]));
  },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt);
    H.cfg.post = config;
    if ((rt.doc.spaces || []).some(s => /voxel|mesh3d/.test(s.use || ''))) { let done = false; const tryAdapt = () => { const a = rt.caches.three?.adapters?.['graphics.post']; if (a && !done) { done = true; H.adapters3d.push(a(rt, config, instance)); } }; tryAdapt(); if (!done) H.update(tryAdapt); }
    let copy = null, small = null, tiny = null, noise = null, lines = null;
    const filterOk = () => { try { const c = ctx2d(surface(2, 2)); if (!c || !('filter' in c)) return false; c.filter = 'blur(1px)'; return c.filter === 'blur(1px)'; } catch { return false; } };
    let canFilter = null;
    H.layer(ORDER.post, F => {
      const g = F.ctx, cv = F.stage.canvas; if (!cv) return;
      canFilter ??= filterOk();
      const W = cv.width, Hh = cv.height;
      const locked = Array.isArray(config.palette) && config.palette.length > 0;
      const needCopy = config.bloom > 0 || (config.tonemap !== 'none' && canFilter) || config.quantize > 0 || locked;
      if (needCopy) {
        if (!copy || copy.width !== W || copy.height !== Hh) copy = surface(W, Hh);
        const c = ctx2d(copy); if (c) { c.setTransform?.(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, Hh); c.drawImage(cv, 0, 0); }
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
        if (config.quantize > 0 || locked) {
          const qw = Math.max(1, Math.round(W / (2 * F.dpr))), qh = Math.max(1, Math.round(Hh / (2 * F.dpr)));
          if (!tiny || tiny.width !== qw || tiny.height !== qh) tiny = surface(qw, qh);
          const t = ctx2d(tiny);
          if (t?.getImageData) { t.imageSmoothingEnabled = true; t.drawImage(copy, 0, 0, qw, qh); const img = t.getImageData(0, 0, qw, qh); if (locked) quantizeToPalette(img.data, qw, qh, config.palette, config.dither); else quantizeData(img.data, qw, qh, levelsFor(config.quantize)); t.putImageData(img, 0, 0); g.imageSmoothingEnabled = false; g.globalAlpha = locked ? 1 : 0.85; g.drawImage(tiny, 0, 0, W, Hh); g.globalAlpha = 1; }
        }
        if (config.tonemap !== 'none' && canFilter) { g.filter = config.tonemap === 'aces' ? 'contrast(1.12) saturate(1.14) brightness(1.02)' : 'contrast(1.06) saturate(1.08) sepia(0.06)'; g.drawImage(config.quantize > 0 || locked ? cv : copy, 0, 0); g.filter = 'none'; }
        if (config.bloom > 0) {
          const bw = Math.max(1, Math.round(W / 4)), bh = Math.max(1, Math.round(Hh / 4));
          if (!small || small.width !== bw || small.height !== bh) small = surface(bw, bh);
          const s = ctx2d(small);
          if (s) {
            s.globalCompositeOperation = 'copy';
            if (canFilter) s.filter = 'brightness(0.72) contrast(4) saturate(1.4) blur(2px)';
            s.drawImage(copy, 0, 0, bw, bh); s.filter = 'none';
            g.globalCompositeOperation = 'screen'; g.globalAlpha = clamp(config.bloom * 0.4, 0, 1); g.imageSmoothingEnabled = true;
            if (canFilter) g.filter = 'blur(4px)';
            g.drawImage(small, 0, 0, W, Hh); g.filter = 'none';
            g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
          }
        }
        g.restore();
      }
      if (config.vignette > 0 && g.createRadialGradient) {
        const gr = g.createRadialGradient(F.w / 2, F.h / 2, Math.min(F.w, F.h) * 0.35, F.w / 2, F.h / 2, Math.hypot(F.w, F.h) * 0.62);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, rgba('#000000', config.vignette * 0.85)); g.fillStyle = gr; g.fillRect(0, 0, F.w, F.h);
      }
      if (config.scanlines) {
        if (!lines) { lines = surface(4, 4); const l = ctx2d(lines); if (l) { l.fillStyle = 'rgba(0,0,0,0.22)'; l.fillRect(0, 0, 4, 1); l.fillStyle = 'rgba(255,255,255,0.03)'; l.fillRect(0, 2, 4, 1); } }
        const pat = lines && g.createPattern ? g.createPattern(lines, 'repeat') : null; if (pat) { g.fillStyle = pat; g.fillRect(0, 0, F.w, F.h); }
      }
      if (config.grain > 0 && !F.reduced) {
        if (!noise) { noise = surface(128, 128); const n = ctx2d(noise), r = rng(3); if (n?.getImageData) { const img = n.createImageData(128, 128); for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; } n.putImageData(img, 0, 0); } }
        if (noise) { g.save(); g.globalAlpha = config.grain * 0.5; g.globalCompositeOperation = 'overlay'; const ox = (F.t * 997) % 128, oy = (F.t * 613) % 128; for (let y = -oy; y < F.h; y += 128) for (let x = -ox; x < F.w; x += 128) g.drawImage(noise, x, y); g.restore(); }
      }
    }, { space: instance.space || null, name: 'post' });
  },
};
