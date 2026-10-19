// Engine-side control surface for a live sports match. It exposes observations,
// capabilities, clocks, executable controls with validation and a safe-idle
// path. It has no idea when decisions are requested, how stale they may be, what
// a reflection is, or which policy produced an action: the harness owns all of
// that. Controls are expressed in the same input frame the human produces, so an
// agent action goes through the real match model, not a side channel.
export const SPORTS_SURFACE_VERSION = 'sports-control-surface-v1';

const DIRECTIONS = {
  stop: { x: 0, y: 0 }, right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
  up_right: { x: .7071, y: -.7071 }, up_left: { x: -.7071, y: -.7071 }, down_right: { x: .7071, y: .7071 }, down_left: { x: -.7071, y: .7071 },
};
// Charged controls hold a button; releasing them strikes. Tap controls pulse.
const SOCCER = {
  move: { kind: 'move', description: 'Run in the chosen direction. No ball action.' },
  pass: { kind: 'charged', key: 'pass', description: 'Charge a ground pass toward the chosen direction; it is released automatically inside its hold window.' },
  shot: { kind: 'charged', key: 'shoot', description: 'Charge a shot at goal in the chosen direction; it is released automatically inside its hold window and counts as a shot attempt. Only useful while your selected player has the ball.' },
  lob: { kind: 'charged', key: 'lob', description: 'Charge a lofted cross in the chosen direction.' },
  through: { kind: 'charged', key: 'through', description: 'Charge a through ball into space ahead of a teammate.' },
  shield: { kind: 'hold', key: 'shield', description: 'Shield the ball from a nearby defender, or jockey when defending.' },
  sprint: { kind: 'hold', key: 'sprint', description: 'Sprint while moving; costs stamina.' },
  tackle: { kind: 'tap', key: 'tackle', description: 'Tackle the ball carrier. Only useful when the opponent has the ball and is close.' },
  switch: { kind: 'tap', key: 'switch', description: 'Switch the selected player to the one nearest the ball when defending.' },
  confirm: { kind: 'tap', key: 'confirm', description: 'Confirm on a menu screen (kick off, restart).' },
  release: { kind: 'release', description: 'Release a held charge immediately.' },
  idle: { kind: 'idle', description: 'Stand still and hold nothing.' },
};
const MENU_PHASES = new Set(['ready', 'finished', 'restart', 'goal', 'setup']);
const empty = () => ({ move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, held: {}, pressed: {}, released: {}, cancelled: {}, connected: false, armed: true, agent: true });

export class SportsControlSurface {
  // `match` is the live runtime handle: { gameId, version, definition, state(), frame(), setAgentInput(frame) }.
  constructor({ name = 'play', match, team = 0, writesProgress = true, now = () => Date.now() }) {
    Object.assign(this, { name, match, team, writesProgress, now });
    this.kind = 'sports-play'; this.actions = SOCCER;
    this.held = null; this.lastApplied = null; this.dispatched = 0; this.rejected = 0;
    this.capabilities = {
      surface: SPORTS_SURFACE_VERSION, gameId: match.gameId, version: match.version, team,
      actions: Object.fromEntries(Object.entries(this.actions).map(([type, spec]) => [type, { kind: spec.kind }])),
      describe: Object.fromEntries(Object.entries(this.actions).map(([type, spec]) => [type, spec.description || type])),
      directions: Object.keys(DIRECTIONS),
      // The engine declares what it can execute. It does not declare a decision
      // cadence, a frame rate requirement or a policy hierarchy.
      notes: 'Charged actions hold until release or safe idle. Menu phases accept confirm only.',
    };
  }
  state() { return this.match.state(); }
  clock() {
    const state = this.state();
    return { frame: this.match.frame(), matchClockSeconds: state.clock, phase: state.phase, wallMs: this.now(), paused: Boolean(this.match.paused?.()), source: 'engine' };
  }
  // Possession-aware observation. Coordinates stay in the game model's frame;
  // `attacking` tells the policy which way its goal is.
  observe() {
    const state = this.state(), team = this.team;
    const active = state.players[state.active ?? state.controlled] || state.players[0];
    const ball = state.ball, owner = ball.owner >= 0 ? state.players[ball.owner] : null;
    const near = (filter, from) => state.players.filter(filter)
      .map(player => ({ id: player.id, x: round(player.x), z: round(player.z), distance: round(Math.hypot(player.x - from.x, player.z - from.z)), keeper: Boolean(player.keeper) }))
      .sort((a, b) => a.distance - b.distance).slice(0, 4);
    const goal = { x: team === 0 ? 27 : -27, z: 0 };
    return {
      surface: SPORTS_SURFACE_VERSION, gameId: this.match.gameId, team,
      phase: state.phase, menu: MENU_PHASES.has(state.phase), score: [...state.score], clockSeconds: round(state.clock),
      possession: owner ? (owner.team === team ? 'us' : 'them') : 'loose',
      ballOwnerIsSelected: Boolean(owner && owner.id === active.id),
      ball: { x: round(ball.x), z: round(ball.z), height: round(ball.y ?? 0) },
      selected: { id: active.id, x: round(active.x), z: round(active.z), stamina: round(active.stamina), keeper: Boolean(active.keeper),
        distanceToGoal: round(Math.hypot(goal.x - active.x, goal.z - active.z)), distanceToBall: round(Math.hypot(ball.x - active.x, ball.z - active.z)) },
      attackingGoal: goal,
      teammates: near(player => player.team === team && player.id !== active.id, active),
      opponents: near(player => player.team !== team, active),
      charging: state.charging || null, charge: round(state.charge || 0),
      held: this.held ? { type: this.held.type, key: this.held.key, sinceMs: this.now() - this.held.since } : null,
      message: state.message || null, frame: this.match.frame(),
    };
  }
  validate(action) {
    if (!action || typeof action !== 'object') return { ok: false, reason: 'An action object is required.' };
    const spec = this.actions[action.type];
    if (!spec) return { ok: false, reason: `Unsupported action '${action.type}' for ${this.match.gameId}.` };
    if (action.direction && !DIRECTIONS[action.direction]) return { ok: false, reason: `Unsupported direction '${action.direction}'.` };
    const state = this.state();
    if (MENU_PHASES.has(state.phase) && !['confirm', 'idle', 'release'].includes(action.type)) {
      return { ok: false, reason: `Phase '${state.phase}' accepts confirm only.` };
    }
    if (!MENU_PHASES.has(state.phase) && action.type === 'confirm') return { ok: false, reason: 'Confirm is only valid on a menu phase.' };
    if (spec.kind === 'charged' && this.held && this.held.key !== spec.key) {
      return { ok: false, reason: `${this.held.type} is still held; release it first.` };
    }
    return { ok: true, kind: spec.kind };
  }
  // Still-valid check for an in-flight action the harness chose to continue.
  stillValid(action) { return this.validate(action).ok; }
  apply(action) {
    const check = this.validate(action);
    if (!check.ok) { this.rejected++; throw Object.assign(Error(check.reason), { code: 'invalid-action' }); }
    const spec = this.actions[action.type], frame = empty();
    const direction = DIRECTIONS[action.direction || 'stop'];
    const move = DIRECTIONS[action.move || action.direction || 'stop'];
    frame.move = { ...move }; frame.aim = { ...direction };
    if (action.sprint) frame.held.sprint = true;
    if (this.held && spec.kind !== 'release') { frame.held[this.held.key] = true; }
    if (spec.kind === 'charged') {
      if (!this.held) { this.held = { type: action.type, key: spec.key, since: this.now() }; frame.pressed[spec.key] = true; }
      frame.held[spec.key] = true;
    } else if (spec.kind === 'hold') { frame.held[spec.key] = true; }
    else if (spec.kind === 'tap') { frame.pressed[spec.key] = true; frame.released[spec.key] = true; }
    else if (spec.kind === 'release') {
      if (!this.held) { this.rejected++; throw Object.assign(Error('Nothing is held to release.'), { code: 'invalid-action' }); }
      frame.released[this.held.key] = true; delete frame.held[this.held.key]; this.held = null;
    }
    this.match.setAgentInput(frame);
    this.dispatched++; this.lastApplied = { ...action, at: this.now() };
    return { accepted: true, kind: spec.kind, frame: this.match.frame(), at: this.lastApplied.at };
  }
  // Safe idle / stop. A held charged button must be cancelled, never released:
  // releasing it would strike the shot or pass the host is trying to stop.
  safeIdle() {
    const frame = empty();
    if (this.held) { frame.cancelled[this.held.key] = true; this.held = null; }
    this.state().charging = this.state().charging; // observed state stays the model's own
    this.match.setAgentInput(frame);
    this.match.definition?.cancelInput?.(this.state());
    this.lastApplied = { type: 'safe-idle', at: this.now() };
    return { idled: true, cancelled: Object.keys(frame.cancelled), frame: this.match.frame() };
  }
  report() { return { surface: SPORTS_SURFACE_VERSION, dispatched: this.dispatched, rejected: this.rejected, lastApplied: this.lastApplied }; }
}

const round = value => Math.round((value ?? 0) * 100) / 100;
