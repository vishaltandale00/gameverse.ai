// Primitive selection (ARCHITECTURE.md §4): decomposed mechanics -> primitives
// from registry.cards(), then spaces chosen to provide what the chosen
// primitives require (capability-aware, including space configurations whose
// capabilities depend on params). Mechanics nothing covers become gaps.
// A decision model (d1 / OpenAI Decisions) picks among lexical candidates
// when available; otherwise the lexical ranking decides.
import { Logic } from '../kernel/logic.js';
import { isSpace, isGenerator, isGraphics, spaceVariants, requirementsOf, satisfying } from './catalog.js';

export const SELECT_VERSION = 'select/0.1';
export const LEXICAL_ACCEPT = 0.75;    // calibrated in tests/v2-p-pipeline-select.test.js
export const DECISION_ACCEPT = 0.4;

const STOP = new Set('a an the of in on with and or to for from by as at is are be it its into that this their them they you your player players game games can each every any one two three when where which who what than then there these those over under up down out about via per such so not no only also more most some between'.split(' '));
const stem = w => w.length > 4 ? w.replace(/(ings|ing|ers|er|ed|es|ions|ion|ments|ment|ies|s)$/, m => m === 'ies' ? 'y' : '') : w;
export const tokens = text => (String(text || '').toLowerCase().match(/[a-z][a-z0-9]*/g) || []).filter(w => !STOP.has(w) && w.length > 1).map(stem);

// Generic semantic neighbours (mechanic words, not genres): lets "talk to villagers" reach a dialogue card.
const GROUPS = [
  'fight combat attack battle melee hit damage enemy weapon sword strike',
  'shoot projectile ranged gun bullet fire aim',
  'talk dialogue conversation speak say chat line',
  'collect item inventory pickup gather loot carry bag',
  'explore zone location travel room place map exit navigate region',
  'story plot act narrative quest scene',
  'move walk run jump platform movement locomotion',
  'build place block construct structure',
  'mine dig block terrain cell',
  'craft recipe station',
  'drive vehicle car steer ride',
  'catch capture creature party tame recruit',
  'turn tactic board grid initiative',
  'puzzle lock key switch lever solve gate',
  'sneak stealth hide detect vision guard',
  'trade shop buy sell currency money economy price',
  'survive hazard timer health hunger',
  'grow level xp ability upgrade progression stat skill',
  'farm crop plant harvest',
].map(g => g.split(' ').map(stem));
const neighbours = t => [...new Set(GROUPS.filter(g => g.includes(t)).flat())].filter(x => x !== t);

const cardWeights = new WeakMap();
function weightsOf(card) {
  if (cardWeights.has(card)) return cardWeights.get(card);
  const w = new Map(), put = (text, weight) => { for (const t of tokens(text)) w.set(t, Math.max(w.get(t) || 0, weight)); };
  put(card.id.split('.').slice(1).join(' '), 3);
  put((card.provides?.actions || []).join(' '), 3);
  put(card.intent, 1);
  put((card.provides?.events || []).map(e => e.replace(/[:_*]/g, ' ')).join(' '), 1.5);
  put((card.provides?.vars || []).join(' ').replace(/\./g, ' '), 1);
  put((card.reads || []).join(' ').replace(/\./g, ' '), 1);
  put(Object.keys(card.params || {}).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2'), 0.5);
  cardWeights.set(card, w);
  return w;
}

/** Lexical relevance of a card to a mechanic (0 = unrelated; ≥ LEXICAL_ACCEPT = a match). */
export function relevance(mechanic, card) {
  const direct = [...new Set(tokens(`${mechanic.verb} ${mechanic.description}`))];
  if (!direct.length) return 0;
  const w = weightsOf(card);
  let total = 0;
  for (const t of direct) total += Math.max(w.get(t) || 0, ...neighbours(t).map(n => (w.get(n) || 0) * 0.5));
  return +(total / Math.sqrt(direct.length)).toFixed(3);
}

export function rankCandidates(mechanic, cards, limit = 6) {
  return cards.map(card => ({ id: card.id, score: relevance(mechanic, card) })).filter(c => c.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

/** Which primitive registers each predicate and effect kind (kernel built-ins excluded). */
const vocabCache = new WeakMap();
export function vocabIndex(registry) {
  if (vocabCache.has(registry)) return vocabCache.get(registry);
  const base = new Logic(), builtinP = new Set(base.predicates.keys()), builtinE = new Set(base.effects.keys());
  const out = { predicates: {}, effects: {} };
  for (const id of registry.ids()) {
    const p = registry.get(id); if (!p.logic) continue;
    const l = new Logic();
    try { p.logic(l); } catch { continue; }
    for (const k of l.predicates.keys()) if (!builtinP.has(k)) out.predicates[k] ??= id;
    for (const k of l.effects.keys()) if (!builtinE.has(k)) out.effects[k] ??= id;
  }
  vocabCache.set(registry, out);
  return out;
}

// Structural hints for a decomposed space kind: capabilities and views it implies (generic, not genre).
const KIND_HINTS = {
  'continuous-3d': { caps: ['surface', 'raycast', 'gravity'], views: ['1p', '3p', 'iso'] },
  'continuous-2d': { caps: ['overlap'], views: ['td', 'side'] },
  'tiles-side': { caps: ['gravity', 'editCells'], views: ['side'] },
  'tiles-topdown': { caps: ['editCells'], views: ['td'] },
  board: { caps: ['occupancy', 'los'], views: ['board', 'td', 'iso'] },
  locations: { caps: ['navigate'], views: ['text', 'map'] },
  none: { caps: [], views: ['ui'] },
};

const spaceSlug = (role, i) => ((String(role || 'world').toLowerCase().match(/[a-z0-9]+/g) || ['world']).join('_').slice(0, 30) || 'world') + (i ? `_${i}` : '');

/**
 * Choose spaces so every chosen primitive's required capabilities are provided. The primary
 * space satisfies the most primitives; primitives it can't host are bound to a second space
 * (a variant of any space primitive) that can, and only then reported as unmet.
 */
export function chooseSpaces(registry, primitiveIds, decomposition = {}, prefer = [], exclude = []) {
  const spaceIds = registry.ids('engine').filter(id => isSpace(id) && !exclude.includes(id));
  const variants = spaceIds.flatMap(id => spaceVariants(registry, id).map(v => ({ use: id, ...v, card: registry.get(id).card })));
  const needers = primitiveIds.filter(id => !isSpace(id)).map(id => ({ id, caps: requirementsOf(registry, id).capabilities }));
  const wantViews = new Set([...(decomposition.views || []), ...(decomposition.spaces || []).flatMap(s => KIND_HINTS[s.kind]?.views || [])]);
  const hint = decomposition.spaces?.[0] ? KIND_HINTS[decomposition.spaces[0].kind] : null;
  const fits = (v, n) => n.caps.every(c => v.caps.has(c));
  const score = (v, pool, kind) => {
    const k = kind ? KIND_HINTS[kind] : hint;
    const views = (v.card.views || []).filter(x => wantViews.has(x) || x === 'any').length;
    const kindFit = k ? k.caps.filter(c => v.caps.has(c)).length - (k.caps.length && !k.caps.some(c => v.caps.has(c)) ? 2 : 0) : 0;
    return pool.filter(n => fits(v, n)).length * 10 + views * 2 + kindFit * 3 + (prefer.includes(v.use) ? 6 : 0) - v.caps.size * 0.05 - Object.keys(v.with).length * 0.5;
  };
  const pick = (pool, kind) => variants.map(v => ({ v, s: score(v, pool, kind) })).sort((a, b) => b.s - a.s || a.v.use.localeCompare(b.v.use))[0]?.v || null;
  const spaces = [], bind = {}, unmet = [];
  if (!variants.length) return { spaces, bind, unmet: needers.map(n => ({ id: n.id, missing: n.caps, why: 'no space primitive is registered' })) };
  const primary = pick(needers, decomposition.spaces?.[0]?.kind);
  spaces.push({ id: spaceSlug(decomposition.spaces?.[0]?.role, 0), use: primary.use, with: primary.with, role: decomposition.spaces?.[0]?.role || 'world', caps: [...primary.caps] });
  let rest = needers.filter(n => !fits(primary, n));
  for (let i = 1; rest.length && i < 3; i++) {
    const role = decomposition.spaces?.[i];
    const next = pick(rest, role?.kind);
    const hosted = rest.filter(n => fits(next, n));
    if (!hosted.length) break;
    const id = spaceSlug(role?.role || hosted[0].id.split('.').pop(), spaces.some(s => s.id === spaceSlug(role?.role || hosted[0].id.split('.').pop(), 0)) ? i : 0);
    spaces.push({ id, use: next.use, with: next.with, role: role?.role || hosted.map(h => h.id.split('.').pop()).join('+'), caps: [...next.caps] });
    for (const h of hosted) bind[h.id] = id;
    rest = rest.filter(n => !hosted.includes(n));
  }
  for (const n of rest) {
    const best = spaces.map(s => ({ s, missing: n.caps.filter(c => !s.caps.includes(c)) })).sort((a, b) => a.missing.length - b.missing.length)[0];
    unmet.push({ id: n.id, missing: best?.missing || n.caps, why: `no registered space provides ${n.caps.join(', ')}` });
  }
  // Extra space roles the idea asks for (an overworld and an interior) that nothing bound yet stay one space: the outline may add more.
  return { spaces, bind, unmet };
}

/** Best renderer per space and overlay UI: graphics cards that name the space, then view overlap. */
export function chooseGraphics(registry, spaces) {
  const out = [], cards = registry.cards('graphics');
  spaces.forEach((s, i) => {
    const views = new Set(registry.get(s.use)?.card.views || []);
    const ranked = cards.map(c => {
      const names = (c.requires?.primitives || []).some(r => s.use === r || s.use.startsWith(r + '.')) ? 10 : 0;
      const capsOk = (c.requires?.capabilities || []).every(x => s.caps.includes(x));
      const overlap = (c.views || []).filter(v => views.has(v) || v === 'any').length;
      return { id: c.id, score: capsOk ? names + overlap * 2 : -1, overlay: (c.views || []).includes('overlay') };
    }).filter(c => c.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    if (ranked[0]) out.push({ id: ranked[0].id, space: i ? s.id : undefined });
  });
  for (const c of cards) if ((c.views || []).includes('overlay') && !out.some(o => o.id === c.id) && out.length < spaces.length + 2 && /\.ui\./.test(c.id)) out.push({ id: c.id });
  return out;
}

const DECIDE = 'Which listed primitive implements this mechanic as the game needs it? Answer "none" if none of them really does (a related but different mechanic is "none").';

/**
 * selectPrimitives({ decomposition, registry, decisions? }) -> {
 *   mechanics: [{ id, description, importance, primitives, score, source, candidates }],
 *   systems: [id], generators: [{ id, space }], graphics: [{ id, space }], spaces: [{ id, use, with, role, caps }],
 *   bind: { primitiveId: spaceId }, gaps: [{ mechanic, description, importance, kind, why }], ms }
 */
export async function selectPrimitives({ decomposition, registry, decisions = null, log = () => {}, excludeSpaces = [] }) {
  const started = performance.now();
  // Spaces compete too: a mechanic a space provides (travelling between places) prefers that space.
  const cards = registry.cards().filter(c => !isGraphics(c.id));
  const mechanics = decomposition.mechanics.map(m => ({ ...m, candidates: rankCandidates(m, cards) }));
  let decided = null, provider = null;
  if (decisions && mechanics.some(m => m.candidates.length)) {
    try {
      const questions = Object.fromEntries(mechanics.filter(m => m.candidates.length).map(m => [m.id, { type: 'choice', instructions: `${DECIDE}\nMechanic: ${m.description}`,
        criteria: { ...Object.fromEntries(m.candidates.map(c => [c.id, registry.get(c.id).card.intent.slice(0, 300)])), none: 'None of these implements it.' } }]));
      const r = await decisions.decide({ state: `Game idea: ${decomposition.premise}`, questions });
      decided = r.answers; provider = r.provider;
    } catch (error) { log(`selection decisions failed: ${error.message}`); }
  }
  const chosen = new Set(), gaps = [];
  for (const m of mechanics) {
    const top = m.candidates[0];
    const answer = decided?.[m.id];
    let pick = null, source = 'lexical';
    if (answer?.choice) {
      const p = answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0;
      source = provider || 'decision';
      if (answer.choice !== 'none' && p >= DECISION_ACCEPT && registry.has(answer.choice)) pick = answer.choice;
      else if (answer.choice === 'none' && p >= 0.5) pick = null;
      else pick = top && top.score >= LEXICAL_ACCEPT ? top.id : null;
    } else pick = top && top.score >= LEXICAL_ACCEPT ? top.id : null;
    // Co-providers: other cards nearly as relevant (a combat mechanic usually needs health too).
    const extra = pick ? m.candidates.filter(c => c.id !== pick && c.score >= Math.max(LEXICAL_ACCEPT * 1.5, (m.candidates.find(x => x.id === pick)?.score || 0) * 0.85)) : [];
    m.primitives = pick ? [pick, ...extra.map(c => c.id)] : [];
    m.source = source; m.score = m.candidates.find(c => c.id === pick)?.score ?? top?.score ?? 0;
    m.primitives.forEach(id => chosen.add(id));
    if (!pick) gaps.push({ mechanic: m.id, description: m.description, importance: m.importance, kind: 'no_primitive', why: m.candidates.length ? `closest primitives (${m.candidates.slice(0, 3).map(c => c.id).join(', ')}) don't implement it` : 'no primitive covers it' });
  }
  // Foundations every document can use: the story runner (reads plot.storyboard) and whatever registers the item vocabulary.
  const vocab = vocabIndex(registry);
  for (const c of cards) if ((c.reads || []).includes('plot.storyboard')) { chosen.add(c.id); break; }
  for (const k of ['give_item']) if (vocab.effects[k]) chosen.add(vocab.effects[k]);
  // Requirements closure and conflicts.
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...chosen]) for (const req of requirementsOf(registry, id).primitives) {
      if ([...chosen].some(x => x === req || x.startsWith(req + '.'))) continue;
      const s = satisfying(registry, req); if (s) { chosen.add(s); changed = true; }
    }
  }
  for (const id of [...chosen]) for (const c of registry.get(id)?.card.conflicts || []) if (chosen.has(c) && c !== id) chosen.delete(c);
  // Input mapping: when anything offers player actions, the catalogue's input primitive (if one is registered) binds them.
  if ([...chosen].some(id => registry.get(id)?.card.provides?.actions?.length)) {
    const input = registry.cards('engine').filter(c => c.id.startsWith('engine.input.')).map(c => ({ id: c.id, score: relevance({ verb: 'map', description: 'map device keys and buttons to player verbs and actions' }, c) })).sort((a, b) => b.score - a.score)[0];
    if (input) chosen.add(input.id);
  }

  const prefer = [...chosen].filter(isSpace);
  for (const id of prefer) chosen.delete(id);
  const { spaces, bind, unmet } = chooseSpaces(registry, [...chosen], decomposition, prefer, excludeSpaces);
  for (const u of unmet) {
    chosen.delete(u.id);
    for (const m of mechanics) if (m.primitives.includes(u.id)) {
      m.primitives = m.primitives.filter(x => x !== u.id);
      if (!m.primitives.length) gaps.push({ mechanic: m.id, description: m.description, importance: m.importance, kind: 'capability', why: `${u.id} needs ${u.missing.join(', ')}, which no registered space provides` });
    }
  }
  const generators = [...chosen].filter(isGenerator).map(id => ({ id, space: (spaces.find(s => requirementsOf(registry, id).capabilities.every(c => s.caps.includes(c))) || spaces[0])?.id }));
  const systems = [...chosen].filter(id => !isGenerator(id) && !isSpace(id)).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  return {
    version: SELECT_VERSION, mechanics: mechanics.map(({ candidates, ...m }) => ({ ...m, candidates: candidates.slice(0, 3) })),
    systems, generators, graphics: chooseGraphics(registry, spaces), spaces, bind, gaps, provider, ms: Math.round(performance.now() - started),
  };
}
// Install order inside systems[]: engine runtime first, then gameplay, then plot (catalog §0 convention).
const order = id => id.startsWith('engine.') ? 0 : id.startsWith('gameplay.') ? 1 : 2;
