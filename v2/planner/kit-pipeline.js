// @ts-check
// Generation for genre-kit games: the model writes the kit's content (schema-
// constrained), the kit validates and verifies it, the art direction runs in
// parallel, and one version publishes with its art. Revisions rewrite content
// against the current content; the art stays locked (see art-procedural.js).
import { loadKit } from '../kits/registry.js';
import { modsFor, modsSchema, modsPrompt } from '../kits/mods/compose.js';
import { checkRevision, changeSummary, NOT_APPLIED, shrunkLists, asksToRemove, usesFranchiseNames } from './revision-check.js';
import { hashOf } from '../server/store.js';
import { seedFrom } from '../engine/rng.js';
import { list, obj, prop } from '../kernel/guards.js';

/** @typedef {import('./arcade-pipeline.js').PipelineContext} PipelineContext */
/** @typedef {import('./design-pipeline.js').Answer} Answer */
/** Kit content after the kit's own `validate` (normalized; KIT_CONTRACT.md). @typedef {{ title: string, logline?: string, artStyle?: string, background?: unknown, [k: string]: unknown }} KitContent */
/** @typedef {{ code?: string, path?: string, message?: string, hint?: string, budgetExhausted?: boolean }} KitProblem */
/** @typedef {{ ok: boolean, errors: KitProblem[], warnings?: unknown[], content: KitContent }} KitValidation */
/** @typedef {{ ok: boolean, problems: (string | KitProblem)[], warnings?: unknown[], report?: unknown }} KitVerification */
/** @typedef {{ name?: string, glyph?: string } | null | undefined} KitCastMember */
/**
 * A genre kit as KIT_CONTRACT.md describes it (the slice this pipeline uses).
 * @typedef {object} Kit
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {{ schema: Record<string, unknown>, prompt: string, sample: unknown }} content
 * @property {(content: unknown) => KitValidation} validate
 * @property {(content: unknown) => { brief?: Record<string, KitCastMember>, entities: Record<string, unknown> }} cast
 * @property {(content: unknown, options: { seed: unknown, budgetMs: number }) => KitVerification} verify
 */
/** @typedef {{ gameId: string, prompt: string, answers?: Answer[], change?: string | null, seed?: number, base?: unknown }} KitJob */
/**
 * @typedef {object} KitOptions
 * @property {import('./openai.js').OpenAIClient | null} client  null runs the kit's sample content (offline)
 * @property {string} model
 * @property {string} kitId
 * @property {unknown} previous  the stored version this revises, if any
 * @property {import('./art-procedural.js').ProceduralArt | null} art
 * @property {unknown} [route]
 * @property {import('./decisions.js').DecisionClient | null} [decisions]
 * @property {'any' | 'original'} [names]
 */

export const KIT_GAME_SCHEMA = 'gameverse.v2.kit-game/0.1';
export const KIT_PIPELINE_VERSION = 'v2-kit/0.1';

/** @param {string | undefined} s @param {string} d @returns {string} */
const slug = (s, d) => ((s || '').toLowerCase().match(/[a-z0-9]+/g) || [d]).join('-').slice(0, 40) || d;

/** The art director's view of a kit game: a design-shaped brief and an entity map.
 * @param {Kit} kit @param {KitContent} content @param {{ id: unknown, title: string, logline: string }} doc */
function artInputs(kit, content, doc) {
  const { brief, entities } = kit.cast(content);
  const design = { title: doc.title, pitch: doc.logline, view: 'topdown', artStyle: content.artStyle || '', cast: brief, background: content.background };
  return { design, spec: { id: doc.id, title: doc.title, entities } };
}

/** @param {{ prompt: string, answers?: Answer[], previous: unknown, change?: string | null }} request */
function contentRequest({ prompt, answers, previous, change }) {
  if (previous) return `Current game (content and mods):\n${JSON.stringify(previous)}\n\nChange request: ${change}\nKeep everything the request doesn't mention.`;
  return `Game idea: ${prompt}${answers?.length ? `\n\nPlayer preferences:\n${answers.map(a => `- ${a.question}: ${a.answer}`).join('\n')}` : ''}`;
}

/** @param {KitJob} job @param {PipelineContext} ctx @param {KitOptions} options */
export async function runKitPipeline(job, ctx, { client, model, kitId, previous, art, route, decisions = null, names = 'any' }) {
  /** @type {Kit} */
  const kit = await loadKit(kitId);
  // The previous version is stored data: narrowed here.
  const prev = obj(previous), prevDoc = obj(prev.doc), prevReport = obj(prev.report);
  const previousContent = prevDoc.schema === KIT_GAME_SCHEMA ? prevDoc.content : null;
  const available = modsFor(kit);
  ctx.stage(previousContent ? 'revising' : 'designing', { model, kit: kit.id });
  // Write content; if it fails validation, send the errors back once for repair.
  /** @type {unknown} */ let draft = null;
  /** @type {Record<string, unknown>[]} */ let unsupported = [];
  /** @type {KitValidation | null} */ let checked = null;
  /** @type {import('./openai.js').OpenAIResult | null} */ let reply = null;
  let attempts = 0, user = contentRequest({ prompt: job.prompt, answers: job.answers, previous: previousContent && { content: previousContent, mods: prevDoc.mods || {} }, change: job.change });
  /** @type {unknown} */ let mods = prevDoc.mods || {};
  // The kit can only do what its schema expresses. Anything else the player asks for is listed,
  // never quietly dropped or claimed in the title and pitch ("Blaster Maze" with no blaster).
  const schema = { type: 'object', additionalProperties: false, required: ['content', ...(available.length ? ['mods'] : []), 'unsupported'], properties: {
    content: kit.content.schema,
    ...(available.length ? { mods: modsSchema(kit) } : {}),
    unsupported: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['request', 'why'], properties: { request: { type: 'string' }, why: { type: 'string' } } } },
  } };
  const system = `${kit.content.prompt}\n\n${names === 'original' ? 'All names, characters and levels must be original (inspired by the idea\'s mechanics, never copying another game\'s names or content). When the player asks for an existing character, add an original look-alike: the same silhouette, palette, signature moves and personality, under a new name.' : 'Existing characters, names and settings may be used when the player asks for them (this overrides any instruction above to keep names original): give them their recognizable look, signature moves and personality. Levels and other content you invent are still your own.'}\nThis engine can do only what the content schema can express. If the idea or change request asks for anything the schema cannot express (a new button or action, a weapon, a mode, a mechanic, a rule), list each such request in "unsupported" with a short why, and do not mention it in the title or logline. If everything fits, "unsupported" is empty. Mixing in a mechanic a mod provides is supported: use the mod rather than listing it.${modsPrompt(kit)}\nReply with JSON matching the schema.`;
  // Generate, validate, verify. Validation errors and verification problems (a level the bot
  // can't clear, a target nobody can reach) go back to the model for repair, up to three tries.
  const seed = prop(prev.provenance, 'seed') ?? job.seed ?? seedFrom(job.prompt);
  /** @type {KitVerification | null} */ let verified = null;
  let verifyMs = 0;
  while (attempts < 3) {
    attempts++;
    if (client) {
      reply = await client.complete({ model, system, user, schema: { name: `${kit.id}_content`, schema } });
      const parsed = obj(JSON.parse(reply.text)); // model output, narrowed; the kit validates the content
      draft = parsed.content; unsupported = list(parsed.unsupported).map(obj);
      if (parsed.mods) mods = parsed.mods;
    } else draft = previousContent || kit.content.sample;
    // A revision must keep what it wasn't asked to remove (8 levels must not quietly become 1).
    if (previousContent && client && attempts < 3) {
      const shrunk = shrunkLists(previousContent, draft);
      if (shrunk.length && !(await asksToRemove(decisions, job.change, shrunk))) {
        user = `${user}\n\nYour previous answer dropped content the request did not ask to remove: ${shrunk.map(s => `${s.path} went from ${s.before} to ${s.after} items${s.removed ? ` and lost ${s.removed.join(', ')}` : ''}`).join('; ')}. Keep every existing item exactly as it was (same ids and names) and add or change only what the request asks.`;
        continue;
      }
    }
    checked = kit.validate(draft);
    if (!checked.ok) {
      if (!client) break;
      user = `${user}\n\nYour previous answer failed validation:\n${checked.errors.slice(0, 12).map(e => `- ${e.path}: ${e.message}`).join('\n')}\nReturn corrected content.`;
      continue;
    }
    // Original names only: franchise names in the title or cast go back for renaming.
    if (names === 'original' && client && attempts < 3) {
      const brief = kit.cast(checked.content).brief || {};
      const names = [checked.content.title, ...Object.values(brief).map(b => b?.name)].filter(n => typeof n === 'string' && n);
      const franchise = await usesFranchiseNames(decisions, names);
      if (franchise?.flagged) {
        user = `${user}\n\nYour previous answer used existing game or character names (${names.slice(0, 6).join(', ')}). Rename the title and every character, creature, place and item to original names that evoke the idea without copying any existing game, company or character.`;
        continue;
      }
    }
    const started = performance.now();
    verified = kit.verify(checked.content, { seed, budgetMs: 2000 });
    verifyMs += performance.now() - started;
    // Problems that only say the search ran out of time are warnings, for every kit.
    const timeOnly = (/** @type {string | KitProblem} */ p) => typeof p === 'object' && p && (p.budgetExhausted || ['over_budget', 'budget'].includes(String(p.code)));
    if (!verified.ok && (verified.problems || []).length && verified.problems.every(timeOnly)) verified = { ...verified, ok: true, warnings: [...(verified.warnings || []), ...verified.problems], problems: [] };
    if (verified.ok || !client) break;
    const problems = (verified.problems || []).slice(0, 10).map(p => typeof p === 'string' ? p : `${p.path ? p.path + ': ' : ''}${p.message || p.code}`);
    user = `${user}\n\nYour previous answer passed validation but failed play-testing (the kit's bot or solver):\n${problems.map(p => `- ${p}`).join('\n')}\nMake those parts achievable (easier targets, more time or moves, gentler difficulty) and return corrected content.`;
  }
  if (!checked?.ok) throw Object.assign(Error(`The ${kit.name} content failed checks: ${(checked?.errors || []).slice(0, 4).map(e => e.code).join(', ')}`), { status: 422 });
  // Validated content reaches play-testing on the loop's last pass (above), so `verified` is set here.
  if (!verified) throw Object.assign(Error(`The ${kit.name} content was not play-tested`), { status: 422 });
  const content = checked.content;

  // Keep only mods this kit can run, normalized, so hosts and saves see a stable shape.
  mods = Object.fromEntries(available.map(m => [m.id, m.normalize(obj(prop(mods, m.id)))]).filter(([id, cfg]) => available.find(m => m.id === id)?.enabled(cfg)));
  // On revisions, check that the change really happened; if not, say so rather than claim it.
  const doc = { schema: KIT_GAME_SCHEMA, kit: kit.id, kitVersion: kit.version, mods, id: prevDoc.id || slug(content.title, kit.id), title: content.title, logline: content.logline || '', seed, content };
  const inputs = artInputs(kit, content, doc);
  // Art direction starts now; the content is already verified.
  const directing = art?.procedural ? art.direct({ design: inputs.design, previous: prevDoc.schema === KIT_GAME_SCHEMA ? { ...prev, report: { ...prevReport, design: prevReport.artDesign } } : null, change: job.change || null }) : null;
  ctx.stage('building', { ms: reply?.ms ?? 0, kit: kit.id });
  ctx.stage('playtested', { winnable: verified.ok, kit: kit.id, ms: Math.round(verifyMs), attempts });
  if (!verified.ok) throw Object.assign(Error(`The game failed verification: ${verified.problems.slice(0, 4).map(p => (typeof p === 'string' ? p : p.code || p)).join(', ')}`), { status: 422 });

  let painted = null;
  if (directing && art) {
    ctx.stage('painting', { generator: 'procedural' });
    painted = await art.paint({ job, ctx, spec: inputs.spec, directed: await directing, previous });
    ctx.stage('painted', { ms: painted.report.paintMs, assets: painted.report.assets, reused: painted.report.reused, changed: painted.report.changed });
  }
  // On revisions, check the change really happened (content, mods and art); if not, say so.
  // A request naming an existing character ("add Goku") is done with an original look-alike; say so plainly.
  const namesFranchise = names === 'original' && previousContent && job.change ? (await usesFranchiseNames(decisions, [job.change]))?.flagged : false;
  const revisionCheck = previousContent ? await checkRevision(decisions, { change: job.change, engine: kit.name, before: { content: previousContent, mods: prevDoc.mods || {}, art: prop(prevDoc.art, 'direction') || null }, after: { content, mods, art: painted?.art?.direction || prop(prevDoc.art, 'direction') || null }, unsupported: unsupported || [], originalStandIns: namesFranchise }) : null;
  const renamedNote = namesFranchise && revisionCheck?.diff ? [{ capability: job.change, why: `Games use original names, so this was added as an original look-alike with its own name (${revisionCheck.summary.join(', ')}). Ask for a different name or look anytime.`, kind: 'renamed' }] : [];
  if (revisionCheck && revisionCheck.diff === 0 && !(unsupported || []).length)
    unsupported = [{ request: job.change, why: revisionCheck.why }];
  await ctx.store.updateMeta(job.gameId, { title: doc.title, kind: `kit:${kit.id}` });
  return ctx.publish({
    doc: painted ? { ...doc, art: painted.art } : doc,
    stage: previousContent ? `revision: ${job.change}` : 'playable',
    report: { kind: `kit:${kit.id}`, kit: kit.id, verified: true, verification: verified.report, summary: content.logline, gaps: [...renamedNote, ...(unsupported || []).slice(0, 8).map(u => ({ capability: String(u.request).slice(0, 120), why: String(u.why).slice(0, 240), kind: 'unsupported' }))], route: route || null, revisionCheck, changes: revisionCheck?.summary || [], artDesign: inputs.design, ...(painted ? { art: painted.report, quality: { art: painted.quality } } : {}), modelMs: reply?.ms ?? 0, contentAttempts: attempts, change: job.change || null },
    provenance: { pipeline: KIT_PIPELINE_VERSION, kit: kit.id, kitVersion: kit.version, model: reply?.model || 'offline', seed, prompt: job.prompt, answers: job.answers || [], change: job.change || null, base: job.base || null, contentHash: hashOf(content) },
  });
}
