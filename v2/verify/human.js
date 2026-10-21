// Human-rate replay (ARCHITECTURE.md §6.3, §1.5: playable by a person, not only by a bot). The bots search with
// snapshots and restores, which no person has, and may change their input every frame, which no hand does. This file
// takes the input a bot's winning world was actually played with (its committed path: every intent stepped from the
// first frame to the last, the lookahead it restored away dropped) and replays it on a fresh world of the same seed
// through the controls a person has, with the input quantized to a human edge rate: what is held (the move axis, the
// keys down) changes at most once per window, and a key pressed anywhere in a window goes down at the window's start
// and stays down for it. A path that still wins is a line a person can play; one that wins only at full rate needs a
// superhuman hand.
//
// recordingMaker(make) logs, per world, the intent of every frame it steps (indexed by frame, so a restore to an
// earlier frame truncates what it overwrote); committedPath(rt) is a world's log up to its current frame.

const RECORD = Symbol('record');

/** A maker whose worlds record their committed input. -> { make, worlds: [{ seed, rt }] } */
export function recordingMaker(make) {
  const worlds = [];
  return {
    worlds,
    make: seed => {
      const rt = make(seed), step = rt.step, log = [];
      rt[RECORD] = log;
      rt.step = input => { log.length = rt.state.frame; log.push(input ?? {}); return step.call(rt, input); };
      worlds.push({ seed, rt });
      return rt;
    },
  };
}

/** The intents a recorded world was stepped with from its first frame to its current one (restored lookahead dropped). */
export function committedPath(rt) {
  const log = rt[RECORD];
  if (!log) throw Error('committedPath: the world was not made by recordingMaker');
  return log.slice(0, rt.state.frame);
}

const truthy = v => v !== undefined && v !== null && v !== false;
const heldKey = intent => JSON.stringify([intent.axes || {}, Object.keys(intent.held || {}).filter(v => intent.held[v]).sort()]);

/**
 * Quantize a path of intents to one change of held input per `window` frames: each window holds the axes and held
 * verbs the path held for most of its frames, and every verb the path pressed in it goes down at its first frame (a
 * press, value true, staying held for the window; a value chosen through a UI sent once).
 * @param {any[]} path @param {number} window frames per change (≥ 1)
 */
export function quantize(path, window) {
  const out = [];
  for (let k = 0; k < path.length; k += window) {
    const part = path.slice(k, k + window), tally = new Map();
    for (const x of part) { const key = heldKey(x); const t = tally.get(key) || { n: 0, x }; t.n++; tally.set(key, t); }
    const top = [...tally.values()].reduce((m, t) => (t.n > m.n ? t : m)).x;
    const presses = {};
    for (const x of part) for (const [v, val] of Object.entries(x.actions || {})) if (truthy(val) && !(v in presses)) presses[v] = val;
    const held = { ...Object.fromEntries(Object.keys(top.held || {}).filter(v => top.held[v]).map(v => [v, true])), ...Object.fromEntries(Object.entries(presses).filter(([, val]) => val === true).map(([v]) => [v, true])) };
    const hold = { ...(top.axes ? { axes: top.axes } : {}), ...(Object.keys(held).length ? { held } : {}) };
    for (let f = 0; f < part.length; f++) out.push(f === 0 && Object.keys(presses).length ? { ...hold, actions: presses } : hold);
  }
  return out;
}

/** Frames per change of held input at `changesPerSecond` for a document stepped every `dt` seconds. */
export const windowFrames = (changesPerSecond, dt) => Math.max(1, Math.round(1 / (changesPerSecond * dt)));

/**
 * Replay a path on a fresh world of `make` (a controlled maker: v2/verify/controls.js), then idle up to `settle`
 * frames for the game to resolve. -> { status, frames }
 */
export function replayPath(make, seed, path, { settle = 0 } = {}) {
  const rt = make(seed);
  for (const x of path) { if (rt.state.status !== 'playing') break; rt.step(x); }
  for (let f = 0; f < settle && rt.state.status === 'playing'; f++) rt.step({});
  return { status: rt.state.status, frames: rt.state.frame };
}

/**
 * The human-rate check of a bot's run on `seed`: the last world of that seed the run made that ended won, its
 * committed path replayed at full rate (it must win again: the recording is the play) and quantized to
 * `changesPerSecond`. -> { seed, frames, window, full, human } (null when no world of the seed was won)
 */
export function humanCheck(make, worlds, seed, changesPerSecond) {
  const won = worlds.filter(w => w.seed === seed && w.rt.state.status === 'won').at(-1);
  if (!won) return null;
  const path = committedPath(won.rt), window = windowFrames(changesPerSecond, won.rt.dt);
  const full = replayPath(make, seed, path), human = replayPath(make, seed, quantize(path, window), { settle: window });
  return { seed, frames: path.length, window, full: full.status, human: human.status };
}
