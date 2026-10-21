// gameplay.encounter: random and scripted creature encounters for any overworld.
// Areas are zones and/or cell tokens (tall grass, cave floor, water) with a
// per-step rate and a weighted table {species, minLevel, maxLevel, weight}.
// A "step" is the subject entering a new cell (or zone, in graph spaces). After
// a battle the next `grace` steps are safe; repel suppresses encounters for N
// steps. Trainers are data (id, name, class, party, prize, kind); trainer_battle
// starts their battle (from sight AI, dialogue or a storyboard beat) once, and
// trainer_defeated tells plot and gates they are beaten.
import { weighted } from './puzzle-lib-board.js';

const ID = 'gameplay.encounter';
const AREA = { type: 'object', fields: {
  id: { type: 'string', required: true },
  zone: { type: 'ref', to: 'zone', effect: 'zone the area covers' },
  block: { type: 'string', effect: 'cell token under the subject that counts (e.g. tall_grass); needs editCells' },
  rate: { type: 'number', default: 0.1, min: 0, max: 1, effect: 'chance per step' },
  table: { type: 'list', required: true, min: 1, of: { type: 'object', fields: { species: { type: 'ref', to: 'species', required: true }, minLevel: { type: 'integer', default: 2, min: 1, max: 100 }, maxLevel: { type: 'integer', default: 5, min: 1, max: 100 }, weight: { type: 'number', default: 1, min: 0.001, max: 1000 } } } },
} };
const TRAINER = { type: 'object', fields: {
  id: { type: 'string', required: true }, name: { type: 'string', default: '' }, class: { type: 'string', default: 'trainer' },
  kind: { type: 'string', default: 'trainer', options: ['trainer', 'leader', 'champion'] },
  party: { type: 'list', required: true, min: 1, max: 6, of: { type: 'object', fields: { species: { type: 'ref', to: 'species', required: true }, level: { type: 'integer', default: 5, min: 1, max: 100 } } } },
  prize: { type: 'integer', default: 0, min: 0, max: 1e7 }, ai: { type: 'string', default: 'normal', options: ['easy', 'normal'] }, noHeal: { type: 'boolean', default: false },
  onDefeat: { type: 'effects', default: [] }, rematch: { type: 'boolean', default: false },
} };

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['encounter', 'trainer_challenge'] },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "param", "param": "areas", "min": 1, "why": "wild encounters need areas (zones) with weighted species tables", "example": [{"id": "meadow_grass", "zone": "meadow", "rate": 0.12, "table": [{"species": "sprout", "weight": 3, "minLevel": 2, "maxLevel": 4}]}]},
      {"need": "param", "param": "trainers", "min": 1, "why": "trainers give the player battles worth winning", "example": [{"id": "ranger_ivy", "party": [{"species": "ember_pup", "level": 5}]}]},
    ],
    intent: 'Creature encounters: tall-grass/zone/cell-tagged areas with per-step rates and weighted level-ranged tables, grace steps and repel; data-defined trainers whose battles start from effects and are remembered when beaten.',
    views: ['td', 'side', 'any'],
    params: {
      areas: { type: 'list', default: [], of: AREA, effect: 'encounter areas (first matching area wins)' },
      trainers: { type: 'list', default: [], of: TRAINER, effect: 'trainers (reference kind "trainer")' },
      who: { type: 'string', default: 'player', effect: 'entity whose steps roll encounters' },
      grace: { type: 'integer', default: 3, min: 0, max: 100, unit: 'steps', effect: 'safe steps after a battle' },
      onEncounter: { type: 'effects', default: [], effect: 'extra effects when a wild encounter starts (the battle starts by itself)' },
    },
    provides: { events: ['encounter_request', 'encounter', 'encounter:*', 'trainer_challenge', 'trainer_challenge:*', 'step'], vars: ['encounter.steps', 'encounter.repel'] },
    requires: { primitives: ['gameplay.creature.battle'] },
    defines: [{ kind: 'trainer', in: 'trainers' }],
  },
  logic(logic) {
    logic.effect('trainer_battle', { refs: e => [['trainer', e.trainer]], run: (e, rt) => rt.emit('encounter_request', { trainer: e.trainer }) });
    logic.effect('wild_battle', { refs: e => [['species', e.species]], run: (e, rt) => rt.emit('encounter_request', { species: e.species, level: e.level ?? 5 }) });
    logic.effect('repel_encounters', { run: (e, rt) => { rt.state.vars['encounter.repel'] = Math.max(rt.state.vars['encounter.repel'] ?? 0, e.steps ?? 100); } });
    logic.predicate('trainer_defeated', { refs: p => [['trainer', p.trainer_defeated]], test: (p, rt) => Boolean(rt.state.prim[ID]?.beaten?.[p.trainer_defeated]) });
  },
  validate(config) {
    const errors = [];
    config.areas.forEach((a, i) => {
      if (!a.zone && !a.block) errors.push({ code: 'encounter_area', path: `with.areas[${i}]`, message: 'an area needs a zone or a block' });
      a.table.forEach((t, j) => { if (t.minLevel > t.maxLevel) errors.push({ code: 'encounter_levels', path: `with.areas[${i}].table[${j}]`, message: 'minLevel must be <= maxLevel' }); });
    });
    return errors;
  },
  install(rt, config) {
    const st = () => rt.store(ID);
    const keyOf = e => Array.isArray(e.at) ? e.at.map(Math.floor).join(',') : String(e.at);
    function areaFor(e) {
      const api = rt.space(e.space);
      for (const a of config.areas) {
        if (a.zone && !(api.inZone && api.inZone(e, a.zone, rt))) continue;
        if (a.block) { if (!api.getCell || !Array.isArray(e.at)) continue; if (api.getCell(e.at.map(Math.floor)) !== a.block) continue; }
        return a;
      }
      return null;
    }
    function wild(species, level, area) {
      rt.emitTyped('encounter', species, { level, area: area?.id ?? null });
      rt.run(config.onEncounter, {});
      rt.run([{ do: 'start_battle', kind: 'wild', foe: [{ species, level }] }]);
    }
    rt.on('encounter_request', r => {
      if (r.species) { wild(r.species, r.level); return; }
      const t = config.trainers.find(x => x.id === r.trainer); if (!t) return;
      const s = st(); s.beaten ??= {};
      if (s.beaten[t.id] && !t.rematch) return;
      rt.emitTyped('trainer_challenge', t.id, { name: t.name });
      rt.run([{ do: 'start_battle', kind: t.kind, foe: t.party, trainer: { id: t.id, name: t.name || t.id, class: t.class, prize: t.prize, ai: t.ai, noHeal: t.noHeal } }]);
    });
    rt.on('trainer_defeated', d => {
      const t = config.trainers.find(x => x.id === d.subject); if (!t) return;
      const s = st(); s.beaten ??= {}; s.beaten[t.id] = rt.state.frame + 1;
      rt.run(t.onDefeat, {});
    });
    rt.on('battle_end', () => { st().grace = config.grace; });
    rt.system('rules', rt => {
      const s = st(), e = rt.resolve(config.who); if (!e || !e.space) return;
      if (rt.state.prim['gameplay.creature.battle']?.battle) return; // no rolls mid-battle
      const k = `${e.space}|${keyOf(e)}`;
      if (s.last === undefined) { s.last = k; return; }
      if (k === s.last) return;
      s.last = k; s.steps = (s.steps ?? 0) + 1; rt.state.vars['encounter.steps'] = s.steps;
      rt.emit('step', { who: e.id });
      if (s.grace > 0) { s.grace--; return; }
      if ((rt.state.vars['encounter.repel'] ?? 0) > 0) { rt.state.vars['encounter.repel']--; return; }
      const a = areaFor(e); if (!a || rt.random() >= a.rate) return;
      const t = weighted(rt, a.table), level = t.minLevel + Math.floor(rt.random() * (t.maxLevel - t.minLevel + 1));
      wild(t.species, level, a);
    }, ID);
  },
};
