// Legacy 2D arcade builder (v2/engine prototype): a schema-constrained design ->
// deterministic level build -> preflight + playtest, rebuilt with new layout
// seeds when unwinnable. Retired from the studio's default flow, which now
// builds kernel documents (planner/kernel-pipeline.js); kept for the prototype
// engine's tests and for replaying stored arcade games.
import { defaultRegistry } from '../modules/index.js';
import { DESIGN_SCHEMA, DESIGN_PROMPT, designToSpec } from './design.js';
import { checkArcade } from './arcade-pipeline.js';

export const DESIGN_PIPELINE_VERSION = 'v2-design/0.1';

export function designRequest({ prompt, answers, previousDesign, change }) {
  const parts = [previousDesign ? `Current design:\n${JSON.stringify(previousDesign)}\n\nChange request: ${change}\nKeep everything the request doesn't mention.` : `Game idea: ${prompt}`];
  if (answers?.length) parts.push('Player preferences:\n' + answers.map(a => `- ${a.question}: ${a.answer}`).join('\n'));
  return parts.join('\n\n');
}

/** Build and verify a spec from a design, retrying layouts deterministically. */
export function buildVerified(design, { seed, registry = defaultRegistry(), attempts = 4 }) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const spec = designToSpec(design, { seed, attempt });
    // Longer levels need longer searches: ~25 ms per column, 1.5–4 s.
    const check = checkArcade(spec, registry, { budgetMs: Math.min(4000, Math.max(1500, 25 * spec.level.rows[0].length)) });
    last = { spec, check, attempt };
    if (check.ok) return last;
  }
  // "Collect everything" that the playtester can't verify falls back to reaching the goal, and says so.
  if (design.mechanics?.collectAllToWin) {
    const relaxed = buildVerified({ ...design, mechanics: { ...design.mechanics, collectAllToWin: false } }, { seed, registry, attempts });
    if (relaxed.check.ok) return { ...relaxed, relaxed: ['collectAllToWin'] };
  }
  return last;
}
