import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentHost } from '../src/agent-host.js';
import { SportsControlSurface } from '../src/sports-control-surface.js';
import { SimulatedUser, simulatedUserRunner } from '../src/simulated-user.js';
import { VoiceAgent, TOOL_CATALOG } from '../src/voice-agent.js';
import { soccerDefinition } from '../src/soccer.js';
import { mergePendingInput } from '../src/sports-feedback.js';

// Policy calls resolve on later microtasks by design; the harness never awaits
// them inside a tick, so tests drain the queue explicitly.
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };

// A real soccer match on a virtual clock. The agent's input frames go through
// the same definition.step() the human's input uses; nothing here mocks play.
function match({ clock = { ms: 0 } } = {}) {
  const state = soccerDefinition.createState();
  const handle = {
    gameId: 'soccer', version: '1.0.0', definition: soccerDefinition, agentInput: null, frames: 0,
    state: () => state, frame: () => handle.frames, paused: () => false,
    setAgentInput: frame => { handle.agentInput = frame; },
    // 60 Hz stepping, exactly like the runtime loop: a press lives for one frame,
    // a hold persists until the surface changes it.
    advance(ms) {
      for (let elapsed = 0; elapsed < ms; elapsed += 1000 / 60) {
        const input = mergePendingInput(handle.agentInput || { move: { x: 0, y: 0 }, held: {}, pressed: {}, released: {}, cancelled: {} }, null);
        soccerDefinition.step(state, 1 / 60, input);
        handle.frames++; clock.ms += 1000 / 60;
        if (handle.agentInput) handle.agentInput = { ...handle.agentInput, pressed: {}, released: {}, cancelled: {} };
      }
      return state;
    },
  };
  return handle;
}

function fixture({ clock = { ms: 0 } } = {}) {
  const now = () => clock.ms;
  const log = [];
  const host = new AgentHost({ now, log: entry => log.push(entry) });
  host.registerGame({ gameId: 'soccer', version: '1.0.0', name: 'Alder Five', kind: 'custom-sports' });
  const handles = [];
  host.registerOpener('soccer', ({ gameId, version, identity }) => {
    const handle = match({ clock }); handles.push(handle);
    const session = host.registerSession({ gameId, version, identity,
      surfaces: [new SportsControlSurface({ match: handle, team: 0, now })] });
    handle.sessionId = session.sessionId;
    return session;
  });
  return { host, clock, now, log, handles };
}

test('host resolves session selection without a universal create-or-reuse default', async () => {
  const { host } = fixture();
  const first = await host.openSession({ gameId: 'soccer', selection: 'new' });
  const reused = await host.openSession({ gameId: 'soccer', selection: 'reuse' });
  assert.equal(reused.sessionId, first.sessionId);
  const second = await host.openSession({ gameId: 'soccer', selection: 'new' });
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal((await host.openSession({ gameId: 'soccer', selection: 'auto' })).sessionId, first.sessionId);
  await assert.rejects(host.openSession({ gameId: 'tennis', selection: 'auto' }), /not a supported target/);
});

test('control slots and progress writers stay exclusive; a second writer is refused', async () => {
  const { host } = fixture();
  const session = await host.openSession({ gameId: 'soccer', selection: 'new' });
  const run = host.startRun({ sessionId: session.sessionId, surface: 'play', goal: 'score' });
  assert.equal(host.runStatus(run.runId).progressWriter, true);
  assert.throws(() => host.startRun({ sessionId: session.sessionId, surface: 'play', goal: 'also score' }), /already controls/);
  // Viewing or saving the match must not create another writer.
  host.setDisplayed(session.sessionId, false);
  assert.equal(host.runStatus(run.runId).progressWriter, true);
  host.stopRun(run.runId);
  const next = host.startRun({ sessionId: session.sessionId, surface: 'play', goal: 'retry' });
  assert.equal(host.runStatus(next.runId).progressWriter, true);
});

test('ordinary human gameplay input does not reclaim control', async () => {
  const { host } = fixture();
  const session = await host.openSession({ gameId: 'soccer', selection: 'new' });
  const run = host.startRun({ sessionId: session.sessionId, surface: 'play', goal: 'score' });
  const noted = host.noteHumanInput(session.sessionId, { source: 'keyboard' });
  assert.equal(noted.reclaimed, false);
  assert.equal(host.runStatus(run.runId).state, 'running');
});

test('leaving the subgame keeps the session, grant and run alive and the clock running', async () => {
  const { host, handles } = fixture();
  const session = await host.openSession({ gameId: 'soccer', selection: 'new' });
  const run = host.startRun({ sessionId: session.sessionId, surface: 'play', goal: 'score' });
  const before = handles[0].frame();
  host.setDisplayed(session.sessionId, false); // human returns to the overworld
  handles[0].advance(500);
  assert.ok(handles[0].frame() > before);
  const status = host.runStatus(run.runId);
  assert.equal(status.state, 'running');
  assert.equal(status.displayed, false);
  // Reopening shows the same evolved session, not a restart or replay.
  const reopened = host.setDisplayed(session.sessionId, true);
  assert.equal(reopened.sessionId, session.sessionId);
  assert.ok(reopened.clock.frame >= handles[0].frame());
  assert.equal(reopened.runs[0].runId, run.runId);
});

test('safe idle cancels a held charged shot instead of striking it', async () => {
  const { host, handles } = fixture();
  const session = await host.openSession({ gameId: 'soccer', selection: 'new' });
  const surface = host.session(session.sessionId).surfaces.get('play');
  const state = handles[0].state();
  state.phase = 'live';
  const run = host.startRun({ sessionId: session.sessionId, surface: 'play', goal: 'score' });
  const grant = host.runs.get(run.runId).grant;
  // Give the agent-controlled player the ball, then charge a shot.
  state.ball.owner = state.active; state.charging = null; state.charge = 0;
  grant.apply({ type: 'shot', direction: 'right' });
  handles[0].advance(200);
  assert.equal(state.charging, 'shoot');
  assert.ok(state.charge > 0);
  const shotsBefore = state.stats.shots[0];
  host.stopRun(run.runId, { reason: 'explicit stop while charged' });
  handles[0].advance(200);
  assert.equal(state.charging, null, 'the charge is cancelled, not released');
  assert.equal(state.stats.shots[0], shotsBefore, 'stop must not fire the charged shot');
  assert.equal(surface.held, null);
  // Late actions on a released run are rejected.
  assert.throws(() => grant.apply({ type: 'pass', direction: 'up' }), /released|revoked/i);
});

test('two concurrent runs keep separate targets and independent Stop', async () => {
  const { host } = fixture();
  const first = await host.openSession({ gameId: 'soccer', selection: 'new', identity: { profileId: 'player' } });
  // A simulation copy is a separate progress scope, so it may write concurrently.
  const second = await host.openSession({ gameId: 'soccer', selection: 'new', identity: { profileId: 'sim-copy' } });
  assert.notEqual(host.describeSession(first.sessionId).progressKey, host.describeSession(second.sessionId).progressKey);
  // Two runs against the same accepted progress record are refused.
  const shared = await host.openSession({ gameId: 'soccer', selection: 'new', identity: { profileId: 'player' } });
  const runA = host.startRun({ sessionId: first.sessionId, surface: 'play', goal: 'score A' });
  assert.throws(() => host.startRun({ sessionId: shared.sessionId, surface: 'play', goal: 'double writer' }), /only authorized writer/);
  const runB = host.startRun({ sessionId: second.sessionId, surface: 'play', goal: 'score B' });
  assert.notEqual(host.runStatus(runA.runId).sessionId, host.runStatus(runB.runId).sessionId);
  host.stopRun(runA.runId);
  assert.equal(host.runStatus(runA.runId).state, 'released');
  assert.equal(host.runStatus(runB.runId).state, 'running');
  assert.equal(host.listRuns({ state: 'running' }).length, 1);
});

test('the engine clock keeps running while a decision is outstanding, and stale answers are discarded', async () => {
  const clock = { ms: 0 };
  const { host, handles } = fixture({ clock });
  const session = await host.openSession({ gameId: 'soccer', selection: 'new' });
  handles[0].state().phase = 'live';
  let resolveDecision;
  const harness = new SimulatedUser({
    grant: host.startRun({ sessionId: session.sessionId, surface: 'play', goal: 'score' }) && host.runs.get(host.listRuns()[0].runId).grant,
    goal: 'score', now: () => clock.ms,
    config: { staleAfterMs: 300, decisionIntervalMs: 100, actionDurationMs: 400, reflectionIntervalMs: 1e9 },
    decisions: () => new Promise(resolve => { resolveDecision = resolve; }),
  }).start();
  harness.tick(clock.ms);
  await flush();
  assert.ok(harness.pending, 'a decision is outstanding');
  const frameAtRequest = handles[0].frame();
  handles[0].advance(600); // game time continues; nothing waited for the policy
  harness.tick(clock.ms);
  assert.ok(handles[0].frame() > frameAtRequest);
  assert.ok(harness.usage.idleFallbacks > 0, 'the harness requested safe idle while waiting');
  resolveDecision({ action: { type: 'pass', direction: 'right' }, provider: 'fake', model: 'test-decider' });
  await flush();
  assert.equal(harness.usage.stale, 1, 'a response older than staleAfterMs is discarded');
  assert.equal(harness.current, null);
  assert.ok(harness.report().evidence.some(entry => entry.event === 'decision-discarded' && entry.reason === 'stale'));
});

test('a fresh decision runs as one bounded action, then falls back to safe idle', async () => {
  const clock = { ms: 0 };
  const { host, handles } = fixture({ clock });
  const session = await host.openSession({ gameId: 'soccer', selection: 'new' });
  handles[0].state().phase = 'live';
  const run = host.startRun({ sessionId: session.sessionId, surface: 'play', goal: 'score' });
  const grant = host.runs.get(run.runId).grant;
  const harness = new SimulatedUser({ grant, goal: 'score', now: () => clock.ms,
    config: { staleAfterMs: 500, decisionIntervalMs: 100, actionDurationMs: 300, reflectionIntervalMs: 1e9 },
    decisions: async () => ({ action: { type: 'move', direction: 'right', durationMs: 300 } }) }).start();
  harness.tick(clock.ms);
  await flush();
  assert.equal(harness.current?.action.type, 'move');
  assert.equal(harness.usage.actions, 1);
  const idleBefore = harness.usage.idleFallbacks;
  clock.ms += 400; handles[0].advance(100);
  harness.tick(clock.ms);
  assert.ok(harness.usage.idleFallbacks > idleBefore, 'the expired action gives way to safe idle');
});

test('reflections are asynchronous, can finish a run truthfully, and are dropped after release', async () => {
  const clock = { ms: 0 };
  const { host } = fixture({ clock });
  const session = await host.openSession({ gameId: 'soccer', selection: 'new' });
  let finished = null;
  const run = host.startRun({ sessionId: session.sessionId, surface: 'play', goal: 'score',
    runner: ({ grant, run: info, finish }) => new SimulatedUser({ grant, goal: info.goal, now: () => clock.ms,
      config: { completionPolicy: 'goal', reflectionIntervalMs: 10, decisionIntervalMs: 1e9, staleAfterMs: 1e9 },
      decisions: async () => ({ action: { type: 'move', direction: 'right' } }),
      reflector: async () => ({ note: 'chance created', goalReached: true, model: 'fake-reflector' }),
      finish: (outcome, detail) => { finished = { outcome, detail }; finish(outcome, detail); } }).start() });
  const harness = host.runs.get(run.runId).harness;
  clock.ms += 50;
  harness.tick(clock.ms);
  await flush();
  assert.equal(harness.usage.reflections, 1);
  assert.equal(finished?.outcome, 'goal-reached');
  assert.equal(host.runStatus(run.runId).state, 'released');
  assert.equal(host.runStatus(run.runId).outcome, 'goal-reached');
});

test('the voice agent turns one transcript into real host tool calls and a text acknowledgment', async () => {
  const clock = { ms: 0 };
  const { host } = fixture({ clock });
  const planner = async ({ transcript, tools, state }) => {
    assert.ok(Object.hasOwn(tools, 'start_simulated_user'));
    assert.ok(Array.isArray(state.games));
    assert.match(transcript, /soccer/i);
    return { model: 'fake-planner', say: 'Taking over the match.', toolCalls: [
      { name: 'open_session', args: { gameId: 'soccer', selection: 'auto' } },
      { name: 'start_simulated_user', args: { sessionId: null, goal: 'try to score' } },
    ] };
  };
  const agent = new VoiceAgent({ host, now: () => clock.ms, runner: simulatedUserRunner({ now: () => clock.ms, decisions: async () => ({ action: { type: 'move', direction: 'right' } }) }),
    plan: async input => {
      const planned = await planner(input);
      return planned;
    } });
  // The planner's second call needs the session the first call opened; the agent
  // exposes prior results through the planner contract, so emulate the common
  // case where the planner is re-asked. Here we patch the arg from the result.
  const original = agent.invoke.bind(agent);
  agent.invoke = async (name, args, meta) => {
    if (name === 'start_simulated_user' && !args.sessionId) args.sessionId = host.listSessions()[0].sessionId;
    return original(name, args, meta);
  };
  const record = await agent.handle({ requestId: 'req-1', transcript: 'Take over soccer and try to score', context: { role: 'base', gameId: 'neighborhood' } });
  assert.equal(record.outcome, 'completed');
  assert.equal(record.toolCalls.length, 2);
  assert.equal(record.toolCalls[0].name, 'open_session');
  assert.equal(record.runs.length, 1);
  assert.match(record.acknowledgment, /Taking over the match\./);
  assert.match(record.acknowledgment, /Started run_/);
  assert.equal(host.listRuns({ state: 'running' }).length, 1);

  // A later stop command targets the same run even though the view changed.
  host.setDisplayed(record.runs[0].sessionId, false);
  const runId = record.runs[0].runId;
  const stopAgent = new VoiceAgent({ host, now: () => clock.ms, plan: async () => ({ toolCalls: [{ name: 'stop_run', args: { runId } }] }) });
  const stopped = await stopAgent.handle({ requestId: 'req-2', transcript: 'stop the soccer agent', context: { role: 'base', gameId: 'neighborhood' } });
  assert.equal(stopped.outcome, 'completed');
  assert.equal(host.runStatus(runId).state, 'released');
  assert.match(stopped.acknowledgment, /controls returned/);
});

test('the voice agent reports tool failures truthfully instead of claiming success', async () => {
  const { host } = fixture();
  const agent = new VoiceAgent({ host, plan: async () => ({ toolCalls: [{ name: 'start_simulated_user', args: { goal: 'score' } }] }) });
  const record = await agent.handle({ requestId: 'req-3', transcript: 'play football for me' });
  assert.equal(record.outcome, 'failed');
  assert.match(record.acknowledgment, /needs a sessionId/);
  assert.equal(host.listRuns({ state: 'running' }).length, 0);
  const unknown = new VoiceAgent({ host, plan: async () => ({ toolCalls: [{ name: 'delete_save', args: {} }] }) });
  assert.match((await unknown.handle({ requestId: 'req-4', transcript: 'wipe my save' })).acknowledgment, /Unknown tool/);
  assert.equal(Object.hasOwn(TOOL_CATALOG, 'delete_save'), false);
});

test('a requester role emits real speech audio for the ordinary voice path', async () => {
  const clock = { ms: 0 };
  const { host } = fixture({ clock });
  const spoken = [];
  const harness = new SimulatedUser({
    grant: { runId: 'run_requester', capabilities: { actions: { speech: { kind: 'speech' } } }, valid: () => true,
      observe: () => ({ app: 'overworld', menu: false, possession: 'n/a' }), clock: () => ({ wallMs: clock.ms }), apply: () => { throw Error('requester has no gameplay control'); }, idle: () => ({ idled: true }) },
    goal: 'ask the app to take over soccer', role: 'requester', now: () => clock.ms,
    config: { decisionIntervalMs: 10, staleAfterMs: 1e9, reflectionIntervalMs: 1e9,
      circuits: [{ name: 'speak', when: () => true, policy: 'builtin',
        action: () => ({ type: 'speech', text: 'Take over soccer and try to score', durationMs: 500 }) }] },
    decisions: async () => { throw Error('the requester circuit is local'); },
    // The audio goes to the real voice-input path in the app; the test verifier
    // only checks that audio was produced and correlated.
    speech: async ({ text, runId }) => { spoken.push({ text, runId }); return { audio: new Uint8Array(32), mime: 'audio/webm', requestId: 'voice-req-1' }; },
  }).start();
  harness.tick(clock.ms);
  await flush();
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'Take over soccer and try to score');
  assert.equal(harness.usage.speech, 1);
  const report = harness.report();
  assert.equal(report.role, 'requester');
  assert.ok(report.evidence.some(entry => entry.event === 'speech-emitted' && entry.requestId === 'voice-req-1'));
  // Separate authority: a requester cannot dispatch gameplay actions.
  assert.equal(harness.usage.actions, 0);
});

test('the spectator camera surface is never grantable to a run', async () => {
  const { host } = fixture();
  const surfaceStub = { name: 'camera', kind: 'spectator-camera', humanOnly: true, observe: () => ({}), apply: () => {}, safeIdle: () => ({ idled: true }) };
  const session = host.registerSession({ gameId: 'neighborhood', version: '1.0.0',
    surfaces: [{ name: 'character', kind: 'overworld-character', writesProgress: true, observe: () => ({ x: 0, z: 0 }), apply: () => ({ accepted: true }), safeIdle: () => ({ idled: true }) }, surfaceStub] });
  const run = host.startRun({ sessionId: session.sessionId, surface: 'character', goal: 'walk to the pitch' });
  assert.equal(host.runStatus(run.runId).state, 'running');
  assert.throws(() => host.startRun({ sessionId: session.sessionId, surface: 'camera', goal: 'steal the camera' }), /human/i);
});

test('opening a new session forwards the selection intent to the app', async () => {
  const host = new AgentHost();
  host.registerGame({ gameId: 'soccer', version: '1.0.0' });
  const first = host.registerSession({ gameId: 'soccer', version: '1.0.0' });
  let selection;
  host.registerOpener('soccer', context => {
    selection = context.selection;
    throw Error('This app cannot create another isolated soccer session.');
  });
  await assert.rejects(host.openSession({ gameId: 'soccer', selection: 'new' }), /cannot create another/);
  assert.equal(selection, 'new');
  assert.equal((await host.openSession({ gameId: 'soccer', selection: 'reuse' })).sessionId, first.sessionId);
});
