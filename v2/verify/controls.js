// The headless input driver (ARCHITECTURE.md §6.3): playtest bots play a game only through the controls a person has.
//
// A person has two channels, and so does the driver:
//   - devices: keys, gamepad buttons and sticks, the mouse. Their state is turned into kernel input by the same
//     engine.input.actions bindings the host mounts (v2/web/host-doc.js: the published document plus the host's input
//     defaults) and the same sampler the browser uses (runtime-lib-input.js compile + sample, the view hostView picks);
//   - UI primitives: a UI primitive the host mounts that declares a verb in its card.controls sends it through
//     view.act, which the host merges into the next step's actions (player.js tick); graphics.ui.choices
//     (controls.choice) issues every choice verb no other mounted UI names.
// A bot states what it does as an intent in kernel-input shape ({ axes: { move: [x, y] }, actions: { verb: value },
// held: { verb: true } }); the driver turns it into the device state a person would produce (the keys the controls
// card shows for each verb, the axis keys or stick for a held axis) plus the UI actions, samples the devices, and steps
// the world with the result. Each step is one sample: the keys down this frame, and the ones that went down this frame
// (an action is a key going down; a held verb a key kept down). A verb, value or axis no control issues throws
// ControlsMissing (code controls_missing): a bot can never reach the game through a channel a person does not have.
import { createWorld } from '../kernel/world.js';
import { preflight } from '../kernel/document.js';
import { compile, sample, deviceOf, hostView, AXIS_KEYS } from '../primitives/engine/runtime-lib-input.js';
import { uiControls, choiceVerbs, verbControl, verbInstances, instanceVerbs } from '../primitives/engine/runtime-lib-controls.js';
import { cardLoop } from '../planner/loop.js';
import { hostDocument } from '../web/host-doc.js';

/** The input primitive: the device -> verb mapping a person's keys go through (its state is what the devices held, not the game). */
export const INPUT = 'engine.input.actions';
export const CONTROLS_VERSION = 'controls/0.1';

/** A verb, value or axis the intent asks for that no control a person has can issue. */
export class ControlsMissing extends Error {
  /** @param {Array<{ verb: string, value?: unknown, why: string }>} missing */
  constructor(missing) {
    super(`controls_missing: ${missing.map(m => `${m.verb}${m.value !== undefined && m.value !== true ? `=${JSON.stringify(m.value)}` : ''} (${m.why})`).join('; ')}`);
    this.code = 'controls_missing';
    this.missing = missing;
  }
}

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const digital = v => v === -1 || v === 0 || v === 1;

/**
 * The controls of a preflighted host document: the bindings of its primary view (compiled as the browser compiles
 * them) and the UI primitives that issue verbs through view.act.
 * @param {any} doc @param {any} registry
 */
export function controlsOf(doc, registry) {
  const cfg = (doc.systems || []).find(s => s.use === INPUT)?.with ?? null;
  const axisVerbs = new Set(cfg?.axes || []);
  const keymap = cfg ? compile(cfg.bindings || {}, axisVerbs) : {};
  const view = hostView(keymap, doc.views?.primary);
  const ui = uiControls(doc, registry);
  const choice = ui.choice.length ? new Set(choiceVerbs(doc, registry)) : new Set();
  return {
    view, map: view ? keymap[view] : null, cfg, axisVerbs, ui, choice,
    /** The UI primitive that issues `verb` through view.act, or null. */
    uiFor: verb => ui.verbs.get(verb)?.[0] ?? (choice.has(verb) && !ui.verbs.has(verb) ? ui.choice[0] : null),
  };
}

/** The keys (keyboard first) bound to `verb` sending `value` (undefined: any value) in a compiled view. */
function keysSending(map, verb, value) {
  const out = [];
  for (const [key, list] of Object.entries(map?.buttons || {})) if (list.some(b => b.verb === verb && (value === undefined || same(b.value, value)))) out.push(key);
  return out.sort((a, b) => (deviceOf(a) === 'keyboard' ? 0 : 1) - (deviceOf(b) === 'keyboard' ? 0 : 1));
}

/**
 * A driver over one runtime of a preflighted host document. input(intent) -> the kernel input a person's devices and
 * UI produce for it (throws ControlsMissing); missing(intent) -> what it asks for that no control issues.
 * @param {any} rt @param {any} registry
 */
export function driver(rt, registry) {
  const c = controlsOf(rt.doc, registry);
  const opts = { deadzone: c.cfg?.deadzone ?? 0.2, lookSensitivity: c.cfg?.lookSensitivity ?? 0.0025, lookRate: c.cfg?.lookRate ?? 3, invertY: Boolean(c.cfg?.invertY) };
  /** Device state and UI actions for an intent. */
  function device(intent = {}) {
    const dev = { down: new Set(), pressed: new Set(), mouse: { dx: 0, dy: 0 }, wheel: 0, sticks: { lstick: [0, 0], rstick: [0, 0] } };
    const acts = {}, missing = [];
    // An action whose verb is a bound input axis, with a vector value (an option's `move: [1, 0]`: what the movement
    // primitives read), is that axis held, as a person gives it; the other actions are presses or UI choices.
    /** @type {Record<string, unknown>} */
    const actions = {}, axes = { ...(intent.axes || {}) };
    for (const [verb, v] of Object.entries(intent.actions || {})) { if (Array.isArray(v) && c.axisVerbs.has(verb) && axes[verb] === undefined) axes[verb] = v; else actions[verb] = v; }
    for (const [verb, v] of Object.entries(axes)) {
      if (!Array.isArray(v) || (!v[0] && !v[1])) continue;
      const sources = c.map?.axes?.[verb] || [];
      const [x, y] = v;
      const keys = sources.find(s => AXIS_KEYS[s]);
      if (digital(x) && digital(y) && keys) {
        const k = AXIS_KEYS[keys];
        if (x > 0) dev.down.add(k.right); if (x < 0) dev.down.add(k.left); if (y > 0) dev.down.add(k.up); if (y < 0) dev.down.add(k.down);
      } else if (verb === 'look' && sources.includes('mouse')) { dev.mouse.dx += x / opts.lookSensitivity; dev.mouse.dy += -y / opts.lookSensitivity * (opts.invertY ? -1 : 1); }
      else if (verb !== 'look' && sources.includes('lstick')) dev.sticks.lstick = [x, -y];
      else missing.push({ verb, value: v, why: sources.length ? 'no source of its bindings gives this value' : 'the axis is not bound' });
    }
    for (const [verb, v] of Object.entries(intent.held || {})) {
      if (!v) continue;
      const keys = keysSending(c.map, verb);
      if (keys.length) dev.down.add(keys[0]);
      else if (!c.uiFor(verb)) missing.push({ verb, why: 'no key holds it' });
    }
    // A UI that issues choices from the game's options (controls.choice) sends an option's whole actions record, so an
    // intent carrying one of its verbs goes to it whole, the press verbs with it, in the record's order.
    const record = Object.entries(actions).filter(([, v]) => v !== undefined && v !== null && v !== false);
    // A UI that lists the game's options (controls.options: the story's choices) sends one's whole actions record.
    if (record.length && c.ui.options.length && rt.availableOptions().some(o => same(o.actions, intent.actions))) { for (const [verb, v] of record) acts[verb] = v; return { dev, acts, missing }; }
    const viaChoice = record.some(([verb, v]) => { const u = c.uiFor(verb); return u && c.ui.choice.includes(u) && !keysSending(c.map, verb, v).length; });
    if (viaChoice) { for (const [verb, v] of record) acts[verb] = v; return { dev, acts, missing }; }
    for (const [verb, v] of Object.entries(actions)) {
      if (v === undefined || v === null || v === false) continue;
      const keys = keysSending(c.map, verb, v);
      if (keys.length) { dev.down.add(keys[0]); dev.pressed.add(keys[0]); continue; }
      if (c.uiFor(verb)) { acts[verb] = v; continue; }
      missing.push({ verb, value: v, why: keysSending(c.map, verb).length ? 'no key sends this value and no UI issues it' : 'no key is bound to it and no UI issues it' });
    }
    return { dev, acts, missing };
  }
  /**
   * The two channels of an intent: `device`, the kernel input sampled from the devices as the browser samples them
   * (what the host reads through view.input), and `ui`, the actions mounted UI primitives send through view.act.
   */
  function parts(intent) {
    const { dev, acts, missing } = device(intent);
    if (missing.length) throw new ControlsMissing(missing);
    return { device: sample(c.map, dev, { ...opts, dt: rt.dt }), ui: acts };
  }
  return {
    controls: c,
    missing: intent => device(intent).missing,
    parts,
    /** The kernel input for an intent: the devices' sample plus the UI actions, merged as the host merges them. */
    input(intent) {
      const { device: live, ui } = parts(intent);
      return { ...live, actions: { ...live.actions, ...ui } };
    },
    /** The key names the controls card shows for a verb (bindings of the primary view). */
    keysFor: verb => c.map?.keys?.[verb] || [],
    /** The values the keys bound to `verb` send ([true] for a press, each value of a value map), in binding order. */
    presses(verb) { const out = []; for (const list of Object.values(c.map?.buttons || {})) for (const b of list) if (b.verb === verb && !out.some(x => same(x, b.value))) out.push(b.value); return out; },
    /** The verbs a key presses (sends true), in binding order: what a person can press. */
    pressable: () => Object.keys(c.map?.keys || {}).filter(v => keysSending(c.map, v, true).length),
  };
}

/**
 * Make a runtime controlled: every rt.step(intent) goes through the driver, so nothing reaches the world but what a
 * person's devices and UI issue. rt.controls is the driver.
 */
export function controlled(rt, registry) {
  const d = driver(rt, registry), step = rt.step.bind(rt), read = rt.availableOptions.bind(rt), extend = rt.extend.bind(rt);
  const snapshot = rt.snapshot.bind(rt), restore = rt.restore.bind(rt);
  // The options of a state, read once per state: a bot reads them to decide and the driver again to send a listed
  // option's record when it steps, and a lookahead restores one snapshot for every option it tries. A world's state
  // changes by step, restore and extend (and a bot re-seeding the RNG it samples chances with), so a read is kept until
  // one of those, and with the snapshot the state is a copy of (taken or restored, nothing stepped since), so restoring
  // it again finds them. Callers get their own array.
  /** @type {{ frame: number, rng: unknown, options: any[] } | null} */
  let memo = null;
  /** @type {object | null} the snapshot the state is a copy of */
  let from = null;
  const bySnap = new WeakMap();
  const valid = () => memo !== null && memo.frame === rt.state.frame && memo.rng === rt.state.rng;
  const forget = () => { memo = null; from = null; };
  rt.availableOptions = () => {
    if (!valid()) { memo = { frame: rt.state.frame, rng: rt.state.rng, options: read() }; if (from) bySnap.set(from, memo); }
    return /** @type {{ options: any[] }} */ (memo).options.slice();
  };
  rt.snapshot = () => { const snap = snapshot(); from = snap; if (valid()) bySnap.set(snap, memo); return snap; };
  rt.restore = snap => { restore(snap); from = snap; memo = bySnap.get(snap) ?? null; };
  rt.extend = (doc, added) => { forget(); return extend(doc, added); };
  rt.controls = d;
  rt.step = (intent = {}) => { const input = d.input(intent); forget(); try { return step(input); } finally { forget(); } };
  return rt;
}

/** A factory of fresh controlled headless worlds for one preflighted host document. */
export function controlledMaker(doc, registry, logic) {
  return seed => controlled(createWorld(doc, registry, logic, { seed, headless: true }), registry);
}

/**
 * The document a person plays (hostDocument), preflighted: what the gate verifies and the bots play.
 * -> the preflight result of the host document ({ ok, doc, errors, capabilities... }).
 */
export function hostPreflight(doc, registry, logic) {
  return preflight(hostDocument(doc, registry), registry, logic);
}

/**
 * The verbs of `verbs` no control issues in a host document (preflighted or not): a key bound to the verb (every value
 * of a closed set; its axis sources for an axis) by engine.input.actions when its card serves `interaction`, or a
 * mounted UI primitive whose card.controls issues it and whose card.interactions include `interaction` (any, when
 * `interaction` is null). -> ['verb (kind)']
 */
export function uncontrolledVerbs(host, registry, verbs, interaction = null) {
  const c = controlsOf(host, registry), inst = verbInstances(host), out = [];
  const serves = id => interaction === null || (registry.get(id)?.card?.interactions || []).includes(interaction);
  const sends = (verb, value) => Object.values(c.map?.buttons || {}).some(l => l.some(b => b.verb === verb && same(b.value, value)));
  for (const verb of verbs) {
    const kind = verbControl(registry, inst, verb);
    const keyed = serves(INPUT) && (kind.kind === 'axis' ? (c.map?.axes?.[verb] || []).length > 0
      : kind.kind === 'values' ? kind.options.every(o => sends(verb, o)) : kind.kind === 'press' ? sends(verb, true) : false);
    const ui = c.uiFor(verb);
    if (!keyed && !(ui && serves(ui))) out.push(`${verb} (${kind.kind})`);
  }
  return out;
}

/**
 * Every verb a document's loops are played with that no control issues in the interactions its loop is played in:
 * for each instance whose card declares a loop, its verbs (instanceVerbs) × the interactions its loop declares (any,
 * when it declares none). -> [{ use, verb, interaction }]
 */
export function documentUncontrolled(host, registry) {
  const out = [];
  for (const inst of verbInstances(host)) {
    const card = registry.get(inst.use)?.card, loop = cardLoop(card), verbs = instanceVerbs(card, inst, host);
    if (!loop || !verbs.length) continue;
    for (const i of loop.interactions.length ? loop.interactions : [null]) for (const v of uncontrolledVerbs(host, registry, verbs, i)) out.push({ use: inst.use, verb: v.split(' ')[0], kind: v, interaction: i });
  }
  return out;
}
