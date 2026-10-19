// Overworld surfaces. The character surface is grantable to a simulated user;
// the spectator camera is declared human-only so the host refuses to grant it,
// which is what keeps camera control with the player during a takeover.
export const OVERWORLD_SURFACE_VERSION = 'overworld-control-surface-v1';

const HEADINGS = { north: { forward: 1, side: 0 }, south: { forward: -1, side: 0 }, east: { forward: 0, side: 1 }, west: { forward: 0, side: -1 },
  north_east: { forward: .7071, side: .7071 }, north_west: { forward: .7071, side: -.7071 }, south_east: { forward: -.7071, side: .7071 }, south_west: { forward: -.7071, side: -.7071 } };

export class OverworldCharacterSurface {
  constructor({ name = 'character', controller, world = null, writesProgress = true, now = () => Date.now(), simulation = null }) {
    // `simulation` is the engine's own diagnostics read (rendered frames and
    // active simulation time). No policy logic lives here.
    Object.assign(this, { name, controller, world, writesProgress, now, simulation });
    this.kind = 'overworld-character'; this.dispatched = 0; this.rejected = 0; this.lastApplied = null;
    this.capabilities = {
      surface: OVERWORLD_SURFACE_VERSION,
      actions: { walk: { kind: 'move' }, run: { kind: 'move' }, interact: { kind: 'tap' }, idle: { kind: 'idle' } },
      directions: Object.keys(HEADINGS),
      notes: 'Movement respects existing collision. The spectator camera is a separate human-only surface.',
    };
  }
  clock() {
    const observed = this.controller.observe();
    const engine = this.simulation?.() || null;
    return { wallMs: this.now(), paused: Boolean(observed.paused), source: 'engine',
      frame: Number.isFinite(engine?.renderedFrames) ? engine.renderedFrames : null,
      simulationMs: Number.isFinite(engine?.activeMs) ? engine.activeMs : null,
      recentFps: engine?.recentFps ?? null };
  }
  observe() {
    const observed = this.controller.observe();
    const venues = (this.world?.venues || []).map(venue => ({ id: venue.id || venue.gameId, gameId: venue.gameId,
      distance: Math.round(Math.hypot((venue.x ?? 0) - observed.x, (venue.z ?? 0) - observed.z) * 100) / 100 })).sort((a, b) => a.distance - b.distance).slice(0, 5);
    return { surface: OVERWORLD_SURFACE_VERSION, x: round(observed.x), z: round(observed.z), yaw: round(observed.yaw),
      speed: round(observed.speed), paused: observed.paused, camera: observed.camera, cameraTarget: observed.cameraTarget,
      agentDriven: observed.agentDriven, humanSpectatorInput: observed.humanSpectatorInput, venues, safety: observed.safety };
  }
  validate(action) {
    if (!action || !this.capabilities.actions[action.type]) return { ok: false, reason: `Unsupported overworld action '${action?.type}'.` };
    if (action.type !== 'idle' && action.type !== 'interact' && !HEADINGS[action.direction]) return { ok: false, reason: `Unsupported heading '${action.direction}'.` };
    if (this.controller.disposed) return { ok: false, reason: 'The overworld controller is disposed.' };
    return { ok: true };
  }
  stillValid(action) { return this.validate(action).ok; }
  apply(action) {
    const check = this.validate(action);
    if (!check.ok) { this.rejected++; throw Object.assign(Error(check.reason), { code: 'invalid-action' }); }
    if (action.type === 'idle') return this.safeIdle();
    if (action.type === 'interact') { this.controller.agentDrive = { forward: 0, side: 0, run: false, interact: true }; this.controller.onInteract?.(); }
    else this.controller.agentDrive = { ...HEADINGS[action.direction], run: action.type === 'run' };
    this.dispatched++; this.lastApplied = { ...action, at: this.now() };
    return { accepted: true, at: this.lastApplied.at };
  }
  // Stop/idle: drop the drive vector so nothing stays held, and let the human's
  // own input take the character again after a neutral frame.
  safeIdle() {
    this.controller.agentDrive = { forward: 0, side: 0, run: false };
    this.lastApplied = { type: 'safe-idle', at: this.now() };
    return { idled: true };
  }
  releaseToHuman() { this.controller.agentDrive = null; this.controller.humanSpectatorInput = false; }
  report() { return { surface: OVERWORLD_SURFACE_VERSION, dispatched: this.dispatched, rejected: this.rejected, lastApplied: this.lastApplied }; }
}

export class SpectatorCameraSurface {
  constructor({ name = 'camera', controller, now = () => Date.now() }) {
    Object.assign(this, { name, controller, now });
    this.kind = 'spectator-camera'; this.humanOnly = true; this.writesProgress = false;
    this.capabilities = { surface: OVERWORLD_SURFACE_VERSION, humanOnly: true, actions: {}, notes: 'Human spectator camera. Not grantable to a run.' };
  }
  clock() { return { wallMs: this.now(), source: 'engine' }; }
  observe() { const observed = this.controller.observe(); return { camera: observed.camera, cameraTarget: observed.cameraTarget, humanSpectatorInput: observed.humanSpectatorInput }; }
  apply() { throw Object.assign(Error('The spectator camera is human-only.'), { code: 'human-only-surface' }); }
  safeIdle() { return { idled: true, humanOnly: true }; }
}

const round = value => Math.round((value ?? 0) * 100) / 100;
