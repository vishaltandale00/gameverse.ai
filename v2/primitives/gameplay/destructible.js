// gameplay.destructible: things that break from impacts and blasts, in any space.
// Entities carry components.destructible = {material, hp?, scale?}. Every
// `contact` (physics spaces, or self-moving primitives) damages both sides by
// the impulse beyond the floor (0.9: resting loads stay below it), ×1.15 when
// the other body is a launched projectile. hp = material hp × scale × toughness.
// At 0 hp a piece breaks: score, `destroyed:<material>`, optional shards, and
// explosive materials (TNT) blast: impulse to bodies in range and 9·k damage to
// destructibles, chaining. Materials with `lit` only light up when hit and
// break together at the end of the shot (Peggle pegs). Blasts can also carve
// editCells cells.
import { checkFields } from '../../kernel/params.js';
import { award } from './puzzle-lib-board.js';
import { centerOf, setVel, explode, sizeOf } from './puzzle-lib-body.js';

const ID = 'gameplay.destructible';
// Slingshot material table (density is for the physics space; hp and score are used here).
export const MATERIALS = {
  wood: { hp: 5, score: 500, density: 0.7 },
  stone: { hp: 18, score: 1000, density: 2.2 },
  glass: { hp: 1.8, score: 300, density: 1.0 },
  tnt: { hp: 2.2, score: 500, density: 0.8, explode: { r: 3.4, strength: 13 } },
  rock: { hp: 0, score: 0, density: 0 },
  target: { hp: 2.6, score: 5000, density: 0.8 },
};
const MATERIAL_SCHEMA = { type: 'object', open: true, fields: { hp: { type: 'number', default: 1, min: 0, max: 1e6, effect: '0 = indestructible' }, score: { type: 'number', default: 0, min: 0, max: 1e7 }, density: { type: 'number', default: 1, min: 0, max: 100 }, explode: { type: 'json' }, shards: { type: 'integer', default: 0, min: 0, max: 32 }, lit: { type: 'boolean', default: false } } };

export default {
  id: ID,
  card: {
    intent: 'Destructible materials (wood, stone, glass, TNT, targets, pegs) that take impulse damage from contacts above a floor, break with score and shards, and blast neighbours when explosive.',
    views: ['side', 'td', '3p'],
    params: {
      materials: { type: 'object', open: true, default: MATERIALS, effect: 'material id -> {hp (0 = never breaks), score, density, explode?:{r,strength}, shards, lit}' },
      floor: { type: 'number', default: 0.9, min: 0, max: 1000, effect: 'impulse a piece shrugs off per contact' },
      projectileBonus: { type: 'number', default: 1.15, min: 0, max: 10, effect: 'damage multiplier when hit by a launched projectile' },
      toughness: { type: 'number', default: 1, min: 0.05, max: 20, effect: 'hp multiplier for every piece' },
      settleFrames: { type: 'integer', default: 0, min: 0, max: 600, unit: 'frames', effect: 'no damage while the structure settles at the start' },
      blastDamage: { type: 'number', default: 9, min: 0, max: 1000, effect: 'damage at the blast centre (×k falloff)' },
      shard: { type: 'ref', to: 'archetype', effect: 'archetype spawned per shard (else only a shards event)' },
      carve: { type: 'boolean', default: false, effect: 'blasts remove editCells cells in range' },
      unbreakable: { type: 'list', default: [], of: { type: 'string' }, effect: 'cell tokens blasts never carve' },
      litOn: { type: 'string', default: 'shot_end', effect: 'event that breaks every lit piece' },
    },
    provides: { events: ['damaged', 'damaged:*', 'destroyed', 'destroyed:*', 'cracked', 'lit', 'lit:*', 'shards', 'explosion', 'cell_broken', 'cell_broken:*'], vars: ['destructible.left'] },
    requires: { capabilities: ['position'] },
    reads: [],
  },
  logic(logic) {
    logic.effect('explode', {
      check: (e, path, errors) => { if (!(e.r > 0)) errors.push({ code: 'effect_invalid', path: `${path}.r`, message: 'explode needs r > 0' }); },
      run: (e, rt, c) => { const who = rt.resolve(e.who, c); const space = e.space ?? who?.space ?? rt.doc.spaces[0].id; const at = e.at ?? (who ? centerOf(rt.space(space), who) : [0, 0]); explode(rt, space, at, e.r, e.strength ?? 13, e.cause ?? 'effect'); },
    });
    logic.effect('break', { run: (e, rt, c) => { const who = rt.resolve(e.who, c); if (who) rt.emit('destructible_request', { id: who.id, amount: e.amount ?? Infinity, cause: e.cause ?? 'effect' }); } });
  },
  validate(config) {
    const errors = [];
    for (const [id, m] of Object.entries(config.materials)) {
      if (typeof m !== 'object' || m === null || Array.isArray(m)) { errors.push({ code: 'material_invalid', path: `with.materials.${id}`, message: 'material must be an object' }); continue; }
      const errs = [];
      checkFields(MATERIAL_SCHEMA.fields, m, `with.materials.${id}`, errs, null, true);
      for (const e of errs) errors.push({ ...e, code: 'material_invalid' });
      if (m.explode && !(m.explode.r > 0)) errors.push({ code: 'material_invalid', path: `with.materials.${id}.explode`, message: 'explode needs {r > 0, strength}' });
    }
    return errors;
  },
  install(rt, config) {
    const st = () => rt.store(ID);
    const mat = id => ({ ...MATERIAL_SCHEMA_DEFAULTS, ...(config.materials[id] || {}) });
    const pieceOf = id => { const e = id != null && rt.entity(id); return e && e.components.destructible ? e : null; };
    const hpOf = e => {
      const d = e.components.destructible, m = mat(d.material);
      if (d.hp === undefined) { const area = Math.sqrt(sizeOf(e)[0] * sizeOf(e)[1]); d.hp = m.hp * (d.scale ?? Math.max(0.5, Math.min(2.2, area))) * config.toughness; d.max = d.hp; }
      return d.hp;
    };
    const isProjectile = e => Boolean(e?.components.launcher) || rt.archetype(e?.archetype)?.kind === 'projectile';
    function damage(e, amount, cause) {
      if (!e || !(amount > 0) || rt.state.frame < config.settleFrames) return;
      const d = e.components.destructible, m = mat(d.material);
      if (!m.hp) return; // indestructible
      hpOf(e);
      if (m.lit) { if (!d.lit) { d.lit = true; rt.emitTyped('lit', d.material, { id: e.id, cause }); } return; }
      d.hp -= amount;
      rt.emitTyped('damaged', d.material, { id: e.id, amount, hp: d.hp, cause });
      if (d.hp > 0) { if (amount > d.max * 0.15) rt.emit('cracked', { id: e.id, material: d.material }); return; }
      destroy(e, cause);
    }
    function destroy(e, cause) {
      const d = e.components.destructible, m = mat(d.material), api = rt.space(e.space), at = centerOf(api, e), space = e.space;
      rt.despawn(e.id);
      if (m.score) award(rt, m.score, 'destroyed', { material: d.material });
      rt.emitTyped('destroyed', d.material, { id: e.id, archetype: e.archetype, at, cause });
      if (m.shards) {
        rt.emit('shards', { at, count: m.shards, material: d.material });
        if (config.shard) for (let i = 0; i < m.shards; i++) {
          const a = rt.random() * Math.PI * 2, sp = 2 + rt.random() * 3;
          const s = rt.spawn(config.shard, { space, at: (api.pos ? api.pos(e) : e.at) || at });
          setVel(rt, api, s, [Math.cos(a) * sp, Math.sin(a) * sp + 2]);
        }
      }
      if (m.explode) explode(rt, space, at, m.explode.r, m.explode.strength ?? 13, d.material);
      vars();
    }
    const vars = () => { rt.state.vars['destructible.left'] = Object.values(rt.state.entities).filter(e => e.components.destructible && mat(e.components.destructible.material).hp > 0).length; };
    rt.on('contact', c => {
      if (c.sensor) return;
      const A = rt.entity(c.a), Bn = c.b != null ? rt.entity(c.b) : null;
      const dmg = (c.impulse ?? 0) - config.floor;
      if (dmg <= 0) return;
      for (const [X, Y] of [[A, Bn], [Bn, A]]) if (pieceOf(X?.id)) damage(X, dmg * (isProjectile(Y) ? config.projectileBonus : 1), isProjectile(Y) ? 'shot' : 'impact');
    });
    rt.on('explosion', ev => {
      const api = rt.space(ev.space);
      for (const e of Object.values(rt.state.entities)) {
        if (e.space !== ev.space || !e.components.destructible) continue;
        const c = centerOf(api, e), dist = Math.hypot(c[0] - ev.at[0], c[1] - ev.at[1]), bound = Math.max(...sizeOf(e)) / 2;
        if (dist > ev.r + bound) continue;
        const k = Math.max(0, 1 - Math.max(0, dist - bound) / ev.r);
        damage(e, config.blastDamage * k, 'blast');
      }
      if (config.carve && api.setCell) {
        const r = Math.ceil(ev.r);
        for (let x = Math.floor(ev.at[0] - r); x <= Math.ceil(ev.at[0] + r); x++) for (let y = Math.floor(ev.at[1] - r); y <= Math.ceil(ev.at[1] + r); y++) {
          if (Math.hypot(x + 0.5 - ev.at[0], y + 0.5 - ev.at[1]) > ev.r) continue;
          const cell = [x, y, 0], t = api.getCell(cell);
          if (t != null && !config.unbreakable.includes(t)) { api.setCell(cell, null, rt, ID); rt.emitTyped('cell_broken', t, { at: cell, by: 'blast' }); }
        }
      }
    });
    rt.on('destructible_request', r => { const e = pieceOf(r.id); if (e) { if (r.amount === Infinity) { hpOf(e); if (mat(e.components.destructible.material).hp) destroy(e, r.cause); } else damage(e, r.amount, r.cause); } });
    rt.on(config.litOn, () => { for (const e of Object.values(rt.state.entities)) if (e.components.destructible?.lit) destroy(e, 'lit'); });
    rt.system('late', () => { if (rt.state.frame % 30 === 0) vars(); }, ID);
  },
};
const MATERIAL_SCHEMA_DEFAULTS = { hp: 1, score: 0, density: 1, shards: 0, lit: false };
