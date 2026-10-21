// Driving a runtime the way solvers and playtesters do: options (with macro
// apply), held input, settling, and replay of recorded paths. Also the
// observation helpers every strategy shares (positions, health, threats), all
// read through documented component fields and space capabilities only.
import { createWorld } from '../kernel/world.js';
import { touchDefeats } from '../primitives/gameplay/combat-lib.js';

/** A factory of fresh headless worlds for one normalized document. */
export function maker(doc, registry, logic) {
  return (seed) => createWorld(doc, registry, logic, { seed, headless: true });
}

const playing = rt => rt.state.status === 'playing';

/** Step `n` frames with `input`; counts steps on the budget. Returns frames actually stepped. */
export function hold(rt, input, n = 1, b = null) {
  let k = 0;
  for (; k < n && playing(rt); k++) rt.step(input);
  b?.step(k);
  return k;
}

/**
 * Apply one option: `apply(rt)` macros run first; then `actions` are stepped
 * `steps` times (default 1); an option with only `steps` steps empty input.
 */
export function applyOption(rt, option, b = null) {
  const before = rt.state.frame;
  if (typeof option.apply === 'function') option.apply(rt);
  if (option.actions || (!option.apply && !option.steps)) hold(rt, { actions: option.actions || {} }, option.steps || 1);
  else if (option.steps && playing(rt)) hold(rt, {}, option.steps);
  b?.step(Math.max(1, rt.state.frame - before));
}

/** Step empty input a few frames so systems react (beats fire, AI moves). */
export function settle(rt, n = 0, b = null) { return n > 0 ? hold(rt, {}, n, b) : 0; }

/** Stable label of an option within one state (labels should be unique; index breaks ties). */
export function optionLabels(options) {
  const seen = new Map();
  return options.map(o => { const base = o.label ?? JSON.stringify(o.actions ?? {}); const n = seen.get(base) || 0; seen.set(base, n + 1); return n ? `${base}#${n}` : base; });
}

/**
 * Replay a path of option labels from a fresh world. Steps not matching any
 * current option are reported. Returns { rt, ok, at }.
 */
export function replayOptions(make, seed, path, settleSteps = 0) {
  const rt = make(seed);
  settle(rt, settleSteps);
  for (let i = 0; i < path.length; i++) {
    if (!playing(rt)) return { rt, ok: false, at: i };
    const options = rt.availableOptions(), labels = optionLabels(options), j = labels.indexOf(path[i]);
    if (j < 0) return { rt, ok: false, at: i };
    applyOption(rt, options[j]); settle(rt, settleSteps);
  }
  return { rt, ok: true, at: path.length };
}

/** Replay a raw input script [{input, frames}] from a fresh world. */
export function replayInputs(make, seed, script) {
  const rt = make(seed);
  for (const { input, frames = 1 } of script) hold(rt, input, frames);
  return rt;
}

// ---------- observation ----------

export const player = rt => rt.player();
/** The player's position in its space (zone id, cell or vector). */
export const posOf = (rt, e = rt.player()) => (e?.space ? (rt.space(e.space).pos?.(e) ?? e.at) : e?.at ?? null);

/** Hit points of an entity: components.health.{hp|current|value} or a number; null if it has none. */
export function hpOf(e) {
  const h = e?.components?.health;
  if (h == null) return null;
  if (typeof h === 'number') return h;
  for (const k of ['hp', 'current', 'value']) if (typeof h[k] === 'number') return h[k];
  return null;
}
export const maxHpOf = e => { const h = e?.components?.health; return h && typeof h === 'object' ? (h.max ?? h.hpMax ?? null) : null; };

/** Player vitality: hp from its health component, else the `hp` var; lives var counts too. */
export function vitality(rt) {
  const p = rt.player();
  const hp = hpOf(p) ?? rt.state.vars.hp ?? null;
  const lives = rt.state.vars.lives ?? null;
  return { hp, lives, alive: Boolean(p) && (hp === null || hp > 0) && rt.state.status !== 'lost' };
}

/** Entities that threaten the player: an ai/attacks/hazard component, unless touching it defeats it or it is dazed (harmless, combat-health). */
export function threats(rt, e = rt.player()) {
  return Object.values(rt.state.entities).filter(o => o !== e && o.space === e?.space && (o.components.ai || o.components.attacks || o.components.hazard) && !isVulnerable(rt, o) && !(o.components.health?.stun > 0 && o.components.health.stunKind === 'dazed'));
}
/** Prey: touching it defeats it (combat-lib touchDefeats, the one definition the runtime uses). */
export function isVulnerable(rt, o) { return touchDefeats(rt, o); }
/** Non-player entities with health in the player's space (opponents, targets). */
export const foes = (rt, e = rt.player()) => Object.values(rt.state.entities).filter(o => o !== e && o.space === e?.space && hpOf(o) !== null);
/** Entities the player gains by touching: collectible/pickup components. */
export const collectibles = (rt, e = rt.player()) => Object.values(rt.state.entities).filter(o => o !== e && o.space === e?.space && (o.components.collectible || o.components.pickup));

/** Velocity of an entity: components.body.vel or [0,0,0]. */
export const velOf = e => { const v = e?.components?.body?.vel; return Array.isArray(v) ? v : [0, 0, 0]; };

/** Directional input macros for continuous/cell spaces: idle + 8 axis directions. */
export const DIRS8 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Generic input macros when a document exposes no options: idle, axis moves,
 * each action verb alone and with a move. `verbs` defaults to rt.actions().
 */
export function inputMacros(rt, { verbs = rt.actions(), axes = true, combos = true } = {}) {
  const out = [{ label: 'idle', input: {} }];
  if (axes) for (const [x, y] of DIRS8.slice(1)) out.push({ label: `move ${x},${y}`, input: { axes: { move: [x, y] } } });
  for (const v of verbs) {
    out.push({ label: v, input: { actions: { [v]: true } } });
    if (combos && axes) for (const [x, y] of [[1, 0], [-1, 0]]) out.push({ label: `${v}+${x},${y}`, input: { actions: { [v]: true }, axes: { move: [x, y] } } });
  }
  return out;
}

/** True if the space bound to the player provides a capability method set. */
export const spaceHas = (rt, method, e = rt.player()) => Boolean(e?.space && typeof rt.space(e.space)[method] === 'function');
