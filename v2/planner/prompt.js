// Spec-writer prompt. Everything here is stable across requests (cards,
// rules, examples) so it is prompt-cached; only the user turn varies.
import { SPEC_SCHEMA, LIMITS } from '../engine/spec.js';

function compactCard({ id, intent, phase, tunables = {}, provides = {}, requires = {}, conflicts = [] }) {
  const t = Object.fromEntries(Object.entries(tunables).map(([k, v]) => [k, v.type
    ? `${v.type}${v.options ? ' ' + v.options.join('|') : ''} = ${JSON.stringify(v.default)} — ${v.effect}`
    : `${v.default} [${v.min}..${v.max}] ${v.unit || ''} — ${v.effect}`]));
  return { id, intent, phase, tunables: t, provides, requires, ...(conflicts.length ? { conflicts } : {}) };
}

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

export function createMessage(prompt, previous) {
  return previous
    ? `Previous spec:\n${JSON.stringify(previous)}\n\nChange request: ${prompt}`
    : `Game idea: ${prompt}`;
}

export function repairMessage(problems) {
  return `That spec failed checks. Fix every problem and reply with the complete corrected JSON object (same shape: summary, spec, gaps).\nProblems:\n${problems.map(p => `- [${p.code}] ${p.path ? p.path + ': ' : ''}${p.message}${p.hint ? ' (hint: ' + p.hint + ')' : ''}`).join('\n')}`;
}
