// gameplay.vision.mode: a sense overlay (detective vision, witcher senses, scan
// visor). The `sense` action toggles it (after a cooldown); while active it
// reveals entities within range that carry one of the configured tags (in
// components.tags, components.vision.tags, an archetype tag, or a component of
// that name), records them as scanned, can drain a resource, and can end by
// itself after `sec`. Renderers read the revealed set from the `vision` service.
import { frames, distance, resolveWho, service, err } from './combat-lib.js';

const KEY = 'gameplay.vision.mode';

export default {
  id: KEY,
  card: {
    intent: 'Sense/detective vision: toggle an overlay that reveals and records tagged entities (traces, clues, weak points, herbs) within range, with cooldown, optional duration and resource drain.',
    views: ['any'],
    params: {
      range: { type: 'number', default: 40, min: 5, max: 200, unit: 'units' },
      tags: { type: 'list', of: { type: 'string' }, default: [], effect: 'tags that are revealed; empty reveals every entity with a vision component' },
      cooldown: { type: 'number', default: 1, min: 0, max: 120, unit: 's' },
      sec: { type: 'number', default: 0, min: 0, max: 600, unit: 's', effect: 'the mode ends by itself after this long (0 = until toggled off)' },
      drain: { type: 'object', fields: { resource: { type: 'string', required: true }, perSec: { type: 'number', default: 5, min: 0 } }, effect: 'resource drained while active; empty ends the mode' },
      scanEvery: { type: 'number', default: 0.25, min: 0.02, max: 5, unit: 's' },
    },
    provides: { events: ['scan', 'scanned', 'scanned:*', 'vision_on', 'vision_off'], vars: ['vision.active', 'vision.revealed'], services: ['vision'], actions: ['sense'] },
  },
  logic(logic) {
    logic.predicate('scanned', { test: (p, rt) => {
      const s = rt.store(KEY).scanned || {}, id = p.scanned;
      if (s[id] !== undefined) return true;
      return Object.values(rt.store(KEY).info || {}).some(x => x.archetype === id || x.tags.includes(id));
    } });
  },
  validate(config) {
    return new Set(config.tags).size !== config.tags.length ? [err('vision_tags_duplicate', 'with.tags', 'tags must be unique')] : [];
  },
  install(rt, config) {
    const S = () => { const s = rt.store(KEY); s.active ??= false; s.cd ??= 0; s.t ??= 0; s.scanned ??= {}; s.info ??= {}; s.revealed ??= []; return s; };
    const tagsOf = e => { const c = e.components; return [...new Set([...(c.tags || []), ...(c.vision?.tags || []), ...(rt.archetype(e.archetype)?.tags || []), ...Object.keys(c).filter(k => config.tags.includes(k))])]; };
    const matches = e => { const t = tagsOf(e); return config.tags.length ? t.some(x => config.tags.includes(x)) : Boolean(e.components.vision); };
    const scan = () => {
      const s = S(), p = rt.player(); if (!p) return 0;
      const found = Object.values(rt.state.entities).filter(e => e.id !== p.id && e.space === p.space && matches(e) && distance(rt, p, e) <= config.range).map(e => e.id).sort();
      for (const id of found) if (s.scanned[id] === undefined) { const e = rt.entity(id); s.scanned[id] = rt.state.frame; s.info[id] = { archetype: e.archetype, tags: tagsOf(e) }; rt.emitTyped('scanned', e.archetype, { who: id, tags: tagsOf(e) }); }
      s.revealed = found; rt.state.vars['vision.revealed'] = found.length;
      return found.length;
    };
    const off = reason => { const s = S(); if (!s.active) return; s.active = false; s.revealed = []; s.cd = frames(config.cooldown); rt.state.vars['vision.active'] = 0; rt.state.vars['vision.revealed'] = 0; rt.emit('vision_off', { reason }); };
    const on = () => { const s = S(); if (s.active || s.cd > 0) return false; s.active = true; s.t = 0; rt.state.vars['vision.active'] = 1; rt.emit('vision_on', {}); rt.emit('scan', { count: scan() }); return true; };
    rt.provide('vision', { active: () => S().active, revealed: () => S().revealed.slice(), scanned: id => S().scanned[id] !== undefined, on, off });
    rt.action('sense', (v, rt) => { if (S().active) off('toggle'); else on(); });
    rt.system('late', rt => {
      const s = S();
      if (!s.active) { if (s.cd > 0) s.cd--; rt.state.vars['vision.active'] = 0; return; }
      s.t++;
      if (config.sec && s.t >= frames(config.sec)) { off('timeout'); return; }
      if (config.drain) { const r = service(rt, 'resources'), p = rt.player(); if (r && p) { r.drain(p, config.drain.resource, config.drain.perSec); if (r.get(p, config.drain.resource) <= 0) { off('empty'); return; } } }
      if (s.t % Math.max(1, frames(config.scanEvery)) === 0) scan();
    }, KEY);
  },
};
export { resolveWho };
