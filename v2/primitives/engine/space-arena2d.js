// A continuous kinematic 2D arena: fighters, shmups, asteroids-likes and
// side runners. Bodies are boxes centred on e.at; movement primitives move them
// with slide() against solid rects, one-way platforms (drop-through) and the
// arena edges (solid, open, kill or wrap). Per-entity box sets keyed by pose
// (hurt/hit/push, mirrored by facing) give fighting games their hit detection;
// a moving scroll window clamps, carries and kills for autoscrollers and
// runners; blast zones, push-apart and a leash (max separation) cover
// platform fighters and traditional versus stages. Ballistic bodies
// (projectiles, debris) are integrated by the space.
import { zoneIndex, zoneTracker, addZoneTo, inSpace, bodyOf, clamp, mod, rectHas, rectArea, rectCenter, rectDist, rectsOverlap, boxAround, rayRect, shapeHitsRect, edgesParam, checkEdges, wrapDelta, BOUNDS_CAPS, zoneEditor, obstacleOf, obstaclesIn } from './spaces2d-lib.js';

const EPS = 1e-6;
const STICK = 0.5; // a rider stays on the entity it stands on if that entity rose at most this far since its last slide
const rectList = (effect) => ({ type: 'list', default: [], of: { type: 'list', of: { type: 'number' }, min: 4, max: 4 }, effect });
const strList = (effect, d = []) => ({ type: 'list', of: { type: 'string' }, default: d, effect });

export default {
  id: 'engine.space.arena2d',
  card: {
    intent: 'A bounded continuous 2D arena with kinematic box bodies: solid blocks, one-way platforms, wrap-around or kill edges, a moving scroll window, blast zones, and per-pose hurt/hit/push box sets for fighting. For fighters, shmups, asteroids-likes and side runners.',
    views: ['side', 'td'],
    // The coordinate frame (runtime-lib-frame.js): `up` the axis pointing up (null: a plane seen from above, the viewer
    // up), `handed` whether x, y, up (or x, y, toward the viewer) is a right- or left-handed frame.
    frame: config => (config.gravity ? { up: 1, handed: 'right' } : { up: null, handed: 'right' }),
    needs: { content: ['structures'] },
    params: {
      size: { type: 'list', of: { type: 'number', min: 1, max: 1e6 }, min: 2, max: 2, default: [16, 9], unit: 'u', scale: 'world', effect: 'arena width and height from the origin' },
      gravity: { type: 'number', default: 0, unit: 'u/s²', effect: 'vertical gravity for ballistic bodies and gravityAt (negative pulls down; 0 for top-down)' },
      edges: edgesParam('solid'),
      solids: rectList('solid rects [x0,y0,x1,y1]: stages, walls, blocks'),
      platforms: { type: 'list', default: [], of: { type: 'object', fields: { x0: { type: 'number', required: true }, x1: { type: 'number', required: true }, y: { type: 'number', required: true } } }, effect: 'one-way (soft) platforms: land from above, jump through from below, drop through' },
      blast: { type: 'list', of: { type: 'number' }, min: 4, max: 4, effect: 'blast-zone rect [x0,y0,x1,y1]: bodies whose centre leaves it emit blasted' },
      scroll: { type: 'object', fields: {
        axis: { type: 'string', options: ['x', 'y'], default: 'x' }, speed: { type: 'number', default: 0, unit: 'u/s' }, accel: { type: 'number', default: 0, unit: 'u/s²' }, max: { type: 'number', default: 1e9, unit: 'u/s' },
        window: { type: 'list', of: { type: 'number', min: 0.1 }, min: 2, max: 2, required: true, effect: 'window width and height' }, start: { type: 'list', of: { type: 'number' }, default: [0, 0], effect: 'window min corner at start' },
        clamp: strList('classes kept inside the window (player ships)'), carry: strList('classes moved along with the window'),
        kill: { type: 'string', options: ['none', 'behind', 'outside'], default: 'none', effect: 'emit scrolled_out for bodies left behind (or outside) the window' },
        cull: { type: 'number', min: 0, default: 2, effect: 'bodies marked body.cull are despawned this far outside the window' },
      }, effect: 'moving window for autoscrollers, runners and rising-camera climbers' },
      separate: { type: 'object', fields: { classes: strList('classes whose push boxes may not overlap', []), axis: { type: 'string', options: ['x', 'both'], default: 'x' } }, effect: 'push-apart of overlapping push boxes (fighters)' },
      leash: { type: 'object', fields: { classes: strList('classes kept together', []), maxSpan: { type: 'number', min: 0, required: true }, axis: { type: 'string', options: ['x', 'y'], default: 'x' } }, effect: 'maximum spread between bodies (versus screen limit)' },
      cull: strList('classes despawned once fully outside the arena (bullets); body.cull does the same per entity'),
    },
    provides: {
      capabilities: ['position', 'distance', 'overlap', 'raycast', 'gravity', 'dynamics', 'bounds', 'boxes', 'ledges', 'scroll', 'wrap'],
      capabilityMethods: { boxes: ['boxesOf', 'setPose', 'setBoxes', 'boxHits'], ledges: ['ledgeNear'], scroll: ['scroll', 'setScroll'], ...BOUNDS_CAPS },
      events: ['enter_zone', 'leave_zone', 'enter_zone:*', 'leave_zone:*', 'out_of_bounds', 'out_of_bounds:*', 'blasted', 'scrolled_out', 'landed', 'culled', 'zone_added', 'zone_removed', 'zone_moved'],
      // Its structures can be written in its own params (walls, stages, barriers): a document with solids or platforms has them.
      contentParams: { structures: ['solids', 'platforms'] },
    },
    at: 'At = [x, y] arena units, y up: the centre of the body box (components.body.size). Box sets are local [x, y, w, h] relative to the centre with x measured forward (mirrored when body.facing < 0): body.poses = {pose: {hurt, hit, push}}, body.pose, or body.boxes overriding the pose; default hurt = push = the body box, no hit boxes.',
    zones: 'Zone = {id, name?, rect:[x0,y0,x1,y1), spawn?, tags?, rules?}',
    state: 'rt.state.spaces[id] = {scroll?:{offset:[x,y], speed}, inside, out, blasted, zones?}',
    notes: 'Classes (scroll.clamp/carry, separate, leash, cull) match entity id, archetype, body.layer and body.tags. Bodies with body.ballistic are integrated (gravity × body.gravityScale, bounce, friction); body.collide=false passes through geometry. raycast hits static geometry as hit:"cell" with solid index (platform:i for one-way when mask.oneway) and solid entities as hit:"entity" with solid:true. Entity obstacles: body.solid entities act as solid rects in slide, body.oneWay ones as one-way platforms; body.standingOn records the support, riders are carried by ballistic movers and setPos(e, at, rt, {carry:true}) and stick to a support that rose up to 0.5; an obstacle already overlapping the mover is ignored. Zones: addZone/removeZone/moveZone.',
  },
  capabilities(config) {
    const caps = ['position', 'distance', 'overlap', 'raycast', 'gravity', 'dynamics', 'bounds', 'boxes'];
    if ((config.solids || []).length) caps.push('ledges');
    if (Object.values(config.edges || {}).includes('wrap')) caps.push('wrap');
    if (config.scroll) caps.push('scroll');
    return caps;
  },
  validate(config) {
    const errors = [...checkEdges(config.edges, 'with.edges')], [W, H] = config.size || [16, 9];
    (config.solids || []).forEach((r, i) => { if (r[2] <= r[0] || r[3] <= r[1]) errors.push({ code: 'rect_invalid', path: `with.solids[${i}]`, message: 'solid rect needs x1>x0 and y1>y0' }); });
    (config.platforms || []).forEach((p, i) => { if (p.x1 <= p.x0) errors.push({ code: 'rect_invalid', path: `with.platforms[${i}]`, message: 'platform needs x1 > x0' }); });
    if (config.blast && (config.blast[2] <= config.blast[0] || config.blast[3] <= config.blast[1])) errors.push({ code: 'rect_invalid', path: 'with.blast', message: 'blast rect needs x1>x0 and y1>y0' });
    const s = config.scroll;
    if (s && Array.isArray(s.window) && (s.window[0] > W + EPS || s.window[1] > H + EPS)) errors.push({ code: 'scroll_window_invalid', path: 'with.scroll.window', message: `window ${s.window.join('×')} is larger than the ${W}×${H} arena` });
    if (s && config.edges && config.edges[s.axis === 'x' ? 'left' : 'bottom'] === 'wrap') errors.push({ code: 'scroll_wrap_conflict', path: 'with.scroll.axis', message: 'a scrolling axis cannot also wrap' });
    return errors;
  },
  install(rt, config, instance) {
    const sid = instance.id, [W, H] = config.size, E = config.edges, S = config.scroll;
    const wrapX = E.left === 'wrap', wrapY = E.bottom === 'wrap';
    const sst = () => rt.state.spaces[sid];
    const zones = zoneIndex(rt, sid);
    const zoneHas = (z, at) => Boolean(z.rect) && rectHas(z.rect, at);
    const tracker = zoneTracker(rt, sid, zones, zoneHas, z => (z.rect ? rectArea(z.rect) : Infinity));
    const classesOf = e => [e.id, e.archetype, e.components.body?.layer, ...(e.components.body?.tags || [])].filter(Boolean);
    const isClass = (e, list) => Boolean(list?.length) && classesOf(e).some(c => list.includes(c));
    const scrollSt = () => (S ? (sst().scroll ??= { offset: S.start.slice(), speed: S.speed }) : null);
    const windowRect = () => { if (!S) return [0, 0, W, H]; const o = scrollSt().offset; return [o[0], o[1], o[0] + S.window[0], o[1] + S.window[1]]; };
    const wrapPos = at => [wrapX ? mod(at[0], W) : at[0], wrapY ? mod(at[1], H) : at[1]];
    const delta = (a, b) => [wrapDelta(a[0], b[0], wrapX ? W : 0), wrapDelta(a[1], b[1], wrapY ? H : 0)];
    const boxOf = e => boxAround(e.at, bodyOf(e).size);
    // setPos(e, at, rt, {carry}): with carry, entities standing on e (body.standingOn) move with it.
    const setPos = (e, at, rt, o = {}) => {
      const from = e.at;
      e.at = wrapPos([at[0], at[1]]); tracker.track(e, rt);
      if (o.carry && from && obstacleOf(e)) { const d = [at[0] - from[0], at[1] - from[1]]; if (d[0] || d[1]) for (const r of inSpace(rt, sid, x => x !== e && x.components.body?.standingOn === e.id)) { slide(r, d, rt, { ignore: [e.id], keepSupport: true }); r.components.body.grounded = true; r.components.body.standingOn = e.id; } }
    };
    // Entity obstacles (body.solid / body.oneWay) for one slide. Ones already overlapping the mover are
    // ignored (a closing door must not trap it); the one it stands on only holds it up.
    const obstaclesFor = (e, o = {}) => {
      const start = boxOf(e), on = e.components.body?.standingOn;
      return obstaclesIn(rt, sid, e, o.ignore).map(x => ({ id: x.id, kind: obstacleOf(x), rect: boxOf(x) }))
        .filter(x => x.id === on || x.kind === 'oneway' || !rectsOverlap(start, x.rect))
        .map(x => (x.id === on && rectsOverlap(start, x.rect) ? { ...x, kind: 'oneway' } : x));
    };

    // ---------- collision geometry: solids, platforms, solid edges ----------
    const edgeRects = () => { const T = Math.max(W, H); return [E.left === 'solid' && [-T, -T, 0, H + T], E.right === 'solid' && [W, -T, W + T, H + T], E.bottom === 'solid' && [-T, -T, W + T, 0], E.top === 'solid' && [-T, H, W + T, H + T]].filter(Boolean); };
    const blockers = () => [...config.solids, ...edgeRects()];
    const hitSolid = (box, ents = []) => blockers().find(r => rectsOverlap(box, r)) || ents.filter(o => o.kind === 'solid' && rectsOverlap(box, o.rect)).map(o => Object.assign(o.rect.slice(), { id: o.id }))[0] || null;

    function slide(e, d, rt, opts = {}) {
      const b = bodyOf(e), hw = b.size[0] / 2, hh = b.size[1] / 2, was = b.grounded;
      let [x, y] = e.at; const dx = d[0] || 0, dy = d[1] || 0;
      const blocked = { x: false, y: false, z: false }; let grounded = false, normal = null, support = null;
      const box = (px, py) => [px - hw, py - hh, px + hw, py + hh];
      const ents = opts.ghost ? [] : obstaclesFor(e, opts), on = b.standingOn ?? null, touched = [];
      const touch = r => { if (r?.id && !touched.includes(r.id)) touched.push(r.id); };
      // One-way surfaces: static platforms plus one-way entity tops.
      const plats = [...config.platforms, ...ents.filter(o => o.kind === 'oneway').map(o => ({ x0: o.rect[0], x1: o.rect[2], y: o.rect[3], id: o.id }))];
      const maxStep = Math.max(0.05, Math.min(hw, hh));
      const nh = Math.ceil(Math.abs(dx) / maxStep), x0 = x;
      for (let i = 0; i < nh; i++) {
        const tx = x0 + dx * (i + 1) / nh, r = hitSolid(box(tx, y), ents);
        if (!r) { x = tx; continue; }
        // Step up small lips when supported.
        if (opts.stepHeight && was) { const top = r[3]; if (top - (y - hh) <= opts.stepHeight + EPS && !hitSolid(box(tx, top + hh + EPS), ents)) { x = tx; y = top + hh + EPS; continue; } }
        x = dx > 0 ? r[0] - hw - EPS : r[2] + hw + EPS; blocked.x = true; normal = [dx > 0 ? -1 : 1, 0]; touch(r); break;
      }
      const nv = Math.ceil(Math.abs(dy) / maxStep), y0 = y;
      for (let i = 0; i < nv; i++) {
        const ty = y0 + dy * (i + 1) / nv, bottom0 = y - hh;
        if (dy < 0 && !opts.drop) {
          const p = plats.filter(p => x + hw > p.x0 && x - hw < p.x1 && bottom0 >= p.y - (p.id && p.id === on ? STICK : EPS) && ty - hh < p.y).sort((a, c) => c.y - a.y)[0];
          if (p) { y = p.y + hh; blocked.y = true; grounded = true; normal = [0, 1]; support = p.id ?? null; touch(p); break; }
        }
        const r = hitSolid(box(x, ty), ents);
        if (r) { y = dy > 0 ? r[1] - hh - EPS : r[3] + hh + EPS; blocked.y = true; if (dy < 0) { grounded = true; normal = [0, 1]; support = r.id ?? null; } else normal = [0, -1]; touch(r); break; }
        y = ty;
      }
      if (!grounded) { const g = groundedAt(x, y, hw, hh, opts.drop, ents); grounded = Boolean(g); if (g) support = g.id ?? null; }
      b.grounded = grounded;
      if (support && grounded) b.standingOn = support; else if (!opts.keepSupport) delete b.standingOn;
      const moved = x !== e.at[0] || y !== e.at[1];
      setPos(e, [x, y], rt, { carry: Boolean(obstacleOf(e)) });
      return { moved, blocked, grounded, normal, touched, on: b.standingOn ?? null, surface: grounded ? (b.standingOn ? `entity:${b.standingOn}` : surfaceUnder(x, y - hh, hw)) : null };
    }
    /** Supporting surface just under a box: true/{id} or null. */
    function groundedAt(x, y, hw, hh, drop, ents = []) {
      const probe = [x - hw + EPS, y - hh - 0.02, x + hw - EPS, y - hh];
      const r = hitSolid(probe, ents); if (r) return r.id ? { id: r.id } : {};
      if (drop) return null;
      const p = config.platforms.find(p => x + hw > p.x0 && x - hw < p.x1 && Math.abs(y - hh - p.y) < 0.02); if (p) return {};
      const o = ents.find(o => o.kind === 'oneway' && x + hw > o.rect[0] && x - hw < o.rect[2] && Math.abs(y - hh - o.rect[3]) < 0.02);
      return o ? { id: o.id } : null;
    }
    // Which surface a grounded body stands on: 'solid:<i>', 'platform:<i>', 'entity:<id>' or 'edge'.
    function surfaceUnder(x, bottom, hw) {
      const i = config.solids.findIndex(r => x + hw > r[0] && x - hw < r[2] && Math.abs(r[3] - bottom) < 0.03);
      if (i >= 0) return `solid:${i}`;
      const j = config.platforms.findIndex(p => x + hw > p.x0 && x - hw < p.x1 && Math.abs(p.y - bottom) < 0.03);
      return j >= 0 ? `platform:${j}` : 'edge';
    }

    // ---------- box sets ----------
    const localSets = e => {
      const b = bodyOf(e), body = [-b.size[0] / 2, -b.size[1] / 2, b.size[0], b.size[1]];
      const set = b.boxes || (b.pose && b.poses?.[b.pose]) || null;
      return { hurt: set?.hurt ?? [body], hit: set?.hit ?? [], push: set?.push ?? set?.hurt ?? [body] };
    };
    const toWorld = (e, [x, y, w, h]) => { const f = (bodyOf(e).facing ?? 1) < 0 ? -1 : 1, x0 = f > 0 ? e.at[0] + x : e.at[0] - x - w; return [x0, e.at[1] + y, x0 + w, e.at[1] + y + h]; };
    const boxesOf = (e, kind = 'hurt') => (localSets(e)[kind] || []).map(b => toWorld(e, b));

    // ---------- per-step world rules ----------
    function stepWorld(rt) {
      const dt = rt.dt, all = inSpace(rt, sid);
      // Ballistic bodies.
      for (const e of all) {
        const b = e.components.body; if (!b?.ballistic) continue;
        const gs = b.gravityScale ?? 1, was = b.grounded;
        b.vel = [b.vel[0], b.vel[1] + config.gravity * gs * dt];
        if (b.collide === false) { setPos(e, [e.at[0] + b.vel[0] * dt, e.at[1] + b.vel[1] * dt], rt, { carry: true }); continue; }
        const vy = b.vel[1], r = slide(e, [b.vel[0] * dt, b.vel[1] * dt], rt), bounce = b.bounce ?? 0;
        if (r.blocked.x) b.vel[0] = -b.vel[0] * bounce;
        if (r.blocked.y) b.vel[1] = Math.abs(vy * bounce) > Math.max(0.01, 2 * Math.abs(config.gravity * gs) * dt) ? -vy * bounce : 0; // rest instead of micro-bouncing
        if (r.grounded) b.vel[0] *= 1 - clamp(b.friction ?? 0, 0, 1);
        if (r.grounded && !was) rt.emit('landed', { who: e.id, speed: -vy });
      }
      // Push-apart and leash.
      if (config.separate?.classes?.length) {
        const list = all.filter(e => isClass(e, config.separate.classes));
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) pushApart(list[i], list[j], rt);
      }
      if (config.leash?.classes?.length) {
        const list = all.filter(e => isClass(e, config.leash.classes)), k = config.leash.axis === 'y' ? 1 : 0;
        if (list.length > 1) {
          const lo = list.reduce((a, e) => (e.at[k] < a.at[k] ? e : a)), hi = list.reduce((a, e) => (e.at[k] > a.at[k] ? e : a)), over = (hi.at[k] - lo.at[k] - config.leash.maxSpan) / 2;
          if (over > 0) { const p = lo.at.slice(), q = hi.at.slice(); p[k] += over; q[k] -= over; setPos(lo, p, rt); setPos(hi, q, rt); }
        }
      }
      // Scroll window.
      if (S) {
        const s = scrollSt(), k = S.axis === 'x' ? 0 : 1, before = s.offset[k];
        s.offset[k] = clamp(s.offset[k] + s.speed * dt, 0, (k ? H : W) - S.window[k]);
        s.speed = clamp(s.speed + S.accel * dt, -S.max, S.max);
        const moved = s.offset[k] - before;
        const win = windowRect(), out = (sst().scrolledOut ??= {});
        for (const e of inSpace(rt, sid)) {
          if (moved && isClass(e, S.carry)) { const p = e.at.slice(); p[k] += moved; setPos(e, p, rt); }
          const b = bodyOf(e), box = boxOf(e);
          if (isClass(e, S.clamp)) {
            const hw = b.size[0] / 2, hh = b.size[1] / 2, p = [clamp(e.at[0], win[0] + hw, win[2] - hw), clamp(e.at[1], win[1] + hh, win[3] - hh)];
            if (p[0] !== e.at[0] || p[1] !== e.at[1]) { if (p[0] !== e.at[0]) b.vel[0] = 0; if (p[1] !== e.at[1]) b.vel[1] = 0; setPos(e, p, rt); }
          }
          const behind = S.speed >= 0 ? box[2 + k] < win[k] : box[k] > win[2 + k], outside = !rectsOverlap(box, win);
          const gone = S.kill === 'behind' ? behind : S.kill === 'outside' ? outside : false;
          if (gone && !out[e.id]) { out[e.id] = true; rt.emit('scrolled_out', { who: e.id }); } else if (!gone && out[e.id]) delete out[e.id];
          if (b.cull && !rectsOverlap(box, [win[0] - S.cull, win[1] - S.cull, win[2] + S.cull, win[3] + S.cull])) { rt.emit('culled', { who: e.id }); rt.despawn(e.id); }
        }
      }
      // Arena edges, blast zones, culling.
      const out = (sst().out ??= {}), blasted = (sst().blasted ??= {});
      for (const e of inSpace(rt, sid)) {
        const b = bodyOf(e), box = boxOf(e);
        if ((b.cull || isClass(e, config.cull)) && (box[2] < 0 || box[0] > W || box[3] < 0 || box[1] > H)) { rt.emit('culled', { who: e.id }); rt.despawn(e.id); continue; }
        if (wrapX || wrapY) { const p = wrapPos(e.at); if (p[0] !== e.at[0] || p[1] !== e.at[1]) setPos(e, p, rt); }
        if (b.collide !== false) {
          const hw = b.size[0] / 2, hh = b.size[1] / 2, p = e.at.slice();
          if (E.left === 'solid' && p[0] < hw) { p[0] = hw; b.vel[0] = Math.max(0, b.vel[0]); }
          if (E.right === 'solid' && p[0] > W - hw) { p[0] = W - hw; b.vel[0] = Math.min(0, b.vel[0]); }
          if (E.bottom === 'solid' && p[1] < hh) { p[1] = hh; b.vel[1] = Math.max(0, b.vel[1]); }
          if (E.top === 'solid' && p[1] > H - hh) { p[1] = H - hh; b.vel[1] = Math.min(0, b.vel[1]); }
          if (p[0] !== e.at[0] || p[1] !== e.at[1]) setPos(e, p, rt);
        }
        const edge = box[2] <= 0 ? 'left' : box[0] >= W ? 'right' : box[3] <= 0 ? 'bottom' : box[1] >= H ? 'top' : null;
        if (edge && E[edge] === 'kill') { if (out[e.id] !== edge) { out[e.id] = edge; rt.emitTyped('out_of_bounds', edge, { who: e.id, edge }); } } else if (out[e.id]) delete out[e.id];
        if (config.blast) {
          const B = config.blast, side = e.at[0] < B[0] ? 'left' : e.at[0] > B[2] ? 'right' : e.at[1] < B[1] ? 'bottom' : e.at[1] > B[3] ? 'top' : null;
          if (side && !blasted[e.id]) { blasted[e.id] = side; rt.emit('blasted', { who: e.id, side, at: [clamp(e.at[0], B[0], B[2]), clamp(e.at[1], B[1], B[3])] }); } else if (!side && blasted[e.id]) delete blasted[e.id];
        }
      }
    }
    // Overlapping push boxes separate half each along x (or the shallower axis); a body pinned
    // to a solid edge pushes the other one out instead (versus corner behaviour).
    function pushApart(a, b, rt) {
      const A = boxesOf(a, 'push'), B = boxesOf(b, 'push');
      for (const ra of A) for (const rb of B) {
        if (!rectsOverlap(ra, rb)) continue;
        const ox = Math.min(ra[2], rb[2]) - Math.max(ra[0], rb[0]), oy = Math.min(ra[3], rb[3]) - Math.max(ra[1], rb[1]);
        const k = config.separate.axis === 'both' && oy < ox ? 1 : 0, over = k ? oy : ox;
        const s = Math.sign(b.at[k] - a.at[k]) || ((bodyOf(a).facing ?? 1) > 0 ? 1 : -1);
        const pa = a.at.slice(), pb = b.at.slice(); pa[k] -= s * over / 2; pb[k] += s * over / 2;
        const lim = (e, p) => { const h = bodyOf(e).size[k] / 2, lo = (k ? E.bottom : E.left) === 'solid' ? h : -Infinity, hi = (k ? E.top : E.right) === 'solid' ? (k ? H : W) - h : Infinity; return clamp(p[k], lo, hi); };
        const ca = lim(a, pa); if (ca !== pa[k]) { pb[k] += ca - pa[k]; pa[k] = ca; }
        const cb = lim(b, pb); if (cb !== pb[k]) { pa[k] += cb - pb[k]; pb[k] = cb; }
        setPos(a, pa, rt); setPos(b, pb, rt);
        return;
      }
    }

    // ---------- raycast ----------
    function raycast(from, dir, maxDist, mask = {}) {
      const l = Math.hypot(dir[0], dir[1]) || 1, u = [dir[0] / l, dir[1] / l];
      let best = { hit: 'none', at: null, normal: null, dist: maxDist };
      const consider = (t, r, extra) => {
        if (t > best.dist || t === Infinity) return;
        const p = [from[0] + u[0] * t, from[1] + u[1] * t];
        const n = Math.abs(p[0] - r[0]) < 1e-6 ? [-1, 0] : Math.abs(p[0] - r[2]) < 1e-6 ? [1, 0] : Math.abs(p[1] - r[1]) < 1e-6 ? [0, -1] : [0, 1];
        best = { at: p, normal: t === 0 ? [-u[0], -u[1]] : n, dist: t, ...extra };
      };
      if (mask.cells !== false) {
        config.solids.forEach((r, i) => consider(rayRect(from, u, r, maxDist), r, { hit: 'cell', solid: i }));
        edgeRects().forEach(r => consider(rayRect(from, u, r, maxDist), r, { hit: 'cell', solid: 'edge' }));
        if (mask.oneway && u[1] < 0) config.platforms.forEach((p, i) => { const t = (p.y - from[1]) / u[1]; if (t >= 0 && from[1] >= p.y) { const x = from[0] + u[0] * t; if (x >= p.x0 && x <= p.x1) consider(t, [p.x0, p.y - 1, p.x1, p.y], { hit: 'cell', solid: `platform:${i}` }); } });
      }
      // Entities: all with mask.entities; otherwise solid obstacles unless mask.solids === false (one-way only from above with mask.oneway).
      for (const o of inSpace(rt, sid)) {
        if (o.id === mask.ignore || (typeof mask.entities === 'function' && !mask.entities(o))) continue;
        if (!mask.entities) { const k = obstacleOf(o); if (mask.solids === false || !k || (k === 'oneway' && !(mask.oneway && u[1] < 0))) continue; }
        for (const r of mask.boxes ? boxesOf(o, mask.boxes) : [boxOf(o)]) consider(rayRect(from, u, r, best.dist), r, { hit: 'entity', id: o.id, ...(obstacleOf(o) ? { solid: true } : {}) });
      }
      return best;
    }

    const api = {
      kind: 'arena2d', anchor: 'center', size: [W, H], config,
      get zones() { return zones().byId; },
      place(e, rt) { bodyOf(e); if (e.at == null) { const z = zones().list[0]; e.at = z ? z.spawn || rectCenter(z.rect) : rectCenter(windowRect()); } setPos(e, e.at, rt); },
      remove(e, rt) { for (const z of sst().inside?.[e.id] || []) rt.emitTyped('leave_zone', z, { who: e.id, zone: z }); tracker.forget(e); for (const k of ['out', 'blasted', 'scrolledOut']) if (sst()[k]) delete sst()[k][e.id]; e.zone = null; },
      pos: e => e.at, setPos,
      entitiesAt: at => inSpace(rt, sid, e => rectHas(boxOf(e), at)).map(e => e.id),
      inZone: (e, zone) => { const z = zones().byId.get(zone); return Boolean(z) && zoneHas(z, e.at); },
      zoneAt: at => tracker.zoneAt(at),
      teleport(e, { zone, at }, rt) { const z = zone && zones().byId.get(zone); bodyOf(e).vel = [0, 0]; setPos(e, at ?? (z ? z.spawn || rectCenter(z.rect) : e.at), rt); },
      nearest(e, target, rt) {
        const z = zones().byId.get(target);
        if (z) return zoneHas(z, e.at) ? 0 : rectDist(z.rect, e.at);
        let best = null; for (const o of inSpace(rt, sid)) if (o !== e && (o.id === target || o.archetype === target)) { const d = api.distance(e.at, o.at); if (best === null || d < best) best = d; }
        return best;
      },
      distance(a, b, metric = 'euclid') { const [dx, dy] = delta(a, b); return metric === 'manhattan' ? Math.abs(dx) + Math.abs(dy) : Math.hypot(dx, dy); },
      wrapPos, delta,
      bounds: () => { const r = windowRect(); return { min: [r[0], r[1]], max: [r[2], r[3]], wrap: [wrapX, wrapY] }; },
      inBounds: (at, m = 0) => { const r = windowRect(); return (wrapX || (at[0] >= r[0] - m && at[0] <= r[2] + m)) && (wrapY || (at[1] >= r[1] - m && at[1] <= r[3] + m)); },
      scroll: () => (S ? structuredClone(scrollSt()) : { offset: [0, 0], speed: 0 }),
      setScroll({ speed, offset } = {}, rt) { if (!S) return false; const s = scrollSt(); if (speed !== undefined) s.speed = speed; if (offset) s.offset = [clamp(offset[0], 0, W - S.window[0]), clamp(offset[1], 0, H - S.window[1])]; return true; },
      overlap(shape, filter, kind) {
        const f = typeof filter === 'function' ? filter : null;
        return inSpace(rt, sid, e => (!f || f(e)) && (kind ? boxesOf(e, kind) : [boxOf(e)]).some(r => shapeHitsRect(shape, r))).map(e => e.id);
      },
      contacts(e) {
        const b = boxOf(e), grow = [b[0] - 0.01, b[1] - 0.01, b[2] + 0.01, b[3] + 0.01], out = [];
        blockers().forEach((r, i) => { if (rectsOverlap(grow, r)) { const n = r[3] <= b[1] + 0.011 ? [0, 1] : r[1] >= b[3] - 0.011 ? [0, -1] : r[2] <= b[0] + 0.011 ? [1, 0] : [-1, 0]; out.push({ solid: i < config.solids.length ? i : 'edge', normal: n }); } });
        config.platforms.forEach((p, i) => { if (b[2] > p.x0 && b[0] < p.x1 && Math.abs(b[1] - p.y) < 0.011) out.push({ solid: `platform:${i}`, normal: [0, 1] }); });
        for (const o of inSpace(rt, sid)) if (o !== e && rectsOverlap(grow, boxOf(o))) { const [dx, dy] = delta(o.at, e.at); out.push({ id: o.id, normal: Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy)] }); }
        return out;
      },
      raycast,
      gravityAt: at => { const z = at && zones().byId.get(tracker.zoneAt(at)); return [0, Number.isFinite(z?.rules?.gravity) ? z.rules.gravity : config.gravity, 0]; },
      slide,
      grounded: e => { const b = bodyOf(e); return Boolean(groundedAt(e.at[0], e.at[1], b.size[0] / 2, b.size[1] / 2, false, obstaclesFor(e))); },
      impulse(e, v) { const b = bodyOf(e), m = b.mass || 1; b.vel = [b.vel[0] + v[0] / m, b.vel[1] + v[1] / m]; },
      velocity: e => bodyOf(e).vel.slice(),
      setVelocity(e, v) { bodyOf(e).vel = [v[0], v[1]]; },
      // boxes
      boxesOf, setPose(e, pose) { bodyOf(e).pose = pose; }, setBoxes(e, sets) { if (sets) bodyOf(e).boxes = structuredClone(sets); else delete bodyOf(e).boxes; },
      /** Pairs where a's `from` boxes overlap b's `to` boxes: [{a, b, at, boxA, boxB}] (each ordered pair once). */
      boxHits(from = 'hit', to = 'hurt', filter) {
        const list = inSpace(rt, sid, e => !filter || filter(e)), out = [];
        for (const a of list) { const A = boxesOf(a, from); if (!A.length) continue; for (const b of list) { if (a === b) continue; const B = boxesOf(b, to); hit: for (const ra of A) for (const rb of B) if (rectsOverlap(ra, rb)) { out.push({ a: a.id, b: b.id, at: [(Math.max(ra[0], rb[0]) + Math.min(ra[2], rb[2])) / 2, (Math.max(ra[1], rb[1]) + Math.min(ra[3], rb[3])) / 2], boxA: ra, boxB: rb }); break hit; } } }
        return out;
      },
      /** Nearest grabbable top corner of a solid within reach [dx, dy] of `at` (or an entity): {at, side} or null. */
      ledgeNear(at, reach = [1, 1]) {
        const p = Array.isArray(at) ? at : at.at; let best = null, bd = Infinity;
        config.solids.forEach(r => [[r[0], -1], [r[2], 1]].forEach(([x, side]) => {
          const c = [x, r[3]]; if (Math.abs(p[0] - c[0]) > reach[0] || Math.abs(p[1] - c[1]) > reach[1]) return;
          if (hitSolid([side < 0 ? x - 0.02 : x, r[3] - 0.01, side < 0 ? x : x + 0.02, r[3] + 0.01])) return; // a neighbouring solid covers this corner
          const d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < bd) { bd = d; best = { at: c, side }; }
        }));
        return best;
      },
      ...zoneEditor(rt, sid, zones, z => (Array.isArray(z.rect) && z.rect.length === 4 ? null : 'needs rect [x0,y0,x1,y1]'), rt => { for (const e of inSpace(rt, sid)) tracker.track(e, rt); }),
    };
    api.applyImpulse = api.impulse;
    rt.defineSpace(sid, api);
    scrollSt(); // persisted layout exists from the start: reads never change state shape
    rt.system('physics', stepWorld, sid);
  },
};
