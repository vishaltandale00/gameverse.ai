// gameplay.portal: placeable linked portals (Portal). A portal gun raycasts
// to a surface; valid surfaces (optionally only some cell ids) take a portal of
// that colour, replacing the previous one. Anything with a body moving into a
// portal comes out of its partner with its velocity rotated from the entry
// face to the exit face, so speed is conserved ("speedy thing goes in, speedy
// thing comes out"). Fixed portal pairs can be authored too.
import { ENTITY_KINDS } from '../../kernel/params.js';
import { err, has, spaceOf, r6, r6v, v3, add, sub, mul, dot, len, norm, cross, matchesAny, sortedEntities, cellKey } from './modes-lib-util.js';

const ID = 'gameplay.portal';

/** Rotation taking unit vector a onto unit vector b (Rodrigues), applied to v. */
export function rotateOnto(v, a, b) {
  const c = dot(a, b);
  if (c > 1 - 1e-9) return v.slice();
  if (c < -1 + 1e-9) { // opposite: rotate 180 degrees about any axis perpendicular to a
    const helper = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], k = norm(cross(a, helper));
    return sub(mul(k, 2 * dot(k, v)), v);
  }
  const k = norm(cross(a, b)), s = Math.sqrt(1 - c * c);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

export default {
  id: ID,
  card: {
    loop: { verbs: ['fire_portal', 'close_portals'], progress: ['portal_placed', 'portal_entered'] },
    intent: 'Placeable linked portals: fire a portal of each colour onto valid surfaces by raycast; bodies entering one exit the other with momentum rotated to the exit face (speed conserved), cooldown against ping-pong, fixed authored pairs, fizzles on invalid surfaces.',
    views: ['1p', '3p', 'side'],
    params: {
      colors: { type: 'list', of: { type: 'string' }, default: ['blue', 'orange'], min: 2, max: 2, effect: 'the two linked colours' },
      range: { type: 'number', default: 64, min: 1, max: 10000, effect: 'portal gun range' },
      radius: { type: 'number', default: 0.8, min: 0.1, max: 20, effect: 'portal opening radius' },
      depth: { type: 'number', default: 0.6, min: 0.05, max: 10, effect: 'how close to the face a body must come to pass' },
      surfaces: { type: 'list', of: { type: 'string' }, default: [], effect: 'cell ids portals stick to (empty = any solid surface)' },
      minExitSpeed: { type: 'number', default: 0, min: 0, max: 1000, effect: 'bodies leave at least this fast along the exit normal' },
      cooldownSec: { type: 'number', default: 0.25, min: 0, max: 10, unit: 's' },
      shooters: { type: 'list', of: { type: 'string', selects: ENTITY_KINDS }, default: ['player'], effect: 'who can fire portals (ids/archetypes/tags)' },
      through: { type: 'list', of: { type: 'string', selects: ENTITY_KINDS }, default: [], effect: 'who can pass (empty = anything with a body)' },
      fixed: { type: 'list', default: [], of: { type: 'object', fields: { color: { type: 'string', required: true }, at: { type: 'list', of: { type: 'number' }, min: 2, max: 3, required: true, effect: 'position in space coordinates' }, normal: { type: 'list', of: { type: 'number' }, min: 2, max: 3, required: true, effect: 'the face direction, a non-zero vector' } } }, effect: 'portals placed at start' },
    },
    provides: { events: ['portal_placed', 'portal_fizzle', 'portal_entered', 'portal_closed'], actions: ['fire_portal', 'close_portals'] },
    actionSpace: { fire_portal: { kind: 'impulse', params: { yaw: { min: -3.1416, max: 3.1416 }, pitch: { min: -1.5, max: 1.5 } } } },
    requires: { capabilities: ['position', 'raycast'] },
    reads: [],
    rules: {
      portal_colors: { fields: ['colors', 'fixed[].color'], message: 'the two colors differ, and each fixed portal\'s color is one of them' },
      portal_normal: { fields: ['fixed[].normal'], message: 'a fixed portal\'s normal is a non-zero vector', example: { fixed: [{ color: 'blue', at: [0, 0, 0], normal: [0, 0, 0] }] } },
    },
  },
  validate(config) {
    const errors = [];
    if (new Set(config.colors).size !== 2) errors.push(err('portal_colors', 'with.colors', 'portal colours must differ'));
    config.fixed.forEach((f, i) => {
      if (!config.colors.includes(f.color)) errors.push(err('portal_colors', `with.fixed[${i}].color`, `colour '${f.color}' is not one of ${config.colors.join('|')}`));
      if (!Array.isArray(f.normal) || !(len(v3(f.normal)) > 0)) errors.push(err('portal_normal', `with.fixed[${i}].normal`, 'normal must be a non-zero vector'));
    });
    return errors;
  },
  install(rt, config, instance) {
    const sid = instance.space ?? rt.doc.spaces[0].id, CD = Math.round(config.cooldownSec * 60);
    const st = () => { const s = rt.store(ID); if (!s.portals) { s.portals = {}; for (const f of config.fixed) s.portals[f.color] = { at: r6v(v3(f.at)), normal: r6v(norm(v3(f.normal))), space: sid }; } s.cd ??= {}; return s; };
    const other = c => config.colors[1 - config.colors.indexOf(c)];
    const center = (e, api) => { const sz = v3(e.components.body?.size || [1, 1, 1]); return api.anchor === 'center' ? v3(e.at) : add(v3(e.at), mul(sz, 0.5)); };
    const fromCenter = (c, e, api) => { const sz = v3(e.components.body?.size || [1, 1, 1]); return api.anchor === 'center' ? c : sub(c, mul(sz, 0.5)); };
    const aimOf = (e, v) => {
      if (v && Array.isArray(v.dir)) return norm(v3(v.dir));
      if (v && (v.yaw !== undefined || v.pitch !== undefined)) { const y = v.yaw ?? 0, p = v.pitch ?? 0; return [Math.cos(p) * Math.cos(y), Math.sin(p), Math.cos(p) * Math.sin(y)]; }
      const f = e.components.body?.facing; return Array.isArray(f) ? norm(v3(f)) : [f === -1 ? -1 : 1, 0, 0];
    };
    function fire(s, e, color, v) {
      const api = spaceOf(rt, e); if (!has(api, 'raycast')) return;
      const from = center(e, api), dir = aimOf(e, v), hit = api.raycast(from, dir, config.range);
      const block = hit.cell && has(api, 'getCell') ? api.getCell(hit.cell) : null;
      if (hit.hit !== 'cell' || !hit.normal || (config.surfaces.length && !config.surfaces.includes(block))) { rt.emit('portal_fizzle', { who: e.id, color, at: hit.at ?? null }); return; }
      const n = norm(v3(hit.normal).map(Math.round)).map(x => x + 0);
      // Centre the portal on the struck face of the cell.
      const at = hit.cell ? add(add(v3(hit.cell), [0.5, 0.5, 0.5]), mul(n, 0.5)) : v3(hit.at);
      const o = s.portals[other(color)];
      if (o && o.space === e.space && len(sub(o.at, at)) < config.radius * 2 && dot(o.normal, n) > 0.99) { rt.emit('portal_fizzle', { who: e.id, color, reason: 'overlap' }); return; }
      s.portals[color] = { at: r6v(at), normal: n, space: e.space, cell: hit.cell ? cellKey(hit.cell) : null };
      rt.emit('portal_placed', { who: e.id, color, at: s.portals[color].at, normal: n });
    }
    rt.action('fire_portal', v => {
      const s = st(), color = typeof v === 'string' ? v : v?.color ?? config.colors[0];
      if (!config.colors.includes(color)) return;
      const who = rt.player(); if (who && matchesAny(who, config.shooters)) fire(s, who, color, typeof v === 'object' ? v : null);
    });
    rt.action('close_portals', () => { const s = st(); s.portals = {}; rt.emit('portal_closed', {}); });

    rt.system('physics', rt => {
      const s = st(), a = s.portals[config.colors[0]], b = s.portals[config.colors[1]];
      for (const id of Object.keys(s.cd)) if (--s.cd[id] <= 0) delete s.cd[id];
      // Portals on cells that were removed close.
      for (const [c, p] of Object.entries(s.portals)) if (p.cell) { const api = rt.space(p.space); if (has(api, 'getCell') && api.getCell(p.cell.split(',').map(Number)) == null) { delete s.portals[c]; rt.emit('portal_closed', { color: c }); } }
      if (!a || !b) return;
      for (const e of sortedEntities(rt)) {
        if (s.cd[e.id] || !Array.isArray(e.at) || !e.components.body || (config.through.length && !matchesAny(e, config.through))) continue;
        for (const [inC, P, Q] of [[config.colors[0], a, b], [config.colors[1], b, a]]) {
          if (e.space !== P.space) continue;
          const api = rt.space(e.space), c = center(e, api), d = sub(c, P.at), along = dot(d, P.normal), lateral = len(sub(d, mul(P.normal, along)));
          const vel = v3(e.components.body.vel || [0, 0, 0]), into = dot(vel, P.normal) < 0;
          if (lateral > config.radius || along > config.depth || along < -config.depth || !into) continue;
          // Map the velocity: entry direction (-nP) onto exit direction (+nQ).
          let out = rotateOnto(vel, mul(P.normal, -1), Q.normal);
          const alongQ = dot(out, Q.normal);
          if (alongQ < config.minExitSpeed) out = add(out, mul(Q.normal, config.minExitSpeed - alongQ));
          const sz = v3(e.components.body.size || [1, 1, 1]), clear = Math.max(...sz) / 2 + 0.05;
          const exitC = add(Q.at, mul(Q.normal, clear + Math.max(0, along)));
          const target = fromCenter(exitC, e, rt.space(Q.space)).slice(0, e.at.length);
          if (Q.space !== e.space) rt.moveToSpace(e, Q.space, r6v(target)); else api.setPos(e, r6v(target), rt);
          e.components.body.vel = r6v(out).slice(0, Math.max(e.components.body.vel?.length ?? 3, 2));
          s.cd[e.id] = CD;
          rt.emit('portal_entered', { who: e.id, from: inC, to: other(inC), speed: r6(len(vel)), exit: r6v(out) });
          break;
        }
      }
    }, ID);
  },
};
