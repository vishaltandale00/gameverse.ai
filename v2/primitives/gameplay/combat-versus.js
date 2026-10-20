// gameplay.combat.versus: one-on-one fighting rules over gameplay.combat.melee
// frame data, for every entity with components.versus (player vs CPU, CPU vs CPU).
// Ported from the fighting kit simulation:
//   guard by holding back (or a block button): high/mid blocked standing or
//   crouching, lows must be crouch-blocked, overheads stand-blocked; chip damage
//   on specials and supers; counter hits (struck during startup) x1.2 with +4
//   hitstun and +3 hitstop; juggle limit; damage SCALING by combo length (supers
//   floor at 0.5); meter gain on hit/block/special start and super cost; throws
//   only on grounded, throwable fighters with throw protection after stun; wall
//   push; screen max separation; body separation; auto-facing; launches,
//   knockdown and wakeup with invulnerability; and a fighter controller
//   (walk, back walk, jump arcs, dash) from the preset physique.
// Fighter state lives in components.versus = {meter, juggle, guard, air, crouch, throwProt, st, t, pv}.
import { grantInvuln, boxOf, add, v3, sub, posOf, facingSign, setFacing, like, spaceOf, round, err, archetypes, combat, service, intercept, statOf } from './combat-lib.js';
import { SUPER_COST, physique } from './combat-lib-moves.js';

const KEY = 'gameplay.combat.versus';
export const SCALING = [1, 1, 0.85, 0.75, 0.65, 0.56, 0.48, 0.42, 0.36, 0.3];
const UNTHROWABLE = new Set(['hit', 'block', 'knockdown', 'wakeup', 'thrown', 'throw', 'launch', 'stagger']);
const FREE_MELEE = new Set(['idle', undefined]);

export default {
  id: KEY,
  card: {
    intent: 'Fighting-game rules for one-on-one fighters on melee frame data: guard high/low/overhead by holding back, chip damage, counter hits, juggle limit, combo damage scaling, super meter, throws with tech and throw protection, wall push, screen separation, launches, knockdown and wakeup, and a walk/jump/dash fighter controller.',
    views: ['side'],
    params: {
      guard: { type: 'string', options: ['back', 'button'], default: 'back', effect: 'block by holding away from the opponent, or with the block button' },
      chip: { type: 'boolean', default: true, effect: 'specials and supers deal chip damage on block' },
      chipKills: { type: 'boolean', default: true, effect: 'chip damage can KO' },
      counterHit: { type: 'number', default: 1.2, min: 1, max: 3, unit: '×', effect: 'damage multiplier for hits during the opponent startup' },
      counterStun: { type: 'integer', default: 4, min: 0, max: 60, unit: 'frames' },
      juggleMax: { type: 'integer', default: 3, min: 0, max: 20, effect: 'air hits allowed on a launched fighter' },
      scaling: { type: 'list', of: { type: 'number', min: 0, max: 2 }, default: SCALING, min: 1, effect: 'damage multiplier by hits already in the combo' },
      superFloor: { type: 'number', default: 0.5, min: 0, max: 1, effect: 'lowest scaling a super can get' },
      meterMax: { type: 'number', default: 100, min: 1, max: 1000 },
      superCost: { type: 'number', default: SUPER_COST, min: 0, max: 1000 },
      throwProtect: { type: 'integer', default: 6, min: 0, max: 60, unit: 'frames', effect: 'throw immunity after leaving hit/blockstun' },
      walls: { type: 'list', of: { type: 'number' }, default: [0, 9.2], min: 2, max: 2, unit: 'units', effect: 'stage left and right walls (x)' },
      floor: { type: 'number', default: 0, unit: 'units', effect: 'ground height (y of the feet)' },
      maxSep: { type: 'number', default: 3.6, min: 0, max: 1000, unit: 'units', effect: 'fighters stay within this distance (the camera keeps both in view); 0 disables' },
      wallPush: { type: 'boolean', default: true, effect: 'hitting a cornered opponent pushes the attacker back instead' },
      physics: { type: 'boolean', default: true, effect: 'integrate fighter bodies (gravity, launches, landing, pushback); turn off when another primitive moves them' },
      locomotion: { type: 'boolean', default: true, effect: 'walk, back walk, jump and dash from the move axis using the preset physique' },
      knockdownFrames: { type: 'integer', default: 38, min: 0, max: 300 },
      wakeupFrames: { type: 'integer', default: 16, min: 0, max: 300 },
      wakeupInvuln: { type: 'integer', default: 18, min: 0, max: 300 },
    },
    provides: { events: ['super', 'guard', 'counter_hit', 'juggle_limit', 'knockdown', 'wakeup', 'jump', 'dash', 'wall_push'], vars: ['meter'], actions: ['dash'] },
    requires: { primitives: ['gameplay.combat.melee', 'gameplay.combat.health'] },
  },
  validate(config, doc) {
    const errors = [];
    if (config.walls[0] >= config.walls[1]) errors.push(err('versus_walls_invalid', 'with.walls', 'left wall must be left of the right wall'));
    if (config.maxSep && config.maxSep > config.walls[1] - config.walls[0]) errors.push(err('versus_maxsep_invalid', 'with.maxSep', 'maxSep is wider than the stage'));
    archetypes(doc).forEach((a, i) => { if (a.components?.versus && !a.components?.melee) errors.push(err('versus_needs_melee', `content.archetypes[${i}].components`, 'a versus fighter needs a melee component (fighter preset or moves)')); });
    return errors;
  },
  install(rt, config) {
    const fighters = () => Object.values(rt.state.entities).filter(e => e.components.versus && e.components.melee && !e.components.health?.dead);
    const vs = e => { const v = e.components.versus; v.meter ??= 0; v.juggle ??= 0; v.throwProt ??= 0; v.st ??= 'free'; v.t ??= 0; v.pv ??= 0; return v; };
    const opponent = e => { let best = null, bd = Infinity; for (const o of fighters()) if (o.id !== e.id && o.space === e.space) { const d = Math.abs(gpos(o)[0] - gpos(e)[0]); if (d < bd) { bd = d; best = o; } } return best; };
    const melee = () => rt.service('melee');
    const scale = () => rt.doc.systems.find(s => s.use === 'gameplay.combat.melee')?.with?.fighterScale ?? 0.01;
    const physOf = e => melee().physique(e) ?? physique({});
    const dirOf = e => {
      if (e.id !== 'player') return e.components.melee?.intent?.dir ?? 5;
      const [x = 0, y = 0] = rt.input?.axes?.move || [];
      return 5 + (Math.abs(x) > 0.5 ? Math.sign(x) * facingSign(e) : 0) + 3 * (Math.abs(y) > 0.5 ? Math.sign(y) : 0);
    };
    const air = e => gpos(e)[1] > config.floor + 1e-6 || vs(e).st === 'launch' || vs(e).st === 'jump';
    const stunned = e => (e.components.health?.stun ?? 0) > 0;
    const gain = (e, n) => { const v = vs(e); v.meter = Math.min(config.meterMax, round(v.meter + n)); if (e.id === 'player') rt.state.vars.meter = v.meter; };
    const hw = e => (e.components.body?.size ? e.components.body.size[0] / 2 : physOf(e).hw * scale());
    // Fighter geometry in anchor-free terms: [centre x, feet y, centre z] (KERNEL_API §3 anchors).
    const gpos = e => { const b = boxOf(rt, e); return [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2]; };
    const setPos = (e, q) => { const api = spaceOf(rt, e); if (!api?.setPos) return; const off = sub(posOf(e), gpos(e)); api.setPos(e, like(e.at, add(v3(q), off).map(x => round(x))), rt); };

    // Guard, chip, counter hits, scaling, juggles, launches (before melee's own block rule).
    intercept(rt, 10, (d, hit) => {
      if (!d.components.versus || !['melee', 'projectile'].includes(hit.source)) return hit;
      const v = vs(d), a = rt.entity(hit.by), dm = d.components.melee, wasAir = air(d), sc = hit.scale ?? scale();
      if ((v.st === 'knockdown' || v.st === 'wakeup') && !hit.otg) return { cancel: true, reason: 'down' };
      if (v.st === 'launch' && v.juggle >= config.juggleMax) { rt.emit('juggle_limit', { who: d.id, by: hit.by }); return { cancel: true, reason: 'juggle' }; }
      const away = a ? Math.sign(gpos(d)[0] - gpos(a)[0]) || facingSign(a) : Math.sign(v3(hit.dir)[0]) || 1;
      const dir = dirOf(d), holdBack = config.guard === 'button' ? (d.id === 'player' ? Boolean(rt.input?.held?.block) : Boolean(dm?.intent?.hold?.includes('block'))) : [1, 4, 7].includes(dir) && facingSign(d) === -away;
      const low = dir >= 1 && dir <= 3;
      const levelOk = hit.level === 'low' ? low : hit.level === 'overhead' ? !low : true;
      const canBlock = !wasAir && (FREE_MELEE.has(dm?.st) || dm?.st === 'block') && !stunned(d) || (stunned(d) && d.components.health.stunKind === 'block');
      const mv = hit.frame || {};
      if (!hit.unblockable && canBlock && holdBack && levelOk) {
        const chip = !config.chip || hit.kind === 'normal' || hit.kind === 'action' ? 0 : hit.chip ?? 0;
        v.pv = away * (hit.blockPush ?? 20 * sc) * 0.22; v.guard = low ? 'low' : 'high';
        if (a && config.wallPush && hit.source === 'melee' && atWall(d)) { vs(a).pv = -away * (hit.blockPush ?? 20 * sc) * 0.22; rt.emit('wall_push', { who: a.id }); }
        if (a) gain(a, Math.round((mv.meter ?? 0) * 0.5)); gain(d, Math.round((mv.meter ?? 0) * 0.4));
        rt.emit('blocked', { who: d.id, by: hit.by ?? null, amount: chip, low, move: hit.move ?? null });
        rt.emit('guard', { who: d.id, level: hit.level, low });
        return { ...hit, amount: chip, blocked: true, stun: hit.blockstun ?? 12, stunKind: 'block', knockback: 0, nonLethal: !config.chipKills, raw: true };
      }
      const counter = Boolean(hit.counter);
      const combo = dm?.combo && stunned(d) ? dm.combo : v.st === 'launch' ? dm?.combo ?? 0 : 0;
      let s = config.scaling[Math.min(combo, config.scaling.length - 1)] * (counter ? config.counterHit : 1);
      if (hit.kind === 'super') s = Math.max(config.superFloor, s);
      const amount = Math.max(1, Math.round((hit.amount ?? 0) * s));
      if (counter) rt.emit('counter_hit', { who: d.id, by: hit.by ?? null });
      if (dm?.st === 'attack') { dm.inv = null; dm.hidden = false; dm.diving = false; }
      const out = { ...hit, amount, knockback: 0, raw: false };
      const b = (d.components.body ??= {});
      if (wasAir || hit.launch || hit.knockdown || v.st === 'launch') {
        const L = hit.launch || (hit.knockdown && !wasAir ? { vx: 3.2, vy: 5 } : { vx: 2.4, vy: 4.5 });
        v.st = 'launch'; v.t = 0; v.juggle = (hit.launch && !wasAir) ? 1 : v.juggle + (wasAir ? 1 : 0);
        b.vel = like(Array.isArray(b.vel) ? b.vel : [0, 0], [away * L.vx * sc * 60, L.vy * sc * 60, 0]); b.grounded = false;
        const p = gpos(d); if (p[1] <= config.floor) { p[1] = config.floor + 1 * sc; setPos(d, p); }
        out.stun = 600; out.stunKind = 'launch';
      } else {
        out.stun = (hit.stun ?? 16) + (counter ? config.counterStun : 0);
        v.pv = away * (hit.push ?? 18 * sc) * 0.22;
        if (a && config.wallPush && hit.source === 'melee' && atWall(d)) { vs(a).pv = -away * (hit.push ?? 18 * sc) * 0.22; rt.emit('wall_push', { who: a.id }); }
      }
      if (counter) out.hitstop = (hit.hitstop ?? 0) + 3;
      if (a) gain(a, mv.meter ?? 0); gain(d, Math.round((mv.meter ?? 0) * 0.5));
      return out;
    }, KEY);
    const atWall = d => { const x = gpos(d)[0], h = hw(d); return x - h <= config.walls[0] + 0.01 || x + h >= config.walls[1] - 0.01; };

    rt.caches.versusHooked ??= false;
    const hookMelee = () => {
      if (rt.caches.versusHooked || !rt.hasService('melee')) return;
      rt.caches.versusHooked = true;
      const h = melee().hooks();
      h.canStart.push((e, mv) => { if (!e.components.versus) return true; if (mv.kind === 'super' && vs(e).meter < (mv.cost || config.superCost)) return false; return true; });
      h.onStart.push((e, mv) => {
        if (!e.components.versus) return;
        if (mv.kind === 'special') gain(e, 3);
        if (mv.kind === 'super') { vs(e).meter -= mv.cost || config.superCost; if (e.id === 'player') rt.state.vars.meter = vs(e).meter; rt.emit('super', { who: e.id, move: mv.id, title: mv.name }); }
        if (!air(e)) { const b = e.components.body; if (b?.vel) b.vel = like(b.vel, [0, 0, 0]); }
      });
      h.canGrab.push((a, d) => {
        if (!d.components.versus) return true;
        const v = vs(d);
        return !air(d) && !UNTHROWABLE.has(v.st) && !UNTHROWABLE.has(d.components.melee?.st) && v.throwProt <= 0 && d.components.melee?.inv !== 'all' && !d.components.melee?.hidden;
      });
    };
    hookMelee();

    rt.action('dash', (v, rt) => { const p = rt.player(); if (p?.components.versus) vs(p).dashReq = v === 'back' ? -1 : 1; });

    rt.system('physics', rt => {
      hookMelee();
      const fs = fighters();
      for (const e of fs) {
        const v = vs(e), m = e.components.melee, h = e.components.health, ph = physOf(e), sc = scale(), b = (e.components.body ??= {});
        if (config.physics && b.controller === undefined) b.controller = 'versus';
        if (h && h.versusInit !== true) { if (!e.components.health.maxSet && m.fighter?.stats?.health && h.max === undefined) h.max = ph.hp; h.versusInit = true; }
        if (e.id === 'player') rt.state.vars.meter = v.meter;
        v.t++; if (v.throwProt > 0) v.throwProt--;
        const o = opponent(e), p = gpos(e);
        const busy = m.st === 'attack' || m.st === 'throw' || m.st === 'thrown' || stunned(e) || m.st === 'land' || m.st === 'fall';
        // Auto-face the opponent when free and grounded (cross-ups turn you around).
        if (o && !busy && !air(e)) { const dx = gpos(o)[0] - p[0]; if (Math.abs(dx) > 1e-6) setFacing(e, Math.sign(dx)); }
        // Leaving stun: throw protection, combo reset.
        if (v.wasStunned && !stunned(e) && v.st !== 'launch' && v.st !== 'knockdown') { v.throwProt = config.throwProtect; v.juggle = 0; }
        v.wasStunned = stunned(e);
        if (!config.physics) continue;
        let vel = v3(b.vel);
        const d = dirOf(e);
        v.crouch = !busy && !air(e) && d >= 1 && d <= 3;
        // Authored poses on box-set spaces (arena2d): crouching shrinks the hurt boxes, etc.
        const api = spaceOf(rt, e);
        if (api?.setPose && b.poses && m.st !== 'attack') { const want = [stunned(e) && (h.stunKind || 'hit'), v.st === 'launch' && 'launch', v.st === 'knockdown' && 'knockdown', v.crouch && 'crouch', air(e) && 'air', 'idle'].find(x => x && b.poses[x]) ?? null; if (b.pose !== want) api.setPose(e, want); }
        if (config.locomotion && !busy && !air(e) && v.st === 'free') {
          if (v.dashReq) { v.st = 'dash'; v.t = 0; vel[0] = ph.dash * sc * 60 * v.dashReq * facingSign(e); v.dashReq = 0; rt.emit('dash', { who: e.id }); }
          else if (d >= 7) { v.st = 'prejump'; v.t = 0; v.jumpDir = d === 9 ? 1 : d === 7 ? -1 : 0; vel[0] = 0; }
          else if (d === 6) vel[0] = ph.walk * sc * 60 * facingSign(e);
          else if (d === 4) vel[0] = -ph.back * sc * 60 * facingSign(e);
          else vel[0] = 0;
        } else if (!air(e) && (m.st === 'attack' || stunned(e)) && v.st !== 'launch') vel[0] *= 0.7;
        if (v.st === 'dash') { vel[0] *= 0.9; if (v.t >= 16) { v.st = 'free'; vel[0] = 0; } }
        if (v.st === 'prejump' && v.t >= 4) { v.st = 'jump'; vel[1] = ph.jumpV * sc * 60; vel[0] = v.jumpDir * ph.jumpX * sc * 60 * facingSign(e); rt.emit('jump', { who: e.id }); }
        if (v.st === 'knockdown') { vel[0] *= 0.8; if (v.t >= config.knockdownFrames) { v.st = 'wakeup'; v.t = 0; grantInvuln(e, config.wakeupInvuln); } }
        else if (v.st === 'wakeup' && v.t >= config.wakeupFrames) { v.st = 'free'; v.juggle = 0; v.throwProt = 4; if (h) { h.stun = 0; } }
        // Gravity while airborne (melee rise/hop/dive moves set body.vel themselves).
        const airborne = p[1] > config.floor + 1e-6 || vel[1] > 0;
        if (airborne) {
          const grav = ph.gravity * sc * 60 * (v.st === 'launch' ? 0.92 : 1);
          const travel = m.st === 'attack' && melee().moves(e)[m.move]?.behavior === 'travel' && m.phase === 'active';
          if (!travel) vel[1] = Math.max(vel[1] - grav, -15 * sc * 60);
          if (e.components.knockback && v.st === 'launch') { vel[0] *= 0.955; if (vel[1] > 0) vel[1] *= 0.97; }
        }
        p[0] += vel[0] / 60 + v.pv; p[1] += vel[1] / 60;
        v.pv *= 0.8; if (Math.abs(v.pv) < 1e-4) v.pv = 0;
        if (p[1] <= config.floor && (airborne || p[1] < config.floor)) {
          p[1] = config.floor; const was = v.st; vel[1] = 0; b.grounded = true;
          if (was === 'launch') { v.st = 'knockdown'; v.t = 0; v.juggle = 0; vel[0] *= 0.4; if (h) { h.stun = config.knockdownFrames + config.wakeupFrames; h.stunKind = 'knockdown'; } if (m) m.st = 'knockdown'; rt.emit('knockdown', { who: e.id }); }
          else if (was === 'jump') { v.st = 'free'; vel[0] = 0; if (m && m.st === 'attack' && melee().moves(e)[m.move]?.air) { const mv = melee().moves(e)[m.move]; m.st = 'land'; m.landT = mv.landRecovery; m.move = null; m.phase = null; } }
          else if (m?.st === 'fall') { m.st = 'land'; vel[0] = 0; }
        } else b.grounded = p[1] <= config.floor + 1e-6;
        if (v.st === 'wakeup' && v.t === 1) rt.emit('wakeup', { who: e.id });
        p[0] = Math.max(config.walls[0] + hw(e), Math.min(config.walls[1] - hw(e), p[0]));
        b.vel = like(Array.isArray(b.vel) ? b.vel : [0, 0], vel.map(x => round(x)));
        setPos(e, p.map(x => round(x)));
      }
      // Body separation and the screen limit.
      for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
        const a = fs[i], c = fs[j]; if (a.space !== c.space || a.components.melee.hidden || c.components.melee.hidden || a.components.melee.st === 'thrown' || c.components.melee.st === 'thrown') continue;
        const pa = gpos(a), pc = gpos(c), need = hw(a) + hw(c), dx = pc[0] - pa[0];
        const overlapY = Math.abs(pa[1] - pc[1]) < physOf(a).h * scale() * 0.75;
        if (overlapY && Math.abs(dx) < need) {
          const s = Math.sign(dx) || facingSign(a), push = (need - Math.abs(dx)) / 2;
          pa[0] -= s * push; pc[0] += s * push;
          for (const [f, q, o] of [[a, pa, pc], [c, pc, pa]]) { const lo = config.walls[0] + hw(f), hi = config.walls[1] - hw(f); if (q[0] < lo) { o[0] += lo - q[0]; q[0] = lo; } else if (q[0] > hi) { o[0] -= q[0] - hi; q[0] = hi; } }
        }
        if (config.maxSep > 0) { const sep = pc[0] - pa[0]; if (Math.abs(sep) > config.maxSep) { const over = (Math.abs(sep) - config.maxSep) / 2 * Math.sign(sep); pa[0] += over; pc[0] -= over; } }
        setPos(a, pa.map(x => round(x))); setPos(c, pc.map(x => round(x)));
      }
    }, KEY);
    rt.on('died', ({ who }) => { const e = rt.entity(who); if (e?.components.versus) { e.components.versus.st = 'ko'; } });
  },
};
export { statOf };
