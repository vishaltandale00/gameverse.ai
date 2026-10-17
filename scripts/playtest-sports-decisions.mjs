// Bounded Decisions API CPU-vs-CPU match runner. No API call unless --live.
// Each tick asks one Decisions call per controller seat in parallel, then both
// controllers press raw buttons for 0.25 s through the real SportsInput.
// Official protocol: https://developers.openai.com/api/docs/guides/decisions
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { CONTROL_PROFILE, TICKS, DECISIONS_MODEL, observeSports, decisionsRequest, decodeDecision, createSession, applyDecisions } from '../src/sports-decisions-core.js';

export { CONTROL_PROFILE, SKILL_DIRECTIONS, MOVE, observeSports, decisionsRequest, decodeDecision, controllerFrames, createSession, applyDecisions } from '../src/sports-decisions-core.js';

const ROOT = new URL('../', import.meta.url);
const ENDPOINT = 'https://api.openai.com/v1/decisions';
const REPORT_SCHEMA = 3;
const round = n => Math.round(n * 1000) / 1000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const stateHash = state => hash(JSON.stringify(state));
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]) : null; };

const sourceFiles = ['scripts/playtest-sports-decisions.mjs', 'src/sports-decisions-core.js', 'src/soccer.js', 'src/football.js', 'src/sports-league.js', 'src/sports-input.js', 'src/gamepad.js', 'src/sports-physics.js', 'src/sports-certified.generated.js', 'src/neighborhood-safety.js', 'src/neighborhood-certified.generated.js'];
async function sourceHashes() { return Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, hash(await readFile(new URL(name, ROOT)))]))); }
const sameHashes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function parseArgs(argv) {
  const options = { game: 'soccer', live: false, maxCalls: 12000, maxWallSeconds: 3600, timeoutMs: 30000, retries: 2, report: null, replay: null, envFile: null, teams: [0, 1], seed: 1, difficulty: 1, controllers: [true, true], maxTicks: null };
  const values = { '--game': 'game', '--max-calls': 'maxCalls', '--max-wall-seconds': 'maxWallSeconds', '--timeout-ms': 'timeoutMs', '--retries': 'retries', '--report': 'report', '--replay': 'replay', '--env-file': 'envFile', '--teams': 'teams', '--seed': 'seed', '--difficulty': 'difficulty', '--controllers': 'controllers', '--max-ticks': 'maxTicks' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--live') options.live = true;
    else if (arg === '--dry-run') options.live = false;
    else if (values[arg] && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) options[values[arg]] = argv[++i];
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  for (const key of ['maxCalls', 'maxWallSeconds', 'timeoutMs', 'retries', 'seed', 'difficulty']) options[key] = Number(options[key]);
  if (typeof options.teams === 'string') options.teams = options.teams.split(',').map(Number);
  if (typeof options.controllers === 'string') options.controllers = { both: [true, true], home: [true, false], away: [false, true] }[options.controllers];
  if (options.maxTicks !== null) options.maxTicks = Number(options.maxTicks);
  if (!['soccer', 'football'].includes(options.game)) throw new Error('--game must be soccer or football');
  if (!Number.isInteger(options.maxCalls) || options.maxCalls < 1 || options.maxCalls > 20000) throw new Error('--max-calls must be 1..20000');
  if (!Number.isFinite(options.maxWallSeconds) || options.maxWallSeconds < 1 || options.maxWallSeconds > 7200) throw new Error('--max-wall-seconds must be 1..7200');
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 120000) throw new Error('--timeout-ms must be 1000..120000');
  if (!Number.isInteger(options.retries) || options.retries < 0 || options.retries > 5) throw new Error('--retries must be 0..5');
  if (!Array.isArray(options.teams) || options.teams.length !== 2 || options.teams.some(t => !Number.isInteger(t) || t < 0 || t > 3) || options.teams[0] === options.teams[1]) throw new Error('--teams must be two different team indices 0..3, e.g. 0,1');
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xFFFFFFFF) throw new Error('--seed must be a uint32');
  if (![0, 1, 2].includes(options.difficulty)) throw new Error('--difficulty must be 0, 1 or 2');
  if (!options.controllers) throw new Error('--controllers must be both, home or away');
  if (options.maxTicks !== null && (!Number.isInteger(options.maxTicks) || options.maxTicks < 1)) throw new Error('--max-ticks must be a positive integer');
  if (options.live && options.replay) throw new Error('--replay is offline and cannot use --live');
  return options;
}

// One explicit, recorded retry policy: transport errors, HTTP 408/429/5xx and
// refusals may be re-asked up to --retries times, with bounded exponential
// backoff inside the wall deadline. A choice is never invented. `budget()`
// says whether another HTTP attempt fits the run's --max-calls cap.
export async function callDecisions(request, { apiKey, timeoutMs, retries, deadline, budget = () => true, backoffMs = 500 }) {
  const attempts = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise(done => setTimeout(done, Math.min(backoffMs * 2 ** (attempt - 1), Math.max(0, deadline - performance.now()))));
    const remaining = deadline - performance.now();
    if (remaining <= 0 || !budget()) break;
    const called = performance.now(), record = { attempt };
    attempts.push(record);
    try {
      const response = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(Math.max(1000, Math.min(timeoutMs, remaining))) });
      record.httpStatus = response.status; record.requestId = response.headers.get('x-request-id');
      const body = await response.text();
      let parsed; try { parsed = JSON.parse(body); } catch { parsed = null; }
      record.apiMs = round(performance.now() - called);
      if (!response.ok) { record.error = parsed?.error?.code || parsed?.error?.type || `http-${response.status}`; if ([408, 429].includes(response.status) || response.status >= 500) continue; return { attempts }; }
      record.usage = parsed?.usage ?? null;
      const refusal = parsed?.answers?.find(answer => answer.type === 'refusal');
      if (refusal) { record.refusal = refusal.name ?? true; continue; }
      try { return { attempts, action: decodeDecision(parsed, request), answers: parsed.answers.map(({ name, choice, confidence }) => ({ name, choice, confidence })) }; }
      catch (error) { record.error = error.message; return { attempts }; }
    } catch (error) { record.apiMs = round(performance.now() - called); record.error = error.name === 'TimeoutError' ? 'timeout' : error.name; }
  }
  return { attempts };
}

function fixtureAction(gameId, tick, team) {
  const pass = gameId === 'soccer' ? 'pass' : 'receiverA';
  return { move: team ? 'left' : 'stop', skill: tick % 8 === 6 ? 'right' : 'none', action: tick === 0 ? 'confirm' : tick % 4 === 1 || tick % 4 === 2 ? pass : 'neutral' };
}

export async function runMatch(options) {
  const started = performance.now(), runId = randomUUID();
  const reportPath = resolve(options.report || `artifacts/sports-decisions/${runId}.json`), observationsPath = reportPath.replace(/\.json$/, '') + '.observations.jsonl';
  const report = { schema: REPORT_SCHEMA, controlProfile: CONTROL_PROFILE, runId, startedAt: new Date().toISOString(), mode: options.replay ? 'replay' : options.live ? 'live-decisions-api' : 'dry-run', game: options.game,
    session: { teams: options.teams, seed: options.seed, difficulty: options.difficulty, controllers: options.controllers },
    model: DECISIONS_MODEL, endpoint: ENDPOINT, apiProtocol: { version: 'v1', documentation: 'https://developers.openai.com/api/docs/guides/decisions' },
    limits: { calls: options.maxCalls, wallSeconds: options.maxWallSeconds, ticksPerDecision: TICKS, requestTimeoutMs: options.timeoutMs, retries: options.retries, maxTicks: options.maxTicks },
    machine: { node: process.version, platform: process.platform, arch: process.arch }, status: 'running', ticks: [], sourceHashes: null, observationsFile: options.live ? observationsPath : null,
    limitations: 'Headless visible-telemetry controller play, one decision per controller every 0.25 s with simulation paused while thinking. Not screenshot perception, rendered feedback, physical-controller feel or real-time latency. Teammates of the controlled athletes are the built-in CPU.',
    queueMs: null, providerExecutionMs: null, cost: null };
  let session, apiKey, lastSave = 0;
  const save = async (force = false) => {
    if (!force && report.ticks.length - lastSave < 40) return;
    lastSave = report.ticks.length; report.elapsedMs = round(performance.now() - started);
    await mkdir(dirname(reportPath), { recursive: true });
    const serialized = JSON.stringify(report);
    await writeFile(reportPath, (apiKey ? serialized.replaceAll(apiKey, '[redacted]') : serialized) + '\n');
  };
  try {
    report.sourceHashes = await sourceHashes();
    let replay;
    if (options.replay) {
      replay = JSON.parse(await readFile(options.replay, 'utf8'));
      if (replay.schema !== REPORT_SCHEMA || replay.controlProfile !== CONTROL_PROFILE || !sameHashes(replay.sourceHashes, report.sourceHashes)) throw new Error('Replay control profile or source hashes differ; use the exact recorded harness/source revision');
      Object.assign(report.session, replay.session); report.game = replay.game; report.replayOf = replay.runId;
    }
    session = createSession(report.game, report.session); report.initialStateHash = stateHash(session.state);
    if (options.live) {
      if (options.envFile) process.loadEnvFile(resolve(options.envFile));
      apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY is required for --live (or supply --env-file)');
      await mkdir(dirname(observationsPath), { recursive: true }); await writeFile(observationsPath, '');
    }
    const deadline = started + options.maxWallSeconds * 1000, seats = session.seats.filter(Boolean);
    // A failed run's last tick never executed, so a replay stops before it.
    const recorded = replay ? replay.ticks.findIndex(tick => !tick.stateHash) : -1;
    const tickCount = replay ? (recorded < 0 ? replay.ticks.length : recorded) : options.maxTicks ?? Infinity;
    // --max-calls caps HTTP attempts, including retries.
    let calls = 0;
    const budget = () => calls < options.maxCalls;
    for (let tick = 0; tick < tickCount; tick++) {
      if (session.state.phase === 'finished') { report.status = 'match-finished'; break; }
      if (!replay && performance.now() >= deadline) { report.status = 'wall-limit'; break; }
      if (!replay && options.live && calls + seats.length > options.maxCalls) { report.status = 'call-limit'; break; }
      const entry = { tick, decisions: [] }, actions = [null, null];
      if (replay) {
        for (const decision of replay.ticks[tick].decisions) { actions[decision.team] = decision.action; entry.decisions.push({ team: decision.team, action: decision.action, replayed: true }); }
      } else {
        const asks = seats.map(seat => {
          const observation = observeSports(report.game, session.state, { team: seat.team, lastAction: seat.lastAction, history: seat.history });
          return { seat, observation, request: decisionsRequest(observation) };
        });
        const answers = await Promise.all(asks.map(ask => options.live ? callDecisions(ask.request, { apiKey, timeoutMs: options.timeoutMs, retries: options.retries, deadline, budget: () => budget() && ++calls > 0 }) : Promise.resolve({ attempts: [], action: fixtureAction(report.game, tick, ask.seat.team), fixture: true })));
        if (options.live) await appendFile(observationsPath, asks.map(ask => JSON.stringify({ tick, team: ask.seat.team, observation: ask.observation })).join('\n') + '\n');
        asks.forEach((ask, i) => {
          const answer = answers[i];
          actions[ask.seat.team] = answer.action ?? null;
          entry.decisions.push({ team: ask.seat.team, action: answer.action ?? null, answers: answer.answers, attempts: answer.attempts, fixture: answer.fixture || undefined, observationSha256: hash(JSON.stringify(ask.observation)) });
        });
        if (answers.some(answer => !answer.action)) { report.ticks.push(entry); throw new Error(`Decisions call failed at tick ${tick} after ${options.retries} allowed retries`); }
      }
      const executed = performance.now(), result = applyDecisions(session, actions);
      entry.executionMs = round(performance.now() - executed); entry.events = result.events.map(event => event.kind);
      entry.phase = session.state.phase; entry.score = [...session.state.score]; entry.stateHash = stateHash(session.state);
      if (replay && entry.stateHash !== replay.ticks[tick].stateHash) throw new Error(`Replay diverged at tick ${tick}`);
      report.ticks.push(entry); await save();
    }
    if (report.status === 'running') report.status = replay ? (recorded < 0 ? 'replayed' : 'replayed-to-failure') : session.state.phase === 'finished' ? 'match-finished' : 'tick-limit';
    report.finalState = session.state; report.finalStateHash = stateHash(session.state);
    if (replay && recorded < 0) { report.replayMatchesFinalState = report.finalStateHash === replay.finalStateHash; if (!report.replayMatchesFinalState) throw new Error('Replay final state differs'); }
    if (replay && recorded >= 0) report.replayMatchesFinalState = report.ticks.at(-1)?.stateHash === replay.ticks[recorded - 1]?.stateHash;
    report.endSourceHashes = await sourceHashes(); report.sourceUnchanged = sameHashes(report.sourceHashes, report.endSourceHashes);
    if (!report.sourceUnchanged) throw new Error('Source files changed during run; result is not bound to one source revision');
  } catch (error) {
    report.status = 'failed'; report.error = { name: error.name, message: apiKey ? String(error.message).replaceAll(apiKey, '[redacted]') : String(error.message) };
    if (session) { report.finalState = session.state; report.finalStateHash = stateHash(session.state); }
  } finally {
    const attempts = report.ticks.flatMap(tick => tick.decisions.flatMap(d => d.attempts || []));
    const usage = attempts.map(a => a.usage).filter(Boolean), sumUsage = key => usage.reduce((sum, u) => sum + (Number.isFinite(u[key]) ? u[key] : 0), 0);
    const apiMs = attempts.map(a => a.apiMs).filter(Number.isFinite);
    report.totals = { ticks: report.ticks.length, decisions: report.ticks.reduce((n, t) => n + t.decisions.filter(d => d.action).length, 0), attempts: attempts.length,
      retries: attempts.filter(a => a.attempt > 0).length, refusals: attempts.filter(a => a.refusal).length, errors: attempts.filter(a => a.error).length,
      inputTokens: sumUsage('input_tokens'), outputTokens: sumUsage('output_tokens'), requestMs: { median: percentile(apiMs, .5), p95: percentile(apiMs, .95), max: apiMs.length ? round(Math.max(...apiMs)) : null },
      simulatedSeconds: round((session?.state.frame || 0) / 60), note: 'requestMs is per HTTP attempt and nested inside elapsedMs; two seats run concurrently, so request times are not additive.' };
    report.observedOutcomes = { score: session?.state.score || null, phase: session?.state.phase || null, frame: session?.state.frame || 0, stats: session?.state.stats || null, eventCounts: {} };
    for (const tick of report.ticks) for (const kind of tick.events || []) report.observedOutcomes.eventCounts[kind] = (report.observedOutcomes.eventCounts[kind] || 0) + 1;
    if (options.live && report.observationsFile) { try { report.observationsSha256 = hash(await readFile(report.observationsFile)); } catch { report.observationsSha256 = null; } }
    await save(true);
  }
  return { reportPath, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runMatch(parseArgs(process.argv.slice(2)));
    const { report } = result;
    console.log(JSON.stringify({ report: result.reportPath, mode: report.mode, status: report.status, ticks: report.ticks.length, elapsedMs: report.elapsedMs, phase: report.finalState?.phase, score: report.finalState?.score, totals: report.totals, error: report.error || null }));
    if (report.status === 'failed') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
