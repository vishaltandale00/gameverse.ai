// Standard browser mapping: Xbox A=0, LB=4, Start=9, D-pad=12..15.
export const GAMEPAD_DEADZONE = 0.18;

export function stickWithDeadzone(x = 0, y = 0, deadzone = GAMEPAD_DEADZONE) {
  x = Number.isFinite(x) ? x : 0; y = Number.isFinite(y) ? y : 0;
  const length = Math.hypot(x, y);
  if (length <= deadzone) return { x: 0, y: 0 };
  const magnitude = (Math.min(length, 1) - deadzone) / (1 - deadzone);
  return { x: x / length * magnitude, y: y / length * magnitude };
}

export function sampleStandardGamepad(gamepads = [], preferredIndex = null) {
  const available = Array.from(gamepads || []).filter(pad => pad?.connected && pad.mapping === 'standard');
  const pad = available.find(pad => pad.index === preferredIndex) || available[0];
  if (!pad) return { connected: false, index: null, id: null, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, buttons: [], neutral: true };
  const move = stickWithDeadzone(pad.axes[0], pad.axes[1]);
  const look = stickWithDeadzone(pad.axes[2], pad.axes[3]);
  const buttons = Array.from(pad.buttons, button => Boolean(button?.pressed || button?.value > 0.25));
  return { connected: true, index: pad.index, id: pad.id, move, look, buttons,
    neutral: !buttons.some(Boolean) && !move.x && !move.y && !look.x && !look.y };
}

// Each active input owner keeps its own gate and resets it at every ownership
// transition. A button held in the previous context cannot activate the next one.
export class StandardGamepadInput {
  constructor() { this.device = null; this.index = null; this.reset(); }
  reset() { this.armed = false; this.previousButtons = []; }
  sample(gamepads) {
    const snapshot = sampleStandardGamepad(gamepads, this.index);
    const device = snapshot.connected ? `${snapshot.index}:${snapshot.id}` : null;
    const changed = device !== this.device;
    const disconnected = this.device !== null && changed;
    if (changed) this.reset();
    this.device = device; this.index = snapshot.index;
    if (snapshot.connected && snapshot.neutral) this.armed = true;
    const buttons = this.armed ? snapshot.buttons : snapshot.buttons.map(() => false);
    const pressed = buttons.map((down, index) => down && !this.previousButtons[index]);
    this.previousButtons = [...buttons];
    return { ...snapshot, armed: this.armed, changed, disconnected, buttons, pressed,
      move: this.armed ? snapshot.move : { x: 0, y: 0 },
      look: this.armed ? snapshot.look : { x: 0, y: 0 } };
  }
}
