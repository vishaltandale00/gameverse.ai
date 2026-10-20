// graphics.render.arena2d — canvas renderer for engine.space.arena2d: fighters,
// shmups, asteroids-likes and side runners. Side or top view (auto from
// gravity); solids drawn as autotiled themed blocks, one-way platforms as
// planks, blast zones faintly; the camera fits the scroll window, frames every
// fighter (zooming out as they separate) or follows the player. Wrap edges
// draw ghost copies; optional hurt/hit box overlays for tuning fighters.
import { ensureJuice } from './flat-juice.js';
import { hubOf, bindSpace, ORDER, stageProjection, checkBinding, boundsOf } from './flat-stage.js';
import { driveFit, driveSide } from './flat-follow.js';
import { drawEntity, lookOf } from './flat-models.js';
import { drawBackdrop, defaultLayers, normalizeLayers } from './flat-backdrop.js';
import { normalizeTheme, themeFromBlock, paintTile } from './flat-tiles.js';
import { blobMask } from './flat-autotile.js';
import { rgba, surface, ctx2d, light, shade } from './flat-util.js';

export default {
  id: 'graphics.render.arena2d',
  card: {
    intent: 'Canvas renderer for arena2d spaces (fighters, shmups, asteroids, runners): side or top view, themed solid blocks and plank platforms, a camera that fits the scroll window, frames all fighters or follows the player, wrap ghosts and optional hit/hurt box overlays.',
    views: ['side', 'td'],
    params: {
      view: { type: 'string', default: 'auto', options: ['auto', 'side', 'top'], effect: 'auto: top when the arena has no gravity' },
      theme: { type: 'string', default: '', effect: 'tileset theme id for solids (default: the first theme, else stone)' },
      frameFighters: { type: 'boolean', default: true, effect: 'with two or more fighters, frame them all and zoom with their spread' },
      boxes: { type: 'boolean', default: false, effect: 'overlay hurt (blue) and hit (red) boxes' },
      maxScale: { type: 'number', default: 96, min: 4, max: 400, unit: 'px/u', effect: 'largest zoom' },
    },
    reads: ['content.models', 'content.archetypes'],
  },
  validate(config, doc, ctx, info) { return checkBinding(doc, info, 'graphics.render.arena2d', ['engine.space.arena2d']); },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt), space = bindSpace(rt, instance, ['arena2d']), S = H.stage(space, 'arena2d');
    ensureJuice(rt);
    const apiOf = () => { try { return rt.space(space); } catch { return null; } };
    const viewOf = api => (config.view !== 'auto' ? config.view : (api?.config?.gravity ?? 0) === 0 ? 'top' : 'side');
    const solids = new Map();
    // A solid rect rasterized once: one cell per arena unit, autotiled against the rect's own edges.
    const solidImage = (r, theme) => {
      const k = `${r.join(',')}|${theme.pattern}|${theme.palette.a}`; if (solids.has(k)) return solids.get(k);
      const T = H.cfg.tileset?.tileSize || 16, cols = Math.max(1, Math.round(r[2] - r[0])), rows = Math.max(1, Math.round(r[3] - r[1]));
      if (cols * rows > 6000) { solids.set(k, null); return null; }
      const W = cols * T, Hh = rows * T, buf = new Uint8ClampedArray(W * Hh * 4);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const mask = blobMask((dx, dy) => i + dx >= 0 && i + dx < cols && j + dy >= 0 && j + dy < rows);
        paintTile(buf, W, i * T, (rows - 1 - j) * T, T, theme, Math.round(r[0]) + i, -(Math.round(r[1]) + j), mask, {});
      }
      const c = surface(W, Hh), g = ctx2d(c);
      if (g) { const img = typeof ImageData !== 'undefined' ? new ImageData(buf, W, Hh) : g.createImageData?.(W, Hh); if (img && img.data !== buf) img.data.set?.(buf); if (img) g.putImageData?.(img, 0, 0); }
      solids.set(k, g ? c : null); return g ? c : null;
    };
    const fighters = F => F.entities.filter(x => !x.ghost && (x.e.components?.versus || lookOf(H, x.e, 'side').type === 'fighter'));
    S.renderer = {
      prepare: () => stageProjection(H, S, 'yup'),
      baseZoom: F => { const b = boundsOf(apiOf()); const w = b ? b.max[0] - b.min[0] : 16, h = b ? b.max[1] - b.min[1] : 9; return Math.min(config.maxScale, F.w / w, F.h / h); },
      camera(F, cam) {
        const api = apiOf(), b = boundsOf(api); if (!b) return;
        const box = [b.min[0], b.min[1], b.max[0], b.max[1]];
        if (api.config?.scroll) { driveFit(F, cam, box, config.maxScale, 0); return; }
        const fs = config.frameFighters ? fighters(F) : [];
        if (fs.length >= 2) { driveSide(F, cam, { frameTargets: fs.map(x => x.id), roomLock: false, smoothing: 0.12, frameMargin: 2.5, deadzone: [0.5, 1], verticalBias: 1 }, Math.min(config.maxScale, F.h / 7)); return; }
        const fit = Math.min(F.w / (box[2] - box[0]), F.h / (box[3] - box[1]));
        if (F.player && fit < Math.min(F.w, F.h) / 14 && viewOf(api) === 'side') driveSide(F, cam, { lookAhead: 3, roomLock: false }, Math.min(config.maxScale, F.h / 10));
        else driveFit(F, cam, box, config.maxScale, 0.2);
      },
    };
    H.layer(ORDER.background, F => {
      if (H.cfg.backgrounds?.has(space)) return;
      const top = viewOf(apiOf()) === 'top';
      S.defaultLayers ??= top ? normalizeLayers([{ pattern: 'gradient', depth: 0, color: '#05051a', fogColor: '#120a30' }, { pattern: 'void', depth: 0.05, color: '#2a1a6a' }, { pattern: 'stars', depth: 0.15, color: '#ffffff' }, { pattern: 'stars', depth: 0.45, color: '#bfe0ff' }]) : defaultLayers(F.doc, 'side');
      drawBackdrop(F, S.defaultLayers);
    }, { space, name: 'arena2d.backdrop' });
    H.layer(ORDER.world, F => draw(F), { space, name: 'render.arena2d' });

    function draw(F) {
      const api = apiOf(); if (!api) return;
      const g = F.ctx, z = F.unit, view = viewOf(api), [W, Hh] = api.size || [16, 9];
      const ts = H.cfg.tileset, theme = ts?.themes?.length ? normalizeTheme(ts.themes.find(t => t.id === config.theme) || ts.themes[0]) : themeFromBlock({ id: 'arena', color: view === 'top' ? '#4a5a7a' : '#6a6070', tile: 'stone' });
      // Solids: each rect painted once as autotiled cells in world coordinates (no repeating tiles).
      for (const r of api.config?.solids || []) {
        const [x0, y0, x1, y1] = r, img = solidImage(r, theme), a = F.toScreen([x0, y1]), b = F.toScreen([x1, y0]);
        if (img) { g.imageSmoothingEnabled = false; g.drawImage(img, Math.floor(a[0]), Math.floor(a[1]), Math.ceil(b[0] - a[0]) + 1, Math.ceil(b[1] - a[1]) + 1); }
        else { g.fillStyle = theme.palette.a; g.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
      }
      for (const p of api.config?.platforms || []) {
        const a = F.toScreen([p.x0, p.y]), b = F.toScreen([p.x1, p.y]), th = Math.max(4, z * 0.22);
        g.fillStyle = '#8a6a3a'; g.fillRect(a[0], a[1], b[0] - a[0], th); g.fillStyle = light('#8a6a3a', 0.3); g.fillRect(a[0], a[1], b[0] - a[0], Math.max(1, th * 0.25)); g.fillStyle = shade('#8a6a3a', 0.4); g.fillRect(a[0], a[1] + th - 1, b[0] - a[0], 1);
        for (let x = a[0] + 6; x < b[0] - 4; x += Math.max(12, z * 1.2)) { g.fillStyle = shade('#8a6a3a', 0.3); g.fillRect(x, a[1] + th, Math.max(2, z * 0.08), th * 1.4); }
      }
      // Top-down arenas: frame the playfield and dim what lies outside it.
      if (view === 'top' && !api.config?.scroll) {
        const b = boundsOf(api), a = F.toScreen([b.min[0], b.max[1]]), c = F.toScreen([b.max[0], b.min[1]]);
        g.save(); g.fillStyle = 'rgba(2,2,10,.55)'; g.beginPath(); g.rect(0, 0, F.w, F.h); g.rect(a[0], a[1], c[0] - a[0], c[1] - a[1]); g.fill('evenodd');
        g.strokeStyle = rgba('#7a8aff', 0.35); g.lineWidth = 2; g.shadowColor = '#7a8aff'; g.shadowBlur = 12; g.strokeRect(a[0], a[1], c[0] - a[0], c[1] - a[1]); g.restore();
      }
      if (api.config?.blast) { const [x0, y0, x1, y1] = api.config.blast, a = F.toScreen([x0, y1]), b = F.toScreen([x1, y0]); g.save(); g.setLineDash?.([10, 8]); g.strokeStyle = rgba('#ff5a5a', 0.25); g.lineWidth = 2; g.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); g.restore(); }
      const wrapX = boundsOf(api)?.wrap?.[0], wrapY = boundsOf(api)?.wrap?.[1];
      const pv = view === 'top' ? 'top' : 'side';
      const items = [...F.entities].sort((a, b) => (a.id === 'player') - (b.id === 'player'));
      for (const it of items) {
        const size = it.e.components?.body?.size || [0.8, 1];
        const at = [it.pos[0], it.pos[1]];
        const copies = [at];
        if (wrapX) { if (at[0] < size[0]) copies.push([at[0] + W, at[1]]); else if (at[0] > W - size[0]) copies.push([at[0] - W, at[1]]); }
        if (wrapY) { if (at[1] < size[1]) copies.push([at[0], at[1] + Hh]); else if (at[1] > Hh - size[1]) copies.push([at[0], at[1] - Hh]); }
        for (const q of copies) {
          const feet = F.toScreen(pv === 'top' ? [q[0], q[1] - size[1] / 2] : [q[0], q[1] - size[1] / 2]);
          drawEntity(F, it, { x: feet[0], y: feet[1], w: size[0] * z, h: size[1] * z, view: pv, unit: z });
        }
        if (config.boxes && api.boxesOf) for (const [kind, color] of [['hurt', '#4fa8ff'], ['hit', '#ff4a4a']]) for (const r of api.boxesOf(it.e, kind) || []) { const a = F.toScreen([r[0], r[3]]), b = F.toScreen([r[2], r[1]]); g.fillStyle = rgba(color, 0.18); g.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); g.strokeStyle = color; g.lineWidth = 1; g.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
      }
    }
  },
};
