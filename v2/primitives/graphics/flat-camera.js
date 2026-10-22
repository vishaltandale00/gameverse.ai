// Camera math for the flat renderers. Pure functions over plain objects, so
// they are unit-tested in Node. A camera holds its center in WORLD units
// (x, y as the space defines them) plus a zoom in CSS pixels per world unit;
// a projection maps world points onto the view plane (v grows downward).
import { clamp, damp, lerp } from './flat-util.js';

/**
 * Projection from world [x, y, z?] to view-plane [u, v] (v down).
 * kind: 'yup' (side and top-down tilemaps, physics2d, arena2d), 'ydown' (grids with rows down),
 * 'iso' (2:1-ish dimetric diamonds; ratio = tan(angle); rot = quarter turns; z lifts).
 */
export function projection(kind = 'yup', { angle = 30, rot = 0, flipY = false, tilt = 90 } = {}) {
  if (kind === 'iso') {
    const ratio = clamp(Math.tan((angle * Math.PI) / 180), 0.3, 1);
    const q = ((Math.round(rot) % 4) + 4) % 4;
    const sy = flipY ? -1 : 1;
    const turn = (x, y) => (q === 0 ? [x, y] : q === 1 ? [-y, x] : q === 2 ? [-x, -y] : [y, -x]);
    const zh = ratio * 1.25;
    const fn = ([x, y, z = 0]) => { const [a, b] = turn(x, y * sy); return [(a - b) * 0.5, (a + b) * 0.5 * ratio - z * zh]; };
    fn.inverse = ([u, v]) => { const s = u * 2, d = (v * 2) / ratio; const a = (s + d) / 2, b = (d - s) / 2; const [x, y] = q === 0 ? [a, b] : q === 1 ? [b, -a] : q === 2 ? [-a, -b] : [-b, a]; return [x, y * sy]; };
    fn.kind = 'iso'; fn.ratio = ratio; fn.rot = q;
    return fn;
  }
  // Top-down tilt squashes depth (90 = straight down).
  const k = clamp(Math.sin((clamp(tilt, 20, 90) * Math.PI) / 180), 0.35, 1);
  if (kind === 'ydown') { const fn = ([x, y]) => [x, y * k]; fn.inverse = ([u, v]) => [u, v / k]; fn.kind = 'ydown'; fn.k = k; return fn; }
  const fn = ([x, y]) => [x, -y * k]; fn.inverse = ([u, v]) => [u, -v / k]; fn.kind = 'yup'; fn.k = k;
  return fn;
}

/** World → screen and back for a camera on a w×h CSS-pixel view. */
export function viewTransform(cam, proj, w, h, shake = [0, 0]) {
  const [uc, vc] = proj([cam.x, cam.y]);
  const z = cam.zoom, rot = cam.rot || 0, cs = Math.cos(rot), sn = Math.sin(rot);
  const toScreen = p => { const [u, v] = proj(p); const du = (u - uc) * z, dv = (v - vc) * z; return [w / 2 + du * cs - dv * sn + shake[0], h / 2 + du * sn + dv * cs + shake[1]]; };
  const toWorld = ([sx, sy]) => { const dx = sx - w / 2 - shake[0], dy = sy - h / 2 - shake[1]; const du = dx * cs + dy * sn, dv = -dx * sn + dy * cs; return proj.inverse([uc + du / z, vc + dv / z]); };
  return { toScreen, toWorld, zoom: z, uc, vc, w, h, shake, rot };
}

/** World-space size of the view for a camera (non-iso projections). */
export function viewSize(cam, proj, w, h) { const k = proj.k || 1; return [w / cam.zoom, h / cam.zoom / k]; }

/** Clamp a center so a view of size `span` stays inside [lo, hi]; centers when the room is smaller than the view. */
export function fitAxis(c, span, lo, hi) {
  if (hi - lo <= span) return (lo + hi) / 2;
  return clamp(c, lo + span / 2, hi - span / 2);
}

/** Pixels per world unit for a tile renderer: crisp integer art scale when pixelSnap, and never fewer than minView tiles. */
export function tileZoom({ tile = 16, scale = 3, zoom = 1, minView = [14, 8], pixelSnap = true }, w, h) {
  let px = tile * scale * zoom;
  const maxPx = Math.min(w / Math.max(1, minView[0]), h / Math.max(1, minView[1]));
  if (px > maxPx) px = maxPx;
  if (pixelSnap && px >= tile) px = Math.max(tile, Math.floor(px / tile) * tile);
  return Math.max(1, px);
}

/** Fit a whole box [x0,y0,x1,y1] in the view with margin (in world units). */
export function fitBox(box, w, h, margin = 0.5, k = 1) {
  const bw = box[2] - box[0] + margin * 2, bh = (box[3] - box[1]) * k + margin * 2;
  return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, zoom: Math.max(0.01, Math.min(w / Math.max(0.01, bw), h / Math.max(0.01, bh))) };
}

/**
 * Side-view follow camera. state: { x, y, look, ready } (mutated and returned).
 * input: { target:[x,y], vel:[vx,vy], facing, grounded, bounds:[x0,y0,x1,y1]|null, view:[vw,vh],
 *          targets?:[[x,y]..] (frame several fighters), zoom (base px per unit), dt }
 * cfg: { lookAhead, smoothing, deadzone:[w,h], risesOnly, verticalBias, frameMargin, minZoom, maxZoom, lookSmoothing }
 */
export function sideCamera(state, input, cfg = {}) {
  const dt = input.dt ?? 1 / 60;
  const [vw0, vh0] = input.view;
  let zoom = input.zoom;
  let tx = input.target[0], ty = input.target[1] + (cfg.verticalBias ?? 0);
  // Fighters: center on the group and zoom out so everyone fits.
  if (input.targets?.length > 1) {
    const xs = input.targets.map(p => p[0]), ys = input.targets.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const m = cfg.frameMargin ?? 3;
    const need = Math.max((x1 - x0 + m * 2) / vw0, (y1 - y0 + m * 2) / vh0, 1);
    zoom = clamp(input.zoom / need, input.zoom * (cfg.minZoom ?? 0.45), input.zoom * (cfg.maxZoom ?? 1));
    tx = (x0 + x1) / 2; ty = Math.max(y0, (y0 + y1) / 2 - (y1 - y0) * 0.1) + (cfg.verticalBias ?? 0);
  }
  const vw = vw0 * (input.zoom / zoom), vh = vh0 * (input.zoom / zoom);
  if (!state.ready) { Object.assign(state, { x: tx, y: ty, look: 0, zoom, ready: true }); }
  // Look-ahead eases toward the facing (or motion) direction, so turning around glides.
  const moving = Math.abs(input.vel?.[0] || 0) > 0.5 ? Math.sign(input.vel[0]) : (input.facing || 0);
  const wantLook = input.targets?.length > 1 ? 0 : moving * (cfg.lookAhead ?? 2);
  state.look = lerp(state.look, wantLook, damp(cfg.lookSmoothing ?? 0.04, dt));
  tx += state.look;
  // Dead zone: the camera only moves once the target leaves the box around the center.
  const [dzw, dzh] = cfg.deadzone || [1, 1.5];
  let gx = state.x, gy = state.y;
  if (tx > gx + dzw / 2) gx = tx - dzw / 2; else if (tx < gx - dzw / 2) gx = tx + dzw / 2;
  // Vertically, snap the platform height when grounded (no bobbing while airborne inside the zone).
  if (input.grounded && !input.targets?.length) gy = lerp(gy, ty, damp(0.08, dt));
  if (ty > gy + dzh / 2) gy = ty - dzh / 2; else if (ty < gy - dzh / 2) gy = ty + dzh / 2;
  if (cfg.risesOnly) gy = Math.max(gy, state.y);
  if (input.bounds) { gx = fitAxis(gx, vw, input.bounds[0], input.bounds[2]); gy = fitAxis(gy, vh, input.bounds[1], input.bounds[3]); }
  const k = damp(cfg.smoothing ?? 0.15, dt);
  state.x = lerp(state.x, gx, k); state.y = lerp(state.y, gy, cfg.risesOnly ? Math.max(k, 0.25) : k);
  state.zoom = lerp(state.zoom ?? zoom, zoom, damp(0.08, dt));
  return state;
}

/** Top-down follow camera with a dead zone and bounds. Same state/input as sideCamera (no look-ahead by default). */
export function topDownCamera(state, input, cfg = {}) {
  const dt = input.dt ?? 1 / 60;
  const [vw, vh] = input.view;
  const lead = cfg.lookAhead ?? 0;
  const v = input.vel || [0, 0], sp = Math.hypot(v[0], v[1]);
  const lx = sp > 0.3 ? (v[0] / sp) * lead : 0, ly = sp > 0.3 ? (v[1] / sp) * lead : 0;
  if (!state.ready) Object.assign(state, { x: input.target[0], y: input.target[1], lx: 0, ly: 0, zoom: input.zoom, ready: true });
  state.lx = lerp(state.lx || 0, lx, damp(0.05, dt)); state.ly = lerp(state.ly || 0, ly, damp(0.05, dt));
  const tx = input.target[0] + state.lx, ty = input.target[1] + state.ly;
  const [dzw, dzh] = cfg.deadzone || [vw * 0.16 * 2, vh * 0.16 * 2];
  let gx = state.x, gy = state.y;
  if (tx > gx + dzw / 2) gx = tx - dzw / 2; else if (tx < gx - dzw / 2) gx = tx + dzw / 2;
  if (ty > gy + dzh / 2) gy = ty - dzh / 2; else if (ty < gy - dzh / 2) gy = ty + dzh / 2;
  if (input.bounds) { gx = fitAxis(gx, vw, input.bounds[0], input.bounds[2]); gy = fitAxis(gy, vh, input.bounds[1], input.bounds[3]); }
  const k = damp(cfg.smoothing ?? 0.14, dt);
  state.x = lerp(state.x, gx, k); state.y = lerp(state.y, gy, k);
  state.zoom = lerp(state.zoom, input.zoom, damp(0.1, dt));
  return state;
}

/** Shake offset in pixels for an amplitude 0..1 at time t (smooth noise, not jitter). */
export function shakeOffset(amount, t, px = 12) {
  if (amount <= 0.001) return [0, 0];
  const a = amount * amount * px;
  return [a * (Math.sin(t * 61.3) * 0.6 + Math.sin(t * 97.1 + 1.3) * 0.4), a * (Math.sin(t * 71.7 + 2.1) * 0.6 + Math.sin(t * 113.9) * 0.4)];
}
