// balance(content) (CONTRACT.md §5): repair and tune generated content so it validates and plays
// fairly. Clamps every range the strict schema can't express; scales base-stat totals per
// evolution stage; sets catch rates and experience yields by stage; orders evolution levels;
// fills thin learnsets; makes every type weak to and resisted by something and closes the
// starter triangle; puts wild, trainer, leader and champion levels on the level curve; and stocks
// marts by progress. Returns { content, fixes } where fixes lists what changed.
import { STATUSES, STAGE_STATS, STATS, GROWTHS, ITEM_KINDS, areaStages, gymOrder, levelCurve } from '../content.js';
import { seedFrom } from '../../../kernel/rng.js';

const clamp = (v, lo, hi, d = lo) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
const clampF = (v, lo, hi, d = lo) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
// Base-stat totals by stage and line length (a two-stage line ends a little lower than a three-stage one).
const BST = { base: [290, 330], middle: [400, 440], final: [500, 540], final2: [460, 500], single: [380, 440] };
const DEFAULT_ITEMS = [
  { id: 'capture-ball', name: 'Capture Ball', kind: 'ball', price: 200, value: 1, description: 'Catches wild creatures.' },
  { id: 'potion', name: 'Potion', kind: 'heal', price: 300, value: 20, description: 'Restores 20 HP.' },
];

export function balance(input) {
  const c = structuredClone(input), fixes = [];
  const fix = (code, path, note) => fixes.push({ code, path, note });
  const h = s => seedFrom(String(s));

  // ---- types and chart
  c.types = (c.types || []).filter((t, i, all) => t?.id && all.findIndex(x => x.id === t.id) === i);
  const typeIds = c.types.map(t => t.id);
  for (const t of c.types) if (!/^#[0-9a-f]{6}$/i.test(t.color || '')) { t.color = ['#a8a878', '#58b858', '#e86830', '#4890e8', '#a08858', '#a0a8f0', '#f0d030', '#a040a0'][h(t.id) % 8]; fix('type_color', `types.${t.id}`); }
  c.chart ??= {};
  for (const a of Object.keys(c.chart)) { if (!typeIds.includes(a)) { delete c.chart[a]; continue; } for (const d of Object.keys(c.chart[a])) if (!typeIds.includes(d) || ![0, 0.5, 2].includes(c.chart[a][d])) delete c.chart[a][d]; }
  const mult = (a, d) => c.chart[a]?.[d] ?? 1;
  const set = (a, d, v, why) => { (c.chart[a] ??= {})[d] = v; fix('chart', `chart.${a}.${d}`, why); };
  // Starter triangle: starter i's first type beats starter i+1's.
  const species0 = new Map((c.species || []).map(s => [s.id, s]));
  const st = (c.starters || []).map(id => species0.get(id)?.types?.[0]).filter(Boolean);
  if (st.length === 3 && new Set(st).size === 3) {
    const cyc = (x, y, z) => mult(x, y) > 1 && mult(y, z) > 1 && mult(z, x) > 1;
    if (!cyc(st[0], st[1], st[2]) && !cyc(st[1], st[0], st[2]) && !cyc(st[0], st[2], st[1])) {
      for (let i = 0; i < 3; i++) { set(st[i], st[(i + 1) % 3], 2, 'starter triangle'); if (mult(st[(i + 1) % 3], st[i]) > 1) set(st[(i + 1) % 3], st[i], 0.5, 'starter triangle'); }
    }
  }
  for (const t of typeIds) {
    if (!typeIds.some(a => mult(a, t) > 1)) { const a = typeIds.find(x => x !== t && mult(x, t) === 1) || typeIds.find(x => x !== t); if (a) set(a, t, 2, 'every type needs a weakness'); }
    if (!typeIds.some(a => mult(a, t) < 1)) { if (mult(t, t) === 1) set(t, t, 0.5, 'every type needs a resistance'); else { const a = typeIds.find(x => x !== t && mult(x, t) === 1); if (a) set(a, t, 0.5, 'every type needs a resistance'); } }
  }
  const neutral = typeIds.find(t => !Object.values(c.chart[t] || {}).some(v => v > 1)) || null;

  // ---- moves
  c.moves = (c.moves || []).filter((m, i, all) => m?.id && all.findIndex(x => x.id === m.id) === i);
  for (const m of c.moves) {
    if (!typeIds.includes(m.type)) { m.type = neutral || typeIds[0]; fix('move_type', `moves.${m.id}`); }
    if (!['physical', 'special', 'status'].includes(m.category)) m.category = m.power > 0 ? 'physical' : 'status';
    if (m.category === 'status') m.power = 0;
    else m.power = clamp(m.power, 20, 150, 40);
    if (m.accuracy !== null) m.accuracy = m.accuracy === undefined ? 100 : clamp(m.accuracy, 30, 100, 100);
    m.pp = clamp(m.pp, 5, 40, 20); m.priority = clamp(m.priority, -3, 3, 0);
    const e = m.effect;
    if (e) {
      if (e.kind === 'status') { if (!STATUSES.includes(e.status)) e.status = 'paralysis'; e.chance = clamp(e.chance, 1, 100, 100); }
      else if (e.kind === 'stat') { if (!STAGE_STATS.includes(e.stat)) e.stat = 'atk'; if (!['self', 'foe'].includes(e.target)) e.target = 'foe'; e.stages = clamp(e.stages, -2, 2, e.target === 'self' ? 1 : -1) || (e.target === 'self' ? 1 : -1); e.chance = clamp(e.chance, 1, 100, 100); }
      else if (e.kind === 'heal') e.fraction = clampF(e.fraction, 0.25, 1, 0.5);
      else if (e.kind === 'drain' || e.kind === 'recoil') e.fraction = clampF(e.fraction, 0.05, 1, 0.25);
      else if (e.kind === 'multihit') { e.min = clamp(e.min, 2, 5, 2); e.max = clamp(e.max, e.min, 5, 5); }
      else if (e.kind === 'flinch') e.chance = clamp(e.chance, 1, 100, 30);
      else if (e.kind !== 'protect') delete m.effect;
    }
    if (m.category === 'status' && !m.effect) m.effect = { kind: 'stat', target: 'foe', stat: 'atk', stages: -1, chance: 100 };
  }
  const moveIds = new Set(c.moves.map(m => m.id));
  const movesOfType = (t, dmg = true) => c.moves.filter(m => m.type === t && (dmg ? m.power > 0 : true)).sort((a, b) => a.power - b.power);
  if (!c.moves.some(m => m.power > 0)) { c.moves.push({ id: 'tackle', name: 'Tackle', type: neutral || typeIds[0], category: 'physical', power: 40, accuracy: 100, pp: 35, priority: 0, description: 'A full-body charge.' }); moveIds.add('tackle'); fix('move_added', 'moves.tackle'); }

  // ---- species: references, evolution lines, stages
  c.species = (c.species || []).filter((s, i, all) => s?.id && all.findIndex(x => x.id === s.id) === i);
  const sp = new Map(c.species.map(s => [s.id, s]));
  for (const s of c.species) {
    s.types = (s.types || []).filter(t => typeIds.includes(t)).filter((t, i, a) => a.indexOf(t) === i).slice(0, 2);
    if (!s.types.length) { s.types = [neutral || typeIds[0]]; fix('species_type', `species.${s.id}`); }
    if (!GROWTHS.includes(s.growth)) s.growth = 'medium';
    if (s.evolves && (!sp.has(s.evolves.to) || s.evolves.to === s.id)) { delete s.evolves; fix('evolution_ref', `species.${s.id}`); }
  }
  // One parent per child; no cycles.
  const parent = new Map();
  for (const s of c.species) if (s.evolves) { if (parent.has(s.evolves.to)) { delete s.evolves; continue; } parent.set(s.evolves.to, s.id); }
  for (const s of c.species) { const seen = new Set([s.id]); let cur = s; while (cur?.evolves) { if (seen.has(cur.evolves.to)) { parent.delete(cur.evolves.to); delete cur.evolves; fix('evolution_cycle', `species.${cur.id}`); break; } seen.add(cur.evolves.to); cur = sp.get(cur.evolves.to); } }
  const root = id => { let cur = id; for (let i = 0; i < 4 && parent.has(cur); i++) cur = parent.get(cur); return cur; };
  const depth = id => { let n = 0, cur = id; while (parent.has(cur) && n < 4) { cur = parent.get(cur); n++; } return n; };
  const lineLen = id => { let n = 1, cur = sp.get(root(id)); while (cur?.evolves && n < 5) { cur = sp.get(cur.evolves.to); n++; } return n; };
  const stageOf = id => { const d = depth(id), n = lineLen(id); return n === 1 ? 'single' : d === 0 ? 'base' : d === n - 1 ? (n === 2 ? 'final2' : 'final') : 'middle'; };
  // Evolution levels increase along a line, within sensible bands.
  for (const s of c.species) {
    if (!s.evolves) continue;
    const d = depth(s.id);
    const lo = d === 0 ? 10 : 24, hi = d === 0 ? 30 : 50;
    const prev = parent.has(s.id) ? sp.get(parent.get(s.id)).evolves.level : 0;
    const lv = clamp(s.evolves.level, Math.max(lo, prev + 6), Math.max(hi, prev + 6), d === 0 ? 16 : 32);
    if (lv !== s.evolves.level) { s.evolves.level = lv; fix('evolution_level', `species.${s.id}.evolves.level`); }
  }
  const starterIds = new Set((c.starters || []).map(root));
  for (const s of c.species) {
    const stage = stageOf(s.id), [lo, hi] = BST[stage];
    const target = lo + (h(s.id) % (hi - lo + 1));
    const raw = STATS.map(k => Math.max(1, Number(s.base?.[k]) || 50));
    const total = raw.reduce((a, b) => a + b, 0);
    s.base = Object.fromEntries(STATS.map((k, i) => [k, clamp(raw[i] * target / total, 20, 160)]));
    const starterLine = starterIds.has(root(s.id));
    s.catchRate = starterLine ? 45 : { base: 190, single: 120, middle: 90, final2: 60, final: 45 }[stage];
    s.expYield = { base: 60, single: 120, middle: 140, final2: 170, final: 200 }[stage] + (h(s.id) % 9);
    // Learnsets: known moves only, two level-1 moves including an attack, room to grow.
    s.learnset = (s.learnset || []).filter(l => moveIds.has(l.move)).map(l => ({ level: clamp(l.level, 1, 100, 1), move: l.move }));
    const knows = id => s.learnset.some(l => l.move === id);
    const own = s.types.flatMap(t => movesOfType(t));
    const basic = (own[0] || (neutral && movesOfType(neutral)[0]) || c.moves.filter(m => m.power > 0).sort((a, b) => a.power - b.power)[0]);
    const early = s.learnset.filter(l => l.level <= 5).map(l => c.moves.find(m => m.id === l.move));
    if (!early.some(m => m.power > 0 && (s.types.includes(m.type) || m.type === neutral))) { if (!knows(basic.id)) s.learnset.unshift({ level: 1, move: basic.id }); else s.learnset.find(l => l.move === basic.id).level = 1; fix('learnset_attack', `species.${s.id}`); }
    if (s.learnset.filter(l => l.level === 1).length < 2 && s.learnset.filter(l => l.level <= 5).length < 2) {
      const extra = c.moves.find(m => m.category === 'status' && !knows(m.id)) || c.moves.find(m => !knows(m.id));
      if (extra) s.learnset.push({ level: 1, move: extra.id });
      fix('learnset_sparse', `species.${s.id}`);
    }
    const strong = own[own.length - 1];
    if (s.learnset.length < 4 && strong && !knows(strong.id)) s.learnset.push({ level: s.evolves ? s.evolves.level + 4 : 20 + (h(s.id) % 8), move: strong.id });
    s.learnset.sort((a, b) => a.level - b.level);
  }
  // Starters are base forms.
  c.starters = (c.starters || []).map(root).filter(id => sp.has(id));

  // ---- items
  c.items = (c.items || []).filter((it, i, all) => it?.id && all.findIndex(x => x.id === it.id) === i && ITEM_KINDS.includes(it.kind));
  for (const d of DEFAULT_ITEMS) if (!c.items.some(i => i.kind === d.kind)) { c.items.push({ ...d }); fix('item_added', `items.${d.id}`); }
  for (const it of c.items) {
    it.price = clamp(it.price, 0, 99999, 200);
    if (it.kind === 'ball') it.value = clampF(it.value, 1, 2.5, 1);
    if (it.kind === 'heal') it.value = it.value <= 1 ? clampF(it.value, 0.25, 1, 0.5) : clamp(it.value, 10, 999, 20);
    if (it.kind === 'revive') it.value = clampF(it.value, 0.25, 1, 0.5);
    if (it.kind === 'repel') it.value = clamp(it.value, 50, 250, 100);
  }

  // ---- levels on the curve
  const evolvedAt = (id, level) => { let cur = root(id); for (let i = 0; i < 4; i++) { const s = sp.get(cur); if (s?.evolves && level >= s.evolves.level) cur = s.evolves.to; else break; } return cur; };
  const wildPool = c.species.filter(s => !starterIds.has(root(s.id))).map(s => s.id);
  const valid = id => sp.has(id) ? id : null;
  const party = (list, ace, spread = 2) => {
    const out = (list || []).map(m => valid(m.species)).filter(Boolean).slice(0, 6);
    if (!out.length) out.push(wildPool[0] || c.species[0].id);
    return out.map((id, i) => { const lv = i === out.length - 1 ? ace : Math.max(2, ace - spread - ((out.length - 2 - i) % 2)); return { species: evolvedAt(id, lv), level: lv }; });
  };
  const stages = areaStages(c);
  for (const a of c.areas || []) {
    if (!stages.has(a.id)) continue;
    const g = stages.get(a.id) + 1, L = levelCurve(g);
    if (a.kind === 'route' || a.kind === 'cave') {
      const [lo, hi] = g === 1 ? [2, 5] : [L - 6, L - 3];
      a.encounters = (a.encounters || []).map(e => ({ ...e, species: valid(e.species) })).filter(e => e.species);
      if (!a.encounters.length) a.encounters = wildPool.slice(0, 2).map(id => ({ species: id, weight: 50 }));
      a.encounters = a.encounters.map(e => ({ species: evolvedAt(e.species, hi), minLevel: lo, maxLevel: hi, weight: clamp(e.weight, 1, 100, 20) }));
    }
    for (const t of a.trainers || []) { t.party = party(t.party, a.kind === 'gym' ? L - 3 : L - 4, 1); t.prize = t.prize || Math.max(...t.party.map(m => m.level)) * 40; }
    if (a.leader) a.leader.party = party(a.leader.party, L, 2);
  }
  const G = gymOrder(c).length;
  if (c.champion) c.champion.party = party(c.champion.party, levelCurve(G) + 6, 2);

  // ---- marts by progress
  const byPrice = kind => c.items.filter(i => i.kind === kind).sort((a, b) => a.price - b.price);
  for (const a of c.areas || []) {
    if (a.kind !== 'town' || !a.services?.includes('mart')) continue;
    const s = stages.get(a.id) || 0;
    const pick = (kind, n) => byPrice(kind).slice(0, n).map(i => i.id);
    a.mart = [...pick('ball', s >= 1 ? 2 : 1), ...pick('heal', s >= 1 ? 2 : 1), ...pick('status', 1), ...(s >= 1 ? pick('revive', 1) : []), ...pick('repel', 1)];
  }
  return { content: c, fixes };
}
