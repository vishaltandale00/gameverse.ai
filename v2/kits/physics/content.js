// Physics-toy content: the schema the model fills, the prompt, normalization
// and validation. Every level picks a mode; that mode's settings live in a
// one-element list under its name (the other mode lists stay empty), which
// keeps the schema strict-mode compatible without optional fields.

export const MODES = ['breakout', 'peggle', 'slingshot', 'pinball'];
export const POWERS = ['wide', 'catch', 'multiball', 'laser', 'slow', 'life'];
export const SPEEDS = ['slow', 'normal', 'fast'];
export const PEG_SHAPES = ['arc', 'circle', 'line', 'grid', 'spiral', 'wave'];
export const PEG_MOTIONS = ['none', 'rotate', 'slide'];
export const GREEN_POWERS = ['multiball', 'superguide', 'zap', 'spooky'];
export const MATERIALS = ['wood', 'stone', 'glass', 'tnt', 'rock'];
export const BLOCK_SHAPES = ['box', 'triangle', 'ball'];
export const TARGET_SIZES = ['small', 'medium', 'large'];
export const ARMORS = ['none', 'helmet'];
export const PROJECTILES = ['normal', 'split', 'boost', 'bomb', 'heavy'];
export const TABLES = ['classic', 'cosmic', 'cavern'];
export const MISSIONS = ['bumpers', 'targets', 'ramps', 'rollovers', 'lock', 'score'];
export const BRICK_CHARS = '.nmxsp2345';
export const PADDLES = ['narrow', 'normal', 'wide'];
export const BOARDS = ['normal', 'large', 'huge'];
export const TABLE_SIZES = ['normal', 'tall'];
export const SLOPES = ['gentle', 'normal', 'steep'];
export const MAX_LEVELS = 12;

const str = description => ({ type: 'string', description });
const num = description => ({ type: 'number', description });
const en = (list, description) => ({ type: 'string', enum: list, ...(description ? { description } : {}) });
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const list = (items, description) => ({ type: 'array', items, ...(description ? { description } : {}) });

const BREAKOUT = obj({
  rows: list(str('brick row, one char per column: . empty, n normal, 2-5 hard (hits), m metal (unbreakable), x explosive, s sliding, p prize'), 'top to bottom, 9-20 columns (the field is as wide as the rows), at most 16 rows'),
  powers: list(en(POWERS), 'capsules that can drop'),
  powerChance: num('0..0.5 chance a broken brick drops a capsule'),
  speed: en(SPEEDS, 'ball speed'),
  paddle: en(PADDLES, 'paddle width'),
  boss: num('boss hit points, 0 for no boss (max 40)'),
});
const PEGGLE = obj({
  groups: list(obj({
    shape: en(PEG_SHAPES), x: num('center 0-100'), y: num('center 25-110'), size: num('radius or length 4-50'),
    count: num('pegs 3-30'), angle: num('degrees: line direction, arc middle, spiral start'), span: num('degrees: arc span, spiral turn, wave periods*360'),
    bricks: { type: 'boolean', description: 'rectangular bricks instead of round pegs' }, motion: en(PEG_MOTIONS),
  }), 'peg shapes on a 100x120 board, cannon at top center'),
  oranges: num('orange target pegs, about a quarter of all pegs'),
  power: en(GREEN_POWERS),
  balls: num('balls 5-15'),
  bucket: en(SPEEDS),
  board: en(BOARDS, 'board size: large and huge boards give more room, pegs stay the same size'),
});
const SLINGSHOT = obj({
  blocks: list(obj({
    material: en(MATERIALS), shape: en(BLOCK_SHAPES), x: num('center, meters from slingshot 12-140'), y: num('bottom height above ground'),
    w: num('width 0.2-4'), h: num('height 0.2-4'), rope: num('0, or hang from a rope this long'),
  }), 'structure pieces; stack by setting y to the top of the piece below'),
  targets: list(obj({ x: num('center'), y: num('bottom height above ground'), size: en(TARGET_SIZES), armor: en(ARMORS) }), 'foes to defeat'),
  shots: list(en(PROJECTILES), 'projectiles in launch order'),
  toughness: en(['soft', 'normal', 'tough'], 'how much damage blocks and foes take'),
});
const PINBALL = obj({
  table: en(TABLES), bumpers: num('0-5'), slingshots: { type: 'boolean' }, ramps: num('0-2'), targets: num('drop targets 0-5'),
  rollovers: num('top lanes 0-4'), lock: num('balls to lock for multiball: 0, 2 or 3'),
  size: en(TABLE_SIZES, 'tall adds a long mid-field and a following camera'), slope: en(SLOPES, 'table tilt: steep is a faster, harder ball'),
  missions: list(obj({ name: str('short mission name'), kind: en(MISSIONS), count: num('how many (score: points)') }), 'in order; finishing all clears the table'),
});

export const SCHEMA = obj({
  title: str('game title'), logline: str('one-sentence pitch'), artStyle: str('art style phrase'), background: str('mood hex color like #1d2b4a'),
  cast: obj({ hero: str('player character, the projectile or pilot'), foe: str('enemy creature, the targets and boss'), prize: str('power-up capsule item'), hazard: str('danger, like the boss shot or tnt'), goal: str('level goal object') }),
  lives: num('1-9'),
  levels: list(obj({
    name: str('level name'), intro: str('one short line shown at level start'), mode: en(MODES),
    breakout: list(BREAKOUT, 'exactly one entry when mode is breakout, else empty'),
    peggle: list(PEGGLE, 'exactly one entry when mode is peggle, else empty'),
    slingshot: list(SLINGSHOT, 'exactly one entry when mode is slingshot, else empty'),
    pinball: list(PINBALL, 'exactly one entry when mode is pinball, else empty'),
  }), '1-12 levels'),
});

export const PROMPT = `You design levels for a physics-toy arcade game. Each level picks a mode and fills exactly one entry in that mode's list (leave the other three lists empty). Usually one mode fits the idea (Breakout or Arkanoid: breakout; Peggle: peggle; Angry Birds: slingshot; pinball: pinball), but a "toy box" game may mix modes.

- breakout: rows are strings of equal length (9-14 columns, up to 12 rows) top to bottom. Characters: . empty, n normal, 2-5 hard brick that needs that many hits, m metal (unbreakable; never wall breakable bricks in completely), x explosive (breaks neighbours), s sliding brick (needs empty cells beside it), p prize brick (always drops a capsule). Make patterns (faces, logos, waves, fortresses). boss > 0 adds a boss with that many hit points (use on a final level, with few bricks).
- peggle: board is 100 wide by 120 tall, cannon at the top center, free-ball bucket along the bottom. Place 4-9 peg groups between y 25 and 110 that don't overlap: arc (radius size, span degrees around angle), circle (ring of radius size), line (length size along angle), grid (width size, staggered rows), spiral (outer radius size, span = total turn), wave (width size, span/360 waves). Total 50-110 pegs; oranges about a quarter of them. motion makes a group rotate or slide.
- slingshot: the slingshot is at x 0, ground at height 0; build structures at x 14-38. Each block: x center, y bottom height (stack by putting y at the top of the block below), w and h in meters (planks 2.4x0.25, columns 0.3x2, crates 1x1). rock is static terrain (ledges, hills). Put targets (foes) inside and on top of structures (y = top of what they sit on). Give 2-5 shots, enough to defeat every foe.
- pinball: choose a table preset and features; missions are achieved in order (e.g. bumpers 15, targets 2, ramps 3, lock 1 needs lock > 0, rollovers 2, score 50000).
- intro: a short punchy line. Names are original. lives 3-5 unless asked.

Change requests map to real fields; never fake one with a stand-in, and keep everything the request doesn't mention (including counts) exactly as it is:
- more or fewer levels: add or remove level entries (1-12).
- bigger or smaller: breakout uses longer rows (up to 20 columns) and more rows (up to 16); peggle sets board to large or huge and adds pegs; slingshot spreads structures farther out (x up to 140; the camera follows and the slingshot gets stronger for far targets); pinball sets size tall.
- more or fewer balls, shots, foes, pegs or bricks: peggle balls; slingshot shots and targets; peg group counts and oranges; brick rows. More multiball: add multiball to powers, or lock in pinball.
- faster, slower, harder, easier: breakout speed and paddle (narrow is harder) and powerChance; peggle bucket and balls; slingshot toughness and shots; pinball slope (steep is harder) and lock; lives for every mode.`;

export const SAMPLE = {
  title: 'Toybox Tumble',
  logline: 'A wind-up fox smashes, bounces and flips through four toys on a playroom shelf.',
  artStyle: 'bright cartoon vector toys',
  background: '#28305a',
  cast: { hero: 'Pip the wind-up fox', foe: 'Grumblebots', prize: 'Spark gem', hazard: 'Fizz bomb', goal: 'Gold trophy' },
  lives: 4,
  levels: [
    {
      name: 'Brick Parade', intro: 'Break every brick. Steer with the paddle edges!', mode: 'breakout',
      breakout: [{
        rows: [
          '.............',
          '..2.2...2.2..',
          '.nnnnn.nnnnn.',
          '.nxnnn.nnnxn.',
          '.nnpnn.nnpnn.',
          'm...........m',
          '..nnsnnnnnn..',
          '..nnnnnnnnn..',
        ],
        powers: ['wide', 'multiball', 'laser', 'catch', 'slow', 'life'], powerChance: 0.18, speed: 'normal', paddle: 'normal', boss: 0,
      }],
      peggle: [], slingshot: [], pinball: [],
    },
    {
      name: 'Peg Garden', intro: 'Clear the orange pegs. Aim for the bucket!', mode: 'peggle',
      breakout: [], slingshot: [], pinball: [],
      peggle: [{
        groups: [
          { shape: 'arc', x: 50, y: 40, size: 30, count: 15, angle: 90, span: 150, bricks: false, motion: 'none' },
          { shape: 'circle', x: 28, y: 66, size: 9, count: 9, angle: 0, span: 360, bricks: false, motion: 'rotate' },
          { shape: 'circle', x: 72, y: 66, size: 9, count: 9, angle: 0, span: 360, bricks: false, motion: 'rotate' },
          { shape: 'wave', x: 50, y: 86, size: 80, count: 16, angle: 0, span: 720, bricks: true, motion: 'none' },
          { shape: 'line', x: 50, y: 62, size: 16, count: 5, angle: 90, span: 0, bricks: false, motion: 'none' },
          { shape: 'grid', x: 50, y: 103, size: 60, count: 14, angle: 0, span: 0, bricks: false, motion: 'slide' },
        ],
        oranges: 16, power: 'multiball', balls: 10, bucket: 'normal', board: 'normal',
      }],
    },
    {
      name: 'Bot Fort', intro: 'Pull back, let fly, topple the fort!', mode: 'slingshot',
      breakout: [], peggle: [], pinball: [],
      slingshot: [{
        blocks: [
          { material: 'rock', shape: 'box', x: 27, y: 0, w: 6, h: 1, rope: 0 },
          { material: 'wood', shape: 'box', x: 18, y: 0, w: 0.3, h: 2, rope: 0 },
          { material: 'wood', shape: 'box', x: 20, y: 0, w: 0.3, h: 2, rope: 0 },
          { material: 'wood', shape: 'box', x: 19, y: 2, w: 2.6, h: 0.25, rope: 0 },
          { material: 'glass', shape: 'box', x: 25.2, y: 1, w: 0.3, h: 1.8, rope: 0 },
          { material: 'glass', shape: 'box', x: 28.8, y: 1, w: 0.3, h: 1.8, rope: 0 },
          { material: 'stone', shape: 'box', x: 27, y: 2.8, w: 4, h: 0.3, rope: 0 },
          { material: 'wood', shape: 'triangle', x: 27, y: 3.1, w: 1.6, h: 1, rope: 0 },
          { material: 'tnt', shape: 'box', x: 23, y: 0, w: 0.8, h: 0.8, rope: 0 },
          { material: 'stone', shape: 'ball', x: 22.5, y: 4, w: 0.8, h: 0.8, rope: 2 },
        ],
        targets: [
          { x: 19, y: 0, size: 'small', armor: 'none' },
          { x: 27, y: 1, size: 'medium', armor: 'none' },
          { x: 19, y: 2.25, size: 'small', armor: 'helmet' },
        ],
        shots: ['normal', 'split', 'bomb', 'heavy'], toughness: 'normal',
      }],
    },
    {
      name: 'Midnight Table', intro: 'Flip, lock and finish every mission!', mode: 'pinball',
      breakout: [], peggle: [], slingshot: [],
      pinball: [{
        table: 'classic', size: 'normal', slope: 'normal', bumpers: 3, slingshots: true, ramps: 2, targets: 4, rollovers: 3, lock: 2,
        missions: [
          { name: 'Wake the bumpers', kind: 'bumpers', count: 12 },
          { name: 'Knock down the bank', kind: 'targets', count: 1 },
          { name: 'Ride the rails', kind: 'ramps', count: 2 },
        ],
      }],
    },
  ],
};

// ---------- validation ----------
const clamp = (v, lo, hi, d) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const text = (v, d, max = 80) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d;
const oneOf = (v, list, d) => list.includes(v) ? v : d;
const HEX = /^#[0-9a-f]{6}$/i;

/** Normalize and validate content. Errors are { code, path, message, hint }. */
export function validate(input) {
  const errors = [], warnings = [];
  const fail = (code, path, message, hint) => errors.push({ code, path, message, ...(hint ? { hint } : {}) });
  const warn = (code, path, message) => warnings.push({ code, path, message });
  if (!input || typeof input !== 'object') return { ok: false, errors: [{ code: 'schema', path: '$', message: 'content must be an object' }], warnings, content: null };
  const c = structuredClone(input);
  const content = {
    title: text(c.title, 'Physics Toy'), logline: text(c.logline, '', 200), artStyle: text(c.artStyle, ''), background: HEX.test(c.background || '') ? c.background : '#28305a',
    cast: { hero: text(c.cast?.hero, 'Hero'), foe: text(c.cast?.foe, 'Foe'), prize: text(c.cast?.prize, 'Gem'), hazard: text(c.cast?.hazard, 'Bomb'), goal: text(c.cast?.goal, 'Trophy') },
    lives: Math.round(clamp(c.lives, 1, 9, 3)),
    levels: [],
  };
  if (!Array.isArray(c.levels) || !c.levels.length) fail('no_levels', 'levels', 'content needs at least one level', 'add 2-6 levels');
  for (const [i, lv] of (Array.isArray(c.levels) ? c.levels : []).slice(0, MAX_LEVELS).entries()) {
    const path = `levels[${i}]`;
    if (!MODES.includes(lv?.mode)) { fail('bad_mode', `${path}.mode`, `mode must be one of ${MODES.join(', ')}`); continue; }
    const entries = Array.isArray(lv[lv.mode]) ? lv[lv.mode] : [];
    if (!entries.length) { fail('missing_mode_settings', `${path}.${lv.mode}`, `a ${lv.mode} level needs exactly one entry in "${lv.mode}"`, `fill levels[${i}].${lv.mode}[0]`); continue; }
    if (entries.length > 1) warn('extra_mode_settings', `${path}.${lv.mode}`, 'only the first entry is used');
    const level = { name: text(lv.name, `Level ${i + 1}`, 40), intro: text(lv.intro, '', 90), mode: lv.mode };
    const settings = entries[0] || {};
    const at = `${path}.${lv.mode}[0]`;
    if (lv.mode === 'breakout') level.breakout = breakout(settings, at, fail, warn);
    else if (lv.mode === 'peggle') level.peggle = peggle(settings, at, fail, warn);
    else if (lv.mode === 'slingshot') level.slingshot = slingshot(settings, at, fail, warn);
    else level.pinball = pinball(settings, at, fail, warn);
    content.levels.push(level);
  }
  return { ok: errors.length === 0, errors, warnings, content: errors.length ? null : content };
}

function breakout(s, at, fail, warn) {
  let rows = (Array.isArray(s.rows) ? s.rows : []).filter(r => typeof r === 'string').slice(0, 16).map(r => r.slice(0, 20));
  const width = Math.max(9, ...rows.map(r => r.length));
  rows = rows.map((r, y) => {
    const clean = [...r].map((ch, x) => { if (BRICK_CHARS.includes(ch)) return ch; if (ch === ' ') return '.'; warn('bad_brick', `${at}.rows[${y}]`, `unknown brick '${ch}' at column ${x} became normal`); return 'n'; }).join('');
    return clean.padEnd(width, '.');
  });
  const out = {
    rows, powers: [...new Set((s.powers || []).filter(p => POWERS.includes(p)))], powerChance: clamp(s.powerChance, 0, 0.5, 0.15),
    speed: oneOf(s.speed, SPEEDS, 'normal'), paddle: oneOf(s.paddle, PADDLES, 'normal'), boss: Math.round(clamp(s.boss, 0, 40, 0)),
  };
  const breakable = rows.join('').replace(/[.m]/g, '').length;
  if (!breakable && !out.boss) fail('no_bricks', `${at}.rows`, 'a breakout level needs breakable bricks or a boss', "use 'n' bricks");
  // Every breakable brick must be reachable from the open field (metal can't seal bricks in).
  const blocked = unreachableBricks(rows);
  for (const [x, y] of blocked.slice(0, 6)) fail('unreachable_brick', `${at}.rows[${y}]`, `the brick at column ${x} is sealed in by metal`, 'open a gap in the metal around it');
  return out;
}

/** Breakable bricks that no ball path can reach (4-connected flood fill through non-metal cells). */
export function unreachableBricks(rows) {
  const h = rows.length, w = rows[0]?.length || 0, H = h + 4;
  const open = (x, y) => y < 3 || y >= h + 3 || rows[y - 3][x] !== 'm';
  const seen = new Uint8Array(w * H), queue = [];
  for (let x = 0; x < w; x++) { seen[(H - 1) * w + x] = 1; queue.push([x, H - 1]); }
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= H || seen[ny * w + nx] || !open(nx, ny)) continue;
      seen[ny * w + nx] = 1; queue.push([nx, ny]);
    }
  }
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!'.m'.includes(rows[y][x]) && !seen[(y + 3) * w + x]) out.push([x, y]);
  return out;
}

function peggle(s, at, fail, warn) {
  const groups = (Array.isArray(s.groups) ? s.groups : []).slice(0, 12).map((g, i) => ({
    shape: oneOf(g?.shape, PEG_SHAPES, 'arc'), x: clamp(g?.x, 4, 96, 50), y: clamp(g?.y, 22, 112, 60), size: clamp(g?.size, 3, 60, 20),
    count: Math.round(clamp(g?.count, 1, 40, 10)), angle: clamp(g?.angle, -720, 720, 0), span: clamp(g?.span, -1440, 1440, 180),
    bricks: !!g?.bricks, motion: oneOf(g?.motion, PEG_MOTIONS, 'none'),
  }));
  if (!groups.length) fail('no_pegs', `${at}.groups`, 'a peggle level needs peg groups');
  const total = groups.reduce((n, g) => n + g.count, 0);
  if (total > 0 && total < 8) fail('too_few_pegs', `${at}.groups`, `only ${total} pegs; use at least 8`);
  const oranges = Math.round(clamp(s.oranges, 1, Math.max(1, Math.floor(total * 0.6)), Math.max(1, Math.round(total / 4))));
  if (s.oranges > oranges) warn('oranges_clamped', `${at}.oranges`, `oranges reduced to ${oranges}`);
  return { groups, oranges, power: oneOf(s.power, GREEN_POWERS, 'multiball'), balls: Math.round(clamp(s.balls, 3, 20, 10)), bucket: oneOf(s.bucket, SPEEDS, 'normal'), board: oneOf(s.board, BOARDS, 'normal') };
}

function slingshot(s, at, fail, warn) {
  const blocks = (Array.isArray(s.blocks) ? s.blocks : []).slice(0, 80).map(b => ({
    material: oneOf(b?.material, MATERIALS, 'wood'), shape: oneOf(b?.shape, BLOCK_SHAPES, 'box'), x: clamp(b?.x, 8, 150, 20), y: clamp(b?.y, 0, 30, 0),
    w: clamp(b?.w, 0.2, 6, 1), h: clamp(b?.h, 0.2, 6, 1), rope: clamp(b?.rope, 0, 8, 0),
  }));
  const targets = (Array.isArray(s.targets) ? s.targets : []).slice(0, 20).map(t => ({ x: clamp(t?.x, 8, 150, 25), y: clamp(t?.y, 0, 30, 0), size: oneOf(t?.size, TARGET_SIZES, 'medium'), armor: oneOf(t?.armor, ARMORS, 'none') }));
  const shots = (Array.isArray(s.shots) ? s.shots : []).filter(p => PROJECTILES.includes(p)).slice(0, 8);
  if (!targets.length) fail('no_targets', `${at}.targets`, 'a slingshot level needs at least one target');
  if (!shots.length) fail('no_shots', `${at}.shots`, 'a slingshot level needs projectiles');
  // Pieces that start overlapping explode apart; report the first few.
  const boxes = blocks.map(b => b.shape === 'ball' ? [b.x - b.w / 2, b.y, b.x + b.w / 2, b.y + b.w] : [b.x - b.w / 2, b.y, b.x + b.w / 2, b.y + b.h]);
  let overlapsFound = 0;
  for (let i = 0; i < boxes.length && overlapsFound < 4; i++) for (let j = i + 1; j < boxes.length && overlapsFound < 4; j++) {
    if (blocks[i].rope || blocks[j].rope) continue;
    const a = boxes[i], b = boxes[j], ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (ox > 0.08 && oy > 0.08 && blocks[i].shape === 'box' && blocks[j].shape === 'box') { overlapsFound++; fail('blocks_overlap', `${at}.blocks[${j}]`, `block ${j} overlaps block ${i}`, `set y to ${Math.max(a[3], b[3]).toFixed(2)} to stack it on top`); }
  }
  return { blocks, targets, shots, toughness: oneOf(s.toughness, ['soft', 'normal', 'tough'], 'normal') };
}

function pinball(s, at, fail) {
  const out = {
    table: oneOf(s.table, TABLES, 'classic'), size: oneOf(s.size, TABLE_SIZES, 'normal'), slope: oneOf(s.slope, SLOPES, 'normal'), bumpers: Math.round(clamp(s.bumpers, 0, 5, 3)), slingshots: s.slingshots !== false, ramps: Math.round(clamp(s.ramps, 0, 2, 1)),
    targets: Math.round(clamp(s.targets, 0, 5, 3)), rollovers: Math.round(clamp(s.rollovers, 0, 4, 3)), lock: [0, 2, 3].includes(Math.round(s.lock)) ? Math.round(s.lock) : 0,
    missions: [],
  };
  const has = { bumpers: out.bumpers, targets: out.targets, ramps: out.ramps, rollovers: out.rollovers, lock: out.lock, score: 1 };
  for (const [i, m] of (Array.isArray(s.missions) ? s.missions : []).slice(0, 6).entries()) {
    const kind = oneOf(m?.kind, MISSIONS, null);
    if (!kind) { fail('bad_mission', `${at}.missions[${i}].kind`, `kind must be one of ${MISSIONS.join(', ')}`); continue; }
    if (!has[kind]) { fail('mission_needs_feature', `${at}.missions[${i}]`, `a ${kind} mission needs the table to have ${kind}`, `set ${kind} above 0 or change the mission`); continue; }
    const count = Math.round(clamp(m.count, 1, kind === 'score' ? 500000 : 50, kind === 'score' ? 25000 : 3));
    out.missions.push({ name: text(m.name, `Mission ${i + 1}`, 40), kind, count });
  }
  if (!out.missions.length) fail('no_missions', `${at}.missions`, 'a pinball table needs at least one mission');
  return out;
}
