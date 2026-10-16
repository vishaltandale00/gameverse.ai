// Bounded real Decisions API controller playtest. No API call unless --live.
// Official protocol: https://developers.openai.com/api/docs/guides/decisions
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { SportsInput } from '../src/sports-input.js';
import { soccerDefinition } from '../src/soccer.js';
import { footballDefinition } from '../src/football.js';

const ROOT = new URL('../', import.meta.url);
const ENDPOINT = 'https://api.openai.com/v1/decisions';
const TICKS = 15;
const round = n => Math.round(n * 1000) / 1000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stateHash = state => hash(JSON.stringify(state));
export const CONTROL_PROFILE = 'classic-sports-v1';
const compass = ['right', 'up_right', 'up', 'up_left', 'left', 'down_left', 'down', 'down_right'];
export const SKILL_DIRECTIONS = Object.fromEntries(compass.map((name, i) => [name, { x: Math.cos(i * Math.PI / 4), y: -Math.sin(i * Math.PI / 4) }]));
export const MOVE = { ...SKILL_DIRECTIONS, stop: { x: 0, y: 0 } };
const commonActions = {
  neutral: { buttons: [], description: 'Release buttons, including a held pass or shot. Movement still follows the left stick.' },
  sprint: { buttons: [7], description: 'Hold RT to sprint while moving; uses stamina. LT+RT is never a shot or throw.' },
  confirm: { buttons: [0], pulse: [0], description: 'Tap A to start, snap or continue. Immediately release the button so this does not charge a pass.' },
};
const ACTIONS = {
  soccer: {
    ...commonActions,
    pass: { buttons: [0], description: 'Hold A for ground-pass power, then neutral to release. Left stick selects a teammate direction; neutral uses facing and assistance.' },
    shot: { buttons: [1], description: 'Hold B for shot power, then neutral to release. Left stick places the shot toward the goal.' },
    lob: { buttons: [2], description: 'Hold X for a lob/cross, then release. Left stick selects the service direction.' },
    through: { buttons: [3], description: 'Hold Y for a through ball into a teammate run, then release. Left stick selects the direction.' },
    finesse_shot: { buttons: [5, 1], description: 'Hold RB+B to charge a finesse shot, then release. RB is a modifier, not a skill button.' },
    driven_pass: { buttons: [5, 0], description: 'Hold RB+A for a driven pass, then release.' },
    lofted_through: { buttons: [4, 3], description: 'Hold LB+Y for a lofted through ball, then release.' },
    shield: { buttons: [6], description: 'Hold LT to shield possession or jockey on defense.' },
    tackle: { buttons: [1], pulse: [1], description: 'Tap B to tackle on defense; misses commit the athlete to recovery.' },
    slide_tackle: { buttons: [2], pulse: [2], description: 'Tap X for a defensive tackle; in possession X instead serves a lob.' },
    switch: { buttons: [4], pulse: [4], description: 'Tap LB to switch defender when out of possession.' },
    run_request: { buttons: [4], pulse: [4], description: 'Tap LB in possession to request a teammate run.' },
  },
  football: {
    ...commonActions,
    receiverA: { buttons: [0], description: 'Hold A to select receiver icon A (slot1/running back), then release to throw. Hold one decision for touch; two decisions for bullet. Use receiverA_tap for lob. Left stick gives bounded lead.' },
    receiverB: { buttons: [1], description: 'Hold B to select receiver icon B (slot2), then release to throw. No right-stick aiming.' },
    receiverX: { buttons: [2], description: 'Hold X to select receiver icon X (slot3), then release to throw. No right-stick aiming.' },
    receiverA_tap: { buttons: [0], pulse: [0], description: 'Tap receiver A and release immediately for a lob pass.' },
    receiverB_tap: { buttons: [1], pulse: [1], description: 'Tap receiver B and release immediately for a lob pass.' },
    receiverX_tap: { buttons: [2], pulse: [2], description: 'Tap receiver X and release immediately for a lob pass.' },
    stiff_arm: { buttons: [0], pulse: [0], description: 'Tap A as ball carrier after a throw/handoff to stiff-arm an approaching defender.' },
    spin: { buttons: [1], pulse: [1], description: 'Tap B as ball carrier to spin through a glancing challenge.' },
    tackle: { buttons: [2], pulse: [2], description: 'Tap X on defense for a committed tackle/reach. Misses have recovery.' },
    conservative_tackle: { buttons: [0], pulse: [0], description: 'Tap A on defense for a conservative tackle near the carrier.' },
    switch: { buttons: [1], pulse: [1], description: 'Tap B on defense or while the ball is airborne to switch selected player.' },
    protect: { buttons: [5], description: 'Hold RB to cover/protect the ball; RB does not spin or juke.' },
    strafe: { buttons: [6], description: 'Hold LT for defensive strafe movement.' },
    play_left: { buttons: [14], pulse: [14], description: 'Select phase: previous offensive/defensive play.' },
    play_right: { buttons: [15], pulse: [15], description: 'Select phase: next offensive/defensive play.' },
  },
};

export function observeSports(gameId, state, lastAction = null, history = []) {
  const soccer = gameId === 'soccer', d = soccer || state.offense === 0 ? 1 : -1;
  const hud = (soccer ? soccerDefinition : footballDefinition).hud(state);
  const position = p => ({ x: round(p.x * d), y: round(soccer ? p.z : -p.y * d) });
  const velocity = p => ({ x: round((p.vx || 0) * d), y: round(soccer ? (p.vz || 0) : -(p.vy || 0) * d) });
  const owner = soccer ? state.ball.owner : state.carrier;
  const controlled = soccer ? state.active : state.controlled;
  const b = state.ball, flight = b.flight;
  return {
    game: gameId, controlProfile: CONTROL_PROFILE, phase: state.phase, frame: state.frame, score: [...state.score], clock: round(soccer ? state.clock : state.time),
    coordinateConvention: 'Controller screen plane: right=+x, down=+y. All positions/velocities below transformed to this plane. Height separate.',
    objective: soccer ? 'You are team0, attack right (+x), goal x28 with mouth y±4.3. Field y±17.' : `You are team0, ${state.offense === 0 ? 'offense attacking up (-y), endzone y=-50' : 'defense; opponent attacks up (-y), defend that endzone'}. Sidelines x±25.`,
    controlled, owner, possessionTeam: owner < 0 ? null : state.players[owner].team,
    charge: round(state.charge), charging: state.charging,
    message: hud.message, controlsHint: hud.skillHint, skillReady: hud.skillReady, lastFeedback: state.feedback ? { kind: state.feedback.kind, strength: state.feedback.strength } : null,
    context: soccer ? { restart: state.restart ? { type: state.restart.type, team: state.restart.team } : null, stats: structuredClone(state.stats) }
      : { offense: state.offense, down: state.down, firstDownLineY: round(-state.target * d), scrimmageY: round(-state.line * d), conversion: state.conversion,
          receiverIcons: state.offense === 0 && !state.thrown && !state.handoffPending && (state.phase === 'live' || state.phase === 'select' && state.play !== 2) ? [1, 2, 3].map((slot, i) => ({ button: ['A', 'B', 'X'][i], player: slot })) : [],
          passType: hud.passType, selectedReceiver: hud.selectedReceiver, selectedPlay: (state.offense === 0 ? ['VERTICALS', 'CROSSING', 'SWEEP'] : ['BALANCED', 'BLITZ', 'DEEP COVER'])[state.play], thrown: state.thrown },
    players: state.players.map(p => ({ id: p.id, team: p.team, ...(soccer ? { keeper: p.keeper, facing: { x: round(p.fx), y: round(p.fz) } } : { slot: p.slot, role: ['quarterback', 'running back', 'receiver', 'receiver', 'blocker', 'blocker', 'blocker'][p.slot], facing: { x: round(p.facingX * d), y: round(-p.facingY * d) } }), ...position(p), velocity: velocity(p), stamina: round(p.stamina),
      protecting: soccer ? p.shield : p.protect })),
    nearbyOpponents: state.players.filter(p => p.team === 1).map(p => ({ id: p.id, distance: round(Math.hypot(p.x - state.players[controlled].x, (soccer ? p.z - state.players[controlled].z : p.y - state.players[controlled].y))), ...position(p) })).sort((a, b) => a.distance - b.distance).slice(0, 3),
    ball: { ...position(b), height: round(soccer ? b.y : b.z), velocity: soccer ? { x: round(b.vx), y: round(b.vz), height: round(b.vy) }
      : { x: round((flight?.vx || 0) * d), y: round(-(flight?.vy || 0) * d), height: round(flight?.vz || 0) } },
    lastAction, recentDecisions: structuredClone(history.slice(-6)), heldButtons: (ACTIONS[gameId][lastAction?.action]?.buttons || []).filter(button => !ACTIONS[gameId][lastAction?.action]?.pulse?.includes(button)), decisionSeconds: TICKS / 60,
  };
}

export function decisionsRequest(observation) {
  // Match the controls available on the visible screen. Without this, a policy
  // can spend its whole budget shooting at a ready screen that needs A to start.
  // The API still chooses every action; the harness never advances a phase itself.
  const menu = ['ready', 'restart', 'goal', 'dead', 'finished', 'select'].includes(observation.phase);
  const menuActions = observation.phase === 'select' ? ['confirm', 'play_left', 'play_right', 'neutral'] : ['confirm', 'neutral'];
  const availableActions = Object.entries(ACTIONS[observation.game]).filter(([name]) => !menu || menuActions.includes(name));
  const instructions = `Play this original arcade ${observation.game} game as team 0. Try to score and defend using its familiar controller controls. You receive visible-world telemetry, not screenshots. Each decision advances 0.25 seconds; game time stops while the API thinks. Left stick moves the player AND supplies assisted pass/shot direction. There is no separate aiming stick. A skill choice flicks the right stick once, then centers it; choose none for normal play. Soccer RS follows player facing: forward knock-on, backward dragback, sideways ball roll; on defense RS selects a nearby teammate direction. Football RS sideways jukes; B spins when carrying. Skill, protect and sprint are optional contextual choices, not automatic mechanics. At ready/select use confirm. On football SWEEP, snapping starts the physical handoff. Before a football pass select receiver A/B/X: _tap actions give lob, one 0.25-second hold gives touch, two holds give bullet, then neutral releases; do not steer the right stick at receivers. Receiver icons are visible in context. Keep the quarterback behind the scrimmage line to throw. Soccer A ground pass, B shot, X lob, Y through; RB+B finesse. Holding the same pass/shot action across decisions continues charging; neutral releases. Use left-stick direction toward a teammate or goal, or stop to let facing and assistance choose. The charge meter is 0..1. Review recent executed actions, charge and HUD cues; do not hold forever. Pulsed actions happen once each decision. Use facing, nearby opponents and stamina to decide whether a skill is useful. No required action sequence or prescribed outcome. Choose move, skill and action independently from this same observation.`;
  return { model: 'gpt-6-luna', input: `${instructions}\nVisible observation:\n${JSON.stringify(observation)}`, questions: [
    { type: 'choice', name: 'move', instructions: 'Choose left-stick movement and assisted pass/shot direction for the next 0.25 seconds. stop brakes and uses current facing for targeting.', choices: Object.keys(MOVE).map(value => ({ value, description: value.replaceAll('_', ' ') })) },
    { type: 'choice', name: 'skill', instructions: 'Choose none for ordinary play, or a single right-stick flick for a contextual skill. This NEVER aims a pass or shot and needs no shoulder button.', choices: [{ value: 'none', description: 'Keep the right stick centered; no skill request.' }, ...Object.entries(SKILL_DIRECTIONS).map(([value, v]) => ({ value, description: `${value.replaceAll('_', ' ')} flick: x ${round(v.x)}, y ${round(v.y)}` }))] },
    { type: 'choice', name: 'action', instructions: menu ? `The visible screen is ${observation.phase}. Choose confirm (A) to start/continue, select a play where offered, or neutral to wait. Gameplay actions are not available on this screen.` : 'Choose a sport-specific button action. Holding a receiver/pass/shot action continues charging; neutral releases it. Respect possession, phase and current charge.', choices: availableActions.map(([value, item]) => ({ value, description: item.description })) },
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

export function controllerFrames(gameId, action) {
  const actions = ACTIONS[gameId];
  if (!actions || !Object.hasOwn(MOVE, action.move) || !(action.skill === 'none' || Object.hasOwn(SKILL_DIRECTIONS, action.skill)) || !Object.hasOwn(actions, action.action)) throw new Error('Invalid controller decision for this sport');
  const move = MOVE[action.move], skill = action.skill === 'none' ? { x: 0, y: 0 } : SKILL_DIRECTIONS[action.skill], mapping = actions[action.action];
  return { controlProfile: CONTROL_PROFILE, frames: Array.from({ length: TICKS }, (_, tick) => ({
    axes: [move.x, move.y, tick === 0 ? skill.x : 0, tick === 0 ? skill.y : 0],
    buttons: mapping.buttons.filter(button => !mapping.pulse?.includes(button) || tick === 0),
  })) };
}

export function createSession(gameId) {
  const game = gameId === 'soccer' ? soccerDefinition : gameId === 'football' ? footballDefinition : null;
  if (!game) throw new Error('Game must be soccer or football');
  const state = game.createState(), input = new SportsInput(gameId);
  const pad = { id: 'Decisions API standard controller', index: 0, mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) };
  input.sample(new Set(), [pad]);
  return { gameId, game, state, input, pad, lastAction: null, history: [] };
}

export function applyDecision(session, action) {
  const mapped = controllerFrames(session.gameId, action), events = [], edges = {};
  let previousFeedback = session.state.feedback?.id;
  for (const frame of mapped.frames) {
    session.pad.axes = frame.axes;
    session.pad.buttons = session.pad.buttons.map((_, i) => ({ pressed: frame.buttons.includes(i), value: Number(frame.buttons.includes(i)) }));
    const sampled = session.input.sample(new Set(), [session.pad]);
    for (const [key, down] of Object.entries(sampled.pressed)) if (down) edges[key] = (edges[key] || 0) + 1;
    session.game.step(session.state, 1 / 60, sampled);
    if (session.state.feedback?.id !== previousFeedback) { events.push(structuredClone(session.state.feedback)); previousFeedback = session.state.feedback?.id; }
    if (session.state.phase === 'finished') break;
  }
  session.game.validateState(session.state);
  session.lastAction = { ...action };
  session.history.push({ action: { ...action }, phase: session.state.phase, score: [...session.state.score], charge: round(session.state.charge), owner: session.gameId === 'soccer' ? session.state.ball.owner : session.state.carrier, feedback: events.map(event => event?.kind) });
  session.history = session.history.slice(-6);
  return { controller: mapped, pressedEdges: edges, feedbackEvents: events, stateHash: stateHash(session.state), observation: observeSports(session.gameId, session.state, action, session.history) };
}

const sourceFiles = ['scripts/playtest-sports-decisions.mjs', 'src/soccer.js', 'src/football.js', 'src/sports-input.js', 'src/gamepad.js', 'src/sports-physics.js', 'src/sports-certified.generated.js', 'src/neighborhood-safety.js', 'src/neighborhood-certified.generated.js'];
async function sourceHashes() { return Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, hash(await readFile(new URL(name, ROOT)))]))); }
const sameHashes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function parseArgs(argv) {
  const options = { game: 'soccer', live: false, maxCalls: 60, maxWallSeconds: 180, report: null, replay: null, envFile: null };
  const values = { '--game': 'game', '--max-calls': 'maxCalls', '--max-wall-seconds': 'maxWallSeconds', '--report': 'report', '--replay': 'replay', '--env-file': 'envFile' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--live') options.live = true;
    else if (arg === '--dry-run') options.live = false;
    else if (values[arg] && argv[i + 1] && !argv[i + 1].startsWith('--')) options[values[arg]] = argv[++i];
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  options.maxCalls = Number(options.maxCalls); options.maxWallSeconds = Number(options.maxWallSeconds);
  if (!Number.isInteger(options.maxCalls) || options.maxCalls < 1 || options.maxCalls > 200) throw new Error('--max-calls must be 1..200');
  if (!Number.isFinite(options.maxWallSeconds) || options.maxWallSeconds < 1 || options.maxWallSeconds > 180) throw new Error('--max-wall-seconds must be 1..180');
  if (options.live && options.replay) throw new Error('--replay is offline and cannot use --live');
  return options;
}

export async function runPlaytest(options) {
  const started = performance.now(), runId = randomUUID();
  const reportPath = resolve(options.report || `artifacts/sports-decisions/${runId}.json`);
  const report = { schema: 2, controlProfile: CONTROL_PROFILE, runId, startedAt: new Date().toISOString(), mode: options.replay ? 'replay' : options.live ? 'live-decisions-api' : 'dry-run', game: options.game,
    model: 'gpt-6-luna', endpoint: ENDPOINT, apiProtocol: { version: 'v1', documentation: 'https://developers.openai.com/api/docs/guides/decisions' }, limits: { calls: options.maxCalls, wallSeconds: options.maxWallSeconds, ticksPerDecision: TICKS },
    machine: { node: process.version, platform: process.platform, arch: process.arch }, status: 'running', decisions: [], sourceHashes: null,
    limitations: 'Headless visible-telemetry model play. Not screenshot perception, rendered feedback, physical-controller feel, or a full match unless final phase is finished. No hidden AI timers, future targets or source code sent to API. Dry-run is a protocol fixture, not AI play.', queueMs: null };
  let session, apiKey;
  const save = async () => { report.elapsedMs = performance.now() - started; await mkdir(dirname(reportPath), { recursive: true }); const serialized = JSON.stringify(report, null, 2); await writeFile(reportPath, (apiKey ? serialized.replaceAll(apiKey, '[redacted]') : serialized) + '\n'); };
  try {
    report.sourceHashes = await sourceHashes();
    let replay;
    if (options.replay) {
      replay = JSON.parse(await readFile(options.replay, 'utf8'));
      if (replay.schema !== 2 || replay.controlProfile !== CONTROL_PROFILE || !sameHashes(replay.sourceHashes, report.sourceHashes)) throw new Error('Replay control profile or source hashes differ; use the exact recorded harness/source revision');
      if (!Array.isArray(replay.decisions) || replay.decisions.length > 200) throw new Error('Replay decision count invalid');
      report.game = replay.game; report.replayOf = replay.runId;
    }
    session = createSession(report.game); report.initialStateHash = stateHash(session.state);
    if (options.live) {
      if (options.envFile) process.loadEnvFile(resolve(options.envFile));
      apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY is required for --live (or supply --env-file)');
    }
    const count = replay ? replay.decisions.filter(item => item.execution).length : options.maxCalls;
    for (let index = 0; index < count; index++) {
      const remaining = options.maxWallSeconds * 1000 - (performance.now() - started);
      if (remaining <= 0) { report.status = 'wall-limit'; break; }
      if (session.state.phase === 'finished') { report.status = 'match-finished'; break; }
      const observation = observeSports(report.game, session.state, session.lastAction, session.history);
      const request = decisionsRequest(observation), entry = { index, observation, request, requestedAt: new Date().toISOString() }; report.decisions.push(entry);
      let action;
      if (replay) {
        action = replay.decisions[index].action;
        entry.replayed = true;
      } else if (options.live) {
        const called = performance.now();
        try {
          const response = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(30000, remaining)))) });
          entry.httpStatus = response.status; entry.requestId = response.headers.get('x-request-id');
          const body = await response.text();
          try { entry.response = JSON.parse(body); } catch { entry.response = { invalidJson: body.slice(0, 2000) }; }
          if (!response.ok) throw new Error(`Decisions API HTTP ${response.status}`);
          entry.usage = entry.response.usage || null;
          action = decodeDecision(entry.response, request);
        } catch (error) { entry.error = { name: error.name, message: String(error.message).replaceAll(apiKey, '[redacted]') }; throw error; }
        finally { entry.apiMs = performance.now() - called; }
      } else {
        action = { move: 'stop', skill: index % 8 === 6 ? 'right' : 'none', action: index === 0 ? 'confirm' : index % 4 === 1 || index % 4 === 2 ? (report.game === 'soccer' ? 'pass' : 'receiverA') : 'neutral' };
        entry.fixture = true;
      }
      entry.action = action;
      const executed = performance.now(); entry.execution = applyDecision(session, action); entry.executionMs = performance.now() - executed;
      if (replay && entry.execution.stateHash !== replay.decisions[index].execution.stateHash) throw new Error(`Replay diverged at decision ${index}`);
      await save();
    }
    if (report.status === 'running') report.status = replay ? 'replayed' : session.state.phase === 'finished' ? 'match-finished' : 'call-limit';
    report.finalState = session.state; report.finalStateHash = stateHash(session.state);
    if (replay) { report.replayMatchesFinalState = report.finalStateHash === replay.finalStateHash; if (!report.replayMatchesFinalState) throw new Error('Replay final state differs'); }
    report.endSourceHashes = await sourceHashes(); report.sourceUnchanged = sameHashes(report.sourceHashes, report.endSourceHashes);
    if (!report.sourceUnchanged) throw new Error('Source files changed during run; result is not bound to one source revision');
  } catch (error) {
    report.status = 'failed'; report.error = { name: error.name, message: apiKey ? String(error.message).replaceAll(apiKey, '[redacted]') : String(error.message) };
    if (session) { report.finalState = session.state; report.finalStateHash = stateHash(session.state); }
  } finally {
    report.observedOutcomes = { score: session?.state.score || null, phase: session?.state.phase || null, frame: session?.state.frame || 0, stats: session?.state.stats || null, eventCounts: {} };
    for (const decision of report.decisions) for (const event of decision.execution?.feedbackEvents || []) if (event?.kind) report.observedOutcomes.eventCounts[event.kind] = (report.observedOutcomes.eventCounts[event.kind] || 0) + 1;
    await save();
  }
  return { reportPath, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runPlaytest(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ report: result.reportPath, mode: result.report.mode, status: result.report.status, decisions: result.report.decisions.length, elapsedMs: round(result.report.elapsedMs), phase: result.report.finalState?.phase, score: result.report.finalState?.score, error: result.report.error || null }));
    if (result.report.status === 'failed') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
