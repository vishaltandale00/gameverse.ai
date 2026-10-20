// Procedural art for generated games: one short model call writes the art
// direction, code paints it. A new game gets a direction from the design; a
// revision reuses the previous direction and replaces only the targets the
// change request (or a changed cast member) is about. Assets are named by
// content hash, so everything that didn't change keeps its exact URL.
import { createHash } from 'node:crypto';
import { DIRECTION_SCHEMA, DIRECTION_PROMPT, directionRequest, normalizeDirection, mergeDirection, forcedTargets, fallbackDirection, TARGETS } from '../art/direction.js';
import { paintGameArt, ART_PAINTER_VERSION } from '../art/paint.js';

export function createProceduralArt({ client = null, model = 'gpt-4.1-mini' } = {}) {
  /** Start the direction early (it runs while the level builds). Resolves to { direction, changed, ms, source }. */
  async function direct({ design, previous, change = null }) {
    const started = performance.now();
    const prev = previous?.doc?.art?.direction || null;
    const forced = prev ? forcedTargets(previous.report?.design, design) : [];
    try {
      if (!client) throw Error('no model');
      if (prev && !change && !forced.length) return { direction: prev, changed: [], ms: 0, source: 'locked' };
      const reply = await client.complete({ model, system: DIRECTION_PROMPT, user: directionRequest({ design, previous: prev, change }), schema: { name: 'art_direction', schema: DIRECTION_SCHEMA } });
      const raw = JSON.parse(reply.text);
      if (!prev) return { direction: normalizeDirection(raw), changed: [...TARGETS], ms: Math.round(performance.now() - started), source: reply.model };
      const merged = mergeDirection(prev, raw, forced);
      return { ...merged, ms: Math.round(performance.now() - started), source: reply.model };
    } catch (error) {
      // Offline or a failed call: keep the locked direction, or derive one from the design.
      if (prev) { const merged = mergeDirection(prev, fallbackDirection(design), forced); return { ...merged, ms: 0, source: 'fallback', error: String(error.message).slice(0, 120) }; }
      return { direction: fallbackDirection(design), changed: [...TARGETS], ms: 0, source: 'fallback', error: String(error.message).slice(0, 120) };
    }
  }

  /** Paint and store every asset; returns { art, report }. */
  async function paint({ job, ctx, spec, directed, previous }) {
    const started = performance.now();
    const { assets, assemble } = paintGameArt(directed.direction, spec);
    const urls = new Map();
    // Locked assets: a target the change didn't name keeps its previous file, even if the painter has since improved.
    const old = previous?.doc?.art?.procedural ? previousUrls(previous.doc.art) : new Map();
    const changed = new Set(directed.changed);
    let reused = 0;
    await Promise.all(assets.map(async ({ key, svg, targets }) => {
      if (old.has(key) && !targets.some(t => changed.has(t))) { urls.set(key, old.get(key)); reused++; return; }
      const hash = createHash('sha256').update(svg).digest('hex').slice(0, 16);
      const url = `/api/v2/games/${job.gameId}/assets/${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${hash}.svg`;
      if (old.get(key) === url) reused++;
      else await ctx.store.saveAsset(job.gameId, url.split('/').pop(), Buffer.from(svg));
      urls.set(key, url);
    }));
    const art = assemble(key => urls.get(key));
    return { art, report: { generator: ART_PAINTER_VERSION, director: directed.source, directionMs: directed.ms, paintMs: Math.round(performance.now() - started), assets: assets.length, reused, changed: directed.changed, ...(directed.error ? { directorError: directed.error } : {}) } };
  }

  return { procedural: true, direct, paint };
}

/** Asset key → URL for a previous procedural art record (inverse of paintGameArt's assemble). */
function previousUrls(art) {
  const out = new Map();
  for (const [kind, frames] of Object.entries(art.frames || {})) for (const [pose, url] of Object.entries(frames)) out.set(`frame-${kind}-${pose}`, url);
  for (const [kind, url] of Object.entries(art.sprites || {})) if (!art.frames?.[kind]) out.set(`sprite-${kind}`, url);
  if (art.tileset?.url) out.set('tileset', art.tileset.url);
  if (art.background) out.set('background', art.background);
  if (art.title) out.set('title', art.title);
  return out;
}
