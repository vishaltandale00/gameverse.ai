// graphics.render.grid — canvas board for engine.space.grid: square, hex
// (odd-r, pointy-top) and iso (diamond) cells. Wall styles: raised beveled
// blocks or prisms (board), autotiled tileset art (tiles), traced neon maze
// contours (neon) or flat. Floors in checker or terrain tiles; piece cells
// (gems, blobs, viruses, capsules, pellets) drawn as pieces that drop in and pop
// out on cell changes; entities glide between cells with a hop; highlights for
// hover, selection, move and attack ranges (hub API for rules primitives);
// clicks can send a verb with the cell.
import { ensureJuice } from './flat-juice.js';
import { hubOf, bindSpace, ORDER, stageProjection, checkBinding, bindingRules } from './flat-stage.js';
import { driveFit, driveTopDown } from './flat-follow.js';
import { drawEntity, STATES, FLAT_MODEL_FIELDS } from './flat-models.js';
import { drawVector, glow } from './flat-vector.js';
import { wallLoops, roundedLoop } from './flat-maze.js';
import { drawBackdrop, defaultLayers } from './flat-backdrop.js';
import { normalizeTheme, themeFromBlock, paintTile } from './flat-tiles.js';
import { blobMask } from './flat-autotile.js';
import { blockColorOf, drawZones, marksOf, drawMark, drawLabel } from './flat-zones.js';
import { TAU, rgba, mix, light, shade, col, isHex, neon, lerp, path as getPath, surface, ctx2d, easeOutBack, hash2 } from './flat-util.js';
import { modelsData, MODEL_COMPONENT, color, blocksData } from './model-lib.js';

const SQ3 = Math.sqrt(3);
// Pieces a non-wall cell can be drawn as. A block is a piece when it declares one as its `tile` (content.blocks[].tile);
// what a cell is never comes from words in its id, name or tags (ARCHITECTURE §1.2: names are themed).
export const PIECES = Object.freeze(['gem', 'blob', 'virus', 'capsule', 'pellet', 'power', 'coin', 'star', 'heart', 'bomb', 'crate', 'rock', 'block', 'key']);
const PIECE_SET = new Set(PIECES);

/** Corner points of a cell in layout coordinates. */
export function cellShape(topology, center) {
  const [x, y] = center;
  if (topology === 'hex') { const R = 1 / SQ3; return Array.from({ length: 6 }, (_, k) => { const a = (Math.PI / 3) * k + Math.PI / 6; return [x + Math.cos(a) * R, y + Math.sin(a) * R]; }); }
  return [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]];
}

export default {
  id: 'graphics.render.grid',
  card: {
    intent: 'Canvas board for grid spaces (square, hex, iso): raised, tiled, neon-maze or flat walls, checker or terrain floors, animated piece cells, gliding pieces, hover/selection/move/attack highlights and click-to-act.',
    views: ['board', 'td', 'iso'],
    // What it draws of its space (graphics/presentation.js DRAWS): the template contract and the gate check it covers what
    // the document's loops show (card.loop.shows).
    draws: ['entities', 'cells', 'zones', 'labels', 'marks'],
    // How it draws its space for each view it serves (v2/verify/directions.js): 'plane' maps the space's axes onto the
    // screen's right and up; 'chase' looks along `forward` with `right` to the right of the screen.
    projection: space => (space?.topology === 'iso' ? {} : { td: { kind: 'plane', right: '+x', up: space?.yAxis === 'down' ? '-y' : '+y' }, board: { kind: 'plane', right: '+x', up: space?.yAxis === 'down' ? '-y' : '+y' } }),
    params: {
      style: { type: 'string', default: 'board', options: ['board', 'tiles', 'neon', 'flat'], effect: 'wall and floor look family' },
      floor: { type: 'string', default: 'auto', options: ['auto', 'checker', 'plain', 'tiles', 'none'], effect: 'floor look (auto follows style)' },
      wallColor: color({ effect: 'wall color override (neon: the glow color)' }),
      floorColor: color({ effect: 'floor color override' }),
      lines: { type: 'boolean', default: true, effect: 'thin grid lines between floor cells' },
      wallHeight: { type: 'number', default: 0.28, min: 0, max: 1.5, unit: 'cells', effect: 'raised wall height (board style and iso prisms)' },
      highlights: { type: 'list', default: [{ source: 'hover', range: 'cell' }], of: { type: 'object', fields: { source: { type: 'string', default: 'hover', options: ['hover', 'player', 'selected'] }, range: { type: 'string', default: 'cell', options: ['cell', 'move', 'attack', 'path'] }, color: color() } }, effect: 'overlays: hovered cell, the player\'s move/attack range, the selected entity' },
      moveRange: { type: 'string', default: 'components.move.range', effect: 'entity field holding move range (cells)' },
      attackRange: { type: 'string', default: 'components.attacks.range', effect: 'entity field holding attack range (cells)' },
      clickAction: { type: 'string', default: '', effect: 'verb sent with the clicked [col,row] (empty: clicks only select)' },
      maxCell: { type: 'number', default: 72, min: 8, max: 256, unit: 'px', effect: 'largest cell size on screen' },
      follow: { type: 'boolean', default: false, effect: 'follow the player instead of fitting the board (big mazes follow automatically)' },
    },
    reads: ['content.blocks', 'content.models', 'content.archetypes'],
    data: { 'content.models': modelsData(FLAT_MODEL_FIELDS, { states: STATES }), 'content.blocks': blocksData(['color', 'tags', 'solid', 'tile']) },
    components: { model: MODEL_COMPONENT },
    rules: { ...bindingRules('graphics.render.grid', ['engine.space.grid']) },
  },
  validate(config, doc, ctx, info) {
    return checkBinding(doc, info, 'graphics.render.grid', ['engine.space.grid']);
  },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt), space = bindSpace(rt, instance, ['grid']), S = H.stage(space, 'grid');
    ensureJuice(rt);
    const apiOf = () => { try { return rt.space(space); } catch { return null; } };
    const doc = () => rt.doc;
    const blocks = () => (S.blockMap?.doc === rt.doc ? S.blockMap.map : (S.blockMap = { doc: rt.doc, map: new Map((rt.doc.content?.blocks || []).map(b => [b.id, b])) }).map);
    let loops = null; const anims = new Map(), glide = new Map(), tileCache = new Map();
    let selected = null;
    H.onReset(() => { loops = null; anims.clear(); glide.clear(); tileCache.clear(); });
    rt.on('cell_changed', ev => {
      loops = null; if (!Array.isArray(ev.at)) return;
      const k = `${Math.round(ev.at[0])},${Math.round(ev.at[1])}`;
      if (ev.to != null && ev.from == null) anims.set(k, { kind: 'in', t0: H.clock, block: ev.to });
      else if (ev.to == null && ev.from != null) anims.set(k, { kind: 'out', t0: H.clock, block: ev.from });
      else anims.set(k, { kind: 'swap', t0: H.clock, block: ev.to });
    });
    const wallOf = (api, b) => { if (b == null) return false; const r = api.config?.rules?.[b]; if (r && r.pass !== undefined) return r.pass === false || (Array.isArray(r.pass) && !r.pass.length); return blocks().get(b)?.solid === true; };
    const pieceOf = b => { const t = blocks().get(b)?.tile; return PIECE_SET.has(t) ? t : null; };
    // Every block has its own color: the declared one, else its content.blocks position's (no two blocks alike by construction).
    const blockColor = b => blockColorOf(rt.doc, b);
    S.renderer = {
      prepare(F) { const api = apiOf(); const topo = api?.config?.topology; stageProjection(H, S, topo === 'iso' ? 'iso' : api?.config?.yAxis === 'down' ? 'ydown' : 'yup', topo === 'iso' ? { flipY: api?.config?.yAxis !== 'down' } : {}); },
      baseZoom(F) { const api = apiOf(); const [W, Hh] = api?.size || [8, 8]; return Math.min(config.maxCell, Math.max(8, Math.min(F.w / (W + 1), F.h / (Hh + 1)))); },
      camera(F, cam) {
        const api = apiOf(); if (!api) return;
        const [W, Hh] = api.size, hex = api.config.topology === 'hex';
        const box = hex ? [-0.6, -0.6, W + 0.1, (Hh - 1) * SQ3 / 2 + 0.6] : [-0.5, -0.5, W - 0.5, Hh - 0.5];
        const fit = Math.min(F.w / (box[2] - box[0] + 1), F.h / ((box[3] - box[1]) * (F.proj.kind === 'iso' ? F.proj.ratio : 1) + 1));
        if ((config.follow || fit < 14) && F.player) driveTopDown(F, cam, { deadzone: [4, 3] }, Math.max(14, Math.min(config.maxCell, 26)));
        else driveFit(F, cam, F.proj.kind === 'iso' ? null : box, config.maxCell, 0.6);
        if (F.proj.kind === 'iso') { cam.x = (W - 1) / 2; cam.y = (Hh - 1) / 2; cam.zoom = Math.min(config.maxCell, F.w / ((W + Hh) * 0.5 + 1), F.h / ((W + Hh) * 0.5 * F.proj.ratio + 1.5)); }
      },
    };
    H.layer(ORDER.background, F => { if (H.cfg.backgrounds?.has(space)) return; S.defaultLayers ??= defaultLayers(F.doc, 'td', space); drawBackdrop(F, S.defaultLayers, { base: config.style === 'neon' ? '#05040e' : null }); }, { space, name: 'grid.backdrop' });
    H.layer(ORDER.world, F => draw(F), { space, name: 'render.grid' });

    function cellTile(theme, mask, T = 16) {
      const k = `${theme.id || theme.pattern}|${theme.palette.a}|${mask}`;
      if (tileCache.has(k)) return tileCache.get(k);
      const buf = new Uint8ClampedArray(T * T * 4); paintTile(buf, T, 0, 0, T, theme, 0, 0, mask, {});
      const c = surface(T, T), g = ctx2d(c);
      if (g) { const img = typeof ImageData !== 'undefined' ? new ImageData(buf, T, T) : g.createImageData?.(T, T); if (img && img.data !== buf) img.data.set?.(buf); if (img) g.putImageData?.(img, 0, 0); }
      tileCache.set(k, g ? c : null);
      return g ? c : null;
    }

    function draw(F) {
      const api = apiOf(); if (!api) return;
      const g = F.ctx; g.imageSmoothingEnabled = false;
      const [W, Hh] = api.size, topo = api.config.topology || 'square', layer0 = api.layers?.[0];
      const center = c => (api.cellCenter ? api.cellCenter(c) : c);
      const iso = F.proj.kind === 'iso', z = F.unit;
      const style = config.style, neonStyle = style === 'neon';
      const tileset = H.cfg.tileset;
      const wallBase = config.wallColor ? col(config.wallColor) : neonStyle ? '#3a5cff' : '#4a4e6a';
      const floorBase = config.floorColor ? col(config.floorColor) : neonStyle ? '#06060f' : style === 'flat' ? '#e8e2d4' : '#2c3346';
      const cells = new Map(); for (const l of api.layers || [layer0]) for (const c of api.cellsIn([[0, 0], [W - 1, Hh - 1]], l)) { const k = `${c.at[0]},${c.at[1]}`; if (!cells.has(k) || wallOf(api, c.block)) cells.set(k, c.block); }
      const isWall = (i, j) => wallOf(api, cells.get(`${i},${j}`));
      const poly = (pts, lift = 0) => { g.beginPath(); pts.forEach((p, i) => { const s = F.toScreen([p[0], p[1], lift]); i ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); }); g.closePath(); };
      const shapeAt = c => cellShape(topo, center(c));
      // Floor.
      const floor = config.floor === 'auto' ? (neonStyle ? 'plain' : style === 'tiles' ? 'tiles' : 'checker') : config.floor;
      if (floor !== 'none') for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
        if (isWall(i, j) && !neonStyle) continue;
        const b = cells.get(`${i},${j}`), piece = b != null && pieceOf(b);
        const terrain = b != null && !piece && !wallOf(api, b) ? blockColor(b) : null;
        poly(shapeAt([i, j]));
        g.fillStyle = terrain || (floor === 'checker' && (i + j) % 2 ? shade(floorBase, 0.06) : floorBase);
        g.fill();
        if (floor === 'tiles' || (terrain && style !== 'flat')) {
          const th = terrain ? themeFromBlock(blocks().get(b)) : normalizeTheme({ pattern: tileset?.themes?.[0]?.pattern || 'stone', palette: { a: floorBase } });
          const tile = cellTile({ ...th, edge: 'none' }, 255);
          if (tile && !iso && topo === 'square') { const p = F.toScreen([i - 0.5, F.proj.kind === 'ydown' ? j - 0.5 : j + 0.5]); g.save(); g.globalAlpha = terrain ? 0.9 : 0.5; g.drawImage(tile, p[0], p[1], z, z); g.restore(); }
        }
        if (config.lines && !neonStyle) { g.strokeStyle = rgba(style === 'flat' ? '#000000' : '#ffffff', 0.07); g.lineWidth = 1; g.stroke(); }
      }
      // Highlights under pieces.
      const hov = F.stage.pointer ? F.toWorld(F.stage.pointer) : null;
      const hoverCell = hov ? nearestCell(api, hov, W, Hh, topo) : null;
      for (const click of F.stage.clicks) {
        const c = nearestCell(api, F.toWorld(click), W, Hh, topo); if (!c) continue;
        const ent = F.entities.find(x => !x.ghost && Math.round(x.pos[0]) === c[0] && Math.round(x.pos[1]) === c[1]);
        selected = ent ? ent.id : null;
        if (config.clickAction && H.view?.act) H.view.act({ [config.clickAction]: c });
      }
      const marks = [];
      for (const h of config.highlights) {
        const color = h.color && isHex(h.color) ? h.color : h.range === 'attack' ? '#ff5a5a' : h.range === 'move' ? '#4fa8ff' : '#ffffff';
        const who = h.source === 'player' ? F.byId.get('player') : h.source === 'selected' ? F.byId.get(selected) : null;
        if (h.source === 'hover') { if (hoverCell) marks.push({ cells: [hoverCell], color, outline: true }); continue; }
        if (!who) continue;
        const at = [Math.round(who.pos[0]), Math.round(who.pos[1])];
        if (h.range === 'cell') { marks.push({ cells: [at], color, outline: true }); continue; }
        const n = Number(getPath(who.e, h.range === 'attack' ? config.attackRange : config.moveRange)) || (h.range === 'attack' ? 1 : 3);
        let list = [];
        try { list = h.range === 'path' && hoverCell ? (api.path?.(at, hoverCell) || []) : api.cellsInRange?.(at, n, 'steps', { passable: h.range === 'move' }) || []; } catch { list = []; }
        marks.push({ cells: list.map(c => (Array.isArray(c) ? c : String(c).split(',').map(Number))), color, pulse: true });
      }
      for (const m of H.highlights.get(space)?.values() || []) marks.push({ cells: m.cells, color: m.color || '#ffd23f', pulse: m.pulse !== false, outline: m.outline });
      for (const m of marks) for (const c of m.cells) {
        poly(shapeAt(c));
        const a = m.pulse ? 0.22 + 0.1 * Math.sin(F.t * 4) : 0.16;
        g.fillStyle = rgba(m.color, a); g.fill();
        if (m.outline || m.pulse) { g.strokeStyle = rgba(m.color, 0.8); g.lineWidth = Math.max(1, z * 0.05); g.stroke(); }
      }
      // The zones the loops name (graphics/presentation.js), under the walls and pieces.
      drawZones(F, api, { cellAnchored: true });
      // Walls.
      if (neonStyle) {
        loops ??= wallLoops(W, Hh, isWall, { inset: 0.5, wrapX: /x|both/.test(api.config.wrap || ''), wrapY: /y|both/.test(api.config.wrap || '') });
        const glowC = neon(wallBase), core = light(wallBase, 0.55);
        const toS = p => F.toScreen([p.x - 0.5, p.y - 0.5]);
        g.save();
        // Clip to the board so the out-of-bounds pad's outer contour never shows.
        { const a = F.toScreen([-0.5, -0.5]), b = F.toScreen([W - 0.5, Hh - 0.5]); g.beginPath(); g.rect(Math.min(a[0], b[0]) - z * 0.05, Math.min(a[1], b[1]) - z * 0.05, Math.abs(b[0] - a[0]) + z * 0.1, Math.abs(b[1] - a[1]) + z * 0.1); g.clip(); }
        g.beginPath(); for (const L of loops) roundedLoop(g, L, toS, z * 0.42);
        g.fillStyle = rgba(glowC, 0.1); g.fill('evenodd');
        g.lineJoin = 'round'; g.lineCap = 'round';
        g.shadowColor = glowC; g.shadowBlur = z * 0.55; g.strokeStyle = glowC; g.lineWidth = Math.max(1.5, z * 0.3); g.stroke();
        g.shadowBlur = 0; g.strokeStyle = core; g.lineWidth = Math.max(0.6, z * 0.11); g.stroke();
        g.restore();
      } else {
        const order = [];
        for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) if (isWall(i, j)) order.push([i, j]);
        // Back to front so raised faces overlap correctly.
        order.sort((a, b) => F.toScreen(center(a))[1] - F.toScreen(center(b))[1]);
        const h = style === 'flat' ? 0 : config.wallHeight;
        for (const c of order) {
          const b = cells.get(`${c[0]},${c[1]}`), wc = config.wallColor ? wallBase : mix(blockColor(b), wallBase, 0.25), pts = shapeAt(c);
          if (style === 'tiles') {
            const th = tileset?.themes?.length ? normalizeTheme(tileset.themes.find(t => t.id === blocks().get(b)?.tile) || tileset.themes[0]) : themeFromBlock(blocks().get(b));
            const mask = blobMask((dx, dy) => isWall(c[0] + dx, c[1] + (F.proj.kind === 'ydown' ? -dy : dy)));
            const tile = cellTile(th, mask);
            if (tile && !iso && topo === 'square') { const p = F.toScreen([c[0] - 0.5, F.proj.kind === 'ydown' ? c[1] - 0.5 : c[1] + 0.5]); g.drawImage(tile, Math.round(p[0]), Math.round(p[1]), Math.ceil(z), Math.ceil(z)); continue; }
          }
          if (iso || h > 0) {
            // Prism: side faces then a lit top.
            const top = pts.map(p => F.toScreen([p[0], p[1], iso ? h * 2 : 0])), base = pts.map(p => F.toScreen([p[0], p[1], 0]));
            const lift = iso ? 0 : h * z;
            const up = top.map(p => [p[0], p[1] - lift]);
            const faces = pts.map((_, k) => ({ k, a: base[k], b: base[(k + 1) % pts.length], ta: up[k], tb: up[(k + 1) % pts.length] }))
              .filter(f => (f.a[1] + f.b[1]) / 2 > (f.ta[1] + f.tb[1]) / 2 + 0.01 && Math.abs(f.a[0] - f.b[0]) > 0.5)
              .sort((x, y) => (x.a[1] + x.b[1]) - (y.a[1] + y.b[1]));
            for (const f of faces) {
              g.beginPath(); g.moveTo(...f.a); g.lineTo(...f.b); g.lineTo(...f.tb); g.lineTo(...f.ta); g.closePath();
              g.fillStyle = shade(wc, (f.a[0] + f.b[0]) / 2 < (up[0][0] + up[2][0]) / 2 ? 0.22 : 0.34); g.fill();
            }
            g.beginPath(); up.forEach((p, k) => (k ? g.lineTo(...p) : g.moveTo(...p))); g.closePath();
            if (g.createLinearGradient) { const gr = g.createLinearGradient(up[0][0], up[0][1], up[2][0], up[2][1]); gr.addColorStop(0, light(wc, 0.25)); gr.addColorStop(1, wc); g.fillStyle = gr; } else g.fillStyle = wc;
            g.fill(); g.strokeStyle = rgba(shade(wc, 0.5), 0.8); g.lineWidth = 1; g.stroke();
            g.strokeStyle = rgba(light(wc, 0.5), 0.6); g.beginPath(); g.moveTo(...up[up.length - 1]); g.lineTo(...up[0]); g.lineTo(...up[1]); g.stroke();
          } else { poly(pts); g.fillStyle = wc; g.fill(); }
        }
      }
      // Pieces (non-wall cells that are pieces) with drop-in / pop-out.
      for (const [k, b] of cells) {
        const piece = pieceOf(b); if (!piece || wallOf(api, b)) continue;
        const c = k.split(',').map(Number), p = F.toScreen(center(c)), an = anims.get(k);
        let s = 1, dy = 0, a = 1;
        if (an && an.kind === 'in') { const t = (H.clock - an.t0) / 0.32; if (t < 1) { s = easeOutBack(t); dy = -(1 - Math.min(1, t * 1.6)) * z * 0.9; } else anims.delete(k); }
        drawPiece(g, piece, p[0], p[1] + dy, z * 0.42 * s, blockColor(b), F, a, c, b);
      }
      for (const [k, an] of anims) {
        if (an.kind !== 'out') continue;
        const t = (H.clock - an.t0) / 0.28; if (t >= 1) { anims.delete(k); continue; }
        const piece = pieceOf(an.block); if (!piece) continue;
        const c = k.split(',').map(Number), p = F.toScreen(center(c));
        g.save(); g.globalAlpha = 1 - t; drawPiece(g, piece, p[0], p[1], z * 0.42 * (1 + t * 0.6), light(blockColor(an.block), t * 0.6), F, 1, c, an.block); g.restore();
        if (t < 0.3) glow(g, p[0], p[1], z * (0.6 + t * 2), '#ffffff', 0.6 * (1 - t / 0.3));
      }
      // Declared block labels (a 2048 tile's number) and the marks primitives publish (crop stages), over cells and pieces.
      for (const [k, b] of cells) { const t = blocks().get(b)?.label; if (t == null || t === '') continue; const c = k.split(',').map(Number), p = F.toScreen(center(c)); drawLabel(g, t, p[0], p[1] - (wallOf(api, b) && !iso && style === 'board' ? config.wallHeight * z : 0), z * 0.42); }
      for (const m of marksOf(rt, space)) { const p = F.toScreen(center(m.at.slice(0, 2))); drawMark(g, m, p[0], p[1], z * 0.45, F.t); }
      // Entities glide between cells with a little hop; drawn back to front.
      const items = F.entities.map(it => {
        let gp = glide.get(it.id);
        const target = center(it.pos);
        if (!gp || Math.hypot(target[0] - gp.p[0], target[1] - gp.p[1]) > 3) gp = { p: target.slice(), from: target.slice(), hop: 0 };
        const d = Math.hypot(target[0] - gp.p[0], target[1] - gp.p[1]);
        if (d > 0.001) { const k = 1 - Math.exp(-(F.realDt || 1 / 60) * 16); gp.p = [lerp(gp.p[0], target[0], k), lerp(gp.p[1], target[1], k)]; gp.hop = Math.min(1, d) * 0.22; } else gp.hop = 0;
        glide.set(it.id, gp);
        return { it, p: gp.p, hop: gp.hop };
      }).sort((a, b) => F.toScreen(a.p)[1] - F.toScreen(b.p)[1]);
      for (const { it, p, hop } of items) {
        const s = F.toScreen(p), size = 0.82 * z;
        const feetY = s[1] + (iso ? size * 0.15 : size * 0.38);
        // Wrap ghosts at the edges keep tunnel moves readable.
        drawEntity(F, it, { x: s[0], y: feetY - hop * z, gx: s[0], gy: feetY, w: size, h: size, view: iso ? 'iso' : 'board', unit: z, lift: hop * 3 });
      }
      if (selected && F.byId.get(selected)) { const s = F.toScreen(center(F.byId.get(selected).pos)); g.strokeStyle = rgba('#ffd23f', 0.8 + 0.2 * Math.sin(F.t * 6)); g.lineWidth = Math.max(1.5, z * 0.06); g.beginPath(); g.ellipse(s[0], s[1] + z * 0.38, z * 0.42, z * 0.16, 0, 0, TAU); g.stroke(); }
    }

    function drawPiece(g, piece, x, y, R, color, F, alpha, c, block) {
      g.save(); g.globalAlpha *= alpha; g.translate(x, y);
      if (piece === 'pellet') { g.fillStyle = light(color, 0.3); g.beginPath(); g.arc(0, 0, Math.max(1.2, R * 0.22), 0, TAU); g.fill(); }
      else if (piece === 'power') { const pulse = 0.75 + 0.25 * Math.sin(F.t * 7 + c[0]); glow(g, 0, 0, R * 1.6 * pulse, color, 0.6); g.fillStyle = light(color, 0.4); g.beginPath(); g.arc(0, 0, R * 0.55 * pulse, 0, TAU); g.fill(); }
      else drawVector(g, piece, R, color, { t: F.t, seed: hash2(c[0], c[1]) * 1000 | 0, idx: Math.max(0, [...blocks().keys()].indexOf(block)), pixel: F.style === 'pixel' });
      g.restore();
    }
  },
};

/** The cell nearest a layout point, or null outside the board. */
export function nearestCell(api, p, W, H, topo) {
  if (!p) return null;
  let best = null, bd = Infinity;
  const r0 = topo === 'hex' ? Math.round(p[1] / (SQ3 / 2)) : Math.round(p[1]), c0 = Math.round(p[0]);
  for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) {
    if (c < 0 || r < 0 || c >= W || r >= H) continue;
    const q = api.cellCenter ? api.cellCenter([c, r]) : [c, r], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) { bd = d; best = [c, r]; }
  }
  return bd <= 0.75 ? best : null;
}
