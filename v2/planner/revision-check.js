// @ts-check
// Did a change request actually happen? Used by every game type after a revision.
// A decision model reads the request and a diff of what changed. A change the
// engine can't really make ("bigger map" faked by switching maze styles) is
// reported as not possible yet instead of being passed off as done, and the
// player sees a plain summary of what did change.
import { createWorld } from '../kernel/world.js';
import { preflight } from '../kernel/document.js';
import { contentOf } from './world.js';
import { isObj, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** measureContent's result (counts are null when unmeasurable). @typedef {{ cells: number | null, entities: number | null, zones: number, generated: number, measured: boolean, error?: string }} ContentMeasure */

/**
 * What a document generates when booted: cells and entities per space (the player excluded), zones, and the entries
 * its generators were configured with. -> { cells, entities, zones, generated, measured } (cells null when unmeasurable).
 * @param {Doc} doc @param {RegistryLike} registry @param {LogicLike} logic @param {{ frames?: number }} [options] @returns {ContentMeasure}
 */
export function measureContent(doc, registry, logic, { frames = 2 } = {}) {
  const zones = (doc.spaces || []).reduce((n, s) => n + (s.zones || []).length, 0);
  const generated = (doc.spaces || []).reduce((n, s) => n + (s.generators || []).reduce((m, g) => m + Object.values(g.with || {}).reduce((k, v) => k + (Array.isArray(v) ? v.length : 0), 0), 0), 0);
  try {
    const pre = preflight(doc, registry, logic);
    const rt = createWorld(pre.ok ? pre.doc : doc, registry, logic, { seed: doc.seed });
    for (let i = 0; i < frames && rt.state.status === 'playing'; i++) rt.step();
    /** @type {number | null} */
    let cells = null, entities = 0;
    for (const s of doc.spaces || []) { const c = contentOf(rt, s.id); if (!c) continue; entities += c.entities; if (c.cells != null) cells = (cells ?? 0) + c.cells; }
    return { cells, entities, zones, generated, measured: true };
  } catch (error) { return { cells: null, entities: null, zones, generated, measured: false, error: String(prop(error, 'message') || error).slice(0, 120) }; }
}

/**
 * Did the generated content grow (not only a container param)? Cells, entities, zones or generator entries must
 * increase. -> { grew, what: [names that grew], before, after }
 * @param {Doc} before @param {Doc} after @param {RegistryLike} registry @param {LogicLike} logic
 */
export function contentGrowth(before, after, registry, logic) {
  const a = measureContent(before, registry, logic), b = measureContent(after, registry, logic);
  const what = /** @type {const} */ (['cells', 'entities', 'zones', 'generated']).filter(k => Number.isFinite(a[k]) && Number.isFinite(b[k]) && Number(b[k]) > Number(a[k]));
  return { grew: what.length > 0, what, before: a, after: b };
}

/**
 * A decision model client (decisions.js): yes/no questions about one state, answered with probabilities.
 * `answers` is model output: read it with noulOf.
 * @typedef {{ decide(request: { state: unknown, questions: Record<string, { type: string, instructions: string, criteria?: unknown }>, images?: string[] }): Promise<{ answers: unknown, provider: string }> }} Decisions
 */
/** A list that got shorter (or lost named items) in a revision. @typedef {{ path: string, before: number, after: number, removed?: Array<string | null> }} Shrunk */
/**
 * checkRevision's verdict. `applied` / `specific` are the decision model's probabilities (null without one).
 * @typedef {{ applied: number | null, specific?: number | null, subjective?: boolean, notApplied?: boolean, why?: string, summary: string[], diff: number, provider: string | null }} RevisionCheck
 */

/**
 * The yes-probability of question `name` in a decision reply's answers, or null when absent or not a number.
 * Throws when there are no answers at all, as reading `answers.x` did (callers catch it and fall back).
 * @param {unknown} answers @param {string} name @returns {number | null}
 */
export const noulOf = (answers, name) => {
  if (answers == null) throw TypeError('the decision model returned no answers');
  const v = prop(prop(answers, name), 'noul');
  return typeof v === 'number' ? v : null;
};

/** Paths whose values differ between two JSON values, e.g. "levels[2].maze.style: classic → sprawling". */
/** @param {unknown} x @returns {string | null} */
const keyOf = x => isObj(x) ? (typeof x.id === 'string' && x.id) || (typeof x.name === 'string' && x.name) || (typeof x.kind === 'string' && x.kind) || null : null;
/** Lists of named things (fighters, levels with ids) are compared by identity, not position. */
// An empty list on either side still diffs by identity ("features: [] → street, traffic" reads as added).
/** @param {unknown[]} a @param {unknown[]} b */
const identityList = (a, b) => Boolean((a.length || b.length) && a.every(keyOf) && b.every(keyOf));

/** @param {unknown} a @param {unknown} b @param {string} [path] @param {string[]} [out] @returns {string[]} */
export function contentDiff(a, b, path = '', out = []) {
  if (out.length >= 40 || JSON.stringify(a) === JSON.stringify(b)) return out;
  // A list that didn't exist before is an empty one (new fields like stage features).
  if (a === undefined && Array.isArray(b)) a = [];
  if (b === undefined && Array.isArray(a)) b = [];
  // Lists can arrive sparse (an op that set an index past the end): compare their actual entries.
  if (Array.isArray(a)) a = Array.from(/** @type {unknown[]} */ (a)).filter(x => x !== undefined);
  if (Array.isArray(b)) b = Array.from(/** @type {unknown[]} */ (b)).filter(x => x !== undefined);
  if (Array.isArray(a) && Array.isArray(b) && identityList(a, b)) {
    const before = new Map(a.map(x => /** @type {const} */ ([keyOf(x), x]))), after = new Map(b.map(x => /** @type {const} */ ([keyOf(x), x])));
    const added = [...after.keys()].filter(k => !before.has(k)), removed = [...before.keys()].filter(k => !after.has(k));
    if (added.length) out.push(`${path}: added ${added.join(', ')}`);
    if (removed.length) out.push(`${path}: removed ${removed.join(', ')}`);
    for (const [k, x] of after) if (before.has(k)) contentDiff(before.get(k), x, `${path}[${k}]`, out);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) out.push(`${path || '$'}: ${a.length} items → ${b.length} items`);
    const A = /** @type {Record<string, unknown>} */ (a), B = /** @type {Record<string, unknown>} */ (b);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) contentDiff(A[k], B[k], Array.isArray(a) ? `${path}[${k}]` : path ? `${path}.${k}` : k, out);
    return out;
  }
  const show = (/** @type {unknown} */ v) => typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v)?.slice(0, 40);
  out.push(`${path}: ${show(a)} → ${show(b)}`);
  return out;
}

/** A short human summary of a diff: field names grouped, array indices collapsed. @param {string[]} diff @param {number} [limit] @returns {string[]} */
export function changeSummary(diff, limit = 4) {
  /** @type {Map<string, number>} */
  const groups = new Map();
  for (const line of diff) {
    const m = line.match(/^(?:content\.)?([^:]+): (added|removed) (.+)$/);
    if (m) { const where = m[1].replace(/\[([^\]]+)\]/g, ' $1').replace(/^(stages|levels|fighters|chapters)\b/, '$1').trim(); groups.set(`${m[2]} ${m[3]}${/\s/.test(where) ? ` (${where.split(' ').slice(1).join(' ')})` : ''}`, 1); continue; }
    const art = line.match(/^art\.(player|enemy|scenery|tiles|pickup|hazard|goal)\b/);
    if (art) { groups.set(/** @type {Record<string, string>} */ ({ player: 'hero look', enemy: 'enemy look', scenery: 'scenery', tiles: 'tiles' })[art[1]] || `${art[1]} look`, 1); continue; }
    const field = line.split(':')[0].replace(/\[[^\]]+\]/g, '').replace(/^content\./, '').replace(/^mods\./, 'mods: ').replace(/^art\./, 'art: ');
    const words = field.split('.').slice(-2).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    groups.set(words, (groups.get(words) || 0) + 1);
  }
  return [...groups].slice(0, limit).map(([k, n]) => (n > 1 ? `${k} (${n})` : k));
}

// Below this, the change is treated as not done. 0.8 is deliberately strict: on real revisions d1
// put a faked "bigger map" at 0.65 and a real "make it faster" at 0.94 (OpenAI Decisions: 0.06, 0.95).
export const NOT_APPLIED = 0.8;
// Per provider: OpenAI Decisions separates at 0.5 (faked 0.00-0.06, real 0.74-0.95 on the same cases).
/** @param {string | null | undefined} provider */
export const notAppliedBar = provider => provider === 'openai' ? 0.5 : NOT_APPLIED;
const SPECIFIC = 'Is the request specific and checkable, naming a concrete size, count, mechanic, mode, feature or object (e.g. "bigger map", "add a sword", "3 lives", "busy cars on the streets")? Answer no if it is a matter of taste or overall feel that could be met in many ways (e.g. "make it more like Mario", "make it better", "cooler", "more fun").';
const INSTRUCTIONS = "Do these changes actually carry out the player's request, as the player would see it in the game? Answer no if the changes are only cosmetic, unrelated, or a stand-in for something the engine cannot really do (for example renaming something or switching a style when the request asks for a different size, a new mechanic or a new mode).";

/**
 * { applied, why, summary, diff, provider } or null when there's nothing to check.
 * `unsupported` entries are model output ({ request, why } when well formed).
 * @param {Decisions | null | undefined} decisions
 * @param {{ change?: string | null, engine: string, before: unknown, after: unknown, unsupported?: unknown[], originalStandIns?: boolean }} revision
 * @returns {Promise<RevisionCheck | null>}
 */
export async function checkRevision(decisions, { change, engine, before, after, unsupported = [], originalStandIns = false }) {
  if (!change) return null;
  const diff = contentDiff(before, after), summary = changeSummary(diff);
  if (!decisions) return { applied: null, summary, diff: diff.length, provider: null };
  try {
    const { answers, provider } = await decisions.decide({
      state: { engine, request: change, changes: diff.length ? diff : ['nothing changed'], reportedUnsupported: unsupported.map(u => prop(u, 'request')), ...(originalStandIns ? { note: 'Games use original names: a request for an existing character is carried out by adding an original look-alike with a new name. That counts as doing it.' } : {}) },
      questions: { applied: { type: 'noul', instructions: INSTRUCTIONS }, specific: { type: 'noul', instructions: SPECIFIC } },
    });
    const applied = noulOf(answers, 'applied'), specific = noulOf(answers, 'specific');
    // Subjective requests ("make it more like X", "better", "cooler") can be met many ways, so they're
    // flagged only when essentially nothing changed; specific ones get the full check.
    const subjective = specific != null && specific < 0.5;
    if (subjective) return { applied, specific, subjective, notApplied: diff.length === 0, why: 'Nothing changed for that request yet.', summary, diff: diff.length, provider };
    const why = 'Nothing changed for that request: this game\'s engine has no setting for it yet.';
    return { applied, specific, subjective, notApplied: applied != null && applied < notAppliedBar(provider), why, summary, diff: diff.length, provider };
  } catch { return { applied: null, summary, diff: diff.length, provider: null }; }
}

/**
 * Lists that got shorter between two content objects (top level and one level down), e.g. levels 8 → 1.
 * @param {unknown} before @param {unknown} after @param {string} [path] @param {number} [depth] @param {Shrunk[]} [out] @returns {Shrunk[]}
 */
export function shrunkLists(before, after, path = '', depth = 0, out = []) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return out;
  const next = /** @type {Record<string, unknown>} */ (after);
  for (const [k, a] of Object.entries(/** @type {Record<string, unknown>} */ (before))) {
    const b = next[k], p = path ? `${path}.${k}` : k;
    // Named items that disappeared count even when the list kept its length (renamed or replaced).
    const removed = Array.isArray(a) && Array.isArray(b) && identityList(a, b) ? a.map(keyOf).filter(id => !b.some(x => keyOf(x) === id)) : [];
    if (Array.isArray(a) && Array.isArray(b) && (b.length < a.length || removed.length)) out.push({ path: p, before: a.length, after: b.length, ...(removed.length ? { removed } : {}) });
    else if (depth < 1 && a && typeof a === 'object' && !Array.isArray(a)) shrunkLists(a, b, p, depth + 1, out);
  }
  return out;
}

const REMOVE_QUESTION = 'Does the request explicitly ask for fewer of these items, or to merge them into one? Answer yes only when the request itself says fewer, less, one, only, remove or similar about them. Answer no when the request is about something else, such as size, speed, looks or a new feature, even if fewer items would be one way to do it.';
const REMOVE_WORDS = /\b(fewer|less|remove|delete|drop|cut|shorter|smaller|reduce|only|just one|single|one level|no more)\b/i;
/**
 * Does the change request ask to remove or reduce these lists? Decision model when available, words otherwise.
 * @param {Decisions | null | undefined} decisions @param {string | null | undefined} change @param {Shrunk[]} shrunk @returns {Promise<boolean>}
 */
export async function asksToRemove(decisions, change, shrunk) {
  if (!change) return false;
  if (decisions) {
    try {
      const { answers, provider } = await decisions.decide({ state: { request: change, shrank: shrunk.map(s => `${s.path}: ${s.before} → ${s.after}${s.removed ? ` (removed ${s.removed.join(', ')})` : ''}`) }, questions: { remove: { type: 'noul', instructions: REMOVE_QUESTION } } });
      // Providers are calibrated differently: on 6 clear cases d1 needed 0.9 to get all right ("make it
      // faster" scored 0.88), OpenAI Decisions separated them at 0.5 (0.04 vs 0.98+).
      const remove = noulOf(answers, 'remove');
      if (remove != null) return remove >= (provider === 'd1' ? 0.9 : 0.5);
    } catch {}
  }
  return REMOVE_WORDS.test(change);
}

/**
 * Does generated text reuse existing franchise names (games, companies, characters)? Generated
 * games keep genre mechanics but must use original names (KIT_CONTRACT.md). Returns the probability,
 * or null without a decision model.
 * @param {Decisions | null | undefined} decisions @param {unknown[]} names sent to the model as they are
 * @returns {Promise<{ p: number, flagged: boolean, provider: string } | null>}
 */
export async function usesFranchiseNames(decisions, names) {
  if (!decisions || !names.length) return null;
  try {
    const { answers, provider } = await decisions.decide({ state: { names }, questions: { franchise: { type: 'noul', instructions: 'Do any of these names use an existing video game, company or character name (for example Mario, Luigi, Sonic, Pokémon, Pac-Man, Zelda, Mortal Kombat, Tetris, Nintendo, Sega)? Original names that only evoke a style are fine.' } } });
    const p = noulOf(answers, 'franchise');
    // On six real titles, franchise names scored ≥ 0.97 on both providers; OpenAI Decisions also put
    // originals at 0.52 ("Feline Siege") and 0.94 (a fighter named "Shadow"), so its bar is higher.
    return p == null ? null : { p, flagged: p >= (provider === 'd1' ? 0.8 : 0.97), provider };
  } catch { return null; }
}
