// Host authority for simulated-user takeover. The host owns execution-session
// lifetime (independent of whichever view is displayed), exclusive control slots,
// exclusive progress writers, control grants and revocation. It deliberately
// knows nothing about decision schedules, reflections, freshness rules or
// prompts: those belong to the versioned harness. Engines expose surfaces; the
// harness consumes grants.
export const HOST_PROTOCOL_VERSION = 1;

const failure = (code, message) => Object.assign(Error(message), { code });
const id = prefix => `${prefix}_${(globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2)).replace(/-/g, '').slice(0, 12)}`;

export class AgentHost {
  constructor({ now = () => Date.now(), log = () => {}, limits = {} } = {}) {
    this.now = now; this.log = log;
    this.limits = { maxRuns: 4, maxRunsPerSession: 2, ...limits };
    this.sessions = new Map(); this.runs = new Map();
    this.openers = new Map(); this.catalog = new Map();
    this.writers = new Map(); // progressKey -> runId
  }

  // --- supported targets and session discovery -------------------------------
  registerGame(entry) {
    if (!entry?.gameId || !entry.version) throw failure('invalid-game', 'A game id and version are required.');
    this.catalog.set(entry.gameId, { kind: 'subgame', ...entry });
    return this.catalog.get(entry.gameId);
  }
  // `open` creates or attaches a live execution session for this game. The host
  // never decides create-versus-reuse on its own; see openSession().
  registerOpener(gameId, open) { this.openers.set(gameId, open); }
  listGames() { return [...this.catalog.values()].map(entry => ({ ...entry })); }
  listSessions(filter = {}) {
    return [...this.sessions.values()]
      .filter(session => (!filter.gameId || session.gameId === filter.gameId) && (!filter.state || session.state === filter.state))
      .map(session => this.describeSession(session.sessionId));
  }
  describeSession(sessionId) {
    const session = this.session(sessionId);
    return {
      sessionId, gameId: session.gameId, version: session.version, identity: { ...session.identity },
      progressKey: session.progressKey, state: session.state, displayed: session.displayed, openedAt: session.openedAt,
      surfaces: [...session.surfaces.values()].map(surface => ({
        name: surface.name, kind: surface.kind, humanOnly: Boolean(surface.humanOnly), writesProgress: Boolean(surface.writesProgress),
        heldBy: this.slots.get(`${sessionId}/${surface.name}`) || null, capabilities: surface.capabilities,
      })),
      runs: [...session.runIds].map(runId => this.runStatus(runId)),
      clock: session.surfaces.size ? [...session.surfaces.values()][0].clock?.() ?? null : null,
    };
  }
  session(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw failure('unknown-session', `No host-authorized session ${sessionId}.`);
    return session;
  }
  get slots() { return (this._slots ||= new Map()); }

  // Called by the app when it has actually started an execution session. The
  // session outlives any view change; `displayed` only records what the human sees.
  registerSession({ sessionId = id('ses'), gameId, version, identity = {}, progressKey, surfaces = [], displayed = true, origin = null }) {
    if (!gameId || !version) throw failure('invalid-session', 'A session needs a game id and version.');
    if (this.sessions.has(sessionId)) throw failure('duplicate-session', `Session ${sessionId} is already registered.`);
    const session = {
      sessionId, gameId, version, identity, origin, displayed,
      progressKey: progressKey || `${gameId}:${version}:${identity.profileId || 'local'}`,
      state: 'running', openedAt: this.now(), surfaces: new Map(), runIds: new Set(),
    };
    for (const surface of surfaces) this.addSurface(session, surface);
    this.sessions.set(sessionId, session);
    this.log({ event: 'session-registered', sessionId, gameId, version, progressKey: session.progressKey, at: session.openedAt });
    return this.describeSession(sessionId);
  }
  addSurface(session, surface) {
    if (!surface?.name || typeof surface.observe !== 'function' || typeof surface.apply !== 'function' || typeof surface.safeIdle !== 'function') {
      throw failure('invalid-surface', 'A control surface needs name, observe, apply and safeIdle.');
    }
    session.surfaces.set(surface.name, surface);
  }
  // Session selection is context dependent: the caller states its intent and the
  // host resolves it to exactly one authorized session, or refuses truthfully.
  async openSession({ gameId, version, identity = {}, selection = 'auto', sessionId = null } = {}) {
    if (!['auto', 'reuse', 'new', 'exact'].includes(selection)) throw failure('invalid-selection', `Unknown session selection '${selection}'.`);
    if (selection === 'exact') return this.describeSession(sessionId);
    const entry = this.catalog.get(gameId);
    if (!entry) throw failure('unsupported-game', `Game '${gameId}' is not a supported target.`);
    const wanted = version || entry.version;
    const existing = this.listSessions({ gameId }).filter(session => session.state === 'running' && (!version || session.version === wanted));
    if (selection === 'reuse') {
      if (!existing.length) throw failure('no-session', `No running ${gameId} session is available to reuse.`);
      return existing[0];
    }
    if (selection === 'auto' && existing.length) return existing[0];
    const open = this.openers.get(gameId);
    if (!open) throw failure('cannot-open', `Opening '${gameId}' is not supported in this build.`);
    const opened = await open({ gameId, version: wanted, identity, selection, host: this });
    return this.describeSession(typeof opened === 'string' ? opened : opened.sessionId);
  }
  // Views change without touching execution. Leaving soccer for the overworld
  // keeps its session, grants and runs exactly as they are.
  setDisplayed(sessionId, displayed) {
    const session = this.session(sessionId); session.displayed = Boolean(displayed);
    this.log({ event: 'session-displayed', sessionId, displayed: session.displayed, at: this.now() });
    return this.describeSession(sessionId);
  }
  // Ordinary human gameplay/camera input is recorded, never a reclaim signal.
  noteHumanInput(sessionId, detail = {}) {
    const session = this.session(sessionId);
    this.log({ event: 'human-input', sessionId, reclaimed: false, ...detail, at: this.now() });
    return { reclaimed: false, runs: [...session.runIds] };
  }

  // --- control grants --------------------------------------------------------
  grantControl({ sessionId, surface: surfaceName, runId, requester = null }) {
    const session = this.session(sessionId);
    const surface = session.surfaces.get(surfaceName);
    if (!surface) throw failure('unknown-surface', `Session ${sessionId} has no '${surfaceName}' control surface.`);
    if (surface.humanOnly) throw failure('human-only-surface', `'${surfaceName}' stays with the human and cannot be granted to a run.`);
    const slot = `${sessionId}/${surfaceName}`;
    const holder = this.slots.get(slot);
    if (holder && this.runs.get(holder)?.state === 'running') throw failure('slot-busy', `Run ${holder} already controls ${slot}.`);
    if (surface.writesProgress) {
      const writer = this.writers.get(session.progressKey);
      if (writer && writer !== runId && this.runs.get(writer)?.state === 'running') {
        throw failure('progress-writer-busy', `Run ${writer} is the only authorized writer of ${session.progressKey}.`);
      }
      this.writers.set(session.progressKey, runId);
    }
    this.slots.set(slot, runId);
    const run = this.runs.get(runId);
    const epoch = run.epoch;
    const live = () => {
      const current = this.runs.get(runId);
      if (!current || current.state !== 'running' || current.epoch !== epoch) {
        throw failure('control-revoked', `Control of ${slot} was released; this result is rejected.`);
      }
      return current;
    };
    this.log({ event: 'control-granted', runId, slot, requester, epoch, at: this.now() });
    return {
      runId, sessionId, surface: surfaceName, epoch, protocol: HOST_PROTOCOL_VERSION,
      capabilities: surface.capabilities, progressKey: session.progressKey,
      observe: () => { live(); return surface.observe(); },
      clock: () => surface.clock?.() ?? null,
      valid: () => { try { live(); return true; } catch { return false; } },
      // Validation and dispatch are engine concerns; the host only enforces that
      // the caller still owns the slot and that late results cannot mutate it.
      apply: action => { const current = live(); current.actions++; current.lastActionAt = this.now(); return surface.apply(action); },
      idle: () => { live(); return surface.safeIdle(); },
    };
  }

  // --- runs ------------------------------------------------------------------
  // `runner` is supplied by the harness workstream: the host starts/stops it but
  // never inspects its policy, schedule or prompts.
  startRun({ sessionId, surface = 'default', goal = '', role = 'gameplay', runner, requester = null, limits = {} }) {
    const session = this.session(sessionId);
    if (session.state !== 'running') throw failure('session-not-running', `Session ${sessionId} is ${session.state}.`);
    const active = [...this.runs.values()].filter(run => run.state === 'running');
    if (active.length >= this.limits.maxRuns) throw failure('run-limit', `The host allows ${this.limits.maxRuns} concurrent simulated users.`);
    if (active.filter(run => run.sessionId === sessionId).length >= this.limits.maxRunsPerSession) {
      throw failure('run-limit', `Session ${sessionId} already has ${this.limits.maxRunsPerSession} runs.`);
    }
    const runId = id('run');
    const run = {
      runId, sessionId, surface, goal, role, requester, state: 'running', epoch: 1,
      startedAt: this.now(), endedAt: null, outcome: null, detail: null, actions: 0, lastActionAt: null,
      limits: { ...limits }, harness: null,
    };
    this.runs.set(runId, run); session.runIds.add(runId);
    let grant;
    try { grant = this.grantControl({ sessionId, surface, runId, requester }); }
    catch (error) { this.runs.delete(runId); session.runIds.delete(runId); throw error; }
    run.grant = grant;
    run.harness = runner?.({ grant, run: { runId, sessionId, goal, role, requester },
      finish: (outcome, detail) => this.finishRun(runId, outcome, detail) }) || null;
    run.version = run.harness?.version || null;
    this.log({ event: 'run-started', runId, sessionId, surface, role, goal, harness: run.version, at: run.startedAt });
    return this.runStatus(runId);
  }
  run(runId) {
    const run = this.runs.get(runId);
    if (!run) throw failure('unknown-run', `No run ${runId}.`);
    return run;
  }
  runStatus(runId) {
    const run = this.run(runId);
    const session = this.sessions.get(run.sessionId);
    return {
      runId, sessionId: run.sessionId, gameId: session?.gameId || null, version: session?.version || null,
      surface: run.surface, role: run.role, goal: run.goal, requester: run.requester, state: run.state,
      outcome: run.outcome, detail: run.detail, actions: run.actions, startedAt: run.startedAt, endedAt: run.endedAt,
      harness: run.version, epoch: run.epoch, displayed: session?.displayed ?? null,
      releaseReceipt: run.releaseReceipt || null, endedAtMs: run.endedAt,
      progressWriter: session ? this.writers.get(session.progressKey) === runId : false,
      report: run.harness?.report?.() ?? null,
    };
  }
  listRuns(filter = {}) {
    return [...this.runs.values()].filter(run => (!filter.state || run.state === filter.state) && (!filter.sessionId || run.sessionId === filter.sessionId))
      .map(run => this.runStatus(run.runId));
  }
  // Explicit Stop. Releases exactly the selected run: it never touches another
  // run's slot, and it clears held input through the engine's safe-idle path
  // before dropping the grant so a charged action cannot fire on release.
  stopRun(runId, { reason = 'explicit-stop', outcome = 'stopped' } = {}) {
    const run = this.run(runId);
    if (run.state !== 'running') return this.runStatus(runId);
    return this.release(run, outcome, reason);
  }
  // Truthful finish from the run itself: goal reached, limit hit or failure.
  finishRun(runId, outcome = 'completed', detail = null) {
    const run = this.run(runId);
    if (run.state !== 'running') return this.runStatus(runId);
    return this.release(run, outcome, detail);
  }
  release(run, outcome, detail) {
    const session = this.sessions.get(run.sessionId);
    const surface = session?.surfaces.get(run.surface);
    run.epoch++; // invalidates every outstanding result and late action immediately
    run.state = 'released'; run.outcome = outcome; run.detail = detail; run.endedAt = this.now();
    let idle = 'unavailable', idleResult = null;
    // Opaque evidence snapshot: the host records whether the runner had work
    // outstanding, without interpreting it. Policy stays in the harness.
    const harnessSnapshot = { pendingDecision: Boolean(run.harness?.pending), reflecting: Boolean(run.harness?.reflecting),
      heldAction: run.harness?.current?.action?.type ?? null };
    try { idleResult = surface?.safeIdle() ?? null; idle = 'cleared'; } catch (error) { idle = `failed: ${error.message}`; }
    run.releaseReceipt = { heldInput: idle, at: this.now(), epoch: run.epoch, surface: run.surface,
      surfaceResult: idleResult, surfaceHeld: surface?.held ?? null, harnessSnapshot, outcome, detail };
    try { run.harness?.stop?.({ reason: detail, outcome }); } catch (error) { this.log({ event: 'harness-stop-failed', runId: run.runId, message: error.message }); }
    this.slots.delete(`${run.sessionId}/${run.surface}`);
    if (session && this.writers.get(session.progressKey) === run.runId) this.writers.delete(session.progressKey);
    this.log({ event: 'run-released', runId: run.runId, outcome, detail, heldInput: idle, at: run.endedAt });
    return this.runStatus(run.runId);
  }
  // Session teardown is a host decision (app close, failure), not a view change.
  closeSession(sessionId, { reason = 'closed' } = {}) {
    const session = this.session(sessionId);
    for (const runId of [...session.runIds]) if (this.runs.get(runId)?.state === 'running') this.release(this.runs.get(runId), 'interrupted', reason);
    session.state = 'closed';
    this.log({ event: 'session-closed', sessionId, reason, at: this.now() });
    return this.describeSession(sessionId);
  }
}
