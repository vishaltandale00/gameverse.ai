// CPU opponent. It plays through the same input path as a person: every special is a motion
// macro fed into the fighter's input buffer, every block is held back, so the CPU can only do
// what the player can. Difficulty (1-5, from content) sets reaction time and the odds of
// blocking, reading high/low, anti-airing, punishing, finishing combos and teching throws.
// All rolls use the game RNG in state, so CPU behaviour replays exactly.
import { random } from '../../kernel/rng.js';
import { phaseOf, SUPER_COST } from './moves.js';
import { motionFrames, toInput, CHARGE } from './input.js';
import { ARENA } from './arena.js';

export const LEVELS = [
  null,
  { react: 26, block: 0.16, read: 0.35, anti: 0.1, punish: 0.1, combo: 0.22, proj: 0.25, aggro: 0.3, tech: 0.05, wait: [16, 34], jumpIn: 0.1, mistake: 0.18, superUse: 0.15 },
  { react: 19, block: 0.36, read: 0.5, anti: 0.28, punish: 0.3, combo: 0.45, proj: 0.45, aggro: 0.42, tech: 0.15, wait: [11, 26], jumpIn: 0.14, mistake: 0.08, superUse: 0.4 },
  { react: 14, block: 0.56, read: 0.65, anti: 0.5, punish: 0.55, combo: 0.65, proj: 0.6, aggro: 0.52, tech: 0.3, wait: [8, 18], jumpIn: 0.17, mistake: 0.04, superUse: 0.6 },
  { react: 10, block: 0.72, read: 0.8, anti: 0.7, punish: 0.75, combo: 0.82, proj: 0.75, aggro: 0.58, tech: 0.45, wait: [6, 14], jumpIn: 0.2, mistake: 0.02, superUse: 0.8 },
  { react: 7, block: 0.85, read: 0.9, anti: 0.85, punish: 0.9, combo: 0.95, proj: 0.88, aggro: 0.64, tech: 0.6, wait: [4, 10], jumpIn: 0.22, mistake: 0, superUse: 0.95 },
];
const PREF = { zoner: 250, balanced: 150, rushdown: 95, grappler: 72 };
const CANCELLABLE = ['uppercut', 'fireball', 'spin_kick', 'flurry', 'slide', 'ground_wave'];
const NEUTRAL = { x: 0, y: 0, a: false, b: false };
const FREE_ST = new Set(['idle', 'walk', 'crouch', 'guard']);
const sign = v => v > 0 ? 1 : v < 0 ? -1 : 0;

export const newBrain = level => ({ level: Math.max(1, Math.min(5, level | 0)), macro: [], plan: null, key: null, seenAt: 0, choice: null, intent: 'approach', wait: 0, punishKey: null, recSeen: -1, techKey: null, finish: null, pressed: false });

const hold = (n, x, y) => Array.from({ length: n }, () => [x, y, 0, 0]);
const press = (x, y, btn) => [x, y, btn === 'a' ? 1 : 0, btn === 'b' ? 1 : 0];

function specialMacro(me, sp, btn) {
  if (sp.motion === 'charge-bf' && (me.charge.b >= CHARGE || me.charge.bm > 0)) return [press(1, 0, btn)];
  if (sp.motion === 'charge-du' && (me.charge.d >= CHARGE || me.charge.dm > 0)) return [press(0, -1, btn)];
  return motionFrames(sp.motion, btn);
}

export function cpuInput(game, state, me, opp) {
  const br = me.cpu, L = LEVELS[br.level], F = game.roster[me.fid];
  const R = () => random(state);
  const out = (rx, y, a = 0, b = 0) => ({ x: rx * me.facing, y, a: !!a, b: !!b });
  const phase = state.phase;
  if (phase === 'finish') return finisher(state, me, opp, br, L, R, out);
  if (phase !== 'fight') { br.macro = []; br.plan = null; return NEUTRAL; }

  // Macros run first: honest frame-by-frame inputs with hit-confirm checkpoints.
  while (br.macro.length && br.macro[0] === 'confirm') {
    br.macro.shift();
    const hit = opp.st === 'hit' || opp.st === 'launch';
    if (!(hit && R() < L.combo)) { br.macro = []; break; }
  }
  if (br.macro.length) return toInput(br.macro.shift(), me.facing);

  const dx = opp.x - me.x, dist = Math.abs(dx);
  const om = opp.st === 'attack' ? game.roster[opp.fid].moves[opp.move] : null;
  const has = arch => F.specials.find(s => s.archetype === arch && !(s.air && !me.air && F.specials.some(o => !o.air && o.motion === s.motion)));
  const projOut = state.projectiles.some(p => p.owner === me.slot);
  const queue = list => { br.macro = list.slice(); return br.macro.length ? toInput(br.macro.shift(), me.facing) : NEUTRAL; };
  const blockOut = low => out(-1, low ? 1 : 0);

  // Platform recovery: get back to the stage before anything else.
  if (game.platform) { const r = recover(game, state, me, opp, br, F, R, out, queue, has); if (r) return r; }

  // Stuck states: hold block for when control returns; tech throws.
  if (me.st === 'thrown') {
    if (br.techKey !== opp.n - opp.t) { br.techKey = opp.n - opp.t; br.techGo = R() < L.tech; br.techAt = 2 + Math.floor(R() * 6); }
    return br.techGo && me.t === br.techAt ? out(0, 0, 1, 1) : NEUTRAL;
  }
  if (['hit', 'launch', 'knockdown', 'wakeup', 'ko', 'dazed', 'throw', 'land', 'climb', 'respawn'].includes(me.st)) {
    br.plan = br.plan === 'jumpin' ? null : br.plan;
    if (me.st === 'ledge') return out(1, 0);
    return br.choice === 'block' ? blockOut(br.low) : (R() < L.block * 0.5 ? blockOut(true) : NEUTRAL);
  }
  if (me.st === 'ledge') return me.t > 6 + br.level * 2 ? out(1, 0) : NEUTRAL;

  // Jump-in plan: kick on the way down, then confirm into a combo on landing.
  if (br.plan === 'jumpin') {
    if (me.air) return me.vy < 1 && dist < 78 && me.y < 80 && !me.airUsed ? out(0, 0, 0, 1) : out(0, 0);
    br.plan = null;
    if ((opp.st === 'hit' || opp.st === 'block') && me.st !== 'attack') return queue(comboRoute(F, me, 'heavy', has));
  }
  if (me.st === 'attack' || me.st === 'prejump' || me.air) return NEUTRAL;

  // ---- threats: attacks, projectiles, jump-ins ----
  const proj = state.projectiles.filter(p => p.owner === opp.slot && sign(p.vx) === sign(me.x - p.x)).sort((p, q) => Math.abs(p.x - me.x) - Math.abs(q.x - me.x))[0];
  let key = null, kind = null;
  if (om && phaseOf(om, opp.mf) !== 'recovery' && om.damage > 0 && dist < reachOf(om) + 40) { key = `m${opp.n - opp.mf}`; kind = 'attack'; }
  else if (proj && Math.abs(proj.x - me.x) < 280) { key = `p${proj.id}`; kind = 'proj'; }
  else if (opp.air && (opp.st === 'air' || opp.st === 'attack') && dist < 190 && sign(opp.vx) !== -sign(dx)) { key = `j${opp.n - opp.t}`; kind = 'jump'; }
  if (key !== br.key) { br.key = key; br.seenAt = state.frame; br.choice = null; }
  if (key && state.frame - br.seenAt >= L.react) {
    if (br.choice == null) {
      const r = R();
      if (kind === 'attack') {
        br.choice = r < L.block ? 'block' : 'none';
        const correct = R() < L.read, lowMove = om.level === 'low', over = om.level === 'overhead';
        br.low = correct ? (lowMove || (!over && R() < 0.6)) : R() < 0.5;
        if (over && correct) br.low = false;
      } else if (kind === 'proj') {
        if (r < L.proj) br.choice = has('fireball') && !projOut && R() < 0.3 ? 'counterfire' : dist > 150 && R() < 0.45 ? 'jump' : 'block';
        else br.choice = 'none';
        br.low = proj.level === 'low' || (proj.level === 'mid' && R() < 0.5);
      } else {
        br.choice = r < L.anti ? 'anti' : r < L.anti + L.block * 0.5 ? 'block' : 'none';
        br.low = false;
      }
    }
    switch (br.choice) {
      case 'block': return blockOut(br.low);
      case 'jump': br.choice = 'none'; br.plan = 'jumpin'; return queue([[1, -1, 0, 0], [1, -1, 0, 0]]);
      case 'counterfire': br.choice = 'none'; return queue(specialMacro(me, has('fireball'), 'a'));
      case 'anti': {
        const up = has('uppercut');
        if (up && dist < 150 && opp.y < 150) { br.choice = 'none'; return queue(specialMacro(me, up, 'b')); }
        if (!up && dist < 105 && opp.y < 110) { br.choice = 'none'; return queue([press(0, 0, 'b')]); }
        return blockOut(false);
      }
    }
  }
  if (me.st === 'block') return blockOut(br.low);

  // ---- punish recovery and landing ----
  const recovering = (om && phaseOf(om, opp.mf) === 'recovery' && om.total - opp.mf >= 7) || (opp.st === 'land' && opp.landT - opp.t >= 6) || opp.st === 'fall';
  if (recovering) {
    const pk = `r${opp.n - opp.t}`;
    if (br.recKey !== pk) { br.recKey = pk; br.recSeen = state.frame; br.punishGo = R() < L.punish; }
    if (br.punishGo && state.frame - br.recSeen >= Math.round(L.react * 0.5) && dist < 120 && !opp.air) {
      br.punishGo = false;
      if (me.meter >= SUPER_COST && R() < L.superUse) return queue(motionFrames('qcf2', 'b'));
      return queue(comboRoute(F, me, dist < 70 ? 'light' : 'heavy', has));
    }
  }
  // Juggle a launched opponent.
  if (opp.st === 'launch' && opp.juggle < 3 && dist < 110 && opp.y < 90 && opp.vy < 0 && !game.platform) {
    const up = has('uppercut');
    if (up && br.jugKey !== opp.n - opp.t) { br.jugKey = opp.n - opp.t; if (R() < L.combo * 0.6) return queue(specialMacro(me, up, 'a')); }
  }
  if (opp.st === 'knockdown' || opp.st === 'wakeup') return dist > 80 ? out(1, 0) : out(-1, 1);

  // ---- platform pursuit: hop up to a rival on a platform, drop down to one below ----
  if (game.platform && !opp.air && FREE_ST.has(me.st)) {
    if (opp.y > me.y + 40 && dist < 150) return br.hopFlip = !br.hopFlip, br.hopFlip ? out(Math.sign(dx) * me.facing, -1) : out(0, 0);
    if (opp.y < me.y - 40 && me.surface === 'soft' && dist < 220) return out(0, 1);
  }
  // ---- neutral game ----
  if (--br.wait <= 0) {
    br.wait = L.wait[0] + Math.floor(R() * (L.wait[1] - L.wait[0]));
    br.intent = chooseIntent(game, state, me, opp, F, L, R, dist, has, projOut);
  }
  const pref = PREF[F.style] || 150;
  const edgeOk = rx => !game.platform || edgeSafe(me, rx);
  switch (br.intent) {
    case 'approach': return dist > pref - 20 && edgeOk(1) ? out(1, chargeY(F)) : (br.intent = 'wait', out(0, 0));
    case 'retreat': return dist < pref + 20 && edgeOk(-1) ? out(-1, chargeY(F)) : (br.intent = 'wait', out(-1, chargeY(F) ? 1 : 0));
    case 'dash': br.intent = 'approach'; return queue([[1, 0, 0, 0], [0, 0, 0, 0], [1, 0, 0, 0]]);
    case 'charge': return out(-1, 1);   // down-back charges both ways without walking away
    case 'jumpin': br.intent = 'wait'; br.plan = 'jumpin'; return queue([[1, -1, 0, 0], [1, -1, 0, 0]]);
    case 'hop': br.intent = 'wait'; return queue([[0, -1, 0, 0], [0, -1, 0, 0]]);
    case 'fireball': { br.intent = 'wait'; const sp = has('fireball') || has('ground_wave'); return sp && !projOut ? queue(specialMacro(me, sp, R() < 0.5 ? 'a' : 'b')) : NEUTRAL; }
    case 'special': { br.intent = 'wait'; const sp = br.pick; return sp ? queue(specialMacro(me, sp, R() < 0.5 ? 'a' : 'b')) : NEUTRAL; }
    case 'super': br.intent = 'wait'; return queue(motionFrames('qcf2', 'b'));
    case 'throw': br.intent = 'wait'; return dist < F.moves.throw.params.range ? queue([[1, 0, 1, 1], [0, 0, 0, 0]]) : out(1, 0);
    case 'grab': { br.intent = 'wait'; const g = has('command_grab'); return g ? queue(specialMacro(me, g, dist < 70 ? 'a' : 'b')) : NEUTRAL; }
    case 'poke': br.intent = 'wait'; return queue(R() < 0.5 ? [press(0, 1, 'b'), ...hold(4, 0, 1)] : [press(0, 0, 'b')]);
    case 'combo': br.intent = 'wait'; return queue(comboRoute(F, me, R() < 0.5 ? 'light' : 'heavy', has));
    case 'mash': br.intent = 'wait'; return queue([press(0, R() < 0.5 ? 1 : 0, R() < 0.5 ? 'a' : 'b')]);
    case 'counter': { br.intent = 'wait'; const c = has('counter'); return c ? queue(specialMacro(me, c, 'b')) : NEUTRAL; }
    default: return chargeY(F) ? out(-1, 1) : NEUTRAL;
  }
}

const chargeY = F => F.specials.some(s => s.motion === 'charge-bf' || s.motion === 'charge-du') ? 1 : 0;
function reachOf(m) {
  if (m.behavior === 'travel' || m.behavior === 'dive' || m.behavior === 'hop') return 260;
  if (m.behavior === 'grab') return m.params.range;
  return m.box ? m.box.x + m.box.w + 20 : 0;
}

function chooseIntent(game, state, me, opp, F, L, R, dist, has, projOut) {
  const pref = PREF[F.style] || 150, r = R();
  if (R() < L.mistake) return dist < 120 ? 'mash' : 'hop';
  if (me.meter >= SUPER_COST && R() < L.superUse * 0.25 && (F.moves.super.behavior === 'projectile' ? dist < 320 : dist < 150)) return 'super';
  const charged = me.charge.b >= CHARGE || me.charge.d >= CHARGE;
  const chargeMove = F.specials.find(s => s.motion === 'charge-bf' || s.motion === 'charge-du');
  if (chargeMove && charged && dist < (chargeMove.archetype === 'axe_kick' ? 120 : 200) && r < L.aggro) { me.cpu.pick = chargeMove; return 'special'; }
  if (dist <= 75) {
    if (has('command_grab') && R() < (F.style === 'grappler' ? 0.45 : 0.2) * L.aggro * 2) return 'grab';
    if (R() < (F.style === 'grappler' ? 0.3 : 0.12)) return 'throw';
    if (has('counter') && R() < 0.12) return 'counter';
    return r < L.aggro ? 'combo' : r < L.aggro + 0.2 ? 'poke' : F.style === 'zoner' ? 'retreat' : 'wait';
  }
  if (dist < 110) return r < L.aggro * 0.7 ? 'poke' : r < L.aggro ? 'approach' : (chargeMove && !charged ? 'charge' : 'wait');
  if ((has('fireball') || has('ground_wave')) && !projOut && dist > 170 && R() < (F.style === 'zoner' ? 0.6 : 0.3)) return 'fireball';
  if (dist > 120 && dist < 230 && R() < L.jumpIn) return 'jumpin';
  const mover = F.specials.find(s => ['charge_dash', 'slide', 'spin_kick', 'axe_kick', 'air_dive'].includes(s.archetype) && !s.motion.startsWith('charge'));
  if (mover && dist < 200 && R() < L.aggro * 0.25) { me.cpu.pick = mover; return 'special'; }
  if (has('teleport') && dist > 220 && R() < 0.08) { me.cpu.pick = has('teleport'); return 'special'; }
  if (chargeMove && !charged && R() < 0.5) return 'charge';
  if (dist > pref + 40) return F.style === 'rushdown' && R() < 0.35 ? 'dash' : 'approach';
  if (dist < pref - 40) return 'retreat';
  return R() < 0.4 ? 'approach' : 'wait';
}

/** Hit-confirmed combo macro: light chain into a cancel, or heavy into a special. */
function comboRoute(F, me, kind, has) {
  const sp = CANCELLABLE.map(a => has(a)).find(Boolean);
  const finish = me.meter >= SUPER_COST ? motionFrames('qcf2', 'b') : sp ? specialMacro(me, sp, 'b') : [];
  if (kind === 'light') return [press(0, 1, 'a'), ...hold(5, 0, 1), 'confirm', press(0, 1, 'a'), ...hold(5, 0, 1), 'confirm', press(0, 1, 'b'), ...hold(4, 0, 1)];
  return [press(0, 0, 'a'), ...hold(5, 0, 0), 'confirm', press(0, 0, 'b'), ...hold(14, 0, 0), 'confirm', ...finish];
}

function finisher(state, me, opp, br, L, R, out) {
  if (br.finish == null) br.finish = { go: R() < 0.3 + L.combo * 0.6, at: 30 + Math.floor(R() * 40) };
  const dist = Math.abs(opp.x - me.x);
  if (!br.finish.go) return state.pt > 200 ? out(0, 0, 0, R() < 0.1 ? 1 : 0) : NEUTRAL;
  if (dist > 140) return out(1, 0);
  if (state.pt < br.finish.at) return NEUTRAL;
  if (!br.macro.length && !br.finish.sent) { br.finish.sent = true; br.macro = motionFrames('tap-dd', 'b'); }
  return br.macro.length ? toInput(br.macro.shift(), me.facing) : NEUTRAL;
}

// ---- platform mode ----
function edgeSafe(me, rx) {
  const dir = rx * me.facing, M = ARENA.P.main;
  if (me.surface === 'soft') return true;
  return !(dir < 0 && me.x < M.x0 + 34) && !(dir > 0 && me.x > M.x1 - 34);
}
function recover(game, state, me, opp, br, F, R, out, queue, has) {
  if (!me.air || !['air', 'fall', 'attack'].includes(me.st)) return null;
  const M = ARENA.P.main, off = me.x < M.x0 + 4 || me.x > M.x1 - 4;
  if (!off && me.y >= -2) return null;
  const toward = Math.sign(ARENA.P.center - me.x) * me.facing;
  if (me.st !== 'air') return out(toward, 0);   // steer the recovery move and the fall toward the stage
  if (me.st === 'air' && me.jumps > 0 && me.vy < 0.5 && me.y < 70) { br.jumpFlip = !br.jumpFlip; return br.jumpFlip ? out(toward, -1) : out(toward, 0); }
  if (me.st === 'air' && !me.airSpecial && me.jumps <= 0 && me.vy < 0 && me.y < 30) {
    const rec = has('uppercut') || has('teleport') || F.specials.find(s => ['charge_dash', 'spin_kick'].includes(s.archetype) && !s.motion.startsWith('charge'));
    if (rec) return queue(specialMacro(me, rec, 'b'));   // the held direction on its first active frame steers it
  }
  return out(toward, 0);
}
