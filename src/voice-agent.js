// One-shot voice agent. A retained transcript goes to a planner (model-backed in
// the app, injected here) which answers with host tool calls. The agent executes
// them against the real host tools and returns a TEXT acknowledgment only: no
// spoken reply and no conversational turn-taking in this slice.
export const VOICE_AGENT_VERSION = 'voice-agent-v1';

const text = value => typeof value === 'string' && value.trim().length > 0;

// Tool surface the planner is allowed to call. Every call must resolve to an
// explicit host-authorized session and control scope; there is no universal
// create-versus-reuse default -- the planner states its selection intent.
export const TOOL_CATALOG = {
  list_games: { description: 'List supported takeover targets.', args: {} },
  list_sessions: { description: 'List live execution sessions, their control slots and runs.', args: { gameId: 'string?' } },
  open_session: { description: 'Resolve one authorized session. selection: auto | reuse | new | exact.',
    args: { gameId: 'string', version: 'string?', selection: 'string?', sessionId: 'string?' } },
  start_simulated_user: { description: 'Start one simulated user bound to one session, surface and goal.',
    args: { sessionId: 'string', surface: 'string?', goal: 'string', role: 'string?', fromPreviousSession: 'boolean?' } },
  run_status: { description: 'Status of one run, or all runs.', args: { runId: 'string?' } },
  stop_run: { description: 'Explicitly stop one run and release its controls.', args: { runId: 'string', reason: 'string?' } },
};

export class VoiceAgent {
  constructor({ host, plan, runner, now = () => Date.now(), log = () => {}, maxToolCalls = 8 } = {}) {
    Object.assign(this, { host, plan, runner, now, log, maxToolCalls });
    this.version = VOICE_AGENT_VERSION; this.history = [];
  }
  // Called with the retained transcript for one voice request. One command may
  // produce several tool calls and start several runs.
  async handle({ requestId, transcript, context = {}, signal = null } = {}) {
    const startedAt = this.now();
    const record = { requestId, agent: this.version, transcript, context, startedAt, toolCalls: [], runs: [], outcome: 'failed', acknowledgment: '' };
    if (!text(transcript)) {
      record.outcome = 'rejected'; record.acknowledgment = 'No transcript was received, so nothing was started.';
      return this.finish(record);
    }
    let planned;
    try {
      planned = await this.plan({ transcript, context, tools: TOOL_CATALOG, state: this.snapshot(context), requestId, signal });
    } catch (error) {
      record.outcome = 'planner-failed';
      record.acknowledgment = `The voice agent could not interpret that request: ${error.message}`;
      return this.finish(record);
    }
    const calls = Array.isArray(planned?.toolCalls) ? planned.toolCalls : [];
    record.planner = { model: planned?.model || null, provider: planned?.provider || null, usage: planned?.usage || null };
    if (!calls.length) {
      record.outcome = 'no-action';
      record.acknowledgment = planned?.say || 'That command did not map to a supported action.';
      return this.finish(record);
    }
    for (const call of calls.slice(0, this.maxToolCalls)) {
      const callStartedAt = this.now();
      const entry = { callId: `${requestId}:${record.toolCalls.length + 1}`, name: call?.name, args: call?.args || {}, startedAt: callStartedAt };
      try {
        entry.result = await this.invoke(call?.name, call?.args || {}, { requestId, context, lastSessionId: record.lastSessionId || null });
        if (entry.result?.sessionId) record.lastSessionId = entry.result.sessionId;
        entry.ok = true;
        if (entry.result?.runId && call.name === 'start_simulated_user') record.runs.push(entry.result);
      } catch (error) { entry.ok = false; entry.error = { message: error.message, code: error.code || null }; }
      entry.wallMs = this.now() - callStartedAt;
      record.toolCalls.push(entry);
      if (!entry.ok && call?.stopOnError !== false) break;
    }
    const failed = record.toolCalls.filter(call => !call.ok);
    record.outcome = failed.length === 0 ? 'completed' : record.toolCalls.some(call => call.ok) ? 'partial' : 'failed';
    record.acknowledgment = planned?.say ? `${planned.say.trim()} ${this.summarize(record)}`.trim() : this.summarize(record);
    return this.finish(record);
  }
  snapshot(context) {
    return {
      displayed: context.gameId ? { gameId: context.gameId, role: context.role || null, sessionId: context.sessionId || null } : null,
      games: this.host.listGames().map(game => ({ gameId: game.gameId, version: game.version, name: game.name || game.gameId })),
      sessions: this.host.listSessions().map(session => ({ sessionId: session.sessionId, gameId: session.gameId, version: session.version,
        displayed: session.displayed, state: session.state, surfaces: session.surfaces.map(surface => ({ name: surface.name, humanOnly: surface.humanOnly, heldBy: surface.heldBy })) })),
      runs: this.host.listRuns({ state: 'running' }).map(run => ({ runId: run.runId, gameId: run.gameId, surface: run.surface, goal: run.goal, state: run.state })),
    };
  }
  async invoke(name, args, meta) {
    if (!Object.hasOwn(TOOL_CATALOG, name)) throw Object.assign(Error(`Unknown tool '${name}'.`), { code: 'unknown-tool' });
    const host = this.host;
    if (name === 'list_games') return { games: host.listGames() };
    if (name === 'list_sessions') return { sessions: host.listSessions({ gameId: args.gameId }) };
    if (name === 'open_session') {
      if (!text(args.gameId) && args.selection !== 'exact') throw Object.assign(Error('open_session needs a gameId.'), { code: 'invalid-args' });
      const session = await host.openSession({ gameId: args.gameId, version: args.version, selection: args.selection || 'auto', sessionId: args.sessionId, identity: args.identity || {} });
      return { sessionId: session.sessionId, gameId: session.gameId, version: session.version, reused: session.openedAt < meta.startedAt, surfaces: session.surfaces.map(surface => surface.name) };
    }
    if (name === 'start_simulated_user') {
      // A planner may chain on the session the previous call resolved.
      if (!text(args.sessionId) && args.fromPreviousSession && text(meta.lastSessionId)) args.sessionId = meta.lastSessionId;
      if (!text(args.sessionId)) throw Object.assign(Error('start_simulated_user needs a sessionId from open_session.'), { code: 'invalid-args' });
      if (!text(args.goal)) throw Object.assign(Error('start_simulated_user needs a goal.'), { code: 'invalid-args' });
      const session = host.describeSession(args.sessionId);
      const surface = args.surface || session.surfaces.find(entry => !entry.humanOnly)?.name;
      const status = await host.startRun({ sessionId: args.sessionId, surface, goal: args.goal, role: args.role || 'gameplay',
        requester: meta.requestId, runner: this.runner });
      return { runId: status.runId, sessionId: status.sessionId, gameId: status.gameId, surface: status.surface, goal: status.goal, state: status.state, harness: status.harness };
    }
    if (name === 'run_status') return args.runId ? host.runStatus(args.runId) : { runs: host.listRuns() };
    if (name === 'stop_run') {
      if (!text(args.runId)) throw Object.assign(Error('stop_run needs a runId.'), { code: 'invalid-args' });
      return host.stopRun(args.runId, { reason: args.reason || 'voice stop command' });
    }
    throw Object.assign(Error(`Tool '${name}' is not implemented.`), { code: 'unimplemented-tool' });
  }
  summarize(record) {
    const parts = [];
    for (const call of record.toolCalls) {
      if (!call.ok) { parts.push(`${call.name} failed: ${call.error.message}`); continue; }
      if (call.name === 'start_simulated_user') parts.push(`Started ${call.result.runId} on ${call.result.gameId} (${call.result.surface}): ${call.result.goal}.`);
      else if (call.name === 'stop_run') parts.push(`Stopped ${call.result.runId} (${call.result.outcome}); controls returned.`);
      else if (call.name === 'open_session') parts.push(`${call.result.reused ? 'Using' : 'Opened'} ${call.result.gameId} session ${call.result.sessionId}.`);
      else if (call.name === 'run_status' && call.result.runId) parts.push(`${call.result.runId}: ${call.result.state}, ${call.result.actions} actions.`);
      else if (call.name === 'run_status') parts.push(`${call.result.runs.filter(run => run.state === 'running').length} runs active.`);
    }
    return parts.join(' ') || 'No tool produced a result.';
  }
  finish(record) {
    record.wallMs = this.now() - record.startedAt;
    this.history.push(record); if (this.history.length > 50) this.history.shift();
    this.log({ operation: 'voice-agent', requestId: record.requestId, outcome: record.outcome, toolCalls: record.toolCalls.length,
      runs: record.runs.length, wallMs: record.wallMs, at: this.now() });
    return record;
  }
}
