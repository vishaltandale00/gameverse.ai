// The flat stage: shared presentation hub for every 2D canvas primitive.
// One hub per runtime lives in rt.caches.flat (non-JSON, never in rt.state).
// It owns one canvas per bound space, the display-frame loop, entity
// interpolation, presentation-only animation trackers (hurt/attack/land...),
// despawn ghosts (death pops, pickup flights) and the ordered draw layers that
// renderers, cameras, backgrounds, lighting, particles, feedback and post add.
//
// Layer order: 0 background · 100 world · 150 particles · 300 lighting ·
// 350 glow particles · 400 feedback flashes · 450 popups · 500 post.
import { DT } from '../../kernel/world.js';
import { projection, viewTransform, shakeOffset } from './flat-camera.js';
import { clamp, lerp, prefersReducedMotion, FONTS } from './flat-util.js';

export const ORDER = { background: 0, world: 100, particles: 150, lighting: 300, glow: 350, feedback: 400, popups: 450, post: 500 };
const SPACE_KIND = { 'engine.space.tilemap': 'tilemap', 'engine.space.grid': 'grid', 'engine.space.physics2d': 'physics2d', 'engine.space.arena2d': 'arena2d', 'engine.space.track': 'track', 'engine.space.graph': 'graph', 'engine.space.none': 'none' };
export const kindOfSpace = s => SPACE_KIND[s?.use] || (s?.use || '').replace(/^engine\.space\./, '');

/** Space id a renderer of `kinds` binds to: the instance's space, else the first space of a matching kind. */
export function bindSpace(rt, instance, kinds) {
  const spaces = rt.doc.spaces || [];
  if (instance?.space) return instance.space;
  return (spaces.find(s => kinds.includes(kindOfSpace(s))) || spaces[0])?.id ?? null;
}
/** Space id a non-renderer flat primitive binds to: the instance's space, else the first space with a flat stage kind. */
export function bindAny(rt, instance) {
  if (instance?.space) return instance.space;
  const flat = ['tilemap', 'grid', 'physics2d', 'arena2d', 'track'];
  return ((rt.doc.spaces || []).find(s => flat.includes(kindOfSpace(s))) || rt.doc.spaces?.[0])?.id ?? null;
}
/** The stage projection for a renderer's default kind, merged with camera options (tilt, iso angle, rotation). */
export function stageProjection(H, S, kind, extra = {}) {
  const o = { ...(H.projOpts.get(S.space) || {}), ...extra }, k = o.kind || kind, key = JSON.stringify([k, o]);
  if (S.projKey !== key) { S.proj = projection(k, o); S.projKey = key; }
  return S.proj;
}
/** Normalize space bounds: {min,max,wrap} or [x0,y0,x1,y1] → {min,max,wrap}. */
export function boundsOf(api) {
  const b = typeof api?.bounds === 'function' ? api.bounds() : null;
  if (Array.isArray(b)) return { min: [b[0], b[1]], max: [b[2], b[3]], wrap: [false, false] };
  if (b?.min) return { min: b.min, max: b.max, wrap: b.wrap || [false, false] };
  const s = api?.size;
  return s ? { min: [0, 0], max: [s[0], s[1]], wrap: [false, false] } : null;
}

/** Entity ids an event is about: the victim (hurt/hit/defeated) or the actor (attack/jump). */
export function subjectOf(ev, role = 'actor') {
  const keys = role === 'victim' ? ['target', 'victim', 'who', 'entity', 'id'] : ['who', 'attacker', 'source', 'by', 'entity', 'id'];
  for (const k of keys) if (typeof ev?.[k] === 'string') return ev[k];
  return null;
}

const VICTIM = /^(hurt|damaged|damage|hit|stomped|stunned|knockback)$/;
const ACTOR = { attack: 'attack', attacked: 'attack', swing: 'attack', melee: 'attack', strike: 'attack', shoot: 'attack', shot: 'attack', fire: 'attack', fired: 'attack', cast: 'attack', throw: 'attack', dash: 'dash', dashed: 'dash', jump: 'jump', jumped: 'jump', land: 'land', landed: 'land', stomp: 'attack', flap: 'jump' };
const DIED = /^(defeated|died|death|killed|destroyed|ko)$/;
const COLLECTED = /^(collect|collected|item_gained|picked_up|pickup)$/;

export function hubOf(rt) {
  if (rt.caches.flat) return rt.caches.flat;
  const view = rt.view;
  const H = {
    rt, view, stages: new Map(), layers: [], cfg: {}, cameras: new Map(), highlights: new Map(), projOpts: new Map(),
    prev: new Map(), trackers: new Map(), ghosts: [], lastSeen: new Map(), resets: [], updaters: [], adapters3d: [],
    feedback: { shake: 0, shakeX: 0, shakeY: 0, flash: 0, flashColor: '#ffffff', hitStop: 0, slowmo: 1, zoom: 1 },
    clock: 0, wall: null, reduced: prefersReducedMotion(), errors: new Set(), frameNo: 0,
    get style() { return styleOf(rt); },
    get font() { return styleOf(rt) === 'pixel' ? FONTS.pixel : FONTS.rounded; },
    layer(order, fn, { space = null, name = '' } = {}) { H.layers.push({ order, fn, space, name }); H.layers.sort((a, b) => a.order - b.order); },
    onReset(fn) { H.resets.push(fn); },
    update(fn) { H.updaters.push(fn); },
    tracker(id) {
      let t = H.trackers.get(id);
      if (!t) H.trackers.set(id, t = { hurt: -9, attack: -9, dash: -9, jump: -9, land: -9, died: -9, collected: -9, born: H.clock, squash: 0, squashV: 0, grounded: null, facing: 1, trail: [], last: null, speed: 0, dir: [1, 0] });
      return t;
    },
    stage(space, kind) {
      let s = H.stages.get(space);
      if (!s) H.stages.set(space, s = makeStage(H, space, kind));
      return s;
    },
    highlight(space, key, cells, style = {}) { if (!H.highlights.has(space)) H.highlights.set(space, new Map()); if (cells?.length) H.highlights.get(space).set(key, { cells, ...style }); else H.highlights.get(space).delete(key); },
    activeSpace() { const p = rt.player(); return p?.space && H.stages.has(p.space) ? p.space : [...H.stages.keys()][0] ?? null; },
    /** Last known position and archetype of an entity, including just-despawned ones. */
    seen(id) { const e = rt.entity(id); return e ? { id, at: e.at, archetype: e.archetype, space: e.space, components: e.components } : H.lastSeen.get(id) || null; },
  };
  rt.caches.flat = H;
  // Positions at the start of each step: the previous frame's state for interpolation.
  rt.system('input', () => { H.prev.clear(); for (const e of Object.values(rt.state.entities)) if (Array.isArray(e.at)) H.prev.set(e.id, e.at.slice()); }, 'graphics.flat');
  rt.onRestore(() => { H.prev.clear(); H.ghosts.length = 0; H.trackers.clear(); for (const fn of H.resets) fn('restore'); });
  rt.on('content_added', () => { for (const fn of H.resets) fn('content'); });
  rt.on('*', ev => onEvent(H, ev));
  if (view?.onFrame) view.onFrame(alpha => H.frame(alpha));
  H.frame = alpha => frame(H, alpha);
  return H;
}

function styleOf(rt) {
  const doc = rt.doc;
  if (doc._flatStyle) return doc._flatStyle;
  const pixel = (doc.graphics || []).some(g => /graphics\.(tileset|sprite)\.pixel/.test(g.use)) || Object.values(doc.content?.models || {}).some(m => m?.kind === 'pixel') || /pixel|8-bit|16-bit|retro/i.test(`${doc.art?.style || ''} ${doc.style || ''}`);
  return pixel ? 'pixel' : 'vector';
}

function onEvent(H, ev) {
  const name = String(ev.name || ''), base = name.split(':')[0];
  if (name.includes(':') && base !== name) return; // typed duplicates carry the same subject
  const now = H.clock;
  if (VICTIM.test(base)) { const id = subjectOf(ev, 'victim'); if (id) { const t = H.tracker(id); t.hurt = now; } }
  if (ACTOR[base]) { const id = subjectOf(ev, 'actor'); if (id) { const t = H.tracker(id); t[ACTOR[base]] = now; if (typeof (ev.move ?? ev.attack) === 'string') t.move = ev.move ?? ev.attack; if (base === 'land' || base === 'landed') t.squashV -= 6; if (ACTOR[base] === 'jump') t.squashV += 5; } }
  if (DIED.test(base)) { const id = subjectOf(ev, 'victim'); if (id) H.tracker(id).died = now; }
  if (COLLECTED.test(base)) { const id = typeof ev.source === 'string' ? ev.source : typeof ev.pickup === 'string' ? ev.pickup : null; if (id) H.tracker(id).collected = now; }
  if (base === 'despawn' && ev.id) {
    const last = H.lastSeen.get(ev.id); const t = H.trackers.get(ev.id);
    if (last) {
      const arch = H.rt.archetype(last.archetype);
      const kind = arch?.kind || '';
      const cause = t && now - t.died < 0.6 ? 'die' : t && now - t.collected < 0.6 ? 'collect' : /pickup|item|collectible|coin/.test(kind) || last.components?.item ? 'collect' : last.components?.health ? 'die' : 'fade';
      H.ghosts.push({ e: structuredClone({ id: last.id, archetype: last.archetype, at: last.at, space: last.space, components: last.components }), t0: now, cause, dur: cause === 'die' ? 0.55 : 0.4 });
    }
  }
}

function makeStage(H, space, kind) {
  const doc = typeof document !== 'undefined' ? document : null;
  const canvas = doc?.createElement ? doc.createElement('canvas') : null;
  if (canvas) {
    canvas.className = `gv-flat gv-flat-${kind}`;
    Object.assign(canvas.style || {}, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none' });
    H.view?.container?.append?.(canvas);
  }
  const S = {
    space, kind, canvas, ctx: canvas?.getContext?.('2d') || null, w: 0, h: 0, dpr: 1,
    cam: { x: 0, y: 0, zoom: 32, ready: false }, proj: projection('yup'), pointer: null, clicks: [],
    renderer: null, // { camera(frame) default camera, size?(entity) }
    frozen: null,
  };
  if (canvas?.addEventListener) {
    const at = e => { const r = canvas.getBoundingClientRect?.() || { left: 0, top: 0 }; return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointermove', e => { S.pointer = at(e); });
    canvas.addEventListener('pointerleave', () => { S.pointer = null; });
    canvas.addEventListener('pointerdown', e => { S.pointer = at(e); S.clicks.push(at(e)); });
  }
  return S;
}

function resize(S) {
  const c = S.canvas; if (!c) return;
  const box = c.parentElement || c.parentNode;
  const w = Math.max(1, Math.round(box?.clientWidth || c.clientWidth || 960)), h = Math.max(1, Math.round(box?.clientHeight || c.clientHeight || 540));
  const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
  if (w !== S.w || h !== S.h || dpr !== S.dpr) { S.w = w; S.h = h; S.dpr = dpr; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
}

/** Interpolated entities of a space, plus despawn ghosts still animating. */
function entitiesOf(H, S, alpha) {
  const rt = H.rt, out = [];
  for (const e of Object.values(rt.state.entities)) {
    if (e.space !== S.space || !Array.isArray(e.at)) continue;
    const p = H.prev.get(e.id), at = e.at;
    let pos = at;
    if (p && p.length === at.length) {
      const jump = Math.hypot(at[0] - p[0], (at[1] ?? 0) - (p[1] ?? 0));
      pos = jump > 4 ? at.slice() : at.map((v, i) => lerp(p[i], v, alpha));
    }
    out.push({ e, id: e.id, pos, vel: e.components?.body?.vel || (p ? at.map((v, i) => (v - p[i]) / DT) : [0, 0]) });
    H.lastSeen.set(e.id, { id: e.id, at: at.slice(), archetype: e.archetype, space: e.space, components: e.components });
  }
  for (const g of H.ghosts) if (g.e.space === S.space) out.push({ e: g.e, id: g.e.id, pos: g.e.at, vel: [0, 0], ghost: g, k: clamp((H.clock - g.t0) / g.dur, 0, 1) });
  return out;
}

function frame(H, alpha) {
  const now = typeof performance !== 'undefined' ? performance.now() / 1000 : H.clock + 1 / 60;
  const realDt = H.wall == null ? 1 / 60 : clamp(now - H.wall, 0, 0.1);
  H.wall = now; H.frameNo++;
  const fb = H.feedback;
  const dt = realDt * (fb.slowmo || 1) * (fb.hitStop > 0 ? 0.05 : 1);
  H.clock += dt;
  H.realDt = realDt; H.realClock = (H.realClock || 0) + realDt;
  for (const fn of H.updaters) safe(H, 'update', () => fn(realDt));
  H.ghosts = H.ghosts.filter(g => H.clock - g.t0 < g.dur);
  const active = H.activeSpace();
  for (const [id, S] of H.stages) if (S.canvas?.style) S.canvas.style.display = id === active ? 'block' : 'none';
  const S = H.stages.get(active);
  if (!S?.ctx) return;
  resize(S);
  const rt = H.rt, g = S.ctx;
  g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  g.imageSmoothingEnabled = H.style !== 'pixel';
  const player = rt.player();
  const F = {
    hub: H, stage: S, ctx: g, w: S.w, h: S.h, dpr: S.dpr, alpha, dt, realDt, t: H.clock,
    simT: rt.state.time + alpha * DT, reduced: H.reduced, player: player?.space === S.space ? player : null,
    style: H.style, font: H.font, doc: rt.doc, rt,
  };
  // Hit-stop freezes the displayed world; it resumes from the live state afterwards.
  if (fb.hitStop > 0) { S.frozenList ??= entitiesOf(H, S, alpha); F.entities = S.frozenList; }
  else {
    // After a hit-stop the world eases from the frozen pose back to the live one (no pop).
    if (S.frozenList) { S.thaw = { at: new Map(S.frozenList.map(x => [x.id, x.pos])), t0: H.realClock ?? 0 }; S.frozenList = null; }
    F.entities = entitiesOf(H, S, alpha);
    if (S.thaw) {
      const k = clamp(((H.realClock ?? 0) - S.thaw.t0) / 0.09, 0, 1);
      if (k >= 1) S.thaw = null;
      else for (const x of F.entities) { const f = S.thaw.at.get(x.id); if (f && f.length === x.pos.length) x.pos = x.pos.map((v, i) => lerp(f[i], v, k)); }
    }
  }
  F.byId = new Map(F.entities.map(x => [x.id, x]));
  F.playerPos = F.player ? F.byId.get('player')?.pos : null;
  F.zone = F.player?.zone ?? null;
  // Camera: a camera primitive bound to this space, else the renderer's default.
  if (S.renderer?.prepare) safe(H, 'prepare', () => S.renderer.prepare(F));
  F.proj = S.proj;
  const camFn = H.cameras.get(S.space) || S.renderer?.camera;
  if (camFn) safe(H, 'camera', () => camFn(F, S.cam));
  const zoomPunch = fb.zoom || 1;
  const cam = zoomPunch === 1 ? S.cam : { ...S.cam, zoom: S.cam.zoom * zoomPunch };
  const shake = H.reduced ? [0, 0] : shakeOffset(fb.shake, H.clock, Math.min(S.w, S.h) * 0.035);
  fb.shakeX = shake[0]; fb.shakeY = shake[1];
  F.cam = cam; F.proj = S.proj; F.X = viewTransform(cam, S.proj, S.w, S.h, shake); F.unit = cam.zoom;
  F.toScreen = F.X.toScreen; F.toWorld = F.X.toWorld;
  g.clearRect(0, 0, S.w, S.h);
  for (const L of H.layers) if (L.space == null || L.space === S.space) safe(H, L.name || `layer${L.order}`, () => L.fn(F));
  S.clicks.length = 0;
  H.lastFrame = F;
}

function safe(H, what, fn) {
  try { fn(); } catch (err) { if (!H.errors.has(what)) { H.errors.add(what); console.error(`[flat] ${what} failed`, err); } }
}
