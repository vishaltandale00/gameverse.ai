// gameplay.combat.projectile: arrows, bolts, bullets, spells, bombs. Owns
// components.projectile (moving shots) and components.ranged (who can shoot what).
// Ballistics with gravity, pierce, homing, bounce, terrain stops by raycast,
// swept entity hits through the combat service, opposing-shot clashes, blasts
// (plus along open cells, or circle) with fuses and breakable cells, ammo
// (unlimited, per life, reloaded by events, or inventory items), draw/charge, and
// volley patterns (single, lanes, spread, laser, missile, ring, spiral, burst)
// with tiers. The shmup weapon set (shot, spread, laser, homing; WEAPON_DPS) is a
// preset. Other primitives fire through the `projectiles` service.
import { itemsData } from './items-lib.js';
import { boxOf, frames, v3, add, sub, mul, len, norm, dot, posOf, facingOf, spaceOf, statOf, hostile, teamOf, resolveWho, combat, service, overlapping, like, round, err, archetypes } from './combat-lib.js';

const KEY = 'gameplay.combat.projectile';
const PATTERNS = ['single', 'lanes', 'spread', 'laser', 'missile', 'ring', 'spiral', 'burst'];
const AMMO = ['unlimited', 'start', 'event', 'item'];
/** Shmup weapon damage per volley by tier (shot, spread, laser, homing), from the shmup kit. */
export const WEAPON_DPS = { shot: [1, 2, 3], spread: [2.1, 3.5, 4.9], laser: [1.3, 1.7, 2.2], homing: [1.6, 2.2, 2.8] };
/** Shmup presets in shmup pixels (scaled by the weapon's unitScale). Ported from the shmup kit fire(). */
export const PRESETS = {
  shot: { pattern: 'lanes', lanes: [[0], [-4, 4], [-6, 0, 6]], speed: 520, damage: 1, radius: 3, life: 2, rate: 8, maxTier: 3 },
  spread: { pattern: 'spread', counts: [3, 5, 7], spans: [11.46, 20.63, 28.65], speed: 520, damage: 0.7, radius: 3, life: 2, rate: 8, maxTier: 3 },
  laser: { pattern: 'laser', speed: 900, damage: 0.8, damagePerTier: 0.35, radius: 3, radiusPerTier: 1, pierce: -1, life: 2, rate: 8, maxTier: 3 },
  homing: { pattern: 'missile', lanes: [[0]], speed: 520, damage: 1, radius: 3, life: 2, rate: 8, maxTier: 3, missile: { every: 2, speed: 280, damage: 1.2, life: 2.5, homing: { turn: 343.8, range: 400, accel: 300, max: 420 } } },
};

const WEAPON = {
  id: { type: 'string', required: true },
  preset: { type: 'string', options: Object.keys(PRESETS) },
  pattern: { type: 'string', options: PATTERNS, default: 'single' },
  speed: { type: 'number', default: 20, min: 0, max: 1e5, unit: 'units/s' },
  damage: { type: 'number', default: 1, min: 0, max: 1e6 },
  type: { type: 'string' },
  rate: { type: 'number', default: 4, min: 0.01, max: 120, unit: 'volleys/s' },
  life: { type: 'number', default: 2, min: 0.01, max: 600, unit: 's' },
  radius: { type: 'number', default: 0.2, min: 0, max: 100, unit: 'units' },
  gravity: { type: 'number', default: 0, min: -1000, max: 1000, unit: 'units/s²' },
  spread: { type: 'number', default: 0, min: 0, max: 180, unit: 'deg', effect: 'random inaccuracy per shot' },
  count: { type: 'integer', default: 1, min: 1, max: 64, effect: 'shots per volley (spread, ring, spiral, burst)' },
  span: { type: 'number', default: 30, min: 0, max: 360, unit: 'deg', effect: 'spread fan width' },
  spin: { type: 'number', default: 12, min: -360, max: 360, unit: 'deg', effect: 'spiral rotation per volley' },
  burstGap: { type: 'number', default: 0.1, min: 0, max: 5, unit: 's' },
  lanes: { type: 'list', of: { type: 'list', of: { type: 'number' } }, effect: 'lane offsets per tier, e.g. [[0],[-4,4],[-6,0,6]]' },
  laneGap: { type: 'number', default: 1, min: 0, max: 100, effect: 'multiplier on lane offsets' },
  pierce: { type: 'integer', default: 0, min: -1, max: 1000, effect: 'extra targets a shot passes through; -1 = unlimited' },
  bounce: { type: 'integer', default: 0, min: 0, max: 100, effect: 'terrain bounces before the shot stops' },
  homing: { type: 'object', fields: { turn: { type: 'number', default: 180, unit: 'deg/s' }, range: { type: 'number', default: 20 }, accel: { type: 'number', default: 0 }, max: { type: 'number', default: 1e9 } } },
  blast: { type: 'object', fields: {
    shape: { type: 'string', options: ['circle', 'plus'], default: 'circle' }, range: { type: 'number', default: 3, min: 0, max: 100 }, fuse: { type: 'number', default: 0, min: 0, max: 60, unit: 's' },
    damage: { type: 'number' }, stunSec: { type: 'number', default: 0, min: 0, max: 60 }, breaks: { type: 'list', of: { type: 'string' }, default: [] }, onExpire: { type: 'boolean', default: true },
  } },
  ammo: { type: 'object', default: { from: 'unlimited' }, fields: {
    from: { type: 'string', options: AMMO, default: 'unlimited' }, count: { type: 'integer', default: 3, min: 0, max: 9999 }, max: { type: 'integer', default: 99, min: 1, max: 9999 },
    events: { type: 'list', of: { type: 'string' }, default: [] }, item: { type: 'ref', to: 'item' },
  } },
  draw: { type: 'number', default: 0, min: 0, max: 10, unit: 's', effect: 'hold fire this long for full power (bows); 0 fires on press' },
  minPower: { type: 'number', default: 0.3, min: 0, max: 1 },
  status: { type: 'ref', to: 'status' },
  knockback: { type: 'number', min: 0, max: 100 },
  archetype: { type: 'ref', to: 'archetype', effect: 'archetype spawned as the visible shot' },
  tiers: { type: 'list', default: [], of: { type: 'object', fields: {}, open: true }, effect: 'per-tier overrides (tier 1 = first entry)' },
  maxTier: { type: 'integer', default: 1, min: 1, max: 10 },
  unitScale: { type: 'number', default: 1, min: 1e-6, max: 1e6, effect: 'multiplier on preset speeds, sizes and lane offsets' },
  clash: { type: 'boolean', default: false, effect: 'cancels opposing clash shots hit for hit (fighting fireballs)' },
  plane: { type: 'string', options: ['auto', 'xy', 'xz'], default: 'auto' },
};

export default {
  id: KEY,
  card: {
    // What an entity carrying these components reads as on screen (graphics/flat-art.js roleOf; never its name).
    presents: { projectile: { role: 'projectile' } },
    // The player fires only with a weapon to fire: the instance's playerWeapon, a ranged component on the player's
    // archetype, or a ranged item the document has for it (runtime-lib-controls.js instanceVerbs).
    loop: { verbs: ['fire'], verbsOf: (config, doc) => { const hero = (doc?.content?.archetypes || []).find(a => a.id === doc?.player?.archetype); return config.playerWeapon || hero?.components?.ranged || (doc?.content?.items || []).some(i => i.ranged) ? ['fire'] : []; }, progress: ['fired', 'projectile_hit'] },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "archetypes", "component": "health", "kinds": ["enemy", "boss", "creature", "npc", "prop"], "min": 1, "placed": 3, "zones": 2, "why": "shots need targets with health, placed in the world", "example": {"id": "thornling", "kind": "enemy", "components": {"health": {"max": 6}, "touch": {"damage": 1}, "ai": {"brain": [{"do": "chase", "when": {"near": "player", "within": 6}}, {"do": "patrol", "range": 5}], "speed": 2.5}}}},
    ],
    // The player fires the first defined weapon when the document named none.
    engage: { config: { playerWeapon: '$first:with.weapons' } },
    intent: 'Projectiles for any entity: ballistic shots with gravity, pierce, homing, bounces and terrain stops; volley patterns (single, lanes, spread, laser, missile, ring, spiral, burst) with tiers; blasts in a circle or a plus along open cells with fuses and breakable cells; ammo per life, from events or inventory items; drawn bows. Includes the shmup shot/spread/laser/homing preset.',
    views: ['side', 'td', '3p', '1p'],
    params: {
      maxLive: { type: 'integer', default: 64, min: 1, max: 5000, effect: 'live shots per space; the oldest is removed first' },
      friendly: { type: 'boolean', default: false, effect: 'shots can hurt their own team' },
      weapons: { type: 'list', default: [], of: { type: 'object', fields: WEAPON }, effect: 'weapon definitions; items with a `ranged` block are weapons too' },
      playerWeapon: { type: 'string', effect: 'weapon or ranged item id the player starts with (components.ranged.weapon overrides)' },
      aim: { type: 'string', options: ['facing', 'look', 'move'], default: 'facing', effect: 'player aim direction source: facing, the look axis (twin-stick) or the move axis' },
    },
    provides: { events: ['hit', 'weapon_used', 'fired', 'projectile_hit', 'blast', 'empty', 'reloaded', 'cancelled', 'clash', 'expired'], services: ['projectiles'], actions: ['fire'] },
    requires: { primitives: ['gameplay.combat.health'], capabilities: ['overlap'] },
    reads: ['content.items'],
    data: itemsData(['ranged', 'weapon']),
    // Shapes of the archetype components this primitive owns (components.projectile is a live shot's, written at runtime).
    components: { ranged: { type: 'object', fields: {
      weapon: { type: 'string', effect: 'a weapons id or a content.items id with a ranged block' },
      tier: { type: 'integer', min: 1, max: 10, effect: 'weapon tier (default 1)' },
      ammo: { type: 'object', values: { type: 'integer', min: 0 }, effect: 'weapon id -> rounds held' },
    }, effect: 'what it can shoot' } },
    defines: [{ kind: 'weapon', in: 'weapons' }],
    rules: {
      projectile_ammo_invalid: { fields: ['weapons[].ammo.from', 'weapons[].ammo.item', 'weapons[].ammo.events'], message: "ammo from 'item' names its item; ammo from 'event' lists at least one event",
        example: { doc: { systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.combat.projectile', with: { weapons: [{ id: 'bow', ammo: { from: 'item' } }] } }] } } },
      projectile_tier_invalid: { fields: ['weapons[].tiers', 'weapons[].maxTier'], message: 'a weapon without a preset has at most maxTier tier entries',
        example: { doc: { systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.combat.projectile', with: { weapons: [{ id: 'bow', tiers: [{}, {}], maxTier: 1 }] } }] } } },
      projectile_weapon_unknown: { fields: ['playerWeapon', 'content.archetypes[].components.ranged.weapon'], message: 'names a weapons id or a content.items id with a ranged block' },
    },
    actionSpace: { fire: { type: 'enum', options: [true] } },
  },
  logic(logic) {
    logic.effect('fire', { run: (e, rt, c) => { const t = resolveWho(rt, e.who, c); if (t) rt.service('projectiles').fireWeapon(t, e.weapon, { target: e.target ? resolveWho(rt, e.target, c)?.id : null, force: Boolean(e.free) }); } });
    logic.effect('give_ammo', { run: (e, rt, c) => { const t = resolveWho(rt, e.who, c); if (t) rt.service('projectiles').addAmmo(t, e.weapon, e.count ?? 1); } });
    logic.effect('set_ranged', { run: (e, rt, c) => { const t = resolveWho(rt, e.who, c); if (t) Object.assign((t.components.ranged ??= {}), { weapon: e.weapon, tier: e.tier ?? t.components.ranged?.tier ?? 1 }); } });
  },
  validate(config, doc) {
    const errors = [], ids = new Set(config.weapons.map(w => w.id)), items = new Map((doc.content?.items || []).map(i => [i.id, i]));
    const known = id => ids.has(id) || Boolean(items.get(id)?.ranged);
    config.weapons.forEach((w, i) => {
      if (w.ammo?.from === 'item' && !w.ammo.item) errors.push(err('projectile_ammo_invalid', `with.weapons[${i}].ammo.item`, 'ammo from item needs ammo.item'));
      if (w.ammo?.from === 'event' && !w.ammo.events?.length) errors.push(err('projectile_ammo_invalid', `with.weapons[${i}].ammo.events`, 'ammo from event needs at least one event'));
      if (w.tiers.length > w.maxTier && !w.preset) errors.push(err('projectile_tier_invalid', `with.weapons[${i}].tiers`, `more tier entries than maxTier ${w.maxTier}`));
    });
    if (config.playerWeapon && !known(config.playerWeapon)) errors.push(err('projectile_weapon_unknown', 'with.playerWeapon', `unknown weapon '${config.playerWeapon}'`));
    archetypes(doc).forEach((a, i) => { const w = a.components?.ranged && typeof a.components.ranged === 'object' ? a.components.ranged.weapon : undefined; if (w !== undefined && !known(w)) errors.push(err('projectile_weapon_unknown', `content.archetypes[${i}].components.ranged.weapon`, `unknown weapon '${w}'`, `weapons: ${[...ids].join(', ') || 'none'}`)); });
    return errors;
  },
  install(rt, config) {
    const defs = new Map(config.weapons.map(w => [w.id, w]));
    /** A weapon definition at a tier: preset, then definition, then tier overrides. */
    const weaponDef = (id, tier = 1) => {
      let w = defs.get(id);
      if (!w) { const item = rt.doc.content?.items?.find(i => i.id === id); if (!item?.ranged) return null;
        const r = item.ranged; w = { id, pattern: 'single', speed: r.speed ?? 20, gravity: r.gravity ?? 0, spread: r.spread ?? 0, damage: item.weapon?.damage ?? r.damage ?? 1, type: item.weapon?.type ?? r.type, draw: r.draw ?? 0, minPower: 0.3, rate: r.rate ?? 2, life: r.life ?? 4, radius: r.radius ?? 0.2,
          ammo: r.ammo ? { from: 'item', item: r.ammo, count: 0, max: 9999, events: [] } : { from: 'unlimited' }, archetype: r.projectile, tiers: [], maxTier: 1, unitScale: 1, count: 1, span: 30, spin: 12, burstGap: 0.1, laneGap: 1, pierce: 0, bounce: 0, plane: 'auto' }; }
      const p = w.preset ? PRESETS[w.preset] : null, us = w.unitScale ?? 1;
      const out = { ...w, ...(p ? { ...p, speed: p.speed * us, radius: p.radius * us, laneGap: us } : {}) };
      if (p) for (const k of ['rate', 'life', 'damage', 'type', 'status', 'ammo', 'archetype', 'blast']) if (w[k] !== undefined && !(k in WEAPON && WEAPON[k].default === w[k])) out[k] = w[k];
      Object.assign(out, w.tiers?.[tier - 1] || {});
      out.tier = Math.max(1, Math.min(tier, out.maxTier ?? 1));
      return out;
    };
    const ranged = e => { const r = e.components.ranged; if (!r && e.id === 'player' && config.playerWeapon) return (e.components.ranged = { weapon: config.playerWeapon, tier: 1 }); return r; };
    const planeOf = (e, w) => {
      if (w.plane && w.plane !== 'auto') return w.plane;
      if (Array.isArray(e.at) && e.at.length === 2) return 'xy';
      const api = spaceOf(rt, e); return api?.size && api.size[2] <= 1 ? 'xy' : 'xz';
    };
    const rotate = (d, deg, plane) => {
      const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      return plane === 'xy' ? [d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2]] : [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
    };
    const lateral = (d, plane) => norm(plane === 'xy' ? [-d[1], d[0], 0] : [-d[2], 0, d[0]], [0, 1, 0]);
    const ammoOf = (e, w) => { const r = ranged(e) ?? (e.components.ranged = {}); r.ammo ??= {}; if (r.ammo[w.id] === undefined) r.ammo[w.id] = w.ammo?.from === 'start' ? w.ammo.count : 0; return r.ammo; };
    const hasAmmo = (e, w) => {
      const from = w.ammo?.from ?? 'unlimited';
      if (from === 'unlimited') return true;
      if (from === 'item') return rt.canTest('item') ? rt.test({ item: w.ammo.item, who: e.id === 'player' ? undefined : e.id, gte: 1 }) : true;
      return ammoOf(e, w)[w.id] > 0;
    };
    const payAmmo = (e, w) => {
      const from = w.ammo?.from ?? 'unlimited';
      if (from === 'item' && rt.canRun('take_item')) rt.run([{ do: 'take_item', item: w.ammo.item, count: 1, ...(e.id === 'player' ? {} : { who: e.id }) }]);
      else if (from === 'start' || from === 'event') ammoOf(e, w)[w.id]--;
    };
    const liveIn = space => Object.values(rt.state.entities).filter(x => x.components.projectile && x.space === space);

    /** Spawn one shot. spec fields mirror a weapon; opts: { dir, at, target }. */
    const shoot = (owner, spec, dir, at, extra = {}) => {
      const live = liveIn(owner.space);
      if (live.length >= config.maxLive) rt.despawn(live.sort((a, b) => a.components.projectile.born - b.components.projectile.born)[0].id);
      if (spec.single && live.some(x => x.components.projectile.single === spec.single)) return null;
      const d = norm(v3(dir)), speed = spec.speed ?? 20;
      const shot = rt.spawn(spec.archetype ?? 'projectile', { space: owner.space, at: like(owner.at, at), components: { body: { size: [0, 0, 0] } } });
      shot.components.projectile = {
        by: owner.id, team: teamOf(rt, owner), vel: mul(d, speed).map(v => round(v)), damage: spec.damage ?? 1, type: spec.type ?? null, life: Math.max(1, frames(spec.blast?.fuse > 0 && !speed ? spec.blast.fuse : spec.life ?? 2)), gravity: spec.gravity ?? 0,
        radius: spec.radius ?? 0.2, pierce: spec.pierce ?? 0, bounce: spec.bounce ?? 0, homing: spec.homing ?? null, blast: spec.blast ?? null, status: spec.status ?? null, knockback: spec.knockback,
        hits: spec.hits ?? 1, every: spec.every ?? 0, hitList: {}, hit: spec.hit ?? null, kind: spec.kind ?? spec.pattern ?? 'shot', single: spec.single ?? null, weapon: spec.weapon ?? null, clash: Boolean(spec.clash ?? spec.single),
        born: rt.state.frame, t: 0, ...extra,
      };
      return shot.id;
    };
    /** Fire a volley. Returns the new shot ids. */
    const fire = (owner, spec, { dir, at, target } = {}) => {
      if (!owner?.space || !Array.isArray(owner.at)) return [];
      const plane = planeOf(owner, spec);
      let d = dir ? norm(v3(dir)) : facingOf(owner);
      const tgt = target ? rt.entity(target) : null;
      if (tgt && posOf(tgt)) d = norm(sub(posOf(tgt), posOf(owner)), d);
      const off = v3(spec.offset || [0, 0, 0]);
      // Shots leave from the body centre, `offset` = [forward, height above the feet].
      const ob = boxOf(rt, owner), origin = at ? v3(at) : add(mul(add(ob.min, ob.max), 0.5), mul(d, off[0]));
      if (!at && off[1]) origin[1] = ob.min[1] + off[1];
      const jitter = () => (spec.spread ? (rt.random() * 2 - 1) * spec.spread : 0);
      const ids = [], tier = spec.tier ?? 1, lat = lateral(d, plane);
      const one = (dd, offset = 0, extra = {}, s = spec) => { const id = shoot(owner, s, rotate(dd, jitter(), plane), add(origin, mul(lat, offset)), extra); if (id) ids.push(id); };
      switch (spec.pattern ?? 'single') {
        case 'lanes': case 'missile': {
          const lanes = (spec.lanes || [[0]])[Math.min(tier, (spec.lanes || [[0]]).length) - 1];
          for (const o of lanes) one(d, o * (spec.laneGap ?? 1));
          if (spec.pattern === 'missile' && spec.missile) {
            const r = ranged(owner) ?? {}; r.volley = (r.volley ?? 0) + 1;
            if (r.volley % (spec.missile.every ?? 2) === 0) for (let k = 0; k < tier; k++) {
              const side = k % 2 ? 1 : -1, ang = (0.7 + 0.25 * Math.floor(k / 2)) * 180 / Math.PI * side, us = spec.unitScale ?? 1, h = spec.missile.homing;
              one(rotate(d, ang, plane), side * 6 * (spec.laneGap ?? 1), {}, { ...spec, speed: spec.missile.speed * us, damage: spec.missile.damage, life: spec.missile.life, kind: 'missile', homing: h ? { turn: h.turn, range: h.range * us, accel: h.accel * us, max: h.max * us } : null });
            }
          }
          break;
        }
        case 'spread': {
          const n = spec.counts ? spec.counts[tier - 1] ?? spec.counts.at(-1) : spec.count, half = spec.spans ? spec.spans[tier - 1] ?? spec.spans.at(-1) : spec.span / 2;
          for (let k = 0; k < n; k++) one(rotate(d, n === 1 ? 0 : -half + (2 * half * k) / (n - 1), plane));
          break;
        }
        case 'laser': {
          const dmg = (spec.damage ?? 0.8) + (spec.damagePerTier ?? 0) * tier, r = (spec.radius ?? 0.2) + (spec.radiusPerTier ?? 0) * tier * (spec.unitScale ?? 1);
          one(d, 0, {}, { ...spec, damage: dmg, radius: r, pierce: -1, kind: 'laser' });
          if (tier >= 3) for (const o of [-7, 7]) one(d, o * (spec.laneGap ?? 1), {}, { ...spec, damage: 0.6, pierce: -1, kind: 'laser' });
          break;
        }
        case 'ring': case 'spiral': {
          const n = spec.count, base = spec.pattern === 'spiral' ? ((ranged(owner) ?? (owner.components.ranged = {})).spin = ((owner.components.ranged.spin ?? 0) + spec.spin) % 360) : 0;
          for (let k = 0; k < n; k++) one(rotate(d, base + 360 * k / n, plane));
          break;
        }
        case 'burst': {
          one(d);
          const r = ranged(owner) ?? (owner.components.ranged = {});
          r.burst = { left: spec.count - 1, gap: Math.max(1, frames(spec.burstGap)), t: Math.max(1, frames(spec.burstGap)), spec: { ...spec, pattern: 'single' }, dir: d };
          break;
        }
        default: one(d);
      }
      if (ids.length) rt.emit('fired', { who: owner.id, weapon: spec.weapon ?? spec.id ?? null, kind: spec.kind ?? spec.pattern ?? 'single', count: ids.length, ids });
      return ids;
    };
    const aimDir = e => {
      if (e.id !== 'player') return e.components.ranged?.intent?.dir ?? null;
      const ax = config.aim === 'look' ? rt.input?.axes?.look : config.aim === 'move' ? rt.input?.axes?.move : null;
      if (!ax || Math.hypot(ax[0] ?? 0, ax[1] ?? 0) < 0.2) return null;
      return planeOf(e, {}) === 'xy' ? [ax[0], ax[1], 0] : [ax[0], 0, ax[1]];
    };
    const fireWeapon = (e, weaponId, { target = null, force = false, power = 1 } = {}) => {
      const r = ranged(e); const id = weaponId ?? r?.weapon; if (!id) return [];
      const w = weaponDef(id, r?.tier ?? 1); if (!w) return [];
      if (!force) {
        if ((r?.cooldown ?? 0) > 0) return [];
        if (!hasAmmo(e, w)) { rt.emit('empty', { who: e.id, weapon: id }); return []; }
      }
      const p = Math.max(w.minPower ?? 0, Math.min(1, power));
      const spec = { ...w, weapon: id, speed: w.speed * (w.draw ? p : 1), damage: w.damage * (w.draw ? p : 1) * (1 + statOf(rt, e, 'stat.ranged_damage')) };
      const ids = fire(e, spec, { dir: aimDir(e), target: target ?? (aimDir(e) ? null : service(rt, 'target')?.of(e)) });
      if (ids.length && rt.doc.content?.items?.some(i => i.id === id)) rt.emit('weapon_used', { who: e.id, item: id });
      if (ids.length && !force) { payAmmo(e, w); (e.components.ranged ??= {}).cooldown = Math.max(1, Math.round(60 / (w.rate * (1 + statOf(rt, e, 'stat.fire_rate'))))); }
      return ids;
    };

    const api = {
      weapon: (id, tier) => weaponDef(id, tier), fire, fireWeapon, live: space => liveIn(space ?? rt.doc.spaces[0].id).map(x => x.id),
      ammo: (e, id) => { const w = weaponDef(id ?? ranged(e)?.weapon); return !w ? 0 : w.ammo?.from === 'unlimited' ? Infinity : w.ammo?.from === 'item' ? null : ammoOf(e, w)[w.id]; },
      addAmmo(e, id, n = 1) { const w = weaponDef(id ?? ranged(e)?.weapon); if (!w) return; const a = ammoOf(e, w); a[w.id] = Math.min(w.ammo?.max ?? 99, a[w.id] + n); rt.emit('reloaded', { who: e.id, weapon: w.id, ammo: a[w.id] }); },
      setTier(e, id, tier) { const r = ranged(e) ?? (e.components.ranged = {}); r.weapon = id ?? r.weapon; r.tier = Math.max(1, Math.min(tier, weaponDef(r.weapon)?.maxTier ?? 1)); return r.tier; },
      /** Remove shots (bomb clears, boss phase changes). filter: { team?, notTeam?, near?: {at, r}, space? } */
      cancel({ team, notTeam, near, space, by } = {}) {
        const out = [];
        for (const s of Object.values(rt.state.entities)) {
          const p = s.components.projectile; if (!p || (space && s.space !== space)) continue;
          if (team && p.team !== team) continue; if (notTeam && p.team === notTeam) continue;
          if (near && !(posOf(s) && len(sub(posOf(s), v3(near.at))) <= near.r)) continue;
          out.push(s.id);
        }
        for (const id of out) rt.despawn(id);
        if (out.length) rt.emit('cancelled', { count: out.length, by: by ?? null });
        return out.length;
      },
      /** Volley damage of a weapon at a tier (missiles averaged over their volley cycle). */
      volleyDamage(id, tier = 1) {
        const w = weaponDef(id, tier); if (!w) return 0;
        switch (w.pattern) {
          case 'lanes': return w.damage * (w.lanes || [[0]])[Math.min(tier, (w.lanes || [[0]]).length) - 1].length;
          case 'spread': return round(w.damage * (w.counts ? w.counts[tier - 1] : w.count));
          case 'laser': return round(w.damage + (w.damagePerTier ?? 0) * tier + (tier >= 3 ? 1.2 : 0));
          case 'missile': return round(w.damage * (w.lanes || [[0]])[0].length + (w.missile ? w.missile.damage * tier / (w.missile.every ?? 2) : 0));
          case 'ring': case 'spiral': case 'burst': return w.damage * w.count;
          default: return w.damage;
        }
      },
    };
    rt.provide('projectiles', api);

    // Reloads from events, per-life ammo on revive.
    const eventWeapons = config.weapons.filter(w => w.ammo?.from === 'event');
    for (const name of new Set(eventWeapons.flatMap(w => w.ammo.events))) rt.on(name, d => {
      for (const w of eventWeapons.filter(x => x.ammo.events.includes(name))) { const who = rt.entity(d.who) ?? rt.player(); if (who && ranged(who)?.weapon === w.id) api.addAmmo(who, w.id, w.ammo.count); }
    });
    rt.on('revived', ({ who }) => { const e = rt.entity(who), r = e?.components.ranged; if (!r?.weapon) return; const w = weaponDef(r.weapon); if (w?.ammo?.from === 'start') ammoOf(e, w)[w.id] = w.ammo.count; });

    rt.on('game_start', () => { const p = rt.player(); if (p) ranged(p); });
    rt.action('fire', (v, rt) => { const p = rt.player(); if (!p) return; const r = ranged(p); if (!r?.weapon) return; const w = weaponDef(r.weapon, r.tier); if (w?.draw) r.drawing = r.drawing ?? 0; else fireWeapon(p, null, { target: typeof v === 'string' ? v : null }); });

    rt.system('input', rt => {
      for (const e of Object.values(rt.state.entities)) {
        const r = e.components.ranged; if (!r) continue;
        if (r.cooldown > 0) r.cooldown--;
        if (r.burst) { if (--r.burst.t <= 0 && r.burst.left > 0) { fire(e, r.burst.spec, { dir: r.burst.dir }); r.burst.left--; r.burst.t = r.burst.gap; } if (r.burst.left <= 0) r.burst = null; }
        if (r.drawing !== undefined && r.drawing !== null) {
          const w = weaponDef(r.weapon, r.tier), holding = e.id === 'player' ? Boolean(rt.input?.held?.fire) : Boolean(r.intent?.hold);
          if (holding) r.drawing++;
          else { fireWeapon(e, null, { power: w?.draw ? r.drawing / frames(w.draw) : 1 }); r.drawing = null; }
        }
        if (e.id !== 'player' && r.intent?.fire) { fireWeapon(e, r.intent.weapon, { target: r.intent.target }); r.intent.fire = false; }
      }
    }, KEY);

    rt.system('physics', rt => {
      const shots = Object.values(rt.state.entities).filter(x => x.components.projectile);
      for (const s of shots) {
        if (!rt.entity(s.id)) continue;
        const p = s.components.projectile, api = spaceOf(rt, s); if (!api || !Array.isArray(s.at)) { rt.despawn(s.id); continue; }
        p.t++;
        if (--p.life <= 0) { if (p.blast && p.blast.onExpire !== false) explode(s); else rt.emit('expired', { id: s.id, by: p.by }); rt.despawn(s.id); continue; }
        let vel = v3(p.vel);
        if (p.homing) {
          const tgt = nearestFoe(s, p);
          if (tgt) {
            const sp = len(vel), want = norm(sub(posOf(tgt), posOf(s))), cur = norm(vel, want), ang = Math.acos(Math.max(-1, Math.min(1, dot(cur, want))));
            const maxA = (p.homing.turn ?? 180) * Math.PI / 180 / 60, k = ang > 1e-6 ? Math.min(1, maxA / ang) : 1;
            vel = mul(norm(add(mul(cur, 1 - k), mul(want, k)), cur), Math.min(p.homing.max ?? 1e9, sp + (p.homing.accel ?? 0) / 60));
          }
        }
        if (p.gravity) vel[1] -= p.gravity / 60;
        p.vel = vel.map(v => round(v));
        const from = posOf(s), delta = mul(vel, 1 / 60), dist = len(delta);
        let to = add(from, delta);
        if (dist > 0 && api.raycast) {
          const hit = api.raycast(from, delta, dist);
          if (hit.hit === 'cell') {
            if (p.bounce > 0) { p.bounce--; const n = v3(hit.normal || [0, 0, 0]); p.vel = sub(vel, mul(n, 2 * dot(vel, n))).map(v => round(v)); to = hit.at ? add(v3(hit.at), mul(n, 0.05)) : from; }
            else { rt.emit('projectile_hit', { id: s.id, by: p.by, cell: hit.cell ?? null, at: hit.at }); if (p.blast) explode(s, hit.at); rt.despawn(s.id); continue; }
          }
        }
        if (dist > 0) api.setPos(s, like(s.at, to), rt);
        if (p.blast && p.blast.fuse > 0 && len(vel) === 0) continue; // a lit bomb waits for its fuse
        // Swept entity hits: sample along the path every radius.
        const steps = Math.max(1, Math.ceil(dist / Math.max(0.05, p.radius * 2))), hitNow = new Set();
        let gone = false;
        for (let k = 1; k <= steps && !gone; k++) {
          const at = add(from, mul(delta, k / steps));
          const ids = overlapping(rt, s.space, { kind: 'sphere', at, r: p.radius }, o => o.id !== s.id && o.id !== p.by && Boolean(o.components.health), api.boxesOf ? 'hurt' : undefined);
          for (const id of ids) {
            if (hitNow.has(id)) continue;
            const t = rt.entity(id), owner = rt.entity(p.by) ?? { id: p.by, components: { health: { team: p.team } } };
            if (!t || !combat(rt)?.canHit(null, t) || !hostile(rt, owner, t, config.friendly)) continue;
            const prev = p.hitList[id]; if (prev && (!p.every || p.t - prev.last < p.every || prev.n >= p.hits)) continue;
            hitNow.add(id);
            const final = p.hit?.final && p.hits <= 1;
            const res = combat(rt).hit(t, { amount: p.damage, type: p.type ?? undefined, by: p.by, source: 'projectile', dir: norm(vel), knockback: p.knockback, ...(p.hit || {}), ...(final ? { launch: p.hit.final.launch, knockdown: true } : {}), weapon: p.weapon });
            if (res.applied && p.status && !res.hit?.blocked) service(rt, 'status')?.apply(t, p.status, { by: p.by });
            rt.emit('projectile_hit', { id: s.id, by: p.by, target: id, at, damage: res.damage ?? 0, blocked: Boolean(res.hit?.blocked), applied: res.applied });
            if (res.applied) rt.emit('hit', { by: p.by, target: id, at, weapon: p.weapon, damage: res.damage, blocked: Boolean(res.hit?.blocked), projectile: s.id });
            p.hitList[id] = { n: (prev?.n ?? 0) + 1, last: p.t };
            if (p.blast) { explode(s); rt.despawn(s.id); gone = true; break; }
            if (p.every && p.hits > 1) { p.hits--; continue; }
            if (p.pierce === -1) continue;
            if (p.pierce > 0) { p.pierce--; continue; }
            rt.despawn(s.id); gone = true; break;
          }
        }
      }
      // Opposing clash shots cancel hit for hit.
      const clash = Object.values(rt.state.entities).filter(x => x.components.projectile?.clash);
      for (let i = 0; i < clash.length; i++) for (let j = i + 1; j < clash.length; j++) {
        const a = clash[i], b = clash[j], pa = a.components.projectile, pb = b.components.projectile;
        if (!rt.entity(a.id) || !rt.entity(b.id) || pa.team === pb.team || a.space !== b.space) continue;
        if (len(sub(posOf(a), posOf(b))) > pa.radius + pb.radius) continue;
        const n = Math.min(pa.hits, pb.hits); pa.hits -= n; pb.hits -= n;
        rt.emit('clash', { a: a.id, b: b.id, at: a.at });
        if (pa.hits <= 0) rt.despawn(a.id); if (pb.hits <= 0) rt.despawn(b.id);
      }
    }, KEY);

    const nearestFoe = (s, p) => {
      let best = null, bd = p.homing.range ?? Infinity;
      const owner = rt.entity(p.by) ?? { id: p.by, components: { health: { team: p.team } } };
      for (const o of Object.values(rt.state.entities)) {
        if (o.space !== s.space || !o.components.health || !combat(rt)?.canHit(null, o) || !hostile(rt, owner, o, config.friendly) || !posOf(o)) continue;
        const d = len(sub(posOf(o), posOf(s))); if (d < bd) { bd = d; best = o; }
      }
      return best;
    };
    /** Blast: a circle, or a plus along open cells that stops at solid cells (breaking listed blocks). */
    const explode = (s, at = s.at) => {
      const p = s.components.projectile, b = p.blast, api = spaceOf(rt, s), c = v3(at).map(v => round(v));
      const tiles = [];
      if (b.shape === 'plus' && api?.getCell) {
        const cell = c.map(Math.floor); tiles.push(cell);
        const dirs = planeOf(s, {}) === 'xy' ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] : [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
        for (const d of dirs) for (let r = 1; r <= b.range; r++) {
          const t = add(cell, mul(d, r)), block = api.getCell(t);
          if (block) { if (b.breaks?.includes(block)) { api.setCell(t, null, rt, p.by); tiles.push(t); } break; }
          tiles.push(t);
        }
      }
      const owner = rt.entity(p.by) ?? { id: p.by, components: { health: { team: p.team } } };
      const victims = new Set();
      if (tiles.length) for (const t of tiles) for (const id of overlapping(rt, s.space, { kind: 'aabb', at: add(t, [0.1, 0.1, 0]), size: [0.8, 0.8, 1] }, o => Boolean(o.components.health))) victims.add(id);
      else for (const id of overlapping(rt, s.space, { kind: 'sphere', at: c, r: b.range }, o => Boolean(o.components.health))) victims.add(id);
      for (const id of victims) {
        const t = rt.entity(id); if (!t || !hostile(rt, owner, t, config.friendly) || !combat(rt)?.canHit(null, t)) continue;
        const pt = posOf(t);
        combat(rt).hit(t, { amount: b.damage ?? p.damage, type: p.type ?? undefined, by: p.by, source: 'blast', stun: b.stunSec ? frames(b.stunSec) : undefined, stunKind: 'stagger', dir: pt ? sub(pt, c) : undefined, unblockable: true });
      }
      rt.emit('blast', { by: p.by, at: c, shape: tiles.length ? 'plus' : 'circle', tiles, range: b.range, victims: [...victims] });
    };
  },
};
