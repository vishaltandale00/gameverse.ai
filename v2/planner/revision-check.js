// Did a change request actually happen? Used by every game type after a revision.
// A decision model reads the request and a diff of what changed. A change the
// engine can't really make ("bigger map" faked by switching maze styles) is
// reported as not possible yet instead of being passed off as done, and the
// player sees a plain summary of what did change.

/** Paths whose values differ between two JSON values, e.g. "levels[2].maze.style: classic → sprawling". */
const keyOf = x => x && typeof x === 'object' && !Array.isArray(x) ? (typeof x.id === 'string' && x.id) || (typeof x.name === 'string' && x.name) || null : null;
/** Lists of named things (fighters, levels with ids) are compared by identity, not position. */
const identityList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length && b.length && a.every(keyOf) && b.every(keyOf);

export function contentDiff(a, b, path = '', out = []) {
  if (out.length >= 40 || JSON.stringify(a) === JSON.stringify(b)) return out;
  if (identityList(a, b)) {
    const before = new Map(a.map(x => [keyOf(x), x])), after = new Map(b.map(x => [keyOf(x), x]));
    const added = [...after.keys()].filter(k => !before.has(k)), removed = [...before.keys()].filter(k => !after.has(k));
    if (added.length) out.push(`${path}: added ${added.join(', ')}`);
    if (removed.length) out.push(`${path}: removed ${removed.join(', ')}`);
    for (const [k, x] of after) if (before.has(k)) contentDiff(before.get(k), x, `${path}[${k}]`, out);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) out.push(`${path || '$'}: ${a.length} items → ${b.length} items`);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) contentDiff(a[k], b[k], Array.isArray(a) ? `${path}[${k}]` : path ? `${path}.${k}` : k, out);
    return out;
  }
  const show = v => typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v)?.slice(0, 40);
  out.push(`${path}: ${show(a)} → ${show(b)}`);
  return out;
}

/** A short human summary of a diff: field names grouped, array indices collapsed. */
export function changeSummary(diff, limit = 4) {
  const groups = new Map();
  for (const line of diff) {
    const m = line.match(/^(?:content\.)?([^:]+): (added|removed) (.+)$/);
    if (m) { groups.set(`${m[2]} ${m[3]}`, 1); continue; }
    const field = line.split(':')[0].replace(/\[[^\]]+\]/g, '').replace(/^content\./, '').replace(/^mods\./, 'mods: ').replace(/^art\./, 'art: ');
    const words = field.split('.').slice(-2).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    groups.set(words, (groups.get(words) || 0) + 1);
  }
  return [...groups].slice(0, limit).map(([k, n]) => (n > 1 ? `${k} (${n})` : k));
}

// Below this, the change is treated as not done. 0.8 is deliberately strict: on real revisions d1
// put a faked "bigger map" at 0.65 and a real "make it faster" at 0.94 (OpenAI Decisions: 0.06, 0.95).
export const NOT_APPLIED = 0.8;
const INSTRUCTIONS = "Do these changes actually carry out the player's request, as the player would see it in the game? Answer no if the changes are only cosmetic, unrelated, or a stand-in for something the engine cannot really do (for example renaming something or switching a style when the request asks for a different size, a new mechanic or a new mode).";

/** { applied, why, summary, diff, provider } or null when there's nothing to check. */
export async function checkRevision(decisions, { change, engine, before, after, unsupported = [], originalStandIns = false }) {
  if (!change) return null;
  const diff = contentDiff(before, after), summary = changeSummary(diff);
  if (!decisions) return { applied: null, summary, diff: diff.length, provider: null };
  try {
    const { answers, provider } = await decisions.decide({
      state: { engine, request: change, changes: diff.length ? diff : ['nothing changed'], reportedUnsupported: unsupported.map(u => u.request), ...(originalStandIns ? { note: 'Games use original names: a request for an existing character is carried out by adding an original look-alike with a new name. That counts as doing it.' } : {}) },
      questions: { applied: { type: 'noul', instructions: INSTRUCTIONS } },
    });
    const applied = answers.applied?.noul ?? null;
    const why = diff.length ? `The engine may not be able to do that yet: the changes it made (${summary.join(', ')}) don't really do it.` : 'The engine may not be able to do that yet: nothing changed.';
    return { applied, why, summary, diff: diff.length, provider };
  } catch { return { applied: null, summary, diff: diff.length, provider: null }; }
}

/** Lists that got shorter between two content objects (top level and one level down), e.g. levels 8 → 1. */
export function shrunkLists(before, after, path = '', depth = 0, out = []) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return out;
  for (const [k, a] of Object.entries(before)) {
    const b = after[k], p = path ? `${path}.${k}` : k;
    // Named items that disappeared count even when the list kept its length (renamed or replaced).
    const removed = identityList(a, b) ? a.map(keyOf).filter(id => !b.some(x => keyOf(x) === id)) : [];
    if (Array.isArray(a) && Array.isArray(b) && (b.length < a.length || removed.length)) out.push({ path: p, before: a.length, after: b.length, ...(removed.length ? { removed } : {}) });
    else if (depth < 1 && a && typeof a === 'object' && !Array.isArray(a)) shrunkLists(a, b, p, depth + 1, out);
  }
  return out;
}

const REMOVE_QUESTION = 'Does the request explicitly ask for fewer of these items, or to merge them into one? Answer yes only when the request itself says fewer, less, one, only, remove or similar about them. Answer no when the request is about something else, such as size, speed, looks or a new feature, even if fewer items would be one way to do it.';
const REMOVE_WORDS = /\b(fewer|less|remove|delete|drop|cut|shorter|smaller|reduce|only|just one|single|one level|no more)\b/i;
/** Does the change request ask to remove or reduce these lists? Decision model when available, words otherwise. */
export async function asksToRemove(decisions, change, shrunk) {
  if (!change) return false;
  if (decisions) {
    try {
      const { answers, provider } = await decisions.decide({ state: { request: change, shrank: shrunk.map(s => `${s.path}: ${s.before} → ${s.after}${s.removed ? ` (removed ${s.removed.join(', ')})` : ''}`) }, questions: { remove: { type: 'noul', instructions: REMOVE_QUESTION } } });
      // Providers are calibrated differently: on 6 clear cases d1 needed 0.9 to get all right ("make it
      // faster" scored 0.88), OpenAI Decisions separated them at 0.5 (0.04 vs 0.98+).
      if (answers.remove?.noul != null) return answers.remove.noul >= (provider === 'd1' ? 0.9 : 0.5);
    } catch {}
  }
  return REMOVE_WORDS.test(change);
}

/**
 * Does generated text reuse existing franchise names (games, companies, characters)? Generated
 * games keep genre mechanics but must use original names (KIT_CONTRACT.md). Returns the probability,
 * or null without a decision model.
 */
export async function usesFranchiseNames(decisions, names) {
  if (!decisions || !names.length) return null;
  try {
    const { answers, provider } = await decisions.decide({ state: { names }, questions: { franchise: { type: 'noul', instructions: 'Do any of these names use an existing video game, company or character name (for example Mario, Luigi, Sonic, Pokémon, Pac-Man, Zelda, Mortal Kombat, Tetris, Nintendo, Sega)? Original names that only evoke a style are fine.' } } });
    const p = answers.franchise?.noul;
    // On six real titles, franchise names scored ≥ 0.97 on both providers; OpenAI Decisions also put
    // originals at 0.52 ("Feline Siege") and 0.94 (a fighter named "Shadow"), so its bar is higher.
    return p == null ? null : { p, flagged: p >= (provider === 'd1' ? 0.8 : 0.97), provider };
  } catch { return null; }
}
