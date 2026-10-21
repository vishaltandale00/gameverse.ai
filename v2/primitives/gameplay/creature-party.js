// gameplay.creature.party: owned creatures for any entity (the player by default).
// Creatures are plain JSON (puzzle-lib-creature.js): stats from base + IVs + level,
// growth curves (0.8n³ / n³ / 1.25n³), learnsets (the four latest moves), evolution
// at a level. A party of up to `size`, overflow to the PC box, a dex of seen/caught
// species. Other primitives (battle, catch, encounter, shops, quests) use the
// `creatures` service instead of reaching into this store.
import { createCreature, healCreature, gainExp, evolutionOf, evolve, statsOf, speciesOf, moveOf, expBar, STATS, STAGE_STATS, STATUSES, EFFECT_KINDS } from './puzzle-lib-creature.js';
import { ID_PATTERN } from '../../kernel/sections.js';

const ID = 'gameplay.creature.party';

/** The creature sections (species, moves, the type chart): owned here, read by gameplay.creature.battle, catch and encounter. */
export const CREATURE_DATA = Object.freeze({
  'content.species': { type: 'list', min: 1, of: { type: 'object', fields: { id: { type: 'string', pattern: ID_PATTERN, required: true }, name: { type: 'string', display: true, required: true, effect: 'the name a person reads' },
    types: { type: 'list', min: 1, of: { type: 'ref', to: 'creature_type' }, required: true, effect: 'its types (content.types)' },
    base: { type: 'object', required: true, fields: Object.fromEntries(STATS.map(k => [k, { type: 'integer', min: 1, max: 255, required: true }])), effect: 'base stats 1..255' },
    catchRate: { type: 'integer', min: 1, max: 255 }, expYield: { type: 'integer', min: 1, max: 400 }, growth: { type: 'string', options: ['fast', 'medium', 'slow'] },
    learnset: { type: 'list', of: { type: 'object', fields: { level: { type: 'integer', min: 1, max: 100, required: true }, move: { type: 'ref', to: 'move', required: true } } } },
    evolves: { type: 'object', fields: { level: { type: 'integer', min: 2, max: 100, required: true }, to: { type: 'ref', to: 'species', required: true } } } } } },
  'content.moves': { type: 'list', min: 1, of: { type: 'object', fields: { id: { type: 'string', pattern: ID_PATTERN, required: true }, name: { type: 'string', display: true, required: true, effect: 'the name a person reads' }, type: { type: 'ref', to: 'creature_type', required: true }, category: { type: 'string', options: ['physical', 'special', 'status'], required: true },
    power: { type: 'integer', min: 0, max: 250, required: true, effect: '0 for status moves' }, accuracy: { type: 'integer', min: 1, max: 100 }, pp: { type: 'integer', min: 1, max: 64, required: true }, priority: { type: 'integer', min: -7, max: 5 },
    effect: { type: 'object', fields: { kind: { type: 'string', options: EFFECT_KINDS, required: true }, status: { type: 'string', options: STATUSES }, stat: { type: 'string', options: STAGE_STATS }, stages: { type: 'integer', min: -6, max: 6 }, chance: { type: 'number', min: 0, max: 100 }, target: { type: 'string', options: ['self', 'foe'] }, min: { type: 'integer', min: 1, effect: 'multihit: fewest hits' }, max: { type: 'integer', min: 1, effect: 'multihit: most hits' } } } } } },
  'content.types': { type: 'object', values: { type: 'object', values: { type: 'number', min: 0 }, effect: 'defending type -> damage multiplier (missing = 1)' }, effect: 'the type chart: attacking type -> { defending type -> multiplier }; species and move types are its keys' },
});

/**
 * A rule example (card.rules[code].example) for the creature cards: a document fragment with these systems, the player
 * archetypes the host templates name (hero, trainer) and a minimal species, move and type chart, plus `content` sections given.
 */
const PLAYERS = [{ id: 'hero', name: 'Hero', components: {} }, { id: 'trainer', name: 'Trainer', components: {} }];
export const creatureExample = (systems, content = {}) => ({ doc: { systems, content: {
  archetypes: PLAYERS, types: { fire: {} }, moves: [{ id: 'ember', name: 'Ember', type: 'fire', category: 'special', power: 40, pp: 25 }],
  species: [{ id: 'cub', name: 'Cub', types: ['fire'], base: { hp: 40, atk: 40, def: 40, spa: 40, spd: 40, spe: 40 }, learnset: [{ level: 1, move: 'ember' }] }], ...content,
} } });

export default {
  id: ID,
  card: {
    loop: { verbs: ['party_swap', 'deposit', 'withdraw'], progress: ['creature_added', 'creature_level_up', 'creature_evolved'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { party_swap: { type: 'choice', of: 'two party slots', from: 'options', emits: ['party_swapped'] }, deposit: { type: 'choice', of: 'a party slot', from: 'options', emits: ['creature_deposited'] }, withdraw: { type: 'choice', of: 'a box slot', from: 'options', emits: ['creature_withdrawn'] } },
    // Content pack: mechanically valid default content the planner starts from (the model themes it: names, flavour, which ones).
    pack: {
      'content.species': [{ id: 'ember_cub', name: 'Ember Cub', types: ['fire'], base: { hp: 45, atk: 52, def: 43, spa: 60, spd: 50, spe: 65 }, catchRate: 90, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 4, move: 'ember' }, { level: 7, move: 'growl' }, { level: 10, move: 'flame_burst' }] }, { id: 'cinder_hound', name: 'Cinder Hound', types: ['fire'], base: { hp: 60, atk: 70, def: 55, spa: 65, spd: 55, spe: 70 }, catchRate: 90, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 4, move: 'ember' }, { level: 7, move: 'flame_burst' }] }, { id: 'tide_pup', name: 'Tide Pup', types: ['water'], base: { hp: 50, atk: 48, def: 65, spa: 50, spd: 64, spe: 43 }, catchRate: 90, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 4, move: 'water_gun' }, { level: 7, move: 'growl' }, { level: 10, move: 'bubble_beam' }] }, { id: 'reef_turtle', name: 'Reef Turtle', types: ['water'], base: { hp: 70, atk: 60, def: 75, spa: 55, spd: 70, spe: 40 }, catchRate: 90, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 4, move: 'water_gun' }, { level: 7, move: 'bubble_beam' }] }, { id: 'sprout', name: 'Sprout', types: ['grass'], base: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 }, catchRate: 90, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 4, move: 'vine_whip' }, { level: 7, move: 'growl' }, { level: 10, move: 'leaf_blade' }] }, { id: 'thorn_stag', name: 'Thorn Stag', types: ['grass'], base: { hp: 65, atk: 72, def: 60, spa: 55, spd: 60, spe: 62 }, catchRate: 90, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 4, move: 'vine_whip' }, { level: 7, move: 'leaf_blade' }] }],
      'content.moves': [{ id: 'tackle', name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }, { id: 'growl', name: 'Growl', type: 'normal', category: 'status', power: 0, accuracy: 100, pp: 40, effect: { kind: 'stat', stat: 'atk', stages: -1, target: 'foe' } }, { id: 'ember', name: 'Ember', type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25 }, { id: 'flame_burst', name: 'Flame Burst', type: 'fire', category: 'special', power: 70, accuracy: 100, pp: 15 }, { id: 'water_gun', name: 'Water Gun', type: 'water', category: 'special', power: 40, accuracy: 100, pp: 25 }, { id: 'bubble_beam', name: 'Bubble Beam', type: 'water', category: 'special', power: 65, accuracy: 100, pp: 20 }, { id: 'vine_whip', name: 'Vine Whip', type: 'grass', category: 'physical', power: 45, accuracy: 100, pp: 25 }, { id: 'leaf_blade', name: 'Leaf Blade', type: 'grass', category: 'physical', power: 70, accuracy: 100, pp: 15 }],
      'content.types': { normal: {}, fire: { grass: 2, water: 0.5, fire: 0.5 }, water: { fire: 2, grass: 0.5, water: 0.5 }, grass: { water: 2, fire: 0.5, grass: 0.5 } },
    },
    // The sections it owns, whole (kinds: species, move, creature_type).
    data: CREATURE_DATA,
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
      events: ['creature_added', 'creature_added:*', 'creature_boxed', 'creature_released', 'party_swapped', 'creature_deposited', 'creature_withdrawn', 'creature_level_up', 'creature_learned', 'creature_learned:*', 'creature_learn_pending', 'creature_evolved', 'creature_evolved:*', 'dex_seen:*', 'dex_caught:*', 'party_full', 'party_healed'],
      vars: ['party.size', 'party.alive', 'dex.seen', 'dex.caught'],
      services: ['creatures'],
      actions: ['party_swap', 'deposit', 'withdraw'],
    },
    reads: ['content.species', 'content.moves', 'content.types'],
    defines: [{ kind: 'species', at: 'content.species' }, { kind: 'move', at: 'content.moves' }, { kind: 'creature_type', at: 'content.types' }],
    rules: {
      species_missing: { fields: ['content.species'], message: 'the document has content.species', example: { doc: { systems: [{ use: 'gameplay.creature.party' }], content: { archetypes: PLAYERS } } } },
      move_invalid: { fields: ['content.moves[].category', 'content.moves[].power', 'content.moves[].effect'], message: 'a physical or special move has power > 0; a status effect names its status, a stat effect its stat' },
    },
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
    const errors = [], content = doc.content || {};
    if (!(Array.isArray(content.species) && content.species.length)) errors.push({ code: 'species_missing', path: 'content.species', message: 'creature party needs content.species' });
    (Array.isArray(content.moves) ? content.moves : []).forEach((m, i) => {
      const p = `content.moves[${i}]`;
      if ((m?.category === 'physical' || m?.category === 'special') && !(m.power > 0)) errors.push({ code: 'move_invalid', path: `${p}.power`, message: 'damaging moves need power > 0' });
      if (m?.effect?.kind === 'status' && m.effect.status === undefined) errors.push({ code: 'move_invalid', path: `${p}.effect.status`, message: `a status effect names its status (${STATUSES.join('|')})` });
      if (m?.effect?.kind === 'stat' && m.effect.stat === undefined) errors.push({ code: 'move_invalid', path: `${p}.effect.stat`, message: `a stat effect names its stat (${STAGE_STATS.join('|')})` });
    });
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
      /** Lend an owner's party to a battle: a copy it plays with, while the party verbs wait for setParty. */
      lend(who, by) { const o = own(who); o.lent = by; return structuredClone(o.party); },
      /** Who the party is lent to, or null. */
      lentTo: who => own(who).lent ?? null,
      /** Replace an owner's party (a battle writes its copy back, ending the loan). */
      setParty(who, list) { const o = own(who); o.party = list; delete o.lent; vars(); },
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
    // The player's party verbs, each with the values it can take now (the options a person chooses from).
    const name = c => speciesOf(content(), c.species)?.name ?? c.species;
    // A party lent to a battle is the battle's until it is written back: its verbs wait.
    const canSwap = (o, a, b) => !o.lent && a !== b && Boolean(o.party[a] && o.party[b]);
    const canDeposit = (o, i) => !o.lent && o.party.length > 1 && Boolean(o.party[i]) && o.box.length < config.box;
    const canWithdraw = (o, i) => !o.lent && Boolean(o.box[i]) && o.party.length < config.size;
    rt.action('party_swap', v => {
      const o = own('player'), [a, b] = Array.isArray(v) ? v : []; if (!canSwap(o, a, b)) return;
      [o.party[a], o.party[b]] = [o.party[b], o.party[a]]; vars();
      rt.emit('party_swapped', { who: 'player', slots: [a, b], uids: [o.party[a].uid, o.party[b].uid] });
    });
    rt.action('deposit', v => {
      const o = own('player'), i = Number(v); if (!Number.isInteger(i) || !canDeposit(o, i)) return;
      const [c] = o.party.splice(i, 1); o.box.push(c); vars();
      rt.emit('creature_deposited', { who: 'player', uid: c.uid, species: c.species, slot: i });
    });
    rt.action('withdraw', v => {
      const o = own('player'), i = Number(v); if (!Number.isInteger(i) || !canWithdraw(o, i)) return;
      const [c] = o.box.splice(i, 1); o.party.push(c); vars();
      rt.emit('creature_withdrawn', { who: 'player', uid: c.uid, species: c.species, slot: i });
    });
    rt.options(rt => {
      const o = own('player'), out = [];
      // Every pair of party slots (slot 0 is the lead that battles first), each creature to the box, each boxed one back.
      for (let a = 0; a < o.party.length; a++) for (let b = a + 1; b < o.party.length; b++) if (canSwap(o, a, b)) out.push({ label: `swap ${name(o.party[a])} and ${name(o.party[b])}`, text: `Swap ${name(o.party[a])} and ${name(o.party[b])}`, actions: { party_swap: [a, b] } });
      o.party.forEach((c, i) => { if (canDeposit(o, i)) out.push({ label: `deposit ${name(c)}`, text: `Send ${name(c)} to storage`, actions: { deposit: i } }); });
      o.box.forEach((c, i) => { if (canWithdraw(o, i)) out.push({ label: `withdraw ${name(c)}`, text: `Bring ${name(c)} back from storage`, actions: { withdraw: i } }); });
      return out;
    });
  },
};
