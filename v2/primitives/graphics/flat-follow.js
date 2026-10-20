// Camera drivers: connect the pure camera math (flat-camera) to a frame —
// pick the follow target, its room or zone bounds, the base zoom and the view
// size, then update the stage camera in place. Used as renderer defaults and
// by the camera primitives with their own params.
import { sideCamera, topDownCamera, fitBox, viewSize, fitAxis } from './flat-camera.js';
import { boundsOf } from './flat-stage.js';
import { lerp, damp } from './flat-util.js';

/** The followed entity: cfg.target (entity id, archetype or tag) or the player; else null. */
export function followTarget(F, target) {
  const list = F.entities.filter(x => !x.ghost);
  let it = null;
  if (target && target !== 'player') it = list.find(x => x.id === target) || list.find(x => x.e.archetype === target) || list.find(x => F.rt.archetype(x.e.archetype)?.tags?.includes(target));
  it ||= F.byId.get('player') || null;
  if (!it) return null;
  const b = it.e.components?.body || {};
  return { pos: it.pos, vel: it.vel || [0, 0], facing: b.facing || 0, grounded: b.grounded, size: b.size || [1, 1], item: it };
}

/** Rects [x0,y0,x1,y1] of rooms (generator rooms, then zones) in a space. */
export function roomsOf(F) {
  const S = F.stage;
  if (S.rooms && S.roomsDoc === F.doc) return S.rooms;
  const sp = F.doc.spaces.find(s => s.id === S.space) || {};
  const rooms = [];
  for (const g of sp.generators || []) for (const r of g.with?.rooms || []) if (Array.isArray(r.rect) && r.rect.length === 4) rooms.push({ id: r.id, rect: r.rect, zone: r.zone });
  for (const z of sp.zones || []) if (Array.isArray(z.rect) && z.rect.length === 4) rooms.push({ id: z.id, rect: z.rect, zone: z.id, isZone: true });
  S.rooms = rooms; S.roomsDoc = F.doc;
  return rooms;
}
/** The smallest room containing p, or null. */
export function roomAt(F, p) {
  let best = null, area = Infinity;
  for (const r of roomsOf(F)) {
    const [x0, y0, x1, y1] = r.rect;
    if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) { const a = (x1 - x0) * (y1 - y0); if (a < area) { best = r; area = a; } }
  }
  return best;
}
/** Bounds the camera keeps inside: the room (when roomLock) else the whole space. */
export function cameraBounds(F, p, roomLock = true) {
  let api = null; try { api = F.rt.space(F.stage.space); } catch { /* space not installed */ }
  const b = boundsOf(api);
  const room = roomLock && p ? roomAt(F, p) : null;
  if (room) return room.rect;
  if (b && !(b.wrap?.[0] && b.wrap?.[1])) return [b.wrap?.[0] ? -Infinity : b.min[0], b.wrap?.[1] ? -Infinity : b.min[1], b.wrap?.[0] ? Infinity : b.max[0], b.wrap?.[1] ? Infinity : b.max[1]];
  return null;
}

/** Side-view follow (platformers, fighters, climbers). cfg from graphics.camera.side or defaults. */
export function driveSide(F, cam, cfg = {}, baseZoom = 32) {
  const T = followTarget(F, cfg.target);
  const zoom = baseZoom * (cfg.zoom ?? 1);
  if (!T) { cam.zoom = zoom; return cam; }
  const view = viewSize({ zoom }, F.proj, F.w, F.h);
  const targets = cfg.frameTargets?.length ? F.entities.filter(x => !x.ghost && cfg.frameTargets.some(t => t === x.id || t === x.e.archetype || F.rt.archetype(x.e.archetype)?.tags?.includes(t))).map(x => x.pos) : null;
  const bounds = cameraBounds(F, T.pos, cfg.roomLock !== false);
  sideCamera(cam, { target: T.pos, vel: T.vel, facing: T.facing, grounded: T.grounded !== false, bounds, view, zoom, targets, dt: F.realDt }, cfg);
  return cam;
}
/** Top-down follow with dead zone. */
export function driveTopDown(F, cam, cfg = {}, baseZoom = 32) {
  const T = followTarget(F, cfg.target);
  const zoom = baseZoom * (cfg.zoom ?? 1);
  if (cfg.follow === false || !T) return driveFit(F, cam, null, zoom);
  const view = viewSize({ zoom }, F.proj, F.w, F.h);
  const dz = cfg.deadzone || [view[0] * 0.25, view[1] * 0.25];
  topDownCamera(cam, { target: T.pos, vel: T.vel, bounds: cameraBounds(F, T.pos, cfg.roomLock === true), view, zoom, dt: F.realDt }, { ...cfg, deadzone: dz });
  return cam;
}
/** Fit a box (default: the whole space) in view, easing toward it. zoomCap limits px per unit. */
export function driveFit(F, cam, box = null, zoomCap = Infinity, margin = 0.6) {
  let api = null; try { api = F.rt.space(F.stage.space); } catch { /* */ }
  const b = box || (() => { const bb = boundsOf(api); return bb ? [bb.min[0], bb.min[1], bb.max[0], bb.max[1]] : [0, 0, 16, 9]; })();
  const want = fitBox(b, F.w, F.h, margin, F.proj.k || 1);
  want.zoom = Math.min(want.zoom, zoomCap);
  if (!cam.ready) Object.assign(cam, want, { ready: true });
  const k = damp(0.12, F.realDt || 1 / 60);
  cam.x = lerp(cam.x, want.x, k); cam.y = lerp(cam.y, want.y, k); cam.zoom = lerp(cam.zoom, want.zoom, k);
  return cam;
}
export { fitAxis };
