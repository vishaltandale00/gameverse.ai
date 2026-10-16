import { WALK_SPEED, RUN_SPEED, SPAWN, clamp, angleDelta, cameraRelativeInput, moveWithCollision, cameraDistance } from './neighborhood-math.js';
import { StandardGamepadInput } from './gamepad.js';

export class NeighborhoodController {
  constructor(canvas, camera, world, onPause, initialPose, onInteract = () => {}) {
    this.canvas = canvas; this.camera = camera; this.world = world; this.onPause = onPause;
    this.onInteract = onInteract; this.gamepadInput = new StandardGamepadInput();
    this.gamepadState = this.gamepadInput.sample([]);
    const pose = initialPose || SPAWN;
    this.position = { x: pose.x, z: pose.z }; this.yaw = pose.yaw; this.pitch = pose.pitch;
    this.keys = new Set(); this.velocity = { x: 0, z: 0 }; this.distance = 6.2; this.actualDistance = 6.2;
    this.speed = 0; this.paused = false; this.dragging = false; this.disposed = false; this.heading = 1.1;
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
    if (this.paused || this.disposed) return;
    // The shell owns menu/GBA polling while this controller is paused.
    this.gamepadState = this.gamepadInput.sample(globalThis.navigator?.getGamepads?.() || []);
    const pad = this.gamepadState;
    if (pad.disconnected || pad.pressed[9]) { this.requestPause(); return; }
    if (pad.pressed[0]) this.onInteract();
    if (this.paused || this.disposed) return;
    this.yaw -= pad.look.x * dt * 2.4;
    this.pitch = clamp(this.pitch + pad.look.y * dt * 1.6, -0.08, 0.95);
    const held = (...keys) => keys.some(k => this.keys.has(k));
    const forward = Number(held('KeyW', 'ArrowUp')) - Number(held('KeyS', 'ArrowDown')) - pad.move.y + Number(!!pad.buttons[12]) - Number(!!pad.buttons[13]);
    const side = Number(held('KeyD', 'ArrowRight')) - Number(held('KeyA', 'ArrowLeft')) + pad.move.x + Number(!!pad.buttons[15]) - Number(!!pad.buttons[14]);
    const direction = cameraRelativeInput(side, forward, this.yaw);
    const running = held('ShiftLeft', 'ShiftRight') || !!pad.buttons[4], targetSpeed = running ? RUN_SPEED : WALK_SPEED;
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
    const target = { x: next.x, y: ground + 1.4, z: next.z };
    const boom = { x: Math.sin(this.yaw) * Math.cos(this.pitch), y: Math.sin(this.pitch), z: Math.cos(this.yaw) * Math.cos(this.pitch) };
    let safeDistance = cameraDistance(target, boom, this.distance, this.world.colliders);
    // Keep the near plane above paving even at the lowest pitch.
    if (boom.y < 0) safeDistance = Math.min(safeDistance, (target.y - 0.45) / -boom.y);
    this.actualDistance = safeDistance < this.actualDistance ? safeDistance : Math.min(safeDistance, this.actualDistance + dt * 5);
    this.camera.position.set(target.x + boom.x * this.actualDistance, target.y + boom.y * this.actualDistance, target.z + boom.z * this.actualDistance);
    this.camera.lookAt(target.x, target.y, target.z); root.visible = this.actualDistance > 0.85;
  }
  pose() { return { ...this.position, yaw: this.yaw, pitch: this.pitch }; }
  observe() {
    return { ...this.pose(), speed: this.speed, paused: this.paused, disposed: this.disposed,
      camera: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, distance: this.actualDistance, desiredDistance: this.distance },
      heldKeys: [...this.keys], pointerLocked: document.pointerLockElement === this.canvas,
      gamepad: { connected: this.gamepadState.connected, index: this.gamepadState.index, id: this.gamepadState.id,
        armed: this.gamepadState.armed, move: { ...this.gamepadState.move }, look: { ...this.gamepadState.look }, buttons: [...this.gamepadState.buttons] } };
  }
  dispose() { this.disposed = true; this.clear(); this.abort.abort(); if (document.pointerLockElement === this.canvas) document.exitPointerLock(); }
}
