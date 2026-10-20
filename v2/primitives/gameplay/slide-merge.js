// gameplay.slide.merge: 2048-style sliding on a board in any editCells space.
// Every tile slides toward the pushed edge; equal neighbours merge once per move
// (the merged tile cannot merge again that move); fixed rocks split lines; after a
// move that changed the board a 2 (or, with spawnFour chance, a 4) appears in a
// random empty cell. Tiles are number tokens ('2', '4', ...), rocks 'rock'.
import { boardParam, validateBoard, boardOf, provideBoard, award, rint } from './puzzle-lib-board.js';

const ID = 'gameplay.slide.merge';
export const DIRS = ['left', 'right', 'up', 'down'];

/** Ordered cell lines for a direction; each lists indexes from the edge tiles move toward. */
export function linesFor(W, H, dir) {
  const out = [], horizontal = dir === 'left' || dir === 'right', rev = dir === 'right' || dir === 'down';
  const nLines = horizontal ? H : W, len = horizontal ? W : H;
  for (let a = 0; a < nLines; a++) {
    const line = [];
    for (let k = 0; k < len; k++) { const j = rev ? len - 1 - k : k; line.push(horizontal ? a * W + j : j * W + a); }
    out.push(line);
  }
  return out;
}

/** Slide values (0 empty, -1 rock). Returns { grid, moved, gained, merges: [[to, value]], moves: [[from, to]] }. */
export function slideGrid(grid, W, H, dir) {
  const out = grid.slice(), moves = [], merges = [];
  let moved = false, gained = 0;
  for (const line of linesFor(W, H, dir)) {
    let seg = [];
    const flush = () => {
      const vals = seg.filter(i => grid[i] > 0);
      let w = 0, lastMerged = true;
      for (const from of vals) {
        const v = grid[from];
        if (w > 0 && !lastMerged && out[seg[w - 1]] === v) {
          const to = seg[w - 1]; out[to] = v * 2; gained += v * 2; merges.push([to, v * 2]); moves.push([from, to]); lastMerged = true; if (from !== to) moved = true; continue;
        }
        const to = seg[w++]; out[to] = v; moves.push([from, to]); lastMerged = false; if (from !== to) moved = true;
      }
      for (let k = w; k < seg.length; k++) out[seg[k]] = 0;
      seg = [];
    };
    for (const i of line) { if (grid[i] === -1) flush(); else seg.push(i); }
    flush();
  }
  return { grid: out, moved: moved || merges.length > 0, gained, merges, moves };
}
export const canMove = (grid, W, H) => DIRS.some(d => slideGrid(grid, W, H, d).moved);

export default {
  id: ID,
  card: {
    intent: '2048-style board: slide all tiles toward an edge, equal tiles merge once per move, a 2 or 4 spawns after each move, rocks split lines; works on any editCells board.',
    views: ['board', 'td'],
    params: {
      board: boardParam([4, 4]),
      start: { type: 'integer', default: 2, min: 0, max: 16, effect: 'tiles placed at start' },
      spawnFour: { type: 'number', default: 0.1, min: 0, max: 1, effect: 'chance a spawned tile is a 4' },
      rocks: { type: 'integer', default: 0, min: 0, max: 16, effect: 'fixed rocks placed at random at start (at most width-2)' },
      layout: { type: 'list', default: [], of: { type: 'string' }, effect: "rows top to bottom: 'x' rock, '.' empty, '1'..'9' tile 2^n (1 = 2)" },
      rockToken: { type: 'string', default: 'rock', effect: 'token of rocks' },
      moves: { type: 'integer', default: 0, min: 0, max: 100000, effect: 'move limit (0 = none)' },
      target: { type: 'integer', default: 2048, min: 4, max: 1 << 30, effect: 'tile that emits tile_reached (stage goals usually read merged.value)' },
      onTarget: { type: 'effects', default: [], effect: 'run once when the target tile is first made (e.g. end_game won)' },
      slideFrames: { type: 'integer', default: 7, min: 0, max: 60, unit: 'frames', effect: 'slide animation; input during it is queued' },
      onStuck: { type: 'effects', default: [{ do: 'end_game', outcome: 'lost' }], effect: 'run when no move is left or the move limit is spent' },
    },
    provides: { events: ['slid', 'merged', 'merged:*', 'tile_spawned', 'tile_reached', 'move', 'slide_blocked', 'board_stuck', 'score'], vars: ['slide.max', 'slide.moves', 'score'], actions: ['slide'], services: ['board'] },
    requires: { capabilities: ['editCells'] },
    actionSpace: { slide: { type: 'enum', options: DIRS } },
  },
  validate(config) {
    const errors = validateBoard(config.board), [W, H] = config.board.size;
    if (config.layout.length && (config.layout.length !== H || config.layout.some(r => r.length !== W))) errors.push({ code: 'slide_layout_size', path: 'with.layout', message: `layout must be ${H} rows of ${W} characters` });
    config.layout.forEach((row, i) => { if ([...row].some(ch => !'.x123456789'.includes(ch))) errors.push({ code: 'slide_layout_char', path: `with.layout[${i}]`, message: "layout chars are '.', 'x' and 1-9" }); });
    if (config.rocks > Math.max(0, Math.min(W, H) - 2)) errors.push({ code: 'slide_rocks', path: 'with.rocks', message: 'too many rocks for the board', hint: `at most ${Math.max(0, Math.min(W, H) - 2)}` });
    if (config.target & (config.target - 1)) errors.push({ code: 'slide_target', path: 'with.target', message: 'target must be a power of two' });
    return errors;
  },
  solverKey: (rt, config) => solverKey(rt, config.board.name),
  progress: rt => Math.log2(Math.max(1, rt.state.vars['slide.max'] ?? 1)),
  install(rt, config, instance) {
    const key = `${ID}:${config.board.name}`, spaceId = instance.space ?? rt.doc.spaces[0].id, name = config.board.name;
    const B = () => boardOf(rt, config.board, spaceId), st = () => rt.store(key);
    provideBoard(rt, name, B);
    const toVal = t => t == null ? 0 : t === config.rockToken ? -1 : (Number(t) || 0);
    const toTok = v => v === 0 ? null : v === -1 ? config.rockToken : String(v);
    const readVals = b => b.read().map(toVal);
    const writeVals = (b, vals) => { const before = b.read(); b.write(vals.map(toTok), before, ID); };
    function spawnTile(b, vals) {
      const empty = vals.map((v, i) => v === 0 ? i : -1).filter(i => i >= 0);
      if (!empty.length) return null;
      const i = empty[rint(rt, empty.length)], v = rt.random() < config.spawnFour ? 4 : 2;
      vals[i] = v;
      rt.emit('tile_spawned', { board: name, at: [i % b.W, Math.floor(i / b.W)], value: v });
      return i;
    }
    const setVars = (s, vals) => { rt.state.vars['slide.max'] = Math.max(0, ...vals); rt.state.vars['slide.moves'] = s.moves; };
    function init() {
      const s = st(); if (s.phase) return;
      Object.assign(s, { phase: 'play', anim: 0, queued: null, moves: config.moves, reached: false, last: null });
      const b = B(), vals = readVals(b);
      if (vals.every(v => v === 0)) {
        config.layout.forEach((row, r) => [...row].forEach((ch, c) => { vals[r * b.W + c] = ch === 'x' ? -1 : ch === '.' ? 0 : 2 ** +ch; }));
        for (let k = 0, placed = 0; placed < config.rocks && k < 60; k++) { const i = rint(rt, vals.length); if (vals[i] === 0) { vals[i] = -1; placed++; } }
        for (let k = 0; k < config.start; k++) spawnTile(b, vals);
        writeVals(b, vals);
      }
      setVars(s, vals);
    }
    init();
    function doMove(s, dir) {
      const b = B(), vals = readVals(b), r = slideGrid(vals, b.W, b.H, dir);
      if (!r.moved) { rt.emit('slide_blocked', { board: name, dir }); return false; }
      const next = r.grid;
      if (r.gained) award(rt, r.gained, 'merge', { board: name });
      for (const [to, v] of r.merges) rt.emitTyped('merged', v, { board: name, value: v, at: [to % b.W, Math.floor(to / b.W)] });
      spawnTile(b, next);
      writeVals(b, next);
      s.last = { dir, moves: r.moves, merges: r.merges };
      if (config.moves) s.moves--;
      s.anim = config.slideFrames;
      rt.emit('slid', { board: name, dir });
      rt.emit('move', { board: name, kind: 'slide' });
      const max = Math.max(...next);
      if (max >= config.target && !s.reached) { s.reached = true; rt.emitTyped('tile_reached', max, { board: name, value: max }); rt.run(config.onTarget, {}); if (rt.state.status !== 'playing') return true; }
      setVars(s, next);
      if (!canMove(next, b.W, b.H) || (config.moves && s.moves <= 0)) { s.phase = 'over'; rt.emit('board_stuck', { board: name, reason: config.moves && s.moves <= 0 ? 'moves' : 'no_moves' }); rt.run(config.onStuck, {}); }
      return true;
    }
    rt.action('slide', v => { const s = st(); if (DIRS.includes(v)) s.queued = v; });
    for (const d of DIRS) rt.action(`slide_${d}`, () => { st().queued = d; });
    rt.system('rules', rt => {
      const s = st(); init();
      if (s.phase !== 'play') return;
      if (s.anim > 0) { s.anim--; return; }
      if (s.queued) { const d = s.queued; s.queued = null; doMove(s, d); }
    }, ID);
    rt.options(rt => {
      const s = st(); if (s.phase !== 'play' || s.anim > 0) return [];
      const b = B(), vals = readVals(b);
      return DIRS.filter(d => slideGrid(vals, b.W, b.H, d).moved).map(d => ({ label: `slide ${d}`, actions: { slide: d } }));
    });
  },
};

export function solverKey(rt, name = 'board') {
  const b = rt.service(`board:${name}`), out = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) out.push(b.get(x, y) ?? 0);
  return out.join(',');
}
