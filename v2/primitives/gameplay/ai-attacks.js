// gameplay.ai.attacks: telegraphed attack patterns for any entity with an
// `attacks` component (enemies, bosses, turrets). Each pattern runs windup →
// active → recover with per-pattern and global cooldowns, weighted choice among
// the patterns whose range, `when` and boss phase allow them, and a hit shape
// resolved through the space's overlap/raycast capabilities. Bullet `emitter`
// patterns (aimed, spread, ring, spiral, burst, flower) are ported from the
// shmup kit with live-bullet caps per mode and difficulty multipliers.
import { objectParam, v3, add, sub, mul, len, norm, dot, r6, round6, spaceOf, can, continuous, centerOf, distBetween, facingOf, headingOf, clearLine, selfRelative, weighted, applyHit, dead, cleanupOnDespawn, ensureLocomotion, upAt, planar, between, TAU } from './ai-lib.js';
import { hostile } from './ai-brain.js';
import { PATTERNS, DIFF, MODE_CAPS, volley, fireShot, liveShots, ensureShots } from './ai-lib-bullets.js';

const ID = 'gameplay.ai.attacks';
const KINDS = ['cone', 'sphere', 'box', 'ray', 'projectile', 'summon', 'self'];
/**
 * Built-in shape names → hit geometry. at: where the volume is centred (self or
 * the aim point captured at windup start). r defaults to the attack's range
 * (`radius` overrides); tick repeats hits during the active window.
 */
export const SHAPES = {
  arc: { kind: 'cone', angle: 100 }, arc_low: { kind: 'cone', angle: 120 }, cone: { kind: 'cone', angle: 60 }, x: { kind: 'sphere' },
  push: { kind: 'cone', angle: 90, knockback: 1 }, pull: { kind: 'cone', angle: 60, knockback: -1 },
  line: { kind: 'box', width: 1.2 }, box: { kind: 'box', width: 1.6 }, line_ground: { kind: 'box', width: 1.6 }, wave: { kind: 'box', width: 3, tick: 0.5 }, beam: { kind: 'box', width: 1, tick: 0.25 },
  ring: { kind: 'sphere' }, circle: { kind: 'sphere' }, blast: { kind: 'sphere' }, storm: { kind: 'sphere', tick: 1 }, darkness: { kind: 'sphere' }, screen_flash: { kind: 'sphere' },
  slam: { kind: 'sphere', at: 'target', r: 2.5 }, columns: { kind: 'sphere', at: 'target', r: 2 }, ceiling_fall: { kind: 'sphere', at: 'target', r: 3 }, emerge: { kind: 'sphere', at: 'target', r: 2.5 },
  pools: { kind: 'sphere', at: 'target', r: 3, tick: 0.5 }, silence_zone: { kind: 'sphere', at: 'target', r: 4, tick: 0.5 },
  hitscan: { kind: 'ray' }, hitscan_burst: { kind: 'ray', tick: 0.2 },
  projectile: { kind: 'projectile' }, projectile_fan: { kind: 'projectile', count: 5, spread: 40 }, projectile_rain: { kind: 'projectile', count: 6, rain: true }, rising_notes: { kind: 'projectile', count: 3, spread: 30 },
  summon: { kind: 'summon' }, buff: { kind: 'self' },
};
const MOVES = ['lunge', 'dash', 'charge', 'leap', 'dive', 'teleport_behind', 'retreat'];

const n = (extra = {}) => ({ type: 'number', min: 0, ...extra });
export const ATTACK = {
  id: { type: 'string', required: true }, range: n({ effect: 'reach / trigger distance' }), minRange: n(),
  windup: n({ unit: 's', effect: 'telegraph time before the hit' }), active: n({ unit: 's' }), recover: n({ unit: 's' }), cooldown: n({ unit: 's' }),
  damage: n(), type: { type: 'string' }, shape: { type: 'string' }, radius: n(), arc: n({ max: 360 }), tick: n({ unit: 's' }), knockback: { type: 'number' },
  move: { type: 'string', options: MOVES }, moveSpeed: n(), status: { type: 'string' }, statusSec: n(),
  weight: n(), when: { type: 'predicate' }, phase: { type: 'integer', min: 1 },
  summon: { type: 'ref', to: 'archetype' }, count: { type: 'integer', min: 1, max: 64 },
  projectile: { type: 'object', fields: { speed: n(), gravity: { type: 'number' }, count: { type: 'integer', min: 1, max: 64 }, spread: n({ max: 360 }), radius: n(), life: n(), homing: n(), pierce: { type: 'integer', min: 0 }, archetype: { type: 'ref', to: 'archetype' } } },
  emitter: { type: 'object', fields: { pattern: { type: 'string', options: PATTERNS, required: true }, rate: n({ effect: 'volleys/s during active' }), speed: n(), count: { type: 'integer', min: 1, max: 64 }, step: n(), boss: { type: 'boolean' }, radius: n(), life: n() } },
  selfDestruct: { type: 'boolean' }, blastBlocks: n({ effect: 'clear solid cells within this radius (editCells spaces)' }),
};

const st = rt => rt.store(ID);
const agentOf = (rt, id) => ((st(rt).agents ??= {})[id] ??= { phase: 'idle', cd: {}, gcd: 0 });

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['attack_launched', 'attack_hit'] },
    // It acts for every non-player entity with an `attacks` component: hits run damage/apply_status (ai-lib applyHit), lunges move it.
    drives: { control: 'ai', components: ['attacks'], effects: ['damage', 'apply_status'], events: ['attack_hit', 'shot_hit'], movement: true },
    // Shapes of the archetype components this primitive owns (the planner's schemas and repair read them).
    components: { attacks: { type: 'list', min: 1, of: { type: 'object', fields: ATTACK }, effect: 'telegraphed attack patterns' } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "archetypes", "component": "attacks", "min": 1, "placed": 1, "why": "attack patterns run on archetypes with an attacks component", "example": {"id": "warden", "kind": "enemy", "components": {"health": {"max": 20}, "attacks": [{"id": "slam", "range": 2, "windup": 0.6, "active": 0.2, "recover": 0.8, "damage": 2, "shape": "arc", "weight": 2}]}}},
    ],
    intent: 'Enemies and bosses attack with telegraphed patterns from their `attacks` component: windup/active/recover/cooldown, weighted choice by range, predicate and boss phase, hit shapes (arcs, cones, lines, rings, slams, hitscan, projectiles, summons, buffs), lunges/charges/blinks and shmup bullet emitters (aimed spread ring spiral burst flower) with per-mode caps and difficulty.',
    views: ['any'],
    params: {
      telegraph: { type: 'boolean', default: true, effect: 'emit `telegraph` at windup start so renderers/players can read the attack' },
      globalCooldown: n({ default: 0, unit: 's', effect: 'pause after any attack before the next' }),
      difficulty: { type: 'string', default: 'normal', options: Object.keys(DIFF), effect: 'bullet speed and fire-rate multipliers' },
      difficultyVar: { type: 'string', effect: 'var holding easy|normal|hard (overrides difficulty when set)' },
      bulletCap: { type: 'integer', default: 140, min: 1, max: 2000, effect: 'max live hostile bullets' },
      capBy: { type: 'object', fields: { var: { type: 'string', required: true }, caps: { type: 'object', open: true, default: MODE_CAPS } }, effect: 'per-mode caps: the cap is caps[var value] (fixed 24, vertical 140, twinstick 80, asteroids 16)' },
      bullet: objectParam({ type: 'object', fields: { speed: n({ default: 8 }), radius: n({ default: 0.25 }), life: n({ default: 6 }), damage: n({ default: 1 }) }, effect: 'emitter bullet defaults (space units)' }),
      shapes: { type: 'object', open: true, default: {}, effect: 'extra shape names → {kind: cone|sphere|box|ray|projectile|summon|self, at?: self|target, r?, angle?, width?, tick?, count?, spread?}' },
      maxSummons: { type: 'integer', default: 4, min: 0, max: 64, effect: 'live summons per summoner' },
      interruptOn: { type: 'list', of: { type: 'string' }, default: ['staggered'], effect: 'events {who} that cancel the victim\'s attack' },
    },
    provides: { events: ['self_destruct', 'enemy_shoot', 'telegraph', 'attack_launched', 'attack_hit', 'attack_end', 'attack_cancelled', 'summoned', 'shot_hit', 'shot_blocked', 'attack_buff'] },
    requires: { capabilities: ['position', 'distance'] },
    reads: ['content.archetypes'],
  },
  validate(config, doc, ctx) {
    const errors = [], shapes = { ...SHAPES, ...config.shapes };
    for (const [name, s] of Object.entries(config.shapes || {})) if (!KINDS.includes(s?.kind)) errors.push({ code: 'attack_shape_kind', path: `shapes.${name}.kind`, message: `shape kind must be one of ${KINDS.join('|')}` });
    (doc.content?.archetypes || []).forEach((a, i) => {
      const list = a.components?.attacks; if (list === undefined) return;
      const path = `content.archetypes[${i}].components.attacks`;
      if (!Array.isArray(list)) { errors.push({ code: 'param_type', path, message: 'attacks must be a list of patterns' }); return; }
      const ids = new Set();
      list.forEach((atk, j) => {
        const p = `${path}[${j}]`;
        if (!atk || typeof atk !== 'object') { errors.push({ code: 'param_type', path: p, message: 'attack must be an object' }); return; }
        checkFieldsInto(ATTACK, atk, p, errors, ctx);
        if (ids.has(atk.id)) errors.push({ code: 'attack_duplicate', path: `${p}.id`, message: `duplicate attack '${atk.id}'` });
        ids.add(atk.id);
        if (atk.shape !== undefined && !shapes[atk.shape]) errors.push({ code: 'attack_shape_unknown', path: `${p}.shape`, message: `unknown shape '${atk.shape}'`, hint: `built in: ${Object.keys(SHAPES).join(', ')}; add more with the shapes param` });
        if ((atk.shape === 'summon' || shapes[atk.shape]?.kind === 'summon') && !atk.summon) errors.push({ code: 'attack_summon_missing', path: `${p}.summon`, message: 'a summon attack needs `summon: <archetype>`' });
      });
    });
    return errors;
  },
  install(rt, config) {
    ensureLocomotion(rt);
    ensureShots(rt, (a, b) => hostile(rt, a, b));
    cleanupOnDespawn(rt, [ID]);
    const shapes = { ...SHAPES, ...config.shapes };
    for (const ev of config.interruptOn) rt.on(ev, (data, rt) => {
      const a = st(rt).agents?.[data.who]; if (!a || a.phase === 'idle') return;
      rt.emit('attack_cancelled', { who: data.who, attack: a.attack, by: ev });
      a.phase = 'idle'; a.gcd = round6(rt.state.time + config.globalCooldown);
      const e = rt.entity(data.who); if (e) delete e.components.steer;
    });
    rt.system('ai', rt => {
      const now = rt.state.time;
      for (const e of Object.values(rt.state.entities)) {
        if (!Array.isArray(e.components.attacks) || !e.components.attacks.length || e.id === 'player') continue;
        if (dead(e)) { const a = st(rt).agents?.[e.id]; if (a) a.phase = 'idle'; continue; }
        // Stunned (combat health.stun frames) or a dazed boss: no new attacks, and a running one is cancelled.
        if ((e.components.health?.stun ?? 0) > 0 || e.components.boss?.dazed) {
          const a = st(rt).agents?.[e.id];
          if (a && a.phase !== 'idle') { rt.emit('attack_cancelled', { who: e.id, attack: a.attack, by: 'stun' }); a.phase = 'idle'; a.gcd = round6(rt.state.time + config.globalCooldown); delete e.components.steer; }
          if (e.components.ai) e.components.ai.attacking = null;
          continue;
        }
        const a = agentOf(rt, e.id);
        if (a.phase === 'idle') { if (now >= a.gcd) start(rt, e, a, config, shapes); }
        else advance(rt, e, a, config, shapes);
        // Readable busy flag for other primitives and verifiers: the attack id while one runs.
        if (e.components.ai && rt.entity(e.id)) e.components.ai.attacking = a.phase === 'idle' ? null : a.attack;
      }
    }, ID);
  },
};

function checkFieldsInto(fields, value, path, errors, ctx) {
  for (const k of Object.keys(value)) if (!(k in fields)) errors.push({ code: 'param_unknown', path: `${path}.${k}`, message: `unknown attack field '${k}'`, hint: `known: ${Object.keys(fields).join(', ')}` });
  for (const [k, schema] of Object.entries(fields)) {
    const v = value[k];
    if (v === undefined) { if (schema.required) errors.push({ code: 'param_missing', path: `${path}.${k}`, message: `required ${schema.type}` }); continue; }
    if (schema.type === 'number' || schema.type === 'integer') {
      if (!Number.isFinite(v) || (schema.type === 'integer' && !Number.isInteger(v))) errors.push({ code: 'param_type', path: `${path}.${k}`, message: `must be ${schema.type === 'integer' ? 'an integer' : 'a number'}` });
      else if ((schema.min !== undefined && v < schema.min) || (schema.max !== undefined && v > schema.max)) errors.push({ code: 'param_range', path: `${path}.${k}`, message: `${v} outside [${schema.min ?? '-∞'}, ${schema.max ?? '∞'}]` });
    } else if (schema.type === 'string') { if (typeof v !== 'string') errors.push({ code: 'param_type', path: `${path}.${k}`, message: 'must be a string' }); else if (schema.options && !schema.options.includes(v)) errors.push({ code: 'param_option', path: `${path}.${k}`, message: `'${v}' is not one of ${schema.options.join('|')}` }); }
    else if (schema.type === 'boolean') { if (typeof v !== 'boolean') errors.push({ code: 'param_type', path: `${path}.${k}`, message: 'must be true or false' }); }
    else if (schema.type === 'predicate') ctx.checkPredicate(v, `${path}.${k}`, errors);
    else if (schema.type === 'ref') { if (!ctx.indexes[schema.to]?.has(v)) errors.push({ code: 'ref_unknown', path: `${path}.${k}`, message: `unknown ${schema.to} '${v}'` }); }
    else if (schema.type === 'object') { if (!v || typeof v !== 'object' || Array.isArray(v)) errors.push({ code: 'param_type', path: `${path}.${k}`, message: 'must be an object' }); else checkFieldsInto(schema.fields, v, `${path}.${k}`, errors, ctx); }
  }
}

// ---------- choice ----------
function targetOf(rt, e) {
  const t = rt.hasService('ai.brain') ? rt.service('ai.brain').targetOf(e.id) : null;
  if (t && hostile(rt, e, t)) return t;
  const p = rt.player();
  return p && p.space === e.space && !dead(p) && hostile(rt, e, p) ? p : null;
}
const phaseOf = e => e.components.boss?.phase ?? e.components.phase ?? 1;
const liveSummons = (rt, e) => Object.values(rt.state.entities).filter(o => o.components.summonedBy === e.id).length;

function start(rt, e, a, config, shapes) {
  const t = targetOf(rt, e); if (!t) return;
  const d = distBetween(rt, e, t), ph = phaseOf(e), now = rt.state.time, ctx = { self: e.id, target: t.id };
  const pattern = Array.isArray(e.components.boss?.pattern) && e.components.boss.pattern.length ? new Set(e.components.boss.pattern) : null;
  const ok = e.components.attacks.filter(x => {
    if (pattern && !pattern.has(x.id)) return false; // combat.boss: the attacks this phase allows
    const sh = shapes[x.shape] || (x.summon ? SHAPES.summon : SHAPES.arc);
    const range = x.range ?? 1.5;
    if (sh.kind !== 'summon' && sh.kind !== 'self' && !(range > 0 && d <= range)) return false;
    if (x.minRange !== undefined && d < x.minRange) return false;
    if ((a.cd[x.id] ?? 0) > now) return false;
    if (x.phase !== undefined && ph < x.phase) return false;
    if (sh.kind === 'summon' && liveSummons(rt, e) >= config.maxSummons) return false;
    return !x.when || rt.test(selfRelative(x.when), ctx);
  });
  const pick = weighted(rt, ok); if (!pick) return;
  const api = spaceOf(rt, e);
  a.attack = pick.id; a.phase = 'windup'; a.t0 = now; a.target = t.id; a.hits = {}; a.fired = 0; a.lastTick = -1;
  a.aim = continuous(t) ? r6(centerOf(t, api)) : t.at;
  a.dir = continuous(e) && continuous(t) ? r6(norm(planar(api, e.at, sub(centerOf(t, api), centerOf(e, api))))) : [1, 0, 0];
  if (len(a.dir) < 1e-6) a.dir = r6(facingOf(e, headingOf(rt, e.id)));
  delete e.components.steer; if (e.components.moveTo?.by === 'ai') delete e.components.moveTo;
  if (config.telegraph) rt.emit('telegraph', { who: e.id, attack: pick.id, target: t.id, at: a.aim, windup: pick.windup ?? 0, shape: pick.shape ?? null });
}

function advance(rt, e, a, config, shapes) {
  const atk = e.components.attacks.find(x => x.id === a.attack);
  if (!atk) { a.phase = 'idle'; return; }
  // combat.boss phase speed scales the whole attack timeline.
  const k = 1 / Math.max(0.05, e.components.boss?.speed ?? 1);
  const now = rt.state.time, el = now - a.t0, wind = (atk.windup ?? 0) * k, act = (atk.active ?? 0.1) * k, rec = (atk.recover ?? 0.3) * k;
  const sh = { ...(shapes[atk.shape] || (atk.summon ? SHAPES.summon : SHAPES.arc)) };
  if (a.phase === 'windup' && el >= wind - 1e-9) {
    a.phase = 'active'; a.t1 = now;
    rt.emit('attack_launched', { who: e.id, attack: atk.id, target: a.target });
    onset(rt, e, a, atk, sh, config);
    if (!rt.entity(e.id)) return; // self-destructed
  }
  if (a.phase === 'active') {
    const ae = now - a.t1;
    activeFrame(rt, e, a, atk, sh, config, ae);
    if (ae >= act - 1e-9) {
      a.phase = 'recover'; a.t2 = now; delete e.components.steer;
      if (atk.selfDestruct) { selfDestruct(rt, e); return; }
    }
  }
  if (a.phase === 'recover' && now - a.t2 >= rec - 1e-9) {
    a.phase = 'idle'; a.cd[atk.id] = round6(now + (atk.cooldown ?? 0)); a.gcd = round6(now + config.globalCooldown);
    rt.emit('attack_end', { who: e.id, attack: atk.id });
  }
}

/** One-time effects at the start of the active window. */
function onset(rt, e, a, atk, sh, config) {
  const api = spaceOf(rt, e), t = rt.entity(a.target);
  if (atk.move === 'teleport_behind' && t && continuous(e) && continuous(t) && api) {
    // A blink attack: reappear just behind the target (an attack mechanic, not navigation).
    const back = mul(norm(planar(api, t.at, facingOf(t, headingOf(rt, t.id)))), -1.5), to = r6(add(t.at, back));
    if (!can(api, 'getCell') || !api.getCell(to)) { api.setPos(e, to, rt); a.dir = r6(norm(sub(t.at, e.at))); }
  }
  if (atk.blastBlocks > 0 && can(api, 'cellsIn') && can(api, 'setCell') && continuous(e)) {
    const c = centerOf(e, api), r = atk.blastBlocks, lo = c.map(v => Math.floor(v - r)), hi = c.map(v => Math.floor(v + r));
    for (const cell of api.cellsIn([lo, hi])) if (len(sub(add(cell.at, [0.5, 0.5, 0.5]), c)) <= r) api.setCell(cell.at, null, rt, e.id);
  }
  if (sh.kind === 'summon') {
    const count = atk.count ?? 1;
    for (let k = 0; k < count && liveSummons(rt, e) < config.maxSummons; k++) {
      const ang = (k / count) * TAU, at = continuous(e) ? r6(add(e.at, planar(api, e.at, [Math.cos(ang) * 1.5, Math.sin(ang) * 1.5, Math.sin(ang) * 1.5]))) : e.at;
      const s = rt.spawn(atk.summon, { space: e.space, at, components: { summonedBy: e.id } });
      rt.emit('summoned', { who: s.id, by: e.id, archetype: atk.summon });
      if (rt.hasService('ai.brain') && t) rt.service('ai.brain').remember(s.id, t.id);
    }
  }
  if (sh.kind === 'self') {
    rt.emit('attack_buff', { who: e.id, attack: atk.id, status: atk.status ?? null });
    if (atk.status) applyHit(rt, e, e, { status: atk.status, sec: atk.statusSec ?? atk.active });
  }
  if (sh.kind === 'projectile' && !atk.emitter) shoot(rt, e, a, atk, sh, config);
}

function activeFrame(rt, e, a, atk, sh, config, ae) {
  const api = spaceOf(rt, e); if (!api) return;
  // Committed movement during the active window: lunges, dashes, charges, leaps and dives.
  if (atk.move && atk.move !== 'teleport_behind' && continuous(e)) {
    const speed = atk.moveSpeed ?? (atk.range ?? 3) / Math.max(0.1, atk.active ?? 0.3);
    const dir = atk.move === 'retreat' ? mul(a.dir, -1) : atk.move === 'dive' || atk.move === 'leap' ? norm(sub(a.aim, centerOf(e, api))) : a.dir;
    e.components.steer = { dir: r6(norm(dir)), speed: round6(speed), fly: atk.move === 'dive' || atk.move === 'leap', by: 'ai' };
  }
  if (atk.emitter) { emit(rt, e, a, atk, config, ae); return; }
  if (sh.kind === 'projectile' || sh.kind === 'summon' || sh.kind === 'self') return;
  const tick = atk.tick ?? sh.tick;
  if (tick) { const k = Math.floor(ae / tick + 1e-9); if (k === a.lastTick) return; a.lastTick = k; a.hits = {}; }
  strike(rt, e, a, atk, sh, api);
}

/** Resolve the hit volume and hit every hostile inside it once per tick. */
function strike(rt, e, a, atk, sh, api) {
  const range = atk.range ?? 1.5;
  const t = rt.entity(a.target);
  if (sh.kind === 'ray') {
    if (!t || t.space !== e.space || a.hits[t.id]) return;
    if (distBetween(rt, e, t) <= range && (!continuous(e) || clearLine(api, centerOf(e, api), centerOf(t, api)))) hit(rt, e, a, atk, sh, t);
    return;
  }
  if (!continuous(e)) { // discrete spaces: everyone hostile at the same node (or the target in range)
    for (const o of Object.values(rt.state.entities)) if (o.space === e.space && !a.hits[o.id] && hostile(rt, e, o) && distBetween(rt, e, o) <= range && !dead(o)) hit(rt, e, a, atk, sh, o);
    return;
  }
  const r = atk.radius ?? sh.r ?? range;
  const origin = sh.at === 'target' ? v3(a.aim) : centerOf(e, api);
  const ids = can(api, 'overlap') ? api.overlap({ kind: sh.kind === 'cone' ? 'cone' : 'sphere', at: origin, r: sh.kind === 'box' ? range : r, dir: a.dir, angle: atk.arc ?? sh.angle }, o => o.id !== e.id) : Object.values(rt.state.entities).filter(o => o.space === e.space && o.id !== e.id).map(o => o.id);
  for (const id of ids) {
    const o = rt.entity(id); if (!o || a.hits[id] || dead(o) || !hostile(rt, e, o) || o.components.aiShot) continue;
    const rel = sub(centerOf(o, api), origin), d = len(rel);
    if (sh.kind === 'sphere' && d > r + 0.5) continue;
    if (sh.kind === 'cone') { if (d > r + 0.5) continue; const ang = atk.arc ?? sh.angle ?? 90; if (d > 0.5 && dot(norm(rel), a.dir) < Math.cos((ang / 2) * Math.PI / 180)) continue; }
    if (sh.kind === 'box') { const along = dot(rel, a.dir), across = len(sub(rel, mul(a.dir, along))); if (along < -0.5 || along > range + 0.5 || across > (atk.radius ?? sh.width ?? 1.2) / 2 + 0.5) continue; }
    hit(rt, e, a, atk, sh, o);
  }
}

function hit(rt, e, a, atk, sh, o) {
  a.hits[o.id] = true;
  const kb = atk.knockback ?? (sh.knockback ? sh.knockback * (atk.range ?? 2) / 2 : undefined);
  const res = applyHit(rt, e, o, { amount: atk.damage ?? 0, type: atk.type, status: atk.status, sec: atk.statusSec, dir: a.dir, knockback: kb, tags: [atk.id] });
  rt.emit('attack_hit', { who: o.id, by: e.id, attack: atk.id, damage: atk.damage ?? 0, applied: Boolean(res?.applied) });
}

function selfDestruct(rt, e) {
  rt.emit('self_destruct', { who: e.id });
  if (rt.canRun('kill')) rt.run([{ do: 'kill', who: e.id, by: e.id }]);
  if (rt.entity(e.id) && !e.components.health) rt.despawn(e.id);
}

// ---------- projectiles and emitters ----------
function capOf(rt, config) {
  if (config.capBy) { const v = rt.state.vars[config.capBy.var]; const c = config.capBy.caps?.[v]; if (Number.isFinite(c)) return c; }
  return config.bulletCap;
}
const diffOf = (rt, config) => DIFF[(config.difficultyVar && rt.state.vars[config.difficultyVar]) || config.difficulty] || DIFF.normal;

function shoot(rt, e, a, atk, sh, config) {
  const api = spaceOf(rt, e), t = rt.entity(a.target);
  const p = { ...(atk.projectile || {}) }, count = p.count ?? sh.count ?? 1, spread = p.spread ?? sh.spread ?? (count > 1 ? 20 : 0);
  const spec = { speed: p.speed ?? config.bullet.speed, gravity: p.gravity ?? 0, damage: atk.damage ?? config.bullet.damage, type: atk.type, status: atk.status, radius: p.radius ?? config.bullet.radius, life: p.life ?? config.bullet.life, homing: p.homing ?? 0, pierce: p.pierce ?? 0, archetype: p.archetype };
  if (!continuous(e)) return;
  const up = upAt(api, e.at);
  // Lob: with gravity, aim above the target so the arc lands (flat-ground ballistic estimate).
  const base = (() => {
    if (!t || !continuous(t)) return a.dir;
    const to = sub(centerOf(t, api), centerOf(e, api));
    if (!spec.gravity || !up) return norm(to);
    const flat = sub(to, mul(up, dot(to, up))), dist = len(flat), tFlight = dist / Math.max(0.1, spec.speed);
    return norm(add(to, mul(up, 0.5 * spec.gravity * tFlight * tFlight)));
  })();
  const axisUp = up || [0, 0, 1];
  for (let k = 0; k < count; k++) {
    if (liveShots(rt) >= capOf(rt, config)) break;
    let dir = base;
    if (sh.rain && t) { // drop from above around the target
      const off = [between(rt, -2, 2), 0, between(rt, -2, 2)], from = add(centerOf(t, api), add(mul(axisUp, 6), planar(api, t.at, off)));
      fireShot(rt, { ...e, at: r6(from), components: e.components }, mul(axisUp, -1), spec, t); continue;
    }
    if (count > 1) { const ang = ((k / (count - 1)) - 0.5) * spread * Math.PI / 180; dir = rotateAbout(base, axisUp, ang); }
    fireShot(rt, e, dir, spec, t);
  }
}
const rotateAbout = (v, axis, ang) => { const k = norm(axis), c = Math.cos(ang), s = Math.sin(ang); const cross = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]; return r6(add(add(mul(v, c), mul(cross, s)), mul(k, dot(k, v) * (1 - c)))); };

function emit(rt, e, a, atk, config, ae) {
  const em = atk.emitter, D = diffOf(rt, config), api = spaceOf(rt, e);
  if (!continuous(e) || !api) return;
  a.em ??= {};
  const boss = em.boss ?? Boolean(e.components.boss), ph = phaseOf(e) - 1;
  const v = (em.speed ?? config.bullet.speed) * D.bs * (boss ? 1.05 : 1);
  const t = rt.entity(a.target), up = upAt(api, e.at);
  // Pattern plane: perpendicular to gravity, or xy when there is none.
  const ax = up ? norm(planar(api, e.at, len(planar(api, e.at, [1, 0, 0])) > 0.5 ? [1, 0, 0] : [0, 0, 1])) : [1, 0, 0];
  const bx = up ? norm(sub(planar(api, e.at, [0, 0, 1]), mul(ax, dot(planar(api, e.at, [0, 0, 1]), ax)))) : [0, 1, 0];
  const aimV = t && continuous(t) ? sub(centerOf(t, api), centerOf(e, api)) : a.dir;
  const aim = Math.atan2(dot(aimV, len(bx) > 0.5 ? bx : [0, 1, 0]), dot(aimV, ax));
  const spec = { speed: v, damage: atk.damage ?? config.bullet.damage, type: atk.type, status: atk.status, radius: em.radius ?? config.bullet.radius, life: em.life ?? config.bullet.life };
  const put = list => { for (const s of list) { if (liveShots(rt) >= capOf(rt, config)) break; fireShot(rt, e, add(mul(ax, Math.cos(s.a)), mul(len(bx) > 0.5 ? bx : [0, 1, 0], Math.sin(s.a))), { ...spec, speed: v * s.k, radius: s.big ? spec.radius * 1.3 : spec.radius }, t); } };
  // Burst: queued aimed shots every 5 frames.
  if (a.em.burst > 0 && --a.em.burstGap <= 0) { a.em.burst--; a.em.burstGap = 5; put(volley('aimedOne', aim, a.em, { boss })); }
  const rate = (em.rate ?? 2) * D.fr * (em.pattern === 'spiral' ? 4 : 1);
  const due = Math.floor(ae * rate + 1e-9) + 1;
  if (a.fired >= due) return;
  a.fired = due;
  put(volley(em.pattern, aim, a.em, { boss, phase: Math.max(0, ph), count: em.count, step: em.step }));
  if (em.pattern !== 'burst') rt.emit('enemy_shoot', { who: e.id, attack: atk.id, pattern: em.pattern });
}
