// Browser-safe core of the Decisions controller harness. A Decisions "CPU"
// sees visible telemetry for its own team and presses raw controller buttons
// every 0.25 s through the real SportsInput adapter. Both teams can be driven
// at once; a seat without a controller is the built-in CPU. No hashing,
// network or file access lives here, so the 3D replay viewer reuses it exactly.
// Official protocol: https://developers.openai.com/api/docs/guides/decisions
import { SportsInput } from './sports-input.js';
import { soccerDefinition } from './soccer.js';
import { footballDefinition } from './football.js';

export const CONTROL_PROFILE = 'classic-sports-v3';
export const TICKS = 15;
export const DECISIONS_MODEL = 'gpt-6-luna';
const round = n => Math.round(n * 1000) / 1000;
const compass = ['right', 'up_right', 'up', 'up_left', 'left', 'down_left', 'down', 'down_right'];
export const SKILL_DIRECTIONS = Object.fromEntries(compass.map((name, i) => [name, { x: Math.cos(i * Math.PI / 4), y: -Math.sin(i * Math.PI / 4) }]));
export const MOVE = { ...SKILL_DIRECTIONS, stop: { x: 0, y: 0 } };
export const definitionFor = gameId => gameId === 'soccer' ? soccerDefinition : gameId === 'football' ? footballDefinition : null;
const commonActions = {
  neutral: { buttons: [], description: 'Release buttons, including a held pass, shot, throw or kick. Movement still follows the left stick.' },
  sprint: { buttons: [7], description: 'Hold RT to sprint while moving; uses stamina.' },
  confirm: { buttons: [0], pulse: [0], description: 'Tap A to continue, restart or snap. Immediately releases so it does not charge.' },
};
export const ACTIONS = {
  soccer: {
    ...commonActions,
    pass: { buttons: [0], description: 'Hold A for ground-pass power, then neutral to release. Left stick selects a teammate direction.' },
    shot: { buttons: [1], description: 'Hold B for shot power, then neutral to release. Left stick places the shot. Also strikes headers/volleys and free kicks/penalties.' },
    lob: { buttons: [2], description: 'Hold X for a lob/cross, then release. Left stick selects the direction.' },
    through: { buttons: [3], description: 'Hold Y for a through ball into a teammate run, then release.' },
    finesse_shot: { buttons: [5, 1], description: 'Hold RB+B to charge a curling finesse shot, then release.' },
    driven_pass: { buttons: [5, 0], description: 'Hold RB+A for a driven pass, then release.' },
    lofted_through: { buttons: [4, 3], description: 'Hold LB+Y for a lofted through ball, then release.' },
    shield: { buttons: [6], description: 'Hold LT to shield possession, or jockey on defense.' },
    tackle: { buttons: [1], pulse: [1], description: 'Tap B to tackle on defense. Mistimed or from-behind tackles can be fouls and earn cards.' },
    slide_tackle: { buttons: [2], pulse: [2], description: 'Tap X for a defensive tackle; in possession X instead serves a lob.' },
    switch: { buttons: [4], pulse: [4], description: 'Tap LB to switch defender when out of possession.' },
    run_request: { buttons: [4], pulse: [4], description: 'Tap LB in possession to request a teammate run.' },
  },
  football: {
    ...commonActions,
    receiverA: { buttons: [0], description: 'Hold A to throw to receiver icon A, then neutral to release. One 0.25 s hold is touch, two holds bullet. Left stick leads.' },
    receiverB: { buttons: [1], description: 'Hold B to throw to receiver icon B, then release.' },
    receiverX: { buttons: [2], description: 'Hold X to throw to receiver icon X, then release.' },
    receiverA_tap: { buttons: [0], pulse: [0], description: 'Tap receiver A for a lob pass.' },
    receiverB_tap: { buttons: [1], pulse: [1], description: 'Tap receiver B for a lob pass.' },
    receiverX_tap: { buttons: [2], pulse: [2], description: 'Tap receiver X for a lob pass.' },
    kick: { buttons: [0], description: 'Kickoff, punt, field goal or extra point: hold A to fill the kick meter, then neutral releases the kick. Left stick x aims.' },
    stiff_arm: { buttons: [0], pulse: [0], description: 'Tap A as ball carrier to stiff-arm an approaching defender.' },
    spin: { buttons: [1], pulse: [1], description: 'Tap B as ball carrier to spin through a glancing challenge.' },
    tackle: { buttons: [2], pulse: [2], description: 'Tap X on defense for a committed dive tackle or reach. Misses need recovery.' },
    conservative_tackle: { buttons: [0], pulse: [0], description: 'Tap A on defense for a wrap-up tackle near the carrier.' },
    switch: { buttons: [1], pulse: [1], description: 'Tap B on defense or while the ball is airborne to switch player.' },
    protect: { buttons: [5], description: 'Hold RB to protect the ball against fumbles.' },
    strafe: { buttons: [6], description: 'Hold LT for defensive strafe movement.' },
    timeout: { buttons: [8], pulse: [8], description: 'Tap View to call a timeout (2 per half); stops the clock.' },
    play_left: { buttons: [14], pulse: [14], description: 'Play selection: previous play.' },
    play_right: { buttons: [15], pulse: [15], description: 'Play selection: next play.' },
  },
};
// Screens that only accept menu choices. Gameplay buttons are withheld there so
// a policy cannot waste a match pressing shot on a restart card.
export const MENU_PHASES = { soccer: ['setup', 'ready', 'goal', 'finished'], football: ['setup', 'dead', 'finished'] };

// Soccer's second controller sees a mirrored pitch so both Decisions CPUs
// attack right; its stick x is mirrored back. Football already shares the
// broadcast frame in which the offense always attacks up the screen.
export const mirrorFor = (gameId, team) => gameId === 'soccer' && team === 1 ? -1 : 1;
const sideOf = (team, other) => other === team ? 'us' : 'them';
const ours = (pair, team) => Array.isArray(pair) ? (team === 0 ? [...pair] : [pair[1], pair[0]]) : pair;

// The football broadcast frame follows the series offense, which only flips once
// a turnover play ends; a live return runs the other way in that frame.
function footballObjective(state, team, owner) {
  const carrier = owner >= 0 ? state.players[owner]?.team : null;
  if (state.phase === 'live' && carrier !== null && carrier !== state.offense) return carrier === team
    ? 'Turnover: your team has the ball. Return it DOWN the screen (+y) toward the end zone at y=+50. Sidelines x±25.'
    : 'Turnover: the opponent has the ball and is returning it down the screen (+y); tackle the carrier. Sidelines x±25.';
  return state.offense === team ? 'Your team is on offense, attacking up the screen (-y); the end zone begins at y=-50. Sidelines x±25.' : 'Your team is on defense; the opponent attacks up the screen (-y) toward the end zone you defend. Sidelines x±25.';
}

export function observeSports(gameId, state, { team = 0, lastAction = null, history = [] } = {}) {
  const soccer = gameId === 'soccer', game = definitionFor(gameId), hud = game.hud(state, team);
  const m = soccer ? mirrorFor(gameId, team) : state.offense === 0 ? 1 : -1;
  const position = p => ({ x: round(p.x * m), y: round(soccer ? p.z : -p.y * m) });
  const velocity = p => ({ x: round((p.vx || 0) * m), y: round(soccer ? (p.vz || 0) : -(p.vy || 0) * m) });
  const owner = soccer ? state.ball.owner : state.carrier;
  const controlled = hud.selected?.[team] ?? null, me = state.players[controlled];
  const profile = p => state.teams?.[p.team]?.players?.[soccer ? p.id % 5 : p.slot];
  const b = state.ball, flight = b.flight;
  const statsFor = stats => stats && Object.fromEntries(Object.entries(stats).map(([key, pair]) => [key, ours(pair, team)]));
  return {
    game: gameId, controlProfile: CONTROL_PROFILE, you: 'us', phase: state.phase, period: hud.period ?? null, frame: state.frame,
    score: { us: state.score[team], them: state.score[1 - team] }, clock: round(hud.clock),
    coordinateConvention: 'Controller screen plane: right=+x, down=+y. Positions/velocities are in this plane; height is separate.',
    objective: soccer ? 'You control team "us" and attack right (+x) toward the goal at x=28 (mouth y±4.3). Field y±17. Penalty areas |x|>19 with |y|<9. Offside applies only in the attacking third.'
      : footballObjective(state, team, owner),
    controlled, owner, possession: owner < 0 || owner === undefined ? null : sideOf(team, state.players[owner].team),
    charge: round(hud.power || 0), charging: hud.charging ?? null,
    message: hud.message, controlsHint: hud.skillHint, skillReady: hud.skillReady, controlledAthlete: hud.athlete ?? null,
    lastFeedback: state.feedback ? { kind: state.feedback.kind, strength: state.feedback.strength } : null,
    context: soccer ? { restart: state.restart?.type ? { type: state.restart.type, side: sideOf(team, state.restart.team) } : null, stats: statsFor(state.stats) }
      : { offense: sideOf(team, state.offense), down: state.down, firstDownLineY: round(-state.target * m), scrimmageY: round(-state.line * m), conversion: state.conversion,
          yardsToFirstDown: round(Math.abs(state.target - state.line)), yardsToEndZone: round(50 - state.line * (state.offense === 0 ? 1 : -1)), special: state.special ?? null, kicked: !!state.kicked,
          receiverIcons: hud.receiverIcons ?? [], passType: hud.passType ?? null, selectedReceiver: hud.selectedReceiver ?? null,
          plays: hud.plays ?? [], selectedPlay: hud.plays?.[hud.selectedPlay] ?? null, thrown: state.thrown, timeouts: ours(hud.timeouts, team) ?? null },
    players: state.players.filter(p => !p.off).map(p => ({ id: p.id, side: sideOf(team, p.team), role: profile(p)?.role ?? null, ovr: profile(p)?.ovr ?? null,
      specialties: profile(p)?.specialties ?? [], ...(soccer ? { keeper: p.keeper, facing: { x: round(p.fx * m), y: round(p.fz) } } : { facing: { x: round(p.facingX * m), y: round(-p.facingY * m) } }),
      ...position(p), velocity: velocity(p), stamina: round(p.stamina), protecting: soccer ? p.shield : p.protect })),
    nearbyOpponents: me ? state.players.filter(p => p.team !== team && !p.off).map(p => ({ id: p.id, distance: round(Math.hypot(p.x - me.x, soccer ? p.z - me.z : p.y - me.y)), ...position(p) })).sort((a, c) => a.distance - c.distance).slice(0, 3) : [],
    ball: { ...position(b), height: round(soccer ? b.y : b.z), velocity: soccer ? { x: round(b.vx * m), y: round(b.vz), height: round(b.vy) }
      : { x: round((flight?.vx || 0) * m), y: round(-(flight?.vy || 0) * m), height: round(flight?.vz || 0) } },
    lastAction, recentDecisions: structuredClone(history.slice(-6)),
    heldButtons: heldButtons(gameId, lastAction), decisionSeconds: TICKS / 60,
  };
}

const isMenu = ({ game, phase }) => MENU_PHASES[game].includes(phase) || (game === 'football' && phase === 'select');
// Offer only the buttons that mean something for this controller right now, as
// a player reads the screen: menus, on the ball, supporting, defending, kicking.
// A button outside its context is not a different action, only a mistake (for
// example a defensive B tap in possession is a minimum-power shot).
function contextActions(o) {
  const { game, phase, context: c } = o, onBall = o.controlled !== null && o.controlled === o.owner;
  if (MENU_PHASES[game].includes(phase)) return ['confirm', 'neutral', ...(game === 'football' && phase === 'dead' ? ['timeout'] : [])];
  if (game === 'football' && phase === 'select') return ['confirm', 'play_left', 'play_right', 'neutral', 'timeout'];
  if (game === 'soccer') {
    if (phase === 'restart') return c.restart?.side === 'us' ? ['confirm', 'neutral', 'pass', 'shot', 'lob', 'through', 'finesse_shot', 'driven_pass'] : ['neutral', 'sprint'];
    if (onBall) return ['neutral', 'sprint', 'pass', 'shot', 'lob', 'through', 'finesse_shot', 'driven_pass', 'lofted_through', 'shield', 'run_request'];
    if (o.possession === 'them') return ['neutral', 'sprint', 'tackle', 'slide_tackle', 'switch', 'shield'];
    return ['neutral', 'sprint', 'pass', 'shot', 'lob', 'through', 'tackle', 'switch'];
  }
  const offense = c.offense === 'us';
  if (offense && c.special && !c.kicked && onBall) return ['kick', 'neutral'];
  if (offense && c.receiverIcons.length) return ['neutral', 'sprint', 'receiverA', 'receiverB', 'receiverX', 'receiverA_tap', 'receiverB_tap', 'receiverX_tap'];
  if (onBall) return ['neutral', 'sprint', 'stiff_arm', 'spin', 'protect'];
  if (o.possession === 'them' || (!offense && o.possession !== 'us')) return ['neutral', 'sprint', 'tackle', 'conservative_tackle', 'switch', 'strafe'];
  return ['neutral', 'sprint', 'switch', 'conservative_tackle'];
}
// The Decisions API requires at least two choices per question.
export function availableActions(observation) {
  const names = contextActions(observation);
  if (names.length < 2) throw new Error(`Decisions choice questions need two options: ${observation.phase}`);
  return names.map(name => [name, ACTIONS[observation.game][name]]);
}

export function decisionsRequest(observation) {
  const available = availableActions(observation), menu = isMenu(observation);
  const tactics = observation.game === 'soccer'
    ? 'Soccer tactics: hold a pass or shot for one or two decisions to build power, then neutral releases it; a single tap is a weak, short ball. Shoot when within about 20 m of goal with an angle; otherwise pass to an open teammate (left stick toward them), play a through ball into a run, or dribble into space. On defense stay goal-side, jockey with shield, switch to the defender nearest the ball, and tackle only when the carrier is within reach and in front of you: late or from-behind tackles concede fouls, free kicks, penalties and cards. Offside applies only in the attacking third.'
    : 'Football tactics: at the play call, pick a play with play_left/play_right before confirm. Mix runs (INSIDE RUN, SWEEP) and passes using down and yards to go; on 4th down choose PUNT, or FIELD GOAL when within about 35 yards of the end zone, unless only a yard or two is needed. After the snap, let routes develop for about one or two decisions, then throw to the most open receiver icon: hold for a bullet into a tight window, tap for a lob over a defender, and throw it away rather than into coverage. Carrying the ball, run to open space and use stiff arms, spins and jukes. On defense switch to the defender nearest the ball and tackle. Kick with the kick action (hold for power). Timeouts (2 per half) stop the clock when you are trailing late.';
  const instructions = `You are a CPU controller in an original arcade ${observation.game} game, playing for the team labelled "us" against "them". Play to win like a skilled player: create chances, score, and defend. Athletes have 0–99 ratings and specialties; use your athletes' strengths. You receive visible-world telemetry, not screenshots. Each decision holds the controller for 0.25 seconds; game time stops while you think. Left stick moves the selected athlete AND supplies assisted pass/shot/throw direction or lead. A skill choice flicks the right stick once; choose none for normal play. Soccer RS follows facing: forward knock-on, backward dragback, sideways ball roll; on defense RS selects a teammate. Football RS sideways jukes; B spins when carrying. Holding the same pass/shot/throw/kick action across decisions keeps charging; neutral releases. The charge meter is 0..1; do not hold forever. Only the buttons that apply to your situation are offered. ${tactics} Choose move, skill and action independently from this same observation.`;
  return { model: DECISIONS_MODEL, input: `${instructions}\nVisible observation:\n${JSON.stringify(observation)}`, questions: [
    { type: 'choice', name: 'move', instructions: 'Choose left-stick movement and assisted direction for the next 0.25 seconds. stop brakes and keeps current facing for targeting.', choices: Object.keys(MOVE).map(value => ({ value, description: value.replaceAll('_', ' ') })) },
    { type: 'choice', name: 'skill', instructions: 'Choose none for ordinary play, or a single right-stick flick for a contextual skill. This never aims a pass or shot.', choices: [{ value: 'none', description: 'Keep the right stick centered.' }, ...Object.entries(SKILL_DIRECTIONS).map(([value, v]) => ({ value, description: `${value.replaceAll('_', ' ')} flick: x ${round(v.x)}, y ${round(v.y)}` }))] },
    { type: 'choice', name: 'action', instructions: menu ? `The visible screen is ${observation.phase}. Choose a menu action, or neutral to wait.` : 'Choose a sport-specific button action. Respect possession, phase and current charge.', choices: available.map(([value, item]) => ({ value, description: item.description })) },
  ] };
}

export function decodeDecision(response, request) {
  if (!Array.isArray(response?.answers)) throw new Error('Decisions response has no answers array');
  const action = {};
  for (const question of request.questions) {
    const matches = response.answers.filter(answer => answer.name === question.name);
    if (matches.length !== 1 || matches[0].type !== 'choice' || !question.choices.some(choice => choice.value === matches[0].choice)) throw new Error(`Invalid or missing decision answer: ${question.name}`);
    action[question.name] = matches[0].choice;
  }
  return action;
}

// `held` lists buttons still down from the previous decision. A pulse on one of
// them releases on the first frame and taps on the second, so it is a real press.
export function controllerFrames(gameId, action, mirror = 1, held = []) {
  const actions = ACTIONS[gameId];
  if (!actions || !Object.hasOwn(MOVE, action.move) || !(action.skill === 'none' || Object.hasOwn(SKILL_DIRECTIONS, action.skill)) || !Object.hasOwn(actions, action.action)) throw new Error('Invalid controller decision for this sport');
  const move = MOVE[action.move], skill = action.skill === 'none' ? { x: 0, y: 0 } : SKILL_DIRECTIONS[action.skill], mapping = actions[action.action];
  const pulseTick = mapping.pulse?.some(button => held.includes(button)) ? 1 : 0;
  return { controlProfile: CONTROL_PROFILE, frames: Array.from({ length: TICKS }, (_, tick) => ({
    axes: [move.x * mirror, move.y, tick === 0 ? skill.x * mirror : 0, tick === 0 ? skill.y : 0],
    buttons: mapping.buttons.filter(button => !mapping.pulse?.includes(button) || tick === pulseTick),
  })) };
}
const heldButtons = (gameId, action) => { const mapping = ACTIONS[gameId][action?.action]; return mapping ? mapping.buttons.filter(button => !mapping.pulse?.includes(button)) : []; };

// controllers: [home, away] booleans. false leaves that team to the built-in CPU.
export function createSession(gameId, { teams = [0, 1], seed = 1, difficulty = 1, controllers = [true, true] } = {}) {
  const game = definitionFor(gameId);
  if (!game) throw new Error('Game must be soccer or football');
  const state = game.createState({ setup: false, mode: 'play', teams, seed, difficulty });
  const seats = controllers.map((enabled, team) => {
    if (!enabled) return null;
    const pad = { id: `Decisions API controller ${team + 1}`, index: team, mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) };
    const input = new SportsInput(gameId); input.sample(new Set(), [pad]);
    return { team, pad, input, lastAction: null, history: [] };
  });
  return { gameId, game, state, seats, options: { teams: [...teams], seed, difficulty, controllers: [...controllers] } };
}

const NEUTRAL = { axes: [0, 0, 0, 0], buttons: [] };
// Map one decision per seat to controller frames for the next 0.25 seconds.
export function prepareDecisions(session, actions) {
  return session.seats.map((seat, team) => seat && actions[team] ? controllerFrames(session.gameId, actions[team], mirrorFor(session.gameId, team), heldButtons(session.gameId, seat.lastAction)) : null);
}
// Advance one 60 Hz frame with every seat's sampled controller. Returns the
// feedback event raised on this frame, if any.
export function stepDecisionFrame(session, mapped, tick) {
  const inputs = session.seats.map((seat, team) => {
    if (!seat) return null;
    const frame = mapped[team]?.frames[tick] || NEUTRAL;
    seat.pad.axes = frame.axes;
    seat.pad.buttons = seat.pad.buttons.map((_, i) => ({ pressed: frame.buttons.includes(i), value: Number(frame.buttons.includes(i)) }));
    return seat.input.sample(new Set(), [seat.pad]);
  });
  const before = session.state.feedback?.id;
  session.game.step(session.state, 1 / 60, { teams: inputs });
  return session.state.feedback?.id !== before ? structuredClone(session.state.feedback) : null;
}
export function recordDecisions(session, actions, events) {
  for (const seat of session.seats) {
    if (!seat || !actions[seat.team]) continue;
    seat.lastAction = { ...actions[seat.team] };
    seat.history.push({ action: { ...actions[seat.team] }, phase: session.state.phase, score: { us: session.state.score[seat.team], them: session.state.score[1 - seat.team] }, feedback: events.map(event => event?.kind) });
    seat.history = seat.history.slice(-6);
  }
}
// Apply one simultaneous decision per seat over TICKS frames (0.25 s).
export function applyDecisions(session, actions) {
  const mapped = prepareDecisions(session, actions), events = [];
  for (let tick = 0; tick < TICKS; tick++) {
    const event = stepDecisionFrame(session, mapped, tick);
    if (event) events.push(event);
    if (session.state.phase === 'finished') break;
  }
  session.game.validateState(session.state);
  recordDecisions(session, actions, events);
  return { events };
}
