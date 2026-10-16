import { StandardGamepadInput, stickWithDeadzone } from './gamepad.js';

export const SPORTS_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyI', 'KeyQ', 'KeyE', 'KeyF', 'KeyC', 'KeyV', 'KeyR', 'ShiftLeft', 'ShiftRight', 'Enter', 'Space']);
const vector = (x, y) => { const n = Math.max(1, Math.hypot(x, y)); return { x: x / n, y: y / n }; };
const length = value => Math.hypot(value.x, value.y);
const trigger = (button, wasDown) => {
  const value = Number.isFinite(button?.value) ? button.value : Number(!!button?.pressed);
  return value >= (wasDown ? .18 : .3);
};

// Game models resolve possession/defense context. Input supplies familiar button
// aliases without forcing a receiver choice, pass target or defensive action.
export class SportsInput {
  constructor(gameId = 'soccer') { this.gameId = gameId; this.pad = new StandardGamepadInput(); this.reset(); }
  reset() {
    this.pad.reset(); this.keyArmed = false; this.previous = {};
    this.triggers = [false, false]; this.blockedB = false; this.previousB = false; this.flickArmed = true;
  }
  sample(keys, gamepads, blockB = false) {
    const previouslyArmed = this.pad.armed;
    const pad = this.pad.sample(gamepads);
    const device = Array.from(gamepads || []).find(candidate => candidate?.connected && candidate.index === pad.index && candidate.id === pad.id);
    const rightStick = stickWithDeadzone(device?.axes?.[2], device?.axes?.[3], .12);
    // Entry/resume waits for both sticks; a held skill stick cannot fire a trick.
    if ((!previouslyArmed || pad.changed) && length(rightStick) > 0) {
      this.pad.armed = pad.armed = false;
      pad.buttons = pad.buttons.map(() => false); pad.move = { x: 0, y: 0 };
    }
    if (pad.changed) this.flickArmed = true;
    this.triggers = pad.changed || !pad.armed ? [false, false]
      : [trigger(device?.buttons?.[6], this.triggers[0]), trigger(device?.buttons?.[7], this.triggers[1])];
    if (!Array.from(keys).some(code => SPORTS_KEYS.has(code))) this.keyArmed = true;
    const key = name => this.keyArmed && keys.has(name);
    const b = i => !!pad.buttons[i];
    const soccer = this.gameId === 'soccer', [leftTrigger, rightTrigger] = this.triggers;
    const captureB = blockB && (b(1) || this.previousB) && !this.blockedB;
    const suppressBRelease = blockB || this.blockedB;
    if (blockB && b(1)) this.blockedB = true;
    if (!b(1)) this.blockedB = false;
    const safeB = !blockB && !this.blockedB && b(1);
    const receiverA = key('KeyJ') || b(0), receiverB = key('KeyU') || safeB, receiverX = key('KeyK') || b(2);
    const held = {
      pass: receiverA,
      shoot: soccer ? key('KeyK') || safeB : receiverX,
      through: soccer && (key('KeyU') || b(3)), lob: soccer && (key('KeyI') || b(2)),
      finesse: soccer && (key('KeyF') || b(5)), driven: soccer && (key('KeyF') || b(5)),
      tackle: key('KeyL') || (soccer ? safeB || b(2) : b(2)),
      skill: key('KeyE'),
      shield: key('KeyC') || (soccer ? leftTrigger : b(5)),
      strafe: !soccer && (key('KeyV') || leftTrigger),
      sprint: key('ShiftLeft') || key('ShiftRight') || rightTrigger,
      switch: key('KeyQ') || (soccer ? b(4) : safeB),
      runRequest: soccer && (key('KeyR') || b(4) || b(12)),
      receiverA: !soccer && receiverA, receiverB: !soccer && receiverB, receiverX: !soccer && receiverX,
      stiffArm: !soccer && receiverA, spin: !soccer && receiverB,
      conservativeTackle: !soccer && receiverA,
      confirm: key('Enter') || key('Space') || b(0),
      left: key('ArrowLeft') || b(14), right: key('ArrowRight') || b(15), rematch: false,
    };
    const pressed = {}, released = {};
    const bAliases = soccer ? ['shoot', 'tackle'] : ['receiverB', 'spin', 'switch'];
    for (const name of Object.keys(held)) {
      pressed[name] = held[name] && !this.previous[name];
      released[name] = !pad.disconnected && !(suppressBRelease && bAliases.includes(name)) && !held[name] && !!this.previous[name];
    }
    const move = vector(Number(key('KeyD')) - Number(key('KeyA')) + pad.move.x, Number(key('KeyS')) - Number(key('KeyW')) + pad.move.y);
    // Left stick / WASD supplies both movement and assisted targeting. RS and
    // arrows can never override pass/shot direction: they only request skills.
    const aim = { ...move };
    const keyboardSkill = key('KeyE') ? vector(Number(key('ArrowRight')) - Number(key('ArrowLeft')), Number(key('ArrowDown')) - Number(key('ArrowUp'))) : { x: 0, y: 0 };
    const skillStick = length(keyboardSkill) > 0 ? keyboardSkill : pad.armed ? rightStick : { x: 0, y: 0 };
    if (length(skillStick) <= .25) this.flickArmed = true;
    const gesture = (this.flickArmed || pressed.skill) && length(skillStick) >= .65 ? { ...skillStick } : null;
    if (length(skillStick) >= .65) this.flickArmed = false;
    if (gesture) pressed.skill = true;
    const skillDirection = gesture || (pressed.skill ? { ...(length(skillStick) > 0 ? skillStick : move) } : null);
    // A voice-cancel press must not become the release of a charged B action.
    const cancelled = captureB ? (soccer ? { shoot: true } : { receiverB: true }) : {};
    this.previous = { ...held };
    this.previousB = b(1);
    return { move, aim, gesture, skillDirection, cancelled, held, pressed, released,
      connected: pad.connected, armed: pad.armed, disconnected: pad.disconnected };
  }
}
