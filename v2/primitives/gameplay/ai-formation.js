// gameplay.ai.formation: enemy formations ported from the shmup kit's fixed
// mode (v2/kits/shmup/game.js formationStep/launchDive/diveStep/entryPath):
// waves fly in on spline entry paths and take slots; a Galaga formation sways
// and breathes, an Invaders formation marches with the step-time formula
// max(3, round(4 + 36·alive/used)) frames, reverses at the edges and drops;
// leaders peel off on curved dives with up to two escorts of their kind and
// rejoin. Positions live in a 2D plane of the space, in the kit's screen
// convention (y grows toward the player); `bounds` sets the playfield.
import { ID_PATTERN } from '../../kernel/sections.js';
import { r6, round6, clamp, steerAng, spaceOf, continuous, moverOwned, dead, between, cleanupOnDespawn, add, sub, mul, norm, len, dot, v3 } from './ai-lib.js';
import { followPath } from './ai-motion.js';

const ID = 'gameplay.ai.formation';
const ENTRIES = ['left-arc', 'right-arc', 'loop', 'top-line', 'v-formation', 'sides'];
const DIVES = ['dive', 'swoop', 'zigzag', 'chase', 'none'];
const n = (d, extra = {}) => ({ type: 'number', ...(d === undefined ? {} : { default: d }), ...extra });
const st = rt => rt.store(ID);

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['formation_join', 'dive', 'formation_clear'] },
    // It moves every entity with a `formation` component: slots, marching and dives.
    drives: { control: 'ai', components: ['formation'], movement: true, events: ['dive', 'march'] },
    intent: 'Shmup formations: waves enter on spline paths into slots; Galaga sway/breathing or Invaders march-step (faster as the formation thins, reverse and drop at edges, overrun line); timed dives by a leader with escorts (dive, swoop, zigzag, homing chase) that rejoin; a `formation_front` predicate lets only column fronts fire.',
    views: ['side', 'td'],
    params: {
      bounds: { type: 'object', required: true, fields: { min: { type: 'list', of: { type: 'number' }, min: 2, required: true }, max: { type: 'list', of: { type: 'number' }, min: 2, required: true } }, effect: 'playfield rectangle in the plane; kit paths scale from 300×400' },
      plane: { type: 'string', default: 'xy', options: ['xy', 'xz'] },
      formations: { type: 'list', min: 1, required: true, of: { type: 'object', fields: {
        id: { type: 'string', pattern: ID_PATTERN, required: true }, cols: { type: 'integer', default: 10, min: 1, max: 32 }, rows: { type: 'integer', default: 4, min: 1, max: 16 },
        spacing: { type: 'list', of: { type: 'number' }, default: [24, 22], min: 2, max: 2 }, top: n(62, { effect: 'first row distance from the top of the bounds' }),
        march: { type: 'boolean', default: false, effect: 'Invaders march instead of Galaga sway + breathing' },
        sway: n(26, { min: 0 }), swayRate: n(0.018, { min: 0, unit: 'rad/frame' }), breathe: { type: 'boolean', default: true },
        marchStep: n(6, { min: 0 }), marchDrop: n(10, { min: 0 }), edge: n(12, { min: 0 }),
        overrun: n(14, { min: 0, effect: 'a settled member this close above the player overruns it' }),
        dives: { type: 'boolean', default: true }, escorts: { type: 'integer', default: 2, min: 0, max: 8 }, aggression: n(1, { min: 0.1, effect: 'dive frequency multiplier (difficulty fire-rate)' }),
        speed: n(120, { min: 1, effect: 'member speed (units/s); entries use max(150, 1.2×speed)' }),
      } } },
      waves: { type: 'list', default: [], of: { type: 'object', fields: {
        formation: { type: 'ref', to: 'formation', required: true }, archetype: { type: 'ref', to: 'archetype', required: true },
        count: { type: 'integer', default: 8, min: 1, max: 64 }, at: n(0, { min: 0, unit: 's' }), entry: { type: 'string', default: 'left-arc', options: ENTRIES },
        dive: { type: 'string', default: 'dive', options: DIVES, effect: 'how members of this wave dive' },
      } } },
    },
    provides: { events: ['formation_join', 'formation_full', 'march', 'dive', 'formation_overrun', 'formation_clear'] },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
    defines: [{ kind: 'formation', in: 'formations' }],
    rules: {
      formation_bounds: { fields: ['bounds.min', 'bounds.max'], message: 'bounds.max is above bounds.min in both plane axes' },
    },
  },
  logic(logic) {
    logic.predicate('formation_front', { test: (p, rt, c) => {
      const e = rt.resolve(p.who ?? 'self', c); const m = e?.components.formation; if (!m) return false;
      if (m.st !== 'formation' || m.slot < 0) return true; // diving or free movers are out front
      const f = rt.caches.formationCfg?.formations.find(x => x.id === m.formation); if (!f) return false;
      return !Object.values(rt.state.entities).some(o => o !== e && !dead(o) && o.components.formation?.formation === m.formation && o.components.formation.st === 'formation' && o.components.formation.slot % f.cols === m.slot % f.cols && o.components.formation.slot > m.slot);
    } });
  },
  validate(config) {
    const errors = [];
    const b = config.bounds; if (Array.isArray(b?.min) && Array.isArray(b?.max) && (b.max[0] <= b.min[0] || b.max[1] <= b.min[1])) errors.push({ code: 'formation_bounds', path: 'bounds', message: 'bounds need min < max in two axes' });
    return errors;
  },
  install(rt, config) {
    rt.caches.formationCfg = config;
    cleanupOnDespawn(rt, [ID]);
    rt.system('ai', rt => tick(rt, config), ID);
    rt.provide('formation', { slotPos: (id, slot) => slotPos(rt, config, id, slot), state: id => st(rt).f?.[id] ?? null });
  },
};

const P2 = config => (config.plane === 'xz' ? [[1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]]);
const to2 = (config, at) => { const [ax, bx] = P2(config); return [dot(at, ax), dot(at, bx)]; };
const to3 = (config, base, xy) => { const [ax, bx] = P2(config), b = v3(base); const off = sub(b, add(mul(ax, dot(b, ax)), mul(bx, dot(b, bx)))); return r6(add(off, add(mul(ax, xy[0]), mul(bx, xy[1])))); };
const dims = config => { const b = config.bounds; return { x0: b.min[0], y0: b.min[1], W: b.max[0] - b.min[0], H: b.max[1] - b.min[1] }; };

function fstate(rt, config, def) {
  const s = st(rt); s.f ??= {};
  if (!s.f[def.id]) { const { x0, y0, W } = dims(config); s.f[def.id] = { t: 0, x: x0 + W / 2, y: y0 + def.top, dir: 1, stepT: 1, frame: 0, used: 0, diveT: 160, breathe: def.march ? 0 : 0.2, full: false }; }
  return s.f[def.id];
}
function slotPos(rt, config, id, slot) {
  const def = config.formations.find(f => f.id === id), f = fstate(rt, config, def), c = slot % def.cols, r = Math.floor(slot / def.cols);
  const spread = def.march ? 1 : 1 + 0.07 * Math.sin(f.t * 0.05) * f.breathe;
  return [round6(f.x + (c - (def.cols - 1) / 2) * def.spacing[0] * spread), round6(f.y + r * def.spacing[1] * (def.march ? 1 : 1 + (spread - 1) * 0.6))];
}

function entryPath(config, def, entry, side, k, count, sp) {
  const { x0, y0, W, H } = dims(config), sx = W / 300, sy = H / 400;
  const mx = x => x0 + (side < 0 ? x * sx : W - x * sx), Y = y => y0 + y * sy;
  switch (entry) {
    case 'top-line': return [[sp[0], Y(-20)], [sp[0], Y(20)]];
    case 'v-formation': return [[x0 + W / 2 + side * 6 * sx, Y(-20)], [x0 + W / 2 + (k - (count - 1) / 2) * 16 * sx, Y(70)]];
    case 'loop': return [[mx(130), Y(-20)], [mx(140), Y(90)], [mx(90), Y(190)], [mx(40), Y(170)], [mx(60), Y(110)], [mx(120), Y(120)]];
    default: return [[mx(-20), Y(330)], [mx(50), Y(280)], [mx(110), Y(210)], [mx(120), Y(140)], [mx(80), Y(110)]];
  }
}

function tick(rt, config) {
  const s = st(rt), now = rt.state.time;
  s.queue ??= []; s.spawned ??= {};
  // Waves: queue each member with the kit's spacing (frames) along its entry path.
  config.waves.forEach((w, wi) => {
    if (s.spawned[wi] || now < w.at - 1e-9) return;
    s.spawned[wi] = true;
    const def = config.formations.find(f => f.id === w.formation), f = fstate(rt, config, def), cap = def.cols * def.rows;
    const dir0 = wi % 2 ? 1 : -1, gap = w.entry === 'top-line' || w.entry === 'v-formation' ? 3 : w.entry === 'sides' ? 5 : 8;
    for (let k = 0; k < w.count; k++) {
      const slot = f.used < cap ? f.used++ : -1;
      const side = w.entry === 'sides' ? (k % 2 ? 1 : -1) : w.entry === 'left-arc' ? -1 : w.entry === 'right-arc' ? 1 : dir0;
      s.queue.push({ d: Math.max(1, k * gap), wave: wi, slot, side, k });
    }
  });
  const keep = [];
  for (const q of s.queue) {
    if (--q.d > 0) { keep.push(q); continue; }
    const w = config.waves[q.wave], def = config.formations.find(f => f.id === w.formation);
    const sp = q.slot >= 0 ? slotPos(rt, config, def.id, q.slot) : [dims(config).x0 + dims(config).W / 2, dims(config).y0 + 80];
    const pts = entryPath(config, def, w.entry, q.side, q.k, w.count, sp);
    const p = rt.player(), space = p?.space ?? rt.doc.spaces[0].id;
    const e = rt.spawn(w.archetype, { space, at: to3(config, p?.at ?? [0, 0, 0], pts[0]), components: { formation: { formation: def.id, slot: q.slot, st: q.slot >= 0 ? 'enter' : 'free', dive: w.dive } } });
    ((s.agents ??= {})[e.id] = { path: { pts, i: 0, u: 0 }, ang: Math.PI / 2, sub: 0, subT: 0 });
  }
  s.queue = keep;
  for (const def of config.formations) formationStep(rt, config, def);
  for (const e of Object.values(rt.state.entities)) {
    const m = e.components.formation; if (!m || dead(e) || !continuous(e)) continue;
    const def = config.formations.find(f => f.id === m.formation); if (!def) continue;
    memberStep(rt, config, def, e, m);
  }
}

function members(rt, def) { return Object.values(rt.state.entities).filter(e => e.components.formation?.formation === def.id && !dead(e) && e.components.formation.slot >= 0); }

function formationStep(rt, config, def) {
  const f = fstate(rt, config, def), s = st(rt), { x0, W } = dims(config), p = rt.player();
  f.t++;
  const all = members(rt, def), settled = all.filter(e => e.components.formation.st === 'formation');
  const pending = s.queue.some(q => config.waves[q.wave].formation === def.id) || config.waves.some((w, i) => w.formation === def.id && !s.spawned[i]);
  const allIn = !pending && all.every(e => !['enter', 'join'].includes(e.components.formation.st));
  if (allIn && !f.full && all.length) { f.full = true; rt.emit('formation_full', { formation: def.id }); }
  if (f.full && !pending && !all.length && !f.cleared) { f.cleared = true; rt.emit('formation_clear', { formation: def.id }); }
  if (def.march) {
    if (--f.stepT <= 0) {
      f.stepT = Math.max(3, Math.round(4 + 36 * all.length / Math.max(1, f.used)));
      let lo = Infinity, hi = -Infinity;
      for (const e of settled) { const x = to2(config, e.at)[0]; lo = Math.min(lo, x); hi = Math.max(hi, x); }
      if (settled.length && ((f.dir > 0 && hi + def.marchStep > x0 + W - def.edge) || (f.dir < 0 && lo - def.marchStep < x0 + def.edge))) { f.dir = -f.dir; f.y = round6(f.y + def.marchDrop); }
      else f.x = round6(f.x + f.dir * def.marchStep);
      f.frame ^= 1;
      rt.emit('march', { formation: def.id, frame: f.frame, step: f.stepT });
    }
    if (p && !dead(p) && settled.some(e => to2(config, e.at)[1] + 8 >= to2(config, p.at)[1] - def.overrun)) {
      rt.emit('formation_overrun', { formation: def.id });
      f.y = round6(Math.max(dims(config).y0 + def.top, f.y - 90));
    }
  } else {
    f.x = round6(x0 + W / 2 + Math.sin(f.t * def.swayRate) * def.sway);
    if (def.breathe) f.breathe = round6(Math.min(1, f.breathe + (allIn ? 0.01 : 0)));
    if (f.t % 30 === 0) f.frame ^= 1;
  }
  // Dives: a leader (plus escorts of its kind beside it) peels off on a curved path.
  if (def.dives && p && !dead(p) && --f.diveT <= 0) {
    const frac = all.length / Math.max(1, f.used);
    f.diveT = Math.max(45, Math.round((130 - 70 * (1 - frac)) / def.aggression * (def.march ? 2.2 : 1) * between(rt, 0.8, 1.2)));
    const cands = settled.filter(e => (e.components.formation.dive ?? 'dive') !== 'none').sort((a, b) => a.components.formation.slot - b.components.formation.slot);
    if (cands.length) {
      const lead = cands[Math.floor(rt.random() * cands.length)], lp = to2(config, lead.at);
      launchDive(rt, config, def, lead, 0);
      let escorts = 0;
      for (const e of cands) { const q = to2(config, e.at); if (e !== lead && escorts < def.escorts && e.archetype === lead.archetype && Math.abs(q[0] - lp[0]) < 30 && Math.abs(q[1] - lp[1]) < 26) launchDive(rt, config, def, e, ++escorts); }
    }
  }
}

function launchDive(rt, config, def, e, escort) {
  const { x0, y0, W, H } = dims(config), pp = to2(config, rt.player().at), [ex, ey] = to2(config, e.at);
  const side = ex - x0 < W / 2 ? -1 : 1, tx = clamp(pp[0] + escort * side * 14, x0 + 20, x0 + W - 20), ty = pp[1];
  const style = e.components.formation.dive ?? 'dive';
  let pts;
  if (style === 'swoop') pts = [[ex, ey], [ex + side * 30, ey - 24], [ex + side * 50, ey + 24], [tx - side * 70, ty - 70], [tx, ty - 34], [tx + side * 60, ty - 80], [x0 + W - (ex - x0), y0 + 150], [ex, ey + 10]];
  else if (style === 'zigzag') pts = [[ex, ey], [ex + side * 20, ey - 20], [ex - side * 40, ey + 60], [ex + side * 50, ey + 130], [tx - 40, ey + 200], [tx + 40, y0 + H - 70], [tx, y0 + H + 40]];
  else pts = [[ex, ey], [ex + side * 28, ey - 26], [ex + side * 48, ey + 16], [(ex + tx) / 2, (ey + ty) / 2], [tx + side * 20, ty - 30], [tx - side * 30, y0 + H + 40]];
  e.components.formation.st = 'dive';
  st(rt).agents[e.id] = { path: { pts: pts.map(q => q.map(round6)), i: 0, u: 0 }, ang: Math.PI / 2, sub: style === 'chase' ? 1 : 0, subT: 0 };
  rt.emit('dive', { who: e.id, formation: def.id, escort, style });
}

function memberStep(rt, config, def, e, m) {
  const a = ((st(rt).agents ??= {})[e.id] ??= { ang: Math.PI / 2, sub: 0, subT: 0 });
  const { x0, y0, W, H } = dims(config), dt = rt.dt, speed = def.speed;
  let [x, y] = to2(config, e.at);
  const entrySp = Math.max(150, speed * 1.2);
  if (m.st === 'enter') { const [nx, ny, done] = followPath(a.path, entrySp, dt); x = nx; y = ny; if (done) m.st = m.slot >= 0 ? 'join' : 'free'; }
  else if (m.st === 'join') {
    const [sx, sy] = slotPos(rt, config, def.id, m.slot), d = Math.hypot(sx - x, sy - y), v = entrySp * dt;
    if (d <= v) { x = sx; y = sy; m.st = 'formation'; rt.emit('formation_join', { who: e.id, formation: def.id, slot: m.slot }); } else { x += (sx - x) / d * v; y += (sy - y) / d * v; }
  } else if (m.st === 'formation') [x, y] = slotPos(rt, config, def.id, m.slot);
  else if (m.st === 'dive') {
    const sp = Math.max(130, speed) * 1.1, p = rt.player(), pp = p && !dead(p) ? to2(config, p.at) : null;
    if (a.sub === 1) { // homing chase-dive, then straight down
      a.subT++;
      if (a.subT < 100 && pp) a.ang = steerAng(a.ang, Math.atan2(pp[1] - y, pp[0] - x), 2.4 * dt); else a.ang = steerAng(a.ang, Math.PI / 2, 2 * dt);
      a.ang = round6(a.ang); x += Math.cos(a.ang) * sp * dt; y += Math.sin(a.ang) * sp * dt;
      if (y > y0 + H + 30) { y = y0 - 24; x = slotPos(rt, config, def.id, m.slot)[0]; m.st = 'join'; }
    } else {
      const [nx, ny, done] = followPath(a.path, sp, dt); x = clamp(nx, x0 - 40, x0 + W + 40); y = ny;
      if (done) { if (y > y0 + H) { y = y0 - 24; x = slotPos(rt, config, def.id, m.slot)[0]; } m.st = 'join'; }
    }
  } else return;
  const api = spaceOf(rt, e); if (!api) return;
  const to = to3(config, e.at, [round6(x), round6(y)]);
  if (moverOwned(e)) { const d = sub(to, e.at); e.components.steer = { dir: r6(norm(d)), speed: round6(len(d) / dt), fly: true, by: 'ai' }; return; }
  api.setPos(e, to, rt);
}
