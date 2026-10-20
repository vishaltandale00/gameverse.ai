// Puzzle-kit content: the strict schema the model fills, the prompt, and
// validation/normalization. Every other part of the kit reads normalized content.
// Errors carry stable codes and paths ({ code, path, message, hint }) so a generator can repair content.
import { hex } from '../../art/color.js';

export const MODES = ['falling', 'chain', 'swap', 'slide'];
export const GOALS = ['lines', 'score', 'survive', 'chain', 'viruses', 'blockers', 'jelly', 'collect', 'tile'];
export const GOALS_BY_MODE = {
  falling: ['lines', 'score', 'survive'],
  chain: ['score', 'chain', 'viruses', 'blockers', 'survive'],
  swap: ['score', 'jelly', 'blockers', 'collect'],
  slide: ['tile', 'score'],
};
const MOODS = ['heroic', 'mysterious', 'playful', 'tense', 'dreamy', 'spooky', 'energetic', 'melancholy'];
const KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SCALES = ['major', 'minor', 'dorian', 'mixolydian', 'pentatonic'];
const INSTRUMENTS = ['chip', 'synth', 'bell', 'pluck'];
// Default piece/gem colors: falling uses them in guideline order I O T S Z J L.
export const DEFAULT_COLORS = ['#35d0f0', '#f5d03a', '#a95cf0', '#5cd65a', '#f0464e', '#4a6cf0', '#f39a2e'];
export const STANDARD_KEYS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

const str = { type: 'string' }, int = { type: 'integer' }, num = { type: 'number' }, bool = { type: 'boolean' };
const en = list => ({ type: 'string', enum: list });
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const arr = items => ({ type: 'array', items });

export const SCHEMA = obj({
  title: str,
  logline: str,
  artStyle: str,
  background: { type: 'string', description: 'mood hex color like #1b2440' },
  music: obj({ mood: en(MOODS), tempo: int, key: en(KEYS), scale: en(SCALES), instrument: en(INSTRUMENTS) }),
  mode: en(MODES),
  cast: obj({ hero: str, rival: str, item: str, blocker: str, prize: str }),
  palette: arr(obj({ name: str, color: str })),
  rules: obj({ colors: int, groupSize: int, nextCount: int, hold: bool, ghost: bool, variant: en(['classic', 'virus']), pieceSet: en(['standard', 'custom', 'mixed']), width: int, height: int, endless: bool, spawnFour: num }),
  customPieces: arr(obj({ name: str, color: str, rows: arr(str) })),
  levels: arr(obj({ name: str, intro: str, goal: en(GOALS), target: int, moves: int, timeSec: int, speed: int, obstacles: int, layout: arr(str), stars: arr(int) })),
});

export const PROMPT = `You write content for a block-and-match puzzle game. Pick ONE mode for the idea:
- "falling": a Tetris-style well (10x20 by default, seven tetrominoes, rotation, hold, next queue, line clears, T-spins). palette: 7 entries named and colored for the pieces in order I, O, T, S, Z, J, L (give them themed names). Goals: "lines" (target lines this level), "score", "survive" (timeSec). speed 1-20 is gravity. obstacles = garbage rows that rise at level start (0-8). layout: optional rows of rules.width chars ('.' empty, '#' block) stacked at the bottom. rules.endless true = marathon that keeps going after the last level. Optional customPieces (pieceSet "custom" or "mixed"): rows like ["##", ".#", ".#"], each piece 1-5 connected cells.
- "chain": falling pairs that pop in same-color groups with chain reactions (Puyo-like), or rules.variant "virus": capsules that clear in lines of rules.groupSize and must wipe out fixed viruses (Dr. Mario-like). rules.colors 3-5 (the virus variant always uses 3), groupSize 4. Goals: "score", "chain" (make a chain of target length, 2-5), "viruses" (virus variant; obstacles = virus count 4-24), "blockers" (obstacles = garbage rows to clear, 1-4), "survive".
- "swap": a match-3 board (8x8 by default) (Bejeweled/Candy-like) with specials (4 in a line, 5 in a line, L/T shapes). rules.colors 4-5. moves = move limit (10-40). Goals: "score" (target about 150-400 points per move), "jelly" (layout must contain j/J), "blockers" (layout must contain b/B), "collect" (bring target items to the bottom; about 10 moves per item). layout: rules.height rows of rules.width chars (8 rows of 8 by default): '.' gem, 'j' jelly, 'J' double jelly, 'b' blocker, 'B' strong blocker, 'x' hole; or [] for a plain board. stars: three ascending score thresholds.
- "slide": a 2048-like square board rules.width x rules.width (4; 3-6). Goals: "tile" (target is a power of two like 128, 512, 2048), "score". rules.spawnFour is the chance a new tile is a 4 (0.1). rules.endless true keeps playing after the last target. obstacles = fixed rocks (0-2).
Board size is real: rules.width and rules.height set it (0 = the mode's default). falling: well width 8-16 (10) x height 16-30 (20). chain: width 4-10 (6) x height 8-18 (12); virus width 7-12 (8) x height 12-20 (16). swap: width and height 5-10 (8x8). slide: width 3-6 (4), height ignored.
Write 3-6 levels that ramp up, each with a short name and a one-line intro. Fill every field; fields another mode uses can be 0, false, [] or defaults. cast: hero is a mascot who cheers on the player, rival the opponent or virus kind, item the collectible, blocker the obstacle, prize the reward. All names are original.
Change requests map to real fields; never fake one with a stand-in:
- bigger/smaller/wider/taller board, well or grid → rules.width / rules.height (and resize every swap/chain/slide layout to match, or use []);
- more/fewer levels → add or remove levels; harder/easier goals → levels[].target, obstacles;
- faster/slower, gravity → levels[].speed (each level's speed is the gravity curve; endless keeps adding 1);
- move or time limits → levels[].moves / levels[].timeSec; endless/marathon → rules.endless;
- more/fewer colors → rules.colors (with matching palette entries); more preview pieces → rules.nextCount; new piece shapes → customPieces with pieceSet "mixed" or "custom"; hold on/off → rules.hold.
On a revision keep every field the request doesn't mention exactly as it was, counts included.`;

const SLUG = s => String(s || '').toLowerCase().match(/[a-z0-9]+/g)?.join('-').slice(0, 40) || 'puzzle';
const clampInt = (v, lo, hi, d) => Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d;
const text = (v, d, max = 120) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d;

/** Parse a polyomino from rows of characters ('.' or space = empty). Returns [[x, y]] cropped to its bounds. */
export function parseShape(rows) {
  const cells = [];
  (rows || []).forEach((row, y) => [...String(row)].forEach((c, x) => { if (c !== '.' && c !== ' ') cells.push([x, y]); }));
  if (!cells.length) return [];
  const mx = Math.min(...cells.map(c => c[0])), my = Math.min(...cells.map(c => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my]);
}
export function connected(cells) {
  if (cells.length <= 1) return true;
  const key = ([x, y]) => `${x},${y}`, set = new Set(cells.map(key)), seen = new Set([key(cells[0])]), todo = [cells[0]];
  while (todo.length) {
    const [x, y] = todo.pop();
    for (const n of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (set.has(key(n)) && !seen.has(key(n))) { seen.add(key(n)); todo.push(n); }
  }
  return seen.size === cells.length;
}

/** [min, max, default] width and height per mode. */
export function sizeRange(mode, variant) {
  if (mode === 'falling') return [[8, 16, 10], [16, 30, 20]];
  if (mode === 'chain') return variant === 'virus' ? [[7, 12, 8], [12, 20, 16]] : [[4, 10, 6], [8, 18, 12]];
  if (mode === 'swap') return [[5, 10, 8], [5, 10, 8]];
  return [[3, 6, 4], [3, 6, 4]];
}

/** Board dimensions per mode/variant (the layout and obstacle checks depend on them). */
export function boardDims(content) {
  const m = content.mode, r = content.rules || {};
  const [w, h] = sizeRange(m, r.variant);
  const pick = (v, [lo, hi, d]) => v ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
  const W = pick(+r.width || 0, w);
  return { W, H: m === 'slide' ? W : pick(+r.height || 0, h) };
}
/** Virus cap that the bot can still clear: 24 on the default 8x16 jar, scaled by area. */
export const maxViruses = d => Math.max(4, Math.round(24 * (d.W * d.H) / 128));
const isPow2 = n => n > 0 && (n & (n - 1)) === 0;

/** Validate content. Returns { ok, errors, warnings, content } where content is normalized. */
export function validate(input) {
  const errors = [], warnings = [];
  const err = (code, path, message, hint) => { errors.push(hint ? { code, path, message, hint } : { code, path, message }); };
  const warn = (code, path, message) => { warnings.push({ code, path, message }); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: [{ code: 'schema', path: '$', message: 'content must be an object' }], warnings, content: null };
  const c = structuredClone(input);
  const out = {};
  out.title = text(c.title, '', 80);
  if (!out.title) err('title_missing', 'title', 'title is required', 'Give the game a short original title.');
  out.id = SLUG(out.title);
  out.logline = text(c.logline, '', 200);
  out.artStyle = text(c.artStyle, 'glossy modern puzzle art', 80);
  out.background = hex(c.background, null) || (warn('background_default', 'background', 'background is not a hex color; using a default'), '#1b2440');
  const m = c.music || {};
  out.music = { mood: MOODS.includes(m.mood) ? m.mood : 'playful', tempo: clampInt(m.tempo, 70, 170, 120), key: KEYS.includes(m.key) ? m.key : 'C', scale: SCALES.includes(m.scale) ? m.scale : 'major', instrument: INSTRUMENTS.includes(m.instrument) ? m.instrument : 'pluck' };
  if (!MODES.includes(c.mode)) { err('mode_unknown', 'mode', `mode must be one of ${MODES.join(', ')}`, 'Pick the mode closest to the idea.'); return { ok: false, errors, warnings, content: null }; }
  const mode = out.mode = c.mode;
  const cast = c.cast || {};
  out.cast = { hero: text(cast.hero, 'Pip', 40), rival: text(cast.rival, 'Grumble', 40), item: text(cast.item, 'Star', 40), blocker: text(cast.blocker, 'Crate', 40), prize: text(cast.prize, 'Trophy', 40) };

  // ---------- rules ----------
  const r = c.rules || {};
  const variant = mode === 'chain' && r.variant === 'virus' ? 'virus' : 'classic';
  out.rules = {
    colors: mode === 'swap' ? clampInt(r.colors, 4, 5, 5) : clampInt(r.colors, 3, 5, 4),
    groupSize: clampInt(r.groupSize, 3, 6, 4),
    nextCount: clampInt(r.nextCount, 3, 5, 5),
    hold: r.hold !== false,
    ghost: r.ghost !== false,
    variant,
    pieceSet: ['standard', 'custom', 'mixed'].includes(r.pieceSet) ? r.pieceSet : 'standard',
    width: 0, height: 0,
    endless: !!r.endless,
    spawnFour: Number.isFinite(+r.spawnFour) ? Math.max(0, Math.min(0.5, +r.spawnFour)) : 0.1,
  };
  if (variant === 'virus') { if (out.rules.colors !== 3) warn('virus_colors', 'rules.colors', 'the virus variant uses 3 colors'); out.rules.colors = 3; out.rules.groupSize = 4; }
  if (mode !== 'falling') out.rules.pieceSet = 'standard';
  { const d = boardDims({ mode, rules: { ...out.rules, width: r.width, height: r.height } }); out.rules.width = d.W; out.rules.height = d.H; }

  // ---------- palette ----------
  const need = mode === 'falling' ? 7 : mode === 'slide' ? 4 : out.rules.colors;
  const pal = Array.isArray(c.palette) ? c.palette : [];
  out.palette = [];
  for (let i = 0; i < Math.max(need, Math.min(pal.length, 12)); i++) {
    const p = pal[i] || {};
    const color = hex(p.color, null);
    if (i < need && !color) warn('palette_filled', `palette[${i}]`, pal[i] ? 'invalid color; using a default' : 'missing entry; using a default');
    out.palette.push({ name: text(p.name, mode === 'falling' ? `${STANDARD_KEYS[i] || 'P'} piece` : `Color ${i + 1}`, 30), color: color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] });
  }

  // ---------- custom pieces ----------
  out.customPieces = [];
  if (mode === 'falling') {
    (Array.isArray(c.customPieces) ? c.customPieces : []).slice(0, 8).forEach((p, i) => {
      const path = `customPieces[${i}]`, cells = parseShape(p?.rows);
      if (!cells.length) return err('piece_empty', `${path}.rows`, 'piece has no cells', "Use rows like ['##', '#.'] with '#' for filled cells.");
      if (cells.length > 5) return err('piece_too_big', `${path}.rows`, `piece has ${cells.length} cells; at most 5`, 'Use polyominoes of 1 to 5 cells.');
      if (!connected(cells)) return err('piece_disconnected', `${path}.rows`, 'piece cells are not edge-connected', 'Every filled cell must touch another filled cell by an edge.');
      const w = Math.max(...cells.map(q => q[0])) + 1, h = Math.max(...cells.map(q => q[1])) + 1;
      out.customPieces.push({ name: text(p.name, `Piece ${i + 1}`, 30), color: hex(p.color, DEFAULT_COLORS[i % 7]), rows: Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => cells.some(q => q[0] === x && q[1] === y) ? '#' : '.').join('')) });
    });
    if (out.rules.pieceSet !== 'standard' && !out.customPieces.length) err('custom_pieces_missing', 'customPieces', `pieceSet '${out.rules.pieceSet}' needs at least one custom piece`, "Add customPieces or set pieceSet to 'standard'.");
  }

  // ---------- levels ----------
  const levels = Array.isArray(c.levels) ? c.levels : [];
  if (!levels.length) err('levels_missing', 'levels', 'at least one level is required', 'Write 3-6 levels that ramp up.');
  if (levels.length > 20) warn('levels_truncated', 'levels', 'only the first 20 levels are kept');
  const dims = boardDims(out);
  out.levels = levels.slice(0, 20).map((l, i) => normalizeLevel(l || {}, i, out, dims, err, warn));
  if (errors.length) return { ok: false, errors, warnings, content: out };
  return { ok: true, errors, warnings, content: out };
}

function normalizeLevel(l, i, content, dims, err, warn) {
  const mode = content.mode, path = `levels[${i}]`, allowed = GOALS_BY_MODE[mode];
  let goal = l.goal;
  if (mode === 'chain' && content.rules.variant === 'virus' && goal === 'blockers') goal = 'viruses';
  if (!allowed.includes(goal)) {
    err('goal_mode', `${path}.goal`, `goal '${goal}' does not fit mode '${mode}'`, `Use one of: ${allowed.join(', ')}.`);
    goal = allowed[0];
  }
  if (goal === 'viruses' && content.rules.variant !== 'virus') err('goal_mode', `${path}.goal`, "goal 'viruses' needs rules.variant 'virus'", "Set rules.variant to 'virus' or use another goal.");
  const L = {
    name: text(l.name, `Level ${i + 1}`, 40),
    intro: text(l.intro, '', 120),
    goal,
    target: 0,
    moves: clampInt(l.moves, 0, 99, 0),
    timeSec: clampInt(l.timeSec, 0, 600, 0),
    speed: clampInt(l.speed, 1, 20, Math.min(20, i + 1)),
    obstacles: 0,
    layout: Array.isArray(l.layout) ? l.layout.map(String).filter(s => s.length) : [],
    stars: [],
  };
  const t = +l.target;
  if (goal === 'lines') L.target = clampInt(t, 1, 200, 10);
  else if (goal === 'score') L.target = clampInt(t, 100, 10_000_000, 5000);
  else if (goal === 'chain') L.target = clampInt(t, 2, 5, 3);
  else if (goal === 'collect') L.target = clampInt(t, 1, 12, 4);
  else if (goal === 'tile') {
    const cap = dims.W === 3 ? 128 : 2048;
    let v = clampInt(t, 8, 1 << 16, 256);
    if (!isPow2(v)) { const p = 2 ** Math.round(Math.log2(v)); warn('tile_rounded', `${path}.target`, `target ${v} is not a power of two; using ${p}`); v = p; }
    if (v > cap) { warn('tile_capped', `${path}.target`, `target ${v} is out of reach on a ${dims.W}x${dims.W} board; using ${cap}`); v = cap; }
    L.target = v;
  } else L.target = clampInt(t, 0, 1_000_000, 0);
  if (goal === 'survive' && !L.timeSec) { L.timeSec = clampInt(t, 10, 600, 60); }

  // obstacles: meaning per mode
  const o = clampInt(l.obstacles, 0, 99, 0);
  if (mode === 'falling') L.obstacles = Math.min(o, Math.floor(dims.H * 0.4));
  else if (mode === 'chain') {
    if (content.rules.variant === 'virus') {
      L.obstacles = Math.max(1, Math.min(o || 4 * (i + 1), maxViruses(dims)));
      if (goal === 'viruses' && !o) warn('viruses_default', `${path}.obstacles`, `no virus count; using ${L.obstacles}`);
    } else L.obstacles = Math.min(o, Math.floor(dims.H / 3));
  } else if (mode === 'slide') L.obstacles = Math.min(o, Math.max(0, dims.W - 2));
  if (mode === 'swap') {
    if (!L.moves && !L.timeSec) { L.moves = 25; warn('moves_default', `${path}.moves`, 'no move or time limit; using 25 moves'); }
    if (L.moves) L.moves = Math.max(5, Math.min(L.moves, 80));
    const most = Math.max(1, Math.floor((L.moves || L.timeSec / 3) / 10));
    const maxScore = L.moves ? L.moves * 600 : L.timeSec * 200;
    if (goal === 'score' && L.target > maxScore) { warn('score_capped', `${path}.target`, `score ${L.target} is out of reach; using ${maxScore}`); L.target = maxScore; }
    if (goal === 'collect' && L.target > most) { warn('collect_capped', `${path}.target`, `${L.target} items in ${L.moves || L.timeSec + 's'} is too many; using ${most} (about 10 moves per item)`); L.target = most; }
  }

  // layout per mode
  const lay = L.layout;
  if (mode === 'swap' && lay.length) {
    if (lay.length !== dims.H || lay.some(row => row.length !== dims.W)) { err('layout_size', `${path}.layout`, `swap layout must be ${dims.H} rows of ${dims.W} characters (rules.height x rules.width)`, 'Resize the layout to the board or use [] for a plain board.'); L.layout = []; }
    else if (lay.some(row => /[^.jJbBx]/.test(row))) { err('layout_char', `${path}.layout`, "swap layout uses only . j J b B x", "'.' gem, 'j'/'J' jelly, 'b'/'B' blocker, 'x' hole."); L.layout = []; }
    else {
      const all = lay.join(''), playable = [...all].filter(ch => ch !== 'x').length, need = Math.ceil(dims.W * dims.H * 0.45);
      if (playable < need) err('layout_small', `${path}.layout`, `only ${playable} playable cells`, `Leave at least ${need} cells that are not holes.`);
      if (/x/.test(all)) checkSwapHoles(lay, path, err, dims.W);
    }
  } else if (mode === 'falling' && lay.length) {
    const full = '#'.repeat(dims.W);
    L.layout = lay.slice(-Math.floor(dims.H * 0.6)).map(row => row.padEnd(dims.W, '.').slice(0, dims.W).replace(/[^.]/g, '#'));
    if (L.layout.some(row => row === full)) { warn('layout_full_row', `${path}.layout`, 'full rows removed (they would clear at once)'); L.layout = L.layout.filter(row => row !== full); }
  } else if (mode === 'chain' && lay.length && content.rules.variant !== 'virus') {
    if (lay.length > dims.H - 4 || lay.some(row => row.length !== dims.W)) { err('layout_size', `${path}.layout`, `chain layout rows must be ${dims.W} characters, at most ${dims.H - 4} rows`, 'Use [] for an empty board.'); L.layout = []; }
    else if (lay.some(row => new RegExp(`[^.g1-${content.rules.colors}]`).test(row))) { err('layout_char', `${path}.layout`, `chain layout uses '.', 'g' (garbage) and color digits 1-${content.rules.colors}`); L.layout = []; }
  } else if (mode === 'slide' && lay.length) {
    if (lay.length !== dims.W || lay.some(row => row.length !== dims.W || /[^.x]/.test(row))) { err('layout_size', `${path}.layout`, `slide layout must be ${dims.W} rows of ${dims.W} characters of '.' and 'x'`, 'Use [] and obstacles instead.'); L.layout = []; }
  } else if (mode === 'chain' && lay.length) L.layout = [];

  if (mode === 'swap') {
    const all = L.layout.join('');
    if (goal === 'jelly' && !/[jJ]/.test(all)) err('goal_unreachable', `${path}.layout`, "goal 'jelly' needs jelly cells (j or J) in the layout", 'Add j or J cells to the layout.');
    if (goal === 'blockers' && !/[bB]/.test(all)) err('goal_unreachable', `${path}.layout`, "goal 'blockers' needs blocker cells (b or B) in the layout", 'Add b or B cells to the layout.');
  }
  if (mode === 'chain' && goal === 'blockers' && !L.obstacles && !L.layout.join('').includes('g')) err('goal_unreachable', `${path}.obstacles`, "goal 'blockers' needs garbage: obstacles 1-4 or 'g' in the layout");

  // stars: three ascending score thresholds
  const s = Array.isArray(l.stars) ? l.stars.map(Number).filter(Number.isFinite).map(Math.round) : [];
  const base = goal === 'score' ? L.target : mode === 'swap' ? 1500 * (i + 1) : mode === 'falling' ? 2000 * (i + 1) : 1000 * (i + 1);
  let s1 = s[0] > 0 ? s[0] : base;
  if (goal === 'score') s1 = L.target;
  const s2 = Math.max(s1 + 1, s[1] > 0 ? s[1] : Math.round(s1 * 1.5)), s3 = Math.max(s2 + 1, s[2] > 0 ? s[2] : Math.round(s1 * 2.2));
  L.stars = [s1, s2, s3];
  return L;
}

// Every playable swap cell must have a playable cell above it or be in the top playable segment;
// each column segment refills from its own top, so holes only need to leave room to play.
function checkSwapHoles(lay, path, err, W) {
  for (let x = 0; x < W; x++) {
    const col = lay.map(row => row[x]).join('');
    if (/^x*$/.test(col)) continue;
    if (col.replace(/x/g, '').length < 2) err('layout_column', `${path}.layout`, `column ${x} has a single playable cell`, 'Give each used column at least two playable cells.');
  }
}

/** One-line description of a level goal for the HUD and intros. */
export function goalText(content, level) {
  const g = level.goal, t = level.target;
  const limit = level.moves && content.mode === 'swap' ? ` in ${level.moves} moves` : level.timeSec && g !== 'survive' ? ` in ${level.timeSec}s` : '';
  switch (g) {
    case 'lines': return `Clear ${t} lines${limit}`;
    case 'score': return `Score ${t.toLocaleString('en-US')}${limit}`;
    case 'survive': return `Survive ${level.timeSec} seconds`;
    case 'chain': return `Make a ${t}-chain${limit}`;
    case 'viruses': return `Clear all ${level.obstacles} ${content.cast.rival}${level.obstacles === 1 ? '' : 's'}${limit}`;
    case 'blockers': return `Break every ${content.cast.blocker}${limit}`;
    case 'jelly': return `Clear all the jelly${limit}`;
    case 'collect': return `Bring down ${t} ${content.cast.item}${t === 1 ? '' : 's'}${limit}`;
    case 'tile': return `Make the ${t} tile${limit}`;
    default: return '';
  }
}
