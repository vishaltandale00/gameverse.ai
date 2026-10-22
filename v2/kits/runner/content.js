// Runner-kit content: schema, prompt, normalization and validation.
// One schema serves every mode; chunk rows are short strings whose alphabet
// depends on the mode (see PROMPT). Errors carry stable codes and paths so the
// pipeline can send them back to the model for repair.
import { PROPS } from '../../art/props.js';
import { MOOD_NAMES } from '../../engine/audio.js';
import { slug } from '../ids.js';

export const MODES = ['lanes', 'side', 'flap', 'climb', 'rhythm-dash', 'hop'];
export const FEELS = ['snappy', 'floaty', 'heavy'];
export const KINDS_BY_MODE = {
  lanes: ['low', 'high', 'wall', 'mover'],
  side: ['crate', 'spike', 'bird', 'laser', 'missile'],
  flap: ['pipe', 'gate'],
  climb: ['platform', 'moving', 'breaking', 'spring', 'vanishing', 'enemy', 'hole'],
  hop: ['road', 'river', 'rail'],
  'rhythm-dash': [],
};
export const KINDS = [...new Set(Object.values(KINDS_BY_MODE).flat())];
export const SEGMENTS = ['run', 'spikes', 'blocks', 'stairs', 'pads', 'orbs', 'gravity', 'speed', 'gaps'];
export const POWERS = ['magnet', 'multiplier', 'jetpack', 'shield', 'superjump', 'slowmo'];
export const POWERS_BY_MODE = {
  lanes: ['magnet', 'multiplier', 'jetpack', 'shield', 'superjump'],
  side: ['magnet', 'multiplier', 'shield', 'jetpack', 'slowmo'],
  flap: ['magnet', 'multiplier', 'shield', 'slowmo'],
  climb: ['magnet', 'multiplier', 'jetpack', 'shield', 'superjump'],
  hop: ['magnet', 'multiplier', 'shield', 'slowmo'],
  'rhythm-dash': [],
};
export const MISSIONS = ['distance', 'coins', 'jumps', 'slides', 'near_misses', 'powerups', 'lane_switches', 'score', 'flaps', 'stomps', 'hops'];
export const MISSIONS_BY_MODE = {
  lanes: ['distance', 'coins', 'jumps', 'slides', 'near_misses', 'powerups', 'lane_switches', 'score'],
  side: ['distance', 'coins', 'jumps', 'near_misses', 'powerups', 'score'],
  flap: ['distance', 'coins', 'flaps', 'near_misses', 'powerups', 'score'],
  climb: ['distance', 'coins', 'jumps', 'stomps', 'powerups', 'score'],
  hop: ['distance', 'coins', 'hops', 'near_misses', 'powerups', 'score'],
  'rhythm-dash': ['distance', 'coins', 'jumps', 'near_misses', 'score'],
};
// Hero and chaser looks: keys into the art director's fallback looks (data only, never drawn as text).
export const LOOKS = { hedgehog: '🦔', fox: '🦊', cat: '🐱', rabbit: '🐰', penguin: '🐧', frog: '🐸', robot: '🤖', alien: '👾', ghost: '👻', bat: '🦇', bird: '🐦', wolf: '🐺', bear: '🐻', ninja: '🥷', wizard: '🧙', cowboy: '🤠', ogre: '👺', dragon: '🐲', crab: '🦀' };
export const PROP_KEYS = { ring: '💍', coin: '🪙', gem: '💎', star: '⭐', heart: '❤️', fruit: '🍎', key: '🔑', orb: '🔮', mushroom: '🍄', feather: '🪶', battery: '🔋', flower: '🌸', scroll: '📜', candy: '🍬', acorn: '🌰', shell: '🐚', note: '🎵', cactus: '🌵', fire: '🔥', electric: '⚡', mine: '💣', 'ice-spikes': '🧊', lava: '🌋', spikes: '⚔️', acid: '☠️', saw: '🪚', flag: '🚩', door: '🚪', portal: '🌀', trophy: '🏆', castle: '🏰', chest: '📦', nest: '🪺' };
const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SCALE_NAMES = ['major', 'minor', 'dorian', 'mixolydian', 'pentatonic'];
const INSTRUMENTS = ['chip', 'synth', 'bell', 'pluck'];

// Built-in row characters per mode (obstacle chars may not reuse them).
export const BUILTIN = {
  lanes: '.o*', side: '.o*#', flap: '.o*#', climb: '.o*=', hop: '.o*T', 'rhythm-dash': '.',
};
// Chunk rows are a picture of the chunk as seen on screen, top row first. Shape per mode:
// lanes/climb/hop rows are rules.width cells across; side pictures are up to 8 rows tall and
// flap pictures exactly 12, any number of columns. spacing: [min, max, default].
export const SHAPE = {
  lanes: { rows: [1, 24], spacing: [5, 20, 10] },
  side: { height: 8, cols: [2, 60], spacing: [1, 3, 1.5] },
  flap: { height: 12, cols: [2, 60], spacing: [0.8, 2, 1] },
  climb: { rows: [2, 40], spacing: [0.9, 2.6, 1.6] },
  hop: { rows: [1, 24], spacing: [1, 1, 1] },
  'rhythm-dash': { rows: [0, 0], spacing: [1, 1, 1] },
};
// World width per mode: [min, max, default]; lanes = lane count, climb = field width, hop = columns.
export const WIDTH = { lanes: [3, 5, 3], climb: [7, 13, 9], hop: [7, 13, 9] };
// Speed clamps per mode (units/s; hop is the camera creep in rows/s; climb and dash ignore it).
export const SPEED = {
  lanes: { start: [8, 22], max: [10, 34], def: [13, 26] },
  side: { start: [6, 14], max: [7, 22], def: [9, 17] },
  flap: { start: [3, 6], max: [3, 8], def: [4, 5.6] },
  climb: { start: [1, 1], max: [1, 1.6], def: [1, 1.4] },
  hop: { start: [0.15, 0.6], max: [0.2, 1.2], def: [0.3, 0.8] },
  'rhythm-dash': { start: [1, 1], max: [1, 1], def: [1, 1] },
};
// Numeric params per obstacle kind: [lo, hi, default] for speed, size and period.
export const PARAMS = {
  low: {}, high: {},
  wall: { size: [3, 40, 12] },
  mover: { speed: [0.2, 1, 0.5], size: [6, 30, 14] },
  crate: { speed: [0.1, 0.6, 0.3] },
  spike: {}, laser: {},
  bird: { speed: [0, 0.5, 0.2], period: [0.5, 3, 1.4] },
  missile: { speed: [0.3, 1.5, 0.8], period: [0.6, 2, 1.1] },
  pipe: {},
  gate: { size: [0.5, 3, 1.5], period: [1, 5, 2.5] },
  platform: {}, breaking: {}, spring: {}, vanishing: {},
  moving: { speed: [0.5, 4, 1.8], size: [1, 3.5, 2] },
  enemy: { speed: [0, 3, 1], size: [0, 3, 1.5] },
  hole: { size: [0.5, 1.2, 0.8] },
  road: { speed: [1, 6, 2.5], size: [1, 3, 1.5], period: [3, 12, 6] },
  river: { speed: [0.6, 3, 1.4], size: [2, 5, 3], period: [3, 8, 5] },
  rail: { size: [6, 20, 12], period: [4, 14, 7] },
};

const str = (description) => ({ type: 'string', ...(description ? { description } : {}) });
const num = (description) => ({ type: 'number', ...(description ? { description } : {}) });
const int = (description) => ({ type: 'integer', ...(description ? { description } : {}) });
const en = (list, description) => ({ type: 'string', enum: list, ...(description ? { description } : {}) });
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const arr = (items, description) => ({ type: 'array', items, ...(description ? { description } : {}) });

export const SCHEMA = obj({
  title: str(), logline: str('one sentence pitch'),
  mode: en(MODES), control: en(['jump', 'fly'], 'side mode only: jump (Canabalt) or fly (hold to jetpack)'), feel: en(FEELS),
  artStyle: str('look and setting, e.g. "bright cartoon vector, neon city rooftops at night"'),
  background: str('mood hex color'),
  music: obj({ mood: en(MOOD_NAMES), tempo: int('bpm 90-170'), key: en(KEYS), scale: en(SCALE_NAMES), instrument: en(INSTRUMENTS) }),
  cast: obj({
    hero: obj({ name: str(), look: en(Object.keys(LOOKS)) }),
    chaser: obj({ name: str(), look: en(Object.keys(LOOKS)) }),
    coin: obj({ name: str(), kind: en(PROPS.pickup) }),
    hazard: obj({ name: str(), kind: en(PROPS.hazard) }),
    goal: obj({ name: str(), kind: en(PROPS.goal) }),
  }),
  speed: obj({ start: num(), max: num(), rampSeconds: num() }),
  rules: obj({ width: int('lanes: 3-5 lanes; climb: field 7-13 wide; hop: 7-13 columns; else 0'), lives: int('1-5'), goalDistance: num('0 = endless; else a finish distance that wins the run'), density: num('0.5 sparse to 2 packed: breathing room between chunks') }),
  scoring: obj({ perMeter: num(), coin: num(), nearMiss: num() }),
  obstacles: arr(obj({ char: str('one character used in chunk rows'), kind: en(KINDS), name: str(), speed: num(), size: num(), period: num() })),
  chunks: arr(obj({ id: str(), tier: int('1-3'), spacing: num(), rows: arr(str()) })),
  segments: arr(obj({ type: en(SEGMENTS), bars: int('1-8'), intensity: int('1-3') }), 'rhythm-dash only'),
  powerups: arr(obj({ kind: en(POWERS), name: str(), seconds: num() })),
  missions: arr(obj({ kind: en(MISSIONS), target: int(), label: str() })),
});

export const PROMPT = `You design an endless-runner or one-touch arcade game for a code engine. Pick the mode that fits the idea:
- lanes: 3-lane chase runner seen from behind (Subway Surfers, Temple Run). Swipe lanes, jump, slide.
- side: side-scrolling auto-runner (Canabalt, Chrome Dino; control "jump") or jetpack flyer (Jetpack Joyride; control "fly").
- flap: tap to flap through gates (Flappy Bird).
- climb: auto-bouncing vertical climber steering left/right (Doodle Jump).
- rhythm-dash: auto-run on a beat grid, tap to jump (Geometry Dash). Uses segments, not chunks.
- hop: hop forward across roads, rivers and rails (Crossy Road).

Content:
- cast: hero, chaser (the enemy: lanes chaser, climb monsters, hop eagle), coin (the pickup), hazard and goal names with a look/kind.
- speed: start and max speed and rampSeconds to reach max. lanes 13→26, side 9→17, flap 4→5.6, hop camera creep 0.3→0.8 rows/s; climb and rhythm-dash use 1 and 1.4.
- obstacles: the obstacle set. Each has a single char used in chunk rows, a kind for the mode, a name and params (speed, size, period; 0 when unused).
  lanes kinds: low (jump over), high (slide under), wall (parked train, switch lanes; size = length 6-30), mover (oncoming train; speed = closing ratio 0.2-1, size = length).
  side kinds: crate (slows you; speed = slowdown 0.1-0.6), spike (deadly, jump it), bird (deadly flyer; speed 0-0.5, period = bob seconds), laser (deadly beam cell), missile (warned, flies at you along its row; speed 0.3-1.5, period = warning seconds).
  flap kinds: pipe (static gate cell), gate (moving gate cell; size = amplitude cells 0.5-3, period seconds).
  climb kinds: platform, moving (speed 0.5-4, size = range 1-3.5), breaking (falls when landed on), spring (super bounce), vanishing (one bounce), enemy (stomp or shoot; speed, size = patrol range), hole (deadly; size = radius 0.5-1.2).
  hop kinds: road (cars; speed cells/s 1-6, size = car length 1-3, period = spacing 3-12), river (logs; speed 0.6-3, size = log length 2-5, period = spacing 3-8), rail (train; size = length, period = seconds between trains 4-14).
- chunks: 6-12 hand-made chunks with tier 1 (easy), 2 or 3 (hard). rows are a picture of the chunk as seen on screen, top row first, one character per cell. '.' empty, 'o' coin, '*' power-up box. Never give an obstacle the char of a built-in ('.', 'o', '*', and '#', '=' or 'T' where listed).
  lanes: each row has one cell per lane (rules.width, 3 by default); the top row is farthest ahead, the bottom row is reached first; rows are spacing units apart (6-14). Always leave a way through every row.
  side: a side view up to 8 rows tall, top row = sky, bottom row = street level; columns run left to right in the direction you run, each spacing units wide (1-3). '#' is solid roof or ground. In jump control start and end each chunk on street level (bottom row '#'), keep gaps ≤ 3 units wide and climbs ≤ 2 cells. In fly control the floor is automatic: the bottom row is the floor lane; lasers stack vertically.
  flap: a side view exactly 12 rows tall, columns left to right, each spacing units wide (1). Draw each gate as a vertical line of '#' (or a pipe/gate char) from the top edge and from the bottom edge, leaving a gap of 3-5 open rows; leave 4-6 empty columns between gates.
  climb: a picture, rules.width cells across (9), top row highest; rows spacing units apart (1.2-2.2); '=' is a normal platform; the bottom row needs a '=' platform; never leave more than 2 empty rows in a row.
  hop: a picture, rules.width cells across (9), top row farthest. A row containing a road/river/rail char is that lane type (fill it with that char; coins allowed). Other rows are grass: '.', 'T' trees, 'o' coins. Never wall off grass rows completely with trees.
- segments (rhythm-dash only, else []): 16-40 bars total in order; types run, spikes, blocks, stairs, pads, orbs, gravity, speed, gaps; intensity 1-3.
- rules: width (lanes 3, climb 9, hop 9 by default; rows must be exactly that many characters), lives (1 classic), goalDistance (0 for endless), density (1 normal).
- powerups: 2-4 from magnet, multiplier, jetpack, shield, superjump, slowmo with seconds 5-15.
- missions: 3-6 short goals (kind + target + label like "Collect 50 shells").
- music: tempo sets the rhythm-dash beat; choose a mood that fits.

Change requests map to real fields; never fake one with a stand-in, and keep everything a request doesn't mention (counts included):
- longer/shorter run, a finish line, "make it end" → rules.goalDistance (metres, rows for hop); "endless" → 0. rhythm-dash: add or remove segments (bars).
- wider/narrower world, more lanes → rules.width (lanes 3-5, climb 7-13, hop 7-13) and rewrite every chunk row at the new width. side and flap have a fixed field height.
- faster/slower, harder/easier → speed.start/max/rampSeconds; harder also moves chunks to higher tiers or adds obstacles to rows; rhythm-dash raises segment intensity or tempo.
- more/fewer obstacles or enemies → rules.density (lanes, side, flap, hop) and add or remove obstacle chars in chunk rows (climb enemies 'E' etc.); more chunks for more variety.
- more lives / extra chances → rules.lives (1-5).`;

const CLIMB_REACH = 3.5;
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const numOr = (v, d) => Number.isFinite(v) ? v : d;
const HEX = /^#[0-9a-f]{6}$/i;

/** Deep-copied content with defaults filled and numbers clamped. Does not validate. */
export function normalize(input) {
  const c = structuredClone(input);
  const mode = MODES.includes(c.mode) ? c.mode : 'side';
  c.mode = mode;
  c.control = c.control === 'fly' && mode === 'side' ? 'fly' : 'jump';
  c.feel = FEELS.includes(c.feel) ? c.feel : 'snappy';
  c.artStyle = typeof c.artStyle === 'string' ? c.artStyle.slice(0, 120) : '';
  c.background = HEX.test(c.background || '') ? c.background : '#1d2b4a';
  const m = c.music || {};
  c.music = { mood: MOOD_NAMES.includes(m.mood) ? m.mood : 'energetic', tempo: Math.round(clamp(numOr(m.tempo, 128), 90, 170)), key: KEYS.includes(m.key) ? m.key : 'C', scale: SCALE_NAMES.includes(m.scale) ? m.scale : 'major', instrument: INSTRUMENTS.includes(m.instrument) ? m.instrument : 'synth' };
  const cast = c.cast || {};
  const look = (v, d) => (v && LOOKS[v.look] ? v.look : d);
  c.cast = {
    hero: { name: String(cast.hero?.name || 'Runner').slice(0, 40), look: look(cast.hero, 'fox') },
    chaser: { name: String(cast.chaser?.name || 'Chaser').slice(0, 40), look: look(cast.chaser, 'robot') },
    coin: { name: String(cast.coin?.name || 'Coin').slice(0, 40), kind: PROPS.pickup.includes(cast.coin?.kind) ? cast.coin.kind : 'coin' },
    hazard: { name: String(cast.hazard?.name || 'Hazard').slice(0, 40), kind: PROPS.hazard.includes(cast.hazard?.kind) ? cast.hazard.kind : 'spikes' },
    goal: { name: String(cast.goal?.name || 'Goal').slice(0, 40), kind: PROPS.goal.includes(cast.goal?.kind) ? cast.goal.kind : 'flag' },
  };
  const sp = SPEED[mode], s = c.speed || {};
  const start = clamp(numOr(s.start, sp.def[0]), ...sp.start);
  c.speed = { start, max: clamp(Math.max(numOr(s.max, sp.def[1]), start), ...sp.max), rampSeconds: clamp(numOr(s.rampSeconds, 90), 20, 300) };
  if (c.speed.max < start) c.speed.max = start;
  const r = c.rules || {}, wd = WIDTH[mode];
  c.rules = {
    width: wd ? Math.round(clamp(numOr(r.width, wd[2]), wd[0], wd[1])) : 0,
    lives: Math.round(clamp(numOr(r.lives, 1), 1, 5)),
    goalDistance: mode === 'rhythm-dash' ? 0 : Math.round(clamp(numOr(r.goalDistance, 0), 0, 100000)),
    density: clamp(numOr(r.density, 1), 0.5, 2),
  };
  const sc = c.scoring || {};
  c.scoring = { perMeter: clamp(numOr(sc.perMeter, 1), 0.1, 10), coin: Math.round(clamp(numOr(sc.coin, 10), 1, 100)), nearMiss: Math.round(clamp(numOr(sc.nearMiss, 50), 0, 500)) };
  c.obstacles = (Array.isArray(c.obstacles) ? c.obstacles : []).map(o => {
    const p = PARAMS[o?.kind] || {};
    const fix = (key) => p[key] ? clamp(numOr(o[key], p[key][2]), p[key][0], p[key][1]) : 0;
    return { char: typeof o?.char === 'string' ? o.char : '', kind: o?.kind, name: String(o?.name || o?.kind || 'Obstacle').slice(0, 40), speed: fix('speed'), size: fix('size'), period: fix('period') };
  });
  const sh = SHAPE[mode];
  c.chunks = (Array.isArray(c.chunks) ? c.chunks : []).map((k, i) => ({
    id: typeof k?.id === 'string' && k.id ? k.id : `chunk-${i + 1}`,
    tier: Math.round(clamp(numOr(k?.tier, 1), 1, 3)),
    spacing: clamp(numOr(k?.spacing, sh.spacing[2]), sh.spacing[0], sh.spacing[1]),
    rows: Array.isArray(k?.rows) ? k.rows.map(r => typeof r === 'string' ? r : String(r ?? '')) : [],
  }));
  c.segments = (Array.isArray(c.segments) ? c.segments : []).map(s => ({ type: SEGMENTS.includes(s?.type) ? s.type : 'run', bars: Math.round(clamp(numOr(s?.bars, 2), 1, 8)), intensity: Math.round(clamp(numOr(s?.intensity, 1), 1, 3)) }));
  c.powerups = (Array.isArray(c.powerups) ? c.powerups : []).map(p => ({ kind: p?.kind, name: String(p?.name || p?.kind || 'Power').slice(0, 40), seconds: clamp(numOr(p?.seconds, 8), 3, 20) }));
  c.missions = (Array.isArray(c.missions) ? c.missions : []).map(m => ({ kind: m?.kind, target: Math.round(clamp(numOr(m?.target, 10), 1, 100000)), label: String(m?.label || `${m?.kind} ${m?.target}`).slice(0, 60) }));
  c.title = typeof c.title === 'string' ? c.title.trim().slice(0, 80) : '';
  c.logline = typeof c.logline === 'string' ? c.logline.slice(0, 200) : '';
  return c;
}

// ---------- repair ----------
// Models get the shape of chunk rows wrong far more often than the idea. Validation repairs
// everything that has an obvious fix (row widths, picture height, unknown characters, clashing
// obstacle chars, unreachable climb gaps, walled-off rows) and warns; errors remain only for
// content with nothing to repair from. Passability after repair is the structural proof's job.
const SOLIDISH = '#=|X█▓[]{}H';
const COINISH = 'oO0c$•@';
const POWERISH = '*+?!P';
const FREE = 'ABCDEFGHIJKLMNPQRSUVWXYZabdefghijklmnpqrstuvwxyz123456789^~%&-:;!?<>/\\';
const BOUNCE_KINDS = ['platform', 'moving', 'spring', 'vanishing'];
const SOLID_OF = { side: '#', flap: '#', climb: '=', hop: 'T' };
// Built-in chars carry fixed meanings; an obstacle redefining one with the same meaning is redundant.
const BUILTIN_KIND = { side: { '#': null }, flap: { '#': 'pipe' }, climb: { '=': 'platform' }, hop: { T: null }, lanes: {} };

/** Map a character the mode doesn't know to the closest valid one, or empty. */
function closestChar(ch, valid, mode, chars) {
  if (valid.has(ch)) return ch;
  for (const alt of [ch.toLowerCase(), ch.toUpperCase()]) if (valid.has(alt)) return alt;
  if (/\s/.test(ch) || ch === '_' || ch === ',' || ch === '`') return '.';
  if (SOLIDISH.includes(ch)) {
    if (SOLID_OF[mode]) return SOLID_OF[mode];
    const wall = [...chars.values()].find(o => o.kind === 'wall');
    return wall ? wall.char : '.';
  }
  if (COINISH.includes(ch)) return 'o';
  if (POWERISH.includes(ch)) return '*';
  return '.';
}

// Width repair: pad with empty cells; trim from the end least likely to remove a needed gap.
function fitRow(row, width, mode, chars) {
  let cells = [...row];
  const kind = ch => chars.get(ch)?.kind;
  const lane = mode === 'hop' ? cells.find(ch => ['road', 'river', 'rail'].includes(kind(ch))) : null;
  while (cells.length < width) {
    const fill = lane || '.';
    if (mode === 'lanes' && cells.length % 2) cells.unshift(fill); else cells.push(fill);
  }
  while (cells.length > width) {
    const a = cells[0], b = cells[cells.length - 1];
    // Prefer dropping what blocks (lanes, hop trees) or what is empty (climb), keeping open cells and platforms.
    const cost = ch => mode === 'climb' ? (ch === '.' ? 0 : 2) : mode === 'lanes' ? (ch === '.' ? 2 : 0) : mode === 'hop' ? (ch === 'T' ? 0 : ch === '.' ? 1 : 2) : 0;
    if (cost(a) < cost(b)) cells.shift(); else cells.pop();
  }
  return cells.join('');
}

/** Validate and repair content. Returns { ok, errors, warnings, content } where content is normalized. */
export function validate(input) {
  const errors = [], warnings = [];
  const fail = (code, path, message, hint) => { errors.push({ code, path, message, ...(hint ? { hint } : {}) }); };
  const warn = (code, path, message) => { warnings.push({ code, path, message }); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: [{ code: 'schema', path: '$', message: 'content must be an object', hint: 'reply with the content object' }], warnings, content: null };
  if (!MODES.includes(input.mode)) fail('mode', 'mode', `unknown mode '${input.mode}'`, `one of ${MODES.join(', ')}`);
  const c = normalize(input);
  const mode = c.mode;
  if (!c.title) { c.title = 'Runner'; warn('title_default', 'title', 'no title; using "Runner"'); }
  if (c.rules.goalDistance > 0 && c.rules.goalDistance < 50) warn('goal_short', 'rules.goalDistance', 'a finish under 50 ends almost at once');

  // Obstacles: one visible char each, kinds valid for the mode, no clashes with built-ins or each other.
  const allowed = KINDS_BY_MODE[mode], builtin = BUILTIN[mode];
  const chars = new Map();
  const taken = new Set(builtin);
  c.obstacles = c.obstacles.filter((o, i) => {
    const p = `obstacles[${i}]`;
    if (!KINDS.includes(o.kind)) { warn('obstacle_kind', `${p}.kind`, `unknown kind '${o.kind}'; dropped`); return false; }
    if (!allowed.includes(o.kind)) { warn('obstacle_mode', `${p}.kind`, `kind '${o.kind}' is not used in ${mode} mode; dropped`); return false; }
    const ch = [...String(o.char).replace(/\s/g, '')][0] || '';
    if (ch && builtin.includes(ch)) {
      warn('obstacle_builtin', `${p}.char`, `'${ch}' is built in for ${mode} (${ch === 'o' ? 'coin' : ch === '*' ? 'power-up' : ch === '.' ? 'empty' : 'solid'}); rows keep that meaning and this obstacle is dropped`);
      return false;
    }
    if (ch && chars.has(ch)) { warn('duplicate_char', `${p}.char`, `char '${ch}' is used twice; the first one wins`); return false; }
    o.char = ch || [...FREE].find(x => !taken.has(x));
    if (!ch) warn('obstacle_char', `${p}.char`, `no char; using '${o.char}'`);
    taken.add(o.char); chars.set(o.char, o);
    return true;
  });
  const valid = new Set([...builtin, ...chars.keys()]);

  if (mode === 'rhythm-dash') {
    if (c.chunks.length) warn('chunks_unused', 'chunks', 'rhythm-dash builds its level from segments; chunks are ignored');
    c.chunks = [];
    if (!c.segments.length) fail('segments_missing', 'segments', 'rhythm-dash needs segments', 'list 6-12 segments like { type: "spikes", bars: 2, intensity: 1 }, 16-40 bars in total');
    else {
      // Too short: repeat what was written. Too long for a fair 90 s level: trim the end.
      const barsOf = list => list.reduce((s, x) => s + x.bars, 0);
      const base = c.segments.slice();
      for (let i = 0; barsOf(c.segments) < 12; i++) c.segments.push({ ...base[i % base.length] });
      if (c.segments.length > base.length) warn('segments_repeated', 'segments', `level was under 12 bars; repeated the segments to ${barsOf(c.segments)} bars`);
      const maxBars = Math.floor((90 * c.music.tempo) / 240);
      while (barsOf(c.segments) > maxBars && c.segments.length > 1) c.segments.pop();
      if (barsOf(c.segments) > maxBars) c.segments[0].bars = Math.max(1, maxBars);
      if (barsOf(base) > maxBars) warn('segments_trimmed', 'segments', `level longer than 90 s at ${c.music.tempo} bpm; trimmed to ${barsOf(c.segments)} bars`);
    }
  } else {
    if (c.segments.length) c.segments = [];
    c.chunks = c.chunks.filter((k, i) => { if (k.rows.length) return true; warn('chunk_empty', `chunks[${i}]`, 'empty chunk dropped'); return false; });
    if (!c.chunks.length) fail('chunks_missing', 'chunks', 'no chunks with rows', `write 3-12 chunks; ${ROWS_HINT[mode]}`);
    if (c.chunks.length > 16) { warn('chunks_trimmed', 'chunks', `kept the first 16 of ${c.chunks.length} chunks`); c.chunks = c.chunks.slice(0, 16); }
    if (c.chunks.length && !c.chunks.some(k => k.tier === 1)) { const easiest = c.chunks.reduce((a, b) => (b.tier < a.tier ? b : a)); warn('chunks_tier', `chunks[${c.chunks.indexOf(easiest)}].tier`, 'no tier 1 chunk; the easiest one becomes tier 1'); easiest.tier = 1; }
    // Ids: slugs, unique.
    const ids = new Set();
    c.chunks.forEach((k, i) => { let id = slug(k.id) || `chunk-${i + 1}`; if (ids.has(id)) id = `${id}-${i + 1}`.slice(0, 32); ids.add(id); k.id = id; });
    // A shared row width the model chose consistently is taken as the world width.
    const wd = WIDTH[mode];
    if (wd) {
      const widths = c.chunks.flatMap(k => k.rows.map(r => [...r].length));
      const common = widths.length && widths.every(w => w === widths[0]) ? widths[0] : null;
      if (common && common !== c.rules.width && common >= wd[0] && common <= wd[1]) { warn('width_from_rows', 'rules.width', `every row is ${common} cells; rules.width set to ${common}`); c.rules.width = common; }
    }
    c.chunks.forEach((k, i) => repairChunk(mode, c, k, chars, valid, `chunks[${i}]`, warn));
  }

  // Power-ups and missions the mode can't use are dropped, never fatal.
  const powers = POWERS_BY_MODE[mode];
  c.powerups = c.powerups.filter((x, i) => {
    if (powers.includes(x.kind)) return true;
    warn('power_mode', `powerups[${i}].kind`, `'${x.kind}' does nothing in ${mode} mode; dropped`); return false;
  });
  const missions = MISSIONS_BY_MODE[mode];
  c.missions = c.missions.filter((x, i) => {
    if (missions.includes(x.kind)) return true;
    warn('mission_mode', `missions[${i}].kind`, `'${x.kind}' can't progress in ${mode} mode; dropped`); return false;
  });
  if (!c.missions.length) warn('missions_none', 'missions', 'no missions; players get no mid-run goals');
  return { ok: errors.length === 0, errors, warnings, content: c };
}

const ROWS_HINT = {
  lanes: 'each row is one string per lane across, the top row farthest ahead',
  side: 'rows are a picture up to 8 rows tall, top row = sky, bottom row = street',
  flap: 'rows are a picture exactly 12 rows tall, columns left to right',
  climb: 'rows are a picture, top row highest, each row the field width',
  hop: 'rows are a picture, top row farthest, each row the field width',
};

function repairChunk(mode, c, k, chars, valid, p, warn) {
  const kindOf = ch => chars.get(ch)?.kind;
  const sh = SHAPE[mode];
  // Unknown characters → the closest valid one.
  const mapped = new Set();
  k.rows = k.rows.map(row => [...row].map(ch => { const v = closestChar(ch, valid, mode, chars); if (v !== ch) mapped.add(`'${ch}'→'${v}'`); return v; }).join(''));
  if (mapped.size) warn('row_char_mapped', `${p}.rows`, `unknown characters mapped: ${[...mapped].slice(0, 6).join(', ')}`);
  let resized = 0;
  const note = () => { resized++; };
  if (mode === 'side' || mode === 'flap') {
    // Pictures: equal-length rows (pad on the right), fixed or capped height.
    const longest = Math.min(sh.cols[1], Math.max(...k.rows.map(r => [...r].length)));
    k.rows = k.rows.map(r => { const cells = [...r]; if (cells.length !== longest) note(); while (cells.length < longest) cells.push('.'); return cells.slice(0, longest).join(''); });
    if (mode === 'side') {
      while (k.rows.length > sh.height && /^\.*$/.test(k.rows[0])) { k.rows.shift(); note(); }
      while (k.rows.length > sh.height) { k.rows.shift(); note(); }
    } else {
      const solid = ch => ch === '#' || ['pipe', 'gate'].includes(kindOf(ch));
      const gateCols = [...k.rows[0]].map((_, x) => k.rows.some(r => solid(r[x])));
      const openIn = row => [...row].filter((ch, x) => gateCols[x] && !solid(ch)).length;
      // Too tall: drop the edge row that opens the fewest gate cells. Too short: extend pipes at the edges.
      while (k.rows.length > sh.height) { if (openIn(k.rows[0]) <= openIn(k.rows[k.rows.length - 1])) k.rows.shift(); else k.rows.pop(); note(); }
      for (let n = 0; k.rows.length < sh.height; n++) {
        const top = n % 2 === 0, edge = top ? k.rows[0] : k.rows[k.rows.length - 1];
        const row = [...edge].map(ch => (solid(ch) ? ch : '.')).join('');
        if (top) k.rows.unshift(row); else k.rows.push(row);
        note();
      }
      // A gate column with no 3-cell opening can never be flown: open its middle.
      for (let x = 0; x < gateCols.length; x++) {
        if (!k.rows.some(r => solid(r[x]))) continue;
        let best = 0, run = 0; for (const r of k.rows) { run = solid(r[x]) ? 0 : run + 1; best = Math.max(best, run); }
        if (best >= 3) continue;
        for (let y = 4; y <= 7; y++) k.rows[y] = k.rows[y].slice(0, x) + '.' + k.rows[y].slice(x + 1);
        warn('flap_gap_opened', `${p}.rows`, `column ${x} had no 3-cell gap; opened rows 4-7`);
      }
    }
    if (k.rows[0] && [...k.rows[0]].length < sh.cols[0]) { k.rows = k.rows.map(r => r.padEnd(sh.cols[0], '.')); note(); }
  } else {
    const width = c.rules.width;
    k.rows = k.rows.map(r => { const fitted = fitRow(r, width, mode, chars); if (fitted !== r) note(); return fitted; });
    if (k.rows.length > sh.rows[1]) { k.rows = k.rows.slice(k.rows.length - sh.rows[1]); note(); }
  }
  if (resized) warn('row_resized', `${p}.rows`, `${resized} row${resized > 1 ? 's' : ''} padded or trimmed to the ${mode} shape (${ROWS_HINT[mode]})`);

  if (mode === 'lanes') {
    k.rows.forEach((row, j) => {
      if ([...row].every(ch => ['wall', 'mover'].includes(kindOf(ch)))) {
        const mid = Math.floor(row.length / 2);
        k.rows[j] = row.slice(0, mid) + '.' + row.slice(mid + 1);
        warn('row_opened', `${p}.rows[${j}]`, 'every lane was a train; opened the middle lane');
      }
    });
  } else if (mode === 'side' && c.control === 'fly' && k.rows.some(r => r.includes('#'))) warn('fly_solid', `${p}.rows`, "fly control has an automatic floor; '#' cells are ignored");
  else if (mode === 'climb') {
    // Rows are a picture (top row highest); work bottom-up.
    const W = c.rules.width, up = k.rows.slice().reverse();
    const bounce = ch => ch === '=' || BOUNCE_KINDS.includes(kindOf(ch));
    const has = r => [...r].some(bounce);
    const put = (j, x) => { const cells = [...up[j]]; const a = Math.max(0, Math.min(W - 2, x)); cells[a] = '='; cells[a + 1] = '='; up[j] = cells.join(''); };
    const platX = r => { const x = [...r].findIndex(bounce); return x < 0 ? Math.floor(W / 2) - 1 : x; };
    if (!has(up[0])) { put(0, Math.floor(W / 2) - 1); warn('climb_start', `${p}.rows[${k.rows.length - 1}]`, 'the bottom row had no platform to bounce on; added one'); }
    const step = Math.max(1, Math.floor(CLIMB_REACH / k.spacing));
    let last = 0;
    for (let j = 1; j < up.length; j++) {
      if (has(up[j])) { last = j; continue; }
      if (j - last >= step) { put(j, platX(up[last])); last = j; warn('climb_gap', `${p}.rows[${k.rows.length - 1 - j}]`, `no bounceable row within reach (${CLIMB_REACH} units); added a platform`); }
    }
    if ((up.length - last) * k.spacing > CLIMB_REACH) { const j = up.length - 1; put(j, platX(up[last])); warn('climb_gap', `${p}.rows[0]`, 'the top row was too far below the next chunk; added a platform'); }
    k.rows = up.reverse();
  } else if (mode === 'hop') {
    k.rows.forEach((row, j) => {
      const lane = [...row].map(kindOf).find(Boolean);
      if (!lane && [...row].every(ch => ch === 'T')) { const mid = Math.floor(row.length / 2); k.rows[j] = row.slice(0, mid) + '.' + row.slice(mid + 1); warn('hop_opened', `${p}.rows[${j}]`, 'a grass row was all trees; opened the middle'); }
    });
  }
}
