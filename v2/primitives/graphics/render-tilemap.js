// graphics.render.tilemap — canvas renderer for engine.space.tilemap (side and
// top-down). Layers draw in order (back layers dimmed, the collision layer,
// entities, then foreground layers that fade around the player), from chunks
// rasterized once and cached (LRU, rebuilt on cell_changed), with blob47/wang16
// autotiling, overhang shadows, live liquids, haze and hazards. Entities draw
// through flat-models (sprites, rigs, generated art) with interpolation.
import { ensureJuice } from './flat-juice.js';
import { hubOf, bindSpace, ORDER, stageProjection, checkBinding } from './flat-stage.js';
import { buildChunk, chunkCache, drawHazard, drawLiquid, MARGIN } from './flat-chunks.js';
import { normalizeTheme, themeFromBlock, patternFor } from './flat-tiles.js';
import { drawEntity, lookOf } from './flat-models.js';
import { tileZoom } from './flat-camera.js';
import { driveSide, driveTopDown, roomAt } from './flat-follow.js';
import { drawBackdrop, defaultLayers } from './flat-backdrop.js';
import { rgba, col, mix } from './flat-util.js';

const DRAW_ORDER = { prop: 0, goal: 1, hazard: 1, pickup: 2, npc: 3, mount: 3, vehicle: 3, enemy: 4, boss: 4, projectile: 5, player: 6 };

/** Terrain resolution shared by the cell renderers: block → { kind, theme, color }. */
export function terrain(H, F, api) {
  const doc = F.doc, ts = H.cfg.tileset || {};
  if (H.terrain?.doc === doc && H.terrain.ts === ts) return H.terrain;
  const blocks = new Map((doc.content?.blocks || []).map(b => [b.id, b]));
  const themes = new Map((ts.themes || []).map(t => [t.id, normalizeTheme(t)]));
  const cache = new Map();
  const T = {
    doc, ts, blocks, themes,
    info(block, room) {
      const k = `${block}|${room?.theme || room?.zone || ''}`;
      let v = cache.get(k); if (v) return v;
      const def = blocks.get(block) || { id: String(block), color: '#7a6a5a', solid: true };
      const tags = def.tags || [];
      const coll = api?.collisionOf?.(block);
      const kind = tags.includes('liquid') ? 'liquid' : (tags.includes('hazard') && !def.solid) ? 'hazard' : (tags.includes('one_way') || tags.includes('oneway') || coll === 'oneway') ? 'oneway' : (coll ? coll !== 'none' : def.solid !== false) ? 'solid' : def.transparent ? 'gas' : 'deco';
      let theme = themes.get(ts.bind?.[block]) || themes.get(def.tile) || null;
      const roomTheme = themes.get(room?.theme) || themes.get(ts.zoneThemes?.[room?.zone]) || null;
      if (!theme && roomTheme) theme = { ...roomTheme, pattern: patternFor(def) };
      if (!theme) theme = themeFromBlock(def, ts.edge || 'soft');
      // Back-compat: a block whose own color is far from the theme keeps a hint of it.
      if (def.color && theme.palette && !themes.get(ts.bind?.[block])) theme = { ...theme, palette: { ...theme.palette, a: mix(theme.palette.a, col(def.color), 0.25) } };
      v = { kind, theme, color: col(def.color, '#3a6aa0'), glowing: /lava|slag|acid|magma/.test(`${def.id} ${def.name || ''}`.toLowerCase()), hazard: /thorn|bramble/.test(`${def.id} ${def.name || ''}`.toLowerCase()) ? 'thorns' : 'spikes' };
      cache.set(k, v);
      return v;
    },
  };
  H.terrain = T;
  return T;
}

export default {
  id: 'graphics.render.tilemap',
  card: {
    intent: 'Canvas renderer for tilemap spaces (side or top-down): cached chunked layers in order, autotiled themed tiles, overhang shadows, live liquids and hazards, and every entity drawn with interpolated, animated sprites, rigs or generated art.',
    views: ['side', 'td'],
    params: {
      pixelSnap: { type: 'boolean', default: true, effect: 'integer pixel scale and pixel-aligned camera for crisp pixel art' },
      scale: { type: 'integer', default: 3, min: 1, max: 8, unit: 'screen px per art px', effect: 'how big one tile pixel is on screen' },
      layerOrder: { type: 'list', default: [], of: { type: 'string' }, effect: 'tile layers back to front; layers after the collision layer draw over entities. Empty = the space\'s own order' },
      minView: { type: 'list', default: [16, 9], of: { type: 'number', min: 4, max: 200 }, min: 2, max: 2, unit: 'tiles', effect: 'fewest tiles kept in view across and down (small screens zoom out)' },
      chunk: { type: 'integer', default: 16, min: 8, max: 64, unit: 'tiles', effect: 'cached chunk size' },
      chunkBudget: { type: 'integer', default: 2, min: 1, max: 16, effect: 'chunks rasterized per frame (visible nearest first)' },
      backDim: { type: 'number', default: 0.45, min: 0, max: 1, effect: 'how much back layers darken behind the action' },
      fgFade: { type: 'boolean', default: true, effect: 'foreground layers turn translucent where they cover the player' },
      occlusion: { type: 'number', default: 0.5, min: 0, max: 1, effect: 'soft shadow strength under overhangs and beside walls' },
    },
    provides: {},
    reads: ['content.blocks', 'content.models', 'content.archetypes'],
  },
  validate(config, doc, ctx, info) { return checkBinding(doc, info, 'graphics.render.tilemap', ['engine.space.tilemap']); },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt), space = bindSpace(rt, instance, ['tilemap']), S = H.stage(space, 'tilemap');
    ensureJuice(rt);
    const cache = chunkCache(160), dirty = new Set();
    S.chunks = cache; // inspection (tests, lab)
    const fade = new Map();
    H.onReset(() => { cache.clear(); H.terrain = null; });
    rt.on('cell_changed', ev => {
      if (!Array.isArray(ev.at)) return;
      const C = config.chunk, [x, y] = ev.at, near = new Set();
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) near.add(`${Math.floor((x + dx) / C)}|${Math.floor((y + dy) / C)}`);
      for (const k of cache.keys()) if (near.has(k.slice(k.indexOf('|') + 1))) dirty.add(k);
    });
    const apiOf = () => { try { return rt.space(space); } catch { return null; } };
    const artTile = api => H.cfg.tileset?.tileSize || api?.config?.tile || 16;
    S.renderer = {
      prepare: () => stageProjection(H, S, 'yup'),
      baseZoom: F => tileZoom({ tile: artTile(apiOf()), scale: config.scale, minView: config.minView, pixelSnap: config.pixelSnap }, F.w, F.h),
      camera(F, cam) {
        const api = apiOf(), base = S.renderer.baseZoom(F);
        if ((api?.config?.mode || 'side') === 'side') driveSide(F, cam, { lookAhead: 2, deadzone: [1, 1.6], roomLock: true }, base);
        else driveTopDown(F, cam, {}, base);
      },
      snap: config.pixelSnap,
    };
    H.layer(ORDER.background, F => { if (H.cfg.backgrounds?.has(space)) return; S.defaultLayers ??= defaultLayers(F.doc, (apiOf()?.config?.mode || 'side') === 'side' ? 'side' : 'td'); drawBackdrop(F, S.defaultLayers); }, { space, name: 'tilemap.backdrop' });
    H.layer(ORDER.world, F => draw(F), { space, name: 'render.tilemap' });

    function draw(F) {
      const api = apiOf(); if (!api) return;
      const g = F.ctx, C = config.chunk, artT = artTile(api), unit = F.unit;
      const mode = api.config?.mode || 'side';
      const layers = (config.layerOrder.length ? config.layerOrder.filter(l => !api.layers || api.layers.includes(l)) : api.layers) || [undefined];
      const collision = api.config?.collisionLayers?.find(l => layers.includes(l)) || (layers.includes('solid') ? 'solid' : layers[Math.min(layers.length - 1, 1)] ?? layers[0]);
      const cIdx = Math.max(0, layers.indexOf(collision));
      const corners = [[0, 0], [F.w, 0], [0, F.h], [F.w, F.h]].map(F.toWorld), xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
      const vx0 = Math.floor(Math.min(...xs)) - 1, vx1 = Math.ceil(Math.max(...xs)) + 1, vy0 = Math.floor(Math.min(...ys)) - 1, vy1 = Math.ceil(Math.max(...ys)) + 1;
      const cx0 = Math.floor(vx0 / C), cx1 = Math.floor(vx1 / C), cy0 = Math.floor(vy0 / C), cy1 = Math.floor(vy1 / C);
      const T = terrain(H, F, api);
      let budget = config.chunkBudget;
      const center = F.cam;
      const order = [];
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) order.push([cx, cy, Math.hypot((cx + 0.5) * C - center.x, (cy + 0.5) * C - center.y)]);
      order.sort((a, b) => a[2] - b[2]);
      const chunkFor = (layer, cx, cy, back) => {
        const k = `${layer}|${cx}|${cy}`;
        let ch = cache.get(k);
        if ((!ch || dirty.has(k)) && budget > 0) {
          budget--; dirty.delete(k);
          const box = [[cx * C - 1, cy * C - 1], [cx * C + C, cy * C + C]];
          const list = api.cellsIn ? api.cellsIn(box, layer) : [];
          const cells = new Map(list.map(c => [`${c.at[0]},${c.at[1]}`, c.block]));
          const solidCells = layer === collision ? cells : null;
          const roomCache = new Map();
          const roomOf = (x, y) => { const rk = `${Math.floor(x / 4)},${Math.floor(y / 4)}`; if (!roomCache.has(rk)) roomCache.set(rk, roomAt(F, [x + 0.5, y + 0.5])); return roomCache.get(rk); };
          // Room themes recolor patterns per cell (rooms looked up in 4×4 blocks).
          const info = (b, x, y) => T.info(b, x == null ? null : roomOf(x, y));
          ch = buildChunk({ cells, cx, cy, C, T: artT, info, back, mode, autotile: H.cfg.tileset?.autotile || 'blob47', solidAt: solidCells ? (x, y) => { const b = solidCells.get(`${x},${y}`); return b != null && info(b).kind === 'solid'; } : null, occlusion: config.occlusion * (H.cfg.tileset?.occlusion ?? 1), decor: H.cfg.tileset?.decor !== false });
          cache.set(k, ch);
        }
        return ch;
      };
      // Chunks blit through an affine map, so tilt, isometric and rotated cameras work too.
      const blit = (ch, cx, cy, alpha = 1) => {
        if (!ch?.canvas) return;
        const m = MARGIN / artT, wx0 = cx * C - m, wy0 = (cy + 1) * C + m;
        const p0 = F.toScreen([wx0, wy0]), p1 = F.toScreen([wx0 + ch.w / artT, wy0]), p2 = F.toScreen([wx0, wy0 - ch.h / artT]);
        const a = (p1[0] - p0[0]) / ch.w, b = (p1[1] - p0[1]) / ch.w, c = (p2[0] - p0[0]) / ch.h, d = (p2[1] - p0[1]) / ch.h;
        const axis = Math.abs(b) < 1e-6 && Math.abs(c) < 1e-6, dpr = F.dpr;
        g.globalAlpha = alpha; g.imageSmoothingEnabled = false;
        g.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, (axis ? Math.round(p0[0]) : p0[0]) * dpr, (axis ? Math.round(p0[1]) : p0[1]) * dpr);
        g.drawImage(ch.canvas, 0, 0);
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalAlpha = 1; g.imageSmoothingEnabled = F.style !== 'pixel';
      };
      const live = [];
      const drawLayer = (li, after) => {
        const layer = layers[li], back = li < cIdx;
        for (const [cx, cy] of order) {
          const ch = chunkFor(layer, cx, cy, back ? config.backDim || 0.01 : 0); if (!ch) continue;
          let a = 1;
          if (after && config.fgFade && F.playerPos) {
            const inside = F.playerPos[0] >= cx * C - 2 && F.playerPos[0] <= cx * C + C + 2 && F.playerPos[1] >= cy * C - 2 && F.playerPos[1] <= cy * C + C + 2;
            const fk = `${layer}|${cx}|${cy}`, cur = fade.get(fk) ?? 1, want = inside ? 0.42 : 1;
            a = cur + (want - cur) * 0.15; fade.set(fk, a);
          }
          blit(ch, cx, cy, a);
          if (!back) live.push(ch);
        }
      };
      for (let li = 0; li <= cIdx && li < layers.length; li++) drawLayer(li, false);
      // Hazards ride with the terrain; liquids and haze go over the entities.
      const liquidList = [];
      for (const ch of live) {
        for (const h of ch.hazards) { const p = F.toScreen([h.x, h.y + 1]); drawHazard(g, p[0], p[1], unit, h.theme, F.t, h.up, T.info(h.block).hazard); }
        for (const l of ch.liquids) liquidList.push(l);
      }
      // Entities, back to front.
      const items = F.entities.filter(it => { const p = it.pos; return p[0] >= vx0 - 2 && p[0] <= vx1 + 2 && p[1] >= vy0 - 2 && p[1] <= vy1 + 2; });
      const roleOfItem = it => lookOf(H, it.e, mode === 'side' ? 'side' : 'td').role;
      items.sort((a, b) => mode === 'side' ? (DRAW_ORDER[roleOfItem(a)] ?? 3) - (DRAW_ORDER[roleOfItem(b)] ?? 3) || (a.id === 'player') - (b.id === 'player') : b.pos[1] - a.pos[1]);
      for (const it of items) {
        const size = it.e.components?.body?.size || [0.8, 1];
        const feet = F.toScreen([it.pos[0], it.pos[1] - size[1] / 2]);
        drawEntity(F, it, { x: feet[0], y: feet[1], w: size[0] * unit, h: size[1] * unit, view: mode === 'side' ? 'side' : 'td', ppu: artT, unit });
      }
      for (const l of liquidList) {
        const p = F.toScreen([l.x, l.y + 1]);
        if (l.gas) { g.fillStyle = rgba(l.color, 0.32 + 0.08 * Math.sin(F.t * 1.3 + l.x * 0.4 + l.y * 0.3)); g.fillRect(p[0], p[1], unit + 0.5, unit + 0.5); }
        else drawLiquid(g, p[0], p[1], unit, l.color, F.t, l.top, l.glowing);
      }
      for (let li = cIdx + 1; li < layers.length; li++) drawLayer(li, true);
    }
  },
};
