// gameplay.creature.battle: turn-based creature battles entered from any overworld
// (ported in depth from the creature kit rules/battle + ai).
//
// start_battle moves the player into a battle space (typically engine.space.none) and
// back afterwards. Each turn the player picks an action through the `battle` verb
// (move / switch / item / run, answers to forced-switch and learn prompts); the foe AI
// picks its own; the turn resolves at once with gameplay.turns semantics (turn_start,
// turn_end). Rules: priority then speed (paralysis halves, ties random), accuracy/
// evasion stages, the damage formula (crit, roll 85-100, STAB, type chart, burn),
// statuses (burn/poison residual, paralysis 25 % skip, sleep 1-3 turns, freeze 20 %
// thaw, confusion 2-5 turns with 1/3 self-hit at power 40), flinch, protect chains,
// drain/recoil/multihit (2,2,2,3,3,3,4,5), heal and stat moves, switching, items
// (balls via the capture service, heals, status cures, revives), escape odds
// ((spe·128/foe + 30·tries) mod 256), experience floor(yield·L/7) ×1.5 for trainers
// split among participants, level-ups, move learning prompts, evolution afterwards.
// Foe AI: wild = random usable move; trainers = best expected damage, useful status
// moves, leaders/hard heal once under 25 %, easy trainers pick at random half the time,
// best type matchup after a faint.
import { moveOf, statsOf, speciesOf, calcDamage, accMult, clampStage, stageMult, expToLevel, levelUp, newMovesAt, learnSlot, expBar, bestMove, wildMove, bestMatchup, itemRule, chance, range, int, STRUGGLE, STAGE_STATS } from './puzzle-lib-creature.js';

import { CREATURE_DATA } from './creature-party.js';
import { itemsData } from './items-lib.js';

const ID = 'gameplay.creature.battle';
const freshStages = () => Object.fromEntries(STAGE_STATS.map(s => [s, 0]));
const freshVol = () => ({ confusion: 0, flinch: false, protect: false, protectChain: 0 });
const firstAlive = party => Math.max(0, party.findIndex(c => c.hp > 0));
const STAT_NAMES = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed', acc: 'accuracy', eva: 'evasiveness' };
const STATUS_TEXT = { burn: 'was burned', poison: 'was poisoned', paralysis: 'is paralyzed! It may be unable to move', sleep: 'fell asleep', freeze: 'was frozen solid', confusion: 'became confused' };
const KINDS = ['wild', 'trainer', 'leader', 'champion'];

/** The battle engine over one battle object (JSON). ctx = { content, rand, capture? }. */
export function engine(ctx) {
  const { content, rand } = ctx;
  const active = side => side.party[side.active];
  const otherSide = (b, side) => (side === b.player ? b.foe : b.player);
  const sideName = (b, side) => (side === b.player ? 'player' : 'foe');
  const nameOf = (b, side, c = active(side)) => side === b.player ? c.name : `${b.kind === 'wild' ? 'Wild' : 'Foe'} ${c.name}`;
  const speedOf = side => { const c = active(side); return Math.floor(statsOf(content, c).spe * stageMult(side.stages.spe) * (c.status === 'paralysis' ? 0.5 : 1)); };

  function needsInput(b) {
    if (b.learnQueue.length) { const q = b.learnQueue[0]; return { kind: 'learn', move: q.move, uid: q.uid }; }
    if (b.over) return null;
    if (b.mustSwitch) return { kind: 'switch' };
    if (!b.action) return { kind: 'action' };
    return null;
  }
  function switchIn(b, side, index, back) {
    const prev = active(side);
    side.active = index; side.stages = freshStages(); side.vol = freshVol(); side.faintedUid = null;
    const c = active(side), who = sideName(b, side);
    if (side === b.player && !b.participants.includes(c.uid)) b.participants.push(c.uid);
    const text = side === b.player ? (back ? `Come back, ${prev.name}! Go, ${c.name}!` : `Go, ${c.name}!`) : `${b.foe.trainer?.name || 'The foe'} sent out ${c.name}!`;
    return { type: 'switch', side: who, index, species: c.species, text };
  }
  /** Record the player's choice; prompts (switch, learn) answer at once. Returns { ok, events }. */
  function choose(b, action) {
    const need = needsInput(b), party = b.player.party;
    if (need?.kind === 'learn') {
      if (action.kind !== 'learn') return { ok: false, events: [] };
      const q = b.learnQueue.shift(), c = party.find(x => x.uid === q.uid);
      if (!c) return { ok: true, events: [] };
      if (action.forget == null || !c.moves[action.forget]) return { ok: true, events: [{ type: 'learn', uid: c.uid, move: q.move, learned: false, text: `${c.name} did not learn ${q.name}.` }] };
      const old = c.moves[action.forget];
      c.moves[action.forget] = { id: q.move, pp: q.pp, max: q.pp };
      return { ok: true, events: [{ type: 'learn', uid: c.uid, move: q.move, forgot: old.id, learned: true, text: `${c.name} forgot ${moveOf(content, old.id)?.name || old.id} and learned ${q.name}!` }] };
    }
    if (!need) return { ok: false, events: [] };
    if (need.kind === 'switch') {
      const c = party[action.index];
      if (action.kind !== 'switch' || !c || c.hp <= 0) return { ok: false, events: [] };
      b.mustSwitch = false;
      return { ok: true, events: [switchIn(b, b.player, action.index, null)] };
    }
    if (action.kind === 'move') {
      const c = active(b.player), anyPp = c.moves.some(m => m.pp > 0);
      if (anyPp && !(c.moves[action.index]?.pp > 0)) return { ok: false, events: [{ type: 'text', text: 'There\'s no PP left for this move!' }] };
      b.action = anyPp ? { kind: 'move', index: action.index } : { kind: 'move', index: -1 };
    } else if (action.kind === 'switch') {
      const c = party[action.index];
      if (!c || c.hp <= 0 || action.index === b.player.active) return { ok: false, events: [{ type: 'text', text: c && c.hp <= 0 ? `${c.name} has no energy left to battle!` : `${c?.name || 'It'} is already out!` }] };
      b.action = { kind: 'switch', index: action.index };
    } else if (action.kind === 'item') b.action = { kind: 'item', item: action.item, target: action.target ?? b.player.active };
    else if (action.kind === 'run') {
      if (b.kind !== 'wild') return { ok: false, events: [{ type: 'text', text: 'No! There\'s no running from a trainer battle!' }] };
      b.action = { kind: 'run' };
    } else return { ok: false, events: [] };
    return { ok: true, events: [] };
  }
  function foeAction(b) {
    const side = b.foe, me = active(side);
    if (b.kind === 'wild') return { kind: 'move', index: wildMove(me, rand) };
    const t = side.trainer || {};
    const healer = (b.kind === 'leader' || b.kind === 'champion' || b.difficulty === 'hard') && !t.noHeal;
    if (healer && !side.healUsed && me.hp > 0 && me.hp < statsOf(content, me).hp * 0.25) return { kind: 'heal' };
    if ((b.difficulty === 'easy' || t.ai === 'easy') && rand() < 0.5) return { kind: 'move', index: wildMove(me, rand) };
    return { kind: 'move', index: bestMove(content, side, b.player) };
  }
  const END_TEXT = { win: 'You won the battle!', lose: 'You lost the battle.', run: 'You fled the battle.', capture: 'The battle is over.' };
  function end(b, outcome, emit, text) { b.over = true; b.outcome = outcome; emit({ type: 'end', outcome, money: b.money, text: text || (outcome === 'win' && b.money ? `You won! Got ${b.money} for winning!` : END_TEXT[outcome]) }); }
  function expFor(kind, foe) { const base = Math.floor((speciesOf(content, foe.species).expYield ?? 64) * foe.level / 7); return kind === 'wild' ? base : Math.floor(base * 1.5); }
  function awardExp(b, foe, emit) {
    const total = expFor(b.kind, foe), takers = b.player.party.filter(c => c.hp > 0 && b.participants.includes(c.uid));
    if (!takers.length) return;
    const share = Math.max(1, Math.floor(total / takers.length));
    for (const c of takers) {
      if (c.level >= 100) continue;
      c.exp += share; b.expTotal += share;
      const growth = speciesOf(content, c.species).growth;
      emit({ type: 'exp', uid: c.uid, amount: share, exp: c.exp, level: c.level, bar: expBar(growth, c), text: `${c.name} gained ${share} EXP. Points!` });
      while (c.level < 100 && c.exp >= expToLevel(growth, c.level + 1)) {
        const { before, after } = levelUp(content, c);
        if (!b.leveled.includes(c.uid)) b.leveled.push(c.uid);
        emit({ type: 'levelup', uid: c.uid, species: c.species, level: c.level, before, after, hp: c.hp, maxHp: after.hp, text: `${c.name} grew to level ${c.level}!` });
        for (const id of newMovesAt(content, c)) {
          const move = moveOf(content, id);
          if (c.moves.length < 4) { c.moves.push(learnSlot(content, id)); emit({ type: 'learn', uid: c.uid, move: id, learned: true, text: `${c.name} learned ${move.name}!` }); }
          else { b.learnQueue.push({ uid: c.uid, move: id, name: move.name, pp: move.pp }); emit({ type: 'learnPrompt', uid: c.uid, move: id, text: `${c.name} wants to learn ${move.name}, but it already knows four moves.` }); }
        }
      }
    }
  }
  function settleFaints(b, emit, endOfTurn) {
    for (const side of [b.foe, b.player]) {
      const c = active(side);
      if (c.hp > 0 || side.faintedUid === c.uid) continue;
      side.faintedUid = c.uid;
      emit({ type: 'faint', side: sideName(b, side), species: c.species, text: `${nameOf(b, side)} fainted!` });
      if (side === b.foe) awardExp(b, c, emit); else b.participants = b.participants.filter(u => u !== c.uid);
    }
    if (!b.player.party.some(c => c.hp > 0)) { end(b, 'lose', emit, 'You have no more creatures that can fight!'); return; }
    if (!b.foe.party.some(c => c.hp > 0)) { if (b.foe.trainer) b.money = b.foe.trainer.prize ?? 0; end(b, 'win', emit); return; }
    if (active(b.player).hp <= 0) b.mustSwitch = true;
    if (endOfTurn && active(b.foe).hp <= 0) {
      const next = bestMatchup(content, b.foe.party, active(b.player), b.foe.active);
      emit(switchIn(b, b.foe, next, false));
      const cur = active(b.player);
      b.participants = cur.hp > 0 ? [cur.uid] : [];
    }
  }
  function useItem(b, action, emit) {
    const item = itemRule(content, action.item); if (!item) return;
    const party = b.player.party;
    if (item.kind === 'ball') {
      emit({ type: 'item', item: item.id, text: `You threw a ${item.name}!` });
      if (b.kind !== 'wild') { emit({ type: 'text', text: 'The trainer blocked it! Don\'t be a thief!' }); return; }
      const foe = active(b.foe), bonus = ctx.capture?.bonusOf(item.id) ?? (item.value || 1);
      const { shakes, success } = ctx.capture ? ctx.capture.attempt(foe, bonus) : { shakes: 0, success: false };
      for (let i = 0; i < Math.min(3, shakes); i++) emit({ type: 'shake', n: i + 1, text: `Shake ${i + 1}...` });
      emit({ type: 'capture', item: item.id, shakes, success, species: foe.species, text: success ? `Gotcha! ${foe.name} was caught!` : ['Oh no! It broke free!', 'Aww! It appeared to be caught!', 'Aargh! Almost had it!', 'Shoot! It was so close, too!'][Math.min(3, shakes)] });
      if (success) { b.captured = foe; end(b, 'capture', emit); }
      return;
    }
    const c = party[action.target], max = c ? statsOf(content, c).hp : 0, isActive = action.target === b.player.active;
    emit({ type: 'item', item: item.id, text: `You used a ${item.name}.` });
    if (!c) return;
    if (item.kind === 'heal' && c.hp > 0) { const amt = Math.min(max - c.hp, item.value <= 1 ? Math.floor(max * item.value) : item.value); c.hp += amt; emit({ type: 'heal', side: 'player', index: action.target, amount: amt, hp: c.hp, maxHp: max, text: `${c.name} recovered ${amt} HP!` }); }
    else if (item.kind === 'status' && c.hp > 0) { c.status = null; c.sleep = 0; if (isActive) b.player.vol.confusion = 0; emit({ type: 'status', side: 'player', index: action.target, status: null, cured: true, text: `${c.name} is cured!` }); }
    else if (item.kind === 'revive' && c.hp <= 0) { c.hp = Math.max(1, Math.floor(max * (item.value || 0.5))); emit({ type: 'heal', side: 'player', index: action.target, amount: c.hp, hp: c.hp, maxHp: max, revived: true, text: `${c.name} was revived!` }); }
    else emit({ type: 'text', text: 'It won\'t have any effect.' });
  }
  function foeHeal(b, emit) {
    const side = b.foe, c = active(side), max = statsOf(content, c).hp;
    side.healUsed = true;
    const best = (content.items || []).filter(i => i.creature?.kind === 'heal').sort((x, y) => y.creature.value - x.creature.value)[0];
    const v = best?.creature.value, amt = Math.min(max - c.hp, best ? (v <= 1 ? Math.floor(max * v) : v) : Math.floor(max / 2));
    c.hp += amt;
    emit({ type: 'heal', side: 'foe', amount: amt, hp: c.hp, maxHp: max, text: `${side.trainer?.name || 'The foe'} used a ${best?.name || 'Tonic'}! ${c.name} recovered ${amt} HP.` });
  }
  function canAct(b, side, emit) {
    const c = active(side), who = sideName(b, side), name = nameOf(b, side);
    if (c.status === 'sleep') {
      c.sleep--;
      if (c.sleep <= 0) { c.status = null; c.sleep = 0; emit({ type: 'status', side: who, status: null, cured: true, text: `${name} woke up!` }); }
      else { emit({ type: 'status', side: who, status: 'sleep', blocked: true, text: `${name} is fast asleep.` }); return false; }
    }
    if (c.status === 'freeze') {
      if (chance(rand, 0.2)) { c.status = null; emit({ type: 'status', side: who, status: null, cured: true, text: `${name} thawed out!` }); }
      else { emit({ type: 'status', side: who, status: 'freeze', blocked: true, text: `${name} is frozen solid!` }); return false; }
    }
    if (side.vol.flinch) { emit({ type: 'text', side: who, text: `${name} flinched and couldn't move!` }); return false; }
    if (side.vol.confusion > 0) {
      side.vol.confusion--;
      if (side.vol.confusion === 0) emit({ type: 'status', side: who, status: null, cured: true, volatile: true, text: `${name} snapped out of its confusion!` });
      else {
        emit({ type: 'status', side: who, status: 'confusion', text: `${name} is confused!` });
        if (chance(rand, 1 / 3)) {
          const { damage } = calcDamage(content, { attacker: c, defender: c, move: { power: 40, category: 'physical', type: null }, attStages: side.stages, defStages: side.stages, rand, crit: false });
          const dmg = Math.min(c.hp, damage), max = statsOf(content, c).hp;
          c.hp -= dmg;
          emit({ type: 'damage', side: who, amount: dmg, hp: c.hp, maxHp: max, cause: 'confusion', text: 'It hurt itself in its confusion!' });
          return false;
        }
      }
    }
    if (c.status === 'paralysis' && chance(rand, 0.25)) { emit({ type: 'status', side: who, status: 'paralysis', blocked: true, text: `${name} is paralyzed! It can't move!` }); return false; }
    return true;
  }
  function applyStage(b, side, stat, stages, emit) {
    const who = sideName(b, side), name = nameOf(b, side), cur = side.stages[stat] || 0, next = clampStage(cur + stages);
    if (next === cur) { emit({ type: 'stat', side: who, stat, stages: 0, text: `${name}'s ${STAT_NAMES[stat]} won't go any ${stages > 0 ? 'higher' : 'lower'}!` }); return false; }
    side.stages[stat] = next;
    const word = Math.abs(stages) >= 2 ? (stages > 0 ? 'rose sharply' : 'harshly fell') : (stages > 0 ? 'rose' : 'fell');
    emit({ type: 'stat', side: who, stat, stages: next - cur, text: `${name}'s ${STAT_NAMES[stat]} ${word}!` });
    return true;
  }
  function inflict(b, side, status, emit) {
    const c = active(side), who = sideName(b, side), name = nameOf(b, side);
    if (c.hp <= 0) return false;
    if (status === 'confusion') {
      if (side.vol.confusion > 0) return false;
      side.vol.confusion = range(rand, 2, 5);
      emit({ type: 'status', side: who, status: 'confusion', volatile: true, text: `${name} ${STATUS_TEXT.confusion}!` });
      return true;
    }
    if (c.status) return false;
    c.status = status;
    emit({ type: 'status', side: who, status, text: `${name} ${STATUS_TEXT[status]}!` });
    if (status === 'sleep') c.sleep = range(rand, 1, 3);
    return true;
  }
  const hitCount = () => [2, 2, 2, 3, 3, 3, 4, 5][int(rand, 8)];
  function useMove(b, side, index, emit, movedFirst) {
    const user = active(side), foeSide = otherSide(b, side), target = active(foeSide), who = sideName(b, side), them = sideName(b, foeSide);
    if (!canAct(b, side, emit)) { side.vol.protectChain = 0; return; }
    const slot = index >= 0 ? user.moves[index] : null, move = slot ? moveOf(content, slot.id) : STRUGGLE;
    if (slot) slot.pp = Math.max(0, slot.pp - 1);
    const e = move.effect;
    emit({ type: 'move', side: who, move: move.id, moveType: move.type, category: move.category, text: `${nameOf(b, side)} used ${move.name}!` });
    if (e?.kind === 'protect') {
      if (chance(rand, 1 / 2 ** side.vol.protectChain)) { side.vol.protect = true; side.vol.protectChain++; emit({ type: 'protect', side: who, text: `${nameOf(b, side)} protected itself!` }); }
      else { side.vol.protectChain = 0; emit({ type: 'fail', side: who, text: 'But it failed!' }); }
      return;
    }
    side.vol.protectChain = 0;
    const selfTarget = move.category === 'status' && (e?.kind === 'heal' || (e?.kind === 'stat' && e.target === 'self'));
    if (!selfTarget && foeSide.vol.protect) { emit({ type: 'protect', side: them, blocked: true, text: `${nameOf(b, foeSide)} protected itself!` }); return; }
    if (!selfTarget && move.accuracy != null) {
      const p = move.accuracy / 100 * accMult(clampStage((side.stages.acc || 0) - (foeSide.stages.eva || 0)));
      if (!chance(rand, p)) { emit({ type: 'miss', side: who, text: `${nameOf(b, side)}'s attack missed!` }); return; }
    }
    if (move.category === 'status') {
      if (!e) { emit({ type: 'fail', text: 'But nothing happened!' }); return; }
      if (e.kind === 'heal') {
        const max = statsOf(content, user).hp;
        if (user.hp >= max) { emit({ type: 'fail', text: 'But it failed!' }); return; }
        const amt = Math.min(max - user.hp, Math.max(1, Math.floor(max * e.fraction)));
        user.hp += amt;
        emit({ type: 'heal', side: who, amount: amt, hp: user.hp, maxHp: max, text: `${nameOf(b, side)} regained health!` });
      } else if (e.kind === 'stat') { if (chance(rand, (e.chance ?? 100) / 100)) applyStage(b, e.target === 'self' ? side : foeSide, e.stat, e.stages, emit); else emit({ type: 'fail', text: 'But it failed!' }); }
      else if (e.kind === 'status') { if (!chance(rand, (e.chance ?? 100) / 100) || !inflict(b, foeSide, e.status, emit)) emit({ type: 'fail', text: 'But it failed!' }); }
      else emit({ type: 'fail', text: 'But it failed!' });
      return;
    }
    const hits = e?.kind === 'multihit' ? Math.max(e.min, Math.min(e.max, hitCount())) : 1;
    let total = 0, landed = 0, eff = 1;
    const max = statsOf(content, target).hp;
    for (let h = 0; h < hits && target.hp > 0; h++) {
      const r = calcDamage(content, { attacker: user, defender: target, move, attStages: side.stages, defStages: foeSide.stages, rand });
      eff = r.eff;
      if (r.eff === 0) { emit({ type: 'effective', side: them, mult: 0, text: `It doesn't affect ${nameOf(b, foeSide)}...` }); return; }
      const dmg = Math.min(target.hp, r.damage);
      target.hp -= dmg; total += dmg; landed++;
      emit({ type: 'damage', side: them, amount: dmg, hp: target.hp, maxHp: max, crit: r.crit, eff: r.eff, moveType: move.type, text: `${nameOf(b, foeSide)} took ${dmg} damage.` });
      if (r.crit) emit({ type: 'crit', side: them, text: 'A critical hit!' });
    }
    if (eff > 1) emit({ type: 'effective', side: them, mult: eff, text: 'It\'s super effective!' });
    else if (eff < 1) emit({ type: 'effective', side: them, mult: eff, text: 'It\'s not very effective...' });
    if (hits > 1) emit({ type: 'text', text: `Hit ${landed} time${landed === 1 ? '' : 's'}!` });
    if (e?.kind === 'drain' && total > 0 && user.hp > 0) { const umax = statsOf(content, user).hp, amt = Math.min(umax - user.hp, Math.max(1, Math.floor(total * e.fraction))); if (amt > 0) { user.hp += amt; emit({ type: 'heal', side: who, amount: amt, hp: user.hp, maxHp: umax, text: `${nameOf(b, foeSide)} had its energy drained!` }); } }
    if (e?.kind === 'recoil' && total > 0) { const umax = statsOf(content, user).hp, amt = Math.min(user.hp, Math.max(1, Math.floor(total * e.fraction))); user.hp -= amt; emit({ type: 'damage', side: who, amount: amt, hp: user.hp, maxHp: umax, cause: 'recoil', text: `${nameOf(b, side)} is hit with recoil!` }); }
    if (target.hp > 0 && e) {
      if (e.kind === 'status' && chance(rand, (e.chance ?? 100) / 100)) inflict(b, foeSide, e.status, emit);
      else if (e.kind === 'stat' && chance(rand, (e.chance ?? 100) / 100)) applyStage(b, e.target === 'self' ? side : foeSide, e.stat, e.stages, emit);
      else if (e.kind === 'flinch' && movedFirst && chance(rand, (e.chance ?? 100) / 100)) foeSide.vol.flinch = true;
    }
  }
  /** Play one turn (the player's action must be chosen). Returns the turn's events. */
  function resolveTurn(b) {
    const events = [], emit = e => { events.push(e); return e; };
    if (b.over || !b.action) return events;
    const pa = b.action; b.action = null; b.turn++;
    const fa = foeAction(b);
    if (pa.kind === 'run') {
      b.escapeAttempts++;
      const me = statsOf(content, active(b.player)).spe, foe = statsOf(content, active(b.foe)).spe;
      const f = (Math.floor(me * 128 / Math.max(1, foe)) + 30 * b.escapeAttempts) % 256;
      if (me >= foe || int(rand, 256) < f) { emit({ type: 'run', success: true, text: 'Got away safely!' }); end(b, 'run', emit); return events; }
      emit({ type: 'run', success: false, text: 'Can\'t escape!' });
    }
    if (pa.kind === 'switch') emit(switchIn(b, b.player, pa.index, true));
    if (pa.kind === 'item') useItem(b, pa, emit);
    if (b.over) return events;
    if (fa.kind === 'heal') foeHeal(b, emit);
    const movers = [];
    if (pa.kind === 'move') movers.push({ side: b.player, index: pa.index });
    if (fa.kind === 'move') movers.push({ side: b.foe, index: fa.index });
    const prio = m => (m.index < 0 ? STRUGGLE : moveOf(content, active(m.side).moves[m.index].id)).priority || 0;
    const tie = movers.length === 2 ? rand() : 0;
    movers.sort((x, y) => prio(y) - prio(x) || speedOf(y.side) - speedOf(x.side) || (tie < 0.5 ? -1 : 1));
    for (const [order, m] of movers.entries()) {
      if (b.over || active(m.side).hp <= 0) continue;
      if (m.side === b.player && b.mustSwitch) continue;
      useMove(b, m.side, m.index, emit, order === 0 && movers.length === 2);
      settleFaints(b, emit, false);
    }
    for (const side of [b.player, b.foe]) {
      if (b.over) break;
      const c = active(side);
      if (c.hp <= 0 || (c.status !== 'burn' && c.status !== 'poison')) continue;
      const max = statsOf(content, c).hp, dmg = Math.min(c.hp, Math.max(1, Math.floor(max / (c.status === 'burn' ? 16 : 8))));
      c.hp -= dmg;
      emit({ type: 'damage', side: sideName(b, side), amount: dmg, hp: c.hp, maxHp: max, cause: c.status, text: `${nameOf(b, side)} is hurt by its ${c.status === 'burn' ? 'burn' : 'poison'}!` });
      settleFaints(b, emit, false);
    }
    for (const side of [b.player, b.foe]) { side.vol.flinch = false; side.vol.protect = false; }
    if (!b.over) settleFaints(b, emit, true);
    return events;
  }
  return { needsInput, choose, resolveTurn, active, foeAction, expFor };
}

export default {
  id: ID,
  card: {
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { battle: { type: 'choice', of: 'a battle command: a move, an item, a switch or running', from: 'options', emits: ['battle_log'] } },
    loop: { shows: [], verbs: ['battle'], progress: ['creature_defeated', 'battle_end', 'caught'], win: { param: 'onWin', scope: 'encounter', once: true, reads: { event: 'creature_defeated', by: { actions: ['battle'] } } },
      lose: { param: 'onLose', shown: { var: 'party.alive', label: 'Party' }, reads: { event: 'creature_fainted', by: { actions: ['battle'] } } },
      // As an encounter: a won battle or a capture takes the foe out; a lost battle the player's side; running away leaves both.
      outcome: { sides: ['player', 'opponent'], results: { won: { param: 'onWin', player: 'keeps', opponent: 'defeated' }, lost: { param: 'onLose', player: 'defeated', opponent: 'keeps' }, fled: { param: 'onRun', player: 'keeps', opponent: 'keeps' }, caught: { param: 'onCapture', player: 'keeps', opponent: 'defeated' } } } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "section", "at": "content.species", "min": 4, "why": "battles are fought between species"},
      {"need": "section", "at": "content.moves", "min": 4, "why": "battles use moves"},
    ],
    // Creature-battle mode: menu turns against wild or trainer creatures, started by start_battle (encounters, beats).
    mode: { loop: 'creature-battle', interaction: 'menu', opponent: 'ai-rival', space: ['engine.space.none'], needs: { content: ['content.species', 'content.moves', 'content.types'], participants: null }, win: { param: 'onWin' }, lose: { param: 'onLose' }, bot: 'balance' },
    // As an encounter's inner loop: every encounter is a fresh duel (the player's creatures are healed first, so a lost
    // battle never leaves the next encounter without a creature to send out) in which the participant posing it fields
    // a creature of the document's species (a duel, not a wild catch); the opening battle waits (autoStart off): the
    // encounter starts every battle.
    engage: { encounter: { start: [{ do: 'heal_party' }, { do: 'start_battle', kind: 'trainer', foe: [{ species: '$first:content.species', level: 5 }] }], config: { autoStart: false } } },
    intent: 'Turn-based creature battles (wild, trainer, leader, champion) entered from any overworld into a battle space: moves, type chart, STAB, crits, stat stages, statuses, priority/speed order, switching, items, capture, escape, experience, move learning and evolution.',
    views: ['ui', 'any'],
    params: {
      space: { type: 'ref', to: 'space', effect: 'battle space (engine.space.none or any); the player returns afterwards. Omit to battle in place' },
      difficulty: { type: 'string', default: 'normal', options: ['easy', 'normal', 'hard'], effect: 'easy trainers often pick at random; hard trainers heal once' },
      onWin: { type: 'effects', default: [], effect: 'run after any won battle' },
      onLose: { type: 'effects', default: [], effect: 'run after a lost battle (blackout: heal_party + teleport home)' },
      onRun: { type: 'effects', default: [], effect: 'run after escaping' },
      onCapture: { type: 'effects', default: [], effect: 'run after a capture' },
      evolve: { type: 'boolean', default: true, effect: 'creatures that reached their evolution level evolve after the battle' },
      currency: { type: 'string', default: 'gold', effect: 'currency for prize money (gameplay.economy give_money when present, else var money.<currency>)' },
      opening: { type: 'object', fields: {
        kind: { type: 'string', options: KINDS, default: 'trainer', effect: 'wild, trainer, leader or champion' },
        trainer: { type: 'object', fields: { id: { type: 'string', required: true }, name: { type: 'string', display: true, effect: 'the name a person reads' }, prize: { type: 'integer', min: 0, max: 100000 } }, effect: 'the opposing trainer (trainer battles)' },
        foe: { type: 'list', min: 1, required: true, of: { type: 'object', fields: { species: { type: 'ref', to: 'species', required: true }, level: { type: 'integer', default: 5, min: 1, max: 100 } } }, effect: "the opponent's creatures" },
      }, effect: 'the battle fought from the start of the game (with autoStart): a creature battler played on its own' },
      autoStart: { type: 'boolean', default: true, effect: 'start the opening battle at game start (otherwise battles start from start_battle)' },
    },
    // Events it emits when it refuses a player's verb, with a reason (graphics.ui.hud says why).
    denials: ['battle_invalid'],
    provides: {
      events: ['battle_request', 'battle_start', 'battle_start:*', 'battle_log', 'turn_start', 'turn_end', 'battle_end', 'battle_end:*', 'creature_fainted:*', 'creature_defeated', 'creature_defeated:*', 'creature_level_up', 'creature_learned:*', 'creature_evolved:*', 'caught', 'caught:*', 'trainer_defeated', 'trainer_defeated:*', 'battle_invalid'],
      vars: ['battle.active', 'battle.turn'],
      actions: ['battle'],
      services: ['battle'],
    },
    requires: { primitives: ['gameplay.creature.party'], services: ['creatures'] },
    reads: ['content.species', 'content.moves', 'content.types', 'content.items'],
    data: { ...CREATURE_DATA, ...itemsData(['creature']) },
  },
  logic(logic) {
    logic.effect('start_battle', {
      refs: e => (e.foe || []).map(f => ['species', f.species]),
      check: (e, path, errors) => {
        if (e.kind && !KINDS.includes(e.kind)) errors.push({ code: 'effect_invalid', path: `${path}.kind`, message: `kind is ${KINDS.join('|')}` });
        if (!Array.isArray(e.foe) || !e.foe.length) errors.push({ code: 'effect_invalid', path: `${path}.foe`, message: 'start_battle needs foe: [{species, level}]' });
      },
      run: (e, rt) => rt.emit('battle_request', { kind: e.kind || (e.trainer ? 'trainer' : 'wild'), foe: e.foe, trainer: e.trainer || null, onWin: e.onWin || [], onLose: e.onLose || [] }),
    });
    logic.predicate('in_battle', { test: (p, rt) => Boolean(rt.state.prim[ID]?.battle) === (p.in_battle !== false) });
  },
  /** Solver progress in a battle: the foe party's lost hp fraction minus half the player's; battles won count 10 each. */
  progress(rt) {
    const won = (rt.state.counts['battle_end:win'] ?? 0) * 10, b = rt.state.prim[ID]?.battle; if (!b) return won;
    const lost = party => party.reduce((t, c) => { const max = statsOf(rt.doc.content, c).hp; return t + (max > 0 ? 1 - Math.max(0, c.hp) / max : 0); }, 0);
    return won + lost(b.foe.party) - 0.5 * lost(b.player.party);
  },
  install(rt, config) {
    const st = () => rt.store(ID);
    const content = () => rt.doc.content;
    const E = () => engine({ content: content(), rand: () => rt.random(), capture: rt.hasService('capture') ? rt.service('capture') : null });
    const cs = () => rt.service('creatures');
    const hasInv = () => rt.canTest('item');
    function flush(events) {
      const s = st(); s.log = (s.log || []).concat(events).slice(-60);
      for (const e of events) {
        rt.emit('battle_log', e);
        if (e.type === 'faint') { rt.emit(`creature_fainted:${e.species}`, { side: e.side }); if (e.side === 'foe') rt.emitTyped('creature_defeated', e.species, {}); }
        if (e.type === 'levelup') { rt.emit('creature_level_up', { uid: e.uid, species: e.species, level: e.level }); }
        if (e.type === 'learn' && e.learned) rt.emit(`creature_learned:${e.move}`, { uid: e.uid });
      }
    }
    function start(req) {
      const s = st(); if (s.battle) return;
      const p = rt.player();
      if (!cs().party('player').some(c => c.hp > 0)) { rt.emit('battle_invalid', { reason: 'no_creatures' }); return; }
      const party = cs().lend('player', ID);
      const foe = req.foe.map(f => cs().create(f.species, f.level ?? 5));
      for (const f of foe) cs().seen('player', f.species);
      const b = {
        kind: req.kind, difficulty: config.difficulty, turn: 0, over: false, outcome: null, money: 0, expTotal: 0,
        player: { party, active: firstAlive(party), stages: freshStages(), vol: freshVol() },
        foe: { party: foe, active: 0, stages: freshStages(), vol: freshVol(), trainer: req.trainer, healUsed: false },
        participants: [], leveled: [], escapeAttempts: 0, action: null, mustSwitch: false, learnQueue: [], captured: null,
        onWin: req.onWin, onLose: req.onLose,
      };
      b.participants.push(party[b.player.active].uid);
      s.battle = b; s.log = [];
      if (config.space && p && p.space !== config.space) { s.returnTo = { space: p.space, at: structuredClone(p.at), zone: p.zone ?? null }; rt.moveToSpace(p, config.space, null); }
      rt.state.vars['battle.active'] = 1; rt.state.vars['battle.turn'] = 0;
      rt.emitTyped('battle_start', req.kind, { foe: foe.map(f => f.species), trainer: req.trainer?.id ?? null });
      flush([{ type: 'start', kind: req.kind, text: req.trainer ? `${req.trainer.name || req.trainer.id} wants to battle!` : `A wild ${foe[0].name} appeared!` }]);
      rt.emit('turn_start', { who: 'player', turn: 1, battle: true });
    }
    function finish() {
      const s = st(), b = s.battle; if (!b) return;
      cs().setParty('player', b.player.party);
      if (config.evolve && b.leveled.length) cs().evolveReady('player');
      if (b.captured) { rt.emitTyped('caught', b.captured.species, { uid: b.captured.uid, level: b.captured.level }); cs().add('player', b.captured, { caught: true }); }
      if (b.money) { if (rt.canRun('give_money')) rt.run([{ do: 'give_money', amount: b.money, currency: config.currency }]); else { const k = `money.${config.currency}`; rt.state.vars[k] = (rt.state.vars[k] ?? 0) + b.money; } }
      if (b.foe.trainer && b.outcome === 'win') rt.emitTyped('trainer_defeated', b.foe.trainer.id, { prize: b.money });
      s.battle = null;
      if (s.returnTo) { const p = rt.player(); if (p) rt.moveToSpace(p, s.returnTo.space, s.returnTo.at, s.returnTo.zone || undefined); s.returnTo = null; }
      rt.state.vars['battle.active'] = 0;
      rt.emitTyped('battle_end', b.outcome, { outcome: b.outcome, exp: b.expTotal, money: b.money, captured: b.captured?.species ?? null });
      const fx = { win: [...config.onWin, ...(b.onWin || [])], lose: [...config.onLose, ...(b.onLose || [])], run: config.onRun, capture: config.onCapture }[b.outcome] || [];
      rt.run(fx, {});
    }
    rt.on('battle_request', start);
    // The opening battle, once, from the first step (after every primitive installed: the party exists).
    if (config.opening && config.autoStart) rt.system('rules', () => {
      const s = st(); if (s.opened) return;
      s.opened = true;
      const o = config.opening;
      start({ kind: o.kind, foe: o.foe, trainer: o.trainer ? { ...o.trainer } : null, onWin: [], onLose: [] });
    }, ID);
    rt.action('battle', v => {
      const s = st(), b = s.battle; if (!b || !v || typeof v !== 'object') return;
      const eng = E();
      if (v.kind === 'item' && v.item) {
        const rule = itemRule(content(), v.item);
        if (!rule) { rt.emit('battle_invalid', { reason: 'not_a_battle_item' }); return; }
        if (hasInv()) { if (!rt.test({ item: v.item, gte: 1 }, {})) { rt.emit('battle_invalid', { reason: 'no_item' }); return; } }
      }
      const need = eng.needsInput(b);
      const r = eng.choose(b, v);
      if (!r.ok) { rt.emit('battle_invalid', { reason: 'rejected', kind: v.kind }); flush(r.events); return; }
      if (v.kind === 'item' && hasInv()) rt.run([{ do: 'take_item', item: v.item, count: 1 }]);
      flush(r.events);
      if (need?.kind === 'action') {
        const events = eng.resolveTurn(b);
        flush(events);
        rt.emit('turn_end', { who: 'player', turn: b.turn, battle: true });
        rt.state.vars['battle.turn'] = b.turn;
        if (!b.over) rt.emit('turn_start', { who: 'player', turn: b.turn + 1, battle: true });
      }
      if (b.over && !b.learnQueue.length) finish();
    });
    /** Every answer to what the battle needs now, including disabled moves (no PP). */
    function menu(b) {
      const eng = E(), need = eng.needsInput(b); if (!need) return [];
      const party = b.player.party, me = party[b.player.active], out = [];
      // label: the solvers' unique key; text: what a person reads (the document's move, item and creature names).
      const add = (id, label, text, kind, v, extra = {}) => out.push({ id, label, text, kind, enabled: true, ...extra, action: { battle: v } });
      const moveName = id => moveOf(content(), id)?.name ?? id, itemName = it => it.name ?? it.id;
      if (need.kind === 'learn') { add('learn:keep', 'keep moves', 'Keep the moves', 'learn', { kind: 'learn', forget: null }); const c = party.find(x => x.uid === need.uid); (c?.moves || []).forEach((m, i) => add(`learn:${i}`, `forget #${i} ${m.id}`, `Forget ${moveName(m.id)}`, 'learn', { kind: 'learn', forget: i })); return out; }
      if (need.kind === 'switch') { party.forEach((c, i) => { if (c.hp > 0) add(`switch:${i}`, `send #${i} ${c.name}`, `Send out ${c.name}`, 'switch', { kind: 'switch', index: i }); }); return out; }
      if (me.moves.some(m => m.pp > 0)) me.moves.forEach((m, i) => { const mv = moveOf(content(), m.id); add(`move:${i}`, `use ${m.id}`, mv?.name ?? m.id, 'move', { kind: 'move', index: i }, { enabled: m.pp > 0, pp: m.pp, ppMax: m.max, type: mv?.type ?? null, name: mv?.name ?? m.id }); });
      else add('move:struggle', 'struggle', 'Struggle', 'move', { kind: 'move', index: 0 }, { type: null });
      party.forEach((c, i) => { if (c.hp > 0 && i !== b.player.active) add(`switch:${i}`, `switch to #${i} ${c.name}`, `Switch to ${c.name}`, 'switch', { kind: 'switch', index: i }); });
      for (const it of (content().items || []).filter(i => i.creature)) {
        if (hasInv() && !rt.test({ item: it.id, gte: 1 }, {})) continue;
        if (it.creature.kind === 'ball') { if (b.kind === 'wild') add(`item:${it.id}`, `throw ${it.id}`, `Throw ${itemName(it)}`, 'item', { kind: 'item', item: it.id }); continue; }
        party.forEach((c, i) => { const max = statsOf(content(), c).hp; if ((it.creature.kind === 'heal' && c.hp > 0 && c.hp < max) || (it.creature.kind === 'revive' && c.hp <= 0) || (it.creature.kind === 'status' && c.hp > 0 && c.status)) add(`item:${it.id}:${i}`, `${it.id} on #${i} ${c.name}`, `${itemName(it)} on ${c.name}`, 'item', { kind: 'item', item: it.id, target: i }); });
      }
      if (b.kind === 'wild') add('run', 'run', 'Run', 'run', { kind: 'run' });
      return out;
    }
    const unitsOf = (b, side) => side.party.map((c, i) => {
      const statuses = [c.status, i === side.active && side.vol.confusion > 0 ? 'confusion' : null].filter(Boolean);
      return { id: c.uid, name: c.name, species: c.species, model: speciesOf(content(), c.species)?.model ?? c.species, hp: c.hp, hpMax: statsOf(content(), c).hp, level: c.level, status: statuses, active: i === side.active, down: c.hp <= 0, stages: i === side.active ? { ...side.stages } : {} };
    });
    // Pure-read view for battle UIs (graphics.ui.battle): never mutates state.
    rt.provide('battle', {
      view() {
        const b = st().battle; if (!b) return null;
        const need = E().needsInput(b);
        return {
          active: true, kind: b.kind, turn: need ? 'player' : 'foe', number: b.turn + 1, need: need?.kind ?? null,
          trainer: b.foe.trainer ? { id: b.foe.trainer.id, name: b.foe.trainer.name } : null,
          sides: [{ id: 'player', player: true, units: unitsOf(b, b.player) }, { id: 'foe', player: false, units: unitsOf(b, b.foe) }],
          menu: menu(b),
          log: (st().log || []).slice(-12),
        };
      },
    });
    // Solver options: every enabled answer to what the battle needs now.
    rt.options(rt => {
      const b = st().battle; if (!b) return [];
      return menu(b).filter(m => m.enabled).map(m => ({ label: m.label, text: m.text, actions: m.action }));
    });
  },
};
