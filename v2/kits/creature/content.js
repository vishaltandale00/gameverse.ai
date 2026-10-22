// Creature-kit content: schema, normalization and validation (CONTRACT.md §1).
// Content is what the model writes; every other part of the kit reads it through these helpers.
// Errors carry stable codes and paths, like v2 preflight, so a generator can repair content.
export const CONTENT_SCHEMA = 'gameverse.v2.creature-content/0.1';

export const STATUSES = ['burn', 'poison', 'paralysis', 'sleep', 'freeze', 'confusion'];
export const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAGE_STATS = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
export const AREA_KINDS = ['town', 'route', 'cave', 'gym', 'interior', 'league'];
export const ITEM_KINDS = ['ball', 'heal', 'status', 'revive', 'key', 'repel'];
export const GROWTHS = ['fast', 'medium', 'slow'];
export const SERVICES = ['heal', 'mart', 'pc'];
// Reserved story/battle identities: `who` in say effects and `trainer` in battle effects.
// The rival's party is derived by the world (counter-starter plus fillers on the level curve).
export const RESERVED_SPEAKERS = ['player', 'rival', 'mentor', 'champion'];
export const RIVAL_TRAINER = 'rival';
export const STARTER_LEVEL = 5;

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Tunable world settings (real options for "bigger", "harder", "more encounters"; see KIT_CONTRACT.md).
export const DIFFICULTIES = ['easy', 'normal', 'hard'];
export const DEFAULT_SETTINGS = { levelStep: 7, difficulty: 'normal', encounterRate: 10, routeLength: 50 };
const clampInt = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
/** Settings with defaults filled and ranges clamped. */
export function settingsOf(content) {
  const s = content?.settings || {};
  return {
    levelStep: clampInt(s.levelStep, 3, 12, DEFAULT_SETTINGS.levelStep),
    difficulty: DIFFICULTIES.includes(s.difficulty) ? s.difficulty : DEFAULT_SETTINGS.difficulty,
    encounterRate: clampInt(s.encounterRate, 1, 40, DEFAULT_SETTINGS.encounterRate),
    routeLength: clampInt(s.routeLength, 24, 160, DEFAULT_SETTINGS.routeLength),
  };
}
/** Level offset trainers, leaders and the champion get from the difficulty. */
export const difficultyOffset = content => ({ easy: -2, normal: 0, hard: 2 })[settingsOf(content).difficulty];

/** Target level for gym g's ace (g counts from 1): L(g) = 5 + step·g, step 7 by default (12, 19, 26, …). */
export const levelCurve = (g, content) => 5 + settingsOf(content).levelStep * g;

/** Id → object maps for every content collection. */
export function indexContent(content) {
  const by = list => new Map((list || []).map(x => [x.id, x]));
  const trainers = new Map();
  for (const area of content.areas || []) {
    for (const t of area.trainers || []) trainers.set(t.id, { ...t, area: area.id });
    if (area.leader) trainers.set(area.leader.id, { ...area.leader, area: area.id, isLeader: true });
  }
  return { types: by(content.types), moves: by(content.moves), species: by(content.species), items: by(content.items), areas: by(content.areas), trainers };
}

/** Deep-copied content with defaults filled and learnsets sorted. Does not validate. */
export function normalize(input) {
  const content = structuredClone(input);
  for (const m of content.moves || []) {
    m.priority ??= 0;
    if (m.accuracy === undefined) m.accuracy = 100;
    if (m.category === 'status') m.power = 0;
    if (m.effect && m.effect.kind !== 'multihit' && m.effect.kind !== 'protect' && m.effect.kind !== 'heal' && m.effect.kind !== 'drain' && m.effect.kind !== 'recoil') m.effect.chance ??= 100;
  }
  for (const s of content.species || []) {
    s.learnset = [...(s.learnset || [])].sort((a, b) => a.level - b.level);
    s.growth ??= 'medium';
  }
  content.settings = settingsOf(content);
  for (const a of content.areas || []) {
    a.connects ??= [];
    if (a.kind === 'route' || a.kind === 'cave') {
      a.encounterRate = Number.isFinite(a.encounterRate) && a.encounterRate > 0 ? Math.min(0.4, a.encounterRate) : content.settings.encounterRate / 100;
      a.length = clampInt(a.length, 24, 160, content.settings.routeLength);
    }
  }
  content.chart ??= {};
  content.story ??= [];
  return content;
}

/**
 * Badges needed to reach each area from the first area, honoring badge gates. Flag gates count as
 * passable when some story effect sets the flag. Returns Map(areaId → badges), unreachable omitted.
 */
export function areaStages(content) {
  const { areas } = indexContent(content);
  const settable = new Set();
  for (const rule of content.story || []) for (const e of rule.then || []) if (e.do === 'set_flag') settable.add(e.flag);
  const start = content.areas?.[0]?.id;
  const stages = new Map();
  if (!start) return stages;
  // Dijkstra-like relaxation where an edge's cost is its badge requirement (max, not sum).
  const frontier = [[start, 0]];
  while (frontier.length) {
    frontier.sort((a, b) => a[1] - b[1]);
    const [id, need] = frontier.shift();
    if (stages.has(id) && stages.get(id) <= need) continue;
    stages.set(id, need);
    for (const c of areas.get(id)?.connects || []) {
      if (!areas.has(c.to)) continue;
      if (c.gate?.flag && !settable.has(c.gate.flag)) continue;
      frontier.push([c.to, Math.max(need, c.gate?.badge || 0)]);
    }
  }
  return stages;
}

/** Gym areas in badge order (by stage, then listing order). */
export function gymOrder(content) {
  const stages = areaStages(content);
  return (content.areas || []).filter(a => a.kind === 'gym' && a.leader && stages.has(a.id))
    .map((a, i) => ({ a, i, s: stages.get(a.id) })).sort((x, y) => x.s - y.s || x.i - y.i).map(x => x.a);
}

function predicateErrors(p, path, refs, fail) {
  if (!p || typeof p !== 'object') return fail('predicate_invalid', path, 'predicate must be an object');
  const keys = Object.keys(p);
  if (keys.length !== 1) return fail('predicate_invalid', path, 'predicate must have exactly one key', 'flag, badges, area, defeated, owns, caught, all, any or not');
  const [k] = keys, v = p[k];
  if (k === 'all' || k === 'any') {
    if (!Array.isArray(v) || !v.length) return fail('predicate_invalid', `${path}.${k}`, `${k} needs a non-empty list`);
    v.forEach((q, i) => predicateErrors(q, `${path}.${k}[${i}]`, refs, fail));
  } else if (k === 'not') predicateErrors(v, `${path}.not`, refs, fail);
  else if (k === 'flag') { if (typeof v !== 'string' || !v) fail('predicate_invalid', `${path}.flag`, 'flag must be a string'); }
  else if (k === 'badges' || k === 'caught') { if (!Number.isFinite(v?.gte)) fail('predicate_invalid', `${path}.${k}`, `${k} needs { gte: number }`); }
  else if (k === 'area') { if (!refs.areas.has(v)) fail('ref_area', `${path}.area`, `unknown area '${v}'`); }
  else if (k === 'defeated') { if (!refs.trainers.has(v) && v !== RIVAL_TRAINER) fail('ref_trainer', `${path}.defeated`, `unknown trainer '${v}'`); }
  else if (k === 'owns') { if (!refs.species.has(v)) fail('ref_species', `${path}.owns`, `unknown species '${v}'`); }
  else fail('predicate_invalid', path, `unknown predicate '${k}'`);
}

function effectErrors(e, path, refs, fail) {
  const speakers = new Set([...RESERVED_SPEAKERS, ...refs.trainers.keys(), ...refs.npcs]);
  switch (e?.do) {
    case 'say': if (!speakers.has(e.who)) fail('ref_speaker', `${path}.who`, `unknown speaker '${e.who}'`, `one of ${RESERVED_SPEAKERS.join(', ')}, an NPC id or a trainer id`);
      if (typeof e.text !== 'string' || !e.text) fail('schema', `${path}.text`, 'say needs text'); break;
    case 'give_item': if (!refs.items.has(e.item)) fail('ref_item', `${path}.item`, `unknown item '${e.item}'`); break;
    case 'give_creature': if (!refs.species.has(e.species)) fail('ref_species', `${path}.species`, `unknown species '${e.species}'`); break;
    case 'set_flag': if (typeof e.flag !== 'string' || !e.flag) fail('schema', `${path}.flag`, 'set_flag needs a flag'); break;
    case 'battle': if (e.trainer !== undefined) { if (e.trainer !== RIVAL_TRAINER && !refs.trainers.has(e.trainer)) fail('ref_trainer', `${path}.trainer`, `unknown trainer '${e.trainer}'`); }
      else if (!Array.isArray(e.party) || !e.party.length) fail('schema', path, 'battle needs a trainer or a party');
      else e.party.forEach((m, i) => { if (!refs.species.has(m.species)) fail('ref_species', `${path}.party[${i}].species`, `unknown species '${m.species}'`); }); break;
    case 'warp': if (!refs.areas.has(e.area)) fail('ref_area', `${path}.area`, `unknown area '${e.area}'`); break;
    case 'heal': case 'end_game': break;
    default: fail('effect_invalid', `${path}.do`, `unknown effect '${e?.do}'`, 'say, give_item, give_creature, set_flag, battle, heal, warp or end_game');
  }
}

/** Validate content. Returns { ok, errors, warnings, content } where content is normalized. */
export function validate(input) {
  const errors = [], warnings = [];
  const fail = (code, path, message, hint) => { errors.push({ code, path, message, ...(hint ? { hint } : {}) }); };
  const warn = (code, path, message) => { warnings.push({ code, path, message }); };
  if (!input || typeof input !== 'object') return { ok: false, errors: [{ code: 'schema', path: '$', message: 'content must be an object' }], warnings, content: null };
  const content = normalize(input);
  const inRange = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  const slugs = (list, path) => {
    if (!Array.isArray(list) || !list.length) return fail('schema', path, `${path} must be a non-empty list`);
    const seen = new Set();
    list.forEach((x, i) => {
      if (!SLUG.test(x?.id || '')) fail('schema', `${path}[${i}].id`, 'id must be a lowercase slug');
      else if (seen.has(x.id)) fail('duplicate_id', `${path}[${i}].id`, `duplicate id '${x.id}'`);
      seen.add(x.id);
      if (typeof x?.name !== 'string' || !x.name.trim()) fail('schema', `${path}[${i}].name`, 'name is required');
    });
  };

  if (content.schema !== CONTENT_SCHEMA) fail('schema', 'schema', `schema must be '${CONTENT_SCHEMA}'`);
  if (!SLUG.test(content.id || '')) fail('schema', 'id', 'id must be a lowercase slug');
  if (typeof content.title !== 'string' || !content.title.trim()) fail('schema', 'title', 'title is required');
  for (const who of ['player', 'rival', 'mentor']) if (typeof content[who]?.name !== 'string') fail('schema', `${who}.name`, `${who} needs a name`);
  for (const key of ['types', 'moves', 'species', 'items', 'areas']) slugs(content[key], key);
  if (errors.length) return { ok: false, errors, warnings, content };

  const refs = indexContent(content);
  refs.npcs = new Set(content.areas.flatMap(a => (a.npcs || []).map(n => n.id)));

  // Types and chart.
  if (!inRange(content.types.length, 6, 18)) fail('types_count', 'types', `need 6–18 types, got ${content.types.length}`);
  for (const [att, row] of Object.entries(content.chart)) {
    if (!refs.types.has(att)) { fail('ref_type', `chart.${att}`, `unknown attacking type '${att}'`); continue; }
    for (const [def, mult] of Object.entries(row || {})) {
      if (!refs.types.has(def)) fail('ref_type', `chart.${att}.${def}`, `unknown defending type '${def}'`);
      else if (![0, 0.5, 2].includes(mult)) fail('chart_value', `chart.${att}.${def}`, 'chart entries must be 0, 0.5 or 2 (omit neutral pairs)');
    }
  }
  const mult = (att, def) => content.chart[att]?.[def] ?? 1;
  for (const t of content.types) {
    const ids = content.types.map(x => x.id);
    if (!ids.some(a => mult(a, t.id) > 1)) warn('type_no_weakness', `types.${t.id}`, `type '${t.id}' has no weakness`);
    if (!ids.some(a => mult(a, t.id) < 1)) warn('type_no_resistance', `types.${t.id}`, `type '${t.id}' has no resistance`);
  }

  // Moves.
  content.moves.forEach((m, i) => {
    const p = `moves[${i}]`;
    if (!refs.types.has(m.type)) fail('ref_type', `${p}.type`, `unknown type '${m.type}'`);
    if (!['physical', 'special', 'status'].includes(m.category)) fail('schema', `${p}.category`, 'category must be physical, special or status');
    if (m.category !== 'status' && !inRange(m.power, 10, 150)) fail('range', `${p}.power`, 'damaging moves need power 10–150');
    if (m.accuracy !== null && !inRange(m.accuracy, 30, 100)) fail('range', `${p}.accuracy`, 'accuracy must be 30–100 or null (never misses)');
    if (!inRange(m.pp, 5, 40)) fail('range', `${p}.pp`, 'pp must be 5–40');
    if (!inRange(m.priority, -3, 3)) fail('range', `${p}.priority`, 'priority must be −3..3');
    const e = m.effect;
    if (!e) { if (m.category === 'status') fail('status_move_no_effect', p, 'status moves need an effect'); return; }
    const chanceOk = () => inRange(e.chance, 1, 100) || fail('range', `${p}.effect.chance`, 'chance must be 1–100');
    if (e.kind === 'status') { if (!STATUSES.includes(e.status)) fail('schema', `${p}.effect.status`, `status must be one of ${STATUSES.join(', ')}`); chanceOk(); }
    else if (e.kind === 'stat') {
      if (!['self', 'foe'].includes(e.target)) fail('schema', `${p}.effect.target`, 'target must be self or foe');
      if (!STAGE_STATS.includes(e.stat)) fail('schema', `${p}.effect.stat`, `stat must be one of ${STAGE_STATS.join(', ')}`);
      if (!Number.isInteger(e.stages) || !e.stages || Math.abs(e.stages) > 2) fail('range', `${p}.effect.stages`, 'stages must be −2..2, not 0');
      chanceOk();
    } else if (e.kind === 'heal') { if (!inRange(e.fraction, 0.25, 1)) fail('range', `${p}.effect.fraction`, 'heal fraction must be 0.25–1'); }
    else if (e.kind === 'drain' || e.kind === 'recoil') { if (!inRange(e.fraction, 0.05, 1)) fail('range', `${p}.effect.fraction`, `${e.kind} fraction must be 0.05–1`); }
    else if (e.kind === 'multihit') { if (!(Number.isInteger(e.min) && Number.isInteger(e.max) && e.min >= 2 && e.max <= 5 && e.min <= e.max)) fail('range', `${p}.effect`, 'multihit needs 2 ≤ min ≤ max ≤ 5'); }
    else if (e.kind === 'flinch') chanceOk();
    else if (e.kind !== 'protect') fail('schema', `${p}.effect.kind`, `unknown effect kind '${e.kind}'`);
  });

  // Species, learnsets and evolution lines.
  const evolvedInto = new Set();
  content.species.forEach((s, i) => {
    const p = `species[${i}]`;
    if (!Array.isArray(s.types) || s.types.length < 1 || s.types.length > 2 || new Set(s.types).size !== s.types.length) fail('schema', `${p}.types`, 'species need one or two distinct types');
    else s.types.forEach((t, j) => { if (!refs.types.has(t)) fail('ref_type', `${p}.types[${j}]`, `unknown type '${t}'`); });
    for (const k of STATS) if (!inRange(s.base?.[k], 20, 160)) fail('range', `${p}.base.${k}`, 'base stats must be 20–160');
    if (!GROWTHS.includes(s.growth)) fail('schema', `${p}.growth`, `growth must be ${GROWTHS.join(', ')}`);
    if (!inRange(s.catchRate, 3, 255)) fail('range', `${p}.catchRate`, 'catchRate must be 3–255');
    if (!inRange(s.expYield, 40, 300)) fail('range', `${p}.expYield`, 'expYield must be 40–300');
    s.learnset.forEach((l, j) => {
      if (!refs.moves.has(l.move)) fail('ref_move', `${p}.learnset[${j}].move`, `unknown move '${l.move}'`);
      if (!Number.isInteger(l.level) || l.level < 1 || l.level > 100) fail('range', `${p}.learnset[${j}].level`, 'learn level must be 1–100');
    });
    const early = s.learnset.filter(l => l.level <= 5 && refs.moves.has(l.move)).map(l => refs.moves.get(l.move));
    if (s.learnset.filter(l => l.level === 1).length < 2 && early.length < 2) fail('learnset_sparse', `${p}.learnset`, 'need at least two moves by level 5', 'start with two level-1 moves');
    const neutral = t => !Object.values(content.chart[t] || {}).some(v => v > 1);
    if (!early.some(m => m.category !== 'status' && (s.types?.includes(m.type) || neutral(m.type)))) fail('learnset_no_attack', `${p}.learnset`, 'need a damaging move of its own or a neutral type by level 5');
    if (s.evolves) {
      if (!refs.species.has(s.evolves.to)) fail('ref_species', `${p}.evolves.to`, `unknown species '${s.evolves.to}'`);
      else if (s.evolves.to === s.id) fail('evolution_cycle', `${p}.evolves`, 'a species cannot evolve into itself');
      if (!Number.isInteger(s.evolves.level) || s.evolves.level < 2 || s.evolves.level > 100) fail('range', `${p}.evolves.level`, 'evolution level must be 2–100');
      if (evolvedInto.has(s.evolves.to)) fail('evolution_branch', `${p}.evolves.to`, `'${s.evolves.to}' is already evolved into by another species`);
      evolvedInto.add(s.evolves.to);
    }
  });
  // Walk each line: no cycles, strictly increasing levels.
  for (const s of content.species) {
    const seen = new Set([s.id]);
    let cur = s, lastLevel = 0;
    while (cur?.evolves && refs.species.has(cur.evolves.to)) {
      if (cur.evolves.level <= lastLevel) { fail('evolution_order', `species.${cur.id}.evolves.level`, 'evolution levels must increase along a line'); break; }
      lastLevel = cur.evolves.level;
      if (seen.has(cur.evolves.to)) { fail('evolution_cycle', `species.${s.id}.evolves`, 'evolution line loops'); break; }
      seen.add(cur.evolves.to);
      cur = refs.species.get(cur.evolves.to);
    }
  }

  // Starters: three base forms whose types beat each other in a cycle.
  const st = content.starters;
  if (!Array.isArray(st) || st.length !== 3 || new Set(st).size !== 3) fail('starters', 'starters', 'need three distinct starter species');
  else if (st.every(id => refs.species.has(id))) {
    st.forEach((id, i) => { if (evolvedInto.has(id)) fail('starter_not_base', `starters[${i}]`, `'${id}' is an evolved form`); });
    const t = st.map(id => refs.species.get(id).types[0]);
    const beats = (a, b) => mult(t[a], t[b]) > 1;
    if (!((beats(0, 1) && beats(1, 2) && beats(2, 0)) || (beats(1, 0) && beats(2, 1) && beats(0, 2))))
      fail('starter_cycle', 'starters', `starter types ${t.join(', ')} don't beat each other in a cycle`, 'e.g. leaf > water > fire > leaf');
  } else st.forEach((id, i) => { if (!refs.species.has(id)) fail('ref_species', `starters[${i}]`, `unknown species '${id}'`); });

  // Items.
  content.items.forEach((it, i) => {
    if (!ITEM_KINDS.includes(it.kind)) fail('schema', `items[${i}].kind`, `kind must be one of ${ITEM_KINDS.join(', ')}`);
    if (!Number.isFinite(it.price) || it.price < 0) fail('range', `items[${i}].price`, 'price must be ≥ 0');
  });
  if (!content.items.some(it => it.kind === 'ball')) fail('no_ball', 'items', 'need at least one ball item');

  // Areas, references and parties.
  const party = (list, path) => {
    if (!Array.isArray(list) || !list.length || list.length > 6) return fail('party', path, 'party must have 1–6 members');
    list.forEach((m, j) => {
      if (!refs.species.has(m.species)) fail('ref_species', `${path}[${j}].species`, `unknown species '${m.species}'`);
      if (!Number.isInteger(m.level) || m.level < 1 || m.level > 100) fail('range', `${path}[${j}].level`, 'level must be 1–100');
    });
  };
  const ace = list => Math.max(...(list || []).map(m => m.level || 0));
  content.areas.forEach((a, i) => {
    const p = `areas[${i}]`;
    if (!AREA_KINDS.includes(a.kind)) fail('schema', `${p}.kind`, `kind must be one of ${AREA_KINDS.join(', ')}`);
    a.connects.forEach((c, j) => {
      if (!refs.areas.has(c.to)) fail('ref_area', `${p}.connects[${j}].to`, `unknown area '${c.to}'`);
      else if (!refs.areas.get(c.to).connects?.some(b => b.to === a.id)) warn('connect_one_way', `${p}.connects[${j}]`, `'${c.to}' has no connection back to '${a.id}'`);
    });
    if ((a.kind === 'route' || a.kind === 'cave') && !a.encounters?.length) fail('route_no_encounters', `${p}.encounters`, `${a.kind} '${a.id}' needs encounters`);
    (a.encounters || []).forEach((e, j) => {
      if (!refs.species.has(e.species)) fail('ref_species', `${p}.encounters[${j}].species`, `unknown species '${e.species}'`);
      if (!(e.minLevel >= 1 && e.maxLevel >= e.minLevel && e.maxLevel <= 100)) fail('range', `${p}.encounters[${j}]`, 'need 1 ≤ minLevel ≤ maxLevel ≤ 100');
      if (!(e.weight > 0)) fail('range', `${p}.encounters[${j}].weight`, 'weight must be > 0');
    });
    (a.trainers || []).forEach((t, j) => party(t.party, `${p}.trainers[${j}].party`));
    if (a.kind === 'gym' && !a.leader) fail('gym_no_leader', `${p}.leader`, 'gyms need a leader');
    if (a.leader) {
      party(a.leader.party, `${p}.leader.party`);
      if (!refs.types.has(a.leader.type)) fail('ref_type', `${p}.leader.type`, `unknown type '${a.leader.type}'`);
      if (!a.leader.badge?.id || !a.leader.badge?.name) fail('schema', `${p}.leader.badge`, 'leader needs a badge { id, name }');
    }
    (a.services || []).forEach((s, j) => { if (!SERVICES.includes(s)) fail('schema', `${p}.services[${j}]`, `service must be one of ${SERVICES.join(', ')}`); });
    (a.mart || []).forEach((id, j) => { if (!refs.items.has(id)) fail('ref_item', `${p}.mart[${j}]`, `unknown item '${id}'`); });
    if (a.mart?.length && !a.services?.includes('mart')) warn('mart_without_service', `${p}.mart`, 'mart items listed but no mart service');
  });
  if (!content.areas.some(a => a.kind === 'league')) fail('no_league', 'areas', 'need a league area');
  if (!content.champion?.party) fail('schema', 'champion', 'champion needs a party');
  else party(content.champion.party, 'champion.party');

  // Story.
  (content.story || []).forEach((r, i) => {
    predicateErrors(r.when, `story[${i}].when`, refs, fail);
    if (!Array.isArray(r.then) || !r.then.length) fail('schema', `story[${i}].then`, 'story rules need effects');
    else r.then.forEach((e, j) => effectErrors(e, `story[${i}].then[${j}]`, refs, fail));
  });
  if (errors.length) return { ok: false, errors, warnings, content };

  // Progression: every gym reachable in badge order, then the league.
  const stages = areaStages(content);
  for (const a of content.areas) if (!stages.has(a.id)) fail('area_unreachable', `areas.${a.id}`, `area '${a.id}' can't be reached from '${content.areas[0].id}'`);
  const gyms = gymOrder(content);
  gyms.forEach((g, i) => {
    if (stages.get(g.id) !== i) fail('gym_order', `areas.${g.id}`, `gym ${i + 1} '${g.id}' needs ${stages.get(g.id)} badges to reach; expected ${i}`, 'gate each gym behind the previous badges, one at a time');
  });
  const league = content.areas.find(a => a.kind === 'league');
  if (league && stages.has(league.id) && stages.get(league.id) < gyms.length) fail('league_open_early', `areas.${league.id}`, `the league is reachable with ${stages.get(league.id)} of ${gyms.length} badges`);

  // Level curve (§5): leader aces L(g) ±3; trainers in an area at stage s target L(s+1) − 4 ±3.
  gyms.forEach((g, i) => {
    const target = levelCurve(i + 1, content) + difficultyOffset(content), got = ace(g.leader.party);
    if (Math.abs(got - target) > 3) fail('level_curve', `areas.${g.id}.leader.party`, `leader ace is level ${got}; gym ${i + 1} targets ${target} ±3`);
  });
  for (const a of content.areas) for (const [j, t] of (a.trainers || []).entries()) {
    if (!stages.has(a.id)) continue;
    const target = levelCurve(stages.get(a.id) + 1, content) - 4 + difficultyOffset(content), got = ace(t.party);
    if (Math.abs(got - target) > 3) fail('level_curve', `areas.${a.id}.trainers[${j}].party`, `trainer ace is level ${got}; this stage targets ${target} ±3`);
  }
  if (content.champion?.party) {
    const target = levelCurve(gyms.length, content) + 6 + difficultyOffset(content), got = ace(content.champion.party);
    if (Math.abs(got - target) > 3) fail('level_curve', 'champion.party', `champion ace is level ${got}; target ${target} ±3`);
  }
  return { ok: !errors.length, errors, warnings, content };
}
