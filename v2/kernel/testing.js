// @ts-check
// Test support for primitive authors (KERNEL_API.md §8).
// - compile(doc, extra): preflight + world in one call, throwing on errors.
// - testSpace: `engine.space.test`, a small reference space implementing every
//   capability interface over integer cells and axis-aligned boxes. Gameplay,
//   plot and AI primitives test against it without waiting for real spaces.
//   It is never registered in the catalogue.
// - spaceConformance(test, assert, opts): the capability contract every space
//   primitive must pass, so all spaces behave alike for the primitives above.
import { Registry } from './registry.js';
import { Logic } from './logic.js';
import { buildLogic, createWorld } from './world.js';
import { preflight } from './document.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Primitive} Primitive */
/** @typedef {import('./types.js').Runtime} Runtime */
/** @typedef {import('./types.js').Entity} Entity */
/** @typedef {import('./types.js').SpaceApi} SpaceApi */
/** @typedef {import('./types.js').Card} Card */
/** @typedef {import('./types.js').Input} Input */
/** @typedef {import('./types.js').View} View */
/** @typedef {number[]} Vec */
/** @typedef {import('./types.js').FullSpaceApi} FullSpaceApi */
/** @typedef {Extract<import('./types.js').PreflightResult, { ok: true }> & { capabilities: Record<string, string[]> }} Checked a passing preflight: doc is the normalized document */

/**
 * @param {Doc} doc
 * @param {{ primitives?: Primitive[], extra?: Primitive[], seed?: unknown, headless?: boolean, view?: View | null }} [opts]
 * @returns {{ registry: Registry, logic: Logic, checked: Checked, rt: Runtime }}
 */
export function compile(doc, { primitives, extra = [], seed, headless = true, view = null } = {}) {
  const registry = new Registry([...(primitives || []), ...extra]);
  const logic = buildLogic(registry, Logic);
  const checked = preflight(doc, registry, logic);
  if (!checked.ok) throw Object.assign(Error(`preflight failed: ${checked.errors.map(e => `${e.code} ${e.path} ${e.message}`).join('; ')}`), { errors: checked.errors });
  return { registry, logic, checked: /** @type {Checked} */ (checked), rt: createWorld(/** @type {Doc} */ (checked.doc), registry, logic, { seed, headless, view }) };
}

/** Step n frames with the same input; returns the runtime. @param {Runtime} rt @param {number} [n] @param {Input} [input] */
export function run(rt, n = 1, input = {}) { for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step(input); return rt; }

const key = (/** @type {Vec} */ c) => c.join(',');
const v3 = (/** @type {any} */ a) => /** @type {Vec} */ ([a[0] ?? 0, a[1] ?? 0, a[2] ?? 0]);
const sub = (/** @type {Vec} */ a, /** @type {Vec} */ b) => a.map((v, i) => v - b[i]);
const len = (/** @type {Vec} */ a) => Math.hypot(...a);

/** @type {Primitive} */
export const testSpace = {
  id: 'engine.space.test',
  card: {
    intent: 'Reference space for tests: integer cells (solid or empty) and box-shaped entities in up to 3D, y up.',
    views: ['any'],
    params: {
      size: { type: 'list', of: { type: 'integer', min: 1, max: 512 }, default: [16, 16, 1], effect: 'cells along x, y, z' },
      gravity: { type: 'number', default: 0, effect: 'cells/s² along -y; 0 disables gravity' },
      solid: { type: 'list', default: [], of: { type: 'json' }, effect: 'initially solid cells [x,y,z]' },
    },
    provides: { capabilities: ['position', 'distance', 'overlap', 'raycast', 'pathfind', 'reachable', 'editCells', 'gravity', 'surface', 'navigate', 'occupancy', 'los'], events: ['enter_zone', 'leave_zone', 'cell_changed', 'blocked'] },
  },
  install(rt, config, instance) {
    const sid = /** @type {string} */ (instance.id), [W, H, D] = v3(config.size);
    /** @returns {{ cells: Record<string, any>, log: any[] }} */
    const st = () => { const s = rt.state.spaces[sid]; s.cells ??= Object.fromEntries(config.solid.map((/** @type {any} */ c) => [key(v3(c)), 'solid'])); s.log ??= []; return s; };
    const zones = () => rt.doc.spaces.find(s => s.id === sid)?.zones || [];
    const inBounds = (/** @type {Vec} */ c) => c[0] >= 0 && c[1] >= 0 && c[2] >= 0 && c[0] < W && c[1] < H && c[2] < D;
    const cellOf = (/** @type {any} */ at) => v3(at).map(Math.floor);
    const solidAt = (/** @type {Vec} */ c) => !inBounds(c) || Boolean(st().cells[key(c)]);
    const size = (/** @type {Entity} */ e) => v3(e.components.body?.size || [1, 1, 1]);
    const boxOf = (/** @type {Entity} */ e) => { const p = v3(e.at), s = size(e); return { min: p, max: p.map((v, i) => v + s[i]) }; };
    const zoneHas = (/** @type {any} */ z, /** @type {any} */ at) => { const p = v3(at); const r = z.rect || [0, 0, W, H]; return p[0] >= r[0] && p[1] >= r[1] && p[0] < r[2] && p[1] < r[3]; };
    const zoneOf = (/** @type {any} */ at) => zones().find(z => zoneHas(z, at))?.id ?? null;
    const neighbors = (/** @type {Vec} */ c) => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(d => c.map((v, i) => v + d[i])).filter(n => inBounds(n) && !solidAt(n));
    /** @param {any} from @param {(c: Vec) => boolean} [goal] @returns {{ path: Vec[] | null, prev: Map<string, Vec | null> }} */
    const bfs = (from, goal) => {
      const start = cellOf(from), prev = /** @type {Map<string, Vec | null>} */ (new Map([[key(start), null]])), q = [start];
      while (q.length) { const c = /** @type {Vec} */ (q.shift()); if (goal?.(c)) { const out = /** @type {Vec[]} */ ([]); for (let k = /** @type {string | null | undefined} */ (key(c)); k; k = prev.get(k) && key(/** @type {Vec} */ (prev.get(k)))) { out.unshift(k.split(',').map(Number)); if (!prev.get(k)) break; } return { path: out, prev }; } for (const n of neighbors(c)) if (!prev.has(key(n))) { prev.set(key(n), c); q.push(n); } }
      return { path: null, prev };
    };
    const track = (/** @type {Entity} */ e, /** @type {Runtime} */ rt) => { const z = zoneOf(e.at); if (z !== e.zone) { if (e.zone) rt.emit('leave_zone', { who: e.id, zone: e.zone }); e.zone = z; if (z) rt.emitTyped('enter_zone', z, { who: e.id, zone: z }); } };
    /** @type {SpaceApi} */
    const api = {
      kind: 'test', size: [W, H, D], anchor: 'min',
      place(e, rt) { if (e.at == null) e.at = [0, 0, 0]; e.at = v3(e.at); e.zone = null; track(e, rt); },
      remove() {},
      pos: e => e.at,
      setPos(e, at, rt) { e.at = v3(at); track(e, rt); },
      entitiesAt: at => Object.values(rt.state.entities).filter(e => e.space === sid && key(cellOf(e.at)) === key(cellOf(at))).map(e => e.id),
      inZone: (e, zone) => zoneOf(e.at) === zone,
      zoneAt: zoneOf,
      teleport(e, { zone, at }, rt) { const z = zones().find(x => x.id === zone); api.setPos(e, at ?? (z?.rect ? [z.rect[0], z.rect[1], 0] : e.at), rt); },
      nearest(e, target, rt) {
        const z = zones().find(x => x.id === target);
        if (z) return zoneHas(z, e.at) ? 0 : len(sub(v3([z.rect[0], z.rect[1]]), v3(e.at)));
        /** @type {number | null} */
        let best = null;
        for (const o of Object.values(rt.state.entities)) if (o !== e && o.space === sid && (o.id === target || o.archetype === target)) { const d = len(sub(v3(o.at), v3(e.at))); if (best === null || d < best) best = d; }
        return best;
      },
      distance: (a, b, metric = 'euclid') => metric === 'manhattan' ? sub(v3(a), v3(b)).reduce((s, v) => s + Math.abs(v), 0) : metric === 'path' ? ((/** @type {NonNullable<SpaceApi['path']>} */ (api.path)(a, b)?.length ?? Infinity) - 1) : len(sub(v3(a), v3(b))),
      overlap(shape, filter = () => true) {
        const at = v3(shape.at), r = shape.r ?? 0, sz = v3(shape.size || [0, 0, 0]);
        return Object.values(rt.state.entities).filter(e => e.space === sid && filter(e)).filter(e => { const b = boxOf(e); return b.min.every((m, i) => m < at[i] + sz[i] + r && b.max[i] > at[i] - r); }).map(e => e.id);
      },
      contacts(e) { const b = boxOf(e), out = /** @type {Array<{ cell: Vec, normal: Vec }>} */ ([]); for (const [i, s] of [[0, -1], [0, 1], [1, -1], [1, 1]]) { const p = b.min.slice(); p[i] = s < 0 ? b.min[i] - 0.01 : b.max[i] + 0.01; if (solidAt(cellOf(p))) { const n = [0, 0, 0]; n[i] = -s; out.push({ cell: cellOf(p), normal: n }); } } return out; },
      raycast(from, dir, maxDist) {
        const d = v3(dir), l = len(d) || 1, u = d.map((/** @type {number} */ v) => v / l);
        for (let t = 0; t <= maxDist; t += 0.25) { const p = v3(from).map((v, i) => v + u[i] * t), c = cellOf(p); if (solidAt(c)) return { hit: 'cell', at: p, normal: u.map(v => -Math.sign(v)), dist: t, cell: c }; }
        return { hit: 'none', at: null, normal: null, dist: maxDist };
      },
      path(from, to) { const g = key(cellOf(to)); return bfs(from, c => key(c) === g).path; },
      reachable(from, rt, opts = {}) { return new Set([...bfs(from).prev.keys()]); },
      canReach: (a, b, rt, opts = {}) => /** @type {NonNullable<SpaceApi['path']>} */ (api.path)(a, b) !== null,
      getCell: at => st().cells[key(cellOf(at))] ?? null,
      setCell(at, block, rt, by = null) {
        const c = cellOf(at); if (!inBounds(c)) return false;
        const s = st(), from = s.cells[key(c)] ?? null; if (from === block) return false;
        if (block == null) delete s.cells[key(c)]; else s.cells[key(c)] = block;
        s.log.push({ t: rt.state.frame, at: c, from, to: block, by }); rt.emit('cell_changed', { at: c, from, to: block, by });
        return true;
      },
      fill(box, block, rt) { const setCell = /** @type {NonNullable<SpaceApi['setCell']>} */ (api.setCell); const [a, b] = box.map(v3); for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) setCell([x, y, z], block, rt); },
      cellsIn(box) { const getCell = /** @type {NonNullable<SpaceApi['getCell']>} */ (api.getCell); const [a, b] = box.map(v3), out = /** @type {Array<{ at: Vec, block: any }>} */ ([]); for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) { const block = getCell([x, y, z]); if (block) out.push({ at: [x, y, z], block }); } return out; },
      editLog: (since = -1) => st().log.filter(e => e.t > since),
      gravityAt: () => [0, -config.gravity, 0],
      slide(e, delta, rt) {
        // Axis-separated collide-and-slide against solid cells, moving to contact: each axis walks the
        // cell layers the box enters and stops flush against the first blocked one.
        const blocked = /** @type {Record<string, boolean>} */ ({ x: false, y: false, z: false }), p = v3(e.at), s = size(e);
        ['x', 'y', 'z'].forEach((ax, i) => {
          const d = delta[i] || 0; if (!d) return;
          const lo = p.map(Math.floor), hi = p.map((v, j) => Math.ceil(v + s[j]) - 1);
          const layerBlocked = (/** @type {number} */ c) => { const a = lo.slice(), b = hi.slice(); a[i] = b[i] = c; for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) if (solidAt([x, y, z])) return true; return false; };
          if (d > 0) { for (let c = Math.ceil(p[i] + s[i] - 1e-9), last = Math.ceil(p[i] + s[i] + d) - 1; c <= last; c++) if (layerBlocked(c)) { p[i] = c - s[i]; blocked[ax] = true; return; } }
          else { for (let c = Math.floor(p[i] + 1e-9) - 1, last = Math.floor(p[i] + d); c >= last; c--) if (layerBlocked(c)) { p[i] = c + 1; blocked[ax] = true; return; } }
          p[i] += d;
        });
        const moved = p.some((v, i) => v !== v3(e.at)[i]); api.setPos(e, p, rt);
        return { moved, blocked, grounded: /** @type {NonNullable<SpaceApi['grounded']>} */ (api.grounded)(e) };
      },
      grounded(e) { const b = boxOf(e); for (let x = Math.floor(b.min[0]); x < Math.ceil(b.max[0]); x++) if (solidAt([x, Math.floor(b.min[1] - 0.01), Math.floor(b.min[2])])) return true; return false; },
      groundAt(x, z) { for (let y = H - 1; y >= 0; y--) if (solidAt([Math.floor(x), y, Math.floor(z)])) return { y: y + 1, normal: [0, 1, 0], material: st().cells[key([Math.floor(x), y, Math.floor(z)])] }; return { y: 0, normal: [0, 1, 0], material: null }; },
      slopeAt: () => 0, waterDepthAt: () => 0,
      neighbors: c => neighbors(cellOf(c)),
      canMove: (e, to) => !solidAt(cellOf(to)) && /** @type {NonNullable<SpaceApi['distance']>} */ (api.distance)(cellOf(e.at), cellOf(to), 'manhattan') === 1,
      move(e, to, rt, { force = false } = {}) { if (!force && !/** @type {NonNullable<SpaceApi['canMove']>} */ (api.canMove)(e, to)) { rt.emit('blocked', { who: e.id, to }); return false; } api.setPos(e, cellOf(to), rt); return true; },
      occupant: c => api.entitiesAt(c)[0] ?? null,
      cellsInRange(c, n, metric = 'manhattan') { const distance = /** @type {NonNullable<SpaceApi['distance']>} */ (api.distance), out = /** @type {Vec[]} */ ([]); const o = cellOf(c); for (let x = -n; x <= n; x++) for (let y = -n; y <= n; y++) { const p = [o[0] + x, o[1] + y, o[2]]; if (inBounds(p) && distance(o, p, metric) <= n) out.push(p); } return out; },
      moveCost: () => 1, coverAt: () => 0,
      los(a, b) { const d = sub(v3(b), v3(a)), l = len(d); const r = /** @type {NonNullable<SpaceApi['raycast']>} */ (api.raycast)(a, d, l); return { clear: r.hit === 'none' || r.dist >= l - 0.5, cover: 0 }; },
      visibleFrom(a, range) { return /** @type {NonNullable<SpaceApi['cellsInRange']>} */ (api.cellsInRange)(a, range, 'euclid').filter(c => /** @type {NonNullable<SpaceApi['los']>} */ (api.los)(a, c).clear); },
    };
    rt.defineSpace(sid, api);
    rt.onRestore(() => {});
  },
};

/** Methods each capability requires (catalog §1). Spaces must implement exactly what they report. @type {Record<string, string[]>} */
export const CAPABILITY_METHODS = {
  position: ['place', 'remove', 'setPos', 'pos', 'entitiesAt', 'inZone', 'zoneAt', 'teleport', 'nearest'],
  distance: ['distance'], overlap: ['overlap', 'contacts'], raycast: ['raycast'], pathfind: ['path'],
  reachable: ['reachable', 'canReach'], editCells: ['getCell', 'setCell', 'fill', 'cellsIn', 'editLog'],
  gravity: ['gravityAt', 'slide', 'grounded'], navigate: ['neighbors', 'canMove', 'move'],
  surface: ['groundAt', 'slopeAt', 'waterDepthAt'], occupancy: ['occupant', 'cellsInRange', 'moveCost', 'coverAt'], los: ['los', 'visibleFrom'],
  bounds: ['bounds', 'inBounds'], wrap: ['wrapPos', 'delta'], dynamics: ['impulse', 'velocity', 'setVelocity'],
};

/** Methods a space's capability needs: kernel list, else the card's provides.capabilityMethods. @param {Card | undefined} card @param {string} cap @returns {string[]} */
export function capabilityMethods(card, cap) { return CAPABILITY_METHODS[cap] || card?.provides?.capabilityMethods?.[cap] || []; }

/** Axis-aligned box of an entity's body in its space, honoring api.anchor ('center' | 'min' | 'cell' | 'slot'). @param {Entity} entity @param {{ anchor?: string }} api */
export function bodyBox(entity, api) {
  const at = Array.isArray(entity.at) ? entity.at : [0, 0, 0], size = entity.components?.body?.size || at.map(() => 1);
  const min = api.anchor === 'center' ? at.map((/** @type {number} */ v, /** @type {number} */ i) => v - (size[i] ?? 1) / 2) : at.slice();
  return { min, max: min.map((/** @type {number} */ v, /** @type {number} */ i) => v + (size[i] ?? 1)) };
}

/**
 * Register the conformance tests for a space primitive.
 * opts: { name, primitives, doc(): a minimal document using the space with a player,
 *         free: At (an open position), other: At (a second open position reachable from free),
 *         solid?: At (a blocked position, for editCells/raycast spaces) }
 */
/**
 * @param {(name: string, fn: () => void) => unknown} test @param {any} assert
 * @param {{ name: string, primitives: Primitive[], doc(): Doc, free: any, other: any, solid?: any, block?: any }} opts
 */
export function spaceConformance(test, assert, opts) {
  const make = () => compile(opts.doc(), { primitives: opts.primitives });
  test(`${opts.name}: implements every reported capability`, () => {
    const { rt, checked } = make();
    const sid = checked.doc.spaces[0].id, api = rt.space(sid);
    const card = /** @type {import('./types.js').RegisteredPrimitive} */ (make().registry.get(checked.doc.spaces[0].use)).card;
    for (const cap of checked.capabilities[sid]) {
      const methods = capabilityMethods(card, cap);
      assert.ok(methods.length || ['none'].includes(cap), `capability '${cap}' has no method list: add it to card.provides.capabilityMethods`);
      for (const m of methods) assert.equal(typeof api[m], 'function', `${cap}.${m}`);
    }
    assert.ok(['center', 'min', 'cell', 'slot', undefined].includes(api.anchor), 'api.anchor');
  });
  test(`${opts.name}: positions round-trip and survive snapshot/restore`, () => {
    const { rt, checked } = make();
    const api = rt.space(checked.doc.spaces[0].id), p = /** @type {Entity} */ (rt.player());
    api.setPos(p, opts.other, rt);
    const snap = rt.snapshot(); api.setPos(p, opts.free, rt); rt.restore(snap);
    const want = structuredClone(snap.entities.player.at);
    assert.deepEqual(api.pos(/** @type {Entity} */ (rt.player())), want);
  });
  test(`${opts.name}: distance is zero to itself and symmetric`, () => {
    const { rt, checked } = make();
    const api = /** @type {FullSpaceApi} */ (rt.space(checked.doc.spaces[0].id));
    assert.equal(api.distance(opts.free, opts.free), 0);
    assert.equal(api.distance(opts.free, opts.other), api.distance(opts.other, opts.free));
  });
  test(`${opts.name}: kernel zone/teleport/near work through the space`, () => {
    const { rt, checked } = make();
    const z = checked.doc.spaces[0].zones?.[0]; if (!z) return;
    rt.run([{ do: 'teleport', zone: z.id }]);
    assert.ok(rt.test({ zone: z.id }), 'player is in the zone it teleported to');
    assert.ok(rt.test({ near: z.id, within: 0.5 }), 'near a zone it is in');
  });
  test(`${opts.name}: same seed and inputs replay to the same state`, () => {
    const a = make().rt, b = make().rt;
    for (let i = 0; i < 30; i++) { a.step({ actions: {} }); b.step({ actions: {} }); }
    assert.deepEqual(a.snapshot(), b.snapshot());
  });
  if (opts.solid) test(`${opts.name}: cell edits are logged and restorable`, () => {
    const { rt, checked } = make();
    const api = /** @type {FullSpaceApi} */ (rt.space(checked.doc.spaces[0].id));
    if (!api.setCell) return;
    const before = api.getCell(opts.free), snap = rt.snapshot();
    assert.equal(api.setCell(opts.free, before ? null : opts.block || 'stone', rt), true);
    assert.equal(api.editLog().length > 0, true);
    rt.restore(snap); assert.equal(api.getCell(opts.free), before);
  });
}
