import { WALK_SPEED, RUN_SPEED, SPAWN, clamp, angleDelta, cameraRelativeInput, moveWithCollision, cameraDistance, smoothCameraDistance } from './neighborhood-math.js';
import { certifyCameraPose, safetyObservations } from './neighborhood-safety.js';
import { StandardGamepadInput } from './gamepad.js';

// World-basis movement for host-granted runs: +z is the world's "north" the
// overworld surface declares, independent of any camera orientation.
const worldDirection = (side, forward) => {
  const length = Math.max(1, Math.hypot(side, forward));
  return { x: side / length, z: forward / length };
};

export class NeighborhoodController {
  constructor(canvas, camera, world, onPause, initialPose, onInteract = () => {}) {
    this.canvas = canvas; this.camera = camera; this.world = world; this.onPause = onPause;
    this.onInteract = onInteract; this.gamepadInput = new StandardGamepadInput();
    this.gamepadState = this.gamepadInput.sample([]);
    const pose = initialPose || SPAWN;
    this.position = { x: pose.x, z: pose.z }; this.yaw = pose.yaw; this.pitch = pose.pitch;
    this.keys = new Set(); this.velocity = { x: 0, z: 0 }; this.distance = 5.2; this.actualDistance = 5.2; this.targetHeight = null;
    this.speed = 0; this.paused = false; this.dragging = false; this.disposed = false; this.heading = 1.1;
    this.executionHold = false;
    this.abort = new AbortController(); const options = { signal: this.abort.signal };
    const movement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];
    window.addEventListener('keydown', event => {
      if (this.paused || event.target.closest?.('button, input, dialog')) return;
      if (movement.includes(event.code)) { event.preventDefault(); if (!event.repeat) this.keys.add(event.code); }
    }, options);
    window.addEventListener('keyup', event => this.keys.delete(event.code), options);
    window.addEventListener('blur', () => this.requestPause(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.requestPause(); }, options);
    window.addEventListener('gamepaddisconnected', event => {
      if (event.gamepad?.index !== this.gamepadState.index) return;
      this.gamepadInput = new StandardGamepadInput(); this.gamepadState = this.gamepadInput.sample([]);
      this.requestPause();
    }, options);
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.paused) return;
      canvas.focus({ preventScroll: true }); this.dragging = true;
      this.lastPointer = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId);
    }, options);
    window.addEventListener('pointerup', () => { this.dragging = false; }, options);
    canvas.addEventListener('pointercancel', () => { this.dragging = false; this.clear(); }, options);
    window.addEventListener('mousemove', event => {
      if (this.paused) return;
      const locked = document.pointerLockElement === canvas;
      if (!locked && !this.dragging) return;
      const dx = locked ? event.movementX : event.clientX - this.lastPointer.x;
      const dy = locked ? event.movementY : event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.yaw -= clamp(dx, -250, 250) * 0.003;
      this.pitch = clamp(this.pitch + clamp(dy, -250, 250) * 0.0025, -0.08, 0.95);
    }, options);
    canvas.addEventListener('wheel', event => {
      event.preventDefault(); if (!this.paused) this.distance = clamp(this.distance + event.deltaY * 0.004, 2.5, 8.5);
    }, { ...options, passive: false });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (this.wasLocked && !locked) this.requestPause();
      this.wasLocked = locked; this.dragging = false;
    }, options);
    this.update(0.016);
  }
  clear() {
    this.keys.clear(); this.velocity.x = this.velocity.z = 0; this.speed = 0; this.dragging = false;
    this.gamepadInput.reset();
    this.gamepadState = { ...this.gamepadState, armed: false, buttons: [], pressed: [], move: { x: 0, y: 0 }, look: { x: 0, y: 0 } };
  }
  requestPause() { this.setPaused(true); this.onPause(true); }
  setPaused(paused) {
    this.paused = paused; this.clear();
    if (paused && document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (!paused) this.canvas.focus({ preventScroll: true });
  }
  update(dt) {
    // `executionHold` is set by the host-facing runtime when a granted run owns
    // the character: the simulation keeps stepping even though the view is
    // paused/hidden. Human input stays cleared while paused.
    if ((this.paused && !this.executionHold) || this.disposed) return;
    // The shell owns menu/GBA polling while this controller is paused.
    this.gamepadState = this.gamepadInput.sample(globalThis.navigator?.getGamepads?.() || []);
    const pad = this.gamepadState;
    if (pad.disconnected || pad.pressed[9]) { this.requestPause(); return; }
    if (pad.pressed[0]) this.onInteract();
    if ((this.paused && !this.executionHold) || this.disposed) return;
    this.yaw -= pad.look.x * dt * 2.4;
    this.pitch = clamp(this.pitch + pad.look.y * dt * 1.6, -0.08, 0.95);
    const held = (...keys) => keys.some(k => this.keys.has(k));
    const humanForward = Number(held('KeyW', 'ArrowUp')) - Number(held('KeyS', 'ArrowDown')) - pad.move.y + Number(!!pad.buttons[12]) - Number(!!pad.buttons[13]);
    const humanSide = Number(held('KeyD', 'ArrowRight')) - Number(held('KeyA', 'ArrowLeft')) + pad.move.x + Number(!!pad.buttons[15]) - Number(!!pad.buttons[14]);
    const humanRunning = held('ShiftLeft', 'ShiftRight') || !!pad.buttons[4];
    // While a host-granted run drives the character, the human keeps the camera:
    // movement input orbits/dollies the spectator boom instead of walking, and
    // look input already only touches the camera. Camera safety is unchanged.
    const driven = this.agentDrive;
    if (driven) {
      this.humanSpectatorInput = Boolean(humanForward || humanSide || pad.look.x || pad.look.y || this.dragging);
      this.yaw -= humanSide * dt * 1.9;
      this.distance = clamp(this.distance - humanForward * dt * 3.4, 2.5, 8.5);
    }
    const forward = driven ? (driven.forward || 0) : humanForward;
    const side = driven ? (driven.side || 0) : humanSide;
    // A granted run steers in world directions. Human input is camera relative,
    // but the spectator boom must never bend the agent's trajectory, so agent
    // movement is resolved against the world basis instead of this.yaw.
    const direction = driven ? worldDirection(side, forward) : cameraRelativeInput(side, forward, this.yaw);
    const running = driven ? Boolean(driven.run) : humanRunning, targetSpeed = running ? RUN_SPEED : WALK_SPEED;
    const smoothing = 1 - Math.exp(-dt * 11);
    this.velocity.x += (direction.x * targetSpeed - this.velocity.x) * smoothing;
    this.velocity.z += (direction.z * targetSpeed - this.velocity.z) * smoothing;
    const next = moveWithCollision(this.position, this.velocity.x * dt, this.velocity.z * dt, this.world.colliders);
    this.speed = Math.hypot(next.x - this.position.x, next.z - this.position.z) / Math.max(dt, 0.001);
    this.position = next;
    if (Math.hypot(this.velocity.x, this.velocity.z) > 0.1) this.heading += angleDelta(this.heading, Math.atan2(this.velocity.x, this.velocity.z)) * (1 - Math.exp(-dt * 12));
    const root = this.world.avatar.root, ground = this.world.heightAt(next.x, next.z);
    root.position.set(next.x, ground, next.z); root.rotation.y = this.heading;
    this.world.avatar.animate(dt, this.speed, running && this.speed > WALK_SPEED);
    this.updateCamera(dt);
  }
  updateCamera(dt = 0) {
    const next = this.position, ground = this.world.heightAt(next.x, next.z), root = this.world.avatar.root;
    // Smooth automatic curb-height changes without lagging horizontal movement
    // (a trailing target could enter the wall the player just walked around).
    const targetY = ground + 1.32;
    this.targetHeight = this.targetHeight === null ? targetY : this.targetHeight + (targetY - this.targetHeight) * (1 - Math.exp(-dt * 14));
    const target = { x: next.x, y: this.targetHeight, z: next.z };
    const boom = { x: Math.sin(this.yaw) * Math.cos(this.pitch), y: Math.sin(this.pitch), z: Math.cos(this.yaw) * Math.cos(this.pitch) };
    // Cover the near-plane corners even in a very wide browser viewport.
    const halfHeight = (this.camera.near || 0.08) * Math.tan((this.camera.fov || 55) * Math.PI / 360);
    const clearance = Math.max(0.25, Math.hypot(halfHeight, halfHeight * (this.camera.aspect || 1)) + 0.06);
    let safeDistance = cameraDistance(target, boom, this.distance, this.world.cameraColliders || this.world.colliders, clearance);
    // Keep the near plane above paving even at the lowest pitch.
    if (boom.y < 0) safeDistance = Math.min(safeDistance, (target.y - 0.45) / -boom.y);
    this.actualDistance = smoothCameraDistance(this.actualDistance, safeDistance, dt);
    // Guard the final products/sums after smoothing, then use precisely the
    // certified XYZ and target; no subsequent floating interpolation can bypass it.
    const proposed = { x: target.x + boom.x * this.actualDistance, y: target.y + boom.y * this.actualDistance, z: target.z + boom.z * this.actualDistance };
    const certified = certifyCameraPose(target, proposed, this.world.cameraColliders || this.world.colliders, clearance);
    this.camera.position.set(certified.position.x, certified.position.y, certified.position.z);
    this.camera.lookAt(certified.target.x, certified.target.y, certified.target.z);
    this.cameraTarget = certified.target;
    this.actualDistance = Math.hypot(certified.position.x - certified.target.x, certified.position.y - certified.target.y, certified.position.z - certified.target.z);
    root.visible = this.actualDistance > 0.85;
  }
  pose() { return { ...this.position, yaw: this.yaw, pitch: this.pitch }; }
  observe() {
    return { ...this.pose(), speed: this.speed, paused: this.paused, disposed: this.disposed,
      camera: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, distance: this.actualDistance, desiredDistance: this.distance },
      safety: safetyObservations(), cameraTarget: { ...this.cameraTarget },
      agentDriven: Boolean(this.agentDrive), spectatorCamera: Boolean(this.agentDrive), humanSpectatorInput: Boolean(this.humanSpectatorInput),
      heldKeys: [...this.keys], pointerLocked: document.pointerLockElement === this.canvas,
      gamepad: { connected: this.gamepadState.connected, index: this.gamepadState.index, id: this.gamepadState.id,
        armed: this.gamepadState.armed, move: { ...this.gamepadState.move }, look: { ...this.gamepadState.look }, buttons: [...this.gamepadState.buttons] } };
  }
  dispose() { this.disposed = true; this.clear(); this.abort.abort(); if (document.pointerLockElement === this.canvas) document.exitPointerLock(); }
}
