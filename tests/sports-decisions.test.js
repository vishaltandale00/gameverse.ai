import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_PROFILE, observeSports, decisionsRequest, decodeDecision, controllerFrames, createSession, applyDecision } from '../scripts/playtest-sports-decisions.mjs';

const decision = (action, move = 'stop', skill = 'none') => ({ move, skill, action });
const samples = (session, action) => controllerFrames(session.gameId, action).frames.map(frame => {
  session.pad.axes = frame.axes;
  session.pad.buttons = session.pad.buttons.map((_, i) => ({ value: Number(frame.buttons.includes(i)), pressed: frame.buttons.includes(i) }));
  return session.input.sample(new Set(), [session.pad]);
});

test('visible football observation excludes AI plans and future target and uses camera coordinates', () => {
  const { state } = createSession('football');
  state.offense = 1; state.aiPlay = 2; state.players[0].think = 123;
  state.ball.flight = { tx: 999, ty: 888, elapsed: 77, vx: 2, vy: 3, vz: 4, duration: 44 };
  const before = structuredClone(state), obs = observeSports('football', state);
  assert.equal(obs.players[1].x, -state.players[1].x);
  assert.equal(obs.players[1].y, state.players[1].y);
  assert.deepEqual(obs.ball.velocity, { x: -2, y: 3, height: 4 });
  for (const forbidden of ['aiPlay', 'think', 'duration', 'tx', 'ty', 'elapsed']) assert.ok(!JSON.stringify(obs).includes(`"${forbidden}"`));
  assert.deepEqual(obs.context.receiverIcons, []);
  assert.deepEqual(state, before);
});

test('receiver icons match visible slots and disappear during handoff or after throw', () => {
  const { state } = createSession('football');
  state.phase = 'select'; state.offense = 0; state.play = 0;
  const icons = () => observeSports('football', state).context.receiverIcons;
  assert.deepEqual(icons(), [{ button: 'A', player: 1 }, { button: 'B', player: 2 }, { button: 'X', player: 3 }]);
  state.play = 2; assert.deepEqual(icons(), []);
  state.phase = 'live'; state.handoffPending = true; assert.deepEqual(icons(), []);
  state.handoffPending = false; assert.equal(icons().length, 3);
  state.thrown = true; assert.deepEqual(icons(), []);
});

test('observation retains possession stamina power and only six recent executed outcomes', () => {
  const { state } = createSession('soccer');
  const history = Array.from({ length: 8 }, (_, action) => ({ action, charge: .2 }));
  const obs = observeSports('soccer', state, decision('finesse_shot'), history);
  assert.equal(obs.controlProfile, CONTROL_PROFILE); assert.equal(obs.owner, 3); assert.equal(obs.controlled, 3);
  assert.equal(obs.players[3].stamina, 1); assert.equal(obs.players[3].y, state.players[3].z);
  assert.deepEqual(obs.heldButtons, [5, 1]); assert.equal(obs.recentDecisions.length, 6); assert.equal(obs.recentDecisions[0].action, 2);
  assert.deepEqual(observeSports('soccer', state, decision('confirm')).heldButtons, []);
  assert.equal('lastAim' in obs, false);
});

test('Decisions asks move skill and sport-specific action, rejecting invalid or refused answers', () => {
  for (const game of ['soccer', 'football']) {
    const request = decisionsRequest(observeSports(game, createSession(game).state));
    assert.equal(request.model, 'gpt-6-luna'); assert.equal(typeof request.input, 'string');
    assert.deepEqual(request.questions.map(q => [q.type, q.name]), [['choice', 'move'], ['choice', 'skill'], ['choice', 'action']]);
    assert.equal(request.questions[0].choices.length, 9); assert.equal(request.questions[1].choices.length, 9);
    const actions = request.questions[2].choices.map(choice => choice.value);
    assert.ok(actions.includes(game === 'soccer' ? 'finesse_shot' : 'receiverX_tap'));
    assert.ok(!actions.includes(game === 'soccer' ? 'receiverX' : 'shot'));
    assert.ok(!actions.includes('precision'));
    const action = decision(game === 'soccer' ? 'shot' : 'receiverB', 'up_right', 'left');
    const response = { answers: Object.entries(action).map(([name, choice]) => ({ type: 'choice', name, choice })) };
    assert.deepEqual(decodeDecision(response, request), action);
    response.answers[1] = { type: 'refusal', name: 'skill' };
    assert.throws(() => decodeDecision(response, request), /Invalid/);
    assert.throws(() => decodeDecision({ answers: [] }, request), /missing/);
  }
});

test('controller mappings use classic face buttons and pulse taps independently of held movement', () => {
  const mappings = { soccer: { pass: [0], shot: [1], lob: [2], through: [3], finesse_shot: [5, 1], driven_pass: [5, 0], lofted_through: [4, 3] }, football: { receiverA: [0], receiverB: [1], receiverX: [2], protect: [5], strafe: [6] } };
  for (const [game, actions] of Object.entries(mappings)) for (const [action, buttons] of Object.entries(actions)) {
    const mapped = controllerFrames(game, decision(action, 'up_right'));
    assert.equal(mapped.controlProfile, CONTROL_PROFILE); assert.equal(mapped.frames.length, 15);
    for (const frame of mapped.frames) { assert.deepEqual(frame.buttons, buttons); assert.ok(Math.abs(Math.hypot(...frame.axes.slice(0, 2)) - 1) < 1e-12); assert.deepEqual(frame.axes.slice(2), [0, 0]); }
  }
  for (const [action, button] of [['receiverA_tap', 0], ['receiverB_tap', 1], ['receiverX_tap', 2], ['spin', 1], ['stiff_arm', 0], ['tackle', 2], ['switch', 1]]) {
    const { frames } = controllerFrames('football', decision(action));
    assert.deepEqual(frames[0].buttons, [button]); assert.ok(frames.slice(1).every(frame => frame.buttons.length === 0));
  }
  assert.throws(() => controllerFrames('soccer', decision('receiverX')), /Invalid/);
  assert.throws(() => controllerFrames('football', { move: 'stop', aim: 'right', action: 'precision' }), /Invalid/);
});

test('actual SportsInput receives LS targeting and one standalone RS flick per decision with center rearm', () => {
  for (const game of ['soccer', 'football']) {
    const session = createSession(game);
    for (const direction of ['left', 'right']) {
      const frames = samples(session, decision('sprint', 'up', direction));
      assert.equal(frames.filter(frame => frame.pressed.skill).length, 1);
      assert.equal(frames[0].gesture.x, direction === 'left' ? -1 : 1);
      assert.ok(frames.slice(1).every(frame => frame.gesture === null));
      for (const frame of frames) { assert.deepEqual(frame.aim, frame.move); assert.ok(Math.abs(frame.aim.x) < 1e-12); assert.equal(frame.aim.y, -1); assert.equal(frame.held.sprint, true); assert.equal(frame.held.finesse, false); }
    }
  }
});

test('actual adapter holds receiver and soccer shot across decisions then releases once', () => {
  for (const [game, action, field] of [['football', 'receiverA', 'receiverA'], ['football', 'receiverB', 'receiverB'], ['football', 'receiverX', 'receiverX'], ['soccer', 'shot', 'shoot'], ['soccer', 'through', 'through'], ['soccer', 'lob', 'lob']]) {
    const session = createSession(game), first = samples(session, decision(action)), second = samples(session, decision(action)), release = samples(session, decision('neutral'));
    assert.equal(first.filter(frame => frame.pressed[field]).length, 1);
    assert.ok(second.every(frame => frame.held[field] && !frame.pressed[field] && !frame.released[field]));
    assert.equal(release.filter(frame => frame.released[field]).length, 1);
  }
});

test('confirm fixture traverses actual model without accidental charge and records skill edge', () => {
  for (const game of ['soccer', 'football']) {
    const session = createSession(game);
    const start = applyDecision(session, decision('confirm'));
    assert.equal(session.state.charge, 0); assert.equal(start.pressedEdges.confirm, 1);
    const skill = applyDecision(session, decision('neutral', 'stop', 'right'));
    assert.equal(skill.pressedEdges.skill, 1); assert.equal(session.history.length, 2);
    assert.equal(skill.controller.frames.length, 15); assert.equal(skill.stateHash.length, 64);
  }
});

test('status follows actual HUD expiry and includes visible skill cues', () => {
  const football = createSession('football');
  football.state.phase = 'live'; football.state.message = 'BALL IN THE AIR'; football.state.frame = 100;
  football.state.actionMessage = { text: 'MISSED TACKLE · RECOVER', until: 99 };
  assert.equal(observeSports('football', football.state).message, 'BALL IN THE AIR');
  football.state.actionMessage.until = 101;
  assert.equal(observeSports('football', football.state).message, 'MISSED TACKLE · RECOVER');
  football.state.phase = 'dead'; assert.equal(observeSports('football', football.state).message, 'BALL IN THE AIR');
  const soccer = createSession('soccer'); soccer.state.phase = 'play'; soccer.state.message = 'CLEAN TACKLE'; soccer.state.messageTime = 0;
  const observation = observeSports('soccer', soccer.state);
  assert.equal(observation.message, 'ALDER IN POSSESSION'); assert.equal(observation.skillReady, true);
  assert.deepEqual(observation.players[3].facing, { x: 1, y: 0 }); assert.equal(observation.nearbyOpponents.length, 3);
  assert.ok(observation.nearbyOpponents[0].distance <= observation.nearbyOpponents[1].distance);
});
