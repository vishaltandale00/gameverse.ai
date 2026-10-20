// Shmup-kit content: schema (OpenAI strict mode), prompt, sample and validation.
// The model writes content; the kit's systems (game.js) read only normalized content.
// Errors carry stable codes and paths so the pipeline can send them back for repair.

export const MODES = ['fixed', 'vertical', 'twinstick', 'asteroids'];
export const SHIPS = ['arrow', 'delta', 'twin', 'needle', 'saucer'];
export const SHAPES = ['bug', 'moth', 'crab', 'squid', 'saucer', 'diamond', 'pinwheel', 'fighter', 'orb', 'drone'];
export const SIZES = ['small', 'medium', 'large'];
export const MOVES = ['formation', 'dive', 'swoop', 'zigzag', 'straight', 'sine', 'hover', 'turret', 'orbit', 'chase', 'wander', 'split', 'snake', 'gravity', 'saucer'];
export const FIRES = ['none', 'aimed', 'spread', 'ring', 'spiral', 'burst', 'flower'];
export const ENTRIES = ['left-arc', 'right-arc', 'loop', 'top-line', 'v-formation', 'sides', 'rain', 'edges', 'corners', 'portal', 'ring'];
export const BOSS_SHAPES = ['mothership', 'hive', 'eye', 'dreadnought'];
export const BOSS_MOVES = ['hover', 'sweep', 'charge', 'circle'];
export const POWERUPS = ['spread', 'laser', 'homing', 'shield', 'bomb', 'life'];
export const DIFFICULTIES = ['easy', 'normal', 'hard'];

const str = d => ({ type: 'string', ...(d ? { description: d } : {}) });
const num = d => ({ type: 'number', ...(d ? { description: d } : {}) });
const int = d => ({ type: 'integer', ...(d ? { description: d } : {}) });
const bool = d => ({ type: 'boolean', ...(d ? { description: d } : {}) });
const en = (list, d) => ({ type: 'string', enum: list, ...(d ? { description: d } : {}) });
const arr = (items, d) => ({ type: 'array', items, ...(d ? { description: d } : {}) });
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const hexS = str('hex color like #4fd8ff');

export const SCHEMA = obj({
  title: str(), logline: str('one sentence pitch'), artStyle: str('e.g. "neon vector arcade" or "crisp 16-bit pixel art"'), background: hexS,
  difficulty: en(DIFFICULTIES), endless: bool('loop the stages harder forever instead of winning'), extraLifeEvery: int('points per extra ship, 0 for none'),
  player: obj({ name: str('pilot or ship name'), ship: en(SHIPS), color: hexS, speed: num('px/s, 140-240'), fireRate: num('shots/s, 5-10'), lives: int(), bombs: int() }),
  powerups: obj({ kinds: arr(en(POWERUPS)), rate: num('drop chance per kill, 0-0.2') }),
  enemies: arr(obj({
    id: str('slug'), name: str(), shape: en(SHAPES), color: hexS, size: en(SIZES), hp: int('1-12'), speed: num('px/s, 40-200'), points: int(),
    move: en(MOVES), fire: en(FIRES), fireRate: num('volleys/s, 0-1.5'),
  })),
  bosses: arr(obj({ id: str('slug'), name: str(), shape: en(BOSS_SHAPES), color: hexS, hp: int('150-300'), points: int(), phases: arr(obj({ pattern: en(FIRES), move: en(BOSS_MOVES), rate: num('volleys/s, 0.3-2') })) })),
  stages: arr(obj({
    name: str(), mode: en(MODES), intro: str('one short line shown at the stage start'),
    shields: bool('fixed mode: bunkers above the ship'), march: bool('fixed mode: march and descend like classic invaders instead of sway and dive'),
    rocks: int('asteroids mode: big rocks at the start, 0 otherwise'), boss: str('boss id or empty string'),
    waves: arr(obj({ at: num('seconds after stage start'), enemy: str('enemy id'), count: int('1-12'), entry: en(ENTRIES) })),
  })),
});

export const PROMPT = `You design a shoot 'em up for an arcade kit. The kit supplies ships, weapons, power-ups, bullets, bosses and bots; you write the content as JSON.

Each stage picks a mode:
- fixed: Galaxian/Galaga/Invaders. Waves fly in along entry paths (left-arc, right-arc, loop, top-line, v-formation, sides) into a formation at the top (max 40 enemies per stage). Enemies whose move is dive, swoop, zigzag or chase break off to dive at the ship; move formation stays in line and fires. march true makes the formation march and descend instead. shields adds bunkers.
- vertical: 1942/Raiden scroller. Waves enter (left-arc, right-arc, loop, top-line, v-formation, sides, rain) then follow their move (straight, sine, zigzag, dive, hover, orbit, chase; turret sits on the scrolling ground). End with a boss.
- twinstick: Geometry Wars arena. Waves spawn with a warning (edges, corners, portal, ring). Moves: chase, wander, split (splits into small chasers), snake (armored tail, shoot the head), gravity (a black hole that pulls and swallows; use count 1), dive (dashes).
- asteroids: inertia ship with rotate/thrust and wraparound; rocks big rocks split in two twice. Add a saucer enemy wave or chasers for variety.

Rules: 3-5 stages; stage 1 should be the gentlest. 4-8 waves per stage spread over 0-30 seconds, counts 4-12. Bosses (1-2 total) have 2-3 phases, each a bullet pattern (aimed, spread, ring, spiral, burst, flower) and a move. Enemy ids and boss ids are slugs; every wave and stage boss must name an existing id. Give enemies distinct shapes and bright colors that pop on a dark background. Points: 50-200 for fodder, 300-1000 for tough enemies, 10000+ for bosses.`;

export const SAMPLE = {
  title: 'Starlance Rising',
  logline: 'Pilot Vela Quill flies the Starlance against the Hive across four fronts: the formation line, the scrolling ruins, the shattered belt and the swarm pit.',
  artStyle: 'neon vector arcade',
  background: '#0a0820',
  difficulty: 'normal', endless: false, extraLifeEvery: 30000,
  player: { name: 'Vela Quill', ship: 'arrow', color: '#4fd8ff', speed: 190, fireRate: 8, lives: 3, bombs: 2 },
  powerups: { kinds: ['spread', 'laser', 'homing', 'shield', 'bomb', 'life'], rate: 0.08 },
  enemies: [
    { id: 'gnat', name: 'Gnat Drone', shape: 'bug', color: '#ffd23f', size: 'small', hp: 1, speed: 90, points: 100, move: 'formation', fire: 'aimed', fireRate: 0.2 },
    { id: 'hornet', name: 'Hornet Diver', shape: 'moth', color: '#ff5a7a', size: 'small', hp: 2, speed: 150, points: 160, move: 'dive', fire: 'aimed', fireRate: 0.6 },
    { id: 'warden', name: 'Warden Crab', shape: 'crab', color: '#8a7cff', size: 'medium', hp: 4, speed: 120, points: 400, move: 'swoop', fire: 'spread', fireRate: 0.5 },
    { id: 'dart', name: 'Raider Dart', shape: 'fighter', color: '#ff8a3a', size: 'small', hp: 2, speed: 140, points: 150, move: 'straight', fire: 'aimed', fireRate: 0.4 },
    { id: 'weaver', name: 'Weaver Wing', shape: 'moth', color: '#5fe0a0', size: 'small', hp: 2, speed: 110, points: 180, move: 'sine', fire: 'aimed', fireRate: 0.35 },
    { id: 'lantern', name: 'Lantern Pod', shape: 'orb', color: '#3ad0e8', size: 'medium', hp: 6, speed: 60, points: 300, move: 'hover', fire: 'ring', fireRate: 0.35 },
    { id: 'rampart', name: 'Rampart Gun', shape: 'drone', color: '#b9c3cf', size: 'medium', hp: 5, speed: 40, points: 250, move: 'turret', fire: 'burst', fireRate: 0.4 },
    { id: 'seeker', name: 'Seeker Mite', shape: 'diamond', color: '#5fff8a', size: 'small', hp: 1, speed: 85, points: 80, move: 'chase', fire: 'none', fireRate: 0 },
    { id: 'drifter', name: 'Drifter Spore', shape: 'squid', color: '#c06cff', size: 'small', hp: 1, speed: 70, points: 60, move: 'wander', fire: 'none', fireRate: 0 },
    { id: 'shard', name: 'Shard Pinwheel', shape: 'pinwheel', color: '#ff6fb1', size: 'medium', hp: 3, speed: 75, points: 200, move: 'split', fire: 'none', fireRate: 0 },
    { id: 'coil', name: 'Coil Serpent', shape: 'diamond', color: '#ffb02a', size: 'medium', hp: 6, speed: 80, points: 600, move: 'snake', fire: 'none', fireRate: 0 },
    { id: 'maw', name: 'Void Maw', shape: 'orb', color: '#9b5cff', size: 'large', hp: 14, speed: 10, points: 800, move: 'gravity', fire: 'none', fireRate: 0 },
    { id: 'raider', name: 'Raider Saucer', shape: 'saucer', color: '#ff4d6d', size: 'medium', hp: 3, speed: 80, points: 1000, move: 'saucer', fire: 'aimed', fireRate: 0.6 },
  ],
  bosses: [
    { id: 'bloom', name: 'Iron Bloom', shape: 'dreadnought', color: '#ff9a3a', hp: 240, points: 20000, phases: [
      { pattern: 'spread', move: 'sweep', rate: 0.8 }, { pattern: 'burst', move: 'hover', rate: 0.7 }, { pattern: 'spiral', move: 'circle', rate: 1.2 }] },
    { id: 'regent', name: 'Hive Regent', shape: 'hive', color: '#ff5ab0', hp: 280, points: 30000, phases: [
      { pattern: 'ring', move: 'hover', rate: 0.6 }, { pattern: 'flower', move: 'sweep', rate: 0.5 }, { pattern: 'spiral', move: 'charge', rate: 1.4 }] },
  ],
  stages: [
    { name: 'The Formation Line', mode: 'fixed', intro: 'Break the swarm before it dives.', shields: true, march: false, rocks: 0, boss: '', waves: [
      { at: 0, enemy: 'gnat', count: 10, entry: 'left-arc' }, { at: 2.5, enemy: 'gnat', count: 10, entry: 'right-arc' },
      { at: 5, enemy: 'hornet', count: 8, entry: 'loop' }, { at: 8, enemy: 'warden', count: 4, entry: 'top-line' }, { at: 10.5, enemy: 'hornet', count: 6, entry: 'sides' }] },
    { name: 'Ruins of Kessa', mode: 'vertical', intro: 'Fly low over the ruins. Something big waits at the end.', shields: false, march: false, rocks: 0, boss: 'bloom', waves: [
      { at: 1, enemy: 'dart', count: 6, entry: 'left-arc' }, { at: 4, enemy: 'dart', count: 6, entry: 'right-arc' }, { at: 7, enemy: 'lantern', count: 3, entry: 'top-line' },
      { at: 9, enemy: 'rampart', count: 3, entry: 'rain' }, { at: 12, enemy: 'weaver', count: 8, entry: 'v-formation' }, { at: 15, enemy: 'hornet', count: 6, entry: 'loop' },
      { at: 18, enemy: 'lantern', count: 2, entry: 'sides' }, { at: 21, enemy: 'dart', count: 10, entry: 'rain' }] },
    { name: 'The Shattered Belt', mode: 'asteroids', intro: 'Rotate, thrust, and mind the drift.', shields: false, march: false, rocks: 5, boss: '', waves: [
      { at: 9, enemy: 'raider', count: 1, entry: 'sides' }, { at: 16, enemy: 'seeker', count: 5, entry: 'edges' }, { at: 24, enemy: 'raider', count: 1, entry: 'sides' }] },
    { name: 'The Swarm Pit', mode: 'twinstick', intro: 'They come from everywhere. Keep moving.', shields: false, march: false, rocks: 0, boss: 'regent', waves: [
      { at: 0, enemy: 'seeker', count: 8, entry: 'edges' }, { at: 3, enemy: 'drifter', count: 10, entry: 'corners' }, { at: 7, enemy: 'shard', count: 4, entry: 'portal' },
      { at: 11, enemy: 'seeker', count: 12, entry: 'ring' }, { at: 14, enemy: 'maw', count: 1, entry: 'portal' }, { at: 17, enemy: 'coil', count: 2, entry: 'edges' },
      { at: 21, enemy: 'seeker', count: 12, entry: 'edges' }, { at: 25, enemy: 'shard', count: 5, entry: 'corners' }] },
  ],
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const HEX = /^#[0-9a-f]{6}$/i;
// Which entries make sense in each mode; others are remapped with a warning.
export const MODE_ENTRIES = {
  fixed: ['left-arc', 'right-arc', 'loop', 'top-line', 'v-formation', 'sides'],
  vertical: ['left-arc', 'right-arc', 'loop', 'top-line', 'v-formation', 'sides', 'rain'],
  twinstick: ['edges', 'corners', 'portal', 'ring', 'sides', 'top-line'],
  asteroids: ['edges', 'corners', 'portal', 'sides'],
};
const ENTRY_FALLBACK = { fixed: 'loop', vertical: 'rain', twinstick: 'edges', asteroids: 'edges' };
export const FORMATION_CAP = 40;

/** Validate and normalize content: { ok, errors, warnings, content }. */
export function validate(input) {
  const errors = [], warnings = [];
  const fail = (code, path, message, hint) => { errors.push({ code, path, message, ...(hint ? { hint } : {}) }); };
  const warn = (code, path, message) => warnings.push({ code, path, message });
  if (!input || typeof input !== 'object') return { ok: false, errors: [{ code: 'schema', path: '$', message: 'content must be an object' }], warnings, content: null };
  const c = structuredClone(input);
  const clamp = (o, key, lo, hi, def, path, round = false) => {
    let v = Number(o[key]);
    if (!Number.isFinite(v)) { v = def; warn('default', `${path}.${key}`, `missing ${key}, using ${def}`); }
    const cl = Math.min(hi, Math.max(lo, v));
    if (cl !== v) warn('clamped', `${path}.${key}`, `${key} ${v} clamped to ${cl}`);
    o[key] = round ? Math.round(cl) : cl;
  };
  const pick = (o, key, list, def, path) => { if (!list.includes(o[key])) { if (o[key] !== undefined) warn('enum', `${path}.${key}`, `unknown ${key} '${o[key]}', using '${def}'`); o[key] = def; } };
  const color = (o, key, def, path) => { if (typeof o[key] !== 'string' || !HEX.test(o[key])) { if (o[key] !== undefined) warn('color', `${path}.${key}`, `bad color '${o[key]}'`); o[key] = def; } else o[key] = o[key].toLowerCase(); };
  const text = (o, key, def, max = 80) => { o[key] = typeof o[key] === 'string' && o[key].trim() ? o[key].trim().slice(0, max) : def; };

  text(c, 'title', 'Untitled Shooter'); text(c, 'logline', '', 240); text(c, 'artStyle', 'neon vector arcade');
  color(c, 'background', '#0a0820', '$');
  pick(c, 'difficulty', DIFFICULTIES, 'normal', '$');
  c.endless = !!c.endless;
  clamp(c, 'extraLifeEvery', 0, 500000, 30000, '$', true);
  if (c.extraLifeEvery > 0 && c.extraLifeEvery < 5000) { warn('clamped', '$.extraLifeEvery', 'extra life threshold raised to 5000'); c.extraLifeEvery = 5000; }

  if (!c.player || typeof c.player !== 'object') { fail('missing', '$.player', 'player is required'); c.player = {}; }
  const p = c.player;
  text(p, 'name', 'Pilot', 40); pick(p, 'ship', SHIPS, 'arrow', '$.player'); color(p, 'color', '#4fd8ff', '$.player');
  clamp(p, 'speed', 100, 300, 190, '$.player'); clamp(p, 'fireRate', 3, 12, 8, '$.player');
  clamp(p, 'lives', 1, 9, 3, '$.player', true); clamp(p, 'bombs', 0, 5, 2, '$.player', true);

  c.powerups = c.powerups && typeof c.powerups === 'object' ? c.powerups : { kinds: [], rate: 0 };
  c.powerups.kinds = [...new Set((Array.isArray(c.powerups.kinds) ? c.powerups.kinds : []).filter(k => POWERUPS.includes(k)))];
  clamp(c.powerups, 'rate', 0, 0.3, 0.08, '$.powerups');

  const ids = new Set();
  if (!Array.isArray(c.enemies) || !c.enemies.length) { fail('missing', '$.enemies', 'at least one enemy type is required', 'add an enemy with an id, shape and move'); c.enemies = []; }
  c.enemies.forEach((e, i) => {
    const path = `$.enemies[${i}]`;
    if (typeof e.id !== 'string' || !SLUG.test(e.id)) fail('bad_id', `${path}.id`, `enemy id '${e.id}' must be a lowercase slug`, 'use letters, digits and dashes');
    else if (ids.has(e.id)) fail('duplicate_id', `${path}.id`, `enemy id '${e.id}' is used twice`);
    ids.add(e.id);
    text(e, 'name', e.id || 'Enemy', 40); pick(e, 'shape', SHAPES, 'bug', path); color(e, 'color', '#ff5a7a', path); pick(e, 'size', SIZES, 'small', path);
    clamp(e, 'hp', 1, 40, 1, path, true); clamp(e, 'speed', 0, 260, 100, path); clamp(e, 'points', 10, 5000, 100, path, true);
    pick(e, 'move', MOVES, 'straight', path); pick(e, 'fire', FIRES, 'none', path); clamp(e, 'fireRate', 0, 2, 0.4, path);
    if (e.fire === 'none') e.fireRate = 0;
    if (e.move === 'gravity') e.speed = Math.min(e.speed, 30);
  });

  const bossIds = new Set();
  c.bosses = Array.isArray(c.bosses) ? c.bosses : [];
  c.bosses.forEach((b, i) => {
    const path = `$.bosses[${i}]`;
    if (typeof b.id !== 'string' || !SLUG.test(b.id)) fail('bad_id', `${path}.id`, `boss id '${b.id}' must be a lowercase slug`);
    else if (bossIds.has(b.id) || ids.has(b.id)) fail('duplicate_id', `${path}.id`, `boss id '${b.id}' is used twice`);
    bossIds.add(b.id);
    text(b, 'name', b.id || 'Boss', 40); pick(b, 'shape', BOSS_SHAPES, 'mothership', path); color(b, 'color', '#ff5ab0', path);
    clamp(b, 'hp', 40, 3000, 300, path, true); clamp(b, 'points', 100, 200000, 20000, path, true);
    if (!Array.isArray(b.phases) || !b.phases.length) { warn('default', `${path}.phases`, 'boss had no phases; added one'); b.phases = [{ pattern: 'ring', move: 'hover', rate: 0.6 }]; }
    if (b.phases.length > 5) { warn('clamped', `${path}.phases`, 'only the first 5 phases are used'); b.phases = b.phases.slice(0, 5); }
    b.phases.forEach((ph, j) => { pick(ph, 'pattern', FIRES, 'aimed', `${path}.phases[${j}]`); pick(ph, 'move', BOSS_MOVES, 'hover', `${path}.phases[${j}]`); clamp(ph, 'rate', 0.1, 3, 0.8, `${path}.phases[${j}]`); });
    if (b.phases.every(ph => ph.pattern === 'none')) warn('harmless_boss', path, `${b.name} never fires`);
    // Keep every boss beatable with the base weapon at half efficiency inside the 80 s limit.
    const cap = Math.floor(p.fireRate * 0.5 * 80 * 0.9);
    if (b.hp > cap) { warn('clamped', `${path}.hp`, `boss hp ${b.hp} lowered to ${cap} so the base weapon can finish it in time`); b.hp = cap; }
  });

  if (!Array.isArray(c.stages) || !c.stages.length) { fail('missing', '$.stages', 'at least one stage is required'); c.stages = []; }
  if (c.stages.length > 8) { warn('clamped', '$.stages', 'only the first 8 stages are used'); c.stages = c.stages.slice(0, 8); }
  const byId = new Map(c.enemies.map(e => [e.id, e]));
  c.stages.forEach((s, i) => {
    const path = `$.stages[${i}]`;
    text(s, 'name', `Stage ${i + 1}`, 40); pick(s, 'mode', MODES, 'vertical', path); text(s, 'intro', '', 120);
    s.shields = !!s.shields && s.mode === 'fixed'; s.march = !!s.march && s.mode === 'fixed';
    clamp(s, 'rocks', 0, 12, 0, path, true);
    if (s.mode !== 'asteroids' && s.rocks) { warn('ignored', `${path}.rocks`, 'rocks only appear in asteroids mode'); s.rocks = 0; }
    if (typeof s.boss !== 'string') s.boss = '';
    if (s.boss && !bossIds.has(s.boss)) fail('unknown_boss', `${path}.boss`, `stage boss '${s.boss}' is not defined`, `use one of: ${[...bossIds].join(', ') || '(none; use "")'}`);
    s.waves = Array.isArray(s.waves) ? s.waves : [];
    if (s.waves.length > 24) { warn('clamped', `${path}.waves`, 'only the first 24 waves are used'); s.waves = s.waves.slice(0, 24); }
    s.waves.forEach((w, j) => {
      const wp = `${path}.waves[${j}]`;
      clamp(w, 'at', 0, 120, j * 3, wp); clamp(w, 'count', 1, 24, 4, wp, true);
      if (!byId.has(w.enemy)) fail('unknown_enemy', `${wp}.enemy`, `wave enemy '${w.enemy}' is not defined`, `use one of: ${[...ids].join(', ')}`);
      if (!MODE_ENTRIES[s.mode].includes(w.entry)) { warn('entry', `${wp}.entry`, `entry '${w.entry}' does not fit ${s.mode} mode; using ${ENTRY_FALLBACK[s.mode]}`); w.entry = ENTRY_FALLBACK[s.mode]; }
      if (byId.get(w.enemy)?.move === 'gravity' && w.count > 2) { warn('clamped', `${wp}.count`, 'at most 2 gravity wells per wave'); w.count = 2; }
    });
    s.waves.sort((a, b) => a.at - b.at);
    if (s.mode === 'fixed') {
      let total = 0;
      s.waves = s.waves.filter(w => { if (total >= FORMATION_CAP) return false; w.count = Math.min(w.count, FORMATION_CAP - total); total += w.count; return true; });
      if (total >= FORMATION_CAP && s.waves.length) warn('formation_full', `${path}.waves`, `fixed stages hold at most ${FORMATION_CAP} enemies; extra waves dropped`);
    }
    if (!s.waves.length && !s.boss && !s.rocks) fail('empty_stage', path, `stage '${s.name}' has nothing to fight`, 'add waves, a boss, or rocks in asteroids mode');
  });
  return { ok: errors.length === 0, errors, warnings, content: c };
}
