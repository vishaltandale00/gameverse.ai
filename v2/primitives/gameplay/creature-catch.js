// gameplay.creature.catch: capture odds and the four-shake check (creature kit rules/capture).
// a = floor((3·max − 2·hp)·rate·ball/(3·max)·status), status ×2.5 sleep/freeze, ×1.5 other;
// b = floor(1048560 / sqrt(sqrt(16711680 / a))); four checks rand(65536) < b; a ≥ 255 always catches.
// Provides the `capture` service (battles use it for ball items) and the catch_creature effect
// for throws outside battle (Pokémon-Go-style encounters).
import { captureOdds, attemptCapture, itemRule } from './puzzle-lib-creature.js';

import { itemsData } from './items-lib.js';
import { creatureExample } from './creature-party.js';

const ID = 'gameplay.creature.catch';

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['capture_thrown', 'caught'], win: { when: { count: 'caught', gte: '$target' }, reads: { event: 'caught', by: { effects: ['catch_creature'] } } } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "param", "param": "balls", "min": 1, "why": "catching needs ball items", "example": [{"item": "orb", "bonus": 1}]},
    ],
    intent: 'Creature capture: ball items with catch bonuses, hp/status-weighted odds, four shake checks; catches go to the party/box and dex.',
    views: ['any'],
    params: {
      balls: { type: 'list', default: [], of: { type: 'object', fields: { item: { type: 'ref', to: 'item', required: true }, bonus: { type: 'number', default: 1, min: 0.1, max: 255 } } }, effect: 'ball items and their catch bonus (items with creature.kind "ball" also count, bonus = creature.value)' },
      consume: { type: 'boolean', default: true, effect: 'throwing uses up the ball (needs gameplay.inventory)' },
    },
    provides: { events: ['capture_thrown', 'capture_shake', 'caught', 'caught:*', 'capture_failed'], services: ['capture'] },
    requires: { primitives: ['gameplay.creature.party'] },
    // Content pack: mechanically valid default content the planner starts from (the model themes it).
    pack: { 'content.items': [{ id: 'capture_orb', name: 'Capture Orb', kind: 'misc', creature: { kind: 'ball', value: 1 } }] },
    reads: ['content.items'],
    data: itemsData(['creature']),
    rules: { catch_no_balls: { fields: ['balls', 'content.items[].creature.kind'], message: "there are ball items: balls lists some, or an item has creature.kind 'ball'",
      example: creatureExample([{ use: 'gameplay.creature.party' }, { use: 'gameplay.creature.catch' }]) } },
  },
  logic(logic) {
    logic.effect('catch_creature', {
      refs: e => [['species', e.species], ...(e.item ? [['item', e.item]] : [])],
      run: (e, rt) => {
        const cap = rt.service('capture'), cs = rt.service('creatures');
        const c = e.creature || cs.create(e.species, e.level ?? 5);
        if (e.hp !== undefined) c.hp = Math.max(1, Math.round(cs.stats(c).hp * e.hp));
        cap.throwAt(e.who || 'player', c, e.item ?? null);
      },
    });
  },
  validate(config, doc) {
    const errors = [];
    if (!config.balls.length && !(doc.content?.items || []).some(i => i.creature?.kind === 'ball')) errors.push({ code: 'catch_no_balls', path: 'with.balls', message: 'no ball items: list balls or give items creature.kind "ball"' });
    return errors;
  },
  install(rt, config) {
    const content = () => rt.doc.content;
    const bonusOf = item => item == null ? 1 : config.balls.find(b => b.item === item)?.bonus ?? (itemRule(content(), item)?.kind === 'ball' ? itemRule(content(), item).value || 1 : null);
    const hasInv = () => rt.canTest('item');
    const api = {
      bonusOf, isBall: item => bonusOf(item) != null && item != null,
      odds: (c, bonus = 1) => captureOdds(content(), c, bonus),
      attempt: (c, bonus = 1) => attemptCapture(content(), c, bonus, () => rt.random()),
      /** Throw: consume the ball, roll shakes, add the creature on success. Returns {shakes, success}. */
      throwAt(who, c, item) {
        const bonus = bonusOf(item);
        if (bonus == null) return { shakes: 0, success: false };
        if (item && config.consume && hasInv()) { if (!rt.test({ item, gte: 1 }, {})) return { shakes: 0, success: false, noBall: true }; rt.run([{ do: 'take_item', item, count: 1 }]); }
        rt.service('creatures').seen(who, c.species);
        rt.emit('capture_thrown', { who, item, species: c.species });
        const r = api.attempt(c, bonus);
        for (let i = 0; i < Math.min(3, r.shakes); i++) rt.emit('capture_shake', { n: i + 1 });
        if (r.success) { rt.emitTyped('caught', c.species, { who, uid: c.uid, level: c.level, item }); rt.service('creatures').add(who, c, { caught: true }); }
        else rt.emit('capture_failed', { who, species: c.species, shakes: r.shakes });
        return r;
      },
    };
    rt.provide('capture', api);
  },
};
