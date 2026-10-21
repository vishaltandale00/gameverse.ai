#!/usr/bin/env node
// Game-creation benchmarks (ARCHITECTURE.md §7) for the kernel pipeline:
//   request -> first playable latency (and its stages), preflight pass rate (first model pass and
//   after repair), plot-solver pass rate, detail patches accepted / proposed, replay determinism.
// Timing context follows AGENTS.md: run id, source commit (+ dirty flag), catalogue hash and size,
// pipeline/loop versions and config, writer models, decisions provider, machine and load. Failed
// runs are kept with the stage they failed in. Values that were not measured are null, not zero.
//
//   node v2/tools/kernel-bench.mjs [--offline] [--n 1] [--prompts file.txt] [--out dir] [--label text]
// --offline turns writers and decisions off (no model calls, no cost). Live runs use the configured
// providers (OPENAI_API_KEY from .env.local, d1 or OpenAI Decisions) and are a qualification run, not CI.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
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
import { replayCheck } from '../planner/first-playable.js';
import { verifyDocument } from '../planner/verify-adapter.js';
import { catalogueForDoc } from '../experiments/primitive.js';
import { hashOf } from '../server/store.js';

// Illustrations spanning different references and structures; never requirements.
export const DEFAULT_PROMPTS = [
  'A mystery in a lighthouse: talk to the keeper, find the missing key, open the lamp room',
  'Dark Souls meets Pokémon: catch creatures and fight hard bosses with stamina',
  'Call of Duty × Minecraft: mine blocks, build cover and shoot it out',
  'A cozy farming village where you grow crops and befriend neighbours',
  'Turn-based tactics on a grid with cover, against a robot army',
  'A deckbuilder where each card is a spell and you climb a tower',
];

const arg = (name, d = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = name => process.argv.includes(`--${name}`);
const pct = (xs, p) => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const rate = (xs) => { const v = xs.filter(x => x != null); return v.length ? +(v.filter(Boolean).length / v.length).toFixed(3) : null; };

export function memoryCtx(gameId) {
  const versions = [], stages = [], t0 = performance.now();
  return {
    versions, stages,
    ctx: {
      job: null,
      stage(name, detail = {}) { stages.push({ name, at: Math.round(performance.now() - t0), ...detail }); },
      draft() {},
      async publish(payload) { const record = { gameId, version: versions.length + 1, docHash: hashOf(payload.doc), at: Math.round(performance.now() - t0), ...payload }; versions.push(record); return record; },
      store: { async updateMeta() {}, async version(_, v) { return versions[v - 1] || null; }, async latest() { return versions.at(-1) || null; } },
    },
  };
}

/** Run the benchmark in-process (`writers`: scripted writers instead of none or live ones). Returns the full report (also used by tests with --offline semantics). */
export async function runBench({ prompts = DEFAULT_PROMPTS, n = 1, offline = true, env = process.env, label = null, config = {}, writers: scripted = null } = {}) {
  const started = Date.now();
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const base = await loadCatalogue();
  const openaiKey = offline ? null : loadOpenAIKey(env, repo);
  // `writers` scripts the spec model of an offline run (tests): offline means no live call, and without any writer nothing is picked.
  const writers = scripted || (offline ? { spec: null, code: null } : await createWriters(env, { openaiKey }));
  const decisions = offline ? null : createDecisions(env, { openaiKey });
  const catalogue = async doc => (doc?.experiments?.length ? catalogueForDoc(doc) : base);
  const pipeline = createKernelPipeline({ catalogue, writers, decisions, config });
  const runs = [];
  for (let r = 0; r < n; r++) for (const prompt of prompts) {
    const gameId = `bench-${runs.length}`;
    const { ctx, versions, stages } = memoryCtx(gameId);
    const job = { gameId, prompt, answers: [], kind: 'create', seed: r + 1, queuedMs: 0 };
    ctx.job = job;
    const t = performance.now();
    const run = { prompt, repeat: r, ok: false, failedStage: null, error: null };
    try {
      const out = await pipeline(job, ctx);
      const fp = versions.find(v => v.stage === 'first_playable');
      const finalDoc = out.doc;
      const cat = await catalogue(finalDoc);
      const final = await verifyDocument(finalDoc, cat.registry, cat.logic);
      const replay = replayCheck(final.doc || finalDoc, cat.registry, cat.logic, { seed: finalDoc.seed, steps: 240 });
      Object.assign(run, {
        ok: true, ms: Math.round(performance.now() - t), timings: out.timings,
        requestToFirstPlayableMs: out.timings.requestToFirstPlayableMs, firstPlayableBuildMs: out.timings.firstPlayableBuildMs,
        decomposition: { source: out.decomposition.source, references: out.decomposition.references.map(x => x.name), mechanics: out.decomposition.mechanics.length },
        selection: { spaces: out.selection.spaces.map(s => s.use), systems: out.selection.systems.length, gaps: out.selection.gaps.length, provider: out.selection.provider || 'lexical' },
        outline: out.outline, preflightFirstPass: out.outline.firstPassOk, preflightAfterRepair: true,
        firstPlayableCompletable: out.firstVerification?.completable ?? null, finalCompletable: final.completable, finalExhaustive: final.exhaustive,
        detail: { proposed: out.detail.proposed, accepted: out.detail.accepted, rejected: out.detail.rejected, tasks: out.detail.tasks },
        replayDeterministic: replay.deterministic, replayHash: replay.hash, versions: versions.length, docHash: hashOf(finalDoc),
      });
    } catch (error) {
      run.ms = Math.round(performance.now() - t);
      run.error = String(error?.message || error).slice(0, 300);
      run.failedStage = stages.at(-1)?.name || 'start';
      run.preflightAfterRepair = !/outline failed checks/.test(run.error) ? null : false;
    }
    run.stages = stages.map(s => ({ name: s.name, at: s.at, ms: s.ms ?? null }));
    runs.push(run);
    process.stderr.write(`${run.ok ? 'ok ' : 'ERR'} ${String(run.requestToFirstPlayableMs ?? '-').padStart(6)} ms to first playable · ${prompt.slice(0, 60)}${run.error ? ` · ${run.error}` : ''}\n`);
  }
  const ok = runs.filter(r => r.ok);
  const proposed = ok.reduce((a, r) => a + r.detail.proposed, 0), accepted = ok.reduce((a, r) => a + r.detail.accepted, 0);
  let commit = null, dirty = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim().length > 0; } catch {}
  const cpus = os.cpus();
  return {
    schema: 'gameverse.v2.kernel-bench/0.1', runId: `${new Date(started).toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`, label,
    startedAt: new Date(started).toISOString(), wallMs: Date.now() - started,
    context: {
      sourceCommit: commit, dirty, pipeline: KERNEL_PIPELINE_VERSION, config: { ...PIPELINE_CONFIG, ...config },
      catalogHash: catalogHash(base.registry), primitives: base.registry.ids().length, primitiveIds: base.registry.ids(),
      writers: { spec: writers.spec ? `${writers.spec.provider}:${writers.spec.model}` : null, code: writers.code ? `${writers.code.provider}:${writers.code.model}` : null },
      decisions: decisions?.provider ?? null, offline,
      machine: { platform: os.platform(), release: os.release(), arch: os.arch(), cpuModel: cpus[0]?.model || null, cpuCount: cpus.length, memoryGb: Math.round(os.totalmem() / 2 ** 30), node: process.version, loadavg: os.loadavg().map(x => +x.toFixed(2)) },
      nesting: 'requestToFirstPlayableMs = decomposeMs + selectMs (includes the agency check) + outlineMs (contains outlineModelMs) + firstPlayableBuildMs (+ publish); firstVerifyMs and detailMs run after it; totalMs covers all',
    },
    summary: {
      runs: runs.length, succeeded: ok.length, failed: runs.length - ok.length,
      requestToFirstPlayableMs: { p50: pct(ok.map(r => r.requestToFirstPlayableMs), 0.5), p90: pct(ok.map(r => r.requestToFirstPlayableMs), 0.9), max: pct(ok.map(r => r.requestToFirstPlayableMs), 1) },
      firstPlayableBuildMs: { p50: pct(ok.map(r => r.firstPlayableBuildMs), 0.5), max: pct(ok.map(r => r.firstPlayableBuildMs), 1) },
      outlineMs: { p50: pct(ok.map(r => r.timings.outlineMs), 0.5), max: pct(ok.map(r => r.timings.outlineMs), 1) },
      decomposeMs: { p50: pct(ok.map(r => r.timings.decomposeMs), 0.5), max: pct(ok.map(r => r.timings.decomposeMs), 1) },
      totalMs: { p50: pct(ok.map(r => r.timings.totalMs), 0.5), max: pct(ok.map(r => r.timings.totalMs), 1) },
      preflightFirstPassRate: offline ? null : rate(ok.map(r => r.preflightFirstPass)), preflightFirstPassUnavailable: offline ? 'no model outline in offline mode (the procedural skeleton is valid by construction)' : undefined,
      preflightPassRate: rate(runs.map(r => (r.ok ? true : r.preflightAfterRepair))),
      outlineFallbackRate: rate(ok.map(r => r.outline.fellBack)),
      outlineIsolatedRate: rate(ok.map(r => r.outline.isolated)), // model outline kept, one+ primitive removed as a gap
      solverCompletableRate: { firstPlayable: rate(ok.map(r => r.firstPlayableCompletable)), final: rate(ok.map(r => r.finalCompletable)) },
      detailAcceptance: { accepted, proposed, ratio: proposed ? +(accepted / proposed).toFixed(3) : null },
      replayDeterministicRate: rate(ok.map(r => r.replayDeterministic)),
    },
    runs,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const promptsFile = arg('prompts');
  const prompts = promptsFile ? readFileSync(promptsFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean) : DEFAULT_PROMPTS;
  const report = await runBench({ prompts, n: Number(arg('n', 1)), offline: flag('offline'), label: arg('label') });
  const out = arg('out', fileURLToPath(new URL('../../local-data/v2/bench/', import.meta.url)));
  mkdirSync(out, { recursive: true });
  const file = join(out, `${report.runId}.json`);
  writeFileSync(file, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ file, context: { commit: report.context.sourceCommit, dirty: report.context.dirty, writers: report.context.writers, decisions: report.context.decisions, primitives: report.context.primitives, loadavg: report.context.machine.loadavg }, summary: report.summary }, null, 1));
}
