// gameplay.cards: card play on top of gameplay.turns. Draw/hand/discard/
// exhaust piles, energy (fixed per turn, or growing mana in duels), block,
// card-game modifiers (strength, dexterity, vulnerable, weak, frail, poison,
// thorns), cards as data in content.cards with effects, and two formats:
//  - roguelike (Slay the Spire): a persistent deck, enemies with intents
//    (components.cards.intents, cycled or weighted), hand discarded each turn,
//    card rewards after won battles;
//  - duel (Hearthstone-like): two decks, growing mana, minions on a board
//    (taunt, charge), minion and hero attacks, fatigue from empty decks.
// Turn boundaries come from gameplay.turns (sides map to owners). Hit points
// stay with gameplay.combat.health: unblocked damage runs its `damage` effect.
import { compare } from '../../kernel/logic.js';
import { alive, sortedEntities, err, runBound, bindRoles, matchesAny } from './modes-lib-util.js';

const ID = 'gameplay.cards';
const TYPES = ['attack', 'skill', 'power', 'minion', 'spell', 'curse', 'status'];
const TARGETS = ['enemy', 'self', 'none', 'all_enemies', 'random_enemy', 'minion', 'any'];
const MODS = ['strength', 'dexterity', 'vulnerable', 'weak', 'frail', 'poison', 'thorns', 'energy_next', 'draw_next', 'barricade'];
const DECAYS = ['vulnerable', 'weak', 'frail'];

export default {
  id: ID,
  card: {
    intent: 'Card battles over gameplay.turns: deck, draw, hand, discard and exhaust piles, energy or growing mana, block, card modifiers (strength, vulnerable, weak, poison...), cards with effects from content.cards, enemy intents (roguelike format: persistent deck and card rewards) or minion boards with taunt/charge and hero attacks (duel format).',
    views: ['ui', 'board'],
    params: {
      format: { type: 'string', options: ['roguelike', 'duel'], default: 'roguelike', effect: 'enemy intents and persistent deck, or two-deck duel with minions' },
      deck: { type: 'list', of: { type: 'ref', to: 'card' }, default: [], effect: "the player's starting deck" },
      energy: { type: 'integer', default: 3, min: 0, max: 20, effect: 'energy per turn (roguelike) or starting mana (duel)' },
      energyMax: { type: 'integer', default: 10, min: 1, max: 30, effect: 'duel mana cap; mana grows by one each turn' },
      handSize: { type: 'integer', default: 5, min: 0, max: 20, effect: 'cards drawn each turn (roguelike) / opening hand (duel)' },
      drawPerTurn: { type: 'integer', default: 1, min: 0, max: 10, effect: 'duel: cards drawn at the start of each later turn' },
      maxHand: { type: 'integer', default: 10, min: 1, max: 30, effect: 'cards beyond this are discarded (burned in duels)' },
      boardSize: { type: 'integer', default: 7, min: 1, max: 20, effect: 'duel: minions per side' },
      fatigue: { type: 'boolean', default: true, effect: 'duel: drawing from an empty deck deals growing damage' },
      rewards: { type: 'object', fields: { choices: { type: 'integer', default: 3, min: 0, max: 10 }, pool: { type: 'list', of: { type: 'ref', to: 'card' }, default: [] } }, default: { choices: 3, pool: [] }, effect: 'roguelike: card choices offered after a won battle' },
      owners: { type: 'list', of: { type: 'string' }, default: [], effect: 'duel opponents (ids/archetypes/tags) whose components.cards.deck they play' },
    },
    provides: {
      events: ['battle_start', 'card_drawn', 'card_played', 'card_played:*', 'card_exhausted', 'card_discarded', 'shuffle', 'intent', 'intent_executed', 'block_gained', 'card_damage', 'minion_summoned', 'minion_attacked', 'minion_died', 'fatigue', 'card_reward', 'card_picked', 'card_invalid', 'mod_applied'],
      vars: ['cards.energy', 'cards.hand', 'cards.draw', 'cards.discard', 'cards.deck', 'cards.block'],
      services: ['cards'],
      actions: ['play_card', 'attack_with', 'pick_card'],
    },
    requires: { primitives: ['gameplay.turns', 'gameplay.combat.health'] },
    defines: [{ kind: 'card', at: 'content.cards' }],
    reads: ['content.cards'],
  },
  logic(logic) {
    logic.predicate('card_owned', {
      refs: p => [['card', p.card_owned]],
      test: (p, rt) => { const n = (rt.store(ID).deck || []).filter(c => c.card === p.card_owned).length; return ['gte', 'lte', 'gt', 'lt', 'eq', 'ne'].some(k => p[k] !== undefined) ? compare(n, p) : n > 0; },
    });
    const svc = rt => rt.service('cards');
    const ctxWho = (who, rt, c) => (who === 'target' ? c.target : who === 'owner' || who === undefined ? c.owner ?? c.self : rt.resolve(who, c)?.id ?? who);
    logic.effect('card_damage', { check: (e, p, errs) => { if (!(e.amount >= 0)) errs.push(err('effect_invalid', p, 'card_damage needs amount >= 0')); }, run: (e, rt, c) => svc(rt).damageEffect(e, c) });
    logic.effect('block', { run: (e, rt, c) => svc(rt).gainBlock(ctxWho(e.who, rt, c), e.amount ?? 0) });
    logic.effect('draw', { run: (e, rt, c) => svc(rt).draw(ctxWho(e.who, rt, c), e.count ?? 1) });
    logic.effect('gain_energy', { run: (e, rt, c) => svc(rt).gainEnergy(ctxWho(e.who, rt, c), e.amount ?? 1) });
    logic.effect('discard', { run: (e, rt, c) => svc(rt).discard(ctxWho(e.who, rt, c), e.count ?? 1, Boolean(e.random)) });
    logic.effect('add_card', { refs: e => [['card', e.card]], run: (e, rt, c) => svc(rt).addCard(ctxWho(e.who, rt, c), e.card, e.pile ?? 'hand', e.count ?? 1) });
    logic.effect('card_mod', { check: (e, p, errs) => { if (!MODS.includes(e.mod)) errs.push(err('effect_invalid', `${p}.mod`, `mod must be ${MODS.join('|')}`)); }, run: (e, rt, c) => svc(rt).mod(ctxWho(e.who, rt, c), e.mod, e.amount ?? 1) });
    logic.effect('add_to_deck', { refs: e => [['card', e.card]], run: (e, rt) => svc(rt).addToDeck(e.card) });
    logic.effect('remove_from_deck', { refs: e => [['card', e.card]], run: (e, rt) => svc(rt).removeFromDeck(e.card) });
  },
  validate(config, doc, ctx) {
    const errors = [], cards = doc.content?.cards || [];
    if (!Array.isArray(cards) || !cards.length) errors.push(err('cards_missing', 'content.cards', 'gameplay.cards needs content.cards'));
    (Array.isArray(cards) ? cards : []).forEach((c, i) => {
      const path = `content.cards[${i}]`;
      if (!Number.isInteger(c.cost ?? 0) || (c.cost ?? 0) < -1) errors.push(err('card_invalid', `${path}.cost`, 'cost must be an integer >= -1 (-1 = X: spend all)'));
      if (c.type && !TYPES.includes(c.type)) errors.push(err('card_invalid', `${path}.type`, `type must be ${TYPES.join('|')}`));
      if (c.target && !TARGETS.includes(c.target)) errors.push(err('card_invalid', `${path}.target`, `target must be ${TARGETS.join('|')}`));
      if (c.type === 'minion' && !(c.power >= 0 && c.health > 0)) errors.push(err('card_invalid', path, 'minions need power >= 0 and health > 0'));
      for (const key of ['effects', 'onDeath']) (c[key] || []).forEach((e, k) => ctx.checkEffect(e, `${path}.${key}[${k}]`, errors));
      if (c.when) ctx.checkPredicate(c.when, `${path}.when`, errors);
    });
    (doc.content?.archetypes || []).forEach((a, i) => (a.components?.cards?.intents || []).forEach((t, j) => {
      const path = `content.archetypes[${i}].components.cards.intents[${j}]`;
      if (!['attack', 'block', 'buff', 'debuff', 'effect'].includes(t.kind)) errors.push(err('intent_invalid', `${path}.kind`, 'kind must be attack|block|buff|debuff|effect'));
      if ((t.kind === 'buff' || t.kind === 'debuff') && !MODS.includes(t.mod)) errors.push(err('intent_invalid', `${path}.mod`, `mod must be ${MODS.join('|')}`));
      (t.do || []).forEach((e, k) => ctx.checkEffect(e, `${path}.do[${k}]`, errors));
    }));
    if (config.format === 'roguelike' && !config.deck.length) errors.push(err('cards_deck_empty', 'with.deck', 'the player needs a starting deck'));
    if (config.format === 'duel' && !config.owners.length) errors.push(err('cards_owners', 'with.owners', 'duel format needs at least one opponent in owners'));
    return errors;
  },
  install(rt, config) {
    const defs = () => new Map((rt.doc.content?.cards || []).map(c => [c.id, c]));
    const st = () => {
      const s = rt.store(ID);
      s.deck ??= config.deck.map(card => ({ card })); s.owners ??= {}; s.fighters ??= {}; s.enemies ??= {}; s.uid ??= 1; s.reward ??= null;
      return s;
    };
    const turns = () => rt.service('turns');
    const unitSide = id => turns().view()?.sides.find(x => x.units.some(u => u.id === id))?.id ?? null;
    const sideControl = side => turns().view()?.sides.find(x => x.id === side)?.control ?? 'ai';
    const fighter = (s, id) => (s.fighters[id] ??= { block: 0, mods: {} });
    const isOwner = id => Boolean(st().owners[id]);
    const opponentsOf = id => {
      const side = unitSide(id); const v = turns().view(); if (!v) return [];
      return v.sides.filter(x => x.id !== side).flatMap(x => x.units.filter(u => !u.downed && !u.fallen).map(u => u.id)).filter(t => alive(rt.entity(t)));
    };
    const shuffle = list => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rt.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
    const mk = (s, card) => ({ uid: `c${s.uid++}`, card });

    function beginBattle(s) {
      s.owners = {}; s.fighters = {}; s.enemies = {}; s.reward = null; s.over = false;
      const owners = ['player', ...sortedEntities(rt).filter(e => e.id !== 'player' && matchesAny(e, config.owners)).map(e => e.id)];
      for (const id of owners) {
        const deck = id === 'player' ? s.deck.map(c => c.card) : rt.entity(id)?.components.cards?.deck || [];
        const D = defs(), cards = shuffle(deck.map(c => mk(s, c)));
        const innate = cards.filter(c => D.get(c.card)?.innate); const rest = cards.filter(c => !D.get(c.card)?.innate);
        s.owners[id] = { draw: [...rest, ...innate], hand: [], discard: [], exhaust: [], energy: 0, energyMax: config.format === 'duel' ? config.energy - 1 : config.energy, board: [], fatigue: 0, turns: 0, powers: [] };
        fighter(s, id);
      }
      for (const e of sortedEntities(rt)) if (e.components.cards?.intents?.length && !s.owners[e.id]) { s.enemies[e.id] = { i: -1, intent: null }; fighter(s, e.id); chooseIntent(s, e.id); }
      rt.emit('battle_start', { format: config.format, owners, enemies: Object.keys(s.enemies) });
    }
    function chooseIntent(s, id) {
      const list = rt.entity(id)?.components.cards?.intents || [], q = s.enemies[id]; if (!list.length || !q) return;
      if ((rt.entity(id).components.cards.pattern ?? 'cycle') === 'random') {
        const total = list.reduce((t, x) => t + (x.weight ?? 1), 0); let r = rt.random() * total, k = 0;
        for (; k < list.length - 1; k++) { r -= list[k].weight ?? 1; if (r < 0) break; }
        q.i = k;
      } else q.i = (q.i + 1) % list.length;
      q.intent = { ...list[q.i] };
      rt.emit('intent', { who: id, intent: q.intent });
    }
    function drawOne(s, id) {
      const o = s.owners[id]; if (!o) return null;
      if (!o.draw.length) {
        if (config.format === 'duel') { if (config.fatigue) { o.fatigue++; rt.emit('fatigue', { who: id, amount: o.fatigue }); hurt(id, o.fatigue, id); } return null; }
        if (!o.discard.length) return null;
        o.draw = shuffle(o.discard); o.discard = []; rt.emit('shuffle', { who: id });
      }
      const c = o.draw.pop();
      if (o.hand.length >= config.maxHand) { o.discard.push(c); rt.emit('card_discarded', { who: id, card: c.card, burned: true }); return null; }
      o.hand.push(c); rt.emit('card_drawn', { who: id, card: c.card, uid: c.uid });
      return c;
    }
    function hurt(id, amount, by) { if (amount > 0 && rt.entity(id)) rt.run([{ do: 'damage', who: id, amount, by }]); }
    function dealDamage(s, from, to, base) {
      const fm = fighter(s, from).mods, D = s.fighters[to] ?? fighter(s, to);
      let amount = base + (fm.strength ?? 0);
      if (fm.weak > 0) amount *= 0.75;
      if (D.mods.vulnerable > 0) amount *= 1.5;
      amount = Math.max(0, Math.floor(amount));
      const minion = minionByUid(s, to);
      if (minion) { minion.m.health -= amount; rt.emit('card_damage', { from, to, amount, blocked: 0 }); if (minion.m.health <= 0) killMinion(s, minion.owner, minion.m); return; }
      const blocked = Math.min(D.block, amount); D.block -= blocked;
      rt.emit('card_damage', { from, to, amount: amount - blocked, blocked });
      hurt(to, amount - blocked, from);
      if (D.mods.thorns > 0 && from !== to && amount > 0) hurt(from, D.mods.thorns, to);
    }
    function gainBlock(s, id, base) {
      const m = fighter(s, id).mods; let amount = base + (m.dexterity ?? 0); if (m.frail > 0) amount *= 0.75;
      amount = Math.max(0, Math.floor(amount)); fighter(s, id).block += amount; rt.emit('block_gained', { who: id, amount });
    }
    function applyMod(s, id, mod, amount) { const m = fighter(s, id).mods; m[mod] = (m[mod] ?? 0) + amount; if (!m[mod]) delete m[mod]; rt.emit('mod_applied', { who: id, mod, amount }); }
    const minionByUid = (s, uid) => { for (const [owner, o] of Object.entries(s.owners)) { const m = o.board.find(x => x.uid === uid); if (m) return { owner, m }; } return null; };
    function killMinion(s, owner, m) {
      const o = s.owners[owner]; o.board = o.board.filter(x => x !== m);
      rt.emit('minion_died', { who: owner, uid: m.uid, card: m.card });
      const def = defs().get(m.card); if (def?.onDeath?.length) runBound(rt, def.onDeath, { actor: owner, owner, target: opponentsOf(owner)[0] ?? owner }, { owner });
    }

    function startTurn(s, id) {
      const o = s.owners[id], f = fighter(s, id); o.turns++;
      if (!f.mods.barricade) f.block = 0;
      if (f.mods.poison > 0) { hurt(id, f.mods.poison, null); f.mods.poison--; if (!f.mods.poison) delete f.mods.poison; }
      if (config.format === 'duel') { o.energyMax = Math.min(config.energyMax, o.energyMax + 1); o.energy = o.energyMax; }
      else { o.energy = config.energy + (f.mods.energy_next ?? 0); delete f.mods.energy_next; }
      const n = config.format === 'duel' ? (o.turns === 1 ? config.handSize : config.drawPerTurn) : config.handSize + (f.mods.draw_next ?? 0);
      delete f.mods.draw_next;
      for (let i = 0; i < n; i++) drawOne(s, id);
      for (const m of o.board) { m.sick = false; m.attacked = false; }
    }
    function endTurnFor(s, id) {
      const o = s.owners[id], f = fighter(s, id), D = defs();
      if (config.format === 'roguelike') {
        for (const c of o.hand.splice(0)) {
          const def = D.get(c.card);
          if (def?.retain) o.hand.push(c);
          else if (def?.ethereal) { o.exhaust.push(c); rt.emit('card_exhausted', { who: id, card: c.card }); }
          else o.discard.push(c);
        }
      }
      for (const k of DECAYS) if (f.mods[k] > 0 && --f.mods[k] === 0) delete f.mods[k];
    }
    function enemyTurn(s, id) {
      const q = s.enemies[id], e = rt.entity(id); if (!q?.intent || !alive(e)) return;
      const f = fighter(s, id); if (!f.mods.barricade) f.block = 0;
      if (f.mods.poison > 0) { hurt(id, f.mods.poison, null); f.mods.poison--; if (!f.mods.poison) delete f.mods.poison; if (!alive(rt.entity(id))) return; }
      const t = q.intent, foe = 'player';
      if (t.kind === 'attack') for (let k = 0; k < (t.times ?? 1); k++) dealDamage(s, id, foe, t.value ?? 0);
      if (t.kind === 'block' || t.block) gainBlock(s, id, t.kind === 'block' ? t.value ?? 0 : t.block);
      if (t.kind === 'buff') applyMod(s, id, t.mod, t.value ?? 1);
      if (t.kind === 'debuff') applyMod(s, foe, t.mod, t.value ?? 1);
      if (t.do?.length) runBound(rt, t.do, { actor: id, owner: id, target: foe }, { owner: id, target: foe });
      rt.emit('intent_executed', { who: id, intent: t });
      for (const k of DECAYS) if (f.mods[k] > 0 && --f.mods[k] === 0) delete f.mods[k];
      chooseIntent(s, id);
    }

    function playCard(s, owner, uid, target) {
      const o = s.owners[owner], fail = reason => { rt.emit('card_invalid', { who: owner, uid, reason }); return false; };
      if (!o || s.over) return fail('no_battle');
      if (turns().current()?.side !== unitSide(owner)) return fail('not_your_turn');
      const c = o.hand.find(x => x.uid === uid); if (!c) return fail('not_in_hand');
      const def = defs().get(c.card); if (!def) return fail('unknown_card');
      if (def.unplayable || def.type === 'curse' || def.type === 'status') return fail('unplayable');
      const cost = def.cost ?? 0, x = cost === -1 ? o.energy : cost;
      if (x > o.energy) return fail('energy');
      if (def.when && !rt.test(bindRoles(def.when, { owner, actor: owner }), { self: owner })) return fail('condition');
      const kind = def.target ?? (def.type === 'attack' ? 'enemy' : 'none');
      const foes = opponentsOf(owner), foeMinions = Object.entries(s.owners).filter(([id]) => id !== owner && unitSide(id) !== unitSide(owner)).flatMap(([, q]) => q.board.map(m => m.uid));
      if (kind === 'enemy' && !foes.includes(target) && !foeMinions.includes(target)) return fail('bad_target');
      if (kind === 'minion' && !foeMinions.includes(target)) return fail('bad_target');
      if (kind === 'any' && !foes.includes(target) && !foeMinions.includes(target) && target !== owner) return fail('bad_target');
      if (def.type === 'minion' && o.board.length >= config.boardSize) return fail('board_full');
      o.energy -= x;
      o.hand = o.hand.filter(h => h !== c);
      const tgt = kind === 'random_enemy' ? foes[Math.floor(rt.random() * foes.length)] : kind === 'self' ? owner : target ?? null;
      if (def.type === 'minion') { const m = { uid: c.uid, card: c.card, power: def.power, health: def.health, max: def.health, keywords: def.keywords || [], sick: !(def.keywords || []).includes('charge'), attacked: false }; o.board.push(m); rt.emit('minion_summoned', { who: owner, uid: m.uid, card: c.card }); }
      rt.emitTyped('card_played', c.card, { who: owner, card: c.card, uid: c.uid, target: tgt, cost: x });
      runBound(rt, def.effects || [], { actor: owner, owner, target: tgt ?? owner, x }, { owner, target: tgt, card: c.card, x });
      if (def.type === 'power') o.powers.push(c);
      else if (def.type === 'minion') {} // on the board
      else if (def.exhaust) { o.exhaust.push(c); rt.emit('card_exhausted', { who: owner, card: c.card }); }
      else o.discard.push(c);
      return true;
    }
    function attackWith(s, owner, uid, target) {
      const o = s.owners[owner], fail = reason => { rt.emit('card_invalid', { who: owner, uid, reason }); return false; };
      if (!o || s.over || turns().current()?.side !== unitSide(owner)) return fail('not_your_turn');
      const m = o.board.find(x => x.uid === uid); if (!m) return fail('no_minion');
      if (m.sick || m.attacked || m.power <= 0) return fail('cannot_attack');
      const enemyOwners = Object.keys(s.owners).filter(id => unitSide(id) !== unitSide(owner));
      const taunts = enemyOwners.flatMap(id => s.owners[id].board.filter(x => x.keywords.includes('taunt')).map(x => x.uid));
      const hero = target === 'hero' ? enemyOwners[0] : enemyOwners.includes(target) ? target : null;
      const def = hero ? null : minionByUid(s, target);
      if (!hero && !def) return fail('bad_target');
      if (taunts.length && (hero || !taunts.includes(target))) return fail('taunt');
      m.attacked = true;
      rt.emit('minion_attacked', { who: owner, uid, target: hero ?? target });
      if (hero) hurt(hero, m.power, owner);
      else { const d = def.m; d.health -= m.power; m.health -= d.power; if (d.health <= 0) killMinion(s, def.owner, d); if (m.health <= 0) killMinion(s, owner, m); }
      return true;
    }
    // Greedy opponent for duel owners on non-player sides: play the costliest affordable card, then attack.
    function aiStep(s, id) {
      const o = s.owners[id], D = defs(), foes = opponentsOf(id);
      const playable = o.hand.map(c => ({ c, d: D.get(c.card) })).filter(({ d }) => d && (d.cost ?? 0) <= o.energy && !d.unplayable && d.type !== 'curse' && d.type !== 'status' && (d.type !== 'minion' || o.board.length < config.boardSize))
        .sort((a, b) => (b.d.cost ?? 0) - (a.d.cost ?? 0) || (a.c.uid < b.c.uid ? -1 : 1));
      for (const { c, d } of playable) {
        const kind = d.target ?? (d.type === 'attack' ? 'enemy' : 'none');
        const enemyMinions = Object.entries(s.owners).filter(([k]) => unitSide(k) !== unitSide(id)).flatMap(([, q]) => q.board.map(m => m.uid));
        const t = kind === 'enemy' || kind === 'any' ? foes[0] : kind === 'minion' ? enemyMinions[0] : undefined;
        if ((kind === 'enemy' || kind === 'minion') && !t) continue;
        if (playCard(s, id, c.uid, t)) return true;
      }
      for (const m of o.board) {
        if (m.sick || m.attacked || m.power <= 0) continue;
        const taunts = Object.entries(s.owners).filter(([k]) => unitSide(k) !== unitSide(id)).flatMap(([, q]) => q.board.filter(x => x.keywords.includes('taunt')).map(x => x.uid));
        if (attackWith(s, id, m.uid, taunts[0] ?? 'hero')) return true;
      }
      return false;
    }

    rt.on('turns_start', () => beginBattle(st()));
    rt.on('turn_start', d => {
      const s = st(); if (!d.side && config.format !== 'roguelike') return;
      for (const id of Object.keys(s.owners)) if (!d.side || unitSide(id) === d.side) startTurn(s, id);
      const enemies = Object.keys(s.enemies).filter(id => !d.side || unitSide(id) === d.side);
      if (enemies.length) s.pendingEnemies = enemies;
      if (d.side && sideControl(d.side) !== 'player' && Object.keys(s.owners).some(id => unitSide(id) === d.side)) s.aiOwner = d.side;
    });
    rt.on('turn_end', d => { const s = st(); for (const id of Object.keys(s.owners)) if (!d.side || unitSide(id) === d.side) endTurnFor(s, id); });
    rt.on('turns_over', d => {
      const s = st(); s.over = true; s.pendingEnemies = null; s.aiOwner = null;
      if (config.format === 'roguelike' && d.winner && d.winner === unitSide('player') && config.rewards.choices && config.rewards.pool.length) {
        const pool = config.rewards.pool.slice(); s.reward = [];
        while (s.reward.length < config.rewards.choices && pool.length) s.reward.push(pool.splice(Math.floor(rt.random() * pool.length), 1)[0]);
        rt.emit('card_reward', { choices: s.reward.slice() });
      }
    });

    const ownerFor = v => (v?.owner && st().owners[v.owner] && sideControl(unitSide(v.owner)) === 'player' ? v.owner : 'player');
    rt.action('play_card', v => { const s = st(); playCard(s, ownerFor(v), typeof v === 'string' ? v : v.uid, v?.target); });
    rt.action('attack_with', v => { const s = st(); attackWith(s, ownerFor(v), v.uid, v.target); });
    rt.action('pick_card', v => {
      const s = st(); if (!s.reward) return;
      const card = typeof v === 'number' ? s.reward[v - 1] : s.reward.includes(v) ? v : null; // ids, or 1-based index ('skip' takes nothing)
      if (card) { s.deck.push({ card }); rt.emit('card_picked', { card }); }
      s.reward = null;
    });

    rt.system('rules', rt => {
      const s = st();
      if (s.pendingEnemies) { const list = s.pendingEnemies; s.pendingEnemies = null; for (const id of list) enemyTurn(s, id); if (!s.over && turns().isActive() && turns().current()?.side && list.every(id => unitSide(id) === turns().current().side)) turns().endTurn(); }
      if (s.aiOwner && !s.over && turns().current()?.side === s.aiOwner) {
        const ids = Object.keys(s.owners).filter(id => unitSide(id) === s.aiOwner);
        if (!ids.some(id => aiStep(s, id))) { s.aiOwner = null; turns().endTurn(); }
      }
      const o = s.owners.player, v = rt.state.vars;
      v['cards.energy'] = o?.energy ?? 0; v['cards.hand'] = o?.hand.length ?? 0; v['cards.draw'] = o?.draw.length ?? 0; v['cards.discard'] = o?.discard.length ?? 0;
      v['cards.deck'] = s.deck.length; v['cards.block'] = s.fighters.player?.block ?? 0;
    }, ID);

    rt.options(rt => {
      const s = st(), o = s.owners.player; if (!o || s.over || turns().current()?.side !== unitSide('player')) return s.reward ? [...s.reward.map(c => ({ label: `pick ${c}`, actions: { pick_card: c } })), { label: 'skip reward', actions: { pick_card: 'skip' } }] : [];
      const D = defs(), foes = opponentsOf('player'), out = [];
      for (const c of o.hand) {
        const d = D.get(c.card); if (!d || (d.cost === -1 ? 0 : d.cost ?? 0) > o.energy) continue;
        const kind = d.target ?? (d.type === 'attack' ? 'enemy' : 'none');
        if (kind === 'enemy' || kind === 'any') for (const t of foes) out.push({ label: `play ${c.card} ${c.uid} on ${t}`, actions: { play_card: { uid: c.uid, target: t } } });
        else out.push({ label: `play ${c.card} ${c.uid}`, actions: { play_card: { uid: c.uid } } });
      }
      for (const m of o.board) if (!m.sick && !m.attacked) out.push({ label: `attack with ${m.card} ${m.uid}`, actions: { attack_with: { uid: m.uid, target: 'hero' } } });
      return out;
    });

    rt.provide('cards', {
      damageEffect(e, c) {
        const s = st(), from = c.owner ?? c.self ?? 'player';
        const targets = e.who === 'all_enemies' ? opponentsOf(from) : e.who === 'random_enemy' ? [opponentsOf(from)[Math.floor(rt.random() * Math.max(1, opponentsOf(from).length))]].filter(Boolean) : [e.who === 'owner' ? from : e.who === undefined || e.who === 'target' ? c.target : e.who];
        for (const t of targets) for (let k = 0; k < (e.times ?? 1); k++) if (t) dealDamage(s, from, rt.resolve(t, c)?.id ?? t, e.amount ?? 0);
      },
      gainBlock: (id, n) => gainBlock(st(), id, n),
      draw: (id, n) => { for (let i = 0; i < n; i++) drawOne(st(), id); },
      gainEnergy: (id, n) => { const o = st().owners[id]; if (o) o.energy += n; },
      discard: (id, n, random) => { const o = st().owners[id]; if (!o) return; for (let i = 0; i < n && o.hand.length; i++) { const k = random ? Math.floor(rt.random() * o.hand.length) : o.hand.length - 1; const [c] = o.hand.splice(k, 1); o.discard.push(c); rt.emit('card_discarded', { who: id, card: c.card }); } },
      addCard: (id, card, pile, n) => { const s = st(), o = s.owners[id]; if (!o) return; for (let i = 0; i < n; i++) (o[pile] ?? o.hand).push(mk(s, card)); },
      mod: (id, mod, n) => applyMod(st(), id, mod, n),
      addToDeck: card => { st().deck.push({ card }); },
      removeFromDeck: card => { const s = st(), i = s.deck.findIndex(c => c.card === card); if (i >= 0) s.deck.splice(i, 1); },
      play: (owner, uid, target) => playCard(st(), owner, uid, target),
      view(owner = 'player') {
        const s = st(), o = s.owners[owner]; if (!o) return null;
        const D = defs();
        return {
          hand: o.hand.map(c => { const d = D.get(c.card) || {}; return { uid: c.uid, card: c.card, name: d.name ?? c.card, cost: d.cost ?? 0, type: d.type ?? null, text: d.text ?? '', target: d.target ?? (d.type === 'attack' ? 'enemy' : 'none'), playable: (d.cost === -1 ? 0 : d.cost ?? 0) <= o.energy && !d.unplayable }; }),
          piles: { draw: o.draw.length, discard: o.discard.length, exhaust: o.exhaust.length }, energy: o.energy, energyMax: config.format === 'duel' ? o.energyMax : config.energy,
          block: s.fighters[owner]?.block ?? 0, mods: { ...(s.fighters[owner]?.mods || {}) },
          board: o.board.map(m => ({ uid: m.uid, card: m.card, power: m.power, health: m.health, canAttack: !m.sick && !m.attacked, keywords: m.keywords })),
          enemies: Object.keys(s.enemies).filter(id => alive(rt.entity(id))).map(id => ({ id, name: rt.entity(id)?.components.name ?? id, block: s.fighters[id]?.block ?? 0, intent: s.enemies[id].intent ? { ...s.enemies[id].intent, label: `${s.enemies[id].intent.kind}${s.enemies[id].intent.value != null ? ` ${s.enemies[id].intent.value}` : ''}${(s.enemies[id].intent.times ?? 1) > 1 ? `x${s.enemies[id].intent.times}` : ''}` } : null })),
          opponents: Object.keys(s.owners).filter(id => id !== owner).map(id => ({ id, hand: s.owners[id].hand.length, board: s.owners[id].board.map(m => ({ uid: m.uid, card: m.card, power: m.power, health: m.health, keywords: m.keywords })), energy: s.owners[id].energy })),
          reward: s.reward,
        };
      },
    });
  },
};
