// gameplay.ai.crowd: ambient pedestrians. They spawn around the player (density
// by hour), stroll the road graph's sidewalks corner to corner (or wander
// reachable ground near where they appeared when there are no roads), keep
// apart from each other and the player, and panic on gunfire, crime or
// explosions: they run from the source, then go back to strolling. They move
// by steering intents (components.steer / moveTo), carried out by the ai
// locomotion or a move.* primitive. Crime witnessing is gameplay.wanted's job
// (crowd members have ai perception, so they can witness).
import { v3, sub, add, mul, len, norm, r6, round6, upAt, planar, weighted, onEvents, dead, randomPoint, ensureLocomotion, spaceOf, between } from './ai-lib.js';
import { roadGraph, sidewalks } from './ai-lib-roads.js';

const ID = 'gameplay.ai.crowd';
const st = rt => rt.store(ID);
const n = (d, extra = {}) => ({ type: 'number', default: d, ...extra });

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['crowd_panic'] },
    intent: 'Ambient pedestrians: spawn around the player by density and hour, stroll sidewalks of the road graph (or wander nearby ground), keep personal space, and panic away from gunfire/crime/explosions before resuming.',
    views: ['3p', 'td', 'iso'],
    params: {
      density: n(0.5, { min: 0, max: 1 }), maxPeds: { type: 'integer', default: 30, min: 0, max: 500 },
      archetypes: { type: 'list', min: 1, required: true, of: { type: 'object', fields: { archetype: { type: 'ref', to: 'archetype', required: true }, weight: n(1, { min: 0 }) } } },
      speed: n(1.4, { min: 0, effect: 'walking speed when the archetype has no ai.speed' }), runFactor: n(2.4, { min: 1 }),
      spawnRadius: { type: 'list', of: { type: 'number', min: 0 }, default: [15, 60], min: 2, max: 2 }, despawnRadius: n(90, { min: 1 }),
      wanderRadius: n(20, { min: 1, effect: 'roam radius without a road graph' }), personal: n(0.8, { min: 0, effect: 'personal-space radius' }),
      panic: { type: 'boolean', default: true }, panicEvents: { type: 'list', of: { type: 'string' }, default: ['shots_fired', 'fired', 'explosion', 'crime', 'defeated'] },
      panicRadius: n(30, { min: 0 }), panicSec: n(8, { min: 0 }),
      byHour: { type: 'list', default: [], of: { type: 'object', fields: { from: n(0, { min: 0, max: 24 }), to: n(24, { min: 0, max: 24 }), density: n(1, { min: 0, max: 1 }) } } },
    },
    provides: { events: ['crowd_spawn', 'crowd_panic'], vars: ['crowd.peds'] },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
  },
  validate(config) {
    const errors = [];
    if (config.spawnRadius[0] > config.spawnRadius[1]) errors.push({ code: 'param_range', path: 'spawnRadius', message: 'min above max' });
    if (config.despawnRadius < config.spawnRadius[1]) errors.push({ code: 'crowd_despawn_radius', path: 'despawnRadius', message: 'despawnRadius must be at least the outer spawn radius' });
    return errors;
  },
  install(rt, config) {
    ensureLocomotion(rt);
    rt.on('despawn', ({ id }, rt) => { const s = st(rt); if (s.peds) delete s.peds[id]; });
    if (config.panic) onEvents(rt, config.panicEvents, (name, data, rt) => {
      const src = Array.isArray(data.at) ? v3(data.at) : rt.entity(data.by ?? data.who)?.at; if (!src) return;
      const s = st(rt); let k = 0;
      for (const [id, q] of Object.entries(s.peds || {})) { const e = rt.entity(id); if (e && len(sub(e.at, src)) <= config.panicRadius) { q.panic = round6(rt.state.time + config.panicSec); q.from = r6(v3(src)); k++; } }
      if (k) rt.emit('crowd_panic', { at: r6(v3(src)), peds: k, cause: name });
    });
    rt.system('ai', rt => tick(rt, config), ID);
  },
};

function densityNow(rt, config) {
  const h = rt.state.vars['time.hour'];
  const m = Number.isFinite(h) ? config.byHour.find(b => (b.from <= b.to ? h >= b.from && h < b.to : h >= b.from || h < b.to)) : null;
  return config.density * (m ? m.density : 1);
}
const walksOf = (rt, G, up) => { const c = rt.caches.aiCrowdWalks; if (c?.G === G) return c.walks; const walks = []; for (const e of G.edges.values()) for (const w of sidewalks(e, up)) walks.push({ ...w, edge: e.id, from: e.from, to: e.to }); rt.caches.aiCrowdWalks = { G, walks }; return walks; };
function pointAlong(w, s) { const c = w.cum, d = Math.max(0, Math.min(w.length, s)); let i = 1; while (i < c.length - 1 && c[i] < d) i++; const a = w.points[i - 1], b = w.points[i], t = (d - c[i - 1]) / ((c[i] - c[i - 1]) || 1); return r6(add(a, mul(sub(b, a), t))); }

function tick(rt, config) {
  const p = rt.player(); if (!p) return;
  const api = spaceOf(rt, p); if (!api) return;
  const up = upAt(api, p.at), G = roadGraph(rt, { spaceId: p.space, up }), walks = G ? walksOf(rt, G, up) : [];
  const s = st(rt); s.peds ??= {};
  for (const id of Object.keys(s.peds)) { const e = rt.entity(id); if (!e || dead(e) || e.space !== p.space || len(sub(e.at, p.at)) > config.despawnRadius) { delete s.peds[id]; if (e && !dead(e)) rt.despawn(id); } }
  if (Object.keys(s.peds).length < Math.round(config.maxPeds * densityNow(rt, config))) spawnPed(rt, config, api, p, walks);
  const peds = Object.entries(s.peds).map(([id, q]) => ({ id, q, e: rt.entity(id) })).filter(x => x.e);
  for (const x of peds) walk(rt, config, api, x, peds, walks, up);
  rt.state.vars['crowd.peds'] = peds.length;
}

function spawnPed(rt, config, api, p, walks) {
  const [lo, hi] = config.spawnRadius;
  for (let tries = 0; tries < 6; tries++) {
    let at, w = null, sAt = 0;
    if (walks.length) { w = Math.floor(rt.random() * walks.length); sAt = round6(rt.random() * walks[w].length); at = pointAlong(walks[w], sAt); }
    else { at = randomPoint(rt, api, p.at, hi, 'auto'); if (typeof api.getCell === 'function' && api.getCell(at)) continue; if (typeof api.path === 'function' && !api.path(at, p.at)) continue; }
    const d = len(sub(at, p.at)); if (d < lo || d > hi) continue;
    const pick = weighted(rt, config.archetypes); if (!pick) return;
    const body = rt.archetype(pick.archetype)?.components?.body, upv = upAt(api, at);
    const place = upv && (api.anchor ?? 'center') === 'center' ? r6(add(at, mul(upv, (body?.size?.[1] ?? 0) / 2))) : at;
    const e = rt.spawn(pick.archetype, { space: p.space, at: place, components: { crowdAgent: true } });
    st(rt).peds[e.id] = { walk: w, s: sAt, dir: rt.random() < 0.5 ? 1 : -1, home: r6(v3(at)), panic: 0, from: null, goal: null };
    rt.emit('crowd_spawn', { who: e.id, archetype: pick.archetype });
    return;
  }
}

function walk(rt, config, api, { id, q, e }, peds, walks, up) {
  const c = e.components, speed = c.ai?.speed ?? config.speed, now = rt.state.time;
  // Personal space: repulsion from nearby peds and the player.
  let push = [0, 0, 0];
  for (const o of [...peds.map(x => x.e), rt.player()]) {
    if (!o || o === e || o.space !== e.space) continue;
    const d = sub(e.at, o.at), l = len(planar(api, e.at, d));
    if (l > 1e-6 && l < config.personal * 2) push = add(push, mul(norm(planar(api, e.at, d)), (config.personal * 2 - l) / (config.personal * 2)));
  }
  if (q.panic > now && q.from) {
    let away = planar(api, e.at, sub(e.at, q.from)); if (len(away) < 1e-6) away = [1, 0, 0];
    delete c.moveTo; c.steer = { dir: r6(norm(add(norm(away), push))), speed: round6(speed * config.runFactor), run: true, by: 'ai' };
    q.resnap = true; return;
  }
  if (q.walk != null && walks[q.walk]) {
    let w = walks[q.walk];
    if (q.resnap) { // back from panic: join the nearest sidewalk point
      let best = null; for (let i = 0; i < walks.length; i++) for (let k = 0; k < walks[i].points.length; k++) { const dd = len(sub(walks[i].points[k], e.at)); if (!best || dd < best.d) best = { i, s: walks[i].cum[k], d: dd }; }
      if (best) { q.walk = best.i; q.s = best.s; w = walks[q.walk]; } q.resnap = false;
    }
    // A carrot along the sidewalk: it advances while the walker keeps up with it.
    if (len(planar(api, e.at, sub(pointAlong(w, q.s), e.at))) < 1) q.s = round6(q.s + q.dir * speed * rt.dt);
    const target = pointAlong(w, q.s + q.dir * 0.8), to = planar(api, e.at, sub(target, e.at));
    if (q.s <= 0 || q.s >= w.length) {
      // Corner: carry on along another sidewalk meeting this end (no instant U-turn unless a dead end).
      const end = q.s <= 0 ? w.points[0] : w.points.at(-1);
      const options = walks.map((x, i) => ({ x, i })).filter(({ x, i }) => i !== q.walk && (len(sub(x.points[0], end)) < 4 || len(sub(x.points.at(-1), end)) < 4));
      const pick = options.length ? options[Math.floor(rt.random() * options.length)] : null;
      if (pick) { const atStart = len(sub(pick.x.points[0], end)) < len(sub(pick.x.points.at(-1), end)); q.walk = pick.i; q.dir = atStart ? 1 : -1; q.s = atStart ? 0 : pick.x.length; }
      else { q.dir = -q.dir; q.s = Math.max(0, Math.min(w.length, q.s)); }
    }
    const dir = len(to) > 1e-6 ? norm(to) : [0, 0, 0];
    delete c.moveTo; c.steer = { dir: r6(norm(add(dir, mul(push, 0.8)))), speed: round6(speed), by: 'ai' };
    return;
  }
  // No roads: wander reachable ground near home with pauses.
  if (q.wait > now) { delete c.steer; delete c.moveTo; return; }
  if (!q.goal || len(planar(api, e.at, sub(q.goal, e.at))) < 0.3) {
    if (q.goal) { q.wait = round6(now + between(rt, 1, 4)); q.goal = null; delete c.moveTo; return; }
    q.goal = randomPoint(rt, api, q.home, config.wanderRadius, 'auto');
  }
  delete c.steer; c.moveTo = { at: q.goal, zone: null, run: false, speed, by: 'ai' };
}
