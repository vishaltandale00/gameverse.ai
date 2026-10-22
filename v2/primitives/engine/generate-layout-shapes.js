// Piece layouts from shapes, for continuous or cell spaces: peg fields (arc,
// circle, line, staggered grid, spiral, wave — ported from the physics kit's
// Peggle groups), brick walls from row pictures (Breakout), and stacked
// structures (stack, pyramid, tower, explicit pieces — Slingshot) with
// materials. Pieces spawn as entities with body.size and a `piece` component;
// roles (e.g. "orange: a quarter", "green: 2") are assigned by the seed after
// placement. Proofs: pieces that leave the bounds or crowd a placed piece are
// skipped (peg rule); breakable bricks sealed in by unbreakable ones
// (flood fill from the open side) are reported; structure pieces must not
// overlap and must rest on the ground or another piece; role counts must be met.
import { withDefaults, drawSeed, stream, spaceOf, publish, spawnAt, problem } from './generate2d-lib.js';

const ID = 'engine.generate.layout.shapes';
const DEG = Math.PI / 180;
export const SHAPES = ['arc', 'circle', 'line', 'grid', 'spiral', 'wave', 'rows', 'stack', 'pyramid', 'tower', 'pieces'];
/** Default materials (slingshot kit): hp per unit area, density, friction, restitution, score. */
export const MATERIALS = {
  wood: { density: 0.7, hp: 5, mu: 0.7, e: 0.08, score: 500 }, stone: { density: 2.2, hp: 18, mu: 0.85, e: 0.04, score: 1000 },
  glass: { density: 1.0, hp: 1.8, mu: 0.35, e: 0.1, score: 300 }, tnt: { density: 0.8, hp: 2.2, mu: 0.7, e: 0.08, score: 500, explodes: true },
  rock: { density: 0, hp: null, mu: 0.9, e: 0.05, score: 0, static: true },
};

/** Positions and tangent angles for one point-shape group (content units). */
export function groupPoints(g) {
  const n = g.count, cx = g.x, cy = g.y, size = g.size, a = g.angle * DEG, span = g.span * DEG, out = [];
  const u = i => (n > 1 ? i / (n - 1) : 0.5);
  if (g.shape === 'arc') for (let i = 0; i < n; i++) { const t = a - span / 2 + span * u(i); out.push([cx + Math.cos(t) * size, cy + Math.sin(t) * size]); }
  else if (g.shape === 'circle') for (let i = 0; i < n; i++) { const t = a + (i / n) * Math.PI * 2; out.push([cx + Math.cos(t) * size, cy + Math.sin(t) * size]); }
  else if (g.shape === 'line') for (let i = 0; i < n; i++) { const d = (u(i) - 0.5) * size; out.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]); }
  else if (g.shape === 'spiral') for (let i = 0; i < n; i++) { const r = size * (0.25 + 0.75 * u(i)), t = a + span * u(i); out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); }
  else if (g.shape === 'wave') for (let i = 0; i < n; i++) { const k = u(i); out.push([cx + (k - 0.5) * size, cy + Math.sin(k * span) * size * 0.12]); }
  else { // grid: staggered rows
    const cols = Math.max(2, Math.round(Math.sqrt(n * 1.6))), rows = Math.ceil(n / cols), sx = size / (cols - 1), sy = Math.max(g.pieceSize[1] * 1.25, sx * 0.8);
    for (let r = 0, k = 0; r < rows; r++) for (let c = 0; c < cols && k < n; c++, k++) out.push([cx - size / 2 + c * sx + (r % 2 ? sx / 2 : 0) - sx / 4, cy + (r - (rows - 1) / 2) * sy]);
  }
  return out.map(([x, y], i) => { const p = out[Math.max(0, i - 1)], q = out[Math.min(out.length - 1, i + 1)]; return { x, y, ang: Math.atan2(q[1] - p[1], q[0] - p[0]) || 0 }; });
}

/** Structure pieces (bottom-anchored boxes: x centre, y bottom, w, h) for stack, pyramid and tower. */
export function structurePieces(g) {
  const [w, h] = g.pieceSize, out = [], mat = g.material;
  if (g.shape === 'stack') for (let i = 0; i < g.count; i++) out.push({ x: g.x, y: g.y + i * h, w, h, material: mat });
  else if (g.shape === 'pyramid') for (let row = 0; row < g.count; row++) { const n = g.count - row; for (let i = 0; i < n; i++) out.push({ x: g.x + (i - (n - 1) / 2) * w, y: g.y + row * h, w, h, material: mat }); }
  else if (g.shape === 'tower') { // levels of two columns capped by a plank
    const span = Math.max(g.size, w * 3), colW = Math.min(w, h) / 2 || 0.3, colH = Math.max(w, h), plankH = Math.min(w, h) / 2 || 0.25;
    for (let lv = 0, y = g.y; lv < g.count; lv++) { out.push({ x: g.x - span / 2 + colW / 2, y, w: colW, h: colH, material: mat }, { x: g.x + span / 2 - colW / 2, y, w: colW, h: colH, material: mat }); y += colH; out.push({ x: g.x, y, w: span, h: plankH, material: mat, plank: true }); y += plankH; }
  } else for (const p of g.pieces || []) out.push({ shape: 'box', material: mat, ...p, y: p.y ?? 0 });
  return out;
}

/** Breakable cells of a row picture that no ball path reaches (4-connected flood from the open side through non-sealing cells). */
export function sealedCells(rows, sealing, open = 'bottom') {
  const h = rows.length, w = Math.max(...rows.map(r => [...r].length)), H = h + 2, grid = rows.map(r => [...r]);
  const passable = (x, y) => y < 1 || y > h || !sealing.has(grid[y - 1][x] ?? '.');
  const seen = new Uint8Array(w * H), q = [], from = open === 'top' ? 0 : H - 1;
  for (let x = 0; x < w; x++) { seen[from * w + x] = 1; q.push([x, from]); }
  while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= H || seen[ny * w + nx] || !passable(nx, ny)) continue; seen[ny * w + nx] = 1; q.push([nx, ny]); } }
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = grid[y][x] ?? '.'; if (ch !== '.' && !sealing.has(ch) && !seen[(y + 1) * w + x]) out.push([x, y]); }
  return out;
}

const group = { type: 'object', fields: {
  shape: { type: 'string', options: SHAPES, required: true },
  id: { type: 'string', effect: 'group id (pieces get <id>_<n>)' },
  kind: { type: 'string', default: 'peg', effect: 'piece kind recorded on the piece component' },
  archetype: { type: 'ref', to: 'archetype', effect: 'archetype spawned per piece (rows use the legend)' },
  x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 }, size: { type: 'number', min: 0, default: 10, effect: 'radius / length / width depending on shape' },
  count: { type: 'integer', min: 0, max: 400, default: 10 }, angle: { type: 'number', default: 0, unit: 'deg' }, span: { type: 'number', default: 180, unit: 'deg' },
  pieceSize: { type: 'list', of: { type: 'number', min: 0.01 }, min: 2, max: 2, default: [0.44, 0.44], effect: 'piece box [w,h] (rows: the cell size)' },
  bricks: { type: 'boolean', default: false, effect: 'oriented boxes along the shape instead of round pegs' },
  material: { type: 'string', default: 'wood' },
  motion: { type: 'string', default: 'none', effect: 'recorded for motion primitives: none|rotate|slide|...' },
  rows: { type: 'list', of: { type: 'string' }, effect: 'shape rows: picture, top row first' },
  legend: { type: 'object', default: {}, values: { type: 'object', fields: {
    kind: { type: 'string', effect: 'piece kind (default brick, or unbreakable for sealing chars)' }, archetype: { type: 'ref', to: 'archetype', effect: 'archetype of this char\'s pieces' },
    hp: { type: 'number', min: 0, effect: 'hit points (default the digit 2-9 the char is, else 1)' }, material: { type: 'string', effect: 'a material name (default the group\'s)' }, motion: { type: 'string', effect: 'motion recorded on the piece (default the group\'s)' },
  } }, effect: 'rows: char → {kind?, archetype?, hp?, material?, motion?}' },
  pieces: { type: 'list', effect: 'shape pieces (x centre, y bottom)', of: { type: 'object', fields: {
    x: { type: 'number', required: true }, y: { type: 'number', default: 0 }, w: { type: 'number', min: 0.01, required: true }, h: { type: 'number', min: 0.01, required: true },
    material: { type: 'string', effect: 'a material name (default the group\'s)' }, shape: { type: 'string', effect: 'recorded on the piece (default box)' },
  } } },
  tags: { type: 'list', of: { type: 'string' }, default: [] },
} };

export default {
  id: ID,
  card: {
    intent: 'Lays out pegs, bricks and stacked structures from shapes (arcs, rings, grids, spirals, waves, row pictures, stacks, pyramids, towers) as entities, assigns roles by seed, and proves no piece is sealed in, overlapping or unsupported.',
    views: ['side', 'td', 'board'],
    spaces: ['engine.space.physics2d', 'engine.space.arena2d'],
    params: {
      groups: { type: 'list', of: group, min: 1, required: true },
      origin: { type: 'list', of: { type: 'number' }, default: [0, 0], scale: 'world', effect: 'space position of layout (0, 0)' },
      scale: { type: 'number', min: 0.001, default: 1, scale: 'world', effect: 'space units per layout unit' },
      yDown: { type: 'boolean', default: false, effect: 'layout y grows downward (board coordinates) into a y-up space' },
      bounds: { type: 'list', of: { type: 'number' }, min: 4, max: 4, effect: '[x0,y0,x1,y1] in layout units; pieces outside are skipped' },
      minSpacing: { type: 'number', min: 0, default: 0.52, effect: 'point pieces closer than this to a placed piece are skipped' },
      roles: { type: 'list', default: [], of: { type: 'object', fields: {
        role: { type: 'string', required: true }, count: { type: 'integer', min: 0 }, fraction: { type: 'number', min: 0, max: 1 },
        kind: { type: 'string', effect: 'only pieces of this kind' }, archetype: { type: 'ref', to: 'archetype', effect: 'archetype for pieces given this role' },
      } }, effect: 'roles assigned in order to seed-shuffled pieces' },
      materials: { type: 'object', default: {}, values: { type: 'object', open: true, fields: { hp: { type: 'number', min: 0, effect: 'hit points per unit area (unset: unbreakable)' }, static: { type: 'boolean', effect: 'pieces of it never move' } } }, effect: 'extra/overriding materials by name: {hp, static, density, mu, e, score...}' },
      support: { type: 'boolean', default: true, effect: 'prove structure pieces rest on the ground (y 0 in layout) or another piece' },
      sealing: { type: 'list', of: { type: 'string' }, default: ['m'], effect: 'row chars that block the ball (unbreakable)' },
      openSide: { type: 'string', options: ['bottom', 'top'], default: 'bottom', effect: 'side of a row picture the ball comes from' },
      archetype: { type: 'ref', to: 'archetype', effect: 'archetype of pieces whose group names none (unset: such pieces are made of their body and piece components alone)' },
    },
    provides: { content: ['structures', 'entities'], extent: 'overlay', events: ['generated', 'generated:*', 'generate_problem'], services: ['generation', 'layout'] },
    requires: { capabilities: ['position'] },
    problems: ['piece_sealed', 'piece_overlap', 'piece_unsupported', 'role_shortfall', 'layout_empty'],
    rules: {
      material_unknown: { fields: ['groups[].material', 'groups[].pieces[].material', 'materials'], message: `a material is ${Object.keys(MATERIALS).join(', ')} or a name in materials`, example: { groups: [{ shape: 'stack', id: null, kind: null, archetype: null, x: null, y: null, size: null, count: null, angle: null, span: null, pieceSize: null, bricks: null, material: 'jelly', motion: null, rows: null, tags: null }] } },
      shape_data_missing: { fields: ['groups[].shape', 'groups[].rows', 'groups[].pieces'], message: 'a rows group lists rows; a pieces group lists pieces' },
      roles_overfull: { fields: ['roles[].fraction', 'roles[].count'], message: 'role fractions sum to at most 1 and role counts to at most 4000' },
    },
  },
  /**
   * Planner hook (v2/planner/world.js), arena2d and physics2d spaces: static solid pieces in every zone. With
   * gravity, stepped platforms whose tops stay within the movement envelope's jump height (each reachable from
   * the ground or the step below); top-down, pillars that leave the zone's middle row open. Pieces keep to the
   * right of the player's start and inside the space.
   */
  scaffold(space, doc, { envelope = {} } = {}) {
    if (!this.card.spaces.includes(space.use)) return null;
    const physics = space.use === 'engine.space.physics2d', size = physics ? space.with?.bounds ?? [20, 12] : space.with?.size ?? [16, 9];
    const g = physics ? (Array.isArray(space.with?.gravity) ? space.with.gravity[1] : -9.8) : Number(space.with?.gravity ?? 0);
    const side = Math.abs(g) > 1e-6, reach = Number.isFinite(envelope.jumpHeight) && envelope.jumpHeight > 0.5 ? envelope.jumpHeight : 2;
    const p = doc.player, here = p && (p.space ?? doc.spaces?.[0]?.id) === space.id && Array.isArray(p.at) ? p.at : null;
    const pieces = [], T = 0.5;
    const zones = (space.zones || []).map(z => z.rect).filter(r => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite));
    for (const [rx0, ry0, rx1, ry1] of zones.length ? zones : [[0, 0, size[0], size[1]]]) {
      const x0 = Math.max(0, rx0), x1 = Math.min(size[0], rx1), y0 = Math.max(0, ry0), y1 = Math.min(size[1], ry1), w = x1 - x0, h = y1 - y0;
      if (w < 4 || h < 3) continue;
      const left = here && here[0] >= x0 && here[0] < x1 ? Math.max(x0, here[0] + 2) : x0 + 1;
      if (x1 - left < 3) continue;
      if (side) {
        const step = Math.max(T + 0.5, Math.min(reach * 0.7, (h - 2) / 2)), pw = Math.min(4, (x1 - left) / 2);
        for (let k = 1; k <= 2 && y0 + k * step + 1.5 < y1; k++) pieces.push({ x: +(left + pw * (k - 0.5)).toFixed(2), y: +(y0 + k * step - T).toFixed(2), w: +pw.toFixed(2), h: T });
      } else {
        const mid = (y0 + y1) / 2, pw = Math.min(2, w / 6);
        for (const fx of [0.33, 0.66]) { const cx = left + (x1 - left) * fx; for (const cy of [y0 + (mid - y0) / 2, mid + (y1 - mid) / 2]) if (Math.abs(cy - mid) > pw) pieces.push({ x: +cx.toFixed(2), y: +(cy - pw / 2).toFixed(2), w: +pw.toFixed(2), h: +pw.toFixed(2) }); }
      }
    }
    if (!pieces.length) return null;
    return {
      with: { groups: [{ id: 'arena', shape: 'pieces', kind: 'platform', archetype: 'arena_solid', material: 'rock', pieces }], support: false },
      content: { archetypes: [{ id: 'arena_solid', components: { name: 'Platform', body: { solid: true, static: true } } }] },
    };
  },
  validate(raw) {
    const config = withDefaults(this.card, raw);
    const errors = [], mats = { ...MATERIALS, ...config.materials };
    config.groups.forEach((g, i) => {
      if (g.shape === 'rows' && !g.rows?.length) errors.push(problem('shape_data_missing', `groups[${i}].rows`, 'a rows group needs rows'));
      if (g.shape === 'pieces' && !g.pieces?.length) errors.push(problem('shape_data_missing', `groups[${i}].pieces`, 'a pieces group needs pieces'));
      for (const m of [g.material, ...(g.pieces || []).map(p => p?.material)]) if (m && !mats[m]) errors.push(problem('material_unknown', `groups[${i}]`, `unknown material '${m}'`, { hint: Object.keys(mats).join(', ') }));
    });
    const fixed = config.roles.reduce((n, r) => n + (r.count ?? 0), 0), frac = config.roles.reduce((n, r) => n + (r.fraction ?? 0), 0);
    if (frac > 1) errors.push(problem('roles_overfull', 'roles', `role fractions sum to ${frac} > 1`));
    if (fixed > 4000) errors.push(problem('roles_overfull', 'roles', 'role counts exceed any layout'));
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(this.card, raw), space = spaceOf(rt, instance), r = stream(drawSeed(rt), 'layout');
    const result = layout(config, r);
    const [ox, oy] = config.origin, s = config.scale;
    const toAt = (x, y) => { const at = [ox + x * s, oy + (config.yDown ? -y : y) * s]; return space.size?.length === 3 ? [...at, 0] : at; };
    for (const p of result.pieces) { // spawned at the body-box min corner; spawnAt re-anchors for the space
      const cy = p.anchor === 'bottom' ? p.y + p.h / 2 : p.y;
      p.entity = spawnAt(rt, space, p.archetype, toAt(p.x - (p.w / 2), cy + (config.yDown ? p.h / 2 : -p.h / 2)), { body: { size: [p.w * s, p.h * s] }, piece: { group: p.group, kind: p.kind, shape: p.shape, material: p.material, hp: p.hp, ang: p.ang, role: p.role, motion: p.motion, center: toAt(p.x, cy), static: p.static, tags: p.tags } }, p.id).id;
    }
    const st = () => rt.store(instance.key);
    publish(rt, instance, space, ID, { problems: result.problems, skipped: result.skipped, pieces: result.pieces.map(p => ({ id: p.entity, group: p.group, kind: p.kind, role: p.role })), roles: result.roleCounts }, {
      layout: { pieces: () => st().pieces, byRole: role => st().pieces.filter(p => p.role === role).map(p => p.id), counts: () => st().roles, problems: () => st().problems },
    });
  },
};

/** Pure layout: { pieces, problems, skipped, roleCounts }. Layout units, y as authored. */
export function layout(config, r) {
  const mats = { ...MATERIALS, ...config.materials }, problems = [], pieces = [], placed = [];
  let skipped = 0;
  const inBounds = (x, y) => !config.bounds || (x >= config.bounds[0] && x <= config.bounds[2] && y >= config.bounds[1] && y <= config.bounds[3]);
  const matOf = (m, w, h) => { const d = mats[m] || mats.wood; return { material: m, hp: d.hp == null ? null : +(d.hp * Math.max(0.5, Math.min(2.2, Math.sqrt(w * h)))).toFixed(3), static: Boolean(d.static) }; };
  config.groups.forEach((g, gi) => {
    const gid = g.id || `g${gi + 1}`, arch = g.archetype || config.archetype;
    if (['arc', 'circle', 'line', 'grid', 'spiral', 'wave'].includes(g.shape)) {
      for (const p of groupPoints(g)) {
        if (!inBounds(p.x, p.y) || placed.some(q => Math.hypot(q[0] - p.x, q[1] - p.y) < (g.bricks ? config.minSpacing * 1.2 : config.minSpacing))) { skipped++; continue; }
        placed.push([p.x, p.y]);
        pieces.push({ id: `${gid}_${pieces.length + 1}`, group: gid, kind: g.kind, shape: g.bricks ? 'box' : 'circle', archetype: arch, x: p.x, y: p.y, w: g.pieceSize[0], h: g.pieceSize[1], ang: g.bricks ? p.ang : 0, motion: g.motion, tags: g.tags, ...matOf(g.material, g.pieceSize[0], g.pieceSize[1]) });
      }
    } else if (g.shape === 'rows') {
      const legend = g.legend || {}, [cw, ch] = g.pieceSize, sealing = new Set(config.sealing);
      for (const [x, y] of sealedCells(g.rows, sealing, config.openSide)) problems.push(problem('piece_sealed', `groups[${gi}].rows[${y}]`, `the brick at column ${x} is sealed in by unbreakable bricks`, { group: gid }));
      g.rows.forEach((row, ry) => [...row].forEach((c, cx) => {
        if (c === '.' || c === ' ') return;
        const d = legend[c] || {}, x = g.x + cx * cw + cw / 2, y = g.y + (config.yDown ? ry : g.rows.length - 1 - ry) * ch + ch / 2;
        if (!inBounds(x, y)) { skipped++; return; }
        const hp = d.hp ?? (c >= '2' && c <= '9' ? Number(c) : 1);
        pieces.push({ id: `${gid}_${pieces.length + 1}`, group: gid, kind: d.kind ?? (sealing.has(c) ? 'unbreakable' : 'brick'), char: c, shape: 'box', archetype: d.archetype || arch, x, y, w: cw - 0.04, h: ch - 0.04, ang: 0, motion: d.motion ?? g.motion, tags: g.tags, material: d.material ?? g.material, hp: sealing.has(c) ? null : hp, static: true, row: ry, col: cx });
      }));
    } else {
      const list = structurePieces(g);
      for (const p of list) {
        if (!inBounds(p.x, p.y)) { skipped++; continue; }
        pieces.push({ id: `${gid}_${pieces.length + 1}`, gi, group: gid, kind: g.kind === 'peg' ? 'block' : g.kind, shape: p.shape || 'box', archetype: arch, x: p.x, y: p.y, w: p.w, h: p.h, ang: 0, anchor: 'bottom', motion: g.motion, tags: g.tags, ...matOf(p.material || g.material, p.w, p.h) });
      }
    }
  });
  // Structure proofs: no overlaps, everything rests on the ground or another piece.
  const blocks = pieces.filter(p => p.anchor === 'bottom'), box = p => [p.x - p.w / 2, p.y, p.x + p.w / 2, p.y + p.h];
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = box(blocks[i]), b = box(blocks[j]), ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (ox > 0.08 && oy > 0.08) problems.push(problem('piece_overlap', `groups[${blocks[j].gi}]`, `${blocks[j].id} overlaps ${blocks[i].id}`, { hint: `set y to ${Math.max(a[3], b[3]).toFixed(2)} to stack it` }));
  }
  if (config.support) for (const p of blocks) {
    if (p.static || Math.abs(p.y) < 0.05) continue;
    const a = box(p), held = blocks.some(q => q !== p && Math.abs(box(q)[3] - p.y) < 0.05 && Math.min(a[2], box(q)[2]) - Math.max(a[0], box(q)[0]) > 0.05);
    if (!held) problems.push(problem('piece_unsupported', `groups[${p.gi}]`, `${p.id} at y ${p.y} rests on nothing`));
  }
  if (!pieces.length) problems.push(problem('layout_empty', 'groups', 'no piece was placed'));
  // Roles from the seed: shuffle candidates, hand out counts / fractions in order.
  const order = r.shuffle(pieces.filter(p => p.hp !== null).map(p => p)), roleCounts = {}, total = order.length;
  for (const role of config.roles) {
    const want = role.count ?? Math.max(role.fraction > 0 ? 1 : 0, Math.round((role.fraction ?? 0) * total));
    let got = 0;
    for (const p of order) { if (got >= want) break; if (p.role || (role.kind && p.kind !== role.kind)) continue; p.role = role.role; if (role.archetype) p.archetype = role.archetype; got++; }
    roleCounts[role.role] = got;
    if (got < want) problems.push(problem('role_shortfall', 'roles', `role '${role.role}' wanted ${want} pieces, got ${got}`));
  }
  return { pieces, problems, skipped, roleCounts };
}
