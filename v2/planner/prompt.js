// @ts-check
// Spec-writer prompt. Everything here is stable across requests (cards,
// rules, examples) so it is prompt-cached; only the user turn varies.
import { SPEC_SCHEMA, LIMITS } from '../engine/spec.js';

/**
 * An arcade module tunable (engine/registry.js): a numeric range or a typed string/boolean option.
 * @typedef {{ type?: string, options?: string[], default?: unknown, min?: number, max?: number, unit?: string, effect?: string }} ArcadeTunable
 */
/**
 * An arcade module card as engine/registry.js `cards()` lists it.
 * @typedef {{ id: string, intent?: string, phase?: string, tunables?: Record<string, ArcadeTunable>, provides?: object, requires?: object, conflicts?: string[] }} ArcadeCard
 */
/** @typedef {{ cards(): ArcadeCard[] }} ArcadeRegistry */
/** A failed check, as engine/spec.js preflight and checkArcade report it. @typedef {{ code: string, path?: string, message: string, hint?: string }} ArcadeProblem */

/** @param {ArcadeCard} card */
function compactCard({ id, intent, phase, tunables = {}, provides = {}, requires = {}, conflicts = [] }) {
  const t = Object.fromEntries(Object.entries(tunables).map(([k, v]) => [k, v.type
    ? `${v.type}${v.options ? ' ' + v.options.join('|') : ''} = ${JSON.stringify(v.default)} — ${v.effect}`
    : `${v.default} [${v.min}..${v.max}] ${v.unit || ''} — ${v.effect}`]));
  return { id, intent, phase, tunables: t, provides, requires, ...(conflicts.length ? { conflicts } : {}) };
}

/** @param {ArcadeRegistry} registry @param {unknown[]} examples example specs, read from disk @returns {string} */
export function systemPrompt(registry, examples) {
  return `You design small, fun 2D games for Gameverse. A player describes an idea; you answer with a game spec that the engine runs immediately.

Reply with one JSON object and nothing else:
{"summary": "<one sentence on what you made>", "spec": <game spec>, "gaps": [{"capability": "<mechanic the library lacks>", "why": "<how the idea needs it>"}]}

Game spec rules (schema "${SPEC_SCHEMA}"):
- id: lowercase slug. title: short and evocative. pitch: one line.
- level.rows: ASCII rows of equal length, at most ${LIMITS.maxColumns} wide and ${LIMITS.maxRows} tall. '.' is empty space. Every other character must be in level.legend, which maps a character to an entity kind.
- entities: kinds keyed by lowercase slug. {"solid": true, "color": "#hex"} makes static tiles. Other kinds are entities with "tags", a "glyph" (one emoji), an optional "color", and optional "w"/"h" in tiles (default 0.8).
- Exactly one entity kind is tagged "player" and placed once. Modules find entities by tag (collectible, enemy, hazard, goal, …; module tunables can rename the tag).
- modules: ordered [{"use": "<module id>", "with": {tunable: value}}]. Use only the modules and tunables below, with values inside their ranges. Omit a tunable to keep its default.
- win (required) and lose (optional) are predicates over module vars or event counts: {"var": "remaining", "lte": 0}, {"count": "reach_goal", "gte": 1}, or {"all": [...]} / {"any": [...]}. Only reference vars/events that a chosen module provides. Falling off the bottom of the level always loses.
- Units are tiles and seconds. Side-view jump height ≈ jumpSpeed² / (2 × gravity) tiles; keep every platform, pickup and goal reachable with the jump you configure. Leave headroom above platforms, and floor or pits under the player's start.
- Design a real level, not a sketch: 60–120 columns and 12–20 rows (top-down: 40–80 × 20–40), with 3–4 distinct sections that escalate (a safe opening, a challenge section, a gauntlet, a finale near the goal). Use vertical variety (platforms at several heights, pits, ledges, hidden pickups), 15–40 pickups, 6–20 enemies or hazards placed with intent, and rows of equal length.
- Make it look like the idea: pick a fitting emoji glyph for every non-solid kind, distinct solid-tile colors (2–4 solid kinds for ground, platforms, walls), and a background color that sets the mood.
- Tune the feel to the idea with tunables (fast and floaty, heavy and precise, slippery, etc.). Never place the player touching an enemy, hazard or goal.

If the idea needs a mechanic no module covers, build the closest playable version from existing modules and list the missing mechanic in "gaps" (an empty list when nothing is missing).
If a previous spec is given, change only what the request asks for and keep the rest.

Modules:
${JSON.stringify(registry.cards().map(compactCard))}

Example specs:
${examples.map(e => JSON.stringify(e)).join('\n')}`;
}

/** @param {string} prompt @param {unknown} [previous] the previous spec, if any @returns {string} */
export function createMessage(prompt, previous) {
  return previous
    ? `Previous spec:\n${JSON.stringify(previous)}\n\nChange request: ${prompt}`
    : `Game idea: ${prompt}`;
}

/** @param {ArcadeProblem[]} problems @returns {string} */
export function repairMessage(problems) {
  return `That spec failed checks. Fix every problem and reply with the complete corrected JSON object (same shape: summary, spec, gaps).\nProblems:\n${problems.map(p => `- [${p.code}] ${p.path ? p.path + ': ' : ''}${p.message}${p.hint ? ' (hint: ' + p.hint + ')' : ''}`).join('\n')}`;
}
