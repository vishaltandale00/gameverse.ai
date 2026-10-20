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
