// gameplay.wanted: crime heat and law response (GTA-style stars) for any space.
// Crimes add heat when a witness sees them (law sees instantly; civilians
// report after a delay unless silenced), stars escalate a response table that
// spawns law units (and vehicles/roadblocks) out of sight, heat decays while
// the player is unseen, hiding long enough (or in a safe zone) clears it, and
// bribes or arrests end it. Law units are ordinary ai.brain agents made
// hostile to the player through the brain's faction service.
import { objectParam, v3, add, sub, mul, len, norm, r6, round6, spaceOf, can, continuous, distBetween, sees, randomPoint, onEvents, dead, upAt, planar } from './ai-lib.js';
import { hostile } from './ai-brain.js';
import { roadGraph } from './ai-lib-roads.js';

const ID = 'gameplay.wanted';
const st = rt => rt.store(ID);
const n = (d, extra = {}) => ({ type: 'number', default: d, ...extra });

export default {
  id: ID,
  card: {
    loop: { shows: [], verbs: [], progress: ['crime', 'escaped'], lose: { param: 'onBusted', says: "Don't get busted", label: 'Wanted', reads: { var: 'wanted', by: { effects: ['surrender'], movement: true } } } },
    intent: 'Wanted level: crimes add heat when witnessed (law instantly, civilians after a report delay), stars escalate a law response that spawns units/vehicles/roadblocks out of sight and hunts the player, heat decays unseen, hiding or safe zones clear it, bribes and arrests end it.',
    views: ['any'],
    params: {
      levels: { type: 'integer', default: 5, min: 1, max: 6, effect: 'max stars' },
      crimes: { type: 'object', default: {}, values: { type: 'number', min: 0, effect: 'heat (1 = one star)' }, effect: 'crime kind → heat (1 = one star)' },
      crimeEvents: { type: 'list', default: [], of: { type: 'object', fields: { event: { type: 'string', required: true }, kind: { type: 'string', required: true }, byPlayer: { type: 'boolean', default: true }, when: { type: 'predicate' } } }, effect: 'events that count as crimes (defeated → murder...)' },
      witnessRange: n(30, { min: 0, effect: 'how far witnesses see crimes' }),
      reportSec: n(2, { min: 0, unit: 's', effect: 'civilian delay before a report reaches the law (kill the witness to stop it)' }),
      lawFaction: { type: 'string', default: 'law', effect: 'faction of response units (and law-kind archetypes)' },
      decayPerSec: n(0.05, { min: 0, effect: 'sub-star heat lost per second while unseen (petty crime fades)' }),
      starDecaySec: n(0, { min: 0, unit: 's', effect: 'unseen this long drops one star (0 = stars only clear by hiding)' }),
      hideSec: n(20, { min: 0, unit: 's', effect: 'unseen this long clears the wanted level' }),
      response: { type: 'list', default: [], of: { type: 'object', fields: {
        level: { type: 'integer', required: true, min: 1, max: 6 }, archetype: { type: 'ref', to: 'archetype', required: true },
        count: { type: 'integer', default: 2, min: 0, max: 64 }, vehicle: { type: 'ref', to: 'archetype' }, roadblock: { type: 'boolean', default: false },
      } } },
      spawnDistance: { type: 'list', default: [25, 45], of: { type: 'number', min: 0 }, min: 2, max: 2, effect: '[min, max] distance from the player for new units' },
      spawnEvery: n(1, { min: 0.05, unit: 's' }), despawnDistance: n(80, { min: 1 }),
      safeZones: { type: 'list', default: [], of: { type: 'ref', to: 'zone' } },
      bribe: { type: 'object', fields: { cost: n(500, { min: 0, effect: 'per star' }), currency: { type: 'string', default: 'gold' } } },
      arrest: objectParam({ type: 'object', fields: { range: n(1.5, { min: 0 }), sec: n(2, { min: 0 }), maxLevel: { type: 'integer', default: 2, min: 0, max: 6 } } }),
      onBusted: { type: 'effects', default: [] }, onEscaped: { type: 'effects', default: [] },
    },
    provides: { vars: ['wanted', 'wanted.heat'], events: ['crime', 'crime:*', 'witness', 'crime_reported', 'wanted_changed', 'busted', 'escaped', 'bribed', 'bribe_failed', 'law_spawned'] },
    requires: { capabilities: ['position', 'distance'], primitives: ['gameplay.ai.brain'] },
    reads: ['content.archetypes'],
    rules: {
      wanted_spawn_distance: { fields: ['spawnDistance'], message: 'spawnDistance is [min, max] with min ≤ max' },
      wanted_crime_unknown: { fields: ['crimeEvents[].kind', 'crimes'], message: 'each crimeEvents kind is a key of crimes (its heat)' },
      wanted_response_level: { fields: ['response[].level', 'levels'], message: 'a response level is at most levels (the max stars)' },
    },
  },
  logic(logic) {
    logic.effect('report_crime', { run: (e, rt, c) => crime(rt, e.kind, { at: e.at, who: rt.resolve(e.who, c)?.id ?? 'player', witnessed: e.witnessed }) });
    logic.effect('set_wanted', { run: (e, rt) => setHeat(rt, e.level) });
    logic.effect('add_wanted', { run: (e, rt) => setHeat(rt, heat(rt) + (e.delta ?? 1)) });
    logic.effect('clear_wanted', { run: (e, rt) => setHeat(rt, 0) });
    logic.effect('bribe', { run: (e, rt) => bribe(rt) });
    logic.effect('surrender', { run: (e, rt) => { if (stars(rt) > 0) busted(rt, 'surrender'); } });
  },
  validate(config, doc) {
    const errors = [];
    if (config.spawnDistance[0] > config.spawnDistance[1]) errors.push({ code: 'wanted_spawn_distance', path: 'spawnDistance', message: 'min above max' });
    config.crimeEvents.forEach((c, i) => { if (!(c.kind in config.crimes)) errors.push({ code: 'wanted_crime_unknown', path: `crimeEvents[${i}].kind`, message: `crime '${c.kind}' has no heat in crimes` }); });
    config.response.forEach((r, i) => { if (r.level > config.levels) errors.push({ code: 'wanted_response_level', path: `response[${i}].level`, message: `level above max stars ${config.levels}` }); });
    return errors;
  },
  install(rt, config) {
    rt.caches.wantedCfg = config;
    rt.on('game_start', (_, rt) => publish(rt));
    onEvents(rt, config.crimeEvents.map(c => c.event), (name, data, rt) => {
      for (const c of config.crimeEvents) {
        if (!(c.event === name || (c.event.endsWith(':*') && name.startsWith(c.event.slice(0, -1))))) continue;
        if (c.byPlayer && (data.by ?? data.who) !== 'player') continue;
        if (c.when && !rt.test(c.when, { self: data.who })) continue;
        const victim = rt.entity(data.who) ?? null;
        crime(rt, c.kind, { at: victim?.at ?? rt.player()?.at, who: 'player', victim: victim?.id });
      }
    });
    rt.system('rules', rt => tick(rt, config), ID);
  },
};

const heat = rt => st(rt).heat ?? 0;
const stars = rt => Math.min(rt.caches.wantedCfg.levels, Math.floor(heat(rt) + 1e-9));
function publish(rt) { rt.state.vars.wanted = stars(rt); rt.state.vars['wanted.heat'] = Math.round(heat(rt) * 1e4) / 1e4; }
const isLaw = (rt, e) => Boolean(e && (e.components.wantedUnit || (rt.hasService('ai.brain') && rt.service('ai.brain').factionOf(e.id) === rt.caches.wantedCfg.lawFaction)));

function setHeat(rt, h) {
  const cfg = rt.caches.wantedCfg, s = st(rt), from = stars(rt);
  s.heat = Math.max(0, Math.min(cfg.levels + 0.999, round6(h)));
  const to = stars(rt);
  if (to > from) { s.hidden = 0; s.starAt = null; }
  publish(rt);
  if (from !== to) {
    rt.emit('wanted_changed', { from, to });
    if (rt.hasService('ai.brain')) rt.service('ai.brain').setHostile(cfg.lawFaction, 'player', to > 0);
    if (to === 0) s.arrestT = 0;
  }
}

/** A crime happened. Law that sees it reacts at once; civilian witnesses report after reportSec. */
function crime(rt, kind, { at, who = 'player', victim, witnessed } = {}) {
  const cfg = rt.caches.wantedCfg, h = cfg.crimes[kind] ?? 0, s = st(rt);
  const p = rt.entity(who) || rt.player(); if (!p) return;
  rt.emitTyped('crime', kind, { kind, who: p.id, victim: victim ?? null });
  if (witnessed === true) { setHeat(rt, heat(rt) + h); rt.emit('crime_reported', { kind, by: null }); return; }
  if (witnessed === false) return;
  const spot = { ...p, at: at ?? p.at, components: p.components };
  const ws = Object.values(rt.state.entities).filter(o => o.id !== p.id && o.id !== victim && o.components.ai && o.space === p.space && !dead(o) && (isLaw(rt, o) || !hostile(rt, o, p)))
    .filter(o => sees(rt, o, spot, { range: Math.min(cfg.witnessRange, o.components.ai.perception?.sight ?? cfg.witnessRange), fov: o.components.ai.perception?.fov ?? 360 }))
    .sort((a, b) => distBetween(rt, a, spot) - distBetween(rt, b, spot) || (a.id < b.id ? -1 : 1));
  const law = ws.find(o => isLaw(rt, o));
  if (law) { setHeat(rt, heat(rt) + h); rt.emit('crime_reported', { kind, by: law.id }); if (rt.hasService('ai.brain')) rt.service('ai.brain').remember(law.id, p.id); return; }
  if (!ws.length) return;
  rt.emit('witness', { who: ws[0].id, kind, crime: kind });
  (s.reports ??= []).push({ kind, by: ws[0].id, at: round6(rt.state.time + cfg.reportSec), heat: h });
}

function tick(rt, cfg) {
  const s = st(rt), now = rt.state.time, p = rt.player(); if (!p) return;
  // Reports land unless the witness was silenced first.
  if (s.reports?.length) {
    const keep = [];
    for (const r of s.reports) {
      if (now < r.at) { keep.push(r); continue; }
      const w = rt.entity(r.by);
      if (w && !dead(w)) { setHeat(rt, heat(rt) + r.heat); rt.emit('crime_reported', { kind: r.kind, by: r.by }); }
    }
    s.reports = keep;
  }
  const level = stars(rt);
  const units = Object.values(rt.state.entities).filter(e => e.components.wantedUnit);
  if (level === 0) {
    if (heat(rt) > 0) { st(rt).heat = round6(Math.max(0, heat(rt) - cfg.decayPerSec * rt.dt)); publish(rt); }
    // Stand down: units leave once they are far from the player.
    for (const u of units) if (u.space !== p.space || distBetween(rt, u, p) > cfg.despawnDistance * 0.5) rt.despawn(u.id);
    return;
  }
  // Seen by any law unit (or law-faction agent)?
  const safe = cfg.safeZones.some(z => rt.space(p.space).inZone?.(p, z, rt));
  const seen = !safe && Object.values(rt.state.entities).some(o => isLaw(rt, o) && !dead(o) && o.space === p.space && (rt.hasService('ai.brain') ? rt.service('ai.brain').agent(o.id)?.mem?.[p.id]?.seen : false));
  if (seen) s.hidden = 0;
  else {
    const k = safe ? 4 : 1;
    s.hidden = round6((s.hidden ?? 0) + rt.dt * k);
    // Sub-star heat burns off; whole stars drop one per starDecaySec unseen; hideSec unseen clears everything.
    const whole = Math.floor(heat(rt) + 1e-9);
    s.heat = round6(Math.max(whole, heat(rt) - cfg.decayPerSec * rt.dt * k));
    if (s.hidden >= cfg.hideSec) { setHeat(rt, 0); rt.emit('escaped', { level }); rt.run(cfg.onEscaped); return; }
    if (cfg.starDecaySec > 0 && s.hidden >= (s.starAt ?? cfg.starDecaySec)) { s.starAt = round6(s.hidden + cfg.starDecaySec); setHeat(rt, whole - 1); if (stars(rt) === 0) { rt.emit('escaped', { level }); rt.run(cfg.onEscaped); return; } s.hidden = s.starAt - cfg.starDecaySec; }
    publish(rt);
  }
  if (seen) s.starAt = null;
  // Response: keep the units the current star level calls for.
  const want = cfg.response.filter(r => r.level <= stars(rt)).sort((a, b) => b.level - a.level)[0];
  if (want && now >= (s.nextSpawn ?? 0)) {
    const have = units.filter(u => u.archetype === want.archetype && !dead(u)).length;
    if (have < want.count) { spawnUnit(rt, cfg, p, want); s.nextSpawn = round6(now + cfg.spawnEvery); }
  }
  for (const u of units) if (u.space !== p.space || distBetween(rt, u, p) > cfg.despawnDistance) rt.despawn(u.id);
  // Arrest: a unit stays close while the level is low.
  const near = units.some(u => !dead(u) && !u.components.vehicleUnit && u.space === p.space && distBetween(rt, u, p) <= cfg.arrest.range);
  if (near && stars(rt) <= cfg.arrest.maxLevel) { s.arrestT = round6((s.arrestT ?? 0) + rt.dt); if (s.arrestT >= cfg.arrest.sec) busted(rt, 'arrest'); }
  else s.arrestT = 0;
}

function spawnPoint(rt, cfg, p) {
  const api = spaceOf(rt, p); if (!api || !continuous(p)) return p.at;
  const [lo, hi] = cfg.spawnDistance;
  for (let k = 0; k < 8; k++) {
    const r = lo + rt.random() * (hi - lo), q = randomPoint(rt, api, p.at, 1, 'auto'), dir = norm(sub(q, p.at));
    const at = r6(add(p.at, mul(len(dir) > 0 ? dir : [1, 0, 0], r)));
    if (can(api, 'getCell') && api.getCell(at)) continue;
    if (can(api, 'path') && !api.path(at, p.at)) continue;
    return at;
  }
  return null;
}
function spawnUnit(rt, cfg, p, want) {
  const at = spawnPoint(rt, cfg, p); if (!at) return;
  const base = rt.archetype(want.archetype)?.components || {};
  const ai = base.ai ? { ...structuredClone(base.ai), faction: cfg.lawFaction } : undefined;
  const u = rt.spawn(want.archetype, { space: p.space, at, components: { wantedUnit: true, ...(ai ? { ai } : {}) } });
  if (rt.hasService('ai.brain')) rt.service('ai.brain').remember(u.id, p.id);
  rt.emit('law_spawned', { who: u.id, archetype: want.archetype, level: want.level });
  if (want.vehicle && rt.archetype(want.vehicle)) {
    const api = spaceOf(rt, u), vAt = continuous(u) ? r6(add(u.at, planar(api, u.at, [2, 0, 2]))) : u.at;
    const v = rt.spawn(want.vehicle, { space: p.space, at: vAt, components: { wantedUnit: true, vehicleUnit: true } });
    rt.emit('law_spawned', { who: v.id, archetype: want.vehicle, level: want.level, vehicle: true });
  }
  if (want.roadblock && want.vehicle && rt.hasService('roadgraph') && continuous(p)) {
    const G = roadGraph(rt, { spaceId: p.space }), nodes = G ? [...G.nodes.values()] : [];
    const ahead = nodes.map(nd => [nd, len(sub(nd.at, p.at))]).filter(([, d]) => d >= cfg.spawnDistance[0] && d <= cfg.spawnDistance[1]).sort((a, b) => a[1] - b[1] || (a[0].id < b[0].id ? -1 : 1))[0];
    if (ahead && !(st(rt).roadblocks ?? {})[ahead[0].id]) {
      (st(rt).roadblocks ??= {})[ahead[0].id] = true;
      const v = rt.spawn(want.vehicle, { space: p.space, at: r6(v3(ahead[0].at)), components: { wantedUnit: true, vehicleUnit: true, roadblock: true } });
      rt.emit('law_spawned', { who: v.id, archetype: want.vehicle, level: want.level, roadblock: true });
    }
  }
}
function busted(rt, how) {
  const cfg = rt.caches.wantedCfg, level = stars(rt);
  setHeat(rt, 0); st(rt).reports = []; st(rt).roadblocks = {};
  rt.emit('busted', { level, how });
  rt.run(cfg.onBusted);
}
function bribe(rt) {
  const cfg = rt.caches.wantedCfg, level = stars(rt);
  if (!level) return;
  if (!cfg.bribe) { rt.emit('bribe_failed', { reason: 'no_bribes' }); return; }
  const cost = cfg.bribe.cost * level, money = rt.state.vars[`money.${cfg.bribe.currency}`] ?? 0;
  if (money < cost) { rt.emit('bribe_failed', { reason: 'funds', cost }); return; }
  if (!rt.canRun('take_money')) { rt.emit('bribe_failed', { reason: 'no_economy', cost }); return; }
  rt.run([{ do: 'take_money', amount: cost, currency: cfg.bribe.currency }]);
  setHeat(rt, 0); st(rt).reports = [];
  rt.emit('bribed', { cost, level });
}
