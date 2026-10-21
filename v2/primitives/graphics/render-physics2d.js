// graphics.render.physics2d — canvas renderer for engine.space.physics2d.
// Bodies draw as their shapes (circles, boxes, polygons, capsule segments) in
// physical materials (wood grain, stone, glass, metal, ice, rubber, TNT...),
// rotated, with damage cracks from health, impact flashes, motion trails on
// fast bodies and shards/debris when a breakable body is removed. Bodies with a
// model or a character role draw as sprites rotated with the body. Static walls
// and sensors, distance/rope/revolute joints are drawn too.
import { ensureJuice } from './flat-juice.js';
import { hubOf, bindSpace, ORDER, stageProjection, checkBinding } from './flat-stage.js';
import { driveFit, followTarget } from './flat-follow.js';
import { drawEntity, lookOf } from './flat-models.js';
import { paintMaterial, materialFor, materialColors, MATERIALS } from './flat-materials.js';
import { drawBackdrop, defaultLayers } from './flat-backdrop.js';
import { TAU, rgba, col, seedOf, clamp01, lerp, isHex } from './flat-util.js';

const SPRITE_ROLES = new Set(['player', 'enemy', 'boss', 'npc', 'pickup', 'goal', 'hazard', 'mount']);

export default {
  id: 'graphics.render.physics2d',
  card: {
    intent: 'Canvas renderer for physics2d spaces: rotated circles, boxes, polygons and segments in physical materials (wood, stone, glass, metal, ice, rubber, TNT) with damage cracks, impact flashes, trails and break shards; sprite bodies for characters; walls, sensors and joints.',
    views: ['side', 'td'],
    // How it draws its space for each view it serves (v2/verify/directions.js): 'plane' maps the space's axes onto the
    // screen's right and up; 'chase' looks along `forward` with `right` to the right of the screen.
    projection: { side: { kind: 'plane', right: '+x', up: '+y' }, td: { kind: 'plane', right: '+x', up: '+y' } },
    params: {
      materials: { type: 'object', default: {}, open: true, effect: 'archetype id or tag → material (wood, stone, glass, tnt, rock, metal, ice, rubber, ball, plastic)' },
      colors: { type: 'object', default: {}, open: true, effect: 'archetype id → tint hex' },
      wallMaterial: { type: 'string', default: 'rock', options: Object.keys(MATERIALS), effect: 'look of static walls' },
      trails: { type: 'boolean', default: true, effect: 'motion trails behind fast bodies' },
      shards: { type: 'boolean', default: true, effect: 'breakable bodies burst into shards when removed' },
      joints: { type: 'boolean', default: true, effect: 'draw ropes, distance links and pivots' },
      sprites: { type: 'string', default: 'auto', options: ['auto', 'always', 'never'], effect: 'draw bodies with a model or character role as sprites' },
      maxScale: { type: 'number', default: 90, min: 4, max: 400, unit: 'px/m', effect: 'largest zoom' },
    },
    reads: ['content.models', 'content.archetypes'],
  },
  validate(config, doc, ctx, info) {
    const errs = checkBinding(doc, info, 'graphics.render.physics2d', ['engine.space.physics2d']);
    for (const [k, m] of Object.entries(config.materials)) if (!MATERIALS[m]) errs.push({ code: 'flat_material', path: `${info?.path || ''}.with.materials.${k}`, message: `unknown material '${m}'`, hint: Object.keys(MATERIALS).join(', ') });
    for (const [k, c] of Object.entries(config.colors)) if (!isHex(c)) errs.push({ code: 'flat_color', path: `${info?.path || ''}.with.colors.${k}`, message: `'${c}' is not a hex color` });
    return errs;
  },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt), space = bindSpace(rt, instance, ['physics2d']), S = H.stage(space, 'physics2d');
    ensureJuice(rt);
    const apiOf = () => { try { return rt.space(space); } catch { return null; } };
    const trails = new Map(), flashes = new Map();
    H.onReset(() => { trails.clear(); flashes.clear(); });
    const matOf = e => { const arch = rt.archetype(e.archetype) || {}; const tag = (arch.tags || []).find(t => config.materials[t]); return materialFor(arch, e.components?.body || {}, config.materials[e.archetype] || config.materials[tag]); };
    rt.on('impact', ev => { for (const id of [ev.a, ev.b]) if (typeof id === 'string') flashes.set(id, { t0: H.clock, k: clamp01((ev.impulse || 1) / 6) }); });
    rt.on('despawn', ev => {
      if (!config.shards || !H.particles) return;
      const last = H.lastSeen.get(ev.id); if (!last || last.space !== space) return;
      const mat = matOf(last), c = materialColors(mat, config.colors[last.archetype]);
      if (['glass', 'ice', 'wood', 'stone', 'tnt', 'plastic'].includes(mat)) H.particles.emit({ shape: mat === 'glass' || mat === 'ice' ? 'shard' : 'debris', color: c.base, count: mat === 'tnt' ? 24 : 12, life: 0.9, speed: mat === 'tnt' ? 10 : 5, gravity: 14 }, last.at, space);
      if (mat === 'tnt') H.particles.emit({ shape: 'smoke', color: '#5a4a48', count: 10, life: 1.2, speed: 2, gravity: -0.5 }, last.at, space);
    });
    S.renderer = {
      prepare: () => stageProjection(H, S, 'yup'),
      baseZoom: F => { const api = apiOf(); const [W, Hh] = api?.size || [20, 12]; return Math.min(config.maxScale, F.w / W, F.h / Hh); },
      camera(F, cam) {
        const api = apiOf(); const [W, Hh] = api?.size || [20, 12];
        const T = followTarget(F, 'player');
        // Worlds wider than a readable view follow the player along the long axis.
        if (T && (W / Hh > (F.w / F.h) * 1.6 || Hh / W > (F.h / F.w) * 1.6)) {
          const zoom = Math.min(config.maxScale, W / Hh > F.w / F.h ? F.h / (Hh + 0.5) : F.w / (W + 0.5));
          const vw = F.w / zoom, vh = F.h / zoom;
          const tx = Math.min(Math.max(T.pos[0] + (T.vel[0] || 0) * 0.3, vw / 2), W - vw / 2), ty = Math.min(Math.max(T.pos[1], vh / 2), Hh - vh / 2);
          if (!cam.ready) Object.assign(cam, { x: tx, y: ty, zoom, ready: true });
          const k = 1 - Math.exp(-(F.realDt || 1 / 60) * 5); cam.x = lerp(cam.x, tx, k); cam.y = lerp(cam.y, ty, k); cam.zoom = zoom;
        } else driveFit(F, cam, [0, 0, W, Hh], config.maxScale, 0.3);
      },
    };
    H.layer(ORDER.background, F => { if (H.cfg.backgrounds?.has(space)) return; S.defaultLayers ??= defaultLayers(F.doc, 'side'); drawBackdrop(F, S.defaultLayers); }, { space, name: 'physics2d.backdrop' });
    H.layer(ORDER.world, F => draw(F), { space, name: 'render.physics2d' });

    function draw(F) {
      const api = apiOf(); if (!api) return;
      const g = F.ctx, z = F.unit;
      // Static walls.
      for (const w of api.walls?.() || []) {
        if (String(w.id).startsWith('edge:')) continue;
        const mat = w.sensor ? null : config.wallMaterial;
        const pts = w.points ? w.points.map(F.toScreen) : null, c = F.toScreen(w.at), R = Math.max(2, (w.r || 0.3) * z);
        if (w.sensor) { g.save(); if (pts) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); } else { g.beginPath(); g.arc(c[0], c[1], R, 0, TAU); } g.fillStyle = rgba('#7af0ff', 0.12 + 0.05 * Math.sin(F.t * 3)); g.fill(); g.setLineDash?.([6, 6]); g.strokeStyle = rgba('#7af0ff', 0.5); g.lineWidth = 1.5; g.stroke(); g.restore(); continue; }
        if (w.kind === 'seg' && pts?.length === 2) { g.save(); g.lineCap = 'round'; g.strokeStyle = materialColors(mat).dark; g.lineWidth = Math.max(3, (w.r || 0.08) * 2 * z + 2); g.beginPath(); g.moveTo(...pts[0]); g.lineTo(...pts[1]); g.stroke(); g.strokeStyle = materialColors(mat).base; g.lineWidth = Math.max(1.5, (w.r || 0.08) * 2 * z - 1); g.stroke(); g.restore(); continue; }
        const xs = pts ? pts.map(p => p[0]) : [c[0]], ys = pts ? pts.map(p => p[1]) : [c[1]];
        const bw = pts ? Math.max(...xs) - Math.min(...xs) : R * 2, bh = pts ? Math.max(...ys) - Math.min(...ys) : R * 2;
        paintMaterial(g, () => { g.beginPath(); if (pts) { pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); } else g.arc(c[0], c[1], R, 0, TAU); }, { mat, cx: c[0], cy: c[1], R: Math.max(bw, bh) / 2, angle: -(w.angle || 0), seed: seedOf(String(w.id)), w: bw, h: bh, circle: !pts });
      }
      // Joints under the bodies.
      if (config.joints) for (const j of api.joints?.() || []) {
        const a = F.toScreen(j.anchorA), b = F.toScreen(j.anchorB);
        g.save(); g.lineCap = 'round';
        if (j.kind === 'revolute') { g.fillStyle = '#c9d0da'; g.strokeStyle = '#3a3f4b'; g.lineWidth = 1.5; g.beginPath(); g.arc(a[0], a[1], Math.max(3, z * 0.09), 0, TAU); g.fill(); g.stroke(); }
        else { const d = Math.hypot(b[0] - a[0], b[1] - a[1]), sag = j.kind === 'rope' ? Math.min(30, d * 0.08) : 0; g.strokeStyle = j.kind === 'rope' ? '#b08a5a' : '#9aa3b0'; g.lineWidth = Math.max(1.5, z * 0.04); g.beginPath(); g.moveTo(...a); g.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag, b[0], b[1]); g.stroke(); for (const p of [a, b]) { g.fillStyle = '#5a5f6b'; g.beginPath(); g.arc(p[0], p[1], Math.max(2, z * 0.05), 0, TAU); g.fill(); } }
        g.restore();
      }
      // Bodies.
      for (const it of F.entities) {
        const e = it.e, b = e.components?.body || {}, shape = b.shape || { kind: 'box', w: b.size?.[0] ?? 1, h: b.size?.[1] ?? 1 };
        const ang = b.angle || 0, c = F.toScreen(it.pos);
        const L = lookOf(H, e, 'side');
        const asSprite = config.sprites === 'always' || (config.sprites === 'auto' && (SPRITE_ROLES.has(L.role) || !String(L.key).endsWith('#auto')));
        // Trails behind fast bodies.
        const speed = Math.hypot(...(b.vel || [0, 0]).slice(0, 2));
        if (config.trails && !F.reduced) {
          const tr = trails.get(it.id) || []; if (speed > 6) tr.push([it.pos[0], it.pos[1]]); else tr.shift();
          while (tr.length > 10) tr.shift(); trails.set(it.id, tr);
          if (tr.length > 1) { g.save(); g.lineCap = 'round'; for (let k = 1; k < tr.length; k++) { const p0 = F.toScreen(tr[k - 1]), p1 = F.toScreen(tr[k]); g.strokeStyle = rgba('#ffffff', (k / tr.length) * 0.35); g.lineWidth = (shape.r || 0.3) * 2 * z * (k / tr.length); g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke(); } g.restore(); }
        }
        if (asSprite && !it.ghost) {
          const size = shape.kind === 'circle' ? [shape.r * 2, shape.r * 2] : b.size || [1, 1];
          // Sprites pivot at their center, so draw with the feet offset rotated.
          g.save(); g.translate(c[0], c[1]); g.rotate(-ang); g.translate(-c[0], -c[1]);
          drawEntity(F, it, { x: c[0], y: c[1] + size[1] * z / 2, w: size[0] * z, h: size[1] * z, view: 'side', unit: z, shadow: false });
          g.restore(); continue;
        }
        if (it.ghost) continue;
        const mat = matOf(e), colors = materialColors(mat, config.colors[e.archetype] || e.components?.model?.color);
        const hp = e.components?.health, damage = hp && hp.max > 0 ? 1 - Math.max(0, hp.hp ?? hp.max) / hp.max : 0;
        const fl = flashes.get(it.id), flash = fl ? clamp01(1 - (H.clock - fl.t0) / 0.15) * (0.4 + fl.k * 0.6) : 0;
        const rot = p => { const cs = Math.cos(ang), sn = Math.sin(ang); return [it.pos[0] + cs * p[0] - sn * p[1], it.pos[1] + sn * p[0] + cs * p[1]]; };
        let build, R, w, h, circle = false;
        if (shape.kind === 'circle') { R = shape.r * z; w = h = R * 2; circle = true; build = () => { g.beginPath(); g.arc(c[0], c[1], R, 0, TAU); }; }
        else if (shape.kind === 'seg') { const a = F.toScreen([it.pos[0] + shape.a[0], it.pos[1] + shape.a[1]]), bb = F.toScreen([it.pos[0] + shape.b[0], it.pos[1] + shape.b[1]]); g.save(); g.lineCap = 'round'; g.strokeStyle = colors.dark; g.lineWidth = Math.max(3, (shape.r || 0.1) * 2 * z + 2); g.beginPath(); g.moveTo(...a); g.lineTo(...bb); g.stroke(); g.strokeStyle = colors.base; g.lineWidth = Math.max(2, (shape.r || 0.1) * 2 * z - 1); g.stroke(); g.restore(); continue; }
        else {
          const local = shape.kind === 'poly' ? shape.points : [[-(shape.w ?? 1) / 2, -(shape.h ?? 1) / 2], [(shape.w ?? 1) / 2, -(shape.h ?? 1) / 2], [(shape.w ?? 1) / 2, (shape.h ?? 1) / 2], [-(shape.w ?? 1) / 2, (shape.h ?? 1) / 2]];
          const pts = local.map(p => F.toScreen(rot(p)));
          w = (shape.w ?? Math.max(...local.map(p => p[0])) - Math.min(...local.map(p => p[0]))) * z; h = (shape.h ?? Math.max(...local.map(p => p[1])) - Math.min(...local.map(p => p[1]))) * z;
          R = Math.max(w, h) / 2;
          build = () => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); };
        }
        paintMaterial(g, build, { mat, colors, cx: c[0], cy: c[1], R, angle: -ang, seed: seedOf(it.id), damage, flash, circle, w, h });
      }
    }
  },
};
