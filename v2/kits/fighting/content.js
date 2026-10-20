// Fighting-kit content: the strict schema the model fills, the writing prompt, a hand-written
// sample and validation. Validation clamps numbers (the schema carries no min/max for strict
// mode) and reports errors as { code, path, message, hint } so a generator can repair content.
import { THEMES, TIMES } from '../../art/scenery.js';

export const CONTENT_SCHEMA = 'gameverse.v2.fighting-content/0.1';
export const MODES = ['traditional', 'platform'];
export const BUILDS = ['lean', 'average', 'heavy', 'towering'];
export const HAIR = ['none', 'short', 'spiky', 'long', 'ponytail', 'mohawk', 'topknot'];
export const HEADWEAR = ['none', 'headband', 'mask', 'hood', 'helmet', 'horns', 'circlet'];
export const OUTFITS = ['gi', 'vest', 'armor', 'robe', 'bodysuit', 'jacket'];
export const STYLES = ['balanced', 'rushdown', 'zoner', 'grappler'];
export const ARCHETYPES = ['fireball', 'ground_wave', 'uppercut', 'spin_kick', 'charge_dash', 'slide', 'command_grab', 'teleport', 'counter', 'air_dive', 'flurry', 'axe_kick'];
export const MOTIONS = ['qcf', 'qcb', 'dp', 'rdp', 'hcf', 'hcb', 'charge-bf', 'charge-du', 'tap-dd', 'tap-bf'];
export const SUPERS = ['beam', 'rush', 'rising', 'grab'];
export const FINISHES = ['starburst', 'petal_storm', 'freeze', 'lightning', 'confetti'];
export { THEMES, TIMES };

const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const PALETTE = [
  ['#e9b48a', '#f4f1ea', '#2f3a8f', '#d8262c', '#2a1a12'], ['#c98a5e', '#2e8bd6', '#1d2340', '#ffd23a', '#101018'],
  ['#8a5a3c', '#7a2a2a', '#3a2a24', '#e8a33a', '#d8d8d8'], ['#f2cfb0', '#3fae7a', '#f4f1ea', '#7a3ad8', '#e8e0c8'],
  ['#6a4a34', '#f08a24', '#2a2a30', '#3ad0ff', '#1a1a1a'], ['#d9c2f0', '#4a1a6a', '#14101e', '#f5c542', '#f4f4ff'],
  ['#f0c8a0', '#d83a6a', '#2a2a48', '#f4f4f4', '#6a3a1a'], ['#b07a50', '#5a6a2a', '#2a1a10', '#d8c040', '#3a2010'],
];

// ---------- schema (OpenAI strict mode: every property required, no min/max) ----------
const str = description => ({ type: 'string', description });
const num = description => ({ type: 'number', description });
const en = (list, description) => ({ type: 'string', enum: list, ...(description ? { description } : {}) });
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const arr = (items, description) => ({ type: 'array', items, ...(description ? { description } : {}) });

const special = obj({
  name: str('move name, original'),
  archetype: en(ARCHETYPES),
  motion: en(MOTIONS, 'input motion; unique per fighter (air_dive may share a motion with a ground move)'),
  power: num('1-10 damage'),
  speed: num('1-10 startup/travel speed'),
});

export const schema = obj({
  title: str('game title'),
  logline: str('one-sentence pitch'),
  mode: en(MODES, 'traditional = health bars and rounds; platform = Smash-style percent, knockback, ledges and stocks'),
  roundTime: num('seconds per round, 30-99 (platform mode plays 3x this)'),
  roundsToWin: num('rounds to win a match, 1-4 (2 = best of 3)'),
  gameSpeed: num('game speed 0.6-2; 1 normal, 1.25 turbo'),
  stocks: num('platform mode lives, 1-5'),
  finisher: { type: 'boolean', description: 'end each match with a stylized, non-gory finish window' },
  fighters: arr(obj({
    id: str('slug like "rook"'),
    name: str('display name'),
    style: en(STYLES, 'CPU personality'),
    build: en(BUILDS),
    stats: obj({ health: num('700-1300'), walkSpeed: num('1-10'), jump: num('1-10'), weight: num('1-10') }),
    look: obj({
      hair: en(HAIR), headwear: en(HEADWEAR), outfit: en(OUTFITS),
      skin: str('hex'), primary: str('hex top/outfit'), secondary: str('hex pants'), accent: str('hex belt, gloves, trim'), hairColor: str('hex'),
    }),
    specials: arr(special, '2-4 special moves'),
    super: obj({ name: str('super move name'), archetype: en(SUPERS) }),
    finish: obj({ name: str('finishing flourish name'), style: en(FINISHES) }),
    stage: str('home stage id'),
    intro: str('arcade intro line'),
    winQuote: str('short victory line'),
    ending: str('arcade ending, 1-2 sentences'),
  }), '2-8 fighters'),
  stages: arr(obj({ id: str('slug'), name: str('stage name'), theme: en(THEMES), time: en(TIMES), width: num('arena width in units, 520-4000; 920 standard (two screens), 1600 wide, 3000 huge') }), '1-8 stages'),
  ladder: arr(obj({ fighter: str('fighter id'), difficulty: num('1-5') }), 'arcade opponents in order, easiest first'),
  boss: obj({ fighter: str('fighter id of the final boss'), difficulty: num('1-5'), stage: str('stage id') }),
});

export const prompt = `You write content for a 2D fighting game in the style of classic arcade fighters (motion-input specials, frame data, blocking high/low, best-of-3 rounds, arcade ladder vs CPU, a final boss).
- mode: "traditional" unless the idea is a platform brawler with knockback and ring-outs (Smash-like), then "platform".
- fighters: 4-6 original characters with distinct silhouettes (build, hair, headwear, outfit) and contrasting hex colors. style sets the CPU personality: zoners have a fireball or ground_wave; grapplers have command_grab and heavy builds; rushdown fighters have charge_dash, slide, axe_kick or air_dive.
- specials: 2-4 per fighter. Every fighter should have at least one of fireball, uppercut, charge_dash or command_grab. Motions: qcf (down, down-forward, forward), qcb, dp (forward, down, down-forward), rdp, hcf, hcb, charge-bf (hold back then forward), charge-du (hold down then up), tap-dd (down, down), tap-bf (back, forward). Give each special a different motion. Classic pairings: fireball qcf, uppercut dp, spin_kick qcb, charge_dash charge-bf, command_grab hcb, teleport rdp or tap-dd.
- power and speed are 1-10. Strong moves should be slower.
- super: one per fighter (input is always qcf twice + a button with a full meter).
- stages: one per fighter plus a boss stage; pick a theme and time that fit. Each fighter's stage is a stage id.
- ladder: the non-boss fighters in arcade order with difficulty rising from 1; boss: the final boss (also listed in fighters), difficulty 4-5.
- intro, winQuote and ending are short, punchy, original story lines. Keep everything family-friendly: knockouts are stylized, never gory.

Change requests map to real fields; never fake one with another:
- bigger/smaller stage or arena: stages[].width (920 standard, 1600 wide, 3000 huge, 600 cramped); the camera follows.
- more/fewer fighters: add/remove fighters (2-8) and update ladder and boss refs; longer/shorter arcade: ladder entries (up to 10, a fighter may repeat).
- more/fewer rounds: roundsToWin (1 = single round, 2 = best of 3, 3 = best of 5); longer/shorter rounds: roundTime.
- harder/easier: ladder[].difficulty and boss.difficulty (1-5); tougher fighters: stats.health.
- faster/slower game: gameSpeed (1.25 turbo, 1.5 very fast, 0.8 slow); faster characters: stats.walkSpeed.
- platform mode lives: stocks.
On a revision keep every field and count the request does not mention exactly as it was.`;

// ---------- sample ----------
export const sample = {
  title: 'Tempest Circuit',
  logline: 'Six rivals brawl across a storm-lit world for the Gilded Crown.',
  mode: 'traditional',
  roundTime: 60,
  roundsToWin: 2,
  gameSpeed: 1,
  stocks: 3,
  finisher: true,
  fighters: [
    {
      id: 'rook', name: 'Rook Varga', style: 'balanced', build: 'average',
      stats: { health: 1000, walkSpeed: 5, jump: 5, weight: 5 },
      look: { hair: 'spiky', headwear: 'headband', outfit: 'gi', skin: '#e9b48a', primary: '#f4f1ea', secondary: '#f4f1ea', accent: '#d8262c', hairColor: '#2a1a12' },
      specials: [
        { name: 'Gale Orb', archetype: 'fireball', motion: 'qcf', power: 5, speed: 5 },
        { name: 'Rising Talon', archetype: 'uppercut', motion: 'dp', power: 7, speed: 7 },
        { name: 'Cyclone Heel', archetype: 'spin_kick', motion: 'qcb', power: 5, speed: 5 },
      ],
      super: { name: 'Tempest Cannon', archetype: 'beam' },
      finish: { name: 'Thunderclap Bow', style: 'lightning' },
      stage: 'harbor', intro: 'A wandering fighter chasing the storm that took his master.', winQuote: 'The wind decides. Today it chose me.',
      ending: 'Rook lays the Gilded Crown on his master\'s shrine and walks on, lighter than the wind.',
    },
    {
      id: 'mira', name: 'Mira Solenne', style: 'rushdown', build: 'lean',
      stats: { health: 900, walkSpeed: 8, jump: 7, weight: 3 },
      look: { hair: 'ponytail', headwear: 'none', outfit: 'bodysuit', skin: '#f2cfb0', primary: '#2e8bd6', secondary: '#1d2340', accent: '#ffd23a', hairColor: '#f0e0a0' },
      specials: [
        { name: 'Comet Rush', archetype: 'charge_dash', motion: 'charge-bf', power: 5, speed: 8 },
        { name: 'Sky Splitter', archetype: 'axe_kick', motion: 'charge-du', power: 6, speed: 6 },
        { name: 'Hummingbird', archetype: 'flurry', motion: 'tap-dd', power: 4, speed: 8 },
      ],
      super: { name: 'Starfall Barrage', archetype: 'rush' },
      finish: { name: 'Curtain Call', style: 'starburst' },
      stage: 'market', intro: 'A courier who outran every rival on the rooftops. Now she wants a real race.', winQuote: 'Too slow! Try to keep up next time.',
      ending: 'Mira trades the crown for a lifetime of open roads and never stops running.',
    },
    {
      id: 'brannoch', name: 'Brannoch', style: 'grappler', build: 'towering',
      stats: { health: 1250, walkSpeed: 3, jump: 3, weight: 9 },
      look: { hair: 'mohawk', headwear: 'none', outfit: 'vest', skin: '#8a5a3c', primary: '#7a2a2a', secondary: '#3a2a24', accent: '#e8a33a', hairColor: '#d8d8d8' },
      specials: [
        { name: 'Mountain Embrace', archetype: 'command_grab', motion: 'hcb', power: 8, speed: 4 },
        { name: 'Bulwark', archetype: 'counter', motion: 'qcb', power: 6, speed: 5 },
        { name: 'Avalanche Slam', archetype: 'charge_dash', motion: 'tap-bf', power: 7, speed: 3 },
      ],
      super: { name: 'Earthshaker Drop', archetype: 'grab' },
      finish: { name: 'Snowglobe', style: 'freeze' },
      stage: 'glacier', intro: 'The glacier clan\'s champion, sent south to prove the old ways still win.', winQuote: 'The mountain does not move. You do.',
      ending: 'Brannoch carries the crown home on his shoulders and the whole clan sings for a week.',
    },
    {
      id: 'zephyra', name: 'Zephyra Lin', style: 'zoner', build: 'lean',
      stats: { health: 880, walkSpeed: 4, jump: 6, weight: 3 },
      look: { hair: 'long', headwear: 'circlet', outfit: 'robe', skin: '#f0c8a0', primary: '#3fae7a', secondary: '#f4f1ea', accent: '#7a3ad8', hairColor: '#1a1a2a' },
      specials: [
        { name: 'Jade Lantern', archetype: 'fireball', motion: 'qcf', power: 4, speed: 6 },
        { name: 'Root Ripple', archetype: 'ground_wave', motion: 'qcb', power: 5, speed: 4 },
        { name: 'Mist Step', archetype: 'teleport', motion: 'rdp', power: 1, speed: 7 },
      ],
      super: { name: 'Thousand Lanterns', archetype: 'beam' },
      finish: { name: 'Blossom Gale', style: 'petal_storm' },
      stage: 'shrine', intro: 'A shrine keeper who hears the forest whisper of a crown that should never be worn.', winQuote: 'Distance is a kindness. You refused it.',
      ending: 'Zephyra seals the crown beneath the old cedar, and the forest finally sleeps.',
    },
    {
      id: 'tamsin', name: 'Tamsin Okoro', style: 'rushdown', build: 'average',
      stats: { health: 960, walkSpeed: 6, jump: 8, weight: 5 },
      look: { hair: 'topknot', headwear: 'mask', outfit: 'jacket', skin: '#6a4a34', primary: '#f08a24', secondary: '#2a2a30', accent: '#3ad0ff', hairColor: '#1a1a1a' },
      specials: [
        { name: 'Kestrel Dive', archetype: 'air_dive', motion: 'qcf', power: 5, speed: 7 },
        { name: 'Floor Burn', archetype: 'slide', motion: 'qcb', power: 5, speed: 6 },
        { name: 'Updraft', archetype: 'uppercut', motion: 'dp', power: 6, speed: 6 },
      ],
      super: { name: 'Thermal Spiral', archetype: 'rising' },
      finish: { name: 'Encore Blast', style: 'confetti' },
      stage: 'foundry', intro: 'A foundry stunt rider who fights like she rides: straight down from the rafters.', winQuote: 'Gravity is on my side. Always.',
      ending: 'Tamsin melts the crown into a trophy for every rider in the foundry.',
    },
    {
      id: 'vexis', name: 'Vexis the Gilded', style: 'balanced', build: 'heavy',
      stats: { health: 1150, walkSpeed: 5, jump: 4, weight: 7 },
      look: { hair: 'long', headwear: 'horns', outfit: 'armor', skin: '#d9c2f0', primary: '#4a1a6a', secondary: '#14101e', accent: '#f5c542', hairColor: '#f4f4ff' },
      specials: [
        { name: 'Crown Flare', archetype: 'fireball', motion: 'qcf', power: 7, speed: 5 },
        { name: 'Sovereign Rise', archetype: 'uppercut', motion: 'dp', power: 8, speed: 6 },
        { name: 'Eclipse Step', archetype: 'teleport', motion: 'rdp', power: 1, speed: 8 },
        { name: 'Gilded Lance', archetype: 'charge_dash', motion: 'hcf', power: 6, speed: 7 },
      ],
      super: { name: 'Coronation', archetype: 'beam' },
      finish: { name: 'Royal Decree', style: 'lightning' },
      stage: 'spire', intro: 'The undefeated keeper of the Gilded Crown, waiting at the top of the storm.', winQuote: 'Kneel. The crown has no room for two.',
      ending: 'Vexis keeps the crown, and the storm over the world grows one shade darker.',
    },
  ],
  stages: [
    { id: 'harbor', name: 'Lantern Harbor', theme: 'city', time: 'night', width: 920 },
    { id: 'market', name: 'Dune Market', theme: 'desert', time: 'sunset', width: 920 },
    { id: 'glacier', name: 'Glacier Rim', theme: 'snow', time: 'day', width: 920 },
    { id: 'shrine', name: 'Cedar Shrine', theme: 'forest', time: 'dawn', width: 920 },
    { id: 'foundry', name: 'Ember Foundry', theme: 'factory', time: 'day', width: 920 },
    { id: 'spire', name: 'Crown Spire', theme: 'castle', time: 'night', width: 1400 },
  ],
  ladder: [
    { fighter: 'mira', difficulty: 1 },
    { fighter: 'zephyra', difficulty: 2 },
    { fighter: 'tamsin', difficulty: 2 },
    { fighter: 'brannoch', difficulty: 3 },
    { fighter: 'rook', difficulty: 3 },
  ],
  boss: { fighter: 'vexis', difficulty: 4, stage: 'spire' },
};

// ---------- validation ----------
const clamp = (v, lo, hi, d) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const text = (v, d, max = 160) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d;

/** Normalize and check content. Returns { ok, errors, warnings, content }. */
export function validate(input) {
  const errors = [], warnings = [];
  const fail = (code, path, message, hint) => { errors.push({ code, path, message, ...(hint ? { hint } : {}) }); };
  const warn = (code, path, message) => warnings.push({ code, path, message });
  if (!input || typeof input !== 'object') return { ok: false, errors: [{ code: 'schema', path: '$', message: 'content must be an object' }], warnings, content: null };
  const c = structuredClone(input);
  const pick = (v, list, path, d) => { if (list.includes(v)) return v; if (v !== undefined) fail('enum', path, `"${v}" is not one of ${list.join(', ')}`); return d; };
  c.title = text(c.title, 'Untitled Fighter', 60);
  c.logline = text(c.logline, '', 200);
  c.mode = pick(c.mode, MODES, '$.mode', 'traditional');
  c.roundTime = Math.round(clamp(c.roundTime, 30, 99, 60));
  c.roundsToWin = Math.round(clamp(c.roundsToWin, 1, 4, 2));
  c.gameSpeed = Math.round(clamp(c.gameSpeed, 0.6, 2, 1) * 100) / 100;
  c.stocks = Math.round(clamp(c.stocks, 1, 5, 3));
  c.finisher = c.finisher !== false;

  const stages = Array.isArray(c.stages) ? c.stages : [];
  if (!stages.length) fail('stages', '$.stages', 'at least one stage is required');
  if (stages.length > 8) { warn('stages', '$.stages', 'only the first 8 stages are used'); stages.length = 8; }
  const stageIds = new Set();
  stages.forEach((s, i) => {
    const p = `$.stages[${i}]`;
    if (!s || typeof s !== 'object') { fail('schema', p, 'stage must be an object'); return; }
    if (!SLUG.test(s.id || '')) fail('id', `${p}.id`, `stage id "${s.id}" must be a lowercase slug`, 'use letters, digits and dashes');
    else if (stageIds.has(s.id)) fail('duplicate', `${p}.id`, `stage id "${s.id}" is used twice`);
    stageIds.add(s.id);
    s.name = text(s.name, s.id || `Stage ${i + 1}`, 40);
    s.theme = pick(s.theme, THEMES, `${p}.theme`, 'city');
    s.time = pick(s.time, TIMES, `${p}.time`, 'day');
    s.width = Math.round(clamp(s.width, 520, 4000, 920));
  });
  c.stages = stages;

  const fighters = Array.isArray(c.fighters) ? c.fighters : [];
  if (fighters.length < 2) fail('roster', '$.fighters', 'a fighting game needs at least 2 fighters', 'add more fighters');
  if (fighters.length > 8) { warn('roster', '$.fighters', 'only the first 8 fighters are used'); fighters.length = 8; }
  const ids = new Set();
  fighters.forEach((f, i) => {
    const p = `$.fighters[${i}]`;
    if (!f || typeof f !== 'object') { fail('schema', p, 'fighter must be an object'); return; }
    if (!SLUG.test(f.id || '')) fail('id', `${p}.id`, `fighter id "${f.id}" must be a lowercase slug`, 'use letters, digits and dashes');
    else if (ids.has(f.id)) fail('duplicate', `${p}.id`, `fighter id "${f.id}" is used twice`);
    ids.add(f.id);
    f.name = text(f.name, f.id || `Fighter ${i + 1}`, 32);
    f.style = pick(f.style, STYLES, `${p}.style`, 'balanced');
    f.build = pick(f.build, BUILDS, `${p}.build`, 'average');
    const st = f.stats || {};
    f.stats = { health: Math.round(clamp(st.health, 700, 1300, 1000)), walkSpeed: clamp(st.walkSpeed, 1, 10, 5), jump: clamp(st.jump, 1, 10, 5), weight: clamp(st.weight, 1, 10, 5) };
    const lk = f.look || {}, pal = PALETTE[i % PALETTE.length];
    const color = (v, k, d) => { if (HEX.test(v || '')) return v.toLowerCase(); if (v !== undefined) warn('color', `${p}.look.${k}`, `"${v}" is not a #rrggbb color; using a default`); return d; };
    f.look = {
      hair: pick(lk.hair, HAIR, `${p}.look.hair`, 'short'), headwear: pick(lk.headwear, HEADWEAR, `${p}.look.headwear`, 'none'), outfit: pick(lk.outfit, OUTFITS, `${p}.look.outfit`, 'gi'),
      skin: color(lk.skin, 'skin', pal[0]), primary: color(lk.primary, 'primary', pal[1]), secondary: color(lk.secondary, 'secondary', pal[2]), accent: color(lk.accent, 'accent', pal[3]), hairColor: color(lk.hairColor, 'hairColor', pal[4]),
    };
    const specials = Array.isArray(f.specials) ? f.specials : [];
    if (!specials.length) fail('specials', `${p}.specials`, `${f.name} needs at least one special move`, 'add 2-4 specials');
    if (specials.length > 4) { warn('specials', `${p}.specials`, 'only the first 4 specials are used'); specials.length = 4; }
    const used = new Map();
    specials.forEach((m, j) => {
      const q = `${p}.specials[${j}]`;
      if (!m || typeof m !== 'object') { fail('schema', q, 'special must be an object'); return; }
      m.name = text(m.name, `Special ${j + 1}`, 32);
      m.archetype = pick(m.archetype, ARCHETYPES, `${q}.archetype`, 'fireball');
      m.motion = pick(m.motion, MOTIONS, `${q}.motion`, MOTIONS[j]);
      m.power = clamp(m.power, 1, 10, 5); m.speed = clamp(m.speed, 1, 10, 5);
      // Ground moves need distinct motions; an air dive may share one (it only comes out in the air).
      const key = `${m.motion}|${m.archetype === 'air_dive' ? 'air' : 'ground'}`;
      if (used.has(key)) fail('motion_conflict', `${q}.motion`, `${m.name} and ${used.get(key)} both use ${m.motion}`, 'give each special a different motion');
      used.set(key, m.name);
    });
    f.specials = specials;
    f.super = { name: text(f.super?.name, 'Super Art', 32), archetype: pick(f.super?.archetype, SUPERS, `${p}.super.archetype`, 'beam') };
    f.finish = { name: text(f.finish?.name, 'Finale', 32), style: pick(f.finish?.style, FINISHES, `${p}.finish.style`, 'starburst') };
    if (!stageIds.has(f.stage)) { if (f.stage !== undefined) warn('stage', `${p}.stage`, `stage "${f.stage}" does not exist; using the first stage`); f.stage = stages[i % Math.max(1, stages.length)]?.id || null; }
    f.intro = text(f.intro, `${f.name} enters the tournament.`, 200);
    f.winQuote = text(f.winQuote, 'Next!', 120);
    f.ending = text(f.ending, `${f.name} claims the title.`, 300);
  });
  c.fighters = fighters;

  const ladder = Array.isArray(c.ladder) ? c.ladder : [];
  ladder.forEach((r, i) => {
    const p = `$.ladder[${i}]`;
    if (!ids.has(r?.fighter)) fail('ref', `${p}.fighter`, `ladder fighter "${r?.fighter}" is not in the roster`, `use one of ${[...ids].join(', ')}`);
    else r.difficulty = Math.round(clamp(r.difficulty, 1, 5, 1 + Math.min(4, i)));
  });
  c.ladder = ladder.filter(r => ids.has(r?.fighter)).slice(0, 10);
  const boss = c.boss || {};
  if (!ids.has(boss.fighter)) fail('ref', '$.boss.fighter', `boss "${boss.fighter}" is not in the roster`, 'name a fighter id from the roster');
  c.boss = { fighter: boss.fighter, difficulty: Math.round(clamp(boss.difficulty, 1, 5, 4)), stage: stageIds.has(boss.stage) ? boss.stage : fighters.find(f => f.id === boss.fighter)?.stage || stages[0]?.id || null };
  if (!c.ladder.length && fighters.length > 1) warn('ladder', '$.ladder', 'empty ladder: the arcade is just the boss');
  if (c.ladder.some(r => r.fighter === c.boss.fighter)) warn('ladder', '$.ladder', 'the boss also appears in the ladder');
  if (fighters.length >= 2 && fighters.every(f => f.id === c.boss.fighter)) fail('roster', '$.fighters', 'the roster needs a selectable fighter besides the boss');
  return { ok: errors.length === 0, errors, warnings, content: errors.length ? null : c };
}
