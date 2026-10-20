// The shared three.js stage every graphics.* three primitive joins: one
// WebGLRenderer, scene and camera per view, ordered per-frame phases, pose
// interpolation for entities, the actor (character/prop model) registry, the
// presentation-only animation event bus, adapters other workstreams plug into
// (graphics.particles / post / fx.feedback), and frame/mesh timing stats.
//
// It never writes rt.state. It records entity poses at the end of each step
// (a 'late' system that only reads state) so renderers can interpolate with
// the host's alpha.
import { createModelLibrary } from './three-models.js';
import { bodyBox } from '../../kernel/testing.js';

export const PHASES = ['pre', 'anim', 'camera', 'world', 'render', 'post'];
const TAU = Math.PI * 2;

/** True when this runtime has no browser view to draw into. */
export const presentationOnly = rt => rt.headless || !rt.view?.THREE || !rt.view?.container;

export function joinStage(rt) {
  return rt.caches.three?.renderer ? rt.caches.three : (rt.caches.three = createStage(rt, rt.caches.three));
}

export const lerpAngle = (a, b, t) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return a + d * t; };

/** Yaw (radians, from +z toward +x) of an entity from body.look / body.facing / body.dir / velocity. */
export function yawOf(entity, fallback = 0) {
  const b = entity?.components?.body || {};
  if (Array.isArray(b.look) && Number.isFinite(b.look[0])) return b.look[0];
  if (Number.isFinite(b.facing)) return b.facing;
  if (Array.isArray(b.facing) && b.facing.length >= 2) return Math.atan2(b.facing[0], b.facing[b.facing.length - 1]);
  if (Array.isArray(b.dir) && b.dir.length === 3 && (b.dir[0] || b.dir[2])) return Math.atan2(b.dir[0], b.dir[2]);
  const v = b.vel; if (Array.isArray(v) && v.length === 3 && Math.hypot(v[0], v[2]) > 0.05) return Math.atan2(v[0], v[2]);
  return fallback;
}

function createStage(rt, preset = {}) {
  const view = rt.view, THREE = view.THREE;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'gv-three'; canvas.tabIndex = 0;
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', outline: 'none' });
  view.container.prepend(canvas);
  if (getComputedStyle(view.container).position === 'static') view.container.style.position = 'relative';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8fb4dc');
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2400);
  camera.position.set(0, 2, 5);
  scene.add(camera);
  // Default lights; graphics.sky drives them by hour and weather when present.
  const hemi = new THREE.HemisphereLight('#cfe3ff', '#5a5040', 1.1);
  const sun = new THREE.DirectionalLight('#fff2dc', 2.2);
  sun.position.set(60, 100, 40); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 400 });
  scene.add(hemi, sun, sun.target);

  const hooks = Object.fromEntries(PHASES.map(p => [p, []]));
  const poses = new Map();
  const spaceRoots = new Map();
  let last = 0, displayTime = 0, disposed = false, width = 0, height = 0;

  const stage = {
    THREE, rt, view, renderer, scene, camera, perspCamera: camera, canvas, hemi, sun,
    /** Where streaming and culling centre: the camera, or the followed point for far cameras (isometric). */
    viewCenter() { return stage.isometric ? stage.focus : stage.camera.position; },
    adapters: preset.adapters || {}, rigs: {}, anim: {}, palette: null, cameras: [], activeCamera: 0,
    look: { yaw: 0, pitch: 0, set: false }, viewYaw: 0, viewPitch: 0, firstPerson: false,
    collidables: new Set(), stats: { frames: 0, frameMs: 0, lastFrameMs: 0, meshMs: 0, meshCount: 0, chunks: 0, drawCalls: 0, triangles: 0, actors: 0 },
    time: 0, dt: 0, alpha: 0, activeSpace: null, settings: { drawDistance: 1200, shadows: 'sun' },
    /** Register a per-frame function. phase: pre anim camera world render post. */
    hook(phase, fn, owner = '') { hooks[phase].push({ fn, owner }); },
    /** Group holding everything drawn for one space; shown only while the player is in it. */
    spaceRoot(spaceId) {
      let g = spaceRoots.get(spaceId);
      if (!g) { g = new THREE.Group(); g.name = `space:${spaceId}`; scene.add(g); spaceRoots.set(spaceId, g); }
      return g;
    },
    spaceApi(spaceId) { try { return rt.space(spaceId); } catch { return null; } },
    /** Feet position of an entity in world space, interpolated with alpha. */
    pose(id, alpha = stage.alpha) {
      const p = poses.get(id);
      const e = rt.state.entities[id];
      if (!p) { if (!e) return null; const at = feetOf(e); return { at, yaw: yawOf(e), vel: [0, 0, 0], speed: 0 }; }
      const at = [p.prev[0] + (p.cur[0] - p.prev[0]) * alpha, p.prev[1] + (p.cur[1] - p.prev[1]) * alpha, p.prev[2] + (p.cur[2] - p.prev[2]) * alpha];
      return { at, yaw: lerpAngle(p.prevYaw, p.curYaw, alpha), pitch: p.pitch, vel: p.vel, speed: Math.hypot(p.vel[0], p.vel[2]), grounded: p.grounded, state: p.state, turnRate: p.turnRate };
    },
    feetOf: e => feetOf(e),
    /** Ground under (x, z) in a space: surface capability, else the stage's terrain sampler. */
    groundAt(spaceId, x, z) {
      const sampler = stage.terrainSamplers.get(spaceId);
      if (sampler) return sampler(x, z);
      const api = stage.spaceApi(spaceId);
      if (api?.groundAt) { const g = api.groundAt(x, z); if (g && Number.isFinite(g.y)) return g; }
      return { y: 0, normal: [0, 1, 0] };
    },
    terrainSamplers: new Map(),
    /** Presentation-only animation events (footsteps, swing hit frames) for audio/particles. */
    emitAnim(event, who, data = {}) {
      const detail = { event, who, ...data };
      for (const fn of stage.animListeners) fn(detail);
      view.container.dispatchEvent(new CustomEvent('gv:anim', { detail }));
    },
    animListeners: [],
    resize() {
      const w = view.container.clientWidth || 800, h = view.container.clientHeight || 600;
      if (w === width && h === height) return;
      width = w; height = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); stage.aspect = w / h;
      stage.adapters.$post?.resize?.(w, h);
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const fn of stage.disposers) try { fn(); } catch {}
      scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => x.dispose?.()); });
      renderer.dispose(); canvas.remove();
    },
    disposers: [],
    get disposed() { return disposed; },
  };
  stage.models = createModelLibrary(stage);
  view.container.gvThree = stage;

  function feetOf(e) {
    const at = e.at || [0, 0, 0];
    const api = e.space ? stage.spaceApi(e.space) : null;
    if (at.length === 2) { const g = stage.groundAt(e.space, at[0], at[1]); return [at[0], g.y, at[1]]; }
    // KERNEL_API §3: api.anchor says what `at` means; bodyBox resolves it. Feet = bottom centre of the box.
    if (!api?.anchor || api.anchor === 'feet') return [at[0], at[1] ?? 0, at[2] ?? 0];
    const box = bodyBox(e, api);
    return [(box.min[0] + box.max[0]) / 2, box.min[1], ((box.min[2] ?? 0) + (box.max[2] ?? 0)) / 2];
  }

  // Pose recording: end of every step, read-only.
  const record = () => {
    for (const e of Object.values(rt.state.entities)) {
      const cur = feetOf(e), yaw = yawOf(e, poses.get(e.id)?.curYaw ?? 0), body = e.components?.body || {};
      let p = poses.get(e.id);
      if (!p) { p = { prev: cur, cur, prevYaw: yaw, curYaw: yaw, vel: [0, 0, 0], frame: rt.state.frame, turnRate: 0 }; poses.set(e.id, p); }
      else {
        const jump = Math.hypot(cur[0] - p.cur[0], cur[1] - p.cur[1], cur[2] - p.cur[2]) > 8; // teleports don't smear
        p.prev = jump ? cur : p.cur; p.prevYaw = jump ? yaw : p.curYaw; p.cur = cur;
        const dYaw = lerpAngle(0, yaw - p.curYaw, 1); p.curYaw = yaw;
        p.turnRate = p.turnRate * 0.8 + (dYaw / rt.dt) * 0.2;
      }
      p.vel = Array.isArray(body.vel) && body.vel.length === 3 ? body.vel.slice() : [(p.cur[0] - p.prev[0]) / rt.dt, (p.cur[1] - p.prev[1]) / rt.dt, (p.cur[2] - p.prev[2]) / rt.dt];
      p.grounded = body.grounded ?? (Math.abs(p.vel[1]) < 0.5);
      p.state = body.state; p.pitch = Array.isArray(body.look) ? body.look[1] : 0;
      p.seen = rt.state.frame;
    }
    for (const [id] of poses) if (!rt.state.entities[id]) poses.delete(id);
    // Look input for cameras when the sim keeps no body.look.
    const look = rt.input?.axes?.look;
    if (Array.isArray(look) && (look[0] || look[1])) { stage.look.yaw -= look[0]; stage.look.pitch = Math.max(-1.45, Math.min(1.45, stage.look.pitch - look[1])); stage.look.set = true; }
    if (rt.input?.actions?.swap_camera && stage.cameras.length > 1) stage.activeCamera = (stage.activeCamera + 1) % stage.cameras.length;
  };
  rt.system('late', record, 'graphics.three');
  rt.onRestore(() => { poses.clear(); for (const fn of stage.restoreHooks) fn(); });
  stage.restoreHooks = [];

  const frame = alpha => {
    if (disposed) return;
    if (!canvas.isConnected) { stage.dispose(); return; }
    const t0 = performance.now();
    stage.dt = last ? Math.min(0.1, (t0 - last) / 1000) : 1 / 60; last = t0;
    displayTime += stage.dt; stage.time = displayTime; stage.alpha = alpha;
    stage.resize();
    const player = rt.player();
    stage.activeSpace = player?.space ?? rt.doc.spaces?.[0]?.id;
    for (const [id, g] of spaceRoots) g.visible = id === stage.activeSpace;
    const ctx = { alpha, dt: stage.dt, time: displayTime, player, space: stage.activeSpace };
    for (const phase of PHASES) {
      for (const h of hooks[phase]) h.fn(ctx);
      if (phase === 'camera') fitSunShadow();
    }
    const post = stage.adapters.$post;
    if (post?.render) post.render(ctx); else renderer.render(scene, stage.camera);
    const ms = performance.now() - t0;
    const s = stage.stats; s.frames++; s.lastFrameMs = ms; s.frameMs = s.frameMs ? s.frameMs * 0.95 + ms * 0.05 : ms;
    s.drawCalls = renderer.info.render.calls; s.triangles = renderer.info.render.triangles;
  };
  // Sun shadow box follows the camera focus, snapped to shadow texels so edges don't shimmer.
  stage.sunDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
  stage.focus = new THREE.Vector3();
  stage.shadowExtent = 40;
  const tmp = new THREE.Vector3(), lightSpace = new THREE.Matrix4(), inv = new THREE.Matrix4();
  function fitSunShadow() {
    const mode = stage.settings.shadows;
    sun.castShadow = mode !== 'none' && stage.sunDir.y > -0.05;
    const ext = mode === 'cascade' ? Math.min(160, stage.shadowExtent * 1.6) : stage.shadowExtent;
    const sc = sun.shadow.camera;
    if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.far = ext * 6; sc.updateProjectionMatrix(); }
    const size = mode === 'cascade' ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    // Snap the focus in light space.
    lightSpace.lookAt(tmp.set(0, 0, 0), stage.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0)); inv.copy(lightSpace).invert();
    const texel = (2 * ext) / size;
    tmp.copy(stage.focus).applyMatrix4(inv); tmp.x = Math.round(tmp.x / texel) * texel; tmp.y = Math.round(tmp.y / texel) * texel; tmp.applyMatrix4(lightSpace);
    sun.target.position.copy(tmp);
    sun.position.copy(tmp).addScaledVector(stage.sunDir, ext * 3);
    sun.target.updateMatrixWorld();
  }
  view.onFrame(frame);
  return stage;
}

export { colorOf, hash01 } from './three-util.js';
