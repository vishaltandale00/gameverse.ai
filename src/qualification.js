// Qualification wiring. Enabled only by an explicit flag (?qualify=1), never in
// ordinary play. It gives the simulated requester a real app surface: its
// decision circuits choose speech or a UI action, speech is synthesized to real
// audio, and the audio enters the ordinary VoiceInput capture path. The
// requester has no gameplay authority and no transcript or tool shortcut.
import { SimulatedUser } from './simulated-user.js';
import { createRequesterCapture, requesterSpeechAdapter } from './requester-capture.js';

export const QUALIFICATION_VERSION = 'qualification-v1';

// Versioned qualification config; finite call budgets are sized for 300ms cadence.
// Possession-aware gameplay circuits. Each one still asks the Decisions API for
// the action; the circuit only supplies the situational intent, which is harness
// configuration. The engine knows none of this.
export const QUALIFICATION_GAMEPLAY_CIRCUITS = [
  { name: 'menu-confirm', policy: 'builtin', when: observation => observation.menu === true,
    action: () => ({ type: 'confirm', durationMs: 150 }) },
  { name: 'shoot-when-you-have-the-ball', policy: 'decisions',
    when: observation => observation.possession === 'us' && observation.ballOwnerIsSelected === true,
    intent: 'Your selected player has the ball: take a shot at goal now if you have any sight of it, otherwise pass or move into a shooting position. Do not just keep running.' },
  { name: 'support-our-attack', policy: 'decisions',
    when: observation => observation.possession === 'us',
    intent: 'Your team has the ball but a teammate carries it: move into space toward the opponent goal, or request the ball.' },
  { name: 'win-the-ball-back', policy: 'decisions',
    when: observation => observation.possession === 'them',
    intent: 'The opponent has the ball: close the carrier down, switch to the nearest defender, and tackle when you are next to them.' },
  { name: 'chase-the-loose-ball', policy: 'decisions',
    when: observation => observation.possession === 'loose',
    intent: 'The ball is loose: move onto it, then attack.' },
  // Any other surface (the overworld character) keeps a plain decisions circuit.
  { name: 'play', policy: 'decisions', when: () => true, intent: 'Pursue the stated goal with the controls this surface offers.' },
];

export const QUALIFICATION_HARNESS_CONFIG = {
  version: 'simulated-user-harness-v2/qualification-5-300ms', completionPolicy: 'explicit-stop',
  // 450 decisions cover 135 seconds at the requested 300ms minimum cadence.
  // A later second player has a separate grant; the server caps the whole run
  // at 600 decisions and the external runner at 240 gameplay seconds.
  // Calls remain single-flight, so provider latency can lower the actual rate.
  decisionIntervalMs: 300, actionDurationMs: 2000, chargedActionDurationMs: 700, maxActionDurationMs: 2400,
  staleAfterMs: 2000, reflectionIntervalMs: 15000,
  maxDecisions: 450, maxReflections: 2, maxWallMs: 220000,
  circuits: QUALIFICATION_GAMEPLAY_CIRCUITS,
};

// Engine-side surface for the app itself: the requester may press the record
// button and release it. Pressing record is a UI action, not a tool call.
export class AppRequesterSurface {
  constructor({ ui, now = () => Date.now() }) {
    Object.assign(this, { name: 'app', kind: 'app-ui', writesProgress: false, ui, now });
    this.dispatched = 0; this.log = [];
    this.capabilities = { surface: QUALIFICATION_VERSION, actions: {
      speech: { kind: 'speech' }, press_record: { kind: 'tap' }, send: { kind: 'tap' }, idle: { kind: 'idle' },
    }, notes: 'Requester UI surface: speak, press record, send. No gameplay control.' };
  }
  clock() { return { wallMs: this.now(), source: 'app' }; }
  observe() { return { surface: QUALIFICATION_VERSION, ...this.ui.observe(), at: this.now() }; }
  validate(action) {
    if (!action || !this.capabilities.actions[action.type]) return { ok: false, reason: `Unsupported requester action '${action?.type}'.` };
    return { ok: true };
  }
  stillValid(action) { return this.validate(action).ok; }
  apply(action) {
    const check = this.validate(action);
    if (!check.ok) throw Object.assign(Error(check.reason), { code: 'invalid-action' });
    if (action.type === 'press_record') this.ui.pressRecord();
    else if (action.type === 'send') this.ui.send();
    this.dispatched++; this.log.push({ type: action.type, at: this.now(), accepted: true });
    return { accepted: true, at: this.now() };
  }
  safeIdle() { this.log.push({ type: 'safe-idle', at: this.now(), accepted: true }); return { idled: true }; }
  report() { return { surface: QUALIFICATION_VERSION, dispatched: this.dispatched, log: this.log.slice(-20) }; }
}

// Requester circuits: speak the goal once, then press record so the app captures
// the synthesized audio through its normal microphone path.
export const REQUESTER_CIRCUITS = (command, capture = null) => [
  { name: 'speak-command', policy: 'builtin', when: (observation, memory) => !memory.notes.includes('spoken'),
    action: (observation, memory) => { memory.notes.push('spoken'); return { type: 'speech', text: command, durationMs: 400 }; } },
  // Record only once the synthesized audio is actually queued.
  { name: 'press-record', policy: 'builtin', when: (observation, memory) => memory.notes.includes('spoken') && !memory.notes.includes('recording')
    && observation.canRecord && Boolean(capture?.pending),
    action: (observation, memory) => { memory.notes.push('recording'); return { type: 'press_record', durationMs: 300 }; } },
  // Send only once the utterance has actually drained through the capture path.
  { name: 'send-command', policy: 'builtin', when: (observation, memory) => memory.notes.includes('recording') && !memory.notes.includes('sent')
    && observation.recording && capture?.capture?.drained === true,
    action: (observation, memory) => { memory.notes.push('sent'); return { type: 'send', durationMs: 300 }; } },
  // Finish explicitly once the app has taken the utterance (recording ended and
  // the app is no longer capturing): the requester's job is done.
  { name: 'finish', policy: 'builtin', when: (observation, memory) => memory.notes.includes('sent') && !observation.recording && observation.voiceState !== 'recording',
    action: (observation, memory) => { if (!memory.notes.includes('finished')) memory.notes.push('finished'); return { type: 'idle', durationMs: 200, finishRequester: true }; } },
  { name: 'wait', policy: 'builtin', when: () => true, action: () => ({ type: 'idle', durationMs: 500 }) },
];

export function installQualification({ takeover, voice, speechPath = '/api/agent/speech', fetchImpl = (...args) => fetch(...args),
  ui, now = () => Date.now(), sourceCommit = null, identity = {} } = {}) {
  const capture = createRequesterCapture({
    speech: async ({ text, voice: voiceName, runId }) => {
      const response = await fetchImpl(speechPath, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voiceName, runId }) });
      if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || 'Speech synthesis failed.');
      const audio = new Uint8Array(await response.arrayBuffer());
      return { audio, mime: response.headers.get('Content-Type') || 'audio/wav' };
    },
  });
  // The ordinary capture path now reads the requester's audio instead of a mic.
  voice.getUserMedia = constraints => capture.getUserMedia(constraints);

  const surface = new AppRequesterSurface({ ui, now });
  const session = takeover.host.registerSession({ gameId: 'requester-app', version: QUALIFICATION_VERSION,
    identity: { ...identity, role: 'requester' }, progressKey: `requester:${identity.profileId || 'local'}`, surfaces: [surface] });

  function startRequester(command, config = {}) {
    return takeover.host.startRun({ sessionId: session.sessionId, surface: 'app', role: 'requester',
      goal: command, requester: 'qualification',
      runner: ({ grant, run, finish }) => new SimulatedUser({
        grant, goal: run.goal, role: 'requester', now,
        finish: (outcome, detail) => finish(outcome, detail),
        // Separate authority, goals, memory and evidence from the gameplay runs.
        config: { decisionIntervalMs: 1e9, reflectionIntervalMs: 1e9, actionDurationMs: 400, staleAfterMs: 1e9,
          circuits: REQUESTER_CIRCUITS(command, capture), ...config },
        decisions: async () => { throw Error('The requester uses local circuits only.'); },
        speech: requesterSpeechAdapter(capture),
      }).start() });
  }

  return {
    version: QUALIFICATION_VERSION, capture, surface, sessionId: session.sessionId, startRequester,
    captureEvidence: (receipts = []) => {
      const utterances = capture.evidence().map(entry => {
        // Provenance: the receipt whose realtime transcription started after this
        // utterance began playing into the capture path.
        const receipt = receipts.find(candidate => candidate?.receipt?.receivedAt
          && Date.parse(candidate.receipt.receivedAt) >= entry.at) || null;
        return { ...entry, audioBase64: undefined, requestId: receipt?.requestId || null,
          transcriptionMode: receipt?.receipt?.transcription?.mode || null,
          transcriptLength: receipt?.receipt?.text?.length ?? null };
      });
      const paired = utterances.filter(entry => entry.requestId && entry.transcriptionMode && entry.bytes > 0);
      return { source: 'requester-capture', utterances, lifecycle: capture.capture,
        // True only when audio of non-zero length was paired with a realtime
        // transcription receipt; never an unconditional flag.
        transcriptFromAudio: paired.length > 0,
        pairedUtterances: paired.length,
        audioBytes: capture.evidence().reduce((total, entry) => total + entry.bytes, 0) };
    },
    rawUtterances: () => capture.evidence(),
    identity: () => ({ sourceCommit, ...identity }),
  };
}

// Assemble the verifier's bundle from real retained events. Nothing here is a
// claim: every field comes from the host, the harness, the engine or a receipt.
export function buildEvidenceBundle({ identity, receipt, capture, agent, takeover, lifecycle = {}, stop = {}, commands = [],
  providerLedger = null, recording = null, quality = null, infrastructure = { failures: [] }, goal = {} } = {}) {
  const runs = takeover.host.listRuns().filter(run => run.role !== 'requester').map(run => {
    const report = run.report || {};
    return {
      runId: run.runId, sessionId: run.sessionId, gameId: run.gameId, gameVersion: run.version, harness: run.harness,
      role: run.role, goal: run.goal, state: run.state, outcome: run.outcome, harnessConfig: report.config || null,
      usage: { actions: run.actions, ...(report.usage || {}) },
      actionLog: report.actionLog || [],
      actionLogWindow: report.actionLogWindow || null,
      chargeEvents: report.chargeEvents || [],
      reflections: report.memory?.reflections || [],
      clockSamples: takeover.clockSamples?.(run.runId) || [],
      progressWriterConflict: Boolean(run.progressWriterConflict),
      evidence: (report.evidence || []).slice(-40),
    };
  });
  return { bundleVersion: 2, identity, receipt, capture, agent, commands, runs, lifecycle, stop,
    providerLedger, recording, quality, infrastructure, goal, builtAt: new Date().toISOString() };
}
