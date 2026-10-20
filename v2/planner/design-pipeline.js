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
import { routeIdea, routeOptions, PLANNED } from './router.js';
import { runKitPipeline, KIT_GAME_SCHEMA } from './kit-pipeline.js';
import { checkRevision, NOT_APPLIED } from './revision-check.js';

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
    // Longer levels need longer searches: ~25 ms per column, 1.5–4 s.
    const check = checkArcade(spec, registry, { budgetMs: Math.min(4000, Math.max(1500, 25 * spec.level.rows[0].length)) });
    last = { spec, check, attempt };
    if (check.ok) return last;
  }
  // "Collect everything" that the playtester can't verify falls back to reaching the goal, and says so.
  if (design.mechanics?.collectAllToWin) {
    const relaxed = buildVerified({ ...design, mechanics: { ...design.mechanics, collectAllToWin: false } }, { seed, registry, attempts });
    if (relaxed.check.ok) return { ...relaxed, relaxed: ['collectAllToWin'] };
  }
  return last;
}

export function createDesignPipeline({ client, model, effort, registry = defaultRegistry(), art = null, decisions = null }) {
  return async function pipeline(job, ctx) {
    const previous = job.base ? await ctx.store.version(job.gameId, job.base) : null;
    // Kit games revise inside their kit; new ideas are routed to the engine that plays their genre.
    if (previous?.doc?.schema === KIT_GAME_SCHEMA) return runKitPipeline(job, ctx, { client, model, kitId: previous.doc.kit, previous, art, decisions });
    let route = null;
    if (!previous) {
      const known = job.route && (await routeOptions()).some(o => o.id === job.route.engine || job.route.engine === 'none');
      if (!known) ctx.stage('routing', { model });
      route = known ? { ...job.route, ms: 0 } : await routeIdea({ client, model, decisions, prompt: job.prompt, answers: job.answers });
      ctx.stage('routed', { engine: route.engine, needs: route.needs, why: route.why, ms: route.ms });
      if (route.engine !== 'arcade' && route.engine !== 'none') return runKitPipeline(job, ctx, { client, model, kitId: route.engine, previous: null, art, route, decisions });
    }
    ctx.stage(previous ? 'revising' : 'designing', { model });
    let lastDraft = 0;
    const onDelta = text => { const now = performance.now(); if (now - lastDraft < 150) return; lastDraft = now; ctx.draft({ partial: partialSpec(text) }); };
    const reply = await client.complete({ model, effort, system: DESIGN_PROMPT, user: designRequest({ prompt: job.prompt, answers: job.answers, previousDesign: previous?.report?.design, change: job.change }), schema: { name: 'game_design', schema: DESIGN_SCHEMA }, onDelta });
    const design = JSON.parse(reply.text);
    // On revisions, check the change really happened (same check every game type uses).
    const revisionCheck = previous && job.change ? await checkRevision(decisions, { change: job.change, engine: 'side-scrolling or top-down 2D action', before: previous.report?.design, after: design, unsupported: (design.gaps || []).map(g => ({ request: g.capability })) }) : null;
    if (revisionCheck?.applied != null && revisionCheck.applied < NOT_APPLIED && !(design.gaps || []).length) design.gaps = [{ capability: job.change, why: revisionCheck.why }];
    // No engine plays this genre yet: say so plainly rather than pass a different genre off as the idea.
    if (route && route.needs && route.needs !== 'none') design.gaps = [{ capability: `${PLANNED[route.needs] || route.needs} kit`, why: `${route.why} This version is the closest platformer/top-down game until that kit exists.` }, ...(design.gaps || [])];
    const seed = previous?.provenance?.seed ?? job.seed ?? seedFrom(job.prompt);
    ctx.stage('building', { ms: reply.ms });
    // Procedural art: the art direction call runs while the level builds, so the first playable already has its art.
    const directing = art?.procedural ? art.direct({ design, previous, change: job.change || null }) : null;
    const built = buildVerified(design, { seed, registry });
    ctx.draft({ partial: { title: built.spec.title, pitch: built.spec.pitch, background: built.spec.background, rows: built.spec.level.rows, legend: built.spec.level.legend, entities: built.spec.entities }, complete: true });
    ctx.stage('playtested', { winnable: built.check.report?.playtest?.winnable ?? false, attempt: built.attempt });
    if (!built.check.spec) throw Object.assign(Error(`The game failed checks: ${built.check.problems.map(p => p.code).join(', ')}`), { status: 422 });
    await ctx.store.updateMeta(job.gameId, { title: built.spec.title, kind: 'arcade2d' });
    let painted = null;
    if (directing) {
      ctx.stage('painting', { generator: 'procedural' });
      painted = await art.paint({ job, ctx, spec: built.spec, directed: await directing, previous });
      ctx.stage('painted', { ms: painted.report.paintMs, assets: painted.report.assets, reused: painted.report.reused, changed: painted.report.changed });
    }
    const record = await ctx.publish({
      doc: painted ? { ...built.spec, art: painted.art } : built.spec, stage: previous ? `revision: ${job.change}` : 'playable',
      report: { ...built.check.report, kind: 'arcade2d', design, route, revisionCheck, changes: revisionCheck?.summary || [], ...(painted ? { art: painted.report } : {}), summary: design.summary, gaps: (design.gaps || []).map(g => / kit$/.test(g.capability) ? g : { ...g, kind: 'unsupported' }), verified: built.check.ok, relaxed: built.relaxed || [], layoutAttempts: built.attempt + 1, modelMs: reply.ms, firstTokenMs: reply.firstMs, change: job.change || null },
      provenance: { pipeline: DESIGN_PIPELINE_VERSION, model: reply.model, seed, prompt: job.prompt, answers: job.answers || [], change: job.change || null, base: job.base || null, designHash: hashOf(design), specHash: hashOf(built.spec) },
    });
    if (art && !art.procedural) await art(job, ctx, { design, spec: built.spec, record });
  };
}
