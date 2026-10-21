#!/usr/bin/env node
// Generation-quality benchmark: runs the real kernel pipeline in-process (no server) over a fixed set
// of ideas and records, per game, whether it succeeded (and why not), a content census of what was
// generated (v2/planner/census.js), what the project's playtest agent found when it played the final
// document (verifyDocument with a playtest budget: crashes, explored states, ending reached), the
// stage timings and every model call (purpose, served model id, ms, tokens).
// Timing context follows AGENTS.md (run id, commit + dirty flag, catalogue hash, pipeline version and
// config, writers, decisions provider, machine and load); values that were not measured are null.
//
//   node v2/tools/generation-bench.mjs [--offline] [--only id,id] [--label text] [--out dir]
// Live runs make real model calls (one full pipeline run per idea) and are a qualification run, not CI.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { loadCatalogue, catalogHash } from '../planner/catalog.js';
import { createKernelPipeline, KERNEL_PIPELINE_VERSION, PIPELINE_CONFIG } from '../planner/kernel-pipeline.js';
import { createWriters } from '../planner/writer.js';
import { createDecisions } from '../planner/decisions.js';
import { loadOpenAIKey } from '../planner/openai.js';
import { verifyDocument } from '../planner/verify-adapter.js';
import { census, kindViewPreserved } from '../planner/census.js';
import { verify, GATE_BUDGET } from '../verify/index.js';
import { isAvatar } from '../planner/play-spec.js';
import { catalogueForDoc } from '../experiments/primitive.js';
import { memoryCtx } from './kernel-bench.mjs';

// The bench (the user's consolidated list). Seeds are fixed per idea so runs are comparable.
export const IDEAS = [
  { id: 'chess-pokemon', seed: 201, prompt: 'chess but with pokemon' , avatar: false},
  { id: 'mario', seed: 101, prompt: 'A Mario-style platformer: run and jump across levels, stomp enemies, collect coins and reach the flag' , avatar: true},
  { id: 'kart', seed: 102, prompt: 'Mario Kart with shopping carts' , avatar: true},
  { id: 'farming', seed: 202, prompt: 'A cozy farming game on a floating island' , avatar: true},
  { id: 'clock-dungeon', seed: 203, prompt: '3D Zelda-style dungeon inside a giant clock' , avatar: true},
  { id: 'pacman-library', seed: 106, prompt: 'Pac-Man in a haunted library' , avatar: true},
  { id: 'card-battler', seed: 204, prompt: 'A card battler: build a deck of spell cards and duel monsters' , avatar: false},
  { id: 'match3', seed: 205, prompt: 'A match-3 puzzle game with enchanted gems' , avatar: false},
  { id: 'tower-defense', seed: 108, prompt: 'A tower-defense game: build towers along the path to stop waves of enemies' , avatar: false},
  { id: 'mystery', seed: 109, prompt: 'A mystery adventure: question suspects, gather clues and name the culprit' , avatar: true},
];
// The first bench's set (the "before" run), kept for comparison: --set original.
export const ORIGINAL_IDEAS = [
  { id: 'mario', seed: 101, prompt: 'A Mario-style platformer: run and jump across levels, stomp enemies, collect coins and reach the flag' },
  { id: 'kart', seed: 102, prompt: 'Mario Kart with shopping carts' },
  { id: 'creatures', seed: 103, prompt: 'A Pokémon-style creature RPG: catch wild creatures, build a party and battle trainers' },
  { id: 'zelda', seed: 104, prompt: 'A Zelda dungeon: explore rooms, fight monsters, find keys to open locked doors and beat the boss' },
  { id: 'tetris-platformer', seed: 105, prompt: 'A Tetris platformer: climb a tower built from falling tetromino pieces' },
  { id: 'pacman-library', seed: 106, prompt: 'Pac-Man in a haunted library' },
  { id: 'sf-pokemon', seed: 107, prompt: 'Street Fighter × Pokémon' },
  { id: 'tower-defense', seed: 108, prompt: 'A tower-defense game: build towers along the path to stop waves of enemies' },
  { id: 'mystery', seed: 109, prompt: 'A mystery adventure: question suspects, gather clues and name the culprit' },
  { id: 'angry-castle', seed: 110, prompt: 'Angry Birds × castle siege' },
];

const arg = (name, d = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = name => process.argv.includes(`--${name}`);
const CRASH = new Set(['runtime_error', 'non_finite', 'entity_explosion', 'event_storm', 'instant_loss', 'verify_threw']);
const PURPOSES = [[/^You decompose/, 'decompose'], [/^You map game mechanics/, 'map'], [/^You check a mechanic mapping/, 'map_check'], [/^You write game (documents|outlines)/, 'outline'], [/^You add detail/, 'detail'], [/^You (revise|change)/, 'revise']];
const purposeOf = system => PURPOSES.find(([re]) => re.test(String(system || '')))?.[1] || 'other';

const REPLIES = fileURLToPath(new URL('../../local-data/v2/bench/replies/', import.meta.url));
/** The cache key of one model request: the writer's model and the exact request. */
const replyKey = (model, req) => createHash('sha256').update(JSON.stringify([model, req.system, req.user, req.schema || null])).digest('hex').slice(0, 32);

/**
 * Wrap a writer so every call is recorded (purpose, served model, ms, tokens, ok) and every reply is kept on disk:
 * a request already answered is replayed from the cache (no model call), so unchanged stages are never re-run.
 * replay 'only' never calls the model (a miss is an error).
 */
function recording(writer, calls, { replay = 'auto' } = {}) {
  if (!writer) return null;
  mkdirSync(REPLIES, { recursive: true });
  return { ...writer, async complete(req) {
    const t = performance.now(), purpose = purposeOf(req.system), key = replyKey(writer.model, req), file = `${REPLIES}${key}.json`;
    if (replay !== 'off' && existsSync(file)) {
      const r = JSON.parse(readFileSync(file, 'utf8'));
      calls.push({ purpose, model: r.model, ms: 0, recordedMs: r.ms ?? null, replayed: true, ok: true });
      return r;
    }
    if (replay === 'only') { calls.push({ purpose, model: writer.model, ms: 0, ok: false, error: 'no recorded reply' }); throw Object.assign(Error(`no recorded reply for this ${purpose} request (replay only)`), { code: 'no_recorded_reply' }); }
    try {
      const r = await writer.complete(req);
      writeFileSync(file, JSON.stringify({ text: r.text, model: r.model, ms: r.ms, usage: r.usage || null, purpose, at: new Date().toISOString() }));
      calls.push({ purpose, model: r.model || writer.model, ms: r.ms ?? Math.round(performance.now() - t), strict: Boolean(req.schema), input: r.usage?.input_tokens ?? r.usage?.prompt_tokens ?? null, output: r.usage?.output_tokens ?? r.usage?.completion_tokens ?? null, ok: true });
      return r;
    } catch (error) { calls.push({ purpose, model: writer.model, ms: Math.round(performance.now() - t), ok: false, error: String(error?.message || error).slice(0, 160) }); throw error; }
  } };
}

/** The playtest agent's report on one document (the publish gate's verifier, with a playtest budget). */
export async function playReport(doc, registry, logic) {
  const v = await verifyDocument(doc, registry, logic, { playable: true });
  const crashes = (v.problems || []).filter(p => CRASH.has(p.code) && p.severity !== 'warning' && p.severity !== 'info');
  // The mode bots (verify strategies chosen by what the document provides): did one play the core loop to a win?
  let bots = [];
  // A bot completes the game when one of its runs is won (the run's path is the trace).
  const wonRun = m => [...(m?.runs || []), ...(m?.matches || [])].find(x => x?.won === true) || null;
  try { const r = await verify(v.doc || doc, registry, logic, { seed: doc.seed, plot: false, spatial: false, playtest: false, invariants: false }); bots = (r.strategies?.ran || []).map(x => { const w = wonRun(x.metrics); return { id: x.id, ok: x.ok, won: Boolean(w), trace: Array.isArray(w?.path) ? w.path.length : (w?.decisions ?? w?.moves ?? null), rate: x.metrics?.rate ?? null }; }); } catch { bots = []; }
  const botWin = bots.find(b => b.won);
  const path = v.playtest?.win?.path;
  return {
    viable: Boolean(v.viable), completable: v.completable ?? null, crashes: crashes.length, crashCodes: [...new Set(crashes.map(p => p.code))],
    explored: v.playtest?.explored ?? null, winnable: v.playtest?.winnable ?? null, ending: v.playtest?.win?.ending ?? null, winSeconds: v.playtest?.win?.seconds ?? null,
    completed: Boolean(v.playtest?.winnable || botWin), trace: Array.isArray(path) ? path.length : botWin?.trace ?? null, by: v.playtest?.winnable ? 'playtest' : botWin ? `bot:${botWin.id}` : null, bots,
    errors: (v.problems || []).filter(p => p.severity === 'error').map(p => p.code).slice(0, 12), ms: v.ms,
  };
}

/** Is the avatar there exactly when the idea's interaction needs one? (base locomotion or a vehicle the player drives) */
export function avatarFit(decomposition, doc, registry, expected = null) {
  // The bench's own expectation for the idea when it has one, else what the play spec says.
  const want = typeof expected === 'boolean' ? expected : decomposition?.core ? isAvatar(decomposition.core.interaction) : null;
  const places = (doc.spaces || []).some(s => (s.zones || []).some(z => Array.isArray(z.exits) && z.exits.length) && s.id === (doc.player?.space ?? doc.spaces[0]?.id));
  const moves = places || (doc.systems || []).some(s => registry.get(s.use)?.card.locomotion === 'base' || registry.get(s.use)?.card.engage?.player?.spawn);
  return { want, has: moves, ok: want === null ? null : want === moves };
}

/** Each core mechanic: its primitives are in the document (covered), it is a reported gap (gapped), or neither (dropped). */
export function coreCoverage(selection, doc, gaps = []) {
  const used = new Set([...(doc.spaces || []).flatMap(s => [s.use, ...(s.generators || []).map(g => g.use)]), ...(doc.systems || []).map(s => s.use)]);
  const out = { covered: 0, gapped: 0, dropped: [] };
  for (const m of (selection.mechanics || []).filter(m => m.importance === 'core')) {
    if ((m.primitives || []).some(id => used.has(id))) out.covered++;
    else if (gaps.some(g => g.mechanic === m.id)) out.gapped++;
    else out.dropped.push(m.id);
  }
  return out;
}

export async function runGenerationBench({ ideas = IDEAS, replay = 'auto', offline = false, env = process.env, label = null, config = {}, outDir = null, writers: given = null, decisions: givenDecisions } = {}) {
  const started = Date.now();
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const base = await loadCatalogue();
  const openaiKey = offline || given ? null : loadOpenAIKey(env, repo);
  const raw = given || (offline ? { spec: null, code: null } : await createWriters(env, { openaiKey }));
  const decisions = givenDecisions !== undefined ? givenDecisions : offline ? null : createDecisions(env, { openaiKey });
  const catalogue = async doc => (doc?.experiments?.length ? catalogueForDoc(doc) : base);
  const games = [];
  for (const idea of ideas) {
    const calls = [];
    const writers = { spec: recording(raw.spec, calls, { replay }), code: raw.code };
    const pipeline = createKernelPipeline({ catalogue, writers, decisions, config });
    const gameId = `gen-${idea.id}`;
    const { ctx, versions, stages } = memoryCtx(gameId);
    const checkpoints = {};
    ctx.checkpoint = (name, value) => { checkpoints[name] = value; };
    const job = { gameId, prompt: idea.prompt, answers: [], kind: 'create', seed: idea.seed, queuedMs: 0 };
    ctx.job = job;
    const t = performance.now();
    const game = { id: idea.id, prompt: idea.prompt, seed: idea.seed, ok: false, reason: null, failedStage: null };
    try {
      const out = await pipeline(job, ctx);
      const cat = await catalogue(out.doc);
      const fp = versions.find(v => v.stage === 'first_playable')?.doc || null;
      Object.assign(game, {
        ok: true, title: out.doc.title, ms: Math.round(performance.now() - t), timings: out.timings,
        outline: out.outline, mechanics: out.selection.mechanics.map(m => ({ id: m.id, importance: m.importance, primitives: m.primitives })),
        spaces: out.doc.spaces.map(s => s.use), systems: (out.doc.systems || []).map(s => s.use), gaps: out.selection.gaps.map(g => `${g.kind}: ${g.description}`).slice(0, 8),
        decomposition: { views: out.decomposition.views, spaces: out.decomposition.spaces.map(x => x.kind), source: out.decomposition.source },
        kindView: kindViewPreserved(out.decomposition, out.doc, cat.registry),
        core: out.decomposition.core || null, structure: out.outline?.structure || null,
        avatar: avatarFit(out.decomposition, out.doc, cat.registry, idea.avatar),
        coverage: coreCoverage(out.selection, out.doc, out.selection.gaps),
        census: census(out.doc, cat.registry, cat.logic), outlineCensus: fp ? census(fp, cat.registry, cat.logic, { boot: 0 }) : null,
        play: await playReport(out.doc, cat.registry, cat.logic),
        detail: { proposed: out.detail.proposed, accepted: out.detail.accepted, rejected: out.detail.rejected.map(r => r.reason) },
        versions: versions.length,
      });
      if (outDir) writeFileSync(join(outDir, `${idea.id}.json`), JSON.stringify(out.doc, null, 1));
    } catch (error) {
      game.ms = Math.round(performance.now() - t);
      game.reason = String(error?.message || error).slice(0, 300);
      game.failedStage = stages.at(-1)?.name || 'start';
      const doc = checkpoints.outline?.doc;
      if (doc) { try { const cat = await catalogue(doc); game.outlineCensus = census(doc, cat.registry, cat.logic, { boot: 0 }); } catch {} }
      if (outDir && doc) writeFileSync(join(outDir, `${idea.id}.failed.json`), JSON.stringify({ reason: game.reason, checkpoints }, null, 1));
    }
    game.stages = stages.map(s => ({ name: s.name, at: s.at, ms: s.ms ?? null }));
    game.modelCalls = calls;
    game.models = [...new Set(calls.map(c => c.model))];
    games.push(game);
    process.stderr.write(`${game.ok ? 'ok ' : 'ERR'} ${idea.id.padEnd(18)} ${String(game.ms).padStart(7)} ms · ${calls.length} model calls${game.ok ? ` · ${row(game).slice(0, 140)}` : ` · ${game.reason}`}\n`);
  }
  let commit = null, dirty = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim().length > 0; } catch {}
  const cpus = os.cpus();
  return {
    schema: 'gameverse.v2.generation-bench/0.1', runId: `${new Date(started).toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`, label,
    startedAt: new Date(started).toISOString(), wallMs: Date.now() - started,
    context: {
      sourceCommit: commit, dirty, pipeline: KERNEL_PIPELINE_VERSION, config: { ...PIPELINE_CONFIG, ...config }, gateBudget: GATE_BUDGET,
      catalogHash: catalogHash(base.registry), primitives: base.registry.ids().length,
      writers: { spec: raw.spec ? `${raw.spec.provider}:${raw.spec.model}` : null }, servedModels: [...new Set(games.flatMap(g => g.models))],
      decisions: decisions?.provider ?? null, offline,
      machine: { platform: os.platform(), release: os.release(), arch: os.arch(), cpuModel: cpus[0]?.model || null, cpuCount: cpus.length, memoryGb: Math.round(os.totalmem() / 2 ** 30), node: process.version, loadavg: os.loadavg().map(x => +x.toFixed(2)) },
      nesting: 'timings come from the pipeline (requestToFirstPlayableMs contains decompose/select/outline/firstPlayable/gate; detailMs follows it; totalMs covers all); play.ms is the benchmark\'s own playtest after the run',
    },
    summary: {
      games: games.length, succeeded: games.filter(g => g.ok).length,
      modelCalls: games.reduce((n, g) => n + g.modelCalls.length, 0),
      table: games.map(row),
    },
    games,
  };
}

/** One table row: success, census and the playtest agent's verdict. */
export function row(g) {
  if (!g.ok) return `${g.id} | FAIL (${g.failedStage}): ${String(g.reason).slice(0, 90)}`;
  const c = g.census, p = g.play;
  return [g.id, 'ok', `mode ${g.core?.mode || '-'}/${g.core?.interaction || '-'}`, `kind/view ${g.kindView?.ok ? 'kept' : `LOST (${(g.kindView?.problems || []).join('; ')})`}`,
    `avatar ${g.avatar?.ok === null ? '-' : g.avatar?.ok ? 'fits' : g.avatar?.has ? 'UNNEEDED' : 'MISSING'}`, `core ${g.coverage ? `${g.coverage.covered} covered, ${g.coverage.gapped} gapped${g.coverage.dropped.length ? `, DROPPED ${g.coverage.dropped.join(',')}` : ''}` : '-'}`, `arch ${c.archetypesReal}/${c.archetypes} real, ${c.archetypesPlaced} placed`, `spawns ${c.spawnRulesNonPlayer}+${c.spawnEffects}fx`, `rt ents ${c.runtime?.entities ?? '-'}`, `items ${c.items}`, `chars ${c.characters}`,
    `quests ${c.questsRead}/${c.quests}`, `dlg ${c.dialogueRead}/${c.dialogue}`, `zones ${c.zonesDistinct}/${c.zones} distinct`, `play: ${p.crashes ? `CRASH ${p.crashCodes.join(',')}` : 'no crash'}, explored ${p.explored}, completed ${p.completed === undefined ? (p.ending ? 'yes' : 'no') : p.completed ? `yes (${p.by}${p.trace != null ? `, trace ${p.trace}` : ''})` : 'no'}`,
    `playable ${g.timings?.requestToFirstPlayableMs != null ? `${(g.timings.requestToFirstPlayableMs / 1000).toFixed(1)}s` : '-'}${g.timings?.requestToThemedMs != null ? `, themed ${(g.timings.requestToThemedMs / 1000).toFixed(1)}s` : ''}, total ${Math.round((g.timings?.totalMs ?? g.ms) / 1000)}s`].join(' | ');
}

/**
 * Re-measure saved bench runs with today's measures (census, the playtest agent and mode bots, kind/view, avatar
 * fit against the idea's expectation, core coverage), so runs made by older code compare column for column.
 * Zero model calls. dirs: bench run directories (each with report.json and <idea>.json documents).
 */
export async function evaluateRuns(dirs) {
  const base = await loadCatalogue();
  const rows = [];
  for (const dir of dirs) {
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    for (const g of report.games) {
      const idea = [...IDEAS, ...ORIGINAL_IDEAS].find(i => i.id === g.id) || {};
      const file = join(dir, `${g.id}.json`);
      const row = { id: g.id, run: report.label || dir, ok: g.ok && existsSync(file), reason: g.reason || null, failedStage: g.failedStage || null, timings: g.timings || null, ms: g.ms, modelCalls: (g.modelCalls || []).length };
      if (row.ok) {
        const doc = JSON.parse(readFileSync(file, 'utf8'));
        const cat = doc?.experiments?.length ? await catalogueForDoc(doc) : base;
        const decomposition = { views: g.decomposition?.views || [], core: g.core || null };
        const mech = g.mechanics || [];
        Object.assign(row, {
          kindView: kindViewPreserved(decomposition, doc, cat.registry), avatar: avatarFit(decomposition, doc, cat.registry, idea.avatar),
          // A core mechanic mapped to nothing was reported as a gap by the selection.
          coverage: coreCoverage({ mechanics: mech }, doc, mech.filter(m => !(m.primitives || []).length).map(m => ({ mechanic: m.id }))),
          census: census(doc, cat.registry, cat.logic), play: await playReport(doc, cat.registry, cat.logic), core: g.core || null,
        });
      }
      rows.push(row);
      process.stderr.write(`${row.id}: ${row.ok ? 'measured' : 'failed run'}\n`);
    }
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--evaluate')) {
  const rest = process.argv.slice(process.argv.indexOf('--evaluate') + 1), end = rest.findIndex(a => a.startsWith('--'));
  const dirs = end < 0 ? rest : rest.slice(0, end);
  const rows = await evaluateRuns(dirs);
  const out = arg('out', fileURLToPath(new URL('../../local-data/v2/bench/generation/evaluated.json', import.meta.url)));
  writeFileSync(out, JSON.stringify(rows, null, 1));
  for (const r of rows) console.log(`${r.run} | ${row(r)}`);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const only = arg('only') ? new Set(arg('only').split(',')) : null;
  const set = arg('set') === 'original' ? ORIGINAL_IDEAS : IDEAS;
  const ideas = only ? set.filter(i => only.has(i.id)) : set;
  const out = arg('out', fileURLToPath(new URL('../../local-data/v2/bench/generation/', import.meta.url)));
  const runDir = join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}${arg('label') ? '-' + arg('label').replace(/[^a-z0-9-]/gi, '_') : ''}`);
  mkdirSync(runDir, { recursive: true });
  const report = await runGenerationBench({ ideas, replay: arg('replay', 'auto'), offline: flag('offline'), label: arg('label'), outDir: runDir });
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ dir: runDir, context: { commit: report.context.sourceCommit, dirty: report.context.dirty, writers: report.context.writers, servedModels: report.context.servedModels, decisions: report.context.decisions }, summary: report.summary }, null, 1));
}
