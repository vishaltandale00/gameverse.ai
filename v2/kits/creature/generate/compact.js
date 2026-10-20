// The compact content schema the model fills (OpenAI strict mode). It holds only what needs
// imagination: names, looks, themes, the type triangle, evolution lines and the journey.
// The kit derives everything else: moves from each type's three move names, learnsets and base stats
// from a line's types and role, ids from names, items, gym teams and trainers' lines.
// Small on purpose: about 1.5k output tokens, so a game is playable in about 10 s.
//
// fromCompact(c) expands it into the journey shape (schema.js), which fromModel() and balance()
// turn into full content.
import { slug } from './from-model.js';

const str = d => (d ? { type: 'string', description: d } : { type: 'string' });
const int = d => ({ type: 'integer', ...(d ? { description: d } : {}) });
const en = (list, d) => ({ type: 'string', enum: list, ...(d ? { description: d } : {}) });
const arr = (items, d) => ({ type: 'array', items, ...(d ? { description: d } : {}) });
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const ROLES = ['balanced', 'fast', 'strong', 'bulky', 'special'];
const person = obj({ name: str(), look: str('clothes, colors, hair in a few words') });
const line = d => obj({
  types: arr(str('type name'), '1 or 2 type names'),
  role: en(ROLES),
  forms: arr(obj({ name: str('original creature name'), look: str('body shape (bird, four-legged, blob, upright), colors, one feature') }), d),
});
const trainer = obj({ name: str(), class: str('e.g. Hiker, Lass'), team: arr(str('creature name'), '1–3') });
const route = obj({
  name: str(), kind: en(['route', 'cave']), theme: str('a few words, e.g. "windy hillside with ledges"'),
  length: int('tiles; 0 = settings.routeLength'), encounterRate: int('percent; 0 = settings.encounterRate'),
  wild: arr(str('creature name (a first form)'), '2–4'), trainers: arr(trainer, '0–2'),
});

export const COMPACT_SCHEMA = obj({
  settings: obj({
    routeLength: int('route length in tiles: 35 small, 50 normal, 80 large, 120–160 huge'),
    encounterRate: int('percent chance of a wild battle per grass step: 10 normal, 4 rare, 20 frequent'),
    difficulty: en(['easy', 'normal', 'hard']),
    levelStep: int('levels the curve climbs per gym: 7 normal, 5 gentle, 9 steep'),
  }),
  title: str(), logline: str('one sentence'), artStyle: str('e.g. "bright 16-bit pixel art"'),
  mood: en(['adventurous', 'calm', 'tense', 'playful', 'mysterious', 'heroic']),
  region: obj({ name: str(), description: str('one sentence') }),
  player: person, rival: person, mentor: person,
  types: arr(obj({
    name: str(), color: str('hex like #e86830'), look: str('two or three words'),
    beats: arr(str('type name'), 'types this one is super effective against'),
    moves: obj({ weak: str('a weak attack name'), strong: str('a strong attack name'), status: str('a status move name') }),
  }), '6–8 types; the first is a plain Normal-like type that beats nothing'),
  starters: arr(line('2–3 forms: first form, then its evolutions'), 'exactly 3 lines whose first types beat each other in a triangle'),
  wild: arr(line('1–3 forms'), '4–8 more lines found in the wild'),
  items: obj({ ball: str(), greatBall: str(), potion: str(), superPotion: str(), cure: str(), revive: str() }),
  home: obj({ name: str('starting town'), theme: str() }),
  chapters: arr(obj({
    routes: arr(route, '1–3 routes or caves leading to the town'),
    town: obj({ name: str(), theme: str() }),
    gym: obj({ leader: str('leader name'), look: str(), type: str('type name'), badge: str('badge name'), quote: str('one short line') }),
  }), 'one per gym, in order: write 3 unless the idea asks for a different number (1–8)'),
  finale: obj({
    routes: arr(route, '1–2 routes or caves leading to the league'),
    league: obj({ name: str(), theme: str() }),
    champion: obj({ name: str(), look: str(), team: arr(str('creature name, final forms'), '3–5'), quote: str() }),
  }),
});

export const COMPACT_PROMPT = `You design a creature-collecting RPG in the style of the classic handheld monster-catching games. The player explores towns and routes and catches wild creatures in tall grass. They battle turn by turn with typed moves, level up and evolve, beat trainers and gym leaders for badges, battle a rival, and face the champion.

The engine supplies every system and derives moves, stats, levels and items. You write only names, looks, types and the journey. Everything must be ORIGINAL (inspired by the idea, never another game's names).

- types: 6–8 (at least six). The first is a plain Normal-like type that beats nothing. Each type lists the types it beats. The three starter types form a triangle: A beats B, B beats C, C beats A. Each type names three moves: a weak attack, a strong attack and a status move.
- starters: three lines, one per triangle type. Each has 2–3 forms (first form, middle, final).
- wild: 4–8 lines. Early routes use first forms. Give every form a vivid look in a few words.
- chapters: one per gym. Write THREE chapters unless the idea asks for another number. Each has 1–3 routes or caves listing wild creatures (first-form names) and 0–2 trainers, then a town whose gym leader uses one type. The finale has 1–2 routes, then the league and the champion with 3–5 final forms.
- Keep every text short. Use names consistently: references use the exact names you gave.
- settings: routeLength 50, encounterRate 10, difficulty "normal", levelStep 7 unless the idea asks otherwise; route length and encounterRate 0 mean "use settings".

Common requests map to these real fields (never fake them with a different field):
- Bigger or smaller world: settings.routeLength and per-route length, and more or fewer routes per chapter. A huge or open world: routeLength 120–160 and 2–3 routes per chapter.
- More or fewer gyms: add or remove chapters.
- More creatures: add lines or forms.
- Harder or easier: settings.difficulty and settings.levelStep.
- More or fewer wild battles: settings.encounterRate.
- Theme and cast: names, looks, themes.
When revising, start from the current content and change only what the request asks; keep every other field, list and count exactly as it is.`;

export const isCompactShape = x => !!x && typeof x === 'object' && Array.isArray(x.starters) && x.starters.some(s => s && typeof s === 'object' && Array.isArray(s.forms));

// ---------------------------------------------------------------- expansion

const STYLE = [
  ['fire', /fire|flame|ember|blaze|heat|lava|burn|magma|sun|solar|cinder/], ['water', /water|tide|aqua|sea|wave|rain|ocean|river|surf/],
  ['grass', /leaf|grass|plant|vine|seed|flora|bloom|wood|forest|moss|petal/], ['bug', /bug|insect|beetle|hive|silk|swarm|mantis|stinger/],
  ['electric', /spark|electric|volt|thunder|bolt|static|lightning|storm/], ['rock', /stone|rock|earth|ground|sand|dune|boulder|metal|steel|crystal|desert/],
  ['wind', /gust|wind|air|sky|feather|fly|cloud|breeze/], ['ice', /ice|frost|snow|cold|glacier/],
  ['ghost', /ghost|spirit|psy|mind|dream|shadow|dark|void|cosmic|mystic|moon|night/], ['poison', /poison|toxic|venom|acid|sludge|miasma/],
  ['dragon', /dragon|wyrm|drake|scale/], ['fight', /fight|fist|brawl|martial|strike/],
];
// Per style: the weak attack's secondary effect, the status move and the strong attack's effect.
const KIT = {
  fire: { weak: { kind: 'status', status: 'burn', chance: 10 }, status: { kind: 'status', status: 'burn', chance: 100, accuracy: 85 }, strong: { kind: 'status', status: 'burn', chance: 20 } },
  water: { weak: null, status: { kind: 'stat', target: 'foe', stat: 'spe', stages: -1, chance: 100, accuracy: 100 }, strong: null },
  grass: { weak: { kind: 'drain', fraction: 0.5 }, status: { kind: 'status', status: 'sleep', chance: 100, accuracy: 75 }, strong: null },
  bug: { weak: { kind: 'multihit', min: 2, max: 5 }, status: { kind: 'status', status: 'poison', chance: 100, accuracy: 90 }, strong: null },
  electric: { weak: { kind: 'status', status: 'paralysis', chance: 10 }, status: { kind: 'status', status: 'paralysis', chance: 100, accuracy: 90 }, strong: null },
  rock: { weak: null, status: { kind: 'stat', target: 'self', stat: 'def', stages: 1, chance: 100, accuracy: null }, strong: { kind: 'flinch', chance: 30 } },
  wind: { weak: null, status: { kind: 'stat', target: 'foe', stat: 'acc', stages: -1, chance: 100, accuracy: 100 }, strong: { kind: 'status', status: 'confusion', chance: 20 } },
  ice: { weak: { kind: 'status', status: 'freeze', chance: 10 }, status: { kind: 'stat', target: 'foe', stat: 'spe', stages: -2, chance: 100, accuracy: 90 }, strong: { kind: 'status', status: 'freeze', chance: 10 } },
  ghost: { weak: null, status: { kind: 'status', status: 'confusion', chance: 100, accuracy: 90 }, strong: null },
  poison: { weak: { kind: 'status', status: 'poison', chance: 30 }, status: { kind: 'status', status: 'poison', chance: 100, accuracy: 90 }, strong: { kind: 'status', status: 'poison', chance: 30 } },
  dragon: { weak: null, status: { kind: 'stat', target: 'self', stat: 'atk', stages: 1, chance: 100, accuracy: null }, strong: { kind: 'recoil', fraction: 0.25 } },
  fight: { weak: null, status: { kind: 'stat', target: 'self', stat: 'atk', stages: 2, chance: 100, accuracy: null }, strong: { kind: 'recoil', fraction: 0.25 } },
  normal: { weak: null, status: { kind: 'stat', target: 'foe', stat: 'atk', stages: -1, chance: 100, accuracy: 100 }, strong: null },
};
const ROLE_STATS = {
  balanced: [60, 60, 60, 60, 60, 60], fast: [50, 60, 45, 60, 50, 95], strong: [65, 90, 60, 45, 50, 60],
  bulky: [80, 60, 85, 45, 70, 30], special: [55, 45, 50, 90, 75, 65],
};
const MOOD_MUSIC = {
  adventurous: { tempo: 116, key: 'D', scale: 'major', instrument: 'square' }, calm: { tempo: 90, key: 'F', scale: 'major', instrument: 'sine' },
  tense: { tempo: 132, key: 'A', scale: 'minor', instrument: 'sawtooth' }, playful: { tempo: 124, key: 'G', scale: 'major', instrument: 'square' },
  mysterious: { tempo: 100, key: 'E', scale: 'dorian', instrument: 'triangle' }, heroic: { tempo: 120, key: 'C', scale: 'mixolydian', instrument: 'square' },
};
const fx = (kind = 'none', o = {}) => ({ kind, status: 'none', target: 'foe', stat: 'atk', stages: 0, chance: 0, fraction: 0, hitsMin: 2, hitsMax: 5, ...o });
const FILLER_TYPES = [
  { style: 'rock', name: 'Stone', color: '#a08858', look: 'rock and pebbles', beats: ['Gale', 'Spark'], moves: { weak: 'Pebble Shot', strong: 'Rockslide', status: 'Harden' } },
  { style: 'wind', name: 'Gale', color: '#a0a8f0', look: 'wind and feathers', beats: [], moves: { weak: 'Gust', strong: 'Cyclone', status: 'Sand Squall' } },
  { style: 'electric', name: 'Spark', color: '#f0d030', look: 'sparks', beats: ['Gale'], moves: { weak: 'Zap', strong: 'Thunderclap', status: 'Static Wave' } },
  { style: 'ice', name: 'Frost', color: '#88d8f0', look: 'ice crystals', beats: ['Gale'], moves: { weak: 'Ice Chip', strong: 'Blizzard Rush', status: 'Chill' } },
  { style: 'ghost', name: 'Shade', color: '#7a5aa8', look: 'shadows', beats: ['Shade'], moves: { weak: 'Shadow Jab', strong: 'Night Wave', status: 'Haunt' } },
  { style: 'poison', name: 'Venom', color: '#a040a0', look: 'toxic drips', beats: [], moves: { weak: 'Toxic Sting', strong: 'Sludge Burst', status: 'Poison Mist' } },
];
const CLASS_NAMES =['Kai', 'Lena', 'Odo', 'Mira', 'Tavi', 'Rook', 'Sela', 'Jun', 'Pim', 'Vera', 'Ilo', 'Nash'];

export function fromCompact(input) {
  const c = structuredClone(input || {});
  const ids = new Set();
  const idFor = (name, d) => { const base = slug(name, d); let id = base, i = 2; while (ids.has(id)) id = `${base}-${i++}`; ids.add(id); return id; };

  // Types: ids from names; the plain type first; styles pick effects.
  const typeList = (c.types || []).filter(t => t?.name).slice(0, 12);
  if (!typeList.some(t => !(t.beats || []).length)) typeList.unshift({ name: 'Normal', color: '#a8a878', look: 'plain', beats: [], moves: { weak: 'Tackle', strong: 'Slam', status: 'Growl' } });
  // Fewer than six types: top up with fillers whose style isn't taken yet (validation needs 6–18).
  for (const extra of FILLER_TYPES) {
    if (typeList.length >= 6) break;
    const taken = typeList.some(t => String(t.name).toLowerCase() === extra.name.toLowerCase() || STYLE.find(([s]) => s === extra.style)?.[1].test(`${t.name} ${t.look}`.toLowerCase()));
    if (!taken) typeList.push(extra);
  }
  const typeId = new Map();
  const types = typeList.map((t, i) => { const id = idFor(t.name, `type-${i}`); typeId.set(String(t.name).toLowerCase(), id); typeId.set(id, id); return { id, name: t.name, color: t.color, look: t.look || '', src: t }; });
  const plain = types.find(t => !(t.src.beats || []).length) || types[0];
  const tid = name => typeId.get(String(name || '').toLowerCase()) || typeId.get(slug(name)) || null;
  const styleOf = t => (t === plain ? 'normal' : (STYLE.find(([, re]) => re.test(`${t.name} ${t.look}`.toLowerCase())) || ['normal'])[0]);
  const chart = [];
  for (const t of types) for (const b of t.src.beats || []) { const d = tid(b); if (d && d !== t.id) chart.push({ attacking: t.id, defending: d, multiplier: '2' }); }
  // Resistances mirror strengths: if A beats B, B resists A.
  for (const e of [...chart]) if (!chart.some(x => x.attacking === e.defending && x.defending === e.attacking)) chart.push({ attacking: e.defending, defending: e.attacking, multiplier: '0.5' });

  // Moves: three per type plus two shared plain moves.
  const moves = [], moveOf = {};
  types.forEach((t, i) => {
    const st = styleOf(t), k = KIT[st] || KIT.normal, m = t.src.moves || {};
    const physicalFirst = i % 2 === 0;
    const add = (role, name, def) => { const id = idFor(name || `${t.name} ${role}`, `${t.id}-${role}`); moves.push({ id, name: name || `${t.name} ${role}`, type: t.id, ...def }); (moveOf[t.id] ??= {})[role] = id; };
    add('weak', m.weak, { category: physicalFirst ? 'physical' : 'special', power: k.weak?.kind === 'multihit' ? 18 : 40, accuracy: k.weak?.kind === 'multihit' ? 85 : 100, pp: 30, priority: 0, effect: k.weak ? fx(k.weak.kind, { ...k.weak, hitsMin: k.weak.min || 2, hitsMax: k.weak.max || 5 }) : fx(), description: `A basic ${t.name} attack.` });
    add('strong', m.strong, { category: physicalFirst ? 'special' : 'physical', power: 85, accuracy: 95, pp: 10, priority: 0, effect: k.strong ? fx(k.strong.kind, k.strong) : fx(), description: `A powerful ${t.name} attack.` });
    add('status', m.status, { category: 'status', power: 0, accuracy: k.status.accuracy === null ? 0 : k.status.accuracy, pp: 20, priority: 0, effect: fx(k.status.kind, k.status), description: `A ${t.name} technique.` });
  });
  const quick = idFor('Quick Strike', 'quick-strike'), mend = idFor('Mend', 'mend');
  moves.push({ id: quick, name: 'Quick Strike', type: plain.id, category: 'physical', power: 40, accuracy: 100, pp: 30, priority: 1, effect: fx(), description: 'Always strikes first.' });
  moves.push({ id: mend, name: 'Mend', type: plain.id, category: 'status', power: 0, accuracy: 0, pp: 10, priority: 0, effect: fx('heal', { fraction: 0.5, target: 'self' }), description: 'Restores half its health.' });

  // Species from lines: same learnset for every form of a line, stats by role and stage.
  const species = [], speciesId = new Map(), starters = [];
  const learnsetFor = lineTypes => {
    const [a, b] = lineTypes, mv = (t, r) => moveOf[t]?.[r];
    const l = [[1, mv(plain.id, 'weak')], [1, mv(plain.id, 'status')], [5, mv(a, 'weak')], [9, b ? mv(b, 'weak') : quick], [13, mv(a, 'status')], [18, quick], [24, mv(a, 'strong')], [30, b ? mv(b, 'strong') : mend], [36, mend]];
    if (a === plain.id) l.splice(2, 1, [5, mv(plain.id, 'strong')]);
    return l.filter(([, m]) => m).map(([level, move]) => ({ level, move }));
  };
  const addLine = (ln, i, { starter }) => {
    let lineTypes = (ln?.types || []).map(tid).filter(Boolean).filter((t, j, all) => all.indexOf(t) === j).slice(0, 2);
    if (!lineTypes.length) lineTypes = [types[(i + 1) % types.length].id];
    const forms = (ln?.forms || []).filter(f => f?.name).slice(0, 3);
    if (!forms.length) return null;
    const base = ROLE_STATS[ln.role] || ROLE_STATS.balanced;
    const learnset = learnsetFor(lineTypes);
    const out = forms.map((f, k) => {
      const id = idFor(f.name, `creature-${species.length}`);
      speciesId.set(String(f.name).toLowerCase(), id); speciesId.set(id, id);
      const stage = forms.length === 1 ? 'base' : k === 0 ? 'base' : k === forms.length - 1 ? 'final' : 'middle';
      const s = { id, name: f.name, types: lineTypes, stage, growth: 'medium', base: { hp: base[0], atk: base[1], def: base[2], spa: base[3], spd: base[4], spe: base[5] }, learnset, evolvesTo: '', evolveLevel: 0, look: f.look || '', dex: f.look ? `${f.name}: ${f.look}.` : '' };
      species.push(s);
      return s;
    });
    out.forEach((s, k) => { if (out[k + 1]) { s.evolvesTo = out[k + 1].id; s.evolveLevel = forms.length === 3 ? (k === 0 ? 16 : 32) : starter ? 16 : 18; } });
    return out;
  };
  // Starters need three distinct first types for the triangle; repeated ones move to unused types.
  const usedFirst = new Set();
  (c.starters || []).slice(0, 3).forEach((ln, i) => {
    const line = { ...ln, types: [...(ln?.types || [])] };
    let first = tid(line.types[0]);
    if (!first || usedFirst.has(first) || first === plain.id) { first = types.find(t => t !== plain && !usedFirst.has(t.id))?.id || first; line.types[0] = first; }
    usedFirst.add(first);
    const forms = addLine(line, i, { starter: true });
    if (forms) starters.push(forms[0].id);
  });
  (c.wild || []).forEach((ln, i) => addLine(ln, i + 3, { starter: false }));
  const firstForms = species.filter(s => s.stage === 'base' && !starters.includes(s.id)).map(s => s.id);
  const anyOf = (names, fallback) => { const out = (names || []).map(n => speciesId.get(String(n).toLowerCase()) || speciesId.get(slug(n))).filter(Boolean); return out.length ? out : fallback; };

  // Items: six names, fixed roles.
  const it = c.items || {};
  const items = [
    { id: idFor(it.ball || 'Capture Ball', 'ball'), name: it.ball || 'Capture Ball', kind: 'ball', price: 200, value: 1, description: 'Catches wild creatures.' },
    { id: idFor(it.greatBall || 'Great Ball', 'great-ball'), name: it.greatBall || 'Great Ball', kind: 'ball', price: 600, value: 1.5, description: 'A better chance to catch.' },
    { id: idFor(it.potion || 'Potion', 'potion'), name: it.potion || 'Potion', kind: 'heal', price: 300, value: 20, description: 'Restores 20 HP.' },
    { id: idFor(it.superPotion || 'Super Potion', 'super-potion'), name: it.superPotion || 'Super Potion', kind: 'heal', price: 700, value: 50, description: 'Restores 50 HP.' },
    { id: idFor(it.cure || 'Cure-All', 'cure'), name: it.cure || 'Cure-All', kind: 'status', price: 400, value: 0, description: 'Cures any status condition.' },
    { id: idFor(it.revive || 'Revive', 'revive'), name: it.revive || 'Revive', kind: 'revive', price: 1500, value: 0.5, description: 'Revives a fainted creature to half health.' },
    { id: idFor('Repel', 'repel'), name: 'Repel', kind: 'repel', price: 350, value: 100, description: 'Keeps weak wild creatures away for 100 steps.' },
  ];

  // The journey: routes with wild creatures and trainers, towns with gyms led by one type.
  let nameN = 0;
  const trainerOut = (t, pool) => ({ id: t?.name || '', name: t?.name || CLASS_NAMES[nameN++ % CLASS_NAMES.length], class: t?.class || 'Trainer', look: '', party: anyOf(t?.team, pool.slice(0, 1)).slice(0, 3).map(species => ({ species })), intro: 'You look strong. Let\'s battle!', defeat: 'You win this time!' });
  let seenWild = firstForms.slice(0, 3);
  const routeOut = (r, i) => {
    const wild = anyOf(r?.wild, seenWild).slice(0, 4);
    seenWild = [...new Set([...wild, ...seenWild])];
    return { id: r?.name || `route-${i + 1}`, name: r?.name || `Route ${i + 1}`, kind: r?.kind === 'cave' ? 'cave' : 'route', theme: r?.theme || '', description: r?.theme || '', length: r?.length || 0, encounterRate: r?.encounterRate || 0, encounters: wild.map((species, k) => ({ species, weight: 40 - k * 8 })), trainers: (r?.trainers || []).slice(0, 2).map(t => trainerOut(t, wild)) };
  };
  let routeN = 0;
  const chapters = (c.chapters || []).filter(Boolean).slice(0, 8).map((ch, g) => {
    const routes = (ch.routes?.length ? ch.routes : [{}]).slice(0, 3).map(r => routeOut(r, routeN++));
    const type = tid(ch.gym?.type) || types[(g % (types.length - 1)) + 1]?.id || plain.id;
    const ofType = species.filter(s => s.types.includes(type) && !starters.includes(s.id)).map(s => s.id);
    const team = (ofType.length ? ofType : seenWild).slice(0, 2 + Math.min(2, Math.floor(g / 2)));
    const gymTrainerTeam = (ofType.length ? ofType : seenWild).slice(0, 1);
    const leader = ch.gym?.leader || `Leader ${g + 1}`;
    return {
      routes,
      town: { id: ch.town?.name || `town-${g + 1}`, name: ch.town?.name || `Town ${g + 1}`, theme: ch.town?.theme || '', description: ch.town?.theme || '', npcs: [] },
      gym: {
        id: `${ch.town?.name || `town-${g + 1}`} gym`, name: `${ch.town?.name || `Town ${g + 1}`} Gym`, theme: `${types.find(t => t.id === type)?.name || ''} gym hall`, description: '',
        trainers: [{ id: `gym-trainer-${g + 1}`, name: CLASS_NAMES[nameN++ % CLASS_NAMES.length], class: 'Gym Trainer', look: '', party: gymTrainerTeam.map(species => ({ species })), intro: `${leader} won't be easy!`, defeat: 'Go on, the leader awaits.' }],
        leader: { id: leader, name: leader, look: ch.gym?.look || '', type, badge: ch.gym?.badge || `Badge ${g + 1}`, party: team.map(species => ({ species })), intro: ch.gym?.quote || 'Show me your strength!', defeat: `You've earned the ${ch.gym?.badge || 'badge'}!` },
      },
    };
  });
  if (!chapters.length) chapters.push({ routes: [routeOut({}, routeN++)], town: { id: '', name: 'Town', theme: '', description: '', npcs: [] }, gym: { id: '', name: 'Gym', theme: '', description: '', trainers: [], leader: { id: '', name: 'Leader', look: '', type: types[1]?.id || plain.id, badge: 'Badge', party: seenWild.slice(0, 2).map(species => ({ species })), intro: '', defeat: '' } } });
  const finals = species.filter(s => s.stage === 'final' && !starters.includes(s.id)).map(s => s.id);
  const f = c.finale || {};
  const finale = {
    routes: (f.routes?.length ? f.routes : [{}]).slice(0, 2).map(r => routeOut(r, routeN++)),
    league: { id: f.league?.name || 'league', name: f.league?.name || 'League', theme: f.league?.theme || 'grand stone hall', description: f.league?.theme || '' },
    champion: { name: f.champion?.name || 'Champion', look: f.champion?.look || '', party: anyOf(f.champion?.team, finals.length ? finals : seenWild).slice(0, 5).map(species => ({ species })), intro: f.champion?.quote || 'Show me everything you have learned.', defeat: 'A new champion rises!' },
  };
  return {
    settings: c.settings || {},
    title: c.title || 'Untitled', logline: c.logline || '', artStyle: c.artStyle || '',
    music: { mood: c.mood || 'adventurous', ...(MOOD_MUSIC[c.mood] || MOOD_MUSIC.adventurous) },
    region: c.region || { name: 'Region', description: '' },
    player: c.player || { name: 'Hero', look: '' }, rival: { name: c.rival?.name || 'Rival', look: c.rival?.look || '', personality: 'competitive' },
    mentor: { name: c.mentor?.name || 'Professor', look: c.mentor?.look || '', role: 'creature researcher' },
    types: types.map(({ src, ...t }) => t), chart, moves, species, starters, items,
    home: { id: c.home?.name || 'home', name: c.home?.name || 'Home', theme: c.home?.theme || '', description: c.home?.theme || '', npcs: [] },
    chapters, finale, moments: [],
  };
}
