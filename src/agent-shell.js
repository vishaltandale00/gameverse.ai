// App-shell integration for voice-triggered takeover. This is the only place
// that knows about both the running app (sessions, adapters, controllers, saves)
// and the host/agent/harness modules. It keeps execution sessions alive across
// view changes, dispatches retained one-shot transcripts to the voice agent and
// exposes a Stop path that never waits for a model response.
import { AgentHost } from './agent-host.js';
import { SportsControlSurface } from './sports-control-surface.js';
import { OverworldCharacterSurface, SpectatorCameraSurface } from './overworld-control-surface.js';
import { SimulatedUser } from './simulated-user.js';
import { VoiceAgent } from './voice-agent.js';

export const SHELL_VERSION = 'agent-shell-v1';

export function createTakeoverShell({
  // Supplied by the app shell: how to open a subgame session for the agent, how
  // to describe the displayed view, and how to show acknowledgments/status.
  openSubgame, openOverworld = null, describeDisplayed = () => null, render = () => {}, harnessConfig = {},
  decisions, reflector, speech = null, plan, now = () => Date.now(), log = () => {}, limits = {},
} = {}) {
  const host = new AgentHost({ now, log, limits });
  const runner = ({ grant, run, finish }) => new SimulatedUser({
    grant, goal: run.goal, role: run.role, config: harnessConfig, decisions, reflector, speech, now, log,
    finish: (outcome, detail) => finish(outcome, detail),
  }).start();
  const agent = new VoiceAgent({ host, plan, runner, now, log });
  const state = { lastAcknowledgment: null, lastRequestId: null, pending: false };

  // Registering a live subgame runtime. `handle` is CustomSportsAdapter.controlHandle().
  function registerSportsSession({ handle, identity = {}, progressKey, displayed = true, origin = null, dispose }) {
    const surface = new SportsControlSurface({ match: handle, team: 0, now });
    const session = host.registerSession({ gameId: handle.gameId, version: handle.version, identity, progressKey, displayed, origin,
      surfaces: [surface] });
    runtimes.set(session.sessionId, { handle, dispose, kind: 'sports' });
    return session;
  }
  function registerOverworldSession({ controller, world, identity = {}, progressKey, displayed = true, simulation = null, hold = null }) {
    const character = new OverworldCharacterSurface({ controller, world, now, simulation });
    const session = host.registerSession({ gameId: 'overworld', version: '1', identity, progressKey, displayed,
      surfaces: [character, new SpectatorCameraSurface({ controller, now })] });
    runtimes.set(session.sessionId, { controller, character, hold, kind: 'overworld' });
    return session;
  }
  const runtimes = new Map();

  // The host asks the app to open a target when a command needs one. The app
  // decides how (fresh match, saved checkpoint), then registers the result.
  // The app may only return a session for the target that was asked for; a
  // mismatched runtime handle must fail loudly instead of binding a run to the
  // wrong game, version or progress record.
  const opener = async context => {
    const opened = await openSubgame({ ...context, register: registerSportsSession });
    const session = host.describeSession(typeof opened === 'string' ? opened : opened.sessionId);
    if (session.gameId !== context.gameId) throw Error(`The app opened '${session.gameId}' for a '${context.gameId}' request.`);
    if (context.version && session.version !== context.version) throw Error(`The app opened ${session.gameId} ${session.version}, not ${context.version}.`);
    return session;
  };
  host.registerOpener('soccer', opener);
  host.registerOpener('football', opener);
  // Overworld takeover: the character surface is grantable, the spectator camera
  // stays human-only, so the human keeps independent camera control.
  host.registerOpener('overworld', context => {
    const existing = host.listSessions({ gameId: 'overworld' }).find(session => session.state === 'running');
    if (existing && context.selection === 'new') throw Error('An overworld session is already open. Reuse it or close it before creating a new one.');
    if (existing) return existing;
    if (!openOverworld) throw Error('The overworld is not open, so it cannot be taken over yet.');
    return openOverworld({ ...context, register: registerOverworldSession });
  });

  // Engine clock samples, tagged with whether a policy request was outstanding.
  const samples = new Map();
  const sampleClocks = () => {
    for (const run of host.listRuns({ state: 'running' })) {
      const runtime = host.runs.get(run.runId);
      const clock = runtime?.grant?.clock?.();
      if (!clock) continue;
      const list = samples.get(run.runId) || [];
      list.push({ frame: clock.frame ?? null, matchClockSeconds: clock.matchClockSeconds ?? null,
        simulationMs: clock.simulationMs ?? null, wallMs: clock.wallMs, source: clock.source || null,
        decisionOutstanding: Boolean(runtime.harness?.pending), reflecting: Boolean(runtime.harness?.reflecting),
        displayed: run.displayed });
      if (list.length > 400) list.shift();
      samples.set(run.runId, list);
    }
  };

  // Control hold/release is what keeps a match stepping in the background and
  // what stops it stepping once nobody owns it.
  const syncHold = () => {
    for (const [sessionId, runtime] of runtimes) {
      const held = host.listRuns({ sessionId, state: 'running' }).length > 0;
      if (runtime.kind === 'sports') runtime.handle.hold?.(held);
      else {
        // A controlled character keeps executing while the human looks at another
        // view; releasing restores ordinary hidden-view suspension.
        runtime.hold?.(held);
        if (!held) runtime.character.releaseToHuman();
      }
      runtime.held = held;
    }
  };
  const observe = () => {
    const sessions = host.listSessions(), runs = host.listRuns();
    return { sessions, runs, running: runs.filter(run => run.state === 'running'), acknowledgment: state.lastAcknowledgment, pending: state.pending };
  };
  const publish = () => { syncHold(); render(observe()); };

  const wrapped = ['startRun', 'stopRun', 'finishRun', 'setDisplayed', 'closeSession'];
  for (const method of wrapped) {
    const original = host[method].bind(host);
    host[method] = (...args) => { const result = original(...args); publish(); return result; };
  }

  return {
    version: SHELL_VERSION, host, agent, observe,
    remoteStatus({pending,acknowledgment}={}) {if(pending!==undefined)state.pending=pending;if(acknowledgment!==undefined)state.lastAcknowledgment=acknowledgment;publish();},
    registerSportsSession, registerOverworldSession,
    // A displayed-view change must never dispose a session that a run owns.
    setDisplayed: (sessionId, displayed) => host.setDisplayed(sessionId, displayed),
    heldBy: sessionId => host.listRuns({ sessionId, state: 'running' }).map(run => run.runId),
    // True when the app may dispose this runtime on leave.
    disposable: sessionId => host.listRuns({ sessionId, state: 'running' }).length === 0,
    noteHumanInput: (sessionId, detail) => host.noteHumanInput(sessionId, detail),
    // Visible Stop. Synchronous host call: it does not await the planner, a
    // decision or a reflection, and it only touches the selected run.
    stop(runId, reason = 'player pressed Stop') {
      const status = host.stopRun(runId, { reason });
      state.lastAcknowledgment = `Stopped ${runId}. Controls are back with you.`;
      publish();
      return status;
    },
    stopAll(reason = 'player stopped every run') {
      const stopped = host.listRuns({ state: 'running' }).map(run => host.stopRun(run.runId, { reason }));
      state.lastAcknowledgment = stopped.length ? `Stopped ${stopped.length} simulated ${stopped.length === 1 ? 'user' : 'users'}.` : 'No simulated user was running.';
      publish();
      return stopped;
    },
    // One retained transcript in, one text acknowledgment out.
    async handleTranscript({ requestId, text, context }) {
      state.pending = true; state.lastRequestId = requestId; publish();
      try {
        const record = await agent.handle({ requestId, transcript: text, context: { ...context, ...describeDisplayed() } });
        state.lastAcknowledgment = record.acknowledgment;
        return record;
      } catch (error) {
        state.lastAcknowledgment = `The voice agent failed: ${error.message}`;
        return { requestId, outcome: 'failed', acknowledgment: state.lastAcknowledgment, toolCalls: [], runs: [] };
      } finally { state.pending = false; publish(); }
    },
    // Called from the app's own animation/update loop, once per frame. Game
    // clocks are never blocked: tick only schedules the harness's own work.
    clockSamples: runId => (samples.get(runId) || []).slice(),
    tick(nowMs = now()) {
      sampleClocks();
      for (const run of host.listRuns({ state: 'running' })) {
        const harness = host.runs.get(run.runId)?.harness;
        try { harness?.tick?.(nowMs); } catch (error) { log({ event: 'harness-tick-failed', runId: run.runId, message: error.message }); }
      }
    },
    // Plain-text status for the shell UI; no model call involved.
    statusText() {
      const runs = host.listRuns({ state: 'running' });
      if (!runs.length) return 'No simulated user is running.';
      return runs.map(run => {
        const report = run.report;
        const latency = report?.usage?.decisionLatencyMs;
        return `${run.gameId} · ${run.surface} · ${run.actions} actions`
          + `${report ? ` · ${report.usage.decisions} decisions${latency ? ` (mean ${latency.meanMs} ms)` : ''}${report.usage.stale ? `, ${report.usage.stale} stale discarded` : ''}` : ''}`
          + `${run.displayed === false ? ' · running in the background' : ''}`;
      }).join('\n');
    },
  };
}
