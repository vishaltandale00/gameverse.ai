import { renderPlayerPanel, playerLabel } from './takeover-panel.js';
import * as storage from './storage.js';
import { digest, progressKey, validateCheckpoint, validateCartridge, KEY_BITS, padMask } from './identity.js';
import { GbaAdapter } from './adapter.js';
import { loadApplicationConfig, configuredGames, validateGameBinding } from './application.js';
import { sampleStandardGamepad } from './gamepad.js';
import { HARNESS_VERSION } from './simulated-user.js';
import { VoiceInput } from './voice-input.js';
import { createProfileNameEntry } from './profile-name.js';
import { createTakeoverShell } from './agent-shell.js';
import { createPlanner, createDecisionsPolicy, createReflector, createSpeechAdapter } from './agent-client.js';
import { installQualification, buildEvidenceBundle, QUALIFICATION_HARNESS_CONFIG } from './qualification.js';

const $ = selector => document.querySelector(selector);
const avatars = ['🦊', '🐸', '🤖', '👾'];
let avatar = avatars[0], profile, profiles = [], games = [], runtime, session, application, busy = false;
let keyboard = new Set(), inputMask = -1, padArmed = false, padPrevious = [], lastPadAction = 0;
let neighborhoodOpen = false, neighborhoodPose, neighborhood, neighborhoodLaunch = 0, neighborhoodEntryPending = false;
let worldProfilePending = false, shellPadDevice = null, shellPadIndex = null;
let voiceClock, voiceNoticeTimer, voiceOwnsSportsB = false;
// Execution sessions a simulated user still owns while the human looks elsewhere.
const backgroundSessions = new Map();
// Explicit qualification flag. Ordinary play never swaps the microphone.
const qualifying = new URLSearchParams(location.search).get('qualify') === '1';
let lastVoiceRecord = null, lastVoiceReceipt = null, qualification = null;
// One entry per spoken command: transcript, receipt, agent record, tool calls
// and the runs it started. Bounded, and never overwritten by a later command.
const voiceCommands = [];
const lifecycleEvidence = { events: [] };
const stopSnapshots = new Map();
const takeover = createTakeoverShell({
  plan: createPlanner(), decisions: createDecisionsPolicy(), reflector: createReflector(), speech: createSpeechAdapter(),
  // Qualification declares its own versioned cadence so one bounded run fits the
  // global provider caps; ordinary play keeps the harness defaults.
  harnessConfig: qualifying ? QUALIFICATION_HARNESS_CONFIG : {},
  describeDisplayed: () => ({ sessionId: session?.agentSessionId || null, view: session ? 'subgame' : neighborhoodOpen ? 'overworld' : 'home' }),
  render: view => renderAgentPanel(view),
  log: entry => { if (entry.event) console.debug('[takeover]', entry.event, entry.runId || entry.sessionId || ''); },
  openOverworld: async ({ register }) => {
    if (!neighborhood) await exploreNeighborhood();
    if (!neighborhood?.controller) throw Error('The overworld could not be opened for a simulated user.');
    if (neighborhood.agentSessionId) return takeover.host.describeSession(neighborhood.agentSessionId);
    const registered = register({ controller: neighborhood.controller, world: neighborhood.world,
      identity: { profileId: profile?.id || 'local' }, progressKey: `overworld:${profile?.id || 'local'}`, displayed: neighborhoodOpen,
      simulation: () => neighborhood?.observe() || null, hold: value => neighborhood?.holdExecution?.(value) });
    neighborhood.agentSessionId = registered.sessionId;
    return registered;
  },
  openSubgame: async ({ gameId, identity, selection, register }) => {
    const game = games.find(entry => entry.id === gameId && entry.kind === 'custom-sports');
    if (!game) throw Error(`'${gameId}' is not a supported takeover target in this build.`);
    if (selection === 'new' && (session?.game.id === gameId || backgroundSessions.has(gameId))) throw Error(`A ${gameId} session is already open. Reuse it or close it before creating a new one.`);
    if (session?.game.id === gameId && session.agentSessionId) return takeover.host.describeSession(session.agentSessionId);
    const existing = backgroundSessions.get(gameId);
    if (existing) return takeover.host.describeSession(existing.agentSessionId);
    // Use the ordinary UI lifecycle: from the overworld that is venue entry
    // (which suspends and hides the world first), otherwise the collection path.
    if (neighborhoodOpen) await enterGameFromNeighborhood(gameId);
    else await startGame(game, 'snapshot', 'collection');
    if (!session || session.game.id !== gameId || !session.agentSessionId) {
      throw Error(`The ${gameId} match could not be opened for a simulated user`
        + `${profile ? '' : ': no player profile is selected yet, so the app asked for one first'}.`);
    }
    return takeover.host.describeSession(session.agentSessionId);
  },
});
window.__gameverseTakeover = takeover;
let watchPending = false, qualificationNavigationRun = null;
// Keep transient notices above the controls on narrow screens, including when
// Details changes the panel height. This only runs when its layout changes.
new ResizeObserver(() => {
  const panel = $('#agent-panel');
  document.documentElement.style.setProperty('--agent-panel-height', `${panel.getBoundingClientRect().height}px`);
}).observe($('#agent-panel'));
// Native modal dialogs make outside controls inert. Keep the single player
// panel inside the most recently opened dialog so Stop remains actionable.
const modalOrder = [];
new MutationObserver(records => {
  for (const { target } of records) {
    if (target.tagName !== 'DIALOG') continue;
    const index = modalOrder.indexOf(target);
    if (index !== -1) modalOrder.splice(index, 1);
    if (target.open) modalOrder.push(target);
  }
  const parent = modalOrder.at(-1) || document.body;
  if ($('#agent-panel').parentElement !== parent) parent.append($('#agent-panel'));
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
function displayedTakeoverSession() { return session?.agentSessionId || (neighborhoodOpen ? neighborhood?.agentSessionId : null) || null; }
function renderAgentPanel(view = takeover.observe()) {
  const panel = $('#agent-panel'); if (!panel) return;
  renderPlayerPanel({ panel, view, displayedSessionId: displayedTakeoverSession(), watchingPending: watchPending,
    onWatch: watchTakeoverRun, onError: handleError,
    onStop: run => { takeover.stop(run.runId); handbackAfterStop(run); },
    diagnostics: () => takeover.statusText() });
}
async function watchTakeoverRun(run) {
  if (watchPending || busy) throw Error('Finish the current action before switching views.');
  const target = takeover.host.runStatus(run.runId);
  if (target.role !== 'gameplay' || target.state !== 'running') throw Error('This simulated player has stopped.');
  if (displayedTakeoverSession() === target.sessionId) return;
  if (qualifying && qualificationNavigationRun !== target.runId) $('#qualification-step').hidden = true;
  qualificationNavigationRun = null;
  const assertAvailable = () => {
    const id = target.gameId === 'overworld' ? neighborhood?.agentSessionId : backgroundSessions.get(target.gameId)?.agentSessionId;
    if (id !== target.sessionId) throw Error('The original play session is no longer available.');
  };
  assertAvailable(); watchPending = true; renderAgentPanel();
  try {
    if (session) {
      if (session.agentSessionId && !takeover.disposable(session.agentSessionId)) await leaveSession({ restoreOrigin: false });
      else { await saveAndReturn(); if (session) throw Error('Your current game could not be saved.'); }
    }
    assertAvailable();
    if (target.gameId === 'overworld') restoreSessionOrigin('neighborhood');
    else {
      const game = games.find(g => g.id === target.gameId);
      if (!game) throw Error('This game is unavailable.');
      await startGame(game, 'snapshot', 'neighborhood');
    }
    if (displayedTakeoverSession() !== target.sessionId) throw Error('The original play session could not be shown.');
    voiceNotice(`Watching ${playerLabel(target.gameId)}. The simulated player is still in control.`);
  } finally { watchPending = false; renderAgentPanel(); }
}
function playerAcknowledgment(record) {
  if (record.outcome !== 'completed') return 'That voice command could not be completed. Try again.';
  const starts = (record.runs || []).map(run => playerLabel(run.gameId));
  if (starts.length) return `Started a simulated player in ${starts.join(' and ')}.`;
  const stopped = (record.toolCalls || []).filter(call => call.name === 'stop_run' && call.ok).map(call => takeover.host.runStatus(call.args.runId));
  if (stopped.length) return `${stopped.map(run => playerLabel(run.gameId)).join(' and ')} stopped.${stopped.some(run => run.sessionId === displayedTakeoverSession()) ? ' The controls are yours.' : ''}`;
  return 'Voice command completed.';
}
// After an explicit Stop the human may take the controls again. Nothing is
// resumed automatically: a neutral transition comes first.
function handbackAfterStop(run) {
  if (session?.agentSessionId === run.sessionId && session.state === 'playing') { clearInput(); void session.adapter?.resume(); }
  voiceNotice(displayedTakeoverSession() === run.sessionId ? `${playerLabel(run.gameId)} stopped. The controls are yours.` : `${playerLabel(run.gameId)} stopped.`);
}
async function dispatchVoiceCommand(requestId, text) {
  const record = await takeover.handleTranscript({ requestId, text, context: voice.run?.context || null });
  voiceNotice(playerAcknowledgment(record));
  // Retain the agent outcome on the existing voice receipt (local, server-side).
  // The attach response IS the stored receipt; there is no GET read route, and a
  // planner failure must still retain its receipt and correlation.
  const toolCalls = (record.toolCalls || []).map(call => ({ callId: call.callId, name: call.name,
    ok: Boolean(call.ok), wallMs: call.wallMs, error: call.error?.message || null,
    ...(call.name === 'stop_run' ? { targetRunId: call.args?.runId, startedAt: call.startedAt,
      releasedAt: call.result?.releaseReceipt?.at ?? null, resultOutcome: call.result?.outcome || null } : {}) }));
  let attachError = null;
  try {
    const attached = await fetch(`/api/voice/requests/${requestId}/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: record.agent, outcome: record.outcome, acknowledgment: record.acknowledgment, wallMs: record.wallMs,
        planner: record.planner || null, runs: record.runs.map(run => run.runId), toolCalls }) });
    lastVoiceReceipt = attached.ok ? await attached.json() : null;
    if (!attached.ok) attachError = `the voice backend rejected the agent result (HTTP ${attached.status})`;
  } catch (error) { attachError = error.message; }
  try {
    voiceCommands.push({ requestId, transcript: text, at: Date.now(), outcome: record.outcome, attachError,
      acknowledgment: record.acknowledgment, planner: record.planner || null, receipt: lastVoiceReceipt,
      toolCalls,
      runs: (record.runs || []).map(run => ({ runId: run.runId, sessionId: run.sessionId, gameId: run.gameId, surface: run.surface })) });
    if (voiceCommands.length > 8) voiceCommands.shift();
  } catch { voiceNotice('The agent result could not be retained locally.'); }
  if (attachError) voiceNotice(`Voice receipt warning: ${attachError}`);
  return record;
}
const timings = [];
window.__gameverseTimings = timings;
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const voice = new VoiceInput({
  canStart: () => !busy && !neighborhoodEntryPending && !document.hidden && document.hasFocus()
    && !$('dialog[open]') && (session?.state === 'playing' || (neighborhoodOpen && neighborhood?.observe().state === 'playing') || (!session && !neighborhoodOpen && !!application)),
  captureContext: () => session ? {
    role: 'subgame', gameId: session.game.id, identity: { ...session.identity }, progressRevision: session.head.revision,
    environment: { id: application.id, version: application.version }, capturedAt: new Date().toISOString(),
  } : {
    role: 'base', gameId: application.id, version: application.version, profileId: profile?.id || null,
    configuration: application.base, pose: neighborhood?.observe() || null, capturedAt: new Date().toISOString(),
  },
  // Voice capture is independent of gameplay; only the mic owns R3/B while open.
  pause: async () => () => {},
  changed: view => {
    const dialog = $('#voice-dialog');
    const restoreFocus = () => {
      if ($('dialog[open]:not(#voice-dialog)')) return;
      const target = session ? $('#screen canvas') : neighborhoodOpen ? $('#neighborhood canvas') : document.body;
      if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
    };
    if (view.background) {
      if (dialog.open) { dialog.close(); restoreFocus(); }
      $('#voice-button').classList.toggle('voice-pending', ['transcribing', 'processing'].includes(view.state));
      if (view.state === 'received') {
        voiceNotice('Voice request received. Asking the agent…');
        void dispatchVoiceCommand(view.requestId, view.text).catch(error => voiceNotice(error.message));
      }
      if (view.state === 'error') voiceNotice(view.message);
      clearInterval(voiceClock); return;
    }
    $('#voice-button').classList.remove('voice-pending');
    clearInterval(voiceClock); dialog.dataset.state = view.state;
    $('#voice-time').hidden = view.state !== 'recording';
    if (view.state === 'recording') {
      const started = view.startedAt || Date.now();
      const updateClock = () => {
        const seconds = Math.floor((Date.now() - started) / 1000);
        $('#voice-time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      };
      updateClock(); voiceClock = setInterval(updateClock, 1000);
    }
    if (view.state === 'idle') {
      dialog.close(); restoreFocus();
      if (view.warning) notice(view.warning);
      else if (view.cancelled) voiceNotice('Voice input cancelled.');
      return;
    }
    if (!dialog.open) { notice(''); $('#voice-transcript').textContent = ''; dialog.show(); restoreFocus(); }
    const labels = { opening: 'Opening microphone…', recording: 'Listening…', transcribing: 'Transcribing…', processing: 'Sending your request…', received: 'Request received.', error: 'Voice input needs attention.', cancelling: 'Cancelling…' };
    $('#voice-title').textContent = labels[view.state];
    $('#voice-message').textContent = view.message || ({
      opening: 'Allow microphone access when your browser asks.',
      recording: `Speak your request. Words appear as you talk. Up to ${view.maxSeconds / 60} minutes.`,
      transcribing: 'Finishing your transcript…',
      processing: 'Saving your request…',
      received: 'Saved on this computer. The voice agent is handling it.',
      cancelling: 'Discarding this input…',
    }[view.state] || '');
    if (view.context) $('#voice-target').textContent = `${session?.game.name || application.title} / Voice feedback`;
    if (view.text !== undefined) $('#voice-transcript').textContent = view.text;
    $('#voice-transcript').hidden = !$('#voice-transcript').textContent;
    $('#voice-stop').hidden = view.state !== 'recording';
    $('#voice-stop').textContent = `Send request · ${voice.config.recordButton === 11 ? 'R3' : `Button ${voice.config.recordButton}`}`;
    $('#voice-cancel').disabled = view.state === 'cancelling';
    $('#voice-cancel').textContent = view.state === 'received' ? 'Cancel transcript · B' : 'Cancel · B';
    $('#voice-done').hidden = !['received', 'error'].includes(view.state);
    $('#voice-done').textContent = `Return to game · ${voice.config.recordButton === 11 ? 'R3' : `Button ${voice.config.recordButton}`}`;

  },
});
$('#agent-stop-all').onclick = () => takeover.stopAll('player stopped every run');
if (qualifying) {
  // The requester's circuits choose speech and UI actions; its synthesized audio
  // replaces only the capture device, so transcription and the agent are real.
  qualification = installQualification({
    takeover, voice, sourceCommit: document.documentElement.dataset.sourceCommit || null,
    identity: { profileId: 'qualification' },
    ui: {
      observe: () => ({ view: session ? 'subgame' : neighborhoodOpen ? 'overworld' : 'home', canRecord: !voice.active && voice.canStart(),
        recording: voice.state === 'recording', voiceState: voice.state, runs: takeover.observe().running.length }),
      pressRecord: () => voice.toggle(),
      send: () => voice.stop(),
    },
  });
  // Qualification control surface for the external runner. It drives the same
  // buttons and lifecycle a human would; it cannot inject a transcript or call a
  // gameplay tool, and every provider call still happens server-side.
  let qualificationStepTimer;
  const showQualificationStep = text => {
    const banner = $('#qualification-step'); banner.textContent = `Test navigation · ${text}`; banner.hidden = false;
    clearTimeout(qualificationStepTimer); qualificationStepTimer = setTimeout(() => { banner.hidden = true; }, 6500);
  };
  window.__gameverseQualification = {
    version: qualification.version, takeover, qualification,
    speakCommand: (command, config) => qualification.startRequester(command, config),
    status: () => ({ voice: voice.state, commands: voiceCommands.map(c => ({ requestId: c.requestId, receipt: c.receipt ? { requestId: c.receipt.requestId, processing: c.receipt.processing, transcription: c.receipt.transcription } : null, toolCalls: c.toolCalls })), runs: takeover.observe().running, ack: takeover.observe().acknowledgment,
      requester: qualification.surface.report(), view: session ? session.game.id : neighborhoodOpen ? 'overworld' : 'home',
      sportsFrame: window.__gameverseSports?.read?.().frame ?? null }),
    engineTruth: () => { const read = window.__gameverseSports?.read?.(); return read ? { frame: read.frame, phase: read.phase, score: read.score,
      clock: read.clock, stats: read.stats, charging: read.charging, charge: read.charge, ball: read.ball, possessionTeam: read.ball?.owner >= 0 ? read.players[read.ball.owner]?.team ?? null : null } : null; },
    leaveSubgame: async () => {
      showQualificationStep('Return to the overworld. The Soccer player keeps playing in the background.');
      await new Promise(resolve => setTimeout(resolve, 700));
      const read = window.__gameverseSports?.read?.();
      Object.assign(lifecycleEvidence, { sessionId: session?.agentSessionId || null, leftSubgame: true,
        frameAtLeave: read?.frame ?? null, matchClockAtLeave: read?.clock ?? null, leftAt: Date.now() });
      lifecycleEvidence.events.push({ event: 'leave', at: Date.now(), frame: lifecycleEvidence.frameAtLeave, sessionId: lifecycleEvidence.sessionId });
      await leaveSession({ message: 'Qualification: returning to the overworld.' });
      return lifecycleEvidence; },
    reopenSubgame: async gameId => {
      const target = takeover.observe().running.find(run => run.role === 'gameplay' && run.gameId === gameId);
      if (!target) throw Error('No running gameplay session to watch.');
      showQualificationStep(`Watch ${playerLabel(gameId)} to verify the same session. Other players continue in the background.`);
      await new Promise(resolve => setTimeout(resolve, 1100));
      const row = [...$('#agent-runs').children].find(item => item.dataset.runId === target.runId);
      const button = row?.querySelector('.agent-watch');
      if (!button) throw Error('The visible Watch control is unavailable.');
      qualificationNavigationRun = target.runId; button.click();
      const deadline = Date.now() + 10000;
      while ((watchPending || displayedTakeoverSession() !== target.sessionId) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
      if (displayedTakeoverSession() !== target.sessionId) throw Error('Watch did not reopen the original session.');
      const read = window.__gameverseSports?.read?.();
      Object.assign(lifecycleEvidence, { reopenedSessionId: session?.agentSessionId || null,
        frameAtReopen: read?.frame ?? null, matchClockAtReopen: read?.clock ?? null, reopenedAt: Date.now() });
      lifecycleEvidence.events.push({ event: 'reopen', at: Date.now(), frame: lifecycleEvidence.frameAtReopen, sessionId: lifecycleEvidence.reopenedSessionId });
      return lifecycleEvidence; },
    stopPreconditions: runId => { const runtime = takeover.host.runs.get(runId); const read = window.__gameverseSports?.read?.();
      const snapshot = { runId, at: Date.now(), pendingDecision: Boolean(runtime?.harness?.pending), reflecting: Boolean(runtime?.harness?.reflecting),
        heldAction: runtime?.harness?.current?.action?.type ?? null, charging: read?.charging ?? null, charge: read?.charge ?? null,
        frame: read?.frame ?? null, shots: read?.stats?.shots ?? null,
        staleBefore: runtime?.harness?.usage?.stale ?? null };
      stopSnapshots.set(runId, snapshot); return snapshot; },
    stopAftermath: runId => {
      const runtime = takeover.host.runs.get(runId); const read = window.__gameverseSports?.read?.();
      const report = runtime?.harness?.report?.() || null;
      const before = stopSnapshots.get(runId) || null;
      const status = takeover.host.runStatus(runId);
      // The HOST clears held input during release, so its release receipt is the
      // authority; harness safe-idle events are not produced by revocation.
      const receipt = status.releaseReceipt || null;
      const stoppedAt = receipt?.at ?? runtime?.endedAt ?? before?.at ?? null;
      const clearedEvent = receipt?.heldInput === 'cleared' ? { at: receipt.at } : null;
      const discardedAfter = (report?.evidence || []).filter(entry => entry.event === 'decision-discarded'
        && (stoppedAt === null || entry.at >= stoppedAt) && entry.reason === 'run-released');
      // Outstanding work is taken from the snapshot the host captured at the
      // ACTUAL release, not from an earlier pre-command snapshot.
      const outstandingAtStop = receipt?.harnessSnapshot
        ? Boolean(receipt.harnessSnapshot.pendingDecision || receipt.harnessSnapshot.reflecting)
        : before ? Boolean(before.pendingDecision || before.reflecting) : null;
      return { runId, stoppedAt, state: status.state, outcome: status.outcome,
        releaseReceipt: receipt, preconditions: before, harnessAtRelease: receipt?.harnessSnapshot || null,
        surfaceHeldAfterStop: receipt?.surfaceHeld ?? null,
        heldInput: clearedEvent ? 'cleared' : 'unknown', heldInputClearedAt: clearedEvent?.at ?? null,
        outstandingAtStop,
        lateResultsRejected: discardedAfter.length,
        staleTotal: report?.usage?.stale ?? null,
        chargedActionFired: before?.shots && read?.stats?.shots ? read.stats.shots[0] > before.shots[0] : false,
        chargingAfterStop: read?.charging ?? null, shotsAfterStop: read?.stats?.shots ?? null, frameAfterStop: read?.frame ?? null }; },
    // Real human control after the neutral handback: dispatch an actual key the
    // match's own input adapter listens for, then read the engine's response.
    humanControlProbe: async ({ code = 'KeyD', ms = 700 } = {}) => {
      const read = () => window.__gameverseSports?.read?.() || null;
      if (!read()) return { inputDispatched: false, engineResponded: false, detail: 'no match is displayed' };
      const readyEnd = Date.now() + 5000; let confirms = 0;
      while (read()?.phase !== 'play' && Date.now() < readyEnd) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        await new Promise(r => setTimeout(r, 80));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Enter', bubbles: true })); confirms++;
        await new Promise(r => setTimeout(r, 120));
      }
      // Entry/resume deliberately requires neutral input before arming keys.
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      const before = read(), samples = [], seen = new Set(), endAt = performance.now() + ms;
      document.querySelector('#screen canvas')?.focus?.({ preventScroll: true });
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      try { while (performance.now() < endAt) { await new Promise(requestAnimationFrame); const sample = read()?.control;
        if (sample && !seen.has(sample.frame)) { seen.add(sample.frame); samples.push(sample); } } }
      finally { window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); }
      const after = read();
      const valid = samples.filter(s => s.source === 'human' && s.keys?.includes(code) && s.before?.playerIndex === s.after?.playerIndex && Number.isFinite(s.before?.x) && Number.isFinite(s.after?.x) && ((s.after.x-s.before.x)*(s.move?.x||0)+((s.after.z??s.after.y)-(s.before.z??s.before.y))*(s.move?.y||0)) > 0.0005);
      const distance = valid.reduce((n,s) => n + Math.hypot(s.after.x-s.before.x,(s.after.z??s.after.y)-(s.before.z??s.before.y)),0);
      return { inputDispatched: true, code, selected: before.active ?? before.controlled, endSelected: after.active ?? after.controlled,
        engineResponded: valid.length >= 2, inputSamples: samples, verifiedInputFrames: valid.length, movedUnits: distance,
        framesAdvanced: after.frame-before.frame, preparatoryConfirms: confirms, paused: after.paused,
        detail: `human ${code} produced ${valid.length} engine-observed human input/movement frames (${distance.toFixed(3)} units)` };
    },
    pressVisibleStop: runId => {
      const row = [...document.querySelectorAll('#agent-runs li')].find(li => li.dataset.runId === runId);
      const target = row?.querySelector('button.agent-stop');
      if (!target) throw Error('The target player has no visible Stop button.');
      target.click(); return takeover.observe().running.filter(run => run.role === 'gameplay').map(run => run.runId); },
    spectatorCamera: async (seconds = 1) => {
      const controller = neighborhood?.controller;
      if (!controller) throw Error('The overworld is not open.');
      const readyEnd = Date.now() + 12000;
      const moving = () => { const run = [...takeover.host.runs.values()].find(r => r.state === 'running' && r.role !== 'requester' && takeover.host.sessions.get(r.sessionId)?.gameId === 'overworld');
        return Math.hypot(controller.agentDrive?.side || 0, controller.agentDrive?.forward || 0) > 0.1 && run?.harness?.current?.expiresAt - Date.now() > seconds * 1000 + 100; };
      while (!moving() && Date.now() < readyEnd) await new Promise(requestAnimationFrame);
      const before = controller.observe(), commanded = controller.agentDrive ? { ...controller.agentDrive } : null;
      // Real human spectator input: hold a movement key for the sampled window.
      controller.keys.add('KeyD');
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      controller.keys.delete('KeyD');
      const after = controller.observe();
      const moved = { x: after.x - before.x, z: after.z - before.z };
      const distance = Math.hypot(moved.x, moved.z);
      // Commanded world direction, from the host-granted drive vector.
      const want = commanded ? { x: commanded.side || 0, z: commanded.forward || 0 } : null;
      const wantLength = want ? Math.hypot(want.x, want.z) : 0;
      const delta = distance > 0.05 && wantLength > 0
        ? Math.hypot(moved.x / distance - want.x / wantLength, moved.z / distance - want.z / wantLength)
        : null;
      Object.assign(lifecycleEvidence, {
        spectatorCameraMovedIndependently: Number.isFinite(delta) && delta <= 0.05 && (Math.abs(after.yaw - before.yaw) > 0.01 || Math.abs(after.camera.distance - before.camera.distance) > 0.01),
        agentTrajectoryDelta: delta, agentDrivenDuringSpectator: Boolean(after.agentDriven),
        spectatorSample: { seconds, yawBefore: before.yaw, yawAfter: after.yaw, distanceMoved: distance,
          cameraDistanceBefore: before.camera.distance, cameraDistanceAfter: after.camera.distance, commanded: want },
      });
      return { ...lifecycleEvidence.spectatorSample, agentTrajectoryDelta: delta,
        spectatorCameraMovedIndependently: lifecycleEvidence.spectatorCameraMovedIndependently,
        humanSpectatorInput: after.humanSpectatorInput, agentDriven: after.agentDriven }; },
    // Privileged export for the external qualification runner: the real WAV
    // bytes with their run ids and playback timestamps. Model-facing contexts
    // never receive audio bytes.
    exportAudio: () => qualification.rawUtterances().map(entry => ({ text: entry.text, runId: entry.runId,
      bytes: entry.bytes, retainedBytes: entry.retainedBytes, truncated: entry.truncated, mime: entry.mime,
      at: entry.at, audioBase64: entry.audioBase64 })),
    captureLifecycle: () => qualification.capture.capture,
    evidence: async extra => {
      const ledger = await fetch('/api/agent/ledger').then(response => response.json()).catch(() => null);
      return buildEvidenceBundle({
        identity: { sourceCommit: document.documentElement.dataset.sourceCommit || null, gameId: 'soccer',
          gameVersion: games.find(game => game.id === 'soccer')?.version || null, adapter: 'custom-sports',
          harness: qualifying ? QUALIFICATION_HARNESS_CONFIG.version : HARNESS_VERSION, agent: 'voice-agent-v1', shell: takeover.version, qualification: qualification.version },
        receipt: voiceCommands[0]?.receipt || lastVoiceReceipt,
        capture: qualification.captureEvidence(voiceCommands),
        commands: voiceCommands.map(command => ({ ...command, receipt: command.receipt ? { requestId: command.receipt.requestId, processing: command.receipt.processing, status: command.receipt.status, transcription: command.receipt.transcription, textLength: command.receipt.text?.length ?? null } : null })),
        agent: voiceCommands[0] ? { planner: voiceCommands[0].planner, outcome: voiceCommands[0].outcome,
          acknowledgment: voiceCommands[0].acknowledgment, transcript: voiceCommands[0].transcript, toolCalls: voiceCommands[0].toolCalls }
          : lastVoiceRecord ? { planner: lastVoiceRecord.planner, outcome: lastVoiceRecord.outcome, acknowledgment: lastVoiceRecord.acknowledgment,
          transcript: lastVoiceRecord.transcript, toolCalls: (lastVoiceRecord.toolCalls || []).map(call => ({ callId: call.callId, name: call.name, ok: Boolean(call.ok), wallMs: call.wallMs })) } : null,
        takeover, providerLedger: ledger,
        // Spread the caller's extras FIRST so the measured lifecycle evidence
        // (session ids, frames at leave/reopen, spectator sample) always wins.
        ...extra,
        lifecycle: { ...lifecycleEvidence, ...(extra?.lifecycle || {}) },
      });
    },
  };
}
$('#voice-button').onclick = () => voice.toggle();
$('#voice-stop').onclick = () => voice.stop();
$('#voice-cancel').onclick = () => void voice.cancel();
$('#voice-done').onclick = () => void voice.close();
$('#voice-dialog').addEventListener('cancel', event => { event.preventDefault(); void voice.cancel(); });
voice.configure().then(config => {
  const label = config.recordButton === 11 ? 'R3' : `Button ${config.recordButton}`;
  $('#voice-button kbd').textContent = label;
  $('#voice-button').setAttribute('aria-label', `Give voice feedback — ${label}`);
}).catch(() => {});
const nameEntry = createProfileNameEntry({
  canStart: () => !busy && !document.hidden && document.hasFocus() && !voice.capturing,
  onTransition: clearInput,
});
function notice(message) { $('#notice').textContent = message; }
function voiceNotice(message) {
  clearTimeout(voiceNoticeTimer); notice(message);
  voiceNoticeTimer = setTimeout(() => { if ($('#notice').textContent === message) notice(''); }, 5000);
}
async function timed(operation, context, work) {
  const start = performance.now(); let outcome = 'passed';
  try { return await work(); } catch (error) { outcome = 'failed'; throw error; }
  finally {
    const report = { runId: crypto.randomUUID(), operation, context, outcome, wallMs: performance.now() - start, timestamp: new Date().toISOString(), queueMs: null, loop: null };
    timings.push(report);
    // Reporting failure must not turn a confirmed checkpoint into a failed save.
    storage.put(`timing:${report.runId}`, report).catch(() => {});
  }
}
function setProfile(value) {
  profile = value;
  $('#profile-button').textContent = value ? `${value.avatar}  ${value.name}  ↗` : 'Create character ↗';
  $('#world-character').textContent = value ? `${value.avatar}  ${value.name} · change character` : 'Choose character';
}
async function refreshGames() {
  const response = await fetch('/games/catalog.json');
  if (!response.ok) throw Error('The local game catalog is unavailable. Start with npm run dev.');
  games = configuredGames(application, await response.json());
  await renderGames();
}
// Host catalog registration: an opener alone does not make a target supported,
// so every ready game (and the overworld) is registered with its real version
// and artifact identity before any voice command can resolve a target.
function registerTakeoverTargets() {
  for (const game of games) {
    if (game.kind !== 'custom-sports' || !game.ready) continue;
    try {
      takeover.host.registerGame({ gameId: game.id, version: game.version, name: game.name,
        kind: game.kind, artifactSha256: game.artifactSha256 || null, adapter: game.adapter || null });
    } catch (error) { console.debug('[takeover] target not registered', game.id, error.message); }
  }
  if (application?.base?.kind === 'neighborhood') {
    try { takeover.host.registerGame({ gameId: 'overworld', version: String(application.version || '1'), name: application.title || 'Gameverse', kind: 'base' }); }
    catch (error) { console.debug('[takeover] overworld not registered', error.message); }
  }
  return takeover.host.listGames();
}
async function renderGames() {
  registerTakeoverTargets();
  $('#games').replaceChildren();
  $('#collection-count').textContent = String(games.length).padStart(2, '0');
  $('#games').classList.toggle('single-game', games.length === 1);
  for (const game of games) {
    let head;
    if (profile && game.ready) head = await storage.get(progressKey(identityFor(game)));
    if (game.kind === 'custom-sports') {
      const card = document.createElement('article'); card.className = `game-card sport-card ${game.id}`;
      card.innerHTML = `<div class="sport-card-art"><span>ALDER SPORTS / ORIGINAL</span><h3>${escapeHtml(game.name)}</h3><p>${escapeHtml(game.subtitle)}</p></div><div class="card-info"><p>${head ? 'Your saved match is ready.' : 'Team control · classic controls · play the CPU'}</p><button data-game="${game.id}">${head ? 'Continue match' : 'Play quick match'} ↗</button></div>`;
      card.querySelector('button').onclick = () => startGame(game).catch(handleError); $('#games').append(card); continue;
    }
    const card = document.createElement('article'); card.className = `game-card ${game.id}`;
    card.innerHTML = `<div class="game-art"><div class="art-label"><span>GAME BOY ADVANCE</span><span>${game.id === 'firered' ? '01' : '02'} / GBA</span></div>${game.id === 'firered'
      ? '<div class="pixel-sun"></div><div class="land land-back"></div><div class="land land-front"></div><div class="tree tree-one"></div><div class="tree tree-two"></div><div class="art-title">FIRE<span>RED</span></div><span class="art-caption">A whole world awaits.</span>'
      : '<div class="cloud cloud-one"></div><div class="cloud cloud-two"></div><div class="coin coin-one"></div><div class="coin coin-two"></div><div class="pipe pipe-one"></div><div class="pipe pipe-two"></div><div class="art-title">SUPER<br>MARIO<span>ADVANCE 4</span></div><span class="art-caption">One more adventure.</span>'}</div><div class="card-info"><div class="card-top"><span class="eyebrow">${game.id === 'firered' ? 'EXPLORE · COLLECT · BATTLE' : 'RUN · JUMP · DISCOVER'}</span><span class="game-state ${game.ready ? 'ready' : ''}">${game.ready ? 'SOURCE BUILT' : 'BUILD PENDING'}</span></div><h3>${escapeHtml(game.name)}</h3><p class="game-subtitle">${game.subtitle ? escapeHtml(game.subtitle) : 'The Kanto adventure, from the beginning.'}</p><div class="card-bottom"><p>${head ? `Last saved ${new Date(head.savedAt).toLocaleString()}` : game.ready ? 'A fresh adventure is waiting.' : escapeHtml(game.reason)}</p><button data-game="${game.id}" ${game.ready ? '' : 'disabled'}>${head ? 'Continue' : 'Play'} <span>↗</span></button></div>${game.ready ? '<p class="qualification">Development build · campaign qualification pending</p>' : ''}</div>`;
    card.querySelector('[data-game]').onclick = () => startGame(game).catch(handleError);
    $('#games').append(card);
  }
}
function identityFor(game) {
  if (game.kind === 'custom-sports') return { kind: game.kind, profileId: profile.id, gameId: game.id, version: game.version, artifactSha256: game.artifactSha256, adapter: game.adapter, snapshotFormat: game.snapshotFormat };
  return { profileId: profile.id, gameId: game.id, cartridgeSha256: game.receipt.sha256, wasmSha256: runtime.wasmSha256, loaderSha256: runtime.loaderSha256, adapter: runtime.adapter, snapshotFormat: runtime.snapshotFormat };
}
function clearInput() { keyboard.clear(); inputMask = -1; padArmed = false; session?.adapter?.input(0); }
function showProfile() {
  if (voice.capturing) void voice.cancel();
  $('#existing-profiles').replaceChildren();
  for (const existing of profiles) {
    const button = document.createElement('button'); button.className = 'existing-profile'; button.textContent = `${existing.avatar} ${existing.name} →`;
    button.onclick = async () => {
      if (busy) return;
      busy = true; let selected = false;
      try { await storage.put('selected-profile', existing.id); setProfile(existing); await renderGames(); selected = true; }
      catch (error) { handleError(error); }
      finally { busy = false; if (selected) $('#profile-dialog').close('selected'); }
    };
    $('#existing-profiles').append(button);
  }
  clearInput(); $('#profile-dialog').returnValue = ''; $('#profile-dialog').showModal(); nameEntry.reset();
}
async function startGame(game, mode = 'snapshot', origin = 'collection') {
  if (busy || session) return;
  // Reopening a match a simulated user is still playing shows that exact
  // runtime: no reload, restart or replay, and its progress lock is retained.
  const background = backgroundSessions.get(game.id);
  if (background && mode === 'snapshot') {
    backgroundSessions.delete(game.id); session = background;
    $('#screen').replaceChildren(background.view);
    background.adapter?.activateView?.();
    await background.adapter.resume(); background.state = 'playing';
    configureGameView(background);
    neighborhoodOpen = false; $('#neighborhood').hidden = true; document.body.classList.remove('exploring-neighborhood');
    neighborhood?.suspend();
    $('#home').hidden = true; $('#player').hidden = false; $('#profile-button').disabled = true;
    document.body.classList.add('playing-subgame'); document.body.classList.toggle('playing-sports', game.kind === 'custom-sports');
    takeover.setDisplayed(background.agentSessionId, true);
    $('#session-status').textContent = 'The same match is still running. Stop the simulated user to take the controls.';
    notice(''); return;
  }
  if (neighborhoodOpen) return;
  if (!profile) { showProfile(); notice('Create or select your character, then choose a game.'); return; }
  busy = true; notice('Loading your adventure…');
  let current, release;
  try {
    validateGameBinding(application, game, game.kind === 'custom-sports' ? game : runtime);
    release = await storage.acquireSessionLock(`session:${profile.id}:${game.id}`);
    const identity = identityFor(game), key = progressKey(identity);
    current = { game, identity, key, release, origin, state: 'loading', head: await storage.get(key) || { revision: 0 } };
    session = current;
    $('#profile-button').disabled = true;
    $('#save-return').textContent = origin === 'neighborhood' ? 'Save & return to Gameverse' : 'Save & return to collection';
    const custom = game.kind === 'custom-sports';
    let rom;
    if (!custom) {
      const romResponse = await fetch(game.artifactUrl);
      if (!romResponse.ok) throw Error('Built cartridge is unavailable. The confirmed progress is retained.');
      rom = new Uint8Array(await romResponse.arrayBuffer());
      if (await digest(rom) !== identity.cartridgeSha256) throw Error('Cartridge digest does not match its source-build receipt.');
      validateCartridge(rom, game.gameCode);
    }
    let state, battery, expectedFrame;
    if (current.head.snapshotId && mode === 'snapshot') {
      const checkpoint = await storage.get(`snapshot:${current.head.snapshotId}`);
      validateCheckpoint(checkpoint, identity);
      if (await digest(checkpoint.state) !== checkpoint.sha256) throw Error('Snapshot integrity check failed.');
      state = checkpoint.state;
      expectedFrame = checkpoint.frame;
      if (checkpoint.batteryId) {
        const paired = await storage.get(`battery:${checkpoint.batteryId}`);
        if (!paired || progressKey(paired.identity) !== key || await digest(paired.bytes) !== paired.sha256) throw Error('The snapshot’s paired cartridge save is missing or invalid.');
        battery = paired.bytes;
      }
    }
    if (mode === 'battery') {
      const record = await storage.get(`battery:${current.head.batteryId}`);
      if (!record || progressKey(record.identity) !== key || await digest(record.bytes) !== record.sha256) throw Error('Confirmed in-game save is unavailable or invalid.');
      battery = record.bytes;
    }
    $('#home').hidden = true; $('#player').hidden = false; document.body.classList.add('playing-subgame');
    configureGameView(current);
    current.view = document.createElement('div'); current.view.className = 'session-view';
    $('#screen').replaceChildren(current.view);
    if (custom) {
      const { CustomSportsAdapter } = await import(game.entryUrl);
      current.adapter = new CustomSportsAdapter(current.view, game, error => failSession(current, error), { onPause: openMenu, ownsB: () => voiceOwnsSportsB, preferredPadIndex: shellPadIndex });
    } else {
      current.view.innerHTML = '<canvas width="240" height="160" aria-label="Game Boy Advance game screen"></canvas>';
      current.adapter = new GbaAdapter(current.view.querySelector('canvas'), error => failSession(current, error));
    }
    const loadContext = { ...identity, buildRunId: game.receipt?.runId || null, mode, origin, baseConfig: { id: application.id, version: application.version, kind: application.base.kind }, expectedFrame: expectedFrame ?? null };
    await timed('load-and-restore', loadContext, async () => {
      const loaded = await (custom ? current.adapter.load(state) : current.adapter.load(rom, state, battery));
      loadContext.restoredFrame = loaded.frame;
      if (state && loaded.frame !== expectedFrame) throw Error('Restored frame does not match the confirmed checkpoint.');
    });
    if (session !== current || current.state !== 'loading') throw Error('Session stopped during loading. Retry from the collection.');
    clearInput();
    await current.adapter.resume(); current.state = 'playing';
    if (custom) {
      const registered = takeover.registerSportsSession({ handle: current.adapter.controlHandle(), identity,
        progressKey: key, displayed: true, origin });
      current.agentSessionId = registered.sessionId;
    }
    $('#session-status').textContent = mode === 'battery' ? 'Using the last confirmed in-game save. Previous snapshots are retained.' : state ? 'Exact confirmed snapshot restored.' : `New session. Save & return to ${origin === 'neighborhood' ? 'Gameverse' : 'the collection'} to confirm a checkpoint.`;
    notice('');
  } catch (error) {
    if (current) { current.adapter?.dispose(); failSession(current, error); }
    else { await release?.(); restoreSessionOrigin(origin, error.message); handleError(error); }
  } finally { busy = false; }
}
function configureGameView(current) {
  const { game, origin } = current, custom = game.kind === 'custom-sports';
  $('#save-return').textContent = origin === 'neighborhood' ? 'Save & return to Gameverse' : 'Save & return to collection';
    $('#playing-title').textContent = game.subtitle ? `${game.name}: ${game.subtitle}` : game.name;
    document.body.classList.toggle('playing-sports', custom);
    $('#download-save').hidden = custom;
    $('#menu-button').setAttribute('aria-label', custom ? 'Gameverse menu — Start or Escape' : 'Gameverse menu — Y or Escape');
    $('#menu-button kbd').textContent = custom ? 'Start' : 'Y';
    $('#session-control-note').textContent = custom
      ? (game.id === 'soccer'
        ? 'Soccer: LS move and pass/shot direction · A pass · B shoot/tackle · X lob/tackle · Y through ball · RS skills · LB run/switch · RB finesse/driven · LT shield/jockey · RT sprint. Hold then release the action for power. Start/Options pauses; R3 voice. Keyboard: WASD direction, J pass, K shoot, U through, I lob, L tackle, Q run/switch, F modifier, E + arrows skill, C shield, Shift sprint, Esc pause.'
        : 'Football: A snap · A/B/X receiver buttons (tap lob, hold bullet) · LS move and pass lead · RS juke · A stiff arm · B spin · RB protect · RT sprint. Defense: B switch, X dive tackle, A conservative tackle, LT strafe. Start/Options pauses; R3 voice. Keyboard: WASD move/lead, J/U/K receivers, L tackle, Q switch, E + arrows skill, C protect, V strafe, Shift sprint, Esc pause. Pausing cancels an unfinished throw.')
      : 'Start and View / Back belong to FireRed.';
}
function failSession(current, error) {
  if (session !== current) return;
  const canResume = current.state === 'saving' || current.state === 'paused';
  clearInput(); current.state = 'failed'; current.adapter?.silence();
  $('#resume-button').hidden = !canResume || !current.adapter || current.adapter.disposed;
  $('#save-return').hidden = !current.adapter || current.adapter.disposed;
  $('#battery-fallback').hidden = !current.head.batteryId;
  $('#session-title').textContent = 'Your game needs attention.';
  $('#session-message').textContent = `${error.message} Your last confirmed checkpoint is retained. ${current.origin === 'neighborhood' ? 'Leave to return to the arcade and try again.' : 'Leave and select Continue to retry.'}`;
  $('#force-return').textContent = 'Leave without saving…'; current.confirmForce = false;
  if (!$('#session-dialog').open) $('#session-dialog').showModal();
  ($('#resume-button').hidden ? $('#force-return') : $('#resume-button')).focus();
  notice(error.message);
}
async function openMenu() {
  const current = session;
  if (!current || busy || current.state !== 'playing') return;
  current.state = 'paused'; clearInput();
  try {
    await current.adapter.pause();
    $('#session-title').textContent = 'Game paused.';
    $('#session-message').textContent = `Save & return to ${current.origin === 'neighborhood' ? 'Gameverse' : 'the collection'} to keep this exact moment. Closing the browser recovers only the last confirmed checkpoint.`;
    $('#resume-button').hidden = false; $('#save-return').hidden = false; $('#battery-fallback').hidden = true;
    $('#force-return').textContent = 'Leave without saving…'; current.confirmForce = false;
    $('#session-dialog').showModal();
    $('#resume-button').focus();
  } catch (error) { failSession(current, error); }
}
function restoreSessionOrigin(origin, message = '') {
  clearInput();
  if (origin === 'neighborhood' && neighborhood) {
    neighborhoodOpen = true; $('#neighborhood').hidden = false; $('#home').hidden = true;
    $('#profile-button').disabled = true; document.body.classList.add('exploring-neighborhood');
    neighborhood.resume(message);
  } else {
    if (application?.base.kind === 'neighborhood') openWorldMenu(message || 'Reopen Gameverse to return to your world.');
    else { $('#home').hidden = false; $('#profile-button').disabled = false; }
  }
}
async function leaveSession({ restoreOrigin = true, message = '' } = {}) {
  const current = session;
  if (!current) return;
  const wasBusy = busy; busy = true;
  const keepRunning = current.agentSessionId && !takeover.disposable(current.agentSessionId);
  try {
    session = undefined;
    if (keepRunning) {
      // The simulated user keeps playing this exact session in the background;
      // its adapter, progress lock and checkpoint policy are untouched.
      await current.adapter.pause(); current.state = 'paused';
      current.adapter?.deactivateView?.(); current.view?.remove();
      backgroundSessions.set(current.game.id, current);
      takeover.setDisplayed(current.agentSessionId, false);
      clearInput(); $('#session-dialog').close(); $('#player').hidden = true;
      document.body.classList.remove('playing-subgame', 'playing-sports');
      if (restoreOrigin) restoreSessionOrigin(current.origin, message || 'The simulated user is still playing. Return to its venue to watch.');
      renderAgentPanel(); return;
    }
    if (current.agentSessionId) takeover.host.closeSession(current.agentSessionId, { reason: 'left the match' });
    current.adapter?.dispose(); await current.release();
    clearInput(); $('#session-dialog').close(); $('#player').hidden = true; document.body.classList.remove('playing-subgame', 'playing-sports'); $('#screen').replaceChildren();
    if (restoreOrigin) restoreSessionOrigin(current.origin, message);
    renderGames().catch(handleError);
  } finally { busy = wasBusy; }
}
async function saveAndReturn() {
  const current = session;
  if (!current || busy) return;
  busy = true; $('#save-return').disabled = true; $('#force-return').disabled = true;
  current.state = 'saving'; clearInput();
  try {
    const captured = await timed('snapshot-capture', current.identity, () => current.adapter.checkpoint());
    const savedAt = new Date().toISOString();
    const battery = captured.battery ? { id: crypto.randomUUID(), identity: current.identity, bytes: captured.battery, sha256: await digest(captured.battery), savedAt } : null;
    const checkpoint = { id: crypto.randomUUID(), identity: current.identity, state: captured.state, sha256: await digest(captured.state), frame: captured.frame, savedAt, batteryId: battery?.id || null };
    current.head = await timed('checkpoint-commit', current.identity, () => storage.commitCheckpoint(current.key, current.head.revision, checkpoint, battery));
    await leaveSession({ message: 'Match or adventure saved. Visit its venue to continue.' }); notice('Moment saved. Your adventure will be here when you return.');
  } catch (error) { failSession(current, error); }
  finally { busy = false; $('#save-return').disabled = false; $('#force-return').disabled = false; }
}
function handleError(error) { notice(error.message || String(error)); }
async function enterGameFromNeighborhood(gameId = 'firered') {
  const sourceWorld = neighborhood;
  if (!sourceWorld || !neighborhoodOpen || busy || session || neighborhoodEntryPending) {
    sourceWorld?.resume('Finish the current action, then try the arcade again.'); return;
  }
  neighborhoodEntryPending = true;
  const stillHere = () => neighborhood === sourceWorld && neighborhoodOpen;
  try {
    if (!profile) {
      await new Promise(resolve => {
        $('#profile-dialog').addEventListener('close', resolve, { once: true });
        showProfile();
      });
      if (!stillHere()) return;
      if (!profile || $('#profile-dialog').returnValue !== 'selected') { sourceWorld.resume('Choose a character when you are ready to play.'); return; }
    }
    // Refresh readiness at the entrance so a missing or newly built cartridge is reported accurately.
    await refreshGames();
    if (!stillHere()) return;
    const game = games.find(item => item.id === gameId);
    if (!game?.ready) throw Error(game?.reason || 'This game is not ready. Return to the venue and try again.');
    if (!runtime) throw Error('The game runtime is unavailable. Reload Gameverse before trying again.');
    sourceWorld.suspend(); neighborhoodOpen = false; $('#neighborhood').hidden = true;
    document.body.classList.remove('exploring-neighborhood'); clearInput();
    await startGame(game, 'snapshot', 'neighborhood');
    if (!session && !neighborhoodOpen) restoreSessionOrigin('neighborhood', 'The game did not start. Try its venue again.');
  } catch (error) {
    if (neighborhood === sourceWorld && !session) restoreSessionOrigin('neighborhood', error.message || 'The game could not open.');
  } finally { neighborhoodEntryPending = false; }
}
async function exploreNeighborhood() {
  if (busy || session || neighborhoodOpen) return;
  const launch = ++neighborhoodLaunch;
  neighborhoodOpen = true; clearInput(); notice('');
  $('#profile-button').disabled = true; $('#home').hidden = true; $('#neighborhood').hidden = false;
  document.body.classList.add('exploring-neighborhood');
  const showMenu = pose => {
    if (launch !== neighborhoodLaunch) return;
    neighborhoodPose = pose || neighborhoodPose; openWorldMenu();
  };
  try {
    const { openNeighborhood } = await import('./neighborhood.js');
    const opened = await openNeighborhood($('#neighborhood'), showMenu, neighborhoodPose, enterGameFromNeighborhood,
      { title: application.title, location: application.base.location, hasFireRed: application.subgames.some(game => game.id === 'firered'), gameIds: application.subgames.map(game => game.id) });
    if (launch === neighborhoodLaunch) {
      neighborhood = opened;
      if (opened.controller) {
        const registered = takeover.registerOverworldSession({ controller: opened.controller, world: opened.world || null,
          identity: { profileId: profile?.id || 'local' }, progressKey: `overworld:${profile?.id || 'local'}`, displayed: true,
          // Real engine clock: rendered frames and active simulation time.
          simulation: () => opened.observe(), hold: value => opened.holdExecution?.(value) });
        opened.agentSessionId = registered.sessionId;
      }
      if ($('#world-menu').open) { opened.suspend(); updateWorldMenu(); }
    }
    else opened.dispose();
  } catch (error) {
    neighborhood?.dispose(); neighborhood = undefined; neighborhoodOpen = false;
    $('#neighborhood').hidden = true; openWorldMenu(error.message || 'Gameverse could not open. Try reopening your world.');
  }
}
function updateWorldMenu() {
  const state = neighborhood?.observe().state;
  $('#world-resume').disabled = !neighborhood || state === 'failed' || state === 'disposed';
  $('#world-reload').hidden = !$('#world-resume').disabled;
  $('#world-menu-close').hidden = $('#world-resume').disabled;
  $('#world-menu-title').textContent = application?.title || 'Gameverse';
}
function openWorldMenu(message = '') {
  if (session || busy || worldProfilePending || $('#profile-dialog').open) return;
  clearInput(); neighborhood?.suspend(); updateWorldMenu();
  $('#world-menu-message').textContent = message || 'Visit Alder Arcade, Juniper Pitch, or Foundry Field. Each venue keeps its own progress.';
  if (!$('#world-menu').open) { $('#world-menu').returnValue = ''; $('#world-menu').showModal(); }
  ($('#world-resume').disabled ? $('#world-reload') : $('#world-resume')).focus();
}
$('#world-resume').onclick = () => $('#world-menu').close('resume');
$('#world-menu-close').onclick = () => $('#world-menu').close('resume');
$('#world-menu').addEventListener('cancel', event => { if ($('#world-resume').disabled) event.preventDefault(); });
$('#world-menu').addEventListener('close', () => {
  clearInput();
  if (['character', 'reload', 'venue'].includes($('#world-menu').returnValue)) return;
  if (neighborhood && !session) neighborhood.resume();
});
for (const button of document.querySelectorAll('[data-venue]')) button.onclick = async () => {
  const id = button.dataset.venue;
  $('#world-menu').close('venue');
  await enterGameFromNeighborhood(id);
};
$('#world-character').onclick = () => {
  if (busy || session) return;
  worldProfilePending = true; $('#world-menu').close('character'); showProfile();
};
$('#profile-dialog').addEventListener('close', () => {
  clearInput();
  if (worldProfilePending) { worldProfilePending = false; openWorldMenu(); }
});
$('#world-reload').onclick = async () => {
  if (busy || session) return;
  $('#world-menu').close('reload');
  neighborhood?.dispose(); neighborhood = undefined; neighborhoodOpen = false;
  await exploreNeighborhood();
};
$('#reload-application').onclick = () => location.reload();
$('#profile-button').onclick = showProfile;
$('#refresh-games').onclick = () => refreshGames().catch(handleError);
$('#avatars').innerHTML = avatars.map((value, index) => `<button type="button" aria-label="${['Fox', 'Frog', 'Robot', 'Alien'][index]} avatar" aria-pressed="${index === 0}">${value}</button>`).join('');
$('#avatars').onclick = event => { const button = event.target.closest('button'); if (!button) return; avatar = button.textContent; for (const choice of $('#avatars').children) choice.setAttribute('aria-pressed', String(choice === button)); };
$('#profile-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  const name = nameEntry.confirm(avatar); if (!name) return;
  busy = true;
  let release, selected = false;
  try {
    release = await storage.acquireSessionLock('profiles');
    const latest = await storage.get('profiles') || [];
    const created = { id: crypto.randomUUID(), name, avatar };
    await storage.put('profiles', [...latest, created]); await storage.put('selected-profile', created.id);
    profiles = [...latest, created]; setProfile(created); await renderGames(); selected = true; notice(`Welcome, ${name}. Pick your adventure.`);
  } catch (error) { handleError(error); } finally { await release?.(); busy = false; if (selected) $('#profile-dialog').close('selected'); }
};
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => { $(`#${button.dataset.close}`).close(); clearInput(); };
$('#menu-button').onclick = openMenu;
$('#resume-button').onclick = async () => {
  if (busy || !session) return;
  const current = session; busy = true;
  try { clearInput(); await current.adapter.resume(); clearInput(); current.state = 'playing'; $('#session-dialog').close(); }
  catch (error) { failSession(current, error); }
  finally { busy = false; }
};
$('#save-return').onclick = saveAndReturn;
$('#force-return').onclick = async () => {
  if (busy || !session) return;
  if (!session.confirmForce) { session.confirmForce = true; $('#force-return').textContent = 'Confirm leave — discard unconfirmed progress'; return; }
  await leaveSession({ message: 'Returned without a new checkpoint. Only previously confirmed progress is available.' }); notice('Returned without a new checkpoint. Only previously confirmed progress is available.');
};
$('#session-dialog').addEventListener('cancel', event => { event.preventDefault(); if (!$('#resume-button').hidden) $('#resume-button').click(); });
$('#feedback-button').onclick = async () => {
  if (session?.state !== 'paused' || $('#resume-button').hidden) return;
  await $('#resume-button').onclick();
  if (session?.state === 'playing') voice.toggle();
};
$('#battery-fallback').onclick = async () => {
  if (busy || !session) return;
  const { game, origin } = session;
  await leaveSession({ restoreOrigin: false }); await startGame(game, 'battery', origin);
};
$('#download-save').onclick = async () => {
  try {
    const id = session?.head.batteryId;
    if (!id) throw Error('No confirmed in-game save yet. Save & return first.');
    const record = await storage.get(`battery:${id}`);
    const url = URL.createObjectURL(new Blob([record.bytes]));
    const link = document.createElement('a'); link.href = url; link.download = `${session.game.id}-${id}.sav`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { handleError(error); }
};
window.addEventListener('keydown', event => {
  if ($('#voice-dialog').open && event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); void voice.cancel(); return; }
  const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.code];
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable;
  if (direction && !editing && $('dialog[open]:not(#voice-dialog)')) {
    event.preventDefault();
    if (!busy) focusDirection(direction);
    return;
  }
  if (event.repeat && (event.code === 'Enter' || event.code === 'Space')) event.preventDefault();
  if (event.code === 'Escape' && session?.state === 'playing') { event.preventDefault(); openMenu(); return; }
  if (session?.state !== 'playing' || session.game?.kind === 'custom-sports' || !KEY_BITS[event.code]) return;
  event.preventDefault(); if (!event.repeat) keyboard.add(event.code);
});
window.addEventListener('keyup', event => keyboard.delete(event.code));
function cancelCapture() {
  if (voice.capturing) void voice.cancel();
  if (nameEntry.voice.active) void nameEntry.voice.cancel();
}
window.addEventListener('blur', () => { cancelCapture(); clearInput(); openMenu(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelCapture(); clearInput(); openMenu(); } });
window.addEventListener('gamepaddisconnected', () => { cancelCapture(); clearInput(); openMenu(); });
window.addEventListener('beforeunload', event => { if (session) { event.preventDefault(); event.returnValue = ''; } });
function focusDirection(direction) {
  const scope = $('dialog[open]:not(#voice-dialog)') || $('#home');
  const candidates = [...scope.querySelectorAll('button:not(:disabled), input, a')].filter(el => el.getClientRects().length);
  const active = document.activeElement;
  if (!candidates.includes(active)) { candidates[0]?.focus(); return; }
  const a = active.getBoundingClientRect(), x = a.x + a.width / 2, y = a.y + a.height / 2;
  const ranked = candidates.filter(el => el !== active).map(el => {
    const b = el.getBoundingClientRect(), dx = b.x + b.width / 2 - x, dy = b.y + b.height / 2 - y;
    const along = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    return { el, score: along > 5 ? along + across * 3 : Infinity };
  }).sort((a, b) => a.score - b.score);
  if (Number.isFinite(ranked[0]?.score)) ranked[0].el.focus();
}
function pollInput(now) {
  const padsForVoice = navigator.getGamepads?.() || [], voiceEnabled = !document.hidden && document.hasFocus() && !busy;
  const nameOwnsB = nameEntry.voice.poll(padsForVoice, voiceEnabled && $('#profile-dialog').open);
  const voiceOwnsB = voice.poll(padsForVoice, voiceEnabled) || nameOwnsB;
  voiceOwnsSportsB = voiceOwnsB;
  // A controller must not activate a focused button in an inactive browser tab.
  // Saving/loading also suspend menu actions; held buttons must be released afterward.
  if (document.hidden || !document.hasFocus() || busy) {
    if (padArmed || keyboard.size || inputMask !== -1) clearInput();
    padArmed = false; padPrevious = []; requestAnimationFrame(pollInput); return;
  }
  // The world owns keyboard/mouse focus; do not navigate or activate hidden shell controls.
  if (neighborhoodOpen && !$('dialog[open]:not(#voice-dialog)')) { padArmed = false; padPrevious = []; requestAnimationFrame(pollInput); return; }
  const pads = [...(navigator.getGamepads?.() || [])];
  const sampled = sampleStandardGamepad(pads, shellPadIndex);
  const pad = pads.find(p => p?.connected && p.index === sampled.index && p.mapping === 'standard');
  const device = pad ? `${pad.index}:${pad.id}` : null;
  if (device !== shellPadDevice) {
    const lostActiveDevice = shellPadDevice !== null;
    clearInput(); padPrevious = []; shellPadDevice = device; shellPadIndex = sampled.index;
    if (lostActiveDevice) openMenu();
  }
  const mask = padMask(pad) & (voiceOwnsB ? ~2 : ~0);
  const buttons = pad ? pad.buttons.map(b => b.pressed) : [];
  const neutral = sampled.neutral;
  if (pad && neutral) padArmed = true;
  if (padArmed) {
    const pressed = i => buttons[i] && !padPrevious[i];
    if (session?.state === 'playing') {
      // Sports use Start/Options; Y belongs to their familiar gameplay layout.
      // FireRed keeps Start/Back in-game and Y (or both triggers) for the host.
      const sports = session.game?.kind === 'custom-sports';
      if (pressed(16) || (sports ? pressed(9) : pressed(3) || (buttons[6] && buttons[7]))) { openMenu(); padArmed = false; }
    } else {
      const dialog = $('dialog[open]:not(#voice-dialog)');
      if (dialog && ((!voiceOwnsB && pressed(1)) || ((dialog.id === 'world-menu' || (dialog.id === 'session-dialog' && session?.game?.kind === 'custom-sports')) && pressed(9)))) {
        if (dialog.id === 'session-dialog') {
          if (!$('#resume-button').hidden && !$('#resume-button').disabled) $('#resume-button').click();
        } else if (dialog.id === 'world-menu') {
          if (!$('#world-resume').disabled) $('#world-resume').click();
        } else if (dialog.id !== 'profile-dialog' || !nameEntry.back()) dialog.close('cancel');
        clearInput(); lastPadAction = now;
      } else if (pressed(0)) { document.activeElement?.click(); lastPadAction = now; padArmed = false; }
      else if ((mask & 240) && now - lastPadAction > 180) { focusDirection(mask & 64 ? 'up' : mask & 128 ? 'down' : mask & 32 ? 'left' : 'right'); lastPadAction = now; }
    }
  }
  if (session?.state === 'playing' && session.game?.kind !== 'custom-sports') {
    const next = [...keyboard].reduce((mask, code) => mask | KEY_BITS[code], padArmed ? mask : 0);
    if (next !== inputMask) { inputMask = next; session.adapter.input(next); }
  }
  padPrevious = buttons;
  $('#controller-status').textContent = pad ? `${pad.id} · controller ready` : 'Keyboard ready · Connect a controller to play';
  $('#world-controller-status').textContent = pad ? 'Left stick / D-pad · choose · A · select · B · back' : 'Keyboard + mouse · press a controller button to connect';
  requestAnimationFrame(pollInput);
}
requestAnimationFrame(pollInput);
// Harness ticks run on their own frame callback: they only schedule the
// harness's own asynchronous work, and a harness error cannot break shell input.
function tickTakeover(now) { takeover.tick(now + performance.timeOrigin); requestAnimationFrame(tickTakeover); }
requestAnimationFrame(tickTakeover);
let healthPending = false;
setInterval(async () => {
  const current = session;
  if (!current || current.state !== 'playing' || document.hidden || healthPending) return;
  healthPending = true;
  try {
    const health = await current.adapter.request('health');
    if (session !== current || current.state !== 'playing') return;
    if (health.frame === current.lastFrame) throw Error('Game execution stopped advancing. Return or retry from the last checkpoint.');
    current.lastFrame = health.frame;
  } catch (error) { failSession(current, error); } finally { healthPending = false; }
}, 2000);
try {
  application = await loadApplicationConfig(location.pathname);
  window.__gameverseApplication = application;
  document.title = application.base.kind === 'neighborhood' ? application.title : `${application.title} · Your games, your world`;
  document.body.classList.toggle('world-application', application.base.kind === 'neighborhood');
  $('.brand').href = application.base.entryPath;
  profiles = await storage.get('profiles') || [];
  const selected = await storage.get('selected-profile');
  setProfile(profiles.find(p => p.id === selected));
  const response = await fetch('/runtime/identity.json'); if (!response.ok) throw Error('Runtime identity unavailable.'); runtime = await response.json();
  await refreshGames();
  $('#application-loading').hidden = true; document.body.classList.remove('application-loading');
  if (application.base.kind === 'neighborhood') await exploreNeighborhood();
  else $('#home').hidden = false;
} catch (error) {
  $('#application-loading').hidden = true; document.body.classList.remove('application-loading'); document.body.classList.add('application-failed');
  $('#application-error').hidden = false; $('#application-error-message').textContent = error.message || 'Gameverse could not open.';
}
