// Generated art for 2D games: transparent sprites for the cast, seamless tile
// textures and a background scene, all in one style. Runs after the first
// playable version (which uses placeholder glyphs) and publishes a new
// version with an `art` map; unchanged roles are reused across revisions.
import { createHash } from 'node:crypto';

const ROLES = { player: 'player', collectible: 'pickup', enemy: 'enemy', hazard: 'hazard', goal: 'goal' };

export function artPrompts(design, spec) {
  const style = design.artStyle || 'crisp 16-bit pixel art';
  const side = design.view !== 'topdown';
  const cast = design.cast || {};
  const facing = side ? 'side view, facing right, full body' : 'top-down view seen from above at a slight angle, full body';
  const sprite = (who, extra = '') => `Single game sprite of ${who}. ${facing}. ${extra} Style: ${style}. Centered, fills most of the frame, clean silhouette, no text, no border, no ground shadow, isolated on a transparent background.`;
  const prompts = {};
  for (const [kind, def] of Object.entries(spec.entities)) {
    if (def.solid) continue;
    const role = ROLES[(def.tags || []).find(t => ROLES[t])];
    if (!role) continue;
    const who = cast[role]?.name || role;
    prompts[`sprite:${kind}`] = { kind: 'sprite', target: kind, transparent: true, size: '1024x1024',
      prompt: sprite(`${who}, the ${role} in a game called "${spec.title}"`, role === 'pickup' ? 'A small collectible item, shiny and readable at small size.' : role === 'goal' ? 'The level exit / goal object.' : role === 'hazard' ? 'A dangerous obstacle.' : '') };
  }
  const setting = `${spec.title}: ${design.pitch || ''}`;
  prompts['tile:ground'] = { kind: 'tile', target: 'ground', transparent: false, size: '1024x1024', prompt: `Seamless tileable square texture for the solid ground blocks of a 2D game set in ${setting}. ${side ? 'Show the block face with a distinct top edge.' : 'Seen from above, wall/obstacle material.'} Style: ${style}. Fills the whole square edge to edge, no text, no objects, no border.` };
  prompts['tile:platform'] = { kind: 'tile', target: 'platform', transparent: false, size: '1024x1024', prompt: `Seamless tileable square texture for floating platform blocks in a 2D game set in ${setting}, a lighter or contrasting material to the ground. Style: ${style}. Fills the whole square edge to edge, no text, no border.` };
  prompts.background = { kind: 'background', target: 'background', transparent: false, size: '1536x1024', prompt: `Wide background scenery for a ${side ? 'side-scrolling' : 'top-down'} 2D game set in ${setting}. ${side ? 'Distant layered scenery with depth, sky at the top, calm enough for characters to read in front of it.' : 'A soft ground texture seen from above, low contrast so characters read on top of it.'} Style: ${style}. No characters, no text, no UI.` };
  return prompts;
}

export function createArtGenerator({ apiKey, model = 'gpt-image-1-mini', quality = 'low', fetchImpl = fetch, concurrency = 8 }) {
  async function image({ prompt, size, transparent }) {
    const response = await fetchImpl('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, quality, output_format: 'webp', output_compression: 82, ...(transparent ? { background: 'transparent' } : {}) }),
      signal: AbortSignal.timeout(120000),
    });
    const body = await response.json();
    if (!response.ok) throw Error(`image model returned HTTP ${response.status}: ${body?.error?.message?.slice(0, 160) || ''}`);
    return Buffer.from(body.data[0].b64_json, 'base64');
  }

  return async function art(job, ctx, { design, spec, record }) {
    const prompts = artPrompts(design, spec);
    // Reuse art from the base version when a role's prompt is unchanged.
    const base = job.base ? await ctx.store.version(job.gameId, job.base) : null;
    const previous = base?.doc?.art?.prompts || {};
    const result = { style: design.artStyle || null, sprites: {}, tiles: {}, background: null, prompts: {} };
    const todo = [];
    for (const [key, p] of Object.entries(prompts)) {
      const hash = createHash('sha256').update(`${model}|${p.prompt}`).digest('hex').slice(0, 16);
      result.prompts[key] = hash;
      const reused = previous[key] === hash ? (p.kind === 'sprite' ? base.doc.art.sprites[p.target] : p.kind === 'tile' ? base.doc.art.tiles[p.target] : base.doc.art.background) : null;
      if (reused) assign(result, p, reused); else todo.push({ key, p, hash });
    }
    ctx.stage('painting', { assets: todo.length, reused: Object.keys(prompts).length - todo.length, model });
    let done = 0;
    const queue = [...todo];
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const { key, p, hash } = queue.shift();
        try {
          const bytes = await image(p);
          const url = await ctx.store.saveAsset(job.gameId, `${key.replace(/[^a-z0-9]+/gi, '-')}-${hash}.webp`, bytes);
          assign(result, p, url);
          ctx.stage('painted', { asset: key, done: ++done, of: todo.length });
          ctx.draft({ art: { key, url } });
        } catch (error) { ctx.stage('paint_failed', { asset: key, error: String(error.message).slice(0, 160) }); }
      }
    }));
    if (!done && todo.length) return; // nothing new to show
    await ctx.publish({ doc: { ...spec, art: result }, stage: 'art', report: { ...record.report, art: { model, generated: done, reused: Object.keys(prompts).length - todo.length } }, provenance: { ...record.provenance, art: { model, quality } } });
  };
}

function assign(result, p, url) {
  if (p.kind === 'sprite') result.sprites[p.target] = url;
  else if (p.kind === 'tile') result.tiles[p.target] = url;
  else result.background = url;
}
