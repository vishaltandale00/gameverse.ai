// Game design (what the model writes) -> playable 2D game spec (what the
// engine runs). The design is small and schema-constrained, so generation is
// fast and never malformed; geometry comes from the deterministic level
// builder, and the playtester proves the result winnable.
import { SPEC_SCHEMA } from '../engine/spec.js';
import { SIDE_SECTIONS, TOPDOWN_SECTIONS, buildSide, buildTopdown } from '../engine/levelgen.js';

const actor = { type: 'object', additionalProperties: false, required: ['name', 'glyph'], properties: { name: { type: 'string' }, glyph: { type: 'string' } } };
const num = { type: 'number' };
export const DESIGN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'pitch', 'summary', 'view', 'length', 'background', 'palette', 'cast', 'feel', 'mechanics', 'sections', 'gaps'],
  properties: {
    title: { type: 'string' }, pitch: { type: 'string' }, summary: { type: 'string' },
    view: { type: 'string', enum: ['side', 'topdown'] },
    length: { type: 'string', enum: ['short', 'medium', 'long'] },
    background: { type: 'string' },
    palette: { type: 'object', additionalProperties: false, required: ['ground', 'platform'], properties: { ground: { type: 'string' }, platform: { type: 'string' } } },
    cast: { type: 'object', additionalProperties: false, required: ['player', 'pickup', 'enemy', 'hazard', 'goal'], properties: { player: actor, pickup: actor, enemy: actor, hazard: actor, goal: actor } },
    feel: { type: 'object', additionalProperties: false, required: ['runSpeed', 'jumpSpeed', 'gravity', 'airJumps', 'friction', 'airControl'], properties: { runSpeed: num, jumpSpeed: num, gravity: num, airJumps: { type: 'integer' }, friction: num, airControl: num } },
    mechanics: { type: 'object', additionalProperties: false, required: ['shoot', 'stomp', 'health', 'timerSeconds', 'enemySpeed', 'collectAllToWin'], properties: { shoot: { type: 'boolean' }, stomp: { type: 'boolean' }, health: { type: 'integer' }, timerSeconds: { type: 'integer' }, enemySpeed: num, collectAllToWin: { type: 'boolean' } } },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'difficulty'], properties: { type: { type: 'string', enum: [...new Set([...SIDE_SECTIONS, ...TOPDOWN_SECTIONS])] }, difficulty: { type: 'integer' } } } },
    gaps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['capability', 'why'], properties: { capability: { type: 'string' }, why: { type: 'string' } } } },
  },
};

export const DESIGN_PROMPT = `You design small, fun, polished 2D action games for Gameverse from a player's idea. Reply with a game design as JSON matching the schema; the engine builds and playtests it immediately.

- view: "side" for platformers and runners; "topdown" for dungeon crawls, arenas, twin-stick shooters, chases.
- length: short (~70 columns), medium (~100), long (~140). Prefer medium or long.
- background: a hex color that sets the mood; palette.ground and palette.platform: hex tile colors that fit the theme and contrast with the background.
- cast: name and ONE emoji glyph each for the player, the pickup, the enemy, the hazard and the goal, all fitting the idea.
- feel (units: tiles and seconds). runSpeed 4–20 (8 normal, 14+ very fast); jumpSpeed 10–24; gravity 25–80 (lower is floatier); airJumps 0–2; friction 10–120 (low is slippery, like ice); airControl 0.3–1.
- mechanics: shoot (fire projectiles with B), stomp (land on enemies to defeat them; side view only), health 1–6, timerSeconds 0 for none or 30–300, enemySpeed 1–8, collectAllToWin (also require every pickup).
- sections: 3–6 parts in play order, escalating, each with difficulty 1–3.
  - side view types: runway (open run with pickups), steps (rising and falling ground), pits (gaps to jump), platforms (floating ledges with pickups), gauntlet (enemies on the path), hazards (spike runs), tower (vertical climb), arena (many enemies), treasure (pickup bonanza).
  - top-down types: rooms, maze, garden (open, obstacles), arena, corridor (hazard-lined), treasure.
- gaps: mechanics the idea asks for that this engine cannot do yet (empty when none).
Match the idea's tone, pace and theme closely.`;

const clamp = (v, lo, hi, d) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const slug = (s, d) => ((s || '').toLowerCase().match(/[a-z0-9]+/g) || [d]).join('-').slice(0, 40) || d;
const hex = (s, d) => /^#[0-9a-f]{3,8}$/i.test(s || '') ? s : d;

/** Convert a design into a spec. attempt varies the layout seed and eases the jump on retries. */
export function designToSpec(design, { seed = 1, attempt = 0 } = {}) {
  const side = design.view !== 'topdown';
  const ease = 1 + 0.12 * Math.max(0, attempt - 1);
  const feel = {
    runSpeed: clamp(design.feel?.runSpeed, 3, 24, 8), jumpSpeed: clamp(design.feel?.jumpSpeed * ease, 8, 30, 16),
    gravity: clamp(design.feel?.gravity, 20, 90, 48), airJumps: clamp(Math.round(design.feel?.airJumps), 0, 2, 0),
    friction: clamp(design.feel?.friction, 8, 200, 60), airControl: clamp(design.feel?.airControl, 0.2, 1, 0.75),
  };
  const allowed = side ? SIDE_SECTIONS : TOPDOWN_SECTIONS;
  const sections = (design.sections || []).slice(0, 7).map(s => ({ type: allowed.includes(s.type) ? s.type : (side ? 'gauntlet' : 'arena'), difficulty: clamp(s.difficulty, 1, 3, 2) }));
  const layoutSeed = `${seed}:${attempt}`;
  const rows = side ? buildSide({ sections, length: design.length, seed: layoutSeed, physics: feel }) : buildTopdown({ sections, length: design.length, seed: layoutSeed });
  const has = ch => rows.some(r => r.includes(ch));
  const cast = design.cast || {};
  const kinds = { player: slug(cast.player?.name, 'hero'), pickup: slug(cast.pickup?.name, 'gem'), enemy: slug(cast.enemy?.name, 'foe'), hazard: slug(cast.hazard?.name, 'spikes'), goal: slug(cast.goal?.name, 'exit') };
  // Kind names must be distinct from each other and from the tile kinds.
  const used = new Set(['ground', 'platform']);
  for (const role of Object.keys(kinds)) { let k = kinds[role]; while (used.has(k)) k = `${k}-${role}`; used.add(k); kinds[role] = k; }
  const m = design.mechanics || {};
  const entities = {
    ground: { solid: true, color: hex(design.palette?.ground, '#3b4a5c') },
    platform: { solid: true, color: hex(design.palette?.platform, '#5b6b7c') },
    [kinds.player]: { tags: ['player'], glyph: cast.player?.glyph || '🙂', w: 0.8, h: 0.9 },
    [kinds.pickup]: { tags: ['collectible'], glyph: cast.pickup?.glyph || '💎', w: 0.6, h: 0.6 },
    [kinds.enemy]: { tags: ['enemy'], glyph: cast.enemy?.glyph || '👾', w: 0.9, h: 0.85 },
    [kinds.hazard]: { tags: ['hazard'], glyph: cast.hazard?.glyph || '🔺', w: 0.9, h: 0.6 },
    [kinds.goal]: { tags: ['goal'], glyph: cast.goal?.glyph || '🚩', w: 1, h: 1 },
  };
  const modules = [
    side ? { use: 'platformer', with: feel } : { use: 'topdown', with: { speed: feel.runSpeed, friction: feel.friction } },
    ...(has('C') ? [{ use: 'collect' }] : []),
    ...(has('E') ? [{ use: 'patrol', with: { speed: clamp(m.enemySpeed, 0.5, 10, 2.5), stomp: side && m.stomp !== false, gravity: side } }] : []),
    ...(has('^') ? [{ use: 'hazard' }] : []),
    { use: 'health', with: { hp: clamp(m.health, 1, 10, 3), knockback: side ? 9 : 0 } },
    { use: 'goal' },
    ...(m.shoot && has('E') ? [{ use: 'shooter', with: { aim: side ? 'facing' : 'stick' } }] : []),
    ...(m.timerSeconds > 0 ? [{ use: 'timer', with: { seconds: clamp(m.timerSeconds, 20, 600, 120) } }] : []),
  ];
  const reach = { count: 'reach_goal', gte: 1 };
  const lose = [{ var: 'hp', lte: 0 }, ...(m.timerSeconds > 0 ? [{ count: 'time_up', gte: 1 }] : [])];
  return {
    schema: SPEC_SCHEMA, id: slug(design.title, 'game'), title: design.title || 'Untitled', pitch: design.pitch || '', seed,
    background: hex(design.background, '#101820'),
    level: { rows, legend: { '#': 'ground', '=': 'platform', P: kinds.player, C: kinds.pickup, E: kinds.enemy, '^': kinds.hazard, G: kinds.goal } },
    entities, modules,
    win: m.collectAllToWin && has('C') ? { all: [reach, { var: 'remaining', lte: 0 }] } : reach,
    lose: lose.length > 1 ? { any: lose } : lose[0],
  };
}
