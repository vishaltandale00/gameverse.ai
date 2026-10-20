// gameplay.combat.cover: cover snapping and cover protection for shooters and
// tactics. The `cover` action snaps the player to the nearest solid cell within
// snapRange (from the space's occupancy coverAt, or raycasts) and remembers the
// wall direction; NPCs can set components.cover themselves. Ranged hits from the
// covered side lose `reduction` of their damage at half cover and are stopped at
// full cover; entities out of snapped cover still get the space's los cover level.
import { boxOf, centerOf, v3, add, sub, mul, norm, dot, len, posOf, like, spaceOf, resolveWho, intercept, err } from './combat-lib.js';

const KEY = 'gameplay.combat.cover';

export default {
  id: KEY,
  card: {
    intent: 'Cover: snap to nearby walls, and ranged attacks from the covered side deal reduced damage at half cover and none at full cover (from the space los/coverAt cover levels).',
    views: ['3p', 'td', 'iso', 'board'],
    params: {
      reduction: { type: 'number', default: 0.5, min: 0, max: 1, effect: 'damage removed by half cover' },
      fullBlocks: { type: 'boolean', default: true, effect: 'full cover stops the hit entirely' },
      snapRange: { type: 'number', default: 2, min: 0.1, max: 20, unit: 'units' },
      sources: { type: 'list', of: { type: 'string', options: ['projectile', 'blast', 'aim', 'melee', 'effect'] }, default: ['projectile', 'aim'], effect: 'hit sources cover protects against' },
      leaveDist: { type: 'number', default: 0.75, min: 0, max: 20, unit: 'units', effect: 'moving this far from the snap point leaves cover' },
    },
    provides: { events: ['cover_enter', 'cover_exit', 'cover_blocked', 'cover_hit'], actions: ['cover'] },
    requires: { primitives: ['gameplay.combat.health'], capabilities: ['raycast'] },
  },
  logic(logic) {
    logic.predicate('in_cover', { test: (p, rt, c) => { const e = resolveWho(rt, p.in_cover === true ? undefined : p.in_cover ?? p.who, c); return Boolean(e?.components.cover?.in); } });
  },
  validate(config) {
    return config.sources.length ? [] : [err('cover_sources_empty', 'with.sources', 'cover must protect against at least one hit source')];
  },
  install(rt, config) {
    // Probe along the ground plane: x/y for 2D spaces (or flat test spaces), x/z for 3D.
    const flat = e => (Array.isArray(e.at) && e.at.length === 2) || (spaceOf(rt, e)?.size?.[2] ?? 2) <= 1;
    const dirsOf = e => (flat(e) ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] : [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]);
    const find = e => {
      const api = spaceOf(rt, e), p = posOf(e); if (!api?.raycast || !p) return null;
      const from = centerOf(rt, e), half = mul(sub(boxOf(rt, e).max, boxOf(rt, e).min), 0.5);
      let best = null;
      for (const d of dirsOf(e)) {
        const r = api.raycast(like(e.at, from), d, config.snapRange + Math.abs(dot(half, d)));
        if (r.hit === 'cell' && (!best || r.dist < best.dist)) {
          const cell = r.cell ?? v3(r.at).map(Math.floor);
          const level = api.coverAt ? api.coverAt(cell, d) || 1 : 1;
          const gap = Math.max(0, r.dist - Math.abs(dot(half, d)) - 0.01);
          best = { dist: gap, dir: d, level, at: add(p, mul(d, gap)) };
        }
      }
      return best;
    };
    const enter = e => {
      const c = find(e); if (!c) return false;
      const api = spaceOf(rt, e); if (api.setPos && c.dist > 0.01) api.setPos(e, like(e.at, c.at), rt);
      e.components.cover = { in: true, dir: c.dir, level: c.level, at: posOf(e) };
      rt.emit('cover_enter', { who: e.id, level: c.level }); return true;
    };
    const exit = (e, reason = 'manual') => { if (!e.components.cover?.in) return; e.components.cover.in = false; rt.emit('cover_exit', { who: e.id, reason }); };
    rt.action('cover', (v, rt) => { const p = rt.player(); if (!p) return; if (p.components.cover?.in) exit(p); else enter(p); });
    intercept(rt, 60, (d, hit) => {
      if (!config.sources.includes(hit.source)) return hit;
      const a = hit.by ? rt.entity(hit.by) : null, pa = posOf(a), pd = posOf(d);
      let level = 0;
      const c = d.components.cover;
      if (c?.in && pa && pd && dot(norm(sub(pa, pd)), v3(c.dir)) > 0.2) level = c.level ?? 1;
      else if (pa && pd && spaceOf(rt, d)?.los) level = spaceOf(rt, d).los(a.at, d.at).cover ?? 0;
      if (!level) return hit;
      if (level >= 2 && config.fullBlocks) { rt.emit('cover_blocked', { who: d.id, by: hit.by ?? null }); return { cancel: true, reason: 'cover' }; }
      rt.emit('cover_hit', { who: d.id, by: hit.by ?? null, level });
      return { ...hit, amount: hit.amount * (1 - config.reduction) };
    }, KEY);
    rt.system('late', rt => {
      for (const e of Object.values(rt.state.entities)) { const c = e.components.cover; if (c?.in && posOf(e) && len(sub(posOf(e), v3(c.at))) > config.leaveDist) exit(e, 'moved'); }
    }, KEY);
  },
};
