// Built-in CPU-vs-CPU gameplay evaluation for the sports subgames. Separately
// triggered (`npm run sim:sports`), never routine CI. Each match runs the real
// model in watch mode from a seed; worker threads only parallelize matches.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRAME_LIMIT = 60 * 60 * 45; // A stuck match is reported, never looped forever.

export async function loadSport(id) {
  if (id === 'soccer') return (await import('../src/soccer.js')).soccerDefinition;
  if (id === 'football') return (await import('../src/football.js')).footballDefinition;
  throw new Error(`Unknown sport ${id}`);
}

// One deterministic match. `mirror` copies the home roster onto the away side
// (a truly even match). `specialty` gives (`with`) or removes (`without`) a
// specialty for every athlete of team 0 before kickoff.
export function playMatch(game, { teams, seed, difficulty = 1, specialty = null, mirror = false }) {
  const s = game.createState({ setup: false, mode: 'watch', teams, seed, difficulty });
  if (mirror) s.teams[1] = { ...structuredClone(s.teams[0]), index: s.teams[1].index };
  if (specialty) for (const p of s.teams[0].players) {
    p.specialties = p.specialties.filter(id => id !== specialty.id);
    if (specialty.arm === 'with') p.specialties.push(specialty.id);
  }
  const started = performance.now();
  let frames = 0;
  while (s.phase !== 'finished' && frames < FRAME_LIMIT) { game.step(s, 1 / 60); frames++; }
  game.validateState(s);
  return { teams, seed, specialty, mirror, score: [...s.score], stats: s.stats, finished: s.phase === 'finished', frames, ms: performance.now() - started };
}

// --------------------------------------------------------------- metrics
// Each metric is pooled as sum(numerator) / sum(denominator) over matches.
const both = a => a[0] + a[1];
export const METRICS = {
  soccer: {
    goals: m => [both(m.score), 1], shots: m => [both(m.stats.shots), 1],
    passCompletion: m => [both(m.stats.completed), both(m.stats.passes)], savePct: m => [both(m.stats.saves), both(m.stats.onTarget)],
    fouls: m => [both(m.stats.fouls), 1],
  },
  football: {
    points: m => [both(m.score), 1], completion: m => [both(m.stats.passComp), both(m.stats.passAtt)],
    intPct: m => [both(m.stats.ints), both(m.stats.passAtt)], ypc: m => [both(m.stats.rushYds), both(m.stats.rushAtt)],
    runShare: m => [both(m.stats.rushAtt), both(m.stats.rushAtt) + both(m.stats.passAtt) + both(m.stats.sacks)],
  },
};
export const BANDS = {
  soccer: { goals: [2, 7], shots: [8, 24], passCompletion: [.7, .9], savePct: [.55, .8], fouls: [1, 8] },
  football: { points: [14, 49], completion: [.55, .75], intPct: [0, .05], ypc: [3.5, 6], runShare: [.3, .65] },
};
// Specialty target statistics from team 0's perspective (+1 should rise, -1 fall).
// Specialties without a match-level statistic are covered by focused model tests.
export const SPECIALTY_TARGETS = {
  soccer: {
    // Finisher also changes how often the CPU shoots, so goals per match is the
    // felt effect. Cannon makes shots harder to stop, so the opposing keeper's
    // save rate isolates it from shot volume.
    finisher: [1, m => [m.score[0], 1]], cannon: [-1, m => [m.stats.saves[1], m.stats.onTarget[0]]],
    playmaker: [1, m => [m.stats.completed[0], m.stats.passes[0]]], interceptor: [-1, m => [m.stats.completed[1], m.stats.passes[1]]],
    ball_winner: [1, m => [m.stats.tackles[0], 1]], wall: [-1, m => [m.stats.tackles[1], 1]],
    cat_reflexes: [1, m => [m.stats.saves[0], m.stats.onTarget[1]]],
  },
  football: {
    // Faster bullets mainly beat closing defenders; the extra 8 yards of range
    // rarely binds on a 100-yard field, so completion rate is the felt effect.
    gunslinger: [1, m => [m.stats.passComp[0], m.stats.passAtt[0]]], surgeon: [1, m => [m.stats.passComp[0], m.stats.passAtt[0]]],
    sure_hands: [-1, m => [m.stats.drops[0], m.stats.passAtt[0]]], route_artist: [1, m => [m.stats.passComp[0], m.stats.passAtt[0]]],
    burner: [1, m => [m.stats.passYds[0] + m.stats.rushYds[0], m.stats.plays[0]]],
    bulldozer: [1, m => [m.stats.rushYds[0], m.stats.rushAtt[0]]], ankle_breaker: [1, m => [m.stats.rushYds[0], m.stats.rushAtt[0]]],
    edge_rusher: [1, m => [m.stats.sacks[0], m.stats.passAtt[1] + m.stats.sacks[0]]],
    brick_wall: [-1, m => [m.stats.sacks[1], m.stats.passAtt[0] + m.stats.sacks[1]]], escape_artist: [-1, m => [m.stats.sacks[1], m.stats.passAtt[0] + m.stats.sacks[1]]],
    ballhawk: [1, m => [m.stats.ints[0], m.stats.passAtt[1]]], enforcer: [1, m => [m.stats.fumbles[1], m.stats.plays[1]]],
    lockdown: [-1, m => [m.stats.passComp[1], m.stats.passAtt[1]]], big_leg: [1, m => [m.stats.fgMade[0], 1]],
  },
};
const pooled = (matches, metric) => {
  let num = 0, den = 0;
  for (const m of matches) { const [n, d] = metric(m); num += n; den += d; }
  return den ? num / den : null;
};
const round = n => n === null ? null : Math.round(n * 1000) / 1000;
// Pairings: equal = a mirror match of the home roster (seat 0 is the subject);
// gap = strongest vs weakest, alternating home and away.
export const PAIRINGS = { soccer: { equal: [0, 1], gap: [2, 3] }, football: { equal: [0, 1], gap: [2, 3] } };
const minWinShare = { soccer: .75, football: .85 };

export function evaluate(sport, sections) {
  const out = { bands: {}, balance: {}, specialties: {}, passed: true };
  const band = sections.bands || [];
  for (const [name, metric] of Object.entries(METRICS[sport])) {
    const value = pooled(band, metric), [low, high] = BANDS[sport][name];
    const passed = value !== null && value >= low && value <= high;
    out.bands[name] = { value: round(value), band: [low, high], passed };
    out.passed &&= passed;
  }
  for (const key of ['equal', 'gap']) {
    const subject = PAIRINGS[sport][key][0], matches = sections[key] || [];
    let wins = 0, losses = 0, draws = 0;
    for (const m of matches) {
      const side = m.mirror ? 0 : m.teams.indexOf(subject), margin = m.score[side] - m.score[1 - side];
      if (margin > 0) wins++; else if (margin < 0) losses++; else draws++;
    }
    const share = wins + losses ? wins / (wins + losses) : null;
    const passed = share !== null && (key === 'equal' ? share >= .4 && share <= .6 : share >= minWinShare[sport]);
    out.balance[key] = { subject: key === 'equal' ? `home seat in a ${subject} mirror match` : `team ${subject}`, wins, losses, draws, winShareOfDecided: round(share), criterion: key === 'equal' ? [.4, .6] : [minWinShare[sport], 1], passed };
    out.passed &&= passed;
  }
  const ab = sections.specialties || [];
  for (const [id, [direction, metric]] of Object.entries(SPECIALTY_TARGETS[sport])) {
    const arm = name => ab.filter(m => m.specialty?.id === id && m.specialty.arm === name);
    if (!arm('with').length) continue;
    const withValue = pooled(arm('with'), metric), withoutValue = pooled(arm('without'), metric);
    const passed = withValue !== null && withoutValue !== null && Math.sign(withValue - withoutValue) === direction;
    out.specialties[id] = { with: round(withValue), without: round(withoutValue), expected: direction > 0 ? 'increase' : 'decrease', matchesPerArm: arm('with').length, passed };
    out.passed &&= passed;
  }
  out.unfinished = Object.values(sections).flat().filter(m => !m.finished).length;
  out.passed &&= out.unfinished === 0;
  return out;
}

// ------------------------------------------------------------------ jobs
export function plan(sport, { matches, balance, ab, seed, specialties, difficulty, only = null }) {
  const jobs = [], count = 4;
  let n = seed >>> 0;
  const next = () => (n = (n * 1664525 + 1013904223) >>> 0);
  for (let a = 0; a < count; a++) for (let b = 0; b < count; b++) if (a !== b)
    for (let i = 0; i < matches; i++) jobs.push({ sport, section: 'bands', teams: [a, b], seed: next(), difficulty });
  for (const key of ['equal', 'gap']) for (let i = 0; i < balance; i++) {
    const [a, b] = PAIRINGS[sport][key];
    jobs.push({ sport, section: key, teams: key === 'equal' ? [a, b] : i % 2 ? [b, a] : [a, b], seed: next(), difficulty, mirror: key === 'equal' });
  }
  if (specialties) for (const id of Object.keys(SPECIALTY_TARGETS[sport]).filter(id => !only || only.includes(id))) for (let i = 0; i < ab; i++) {
    const shared = next();
    for (const arm of ['with', 'without']) jobs.push({ sport, section: 'specialties', teams: PAIRINGS[sport].equal, seed: shared, difficulty, specialty: { id, arm } });
  }
  return jobs;
}

async function runPool(jobs, workers) {
  const results = new Array(jobs.length);
  let next = 0, failed = null;
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, () => new Promise((done, fail) => {
    const worker = new Worker(fileURLToPath(import.meta.url));
    let stopping = false;
    const feed = () => {
      if (failed || next >= jobs.length) { stopping = true; worker.terminate().then(done); return; }
      const index = next++; worker.once('message', message => {
        if (message.error) { failed = new Error(`${jobs[index].sport} seed ${jobs[index].seed}: ${message.error}`); stopping = true; worker.terminate().then(() => fail(failed)); return; }
        results[index] = { ...jobs[index], ...message.result }; feed();
      });
      worker.postMessage(jobs[index]);
    };
    // A worker that dies without posting (e.g. out of memory) fails the run instead of hanging it.
    worker.once('error', fail);
    worker.once('exit', code => { if (!stopping) { failed ||= new Error(`Simulation worker exited unexpectedly with code ${code}`); fail(failed); } });
    feed();
  })));
  return results;
}

if (!isMainThread) {
  const games = {};
  parentPort.on('message', async job => {
    try {
      games[job.sport] ||= await loadSport(job.sport);
      const { score, stats, finished, frames, ms } = playMatch(games[job.sport], job);
      parentPort.postMessage({ result: { score, stats, finished, frames, ms } });
    } catch (error) { parentPort.postMessage({ error: error.stack || String(error) }); }
  });
}

function parseArgs(argv) {
  const options = { game: 'all', matches: 6, balance: 100, ab: 100, seed: 20261017, specialties: false, difficulty: 1, workers: Math.max(1, Math.min(cpus().length - 2, 12)), report: null, only: null };
  const numeric = { '--matches': 'matches', '--balance': 'balance', '--ab': 'ab', '--seed': 'seed', '--difficulty': 'difficulty', '--workers': 'workers' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--specialties') options.specialties = true;
    else if (arg === '--game' && argv[i + 1]) options.game = argv[++i];
    else if (arg === '--report' && argv[i + 1]) options.report = argv[++i];
    else if (arg === '--only' && argv[i + 1]) { options.only = argv[++i].split(','); options.specialties = true; }
    else if (numeric[arg] && argv[i + 1] !== undefined) options[numeric[arg]] = Number(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!['all', 'soccer', 'football'].includes(options.game)) throw new Error('--game must be all, soccer or football');
  for (const key of ['matches', 'balance', 'ab', 'workers']) if (!Number.isInteger(options[key]) || options[key] < 0 || options[key] > 500) throw new Error(`--${key} must be an integer 0..500`);
  if (!Number.isInteger(options.seed) || options.seed < 0) throw new Error('--seed must be a nonnegative integer');
  if (![0, 1, 2].includes(options.difficulty)) throw new Error('--difficulty must be 0, 1 or 2');
  if (options.workers < 1) throw new Error('--workers must be at least 1');
  return options;
}

const SOURCES = ['src/soccer.js', 'src/football.js', 'src/sports-league.js', 'src/sports-physics.js', 'src/sports-certified.generated.js', 'scripts/simulate-sports.mjs'];
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null; };

if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2)), started = performance.now(), runId = randomUUID();
    const git = args => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
    const report = { schema: 1, kind: 'sports-builtin-cpu-evaluation', runId, startedAt: new Date().toISOString(), options,
      sourceCommit: git(['rev-parse', 'HEAD']), workingTreeChanges: git(['status', '--porcelain', '--', 'src', 'scripts']).split('\n').filter(Boolean),
      sourceHashes: Object.fromEntries(await Promise.all(SOURCES.map(async file => [file, createHash('sha256').update(await readFile(resolve(ROOT, file))).digest('hex')]))),
      machine: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, cpus: cpus().length }, sports: {},
      limitations: 'Built-in CPU in watch mode at the stated difficulty. Seeds make each match reproducible. Evaluates statistical behavior, not human fun, rendering or controller feel.' };
    for (const sport of options.game === 'all' ? ['soccer', 'football'] : [options.game]) {
      const jobs = plan(sport, options), sectionStart = performance.now();
      const results = await runPool(jobs, options.workers), elapsedMs = performance.now() - sectionStart;
      const sections = Object.groupBy(results, m => m.section), times = results.map(m => m.ms);
      const evaluation = evaluate(sport, sections);
      report.sports[sport] = { evaluation, timing: { elapsedMs: round(elapsedMs), aggregateMatchMs: round(times.reduce((a, b) => a + b, 0)), matches: results.length,
        perMatchMs: { mean: round(times.reduce((a, b) => a + b, 0) / times.length), p95: round(percentile(times, .95)), max: round(Math.max(...times)) } },
        matches: results.map(({ section, teams, seed, specialty, mirror, score, finished, frames, ms, stats }) => ({ section, teams, seed, specialty, mirror, score, finished, frames, ms: round(ms), stats })) };
      console.log(JSON.stringify({ sport, passed: evaluation.passed, bands: evaluation.bands, balance: evaluation.balance, specialties: evaluation.specialties, unfinished: evaluation.unfinished, timing: report.sports[sport].timing }, null, 1));
    }
    report.totalMs = round(performance.now() - started);
    report.passed = Object.values(report.sports).every(sport => sport.evaluation.passed);
    const reportPath = resolve(ROOT, options.report || `artifacts/sports-sim/${runId}.json`);
    await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report) + '\n');
    console.log(JSON.stringify({ passed: report.passed, totalMs: report.totalMs, report: reportPath }));
    if (!report.passed) process.exitCode = 1;
  } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}
