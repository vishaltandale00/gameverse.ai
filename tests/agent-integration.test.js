import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createAgentApi, agentConfiguration, toDecisionsWire } from '../scripts/agent-api.mjs';
import { createPlanner, createDecisionsPolicy, createReflector, createSpeechAdapter } from '../src/agent-client.js';
import { createTakeoverShell } from '../src/agent-shell.js';
import { createRequesterCapture, requesterSpeechAdapter, encodeAudioBase64 } from '../src/requester-capture.js';
import { verifyEvidence } from '../scripts/verify-takeover-evidence.mjs';
import { soccerDefinition } from '../src/soccer.js';
import { mergePendingInput } from '../src/sports-feedback.js';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };

// --- local agent API over real HTTP, provider reached only through fetchImpl ---
async function server(t, { env = {}, respond } = {}) {
  const calls = [], reports = [];
  const handler = createAgentApi({
    env: { OPENAI_API_KEY: 'test-secret-key', ...env },
    fetchImpl: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return respond(url, JSON.parse(init.body)); },
    report: entry => reports.push(entry),
  });
  const node = http.createServer(async (req, res) => { if (!await handler(req, res, new URL(req.url, 'http://localhost').pathname)) res.writeHead(404).end(); });
  await new Promise(resolve => node.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${node.address().port}`;
  t.after(() => new Promise(resolve => node.close(resolve)));
  return { base, calls, reports, fetchImpl: (path, init) => fetch(base + path, init) };
}
const answers = rows => new Response(JSON.stringify({ answers: rows }), { headers: { 'Content-Type': 'application/json' } });

test('the server-only boundary translates planner and decision calls and never exposes the key', async t => {
  const f = await server(t, { respond: (url, body) => {
    assert.equal(url, 'https://api.openai.com/v1/decisions');
    return answers(body.questions.map(question => question.type === 'choice'
      ? { name: question.name, type: 'choice', choice: question.choices[0].value }
      : { name: question.name, type: 'predicate', probability: 0.1 }));
  } });
  const config = await (await f.fetchImpl('/api/agent/config')).json();
  assert.equal(config.available, true);
  assert.equal(JSON.stringify(config).includes('test-secret-key'), false, 'config never carries the key');
  assert.equal(config.documentation.decisions, 'https://developers.openai.com/api/docs/guides/decisions');

  const decide = createDecisionsPolicy({ fetchImpl: f.fetchImpl });
  const decision = await decide({ observation: { team: 0, menu: false, phase: 'live', possession: 'us' }, goal: 'try to score',
    memory: { recentActions: [], reflections: [] }, capabilities: { directions: ['stop', 'right'], actions: { move: { kind: 'move' }, shot: { kind: 'charged' } } }, seq: 1 });
  assert.equal(decision.action.type, 'move');
  assert.equal(decision.model, 'gpt-6-luna');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer test-secret-key');
  // The browser-facing request carries no credential of any kind.
  const names = f.calls[0].body.questions.map(question => question.name);
  assert.deepEqual(names, ['move', 'action']);
  assert.equal(JSON.stringify(f.calls[0].body).includes('test-secret-key'), false);
  assert.ok(f.reports.every(entry => entry.operation.startsWith('agent:') && entry.wallMs >= 0));
  assert.equal(JSON.stringify(f.reports).includes('test-secret-key'), false, 'server reports never log the key');
});

test('a missing key, bad question set, unknown route and cross-origin call fail honestly', async t => {
  const f = await server(t, { env: { OPENAI_API_KEY: '' }, respond: () => answers([]) });
  assert.equal((await (await f.fetchImpl('/api/agent/config')).json()).available, false);
  const call = await f.fetchImpl('/api/agent/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'x', questions: [{ name: 'a', type: 'choice', instructions: 'i', choices: [{ value: '1' }, { value: '2' }] }] }) });
  assert.equal(call.status, 503);
  assert.match((await call.json()).error, /OPENAI_API_KEY/);
  const bad = await f.fetchImpl('/api/agent/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'x', questions: [{ name: 'a', type: 'freetext', instructions: 'i' }] }) });
  assert.equal(bad.status, 400);
  assert.equal((await f.fetchImpl('/api/agent/nope', { method: 'POST', body: '{}' })).status, 404);
  const cross = await f.fetchImpl('/api/agent/reflect', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify({ input: 'x' }) });
  assert.equal(cross.status, 403);
});

test('reflection text is aggregated across output parts and speech returns real audio bytes', async t => {
  const f = await server(t, { respond: url => url.endsWith('/responses')
    ? new Response(JSON.stringify({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'GOAL REACHED: you scored.' }] }] }), { headers: { 'Content-Type': 'application/json' } })
    : new Response(new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]), { headers: { 'Content-Type': 'audio/wav' } }) });
  const reflection = await createReflector({ fetchImpl: f.fetchImpl })({ observation: { phase: 'live' }, memory: { recentActions: [] }, goal: 'score', usage: {}, seq: 2 });
  assert.equal(reflection.goalReached, true);
  assert.match(reflection.note, /GOAL REACHED/);
  const spoken = await createSpeechAdapter({ fetchImpl: f.fetchImpl })({ text: 'Take over soccer and try to score', runId: 'run_x' });
  assert.equal(spoken.bytes, 8);
  assert.equal(spoken.mime, 'audio/wav');
  assert.equal(f.calls.at(-1).body.input, 'Take over soccer and try to score');
});

test('agent provider limits are configurable and enforced without a provider call', async t => {
  const f = await server(t, { env: { AGENT_MAX_REFLECTIONS_PER_MINUTE: '1' }, respond: () => new Response(JSON.stringify({ output_text: 'ok' }), { headers: { 'Content-Type': 'application/json' } }) });
  const body = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'reflect please' }) };
  assert.equal((await f.fetchImpl('/api/agent/reflect', body)).status, 200);
  const second = await f.fetchImpl('/api/agent/reflect', body);
  assert.equal(second.status, 429);
  assert.equal(f.calls.length, 1, 'the rate cap stops the call before the provider');
  assert.equal(agentConfiguration({ AGENT_MAX_REFLECTIONS_PER_MINUTE: '1' }).maxReflectionsPerMinute, 1);
});

// --- shell integration over the real soccer model -----------------------------
function liveMatch(clock, gameId = 'soccer') {
  const state = soccerDefinition.createState(); state.phase = 'live';
  const handle = { gameId, version: '1.0.0', definition: soccerDefinition, agentInput: null, frames: 0, holds: [],
    state: () => state, frame: () => handle.frames, paused: () => false,
    setAgentInput: frame => { handle.agentInput = frame; }, hold: held => handle.holds.push(held),
    advance(ms) { for (let elapsed = 0; elapsed < ms; elapsed += 1000 / 60) {
      soccerDefinition.step(state, 1 / 60, mergePendingInput(handle.agentInput || { move: { x: 0, y: 0 }, held: {}, pressed: {}, released: {}, cancelled: {} }, null));
      handle.frames++; clock.ms += 1000 / 60;
      if (handle.agentInput) handle.agentInput = { ...handle.agentInput, pressed: {}, released: {}, cancelled: {} };
    } } };
  return handle;
}
function shellFixture({ plan, decisions = async () => ({ action: { type: 'move', direction: 'right' } }), harnessConfig } = {}) {
  const clock = { ms: 0 }, renders = [], handles = [];
  const shell = createTakeoverShell({
    now: () => clock.ms, render: view => renders.push(view), plan, decisions,
    harnessConfig: harnessConfig || { decisionIntervalMs: 50, actionDurationMs: 200, staleAfterMs: 400, reflectionIntervalMs: 1e9 },
    openSubgame: ({ gameId, identity, register }) => {
      const handle = liveMatch(clock, gameId); handles.push(handle);
      return register({ handle, identity, progressKey: `${gameId}:${identity.profileId || 'player'}` });
    },
  });
  shell.host.registerGame({ gameId: 'soccer', version: '1.0.0', name: 'Alder Five' });
  shell.host.registerGame({ gameId: 'football', version: '1.0.0', name: 'Foundry Field' });
  return { shell, clock, renders, handles };
}

test('one voice command can launch several simulated users on different targets', async () => {
  const plan = async ({ transcript, state }) => {
    assert.match(transcript, /both/i);
    assert.ok(state.games.length >= 2, 'the planner sees the real supported targets');
    return { model: 'gpt-6-luna', provider: 'openai', say: 'Starting both.', toolCalls: [
      { name: 'open_session', args: { gameId: 'soccer', selection: 'new' } },
      { name: 'start_simulated_user', args: { goal: 'try to score', fromPreviousSession: true } },
      { name: 'open_session', args: { gameId: 'football', selection: 'new' } },
      { name: 'start_simulated_user', args: { goal: 'move the ball downfield', fromPreviousSession: true } },
    ] };
  };
  const { shell, handles } = shellFixture({ plan });
  const record = await shell.handleTranscript({ requestId: 'req-multi', text: 'Play both games for me' });
  assert.equal(record.outcome, 'completed');
  assert.equal(record.runs.length, 2);
  assert.notEqual(record.runs[0].sessionId, record.runs[1].sessionId);
  assert.deepEqual(record.runs.map(run => run.gameId), ['soccer', 'football']);
  assert.equal(shell.observe().running.length, 2);
  // Both live runtimes were actually told to hold control for background play.
  assert.ok(handles.every(handle => handle.holds.includes(true)));
  // Every tool call is correlated to the one voice request.
  assert.ok(record.toolCalls.every(call => call.callId.startsWith('req-multi:')));
  // Stopping one leaves the other running and its runtime still held.
  shell.stop(record.runs[0].runId);
  assert.equal(shell.observe().running.length, 1);
  assert.equal(handles[0].holds.at(-1), false);
  assert.equal(handles[1].holds.at(-1), true);
});

test('session selection honours reuse and new, and reuse without a session fails truthfully', async () => {
  const { shell } = shellFixture({ plan: async () => ({ toolCalls: [] }) });
  await assert.rejects(shell.host.openSession({ gameId: 'soccer', selection: 'reuse' }), /No running soccer session/);
  const opened = await shell.host.openSession({ gameId: 'soccer', selection: 'new' });
  const reused = await shell.host.openSession({ gameId: 'soccer', selection: 'reuse' });
  assert.equal(reused.sessionId, opened.sessionId);
  const fresh = await shell.host.openSession({ gameId: 'soccer', selection: 'new', identity: { profileId: 'sim-copy' } });
  assert.notEqual(fresh.sessionId, opened.sessionId);
  assert.equal(shell.host.listSessions({ gameId: 'soccer' }).length, 2);
});

test('visible Stop works synchronously while a decision is outstanding, and the late answer is rejected', async () => {
  let resolveDecision = null;
  const { shell, clock, handles } = shellFixture({
    plan: async () => ({ model: 'gpt-6-luna', toolCalls: [
      { name: 'open_session', args: { gameId: 'soccer', selection: 'new' } },
      { name: 'start_simulated_user', args: { goal: 'try to score', fromPreviousSession: true } }] }),
    decisions: () => new Promise(resolve => { resolveDecision = resolve; }),
  });
  const record = await shell.handleTranscript({ requestId: 'req-stop', text: 'take over soccer' });
  const runId = record.runs[0].runId;
  shell.tick(clock.ms); await flush();
  const harness = shell.host.runs.get(runId).harness;
  assert.ok(harness.pending, 'a decision is outstanding');
  handles[0].advance(200); // the match keeps running meanwhile
  const stopped = shell.stop(runId, 'player pressed Stop');
  assert.equal(stopped.state, 'released');
  assert.equal(shell.observe().running.length, 0);
  assert.equal(handles[0].holds.at(-1), false, 'the runtime stops being held');
  const framesAtStop = handles[0].frame();
  resolveDecision({ action: { type: 'shot', direction: 'right' } });
  await flush();
  handles[0].advance(100);
  assert.equal(harness.usage.stale, 1, 'the late decision is discarded');
  assert.equal(harness.usage.actions, 0, 'no action was dispatched after the stop');
  assert.ok(handles[0].frame() > framesAtStop);
  assert.match(shell.observe().acknowledgment, /Stopped run_/);
  assert.equal(shell.statusText(), 'No simulated user is running.');
});

test('a planner failure is reported truthfully and starts nothing', async () => {
  const { shell } = shellFixture({ plan: async () => { throw Error('the planner backend is unavailable'); } });
  const record = await shell.handleTranscript({ requestId: 'req-bad', text: 'take over soccer' });
  assert.equal(record.outcome, 'planner-failed');
  assert.match(record.acknowledgment, /planner backend is unavailable/);
  assert.equal(shell.observe().running.length, 0);
});

// --- requester speech through the real capture path ---------------------------
test('requester speech becomes decoded audio on a MediaStream, never an injected transcript', async () => {
  const synthesized = [];
  const audio = new Uint8Array([82, 73, 70, 70, 9, 9, 9, 9]);
  const tracks = [{ kind: 'audio', stopped: false, stop() { this.stopped = true; }, addEventListener() {} }];
  const decoded = [];
  const capture = createRequesterCapture({
    speech: async ({ text, runId }) => { synthesized.push({ text, runId }); return { audio, mime: 'audio/wav' }; },
    createAudioContext: () => ({
      decodeAudioData: async bytes => { decoded.push(bytes.byteLength ?? bytes.length); return { duration: 1.4 }; },
      createMediaStreamDestination: () => ({ stream: { getTracks: () => tracks } }),
      createBufferSource: () => ({ connect() {}, start() {}, set buffer(value) { this._buffer = value; } }),
    }),
  });
  await assert.rejects(capture.getUserMedia(), /No simulated requester speech is queued/);
  const adapter = requesterSpeechAdapter(capture);
  const queued = await adapter({ text: 'Take over soccer and try to score', runId: 'run_requester' });
  assert.equal(queued.bytes, 8);
  assert.equal(queued.viaCapture, true);
  assert.equal(queued.audio.byteLength, 0, 'the harness never receives a transcript or raw audio to replay itself');
  assert.equal(capture.pending.text, 'Take over soccer and try to score');
  const stream = await capture.getUserMedia({ audio: { echoCancellation: true } });
  assert.deepEqual(decoded, [8], 'the real audio bytes were decoded for playback');
  assert.equal(stream.getTracks()[0].kind, 'audio');
  assert.equal(capture.pending, null, 'audio is consumed once, like a microphone utterance');
  assert.deepEqual(capture.evidence().map(entry => entry.bytes), [8]);
  // The capture module exposes no transcript or gameplay-tool entry point.
  assert.deepEqual(Object.keys(capture).filter(key => /transcript|tool|play/i.test(key)), []);
});

// --- separate verifier with negative controls --------------------------------
const goodEvidence = () => ({
  identity: { sourceCommit: 'abc1234', gameId: 'soccer', gameVersion: '1.0.0', adapter: 'custom-sports', harness: 'simulated-user-harness-v1', agent: 'voice-agent-v1' },
  receipt: { requestId: 'req-1', processing: 'agent', text: 'take over soccer and try to score', transcription: { mode: 'realtime' } },
  capture: { source: 'requester-capture', audioBytes: 4096, transcriptFromAudio: true },
  agent: { planner: { model: 'gpt-6-luna' }, toolCalls: [{ callId: 'req-1:1', name: 'open_session', ok: true }, { callId: 'req-1:2', name: 'start_simulated_user', ok: true }] },
  runs: [{ runId: 'run_a', sessionId: 'ses_a', harness: 'simulated-user-harness-v1', usage: { actions: 12 },
    actionLog: Array.from({ length: 12 }, () => ({ accepted: true })),
    actionLogWindow: { retained: 12, logged: 12, lifetimeActions: 12, complete: true, evidenceTrimmed: false },
    reflections: [{ note: 'keep the ball wide', at: 1, seq: 4 }],
    clockSamples: [{ frame: 100, decisionOutstanding: true }, { frame: 140, decisionOutstanding: true }] },
  { runId: 'run_b', sessionId: 'ses_overworld', gameId: 'overworld', harness: 'simulated-user-harness-v1', usage: { actions: 5 },
    actionLog: Array.from({ length: 5 }, () => ({ accepted: true })),
    actionLogWindow: { retained: 5, logged: 5, lifetimeActions: 5, complete: true, evidenceTrimmed: false },
    // The overworld exposes simulation time, not match frames: no universal
    // frame rate is assumed anywhere.
    clockSamples: [{ frame: null, simulationMs: 8200, decisionOutstanding: true }, { frame: null, simulationMs: 11400, decisionOutstanding: true }] }],
  stop: { runId: 'run_a', stoppedAt: 1000, heldInput: 'cleared', heldInputClearedAt: 1010, chargedActionFired: false,
    lateResultsAccepted: false, outstandingAtStop: true, lateResultsRejected: 2, otherRunsAffected: false,
    humanControl: { inputDispatched: true, engineResponded: true, movedUnits: 0.62, detail: 'human KeyD moved the selected player 0.62 units' } },
  commands: [
    { requestId: 'req-1', transcript: 'take over soccer and try to score', toolCalls: [{ callId: 'req-1:1', name: 'open_session', ok: true }, { callId: 'req-1:2', name: 'start_simulated_user', ok: true }], runs: [{ runId: 'run_a' }] },
    { requestId: 'req-2', transcript: 'also take over my character outside', toolCalls: [{ callId: 'req-2:1', name: 'open_session', ok: true }, { callId: 'req-2:2', name: 'start_simulated_user', ok: true }], runs: [{ runId: 'run_b' }] },
    { requestId: 'req-3', receipt: { requestId: 'req-3', processing: 'agent', transcription: { mode: 'realtime' } }, transcript: 'stop the soccer simulated user', toolCalls: [{ callId: 'req-3:1', name: 'stop_run', ok: true, targetRunId: 'run_a', startedAt: 990, releasedAt: 1000, resultOutcome: 'stopped' }], runs: [] },
  ],
  providerLedger: { ledger: { decisions: 38, reflect: 3, plan: 3, speech: 3, transcription: 3, aborted: null } },
  lifecycle: { sessionId: 'ses_a', leftSubgame: true, reopenedSessionId: 'ses_a', frameAtLeave: 200, frameAtReopen: 920,
    spectatorCameraMovedIndependently: true, agentTrajectoryDelta: 0.01 },
  quality: { shots: 2, shotCounter: { first: 0, last: 2 }, possessionSeconds: 14, attemptsTowardGoal: 3, score: [0, 0] },
  requester: { runIds: ['run_requester'], role: 'requester', utterances: 2 },
  journey: { requesterSpeech: { ok: true, bytes: 4096 }, agentTookOver: { ok: true, runId: 'run_a' }, leftSubgame: true,
    reopenedSession: { ok: true, sessionId: 'ses_a' }, concurrentRun: { ok: true, count: 2 },
    spokenStop: { ok: true, requestId: 'req-3', target: 'run_a' }, visibleStop: { ok: true, target: 'run_b' } },
  infrastructure: { failures: [] },
  goal: { claimedByActor: true, engineObserved: false },
  recording: { path: 'verification/takeover.webm' },
});

test('the verifier accepts consistent evidence but never promotes a claim or quality into qualification', () => {
  const report = verifyEvidence(goodEvidence());
  assert.equal(report.verdict, 'evidence-consistent');
  assert.equal(report.protocol, 'passed');
  assert.equal(report.goalOutcome, 'not-reached', 'a scoring attempt is not a goal');
  assert.equal(report.quality.verdict, 'attempted-scoring');
  assert.match(report.quality.note, /not a qualification verdict/);
  assert.match(report.note, /Rendered real-provider qualification/);
});

test('the verifier rejects each negative control', () => {
  const cases = {
    'missing identity': evidence => { delete evidence.identity.sourceCommit; },
    'transcript injection': evidence => { evidence.capture = { source: 'transcript-injection', transcriptFromAudio: false }; },
    'uncorrelated tool calls': evidence => { evidence.agent.toolCalls[1].callId = 'other:9'; },
    'run without a session scope': evidence => { evidence.agent.toolCalls = [{ callId: 'req-1:1', name: 'start_simulated_user', ok: true }]; },
    'direct gameplay tool shortcut': evidence => { evidence.shortcuts = { directGameplayToolCall: true }; },
    'frozen clock during a decision': evidence => { evidence.runs[0].clockSamples = [{ frame: 100, decisionOutstanding: true }, { frame: 100, decisionOutstanding: true }]; },
    'inflated action count': evidence => { evidence.runs[0].usage.actions = 50; },
    'stop left input held': evidence => { evidence.stop.heldInput = 'unavailable'; },
    'stop fired a charged action': evidence => { evidence.stop.chargedActionFired = true; },
    'late result mutated the session': evidence => { evidence.stop.lateResultsAccepted = true; },
    'stop hit another run': evidence => { evidence.stop.otherRunsAffected = true; },
    'reopen created a new session': evidence => { evidence.lifecycle.reopenedSessionId = 'ses_b'; },
    'no background progress': evidence => { evidence.lifecycle.frameAtReopen = 200; },
    'spectator input moved the character': evidence => { evidence.lifecycle.agentTrajectoryDelta = 0.9; },
    'two progress writers': evidence => { evidence.runs[0].progressWriterConflict = true; },
    'receipt never reached the agent': evidence => { evidence.receipt.processing = 'agent-pending'; },
    'a journey stage failed': evidence => { evidence.journey.spokenStop = { ok: false, reason: 'the spoken stop released nothing' }; },
    'the visible Stop never ran': evidence => { evidence.journey.visibleStop = false; },
    'requester shares a run identity with gameplay': evidence => { evidence.requester.runIds = ['run_a']; },
    'requester produced no audio': evidence => { evidence.capture.audioBytes = 0; },
    'engine recorded no shot attempt': evidence => { evidence.quality.shotCounter = { first: 3, last: 3 }; },
    'a complete action log contradicts the action count': evidence => { evidence.runs[0].actionLogWindow.lifetimeActions = 12; evidence.runs[0].actionLog = [{ accepted: true }]; },
    'more dispatches logged than counted': evidence => { evidence.runs[0].usage.actions = 2; },
    'no engine clock advanced during a wait': evidence => { evidence.runs[1].clockSamples = [{ simulationMs: 8200, decisionOutstanding: true }, { simulationMs: 8200, decisionOutstanding: true }]; },
    'the only safe-idle predates the stop': evidence => { evidence.stop.heldInputClearedAt = 900; },
    'outstanding work at stop with no discarded late result': evidence => { evidence.stop.lateResultsRejected = 0; },
    'human input produced no engine response': evidence => { evidence.stop.humanControl = { inputDispatched: true, engineResponded: false, detail: 'nothing moved' }; },
    'a spoken command is not correlated to its tool calls': evidence => { evidence.commands[1].toolCalls[0].callId = 'req-9:1'; },
    'no reflection ran': evidence => { evidence.providerLedger.ledger.reflect = 0; },
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const evidence = goodEvidence(); mutate(evidence);
    const report = verifyEvidence(evidence);
    assert.equal(report.verdict, 'evidence-insufficient', `${label} must not pass`);
    assert.ok(report.failures.length >= 1, `${label} must name a failing check`);
  }
  // An actor claiming the goal without engine evidence is rejected, not believed.
  const claimed = goodEvidence(); claimed.goal = { claimedByActor: true, engineObserved: null };
  assert.equal(verifyEvidence(claimed).goalOutcome, 'claim-only-rejected');
  // Missing evidence is "unproven", never a silent pass.
  const empty = verifyEvidence({});
  assert.equal(empty.verdict, 'evidence-insufficient');
  assert.equal(empty.quality.assessed, false);
  assert.ok(empty.unknowns.includes('recording'));
});

// --- actual main.js wiring ----------------------------------------------------
test('main.js wires the real adapter handle, background lifetime and the host panel', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  // The live adapter, not a copy, is registered as the control surface.
  assert.match(source, /takeover\.registerSportsSession\(\{ handle: current\.adapter\.controlHandle\(\)/);
  // Leaving must consult host ownership before disposing anything.
  const leave = source.slice(source.indexOf('async function leaveSession'), source.indexOf('async function saveAndReturn'));
  assert.match(leave, /takeover\.disposable\(current\.agentSessionId\)/);
  const keepBranch = leave.slice(leave.indexOf('if (keepRunning)'), leave.indexOf('if (current.agentSessionId) takeover.host.closeSession'));
  assert.equal(/dispose\(\)/.test(keepBranch), false, 'a held session is never disposed on leave');
  assert.equal(/current\.release\(\)/.test(keepBranch), false, 'the progress lock is retained while a run owns the session');
  assert.match(keepBranch, /backgroundSessions\.set\(current\.game\.id, current\)/);
  assert.match(keepBranch, /takeover\.setDisplayed\(current\.agentSessionId, false\)/);
  // Reopening restores the same session object without reloading it.
  const open = source.slice(source.indexOf('async function startGame'), source.indexOf('function failSession'));
  const restore = open.slice(open.indexOf('const background = backgroundSessions.get'), open.indexOf('if (neighborhoodOpen) return;'));
  assert.match(restore, /session = background/);
  assert.equal(/adapter\.load\(/.test(restore), false, 'reopening must not reload the match');
  assert.match(restore, /takeover\.setDisplayed\(background\.agentSessionId, true\)/);
  // Stop is a direct host call from a plain button, and the tick loop is separate
  // from shell input polling so a harness error cannot break menu handling.
  assert.match(source, /onStop: run => \{ takeover\.stop\(run\.runId\); handbackAfterStop\(run\); \}/);
  assert.match(source, /function tickTakeover\(now\) \{ takeover\.tick/);
  assert.equal(/function pollInput\(now\) \{\n  takeover\.tick/.test(source), false);
  // The retained transcript is dispatched to the agent and its outcome retained.
  assert.match(source, /void dispatchVoiceCommand\(view\.requestId, view\.text\)/);
  assert.match(source, /\/api\/voice\/requests\/\$\{requestId\}\/agent/);
  assert.equal(/OPENAI_API_KEY|sk-/.test(source), false, 'no credential or provider key appears in client source');
});

test('the shell refuses a runtime handle that does not match the requested target', async () => {
  const clock = { ms: 0 };
  const shell = createTakeoverShell({ now: () => clock.ms, plan: async () => ({ toolCalls: [] }),
    decisions: async () => ({ action: { type: 'move', direction: 'right' } }),
    openSubgame: ({ identity, register }) => register({ handle: liveMatch(clock, 'soccer'), identity, progressKey: 'soccer:player' }) });
  shell.host.registerGame({ gameId: 'football', version: '1.0.0', name: 'Foundry Field' });
  await assert.rejects(shell.host.openSession({ gameId: 'football', selection: 'new' }), /opened 'soccer' for a 'football' request/);
});

test('a charged shot decision actually fires in the engine, and Stop still cancels one', async () => {
  // Use the fixture's own clock: the harness and the match must share one.
  const { shell, handles, clock } = shellFixture({
    plan: async () => ({ model: 'gpt-6-luna', toolCalls: [
      { name: 'open_session', args: { gameId: 'soccer', selection: 'new' } },
      { name: 'start_simulated_user', args: { goal: 'try to score', fromPreviousSession: true } }] }),
    decisions: async () => ({ action: { type: 'shot', direction: 'right', durationMs: 300 } }),
  });
  const record = await shell.handleTranscript({ requestId: 'req-shot', text: 'take over soccer and shoot' });
  const runId = record.runs[0].runId;
  const handle = handles[0], state = handle.state();
  state.ball.owner = state.active; state.charging = null; state.charge = 0;
  const shotsBefore = state.stats.shots[0];
  // Drive real frames and harness ticks together, as the app's loops do.
  for (let step = 0; step < 40; step++) { shell.tick(clock.ms); await flush(); handle.advance(1000 / 60 * 2); }
  const harness = shell.host.runs.get(runId).harness;
  // Fixed this turn: adopt() sets `release` on the current action and tick() now
  // reads that same field, so the held button is released inside the action's
  // bounded duration instead of being cancelled by expiry safe-idle.
  assert.ok(harness.report().actionLog.some(entry => entry.action === 'release'),
    'the harness released the charged button inside the action duration');
  // Engine truth, not an actor claim: the match's own shot counter must move.
  const engineShots = state.stats.shots[0] - shotsBefore;
  assert.ok(engineShots > 0, `the engine recorded a shot attempt (delta ${engineShots})`);
  assert.ok(harness.report().chargeEvents.some(entry => entry.event === 'charge-continued'),
    'the hold continued across fresh decisions on its original schedule');
  // Stop while charged must still cancel rather than strike.
  state.ball.owner = state.active;
  shell.tick(clock.ms); await flush(); handle.advance(100);
  const shotsAtStop = state.stats.shots[0];
  shell.stop(runId);
  handle.advance(300);
  assert.equal(state.charging, null);
  assert.equal(state.stats.shots[0], shotsAtStop, 'explicit Stop never fires a held charged shot');
});

test('planner target choices stay unique when the overworld is also in the catalog', async () => {
  const requests = [];
  const plan = createPlanner({ fetchImpl: async (path, init) => { requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ model: 'gpt-6-luna', provider: 'openai', answers: [
      { name: 'intent', type: 'choice', choice: 'start' }, { name: 'target', type: 'choice', choice: 'overworld' },
      { name: 'selection', type: 'choice', choice: 'auto' }, { name: 'second_run', type: 'predicate', probability: 0.1 }] }), { headers: { 'Content-Type': 'application/json' } }); } });
  const planned = await plan({ transcript: 'take over my character', context: {},
    state: { games: [{ gameId: 'soccer', name: 'Alder Five' }, { gameId: 'overworld', name: 'Gameverse' }], sessions: [], runs: [], displayed: null } });
  const targets = requests[0].questions.find(question => question.name === 'target').choices.map(choice => choice.value);
  assert.deepEqual(targets, [...new Set(targets)], 'no duplicate Decisions choice values');
  assert.ok(targets.includes('overworld'));
  assert.deepEqual(planned.toolCalls.map(call => call.name), ['open_session', 'start_simulated_user']);
  assert.equal(planned.toolCalls[0].args.gameId, 'overworld');
  // With live runs present a stop command targets the chosen run, not all runs.
  const stopPlan = createPlanner({ fetchImpl: async () => new Response(JSON.stringify({ answers: [
    { name: 'intent', type: 'choice', choice: 'stop' }, { name: 'target', type: 'choice', choice: 'soccer' },
    { name: 'selection', type: 'choice', choice: 'auto' }, { name: 'run', type: 'choice', choice: 'run_two' },
    { name: 'second_run', type: 'predicate', probability: 0.05 }] }), { headers: { 'Content-Type': 'application/json' } }) });
  const stopped = await stopPlan({ transcript: 'stop the soccer agent', context: {},
    state: { games: [{ gameId: 'soccer', name: 'Alder Five' }], sessions: [],
      runs: [{ runId: 'run_one', gameId: 'overworld', surface: 'character', goal: 'walk' }, { runId: 'run_two', gameId: 'soccer', surface: 'play', goal: 'score' }], displayed: null } });
  assert.deepEqual(stopped.toolCalls, [{ name: 'stop_run', args: { runId: 'run_two', reason: 'voice stop command' }, stopOnError: false }]);
});

test('the harness tick chain starts exactly once, outside the input polling function', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const lines = source.split('\n');
  const pollStart = lines.findIndex(line => line.startsWith('function pollInput('));
  assert.ok(pollStart >= 0);
  const pollEnd = pollStart + lines.slice(pollStart).findIndex(line => line === '}');
  // Inside pollInput there must be no tick reference at all: pollInput
  // reschedules itself every frame, so a tick chain started there would spawn a
  // new perpetual RAF chain per input frame.
  const inside = lines.slice(pollStart, pollEnd).filter(line => line.includes('tickTakeover'));
  assert.deepEqual(inside, [], 'the harness tick chain must not be started inside pollInput');
  const definitions = lines.filter(line => line.startsWith('function tickTakeover'));
  const starts = lines.filter(line => line === 'requestAnimationFrame(tickTakeover);');
  assert.equal(definitions.length, 1, 'exactly one top-level tick function');
  assert.equal(starts.length, 1, 'exactly one top-level tick chain start');
});

test('a representative utterance is retained whole, without an argument-limit overflow', async () => {
  // ~200 kB: about 4 s of 24 kHz 16-bit mono speech. Spreading that into
  // String.fromCharCode throws RangeError, so encoding must be chunked.
  const audio = new Uint8Array(200_000);
  for (let index = 0; index < audio.length; index++) audio[index] = (index * 31) % 256;
  const encoded = encodeAudioBase64(audio);
  assert.equal(encoded.bytes, 200_000);
  assert.equal(encoded.retainedBytes, 200_000);
  assert.equal(encoded.truncated, false);
  assert.deepEqual([...Buffer.from(encoded.base64, 'base64')], [...audio], 'retained audio round-trips byte for byte');
  const capture = createRequesterCapture({
    speech: async () => ({ audio, mime: 'audio/wav' }),
    createAudioContext: () => ({ decodeAudioData: async () => ({ duration: 4.1 }),
      createMediaStreamDestination: () => ({ stream: { getTracks: () => [{ kind: 'audio', stop() {} }] } }),
      createBufferSource: () => ({ connect() {}, start() {}, set buffer(value) { this._buffer = value; } }), currentTime: 0 }),
  });
  const queued = await capture.say({ text: 'Take over soccer and try to score', runId: 'run_long' });
  assert.equal(queued.bytes, 200_000);
  const [utterance] = capture.evidence();
  assert.equal(utterance.bytes, 200_000);
  assert.equal(utterance.truncated, false);
  assert.equal(Buffer.from(utterance.audioBase64, 'base64').byteLength, 200_000);
});

test('the verifier reports unknown, not pass, when stop or human-control evidence is absent', () => {
  const evidence = goodEvidence();
  delete evidence.stop.outstandingAtStop; delete evidence.stop.humanControl;
  const report = verifyEvidence(evidence);
  const byId = Object.fromEntries(report.checks.map(check => [check.id, check.status]));
  assert.equal(byId['stop-late-results'], 'unknown', 'absence of a late answer is never proof of rejection');
  assert.equal(byId['human-resumed'], 'unknown');
  assert.ok(report.unknowns.includes('stop-late-results'));
  // Unknowns in protocol-relevant checks keep the protocol unproven, not passed.
  const noCommands = goodEvidence(); noCommands.commands = []; delete noCommands.journey.spokenStop;
  assert.equal(verifyEvidence(noCommands).protocol, 'unproven');
});

test('the qualification harness config fits the global caps and produces real reflections', async () => {
  const { QUALIFICATION_HARNESS_CONFIG } = await import('../src/qualification.js');
  const { QUALIFICATION_CAPS } = await import('../scripts/agent-api.mjs');
  const config = QUALIFICATION_HARNESS_CONFIG;
  // A run must reach its first reflection well before its decision budget ends.
  const runLifeMs = config.maxDecisions * config.decisionIntervalMs;
  assert.ok(config.reflectionIntervalMs < runLifeMs / 2,
    `reflection interval ${config.reflectionIntervalMs} must fire inside a ${runLifeMs} ms run`);
  assert.ok(runLifeMs >= 80000, 'a run must survive play, concurrency, reopen and both stops');
  // Two gameplay runs (the second starts later) must fit the global decision cap.
  assert.ok(config.chargedActionDurationMs > 0 && config.chargedActionDurationMs <= 900,
    'a charged action must be short enough to strike before a tackle');
  assert.ok(config.circuits.some(circuit => circuit.policy === 'decisions' && /shot at goal now/i.test(circuit.intent || '')),
    'a possession-aware circuit must ask the model for a shot, through the Decisions API');
  assert.equal(config.circuits.some(circuit => circuit.policy === 'builtin' && /shot|pass|tackle/i.test(JSON.stringify(circuit))), false,
    'no built-in circuit may bypass the model for a gameplay action');
  const secondRunDecisions = Math.ceil(45000 / config.decisionIntervalMs);
  assert.ok(config.maxDecisions + secondRunDecisions <= QUALIFICATION_CAPS.decisions,
    `${config.maxDecisions} + ${secondRunDecisions} decisions must fit ${QUALIFICATION_CAPS.decisions}`);
  assert.ok(config.maxReflections * 2 <= QUALIFICATION_CAPS.reflect);
  assert.ok(config.staleAfterMs > 311 * 3,
    'measured gameplay Decisions latency (157 ms mean / 311 ms max) must sit well inside staleness');
  assert.ok(config.actionDurationMs <= config.maxActionDurationMs);
});

test('predicate criteria are folded into instructions before the provider call', async t => {
  // The live planner returned HTTP 400 because true_description/false_description
  // are portable-contract fields, not provider wire fields.
  const wire = toDecisionsWire([
    { type: 'choice', name: 'intent', instructions: 'pick', choices: [{ value: 'a' }, { value: 'b' }] },
    { type: 'predicate', name: 'second_run', instructions: 'More than one run?', true_description: 'several', false_description: 'one' },
  ]);
  assert.equal(Object.hasOwn(wire[1], 'true_description'), false);
  assert.equal(Object.hasOwn(wire[1], 'false_description'), false);
  assert.equal(wire[1].instructions, 'More than one run?\ntrue: several\nfalse: one');
  assert.deepEqual(wire[0], { type: 'choice', name: 'intent', instructions: 'pick', choices: [{ value: 'a' }, { value: 'b' }] });

  // End to end through the real HTTP boundary with the planner's own question set.
  const f = await server(t, { respond: (url, body) => {
    const predicate = body.questions.find(question => question.type === 'predicate');
    assert.ok(predicate, 'the planner still asks a predicate question');
    assert.equal(Object.hasOwn(predicate, 'true_description'), false, 'no unsupported field reaches the provider');
    assert.match(predicate.instructions, /true: /);
    return answers([{ name: 'intent', type: 'choice', choice: 'start' }, { name: 'target', type: 'choice', choice: 'soccer' },
      { name: 'selection', type: 'choice', choice: 'auto' }, { name: 'second_run', type: 'predicate', probability: 0.1 }]);
  } });
  const planned = await createPlanner({ fetchImpl: f.fetchImpl })({
    transcript: 'Take over soccer and try to score. Keep playing until I tell you to stop.', context: {},
    state: { games: [{ gameId: 'soccer', name: 'Alder Five' }], sessions: [], runs: [], displayed: null } });
  assert.deepEqual(planned.toolCalls.map(call => call.name), ['open_session', 'start_simulated_user']);
  assert.equal(planned.toolCalls[1].args.goal, 'Take over soccer and try to score. Keep playing until I tell you to stop.');
});

test('the realtime transcription path is wired to the counted providers', async () => {
  // The live run transcribed real speech but the ledger stayed at 0 because the
  // WebSocket upgrade handler used the uncounted provider table.
  const source = await readFile(new URL('../scripts/serve.mjs', import.meta.url), 'utf8');
  assert.match(source, /attachVoiceStream\(server, \{ providers: countedLiveProviders \}\)/);
  assert.equal(/attachVoiceStream\(server\)/.test(source), false, 'the uncounted call must not remain');
  assert.match(source, /const handleVoice = createVoiceApi\(\{ liveProviders: countedLiveProviders \}\)/);
});

test('the retained receipt comes from the agent attach response, not a GET route', async t => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const dispatch = source.slice(source.indexOf('async function dispatchVoiceCommand'), source.indexOf('function setProfile'));
  assert.match(dispatch, /attached\.ok \? await attached\.json\(\) : null/);
  assert.equal(/fetch\(`\/api\/voice\/requests\/\$\{requestId\}`\)/.test(dispatch), false,
    'there is no GET read route on the voice API; the attach response is the receipt');
  // A planner failure must still push a correlated command record.
  const push = dispatch.slice(dispatch.indexOf('voiceCommands.push'));
  assert.match(push, /outcome: record\.outcome/);
  assert.match(push, /attachError/);

  // The attach route really does return the stored receipt for a failed planner.
  const { createVoiceApi } = await import('../scripts/voice-api.mjs');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const { randomUUID } = await import('node:crypto');
  const path = await mkdtemp(`${tmpdir()}/gameverse-receipt-`);
  const handler = createVoiceApi({ directory: pathToFileURL(`${path}/`), env: { OPENAI_API_KEY: 'k' }, report: () => {} });
  const node = http.createServer(async (req, res) => { if (!await handler(req, res, new URL(req.url, 'http://localhost').pathname)) res.writeHead(404).end('Not found'); });
  await new Promise(resolve => node.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${node.address().port}`;
  t.after(async () => { await new Promise(resolve => node.close(resolve)); await rm(path, { recursive: true, force: true }); });
  const id = randomUUID();
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await post('/api/voice/requests', { requestId: id, text: 'Take over soccer and try to score. Keep playing until I tell you to stop.',
    context: { role: 'base', gameId: 'neighborhood' }, transcriptionMs: 310, transcriptionMode: 'realtime' });
  assert.equal((await fetch(`${base}/api/voice/requests/${id}`)).status, 404, 'no GET read route exists');
  const attached = await post(`/api/voice/requests/${id}/agent`, { agent: 'voice-agent-v1', outcome: 'planner-failed',
    acknowledgment: 'The voice agent could not interpret that request: Decisions provider returned HTTP 400.', toolCalls: [], runs: [] });
  assert.equal(attached.status, 200);
  const receipt = await attached.json();
  assert.equal(receipt.requestId, id);
  assert.equal(receipt.processing, 'agent');
  assert.equal(receipt.transcription.mode, 'realtime');
  assert.match(receipt.text, /Keep playing until I tell you to stop/);
  assert.equal(receipt.agent.outcome, 'planner-failed');
});

test('the runner waits for genuinely outstanding policy work before the visible Stop', async () => {
  const source = await readFile(new URL('../scripts/qualify-takeover.mjs', import.meta.url), 'utf8');
  // The stop proof must not depend on timing luck: wait for a real pending
  // decision/reflection, then bounded-wait for the actual discard.
  assert.match(source, /a naturally outstanding decision or reflection on the second run/);
  assert.match(source, /the late policy answer to be discarded after release/);
  assert.match(source, /state\?\.lateResultsRejected > 0/);
  // The bundle must record which stop carried the outstanding work.
  assert.match(source, /stopKind: report\.stopState\?\.chosen/);
  assert.match(source, /neither-had-outstanding-work/);
  // No artificial delay or fabricated result anywhere in the stop stage.
  assert.equal(/lateResultsRejected = 1|fakeLate|injectLate/.test(source), false);
});

test('the app registers real host targets, and the planner never invents one', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  // An opener alone does not make a target supported: AgentHost.openSession
  // requires a catalog entry, which is why the live run failed with
  // "Game 'soccer' is not a supported target".
  assert.match(source, /function registerTakeoverTargets\(\)/);
  assert.match(source, /takeover\.host\.registerGame\(\{ gameId: game\.id, version: game\.version/);
  assert.match(source, /gameId: 'overworld'/);
  const render = source.slice(source.indexOf('async function renderGames()'), source.indexOf('function identityFor'));
  assert.match(render, /registerTakeoverTargets\(\);/, 'targets are registered as the catalog renders');

  // The planner refuses to name a target when the host catalog is empty.
  let called = false;
  const plan = createPlanner({ fetchImpl: async () => { called = true; return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); } });
  const planned = await plan({ transcript: 'take over soccer', context: {}, state: { games: [], sessions: [], runs: [], displayed: null } });
  assert.deepEqual(planned.toolCalls, []);
  assert.match(planned.say, /No takeover target is registered/);
  assert.equal(called, false, 'no provider call is made when nothing is registered');
});

test('a charged action uses its own short lifetime and the engine fires the shot', async () => {
  const { shell, handles, clock } = shellFixture({
    plan: async () => ({ model: 'gpt-6-luna', toolCalls: [
      { name: 'open_session', args: { gameId: 'soccer', selection: 'new' } },
      { name: 'start_simulated_user', args: { goal: 'try a shot', fromPreviousSession: true } }] }),
    decisions: async () => ({ action: { type: 'shot', direction: 'right' } }),
    harnessConfig: { decisionIntervalMs: 2500, actionDurationMs: 2000, chargedActionDurationMs: 700,
      maxActionDurationMs: 2400, staleAfterMs: 2000, reflectionIntervalMs: 1e9 },
  });
  const record = await shell.handleTranscript({ requestId: 'req-charged', text: 'take a shot' });
  const harness = shell.host.runs.get(record.runs[0].runId).harness;
  const handle = handles[0], state = handle.state();
  state.ball.owner = state.active; state.charging = null; state.charge = 0;
  const before = state.stats.shots[0];
  for (let step = 0; step < 30; step++) { shell.tick(clock.ms); await flush(); handle.advance(1000 / 60 * 2); }
  // The hold must expire on the charged lifetime, not the movement lifetime.
  const adopted = harness.report().chargeEvents.find(entry => entry.event === 'action-expired');
  assert.ok(harness.report().actionLog.some(entry => entry.action === 'release'), 'the charge was released');
  assert.ok(state.stats.shots[0] > before, `the engine recorded the shot attempt (${before} -> ${state.stats.shots[0]})`);
  if (adopted) assert.ok(adopted.ageMs <= 900, `the charged action expired after ${adopted.ageMs} ms, not the 2000 ms movement duration`);
  assert.equal(harness.report().config.chargedActionDurationMs, 700);
});

test('the decisions request states possession facts and the real control descriptions', async t => {
  const f = await server(t, { respond: (url, body) => {
    assert.match(body.input, /YOUR SELECTED PLAYER HAS THE BALL/);
    assert.match(body.input, /released automatically inside its own short hold window/);
    const action = body.questions.find(question => question.name === 'action');
    const shot = action.choices.find(choice => choice.value === 'shot');
    assert.match(shot.description, /counts as a shot attempt/);
    return answers([{ name: 'move', type: 'choice', choice: 'right' }, { name: 'action', type: 'choice', choice: 'shot' }]);
  } });
  const { SportsControlSurface } = await import('../src/sports-control-surface.js');
  const clock = { ms: 0 };
  const surface = new SportsControlSurface({ match: liveMatch(clock), team: 0, now: () => clock.ms });
  const state = surface.state(); state.ball.owner = state.active;
  const decision = await createDecisionsPolicy({ fetchImpl: f.fetchImpl })({
    observation: surface.observe(), goal: 'try a shot as soon as you control the ball',
    intent: 'Your selected player has the ball: take a shot at goal now', memory: { recentActions: [], reflections: [] },
    capabilities: surface.capabilities, seq: 1 });
  assert.equal(decision.action.type, 'shot');
  assert.equal(decision.action.direction, 'right');
});

test('the audio export hands every real utterance to the runner before the browser closes', async () => {
  const audio = new Uint8Array(180_000).fill(7);
  const capture = createRequesterCapture({
    speech: async () => ({ audio, mime: 'audio/wav' }),
    createAudioContext: () => ({ decodeAudioData: async () => ({ duration: 3.8 }),
      createMediaStreamDestination: () => ({ stream: { getTracks: () => [{ kind: 'audio', stop() {} }] } }),
      createBufferSource: () => ({ connect() {}, start() {}, set buffer(value) { this._buffer = value; } }), currentTime: 0 }),
  });
  await capture.say({ text: 'first command', runId: 'run_a' });
  await capture.getUserMedia({ audio: true });
  await capture.say({ text: 'stop command', runId: 'run_b' });
  // The metadata view strips bytes (model context must not carry audio) while the
  // export keeps the real buffers for the external runner.
  const { installQualification } = await import('../src/qualification.js');
  const metadata = capture.evidence().map(entry => ({ ...entry, audioBase64: undefined }));
  assert.equal(metadata.every(entry => entry.audioBase64 === undefined), true);
  const exported = capture.evidence();
  assert.equal(exported.length, 2);
  for (const entry of exported) {
    assert.ok(entry.audioBase64 && entry.audioBase64.length > 1000, 'raw audio is exportable');
    assert.equal(entry.truncated, false);
    assert.equal(Buffer.from(entry.audioBase64, 'base64').byteLength, 180_000);
    assert.ok(entry.runId && entry.at > 0, 'each utterance keeps its run id and timestamp');
  }
  assert.equal(typeof installQualification, 'function');

  // The runner must export audio, assert it is non-empty, and refuse to call a
  // frames-only folder a complete recording.
  const runner = await readFile(new URL('../scripts/qualify-takeover.mjs', import.meta.url), 'utf8');
  assert.match(runner, /exportAudio\(\)/);
  assert.match(runner, /audioFiles\.length/);
  assert.match(runner, /complete: /);
});
