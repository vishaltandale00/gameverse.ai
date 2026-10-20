// Turn-based battles (CONTRACT.md §2): one active creature per side, priority/speed turn order,
// statuses, stat stages, items, capture, escape, experience, level-ups and move learning.
//
// A battle is plain JSON. The player's party array is the game's party, mutated in place; the game
// writes it back when the battle ends (a save taken mid-battle holds its own copy).
//
// Driving a battle:
//   needsInput(battle)            → what the player must answer next
//   chooseAction(battle, action)  → records the action (or answers a switch/learn prompt at once)
//   resolveTurn(content, battle, rng) → plays the turn; returns { events, battle }
//   battleResult(battle)          → the outcome once it's over
import { STAGE_STATS, settingsOf } from '../content.js';
import { moveOf, statsOf, summary, levelUp, newMovesAt, learnSlot, expToLevel, speciesOf, lookup, STRUGGLE } from './stats.js';
import { calcDamage, accMult, clampStage, stageMult } from './damage.js';
import { attemptCapture } from './capture.js';
import { foeAction, bestMatchup } from './ai.js';
import { chance, range, rand, int } from './random.js';

const freshStages = () => Object.fromEntries(STAGE_STATS.map(s => [s, 0]));
const freshVol = () => ({ confusion: 0, flinch: false, protect: false, protectChain: 0 });
const firstAlive = party => Math.max(0, party.findIndex(c => c.hp > 0));
const STAT_NAMES = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed', acc: 'accuracy', eva: 'evasiveness' };
const STATUS_TEXT = { burn: 'was burned', poison: 'was poisoned', paralysis: 'is paralyzed! It may be unable to move', sleep: 'fell asleep', freeze: 'was frozen solid', confusion: 'became confused' };

/**
 * Start a battle. foeTrainer: { id, name, class?, prize? } for trainer, leader and champion battles.
 */
export function startBattle(content, { kind = 'wild', player, foe, foeTrainer = null, rng }) {
  void rng;
  const battle = {
    kind, difficulty: settingsOf(content).difficulty, turn: 0, over: false, outcome: null, money: 0, expTotal: 0,
    player: { party: player, active: firstAlive(player), stages: freshStages(), vol: freshVol() },
    foe: { party: foe, active: firstAlive(foe), stages: freshStages(), vol: freshVol(), trainer: foeTrainer, healUsed: false },
    participants: [], leveled: [], escapeAttempts: 0, action: null, mustSwitch: false, learnQueue: [], captured: null,
  };
  battle.participants.push(player[battle.player.active].uid);
  return battle;
}

const active = side => side.party[side.active];
const otherSide = (battle, side) => (side === battle.player ? battle.foe : battle.player);
const sideName = (battle, side) => (side === battle.player ? 'player' : 'foe');
/** Display name for a side's active creature. */
function nameOf(battle, side, c = active(side)) {
  if (side === battle.player) return c.name;
  return `${battle.kind === 'wild' ? 'Wild' : 'Foe'} ${c.name}`;
}

/** What the battle needs from the player next. */
export function needsInput(battle) {
  if (battle.learnQueue.length) { const q = battle.learnQueue[0]; return { kind: 'learn', move: q.move, uid: q.uid }; }
  if (battle.over) return null;
  if (battle.mustSwitch) return { kind: 'switch' };
  if (!battle.action) return { kind: 'action' };
  return null;
}

export function battleResult(battle) {
  if (!battle.over || battle.learnQueue.length) return null;
  return { outcome: battle.outcome, exp: battle.expTotal, money: battle.money, captured: battle.captured };
}

/**
 * Record the player's choice. Switch prompts (after a faint) and learn prompts are answered at once
 * and their events returned; ordinary actions wait for resolveTurn. Returns { ok, events }.
 * Actions: { kind: 'move', index } | { kind: 'switch', index } | { kind: 'item', item, target? } | { kind: 'run' }
 *        | { kind: 'learn', forget: moveIndex | null }  (answer to a learn prompt; null keeps the old moves)
 */
export function chooseAction(battle, action) {
  const need = needsInput(battle);
  const party = battle.player.party;
  if (need?.kind === 'learn') {
    if (action.kind !== 'learn') return { ok: false, events: [] };
    const q = battle.learnQueue.shift();
    const c = party.find(x => x.uid === q.uid);
    if (!c) return { ok: true, events: [] };
    if (action.forget == null || !c.moves[action.forget]) return { ok: true, events: [{ type: 'learn', uid: c.uid, move: q.move, learned: false, text: `${c.name} did not learn ${q.name}.` }] };
    const old = c.moves[action.forget];
    c.moves[action.forget] = { id: q.move, pp: q.pp, max: q.pp };
    return { ok: true, events: [{ type: 'learn', uid: c.uid, move: q.move, forgot: old.id, learned: true, text: `${c.name} forgot ${q.forgetName?.[action.forget] || old.id} and learned ${q.name}!` }] };
  }
  if (!need) return { ok: false, events: [] };
  if (need.kind === 'switch') {
    const c = party[action.index];
    if (action.kind !== 'switch' || !c || c.hp <= 0) return { ok: false, events: [] };
    battle.mustSwitch = false;
    return { ok: true, events: [switchIn(battle, battle.player, action.index, null)] };
  }
  if (action.kind === 'move') {
    const c = active(battle.player);
    const anyPp = c.moves.some(m => m.pp > 0);
    if (anyPp && !(c.moves[action.index]?.pp > 0)) return { ok: false, events: [{ type: 'text', text: 'There\'s no PP left for this move!' }] };
    battle.action = anyPp ? { kind: 'move', index: action.index } : { kind: 'move', index: -1 };
  } else if (action.kind === 'switch') {
    const c = party[action.index];
    if (!c || c.hp <= 0 || action.index === battle.player.active) return { ok: false, events: [{ type: 'text', text: c && c.hp <= 0 ? `${c.name} has no energy left to battle!` : `${c?.name || 'It'} is already out!` }] };
    battle.action = { kind: 'switch', index: action.index };
  } else if (action.kind === 'item') battle.action = { kind: 'item', item: action.item, target: action.target ?? battle.player.active };
  else if (action.kind === 'run') {
    if (battle.kind !== 'wild') return { ok: false, events: [{ type: 'text', text: 'No! There\'s no running from a trainer battle!' }] };
    battle.action = { kind: 'run' };
  } else return { ok: false, events: [] };
  return { ok: true, events: [] };
}

function switchIn(battle, side, index, back) {
  const prev = active(side);
  side.active = index; side.stages = freshStages(); side.vol = freshVol(); side.faintedUid = null;
  const c = active(side), who = sideName(battle, side);
  if (side === battle.player && !battle.participants.includes(c.uid)) battle.participants.push(c.uid);
  const trainer = battle.foe.trainer?.name;
  const text = side === battle.player ? (back ? `Come back, ${prev.name}! Go, ${c.name}!` : `Go, ${c.name}!`) : `${trainer || 'The foe'} sent out ${c.name}!`;
  return { type: 'switch', side: who, index, creature: { ...c }, text };
}

/** Play one turn. The player's action must have been chosen. */
export function resolveTurn(content, battle, rng) {
  const events = [];
  const emit = e => { events.push(e); return e; };
  if (battle.over || !battle.action) return { events, battle };
  const pa = battle.action;
  battle.action = null;
  battle.turn++;
  const fa = foeAction(content, battle, rng);

  // Escape (wild battles only).
  if (pa.kind === 'run') {
    battle.escapeAttempts++;
    const me = statsOf(content, active(battle.player)).spe, foe = statsOf(content, active(battle.foe)).spe;
    const f = (Math.floor(me * 128 / Math.max(1, foe)) + 30 * battle.escapeAttempts) % 256;
    if (me >= foe || int(rng, 256) < f) {
      emit({ type: 'run', success: true, text: 'Got away safely!' });
      end(battle, 'run', emit);
      return { events, battle };
    }
    emit({ type: 'run', success: false, text: 'Can\'t escape!' });
  }

  // Switches and items go before moves.
  if (pa.kind === 'switch') emit(switchIn(battle, battle.player, pa.index, true));
  if (pa.kind === 'item') useItem(content, battle, pa, rng, emit);
  if (battle.over) return { events, battle };
  if (fa.kind === 'heal') foeHeal(content, battle, emit);

  // Moves: priority, then speed, ties by RNG.
  const movers = [];
  if (pa.kind === 'move') movers.push({ side: battle.player, index: pa.index });
  if (fa.kind === 'move') movers.push({ side: battle.foe, index: fa.index });
  const prio = m => (m.index < 0 ? STRUGGLE : moveOf(content, active(m.side).moves[m.index].id)).priority || 0;
  const tie = movers.length === 2 ? rand(rng) : 0;
  movers.sort((a, b) => prio(b) - prio(a) || speedOf(content, b.side) - speedOf(content, a.side) || (tie < 0.5 ? -1 : 1));
  for (const [order, m] of movers.entries()) {
    if (battle.over || active(m.side).hp <= 0) continue;
    if (m.side === battle.player && battle.mustSwitch) continue;
    useMove(content, battle, m.side, m.index, rng, emit, order === 0 && movers.length === 2);
    settleFaints(content, battle, rng, emit, false);
  }

  // Residual damage from burn and poison.
  for (const side of [battle.player, battle.foe]) {
    if (battle.over) break;
    const c = active(side);
    if (c.hp <= 0 || (c.status !== 'burn' && c.status !== 'poison')) continue;
    const max = statsOf(content, c).hp;
    const dmg = Math.min(c.hp, Math.max(1, Math.floor(max / (c.status === 'burn' ? 16 : 8))));
    c.hp -= dmg;
    emit({ type: 'damage', side: sideName(battle, side), amount: dmg, hp: c.hp, maxHp: max, cause: c.status, text: `${nameOf(battle, side)} is hurt by its ${c.status === 'burn' ? 'burn' : 'poison'}!` });
    settleFaints(content, battle, rng, emit, false);
  }
  for (const side of [battle.player, battle.foe]) { side.vol.flinch = false; side.vol.protect = false; }
  if (!battle.over) settleFaints(content, battle, rng, emit, true);
  return { events, battle };
}

function speedOf(content, side) {
  const c = active(side);
  return Math.floor(statsOf(content, c).spe * stageMult(side.stages.spe) * (c.status === 'paralysis' ? 0.5 : 1));
}

function end(battle, outcome, emit, text) {
  battle.over = true; battle.outcome = outcome;
  emit({ type: 'end', outcome, money: battle.money, ...(text ? { text } : {}) });
}

/**
 * After any damage: faint events, experience for the foe's faint, the trainer's next creature and the
 * player's forced switch. `endOfTurn` sends in foe replacements (a fainted foe is replaced after the turn).
 */
function settleFaints(content, battle, rng, emit, endOfTurn) {
  // faintedUid remembers whose faint was already reported, so repeated checks in one turn stay quiet.
  for (const side of [battle.foe, battle.player]) {
    const c = active(side);
    if (c.hp > 0 || side.faintedUid === c.uid) continue;
    side.faintedUid = c.uid;
    emit({ type: 'faint', side: sideName(battle, side), text: `${nameOf(battle, side)} fainted!` });
    if (side === battle.foe) awardExp(content, battle, c, emit);
    else battle.participants = battle.participants.filter(u => u !== c.uid);
  }
  if (!battle.player.party.some(c => c.hp > 0)) { end(battle, 'lose', emit, 'You have no more creatures that can fight!'); return; }
  if (!battle.foe.party.some(c => c.hp > 0)) {
    if (battle.foe.trainer) battle.money = battle.foe.trainer.prize ?? 0;
    end(battle, 'win', emit);
    return;
  }
  if (active(battle.player).hp <= 0) battle.mustSwitch = true;
  if (endOfTurn && active(battle.foe).hp <= 0) {
    const next = bestMatchup(content, battle.foe.party, active(battle.player), battle.foe.active);
    emit(switchIn(battle, battle.foe, next, false));
    // Experience for the new foe goes to whoever faces it.
    const cur = active(battle.player);
    battle.participants = cur.hp > 0 ? [cur.uid] : [];
  }
}

/** floor(expYield × level / 7), ×1.5 in trainer battles, split among the creatures that took part. */
export function expFor(content, battleKind, foe) {
  const base = Math.floor(speciesOf(content, foe.species).expYield * foe.level / 7);
  return battleKind === 'wild' ? base : Math.floor(base * 1.5);
}

function awardExp(content, battle, foe, emit) {
  const total = expFor(content, battle.kind, foe);
  const takers = battle.player.party.filter(c => c.hp > 0 && battle.participants.includes(c.uid));
  if (!takers.length) return;
  const share = Math.max(1, Math.floor(total / takers.length));
  for (const c of takers) {
    if (c.level >= 100) continue;
    c.exp += share;
    battle.expTotal += share;
    const growth = speciesOf(content, c.species).growth;
    emit({ type: 'exp', uid: c.uid, amount: share, exp: c.exp, level: c.level, bar: expBar(growth, c), text: `${c.name} gained ${share} EXP. Points!` });
    while (c.level < 100 && c.exp >= expToLevel(growth, c.level + 1)) {
      const { before, after } = levelUp(content, c);
      if (!battle.leveled.includes(c.uid)) battle.leveled.push(c.uid);
      emit({ type: 'levelup', uid: c.uid, level: c.level, before, after, hp: c.hp, maxHp: after.hp, bar: expBar(growth, c), text: `${c.name} grew to level ${c.level}!` });
      for (const id of newMovesAt(content, c)) {
        const move = moveOf(content, id);
        if (c.moves.length < 4) {
          c.moves.push(learnSlot(content, id));
          emit({ type: 'learn', uid: c.uid, move: id, learned: true, text: `${c.name} learned ${move.name}!` });
        } else {
          battle.learnQueue.push({ uid: c.uid, move: id, name: move.name, pp: move.pp, forgetName: c.moves.map(m => moveOf(content, m.id).name) });
          emit({ type: 'learnPrompt', uid: c.uid, move: id, text: `${c.name} wants to learn ${move.name}, but it already knows four moves.` });
        }
      }
    }
  }
}

/** EXP bar for a creature: thresholds of this level and the next. */
export function expBar(growth, c) {
  return { from: expToLevel(growth, c.level), to: c.level >= 100 ? expToLevel(growth, 100) : expToLevel(growth, c.level + 1), now: c.exp };
}

function useItem(content, battle, action, rng, emit) {
  const item = lookup(content).items.get(action.item);
  if (!item) return;
  const party = battle.player.party;
  if (item.kind === 'ball') {
    emit({ type: 'item', item: item.id, text: `You threw a ${item.name}!` });
    if (battle.kind !== 'wild') { emit({ type: 'text', text: 'The trainer blocked it! Don\'t be a thief!' }); return; }
    const foe = active(battle.foe);
    const { shakes, success } = attemptCapture(content, foe, item.value || 1, rng);
    for (let i = 0; i < Math.min(3, shakes); i++) emit({ type: 'shake', n: i + 1 });
    emit({ type: 'capture', item: item.id, shakes, success, species: foe.species, text: success ? `Gotcha! ${foe.name} was caught!` : ['Oh no! It broke free!', 'Aww! It appeared to be caught!', 'Aargh! Almost had it!', 'Shoot! It was so close, too!'][Math.min(3, shakes)] });
    if (success) { battle.captured = foe; end(battle, 'capture', emit); }
    return;
  }
  const c = party[action.target];
  const max = c ? statsOf(content, c).hp : 0;
  const isActive = action.target === battle.player.active;
  emit({ type: 'item', item: item.id, text: `You used a ${item.name}.` });
  if (!c) return;
  if (item.kind === 'heal' && c.hp > 0) {
    const amt = Math.min(max - c.hp, item.value <= 1 ? Math.floor(max * item.value) : item.value);
    c.hp += amt;
    emit({ type: 'heal', side: 'player', index: action.target, active: isActive, amount: amt, hp: c.hp, maxHp: max, text: `${c.name} recovered ${amt} HP!` });
  } else if (item.kind === 'status' && c.hp > 0) {
    c.status = null; c.sleep = 0; if (isActive) battle.player.vol.confusion = 0;
    emit({ type: 'status', side: 'player', index: action.target, active: isActive, status: null, cured: true, text: `${c.name} is cured!` });
  } else if (item.kind === 'revive' && c.hp <= 0) {
    c.hp = Math.max(1, Math.floor(max * (item.value || 0.5)));
    emit({ type: 'heal', side: 'player', index: action.target, active: false, amount: c.hp, hp: c.hp, maxHp: max, revived: true, text: `${c.name} was revived!` });
  } else emit({ type: 'text', text: 'It won\'t have any effect.' });
}

function foeHeal(content, battle, emit) {
  const side = battle.foe, c = active(side), max = statsOf(content, c).hp;
  side.healUsed = true;
  const best = (content.items || []).filter(i => i.kind === 'heal').sort((a, b) => b.value - a.value)[0];
  const amt = Math.min(max - c.hp, best ? (best.value <= 1 ? Math.floor(max * best.value) : best.value) : Math.floor(max / 2));
  c.hp += amt;
  emit({ type: 'heal', side: 'foe', amount: amt, hp: c.hp, maxHp: max, text: `${side.trainer?.name || 'The foe'} used a ${best?.name || 'Tonic'}! ${c.name} recovered ${amt} HP.` });
}

/** Pre-move checks; returns false if the creature can't act this turn. */
function canAct(content, battle, side, rng, emit) {
  const c = active(side), who = sideName(battle, side), name = nameOf(battle, side);
  if (c.status === 'sleep') {
    c.sleep--;
    if (c.sleep <= 0) { c.status = null; c.sleep = 0; emit({ type: 'status', side: who, status: null, cured: true, text: `${name} woke up!` }); }
    else { emit({ type: 'status', side: who, status: 'sleep', blocked: true, text: `${name} is fast asleep.` }); return false; }
  }
  if (c.status === 'freeze') {
    if (chance(rng, 0.2)) { c.status = null; emit({ type: 'status', side: who, status: null, cured: true, text: `${name} thawed out!` }); }
    else { emit({ type: 'status', side: who, status: 'freeze', blocked: true, text: `${name} is frozen solid!` }); return false; }
  }
  if (side.vol.flinch) { emit({ type: 'text', side: who, text: `${name} flinched and couldn't move!` }); return false; }
  if (side.vol.confusion > 0) {
    side.vol.confusion--;
    if (side.vol.confusion === 0) emit({ type: 'status', side: who, status: null, cured: true, volatile: true, text: `${name} snapped out of its confusion!` });
    else {
      emit({ type: 'status', side: who, status: 'confusion', text: `${name} is confused!` });
      if (chance(rng, 1 / 3)) {
        const { damage } = calcDamage(content, { attacker: c, defender: { ...c, species: c.species }, move: { power: 40, category: 'physical', type: null }, attStages: side.stages, defStages: side.stages, rng, crit: false });
        const dmg = Math.min(c.hp, damage), max = statsOf(content, c).hp;
        c.hp -= dmg;
        emit({ type: 'damage', side: who, amount: dmg, hp: c.hp, maxHp: max, cause: 'confusion', text: 'It hurt itself in its confusion!' });
        return false;
      }
    }
  }
  if (c.status === 'paralysis' && chance(rng, 0.25)) { emit({ type: 'status', side: who, status: 'paralysis', blocked: true, text: `${name} is paralyzed! It can't move!` }); return false; }
  return true;
}

function applyStatus(content, battle, side, status, emit) {
  const c = active(side), who = sideName(battle, side), name = nameOf(battle, side);
  if (c.hp <= 0) return false;
  if (status === 'confusion') {
    if (side.vol.confusion > 0) return false;
    return true; // the caller rolls the duration
  }
  if (c.status) return false;
  c.status = status;
  emit({ type: 'status', side: who, status, text: `${name} ${STATUS_TEXT[status]}!` });
  return true;
}

function applyStage(battle, side, stat, stages, emit) {
  const who = sideName(battle, side), name = nameOf(battle, side);
  const cur = side.stages[stat] || 0, next = clampStage(cur + stages);
  if (next === cur) { emit({ type: 'stat', side: who, stat, stages: 0, text: `${name}'s ${STAT_NAMES[stat]} won't go any ${stages > 0 ? 'higher' : 'lower'}!` }); return false; }
  side.stages[stat] = next;
  const word = Math.abs(stages) >= 2 ? (stages > 0 ? 'rose sharply' : 'harshly fell') : (stages > 0 ? 'rose' : 'fell');
  emit({ type: 'stat', side: who, stat, stages: next - cur, text: `${name}'s ${STAT_NAMES[stat]} ${word}!` });
  return true;
}

const hitCount = rng => [2, 2, 2, 3, 3, 3, 4, 5][int(rng, 8)];

function useMove(content, battle, side, index, rng, emit, movedFirst) {
  const user = active(side), foeSide = otherSide(battle, side), target = active(foeSide);
  const who = sideName(battle, side), them = sideName(battle, foeSide);
  if (!canAct(content, battle, side, rng, emit)) { side.vol.protectChain = 0; return; }
  const slot = index >= 0 ? user.moves[index] : null;
  const move = slot ? moveOf(content, slot.id) : STRUGGLE;
  if (slot) slot.pp = Math.max(0, slot.pp - 1);
  const e = move.effect;
  emit({ type: 'move', side: who, move: move.id, moveType: move.type, category: move.category, text: `${nameOf(battle, side)} used ${move.name}!` });

  if (e?.kind === 'protect') {
    if (chance(rng, 1 / 2 ** side.vol.protectChain)) { side.vol.protect = true; side.vol.protectChain++; emit({ type: 'protect', side: who, text: `${nameOf(battle, side)} protected itself!` }); }
    else { side.vol.protectChain = 0; emit({ type: 'fail', side: who, text: 'But it failed!' }); }
    return;
  }
  side.vol.protectChain = 0;
  const selfTarget = move.category === 'status' && (e?.kind === 'heal' || (e?.kind === 'stat' && e.target === 'self'));
  if (!selfTarget && foeSide.vol.protect) { emit({ type: 'protect', side: them, blocked: true, text: `${nameOf(battle, foeSide)} protected itself!` }); return; }
  if (!selfTarget && move.accuracy != null) {
    const p = move.accuracy / 100 * accMult(clampStage((side.stages.acc || 0) - (foeSide.stages.eva || 0)));
    if (!chance(rng, p)) { emit({ type: 'miss', side: who, text: `${nameOf(battle, side)}'s attack missed!` }); return; }
  }

  if (move.category === 'status') {
    if (!e) { emit({ type: 'fail', text: 'But nothing happened!' }); return; }
    if (e.kind === 'heal') {
      const max = statsOf(content, user).hp;
      if (user.hp >= max) { emit({ type: 'fail', text: 'But it failed!' }); return; }
      const amt = Math.min(max - user.hp, Math.max(1, Math.floor(max * e.fraction)));
      user.hp += amt;
      emit({ type: 'heal', side: who, amount: amt, hp: user.hp, maxHp: max, text: `${nameOf(battle, side)} regained health!` });
    } else if (e.kind === 'stat') {
      if (chance(rng, (e.chance ?? 100) / 100)) applyStage(battle, e.target === 'self' ? side : foeSide, e.stat, e.stages, emit);
      else emit({ type: 'fail', text: 'But it failed!' });
    } else if (e.kind === 'status') {
      if (!chance(rng, (e.chance ?? 100) / 100) || !inflict(content, battle, foeSide, e.status, rng, emit)) emit({ type: 'fail', text: 'But it failed!' });
    } else emit({ type: 'fail', text: 'But it failed!' });
    return;
  }

  // Damaging move.
  const hits = e?.kind === 'multihit' ? Math.max(e.min, Math.min(e.max, hitCount(rng))) : 1;
  let total = 0, landed = 0, eff = 1;
  const max = statsOf(content, target).hp;
  for (let h = 0; h < hits && target.hp > 0; h++) {
    const r = calcDamage(content, { attacker: user, defender: target, move, attStages: side.stages, defStages: foeSide.stages, rng });
    eff = r.eff;
    if (r.eff === 0) { emit({ type: 'effective', side: them, mult: 0, text: `It doesn't affect ${nameOf(battle, foeSide)}...` }); return; }
    const dmg = Math.min(target.hp, r.damage);
    target.hp -= dmg; total += dmg; landed++;
    emit({ type: 'damage', side: them, amount: dmg, hp: target.hp, maxHp: max, crit: r.crit, eff: r.eff, moveType: move.type });
    if (r.crit) emit({ type: 'crit', side: them, text: 'A critical hit!' });
  }
  if (eff > 1) emit({ type: 'effective', side: them, mult: eff, text: 'It\'s super effective!' });
  else if (eff < 1) emit({ type: 'effective', side: them, mult: eff, text: 'It\'s not very effective...' });
  if (hits > 1) emit({ type: 'text', text: `Hit ${landed} time${landed === 1 ? '' : 's'}!` });
  if (e?.kind === 'drain' && total > 0 && user.hp > 0) {
    const umax = statsOf(content, user).hp, amt = Math.min(umax - user.hp, Math.max(1, Math.floor(total * e.fraction)));
    if (amt > 0) { user.hp += amt; emit({ type: 'heal', side: who, amount: amt, hp: user.hp, maxHp: umax, text: `${nameOf(battle, foeSide)} had its energy drained!` }); }
  }
  if (e?.kind === 'recoil' && total > 0) {
    const umax = statsOf(content, user).hp, amt = Math.min(user.hp, Math.max(1, Math.floor(total * e.fraction)));
    user.hp -= amt;
    emit({ type: 'damage', side: who, amount: amt, hp: user.hp, maxHp: umax, cause: 'recoil', text: `${nameOf(battle, side)} is hit with recoil!` });
  }
  if (target.hp > 0 && e) {
    if (e.kind === 'status' && chance(rng, (e.chance ?? 100) / 100)) inflict(content, battle, foeSide, e.status, rng, emit);
    else if (e.kind === 'stat' && chance(rng, (e.chance ?? 100) / 100)) applyStage(battle, e.target === 'self' ? side : foeSide, e.stat, e.stages, emit);
    else if (e.kind === 'flinch' && movedFirst && chance(rng, (e.chance ?? 100) / 100)) foeSide.vol.flinch = true;
  }
}

function inflict(content, battle, side, status, rng, emit) {
  if (!applyStatus(content, battle, side, status, emit)) return false;
  const c = active(side);
  if (status === 'sleep') c.sleep = range(rng, 1, 3);
  if (status === 'confusion') {
    side.vol.confusion = range(rng, 2, 5);
    emit({ type: 'status', side: sideName(battle, side), status: 'confusion', volatile: true, text: `${nameOf(battle, side)} ${STATUS_TEXT.confusion}!` });
  }
  return true;
}

export { summary };
