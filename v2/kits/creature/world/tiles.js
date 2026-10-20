// Tile codes for creature maps. Maps store rows as strings of these one-character codes.
export const T = {
  ground: '.', path: ',', grass: '"', tree: 'T', water: '~', ledge: 'v', wall: '#', roof: '^', door: 'D', sign: 'S',
  heal: 'H', counter: 'C', flower: '*', fence: 'f', floor: '_', rock: 'R', mat: 'M', pc: 'P', switch: 'W', barrier: 'B',
  carpet: '=', shelf: 'L', table: 't', boulder: 'o', statue: 's', window: 'w',
};
export const KIND_OF = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));

// Tiles a walker can stand on. Ledges are entered only moving down (and hopped over); doors and mats warp.
const WALKABLE = new Set([T.ground, T.path, T.grass, T.flower, T.door, T.floor, T.mat, T.switch, T.carpet]);
export const walkable = ch => WALKABLE.has(ch);
export const isLedge = ch => ch === T.ledge;

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
export const SIDE_DIR = { N: 'up', S: 'down', E: 'right', W: 'left' };
export const OPPOSITE_SIDE = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** A mutable grid used while generating; `rows()` freezes it into strings. */
export function grid(w, h, fill) {
  const cells = Array.from({ length: h }, () => Array(w).fill(fill));
  return {
    w, h, cells,
    in: (x, y) => x >= 0 && y >= 0 && x < w && y < h,
    get(x, y) { return this.in(x, y) ? cells[y][x] : null; },
    set(x, y, v) { if (this.in(x, y)) cells[y][x] = v; },
    rect(x, y, rw, rh, v) { for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) this.set(i, j, v); },
    rows() { return cells.map(r => r.join('')); },
  };
}

export const tileAt = (map, x, y) => (x >= 0 && y >= 0 && x < map.w && y < map.h ? map.tiles[y][x] : null);
