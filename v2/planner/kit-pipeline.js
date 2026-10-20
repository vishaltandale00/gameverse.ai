// Generation for genre-kit games: the model writes the kit's content (schema-
// constrained), the kit validates and verifies it, the art direction runs in
// parallel, and one version publishes with its art. Revisions rewrite content
// against the current content; the art stays locked (see art-procedural.js).
import { loadKit } from '../kits/registry.js';
import { modsFor, modsSchema, modsPrompt } from '../kits/mods/compose.js';
import { checkRevision, changeSummary, NOT_APPLIED } from './revision-check.js';
import { hashOf } from '../server/store.js';
import { seedFrom } from '../engine/rng.js';

export const KIT_GAME_SCHEMA = 'gameverse.v2.kit-game/0.1';
export const KIT_PIPELINE_VERSION = 'v2-kit/0.1';

const slug = (s, d) => ((s || '').toLowerCase().match(/[a-z0-9]+/g) || [d]).join('-').slice(0, 40) || d;

/** The art director's view of a kit game: a design-shaped brief and an entity map. */
function artInputs(kit, content, doc) {
  const { brief, entities } = kit.cast(content);
  const design = { title: doc.title, pitch: doc.logline, view: 'topdown', artStyle: content.artStyle || '', cast: brief, background: content.background };
  return { design, spec: { id: doc.id, title: doc.title, entities } };
}

function contentRequest({ prompt, answers, previous, change }) {
  if (previous) return `Current game (content and mods):\n${JSON.stringify(previous)}\n\nChange request: ${change}\nKeep everything the request doesn't mention.`;
  return `Game idea: ${prompt}${answers?.length ? `\n\nPlayer preferences:\n${answers.map(a => `- ${a.question}: ${a.answer}`).join('\n')}` : ''}`;
}

export async function runKitPipeline(job, ctx, { client, model, kitId, previous, art, route, decisions = null }) {
  const kit = await loadKit(kitId);
  const previousContent = previous?.doc?.schema === KIT_GAME_SCHEMA ? previous.doc.content : null;
  const available = modsFor(kit);
  ctx.stage(previousContent ? 'revising' : 'designing', { model, kit: kit.id });
  // Write content; if it fails validation, send the errors back once for repair.
  let content = null, unsupported = [], checked = null, reply = null, attempts = 0, user = contentRequest({ prompt: job.prompt, answers: job.answers, previous: previousContent && { content: previousContent, mods: previous.doc.mods || {} }, change: job.change });
  let mods = previous?.doc?.mods || {};
  // The kit can only do what its schema expresses. Anything else the player asks for is listed,
  // never quietly dropped or claimed in the title and pitch ("Blaster Maze" with no blaster).
  const schema = { type: 'object', additionalProperties: false, required: ['content', ...(available.length ? ['mods'] : []), 'unsupported'], properties: {
    content: kit.content.schema,
    ...(available.length ? { mods: modsSchema(kit) } : {}),
    unsupported: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['request', 'why'], properties: { request: { type: 'string' }, why: { type: 'string' } } } },
  } };
  const system = `${kit.content.prompt}\n\nAll names, characters and levels must be original (inspired by the idea's mechanics, never copying another game's names or content).\nThis engine can do only what the content schema can express. If the idea or change request asks for anything the schema cannot express (a new button or action, a weapon, a mode, a mechanic, a rule), list each such request in "unsupported" with a short why, and do not mention it in the title or logline. If everything fits, "unsupported" is empty. Mixing in a mechanic a mod provides is supported: use the mod rather than listing it.${modsPrompt(kit)}\nReply with JSON matching the schema.`;
  while (attempts < 2) {
    attempts++;
    if (client) {
      reply = await client.complete({ model, system, user, schema: { name: `${kit.id}_content`, schema } });
      const parsed = JSON.parse(reply.text);
      ({ content, unsupported } = parsed);
      if (parsed.mods) mods = parsed.mods;
    } else content = previousContent || kit.content.sample;
    checked = kit.validate(content);
    if (checked.ok || !client) break;
    user = `${user}\n\nYour previous answer failed validation:\n${checked.errors.slice(0, 12).map(e => `- ${e.path}: ${e.message}`).join('\n')}\nReturn corrected content.`;
  }
  if (!checked.ok) throw Object.assign(Error(`The ${kit.name} content failed checks: ${checked.errors.slice(0, 4).map(e => e.code).join(', ')}`), { status: 422 });
  content = checked.content;

  const seed = previous?.provenance?.seed ?? job.seed ?? seedFrom(job.prompt);
  // Keep only mods this kit can run, normalized, so hosts and saves see a stable shape.
  mods = Object.fromEntries(available.map(m => [m.id, m.normalize(mods?.[m.id])]).filter(([id, cfg]) => available.find(m => m.id === id).enabled(cfg)));
  // On revisions, check that the change really happened; if not, say so rather than claim it.
  const revisionCheck = previousContent ? await checkRevision(decisions, { change: job.change, engine: kit.name, before: { content: previousContent, mods: previous.doc.mods || {} }, after: { content, mods }, unsupported: unsupported || [] }) : null;
  if (revisionCheck?.applied != null && revisionCheck.applied < NOT_APPLIED && !(unsupported || []).length)
    unsupported = [{ request: job.change, why: revisionCheck.why }];
  const doc = { schema: KIT_GAME_SCHEMA, kit: kit.id, kitVersion: kit.version, mods, id: previous?.doc?.id || slug(content.title, kit.id), title: content.title, logline: content.logline || '', seed, content };
  const inputs = artInputs(kit, content, doc);
  // Art direction runs while the kit verifies the content.
  const directing = art?.procedural ? art.direct({ design: inputs.design, previous: previous?.doc?.schema === KIT_GAME_SCHEMA ? { ...previous, report: { ...previous.report, design: previous.report?.artDesign } } : null, change: job.change || null }) : null;
  ctx.stage('building', { ms: reply?.ms ?? 0, kit: kit.id });
  const verifyStarted = performance.now();
  const verified = kit.verify(content, { seed, budgetMs: 2000 });
  ctx.stage('playtested', { winnable: verified.ok, kit: kit.id, ms: Math.round(performance.now() - verifyStarted) });
  if (!verified.ok) throw Object.assign(Error(`The game failed verification: ${verified.problems.slice(0, 4).map(p => p.code || p).join(', ')}`), { status: 422 });

  let painted = null;
  if (directing) {
    ctx.stage('painting', { generator: 'procedural' });
    painted = await art.paint({ job, ctx, spec: inputs.spec, directed: await directing, previous });
    ctx.stage('painted', { ms: painted.report.paintMs, assets: painted.report.assets, reused: painted.report.reused, changed: painted.report.changed });
  }
  await ctx.store.updateMeta(job.gameId, { title: doc.title, kind: `kit:${kit.id}` });
  return ctx.publish({
    doc: painted ? { ...doc, art: painted.art } : doc,
    stage: previousContent ? `revision: ${job.change}` : 'playable',
    report: { kind: `kit:${kit.id}`, kit: kit.id, verified: true, verification: verified.report, summary: content.logline, gaps: (unsupported || []).slice(0, 8).map(u => ({ capability: String(u.request).slice(0, 120), why: String(u.why).slice(0, 240), kind: 'unsupported' })), route: route || null, revisionCheck, changes: revisionCheck?.summary || [], artDesign: inputs.design, ...(painted ? { art: painted.report } : {}), modelMs: reply?.ms ?? 0, contentAttempts: attempts, change: job.change || null },
    provenance: { pipeline: KIT_PIPELINE_VERSION, kit: kit.id, kitVersion: kit.version, model: reply?.model || 'offline', seed, prompt: job.prompt, answers: job.answers || [], change: job.change || null, base: job.base || null, contentHash: hashOf(content) },
  });
}
