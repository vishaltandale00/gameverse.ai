// gameplay.creature.party: owned creatures for any entity (the player by default).
// Creatures are plain JSON (puzzle-lib-creature.js): stats from base + IVs + level,
// growth curves (0.8n³ / n³ / 1.25n³), learnsets (the four latest moves), evolution
// at a level. A party of up to `size`, overflow to the PC box, a dex of seen/caught
// species. Other primitives (battle, catch, encounter, shops, quests) use the
// `creatures` service instead of reaching into this store.
import { createCreature, healCreature, gainExp, evolutionOf, evolve, statsOf, speciesOf, moveOf, validateContent, expBar } from './puzzle-lib-creature.js';

const ID = 'gameplay.creature.party';

export default {
  id: ID,
  card: {
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "section", "at": "content.species", "min": 4, "why": "creatures come from species with types, base stats and learnsets", "example": {"id": "sprout", "name": "Sprout", "types": ["grass"], "base": {"hp": 45, "atk": 49, "def": 49, "spa": 65, "spd": 65, "spe": 45}, "catchRate": 45, "expYield": 64, "growth": "medium", "learnset": [{"level": 1, "move": "tackle"}, {"level": 7, "move": "vine"}], "evolves": {"level": 16, "to": "bloom"}}},
      {"need": "section", "at": "content.moves", "min": 4, "why": "species learn moves", "example": {"id": "vine", "name": "Vine Whip", "type": "grass", "category": "physical", "power": 45, "accuracy": 100, "pp": 25}},
      {"need": "param", "param": "start", "min": 1, "why": "the player starts with a creature", "example": [{"species": "sprout", "level": 5}]},
    ],
    // The player starts with a creature (the first species) so battles and catching have someone to fight with.
    engage: { config: { start: [{ species: '$first:content.species', level: 5 }] } },
    intent: 'Creature collection: party (6) and PC box per owner, stats/IVs/growth curves, learnsets, evolution, dex of seen and caught species; the creatures service used by battles, catching and encounters.',
    views: ['any'],
    params: {
      size: { type: 'integer', default: 6, min: 1, max: 12, effect: 'party size; extra creatures go to the box' },
      box: { type: 'integer', default: 240, min: 0, max: 5000, effect: 'PC box capacity' },
      start: { type: 'list', default: [], of: { type: 'object', fields: { species: { type: 'ref', to: 'species', required: true }, level: { type: 'integer', default: 5, min: 1, max: 100 } } }, effect: "player's starting creatures" },
      evolveOnLevel: { type: 'boolean', default: true, effect: 'evolve as soon as the level is reached (battles evolve after the battle)' },
    },
    provides: {
      events: ['creature_added', 'creature_added:*', 'creature_boxed', 'creature_released', 'creature_level_up', 'creature_learned', 'creature_learned:*', 'creature_learn_pending', 'creature_evolved', 'creature_evolved:*', 'dex_seen:*', 'dex_caught:*', 'party_full', 'party_healed'],
      vars: ['party.size', 'party.alive', 'dex.seen', 'dex.caught'],
      services: ['creatures'],
      actions: ['party_swap', 'deposit', 'withdraw'],
    },
    reads: ['content.species', 'content.moves', 'content.types'],
    defines: [{ kind: 'species', at: 'content.species' }, { kind: 'move', at: 'content.moves' }],
  },
  logic(logic) {
    const svc = rt => rt.service('creatures');
    logic.effect('give_creature', {
      refs: e => [['species', e.species]],
      check: (e, path, errors) => { if (e.level !== undefined && !(Number.isInteger(e.level) && e.level >= 1 && e.level <= 100)) errors.push({ code: 'effect_invalid', path: `${path}.level`, message: 'level 1..100' }); },
      run: (e, rt) => { const s = svc(rt); s.add(e.who || 'player', s.create(e.species, e.level ?? 5), { caught: true }); },
    });
    logic.effect('heal_party', { run: (e, rt) => svc(rt).healAll(e.who || 'player') });
    logic.effect('creature_exp', { run: (e, rt) => svc(rt).giveExp(e.who || 'player', e.slot ?? 0, e.amount ?? 0) });
    logic.predicate('has_creature', { refs: p => [['species', p.has_creature]], test: (p, rt) => svc(rt).party(p.who || 'player').concat(svc(rt).boxOf(p.who || 'player')).some(c => c.species === p.has_creature) });
    logic.predicate('dex', { refs: p => [['species', p.dex]], test: (p, rt) => { const d = svc(rt).dex(p.who || 'player'); return Boolean((p.state === 'seen' ? d.seen : d.caught)[p.dex]); } });
  },
  validate(config, doc) {
    const errors = validateContent(doc.content);
    if (!(doc.content?.species || []).length) errors.push({ code: 'species_missing', path: 'content.species', message: 'creature party needs content.species' });
    return errors;
  },
  install(rt, config) {
    const st = () => rt.store(ID);
    const content = () => rt.doc.content;
    const own = who => { const s = st(); s.owners ??= {}; return (s.owners[who] ??= { party: [], box: [], dex: { seen: {}, caught: {} } }); };
    const vars = () => { const o = own('player'); rt.state.vars['party.size'] = o.party.length; rt.state.vars['party.alive'] = o.party.filter(c => c.hp > 0).length; rt.state.vars['dex.seen'] = Object.keys(o.dex.seen).length; rt.state.vars['dex.caught'] = Object.keys(o.dex.caught).length; };
    const api = {
      create(species, level) { const s = st(); s.nextUid = (s.nextUid ?? 0) + 1; return createCreature(content(), species, level, () => rt.random(), `c${s.nextUid}`); },
      party: who => own(who).party, boxOf: who => own(who).box, dex: who => own(who).dex,
      find(who, uid) { const o = own(who); return o.party.find(c => c.uid === uid) || o.box.find(c => c.uid === uid) || null; },
      stats: c => statsOf(content(), c), species: id => speciesOf(content(), id),
      seen(who, species) { const d = own(who).dex; if (!d.seen[species]) { d.seen[species] = rt.state.frame + 1; rt.emit(`dex_seen:${species}`, { who }); vars(); } },
      /** Add a creature: party when there is room, else the box. Returns 'party' | 'box' | null (full). */
      add(who, c, { caught = true } = {}) {
        const o = own(who);
        api.seen(who, c.species);
        if (caught && !o.dex.caught[c.species]) { o.dex.caught[c.species] = rt.state.frame + 1; rt.emit(`dex_caught:${c.species}`, { who }); }
        let where = null;
        if (o.party.length < config.size) { o.party.push(c); where = 'party'; }
        else if (o.box.length < config.box) { o.box.push(c); where = 'box'; rt.emit('creature_boxed', { who, uid: c.uid, species: c.species }); }
        else rt.emit('party_full', { who, species: c.species });
        if (where) rt.emitTyped('creature_added', c.species, { who, uid: c.uid, level: c.level, where });
        vars();
        return where;
      },
      /** Replace an owner's party (a battle writes its copy back). */
      setParty(who, list) { own(who).party = list; vars(); },
      healAll(who) { for (const c of own(who).party) healCreature(content(), c); rt.emit('party_healed', { who }); vars(); },
      /** Experience outside battle; new moves beyond four forget the oldest. */
      giveExp(who, slot, amount) {
        const c = own(who).party[slot]; if (!c || amount <= 0) return;
        for (const lv of gainExp(content(), c, amount)) {
          rt.emit('creature_level_up', { who, uid: c.uid, species: c.species, level: lv.level });
          for (const m of lv.learned) rt.emitTyped('creature_learned', m, { who, uid: c.uid });
          for (const m of lv.pending) { const mv = moveOf(content(), m), old = c.moves.shift(); c.moves.push({ id: m, pp: mv.pp, max: mv.pp }); rt.emitTyped('creature_learned', m, { who, uid: c.uid, forgot: old.id }); }
        }
        if (config.evolveOnLevel) api.evolveReady(who);
        vars();
      },
      evolveReady(who) {
        for (const c of own(who).party) { const to = evolutionOf(content(), c); if (to) { const from = c.species; evolve(content(), c, to); api.seen(who, to); own(who).dex.caught[to] ??= rt.state.frame + 1; rt.emitTyped('creature_evolved', to, { who, uid: c.uid, from }); } }
      },
      expBar: c => expBar(speciesOf(content(), c.species).growth, c),
    };
    rt.provide('creatures', api);
    if (!st().init) { st().init = true; for (const s of config.start) api.add('player', api.create(s.species, s.level), { caught: true }); vars(); }
    rt.action('party_swap', v => { const p = own('player').party, [a, b] = Array.isArray(v) ? v : []; if (p[a] && p[b]) { [p[a], p[b]] = [p[b], p[a]]; vars(); } });
    rt.action('deposit', v => { const o = own('player'), i = Number(v) || 0; if (o.party.length > 1 && o.party[i] && o.box.length < config.box) { o.box.push(...o.party.splice(i, 1)); vars(); } });
    rt.action('withdraw', v => { const o = own('player'), i = Number(v) || 0; if (o.box[i] && o.party.length < config.size) { o.party.push(...o.box.splice(i, 1)); vars(); } });
  },
};
