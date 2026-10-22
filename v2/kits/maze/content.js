// Maze kit content: the strict schema the model fills, its prompt, a hand-written
// sample, and validate() which normalizes content and reports errors as
// { code, path, message, hint? } so a generator can repair it.
import { STYLE_NAMES, SIZE_NAMES, SIZES } from './maze.js';

export const PERSONALITIES = ['chaser', 'ambusher', 'whimsical', 'shy'];
/** Hunters: up to 6, or 8 when any level is huge or vast. */
export const LIMITS = { hunters: [2, 6], huntersBig: [2, 8], levels: [1, 12], bonus: [1, 12], lives: [1, 5], density: [0.3, 1], speed: [0.7, 1.4], tunnels: [1, 2], powerPellets: [2, 6], points: [10, 10000], extraLifeAt: [0, 100000] };

const str = description => ({ type: 'string', description });
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const schema = obj({
  title: str('Game title, original (no existing game or character names), at most 40 characters.'),
  logline: str('One sentence pitch, at most 140 characters.'),
  hero: obj({ name: str('The hero who eats their way through the maze.'), glyph: str('One emoji that suggests the hero, used only to pick an art look.') }),
  hunters: { type: 'array', description: '2 to 6 hunters (up to 8 if any level is huge or vast). Bigger mazes add numbered copies automatically, so 4 is right for most games.', items: obj({
    name: str('Short hunter name, unique.'),
    personality: { type: 'string', enum: PERSONALITIES, description: 'chaser: targets the hero; ambusher: aims 4 tiles ahead; whimsical: flanks using the chaser; shy: chases from afar, retreats up close.' },
    color: str('Hex color like #ff4d4d, distinct from the other hunters and from frightened blue.'),
  }) },
  pellet: obj({ name: str('What the small pellets are (e.g. "glowberry").') }),
  power: obj({ name: str('What the power pellets are; eating one turns the hunters into prey.') }),
  bonus: { type: 'array', description: '1 to 12 bonus prizes, one per level in order (the last repeats), points rising.', items: obj({ name: str('Bonus prize name.'), points: { type: 'integer', description: '10 to 10000.' } }) },
  levels: { type: 'array', description: '1 to 12 levels in order; each gets its own generated maze. A revision returns every level, changed only where the request says.', items: obj({
    maze: obj({
      size: { type: 'string', enum: SIZE_NAMES, description: `The map's dimensions: ${SIZE_NAMES.map(k => `${k} ${SIZES[k].w}×${SIZES[k].h}`).join(', ')} tiles. Bigger sizes scroll with a camera and add hunter houses, hunters and power pellets. "Bigger map" means a bigger size; "open world" means vast.` },
      style: { type: 'string', enum: STYLE_NAMES, description: 'The corridor shape, at any size: classic mixed blocks; compact many short corridors and junctions; sprawling big blocks and long runs. Style never changes the map size.' },
      density: { type: 'number', description: '0.3 to 1: how many of the possible corridors to keep. Higher means more junctions and escape routes.' },
      tunnels: { type: 'integer', description: '1 or 2 side tunnels that wrap around.' },
      powerPellets: { type: 'integer', description: '2, 4 or 6 for a classic-size map (4 is classic); bigger sizes scale this with area automatically.' },
    }),
    speed: { type: 'number', description: '0.7 to 1.4 multiplier on every speed; ramp it up gently across levels.' },
  }) },
  lives: { type: 'integer', description: '1 to 5 (3 is classic).' },
  extraLifeAt: { type: 'integer', description: 'Score that awards one extra life, or 0 for none (10000 is classic).' },
  endless: { type: 'boolean', description: 'true: levels loop forever, faster each loop; false: winning the last level wins the game.' },
  noUpwardTurns: { type: 'boolean', description: 'Classic rule: hunters may not turn upward at the junctions above the house and the start. Usually true.' },
});

export const prompt = `You write content for a maze chase game in the style of the classic pellet-eating arcade games. The kit supplies the rules, the hunter AI and the maze generator; you supply the cast and the level plan. All names and the theme must be original: never use existing game, company or character names.

- hero: the player character; glyph is one emoji that suggests its look.
- hunters: 2 to 6, usually 4 with one of each personality (chaser, ambusher, whimsical, shy). The whimsical hunter needs a chaser to flank with. Colors: bright, distinct, not deep blue (frightened hunters turn blue).
- pellet and power: themed names for the small dots and the big power dots.
- bonus: prizes that appear twice per level, points rising level by level (classic: 100, 300, 500, 700, 1000, 2000, 3000, 5000).
- levels: usually 4 to 8. Each level picks a maze size, style and parameters; the generator builds a different maze for each. Start with density around 0.6 and speed 1.0, vary styles, and ramp speed up gently (at most +0.05 per level). Fewer power pellets or lower density makes a level harder.
- size is the map's dimensions; style is only the corridor shape. Use classic unless the idea asks for more room. "Bigger map", "larger maze" or "more to explore" means a bigger size (large or huge), never just a different style. "Open world" or "one giant map" means size vast with a single long level, or endless true. Bigger sizes scroll with a camera and bring more houses, hunters and power pellets on their own; keep tunnels and powerPellets at their classic values.
- lives 3, extraLifeAt 10000, noUpwardTurns true unless the idea asks otherwise; endless only when the idea is score-chasing forever.
- When revising, return every existing level: change only the levels and fields the request is about, and never drop, shorten or reorder levels unless asked. "Make the map bigger" changes size on every level and nothing else.`;

export const sample = {
  title: 'Glowberry Grove',
  logline: 'A hungry little frog gobbles glowberries through a moonlit hedge maze while four thorny sprites give chase.',
  hero: { name: 'Pip', glyph: '🐸' },
  hunters: [
    { name: 'Bramble', personality: 'chaser', color: '#ff4d4d' },
    { name: 'Thistle', personality: 'ambusher', color: '#ff8ad8' },
    { name: 'Wisp', personality: 'whimsical', color: '#3ad8e8' },
    { name: 'Moss', personality: 'shy', color: '#ffb347' },
  ],
  pellet: { name: 'glowberry' },
  power: { name: 'moonseed' },
  bonus: [
    { name: 'honeycomb', points: 100 }, { name: 'dewdrop pear', points: 300 }, { name: 'star plum', points: 500 },
    { name: 'sun melon', points: 700 }, { name: 'golden acorn', points: 1000 }, { name: 'crown truffle', points: 2000 },
  ],
  levels: [
    { maze: { size: 'classic', style: 'classic', density: 0.65, tunnels: 1, powerPellets: 4 }, speed: 1 },
    { maze: { size: 'classic', style: 'compact', density: 0.6, tunnels: 2, powerPellets: 4 }, speed: 1.02 },
    { maze: { size: 'classic', style: 'sprawling', density: 0.7, tunnels: 1, powerPellets: 4 }, speed: 1.05 },
    { maze: { size: 'classic', style: 'classic', density: 0.5, tunnels: 2, powerPellets: 4 }, speed: 1.08 },
    { maze: { size: 'classic', style: 'compact', density: 0.45, tunnels: 1, powerPellets: 2 }, speed: 1.1 },
  ],
  lives: 3,
  extraLifeAt: 10000,
  endless: false,
  noUpwardTurns: true,
};

const isHexColor = s => typeof s === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());
const fullHex = s => { const h = s.trim().toLowerCase(); return h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h; };

/** Validate and normalize content. Returns { ok, errors, warnings, content }. */
export function validate(input) {
  const errors = [], warnings = [];
  const fail = (code, path, message, hint) => { errors.push({ code, path, message, ...(hint ? { hint } : {}) }); };
  const warn = (code, path, message) => { warnings.push({ code, path, message }); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: [{ code: 'schema', path: '$', message: 'content must be an object' }], warnings, content: null };
  const c = structuredClone(input);
  const text = (v, path, max, required = true) => {
    if (typeof v !== 'string' || !v.trim()) { if (required) fail('schema', path, `${path} must be a non-empty string`); return v; }
    const t = v.trim().replace(/\s+/g, ' ');
    if (t.length > max) { warn('trimmed', path, `${path} was cut to ${max} characters`); return t.slice(0, max); }
    return t;
  };
  const num = (v, path, [lo, hi], { integer = false, def } = {}) => {
    if (v === undefined && def !== undefined) return def;
    if (typeof v !== 'number' || !Number.isFinite(v)) { fail('schema', path, `${path} must be a number`, `${lo} to ${hi}`); return v; }
    let n = integer ? Math.round(v) : v;
    if (n < lo || n > hi) { warn('clamped', path, `${path} ${n} was clamped to ${lo}–${hi}`); n = Math.min(hi, Math.max(lo, n)); }
    return n;
  };
  const list = (v, path, [lo, hi]) => {
    if (!Array.isArray(v)) { fail('schema', path, `${path} must be a list`); return false; }
    if (v.length < lo || v.length > hi) { fail('count', path, `${path} needs ${lo} to ${hi} entries, got ${v.length}`); return false; }
    return true;
  };

  c.title = text(c.title, 'title', 40);
  c.logline = text(c.logline, 'logline', 140);
  if (!c.hero || typeof c.hero !== 'object') fail('schema', 'hero', 'hero must be an object with name and glyph');
  else { c.hero.name = text(c.hero.name, 'hero.name', 24); c.hero.glyph = typeof c.hero.glyph === 'string' ? c.hero.glyph.trim().slice(0, 8) : ''; }
  for (const k of ['pellet', 'power']) {
    if (!c[k] || typeof c[k] !== 'object') fail('schema', k, `${k} must be an object with a name`);
    else c[k].name = text(c[k].name, `${k}.name`, 24);
  }

  const big = Array.isArray(c.levels) && c.levels.some(lv => ['huge', 'vast'].includes(lv?.maze?.size));
  if (list(c.hunters, 'hunters', big ? LIMITS.huntersBig : LIMITS.hunters)) {
    const names = new Set();
    c.hunters.forEach((h, i) => {
      const p = `hunters[${i}]`;
      if (!h || typeof h !== 'object') return fail('schema', p, 'hunter must be an object');
      h.name = text(h.name, `${p}.name`, 16);
      if (typeof h.name === 'string') { if (names.has(h.name.toLowerCase())) fail('duplicate_name', `${p}.name`, `duplicate hunter name '${h.name}'`, 'give every hunter its own name'); names.add(h.name.toLowerCase()); }
      if (!PERSONALITIES.includes(h.personality)) fail('personality', `${p}.personality`, `unknown personality '${h.personality}'`, PERSONALITIES.join(', '));
      if (!isHexColor(h.color)) fail('color', `${p}.color`, `color must be a hex color like #ff4d4d, got '${h.color}'`);
      else h.color = fullHex(h.color);
    });
    if (c.hunters.some(h => h?.personality === 'whimsical') && !c.hunters.some(h => h?.personality === 'chaser')) warn('whimsical_without_chaser', 'hunters', 'a whimsical hunter flanks off a chaser; with none it uses the first hunter');
  }
  if (list(c.bonus, 'bonus', LIMITS.bonus)) c.bonus.forEach((b, i) => {
    if (!b || typeof b !== 'object') return fail('schema', `bonus[${i}]`, 'bonus must be an object');
    b.name = text(b.name, `bonus[${i}].name`, 24);
    b.points = num(b.points, `bonus[${i}].points`, LIMITS.points, { integer: true });
  });
  if (list(c.levels, 'levels', LIMITS.levels)) c.levels.forEach((lv, i) => {
    const p = `levels[${i}]`;
    if (!lv || typeof lv !== 'object' || !lv.maze || typeof lv.maze !== 'object') return fail('schema', `${p}.maze`, 'level needs a maze object');
    const m = lv.maze;
    if (m.size === undefined) m.size = 'classic'; // content written before sizes existed
    else if (!SIZE_NAMES.includes(m.size)) fail('maze_size', `${p}.maze.size`, `unknown maze size '${m.size}'`, SIZE_NAMES.join(', '));
    if (!STYLE_NAMES.includes(m.style)) fail('maze_style', `${p}.maze.style`, `unknown maze style '${m.style}'`, STYLE_NAMES.join(', '));
    m.density = num(m.density, `${p}.maze.density`, LIMITS.density);
    m.tunnels = num(m.tunnels, `${p}.maze.tunnels`, LIMITS.tunnels, { integer: true });
    m.powerPellets = num(m.powerPellets, `${p}.maze.powerPellets`, LIMITS.powerPellets, { integer: true });
    if (Number.isFinite(m.powerPellets) && m.powerPellets % 2) { warn('power_even', `${p}.maze.powerPellets`, 'power pellets are mirrored, so the count was rounded up to even'); m.powerPellets += 1; }
    lv.speed = num(lv.speed, `${p}.speed`, LIMITS.speed);
  });
  c.lives = num(c.lives, 'lives', LIMITS.lives, { integer: true });
  c.extraLifeAt = num(c.extraLifeAt, 'extraLifeAt', LIMITS.extraLifeAt, { integer: true });
  if (typeof c.endless !== 'boolean') fail('schema', 'endless', 'endless must be true or false');
  if (c.noUpwardTurns === undefined) c.noUpwardTurns = true;
  else if (typeof c.noUpwardTurns !== 'boolean') fail('schema', 'noUpwardTurns', 'noUpwardTurns must be true or false');
  for (const k of Object.keys(c)) if (!(k in schema.properties)) warn('unknown_field', k, `unknown field '${k}' is ignored`);
  return { ok: !errors.length, errors, warnings, content: c };
}
