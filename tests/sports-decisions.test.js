import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTROL_PROFILE, observeSports, decisionsRequest, decodeDecision, controllerFrames, createSession, applyDecisions, prepareDecisions, definitionFor } from '../src/sports-decisions-core.js';
import { runMatch, callDecisions } from '../scripts/playtest-sports-decisions.mjs';

const decision = (action, move = 'stop', skill = 'none') => ({ move, skill, action });
const round = n => Math.round(n * 1000) / 1000;
const actionsOf = request => request.questions.find(q => q.name === 'action').choices.map(c => c.value);
const answer = action => ({ answers: Object.entries(action).map(([name, choice]) => ({ type: 'choice', name, choice })) });
// Sample one seat's real SportsInput for a decision without stepping the model.
const samples = (session, team, action) => {
  const seat = session.seats[team], mapped = prepareDecisions(session, team ? [null, action] : [action, null])[team];
  return mapped.frames.map(frame => {
    seat.pad.axes = frame.axes;
    seat.pad.buttons = seat.pad.buttons.map((_, i) => ({ value: Number(frame.buttons.includes(i)), pressed: frame.buttons.includes(i) }));
    return seat.input.sample(new Set(), [seat.pad]);
  });
};
const runOptions = (dir, overrides) => ({ game: 'soccer', live: false, maxCalls: 400, maxWallSeconds: 120, timeoutMs: 30000, retries: 0, report: join(dir, 'run.json'), replay: null, envFile: null,
  teams: [0, 1], seed: 7, difficulty: 1, controllers: [true, true], maxTicks: 24, ...overrides });

test('soccer observations are team-relative and mirror the away controller so both attack right', () => {
  const { state } = createSession('soccer');
  state.score = [2, 1];
  const before = structuredClone(state), home = observeSports('soccer', state, { team: 0 }), away = observeSports('soccer', state, { team: 1 });
  assert.equal(home.controlProfile, CONTROL_PROFILE);
  assert.deepEqual(home.score, { us: 2, them: 1 }); assert.deepEqual(away.score, { us: 1, them: 2 });
  const athlete = state.players[7], seenHome = home.players.find(p => p.id === 7), seenAway = away.players.find(p => p.id === 7);
  assert.equal(seenHome.x, round(athlete.x)); assert.equal(seenAway.x, round(-athlete.x)); assert.equal(seenAway.y, seenHome.y);
  assert.equal(seenHome.side, 'them'); assert.equal(seenAway.side, 'us');
  assert.equal(away.controlled, definitionFor('soccer').hud(state).selected[1]);
  assert.ok(seenAway.ovr >= 40 && Array.isArray(seenAway.specialties));
  assert.deepEqual(state, before);
});

test('football observation keeps the offense-up broadcast frame for both teams and hides AI plans', () => {
  const { state } = createSession('football');
  state.offense = 1; state.players[0].think = 123;
  state.ball.flight = { x: 0, y: 0, tx: 999, ty: 888, elapsed: 77, vx: 2, vy: 3, vz: 4, duration: 44, passer: 7 };
  const before = structuredClone(state);
  for (const team of [0, 1]) {
    const obs = observeSports('football', state, { team }), athlete = obs.players.find(p => p.id === 1);
    assert.equal(athlete.x, round(-state.players[1].x)); assert.equal(athlete.y, round(state.players[1].y));
    assert.deepEqual(obs.ball.velocity, { x: -2, y: 3, height: 4 });
    const json = JSON.stringify(obs);
    for (const hidden of ['999', '888', '"think"', '"duration"', '"elapsed"']) assert.ok(!json.includes(hidden), hidden);
    assert.match(obs.objective, team === 1 ? /on offense/ : /on defense/);
  }
  assert.deepEqual(state, before);
});

test('requests ask move, skill and action, and menu screens only offer menu choices', () => {
  for (const game of ['soccer', 'football']) {
    const session = createSession(game), observation = observeSports(game, session.state);
    const request = decisionsRequest(observation);
    assert.equal(request.model, 'gpt-6-luna'); assert.equal(typeof request.input, 'string');
    assert.deepEqual(request.questions.map(q => [q.type, q.name]), [['choice', 'move'], ['choice', 'skill'], ['choice', 'action']]);
    assert.equal(request.questions[0].choices.length, 9); assert.equal(request.questions[1].choices.length, 9);
    const menu = actionsOf(decisionsRequest({ ...observation, phase: 'finished' }));
    assert.deepEqual(menu.sort(), ['confirm', 'neutral']);
    const live = actionsOf(decisionsRequest({ ...observation, phase: game === 'soccer' ? 'play' : 'live', context: { ...observation.context, plays: [] } }));
    assert.ok(live.includes(game === 'soccer' ? 'finesse_shot' : 'receiverX_tap'));
    assert.ok(!live.includes(game === 'soccer' ? 'receiverX' : 'shot'));
    if (game === 'football') assert.ok(live.includes('timeout') && live.includes('kick'));
  }
  const football = observeSports('football', createSession('football').state);
  const selecting = actionsOf(decisionsRequest({ ...football, phase: 'select', context: { ...football.context, plays: ['INSIDE RUN', 'SLANTS'] } }));
  assert.deepEqual(selecting.sort(), ['confirm', 'neutral', 'play_left', 'play_right', 'timeout']);
});

test('decoding accepts exact typed choices and rejects refusals or missing answers', () => {
  const request = decisionsRequest(observeSports('soccer', createSession('soccer').state));
  const live = decisionsRequest({ ...observeSports('soccer', createSession('soccer').state), phase: 'play' });
  const action = decision('shot', 'up_right', 'left');
  assert.deepEqual(decodeDecision(answer(action), live), action);
  const refused = answer(action); refused.answers[1] = { type: 'refusal', name: 'skill' };
  assert.throws(() => decodeDecision(refused, live), /Invalid/);
  assert.throws(() => decodeDecision({ answers: [] }, live), /missing/);
  if (actionsOf(request).length <= 5) assert.throws(() => decodeDecision(answer(action), request), /Invalid/);
});

test('controller mappings use classic face buttons, pulse taps, and mirror only the away soccer stick', () => {
  const mappings = { soccer: { pass: [0], shot: [1], lob: [2], through: [3], finesse_shot: [5, 1], driven_pass: [5, 0], lofted_through: [4, 3] }, football: { receiverA: [0], receiverB: [1], receiverX: [2], kick: [0], protect: [5], strafe: [6] } };
  for (const [game, actions] of Object.entries(mappings)) for (const [action, buttons] of Object.entries(actions)) {
    const mapped = controllerFrames(game, decision(action, 'up_right'));
    assert.equal(mapped.controlProfile, CONTROL_PROFILE); assert.equal(mapped.frames.length, 15);
    for (const frame of mapped.frames) { assert.deepEqual(frame.buttons, buttons); assert.ok(Math.abs(Math.hypot(...frame.axes.slice(0, 2)) - 1) < 1e-12); assert.deepEqual(frame.axes.slice(2), [0, 0]); }
  }
  for (const [action, button] of [['receiverA_tap', 0], ['receiverB_tap', 1], ['receiverX_tap', 2], ['spin', 1], ['stiff_arm', 0], ['tackle', 2], ['switch', 1], ['timeout', 8]]) {
    const { frames } = controllerFrames('football', decision(action));
    assert.deepEqual(frames[0].buttons, [button]); assert.ok(frames.slice(1).every(frame => frame.buttons.length === 0));
  }
  const mirrored = controllerFrames('soccer', decision('pass', 'right', 'right'), -1).frames[0];
  assert.deepEqual(mirrored.axes.map(v => round(v) || 0), [-1, 0, -1, 0]);
  const soccer = createSession('soccer');
  assert.equal(prepareDecisions(soccer, [decision('pass', 'right'), decision('pass', 'right')])[1].frames[0].axes[0], -1);
  assert.equal(prepareDecisions(createSession('football'), [null, decision('receiverA', 'right')])[1].frames[0].axes[0], 1);
  assert.throws(() => controllerFrames('soccer', decision('receiverX')), /Invalid/);
});

test('each seat’s real SportsInput gets one RS flick per decision and holds then releases once', () => {
  for (const game of ['soccer', 'football']) for (const team of [0, 1]) {
    const session = createSession(game);
    const frames = samples(session, team, decision('sprint', 'up', 'left'));
    assert.equal(frames.filter(frame => frame.pressed.skill).length, 1);
    assert.equal(frames[0].gesture.x, game === 'soccer' && team === 1 ? 1 : -1);
    assert.ok(frames.slice(1).every(frame => frame.gesture === null));
    assert.ok(frames.every(frame => frame.held.sprint && frame.aim.y === -1));
    const action = game === 'soccer' ? 'shot' : 'receiverB', field = game === 'soccer' ? 'shoot' : 'receiverB';
    const first = samples(session, team, decision(action)), second = samples(session, team, decision(action)), release = samples(session, team, decision('neutral'));
    assert.equal(first.filter(frame => frame.pressed[field]).length, 1);
    assert.ok(second.every(frame => frame.held[field] && !frame.pressed[field] && !frame.released[field]));
    assert.equal(release.filter(frame => frame.released[field]).length, 1);
  }
});

test('two Decisions seats drive both soccer teams through the same simulated frames', () => {
  const session = createSession('soccer'), game = definitionFor('soccer');
  for (let i = 0; i < 12 && session.state.phase !== 'play'; i++) applyDecisions(session, [decision('confirm'), decision('confirm')]);
  assert.equal(session.state.phase, 'play');
  const [home, away] = game.hud(session.state).selected, before = [session.state.players[home].x, session.state.players[away].x];
  for (let i = 0; i < 3; i++) applyDecisions(session, [decision('neutral', 'right'), decision('neutral', 'right')]);
  assert.deepEqual(game.hud(session.state).selected, [home, away]);
  assert.ok(session.state.players[home].x > before[0] + 2, 'home controller runs toward +x');
  assert.ok(session.state.players[away].x < before[1] - 2, 'mirrored away controller runs toward -x');
  assert.equal(session.seats[0].history.length, session.seats[1].history.length);
});

test('dry-run matches record both seats and replay to the exact same state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sports-decisions-'));
  try {
    for (const game of ['soccer', 'football']) {
      const first = await runMatch(runOptions(dir, { game, report: join(dir, `${game}.json`) }));
      assert.equal(first.report.status, 'tick-limit', first.report.error?.message);
      assert.equal(first.report.ticks.length, 24);
      assert.ok(first.report.ticks.every(tick => tick.decisions.length === 2 && tick.stateHash.length === 64));
      const replay = await runMatch(runOptions(dir, { game, report: join(dir, `${game}-replay.json`), replay: join(dir, `${game}.json`) }));
      assert.equal(replay.report.status, 'replayed', replay.report.error?.message);
      assert.equal(replay.report.replayMatchesFinalState, true);
      assert.equal(replay.report.finalStateHash, first.report.finalStateHash);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the explicit retry policy re-asks refusals and server errors but never invents a choice', async () => {
  const request = decisionsRequest({ ...observeSports('soccer', createSession('soccer').state), phase: 'play' });
  const chosen = decision('pass', 'right');
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'x-request-id': `req-${status}` } });
  const original = globalThis.fetch;
  const run = async (responses, retries) => {
    const queue = [...responses]; globalThis.fetch = async () => queue.shift();
    try { return await callDecisions(request, { apiKey: 'test-key', timeoutMs: 5000, retries, deadline: performance.now() + 60000, backoffMs: 1 }); }
    finally { globalThis.fetch = original; }
  };
  const refusedThenAnswered = await run([reply(200, { answers: [{ type: 'refusal', name: 'move' }] }), reply(200, { ...answer(chosen), usage: { input_tokens: 10 } })], 2);
  assert.deepEqual(refusedThenAnswered.action, chosen); assert.equal(refusedThenAnswered.attempts.length, 2); assert.equal(refusedThenAnswered.attempts[0].refusal, 'move');
  const badRequest = await run([reply(400, { error: { code: 'invalid_request' } })], 2);
  assert.equal(badRequest.action, undefined); assert.equal(badRequest.attempts.length, 1); assert.equal(badRequest.attempts[0].error, 'invalid_request');
  const outage = await run([reply(500, {}), reply(503, {}), reply(500, {})], 2);
  assert.equal(outage.action, undefined); assert.equal(outage.attempts.length, 3);
});

test('a tap right after holding the same button releases first, then presses, so the tap is real', () => {
  const session = createSession('soccer'), seat = session.seats[0];
  samples(session, 0, decision('pass')); seat.lastAction = decision('pass');
  const frames = samples(session, 0, decision('confirm'));
  assert.equal(frames[0].released.pass, true); assert.equal(frames[0].pressed.confirm, false);
  assert.equal(frames[1].pressed.confirm, true); assert.equal(frames.filter(frame => frame.pressed.confirm).length, 1);
});

test('sent-off soccer athletes are absent from Decisions observations', () => {
  const { state } = createSession('soccer');
  state.players[6].off = true;
  const observation = observeSports('soccer', state, { team: 0 });
  assert.ok(!observation.players.some(p => p.id === 6)); assert.ok(!observation.nearbyOpponents.some(p => p.id === 6));
});

test('every HTTP attempt, including retries, is charged against the call budget', async () => {
  const request = decisionsRequest({ ...observeSports('soccer', createSession('soccer').state), phase: 'play' });
  const original = globalThis.fetch; let fetched = 0, allowed = 2;
  globalThis.fetch = async () => { fetched++; return new Response('{}', { status: 503 }); };
  try {
    const result = await callDecisions(request, { apiKey: 'k', timeoutMs: 5000, retries: 5, deadline: performance.now() + 60000, backoffMs: 1, budget: () => allowed-- > 0 });
    assert.equal(fetched, 2); assert.equal(result.attempts.length, 2); assert.equal(result.action, undefined);
  } finally { globalThis.fetch = original; }
});
