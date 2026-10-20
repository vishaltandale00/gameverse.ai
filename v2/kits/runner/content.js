// Runner-kit content: schema, prompt, normalization and validation.
// One schema serves every mode; chunk rows are short strings whose alphabet
// depends on the mode (see PROMPT). Errors carry stable codes and paths so the
// pipeline can send them back to the model for repair.
import { PROPS } from '../../art/props.js';
import { MOOD_NAMES } from '../../engine/audio.js';

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
// Row shape per mode: exact width (or max height for side slices), row count limits, spacing clamp.
export const SHAPE = {
  lanes: { width: 3, rows: [2, 24], spacing: [5, 20] },
  side: { maxHeight: 8, rows: [4, 40], spacing: [1, 3] },
  flap: { width: 12, rows: [2, 16], spacing: [3, 9] },
  climb: { width: 9, rows: [4, 40], spacing: [0.9, 2.6] },
  hop: { width: 9, rows: [2, 24], spacing: [1, 1] },
  'rhythm-dash': { rows: [0, 0], spacing: [1, 1] },
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
- chunks: 6-12 hand-made chunks with tier 1 (easy), 2 or 3 (hard). Rows are strings; first row is nearest. '.' empty, 'o' coin, '*' power-up box.
  lanes: each row is 3 chars (left, middle, right lane), rows are spacing units apart (6-14). Always leave a way through every row.
  side: each row is one vertical slice listed bottom to top, up to 8 chars; spacing = slice width (1-3). '#' is solid roof. In jump control every chunk's first and last slice is exactly "#" (street height 1); a slice with no '#' is a gap; keep gaps ≤ 3 units wide and climbs ≤ 2 cells. In fly control the floor is automatic: index 0 is the floor cell; lasers stack vertically.
  flap: each row is one gate column, 12 chars top to bottom; '#' (or a pipe/gate char) blocks; leave a gap of 3-5 open cells; spacing between columns 4-7.
  climb: each row is 9 chars across, listed bottom to top, spacing 1.2-2.2 units apart; '=' is a normal platform; the first row needs a '=' platform; never leave more than 2 empty rows in a row.
  hop: each row is 9 chars. A row containing a road/river/rail char is that lane type (fill it with that char; coins allowed). Other rows are grass: '.', 'T' trees, 'o' coins. Never wall off grass rows completely with trees.
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
    spacing: clamp(numOr(k?.spacing, sh.spacing[0]), ...sh.spacing),
    rows: Array.isArray(k?.rows) ? k.rows.map(r => String(r ?? '')) : [],
  }));
  c.segments = (Array.isArray(c.segments) ? c.segments : []).map(s => ({ type: SEGMENTS.includes(s?.type) ? s.type : 'run', bars: Math.round(clamp(numOr(s?.bars, 2), 1, 8)), intensity: Math.round(clamp(numOr(s?.intensity, 1), 1, 3)) }));
  c.powerups = (Array.isArray(c.powerups) ? c.powerups : []).map(p => ({ kind: p?.kind, name: String(p?.name || p?.kind || 'Power').slice(0, 40), seconds: clamp(numOr(p?.seconds, 8), 3, 20) }));
  c.missions = (Array.isArray(c.missions) ? c.missions : []).map(m => ({ kind: m?.kind, target: Math.round(clamp(numOr(m?.target, 10), 1, 100000)), label: String(m?.label || `${m?.kind} ${m?.target}`).slice(0, 60) }));
  c.title = typeof c.title === 'string' ? c.title.slice(0, 80) : '';
  c.logline = typeof c.logline === 'string' ? c.logline.slice(0, 200) : '';
  return c;
}

/** Validate content. Returns { ok, errors, warnings, content } where content is normalized. */
export function validate(input) {
  const errors = [], warnings = [];
  const fail = (code, path, message, hint) => { errors.push({ code, path, message, ...(hint ? { hint } : {}) }); };
  const warn = (code, path, message) => { warnings.push({ code, path, message }); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: [{ code: 'schema', path: '$', message: 'content must be an object' }], warnings, content: null };
  if (!MODES.includes(input.mode)) fail('mode', 'mode', `unknown mode '${input.mode}'`, MODES.join(', '));
  const c = normalize(input);
  const mode = c.mode;
  if (!c.title.trim()) fail('schema', 'title', 'title is required');
  if (c.rules.goalDistance > 0 && c.rules.goalDistance < 50) warn('goal_short', 'rules.goalDistance', 'a finish under 50 ends almost at once');

  // Obstacles: unique single chars that don't shadow built-ins, kinds valid for the mode.
  const allowed = KINDS_BY_MODE[mode], builtin = BUILTIN[mode];
  const chars = new Map();
  c.obstacles = c.obstacles.filter((o, i) => {
    const p = `obstacles[${i}]`;
    if (!KINDS.includes(o.kind)) { fail('obstacle_kind', `${p}.kind`, `unknown obstacle kind '${o.kind}'`, allowed.join(', ')); return false; }
    if (!allowed.includes(o.kind)) { warn('obstacle_mode', `${p}.kind`, `kind '${o.kind}' is not used in ${mode} mode; dropped`); return false; }
    if ([...o.char].length !== 1 || /\s/.test(o.char)) { fail('obstacle_char', `${p}.char`, 'char must be exactly one visible character'); return false; }
    if (builtin.includes(o.char)) { fail('obstacle_char', `${p}.char`, `'${o.char}' is a built-in row character in ${mode} mode`, `avoid ${[...builtin].join(' ')}`); return false; }
    if (chars.has(o.char)) { fail('duplicate_char', `${p}.char`, `char '${o.char}' is used twice`); return false; }
    chars.set(o.char, o); return true;
  });

  // Chunks.
  const sh = SHAPE[mode];
  if (mode === 'rhythm-dash') {
    if (c.chunks.length) warn('chunks_unused', 'chunks', 'rhythm-dash builds its level from segments; chunks are ignored');
    c.chunks = [];
    const bars = c.segments.reduce((s, x) => s + x.bars, 0);
    if (c.segments.length < 4) fail('segments_count', 'segments', `need at least 4 segments, got ${c.segments.length}`);
    if (bars < 12 || bars > 64) fail('segments_length', 'segments', `the level needs 12-64 bars, got ${bars}`, 'about 16-40 bars makes a 30-80 s level');
  } else {
    if (c.segments.length) c.segments = [];
    if (c.chunks.length < 3 || c.chunks.length > 16) fail('chunks_count', 'chunks', `need 3-16 chunks, got ${c.chunks.length}`);
    if (!c.chunks.some(k => k.tier === 1)) fail('chunks_tier', 'chunks', 'at least one chunk must be tier 1');
    const ids = new Set();
    c.chunks.forEach((k, i) => {
      const p = `chunks[${i}]`;
      if (!SLUG.test(k.id)) k.id = `chunk-${i + 1}`;
      if (ids.has(k.id)) k.id = `${k.id}-${i + 1}`;
      ids.add(k.id);
      if (k.rows.length < sh.rows[0] || k.rows.length > sh.rows[1]) fail('chunk_rows', `${p}.rows`, `${mode} chunks need ${sh.rows[0]}-${sh.rows[1]} rows, got ${k.rows.length}`);
      k.rows.forEach((row, j) => {
        const rp = `${p}.rows[${j}]`;
        const cells = [...row];
        const width = WIDTH[mode] ? c.rules.width : sh.width;
        if (width && cells.length !== width) fail('row_width', rp, `${mode} rows must be exactly ${width} characters (rules.width), got ${cells.length}`, `pad with '.'`);
        if (sh.maxHeight && (cells.length < 1 || cells.length > sh.maxHeight)) fail('row_height', rp, `side slices are 1-${sh.maxHeight} characters bottom to top`, `use '.' for an empty slice`);
        for (const ch of cells) if (!builtin.includes(ch) && !chars.has(ch)) { fail('row_char', rp, `unknown character '${ch}'`, `use ${[...builtin].join(' ')} or an obstacle char`); break; }
      });
      if (errors.length) return;
      checkChunk(mode, c, k, chars, p, fail, warn);
    });
  }

  // Power-ups and missions.
  const powers = POWERS_BY_MODE[mode];
  c.powerups = c.powerups.filter((x, i) => {
    if (!POWERS.includes(x.kind)) { fail('power_kind', `powerups[${i}].kind`, `unknown power-up '${x.kind}'`, POWERS.join(', ')); return false; }
    if (!powers.includes(x.kind)) { warn('power_mode', `powerups[${i}].kind`, `'${x.kind}' does nothing in ${mode} mode; dropped`); return false; }
    return true;
  });
  const missions = MISSIONS_BY_MODE[mode];
  c.missions = c.missions.filter((x, i) => {
    if (!MISSIONS.includes(x.kind)) { fail('mission_kind', `missions[${i}].kind`, `unknown mission '${x.kind}'`, MISSIONS.join(', ')); return false; }
    if (!missions.includes(x.kind)) { warn('mission_mode', `missions[${i}].kind`, `'${x.kind}' can't progress in ${mode} mode; dropped`); return false; }
    return true;
  });
  if (!c.missions.length) warn('missions_none', 'missions', 'no missions; players get no mid-run goals');
  return { ok: errors.length === 0, errors, warnings, content: c };
}

// Mode-specific structural rules the solver would otherwise report less helpfully.
function checkChunk(mode, c, k, chars, p, fail, warn) {
  const kindOf = ch => chars.get(ch)?.kind;
  if (mode === 'lanes') {
    k.rows.forEach((row, j) => {
      if ([...row].every(ch => ['wall', 'mover'].includes(kindOf(ch)))) fail('row_blocked', `${p}.rows[${j}]`, 'every lane is a train; leave a lane open or use a barrier', `e.g. '${row[0]}.${row[2]}'`);
    });
  } else if (mode === 'side' && c.control === 'jump') {
    const height = s => { let h = 0; while (s[h] === '#') h++; return h; };
    if (height(k.rows[0]) !== 1 || k.rows[0].replace(/^#/, '').includes('#')) fail('side_edge', `${p}.rows[0]`, 'the first slice must be exactly street height 1 ("#")', 'chunks join at height 1');
    const last = k.rows[k.rows.length - 1];
    if (height(last) !== 1 || last.replace(/^#/, '').includes('#')) fail('side_edge', `${p}.rows[${k.rows.length - 1}]`, 'the last slice must be exactly street height 1 ("#")', 'chunks join at height 1');
    let gap = 0;
    k.rows.forEach((row, j) => {
      gap = row.includes('#') ? 0 : gap + k.spacing;
      if (gap > 4.5) fail('side_gap', `${p}.rows[${j}]`, `gap of ${gap} units is too wide to jump`, 'keep gaps ≤ 4 units');
      if (j && height(row) - height(k.rows[j - 1]) > 2 && height(k.rows[j - 1]) > 0) fail('side_climb', `${p}.rows[${j}]`, 'a roof more than 2 cells above the previous one is a wall', 'step up 1-2 cells at a time');
    });
  } else if (mode === 'side' && c.control === 'fly') {
    if (k.rows.some(r => r.includes('#'))) warn('fly_solid', p, "fly control has an automatic floor; '#' cells are ignored");
  } else if (mode === 'flap') {
    k.rows.forEach((row, j) => {
      const open = [...row].map(ch => ch === '#' || ['pipe', 'gate'].includes(kindOf(ch)) ? 0 : 1);
      if (open.every(Boolean)) return;
      let best = 0, run = 0; for (const o of open) { run = o ? run + 1 : 0; best = Math.max(best, run); }
      if (best < 3) fail('flap_gap', `${p}.rows[${j}]`, `gate gap of ${best} cells is too small`, 'leave 3-5 open cells');
    });
  } else if (mode === 'climb') {
    const solid = ch => ch === '=' || ['platform', 'moving', 'breaking', 'spring', 'vanishing'].includes(kindOf(ch));
    const bounce = ch => ch === '=' || ['platform', 'moving', 'spring'].includes(kindOf(ch));
    if (![...k.rows[0]].some(bounce)) fail('climb_start', `${p}.rows[0]`, "the first row needs a platform you can bounce on ('=')");
    // A bounce rises about 4 units: bounceable rows (and the join to the next chunk) must be closer than that.
    const rows = k.rows.map((r, j) => [...r].some(ch => bounce(ch) || kindOf(ch) === 'vanishing') ? j : -1).filter(j => j >= 0);
    for (let i = 1; i < rows.length; i++) if ((rows[i] - rows[i - 1]) * k.spacing > CLIMB_REACH) fail('climb_gap', `${p}.rows[${rows[i]}]`, `${((rows[i] - rows[i - 1]) * k.spacing).toFixed(1)} units since the last bounceable row; a bounce reaches ${CLIMB_REACH}`, 'add a platform in between or lower spacing');
    if (rows.length && (k.rows.length - rows.at(-1)) * k.spacing > CLIMB_REACH) fail('climb_gap', `${p}.rows[${k.rows.length - 1}]`, 'the top rows are too far below the next chunk', 'end with a platform near the top');
    if (![...k.rows[k.rows.length - 1]].some(solid)) warn('climb_end', `${p}.rows[${k.rows.length - 1}]`, 'the last row has no platform');
  } else if (mode === 'hop') {
    k.rows.forEach((row, j) => {
      const lane = [...row].map(kindOf).find(Boolean);
      if (lane && [...row].some(ch => ch !== 'o' && ch !== '*' && kindOf(ch) !== lane && ch !== '.' && chars.get(ch)?.kind !== lane)) warn('hop_mixed', `${p}.rows[${j}]`, 'a lane row mixes types; the first one wins');
      if (!lane && [...row].every(ch => ch === 'T')) fail('hop_blocked', `${p}.rows[${j}]`, 'a grass row is all trees', "leave at least one '.' cell");
    });
  }
  if (!k.rows.length) warn('chunk_empty', p, 'empty chunk');
}
