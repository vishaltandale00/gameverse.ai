#!/usr/bin/env node
// Generation-quality benchmark: runs the real kernel pipeline in-process (no server) over a fixed set
// of ideas and records, per game, whether it succeeded (and why not), a content census of what was
// generated (v2/planner/census.js), what the project's playtest agent found when it played the final
// document (verifyDocument with a playtest budget: crashes, explored states, ending reached), the
// stage timings and every model call (purpose, served model id, ms, tokens).
// Timing context follows AGENTS.md (run id, commit + dirty flag, catalogue hash, pipeline version and
// config, writers, decisions provider, machine and load); values that were not measured are null.
//
//   node v2/tools/generation-bench.mjs [--offline] [--only id,id] [--label text] [--out dir] [--playtest-ms 3000]
// Live runs make real model calls (one full pipeline run per idea) and are a qualification run, not CI.
import { writeFileSync, mkdirSync } from 'node:fs';
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
import { catalogueForDoc } from '../experiments/primitive.js';
import { memoryCtx } from './kernel-bench.mjs';

// The fixed idea set (the user's list). Seeds are fixed per idea so runs are comparable.
export const IDEAS = [
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
const PURPOSES = [[/^You decompose/, 'decompose'], [/^You map game mechanics/, 'map'], [/^You check a mechanic mapping/, 'map_check'], [/^You write game documents/, 'outline'], [/^You add detail/, 'detail'], [/^You (revise|change)/, 'revise']];
const purposeOf = system => PURPOSES.find(([re]) => re.test(String(system || '')))?.[1] || 'other';

/** Wrap a writer so every call is recorded (purpose, served model, ms, tokens, ok). */
function recording(writer, calls) {
  if (!writer) return null;
  return { ...writer, async complete(req) {
    const t = performance.now(), purpose = purposeOf(req.system);
    try {
      const r = await writer.complete(req);
      calls.push({ purpose, model: r.model || writer.model, ms: r.ms ?? Math.round(performance.now() - t), strict: Boolean(req.schema), input: r.usage?.input_tokens ?? r.usage?.prompt_tokens ?? null, output: r.usage?.output_tokens ?? r.usage?.completion_tokens ?? null, ok: true });
      return r;
    } catch (error) { calls.push({ purpose, model: writer.model, ms: Math.round(performance.now() - t), ok: false, error: String(error?.message || error).slice(0, 160) }); throw error; }
  } };
}

/** The playtest agent's report on one document (the publish gate's verifier, with a playtest budget). */
export async function playReport(doc, registry, logic, { playtestMs = 3000, budgetMs = 1500 } = {}) {
  const v = await verifyDocument(doc, registry, logic, { budgetMs, playtestMs });
  const crashes = (v.problems || []).filter(p => CRASH.has(p.code) && p.severity !== 'warning' && p.severity !== 'info');
  return {
    viable: Boolean(v.viable), completable: v.completable ?? null, crashes: crashes.length, crashCodes: [...new Set(crashes.map(p => p.code))],
    explored: v.playtest?.explored ?? null, winnable: v.playtest?.winnable ?? null, ending: v.playtest?.win?.ending ?? null, winSeconds: v.playtest?.win?.seconds ?? null,
    errors: (v.problems || []).filter(p => p.severity === 'error').map(p => p.code).slice(0, 12), ms: v.ms,
  };
}

export async function runGenerationBench({ ideas = IDEAS, offline = false, env = process.env, label = null, config = {}, playtestMs = 3000, outDir = null, writers: given = null, decisions: givenDecisions } = {}) {
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
    const writers = { spec: recording(raw.spec, calls), code: raw.code };
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
        census: census(out.doc, cat.registry, cat.logic), outlineCensus: fp ? census(fp, cat.registry, cat.logic, { boot: 0 }) : null,
        play: await playReport(out.doc, cat.registry, cat.logic, { playtestMs }),
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
      sourceCommit: commit, dirty, pipeline: KERNEL_PIPELINE_VERSION, config: { ...PIPELINE_CONFIG, ...config }, playtestMs,
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
  return [g.id, 'ok', `kind/view ${g.kindView?.ok ? 'kept' : `LOST (${(g.kindView?.problems || []).join('; ')})`}`, `arch ${c.archetypesReal}/${c.archetypes} real, ${c.archetypesPlaced} placed`, `spawns ${c.spawnRulesNonPlayer}+${c.spawnEffects}fx`, `rt ents ${c.runtime?.entities ?? '-'}`, `items ${c.items}`, `chars ${c.characters}`,
    `quests ${c.questsRead}/${c.quests}`, `dlg ${c.dialogueRead}/${c.dialogue}`, `zones ${c.zonesDistinct}/${c.zones} distinct`, `play: ${p.crashes ? `CRASH ${p.crashCodes.join(',')}` : 'no crash'}, explored ${p.explored}, ending ${p.ending || 'none'}`,
    `total ${Math.round((g.timings?.totalMs ?? g.ms) / 1000)}s`].join(' | ');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const only = arg('only') ? new Set(arg('only').split(',')) : null;
  const ideas = only ? IDEAS.filter(i => only.has(i.id)) : IDEAS;
  const out = arg('out', fileURLToPath(new URL('../../local-data/v2/bench/generation/', import.meta.url)));
  const runDir = join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}${arg('label') ? '-' + arg('label').replace(/[^a-z0-9-]/gi, '_') : ''}`);
  mkdirSync(runDir, { recursive: true });
  const report = await runGenerationBench({ ideas, offline: flag('offline'), label: arg('label'), playtestMs: Number(arg('playtest-ms', 3000)), outDir: runDir });
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ dir: runDir, context: { commit: report.context.sourceCommit, dirty: report.context.dirty, writers: report.context.writers, servedModels: report.context.servedModels, decisions: report.context.decisions }, summary: report.summary }, null, 1));
}
