#!/usr/bin/env node
// Separate evidence verifier. It never plays, never calls a provider and never
// trusts an actor's claim: it only reads retained evidence and reports what that
// evidence does and does not establish. Protocol success, goal outcome and
// gameplay quality are reported separately and are never merged into one pass.
import { readFile } from 'node:fs/promises';

export const VERIFIER_VERSION = 'takeover-evidence-verifier-v1';

const fail = (checks, id, detail) => checks.push({ id, status: 'fail', detail });
const pass = (checks, id, detail) => checks.push({ id, status: 'pass', detail });
const unknown = (checks, id, detail) => checks.push({ id, status: 'unknown', detail });
const num = value => (Number.isFinite(value) ? value : null);

function verifiedHumanSamples(resumed) {
 return (resumed.inputSamples || []).filter(s => s.source === 'human' && s.keys?.includes(resumed.code) && Number.isInteger(s.before?.playerIndex) && s.before.playerIndex === s.after?.playerIndex && Number.isFinite(s.before.x) && Number.isFinite(s.after.x) && Number.isFinite(s.before.z ?? s.before.y) && Number.isFinite(s.after.z ?? s.after.y) && ((s.after.x-s.before.x)*(s.move?.x||0)+((s.after.z??s.after.y)-(s.before.z??s.before.y))*(s.move?.y||0)) > 0.0005).length;
}

// `evidence` is the retained bundle: source identity, the voice receipt, the
// agent record, host run reports and engine clock samples.
export function verifyEvidence(evidence) {
  const checks = [];
  const bundle = evidence && typeof evidence === 'object' ? evidence : {};

  // 1. Identity. Without source/config/adapter/harness identity nothing below
  //    can be attributed to a build, so this is a hard failure, not a warning.
  const identity = bundle.identity || {};
  const requiredIdentity = ['sourceCommit', 'gameId', 'gameVersion', 'adapter', 'harness', 'agent'];
  const missingIdentity = requiredIdentity.filter(field => typeof identity[field] !== 'string' || !identity[field]);
  missingIdentity.length ? fail(checks, 'identity', `missing: ${missingIdentity.join(', ')}`) : pass(checks, 'identity', identity.sourceCommit);

  // 2. Speech actually entered the capture/transcription path.
  const receipt = bundle.receipt || {};
  const capture = bundle.capture || {};
  if (receipt.processing !== 'agent') fail(checks, 'voice-receipt', `processing is '${receipt.processing ?? 'absent'}', expected 'agent'`);
  else if (typeof receipt.text !== 'string' || !receipt.text.trim()) fail(checks, 'voice-receipt', 'no retained transcript text');
  else pass(checks, 'voice-receipt', `${receipt.requestId}: ${receipt.transcription?.mode || 'unknown'} transcription`);
  const audioBytes = num(capture.audioBytes);
  if (capture.source === 'microphone') pass(checks, 'speech-audio', 'human microphone capture');
  else if (capture.source === 'requester-capture' && audioBytes > 0 && capture.transcriptFromAudio === true) pass(checks, 'speech-audio', `${audioBytes} bytes decoded into the capture path`);
  else if (capture.transcriptFromAudio === false || capture.source === 'transcript-injection') fail(checks, 'speech-audio', 'the transcript was injected, so speech recognition is unproven');
  else unknown(checks, 'speech-audio', 'no capture evidence retained');

  // 3. The agent, not the test, selected and called the tools.
  const agent = bundle.agent || {};
  const calls = Array.isArray(agent.toolCalls) ? agent.toolCalls : [];
  const correlated = calls.filter(call => typeof call.callId === 'string' && call.callId.startsWith(`${receipt.requestId}:`));
  if (!calls.length) fail(checks, 'agent-tool-calls', 'no tool calls retained');
  else if (correlated.length !== calls.length) fail(checks, 'agent-tool-calls', `${calls.length - correlated.length} tool calls are not correlated to the voice request`);
  else if (!agent.planner?.model) fail(checks, 'agent-tool-calls', 'no planner model recorded, so tool selection is unattributed');
  else if (calls.some(call => call.name === 'start_simulated_user' && call.ok) && !calls.some(call => call.name === 'open_session' && call.ok)) {
    fail(checks, 'agent-tool-calls', 'a run started without a resolved session scope');
  } else pass(checks, 'agent-tool-calls', `${calls.length} correlated calls via ${agent.planner.model}`);
  const commands = Array.isArray(bundle.commands) ? bundle.commands : [];
  if (!commands.length) unknown(checks, 'command-correlation', 'no per-command records retained');
  else {
    const broken = commands.filter(command => !command.requestId
      || (command.toolCalls || []).some(call => !String(call.callId || '').startsWith(`${command.requestId}:`)));
    broken.length ? fail(checks, 'command-correlation', `${broken.length} of ${commands.length} spoken commands are not correlated to their own tool calls`)
      : pass(checks, 'command-correlation', `${commands.length} spoken command(s) correlated to their tool calls and runs`);
  }
  if (bundle.shortcuts?.directGameplayToolCall) fail(checks, 'no-test-shortcut', 'a test invoked the gameplay tool directly');
  else pass(checks, 'no-test-shortcut', 'gameplay runs were started through the voice agent');

  // 4. Runs: ownership, clocks that advanced during policy waits, and actions.
  const runs = Array.isArray(bundle.runs) ? bundle.runs : [];
  if (!runs.length) fail(checks, 'runs', 'no run evidence retained');
  for (const run of runs) {
    const label = run.runId || 'unknown-run';
    if (!run.sessionId || !run.harness) { fail(checks, `run:${label}:binding`, 'run is not bound to a session and harness version'); continue; }
    const clocks = Array.isArray(run.clockSamples) ? run.clockSamples : [];
    const duringWait = clocks.filter(sample => sample.decisionOutstanding === true);
    // Engines expose different clocks (match frames, rendered frames, simulation
    // milliseconds, match seconds). Any one of them advancing is proof that game
    // time ran during a policy wait; no universal frame rate is assumed.
    const fields = ['frame', 'simulationMs', 'matchClockSeconds'];
    const advancing = duringWait.length >= 2 ? fields.find(field => {
      const values = duringWait.map(sample => sample[field]).filter(value => Number.isFinite(value));
      return values.length >= 2 && values.at(-1) > values[0];
    }) : null;
    if (!clocks.length) unknown(checks, `run:${label}:clock`, 'no clock samples retained');
    else if (!duringWait.length) fail(checks, `run:${label}:clock`, 'no clock sample was taken while a decision was outstanding');
    else if (duringWait.every(sample => fields.every(field => !Number.isFinite(sample[field])))) {
      unknown(checks, `run:${label}:clock`, 'the surface exposed no numeric engine clock to compare');
    } else if (!advancing) fail(checks, `run:${label}:clock`, 'no engine clock advanced while a decision was outstanding');
    else {
      const values = duringWait.map(sample => sample[advancing]).filter(Number.isFinite);
      pass(checks, `run:${label}:clock`, `${advancing} advanced by ${values.at(-1) - values[0]} during policy waits`);
    }
    const actions = num(run.usage?.actions) ?? 0;
    const dispatched = Array.isArray(run.actionLog) ? run.actionLog.filter(entry => entry.accepted === true).length : null;
    const window = run.actionLogWindow || null;
    if (!actions) fail(checks, `run:${label}:actions`, 'no action was dispatched');
    else if (dispatched === null) unknown(checks, `run:${label}:actions`, `${actions} actions claimed with no dispatch log`);
    else if (window?.complete === true && dispatched !== actions) {
      fail(checks, `run:${label}:actions`, `a complete log was claimed but shows ${dispatched} of ${actions} actions`);
    } else if (dispatched > actions) fail(checks, `run:${label}:actions`, `the log shows ${dispatched} dispatches but usage counts only ${actions}`);
    else if (window && window.complete === false && dispatched < actions) {
      pass(checks, `run:${label}:actions`, `${actions} actions dispatched; log window retained ${dispatched} (bounded)`);
    } else pass(checks, `run:${label}:actions`, `${actions} actions dispatched, ${dispatched} logged`);
    if (run.progressWriterConflict) fail(checks, `run:${label}:ownership`, 'two writers touched one progress record');
  }

  // 5. Stop released the right run, cleared held input and rejected late work.
  const stop = bundle.stop || {};
  if (!stop.runId) unknown(checks, 'stop', 'no stop evidence retained');
  else if (!runs.some(run => run.runId === stop.runId)) fail(checks, 'stop', 'the stop evidence names a run that has no run evidence');
  else if (stop.heldInput !== 'cleared') fail(checks, 'stop', `held input was '${stop.heldInput}'`);
  else if (stop.heldInputClearedAt !== undefined && stop.stoppedAt !== undefined
    && !(num(stop.heldInputClearedAt) >= num(stop.stoppedAt))) fail(checks, 'stop', 'the only safe-idle evidence predates the stop');
  else if (stop.chargedActionFired) fail(checks, 'stop', 'stop fired a charged action');
  else if (stop.lateResultsAccepted) fail(checks, 'stop', 'a late policy result mutated a released session');
  else if (stop.otherRunsAffected) fail(checks, 'stop', 'stopping one run affected another');
  else pass(checks, 'stop', `${stop.runId} released; held input cleared after the stop`);
  // Late-answer rejection needs positive evidence: either outstanding policy work
  // at stop time that was then discarded, or an explicit 'nothing outstanding'.
  if (stop.outstandingAtStop === true) {
    num(stop.lateResultsRejected) > 0
      ? pass(checks, 'stop-late-results', `${stop.lateResultsRejected} late result(s) discarded after release`)
      : fail(checks, 'stop-late-results', 'policy work was outstanding at stop but no late result was recorded as discarded');
  } else if (stop.outstandingAtStop === false) {
    unknown(checks, 'stop-late-results', 'no policy work was outstanding at stop, so rejection was not exercised');
  } else unknown(checks, 'stop-late-results', 'no outstanding-work observation was retained at stop');
  // Human control after the neutral handback must be an observed input/result.
  const resumed = stop.humanControl || null;
  if (!resumed) unknown(checks, 'human-resumed', 'no human control observation after the stop');
  else if (resumed.inputDispatched && resumed.engineResponded && verifiedHumanSamples(resumed) >= 2) pass(checks, 'human-resumed', `${resumed.detail || 'human input moved the game after handback'}`);
  else if (resumed.inputDispatched && !resumed.engineResponded) fail(checks, 'human-resumed', 'human input produced no engine response');
  else if (resumed.inputDispatched) unknown(checks, 'human-resumed', 'fewer than two same-player, human-origin input/movement samples were retained');
  else unknown(checks, 'human-resumed', 'no human input was attempted after the stop');

  // 6. Background lifetime and reopen identity.
  const lifecycle = bundle.lifecycle || {};
  if (lifecycle.leftSubgame === true && lifecycle.reopenedSessionId && lifecycle.sessionId) {
    if (lifecycle.reopenedSessionId !== lifecycle.sessionId) fail(checks, 'reopen', 'reopening produced a different session');
    else if (!(num(lifecycle.frameAtReopen) > num(lifecycle.frameAtLeave))) fail(checks, 'reopen', 'the match did not progress while the human was away');
    else pass(checks, 'reopen', `same session, +${lifecycle.frameAtReopen - lifecycle.frameAtLeave} frames in the background`);
  } else unknown(checks, 'reopen', 'no leave/reopen evidence retained');
  if (lifecycle.spectatorCameraMovedIndependently === true && Number.isFinite(lifecycle.agentTrajectoryDelta)) {
    num(lifecycle.agentTrajectoryDelta) <= 0.05
      ? pass(checks, 'spectator-camera', `trajectory delta ${lifecycle.agentTrajectoryDelta}`)
      : fail(checks, 'spectator-camera', `spectator input moved the agent character by ${lifecycle.agentTrajectoryDelta}`);
  } else unknown(checks, 'spectator-camera', 'no overworld spectator evidence retained');

  // 7. Required journey stages. A missing or failed stage is a failure, and an
  //    actor's description of a stage never substitutes for its evidence.
  const journey = bundle.journey || {};
  const requiredStages = ['requesterSpeech', 'agentTookOver', 'leftSubgame', 'reopenedSession', 'concurrentRun', 'spokenStop', 'visibleStop'];
  for (const stage of requiredStages) {
    const entry = journey[stage];
    if (entry === undefined || entry === null) unknown(checks, `journey:${stage}`, 'stage evidence was not retained');
    else if (entry === false || entry?.ok === false) fail(checks, `journey:${stage}`, entry?.reason || 'the stage did not complete');
    else pass(checks, `journey:${stage}`, typeof entry === 'object' ? JSON.stringify(entry).slice(0, 120) : String(entry));
  }
  // A released run alone is not evidence of a spoken Stop. Require the actual
  // realtime receipt and a successful stop tool whose new release follows it.
  const spoken = journey.spokenStop;
  if (spoken?.ok === true) {
    const command = commands.find(c => c.requestId === spoken.requestId && c.receipt?.requestId === c.requestId && c.receipt?.processing === 'agent' && c.receipt?.transcription?.mode === 'realtime');
    const call = command?.toolCalls?.find(c => c.name === 'stop_run' && c.ok && c.targetRunId === spoken.target && c.resultOutcome === 'stopped' && String(c.callId).startsWith(command.requestId + ':') && Number.isFinite(c.startedAt) && Number.isFinite(c.releasedAt) && c.releasedAt >= c.startedAt);
    call ? pass(checks, 'spoken-stop-correlation', command.requestId + ': new correlated stop release')
      : fail(checks, 'spoken-stop-correlation', 'no realtime spoken command with a new target stop receipt');
  } else unknown(checks, 'spoken-stop-correlation', 'spoken Stop did not complete');
  // The requester must be a distinct role with its own capture evidence, never
  // the same actor that played the game.
  const requester = bundle.requester || {};
  if (!requester.runIds?.length) unknown(checks, 'requester-role', 'no requester run evidence retained');
  else if (runs.some(run => requester.runIds.includes(run.runId))) fail(checks, 'requester-role', 'a gameplay run and the requester share one run identity');
  else if (!(num(capture.audioBytes) > 0)) fail(checks, 'requester-role', 'the requester produced no audio');
  else pass(checks, 'requester-role', `${requester.runIds.length} requester run(s), ${capture.audioBytes} audio bytes`);
  // Engine-observed shot attempts, from the match's own counter.
  const shotDelta = num(bundle.quality?.shotCounter?.last) !== null && num(bundle.quality?.shotCounter?.first) !== null
    ? bundle.quality.shotCounter.last - bundle.quality.shotCounter.first : null;
  if (shotDelta === null) unknown(checks, 'engine-shot-attempt', 'no engine shot counter samples retained');
  else if (shotDelta <= 0) fail(checks, 'engine-shot-attempt', 'the engine recorded no shot attempt during the run');
  else pass(checks, 'engine-shot-attempt', `engine shot counter advanced by ${shotDelta}`);

  const reflections = runs.flatMap(run => run.reflections || []);
  const reflectionCount = num(bundle.providerLedger?.ledger?.reflect);
  if (reflectionCount === null && !reflections.length) unknown(checks, 'reflections', 'no reflection evidence retained');
  else if ((reflectionCount ?? 0) < 1) fail(checks, 'reflections', 'no LLM reflection ran during the journey');
  else pass(checks, 'reflections', `${reflectionCount} reflection call(s), ${reflections.length} note(s) retained`);

  // Rendered proof is a separate artifact; its absence is never a pass.
  bundle.recording?.complete === false ? fail(checks, 'recording', 'rendered recording or original audio is incomplete') : bundle.recording?.path ? pass(checks, 'recording', bundle.recording.path) : unknown(checks, 'recording', 'no rendered recording retained');

  const failed = checks.filter(check => check.status === 'fail');
  const unknowns = checks.filter(check => check.status === 'unknown');
  const protocolIds = ['identity', 'voice-receipt', 'speech-audio', 'agent-tool-calls', 'no-test-shortcut', 'requester-role', 'command-correlation', 'spoken-stop-correlation',
    ...requiredStages.map(stage => `journey:${stage}`)];
  const protocol = failed.some(check => protocolIds.includes(check.id)) ? 'failed'
    : unknowns.some(check => protocolIds.includes(check.id)) ? 'unproven' : 'passed';

  // Goal outcome comes from retained engine state, not from an actor's claim.
  const goal = bundle.goal || {};
  const noEngineGoalEvidence = goal.engineObserved === undefined || goal.engineObserved === null;
  const goalOutcome = goal.claimedByActor && noEngineGoalEvidence ? 'claim-only-rejected'
    : noEngineGoalEvidence ? 'unproven'
      : goal.engineObserved ? 'reached' : 'not-reached';

  // Quality is never inferred from protocol success.
  const quality = bundle.quality && Number.isFinite(bundle.quality.shots) ? {
    assessed: true, shots: bundle.quality.shots, possessionSeconds: num(bundle.quality.possessionSeconds),
    attemptsTowardGoal: num(bundle.quality.attemptsTowardGoal),
    verdict: bundle.quality.shots > 0 ? 'attempted-scoring' : 'no-scoring-attempt',
    note: 'Quality is descriptive. It is not a qualification verdict and does not upgrade protocol or goal status.',
  } : { assessed: false, verdict: 'unassessed', note: 'No gameplay quality evidence retained.' };

  const infrastructure = bundle.infrastructure?.failures?.length ? 'failed' : bundle.infrastructure ? 'ok' : 'unknown';
  return {
    verifier: VERIFIER_VERSION,
    verdict: protocol === 'passed' && goalOutcome !== 'claim-only-rejected' && !failed.length ? 'evidence-consistent' : 'evidence-insufficient',
    protocol, goalOutcome, quality, infrastructure,
    failures: failed, unknowns: unknowns.map(check => check.id), checks,
    note: 'A consistent-evidence verdict covers retained protocol evidence only. Rendered real-provider qualification requires the recording and provider receipts named in the plan.',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) { console.error('Usage: node scripts/verify-takeover-evidence.mjs EVIDENCE.json'); process.exit(2); }
  const report = verifyEvidence(JSON.parse(await readFile(path, 'utf8')));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === 'evidence-consistent' ? 0 : 1);
}
