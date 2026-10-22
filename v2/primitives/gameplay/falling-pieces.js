// gameplay.falling.pieces: pieces fall through a board in ANY editCells space.
//
// Guideline depth (ported from the puzzle kit): SRS rotation with the JLSTZ / I
// wall-kick tables, 7-bag randomizer, hold, next queue, ghost, DAS/ARR, soft and
// hard drop, lock delay 30 frames with 15 move resets (lowest-row reset), 3-corner
// T-spins (mini/full, 5th-kick promotion), combos, back-to-back, perfect clears,
// guideline scoring x level and guideline gravity. Custom polyominoes, small
// pieces and two-colour pairs (puyo pairs / linked capsules) share the code.
//
// Generality (ported from the falling mod): the board is a rectangle anywhere in
// the space (board.at/axes/fall), so pieces can fall down a puzzle well, drop into
// a platformer level, or rise into a breakout wall (fall = +1 on a y-up space).
// A landed piece becomes cells (setCell) or spawns one entity per cell; the
// reachability guard refuses landings that would cut the player off; landings
// never bury an entity; steering can be the player, follow the player, or drift.
// With gameplay.match on the same board name, locking hands the board over
// (piece_locked -> board_busy ... board_idle) and the next piece waits.
import { BOARD_CONTENT, boardParam, validateBoard, boardOf, provideBoard, award, isHeld, autoShift, rint, shuffle, solidToken, settleBoard, token as mkToken } from './puzzle-lib-board.js';

const ID = 'gameplay.falling.pieces';
const STANDARD = {
  I: ['....', 'IIII', '....', '....'], O: ['OO', 'OO'], T: ['.T.', 'TTT', '...'], S: ['.SS', 'SS.', '...'],
  Z: ['ZZ.', '.ZZ', '...'], J: ['J..', 'JJJ', '...'], L: ['..L', 'LLL', '...'],
};
export const STANDARD_KEYS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const SMALL = { m1: ['#'], m2: ['##'], m3: ['###'], m4: ['##', '#.'] };
// SRS kicks, written y-up as in the guideline and flipped to y-down (board r grows downward).
const yDown = t => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.map(([x, y]) => [x, -y])]));
export const KICKS = {
  JLSTZ: yDown({
    '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  }),
  I: yDown({
    '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  }),
};
const GENERIC = [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-2, 0], [2, 0], [0, 1]];
const PAIR_DX = [0, 1, 0, -1], PAIR_DY = [-1, 0, 1, 0]; // child offset by rotation: up, right, down, left
const PAIR_LINK = ['u', 'r', 'd', 'l'], OPP = { u: 'd', d: 'u', l: 'r', r: 'l' };
const NAMES = ['', 'Single', 'Double', 'Triple', 'Tetris', 'Pentris'];

/** Guideline gravity in rows per frame: seconds per row = (0.8 − (L−1)·0.007)^(L−1). */
export const gravityRows = level => Math.min(40, 1 / (60 * Math.pow(0.8 - (level - 1) * 0.007, level - 1)));

export function parseShape(rows) {
  const cells = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.' && ch !== ' ') cells.push([x, y]); }));
  if (!cells.length) return cells;
  const mx = Math.min(...cells.map(c => c[0])), my = Math.min(...cells.map(c => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my]);
}
const connected = cells => {
  if (!cells.length) return false;
  const k = c => c.join(','), set = new Set(cells.map(k)), seen = new Set([k(cells[0])]), q = [cells[0]];
  while (q.length) { const [x, y] = q.pop(); for (const n of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (set.has(k(n)) && !seen.has(k(n))) { seen.add(k(n)); q.push(n); } }
  return seen.size === cells.length;
};
const rotateCells = (cells, n) => cells.map(([x, y]) => [n - 1 - y, x]);
function makeType(key, cells, n, kicks, W, hidden, token) {
  const states = [cells];
  for (let r = 1; r < 4; r++) states.push(rotateCells(states[r - 1], n));
  const minY = Math.min(...cells.map(c => c[1]));
  return { key, n, kicks, states, spawnX: Math.floor((W - n) / 2), spawnY: hidden - 2 - minY, size: cells.length, token };
}

/** Piece types for a config (pure; cached per config object). */
const TYPES = new WeakMap();
export function typesFor(cfg) {
  if (TYPES.has(cfg)) return TYPES.get(cfg);
  const W = cfg.board.size[0], hidden = cfg.hidden, out = [], tok = k => cfg.tokens[k] ?? `piece_${k.toLowerCase()}`;
  const add = (key, rows, kick) => {
    const cells = parseShape(rows), w = Math.max(...cells.map(c => c[0])) + 1, h = Math.max(...cells.map(c => c[1])) + 1;
    const n = Math.max(w, h), ox = Math.floor((n - w) / 2), oy = Math.floor((n - h) / 2);
    const square = w === h && cells.length === w * h;
    out.push(makeType(key, cells.map(([x, y]) => [x + ox, y + oy]), n, kick || (square ? 'O' : n === 3 ? 'JLSTZ' : n === 4 ? 'I' : 'G'), W, hidden, tok(key)));
  };
  for (const set of cfg.sets) {
    if (set === 'standard') STANDARD_KEYS.forEach(k => {
      const rows = STANDARD[k], cells = [];
      rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') cells.push([x, y]); }));
      out.push(makeType(k, cells, rows.length, k === 'I' ? 'I' : k === 'O' ? 'O' : 'JLSTZ', W, hidden, tok(k)));
    });
    if (set === 'small') Object.entries(SMALL).forEach(([k, rows]) => add(k, rows));
    if (set === 'custom') cfg.custom.forEach(p => add(p.id, p.rows));
    if (set === 'pairs') out.push({ key: 'pair', n: 2, kicks: 'pair', pair: true, states: [0, 1, 2, 3].map(r => [[0, 0], [PAIR_DX[r], PAIR_DY[r]]]), spawnX: Math.floor(W / 2) - 1, spawnY: Math.max(1, hidden - 1), size: 2, token: null });
  }
  TYPES.set(cfg, out);
  return out;
}
const kicksFor = (T, from, to) => T.kicks === 'O' ? [[0, 0]] : KICKS[T.kicks]?.[`${from}${to}`] || GENERIC;

const DEFAULT_TOP_OUT = [{ do: 'end_game', outcome: 'lost' }];

/** The player's verbs: every one moves or places the falling piece (what the lines cleared and the stack read). */
const VERBS = ['shift_left', 'shift_right', 'soft_drop', 'hard_drop', 'rotate_cw', 'rotate_ccw', 'hold', 'place'];

export default {
  id: ID,
  card: {
    loop: { shows: ['cells'], verbs: VERBS, progress: ['piece_locked', 'lines_cleared'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { place: { type: 'choice', of: 'a placement of the falling piece (column, rotation)', from: 'options', emits: ['piece_locked'] } },
    // Falling-blocks mode: clear lines before the stack tops out (the line target wins through an ending or a stage goal).
    mode: { loop: 'falling-blocks', interaction: 'cursor-board', opponent: 'clock', space: ['engine.space.grid', ['editCells']], needs: { content: [], participants: null }, win: { when: { var: 'falling.lines', gte: '$target' }, reads: { var: 'falling.lines', by: { actions: VERBS } } }, lose: { param: 'onTopOut', once: true, reads: { event: 'top_out', by: { actions: VERBS } } }, bot: 'placement' },
    intent: 'Falling pieces over a board in any editCells space: Tetris-guideline wells (SRS, 7-bag, hold, ghost, T-spins, combos), puyo pairs and capsules handed to gameplay.match, or blocks dropping into a platformer level / rising into a breakout wall as cells or entities.',
    views: ['side', 'board', 'td'],
    params: {
      board: boardParam([10, 24]),
      hidden: { type: 'integer', default: 4, min: 0, max: 20, unit: 'rows', effect: 'rows at the top where pieces spawn; locking entirely inside them tops out' },
      sets: { type: 'list', default: ['standard'], min: 1, of: { type: 'string', options: ['standard', 'small', 'custom', 'pairs'] }, effect: 'piece sets in play: standard tetrominoes, small 1-3 cell pieces, custom polyominoes, or two-colour pairs' },
      custom: { type: 'list', default: [], of: { type: 'object', fields: { id: { type: 'string', required: true }, rows: { type: 'list', required: true, min: 1, max: 6, of: { type: 'string' } } } }, effect: 'custom polyominoes: rows of chars, "." empty' },
      tokens: { type: 'object', values: { type: 'string' }, default: {}, effect: 'block token per piece key (I, O, T..., m1.., custom id); default piece_<key>' },
      pairColors: { type: 'list', default: ['red', 'green', 'blue', 'yellow'], min: 1, max: 8, of: { type: 'string' }, effect: 'tokens pair halves are drawn from' },
      link: { type: 'boolean', default: false, effect: 'pairs land as linked capsule halves (fall together until one half clears)' },
      pairStart: { type: 'string', default: 'vertical', options: ['vertical', 'horizontal'], effect: 'spawn orientation of pairs' },
      randomizer: { type: 'string', default: 'bag', options: ['bag', 'random'], effect: 'bag = every type once per bag (7-bag), random = independent picks' },
      next: { type: 'integer', default: 5, min: 0, max: 7, effect: 'preview queue length' },
      hold: { type: 'boolean', default: true, effect: 'hold slot (once per piece)' },
      ghost: { type: 'boolean', default: true, effect: 'publish the landing row for renderers' },
      steer: { type: 'string', default: 'player', options: ['player', 'follow', 'drift'], effect: 'player: shift/rotate verbs; follow: the piece tracks the player\'s column; drift: falls where it spawns (random column)' },
      every: { type: 'number', default: 0, min: 0, max: 120, unit: 's', effect: 'delay between pieces (0 = next piece at once)' },
      level: { type: 'integer', default: 1, min: 1, max: 30, effect: 'starting level: guideline gravity and score multiplier' },
      levelEvery: { type: 'integer', default: 10, min: 0, max: 200, unit: 'lines', effect: 'lines per level up (0 = fixed level)' },
      rowsPerSecond: { type: 'number', default: 0, min: 0, max: 60, unit: 'rows/s', effect: 'fixed gravity overriding the guideline curve (0 = guideline)' },
      softFactor: { type: 'number', default: 20, min: 1, max: 100, effect: 'soft-drop gravity multiplier (at least 0.34 rows/frame)' },
      das: { type: 'integer', default: 10, min: 1, max: 60, unit: 'frames', effect: 'delayed auto-shift' },
      arr: { type: 'integer', default: 2, min: 1, max: 30, unit: 'frames', effect: 'auto-repeat rate' },
      lockDelay: { type: 'integer', default: 30, min: 0, max: 600, unit: 'frames', effect: 'frames resting before lock (0 = lock on contact)' },
      moveResets: { type: 'integer', default: 15, min: 0, max: 100, effect: 'moves/rotations that reset the lock delay; reaching the cap locks' },
      clearFrames: { type: 'integer', default: 22, min: 0, max: 120, unit: 'frames', effect: 'line-clear pause before rows collapse' },
      clearRows: { type: 'string', default: 'shift', options: ['shift', 'remove', 'none'], effect: 'full rows: collapse (Tetris), just clear (breakout wall), or keep' },
      scoring: { type: 'string', default: 'guideline', options: ['guideline', 'flat', 'none'], effect: 'guideline points x level, flat 10 per landed cell + 100 x width per row, or none' },
      tspin: { type: 'boolean', default: true, effect: 'detect T-spins (3-corner rule)' },
      settle: { type: 'boolean', default: false, effect: 'after locking, cells fall individually until supported (pairs split like puyo)' },
      land: { type: 'string', default: 'cells', options: ['cells', 'spawn'], effect: 'landed cells become blocks (setCell) or spawn one entity per cell' },
      archetype: { type: 'ref', to: 'archetype', effect: 'archetype spawned per cell when land = spawn' },
      solidArchetypes: { type: 'list', default: [], of: { type: 'ref', to: 'archetype' }, effect: 'entities that act as solid cells (bricks); the spawn archetype always does' },
      passThrough: { type: 'boolean', default: false, effect: 'pieces pass over obstacles and settle in the first open spot resting on something (falling-blocks-in-a-level)' },
      guard: { type: 'string', default: 'none', options: ['none', 'reachable'], effect: 'reachable: refuse landings that cut off board cells the player can reach' },
      garbage: { type: 'integer', default: 0, min: 0, max: 40, unit: 'rows', effect: 'garbage rows (one hole) at start' },
      garbageToken: { type: 'string', default: 'garbage', effect: 'token of garbage cells' },
      onTopOut: { type: 'effects', default: DEFAULT_TOP_OUT, effect: 'run when a piece cannot spawn or locks out above the board' },
    },
    provides: {
      events: ['falling_garbage_request', 'piece_spawned', 'piece_spawned:*', 'piece_moved', 'piece_rotated', 'piece_held', 'piece_locked', 'piece_locked:*', 'piece_blocked', 'piece_fizzled', 'lines_cleared', 'lines_cleared:*', 'tspin', 'perfect_clear', 'garbage_added', 'top_out', 'falling_level', 'score', 'move', 'row_cleared_entity', 'row_cleared_entity:*'],
      vars: ['falling.lines', 'falling.level', 'falling.pieces', 'falling.combo', 'score'],
      actions: ['shift_left', 'shift_right', 'soft_drop', 'hard_drop', 'rotate_cw', 'rotate_ccw', 'hold', 'place'],
      services: ['board'],
      content: [...BOARD_CONTENT],
    },
    requires: { capabilities: ['editCells'] },
    reads: ['content.blocks'],
    rules: {
      // The board rules validateBoard (puzzle-lib-board.js) emits; that file exports them as BOARD_RULES on E-gp-mz's branch.
      board_fall: { fields: ['board.fall'], message: 'board.fall is -1 or 1 (the space-axis direction pieces fall)', example: { board: { name: null, at: null, size: null, axes: null, fall: 0, layer: null } } },
      board_axes: { fields: ['board.axes', 'board.at'], message: 'board.axes names two different space axes, each an index of board.at' },
      pieces_pairs_exclusive: { fields: ['sets'], message: "the pairs set is not mixed with other piece sets" },
      pieces_custom_missing: { fields: ['sets', 'custom'], message: "the custom set comes with custom pieces" },
      piece_shape: { fields: ['custom[].rows', 'board.size'], message: 'a custom piece is 1-9 edge-connected cells, no wider than the board' },
      falling_archetype: { fields: ['land', 'archetype'], message: "land 'spawn' names the archetype spawned per cell" },
      board_too_small: { fields: ['board.size', 'hidden'], message: 'the board is taller than hidden rows + 1' },
    },
  },
  logic(logic) {
    logic.effect('add_garbage', {
      check: (e, path, errors) => { if (!Number.isInteger(e.rows) || e.rows < 1 || e.rows > 40) errors.push({ code: 'effect_invalid', path: `${path}.rows`, message: 'rows must be an integer 1..40' }); },
      run: (e, rt) => rt.emit('falling_garbage_request', { rows: e.rows, board: e.board ?? null }),
    });
  },
  validate(config) {
    const errors = validateBoard(config.board);
    if (config.sets.includes('pairs') && config.sets.length > 1) errors.push({ code: 'pieces_pairs_exclusive', path: 'with.sets', message: 'pairs cannot be mixed with other piece sets' });
    if (config.sets.includes('custom') && !config.custom.length) errors.push({ code: 'pieces_custom_missing', path: 'with.custom', message: "set 'custom' needs custom pieces" });
    config.custom.forEach((p, i) => {
      const cells = parseShape(p.rows);
      if (cells.length < 1 || cells.length > 9 || !connected(cells)) errors.push({ code: 'piece_shape', path: `with.custom[${i}].rows`, message: 'a custom piece is 1-9 edge-connected cells', hint: 'e.g. ["##", ".#"]' });
      if (Math.max(...cells.map(c => c[0]), 0) >= config.board.size[0]) errors.push({ code: 'piece_shape', path: `with.custom[${i}].rows`, message: 'piece wider than the board' });
    });
    if (config.land === 'spawn' && !config.archetype) errors.push({ code: 'falling_archetype', path: 'with.archetype', message: 'land = spawn needs an archetype' });
    if (config.board.size[1] <= config.hidden + 1) errors.push({ code: 'board_too_small', path: 'with.board.size', message: 'board must be taller than hidden rows + 1' });
    return errors;
  },
  solverKey: (rt, config) => solverKey(rt, config.board.name),
  progress: rt => Object.entries(rt.state.prim).filter(([k]) => k.startsWith(`${ID}:`)).reduce((n, [, s]) => n + (s.lines || 0), 0),
  install(rt, config, instance) {
    const key = `${ID}:${config.board.name}`, types = typesFor(config);
    const spaceId = instance.space ?? rt.doc.spaces[0].id;
    const B = () => boardOf(rt, config.board, spaceId);
    const st = () => rt.store(key);
    const solidArch = new Set([...(config.land === 'spawn' ? [config.archetype] : []), ...config.solidArchetypes]);
    provideBoard(rt, config.board.name, B);

    // ---- board queries ----
    const occupied = (b, c, r) => {
      if (c < 0 || c >= b.W || r >= b.H) return true;
      if (r < 0) return false; // open air above the board
      if (solidToken(rt, b.get(c, r))) return true;
      return solidArch.size > 0 && b.entitiesAt(c, r).some(e => solidArch.has(e.archetype));
    };
    const cellsOf = (p, r = p.r, x = p.x, y = p.y) => types[p.t].states[r].map(([cx, cy]) => [x + cx, y + cy]);
    const fits = (b, p, r = p.r, x = p.x, y = p.y) => cellsOf(p, r, x, y).every(([c, rr]) => !occupied(b, c, rr));
    const dropY = (b, p, r = p.r, x = p.x, y = p.y) => { while (fits(b, p, r, x, y + 1)) y++; return y; };
    const award_ = (s, n, reason, data) => { if (config.scoring !== 'none' && n) award(rt, n, reason, { board: config.board.name, ...data }); };
    const setVars = s => { const v = rt.state.vars; v['falling.lines'] = s.lines; v['falling.level'] = s.level; v['falling.pieces'] = s.pieces; v['falling.combo'] = s.combo; };

    // ---- piece flow ----
    function refill(s) {
      while (s.queue.length < Math.max(7, config.next + 1)) {
        if (config.randomizer === 'bag') { if (!s.bag.length) s.bag = shuffle(rt, types.map((_, i) => i)); s.queue.push(s.bag.shift()); }
        else s.queue.push(rint(rt, types.length));
      }
    }
    const pairColors = () => [0, 1].map(() => config.pairColors[rint(rt, config.pairColors.length)]);
    function playerColumn(b, p) {
      const e = rt.player(); if (!e || e.space !== spaceId) return null;
      const at = b.fromSpace(rt.space(spaceId).pos(e)); if (!at) return null;
      const span = Math.max(...types[p.t].states[p.r].map(c => c[0])) + 1;
      return Math.max(0, Math.min(b.W - span, at[0] - Math.floor(span / 2)));
    }
    function spawn(s, t, colors) {
      const b = B();
      if (t === undefined) { t = s.queue.shift(); refill(s); }
      const T = types[t];
      const p = { t, r: T.pair && config.pairStart === 'horizontal' ? 1 : 0, x: T.spawnX, y: T.spawnY, id: s.nextId++ };
      if (T.pair) {
        p.colors = colors || s.queuedColors.shift() || pairColors();
        while (s.queuedColors.length < Math.max(1, config.next)) s.queuedColors.push(pairColors());
      }
      if (config.steer === 'follow') p.x = playerColumn(b, p) ?? p.x;
      if (config.steer === 'drift') { const span = Math.max(...T.states[p.r].map(c => c[0])) + 1; p.x = rint(rt, Math.max(1, b.W - span + 1)); }
      s.piece = p; s.grav = 0; s.lockT = 0; s.lockMoves = 0; s.last = null; s.kick = 0; s.steerT = 0;
      if (!config.passThrough && !fits(b, p)) { topOut(s, 'spawn'); return; }
      if (fits(b, p, p.r, p.x, p.y + 1)) p.y++;
      s.lowest = p.y;
      rt.emitTyped('piece_spawned', T.key, { board: config.board.name, piece: p.id, type: T.key });
    }
    function topOut(s, reason) {
      s.piece = null; s.phase = 'over';
      rt.emit('top_out', { board: config.board.name, reason });
      rt.run(config.onTopOut, {});
    }
    function moved(b, s) {
      if (s.lockT > 0 || !fits(b, s.piece, s.piece.r, s.piece.x, s.piece.y + 1)) if (s.lockMoves < config.moveResets) { s.lockT = 0; s.lockMoves++; }
    }
    function shift(b, s, dx) {
      const p = s.piece;
      if (!fits(b, p, p.r, p.x + dx, p.y)) return false;
      p.x += dx; s.last = 'move'; moved(b, s);
      rt.emit('piece_moved', { board: config.board.name, dx });
      return true;
    }
    function rotateTry(b, p, dir) {
      const T = types[p.t], to = (p.r + dir + 4) % 4;
      if (T.pair) {
        for (const [kx, ky] of [[0, 0], [-PAIR_DX[to], -PAIR_DY[to]]]) if (fits(b, p, to, p.x + kx, p.y + ky)) return { r: to, x: p.x + kx, y: p.y + ky, kick: 0 };
        const flip = (p.r + 2) % 4; // boxed in on both sides: quick turn
        if (PAIR_DX[to] && fits(b, p, flip)) return { r: flip, x: p.x, y: p.y, kick: 0 };
        if (PAIR_DX[to] && fits(b, p, flip, p.x, p.y - PAIR_DY[flip])) return { r: flip, x: p.x, y: p.y - PAIR_DY[flip], kick: 0 };
        return null;
      }
      const kicks = kicksFor(T, p.r, to);
      for (let i = 0; i < kicks.length; i++) { const [kx, ky] = kicks[i]; if (fits(b, p, to, p.x + kx, p.y + ky)) return { r: to, x: p.x + kx, y: p.y + ky, kick: i }; }
      return null;
    }
    function rotate(b, s, dir) {
      const p = s.piece, k = rotateTry(b, p, dir);
      if (!k) return false;
      p.r = k.r; p.x = k.x; p.y = k.y; s.last = 'rotate'; s.kick = k.kick;
      if (p.y > s.lowest) { s.lowest = p.y; s.lockMoves = 0; }
      moved(b, s);
      rt.emit('piece_rotated', { board: config.board.name, dir, kick: k.kick });
      return true;
    }
    function doHold(s) {
      if (!config.hold || s.holdUsed || !s.piece) return false;
      const cur = s.piece.t, colors = s.piece.colors ?? null, held = s.holdColors;
      s.holdUsed = true;
      rt.emit('piece_held', { board: config.board.name, type: types[cur].key });
      if (s.hold < 0) { s.hold = cur; s.holdColors = colors; spawn(s); } else { const h = s.hold; s.hold = cur; s.holdColors = colors; spawn(s, h, held || undefined); }
      return true;
    }
    // 3-corner T-spin; mini unless both front corners are filled or the last kick was the 5th test.
    function tspinKind(b, s, p) {
      if (!config.tspin || types[p.t].key !== 'T' || s.last !== 'rotate') return null;
      const c = [[p.x, p.y], [p.x + 2, p.y], [p.x + 2, p.y + 2], [p.x, p.y + 2]].map(([x, y]) => y < 0 || occupied(b, x, y)); // TL TR BR BL (out of bounds counts as filled)
      if (c.filter(Boolean).length < 3) return null;
      const front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.r];
      return (c[front[0]] && c[front[1]]) || s.kick === 4 ? 'full' : 'mini';
    }
    const tokenFor = (p, i) => {
      const T = types[p.t];
      if (!T.pair) return T.token;
      const color = p.colors[i];
      if (!config.link) return color;
      const lk = PAIR_LINK[p.r];
      return mkToken(color, `link:${i === 0 ? lk : OPP[lk]}`);
    };

    // Reachability guard: board-local flood fill from the player's cell with the landing cells as walls.
    function reachCount(b, start, extra) {
      const open = (c, r) => c >= 0 && r >= 0 && c < b.W && r < b.H && !extra.has(r * b.W + c) && !occupied(b, c, r);
      if (!open(start[0], start[1])) return { count: 0, seen: new Set() };
      const seen = new Set([start[1] * b.W + start[0]]), stack = [start];
      while (stack.length) { const [c, r] = stack.pop(); for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [c + dc, r + dr], k = n[1] * b.W + n[0]; if (!seen.has(k) && open(n[0], n[1])) { seen.add(k); stack.push(n); } } }
      return { count: seen.size, seen };
    }
    function canLand(b, cells) {
      // Never bury an entity (the player, enemies) unless it is itself solid.
      for (const [c, r] of cells) if (b.entitiesAt(c, r).some(e => !solidArch.has(e.archetype))) return 'occupied';
      if (config.guard === 'reachable') {
        const pl = rt.player();
        const at = pl && pl.space === spaceId ? b.fromSpace(b.api.pos(pl)) : null;
        if (at && b.inside(at[0], at[1])) {
          const before = reachCount(b, at, new Set()), keys = new Set(cells.map(([c, r]) => r * b.W + c));
          const lost = cells.filter(([c, r]) => before.seen.has(r * b.W + c)).length;
          if (before.count && reachCount(b, at, keys).count !== before.count - lost) return 'cuts_off';
        }
      }
      return null;
    }

    function lock(s) {
      const b = B(), p = s.piece, cells = cellsOf(p), T = types[p.t];
      if (cells.some(([, r]) => r < 0) || cells.every(([, r]) => r < config.hidden) && config.hidden > 0) { topOut(s, 'lock_out'); return; }
      const why = canLand(b, cells);
      if (why) {
        rt.emit('piece_blocked', { board: config.board.name, reason: why });
        if (config.passThrough && cells.every(([, r]) => r + 1 < b.H)) { p.y++; return; } // keeps falling past
        s.piece = null; s.holdUsed = false; afterLock(s); return;
      }
      const spin = tspinKind(b, s, p);
      cells.forEach(([c, r], i) => {
        if (config.land === 'spawn') rt.spawn(config.archetype, { space: spaceId, at: b.toSpace(c, r) });
        else b.set(c, r, tokenFor(p, i), ID);
      });
      s.pieces++; s.piece = null; s.holdUsed = false;
      rt.emit('move', { board: config.board.name, kind: 'drop' });
      rt.emitTyped('piece_locked', T.key, { board: config.board.name, cells: cells.map(([c, r]) => [c, r]), spaceCells: cells.map(([c, r]) => b.toSpace(c, r)), type: T.key, spin });
      if (config.settle) settleBoard(rt, b, { by: ID });
      if (config.scoring === 'flat') award_(s, 10 * cells.length, 'piece');
      // Line clears.
      const rows = [];
      if (config.clearRows !== 'none') for (let r = 0; r < b.H; r++) { let full = true; for (let c = 0; c < b.W && full; c++) full = occupied(b, c, r); if (full) rows.push(r); }
      const n = rows.length;
      if (config.scoring === 'guideline') {
        let pts = 0, label = '';
        if (spin === 'full') { pts = [400, 800, 1200, 1600, 2000][n] ?? 2000; label = `T-Spin ${NAMES[n] || ''}`.trim(); }
        else if (spin === 'mini') { pts = [100, 200, 400][n] ?? 400; label = `Mini T-Spin ${NAMES[n] || ''}`.trim(); }
        else if (n) { pts = [0, 100, 300, 500, 800, 1200][n] ?? 1200; label = NAMES[n] || `${n} lines`; }
        const difficult = n >= 4 || (spin && n > 0);
        let b2b = false;
        if (n) {
          if (difficult && s.b2b) { pts = Math.round(pts * 1.5); b2b = true; }
          s.b2b = difficult; s.combo++;
          if (s.combo > 0) pts += 50 * s.combo;
        } else s.combo = -1;
        let perfect = false;
        if (n) {
          const set = new Set(rows);
          perfect = true;
          for (let r = 0; r < b.H && perfect; r++) if (!set.has(r)) for (let c = 0; c < b.W; c++) if (occupied(b, c, r)) { perfect = false; break; }
          if (perfect) pts += [0, 800, 1200, 1800, 2000, 2400][Math.min(5, n)];
        }
        const gained = pts * s.level;
        if (spin) rt.emitTyped('tspin', spin, { board: config.board.name, lines: n });
        if (perfect) rt.emit('perfect_clear', { board: config.board.name, lines: n });
        if (n || spin) rt.emitTyped('lines_cleared', n, { board: config.board.name, count: n, rows, spin, b2b, combo: s.combo, perfect, label, points: gained });
        award_(s, gained, label || 'lines');
      } else {
        if (n) { s.combo++; rt.emitTyped('lines_cleared', n, { board: config.board.name, count: n, rows, combo: s.combo }); } else s.combo = -1;
        if (config.scoring === 'flat') award_(s, 100 * b.W * n, 'row');
      }
      setVars(s);
      if (n) { s.phase = 'clear'; s.phaseT = config.clearFrames; s.clearRows = rows; if (!config.clearFrames) finishClear(s); return; }
      afterLock(s);
    }
    function finishClear(s) {
      const b = B(), rows = new Set(s.clearRows);
      if (config.land === 'spawn' || solidArch.size) {
        for (const r of rows) for (let c = 0; c < b.W; c++) for (const e of b.entitiesAt(c, r)) if (solidArch.has(e.archetype)) { rt.emitTyped('row_cleared_entity', e.archetype, { id: e.id }); rt.despawn(e.id); }
      }
      const before = b.read(), grid = before.slice();
      if (config.clearRows === 'shift') {
        const keep = [];
        for (let r = 0; r < b.H; r++) if (!rows.has(r)) keep.push(grid.slice(r * b.W, r * b.W + b.W));
        const out = [...Array.from({ length: rows.size }, () => new Array(b.W).fill(null)), ...keep].flat();
        b.write(out, before, ID);
        if (solidArch.size) { // solid entities above the cleared rows drop with them
          for (const e of Object.values(rt.state.entities)) {
            if (e.space !== spaceId || !solidArch.has(e.archetype)) continue;
            const at = b.fromSpace(b.api.pos(e)); if (!at || !b.inside(at[0], at[1])) continue;
            const drop = [...rows].filter(r => r > at[1]).length;
            if (drop) b.api.setPos(e, b.toSpace(at[0], at[1] + drop), rt);
          }
        }
      } else {
        for (const r of rows) for (let c = 0; c < b.W; c++) grid[r * b.W + c] = null;
        b.write(grid, before, ID);
      }
      s.lines += rows.size; s.clearRows = []; s.phase = 'play';
      if (config.levelEvery && Math.floor(s.lines / config.levelEvery) + config.level > s.level) {
        s.level = Math.floor(s.lines / config.levelEvery) + config.level;
        rt.emit('falling_level', { board: config.board.name, level: s.level });
      }
      setVars(s);
      afterLock(s);
    }
    function afterLock(s) {
      if (s.phase === 'over') return;
      s.phase = s.waiting ? 'wait' : 'play';
      s.delay = Math.round(config.every * 60);
    }
    function pushGarbage(s, n) {
      const b = B(), before = b.read();
      for (let i = 0; i < n * b.W; i++) if (before[i] != null) { topOut(s, 'garbage'); return; }
      const rows = [];
      let hole = rint(rt, b.W);
      for (let k = 0; k < n; k++) { if (k && rint(rt, 10) < 3) hole = (hole + 1 + rint(rt, b.W - 1)) % b.W; rows.push(Array.from({ length: b.W }, (_, c) => c === hole ? null : config.garbageToken)); }
      b.write([...before.slice(n * b.W), ...rows.flat()], before, ID);
      if (s.piece && !fits(b, s.piece)) { let y = s.piece.y; while (y > -4 && !fits(b, s.piece, s.piece.r, s.piece.x, y)) y--; s.piece.y = y; s.lowest = Math.min(s.lowest, y); }
      rt.emit('garbage_added', { board: config.board.name, rows: n });
    }

    function hardDrop(b, s) {
      const p = s.piece, y0 = p.y, y1 = config.passThrough ? restY(b, p) : dropY(b, p);
      if (y1 === null) { s.piece = null; rt.emit('piece_fizzled', { board: config.board.name }); afterLock(s); return; }
      p.y = y1;
      if (y1 > y0) { s.last = 'drop'; if (config.scoring === 'guideline') award_(s, 2 * (y1 - y0), 'hard_drop'); }
      lock(s);
    }
    // passThrough: first position at/below the piece where it is open and resting on something.
    function restY(b, p) {
      for (let y = p.y; ; y++) {
        const cur = cellsOf(p, p.r, p.x, y);
        if (cur.every(([, r]) => r >= b.H)) return null;
        if (cur.every(([c, r]) => r >= 0 && !occupied(b, c, r)) && !fits(b, p, p.r, p.x, y + 1)) return y;
      }
    }
    /** Macro verb: rotate then shift through the real kick/collision code, then hard drop. */
    /** Values without an integer target (e.g. a generic `place: true`) are ignored; shifting is bounded by the board width. */
    function place(s, v) {
      if (!v || typeof v !== 'object') return false;
      const b = B();
      if (v.hold) { if (!doHold(s)) return false; if (!s.piece) return false; }
      const p = s.piece; if (!p) return false;
      const tx = v.x ?? p.x, tr = v.r ?? p.r;
      if (!Number.isInteger(tx) || !Number.isInteger(tr)) return false;
      const dir = v.ccw ? -1 : 1;
      for (let i = 0; i < 4 && p.r !== ((tr % 4) + 4) % 4; i++) if (!rotate(b, s, dir)) return false;
      for (let i = 0; i <= b.W && p.x !== tx; i++) if (!shift(b, s, Math.sign(tx - p.x))) return false;
      if (p.x !== tx) return false;
      hardDrop(b, s);
      return true;
    }

    const init = () => {
      const s = st();
      if (s.phase) return;
      Object.assign(s, { phase: 'play', piece: null, queue: [], bag: [], queuedColors: [], hold: -1, holdColors: null, holdUsed: false, nextId: 1, grav: 0, lockT: 0, lockMoves: 0, lowest: 0,
        shift: { dir: 0, t: 0 }, prev: {}, last: null, kick: 0, lines: 0, level: config.level, pieces: 0, combo: -1, b2b: false, clearRows: [], waiting: false,
        delay: config.every ? Math.round(config.every * 30) : 0, steerT: 0, ghost: null, press: {} });
      refill(s);
      setVars(s);
      if (config.garbage) pushGarbage(s, config.garbage);
    };
    init();

    for (const verb of ['shift_left', 'shift_right', 'soft_drop', 'hard_drop', 'rotate_cw', 'rotate_ccw', 'hold']) rt.action(verb, () => { st().press[verb] = true; });
    rt.action('place', v => { const s = st(); if (s.phase === 'play' && s.piece) place(s, v); });
    rt.on('board_busy', d => { if (d.board === config.board.name) st().waiting = true; });
    rt.on('board_idle', d => { if (d.board === config.board.name) { const s = st(); s.waiting = false; if (s.phase === 'wait') s.phase = 'play'; } });
    rt.on('falling_garbage_request', d => { if (d.board == null || d.board === config.board.name) { const s = st(); if (s.phase !== 'over') pushGarbage(s, d.rows); } });

    rt.system('movement', rt => {
      const s = st(); init();
      const press = s.press; s.press = {};
      const lv = rt.state.vars['falling.level']; if (Number.isFinite(lv) && lv >= 1) s.level = lv; // stage tables may set it
      if (s.phase === 'over' || s.phase === 'wait') return;
      if (s.phase === 'clear') { if (--s.phaseT <= 0) finishClear(s); return; }
      const b = B();
      if (!s.piece) {
        if (s.delay > 0) { s.delay--; return; }
        spawn(s); if (!s.piece) return;
      }
      const p = s.piece;
      const prev = s.prev || {};
      s.prev = { ...press };
      const edge = verb => press[verb] && !prev[verb];
      const heldOrPress = verb => press[verb] || isHeld(rt, verb);
      if (config.hold && edge('hold')) { doHold(s); return; }
      if (edge('rotate_cw')) rotate(b, s, 1); else if (edge('rotate_ccw')) rotate(b, s, -1);
      if (config.steer === 'player') {
        const dir = (heldOrPress('shift_right') ? 1 : 0) - (heldOrPress('shift_left') ? 1 : 0);
        const dx = autoShift(s.shift, dir, config.das, config.arr);
        if (dx) shift(b, s, dx);
      } else if (config.steer === 'follow' && ++s.steerT >= 5) {
        s.steerT = 0; const want = playerColumn(b, p);
        if (want !== null && want !== p.x) { if (config.passThrough) p.x += Math.sign(want - p.x); else shift(b, s, Math.sign(want - p.x)); }
      }
      if (edge('hard_drop')) { hardDrop(b, s); return; }
      const soft = heldOrPress('soft_drop');
      const base = config.rowsPerSecond > 0 ? config.rowsPerSecond / 60 : gravityRows(s.level);
      s.grav += soft ? Math.max(base * config.softFactor, 0.34) : base;
      if (config.passThrough) {
        while (s.grav >= 1 && s.piece) {
          s.grav -= 1;
          const cur = cellsOf(p), next = cellsOf(p, p.r, p.x, p.y + 1);
          if (cur.every(([c, r]) => r >= 0 && !occupied(b, c, r)) && next.some(([c, r]) => occupied(b, c, r))) { lock(s); if (s.piece !== p) return; continue; }
          if (next.every(([, r]) => r >= b.H)) { s.piece = null; rt.emit('piece_fizzled', { board: config.board.name }); afterLock(s); return; }
          p.y++;
        }
        s.ghost = restY(b, p);
        return;
      }
      while (s.grav >= 1) {
        s.grav -= 1;
        if (fits(b, p, p.r, p.x, p.y + 1)) {
          p.y++; s.last = 'drop';
          if (soft && config.scoring === 'guideline') award_(s, 1, 'soft_drop');
          if (p.y > s.lowest) { s.lowest = p.y; s.lockMoves = 0; s.lockT = 0; }
        } else { s.grav = 0; break; }
      }
      if (!fits(b, p, p.r, p.x, p.y + 1)) {
        s.lockT++;
        if (s.lockT >= config.lockDelay || (config.moveResets && s.lockMoves >= config.moveResets)) { lock(s); return; }
      }
      if (config.ghost && s.piece) s.ghost = dropY(b, p);
    }, ID);

    // Solver options: one per distinct final (rotation, column) placement, plus hold variants.
    rt.options(rt => {
      const s = st();
      if (config.steer !== 'player' || s.phase !== 'play' || !s.piece) return [];
      return placements(s, B()).map(o => ({ label: `place ${types[s.piece.t].key} r${o.r} x${o.x}${o.ccw ? ' ccw' : ''}`, text: `Drop in column ${o.x + 1}${o.r ? `, turned ${o.r * 90}°` : ''}${o.ccw ? ' left' : ''}`, actions: { place: { r: o.r, x: o.x, ccw: o.ccw } } }));
    });
    function placements(s, b) {
      const out = [], seen = new Set(), p0 = s.piece;
      for (const ccw of [false, true]) for (let turns = 0; turns < 4; turns++) {
        const p = { ...p0 }; let ok = true;
        for (let i = 0; i < turns && ok; i++) { const k = rotateTry(b, p, ccw ? -1 : 1); if (!k) ok = false; else { p.r = k.r; p.x = k.x; p.y = k.y; } }
        if (!ok) continue;
        for (const dir of [-1, 1]) {
          const q = { ...p };
          for (;;) {
            const y = config.passThrough ? restY(b, q) : dropY(b, q);
            if (y !== null) { const k = cellsOf(q, q.r, q.x, y).map(c => c.join(',')).sort().join('|'); if (!seen.has(k)) { seen.add(k); out.push({ r: q.r, x: q.x, ccw }); } }
            if (!fits(b, q, q.r, q.x + dir, q.y)) break;
            q.x += dir;
          }
        }
      }
      return out;
    }
    rt.caches[key] = { types, cellsOf, placements: () => placements(st(), B()) };
  },
};

/** Compact solver key for a falling board: cells + piece + hold + queue head. */
export function solverKey(rt, name = 'board') {
  const s = rt.state.prim[`${ID}:${name}`], b = rt.service(`board:${name}`);
  let cells = '';
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) cells += b.get(x, y) == null ? '.' : '#';
  return `${cells}|${s?.piece ? [s.piece.t, s.piece.r, s.piece.x, s.piece.y].join(',') : '-'}|${s?.hold}|${(s?.queue || []).slice(0, 2).join(',')}`;
}
