// Arena geometry shared by the simulation, the CPU and the renderer (world units, y up from the
// floor). Each stage has its own width (content `stages[].width`); the arena in use is set from
// the match before every step and render (single-threaded, so one current arena is safe).
export const DEFAULT_WIDTH = 920;

/** Traditional walls and the platform stage for an arena `width` units wide. */
export function makeArena(width = DEFAULT_WIDTH) {
  const left = 40, center = left + width / 2, k = width / DEFAULT_WIDTH;
  const T = { left, right: left + width, center, maxSep: 360, start: 105, width };
  const half = width * 0.25;
  const P = {
    center, start: Math.min(110, half * 0.5),
    main: { x0: center - half, x1: center + half },
    soft: [[-180, -50, 95], [50, 180, 95], [-65, 65, 185]].map(([a, b, y]) => ({ x0: center + a * k, x1: center + b * k, y })),
    blast: { l: center - width / 2 - 20, r: center + width / 2 + 20, b: -230, t: 520 },
  };
  return { T, P, width };
}

export const ARENA = makeArena();
const cache = new Map();
/** Make `width` the current arena. */
export function useArena(width = DEFAULT_WIDTH) {
  if (ARENA.width === width) return ARENA;
  if (!cache.has(width)) cache.set(width, makeArena(width));
  return Object.assign(ARENA, cache.get(width));
}
export const useArenaOf = state => useArena(state?.match?.arena || DEFAULT_WIDTH);
