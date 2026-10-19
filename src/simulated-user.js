// Versioned simulated-user harness. Everything about WHEN a decision is asked
// for, how long an action may run, what happens while a request is outstanding,
// which responses are too stale to use, when a reflection runs and what a
// requester says belongs here -- never to the engine or the host. The engine
// only supplies observations, clocks, validated controls and safe idle; the host
// only grants and revokes control.
export const HARNESS_VERSION = 'simulated-user-harness-v2';

// Decision circuits pick which policy answers the current observation. A cheap
// built-in circuit answers menu phases locally, so there is no model call per
// tick and no mandated request cadence.
export const DEFAULT_CIRCUITS = [
  { name: 'menu-confirm', when: observation => observation.menu === true, policy: 'builtin',
    action: () => ({ type: 'confirm', durationMs: 120, reason: 'menu phase accepts confirm only' }) },
  { name: 'attack', when: observation => observation.possession === 'us', policy: 'decisions', intent: 'advance and create a shooting chance' },
  { name: 'chase', when: observation => observation.possession !== 'us', policy: 'decisions', intent: 'win the ball back, then attack' },
];

export const DEFAULT_CONFIG = {
  version: HARNESS_VERSION,
  // Reflections advise a takeover; only an explicit goal mode may end it.
  completionPolicy: 'explicit-stop',
  decisionIntervalMs: 420,      // soonest a new Decisions request may be issued
  actionDurationMs: 700,        // default bounded lifetime of one accepted action
  maxActionDurationMs: 1600,
  staleAfterMs: 1400,           // a response older than this is discarded unused
  reflectionIntervalMs: 7000,
  maxDecisions: 120, maxReflections: 6, maxConsecutiveFailures: 4, maxWallMs: 180000,
  circuits: DEFAULT_CIRCUITS,
};

const nowDefault = () => Date.now();

export class SimulatedUser {
  constructor({ grant, goal = '', role = 'gameplay', config = {}, decisions, reflector = null, speech = null,
    finish = () => {}, now = nowDefault, log = () => {} } = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config, circuits: config.circuits || DEFAULT_CONFIG.circuits };
    Object.assign(this, { grant, goal, role, decisions, reflector, speech, finish, now, log });
    this.version = this.config.version || HARNESS_VERSION;
    this.state = 'idle'; this.seq = 0; this.accepted = 0; this.pending = null; this.current = null;
    this.memory = { runId: grant.runId, goal, role, notes: [], reflections: [], recentActions: [] };
    this.usage = { decisions: 0, decisionFailures: 0, stale: 0, reflections: 0, reflectionFailures: 0,
      actions: 0, rejectedActions: 0, idleFallbacks: 0, speech: 0, decisionLatencyMs: [], tokens: 0 };
    this.startedAt = null; this.evidence = []; this.trimmed = 0;
  }
  start() { this.state = 'running'; this.startedAt = this.now(); this.record('start', { goal: this.goal, role: this.role, harness: this.version }); return this; }
  stop({ reason = 'stopped', outcome = 'stopped' } = {}) {
    if (this.state !== 'running') return this.report();
    this.state = 'stopped'; this.stoppedAt = this.now();
    // Invalidate every outstanding decision/reflection before dropping control.
    this.pending = null; this.current = null; this.abandonedAt = this.seq;
    this.record('stop', { reason, outcome });
    return this.report();
  }
  record(event, detail = {}) {
    const entry = { event, at: this.now(), seq: this.seq, ...detail };
    this.evidence.push(entry);
    if (this.evidence.length > 500) { this.evidence.shift(); this.trimmed = (this.trimmed || 0) + 1; }
    this.log({ harness: this.version, role: this.role, ...entry });
    return entry;
  }

  // One non-blocking step, driven by the engine's own clock. It never awaits a
  // policy call: game time keeps running while a request is outstanding.
  tick(nowMs = this.now()) {
    if (this.state !== 'running') return { state: this.state };
    if (!this.grant.valid()) { this.state = 'released'; this.record('control-lost', {}); return { state: this.state }; }
    if (nowMs - this.startedAt > this.config.maxWallMs) { this.conclude('limit', 'wall-time limit reached'); return { state: this.state }; }
    if (this.usage.decisionFailures >= this.config.maxConsecutiveFailures && !this.current) { this.conclude('failed', 'policy requests kept failing'); return { state: this.state }; }

    let observation = null;
    try { observation = this.grant.observe(); }
    catch { this.state = 'released'; this.record('control-lost', {}); return { state: this.state }; }

    const circuit = this.config.circuits.find(entry => { try { return entry.when(observation, this.memory); } catch { return false; } }) || null;
    this.maybeReflect(nowMs, observation);

    // 1. A still-valid bounded action keeps running.
    if (this.current && nowMs < this.current.expiresAt && this.surfaceAccepts(this.current.action)) {
      // `release` is set by adopt() for charged actions; the harness releases the
      // held button inside the action's own bounded duration so the shot fires.
      if (this.current.release && nowMs >= this.current.releaseAt && !this.current.released) {
        const released = this.dispatch({ type: 'release' }, 'release', nowMs);
        if (released.ok) this.current.released = true;
      }
      this.maybeRequest(nowMs, observation, circuit);
      return { state: 'acting', action: this.current.action.type, circuit: this.current.circuit };
    }
    // 2. Its bounded lifetime ended (or it stopped being valid): hand back safe
    //    idle and wait for fresh input rather than extending a stale choice.
    if (this.current) {
      this.record('action-expired', { action: this.current.action.type, circuit: this.current.circuit, ageMs: nowMs - this.current.startedAt });
      this.current = null; this.safeIdle('action-expired');
    }
    // 3. A local built-in circuit may answer immediately without a model call.
    if (circuit?.policy === 'builtin') {
      const action = circuit.action(observation, this.memory);
      if (action) { this.adopt(action, circuit.name, nowMs, 'builtin'); return { state: 'acting', action: action.type, circuit: circuit.name }; }
    }
    this.maybeRequest(nowMs, observation, circuit);
    if (!this.idling) this.safeIdle('awaiting-decision');
    return { state: 'awaiting-decision', pending: Boolean(this.pending), circuit: circuit?.name || null };
  }
  surfaceAccepts(action) {
    const surface = this.grant.capabilities;
    if (surface?.actions && !surface.actions[action.type]) return false;
    return true;
  }
  safeIdle(reason) {
    try { this.grant.idle(); this.idling = true; this.usage.idleFallbacks++; this.record('safe-idle', { reason }); }
    catch (error) { this.record('safe-idle-failed', { reason, message: error.message }); }
  }
  // Asynchronous Decisions request. Responses are matched by sequence and age.
  maybeRequest(nowMs, observation, circuit) {
    if (this.pending || !circuit || circuit.policy === 'builtin') return;
    if (this.lastRequestAt && nowMs - this.lastRequestAt < this.config.decisionIntervalMs) return;
    if (this.usage.decisions >= this.config.maxDecisions) { if (!this.current) this.conclude('limit', 'decision budget exhausted'); return; }
    const seq = ++this.seq, issuedAt = nowMs;
    this.lastRequestAt = nowMs; this.usage.decisions++;
    this.pending = { seq, issuedAt, circuit: circuit.name };
    this.record('decision-requested', { circuit: circuit.name, intent: circuit.intent || null, clock: this.grant.clock() });
    Promise.resolve()
      .then(() => this.decisions({ observation, goal: this.goal, intent: circuit.intent, memory: this.memory, capabilities: this.grant.capabilities, seq }))
      .then(response => this.accept(response, seq, issuedAt, circuit.name))
      .catch(error => {
        if (this.pending?.seq === seq) this.pending = null;
        this.usage.decisionFailures++; this.record('decision-failed', { seq, message: error.message, circuit: circuit.name });
      });
  }
  // Freshness and ordering are the harness's rules, not the engine's.
  accept(response, seq, issuedAt, circuitName) {
    const arrivedAt = this.now(), latency = arrivedAt - issuedAt;
    this.usage.decisionLatencyMs.push(latency);
    if (response?.usage?.tokens) this.usage.tokens += response.usage.tokens;
    if (this.pending?.seq === seq) this.pending = null;
    const released = this.state !== 'running' || !this.grant.valid();
    if (released || seq <= (this.abandonedAt || 0) || seq < this.acceptedSeq || latency > this.config.staleAfterMs) {
      this.usage.stale++;
      this.record('decision-discarded', { seq, latencyMs: latency, reason: released ? 'run-released' : latency > this.config.staleAfterMs ? 'stale' : 'superseded' });
      return null;
    }
    this.usage.decisionFailures = 0; this.acceptedSeq = seq;
    const action = response?.action || response;
    if (!action?.type) { this.record('decision-unusable', { seq, latencyMs: latency }); return null; }
    this.record('decision-accepted', { seq, latencyMs: latency, action: action.type, circuit: circuitName, provider: response?.provider || null, model: response?.model || null });
    this.adopt(action, circuitName, arrivedAt, 'decisions', latency);
    return action;
  }
  adopt(action, circuitName, nowMs, policy, latencyMs = null) {
    const charged = this.grant.capabilities?.actions?.[action.type]?.kind === 'charged';
    // A charged action may declare a shorter lifetime than ordinary movement:
    // holding a shot for seconds just invites a tackle before the strike.
    const configured = charged && Number.isFinite(this.config.chargedActionDurationMs)
      ? this.config.chargedActionDurationMs : this.config.actionDurationMs;
    const duration = Math.min(this.config.maxActionDurationMs, Math.max(80, Number(action.durationMs) || configured));
    // Choosing the same charged action again CONTINUES the existing hold on its
    // original schedule. Restarting the schedule on every fresh decision would
    // push the release past the hold window forever, so the shot would never
    // strike and expiry safe-idle would cancel the charge instead.
    const continuing = charged && this.current?.release && !this.current.released && this.current.action.type === action.type;
    if (continuing) {
      this.current.action = { ...this.current.action, ...action };
      this.current.circuit = circuitName; this.current.policy = policy; this.current.latencyMs = latencyMs;
      this.record('charge-continued', { action: action.type, heldMs: nowMs - this.current.startedAt, releaseInMs: this.current.releaseAt - nowMs });
      const kept = this.dispatch(this.current.action, policy, nowMs);
      if (!kept.ok) { this.current = null; this.safeIdle('action-rejected'); }
      return kept;
    }
    this.current = { action, circuit: circuitName, policy, startedAt: nowMs, expiresAt: nowMs + duration,
      release: charged, releaseAt: nowMs + duration * 0.7, released: false, latencyMs };
    this.accepted++;
    const result = this.dispatch(action, policy, nowMs);
    if (!result.ok) { this.current = null; this.safeIdle('action-rejected'); }
    if (action.type === 'speech') this.say(action, nowMs);
    // A circuit may declare its work finished (used by the requester role after
    // its utterance has actually been captured by the app).
    if (action.finishRequester) this.conclude('completed', 'the spoken command was captured by the app');
    this.memory.recentActions.push({ type: action.type, circuit: circuitName, at: nowMs, ok: result.ok });
    if (this.memory.recentActions.length > 24) this.memory.recentActions.shift();
    return result;
  }
  dispatch(action, policy, nowMs) {
    if (action.type === 'speech') return { ok: true, speech: true };
    try {
      const outcome = this.grant.apply(action);
      this.usage.actions++; this.idling = false;
      if (action.type === 'release' && this.current) this.current.released = true;
      this.record('action-dispatched', { action: action.type, direction: action.direction || null, policy, outcome, clock: this.grant.clock() });
      return { ok: true, outcome };
    } catch (error) {
      this.usage.rejectedActions++;
      this.record('action-rejected', { action: action.type, policy, message: error.message, code: error.code || null });
      return { ok: false, message: error.message };
    }
  }
  // Requester role: the same harness, a different goal/authority/evidence set.
  // Speech emits real audio for the ordinary voice-input path; the harness never
  // short-circuits straight to a gameplay tool.
  say(action, nowMs = this.now()) {
    if (!this.speech) { this.record('speech-unavailable', { text: action.text || null }); return null; }
    const text = String(action.text || '').trim();
    if (!text) { this.record('speech-empty', {}); return null; }
    this.usage.speech++;
    const promise = Promise.resolve()
      .then(() => this.speech({ text, voice: action.voice || null, runId: this.grant.runId, requestedAt: nowMs }))
      .then(result => { this.record('speech-emitted', { text, mime: result?.mime || null, bytes: result?.audio?.byteLength ?? result?.bytes ?? null, requestId: result?.requestId || null }); return result; })
      .catch(error => { this.record('speech-failed', { text, message: error.message }); return null; });
    return promise;
  }
  // Reflections are asynchronous and never gate a tick or an action.
  maybeReflect(nowMs, observation) {
    if (!this.reflector || this.reflecting) return;
    if (this.usage.reflections >= this.config.maxReflections) return;
    if (this.lastReflectionAt && nowMs - this.lastReflectionAt < this.config.reflectionIntervalMs) return;
    if (!this.lastReflectionAt && nowMs - this.startedAt < this.config.reflectionIntervalMs) return;
    this.reflecting = true; this.lastReflectionAt = nowMs; this.usage.reflections++;
    const seq = this.seq;
    this.record('reflection-requested', { seq });
    Promise.resolve()
      .then(() => this.reflector({ observation, memory: this.memory, goal: this.goal, usage: this.usage, seq }))
      .then(result => {
        this.reflecting = false;
        if (this.state !== 'running') { this.record('reflection-discarded', { seq, reason: 'run-released' }); return; }
        if (result?.usage?.tokens) this.usage.tokens += result.usage.tokens;
        const note = typeof result === 'string' ? result : result?.note;
        if (note) { this.memory.reflections.push({ note, at: this.now(), seq }); if (this.memory.reflections.length > 8) this.memory.reflections.shift(); }
        if (result?.goalReached) {
          this.record('goal-reported', { completionPolicy: this.config.completionPolicy, note: note || null });
          if (this.config.completionPolicy === 'goal') this.conclude('goal-reached', note || 'reflection reported the goal was reached');
        }
        this.record('reflection-applied', { seq, note: note || null, model: result?.model || null });
      })
      .catch(error => { this.reflecting = false; this.usage.reflectionFailures++; this.record('reflection-failed', { seq, message: error.message }); });
  }
  // Truthful finish: goal, finite limit or failure. Release goes through the host.
  conclude(outcome, detail) {
    if (this.state !== 'running') return;
    this.state = outcome === 'goal-reached' ? 'completed' : outcome;
    this.current = null; this.pending = null; this.abandonedAt = this.seq;
    this.record('concluded', { outcome, detail });
    try { this.finish(outcome, detail); } catch (error) { this.record('finish-failed', { message: error.message }); }
  }
  report() {
    const latencies = this.usage.decisionLatencyMs;
    const dispatches = this.evidence.filter(entry => entry.event === 'action-dispatched')
      .map(entry => ({ accepted: true, action: entry.action, direction: entry.direction ?? null, policy: entry.policy ?? null,
        at: entry.at, frame: entry.clock?.frame ?? null, simulationMs: entry.clock?.simulationMs ?? null }));
    return {
      harness: this.version, role: this.role, goal: this.goal, state: this.state,
      startedAt: this.startedAt, stoppedAt: this.stoppedAt || null,
      config: { completionPolicy: this.config.completionPolicy, decisionIntervalMs: this.config.decisionIntervalMs, actionDurationMs: this.config.actionDurationMs,
        chargedActionDurationMs: this.config.chargedActionDurationMs ?? null,
        staleAfterMs: this.config.staleAfterMs, reflectionIntervalMs: this.config.reflectionIntervalMs,
        maxDecisions: this.config.maxDecisions, maxReflections: this.config.maxReflections,
        circuits: this.config.circuits.map(circuit => ({ name: circuit.name, policy: circuit.policy })) },
      usage: { ...this.usage, decisionLatencyMs: latencies.length ? { count: latencies.length, meanMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length), maxMs: Math.max(...latencies) } : null },
      memory: { reflections: this.memory.reflections.slice(-3), recentActions: this.memory.recentActions.slice(-6) },
      // Complete dispatch log (bounded) with an explicit window, so a consumer
      // can compare counts honestly instead of assuming the log is lifetime.
      actionLog: dispatches.slice(-200),
      actionLogWindow: { retained: Math.min(dispatches.length, 200), logged: dispatches.length,
        lifetimeActions: this.usage.actions, complete: dispatches.length <= 200 && dispatches.length === this.usage.actions,
        evidenceTrimmed: this.trimmed > 0 },
      chargeEvents: this.evidence.filter(entry => ['charge-continued', 'action-expired', 'safe-idle'].includes(entry.event)).slice(-60),
      evidence: this.evidence.slice(-40),
    };
  }
}

// Runner factory for AgentHost.startRun: the host starts and stops this without
// knowing anything inside it.
export const simulatedUserRunner = options => ({ grant, run, finish }) => {
  const harness = new SimulatedUser({ ...options, grant, goal: run.goal, role: run.role, finish: (outcome, detail) => finish(outcome, detail) });
  return harness.start();
};
