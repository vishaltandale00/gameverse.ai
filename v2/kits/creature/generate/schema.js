// The model-facing content schema (OpenAI strict mode): every object has additionalProperties
// false and lists every property in `required`; enums instead of unions; no min/max keywords
// (ranges are clamped by balance()). The model writes a compact *journey*: the cast, types, moves,
// species and one chapter per gym. fromModel() expands it into full content (areas, connects,
// gates, services, levels on the curve), so the model never has to get graph or level math right.
import { STATUSES, STAGE_STATS, GROWTHS } from '../content.js';

const str = (description) => (description ? { type: 'string', description } : { type: 'string' });
const int = description => ({ type: 'integer', ...(description ? { description } : {}) });
const num = description => ({ type: 'number', ...(description ? { description } : {}) });
const en = (list, description) => ({ type: 'string', enum: list, ...(description ? { description } : {}) });
const arr = (items, description) => ({ type: 'array', items, ...(description ? { description } : {}) });
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const EFFECT_KINDS = ['none', 'status', 'stat', 'heal', 'drain', 'recoil', 'multihit', 'protect', 'flinch'];

const person = obj({ name: str(), look: str('short visual description: clothes, colors, hair') });
const npc = obj({ id: str('lowercase slug'), name: str(), look: str(), lines: arr(str()) });
const member = obj({ species: str('species id') });
const trainer = obj({ id: str('lowercase slug, unique'), name: str(), class: str('e.g. Hiker, Lass, Fisher'), look: str(), party: arr(member, '1–3 creatures'), intro: str(), defeat: str() });

export const MODEL_SCHEMA = obj({
  title: str(), logline: str('one sentence'), artStyle: str('e.g. "bright 16-bit pixel art"'),
  music: obj({ mood: en(['adventurous', 'calm', 'tense', 'playful', 'mysterious', 'heroic']), tempo: int('80–150'), key: en(['C', 'D', 'E', 'F', 'G', 'A', 'B']), scale: en(['major', 'minor', 'dorian', 'mixolydian']), instrument: en(['square', 'triangle', 'sawtooth', 'sine']) }),
  region: obj({ name: str(), description: str('one sentence') }),
  player: person,
  rival: obj({ name: str(), look: str(), personality: str() }),
  mentor: obj({ name: str(), look: str(), role: str('e.g. creature researcher') }),
  types: arr(obj({ id: str('lowercase slug'), name: str(), color: str('hex like #e86830'), look: str('what creatures of this type look like') }), '6–8 types; include one plain Normal-like type'),
  chart: arr(obj({ attacking: str('type id'), defending: str('type id'), multiplier: en(['0', '0.5', '2']) }), 'only non-neutral pairs; every type needs a weakness and a resistance'),
  moves: arr(obj({
    id: str('lowercase slug'), name: str(), type: str('type id'), category: en(['physical', 'special', 'status']),
    power: int('0 for status moves, else 20–120'), accuracy: int('30–100, or 0 for never misses'), pp: int('5–40'), priority: int('usually 0; 1 for quick moves'),
    effect: obj({
      kind: en(EFFECT_KINDS), status: en(['none', ...STATUSES]), target: en(['self', 'foe']), stat: en(STAGE_STATS), stages: int('−2..2, not 0, for stat effects'),
      chance: int('1–100 percent'), fraction: num('0.25–1 for heal; 0.1–0.5 for drain and recoil'), hitsMin: int('2'), hitsMax: int('3–5'),
    }),
    description: str('a few words'),
  }), '16–24 moves: per type a weak and a strong attack, plus a few status moves'),
  species: arr(obj({
    id: str('lowercase slug'), name: str('original name'), types: arr(str('type id'), '1 or 2 type ids'), stage: en(['base', 'middle', 'final']),
    growth: en(GROWTHS), base: obj({ hp: int(), atk: int(), def: int(), spa: int(), spd: int(), spe: int() }),
    learnset: arr(obj({ level: int(), move: str('move id') }), 'two moves at level 1 (one damaging), then 2–4 more up to level 40'),
    evolvesTo: str('species id, or "" if it does not evolve'), evolveLevel: int('0 if it does not evolve; else 12–36'),
    look: str('visual description: body shape (bird, quadruped, blob, biped), colors, features'), dex: str('one short sentence'),
  }), '12–20 species: three starter lines (base → middle → final) plus wild lines'),
  starters: arr(str('base species id'), 'exactly three base species whose first types beat each other in a cycle'),
  items: arr(obj({ id: str('lowercase slug'), name: str(), kind: en(['ball', 'heal', 'status', 'revive', 'repel']), price: int(), value: num('ball: catch bonus 1–2; heal: HP restored; revive: fraction 0.5'), description: str() }), '5–8 items with at least one ball and one heal'),
  home: obj({ id: str('lowercase slug'), name: str('starting town'), theme: str('visual theme, e.g. "cozy village with thatched roofs"'), description: str(), npcs: arr(npc) }),
  chapters: arr(obj({
    route: obj({ id: str('lowercase slug'), name: str(), kind: en(['route', 'cave']), theme: str(), description: str(), encounters: arr(obj({ species: str('species id'), weight: int('1–100') }), '2–4 wild species'), trainers: arr(trainer, '1–2 trainers') }),
    town: obj({ id: str('lowercase slug'), name: str(), theme: str(), description: str(), npcs: arr(npc) }),
    gym: obj({ id: str('lowercase slug'), name: str(), theme: str(), description: str(), trainers: arr(trainer, '0–2 gym trainers'),
      leader: obj({ id: str('lowercase slug'), name: str(), look: str(), type: str('type id this gym specializes in'), badge: str('badge name'), party: arr(member, '2–4 creatures, mostly of the gym type'), intro: str(), defeat: str() }) }),
  }), '2 or 3 chapters in order: a route (or cave) leading to a town that has a gym'),
  finale: obj({
    route: obj({ id: str('lowercase slug'), name: str(), kind: en(['route', 'cave']), theme: str(), description: str(), encounters: arr(obj({ species: str(), weight: int() })), trainers: arr(trainer) }),
    league: obj({ id: str('lowercase slug'), name: str(), theme: str(), description: str() }),
    champion: obj({ name: str(), look: str(), party: arr(member, '3–5 strong, evolved creatures'), intro: str(), defeat: str() }),
  }),
  moments: arr(obj({ area: str('area id from home, chapters or finale'), who: en(['mentor', 'rival', 'player']), text: str() }), '0–4 short story moments, shown when the player first enters that area'),
});

export const MODEL_PROMPT = `You design a creature-collecting RPG in the style of the classic handheld monster-catching games: explore towns and routes, meet wild creatures in tall grass, battle them turn by turn with typed moves, weaken and catch them, build a party of six, level up, evolve, beat trainers and gym leaders for badges, battle a rival, and finally face the champion.

Write ORIGINAL content only: new names for creatures, moves, types, places and people (inspired by the idea, never copying an existing game's names). The engine supplies every system; you supply the world.

Rules for your content:
- Types: 6–8, with ids as lowercase slugs, a hex color each, and one plain Normal-like type. The chart lists only non-neutral pairs (0, 0.5 or 2). Every type must have at least one weakness and one resistance. Three types form a starter triangle (e.g. leaf beats water, water beats fire, fire beats leaf).
- Moves: 16–24. Each type gets a weak attack (power 35–50) and a stronger one (power 70–100). A few status moves (sleep, paralysis, stat drops, a heal). Status moves have power 0. effect.kind is "none" when a move has no extra effect; unused effect fields still need values (use "none", "foe", "atk", 0).
- Species: 12–20. Three starter lines of three stages (base → middle at about level 16 → final at about level 32), and wild lines (common early creatures, sturdier later ones). Every species learns two moves at level 1, including a damaging move of its own type or the Normal-like type, and gains its type's stronger move later. Give each a vivid visual look (body shape: bird, four-legged, blob, upright; colors; one or two features) and a short dex line.
- Starters: the three starter base species, in triangle order.
- Items: 5–8, including a basic ball (price 200, value 1), a better ball (value 1.5), a heal (value 20), a strong heal (value 50), a status cure and a revive (value 0.5).
- The journey: a home town, then 2–3 chapters (a route or cave with wild encounters and trainers, then a town whose gym leader specializes in one type), then a finale route and the league with the champion. Wild encounters list species ids that fit the place; early routes use base forms. Gym leaders use their type; the champion uses evolved creatures of several types.
- Levels are set by the engine on a level curve, so parties only list species.
- Keep text short: one-line descriptions, dialogue lines under 90 characters.`;
