// Generate playable 2D games (gameverse.v2.game-spec/0.1) with a model:
// write spec -> preflight (+1 repair) -> headless playtest -> repair once if
// the playtest finds errors -> publish. Every version records its spec hash,
// seed, model and playtest report, so results replay exactly.
import { readFileSync, readdirSync } from 'node:fs';
import { defaultRegistry } from '../modules/index.js';
import { preflight } from '../engine/spec.js';
import { compose } from '../engine/compose.js';
import { playtest } from '../engine/playtest.js';
import { systemPrompt, createMessage, repairMessage } from './prompt.js';
import { parseJsonObject } from './models.js';
import { hashOf } from '../server/store.js';

export const ARCADE_PIPELINE_VERSION = 'v2-arcade/0.1';
const examplesDir = new URL('../examples/', import.meta.url);
export const loadArcadeExamples = () => readdirSync(examplesDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(new URL(f, examplesDir), 'utf8')));

export function checkArcade(spec, registry, { budgetMs = 1500 } = {}) {
  const checked = preflight(spec, registry);
  if (!checked.ok) return { ok: false, problems: checked.errors, report: { preflight: { ok: false, errors: checked.errors, warnings: checked.warnings } } };
  const report = playtest(compose(checked.spec, registry), { budgetMs });
  const problems = report.issues.filter(i => i.severity === 'error').map(i => ({ code: i.code, message: i.message }));
  if (!report.winnable && !problems.length) problems.push({ code: 'goal_not_reached', message: report.issues.find(i => i.code === 'goal_not_reached')?.message || 'the automated playtester could not reach the win condition', hint: 'make the goal reachable: lower platforms, raise jumpSpeed, remove blocking walls' });
  return { ok: !problems.length, playable: report.ok, spec: checked.spec, problems, report: { preflight: { ok: true, warnings: checked.warnings }, playtest: report } };
}

export function createArcadePipeline({ client, model, registry = defaultRegistry(), examples = loadArcadeExamples(), repairs = 2 }) {
  const system = systemPrompt(registry, examples);
  return async function pipeline(job, ctx) {
    ctx.stage('designing', { model });
    const conversation = [createMessage(job.prompt, job.previous)];
    let draft, check, modelMs = 0, attempt = 0;
    for (;;) {
      const reply = await client.complete({ model, system, user: conversation.join('\n\n') });
      modelMs += reply.ms;
      try { draft = parseJsonObject(reply.text); }
      catch (error) { draft = null; check = { ok: false, problems: [{ code: 'model_output_not_json', message: error.message }] }; }
      if (draft) { draft.spec = { seed: job.seed ?? 1, ...draft.spec }; check = checkArcade(draft.spec, registry); }
      ctx.stage(check.ok ? 'verified' : 'checking', { attempt, problems: check.problems?.length || 0, winnable: check.report?.playtest?.winnable ?? null, ms: modelMs });
      if (check.ok || attempt >= repairs) break;
      attempt++;
      ctx.stage('repairing', { attempt, problems: check.problems.slice(0, 4).map(p => p.code) });
      conversation.push(`Your previous reply:\n${JSON.stringify(draft ?? {})}`, repairMessage(check.problems));
    }
    if (!check.spec) throw Object.assign(Error(`The model's game failed checks: ${check.problems.map(p => p.code).join(', ')}`), { status: 422 });
    await ctx.store.updateMeta(job.gameId, { title: check.spec.title, kind: 'arcade2d' });
    await ctx.publish({
      doc: check.spec, stage: check.ok ? 'playable' : 'playable_unverified',
      report: { ...check.report, kind: 'arcade2d', summary: draft.summary || '', gaps: draft.gaps || [], repairs: attempt, verified: check.ok, modelMs },
      provenance: { pipeline: ARCADE_PIPELINE_VERSION, model, seed: check.spec.seed, prompt: job.prompt, specHash: hashOf(check.spec), catalogHash: hashOf(registry.cards()) },
    });
  };
}
