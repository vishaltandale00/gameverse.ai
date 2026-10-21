// Content contracts: what a primitive needs in the document to be meaningful, read from the cards.
// A combat primitive with nothing to fight, a race with no racers or a dialogue runner with no lines
// all preflight, boot and even "complete", yet the game is hollow. Each card may declare
//
//   card.content = [
//     { need: 'archetypes', component: 'health', kinds?: [...], min: 2, placed?: n, zones?: n, why, example },
//     { need: 'section', at: 'plot.quests', min: 1, why, example },
//     { need: 'param', param: 'racers', min: 3, why, example },
//     { need: 'items', min: 2, why, example },
//   ]
//
//   archetypes  non-player archetypes carrying `component` (and of `kinds` when given): at least `min`
//               defined, `placed` instances put in the world (spawn rules, spawn effects, characters, any
//               param or generator naming them) across at least `zones` zones (capped by the zone count);
//   section     a plot/content section with at least `min` entries;
//   param       the primitive's own instance param (a list) with at least `min` entries;
//   items       content.items with at least `min` entries.
//
// Cards without a declaration get derived contracts: every plot/content section they read that the
// skeleton does not provide, and their engagement participants. Nothing here names a primitive.
//
// populateProblems(doc) lists what is missing as repair problems with the exact shape to add (the card's
// example); placeContent(doc) deterministically places archetypes that exist but nothing puts in the world.
import { placements, spawnRules, spawnEffects } from './census.js';
import { spawnerId } from './engage.js';

export const CONTENT_VERSION = 'content/0.1';
const isObj = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const at = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const size = v => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0);
// Sections the procedural skeleton always writes, and catalogue-wide ones a reader never needs filled.
// Sections the kernel itself consumes (spawning, characters, the story runner's own data): never "unread".
const KERNEL_SECTIONS = new Set(['content.archetypes', 'content.models', 'plot.characters', 'plot.storyboard', 'plot.endings']);
const SKELETON = new Set(['plot.characters', 'plot.storyboard', 'plot.endings', 'content.items', 'content.archetypes', 'content.models', 'content.blocks']);

/** Contracts of one primitive: declared, else derived. Each gets { use, key }. */
export function contractsOf(registry, id) {
  const card = registry.get(id)?.card; if (!card) return [];
  let list = Array.isArray(card.content) ? card.content : null;
  if (!list) {
    list = [];
    // Plot sections a gameplay/plot primitive runs on (quests, dialogue, clues...); content sections are often
    // optional overrides (prefabs, tables), so content needs are declared by the card itself.
    if (/^(gameplay|plot)\./.test(id)) for (const r of card.reads || []) if (typeof r === 'string' && !SKELETON.has(r) && /^plot\./.test(r)) list.push({ need: 'section', at: r, min: 1, why: `${id} reads ${r}` });
    const part = card.engage?.participants?.param;
    if (part) list.push({ need: 'param', param: part, min: 2, why: `${id} needs participants besides the player` });
  }
  return list.map((c, i) => ({ ...c, use: id, key: `${id}#${c.need}:${c.component || c.at || c.param || i}` }));
}

/** Contracts of every primitive a document (or a selection) uses, deduplicated by what they ask for. */
export function contractsFor(registry, ids) {
  const out = [], seen = new Map();
  for (const id of [...new Set(ids)]) for (const c of contractsOf(registry, id)) {
    const k = `${c.need}|${c.component || ''}|${(c.kinds || []).join(',')}|${c.at || ''}|${c.need === 'param' ? c.use + '.' + c.param : ''}`;
    const prev = seen.get(k);
    if (prev) { prev.min = Math.max(prev.min || 0, c.min || 0); prev.placed = Math.max(prev.placed || 0, c.placed || 0) || undefined; prev.zones = Math.max(prev.zones || 0, c.zones || 0) || undefined; prev.uses.push(id); continue; }
    const entry = { ...c, uses: [id] }; seen.set(k, entry); out.push(entry);
  }
  return out;
}

const usedIds = doc => [...(doc.spaces || []).flatMap(s => [s.use, ...(s.generators || []).map(g => g.use)]), ...(doc.systems || []).map(s => s.use)].filter(Boolean);
const zoneIds = doc => (doc.spaces || []).flatMap(s => (s.zones || []).map(z => z.id));

/** archetype id -> { count, zones:Set } of placed instances (spawn rules count their max, others count one). */
export function placementCounts(doc, registry) {
  const out = new Map();
  const add = (id, n, zone) => { const e = out.get(id) || out.set(id, { count: 0, zones: new Set() }).get(id); e.count += n; if (zone) e.zones.add(zone); };
  const covered = new Set();
  for (const r of spawnRules(doc, registry)) if (typeof r.archetype === 'string') { add(r.archetype, r.unique ? 1 : Math.max(1, (Array.isArray(r.count) ? r.count[r.count.length - 1] : r.count) || 1), r.zone); covered.add(`${r._path}.archetype`); }
  for (const e of spawnEffects(doc)) { add(e.archetype, Math.max(1, e.count || 1), e.zone); covered.add(`${e._path}.archetype`.replace(/^\./, '')); }
  for (const c of doc.plot?.characters || []) if (typeof c?.archetype === 'string') add(c.archetype, 1, c.home);
  for (const [id, paths] of placements(doc)) for (const p of paths) {
    if (covered.has(p) || covered.has(p.replace(/^\./, '')) || /^plot\.characters\[\d+\]\.archetype$/.test(p)) continue;
    add(id, 1, null);
  }
  return out;
}

const archetypesWith = (doc, c) => (doc.content?.archetypes || []).filter(a => a?.id && a.id !== doc.player?.archetype && a.kind !== 'player'
  && (!c.component || (isObj(a.components) && a.components[c.component] !== undefined)) && (!c.kinds?.length || !a.kind || c.kinds.includes(a.kind)));

const shape = example => (example === undefined ? '' : ` Shape: ${JSON.stringify(example).slice(0, 600)}`);

/**
 * What the document's primitives need and do not have. -> [{ code, path, message, hint, severity, contract, missing }]
 * Problems use stable codes: content_missing (nothing there), content_unplaced (defined, not in the world),
 * content_spread (placed in too few zones), content_thin (fewer than the minimum).
 */
export function populateProblems(doc, registry, { contracts = null } = {}) {
  const list = contracts || contractsFor(registry, usedIds(doc));
  const counts = placementCounts(doc, registry), zones = zoneIds(doc), problems = [];
  const push = (code, path, c, message, missing) => problems.push({ code, path, message, hint: `${c.why ? c.why + '.' : ''}${shape(c.example)}`, severity: 'error', contract: c.key, uses: c.uses, missing });
  for (const c of list) {
    if (c.need === 'archetypes') {
      const have = archetypesWith(doc, c);
      const what = `archetypes with a "${c.component}" component${c.kinds?.length ? ` (kind ${c.kinds.join('|')})` : ''}`;
      if (have.length < (c.min || 1)) { push(have.length ? 'content_thin' : 'content_missing', 'content.archetypes', c, `${c.uses.join(', ')} need${c.uses.length > 1 ? '' : 's'} at least ${c.min || 1} ${what}; the document has ${have.length}`, { kind: 'archetypes', count: (c.min || 1) - have.length }); continue; }
      if (!c.placed) continue;
      let total = 0, unknown = 0; const where = new Set();
      for (const a of have) { const p = counts.get(a.id); if (p) { total += p.count; p.zones.forEach(z => where.add(z)); if (!p.zones.size) unknown += p.count; } }
      if (total < c.placed) push(total ? 'content_thin' : 'content_unplaced', 'systems', c, `${have.map(a => a.id).join(', ')} ${have.length > 1 ? 'are' : 'is'} defined but only ${total} of at least ${c.placed} are placed in the world: add spawn rules (archetype, zone, count) in the zones where they belong`, { kind: 'placed', count: c.placed - total, archetypes: have.map(a => a.id) });
      // Spread is judged only on placements whose zone is known (a generator feature or a param may place them anywhere).
      else if (c.zones && zones.length > 1 && unknown < c.placed && where.size < Math.min(c.zones, zones.length)) push('content_spread', 'systems', c, `${what} are placed in ${where.size} zone(s); spread them over at least ${Math.min(c.zones, zones.length)} zones so each place has its own`, { kind: 'spread', zones: Math.min(c.zones, zones.length) - where.size, archetypes: have.map(a => a.id) });
    } else if (c.need === 'section') {
      const n = size(at(doc, c.at));
      if (n < (c.min || 1)) push(n ? 'content_thin' : 'content_missing', c.at, c, `${c.uses.join(', ')} read${c.uses.length > 1 ? '' : 's'} ${c.at}, which has ${n} entr${n === 1 ? 'y' : 'ies'}; write at least ${c.min || 1}`, { kind: 'section', at: c.at, count: (c.min || 1) - n });
    } else if (c.need === 'param') {
      (doc.systems || []).forEach((s, i) => {
        if (s.use !== c.use) return;
        const v = s.with?.[c.param], n = Array.isArray(v) ? v.length : v ? 1 : 0;
        if (n < (c.min || 1)) push(n ? 'content_thin' : 'content_missing', `systems[${i}].with.${c.param}`, c, `${c.use} ${c.param} has ${n} entr${n === 1 ? 'y' : 'ies'}; it needs at least ${c.min || 1}`, { kind: 'param', use: c.use, param: c.param, count: (c.min || 1) - n });
      });
    } else if (c.need === 'items') {
      const n = (doc.content?.items || []).length;
      if (n < (c.min || 1)) push(n ? 'content_thin' : 'content_missing', 'content.items', c, `${c.uses.join(', ')} need${c.uses.length > 1 ? '' : 's'} at least ${c.min || 1} items in content.items; the document has ${n}`, { kind: 'items', count: (c.min || 1) - n });
    }
  }
  return problems;
}

/** Primitive ids whose sections hold data nothing installed reads (quests with no quest runner...): readers to add. */
export function unreadReaders(doc, registry) {
  const used = new Set(usedIds(doc)), reads = new Set();
  for (const id of used) for (const r of registry.get(id)?.card.reads || []) if (typeof r === 'string') reads.add(r);
  const out = [];
  for (const [root, obj] of [['plot', doc.plot], ['content', doc.content]]) for (const [k, v] of Object.entries(isObj(obj) ? obj : {})) {
    const key = `${root}.${k}`;
    if (k === 'premise' || KERNEL_SECTIONS.has(key) || !size(v) || [...reads].some(r => key === r || key.startsWith(r + '.'))) continue;
    // The reader: a registered card that reads it and needs no capability (plot/data readers), fewest requirements first.
    const reader = registry.cards().filter(c => (c.reads || []).includes(key) && !(c.requires?.capabilities || []).length && !c.id.startsWith('graphics.'))
      .sort((a, b) => (a.requires?.primitives || []).length - (b.requires?.primitives || []).length || a.id.localeCompare(b.id))[0];
    out.push({ section: key, reader: reader?.id || null });
  }
  return out;
}

/**
 * Deterministic placement: archetypes a contract wants placed that the document defines but nothing puts in
 * the world get spawn rules through the spawner primitive, spread over the zones (hostile kinds skip the
 * player's start zone when there are others). Returns { doc, added: [{rule, archetype, zone}] }; input untouched.
 */
export function placeContent(input, registry, { contracts = null } = {}) {
  const list = (contracts || contractsFor(registry, usedIds(input))).filter(c => c.need === 'archetypes' && c.placed);
  const sid = spawnerId(registry);
  if (!list.length || !sid) return { doc: input, added: [] };
  const doc = structuredClone(input), added = [];
  const counts = placementCounts(doc, registry);
  const space = doc.spaces?.[0];
  const zones = (space?.zones || []).map(z => z.id);
  if (!zones.length) return { doc: input, added };
  const startZone = typeof doc.player?.at === 'string' ? doc.player.at : zones[0];
  let spawner = null;
  const rules = () => {
    if (spawner) return spawner.with.rules;
    doc.systems = Array.isArray(doc.systems) ? doc.systems : [];
    spawner = doc.systems.find(s => s?.use === sid);
    if (!spawner) { spawner = { use: sid, with: { rules: [] } }; doc.systems.unshift(spawner); }
    spawner.with = isObj(spawner.with) ? spawner.with : {};
    spawner.with.rules = Array.isArray(spawner.with.rules) ? spawner.with.rules : [];
    return spawner.with.rules;
  };
  const taken = new Set(spawnRules(doc, registry).map(r => r.id));
  for (const c of list) {
    const have = archetypesWith(doc, c); if (!have.length) continue;
    let total = have.reduce((n, a) => n + (counts.get(a.id)?.count || 0), 0);
    if (total >= c.placed) continue;
    const hostile = have.some(a => ['enemy', 'boss'].includes(a.kind));
    const pool = hostile && zones.length > 1 ? zones.filter(z => z !== startZone) : zones;
    const unplaced = have.filter(a => !counts.get(a.id)?.count);
    const order = unplaced.length ? unplaced : have;
    const per = Math.max(1, Math.ceil((c.placed - total) / Math.max(1, Math.min(pool.length, Math.max(c.zones || 1, order.length)))));
    for (let k = 0; total < c.placed && k < Math.max(pool.length, order.length) * 2; k++) {
      const a = order[k % order.length], zone = pool[k % pool.length];
      let id = `place_${a.id}_${zone}`.slice(0, 60); while (taken.has(id)) id += '_b'; taken.add(id);
      const n = a.kind === 'boss' ? 1 : per;
      rules().push({ id, archetype: a.id, zone, count: [n, n], respawnSec: 0 });
      added.push({ rule: id, archetype: a.id, zone, count: n, contract: c.key });
      total += n; const e = counts.get(a.id) || counts.set(a.id, { count: 0, zones: new Set() }).get(a.id); e.count += n; e.zones.add(zone);
    }
  }
  return added.length ? { doc, added } : { doc: input, added };
}

/** Problems as model-facing text, grouped (each with the shape to add). */
export function describeContent(problems, limit = 12) {
  return problems.slice(0, limit).map(p => `- [${p.code}] ${p.path}: ${p.message}${p.hint ? `\n    ${p.hint}` : ''}`).join('\n');
}

/** Model-facing text: the content the chosen primitives need, with the exact shapes. */
export function contractText(contracts) {
  return contracts.map(c => {
    const what = c.need === 'archetypes' ? `≥${c.min || 1} archetypes with a "${c.component}" component${c.kinds?.length ? ` (kind ${c.kinds.join('|')})` : ''}${c.placed ? `, ≥${c.placed} placed by spawns${c.zones ? ` across ≥${c.zones} zones` : ''}` : ''}`
      : c.need === 'section' ? `${c.at}: ≥${c.min || 1} entries` : c.need === 'param' ? `${c.use} with.${c.param}: ≥${c.min || 1} entries` : `content.items: ≥${c.min || 1} items`;
    return `- ${c.uses.join(', ')}: ${what}.${c.why ? ` ${c.why}.` : ''}${shape(c.example)}`;
  }).join('\n');
}
