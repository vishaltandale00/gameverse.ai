// Fast generation: idea (+ answers) -> schema-constrained design (one short
// model call, streamed for live preview) -> deterministic level build ->
// preflight + playtest. Unwinnable builds are rebuilt (new layout seed, then
// a more generous jump) with no further model calls.
import { defaultRegistry } from '../modules/index.js';
import { DESIGN_SCHEMA, DESIGN_PROMPT, designToSpec } from './design.js';
import { checkArcade } from './arcade-pipeline.js';
import { partialSpec } from './partial.js';
import { hashOf } from '../server/store.js';
import { seedFrom } from '../engine/rng.js';

export const DESIGN_PIPELINE_VERSION = 'v2-design/0.1';

export function designRequest({ prompt, answers, previousDesign, change }) {
  const parts = [previousDesign ? `Current design:\n${JSON.stringify(previousDesign)}\n\nChange request: ${change}\nKeep everything the request doesn't mention.` : `Game idea: ${prompt}`];
  if (answers?.length) parts.push('Player preferences:\n' + answers.map(a => `- ${a.question}: ${a.answer}`).join('\n'));
  return parts.join('\n\n');
}

/** Build and verify a spec from a design, retrying layouts deterministically. */
export function buildVerified(design, { seed, registry = defaultRegistry(), attempts = 4 }) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const spec = designToSpec(design, { seed, attempt });
    const check = checkArcade(spec, registry, { budgetMs: 1200 });
    last = { spec, check, attempt };
    if (check.ok) return last;
  }
  return last;
}

export function createDesignPipeline({ client, model, effort, registry = defaultRegistry(), art = null }) {
  return async function pipeline(job, ctx) {
    const previous = job.base ? await ctx.store.version(job.gameId, job.base) : null;
    ctx.stage(previous ? 'revising' : 'designing', { model });
    let lastDraft = 0;
    const onDelta = text => { const now = performance.now(); if (now - lastDraft < 150) return; lastDraft = now; ctx.draft({ partial: partialSpec(text) }); };
    const reply = await client.complete({ model, effort, system: DESIGN_PROMPT, user: designRequest({ prompt: job.prompt, answers: job.answers, previousDesign: previous?.report?.design, change: job.change }), schema: { name: 'game_design', schema: DESIGN_SCHEMA }, onDelta });
    const design = JSON.parse(reply.text);
    const seed = previous?.provenance?.seed ?? job.seed ?? seedFrom(job.prompt);
    ctx.stage('building', { ms: reply.ms });
    const built = buildVerified(design, { seed, registry });
    ctx.draft({ partial: { title: built.spec.title, pitch: built.spec.pitch, background: built.spec.background, rows: built.spec.level.rows, legend: built.spec.level.legend, entities: built.spec.entities }, complete: true });
    ctx.stage('playtested', { winnable: built.check.report?.playtest?.winnable ?? false, attempt: built.attempt });
    if (!built.check.spec) throw Object.assign(Error(`The game failed checks: ${built.check.problems.map(p => p.code).join(', ')}`), { status: 422 });
    await ctx.store.updateMeta(job.gameId, { title: built.spec.title, kind: 'arcade2d' });
    const record = await ctx.publish({
      doc: built.spec, stage: previous ? `revision: ${job.change}` : 'playable',
      report: { ...built.check.report, kind: 'arcade2d', design, summary: design.summary, gaps: design.gaps || [], verified: built.check.ok, layoutAttempts: built.attempt + 1, modelMs: reply.ms, firstTokenMs: reply.firstMs, change: job.change || null },
      provenance: { pipeline: DESIGN_PIPELINE_VERSION, model: reply.model, seed, prompt: job.prompt, answers: job.answers || [], change: job.change || null, base: job.base || null, designHash: hashOf(design), specHash: hashOf(built.spec) },
    });
    if (art) await art(job, ctx, { design, spec: built.spec, record });
  };
}
