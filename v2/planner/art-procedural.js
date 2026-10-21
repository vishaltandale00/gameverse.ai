// @ts-check
// Procedural art for generated games: one short model call writes the art
// direction, code paints it. A new game gets a direction from the design; a
// revision reuses the previous direction and replaces only the targets the
// change request (or a changed cast member) is about. Assets are named by
// content hash, so everything that didn't change keeps its exact URL.
import { createHash } from 'node:crypto';
import { DIRECTION_SCHEMA, DIRECTION_PROMPT, directionRequest, normalizeDirection, mergeDirection, forcedTargets, fallbackDirection, TARGETS } from '../art/direction.js';
import { paintGameArt, ART_PAINTER_VERSION } from '../art/paint.js';
import { artQuality } from '../verify/art-quality.js';
import { messageOf, obj, prop } from '../kernel/guards.js';

/** @typedef {ReturnType<typeof createProceduralArt>} ProceduralArt */
/**
 * An art direction and the targets it changed. `direction` is a normalized direction (art/direction.js) or a
 * previous version's stored one, reused as is.
 * @typedef {{ direction: unknown, changed: string[], ms: number, source: string, error?: string }} Directed
 */
/** @typedef {{ id?: unknown, title?: string, entities: Record<string, unknown> }} ArtSpec */

/** @param {{ client?: import('./openai.js').OpenAIClient | null, model?: string }} [options] */
export function createProceduralArt({ client = null, model = 'gpt-4.1-mini' } = {}) {
  /** Start the direction early (it runs while the level builds). Resolves to { direction, changed, ms, source }.
   * @param {{ design: unknown, previous: unknown, change?: string | null }} request  `previous` is a stored version
   * @returns {Promise<Directed>} */
  async function direct({ design, previous, change = null }) {
    const started = performance.now();
    const prev = prop(prop(prop(previous, 'doc'), 'art'), 'direction') || null;
    const forced = prev ? forcedTargets(prop(prop(previous, 'report'), 'design'), design) : [];
    try {
      if (!client) throw Error('no model');
      if (prev && !change && !forced.length) return { direction: prev, changed: [], ms: 0, source: 'locked' };
      const reply = await client.complete({ model, system: DIRECTION_PROMPT, user: directionRequest({ design, previous: prev, change }), schema: { name: 'art_direction', schema: DIRECTION_SCHEMA } });
      /** @type {unknown} */
      const raw = JSON.parse(reply.text); // model output: normalizeDirection / mergeDirection clamp it to known values
      if (!prev) return { direction: normalizeDirection(obj(raw)), changed: [...TARGETS], ms: Math.round(performance.now() - started), source: reply.model };
      const merged = mergeDirection(prev, obj(raw), forced);
      return { ...merged, ms: Math.round(performance.now() - started), source: reply.model };
    } catch (error) {
      // Offline or a failed call: keep the locked direction, or derive one from the design.
      if (prev) { const merged = mergeDirection(prev, fallbackDirection(obj(design)), forced); return { ...merged, ms: 0, source: 'fallback', error: messageOf(error).slice(0, 120) }; }
      return { direction: fallbackDirection(obj(design)), changed: [...TARGETS], ms: 0, source: 'fallback', error: messageOf(error).slice(0, 120) };
    }
  }

  /** Paint and store every asset; returns { art, report, quality } (quality: the art checks, verify/art-quality.js; never blocking).
   * @param {{ job: { gameId: string }, ctx: { store: Pick<import('./arcade-pipeline.js').PipelineStore, 'saveAsset'> }, spec: ArtSpec, directed: Directed, previous: unknown }} request */
  async function paint({ job, ctx, spec, directed, previous }) {
    const started = performance.now();
    const { assets, assemble, look, palette, separation } = paintGameArt(directed.direction, spec);
    /** @type {Map<string, unknown>} */
    const urls = new Map();
    // Locked assets: a target the change didn't name keeps its previous file, even if the painter has since improved.
    const previousArt = prop(prop(previous, 'doc'), 'art');
    const old = prop(previousArt, 'procedural') ? previousUrls(previousArt) : new Map();
    const changed = new Set(directed.changed);
    let reused = 0;
    await Promise.all(assets.map(async ({ key, svg, targets }) => {
      if (old.has(key) && !targets.some((/** @type {string} */ t) => changed.has(t))) { urls.set(key, old.get(key)); reused++; return; }
      const hash = createHash('sha256').update(svg).digest('hex').slice(0, 16);
      const url = `/api/v2/games/${job.gameId}/assets/${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${hash}.svg`;
      if (old.get(key) === url) reused++;
      else await ctx.store.saveAsset(job.gameId, url.split('/').pop() ?? '', Buffer.from(svg));
      urls.set(key, url);
    }));
    const art = assemble((/** @type {string} */ key) => urls.get(key));
    const paintMs = Math.round(performance.now() - started);
    // Checks run on the painted SVGs. Reused assets were checked when they were painted; a reused file may differ
    // from this paint only when the painter has changed since.
    const t = performance.now(), quality = artQuality(assets, look);
    return { art, quality: { ...quality, ms: Math.round(performance.now() - t) }, report: { generator: ART_PAINTER_VERSION, director: directed.source, directionMs: directed.ms, paintMs, assets: assets.length, reused, changed: directed.changed, look: look ? { preset: look.preset, colors: palette?.length ?? null, separation } : null, ...(directed.error ? { directorError: directed.error } : {}) } };
  }

  return { procedural: true, direct, paint };
}

/** Asset key → URL for a previous procedural art record (inverse of paintGameArt's assemble).
 * @param {unknown} stored a previous version's `art` (stored data) @returns {Map<string, unknown>} */
function previousUrls(stored) {
  const art = obj(stored);
  /** @type {Map<string, unknown>} */
  const out = new Map();
  for (const [kind, frames] of Object.entries(obj(art.frames))) for (const [pose, url] of Object.entries(obj(frames))) out.set(`frame-${kind}-${pose}`, url);
  for (const [kind, url] of Object.entries(obj(art.sprites))) if (!prop(art.frames, kind)) out.set(`sprite-${kind}`, url);
  const tileset = prop(art.tileset, 'url');
  if (tileset) out.set('tileset', tileset);
  if (art.background) out.set('background', art.background);
  if (art.title) out.set('title', art.title);
  return out;
}
