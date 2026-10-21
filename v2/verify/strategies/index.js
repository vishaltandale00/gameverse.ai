// Strategy library: generic players ported from the retired kits. A document
// whose primitives declare game modes (card.mode, see
// v2/primitives/gameplay/modes-lib-mode.js) is played by the bots those modes
// name (card.mode.bot); otherwise strategies are selected by what the document
// provides (space capabilities, options, a board service or cell space, entity
// components, declared action spaces), never by genre.
// A strategy: { id, intent, requires: { capabilities?, options?, board? },
//   hints?: [primitive id prefixes that make it apply without probing],
//   group?: exclusive group (first applicable wins), modeOnly?: chosen only through a mode,
//   detect(ctx) → bool, run(ctx, opts) → { ok, proven, problems, metrics, exhaustive, budget } }.
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
import turnBoard from './turn-board.js';
import race from './race.js';
import striker from './striker.js';
import story from './story.js';
import crawl from './crawl.js';
import { stagesStrategy } from './stages.js';
import { boardOf, untilDecision } from './common.js';
import { threats, velOf, foes } from '../drive.js';
import { modesIn } from '../../primitives/gameplay/modes-lib-mode.js';

const GROUPS = { placement: 'board', expectimax: 'board', greedy: 'board' };
/** The registry, in priority order within each exclusive group. */
export const strategies = new Map();
export function register(strategy, { group } = {}) {
  if (!strategy?.id || typeof strategy.run !== 'function') throw Error('strategy needs id and run');
  strategies.set(strategy.id, { ...strategy, group: group ?? strategy.group ?? GROUPS[strategy.id] ?? null });
}
for (const s of [beam, placement, expectimax, greedy, dangerField, dodge, versus, aim, randomPolicy, balance]) register(s);
// Mode bots added with card.mode: chosen through the modes that name them, not by detection
// (detection keeps choosing among the strategies above for documents without modes).
const stages = stagesStrategy(id => strategies.get(id) || null, ctx => select(ctx, { modes: false }).chosen.map(c => c.s));
for (const s of [turnBoard, race, striker, story, crawl, stages]) register({ ...s, modeOnly: true });

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

/**
 * Bots named by the document's modes, once each: [{ s, reason, mode }]. A wrapper mode
 * (stage sequences) plays the modes it wraps, so when one is present only wrapper bots run.
 */
export function modeBots(ctx) {
  const found = modesIn(ctx.doc, ctx.registry).filter(m => strategies.has(m.mode.bot));
  const wrappers = found.filter(m => m.mode.wraps), list = wrappers.length ? wrappers : found, out = [];
  for (const m of list) if (!out.some(x => x.s.id === m.mode.bot)) out.push({ s: strategies.get(m.mode.bot), reason: `mode '${m.mode.loop}' (${m.use})`, mode: m });
  return out;
}

/**
 * Strategies that apply to a document. The bots its modes name come first and replace
 * detection; without modes (or with modes: false), detection honoring exclusive groups.
 * `only` is an allow-list of strategy ids for both.
 */
export function select(ctx, { only = null, modes = true } = {}) {
  const chosen = [], groups = new Set(), skipped = {};
  if (modes) {
    const bots = modeBots(ctx).filter(x => !only || only.includes(x.s.id));
    if (bots.length) {
      for (const s of strategies.values()) if (!bots.some(x => x.s.id === s.id)) skipped[s.id] = 'the document\'s modes name their bots';
      return { chosen: bots.map(({ s, reason }) => ({ s, reason })), skipped };
    }
  }
  for (const s of strategies.values()) {
    if (only && !only.includes(s.id)) continue;
    if (s.modeOnly) { skipped[s.id] = 'chosen only through a mode'; continue; }
    if (s.group && groups.has(s.group)) { skipped[s.id] = `group '${s.group}' already chosen`; continue; }
    const a = applicability(s, ctx);
    if (!a.applies) { skipped[s.id] = a.reason; continue; }
    chosen.push({ s, reason: a.reason });
    if (s.group) groups.add(s.group);
  }
  return { chosen, skipped };
}

export { placement, expectimax, greedy, dangerField, dodge, beam, versus, aim, randomPolicy, balance, turnBoard, race, striker, story, crawl, stages };
