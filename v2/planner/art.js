// @ts-check
// Generated art for 2D games: transparent sprites for the cast, seamless tile
// textures and a background scene, all in one style. Runs after the first
// playable version (which uses placeholder glyphs) and publishes a new
// version with an `art` map; unchanged roles are reused across revisions.
import { createHash } from 'node:crypto';
import { tilesetTemplate } from './png.js';
import { isStr, messageOf, obj, objects, prop, str } from '../kernel/guards.js';

/** @typedef {import('./arcade-pipeline.js').PipelineContext} PipelineContext */
/** @typedef {{ kind: string, target: string, transparent: boolean, size: string, prompt: string, template?: boolean }} ArtPrompt */
/** An engine spec's entity kinds (design.js designToSpec output). @typedef {{ title?: unknown, entities: Record<string, { solid?: boolean, tags?: string[] }> }} ArtSpecInput */
/**
 * @typedef {object} ArtRecord
 * @property {unknown} style
 * @property {Record<string, string>} sprites
 * @property {Record<string, string>} tiles
 * @property {string | null} background
 * @property {string | null} title
 * @property {Record<string, Record<string, string>>} frames
 * @property {Record<string, string>} prompts
 * @property {{ url: string } & typeof TILESET_LAYOUT} [tileset]
 */

export const TILESET_LAYOUT = { cols: 2, rows: 2, inset: 0.06, cells: { groundTop: [0, 0], groundFill: [1, 0], platform: [0, 1], wall: [1, 1] } };

/** @type {Record<string, string>} */
const ROLES = { player: 'player', collectible: 'pickup', enemy: 'enemy', hazard: 'hazard', goal: 'goal' };

/** @param {unknown} input the game design (model output, DESIGN_SCHEMA) @param {ArtSpecInput} spec @returns {Record<string, ArtPrompt>} */
export function artPrompts(input, spec) {
  const design = obj(input);
  const style = design.artStyle || 'crisp 16-bit pixel art';
  const side = design.view !== 'topdown';
  const cast = obj(design.cast);
  const facing = side ? 'side view, facing right, full body' : 'top-down view seen from above at a slight angle, full body';
  const sprite = (/** @type {string} */ who, extra = '') => `Single game sprite of ${who}. ${facing}. ${extra} Style: ${style}. Centered, fills most of the frame, clean silhouette, no text, no border, no ground shadow, isolated on a transparent background.`;
  /** @type {Record<string, ArtPrompt>} */
  const prompts = {};
  for (const [kind, def] of Object.entries(spec.entities)) {
    if (def.solid) continue;
    const role = ROLES[(def.tags || []).find(t => ROLES[t]) ?? ''];
    if (!role) continue;
    const who = prop(cast[role], 'name') || role;
    prompts[`sprite:${kind}`] = { kind: 'sprite', target: kind, transparent: true, size: '1024x1024',
      prompt: sprite(`${who}, the ${role} in a game called "${spec.title}"`, role === 'pickup' ? 'A small collectible item, shiny and readable at small size.' : role === 'goal' ? 'The level exit / goal object.' : role === 'hazard' ? 'A dangerous obstacle.' : '') };
  }
  const setting = `${spec.title}: ${design.pitch || ''}`;
  // One template-guided tileset (2x2 cells) instead of free-form textures, which often came back as whole sheets.
  prompts.tileset = { kind: 'tileset', target: 'tileset', transparent: false, size: '1024x1024', template: true, prompt: `This image is a layout template of four squares in a 2x2 grid separated by dark gutters. Repaint it as a game tileset for a ${side ? 'side-scrolling' : 'top-down'} 2D game set in ${setting}, keeping exactly the same 2x2 layout and gutters. Top-left square: a ground tile. The light band along its top marks the walkable surface layer (grass, snow, moss, stone lip or similar) running along the very top edge of the square, and the ground's interior material fills everything below it down to the bottom edge. Top-right square: that same interior material only, with no surface layer, seamless on all four sides. Bottom-left square: a platform tile whose material (planks, bricks, stone slabs or similar, in a contrasting color) covers the entire square edge to edge, following the seam lines; do not draw a separate object inside it. Bottom-right square: a wall tile, seamless on all sides. Every square is a single flat texture filling its whole square, seamlessly tileable horizontally, front-facing with no perspective and no empty background. Style: ${style}. No text, no characters, no items, no extra tiles.` };
  prompts.title = { kind: 'title', target: 'title', transparent: false, size: '1536x1024', prompt: `Title screen key art for a 2D game called "${spec.title}": ${design.pitch || ''}. A dramatic, inviting composition featuring ${prop(cast.player, 'name') || 'the hero'} with ${prop(cast.enemy, 'name') || 'their foes'} in the world of the game. Leave the upper third calm for a logo. Style: ${style}. No text, no letters, no logos, no UI.` };
  prompts.background = { kind: 'background', target: 'background', transparent: false, size: '1536x1024', prompt: `Wide background scenery for a ${side ? 'side-scrolling' : 'top-down'} 2D game set in ${setting}. ${side ? 'Distant layered scenery with depth, sky at the top, calm enough for characters to read in front of it.' : 'A soft ground texture seen from above, low contrast so characters read on top of it.'} Style: ${style}. No characters, no text, no UI.` };
  return prompts;
}

// Pose frames are image edits of the base sprite, so the character stays on model.
export const POSES = {
  player: { idle: 'standing relaxed in an idle pose, weight balanced', runA: 'running, mid-stride with the left leg forward and arms swinging', runB: 'running, mid-stride with the right leg forward and arms swinging the other way', jump: 'jumping upward, legs tucked, arms raised', hurt: 'recoiling from a hit, leaning back with a pained expression' },
  enemy: { runA: 'walking, mid-step with one foot forward', runB: 'walking, mid-step with the other foot forward' },
};

/** The image bytes of an OpenAI Images reply (external data). @param {unknown} body @returns {Buffer} */
function imageBytes(body) {
  const b64 = prop(objects(prop(body, 'data'))[0], 'b64_json');
  if (!isStr(b64)) throw Error('the image reply contained no image');
  return Buffer.from(b64, 'base64');
}
/** The error text of a failed OpenAI reply. @param {unknown} body */
const errorText = body => str(prop(prop(body, 'error'), 'message')).slice(0, 160);

/** @param {{ apiKey: string, model?: string, quality?: string, fetchImpl?: typeof fetch, concurrency?: number }} options */
export function createArtGenerator({ apiKey, model = 'gpt-image-1-mini', quality = 'low', fetchImpl = fetch, concurrency = 8 }) {
  /** @param {Buffer} sourceBytes @param {string} posePrompt @param {unknown} style the design's art style (model text) @param {string} facing */
  async function pose(sourceBytes, posePrompt, style, facing) {
    const form = new FormData();
    form.append('model', model); form.append('image', new Blob([sourceBytes], { type: 'image/webp' }), 'sprite.webp');
    form.append('prompt', `The exact same character: same colors, outfit, proportions and art style (${style}), now ${posePrompt}. ${facing}, full body, centered, same scale as the original. Isolated on a transparent background, no text.`);
    form.append('size', '1024x1024'); form.append('background', 'transparent'); form.append('quality', quality); form.append('output_format', 'webp');
    const response = await fetchImpl('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(120000) });
    const body = await response.json();
    if (!response.ok) throw Error(`image edit returned HTTP ${response.status}: ${errorText(body)}`);
    return imageBytes(body);
  }
  /** @type {Buffer | null} */
  let template = null;
  /** @param {Buffer} sourceBytes @param {string} mime @param {string} prompt @param {{ size?: string, transparent?: boolean }} [options] */
  async function edit(sourceBytes, mime, prompt, { size = '1024x1024', transparent = false } = {}) {
    const form = new FormData();
    form.append('model', model); form.append('image', new Blob([sourceBytes], { type: mime }), mime === 'image/png' ? 'template.png' : 'sprite.webp');
    form.append('prompt', prompt); form.append('size', size); form.append('quality', quality); form.append('output_format', 'webp');
    if (transparent) form.append('background', 'transparent');
    const response = await fetchImpl('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(120000) });
    const body = await response.json();
    if (!response.ok) throw Error(`image edit returned HTTP ${response.status}: ${errorText(body)}`);
    return imageBytes(body);
  }
  /** @param {ArtPrompt} request @returns {Promise<Buffer>} */
  async function image({ prompt, size, transparent, template: useTemplate }) {
    if (useTemplate) return edit((template ??= tilesetTemplate()), 'image/png', prompt, { size });
    const response = await fetchImpl('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, quality, output_format: 'webp', output_compression: 82, ...(transparent ? { background: 'transparent' } : {}) }),
      signal: AbortSignal.timeout(120000),
    });
    const body = await response.json();
    if (!response.ok) throw Error(`image model returned HTTP ${response.status}: ${errorText(body)}`);
    return imageBytes(body);
  }

  /** @param {{ gameId: string, base?: unknown }} job @param {PipelineContext} ctx
   * @param {{ design: unknown, spec: ArtSpecInput & Record<string, unknown>, record: { report?: unknown, provenance?: unknown } }} input */
  return async function art(job, ctx, { design, spec, record }) {
    const prompts = artPrompts(design, spec);
    // Reuse art from the base version when a role's prompt is unchanged. The base version is stored data.
    const base = job.base ? await ctx.store.version(job.gameId, job.base) : null;
    const baseArt = obj(prop(prop(base, 'doc'), 'art'));
    const previous = obj(baseArt.prompts);
    /** @type {ArtRecord} */
    const result = { style: obj(design).artStyle || null, sprites: {}, tiles: {}, background: null, title: null, frames: {}, prompts: {} };
    /** @type {{ key: string, p: ArtPrompt, hash: string }[]} */
    const todo = [];
    for (const [key, p] of Object.entries(prompts)) {
      const hash = createHash('sha256').update(`${model}|${p.prompt}`).digest('hex').slice(0, 16);
      result.prompts[key] = hash;
      const reused = previous[key] === hash ? str(p.kind === 'sprite' ? prop(baseArt.sprites, p.target) : p.kind === 'tileset' ? prop(baseArt.tileset, 'url') : p.kind === 'title' ? baseArt.title : baseArt.background) : null;
      if (reused) assign(result, p, reused); else todo.push({ key, p, hash });
    }
    ctx.stage('painting', { assets: todo.length, reused: Object.keys(prompts).length - todo.length, model });
    let done = 0;
    const queue = [...todo];
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) break;
        const { key, p, hash } = next;
        try {
          const bytes = await image(p).catch(() => image(p)); // one retry: image calls occasionally fail transiently
          const url = await ctx.store.saveAsset(job.gameId, `${key.replace(/[^a-z0-9]+/gi, '-')}-${hash}.webp`, bytes);
          assign(result, p, url);
          ctx.stage('painted', { asset: key, done: ++done, of: todo.length });
          ctx.draft({ art: { key, url } });
        } catch (error) { ctx.stage('paint_failed', { asset: key, error: messageOf(error).slice(0, 160) }); }
      }
    }));
    if (!done && todo.length) return; // nothing new to show
    const artRecord = await ctx.publish({ doc: { ...spec, art: result }, stage: 'art', report: { ...obj(record.report), art: { model, generated: done, reused: Object.keys(prompts).length - todo.length } }, provenance: { ...obj(record.provenance), art: { model, quality } } });

    // Animation: pose frames for the player and enemies, edited from their base sprites.
    const style = obj(design).artStyle || 'crisp 16-bit pixel art';
    const facing = obj(design).view !== 'topdown' ? 'Side view, facing right' : 'Top-down view at a slight angle';
    /** @type {{ kind: string, name: string, posePrompt: string, file: string, hash: string }[]} */
    const jobs = [];
    for (const [kind, def] of Object.entries(spec.entities)) {
      const role = (def.tags || []).includes('player') ? 'player' : (def.tags || []).includes('enemy') ? 'enemy' : null;
      const url = result.sprites[kind];
      if (!role || !url) continue;
      const file = url.split('/').pop() ?? '';
      for (const [name, posePrompt] of Object.entries(POSES[role])) {
        const hash = createHash('sha256').update(`${model}|pose|${result.prompts[`sprite:${kind}`]}|${posePrompt}`).digest('hex').slice(0, 16);
        const stored = prop(prop(baseArt.frames, kind), name);
        const reused = stored && previous[`frame:${kind}:${name}`] === hash ? str(stored) : null;
        result.prompts[`frame:${kind}:${name}`] = hash;
        (result.frames[kind] ??= {});
        if (reused) result.frames[kind][name] = reused; else jobs.push({ kind, name, posePrompt, file, hash });
      }
    }
    if (!jobs.length) return;
    ctx.stage('animating', { frames: jobs.length });
    let animated = 0;
    const frameQueue = [...jobs];
    await Promise.all(Array.from({ length: Math.min(concurrency, frameQueue.length) }, async () => {
      while (frameQueue.length) {
        const j = frameQueue.shift();
        if (!j) break;
        try {
          const source = await ctx.store.asset(job.gameId, j.file);
          if (!source) throw Error(`sprite ${j.file} is missing`);
          const bytes = await pose(source, j.posePrompt, style, facing).catch(() => pose(source, j.posePrompt, style, facing));
          result.frames[j.kind][j.name] = await ctx.store.saveAsset(job.gameId, `frame-${j.kind}-${j.name}-${j.hash}.webp`, bytes);
          ctx.stage('animated', { frame: `${j.kind}:${j.name}`, done: ++animated, of: jobs.length });
        } catch (error) { ctx.stage('animate_failed', { frame: `${j.kind}:${j.name}`, error: messageOf(error).slice(0, 160) }); }
      }
    }));
    if (animated) await ctx.publish({ doc: { ...spec, art: result }, stage: 'animation', report: { ...obj(prop(artRecord, 'report')), animation: { frames: animated } }, provenance: prop(artRecord, 'provenance') });
  };
}

/** @param {ArtRecord} result @param {ArtPrompt} p @param {string} url */
function assign(result, p, url) {
  if (p.kind === 'sprite') result.sprites[p.target] = url;
  else if (p.kind === 'tile') result.tiles[p.target] = url;
  else if (p.kind === 'title') result.title = url;
  else if (p.kind === 'tileset') result.tileset = { url, ...TILESET_LAYOUT };
  else result.background = url;
}
