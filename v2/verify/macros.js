// Travel macros for spaces that offer no options of their own (continuous
// tilemaps, grids with real-time movement): one "travel <zone>" option per
// zone of the player's space, planned with the space's ability-aware `path`
// under the player's current abilities and movement envelope.
//   'warp'  moves the player along the path one waypoint per frame (the
//           space's navigation is taken as the claim of traversability);
//   'steer' drives the real controls: held move axes toward each waypoint,
//           with the jump verb (discovered by probing) when the next waypoint
//           is higher in a gravity space. It proves the route with physics.
// Solvers and playtesters attach them with rt.options (the public runtime API).
import { hold, inputMacros, posOf, applyOption, pressableVerbs } from './drive.js';
import { navOptions, navFrom } from './movement.js';
import { instancesOf } from './util.js';

/** The verb that makes the player rise when pressed from rest (jump, flap), or null. */
export function jumpVerb(rt) {
  const pos = () => { const q = posOf(rt); return Array.isArray(q) ? q : null; }; // spaces without positions (none, graph) have no height
  const p = rt.player(); if (!p || !Array.isArray(p.at) || !pos()) return null;
  const snap = rt.snapshot();
  hold(rt, {}, 20); // settle onto the ground
  if (!pos()) { rt.restore(snap); return null; }
  const base = rt.snapshot(), y0 = pos()[1];
  let found = null;
  // On a controlled runtime (v2/verify/controls.js) only the verbs a key presses are tried: what a person can press.
  for (const v of pressableVerbs(rt)) {
    rt.restore(base);
    hold(rt, { actions: { [v]: true }, held: { [v]: true } }, 1);
    let top = pos()?.[1] ?? y0;
    for (let i = 0; i < 12; i++) { hold(rt, { held: { [v]: true } }, 1); top = Math.max(top, pos()?.[1] ?? top); }
    if (top > y0 + 0.5) { found = v; break; }
  }
  rt.restore(snap);
  return found;
}

/** Whether held input macros move the player at all (so steering can work). */
export function inputsMove(rt) {
  const snap = rt.snapshot(), at0 = JSON.stringify(rt.player()?.at);
  let moved = false;
  for (const m of inputMacros(rt, { verbs: [], combos: false }).slice(1)) { rt.restore(snap); hold(rt, m.input, 10); if (JSON.stringify(rt.player()?.at) !== at0) { moved = true; break; } }
  rt.restore(snap);
  return moved;
}

const grounded = (api, p) => (typeof api.grounded === 'function' ? api.grounded(p) : Boolean(p.components.body?.grounded));
const sideView = api => typeof api.gravityAt === 'function' && Math.abs(api.gravityAt([0, 0, 0])?.[1] ?? 0) > 0;

/** Move the player to `zone` along the space's path. Returns true when it arrived. */
export function travel(rt, registry, zone, { mode = 'warp', jump = null, perWaypoint = 120, controlsOnly = false } = {}) {
  const p = rt.player(); if (!p) return false;
  const api = rt.space(p.space);
  const nav = navOptions(rt, registry, p);
  const path = api.path(navFrom(api, p), zone, nav.opts);
  if (!path || path.length < 2) return false;
  if (mode === 'warp' && !controlsOnly) {
    for (const wp of path.slice(1)) {
      if (p.components.body?.vel) p.components.body.vel = p.components.body.vel.map(() => 0);
      api.setPos(p, Array.isArray(wp) ? wp.slice() : wp, rt);
      rt.step({});
      if (rt.state.status !== 'playing' || rt.player() !== p) break;
    }
    return api.inZone(p, zone, rt);
  }
  // A movement primitive that knows its own controls may steer instead: export travel(rt, path, config, instance).
  // Prefer the controller bound to the player's space; the first one declared wins ties. controlsOnly (a bot playing
  // through the controls a person has): only held move axes and the jump verb, never a movement plan written for it.
  const owners = controlsOnly ? [] : instancesOf(rt.doc).map(x => ({ x, prim: registry.get(x.inst?.use) })).filter(e => typeof e.prim?.travel === 'function');
  const own = owners.find(e => e.x.space === p.space) || owners[0];
  if (own) {
    const arrived = own.prim.travel(rt, path, own.x.inst.with || {}, { key: own.x.key, ...own.x.inst });
    return rt.state.status !== 'playing' ? rt.state.status !== 'lost' : Boolean(arrived) && api.inZone(p, zone, rt);
  }
  const side = sideView(api);
  let prev = posOf(rt, p);
  for (const wp of path.slice(1)) {
    // A waypoint higher up, or more than a step away horizontally, is a jump edge of the nav graph.
    const leap = side && jump && (wp[1] - prev[1] > 0.4 || Math.abs(wp[0] - prev[0]) > 1.2);
    let ok = false, best = Infinity, still = 0, airPress = false, jumped = false;
    for (let f = 0; f < perWaypoint && rt.state.status === 'playing'; f++) {
      const at = posOf(rt, p), dx = wp[0] - at[0], dy = wp[1] - at[1], vy = p.components.body?.vel?.[1] ?? 0, g = grounded(api, p);
      if (Math.abs(dx) < 0.35 && Math.abs(dy) < (side ? 0.75 : 0.35) && (!side || g || dy > -0.2)) { ok = true; break; }
      const input = { axes: { move: [Math.abs(dx) > 0.15 ? Math.sign(dx) : 0, side ? 0 : Math.abs(dy) > 0.15 ? Math.sign(dy) : 0] } };
      if (leap) {
        if (g && !jumped) { input.actions = { [jump]: true }; jumped = true; airPress = false; }
        else if (!g && !airPress && vy <= 0.5 && dy > 0.6) { input.actions = { [jump]: true }; airPress = true; } // second (double) jump at the apex
        if (!g && vy > 0) input.held = { [jump]: true };
        if (g && jumped && f > 2) jumped = dy > 0.4 ? false : jumped; // landed short: try again
      }
      rt.step(input);
      const d = Math.hypot(dx, dy);
      if (d < best - 0.01) { best = d; still = 0; } else if (++still > 60) break;
    }
    if (rt.state.status !== 'playing') return rt.state.status !== 'lost'; // the trip ended the game
    if (!ok || rt.player() !== p) return false;
    prev = posOf(rt, p);
  }
  return api.inZone(p, zone, rt);
}

/**
 * Option provider: "travel <zone>" for every zone of the player's space it is not in,
 * when the space has `path`. mode 'auto' steers when the player's inputs move it, else warps.
 */
export function travelOptions(registry, { mode = 'auto' } = {}) {
  let resolved = null, jump = null;
  const provider = rt => {
    const p = rt.player(); if (!p || rt.state.status !== 'playing') return [];
    const api = rt.space(p.space); if (typeof api.path !== 'function') return [];
    if (resolved === null) {
      if (mode === 'auto') resolved = inputsMove(rt) ? 'steer' : 'warp'; else resolved = mode;
      if (resolved === 'steer') jump = jumpVerb(rt);
    }
    const zones = rt.doc.spaces.find(s => s.id === p.space)?.zones || [];
    // A zone the game's own primitives already offer travel to (their real controllers) gets no second, generic macro.
    const offered = new Set(rt.optionsExcept(provider).filter(o => o.macro && o.actions?.travel).map(o => o.actions.travel));
    return zones.filter(z => !api.inZone(p, z.id, rt) && !offered.has(z.id)).map(z => ({ label: `travel ${z.id}`, macro: resolved, zone: z.id, jump, apply: r => travel(r, registry, z.id, { mode: resolved, jump }) }));
  };
  provider.resolved = () => resolved;
  return provider;
}

/**
 * Wrap a world factory so worlds also offer travel macros. Returns { make, mode() }: mode() is the
 * resolved macro mode ('warp' | 'steer') once a world has listed its options, else null.
 */
export function withTravel(make, registry, opts = {}) {
  let last = null;
  return {
    make: seed => { const rt = make(seed); last = travelOptions(registry, opts); rt.options(last); return rt; },
    mode: () => last?.resolved() ?? null,
  };
}

/** Can a person travel on a controlled runtime by holding the move axis (travel macros realized as held input)? */
export const steerable = rt => Boolean(rt.controls && (rt.controls.controls.map?.axes?.move || []).length);

/**
 * Take an option the way a person does. On a controlled runtime (v2/verify/controls.js) a travel macro (travelOptions'
 * "travel <zone>", which a solver may realize by warping) is held input: the move axis (and the jump verb) along the
 * space's path when the move axis is a control, else the travel verb toward its zone (a choice verb a mounted UI issues)
 * and waiting until the player is there; every other option issues its actions (drive.js applyOption). Uncontrolled,
 * the option as a solver takes it.
 * @param {any} rt @param {any} option @param {any} registry
 */
export function takeOption(rt, option, registry, { travelFrames = 900 } = {}) {
  if (!rt.controls || option.zone === undefined || typeof option.apply !== 'function') return void applyOption(rt, option);
  if (steerable(rt)) return void travel(rt, registry, option.zone, { mode: 'steer', jump: option.jump !== undefined ? option.jump : jumpVerb(rt), controlsOnly: true });
  hold(rt, { actions: { travel: option.zone } }, 1);
  const there = () => { const p = rt.player(); return p && rt.space(p.space).inZone?.(p, option.zone, rt); };
  for (let k = 0; k < travelFrames && rt.state.status === 'playing' && !there(); k++) rt.step({});
}
