// Driving a runtime the way solvers and playtesters do: options (with macro
// apply), held input, settling, and replay of recorded paths. Also the
// observation helpers every strategy shares (positions, health, threats), all
// read through documented component fields and space capabilities only.
import { createWorld } from '../kernel/world.js';
import { touchDefeats } from '../primitives/gameplay/combat-lib.js';
import { ControlsMissing } from './controls.js';

/** A factory of fresh headless worlds for one normalized document. */
export function maker(doc, registry, logic) {
  return (seed) => createWorld(doc, registry, logic, { seed, headless: true });
}

const playing = rt => rt.state.status === 'playing';

/** Step `n` frames with `input` (a metered runtime counts them on its budget: util.js budget.meter). Returns frames actually stepped. */
export function hold(rt, input, n = 1) {
  let k = 0;
  for (; k < n && playing(rt); k++) rt.step(input);
  return k;
}

/**
 * Hold a person's input for `n` frames: a press goes down on the first frame and stays down (held) for the rest, a
 * value sent through a UI is sent once, and axes and held verbs stay as given. Holding `{ actions }` itself for n
 * frames would press the key again every frame, which no hand does. Returns frames actually stepped.
 */
export function holdInput(rt, input, n = 1) {
  if (n <= 0) return 0;
  const k = hold(rt, input, 1);
  if (n === 1 || !k) return k;
  const held = { ...(input.held || {}) };
  for (const [v, x] of Object.entries(input.actions || {})) if (x === true) held[v] = true;
  return k + hold(rt, { ...(input.axes ? { axes: input.axes } : {}), ...(Object.keys(held).length ? { held } : {}) }, n - 1);
}

/**
 * Apply one option: `apply(rt)` macros run first; then `actions` are stepped
 * `steps` times (default 1); an option with only `steps` steps empty input.
 * On a controlled runtime (v2/verify/controls.js) an option is a hint of what a person can do: its actions are issued
 * through the controls (the keys go down on the first frame and stay down for its steps; values chosen through a UI
 * are sent once) and its `apply` macro is never run; an option whose only content is a macro is not something a
 * person can do (ControlsMissing).
 */
export function applyOption(rt, option) {
  if (rt.controls) {
    const actions = option.actions || {}, verbs = Object.keys(actions).filter(v => actions[v] !== undefined && actions[v] !== null && actions[v] !== false);
    if (!verbs.length && typeof option.apply === 'function') throw new ControlsMissing([{ verb: option.label ?? 'option', why: 'the option is a macro (apply) and issues no action' }]);
    const n = option.steps || 1;
    hold(rt, { actions }, 1);
    const held = Object.fromEntries(verbs.filter(v => actions[v] === true).map(v => [v, true]));
    if (n > 1) hold(rt, Object.keys(held).length ? { held } : {}, n - 1);
    return;
  }
  if (typeof option.apply === 'function') option.apply(rt);
  if (option.actions || (!option.apply && !option.steps)) hold(rt, { actions: option.actions || {} }, option.steps || 1);
  else if (option.steps && playing(rt)) hold(rt, {}, option.steps);
}

/** Step empty input a few frames so systems react (beats fire, AI moves). */
export function settle(rt, n = 0) { return n > 0 ? hold(rt, {}, n) : 0; }

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

/**
 * The verbs a person presses (a key sends true): on a controlled runtime (v2/verify/controls.js) the controls' own
 * list, so a bot never asks for a verb no key gives; else every action the runtime registers.
 */
export const pressableVerbs = rt => (rt.controls ? rt.controls.pressable() : rt.actions());

/** Directional input macros for continuous/cell spaces: idle + 8 axis directions. */
export const DIRS8 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Generic input macros when a document exposes no options: idle, each held axis in the eight directions, each action
 * verb alone and with a horizontal move. On a controlled runtime (v2/verify/controls.js) they are what a person has:
 * `verbs` defaults to the verbs a key presses and `axes` to every axis the bindings give a source (move, drive, steer,
 * aim...; mouse look excepted); else rt.actions() and the move axis. `axes: false` (or []) leaves the axes out.
 */
export function inputMacros(rt, { verbs = pressableVerbs(rt), axes = boundAxes(rt), combos = true } = {}) {
  const list = axes === true ? ['move'] : axes || [];
  const out = [{ label: 'idle', input: {} }];
  for (const a of list) for (const [x, y] of DIRS8.slice(1)) out.push({ label: `${a} ${x},${y}`, input: { axes: { [a]: [x, y] } } });
  for (const v of verbs) {
    out.push({ label: v, input: { actions: { [v]: true } } });
    if (combos && list.length) for (const [x, y] of [[1, 0], [-1, 0]]) out.push({ label: `${v}+${x},${y}`, input: { actions: { [v]: true }, axes: { [list[0]]: [x, y] } } });
  }
  return out;
}

/** The axes a person holds on a controlled runtime (bound to some source; mouse look excepted), move first; else ['move']. */
export function boundAxes(rt) {
  if (!rt.controls) return ['move'];
  const axes = Object.entries(rt.controls.controls.map?.axes || {}).filter(([a, src]) => a !== 'look' && (src || []).length).map(([a]) => a);
  return axes.sort((a, b) => (b === 'move') - (a === 'move'));
}

/** True if the space bound to the player provides a capability method set. */
export const spaceHas = (rt, method, e = rt.player()) => Boolean(e?.space && typeof rt.space(e.space)[method] === 'function');
