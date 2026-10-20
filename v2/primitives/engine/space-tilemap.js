// 2D tile layers seen from the side (platformers, metroidvanias) or from above
// (Zelda/Pokémon maps, roguelikes). Cells are persisted compactly (palette +
// row strings) with an edit log; block collision comes from content.blocks
// (solid, tag one_way, slope:[hl,hr]) with per-space overrides. Bodies are
// boxes centered on e.at. slide() is the collide-and-slide every movement
// primitive uses: solid tiles, one-way platforms (drop-through), slopes and
// step-ups. Gravity exists only in side mode. Navigation is ability-aware
// (spaces2d-tilenav.js) and powers path, reachable and canReach.
import { cellStore, zoneIndex, zoneTracker, addZoneTo, inSpace, bodyOf, key2, unkey, mod, clamp, rectHas, rectArea, rectCenter, rectDist, boxAround, rectsOverlap, shapeHitsRect, rayRect, edgesParam, checkEdges, wrapDelta, BOUNDS_CAPS, zoneEditor, ownSpaces, obstacleOf, dynamicObstacle, obstaclesIn } from './spaces2d-lib.js';
import { makeNav, DEFAULT_ABILITIES } from './spaces2d-tilenav.js';

const EPS = 1e-4;
const STICK = 0.5; // a rider stays on the entity it stands on if that entity rose at most this far (tiles) since the last slide
const KIND_RANK = { none: 0, oneway: 1, slope: 2, solid: 3 };
const LIQUID_TAGS = ['liquid', 'water'];

export default {
  id: 'engine.space.tilemap',
  card: {
    intent: 'A 2D map of tile layers, side view with gravity (platformers, metroidvanias) or top-down (adventure maps, roguelikes). Solid tiles, one-way platforms and slopes come from content.blocks; editable cells with an edit log; ability-aware pathfinding and reachability for verification.',
    views: ['side', 'td'],
    params: {
      tile: { type: 'integer', min: 8, max: 64, unit: 'px', default: 16, effect: 'pixels per tile (renderers)' },
      size: { type: 'list', of: { type: 'integer', min: 2, max: 4096 }, min: 2, max: 2, default: [64, 32], unit: 'tiles', effect: 'map width and height' },
      mode: { type: 'string', options: ['side', 'topdown'], default: 'side', effect: 'side: gravity, platforms and slopes; topdown: walls, ledges and water' },
      gravity: { type: 'number', min: -400, max: 400, unit: 'tiles/s²', default: -60, effect: 'vertical gravity in side mode (negative pulls down); zone rules.gravity overrides it' },
      layers: { type: 'list', of: { type: 'string' }, min: 1, default: ['bg', 'solid', 'fg'], effect: 'tile layers back to front' },
      collisionLayers: { type: 'list', of: { type: 'string' }, min: 1, default: ['solid'], effect: 'layers whose blocks collide; tags (liquid, hazard, climbable) are read from every layer' },
      collision: { type: 'object', open: true, default: {}, effect: "per-block collision override: blockId → 'solid' | 'oneway' | 'none' | [hl, hr] (slope surface heights 0..1 at the tile's left and right edges)" },
      edges: edgesParam('solid'),
    },
    provides: {
      capabilities: ['position', 'distance', 'overlap', 'raycast', 'pathfind', 'reachable', 'editCells', 'surface', 'gravity', 'dynamics', 'bounds', 'wrap'],
      capabilityMethods: BOUNDS_CAPS,
      events: ['enter_zone', 'leave_zone', 'enter_zone:*', 'leave_zone:*', 'cell_changed', 'out_of_bounds', 'landed', 'zone_added'],
    },
    reads: ['content.blocks'],
    at: 'At = [x, y] in tiles, y up; the center of the body box (components.body.size, default [1,1]). Cell [i,j] covers [i,i+1)×[j,j+1).',
    zones: 'Zone = {id, name?, rect:[x0,y0,x1,y1) in tiles, spawn?:[x,y], tags?, rules?:{gravity?}}; nested zones are all entered, entity.zone is the smallest.',
    state: 'rt.state.spaces[id] = {palette, cells:{layer:[rowString|null]}, log:[{t,at,layer,from,to,by}], inside:{entity:[zones]}, out:{entity:edge}, zones?:[runtime zones]}',
    notes: 'gravity is reported only in side mode; slide/grounded also work top-down (walls, ledges entered moving -y, water without swim). Bodies with components.body.ballistic are integrated by the space (gravity, bounce, friction). path/reachable abilities (tiles): jumpHeight=3, jumpDistance=4 (alias jumpGap), doubleJump, dash, climb, wallJump, swim, fly, dropThrough=true; avoid=[hazard]. reachable returns feet-cell keys "x,y" (a shared Set: read-only). Entity obstacles: body.solid entities block slide like solid tiles and support from above; body.oneWay ones only support from above (drop-through applies). The supporting entity is recorded in body.standingOn; riders move with ballistic movers and setPos(e, at, rt, {carry:true}), and stay on a support that rose up to 0.5 tiles. A solid entity already overlapping the mover is ignored (a closing door never traps). raycast hits solid entities by default (mask.solids=false to skip). Navigation (path/reachable/canReach, opts.obstacles): "static" (default) treats solid entities that cannot move or open as cells and dynamic ones (components.mechanism, ballistic, kinematic, moving, body.dynamic) as passable, since whether a door opens is the plot/mechanism solver question; "all" includes dynamic ones where they stand; "none" ignores entities. Graphs are cached in rt.caches per map version (navStats()). Zones: addZone/removeZone/moveZone.',
  },
  capabilities(config) {
    const caps = ['position', 'distance', 'overlap', 'raycast', 'pathfind', 'reachable', 'editCells', 'surface', 'dynamics', 'bounds'];
    if (config.mode !== 'topdown') caps.push('gravity');
    if (Object.values(config.edges || {}).includes('wrap')) caps.push('wrap');
    return caps;
  },
  validate(config, doc, ctx, inst) {
    const errors = [];
    for (const l of config.collisionLayers || []) if (!(config.layers || []).includes(l)) errors.push({ code: 'layer_unknown', path: 'with.collisionLayers', message: `collision layer '${l}' is not in layers`, hint: `layers: ${(config.layers || []).join(', ')}` });
    for (const [b, v] of Object.entries(config.collision || {})) {
      const ok = ['solid', 'oneway', 'none'].includes(v) || (Array.isArray(v) && v.length === 2 && v.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
      if (!ok) errors.push({ code: 'collision_invalid', path: `with.collision.${b}`, message: `collision for '${b}' must be solid|oneway|none or [hl, hr] in 0..1` });
    }
    errors.push(...checkEdges(config.edges, 'with.edges'));
    const [W, H] = config.size || [64, 32];
    for (const [s, i] of ownSpaces(doc, 'engine.space.tilemap', config, inst)) (s.zones || []).forEach((z, j) => {
      const r = z.rect, path = `spaces[${i}].zones[${j}].rect`;
      if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isFinite) || r[2] <= r[0] || r[3] <= r[1]) errors.push({ code: 'zone_rect_invalid', path, message: `zone '${z.id}' needs rect [x0,y0,x1,y1] with x1>x0, y1>y0` });
      else if (r[0] < 0 || r[1] < 0 || r[2] > W || r[3] > H) errors.push({ code: 'zone_outside', path, message: `zone '${z.id}' extends outside the ${W}×${H} map` });
    });
    return errors;
  },
  install(rt, config, instance) {
    const sid = instance.id, [W, H] = config.size, side = config.mode !== 'topdown', E = config.edges;
    const wrapX = E.left === 'wrap', wrapY = E.bottom === 'wrap';
    const cells = cellStore(rt, sid, { W, H, layers: config.layers, wrapX, wrapY });
    const zones = zoneIndex(rt, sid);
    const zoneHas = (z, at) => Boolean(z.rect) && rectHas(z.rect, wrapPos(at));
    const tracker = zoneTracker(rt, sid, zones, zoneHas, z => (z.rect ? rectArea(z.rect) : Infinity));
    const sst = () => rt.state.spaces[sid];

    // Block definitions (re-indexed when the document changes).
    let defsDoc = null, defs = new Map(), kindCache = new Map();
    const def = b => { if (defsDoc !== rt.doc) { defsDoc = rt.doc; defs = new Map((rt.doc.content?.blocks || []).map(d => [d.id, d])); kindCache = new Map(); } return defs.get(b); };
    /** 'solid' | 'oneway' | 'slope' | 'none' for a block id (null = empty). */
    const collisionOf = b => {
      if (b == null) return 'none';
      def(b); if (kindCache.has(b)) return kindCache.get(b);
      const o = config.collision[b], d = defs.get(b);
      let k = 'solid';
      if (o !== undefined) k = Array.isArray(o) ? 'slope' : o;
      else if (d) k = Array.isArray(d.slope) ? 'slope' : (d.oneWay || (d.tags || []).some(t => t === 'one_way' || t === 'oneway')) ? 'oneway' : d.solid === false ? 'none' : 'solid';
      kindCache.set(b, k); return k;
    };
    const slopeOf = b => { const o = config.collision[b]; return Array.isArray(o) ? o : def(b)?.slope || [0, 1]; };
    const outKind = (x, y) => { const m = x < 0 ? E.left : x >= W ? E.right : y < 0 ? E.bottom : y >= H ? E.top : null; return m === 'solid' ? 'solid' : 'none'; };
    const nx = x => (wrapX ? mod(x, W) : x), ny = y => (wrapY ? mod(y, H) : y);
    const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    /** Strongest collision over the collision layers at integer cell (x, y), with the block that gives it. */
    const cellKind = (x, y) => {
      x = nx(x); y = ny(y);
      if (!inMap(x, y)) return { kind: outKind(x, y), block: null };
      let best = { kind: 'none', block: null };
      for (const l of config.collisionLayers) { const b = cells.get([x, y], l), k = collisionOf(b); if (KIND_RANK[k] > KIND_RANK[best.kind]) best = { kind: k, block: b }; }
      return best;
    };
    const kindAt = (x, y) => cellKind(x, y).kind;
    // Tags of every layer at a cell, memoised per map version and document (rt.caches, never state).
    const NO_TAGS = Object.freeze([]);
    const tagsAt = (x, y) => {
      x = nx(Math.floor(x)); y = ny(Math.floor(y)); if (!inMap(x, y)) return NO_TAGS;
      const c = (rt.caches[`spaces2d.tags:${sid}`] ??= { doc: null, ver: null, m: new Map() }), v = cells.version();
      if (c.doc !== rt.doc || c.ver !== v) { c.doc = rt.doc; c.ver = v; c.m.clear(); }
      const k = y * W + x; let out = c.m.get(k);
      if (!out) {
        out = [];
        for (const l of config.layers) { const b = cells.get([x, y], l); if (b != null) { const d = def(b); for (const t of d?.tags || []) if (!out.includes(t)) out.push(t); } }
        out = out.length ? Object.freeze(out) : NO_TAGS; c.m.set(k, out);
      }
      return out;
    };
    const isLiquid = (x, y) => tagsAt(x, y).some(t => LIQUID_TAGS.includes(t));
    const costAt = (x, y) => { let c = 1; for (const l of config.layers) { const d = def(cells.get([x, y], l)); if (Number.isFinite(d?.moveCost)) c = Math.max(c, d.moveCost); } return c; };
    const slopeY = (x, y, fx) => { const [hl, hr] = slopeOf(cellKind(x, y).block); return y + hl + (hr - hl) * clamp(fx, 0, 1); };
    const slopeNormal = (x, y) => { const [hl, hr] = slopeOf(cellKind(x, y).block), d = hr - hl, l = Math.hypot(d, 1); return [-d / l, 1 / l]; };

    function wrapPos(at) { return [wrapX ? mod(at[0], W) : at[0], wrapY ? mod(at[1], H) : at[1]]; }
    const delta = (a, b) => [wrapDelta(a[0], b[0], wrapX ? W : 0), wrapDelta(a[1], b[1], wrapY ? H : 0)];
    const size = e => bodyOf(e).size;
    const boxOf = e => boxAround(e.at, size(e));
    const toAt = v => (typeof v === 'string' ? unkey(v).map(n => n + 0.5) : v);

    // Out-of-bounds bookkeeping for kill edges: emit once per exit.
    const checkOut = (e, rt) => {
      const b = boxOf(e), o = (sst().out ??= {});
      const edge = b[2] <= 0 ? 'left' : b[0] >= W ? 'right' : b[3] <= 0 ? 'bottom' : b[1] >= H ? 'top' : null;
      if (edge && E[edge] === 'kill') { if (o[e.id] !== edge) { o[e.id] = edge; rt.emitTyped('out_of_bounds', edge, { who: e.id, edge }); } }
      else if (o[e.id]) delete o[e.id];
    };
    // setPos(e, at, rt, {carry}): with carry, entities standing on e (body.standingOn) move with it.
    const setPos = (e, at, rt, o = {}) => {
      const from = e.at;
      e.at = wrapPos([at[0], at[1]]); tracker.track(e, rt); checkOut(e, rt);
      if (o.carry && from && obstacleOf(e)) carryRiders(e, [at[0] - from[0], at[1] - from[1]], rt);
    };
    function carryRiders(e, d, rt) {
      if (!d[0] && !d[1]) return;
      for (const r of inSpace(rt, sid, o => o !== e && o.components.body?.standingOn === e.id)) { slide(r, d, rt, { ignore: [e.id], keepSupport: true }); r.components.body.grounded = true; r.components.body.standingOn = e.id; }
    }
    // Entity obstacles for one slide: boxes of body.solid entities; ones already overlapping the mover are
    // ignored (a door closing on it must not trap it), except the one it stands on.
    const obstaclesFor = (e, o = {}) => {
      const start = boxOf(e), on = e.components.body?.standingOn;
      return obstaclesIn(rt, sid, e, o.ignore).map(x => ({ id: x.id, kind: obstacleOf(x), rect: boxOf(x) })).filter(x => x.id === on || x.kind === 'oneway' || !rectsOverlap(start, x.rect))
        .map(x => (x.id === on && rectsOverlap(start, x.rect) ? { ...x, kind: 'oneway' } : x)); // a support that rose into its rider only holds it up
    };

    // ---------- collision queries ----------
    /** First blocker overlapping box: a tile rect [c, r, c+1, r+1] or a solid entity's rect (with .id), or null. */
    const blocksBox = (box, { slopes = false, oneway = null, liquids = false, ents = [] } = {}) => {
      const c0 = Math.floor(box[0] + EPS), c1 = Math.floor(box[2] - EPS), r0 = Math.floor(box[1] + EPS), r1 = Math.floor(box[3] - EPS);
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
        const k = kindAt(c, r);
        if (k === 'solid' || (slopes && k === 'slope') || (oneway && k === 'oneway' && oneway(c, r)) || (liquids && isLiquid(c, r))) return [c, r, c + 1, r + 1];
      }
      for (const o of ents) if (o.kind === 'solid' && rectsOverlap([box[0] + EPS, box[1] + EPS, box[2] - EPS, box[3] - EPS], o.rect)) return Object.assign(o.rect.slice(), { id: o.id });
      return null;
    };
    // Highest supporting surface under box between yFrom (old bottom) and yTo (new bottom), or null.
    const landing = (box, yFrom, yTo, drop, stick = 0, ents = [], on = null) => {
      let best = null, normal = [0, 1], by = null;
      const c0 = Math.floor(box[0] + EPS), c1 = Math.floor(box[2] - EPS), cx = (box[0] + box[2]) / 2, cc = Math.floor(cx);
      for (let r = Math.floor(yFrom + stick - EPS); r >= Math.floor(yTo - EPS) - 1; r--) for (let c = c0; c <= c1; c++) {
        const k = kindAt(c, r);
        let top = null;
        if (k === 'solid' || (k === 'oneway' && !drop)) top = r + 1;
        else if (k === 'slope' && c === cc) top = slopeY(c, r, cx - c);
        if (k === 'oneway' && top !== null && top > yFrom + EPS) top = null; // one-way only from above
        if (top !== null && top <= yFrom + stick + EPS && top > yTo - EPS && (best === null || top > best)) { best = top; normal = k === 'slope' ? slopeNormal(c, r) : [0, 1]; }
      }
      // Entity tops: solid and one-way entities support from above; the one being stood on may have risen up to STICK.
      for (const o of ents) {
        if (o.kind === 'oneway' && drop) continue;
        const top = o.rect[3], lift = o.id === on ? STICK : 0;
        if (box[0] < o.rect[2] - EPS && o.rect[0] < box[2] - EPS && top <= yFrom + lift + EPS && top > yTo - EPS && (best === null || top > best)) { best = top; normal = [0, 1]; by = o.id; }
      }
      return best === null ? null : { y: best, normal, on: by };
    };

    /** Collide-and-slide: axis-separated, sub-stepped (≤0.45 tiles), with step-ups and slope following. */
    function slide(e, d, rt, opts = {}) {
      const b = bodyOf(e), [hw, hh] = [b.size[0] / 2, b.size[1] / 2], was = b.grounded;
      let [x, y] = e.at; const dx = d[0] || 0, dy = d[1] || 0;
      const blocked = { x: false, y: false, z: false }, bumped = []; let grounded = false, normal = null;
      const swim = opts.swim || opts.fly, ledge = !side && !opts.fly, ents = opts.ghost ? [] : obstaclesFor(e, opts), touched = [], on = b.standingOn ?? null;
      let support = null;
      const box = (px, py) => [px - hw, py - hh, px + hw, py + hh];
      // Top-down one-way tiles are ledges: entered only moving -y (or already overlapped, mid-hop).
      const inside = (c, r) => { const b0 = box(x, y); return c >= Math.floor(b0[0] + EPS) && c <= Math.floor(b0[2] - EPS) && r >= Math.floor(b0[1] + EPS) && r <= Math.floor(b0[3] - EPS); };
      const hitAt = (px, py, down) => blocksBox(box(px, py), { liquids: !side && !swim, oneway: ledge ? (c, r) => !(down || inside(c, r)) : null, ents });
      const touch = hit => { if (hit?.id && !touched.includes(hit.id)) touched.push(hit.id); };
      // Horizontal.
      const nh = Math.ceil(Math.abs(dx) / 0.45), x0 = x;
      for (let i = 0; i < nh; i++) {
        const tx = x0 + dx * (i + 1) / nh, hit = hitAt(tx, y, false);
        if (!hit) { x = tx; continue; }
        // Step up onto low obstacles (slope crests, stairs) when supported.
        const allow = side && (was || opts.stepHeight) ? Math.max(opts.stepHeight || 0, onSlope(x, y - hh) ? 1 : 0) : 0;
        if (allow > 0) {
          let top = -Infinity; const bx = box(tx, y);
          for (let c = Math.floor(bx[0] + EPS); c <= Math.floor(bx[2] - EPS); c++) for (let r = Math.floor(bx[1] + EPS); r <= Math.floor(bx[1] + allow + EPS); r++) if (kindAt(c, r) === 'solid') top = Math.max(top, r + 1);
          const ny2 = top + hh + EPS;
          if (top > -Infinity && top - (y - hh) <= allow + EPS && !hitAt(tx, ny2, false)) { x = tx; y = ny2; continue; }
        }
        x = dx > 0 ? hit[0] - hw - EPS : hit[2] + hw + EPS; blocked.x = true; normal = [dx > 0 ? -1 : 1, 0]; touch(hit);
        if (Math.abs(x - e.at[0]) > Math.abs(dx)) x = e.at[0];
        break;
      }
      // Vertical.
      if (side) {
        const nv = Math.max(1, Math.ceil(Math.abs(dy) / 0.45));
        for (let i = 0; i < nv && dy; i++) {
          const ty = y + dy / nv;
          if (dy < 0) {
            const l = landing(box(x, ty), y - hh, ty - hh, opts.drop, 0, ents, on);
            if (l) { y = l.y + hh; grounded = true; blocked.y = true; normal = l.normal; support = l.on; if (l.on) touch({ id: l.on }); break; }
            const h = hitAt(x, ty, true); if (h) { blocked.y = true; touch(h); break; }
            y = ty;
          } else {
            const top0 = y + hh, bx = box(x, ty); let ceil = null;
            for (let c = Math.floor(bx[0] + EPS); c <= Math.floor(bx[2] - EPS); c++) for (let r = Math.floor(top0 - EPS); r <= Math.floor(bx[3] - EPS); r++) {
              const k = kindAt(c, r); if ((k === 'solid' || k === 'slope') && r >= top0 - EPS - 1e-3 && (ceil === null || r < ceil)) ceil = r;
              if ((k === 'solid' || k === 'slope') && r === ceil) bumped.push([nx(c), ny(r)]);
            }
            let ceilBy = null;
            for (const o of ents) if (o.kind === 'solid' && bx[0] < o.rect[2] - EPS && o.rect[0] < bx[2] - EPS && o.rect[1] >= top0 - EPS - 1e-3 && o.rect[1] < bx[3] && (ceil === null || o.rect[1] < ceil)) { ceil = o.rect[1]; ceilBy = o.id; }
            if (ceil !== null) { y = ceil - hh - EPS; blocked.y = true; normal = [0, -1]; if (ceilBy) touch({ id: ceilBy }); break; }
            y = ty;
          }
        }
        // Follow slopes and stay glued going downhill when grounded.
        if (!grounded && dy <= 0 && !opts.drop) {
          const l = landing(box(x, y), y - hh, y - hh - (was ? Math.abs(dx) + 0.1 : 0), false, onSlope(x, y - hh) || was ? 1 : 0, ents, on);
          if (l && (was || l.y >= y - hh - EPS || l.on) && !hitAt(x, l.y + hh, false)) { y = l.y + hh; grounded = true; normal = normal || l.normal; support = l.on; if (dy < 0) blocked.y = true; }
        }
        if (!grounded) { const g = groundedAt(x, y, hw, hh, opts.drop, ents); grounded = Boolean(g); if (g) support = g.on; }
      } else {
        const nv = Math.ceil(Math.abs(dy) / 0.45);
        for (let i = 0; i < nv; i++) {
          const ty = y + dy / nv, hit = hitAt(x, ty, dy < 0);
          if (!hit) { y = ty; continue; }
          y = dy > 0 ? hit[1] - hh - EPS : hit[3] + hh + EPS; blocked.y = true; normal = [0, dy > 0 ? -1 : 1]; touch(hit);
          break;
        }
      }
      const moved = x !== e.at[0] || y !== e.at[1];
      b.grounded = side ? grounded : false;
      if (support && b.grounded) b.standingOn = support; else if (!opts.keepSupport) delete b.standingOn;
      setPos(e, [x, y], rt, { carry: obstacleOf(e) && !opts.noCarry });
      return { moved, blocked, grounded: b.grounded, normal, bumped, touched, on: b.standingOn ?? null };
    }
    const onSlope = (x, bottom) => [Math.floor(bottom - EPS), Math.floor(bottom + EPS)].some(r => kindAt(Math.floor(x), r) === 'slope');
    function groundedAt(x, y, hw, hh, drop, ents = []) { return landing([x - hw, y - hh, x + hw, y + hh], y - hh + 0.02, y - hh - 0.03, drop, 0, ents); }

    // ---------- raycast (DDA over cells, exact slopes, optional entities) ----------
    function raycast(from, dir, maxDist, mask = {}) {
      const l = Math.hypot(dir[0], dir[1]) || 1, u = [dir[0] / l, dir[1] / l];
      let best = { hit: 'none', at: null, normal: null, dist: maxDist };
      if (mask.cells !== false) {
        let cx = Math.floor(from[0]), cy = Math.floor(from[1]), t = 0, axis = -1;
        const sx = Math.sign(u[0]), sy = Math.sign(u[1]);
        let tx = sx > 0 ? (cx + 1 - from[0]) / u[0] : sx < 0 ? (from[0] - cx) / -u[0] : Infinity;
        let ty = sy > 0 ? (cy + 1 - from[1]) / u[1] : sy < 0 ? (from[1] - cy) / -u[1] : Infinity;
        const ddx = sx ? 1 / Math.abs(u[0]) : Infinity, ddy = sy ? 1 / Math.abs(u[1]) : Infinity;
        for (let n = 0; n < 4 * (W + H) && t <= maxDist; n++) {
          const { kind, block } = cellKind(cx, cy);
          if (kind === 'solid' || (kind === 'oneway' && mask.oneway && axis === 1 && sy < 0)) {
            const nrm = axis < 0 ? [-u[0], -u[1]] : axis === 0 ? [-sx, 0] : [0, -sy];
            best = { hit: 'cell', at: [from[0] + u[0] * t, from[1] + u[1] * t], normal: nrm, dist: t, cell: [nx(cx), ny(cy)], block }; break;
          }
          if (kind === 'slope') {
            const [hl, hr] = slopeOf(block), s = raySlope(from, u, cx, cy, hl, hr, maxDist);
            if (s) { best = { hit: 'cell', at: [from[0] + u[0] * s.t, from[1] + u[1] * s.t], normal: s.n, dist: s.t, cell: [nx(cx), ny(cy)], block }; break; }
          }
          if (tx < ty) { t = tx; tx += ddx; cx += sx; axis = 0; } else { t = ty; ty += ddy; cy += sy; axis = 1; }
        }
        if (best.dist > maxDist) best = { hit: 'none', at: null, normal: null, dist: maxDist };
      }
      // Entities: all of them with mask.entities, otherwise solid obstacles unless mask.solids === false
      // (one-way ones only from above, with mask.oneway).
      const solidsToo = mask.solids !== false;
      for (const o of inSpace(rt, sid)) {
        if (o.id === mask.ignore || (typeof mask.entities === 'function' && !mask.entities(o))) continue;
        if (!mask.entities) { const k = obstacleOf(o); if (!solidsToo || !k || (k === 'oneway' && !(mask.oneway && u[1] < 0))) continue; }
        const r = boxOf(o), t = rayRect(from, u, r, best.dist);
        if (t < best.dist || (t === best.dist && best.hit === 'none' && t <= maxDist)) {
          const p = [from[0] + u[0] * t, from[1] + u[1] * t];
          const n = Math.abs(p[0] - r[0]) < 1e-6 ? [-1, 0] : Math.abs(p[0] - r[2]) < 1e-6 ? [1, 0] : Math.abs(p[1] - r[1]) < 1e-6 ? [0, -1] : [0, 1];
          best = { hit: 'entity', at: p, normal: n, dist: t, id: o.id, ...(obstacleOf(o) ? { solid: true } : {}) };
        }
      }
      return best;
    }

    // ---------- navigation ----------
    const navQ = { W, H, mode: side ? 'side' : 'topdown', wrapX, wrapY, kindAt, tagsAt: (x, y) => tagsAt(x, y), costAt };
    const navOpts = (o = {}) => {
      const env = { ...(o.envelope || {}), ...(o.abilities || {}) };
      if (env.jumpGap !== undefined && env.jumpDistance === undefined) env.jumpDistance = env.jumpGap;
      return { abilities: env, width: o.width ?? (o.radius != null ? o.radius * 2 : 1), height: o.height ?? 1, avoid: o.avoid, diagonals: o.diagonals, maxNodes: o.maxNodes, obstacles: o.obstacles ?? 'static', who: o.who };
    };
    // Entity obstacles in navigation (opts.obstacles): "static" (default) adds solid entities that cannot move
    // or open as solid cells and one-way ones as one-way tops; 'all' adds dynamic ones at their current
    // position too; "none" ignores entities. Dynamic obstacles (doors, lifts, movers) are passable by default.
    //
    // Graphs are cached in rt.caches (never state) per (map content version, document, nav options,
    // obstacle signature) and built lazily: cell facts, jump arcs, edges and reachable sets are computed once
    // and reused by every path/reachable/canReach until a cell edit or obstacle change. navStats() counts builds.
    const NAV_MAX = 16;
    const navCache = () => (rt.caches[`spaces2d.nav:${sid}`] ??= { doc: null, ver: null, graphs: new Map(), stats: { builds: 0, hits: 0 } });
    const navFor = o => {
      const c = navCache(), ver = cells.version();
      if (c.doc !== rt.doc || c.ver !== ver) { c.doc = rt.doc; c.ver = ver; c.graphs.clear(); }
      const self = o.who ? (typeof o.who === 'string' ? rt.entity(o.who) : o.who) : null;
      const obs = o.obstacles === 'none' ? [] : obstaclesIn(rt, sid, self).filter(x => o.obstacles === 'all' || !dynamicObstacle(x)).map(x => ({ k: obstacleOf(x), r: boxOf(x), id: x.id }));
      const ab = { ...DEFAULT_ABILITIES, ...o.abilities };
      const key = JSON.stringify([Object.keys(ab).sort().map(k => [k, ab[k]]), Math.ceil(o.width - 1e-6), Math.ceil(o.height - 1e-6), [...(o.avoid ?? ['hazard'])].sort(), !!o.diagonals, o.maxNodes ?? 0, obs.map(x => [x.id, x.k, x.r.map(v => +v.toFixed(4))])]);
      let g = c.graphs.get(key);
      if (g) { c.stats.hits++; return g; }
      let q = navQ;
      if (obs.length) {
        const overlay = new Map();
        for (const { k, r } of obs) {
          const c0 = Math.floor(r[0] + EPS), c1 = Math.floor(r[2] - EPS), r0 = Math.floor(r[1] + EPS), r1 = Math.floor(r[3] - EPS);
          for (let cx = c0; cx <= c1; cx++) for (let y = k === 'oneway' ? r1 : r0; y <= r1; y++) { const kk = y * (W + 8) + cx; if (KIND_RANK[k] > KIND_RANK[overlay.get(kk) || 'none']) overlay.set(kk, k); }
        }
        q = { ...navQ, kindAt: (x, y) => { const base = kindAt(x, y), extra = overlay.get(y * (W + 8) + x); return extra && KIND_RANK[extra] > KIND_RANK[base] ? extra : base; } };
      }
      g = makeNav(q, o); c.stats.builds++;
      c.graphs.set(key, g); if (c.graphs.size > NAV_MAX) c.graphs.delete(c.graphs.keys().next().value);
      return g;
    };
    const feetCell = (at, h = 1) => [Math.floor(at[0]), Math.floor(at[1] - h / 2 + 0.1)]; // tolerant of bodies a little shorter than h
    // Nav nodes inside a zone, memoised on the (cached) nav object per zone shape.
    const zoneNodes = (nav, z) => {
      const mk = `${z.id}:${z.rect.join(',')}`, memo = (nav.zmem ??= new Map()); let out = memo.get(mk);
      if (!out) { out = new Set(); const r = z.rect; for (let x = Math.floor(r[0]); x < r[2]; x++) for (let y = Math.floor(r[1]); y < r[3]; y++) if (nav.isNode(x, y)) out.add(key2(x, y)); memo.set(mk, out); }
      return out;
    };
    // `from` may be a zone id, a cell key or an At (body center, height from opts).
    const startKeys = (nav, from, h) => {
      const z = typeof from === 'string' && zones().byId.get(from);
      if (z) { const s = z.spawn ? nav.snap(feetCell(z.spawn, h)) : null; return s ? [s] : [...zoneNodes(nav, z)]; }
      if (typeof from === 'string') { const k = nav.snap(unkey(from)); return k ? [k] : []; }
      const k = nav.snap(feetCell(from, h)); return k ? [k] : [];
    };

    // ---------- placement ----------
    const spawnIn = (z, e) => {
      if (z.spawn) return z.spawn.slice();
      const h = size(e)[1], nav = navFor(navOpts({ height: h, width: size(e)[0], who: e })), c = rectCenter(z.rect);
      let best = null, bd = Infinity;
      for (let x = Math.floor(z.rect[0]); x < z.rect[2]; x++) for (let y = Math.floor(z.rect[1]); y < z.rect[3]; y++) {
        if (!(side ? nav.standable(x, y) : nav.clear(x, y))) continue;
        const dd = Math.hypot(x + 0.5 - c[0], y - c[1]); if (dd < bd) { bd = dd; best = [x + 0.5, y + h / 2 + EPS]; }
      }
      return best || c;
    };

    const api = {
      kind: 'tilemap', anchor: 'center', size: [W, H], config, layers: config.layers,
      bounds: () => ({ min: [0, 0], max: [W, H], wrap: [wrapX, wrapY] }),
      inBounds: (at, m = 0) => (wrapX || (at[0] >= -m && at[0] <= W + m)) && (wrapY || (at[1] >= -m && at[1] <= H + m)),
      get zones() { return zones().byId; },
      collisionOf, tagsAt: at => [...tagsAt(at[0], at[1])],
      /** Navigation cache counters: graph builds, cache hits, cached graphs and the nodes they have expanded. */
      navStats: () => { const c = navCache(); return { builds: c.stats.builds, hits: c.stats.hits, graphs: c.graphs.size, nodes: [...c.graphs.values()].reduce((n, g) => n + g.stats.nodes, 0), reachHits: [...c.graphs.values()].reduce((n, g) => n + (g.stats.reachHits || 0), 0) }; },
      cellOf: e => key2(...feetCell(e.at, size(e)[1]).map((v, i) => (i ? ny(v) : nx(v)))),
      place(e, rt) {
        bodyOf(e);
        if (e.at == null) { const z = zones().list.find(z => z.rect); e.at = z ? spawnIn(z, e) : [W / 2, H / 2]; }
        setPos(e, e.at, rt);
      },
      remove(e, rt) { for (const z of sst().inside?.[e.id] || []) rt.emitTyped('leave_zone', z, { who: e.id, zone: z }); tracker.forget(e); if (sst().out) delete sst().out[e.id]; e.zone = null; },
      pos: e => e.at,
      setPos,
      entitiesAt: at => inSpace(rt, sid, e => rectHas(boxOf(e), toAt(at))).map(e => e.id),
      inZone: (e, zone) => { const z = zones().byId.get(zone); return Boolean(z) && zoneHas(z, e.at); },
      zoneAt: at => tracker.zoneAt(toAt(at)),
      teleport(e, { zone, at }, rt) { const z = zone && zones().byId.get(zone); const p = at ?? (z ? spawnIn(z, e) : e.at); bodyOf(e).vel = [0, 0]; setPos(e, p, rt); },
      nearest(e, target, rt) {
        const z = zones().byId.get(target);
        if (z) return zoneHas(z, e.at) ? 0 : rectDist(z.rect, e.at);
        let best = null; for (const o of inSpace(rt, sid)) if (o !== e && (o.id === target || o.archetype === target)) { const d = api.distance(e.at, o.at); if (best === null || d < best) best = d; }
        return best;
      },
      distance(a, b, metric = 'euclid') {
        a = toAt(a); b = toAt(b);
        if (metric === 'path') { const p = api.path(a, b); if (!p) return Infinity; let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(...delta(p[i - 1], p[i])); return s; }
        const [dx, dy] = delta(a, b);
        return metric === 'manhattan' ? Math.abs(dx) + Math.abs(dy) : Math.hypot(dx, dy);
      },
      wrapPos, delta,
      overlap(shape, filter) {
        const f = typeof filter === 'function' ? filter : null;
        return inSpace(rt, sid, e => (!f || f(e)) && shapeHitsRect(shape, boxOf(e))).map(e => e.id);
      },
      contacts(e) {
        const b = boxOf(e), out = [];
        const probe = (box, n) => { const c0 = Math.floor(box[0] + EPS), c1 = Math.floor(box[2] - EPS), r0 = Math.floor(box[1] + EPS), r1 = Math.floor(box[3] - EPS); for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) { const k = kindAt(c, r); if (k === 'solid' || (k !== 'none' && n[1] === 1)) out.push({ cell: [nx(c), ny(r)], normal: n, block: cellKind(c, r).block }); } };
        probe([b[0] - 0.02, b[1] + 0.05, b[0], b[3] - 0.05], [1, 0]); probe([b[2], b[1] + 0.05, b[2] + 0.02, b[3] - 0.05], [-1, 0]);
        probe([b[0] + 0.05, b[1] - 0.02, b[2] - 0.05, b[1]], [0, 1]); probe([b[0] + 0.05, b[3], b[2] - 0.05, b[3] + 0.02], [0, -1]);
        for (const o of inSpace(rt, sid)) if (o !== e) { const r = boxOf(o); if (rectsOverlap([b[0] - 0.01, b[1] - 0.01, b[2] + 0.01, b[3] + 0.01], r)) { const [dx, dy] = delta(o.at, e.at); out.push({ id: o.id, normal: Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy) || 1] }); } }
        return out;
      },
      raycast,
      path(from, to, opts = {}) {
        const o = navOpts(opts), nav = navFor(o), h = o.height;
        const starts = startKeys(nav, from, h);
        const z = typeof to === 'string' && zones().byId.get(to);
        const goals = z ? zoneNodes(nav, z) : new Set(startKeys(nav, to, h));
        if (!starts.length || !goals.size) return null;
        const g = [...goals][0], keys = nav.path(starts[0], g, goals, z ? `zone:${z.id}:${z.rect.join(',')}` : g);
        return keys && keys.map(k => { const [x, y] = unkey(k); return [x + 0.5, y + h / 2 + EPS]; });
      },
      reachable(from, rt, opts = {}) { const o = navOpts(opts), nav = navFor(o); return nav.reach(startKeys(nav, from, o.height)); },
      canReach(a, b, c, d) {
        const opts = c && c.state ? (d || {}) : (c?.abilities || c?.envelope ? c : { abilities: c || {} });
        const o = navOpts(opts), nav = navFor(o), seen = nav.reach(startKeys(nav, a, o.height));
        const z = typeof b === 'string' && zones().byId.get(b);
        if (z) { for (const k of zoneNodes(nav, z)) if (seen.has(k)) return true; return false; }
        return startKeys(nav, b, o.height).some(k => seen.has(k));
      },
      getCell: (at, layer = config.collisionLayers[0]) => cells.get(toAt(at), layer),
      setCell: (at, block, rt, by = null, layer = config.collisionLayers[0]) => cells.set(at, block, rt, by, layer),
      fill: (box, block, rt, by = null, layer = config.collisionLayers[0]) => cells.fill(box, block, rt, by, layer),
      cellsIn: (box, layer = config.collisionLayers[0]) => cells.cellsIn(box, layer),
      editLog: since => cells.log(since),
      bake: (list, rt, opts = {}) => cells.bake(list, { layer: opts.layer ?? config.collisionLayers[0], box: opts.box }),
      ...zoneEditor(rt, sid, zones, z => (Array.isArray(z.rect) && z.rect.length === 4 ? null : 'needs rect [x0,y0,x1,y1]'), rt => { for (const e of inSpace(rt, sid)) tracker.track(e, rt); }),
      gravityAt(at) { if (!side) return [0, 0, 0]; const z = at && zones().byId.get(tracker.zoneAt(at)); return [0, Number.isFinite(z?.rules?.gravity) ? z.rules.gravity : config.gravity, 0]; },
      slide,
      grounded(e) { const b = bodyOf(e); return side && Boolean(groundedAt(e.at[0], e.at[1], b.size[0] / 2, b.size[1] / 2, false, obstaclesFor(e))); },
      groundAt(x, y = H) {
        if (!side) { const b = config.layers.map(l => cells.get([x, y], l)).find(v => v != null) ?? null; return { y: 0, normal: [0, 0, 1], material: b }; }
        for (let r = Math.min(H - 1, Math.floor(y)); r >= 0; r--) {
          const { kind, block } = cellKind(Math.floor(x), r);
          if (kind === 'solid' || kind === 'oneway') return { y: r + 1, normal: [0, 1], material: block };
          if (kind === 'slope') return { y: slopeY(Math.floor(x), r, x - Math.floor(x)), normal: slopeNormal(Math.floor(x), r), material: block };
        }
        return { y: E.bottom === 'solid' ? 0 : null, normal: [0, 1], material: null };
      },
      slopeAt(x, y = H) { const g = api.groundAt(x, y); return g.normal && g.normal.length === 2 ? +(Math.acos(clamp(g.normal[1], -1, 1)) * 180 / Math.PI).toFixed(6) : 0; },
      waterDepthAt(x, y) {
        const c = Math.floor(x); let r = Math.floor(y);
        if (!isLiquid(c, r)) return 0;
        if (!side) return 1;
        while (r + 1 < H && isLiquid(c, r + 1)) r++;
        return r + 1 - y;
      },
      impulse(e, v, rt) { const b = bodyOf(e), m = b.mass || 1; b.vel = [b.vel[0] + v[0] / m, b.vel[1] + v[1] / m]; },
      velocity: e => bodyOf(e).vel.slice(),
      setVelocity(e, v) { bodyOf(e).vel = [v[0], v[1]]; },
    };
    api.applyImpulse = api.impulse;
    rt.defineSpace(sid, api);
    cells.init();

    // Ballistic bodies (pickups, debris, thrown things): gravity, bounce, ground friction.
    rt.system('physics', rt => {
      for (const e of inSpace(rt, sid, e => e.components.body?.ballistic)) {
        const b = e.components.body, g = api.gravityAt(e.at), gs = b.gravityScale ?? 1, dt = rt.dt, was = b.grounded;
        b.vel = [b.vel[0] + g[0] * gs * dt, b.vel[1] + g[1] * gs * dt];
        if (b.collide === false) { setPos(e, [e.at[0] + b.vel[0] * dt, e.at[1] + b.vel[1] * dt], rt, { carry: true }); continue; }
        const vy = b.vel[1], r = slide(e, [b.vel[0] * dt, b.vel[1] * dt], rt), bounce = b.bounce ?? 0;
        if (r.blocked.x) b.vel[0] = -b.vel[0] * bounce;
        if (r.blocked.y) b.vel[1] = Math.abs(vy * bounce) > Math.max(0.01, 2 * Math.abs(g[1] * gs) * dt) ? -vy * bounce : 0; // rest instead of micro-bouncing
        if (r.grounded) b.vel[0] *= 1 - clamp(b.friction ?? 0.2, 0, 1);
        if (r.grounded && !was) rt.emit('landed', { who: e.id, speed: -vy });
      }
    }, sid);
  },
};


/** Ray from o (unit u) against the slope polygon in cell (cx, cy): {t, n} or null (Cyrus–Beck). */
function raySlope(o, u, cx, cy, hl, hr, maxDist) {
  const poly = [[cx, cy], [cx + 1, cy], [cx + 1, cy + hr], [cx, cy + hl]].filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  let t0 = 0, t1 = maxDist, n0 = [-u[0], -u[1]];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey);
    if (l < 1e-9) continue;
    const n = [ey / l, -ex / l], den = n[0] * u[0] + n[1] * u[1], num = n[0] * (a[0] - o[0]) + n[1] * (a[1] - o[1]);
    if (Math.abs(den) < 1e-12) { if (num < 0) return null; continue; }
    const t = num / den;
    if (den < 0) { if (t > t0) { t0 = t; n0 = n; } } else if (t < t1) t1 = t;
    if (t0 > t1) return null;
  }
  return { t: t0, n: n0 };
}
