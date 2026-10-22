// gameplay.match: matching rules over a board in any editCells space.
//
// rule 'line': runs of >= min in rows/columns (match-3 swap boards; runs that
// cross merge into L/T groups). Line 4 makes a striped gem (clears its column or
// row), L/T an area bomb (3x3), line 5 a colour bomb (every gem of the board's
// most common colour); swapping two specials fires a combination
// (stripe+stripe, area+stripe, area+area, bomb+X, bomb+bomb). Viruses
// (Dr. Mario) are fixed coloured cells that clear in lines too.
// rule 'group': 4-connected same-colour groups of >= min pop (puyo), with
// adjacent garbage, chain power, colour and group bonuses.
//
// Layers: jelly under gems (peels when a gem clears on it), blockers (fixed,
// damaged by adjacent matches and special blasts), holes, items that are
// collected when they reach the bottom. Dead boards reshuffle.
// Gravity uses the space's `settle` capability when present, else column
// gravity through setCell; refill from the top is optional.
// Triggers: the `swap` verb, and/or `piece_locked` from gameplay.falling.pieces on
// the same board name; while resolving it emits board_busy, then board_idle.
import { BOARD_CONTENT, boardParam, validateBoard, boardOf, provideBoard, award, colorOf, hasTag, tagsOf, token, linkOf, linkDelta, unlink, settleBoard, rint } from './puzzle-lib-board.js';

const ID = 'gameplay.match';
const CHAIN_POWER = [0, 0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512];
const COLOR_BONUS = [0, 0, 3, 6, 12, 24, 24, 24, 24];
const groupBonus = n => n < 5 ? 0 : n >= 11 ? 10 : n - 3;
const SPECIAL_BONUS = { h: 60, v: 60, area: 100, bomb: 200 };

/** Puyo chain score for one pop step. */
export function popScore(groups, chain) {
  const n = groups.reduce((t, g) => t + g.size, 0), colors = new Set(groups.map(g => g.color)).size;
  const bonus = Math.max(1, Math.min(999, (CHAIN_POWER[Math.min(chain, CHAIN_POWER.length - 1)] || 0) + COLOR_BONUS[Math.min(colors, 8)] + groups.reduce((t, g) => t + groupBonus(g.size), 0)));
  return 10 * n * bonus;
}

/** Pure board model used by the runtime and by bots: grid of tokens, W, H, hole mask. */
export function model(cfg, grid, hole) {
  const [W, H] = cfg.board.size, N = W * H, colors = new Set(cfg.colors);
  const isColor = t => t != null && colors.has(colorOf(t));
  const special = t => t == null ? null : colorOf(t) === 'bomb' ? 'bomb' : hasTag(t, 'h') ? 'h' : hasTag(t, 'v') ? 'v' : hasTag(t, 'area') ? 'area' : null;
  const blocker = t => colorOf(t) === 'blocker';
  const item = t => t != null && colorOf(t) === cfg.items.token;
  const playable = i => !hole[i] && !blocker(grid[i]);
  const ignored = i => Math.floor(i / W) < cfg.ignoreRows;
  const xy = i => [i % W, Math.floor(i / W)];
  const M = { W, H, N, grid, hole, isColor, special, blocker, item, playable, xy };

  M.findRuns = () => {
    const runs = [];
    for (let pass = 0; pass < 2; pass++) for (let a = 0; a < (pass ? W : H); a++) {
      const len = pass ? H : W;
      let k = 0;
      while (k < len) {
        const i = pass ? k * W + a : a * W + k, c = colorOf(grid[i]);
        if (!playable(i) || ignored(i) || !isColor(grid[i])) { k++; continue; }
        let e = k + 1;
        while (e < len) { const j = pass ? e * W + a : a * W + e; if (playable(j) && !ignored(j) && isColor(grid[j]) && colorOf(grid[j]) === c) e++; else break; }
        if (e - k >= cfg.min) runs.push({ dir: pass ? 'v' : 'h', color: c, cells: Array.from({ length: e - k }, (_, t) => pass ? (k + t) * W + a : a * W + k + t) });
        k = e;
      }
    }
    return runs;
  };
  /** Runs merged into shapes, each with the special it creates and where. */
  M.findGroups = (prefer = []) => {
    const runs = M.findRuns(), owner = new Map(), groups = [];
    runs.forEach(run => {
      const hit = new Set(run.cells.map(i => owner.get(i)).filter(g => g !== undefined));
      let g;
      if (!hit.size) { g = { runs: [], cells: new Set(), color: run.color }; groups.push(g); }
      else { const list = [...hit].map(k => groups[k]); g = list[0]; for (const o of list.slice(1)) { o.runs.forEach(r => g.runs.push(r)); o.cells.forEach(c => g.cells.add(c)); o.dead = true; } }
      g.runs.push(run); run.cells.forEach(c => g.cells.add(c));
      const id = groups.indexOf(g); g.cells.forEach(c => owner.set(c, id));
    });
    return groups.filter(g => !g.dead).map(g => {
      const max = Math.max(...g.runs.map(r => r.cells.length));
      const hasH = g.runs.some(r => r.dir === 'h'), hasV = g.runs.some(r => r.dir === 'v');
      let sp = null;
      if (cfg.specials) {
        if (max >= cfg.min + 2) sp = 'bomb';
        else if (hasH && hasV) sp = 'area';
        else if (max === cfg.min + 1) sp = g.runs.find(r => r.cells.length === max).dir === 'h' ? 'v' : 'h';
      }
      let at = -1;
      if (sp) {
        at = prefer.find(i => g.cells.has(i)) ?? -1;
        if (at < 0 && sp === 'area') { const h = g.runs.filter(r => r.dir === 'h').flatMap(r => r.cells), v = new Set(g.runs.filter(r => r.dir === 'v').flatMap(r => r.cells)); at = h.find(i => v.has(i)) ?? -1; }
        if (at < 0) { const long = g.runs.reduce((m, r) => (r.cells.length > m.cells.length ? r : m)); at = long.cells[Math.floor((long.cells.length - 1) / 2)]; }
      }
      return { cells: [...g.cells], color: g.color, special: sp, at, size: g.cells.size };
    });
  };
  /** Puyo groups: 4-connected same colour >= min, plus garbage touching a popping cell. */
  M.findPops = () => {
    const seen = new Uint8Array(N), pop = new Set(), groups = [];
    const nb = j => { const x = j % W; return [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W >= 0 ? j - W : -1, j + W < N ? j + W : -1].filter(n => n >= 0 && !hole[n]); };
    for (let i = 0; i < N; i++) {
      if (seen[i] || hole[i] || ignored(i) || !isColor(grid[i])) continue;
      const c = colorOf(grid[i]), g = [i]; seen[i] = 1;
      for (let k = 0; k < g.length; k++) for (const n of nb(g[k])) if (!seen[n] && !ignored(n) && isColor(grid[n]) && colorOf(grid[n]) === c) { seen[n] = 1; g.push(n); }
      if (g.length >= cfg.min) { g.forEach(j => pop.add(j)); groups.push({ color: c, size: g.length, cells: g }); }
    }
    for (const j of [...pop]) for (const n of nb(j)) if (colorOf(grid[n]) === cfg.garbageToken) pop.add(n);
    return { clear: [...pop], hits: [], effects: [], creates: [], groups: groups.map(g => ({ color: g.color, size: g.size })) };
  };
  M.mostCommonColor = () => {
    const n = new Map(cfg.colors.map(c => [c, 0]));
    for (let i = 0; i < N; i++) if (playable(i) && isColor(grid[i])) n.set(colorOf(grid[i]), n.get(colorOf(grid[i])) + 1);
    let best = cfg.colors[0]; for (const c of cfg.colors) if (n.get(c) > n.get(best)) best = c;
    return best;
  };
  // Expand a clear set with the effect of every special inside it.
  M.expand = (clear, hits, effects) => {
    const queue = [...clear], done = new Set();
    const add = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = y * W + x; if (hole[i]) return;
      if (blocker(grid[i])) { hits.add(i); return; }
      if (!clear.has(i)) { clear.add(i); queue.push(i); }
    };
    while (queue.length) {
      const i = queue.shift(); if (done.has(i)) continue; done.add(i);
      const t = grid[i], sp = special(t), [x, y] = xy(i);
      if (sp === 'h') { effects.push({ kind: 'row', at: [x, y] }); for (let k = 0; k < W; k++) add(k, y); }
      else if (sp === 'v') { effects.push({ kind: 'col', at: [x, y] }); for (let k = 0; k < H; k++) add(x, k); }
      else if (sp === 'area') { effects.push({ kind: 'area', at: [x, y], r: 1 }); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(x + dx, y + dy); }
      else if (sp === 'bomb') { const c = M.mostCommonColor(); effects.push({ kind: 'bomb', at: [x, y], color: c }); for (let k = 0; k < N; k++) if (playable(k) && isColor(grid[k]) && colorOf(grid[k]) === c) add(k % W, Math.floor(k / W)); }
    }
  };
  /** What a cascade step clears: matched groups (creating specials) plus everything their specials hit. */
  M.computeClear = (prefer = []) => {
    const groups = M.findGroups(prefer), clear = new Set(), hits = new Set(), effects = [], creates = [];
    for (const g of groups) {
      g.cells.forEach(i => clear.add(i));
      if (g.special) creates.push([g.at, g.special === 'bomb' ? 'bomb' : token(g.color, g.special)]);
      for (const i of g.cells) { const [x, y] = xy(i); for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (nx >= 0 && ny >= 0 && nx < W && ny < H && blocker(grid[ny * W + nx])) hits.add(ny * W + nx); }
    }
    M.expand(clear, hits, effects);
    return { clear: [...clear], hits: [...hits], effects, creates, groups: groups.map(g => ({ size: g.size, special: g.special, color: g.color, at: g.at })) };
  };
  /** Swapping two specials (or a colour bomb with anything) fires a combination; null when it is not one. */
  M.comboClear = (from, to, random) => {
    const ga = grid[to], gb = grid[from], sa = special(ga), sb = special(gb);
    if (!(sa === 'bomb' || sb === 'bomb' || (sa && sb))) return null;
    if (item(ga) || item(gb)) return null;
    const clear = new Set([from, to]), hits = new Set(), effects = [], [x, y] = xy(to);
    const area = (rad, kind) => { effects.push({ kind, at: [x, y], r: rad }); for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) { const i = ny * W + nx; if (hole[i]) continue; if (blocker(grid[i])) hits.add(i); else clear.add(i); } } };
    const line = (row, colX) => {
      if (row >= 0 && row < H) { effects.push({ kind: 'row', at: [x, row] }); for (let k = 0; k < W; k++) { const i = row * W + k; if (blocker(grid[i])) hits.add(i); else if (!hole[i]) clear.add(i); } }
      if (colX >= 0 && colX < W) { effects.push({ kind: 'col', at: [colX, y] }); for (let k = 0; k < H; k++) { const i = k * W + colX; if (blocker(grid[i])) hits.add(i); else if (!hole[i]) clear.add(i); } }
    };
    // Strip the two swapped specials so the expansion does not fire them again.
    grid[from] = isColor(gb) ? colorOf(gb) : cfg.colors[0]; grid[to] = isColor(ga) ? colorOf(ga) : cfg.colors[0];
    let kind;
    if (sa === 'bomb' && sb === 'bomb') { kind = 'bomb+bomb'; area(Math.max(W, H), 'board'); }
    else if (sa === 'bomb' || sb === 'bomb') {
      const other = sa === 'bomb' ? gb : ga, c = colorOf(other), so = special(other);
      kind = so ? `bomb+${so === 'area' ? 'area' : 'stripe'}` : 'bomb';
      effects.push({ kind: 'bomb', at: [x, y], color: c });
      for (let i = 0; i < N; i++) if (playable(i) && isColor(grid[i]) && colorOf(grid[i]) === c && i !== from && i !== to) {
        if (so === 'area') grid[i] = token(c, 'area');
        else if (so) grid[i] = token(c, random() < 0.5 ? 'h' : 'v');
        clear.add(i);
      }
    } else if (sa === 'area' && sb === 'area') { kind = 'area+area'; area(2, 'area'); }
    else if (sa === 'area' || sb === 'area') { kind = 'area+stripe'; for (let d = -1; d <= 1; d++) line(y + d, x + d); }
    else { kind = 'stripe+stripe'; line(y, x); }
    M.expand(clear, hits, effects);
    return { clear: [...clear], hits: [...hits], effects, creates: [], groups: [], combo: kind };
  };
  const matchAt = i => {
    if (!isColor(grid[i]) || !playable(i)) return false;
    const c = colorOf(grid[i]), [x, y] = xy(i), same = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H && playable(yy * W + xx) && isColor(grid[yy * W + xx]) && colorOf(grid[yy * W + xx]) === c;
    let h = 1; for (let k = x - 1; same(k, y); k--) h++; for (let k = x + 1; same(k, y); k++) h++;
    if (h >= cfg.min) return true;
    let v = 1; for (let k = y - 1; same(x, k); k--) v++; for (let k = y + 1; same(x, k); k++) v++;
    return v >= cfg.min;
  };
  M.swapValid = (i, j) => {
    if (!playable(i) || !playable(j) || grid[i] == null || grid[j] == null) return false;
    if (hasTag(grid[i], 'fixed') || hasTag(grid[j], 'fixed')) return false;
    const gi = grid[i], gj = grid[j];
    if ((special(gi) === 'bomb' && !item(gj)) || (special(gj) === 'bomb' && !item(gi))) return true;
    if (special(gi) && special(gj)) return true;
    grid[i] = gj; grid[j] = gi;
    const ok = matchAt(i) || matchAt(j);
    grid[i] = gi; grid[j] = gj;
    return ok;
  };
  M.allMoves = () => { const out = []; for (let i = 0; i < N; i++) { const x = i % W; if (x < W - 1 && M.swapValid(i, i + 1)) out.push([i, i + 1]); if (i + W < N && M.swapValid(i, i + W)) out.push([i, i + W]); } return out; };
  M.hasMove = () => { for (let i = 0; i < N; i++) { if (i % W < W - 1 && M.swapValid(i, i + 1)) return true; if (i + W < N && M.swapValid(i, i + W)) return true; } return false; };
  M.fillNoMatch = random => {
    for (let i = 0; i < N; i++) {
      if (hole[i] || blocker(grid[i])) continue;
      if (grid[i] != null) continue;
      const [x, y] = xy(i), banned = new Set(), same = (a, b) => isColor(grid[a]) && isColor(grid[b]) && colorOf(grid[a]) === colorOf(grid[b]) && playable(a) && playable(b);
      if (cfg.rule === 'line') {
        if (x >= 2 && same(i - 1, i - 2)) banned.add(colorOf(grid[i - 1]));
        if (y >= 2 && same(i - W, i - 2 * W)) banned.add(colorOf(grid[i - W]));
      }
      let c, tries = 0; do { c = cfg.colors[Math.floor(random() * cfg.colors.length)]; } while (banned.has(c) && banned.size < cfg.colors.length && ++tries < 64);
      grid[i] = c;
    }
  };
  /** Rearrange gems until there are no matches and at least one move. */
  M.reshuffle = random => {
    const cells = []; for (let i = 0; i < N; i++) if (playable(i) && grid[i] != null && !item(grid[i]) && !hasTag(grid[i], 'fixed')) cells.push(i);
    for (let t = 0; t < 40; t++) {
      const vals = cells.map(i => grid[i]);
      for (let k = vals.length - 1; k > 0; k--) { const j = Math.floor(random() * (k + 1)); [vals[k], vals[j]] = [vals[j], vals[k]]; }
      cells.forEach((i, k) => { grid[i] = vals[k]; });
      if (!M.findRuns().length && M.hasMove()) return true;
    }
    for (let t = 0; t < 40; t++) { cells.forEach(i => { if (!special(grid[i])) grid[i] = null; }); M.fillNoMatch(random); if (M.hasMove()) return true; }
    return false;
  };
  /** Items that reached the bottom of their column. */
  M.collectItems = () => {
    const got = [];
    for (let x = 0; x < W; x++) for (let y = H - 1; y >= 0; y--) { const i = y * W + x; if (hole[i]) continue; if (blocker(grid[i])) break; if (item(grid[i])) { grid[i] = null; got.push(i); } break; }
    return got;
  };
  return M;
}

export default {
  id: ID,
  card: {
    loop: { shows: ['cells'], verbs: ['swap'], progress: ['matched', 'cascade'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { swap: { type: 'choice', of: 'two neighbouring cells', from: 'options', emits: ['swap', 'matched'] } },
    // Match-board mode: swaps under a move limit; the score (or a stage goal) wins, running out of moves loses.
    mode: { loop: 'match-board', interaction: 'cursor-board', opponent: 'clock', space: ['engine.space.grid', ['editCells']], needs: { content: [], participants: null }, win: { when: { var: 'score', gte: '$target' }, reads: { var: 'score', by: { actions: ['swap'] } } }, lose: { param: 'onOutOfMoves', reads: { var: 'match.moves', by: { actions: ['swap'] } } }, bot: 'greedy' },
    intent: 'Matching rules on a board in any editCells space: match-3 swaps with L/T groups, striped/area/colour-bomb specials and combos, jelly, blockers, items and reshuffles; or puyo-style group pops and Dr-Mario virus lines resolved after falling pieces land, with cascades and chain scoring.',
    views: ['board', 'td', 'side'],
    params: {
      board: boardParam([8, 8]),
      rule: { type: 'string', default: 'line', options: ['line', 'group'], effect: 'line: runs in rows/columns; group: connected same-colour groups' },
      min: { type: 'integer', default: 3, min: 2, max: 8, effect: 'run length (line) or group size (group) that clears' },
      colors: { type: 'list', default: ['red', 'orange', 'yellow', 'green', 'blue'], min: 2, max: 8, of: { type: 'string' }, effect: 'gem colour tokens: the board cells (content.blocks ids)' },
      trigger: { type: 'list', default: ['swap'], min: 1, of: { type: 'string', options: ['swap', 'land'] }, effect: 'swap verb and/or piece_locked from falling pieces on this board' },
      refill: { type: 'boolean', default: true, effect: 'new gems drop in from the top after clears' },
      gravity: { type: 'boolean', default: true, effect: 'cells fall after clears (fixed cells and blockers stay)' },
      specials: { type: 'boolean', default: true, effect: 'line min+1 striped, L/T area bomb, min+2 colour bomb, and their combos (line rule)' },
      scoring: { type: 'string', default: 'match3', options: ['match3', 'chain', 'virus', 'none'], effect: 'match3: 20/cell, jelly 100, blocker 80, specials, x cascade; chain: puyo chain power; virus: 100·2^n per virus' },
      layout: { type: 'list', default: [], of: { type: 'string' }, effect: "rows top to bottom: '.' gem, '_' empty, 'j'/'J' jelly 1/2, 'b'/'B' blocker 1/2 hp, 'x' hole, 'g' garbage, 'v' virus, '1'-'8' colour index" },
      fill: { type: 'string', default: 'nomatch', options: ['nomatch', 'none'], effect: "fill '.' cells at start without ready-made matches (and with a move)" },
      viruses: { type: 'integer', default: 0, min: 0, max: 200, effect: 'viruses placed at random in the lower board (no 3 in a row)' },
      ignoreRows: { type: 'integer', default: 0, min: 0, max: 10, effect: 'top rows that never match (puyo hidden row)' },
      garbageToken: { type: 'string', default: 'garbage', effect: 'garbage cells: cleared when touching a popping group' },
      items: { type: 'object', default: { token: 'item', target: 0, chance: 0.5 }, fields: { token: { type: 'string', default: 'item' }, target: { type: 'integer', default: 0, min: 0, max: 100 }, chance: { type: 'number', default: 0.5, min: 0, max: 1 } }, effect: 'collectible items dropped in by refills (target total), collected at the bottom' },
      moves: { type: 'integer', default: 0, min: 0, max: 999, effect: 'move limit (0 = none)' },
      onOutOfMoves: { type: 'effects', default: [{ do: 'end_game', outcome: 'lost' }], effect: 'run when the move limit is spent and the board is stable' },
      reshuffle: { type: 'boolean', default: true, effect: 'reshuffle dead boards (no legal swap)' },
      swapFrames: { type: 'integer', default: 9, min: 0, max: 60, unit: 'frames', effect: 'swap animation' },
      clearFrames: { type: 'integer', default: 16, min: 0, max: 120, unit: 'frames', effect: 'pause before matched cells vanish' },
      settleFrames: { type: 'integer', default: 8, min: 0, max: 120, unit: 'frames', effect: 'pause per gravity/refill step' },
    },
    // Events it emits when it refuses a player's verb, with a reason (graphics.ui.hud says why).
    denials: ['swap_invalid'],
    provides: {
      events: ['matched', 'matched:*', 'cascade', 'chain', 'special_created', 'special_created:*', 'special_combo', 'special_combo:*', 'jelly_cleared', 'blocker_broken', 'virus_cleared', 'collected', 'board_shuffled', 'swap', 'swap_invalid', 'move', 'out_of_moves', 'board_busy', 'board_idle', 'score'],
      vars: ['match.moves', 'match.jelly', 'match.blockers', 'match.viruses', 'match.items', 'match.max_chain', 'score'],
      actions: ['swap'],
      services: ['board'],
      content: [...BOARD_CONTENT],
    },
    requires: { capabilities: ['editCells'] },
  },
  validate(config) {
    const errors = validateBoard(config.board);
    const [W, H] = config.board.size;
    if (config.layout.length && (config.layout.length !== H || config.layout.some(r => r.length !== W))) errors.push({ code: 'match_layout_size', path: 'with.layout', message: `layout must be ${H} rows of ${W} characters` });
    config.layout.forEach((row, i) => { const bad = [...row].find(ch => !'._jJbBxgv12345678'.includes(ch)); if (bad) errors.push({ code: 'match_layout_char', path: `with.layout[${i}]`, message: `unknown layout char '${bad}'` }); if ([...row].some(ch => /[1-8]/.test(ch) && +ch > config.colors.length)) errors.push({ code: 'match_layout_char', path: `with.layout[${i}]`, message: 'colour index beyond colors' }); });
    if (config.rule === 'group' && config.scoring === 'match3') errors.push({ code: 'match_rule_scoring', path: 'with.scoring', message: "group rule scores with 'chain' (or 'none')", hint: "set scoring: 'chain'" });
    if (config.trigger.includes('swap') && config.rule === 'group') errors.push({ code: 'match_rule_trigger', path: 'with.trigger', message: 'swaps need the line rule' });
    if (config.rule === 'line' && config.min > Math.max(W, H)) errors.push({ code: 'match_min', path: 'with.min', message: 'run length longer than the board' });
    return errors;
  },
  solverKey: (rt, config) => solverKey(rt, config.board.name),
  progress: rt => rt.state.vars.score ?? 0,
  install(rt, config, instance) {
    const key = `${ID}:${config.board.name}`, spaceId = instance.space ?? rt.doc.spaces[0].id;
    const B = () => boardOf(rt, config.board, spaceId), st = () => rt.store(key);
    const random = () => rt.random();
    provideBoard(rt, config.board.name, B);
    const name = config.board.name;
    const M = () => { const b = B(), s = st(); return { b, m: model(config, b.read(), s.hole) }; };
    const setVars = s => {
      const v = rt.state.vars, { m } = M();
      v['match.moves'] = s.moves; v['match.jelly'] = s.jelly.reduce((t, x) => t + x, 0); v['match.items'] = s.collected; v['match.max_chain'] = s.maxChain;
      v['match.blockers'] = m.grid.filter(t => m.blocker(t)).length; v['match.viruses'] = m.grid.filter(t => hasTag(t, 'virus')).length;
    };
    const busy = s => { if (!s.busy) { s.busy = true; rt.emit('board_busy', { board: name }); } };
    const idle = s => { s.phase = 'idle'; if (s.busy) { s.busy = false; rt.emit('board_idle', { board: name }); } };

    function init() {
      const s = st(); if (s.phase) return;
      const [W, H] = config.board.size, N = W * H, b = B();
      Object.assign(s, { phase: 'idle', t: 0, hole: new Array(N).fill(0), jelly: new Array(N).fill(0), moves: config.moves, cascade: 0, chain: 0, maxChain: 0, collected: 0, pending: null, dropViruses: 0, busy: false, swap: null, prefer: [] });
      const before = b.read(), grid = before.slice(), filling = before.every(t => t == null);
      if (filling) {
        config.layout.forEach((row, r) => [...row].forEach((ch, c) => {
          const i = r * W + c;
          if (ch === 'x') s.hole[i] = 1; else if (ch === 'j') s.jelly[i] = 1; else if (ch === 'J') s.jelly[i] = 2;
          else if (ch === 'b') grid[i] = token('blocker', 'fixed'); else if (ch === 'B') grid[i] = token('blocker', 'fixed', 'hp2');
          else if (ch === 'g') grid[i] = config.garbageToken; else if (ch === 'v') grid[i] = token(config.colors[rint(rt, config.colors.length)], 'virus', 'fixed');
          else if (/[1-8]/.test(ch)) grid[i] = config.colors[+ch - 1];
          else if (ch === '_') grid[i] = '_';
        }));
        if (config.viruses) placeViruses(grid, s.hole);
        const m = model(config, grid, s.hole);
        // '.' layout cells fill; with no layout only swap boards start full (falling-piece boards start empty).
        if (!config.layout.length && !config.trigger.includes('swap')) for (let i = 0; i < N; i++) if (grid[i] == null) grid[i] = '_';
        if (config.fill === 'nomatch') {
          m.fillNoMatch(random);
          if (config.trigger.includes('swap') && config.rule === 'line' && !m.hasMove()) m.reshuffle(random);
        }
        for (let i = 0; i < N; i++) if (grid[i] === '_') grid[i] = null;
        b.write(grid, before, ID);
      }
      setVars(s);
    }
    function placeViruses(grid, hole) {
      const [W, H] = config.board.size, top = H - Math.max(4, Math.round(H * 0.62)), n = config.viruses;
      const runLen = (x, y, c, dx, dy) => { let k = 0; for (let t = 1; t < 3; t++) { const xx = x + dx * t, yy = y + dy * t; if (xx >= 0 && yy >= 0 && xx < W && yy < H && colorOf(grid[yy * W + xx]) === c) k++; else break; } return k; };
      for (let v = 0; v < n; v++) {
        const c = config.colors[v % config.colors.length];
        for (let tries = 0; tries < 200; tries++) {
          const x = rint(rt, W), y = top + rint(rt, H - top), i = y * W + x;
          if (grid[i] != null || hole[i]) continue;
          if (runLen(x, y, c, 1, 0) + runLen(x, y, c, -1, 0) >= 2 || runLen(x, y, c, 0, 1) + runLen(x, y, c, 0, -1) >= 2) continue;
          grid[i] = token(c, 'virus', 'fixed'); break;
        }
      }
    }
    init();

    const fixed = t => hasTag(t, 'fixed');
    function settleAndRefill(s) {
      const b = B();
      const moved = config.gravity ? settleBoard(rt, b, { fixed, blocked: s.hole.some(Boolean) ? i => s.hole[i] : null, by: ID }) : [];
      const before = b.read(), grid = before.slice();
      let filled = 0;
      if (config.refill) {
        const m = model(config, grid, s.hole);
        const onBoard = grid.filter(t => m.item(t)).length;
        for (let i = 0; i < grid.length; i++) {
          if (grid[i] != null || s.hole[i]) continue;
          const top = Math.floor(i / b.W) === 0;
          if (top && config.items.target && s.collected + onBoard + filled < config.items.target && filled < 2 && rt.random() < config.items.chance) { grid[i] = config.items.token; filled++; continue; }
          grid[i] = config.colors[rint(rt, config.colors.length)];
        }
      }
      b.write(grid, before, ID);
      return moved.length || grid.some((t, i) => t !== before[i]);
    }
    function detect(s, m) {
      if (config.rule === 'group') return m.findPops();
      const res = m.computeClear(s.prefer || []);
      return res.clear.length ? res : null;
    }
    function beginClear(s, res) {
      s.pending = res; s.phase = 'clear'; s.t = config.clearFrames;
      const step = config.rule === 'group' || config.trigger.includes('land') ? ++s.chain : s.cascade;
      s.maxChain = Math.max(s.maxChain, step);
      const { b } = M(), cells = res.clear.map(i => [i % b.W, Math.floor(i / b.W)]);
      rt.emit('matched', { board: name, cascade: s.cascade, chain: s.chain, cells, groups: res.groups, effects: res.effects, combo: res.combo || null });
      for (const g of res.groups) rt.emit(`matched:${g.color}`, { board: name, size: g.size });
      if (step >= 2) { rt.emit('chain', { board: name, length: step }); rt.emit('cascade', { board: name, n: step }); }
      for (const [, t] of res.creates) rt.emitTyped('special_created', colorOf(t) === 'bomb' ? 'bomb' : tagsOf(t)[0], { board: name });
      if (res.combo) rt.emitTyped('special_combo', res.combo, { board: name });
      if (!config.clearFrames) applyClear(s);
    }
    function applyClear(s) {
      const { b, m } = M(), res = s.pending, grid = m.grid, before = grid.slice();
      let jelly = 0, broken = 0, cleared = 0, viruses = 0;
      const clearing = new Set(res.clear);
      for (const i of res.clear) {
        const t = grid[i]; if (t == null || m.item(t)) continue; // items only leave at the bottom
        if (hasTag(t, 'virus')) viruses++;
        const lk = linkOf(t);
        if (lk) { const [dc, dr] = linkDelta(lk), j = i + dr * b.W + dc; if (grid[j] != null && !clearing.has(j)) grid[j] = unlink(grid[j]); }
        grid[i] = null; cleared++;
        if (s.jelly[i] > 0) { s.jelly[i]--; jelly++; }
      }
      for (const i of res.hits) { const t = grid[i]; if (!m.blocker(t)) continue; if (hasTag(t, 'hp2')) grid[i] = token('blocker', 'fixed'); else { grid[i] = null; broken++; } }
      for (const [i, t] of res.creates) grid[i] = t;
      b.write(grid, before, ID);
      let pts = 0;
      if (config.scoring === 'match3') pts = (cleared * 20 + jelly * 100 + broken * 80 + res.creates.reduce((t, [, g]) => t + (SPECIAL_BONUS[colorOf(g) === 'bomb' ? 'bomb' : tagsOf(g)[0]] || 0), 0)) * Math.max(1, s.cascade) + (res.combo ? 300 : 0);
      else if (config.scoring === 'chain') pts = popScore(res.groups, s.chain);
      else if (config.scoring === 'virus') { for (let k = 0; k < viruses; k++) pts += 100 * 2 ** Math.min(5, s.dropViruses++); pts = (pts + 10 * (cleared - viruses)) * Math.max(1, s.chain); }
      if (pts) award(rt, pts, 'match', { board: name });
      if (jelly) rt.emit('jelly_cleared', { board: name, count: jelly });
      if (broken) rt.emit('blocker_broken', { board: name, count: broken });
      if (viruses) rt.emit('virus_cleared', { board: name, count: viruses });
      s.pending = null; s.prefer = [];
      startSettle(s);
    }
    function startSettle(s) {
      settleAndRefill(s);
      s.phase = 'settle'; s.t = config.settleFrames;
      if (!config.settleFrames) settled(s);
    }
    function settled(s) {
      const { b, m } = M();
      const got = config.items.target ? m.collectItems() : [];
      if (got.length) {
        const before = b.read(); b.write(m.grid, before, ID);
        s.collected += got.length; award(rt, 1000 * got.length, 'item', { board: name });
        rt.emit('collected', { board: name, count: got.length });
        startSettle(s); return;
      }
      const res = detect(s, m);
      if (res && res.clear.length) { s.cascade++; beginClear(s, res); return; }
      s.cascade = 0; s.chain = 0;
      setVars(s);
      if (config.moves && s.moves <= 0) { rt.emit('out_of_moves', { board: name }); idle(s); rt.run(config.onOutOfMoves, {}); return; }
      if (config.trigger.includes('swap') && config.rule === 'line' && config.reshuffle && !m.hasMove()) {
        const before = m.grid.slice(); m.reshuffle(random); b.write(m.grid, before, ID); rt.emit('board_shuffled', { board: name });
      }
      idle(s);
    }

    rt.action('swap', v => {
      const s = st(); if (!config.trigger.includes('swap') || s.phase !== 'idle') return;
      if (config.moves && s.moves <= 0) return;
      const { b, m } = M(), a = v?.a, c = v?.b;
      if (!Array.isArray(a) || !Array.isArray(c) || !b.inside(a[0], a[1]) || !b.inside(c[0], c[1]) || Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) !== 1) { rt.emit('swap_invalid', { board: name, reason: 'not_adjacent' }); return; }
      const i = a[1] * b.W + a[0], j = c[1] * b.W + c[0];
      if (!m.swapValid(i, j)) { rt.emit('swap_invalid', { board: name, reason: 'no_match', a, b: c }); return; }
      busy(s);
      s.swap = [i, j]; s.phase = 'swap'; s.t = config.swapFrames;
      rt.emit('swap', { board: name, a, b: c });
      if (!config.swapFrames) doSwap(s);
    });
    function doSwap(s) {
      const { b, m } = M(), [i, j] = s.swap, before = m.grid.slice();
      [m.grid[i], m.grid[j]] = [m.grid[j], m.grid[i]];
      if (config.moves) s.moves--;
      rt.emit('move', { board: name, kind: 'swap' });
      s.cascade = 1; s.swap = null;
      const res = m.comboClear(i, j, random) || m.computeClear([j, i]);
      b.write(m.grid, before, ID);
      setVars(s);
      beginClear(s, res);
    }
    rt.on('piece_locked', d => {
      if (d.board !== name || !config.trigger.includes('land')) return;
      const s = st(); busy(s); s.dropViruses = 0; s.chain = 0; s.cascade = 0;
      s.phase = 'landed'; // resolve in the rules phase after the piece has fully landed
    });

    rt.system('rules', rt => {
      const s = st(); init();
      if (s.phase === 'idle') { setVars(s); return; }
      if (s.phase === 'landed') { startSettle(s); return; }
      if (--s.t > 0) return;
      if (s.phase === 'swap') doSwap(s);
      else if (s.phase === 'clear') applyClear(s);
      else if (s.phase === 'settle') settled(s);
    }, ID);

    rt.options(rt => {
      const s = st();
      if (s.phase !== 'idle' || !config.trigger.includes('swap') || (config.moves && s.moves <= 0)) return [];
      const { m } = M();
      return m.allMoves().map(([i, j]) => { const a = m.xy(i), b = m.xy(j); return { label: `swap ${a} ${b}`, text: `Swap ${a.join(', ')} with ${b.join(', ')}`, actions: { swap: { a, b } } }; });
    });
  },
};

/** Compact solver key: board tokens plus moves left. */
export function solverKey(rt, name = 'board') {
  const b = rt.service(`board:${name}`), s = rt.state.prim[`${ID}:${name}`];
  const out = []; for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) out.push(b.get(x, y) ?? '.');
  return `${out.join(',')}|${s?.moves}|${s?.phase}`;
}
