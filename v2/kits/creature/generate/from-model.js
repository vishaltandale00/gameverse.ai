// Expand the model's compact journey (schema.js) into full creature content (CONTRACT.md §1):
// a linear area graph home → route → town + gym → … → finale route → league, badge gates on the
// way out of each gym town, services, and story moments. Levels are left to balance().
import { CONTENT_SCHEMA } from '../content.js';

export const isModelShape = x => !!x && typeof x === 'object' && Array.isArray(x.chapters) && !!x.home;

export const slug = (s, d = 'x') => (String(s ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 60) || d);

function effectOf(e, category) {
  const k = e?.kind || 'none';
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  switch (k) {
    case 'status': return e.status && e.status !== 'none' ? { kind: 'status', status: e.status, chance: n(e.chance, 100) } : null;
    case 'stat': return { kind: 'stat', target: e.target === 'self' ? 'self' : 'foe', stat: e.stat || 'atk', stages: n(e.stages, e.target === 'self' ? 1 : -1), chance: n(e.chance, 100) };
    case 'heal': return { kind: 'heal', fraction: n(e.fraction, 0.5) };
    case 'drain': case 'recoil': return { kind: k, fraction: n(e.fraction, k === 'drain' ? 0.5 : 0.25) };
    case 'multihit': return { kind: 'multihit', min: n(e.hitsMin, 2), max: n(e.hitsMax, 5) };
    case 'protect': return { kind: 'protect' };
    case 'flinch': return { kind: 'flinch', chance: n(e.chance, 30) };
    default: return category === 'status' ? { kind: 'stat', target: 'foe', stat: 'atk', stages: -1, chance: 100 } : null;
  }
}

export function fromModel(m) {
  const used = new Set();
  const uniq = (id, d) => { let base = slug(id, d), out = base, i = 2; while (used.has(out)) out = `${base}-${i++}`; used.add(out); return out; };
  const trainerIds = new Set();
  const trainerOf = t => {
    let id = slug(t.id || `${t.class}-${t.name}`, 'trainer'), i = 2;
    while (trainerIds.has(id)) id = `${slug(t.id, 'trainer')}-${i++}`;
    trainerIds.add(id);
    return { id, name: t.name || 'Trainer', class: t.class || 'Trainer', look: t.look || '', party: (t.party || []).map(p => ({ species: slug(p.species), level: 5 })), prize: 0, intro: t.intro || '', defeat: t.defeat || '' };
  };
  const npcsOf = list => (list || []).map((n, i) => ({ id: uniq(n.id || `npc-${i}`, `npc-${i}`), name: n.name || 'Villager', look: n.look || '', lines: (n.lines || []).filter(Boolean).slice(0, 4) }));

  const content = {
    schema: CONTENT_SCHEMA,
    id: slug(m.title, 'creature-game'), title: m.title || 'Untitled', logline: m.logline || '', artStyle: m.artStyle || '',
    music: m.music, region: m.region, player: m.player, rival: m.rival, mentor: m.mentor,
    types: (m.types || []).map(t => ({ id: slug(t.id), name: t.name || t.id, color: t.color, look: t.look || '' })),
    chart: {},
    moves: (m.moves || []).map(mv => ({
      id: slug(mv.id), name: mv.name || mv.id, type: slug(mv.type), category: mv.category, power: mv.category === 'status' ? 0 : mv.power,
      accuracy: mv.accuracy === 0 ? null : mv.accuracy, pp: mv.pp, priority: mv.priority ?? 0,
      ...(effectOf(mv.effect, mv.category) ? { effect: effectOf(mv.effect, mv.category) } : {}), description: mv.description || '',
    })),
    species: (m.species || []).map(s => ({
      id: slug(s.id), name: s.name || s.id, types: (s.types || []).map(t => slug(t)).slice(0, 2), base: { ...s.base }, growth: s.growth, catchRate: 45, expYield: 64,
      learnset: (s.learnset || []).map(l => ({ level: l.level, move: slug(l.move) })),
      ...(s.evolvesTo && s.evolveLevel ? { evolves: { to: slug(s.evolvesTo), level: s.evolveLevel } } : {}),
      look: s.look || '', dex: s.dex || '',
    })),
    starters: (m.starters || []).map(s => slug(s)),
    items: (m.items || []).map(it => ({ id: slug(it.id), name: it.name || it.id, kind: it.kind, price: it.price, value: it.value, description: it.description || '' })),
    areas: [], story: [],
  };
  for (const c of m.chart || []) {
    const a = slug(c.attacking), d = slug(c.defending), v = Number(c.multiplier);
    if (![0, 0.5, 2].includes(v)) continue;
    (content.chart[a] ??= {})[d] = v;
  }

  const areas = content.areas;
  const home = { id: uniq(m.home.id, 'home'), name: m.home.name || 'Home', kind: 'town', theme: m.home.theme || '', description: m.home.description || '', connects: [], services: ['heal'], npcs: npcsOf(m.home.npcs) };
  areas.push(home);
  let prevTown = home, badges = 0;
  const route = (r, from) => {
    const a = { id: uniq(r.id, 'route'), name: r.name || 'Route', kind: r.kind === 'cave' ? 'cave' : 'route', theme: r.theme || '', description: r.description || '', connects: [{ to: from.id }], encounters: (r.encounters || []).map(e => ({ species: slug(e.species), minLevel: 2, maxLevel: 4, weight: e.weight || 10 })), trainers: (r.trainers || []).map(trainerOf) };
    from.connects.push({ to: a.id, ...(badges ? { gate: { badge: badges } } : {}) });
    areas.push(a);
    return a;
  };
  for (const ch of m.chapters) {
    const r = route(ch.route, prevTown);
    const town = { id: uniq(ch.town.id, 'town'), name: ch.town.name || 'Town', kind: 'town', theme: ch.town.theme || '', description: ch.town.description || '', connects: [{ to: r.id }], services: ['heal', 'mart', 'pc'], mart: [], npcs: npcsOf(ch.town.npcs) };
    r.connects.push({ to: town.id });
    areas.push(town);
    const L = ch.gym.leader || {};
    const gym = {
      id: uniq(ch.gym.id, 'gym'), name: ch.gym.name || `${town.name} Gym`, kind: 'gym', theme: ch.gym.theme || '', description: ch.gym.description || '', connects: [{ to: town.id }],
      trainers: (ch.gym.trainers || []).map(trainerOf),
      leader: { id: (() => { let id = slug(L.id || L.name, 'leader'), i = 2; while (trainerIds.has(id)) id = `${slug(L.id || L.name, 'leader')}-${i++}`; trainerIds.add(id); return id; })(), name: L.name || 'Leader', look: L.look || '', type: slug(L.type), party: (L.party || []).map(p => ({ species: slug(p.species), level: 10 })), badge: { id: slug(`${L.badge || 'badge'}`, 'badge'), name: L.badge || 'Badge' }, intro: L.intro || '', defeat: L.defeat || '' },
    };
    town.connects.push({ to: gym.id });
    areas.push(gym);
    badges++;
    prevTown = town;
  }
  const fr = route(m.finale.route, prevTown);
  const league = { id: uniq(m.finale.league.id, 'league'), name: m.finale.league.name || 'League', kind: 'league', theme: m.finale.league.theme || '', description: m.finale.league.description || '', connects: [{ to: fr.id }], services: ['heal'] };
  fr.connects.push({ to: league.id });
  areas.push(league);
  const champ = m.finale.champion || {};
  content.champion = { name: champ.name || 'Champion', look: champ.look || '', party: (champ.party || []).map(p => ({ species: slug(p.species), level: 30 })), intro: champ.intro || '', defeat: champ.defeat || '' };
  const ids = new Set(areas.map(a => a.id));
  (m.moments || []).forEach((mo, i) => {
    const area = slug(mo.area);
    if (!ids.has(area) || !mo.text) return;
    const flag = `moment-${i}`;
    content.story.push({ id: flag, when: { all: [{ area }, { not: { flag } }] }, then: [{ do: 'say', who: ['mentor', 'rival', 'player'].includes(mo.who) ? mo.who : 'mentor', text: mo.text }, { do: 'set_flag', flag }] });
  });
  return content;
}
