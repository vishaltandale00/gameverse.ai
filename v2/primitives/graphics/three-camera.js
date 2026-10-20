// Shared camera plumbing for graphics.camera.first-person / third-person /
// isometric: one active controller drives the stage camera; look comes from
// the simulation (body.look) when movement keeps it, else from input look
// deltas integrated here (or this module's own pointer-lock mouse when the
// game has no input primitive). The view yaw/pitch is published to the step
// input as axes.camera so movement can be camera-relative deterministically.
// Screen shake / zoom punch come from graphics.fx.feedback (rt.caches.flat.feedback).

export function registerCamera(stage, cam) {
  stage.cameras.push(cam);
  const views = stage.rt.doc.views || {};
  const primary = views.primary || views.default;
  // The document's primary view wins the initial camera.
  if (primary && cam.view === primary) stage.activeCamera = stage.cameras.length - 1;
  wireLook(stage);
  if (!stage.cameraHooked) {
    stage.cameraHooked = true;
    stage.hook('camera', ctx => {
      const active = stage.cameras[stage.activeCamera] || stage.cameras[0];
      if (!active) return;
      if (stage.lastCamera && stage.lastCamera !== active) stage.lastCamera.deactivate?.();
      stage.lastCamera = active;
      stage.firstPerson = active.view === '1p'; stage.isometric = active.view === 'iso';
      active.update(ctx);
      applyFeedback(stage);
    }, 'graphics.camera');
  }
}

/** Ensure a camera exists: renderers call this so a document without a camera still has a good one. */
export function ensureDefaultCamera(stage, make) {
  if (stage.defaultCameraPending) return;
  stage.defaultCameraPending = true;
  stage.hook('pre', () => { if (!stage.cameras.length) make(); }, 'graphics.camera.default');
}

/** View yaw/pitch for the player: sim look when present, else integrated input/mouse look. */
export function viewAngles(stage, player) {
  const look = player?.components?.body?.look;
  if (Array.isArray(look) && Number.isFinite(look[0])) {
    const pose = stage.pose(player.id);
    return { yaw: pose ? pose.yaw : look[0], pitch: look[1] ?? 0, sim: true };
  }
  return { yaw: stage.look.yaw, pitch: stage.look.pitch, sim: false };
}

function wireLook(stage) {
  if (stage.lookWired) return;
  stage.lookWired = true;
  const view = stage.view;
  // Publish the camera's angles into every step's input.
  const orig = view.input;
  view.input = () => {
    const i = (typeof orig === 'function' ? orig() : null) || {};
    return { ...i, axes: { ...(i.axes || {}), camera: [stage.viewYaw, stage.viewPitch] } };
  };
  if (typeof orig === 'function' || typeof document === 'undefined') return; // engine.input.actions owns devices and pointer lock
  // No input primitive: own pointer-lock mouse look so the camera is still usable.
  const canvas = stage.canvas;
  canvas.addEventListener('click', () => { if (!stage.isometric) canvas.requestPointerLock?.(); });
  const onMove = e => {
    if (document.pointerLockElement !== canvas) return;
    stage.look.yaw -= e.movementX * 0.0025; stage.look.pitch = Math.max(-1.45, Math.min(1.45, stage.look.pitch - e.movementY * 0.0025)); stage.look.set = true; stage.look.lastInput = performance.now();
  };
  const onKey = e => {
    if (e.code === 'F5' || e.code === 'KeyV') { if (stage.cameras.length > 1) stage.activeCamera = (stage.activeCamera + 1) % stage.cameras.length; e.preventDefault(); }
    if (stage.isometric && (e.code === 'KeyQ' || e.code === 'KeyE')) stage.isoTurn = (stage.isoTurn || 0) + (e.code === 'KeyQ' ? 1 : -1);
  };
  document.addEventListener('mousemove', onMove);
  addEventListener('keydown', onKey);
  stage.disposers.push(() => { document.removeEventListener('mousemove', onMove); removeEventListener('keydown', onKey); });
}

function applyFeedback(stage) {
  const fb = stage.rt.caches.flat?.feedback;
  const cam = stage.camera;
  if (fb?.shake) {
    const s = fb.shake * 0.25;
    cam.position.x += (fb.shakeX ?? 0) * s; cam.position.y += (fb.shakeY ?? 0) * s;
    cam.rotation.z += (fb.shakeX ?? 0) * fb.shake * 0.02;
  }
  const zoom = fb?.zoom && fb.zoom > 1 ? fb.zoom : 1;
  const fov = (stage.baseFov || 70) / zoom;
  if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
}

export const forwardOf = (yaw, pitch = 0) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];

/** Point the stage camera along yaw/pitch (yaw from +z toward +x; pitch up positive). */
export function orient(cam, yaw, pitch) { cam.rotation.order = 'YXZ'; cam.rotation.set(pitch, yaw + Math.PI, 0); }

/** Distance along a ray before hitting the world: space raycast (cells), else ground sampling + scene meshes. */
export function clearDistance(stage, spaceId, from, dir, max) {
  const api = stage.spaceApi(spaceId);
  let best = max;
  if (api?.raycast) {
    // Space coordinates are metres (cells are integer-aligned metres x cell size).
    const hit = api.raycast(from, dir, max);
    if (hit?.hit && hit.hit !== 'none' && hit.hit !== 'entity' && Number.isFinite(hit.dist)) best = Math.min(best, hit.dist);
  }
  // March against the ground so the camera never dips under terrain.
  for (let t = 0.5; t <= best; t += 0.5) {
    const g = stage.groundAt(spaceId, from[0] + dir[0] * t, from[2] + dir[2] * t);
    if (from[1] + dir[1] * t < g.y + 0.25) { best = Math.max(0.3, t - 0.5); break; }
  }
  if (stage.collidables.size && stage.raycaster) {
    const THREE = stage.THREE;
    stage.raycaster.set(new THREE.Vector3(...from), new THREE.Vector3(...dir)); stage.raycaster.far = best;
    const hits = stage.raycaster.intersectObjects([...stage.collidables].filter(o => o.visible !== false && o.userData.cameraBlocks !== false), true);
    if (hits.length) best = Math.min(best, hits[0].distance);
  }
  return best;
}
