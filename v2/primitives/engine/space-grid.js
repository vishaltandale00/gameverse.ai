// A discrete board: square, hex (odd-r offset) or iso cells, optional diagonals
// and wrap-around (tunnels, toroidal boards) with wrap-aware distances. Cells
// hold blocks per layer (terrain, pieces...) with an edit log. Per-block cell
// rules make passability generic: who may enter (class allow-lists: the maze
// house door), one-way cells (no exit/entry in given directions: the maze's
// no-up tiles), speed and cost modifiers (tunnel slowdown, rough terrain),
// cover and opacity (tactics). settle() is column gravity for falling and
// match puzzles. Tactics, puzzle, maze and ARC-style games all live here.
import { cellStore, zoneIndex, zoneTracker, zoneEditor, ownSpaces, obstacleOf, dynamicObstacle, inSpace, key2, unkey, mod, astar, Heap, shapeHitsRect, BOUNDS_CAPS } from './spaces2d-lib.js';

const SQ = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0], 'up-left': [-1, 1], 'up-right': [1, 1], 'down-left': [-1, -1], 'down-right': [1, -1] };
// odd-r hex neighbours: [dc, dr] for even and odd rows; names assume +row is "north".
const HEX = {
  even: { e: [1, 0], w: [-1, 0], ne: [0, 1], nw: [-1, 1], se: [0, -1], sw: [-1, -1] },
  odd: { e: [1, 0], w: [-1, 0], ne: [1, 1], nw: [0, 1], se: [1, -1], sw: [0, -1] },
};
const RULE_FIELDS = ['pass', 'noExit', 'noEnter', 'speed', 'cost', 'cover', 'opaque', 'fixed', 'appliesTo', 'except'];

export default {
  id: 'engine.space.grid',
  card: {
    intent: 'A discrete board of square, hex or iso cells (tactics, puzzles, mazes, board games, ARC-style grids). Per-cell rules give passability by entity class, one-way cells, speed/cost, cover and line of sight; optional wrap-around; column settling for falling and match puzzles.',
    views: ['board', 'td', 'iso'],
    params: {
      topology: { type: 'string', options: ['square', 'hex', 'iso'], default: 'square', effect: 'square, hex (odd-r offset rows) or iso (square logic, diamond projection)' },
      size: { type: 'list', of: { type: 'integer', min: 1, max: 512 }, min: 2, max: 2, default: [8, 8], unit: 'cells', effect: 'columns and rows' },
      diagonals: { type: 'boolean', default: false, effect: 'square/iso: 8-way moves (no corner cutting past impassable cells)' },
      wrap: { type: 'string', options: ['none', 'x', 'y', 'both'], default: 'none', effect: 'wrap-around edges (maze tunnels, toroidal boards); distances take the short way round' },
      yAxis: { type: 'string', options: ['up', 'down'], default: 'up', effect: "which way rows increase on screen; 'up' and 'down' directions follow it" },
      layers: { type: 'list', of: { type: 'string' }, min: 1, default: ['terrain'], effect: 'cell layers; the first is the default for getCell/setCell' },
      rules: { type: 'object', open: true, default: {}, effect: 'blockId → {pass: bool | [classes], noExit: [dirs], noEnter: [dirs], speed: n, cost: n, cover: 0|1|2, opaque: bool, fixed: bool, appliesTo: [classes], except: [classes]}. Classes match entity id, archetype, body.layer and body.tags' },
      exclusive: { type: 'boolean', default: false, effect: 'at most one blocking entity per cell (tactics units); body.blocking=false opts out' },
      cover: { type: 'boolean', default: false, effect: 'compute cover from rules (tactics); off means coverAt is always 0' },
    },
    provides: {
      capabilities: ['position', 'distance', 'navigate', 'pathfind', 'reachable', 'occupancy', 'los', 'overlap', 'editCells', 'settle', 'cellRules', 'bounds', 'wrap'],
      capabilityMethods: { settle: ['settle', 'settled'], cellRules: ['ruleAt', 'passable', 'speedAt'], bounds: BOUNDS_CAPS.bounds, wrap: BOUNDS_CAPS.wrap },
      events: ['enter_zone', 'leave_zone', 'enter_zone:*', 'leave_zone:*', 'cell_changed', 'blocked', 'moved', 'settled', 'zone_added'],
    },
    reads: ['content.blocks'],
    at: 'At = [col, row] (integers are cell centres; square/iso may hold fractional positions while lane-moving; the cell is the rounded position). Hex uses odd-r offset coordinates. cellCenter(cell) gives layout coordinates.',
    zones: 'Zone = {id, name?, rect:[c0,r0,c1,r1) half-open, or cells:[[c,r]..], spawn?:[c,r], tags?, rules?}',
    state: 'rt.state.spaces[id] = {palette, cells:{layer:[rowString|null]}, log:[{t,at,layer,from,to,by}], inside:{entity:[zones]}, zones?:[runtime zones]}',
    notes: 'Directions: square/iso up|down|left|right (+ up-left, up-right, down-left, down-right); hex e|w|ne|nw|se|sw. Unknown blocks (not in content.blocks) are impassable unless a rule says otherwise; content.blocks solid:false makes a block passable. path/reachable opts: {who (entity or id: whose class rules apply), maxCost, avoid:[classes of blocking occupants], diagonals}. distance metrics: euclid (default, layout units), manhattan, steps (topology moves), path.',
  },
  capabilities(config) {
    const caps = ['position', 'distance', 'navigate', 'pathfind', 'reachable', 'occupancy', 'los', 'overlap', 'editCells', 'settle', 'cellRules', 'bounds'];
    if (config.wrap && config.wrap !== 'none') caps.push('wrap');
    return caps;
  },
  validate(config, doc, ctx, inst) {
    const errors = [], [W, H] = config.size || [8, 8];
    if (config.topology === 'hex' && config.diagonals) errors.push({ code: 'grid_hex_diagonals', path: 'with.diagonals', message: 'hex cells already have six neighbours; diagonals applies to square/iso' });
    if (config.topology === 'hex' && (config.wrap === 'y' || config.wrap === 'both') && H % 2) errors.push({ code: 'grid_hex_wrap', path: 'with.wrap', message: 'hex boards wrap vertically only with an even number of rows' });
    for (const [b, r] of Object.entries(config.rules || {})) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push({ code: 'rule_invalid', path: `with.rules.${b}`, message: 'a cell rule must be an object' }); continue; }
      for (const k of Object.keys(r)) if (!RULE_FIELDS.includes(k)) errors.push({ code: 'rule_invalid', path: `with.rules.${b}.${k}`, message: `unknown rule field '${k}'`, hint: `fields: ${RULE_FIELDS.join(', ')}` });
      const dirs = config.topology === 'hex' ? Object.keys(HEX.even) : Object.keys(SQ);
      for (const k of ['noExit', 'noEnter']) for (const d of r[k] || []) if (!dirs.includes(d)) errors.push({ code: 'rule_direction', path: `with.rules.${b}.${k}`, message: `unknown direction '${d}'`, hint: dirs.join(', ') });
      if (r.speed !== undefined && !(r.speed > 0)) errors.push({ code: 'rule_invalid', path: `with.rules.${b}.speed`, message: 'speed must be > 0' });
      if (r.cover !== undefined && ![0, 1, 2].includes(r.cover)) errors.push({ code: 'rule_invalid', path: `with.rules.${b}.cover`, message: 'cover is 0, 1 or 2' });
    }
    for (const [s, i] of ownSpaces(doc, 'engine.space.grid', config, inst)) (s.zones || []).forEach((z, j) => {
      const path = `spaces[${i}].zones[${j}]`, r = z.rect;
      if (r && (!Array.isArray(r) || r.length !== 4 || r[2] <= r[0] || r[3] <= r[1])) errors.push({ code: 'zone_rect_invalid', path: `${path}.rect`, message: `zone '${z.id}' rect must be [c0,r0,c1,r1) with c1>c0, r1>r0` });
      else if (r && (r[0] < 0 || r[1] < 0 || r[2] > W || r[3] > H)) errors.push({ code: 'zone_outside', path: `${path}.rect`, message: `zone '${z.id}' extends outside the ${W}×${H} board` });
      if (!r && !Array.isArray(z.cells)) errors.push({ code: 'zone_rect_invalid', path, message: `zone '${z.id}' needs rect or cells` });
    });
    return errors;
  },
  install(rt, config, instance) {
    const sid = instance.id, [W, H] = config.size, hex = config.topology === 'hex';
    const wrapX = config.wrap === 'x' || config.wrap === 'both', wrapY = config.wrap === 'y' || config.wrap === 'both';
    const ysign = config.yAxis === 'down' ? -1 : 1;
    const cells = cellStore(rt, sid, { W, H, layers: config.layers, wrapX, wrapY });
    const zones = zoneIndex(rt, sid);
    const cellKey = c => key2(c[0], c[1]);
    const norm = c => [wrapX ? mod(c[0], W) : c[0], wrapY ? mod(c[1], H) : c[1]];
    const cellOf = at => (typeof at === 'string' ? norm(unkey(at)) : norm([Math.round(at[0]), Math.round(at[1])]));
    const inBounds = c => c[0] >= 0 && c[1] >= 0 && c[0] < W && c[1] < H;
    const zoneHas = (z, at) => { const c = cellOf(at); return z.rect ? c[0] >= z.rect[0] && c[1] >= z.rect[1] && c[0] < z.rect[2] && c[1] < z.rect[3] : (z.cells || []).some(q => q[0] === c[0] && q[1] === c[1]); };
    const tracker = zoneTracker(rt, sid, zones, zoneHas, z => (z.rect ? (z.rect[2] - z.rect[0]) * (z.rect[3] - z.rect[1]) : (z.cells || []).length));

    // ---------- topology ----------
    const dirTable = r => (hex ? HEX[r & 1 ? 'odd' : 'even'] : SQ);
    const dirNames = () => (hex ? Object.keys(HEX.even) : config.diagonals ? Object.keys(SQ) : ['up', 'down', 'left', 'right']);
    // Screen-meaning of 'up' follows yAxis: flip row deltas when rows grow downward.
    const step = (c, d) => { const v = dirTable(c[1])[d]; return norm([c[0] + v[0], c[1] + v[1] * (hex ? 1 : ysign)]); };
    const dirBetween = (a, b) => { for (const d of dirNames()) { const n = step(a, d); if (n[0] === b[0] && n[1] === b[1]) return d; } return null; };
    const cube = c => { const x = c[0] - (c[1] - (c[1] & 1)) / 2, z = c[1]; return [x, -x - z, z]; };
    const wd = (a, b, n, w) => { let d = b - a; if (w) d = mod(d + n / 2, n) - n / 2; return d; };
    const delta = (a, b) => [wd(a[0], b[0], W, wrapX), wd(a[1], b[1], H, wrapY)];
    const hexSteps = (a, b) => {
      let best = Infinity;
      for (const sx of wrapX ? [-W, 0, W] : [0]) for (const sy of wrapY ? [-H, 0, H] : [0]) {
        const p = cube(a), q = cube([b[0] + sx, b[1] + sy]); best = Math.min(best, Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2])));
      }
      return best;
    };
    const cellCenter = c => (hex ? [c[0] + 0.5 * (c[1] & 1), c[1] * Math.sqrt(3) / 2] : [c[0], c[1]]);
    const steps = (a, b) => { if (hex) return hexSteps(cellOf(a), cellOf(b)); const [dx, dy] = delta(a, b); return config.diagonals ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.abs(dx) + Math.abs(dy); };

    // ---------- blocks and rules ----------
    let defsDoc = null, defs = new Map();
    const def = b => { if (defsDoc !== rt.doc) { defsDoc = rt.doc; defs = new Map((rt.doc.content?.blocks || []).map(d => [d.id, d])); } return defs.get(b); };
    const classesOf = e => (e ? [e.id, e.archetype, e.components?.body?.layer, ...(e.components?.body?.tags || [])].filter(Boolean) : []);
    const applies = (r, cls) => (!r.appliesTo || r.appliesTo.some(c => cls.includes(c))) && !(r.except || []).some(c => cls.includes(c));
    /** Rules of every block in the cell, in layer order: [{block, rule}]. */
    // Derived navigation data lives in rt.caches (never state), keyed by the board's content version and the
    // document: per-cell rules, and per-walker adjacency and reachable sets built lazily. navStats() counts builds.
    const navCache = () => {
      const c = (rt.caches[`spaces2d.gridnav:${sid}`] ??= { doc: null, ver: null, rules: new Map(), graphs: new Map(), stats: { builds: 0, hits: 0 } }), v = cells.version();
      if (c.doc !== rt.doc || c.ver !== v) { c.doc = rt.doc; c.ver = v; c.rules.clear(); c.graphs.clear(); }
      return c;
    };
    const rulesIn = c => {
      const memo = navCache().rules, k = cellKey(c); let out = memo.get(k);
      if (!out) {
        out = config.layers.map(l => cells.get(c, l)).filter(b => b != null).map(b => {
          const r = config.rules[b], d = def(b);
          return { block: b, rule: r || {}, solid: r?.pass !== undefined ? r.pass === false : d ? d.solid === true : true, opaque: r?.opaque ?? (d ? d.opaque ?? d.solid === true : true) };
        });
        memo.set(k, out);
      }
      return out;
    };
    const passFor = (x, cls) => {
      const p = x.rule.pass;
      if (Array.isArray(p)) return p.some(c => cls.includes(c));
      if (p === true || p === false) return p;
      return !x.solid;
    };
    /** Whether e (or a generic walker when e is null) may stand in cell c. */
    const enterable = (c, e) => { if (!inBounds(c)) return false; const cls = classesOf(e); return rulesIn(c).every(x => passFor(x, cls)); };
    /** Whether e may step from a to adjacent b: passability, one-way rules on both cells, exclusive occupancy. */
    const stepOk = (a, b, e, { occupied = config.exclusive, obstacles = 'all' } = {}) => {
      if (!enterable(b, e)) return false;
      const d = dirBetween(a, b), cls = classesOf(e);
      if (d) { for (const x of rulesIn(a)) if (applies(x.rule, cls) && (x.rule.noExit || []).includes(d)) return false; for (const x of rulesIn(b)) if (applies(x.rule, cls) && (x.rule.noEnter || []).includes(d)) return false; }
      if (hex || !config.diagonals || a[0] === b[0] || a[1] === b[1]) { /* orthogonal */ } else if (!enterable(norm([b[0], a[1]]), e) || !enterable(norm([a[0], b[1]]), e)) return false;
      if (occupied && blockerAt(b, e)) return false;
      if (solidAt(b, e, obstacles)) return false;
      return true;
    };
    const blockerAt = (c, e) => inSpace(rt, sid, o => o !== e && o.components.body?.blocking !== false && cellKey(cellOf(o.at)) === cellKey(c)).length > 0;
    // Entity obstacles (body.solid): always block real moves; in navigation only static ones do unless
    // obstacles: 'all' (doors and pushable crates are dynamic, assumed passable) or 'none'.
    const solidAt = (c, e, mode = 'all') => mode !== 'none' && inSpace(rt, sid, o => o !== e && obstacleOf(o) === 'solid' && (mode === 'all' || !dynamicObstacle(o)) && cellKey(cellOf(o.at)) === cellKey(c)).length > 0;
    const speedAt = (c, e) => { const cls = classesOf(e); let s = 1; for (const x of rulesIn(cellOf(c))) if (applies(x.rule, cls) && x.rule.speed) s *= x.rule.speed; return s; };
    const costTo = (c, e) => { const cls = classesOf(e); let k = 1; for (const x of rulesIn(c)) if (applies(x.rule, cls)) { if (x.rule.cost !== undefined) k = Math.max(k, x.rule.cost); else if (x.rule.speed) k = Math.max(k, 1 / x.rule.speed); } return k; };
    const opaqueAt = c => !inBounds(c) || rulesIn(c).some(x => x.opaque);
    const coverOf = c => (config.cover && inBounds(c) ? Math.max(0, ...rulesIn(c).map(x => x.rule.cover ?? (x.solid ? 2 : 0))) : 0);
    const nbrs = c => dirNames().map(d => step(c, d)).filter(inBounds);
    const who = o => (o?.who == null ? null : typeof o.who === 'string' ? rt.entity(o.who) : o.who);
    // Adjacency for a walker: memoised per (walker classes, occupancy mode, positions of what blocks it).
    const graphOf = (e, o = {}) => {
      const occupied = o.occupied ?? config.exclusive, obstacles = o.obstacles ?? 'static';
      const sig = inSpace(rt, sid, x => x !== e && ((occupied && x.components.body?.blocking !== false) || (obstacles !== 'none' && obstacleOf(x) === 'solid' && (obstacles === 'all' || !dynamicObstacle(x))))).map(x => `${x.id}@${cellKey(cellOf(x.at))}`).join(' ');
      const key = JSON.stringify([classesOf(e).sort(), occupied, obstacles, sig]), c = navCache();
      let g = c.graphs.get(key);
      if (g) { c.stats.hits++; return g; }
      const adj = new Map();
      g = { adj, reach: new Map(), next: k => { let out = adj.get(k); if (!out) { const cc = unkey(k); out = []; for (const n of nbrs(cc)) if (stepOk(cc, n, e, { occupied, obstacles })) out.push([cellKey(n), costTo(n, e) * (!hex && n[0] !== cc[0] && n[1] !== cc[1] ? Math.SQRT2 : 1)]); adj.set(k, out); } return out; } };
      c.stats.builds++; c.graphs.set(key, g); if (c.graphs.size > 32) c.graphs.delete(c.graphs.keys().next().value);
      return g;
    };
    const graph = (e, o = {}) => graphOf(e, o).next;
    /** Dijkstra from start cells, bounded by maxCost: Map key → cost (memoised per graph; treat as read-only). */
    const costs = (starts, e, o = {}) => {
      const G = graphOf(e, o), mk = `${starts.join(';')}|${o.maxCost ?? ''}`, hit = G.reach.get(mk); if (hit) return hit;
      const best = new Map(), open = new Heap(), next = G.next, max = o.maxCost ?? Infinity;
      for (const s of starts) { best.set(s, 0); open.push(s, 0); }
      while (open.size) { const k = open.pop(), g = best.get(k); for (const [m, c] of next(k)) { const ng = g + c; if (ng <= max + 1e-9 && ng < (best.get(m) ?? Infinity)) { best.set(m, ng); open.push(m, ng); } } }
      G.reach.set(mk, best);
      return best;
    };
    const startsOf = from => { const z = typeof from === 'string' && zones().byId.get(from); if (z) return z.spawn ? [cellKey(cellOf(z.spawn))] : zoneCells(z).map(cellKey); return [cellKey(cellOf(from))]; };
    const zoneCells = z => { if (z.cells) return z.cells.map(norm); const out = []; for (let r = z.rect[1]; r < z.rect[3]; r++) for (let c = z.rect[0]; c < z.rect[2]; c++) out.push([c, r]); return out; };

    // Line of cells from a to b: supercover-ish via sampled lerp in layout space (hex rounds cubes).
    const line = (a, b) => {
      a = cellOf(a); b = cellOf(b);
      const n = Math.max(1, steps(a, b)), out = [];
      if (hex) {
        const p = cube(a), d = delta(a, b), q = cube([a[0] + d[0], a[1] + d[1]]);
        for (let i = 0; i <= n; i++) { const t = i / n, f = p.map((v, j) => v + (q[j] - v) * t + 1e-6 * (j === 0 ? 1 : j === 1 ? 1 : -2)); let r = f.map(Math.round); const df = r.map((v, j) => Math.abs(v - f[j])); if (df[0] > df[1] && df[0] > df[2]) r[0] = -r[1] - r[2]; else if (df[1] > df[2]) r[1] = -r[0] - r[2]; else r[2] = -r[0] - r[1]; out.push(norm([r[0] + (r[2] - (r[2] & 1)) / 2, r[2]])); }
      } else {
        const d = delta(a, b), m = Math.max(Math.abs(d[0]), Math.abs(d[1])) * 2 || 1;
        for (let i = 0; i <= m; i++) { const c = norm([Math.round(a[0] + d[0] * i / m + 1e-9), Math.round(a[1] + d[1] * i / m + 1e-9)]); if (!out.length || cellKey(out.at(-1)) !== cellKey(c)) out.push(c); }
      }
      return out;
    };
    /** Cover at cell c against an attack from `dir` (a direction name, or a [dc, dr] vector toward the attacker):
     *  the best cover among the orthogonal (hex: all) neighbours facing the attacker. */
    const coverAt = (c, dir) => {
      c = cellOf(c); if (!config.cover) return 0;
      if (typeof dir === 'string') return coverOf(step(c, dir));
      const c0 = cellCenter(c), lay = v => { if (!hex) return v; const p = cellCenter([c[0] + v[0], c[1] + v[1]]); return [p[0] - c0[0], p[1] - c0[1]]; }, V = lay(dir), vl = Math.hypot(V[0], V[1]) || 1;
      let best = 0;
      for (const d of hex ? dirNames() : ['up', 'down', 'left', 'right']) { const n = step(c, d), s = lay(delta(c, n)), sl = Math.hypot(s[0], s[1]) || 1; if ((s[0] * V[0] + s[1] * V[1]) / (sl * vl) > 0.25) best = Math.max(best, coverOf(n)); }
      return best;
    };

    const setPos = (e, at, rt) => { e.at = typeof at === 'string' ? unkey(at) : [wrapX ? mod(at[0], W) : at[0], wrapY ? mod(at[1], H) : at[1]]; tracker.track(e, rt); };
    const api = {
      kind: 'grid', anchor: 'cell', size: [W, H], config, layers: config.layers, cellCenter, cellOf: e => cellKey(cellOf(e.at ?? e)), dirs: dirNames, step,
      get zones() { return zones().byId; },
      place(e, rt) { if (e.at == null) { const z = zones().list[0]; e.at = z ? (z.spawn || zoneCells(z)[0]).slice() : [0, 0]; } setPos(e, e.at, rt); },
      remove(e, rt) { for (const z of rt.state.spaces[sid].inside?.[e.id] || []) rt.emitTyped('leave_zone', z, { who: e.id, zone: z }); tracker.forget(e); e.zone = null; },
      pos: e => e.at, setPos,
      entitiesAt: at => { const k = cellKey(cellOf(at)); return inSpace(rt, sid, e => cellKey(cellOf(e.at)) === k).map(e => e.id); },
      inZone: (e, zone) => { const z = zones().byId.get(zone); return Boolean(z) && zoneHas(z, e.at); },
      zoneAt: at => tracker.zoneAt(typeof at === 'string' ? unkey(at) : at),
      teleport(e, { zone, at }, rt) {
        const z = zone && zones().byId.get(zone);
        let p = at;
        if (!p && z) p = z.spawn || zoneCells(z).find(c => enterable(c, e) && !(config.exclusive && blockerAt(c, e))) || zoneCells(z)[0];
        if (p) setPos(e, p.slice ? p.slice() : p, rt);
      },
      nearest(e, target, rt) {
        const z = zones().byId.get(target);
        if (z) return zoneHas(z, e.at) ? 0 : Math.min(...zoneCells(z).map(c => api.distance(e.at, c)));
        let best = null; for (const o of inSpace(rt, sid)) if (o !== e && (o.id === target || o.archetype === target)) { const d = api.distance(e.at, o.at); if (best === null || d < best) best = d; }
        return best;
      },
      distance(a, b, metric = 'euclid') {
        if (typeof a === 'string') a = unkey(a); if (typeof b === 'string') b = unkey(b);
        if (metric === 'steps') return steps(a, b);
        if (metric === 'path') { const p = api.path(a, b); return p ? p.length - 1 : Infinity; }
        if (metric === 'manhattan') { const [dx, dy] = delta(a, b); return Math.abs(dx) + Math.abs(dy); }
        if (hex) { const ca = cellOf(a), d = delta(ca, cellOf(b)), p = cellCenter(ca), q = cellCenter([ca[0] + d[0], ca[1] + d[1]]); return Math.hypot(q[0] - p[0], q[1] - p[1]); }
        const [dx, dy] = delta(a, b); return Math.hypot(dx, dy);
      },
      wrapPos: at => [wrapX ? mod(at[0], W) : at[0], wrapY ? mod(at[1], H) : at[1]], delta,
      bounds: () => ({ min: [0, 0], max: [W, H], wrap: [wrapX, wrapY] }),
      inBounds: (at, m = 0) => (wrapX || (at[0] >= -0.5 - m && at[0] < W - 0.5 + m)) && (wrapY || (at[1] >= -0.5 - m && at[1] < H - 0.5 + m)),
      // navigate
      neighbors: c => nbrs(cellOf(c)),
      canMove: (e, to, rt) => { const a = cellOf(e.at), b = cellOf(to); return nbrs(a).some(n => n[0] === b[0] && n[1] === b[1]) && stepOk(a, b, e); },
      move(e, to, rt, { force = false } = {}) {
        const from = cellOf(e.at), b = cellOf(to);
        if (!force && !api.canMove(e, b, rt)) { rt.emit('blocked', { who: e.id, from, to: b }); return false; }
        setPos(e, b, rt); rt.emit('moved', { who: e.id, from, to: b, dir: dirBetween(from, b) }); return true;
      },
      // cell rules
      ruleAt: (c, e) => { const cls = classesOf(e), out = {}; for (const x of rulesIn(cellOf(c))) if (applies(x.rule, cls)) Object.assign(out, x.rule); return out; },
      passable: (c, e, from) => (from ? stepOk(cellOf(from), cellOf(c), e) : enterable(cellOf(c), e)),
      speedAt,
      // pathfind / reachable
      path(from, to, o = {}) {
        const e = who(o), starts = startsOf(from), z = typeof to === 'string' && zones().byId.get(to), occ = o.occupied ?? config.exclusive;
        const goals = new Set(z ? zoneCells(z).map(cellKey) : [cellKey(cellOf(to))]), g = z ? cellOf(z.spawn || zoneCells(z)[0]) : cellOf(to);
        // In exclusive boards the goal may be occupied (walking up to a target); other occupied cells are avoided.
        const busy = graph(e, { occupied: occ, obstacles: o.obstacles }), free = graph(e, { occupied: false, obstacles: o.obstacles });
        const next = k => { const out = busy(k); if (occ) for (const m of free(k)) if (goals.has(m[0]) && !out.some(x => x[0] === m[0])) out.push(m); return out; };
        const keys = astar(starts[0], k => goals.has(k), next, k => steps(unkey(k), g), o.maxNodes ?? 200000);
        return keys && keys.map(unkey);
      },
      reachable(from, rt, o = {}) { const G = graphOf(who(o), o), mk = `set:${startsOf(from).join(';')}|${o.maxCost ?? ''}`; let s = G.reach.get(mk); if (!s) { s = new Set(costs(startsOf(from), who(o), o).keys()); G.reach.set(mk, s); } return s; },
      navStats: () => { const c = navCache(); return { builds: c.stats.builds, hits: c.stats.hits, graphs: c.graphs.size, nodes: [...c.graphs.values()].reduce((n, g) => n + g.adj.size, 0) }; },
      canReach(a, b, c, d) { const o = c && c.state ? (d || {}) : (c || {}); const seen = api.reachable(a, rt, o), z = typeof b === 'string' && zones().byId.get(b); return z ? zoneCells(z).some(q => seen.has(cellKey(q))) : seen.has(cellKey(cellOf(b))); },
      // occupancy
      occupant: c => api.entitiesAt(c)[0] ?? null,
      cellsInRange(c, n, metric = 'steps', o = {}) {
        c = cellOf(c);
        if (o.passable) return [...costs([cellKey(c)], who(o), { ...o, maxCost: n }).keys()].map(unkey);
        const out = [];
        for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (api.distance(c, [q, r], metric) <= n + 1e-9) out.push([q, r]);
        return out;
      },
      moveCost: (from, to, e) => { const a = cellOf(from), b = cellOf(to); return stepOk(a, b, e, { occupied: false }) ? costTo(b, e) : Infinity; },
      coverAt,
      // line of sight
      los(a, b) {
        const cs = line(a, b);
        for (let i = 1; i < cs.length - 1; i++) if (opaqueAt(cs[i])) return { clear: false, cover: 0 };
        const ca = cellOf(a), cb = cellOf(b);
        return { clear: true, cover: coverAt(cb, delta(cb, ca)) };
      },
      visibleFrom(a, range) { const c = cellOf(a); return api.cellsInRange(c, range, 'euclid').filter(q => api.los(c, q).clear); },
      // overlap
      overlap(shape, filter) {
        const f = typeof filter === 'function' ? filter : null;
        return inSpace(rt, sid, e => (!f || f(e)) && hitsCell(shape, cellOf(e.at))).map(e => e.id);
      },
      contacts(e) {
        const c = cellOf(e.at), out = [];
        for (const d of dirNames()) { const n = step(c, d), v = dirTable(c[1])[d], normal = [-v[0], -v[1] * (hex ? 1 : ysign)]; if (!enterable(n, e)) out.push({ cell: n, normal, dir: d }); for (const id of api.entitiesAt(n)) if (id !== e.id) out.push({ id, normal, dir: d }); }
        return out;
      },
      // editCells
      getCell: (at, layer) => cells.get(cellOf(at), layer ?? config.layers[0]),
      setCell: (at, block, rt, by = null, layer) => cells.set(cellOf(at), block, rt, by, layer ?? config.layers[0]),
      fill: (box, block, rt, by = null, layer) => cells.fill(box, block, rt, by, layer ?? config.layers[0]),
      cellsIn: (box, layer) => cells.cellsIn(box, layer ?? config.layers[0]),
      editLog: since => cells.log(since),
      bake: (list, rt, o = {}) => cells.bake(list, { layer: o.layer ?? config.layers[0], box: o.box }),
      ...zoneEditor(rt, sid, zones, z => (Array.isArray(z.rect) || Array.isArray(z.cells) ? null : 'needs rect or cells'), rt => { for (const e of inSpace(rt, sid)) tracker.track(e, rt); }),
      // settle: gravity for cell contents
      settle(rt, o = {}) {
        const moves = plan(o);
        const layer = o.layer ?? config.layers.at(-1);
        for (const m of moves) cells.set(m.from, null, rt, o.by ?? 'settle', layer);
        for (const m of moves) cells.set(m.to, m.block, rt, o.by ?? 'settle', layer);
        if (moves.length) rt.emit('settled', { space: sid, layer, moves: moves.length, dir: o.dir ?? 'down' });
        return moves;
      },
      settled: (o = {}) => plan(o).length === 0,
    };
    // Square cells hit by a shape: aabb {at: min cell, size} (or centered), circle/cone by layout distance.
    function hitsCell(shape, c) {
      if (shape.kind === 'aabb' || !shape.kind) { const sz = shape.size || [1, 1], a = shape.centered ? [shape.at[0] - sz[0] / 2, shape.at[1] - sz[1] / 2] : shape.at; const d = delta(a, c); return d[0] >= -1e-9 && d[1] >= -1e-9 && d[0] < Math.max(1, sz[0]) && d[1] < Math.max(1, sz[1]); }
      // Circles and cones test cell centres (wrap-aware), in layout units.
      const oc = cellOf(shape.at), d = delta(oc, c);
      const o = hex ? cellCenter(oc) : shape.at, q = hex ? cellCenter([oc[0] + d[0], oc[1] + d[1]]) : [shape.at[0] + wd(shape.at[0], c[0], W, wrapX), shape.at[1] + wd(shape.at[1], c[1], H, wrapY)];
      return shapeHitsRect({ ...shape, at: o }, [q[0], q[1], q[0], q[1]]);
    }
    // Settle plan: along each line in `dir`, movable blocks of `layer` slide toward the far side
    // until they rest on the edge, another block, or a fixed block (rule fixed, in any layer).
    function plan(o = {}) {
      const layer = o.layer ?? config.layers.at(-1), dir = o.dir ?? 'down';
      const v = dir === 'down' ? [0, -ysign] : dir === 'up' ? [0, ysign] : dir === 'left' ? [-1, 0] : [1, 0];
      const vertical = v[0] === 0, lines = vertical ? W : H, len = vertical ? H : W, moves = [], only = o.columns ? new Set(o.columns) : null;
      const at = (i, j) => { const t = v[0] + v[1] > 0 ? len - 1 - j : j; return vertical ? [i, t] : [t, i]; }; // j = 0 is the side blocks fall toward
      const fixed = c => config.layers.some(l => { const b = cells.get(c, l); return b != null && config.rules[b]?.fixed; });
      for (let i = 0; i < lines; i++) {
        if (only && !only.has(i)) continue;
        let floor = 0; // next free resting index; never a fixed cell when used (fixed cells reset it past themselves)
        for (let j = 0; j < len; j++) {
          const c = at(i, j);
          if (fixed(c)) { floor = j + 1; continue; }
          const b = cells.get(c, layer); if (b == null) continue;
          if (floor < j) moves.push({ from: c, to: at(i, floor), block: b });
          floor++;
        }
      }
      return moves;
    }
    rt.defineSpace(sid, api);
    cells.init();
  },
};
