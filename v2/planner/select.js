// Primitive selection (ARCHITECTURE.md §4): decomposed mechanics -> primitives
// from registry.cards(), then spaces chosen to provide what the chosen
// primitives require (capability-aware, including space configurations whose
// capabilities depend on params). Mechanics nothing covers become gaps.
// A decision model (d1 / OpenAI Decisions) picks among lexical candidates
// when available; otherwise the lexical ranking decides.
import { Logic } from '../kernel/logic.js';
import { isSpace, isGenerator, isGraphics, spaceVariants, requirementsOf, satisfying } from './catalog.js';
import { parseReply } from './writer.js';
import { planWorld, unfurnishable, spaceNeeds, contentOfGenerator, targets, isMovement, OUTLINE_AUTHORS } from './world.js';

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
  let spaceIds = registry.ids('engine').filter(id => isSpace(id) && !exclude.includes(id));
  // Something moves through the world: a space kind whose declared needs (card.needs.content) no registered
  // generator can build would be a void, so it is not offered (when another space kind can be).
  const excluded = [];
  if (primitiveIds.some(id => isMovement(registry, id))) {
    const ok = spaceIds.filter(id => { const missing = unfurnishable(registry, id); if (missing.length) excluded.push({ use: id, missing, why: `no registered generator builds ${missing.join(', ')} for ${id}` }); return !missing.length; });
    if (ok.length) spaceIds = ok; else excluded.length = 0;
  }
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
  if (!variants.length) return { spaces, bind, excluded, unmet: needers.map(n => ({ id: n.id, missing: n.caps, why: 'no space primitive is registered' })) };
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
  return { spaces, bind, unmet, excluded };
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
/**
 * Whole-catalogue mapping: the model sees every gameplay/engine/plot card (id + intent) and maps each
 * mechanic to the primitives that implement it. Word overlap can't know that "rings" are collectibles or
 * that "tetromino" means falling pieces; the model can, so it is the primary selector when available.
 * Returns { [mechanicId]: { primitives: [ids], covered: bool, why } } or null.
 */
export async function mapWithCatalogue({ writer, decomposition, mechanics, cards, registry, log = () => {} }) {
  if (!writer?.complete) return null;
  const index = cards.map(c => `${c.id}: ${String(c.intent || '').replace(/\s+/g, ' ').slice(0, 170)}`).join('\n');
  const system = 'You map game mechanics onto a fixed catalogue of composable game primitives. Each primitive is general: "collectible" covers rings, coins, pellets, gems; "falling.pieces" covers Tetris/tetrominoes/falling blocks; "move.lanes" covers endless-runner lanes; a space covers travel inside it. For every mechanic, list the primitive ids (exact ids from the catalogue) that together implement it, most important first. Only say covered=false when no combination of catalogue primitives could implement it. Use only ids that appear in the catalogue.';
  const user = `Game idea: ${decomposition.premise}\n\nMechanics:\n${mechanics.map(m => `- ${m.id}: ${m.description}`).join('\n')}\n\nCatalogue:\n${index}`;
  const schema = { name: 'mechanic_map', schema: { type: 'object', additionalProperties: false, required: ['mappings'], properties: { mappings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['mechanic', 'primitives', 'covered', 'why'], properties: { mechanic: { type: 'string' }, primitives: { type: 'array', items: { type: 'string' } }, covered: { type: 'boolean' }, why: { type: 'string' } } } } } } };
  try {
    const reply = await writer.complete({ system, user, schema });
    const out = {};
    for (const m of parseReply(reply.text)?.mappings || []) {
      const ids = (m.primitives || []).filter(id => registry.has(id) && !isGraphics(id));
      out[m.mechanic] = { primitives: [...new Set(ids)], covered: Boolean(m.covered) && ids.length > 0, why: String(m.why || '').slice(0, 200) };
    }
    return Object.keys(out).length ? out : null;
  } catch (error) { log(`catalogue mapping failed: ${error.message}`); return null; }
}

export async function selectPrimitives({ decomposition, registry, decisions = null, writer = null, log = () => {}, excludeSpaces = [] }) {
  const started = performance.now();
  // Spaces compete too: a mechanic a space provides (travelling between places) prefers that space.
  const cards = registry.cards().filter(c => !isGraphics(c.id));
  const mechanics = decomposition.mechanics.map(m => ({ ...m, candidates: rankCandidates(m, cards) }));
  const mapped = await mapWithCatalogue({ writer, decomposition, mechanics, cards, registry, log });
  let decided = null, provider = mapped ? 'catalogue-model' : null;
  if (!mapped && decisions && mechanics.some(m => m.candidates.length)) {
    try {
      const questions = Object.fromEntries(mechanics.filter(m => m.candidates.length).map(m => [m.id, { type: 'choice', instructions: `${DECIDE}\nMechanic: ${m.description}`,
        criteria: { ...Object.fromEntries(m.candidates.map(c => [c.id, registry.get(c.id).card.intent.slice(0, 300)])), none: 'None of these implements it.' } }]));
      const r = await decisions.decide({ state: `Game idea: ${decomposition.premise}`, questions });
      decided = r.answers; provider = r.provider;
    } catch (error) { log(`selection decisions failed: ${error.message}`); }
  }
  // Selection completeness: each core mechanic must have the primitive that defines it (a model check, when a writer is connected).
  const checked = mapped ? await checkMapping({ writer, decomposition, mechanics, mapped, cards, registry, log }) : null;
  const chosen = new Set(), gaps = [];
  for (const m of mechanics) {
    const map = mapped?.[m.id];
    if (map) {
      m.primitives = map.covered ? map.primitives : [];
      m.source = 'catalogue-model'; m.score = map.covered ? 1 : 0;
      m.primitives.forEach(id => chosen.add(id));
      if (!map.covered) gaps.push({ mechanic: m.id, description: m.description, importance: m.importance, kind: 'no_primitive', why: map.why || 'no catalogue primitive implements it' });
      continue;
    }
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
  const { spaces, bind, unmet, excluded: excludedSpaces = [] } = chooseSpaces(registry, [...chosen], decomposition, prefer, excludeSpaces);
  // A primitive no chosen space can host stays the user's intent: a core mechanic's primitive becomes an adapter gap
  // (the gap layer writes the adapter that projects it onto the space, gated by tests and the playtest agent), never
  // a quiet downgrade. The document published meanwhile leaves it out (it could not install).
  const composition = unmet.length ? await compositionCheck() : null;
  for (const u of unmet) {
    chosen.delete(u.id);
    // An adapter projects a primitive onto a space that lacks what it needs; when NO registered space provides it,
    // the missing piece is a space capability (a capability gap), not an adapter.
    const hostable = registry.ids('engine').filter(isSpace).some(id => spaceVariants(registry, id).some(v => u.missing.every(c => v.caps.has(c))));
    const core = hostable && mechanics.some(m => m.importance === 'core' && m.primitives.includes(u.id));
    let verdict = null;
    if (core && composition) try { verdict = composition({ spaces, systems: [...chosen, u.id], primitive: u.id }, registry); } catch { verdict = null; }
    const signature = verdict?.signature || `${u.id} -> ${spaces[0]?.use || 'space'} (${u.missing.join(', ')})`;
    for (const m of mechanics) if (m.primitives.includes(u.id)) {
      m.primitives = m.primitives.filter(x => x !== u.id);
      if (core && m.importance === 'core') gaps.push({ mechanic: m.id, description: `needs adapter: ${signature}`, importance: 'core', kind: 'adapter', primitive: u.id, signature, verdict: verdict?.verdict || 'incompatible-needs-adapter', why: `${u.id} needs ${u.missing.join(', ')}, which ${spaces[0]?.use || 'the space'} does not provide; an adapter primitive can project it` });
      else if (!m.primitives.length) gaps.push({ mechanic: m.id, description: m.description, importance: m.importance, kind: 'capability', why: `${u.id} needs ${u.missing.join(', ')}, which no registered space provides` });
    }
  }
  // Base locomotion follows the idea: the primary view and the avatar's medium (cards declare locomotion and medium).
  const loco = locomotionCompleteness({ decomposition, registry, chosen, space: spaces[0], mechanics });
  // Mechanics the chosen space itself provides (travelling between its places) are not gaps: ask the decision
  // model once for every no-primitive gap, else fall back to lexical relevance against the space card.
  const noPrim = gaps.filter(g => g.kind === 'no_primitive');
  if (noPrim.length && spaces.length) {
    const spaceCards = spaces.map(s => ({ id: s.use, ...registry.get(s.use).card }));
    let covered = new Set();
    if (decisions) {
      try {
        const r = await decisions.decide({ state: `Game idea: ${decomposition.premise}\nSpaces: ${spaceCards.map(c => `${c.id}: ${c.intent}`).join(' | ')}`, questions: Object.fromEntries(noPrim.map((g, i) => [`g${i}`, { type: 'noul', instructions: `Does one of these spaces, on its own, give the player this mechanic as the game needs it? Mechanic: ${g.description}` }])) });
        const bar = r.provider === 'd1' ? 0.7 : 0.5;
        noPrim.forEach((g, i) => { if ((r.answers[`g${i}`]?.noul ?? 0) >= bar) covered.add(g.mechanic); });
      } catch { covered = new Set(); }
    } else for (const g of noPrim) if (spaceCards.some(c => relevance({ verb: '', description: g.description }, c) >= LEXICAL_ACCEPT)) covered.add(g.mechanic);
    for (const g of noPrim) if (covered.has(g.mechanic)) {
      gaps.splice(gaps.indexOf(g), 1);
      const m = mechanics.find(x => x.id === g.mechanic); if (m) { m.primitives = [spaces[0].use]; m.source = `${m.source}+space`; }
    }
  }
  // A generator a mechanic named goes to the first chosen space its card targets (card.spaces); one that targets
  // none of them is dropped, never bound to a space it can't build.
  const generators = [], dropped = [];
  for (const id of [...chosen].filter(isGenerator)) {
    const s = spaces.find(x => targets(registry, id, x.use));
    if (s) generators.push({ id, space: s.id }); else { dropped.push({ id, why: `targets ${(registry.get(id).card.spaces || []).join(', ') || 'no space'}; chosen: ${spaces.map(x => x.use).join(', ')}` }); chosen.delete(id); }
  }
  for (const d of dropped) for (const m of mechanics) m.primitives = m.primitives.filter(x => x !== d.id);
  const systems = [...chosen].filter(id => !isGenerator(id) && !isSpace(id)).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  // A space something moves through gets a world even when no mechanic mapped to a generator (the mapping rarely
  // names one): the generators whose cards declare the content the space card says it needs (planWorld). Zones
  // are the outline's own; the outline's scaffold pass fills each generator's params.
  const movers = systems.filter(id => isMovement(registry, id));
  for (const s of spaces) {
    if (!spaceNeeds(registry, s.use).length || !movers.some(id => (bind[id] ?? spaces[0].id) === s.id)) continue;
    const have = [...OUTLINE_AUTHORS, ...generators.filter(g => g.space === s.id).flatMap(g => contentOfGenerator(registry, g.id))];
    const plan = planWorld(registry, s, { view: decomposition.views?.[0], have, exclude: generators.filter(g => g.space === s.id).map(g => g.id) });
    for (const id of plan.generators) generators.push({ id, space: s.id, auto: true });
  }
  return {
    version: SELECT_VERSION, mechanics: mechanics.map(({ candidates, ...m }) => ({ ...m, candidates: candidates.slice(0, 3) })),
    // Renderers, UI and audio are chosen by the host from the document's systems and spaces
    // (graphics/ui-defaults.js withDefaultGraphics); the planner adds graphics only when a mechanic needs one.
    systems, generators, graphics: [], spaces, bind, gaps, provider, completeness: { locomotion: loco, mapping: checked }, ...(dropped.length ? { droppedGenerators: dropped } : {}), ...(excludedSpaces.length ? { excludedSpaces } : {}), ms: Math.round(performance.now() - started),
  };
}
// Install order inside systems[]: engine runtime first, then gameplay, then plot (catalog §0 convention).
const order = id => id.startsWith('engine.') ? 0 : id.startsWith('gameplay.') ? 1 : 2;

// ---------- selection completeness ----------

/** compose-check.js (v2-static-composition) when present: checkComposition(selection, registry) -> { verdict, missing, adapter, signature }. */
let composeMod;
async function compositionCheck() {
  if (composeMod === undefined) composeMod = await import('./compose-check.js').catch(() => null);
  return typeof composeMod?.checkComposition === 'function' ? composeMod.checkComposition : null;
}

const primaryOf = decomposition => (decomposition.views || []).find(v => v !== 'ui') || null;
const supportsView = (card, view) => !view || (card.views || []).includes(view) || (card.views || []).includes('any');

/**
 * Base locomotion cards that fit a space, a primary view and a medium, best first. Hard filters: base locomotion,
 * capabilities the space provides, the primary view. Preference: the wanted medium, then specialisation.
 */
export function baseLocomotion(registry, { caps = [], view = null, medium = null, exclude = [] } = {}) {
  const have = new Set(caps);
  return registry.cards('gameplay').filter(c => c.locomotion === 'base' && !exclude.includes(c.id) && (c.requires?.capabilities || []).every(x => have.has(x)) && supportsView(c, view))
    // Specialisation breaks ties: a card that needs more of what this space provides (gravity for jumping) and is made
    // for fewer views fits it better than a general one (the side-view platformer over walking, on a side-view tilemap).
    .map(c => ({ id: c.id, medium: c.medium || null, score: ((c.views || []).includes(view) ? 10 : 1) + (medium && c.medium === medium ? 5 : 0) + (c.requires?.capabilities || []).length + 2 / Math.max(1, (c.views || []).length) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * The avatar moves the way the idea says: a base locomotion that lacks the primary view is replaced; a lone base
 * locomotion in the wrong medium (flying through a walking dungeon) is replaced by one in the right medium; an idea
 * whose avatar moves but has no base locomotion gets one. movement 'none' (cards, boards, falling pieces) adds nothing.
 * Mutates `chosen` and the mechanics' primitive lists; returns what it did.
 */
export function locomotionCompleteness({ decomposition, registry, chosen, space, mechanics = [] }) {
  const view = primaryOf(decomposition), medium = decomposition.movement || null, out = { view, medium, removed: [], added: null };
  if (!space) return out;
  const present = [...chosen].filter(id => registry.get(id)?.card.locomotion === 'base');
  const drop = id => { chosen.delete(id); out.removed.push(id); for (const m of mechanics) if (Array.isArray(m.primitives)) m.primitives = m.primitives.filter(x => x !== id); };
  for (const id of present) if (!supportsView(registry.get(id).card, view)) drop(id);
  const left = present.filter(id => chosen.has(id));
  const wrongMedium = Boolean(medium && medium !== 'none' && left.length && left.every(id => registry.get(id).card.medium && registry.get(id).card.medium !== medium));
  if (medium === 'none' || (left.length && !wrongMedium)) return out;
  const best = baseLocomotion(registry, { caps: space.caps, view, medium, exclude: left }).find(c => !medium || c.medium === medium || !c.medium);
  if (!best) return out;
  if (wrongMedium) for (const id of left) drop(id);
  chosen.add(best.id); out.added = best.id;
  const host = mechanics.find(m => m.importance === 'core' && /\b(move|walk|run|jump|explor|navigat|travel|climb|platform|roam|fly|swim|drive)\w*/i.test(`${m.verb} ${m.description}`)) || mechanics.find(m => m.importance === 'core');
  if (host && Array.isArray(host.primitives) && !host.primitives.includes(best.id)) host.primitives.push(best.id);
  return out;
}

/**
 * Model check of the catalogue mapping: for every core mechanic, is the primitive that DEFINES it mapped (a Tetris
 * platformer needs the platformer movement, not grid steps)? The model sees the mapped primitives and the closest
 * alternatives (lexical candidates and siblings of what was mapped) and names the central one and any wrong ones.
 * Applies its answer to `mapped` (adds the central primitive, removes wrong ones). -> { checked, changes } or null.
 */
export async function checkMapping({ writer, decomposition, mechanics, mapped, cards, registry, log = () => {} }) {
  const core = mechanics.filter(m => m.importance === 'core' && mapped[m.id]);
  if (!writer?.complete || !core.length) return null;
  const byId = new Map(cards.map(c => [c.id, c]));
  const line = id => `${id}: ${String(byId.get(id)?.intent || '').replace(/\s+/g, ' ').slice(0, 160)}`;
  const blocks = core.map(m => {
    const have = mapped[m.id].primitives;
    const domains = new Set(have.map(id => id.split('.').slice(0, 2).join('.')));
    const alts = [...new Set([...m.candidates.map(c => c.id), ...cards.filter(c => domains.has(c.id.split('.').slice(0, 2).join('.'))).map(c => c.id)])].filter(id => !have.includes(id) && !isGraphics(id)).slice(0, 14);
    return `Mechanic ${m.id}: ${m.description}\n  mapped:\n${have.map(id => `    ${line(id)}`).join('\n') || '    (none)'}\n  alternatives:\n${alts.map(id => `    ${line(id)}`).join('\n') || '    (none)'}`;
  }).join('\n\n');
  const system = 'You check a mechanic mapping for a game built from composable primitives. For each core mechanic decide which single primitive DEFINES it (the one without which the mechanic is not there at all: platforming needs the platformer movement, falling-block stacking needs the falling-pieces primitive, catching creatures needs the catch primitive). It may be one already mapped or one of the alternatives. Also list mapped primitives that implement a DIFFERENT mechanic than this one (a wrong sibling, e.g. grid steps for a jump-and-run, flying for a walking dungeon); supporting primitives that help are not wrong. Use exact ids from the lists.';
  const user = `Game idea: ${decomposition.premise}\nMain view: ${primaryOf(decomposition) || 'any'}; the avatar moves: ${decomposition.movement || 'unknown'}\n\n${blocks}`;
  const schema = { name: 'mapping_check', schema: { type: 'object', additionalProperties: false, required: ['checks'], properties: { checks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['mechanic', 'central', 'wrong', 'why'], properties: { mechanic: { type: 'string' }, central: { type: 'string' }, wrong: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } } } } } } };
  try {
    const reply = await writer.complete({ system, user, schema });
    const changes = [];
    for (const c of parseReply(reply.text)?.checks || []) {
      const entry = mapped[c.mechanic]; if (!entry) continue;
      const m = core.find(x => x.id === c.mechanic); if (!m) continue;
      const central = registry.has(c.central) && !isGraphics(c.central) ? c.central : null;
      if (central && !entry.primitives.includes(central)) { entry.primitives = [central, ...entry.primitives]; entry.covered = true; changes.push({ mechanic: m.id, added: central, why: String(c.why || '').slice(0, 160) }); }
      for (const w of c.wrong || []) if (w !== central && entry.primitives.includes(w)) { entry.primitives = entry.primitives.filter(x => x !== w); changes.push({ mechanic: m.id, removed: w, why: String(c.why || '').slice(0, 160) }); }
      if (!entry.primitives.length) entry.covered = false;
    }
    return { checked: core.map(m => m.id), changes, ms: reply.ms ?? null };
  } catch (error) { log(`mapping check failed: ${error.message}`); return { checked: [], changes: [], error: String(error.message || error).slice(0, 120) }; }
}
