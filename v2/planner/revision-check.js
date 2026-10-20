// Did a change request actually happen? Used by every game type after a revision.
// A decision model reads the request and a diff of what changed. A change the
// engine can't really make ("bigger map" faked by switching maze styles) is
// reported as not possible yet instead of being passed off as done, and the
// player sees a plain summary of what did change.

/** Paths whose values differ between two JSON values, e.g. "levels[2].maze.style: classic → sprawling". */
export function contentDiff(a, b, path = '', out = []) {
  if (out.length >= 40 || JSON.stringify(a) === JSON.stringify(b)) return out;
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
    const field = line.split(':')[0].replace(/\[\d+\]/g, '').replace(/^content\./, '').replace(/^mods\./, 'mods: ');
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
export async function checkRevision(decisions, { change, engine, before, after, unsupported = [] }) {
  if (!change) return null;
  const diff = contentDiff(before, after), summary = changeSummary(diff);
  if (!decisions) return { applied: null, summary, diff: diff.length, provider: null };
  try {
    const { answers, provider } = await decisions.decide({
      state: { engine, request: change, changes: diff.length ? diff : ['nothing changed'], reportedUnsupported: unsupported.map(u => u.request) },
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
    if (Array.isArray(a) && Array.isArray(b) && b.length < a.length) out.push({ path: p, before: a.length, after: b.length });
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
      const { answers, provider } = await decisions.decide({ state: { request: change, shrank: shrunk.map(s => `${s.path}: ${s.before} → ${s.after}`) }, questions: { remove: { type: 'noul', instructions: REMOVE_QUESTION } } });
      // Providers are calibrated differently: on 6 clear cases d1 needed 0.9 to get all right ("make it
      // faster" scored 0.88), OpenAI Decisions separated them at 0.5 (0.04 vs 0.98+).
      if (answers.remove?.noul != null) return answers.remove.noul >= (provider === 'd1' ? 0.9 : 0.5);
    } catch {}
  }
  return REMOVE_WORDS.test(change);
}
