// Shared board helpers for the puzzle workstream (falling pieces, match, slide/merge).
//
// A *board* is a rectangle of cells inside any space that provides `editCells`
// (a puzzle grid, a platformer tilemap, a voxel wall...). Primitives work in
// board coordinates (c, r): c = 0..W-1 across, r = 0..H-1 *in the fall
// direction* (r = 0 is the spawn/top edge). The frame maps them to space cells:
//   space[axes[0]] = at[axes[0]] + c
//   space[axes[1]] = at[axes[1]] + (fall < 0 ? H-1-r : r)
// fall = -1 suits y-up spaces (tilemap, test space: pieces fall toward -y);
// fall = +1 suits y-down boards, or y-up boards whose pieces rise (breakout).
//
// Cell values are block-id tokens: `color(/tag)*`, e.g. 'red', 'red/h'
// (striped), 'bomb', 'red/fixed' (virus), 'red/link:r' (capsule half),
// 'blocker/hp2'. Tags travel with the cell when it moves.
import { checkParam } from '../../kernel/params.js';

/**
 * The world content a board primitive gives the space its board sits in (card.provides.content): it fills the board's
 * cells itself (its starting tiles or gems, the pieces that land), so the space needs no generator for them
 * (planner/compose-check.js content coverage). Every card with a boardParam declares it.
 */
export const BOARD_CONTENT = Object.freeze(['cells']);

export const boardParam = (size = [10, 20], name = 'board') => ({
  type: 'object',
  // Space-region metadata (planner): this param claims the board's cells, so world generators leave them clear.
  region: 'board',
  default: { name, at: [0, 0, 0], size, axes: [0, 1], fall: -1, layer: '' },
  effect: 'where the board sits in its space: name (shared by primitives on the same board), at (space cell of board column 0 / bottom row), size [w,h] cells, axes [across, vertical] space axis indexes, fall ±1 (space-axis direction pieces fall)',
  fields: {
    name: { type: 'string', default: name, effect: 'board name; primitives with the same name coordinate (board_busy / board_idle)' },
    at: { type: 'list', of: { type: 'integer', min: -100000, max: 100000 }, min: 2, max: 3, default: [0, 0, 0], effect: 'space cell of board column 0 at its bottom (fall<0) or top (fall>0) row' },
    size: { type: 'list', of: { type: 'integer', min: 1, max: 256 }, min: 2, max: 2, default: size, unit: 'cells', effect: 'board width and height' },
    axes: { type: 'list', of: { type: 'integer', min: 0, max: 2 }, min: 2, max: 2, default: [0, 1], effect: 'space axis indexes for across and vertical' },
    fall: { type: 'integer', min: -1, max: 1, default: -1, effect: 'space-axis direction of falling: -1 toward lower coordinates (y-up spaces), +1 toward higher' },
    layer: { type: 'string', default: '', effect: "cell layer the board lives on ('' = the space's default layer)" },
  },
});

/** The rules validateBoard enforces (card.rules of every card with a boardParam named `board`). */
export const BOARD_RULES = Object.freeze({
  board_fall: { fields: ['board.fall'], message: 'board.fall is -1 or 1 (the space-axis direction pieces fall)', example: { board: { name: null, at: null, size: null, axes: null, fall: 0, layer: null } } },
  board_axes: { fields: ['board.axes', 'board.at'], message: 'board.axes names two different space axes, each an index of board.at' },
});

/** Preflight checks shared by board primitives. Codes: board_fall, board_axes (BOARD_RULES). */
export function validateBoard(board, path = 'with.board') {
  const errors = [];
  if (!board) return errors;
  if (board.fall !== 1 && board.fall !== -1) errors.push({ code: 'board_fall', path: `${path}.fall`, message: 'fall must be -1 or 1', hint: '-1 for y-up spaces' });
  if (board.axes?.[0] === board.axes?.[1]) errors.push({ code: 'board_axes', path: `${path}.axes`, message: 'across and vertical axes must differ' });
  if (board.axes && board.at && Math.max(...board.axes) >= board.at.length) errors.push({ code: 'board_axes', path: `${path}.axes`, message: `axis index exceeds the ${board.at.length}-d 'at'` });
  return errors;
}

/** Board frame + cell access over a space's editCells API. */
export function boardOf(rt, board, spaceId) {
  const api = rt.space(spaceId);
  const [W, H] = board.size, [ah, av] = board.axes, base = board.at.slice(), fall = board.fall, layer = board.layer || undefined;
  const toSpace = (c, r) => { const p = base.slice(); p[ah] += c; p[av] += fall < 0 ? H - 1 - r : r; return p; };
  const fromSpace = at => {
    if (!Array.isArray(at)) return null;
    const c = Math.floor(at[ah]) - base[ah], v = Math.floor(at[av]) - base[av];
    return [c, fall < 0 ? H - 1 - v : v];
  };
  const inside = (c, r) => c >= 0 && r >= 0 && c < W && r < H;
  const B = {
    W, H, api, name: board.name, spaceId, toSpace, fromSpace, inside, fall, axes: board.axes, layer,
    get: (c, r) => inside(c, r) ? (api.getCell(toSpace(c, r), layer) ?? null) : null,
    set: (c, r, token, by) => inside(c, r) && api.setCell(toSpace(c, r), token ?? null, rt, by, layer),
    /** Read the whole board into a row-major array (index r*W + c). */
    read() { const g = new Array(W * H); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) g[r * W + c] = B.get(c, r); return g; },
    /** Write only the cells that differ from `before`. */
    write(grid, before, by) { for (let i = 0; i < W * H; i++) if ((grid[i] ?? null) !== (before[i] ?? null)) B.set(i % W, Math.floor(i / W), grid[i] ?? null, by); },
    // Probe the cell centre in centre-anchored spaces (cell [i,j] covers [i,i+1)); grid/test cells are addressed directly.
    entitiesAt: (c, r) => api.entitiesAt ? api.entitiesAt(api.anchor === 'center' ? toSpace(c, r).map((v, i) => i === ah || i === av ? v + 0.5 : v) : toSpace(c, r)).map(id => rt.entity(id)).filter(Boolean) : [],
  };
  return B;
}

/** The `board` service shape verify bots read: {w, h, get(x, y)} board-local, y up (y = 0 bottom row). */
export function provideBoard(rt, name, boardFn) {
  const svc = { get w() { return boardFn().W; }, get h() { return boardFn().H; }, get: (x, y) => { const B = boardFn(); return B.get(x, B.H - 1 - y); } };
  rt.provide(`board:${name}`, svc);
  if (!rt.hasService('board')) rt.provide('board', svc);
}

// ---- tokens ----
export const colorOf = t => t == null ? null : String(t).split('/')[0];
export const tagsOf = t => t == null ? [] : String(t).split('/').slice(1);
export const hasTag = (t, tag) => tagsOf(t).includes(tag);
export const tagValue = (t, key) => { const x = tagsOf(t).find(s => s.startsWith(key + ':')); return x ? x.slice(key.length + 1) : null; };
export const token = (color, ...tags) => [color, ...tags.filter(Boolean)].join('/');
export const withoutTag = (t, pred) => token(colorOf(t), ...tagsOf(t).filter(x => !pred(x)));

// Partner direction of a linked half (capsules): l r u d in board coordinates (u = r-1).
const LINK_D = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };
export const linkOf = t => tagValue(t, 'link');
export const linkDelta = l => LINK_D[l] || null;
export const unlink = t => withoutTag(t, x => x.startsWith('link:'));

/**
 * Column gravity on an in-memory grid (row-major, W×H, r grows in the fall direction).
 * fixed(token) cells never move; blocked(i) marks holes (not part of the board).
 * Linked halves (link:l/r/u/d) fall together. Returns [{from, to}] index moves.
 */
export function settleGrid(grid, W, H, { fixed = t => hasTag(t, 'fixed'), blocked = () => false } = {}) {
  const moves = [], open = i => !blocked(i) && grid[i] == null;
  const mv = (i, j) => { grid[j] = grid[i]; grid[i] = null; moves.push({ from: i, to: j }); };
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = H - 2; r >= 0; r--) for (let c = 0; c < W; c++) {
      const i = r * W + c, t = grid[i];
      if (t == null || blocked(i) || fixed(t)) continue;
      const lk = linkOf(t);
      if (lk === 'l' || lk === 'd') continue; // the partner moves the unit
      if (lk === 'r') {
        if (c + 1 < W && open(i + W) && open(i + 1 + W) && grid[i + 1] != null && !fixed(grid[i + 1])) { mv(i, i + W); mv(i + 1, i + 1 + W); changed = true; }
      } else if (lk === 'u') {
        if (open(i + W) && r > 0 && grid[i - W] != null && !fixed(grid[i - W])) { mv(i, i + W); mv(i - W, i); changed = true; }
      } else if (open(i + W)) { mv(i, i + W); changed = true; }
    }
  }
  return moves;
}

/**
 * Settle a board. When the space has the `settle` capability (engine.space.grid:
 * settle(rt, {dir, layer, by})) and it can do exactly this job (the board is the
 * whole space, falls vertically, and holds no tag-fixed or linked cells, which the
 * space's own rules cannot see), the space settles; otherwise column gravity runs
 * here through setCell. Returns [{from, to}] board-index moves.
 */
export function settleBoard(rt, B, { fixed = t => hasTag(t, 'fixed'), blocked = null, by } = {}) {
  const before = B.read();
  const api = B.api, size = api.size || [];
  const whole = size[0] === B.W && size[1] === B.H && B.toSpace(0, 0).every((v, i) => i > 1 || v === (i === 0 ? 0 : B.fall < 0 ? B.H - 1 : 0));
  if (typeof api.settle === 'function' && api.kind === 'grid' && whole && B.axes[0] === 0 && B.axes[1] === 1 && !blocked && !before.some(t => linkOf(t) || fixed(t))) {
    const ysign = api.config?.yAxis === 'down' ? -1 : 1;
    const moves = api.settle(rt, { dir: B.fall === -ysign ? 'down' : 'up', layer: B.layer ?? api.layers?.[0], by }) || [];
    return moves.map(m => { const a = B.fromSpace(m.from), b = B.fromSpace(m.to); return { from: a[1] * B.W + a[0], to: b[1] * B.W + b[0] }; });
  }
  const grid = before.slice();
  const moves = settleGrid(grid, B.W, B.H, { fixed, blocked: blocked || (() => false) });
  B.write(grid, before, by);
  return moves;
}

// ---- scoring ----
/** Points go to gameplay.score's add_score when it is registered; otherwise to var `score` plus a `score` event. */
export function award(rt, amount, reason, data = {}) {
  if (!amount) return;
  if (rt.canRun('add_score')) rt.run([{ do: 'add_score', amount, reason }]);
  else { rt.state.vars.score = (rt.state.vars.score ?? 0) + amount; rt.emit('score', { amount, reason, ...data }); }
}

// ---- input ----
/** True when verb is held this step (engine.input.actions `held`) or sent as an action. */
export const isHeld = (rt, verb) => Boolean(rt.input?.held?.[verb] || rt.input?.actions?.[verb]);
/** Delayed auto-shift: returns -1/0/1 steps this frame (once on press, then every arr after das). */
export function autoShift(rep, dir, das, arr) {
  if (!dir) { rep.dir = 0; rep.t = 0; return 0; }
  if (dir !== rep.dir) { rep.dir = dir; rep.t = 0; return dir; }
  rep.t++;
  return rep.t >= das && (rep.t - das) % Math.max(1, arr) === 0 ? dir : 0;
}
export const rint = (rt, n) => Math.floor(rt.random() * n);
export function shuffle(rt, list) { for (let i = list.length - 1; i > 0; i--) { const j = rint(rt, i + 1); [list[i], list[j]] = [list[j], list[i]]; } return list; }
export function weighted(rt, list, w = x => x.weight ?? 1) {
  const total = list.reduce((s, x) => s + Math.max(0, w(x)), 0);
  let r = rt.random() * total;
  for (const x of list) { r -= Math.max(0, w(x)); if (r < 0) return x; }
  return list[list.length - 1];
}

/** Whether a token is solid for pieces: content.blocks may mark a block solid:false. */
export function solidToken(rt, t) {
  if (t == null) return false;
  const b = rt.doc.content?.blocks?.find?.(x => x.id === t);
  return b ? b.solid !== false : true;
}

/** Normalize a param config (used for nested defaults in effects). */
export const normalize = (schema, value) => checkParam(schema, value, '', [], null);
