// Human-rate hands (ARCHITECTURE.md §6.3, §1.5: playable by a person, not only by a bot). A bot may change its input
// every frame, which no hand does. humanRate(make, rate) gives worlds whose input passes through a person's edge rate:
//   held input   what is held (the move axis and the other axes, the keys held down) changes only at the start of
//                each window of frames; for the rest of the window it stays as it was then;
//   presses      a press or a choice sent through a UI (one actions record: one act of the person) goes out at the
//                start of a window, one per window, its key held down for that window; an act asked for mid-window
//                waits for the next window start (one waiting act; asking again for the same act while it waits, a
//                mashed key, is the same act).
// The bot plays these worlds exactly as it plays any other (through the controls: v2/verify/controls.js), seeing the
// state and reacting to it, its lookahead on snapshots simulating the same hands; a bot that still wins found a line a
// person's hands can play. The limiter's decisions are a pure function of the intents stepped from the first frame,
// kept per frame, so a restore to an earlier frame resumes the hands as they were then (no state outside the world).

/**
 * Frames per change for a document stepped every `dt` seconds at `changesPerSecond`.
 * @param {number} changesPerSecond @param {number} dt
 */
export const windowFrames = (changesPerSecond, dt) => Math.max(1, Math.round(1 / (changesPerSecond * dt)));

const truthy = v => v !== undefined && v !== null && v !== false;
const heldOf = x => ({ ...(x?.axes ? { axes: x.axes } : {}), held: Object.fromEntries(Object.entries(x?.held || {}).filter(([, v]) => v)) });

/**
 * A maker whose worlds take input at a person's edge rate. -> (seed) => world (rt.humanWindow: frames per change)
 * @param {(seed: any) => any} make a controlled maker @param {number} changesPerSecond
 */
export function humanRate(make, changesPerSecond) {
  return seed => {
    const rt = make(seed), step = rt.step, W = windowFrames(changesPerSecond, rt.dt ?? 1 / 60);
    // sched[f]: the hands before frame f: { hold (the window's held input), act (the act down this window), wait }.
    const sched = [{ hold: heldOf(null), act: null, wait: null }];
    rt.humanWindow = W;
    rt.step = intent => {
      const f = rt.state.frame;
      // A restore to an earlier frame resumes the hands of that frame; a world stepped past what was kept (a snapshot
      // made elsewhere) resumes the last hands known.
      if (f + 1 < sched.length) sched.length = f + 1;
      let k = Math.min(f, sched.length - 1);
      while (k > 0 && !sched[k]) k--;
      const s = sched[k];
      const acts = Object.fromEntries(Object.entries(intent?.actions || {}).filter(([, v]) => truthy(v)));
      let { hold, act, wait } = s;
      if (Object.keys(acts).length && JSON.stringify(acts) !== JSON.stringify(wait) && !(f % W !== 0 && act && JSON.stringify(acts) === JSON.stringify(act))) wait = acts;
      let pressed = null;
      if (f % W === 0) { hold = heldOf(intent); act = wait; wait = null; pressed = act; }
      const down = { ...hold.held, ...(act ? Object.fromEntries(Object.entries(act).filter(([, v]) => v === true).map(([v]) => [v, true])) : {}) };
      const out = { ...(hold.axes ? { axes: hold.axes } : {}), ...(Object.keys(down).length ? { held: down } : {}), ...(pressed ? { actions: pressed } : {}) };
      sched[f + 1] = { hold, act: f % W === W - 1 ? null : act, wait };
      return step.call(rt, out);
    };
    return rt;
  };
}
