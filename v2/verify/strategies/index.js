// Strategy library: generic players ported from the retired kits, selected
// by what a document provides (space capabilities, options, a board service
// or cell space, entity components, declared action spaces), never by genre.
// A strategy: { id, intent, requires: { capabilities?, options?, board? },
//   hints?: [primitive id prefixes that make it apply without probing],
//   group?: exclusive group (first applicable wins), detect(ctx) → bool,
//   run(ctx, opts) → { ok, proven, problems, metrics, exhaustive, budget } }.
// register() adds strategies from other workstreams.
import placement from './placement.js';
import expectimax from './expectimax.js';
import greedy from './greedy.js';
import dangerField from './danger-field.js';
import dodge from './dodge.js';
import beam from './beam.js';
import versus from './versus.js';
import aim from './aim.js';
import randomPolicy from './random-policy.js';
import balance from './balance.js';
import { boardOf, untilDecision } from './common.js';
import { threats, velOf, foes } from '../drive.js';

const GROUPS = { placement: 'board', expectimax: 'board', greedy: 'board' };
/** The registry, in priority order within each exclusive group. */
export const strategies = new Map();
export function register(strategy, { group } = {}) {
  if (!strategy?.id || typeof strategy.run !== 'function') throw Error('strategy needs id and run');
  strategies.set(strategy.id, { ...strategy, group: group ?? strategy.group ?? GROUPS[strategy.id] ?? null });
}
for (const s of [beam, placement, expectimax, greedy, dangerField, dodge, versus, aim, randomPolicy, balance]) register(s);

// Narrow the overlapping real-time detectors so each document gets the right player:
// dodge = many moving threats or threats without health (bullets, rocks); versus = a few AI opponents with health.
const dodgeDetect = dodge.detect, versusDetect = versus.detect;
strategies.get('dodge').detect = ctx => {
  if (!dodgeDetect(ctx)) return false;
  const rt = ctx.make(ctx.seed);
  for (let i = 0; i < 30; i++) rt.step({});
  const t = threats(rt).filter(e => velOf(e).some(v => v !== 0));
  return t.length >= 4 || t.some(e => !e.components.health);
};
strategies.get('versus').detect = ctx => versusDetect(ctx) && foes(ctx.make(ctx.seed)).filter(e => e.components.ai).length <= 3;

/** Why a strategy does or doesn't apply: { applies, reason }. */
export function applicability(s, ctx) {
  const caps = new Set(ctx.capabilities?.[ctx.playerSpace] || []);
  const missing = (s.requires?.capabilities || []).filter(c => !caps.has(c));
  if (missing.length) return { applies: false, reason: `space lacks ${missing.join(', ')}` };
  if (s.requires?.options || s.requires?.board) {
    const rt = ctx.make(ctx.seed); untilDecision(rt, 600);
    if (s.requires.options && !rt.availableOptions().length) return { applies: false, reason: 'no options' };
    if (s.requires.board && !boardOf(rt)) return { applies: false, reason: 'no board service or cell space' };
  }
  if ((s.hints || []).some(h => [...ctx.used].some(id => id === h || id.startsWith(h + '.')))) return { applies: true, reason: 'primitive present' };
  try { return s.detect?.(ctx) ? { applies: true, reason: 'detected' } : { applies: false, reason: 'not detected' }; }
  catch (error) { return { applies: false, reason: `detect threw: ${error?.message || error}` }; }
}

/** Strategies that apply to a document, honoring exclusive groups and an optional allow-list. */
export function select(ctx, { only = null } = {}) {
  const chosen = [], groups = new Set(), skipped = {};
  for (const s of strategies.values()) {
    if (only && !only.includes(s.id)) continue;
    if (s.group && groups.has(s.group)) { skipped[s.id] = `group '${s.group}' already chosen`; continue; }
    const a = applicability(s, ctx);
    if (!a.applies) { skipped[s.id] = a.reason; continue; }
    chosen.push({ s, reason: a.reason });
    if (s.group) groups.add(s.group);
  }
  return { chosen, skipped };
}

export { placement, expectimax, greedy, dangerField, dodge, beam, versus, aim, randomPolicy, balance };
