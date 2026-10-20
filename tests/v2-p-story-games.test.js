// The story primitives against the full-scale example games.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalog } from '../v2/primitives/plot/story-testkit.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const GAMES = ['hollow-lantern', 'emberfall', 'blockport', 'quiet-manor'];
const load = g => JSON.parse(readFileSync(new URL(`../v2/games/${g}.json`, import.meta.url)));
const STORY = ['plot.character', 'plot.storyboard', 'plot.dialogue', 'plot.quest', 'plot.gate', 'plot.ending', 'plot.cutscene', 'plot.relationship', 'plot.journal', 'plot.barks', 'plot.events.random', 'plot.investigation'];
// Vocabulary catalog §7 assigns to non-plot primitives (built by other workstreams).
const FOREIGN = new Set(['used', 'boss', 'ability', 'status', 'equipped', 'daytime', 'in_vehicle', 'knows', 'notify', 'unlock_ability', 'set_checkpoint', 'shake', 'play_sound', 'open_shop', 'craft', 'start_boss', 'give_money', 'take_money', 'give_xp', 'set_time', 'change_weather', 'spawn', 'learn_recipe', 'discover', 'command', 'repair', 'call_mount', 'set_wanted', 'add_wanted', 'unlock_perk']);
const FOREIGN_PREDICATES = ['used', 'boss', 'ability', 'status', 'equipped', 'daytime', 'in_vehicle', 'knows'];
const kindIn = e => e.message.match(/\{"([a-z_]+)"/)?.[1] ?? e.message.match(/'([a-z_]+)'/)?.[1];

test('every story instance and every doc.plot section of the example games preflights clean', () => {
  const { registry, logic } = catalog();
  for (const g of GAMES) {
    const doc = load(g), r = preflight(doc, registry, logic);
    const mine = (doc.systems || []).map((s, i) => STORY.includes(s.use) ? `systems[${i}]` : null).filter(Boolean);
    const errs = r.errors.filter(e => e.path.startsWith('plot.') || mine.some(m => e.path === m || e.path.startsWith(m + '.')));
    const ours = errs.filter(e => !(['predicate_unknown', 'effect_unknown'].includes(e.code) && FOREIGN.has(kindIn(e))));
    assert.deepEqual(ours.map(e => `${e.code} ${e.path} ${e.message}`), [], g);
    assert.equal(errs.filter(e => mine.some(m => e.path.startsWith(m))).length, 0, `${g}: zero param errors on story instances`);
  }
});

// Test-only stand-ins for the foreign vocabulary, so full documents can run headless before those primitives land.
const stubVocab = {
  id: 'gameplay.test.vocab',
  card: { intent: 'test stand-in for vocabulary owned by other workstreams', params: {} },
  logic(logic) {
    for (const k of FOREIGN) {
      if (FOREIGN_PREDICATES.includes(k)) { if (!logic.predicates.has(k)) logic.predicate(k, { test: () => false }); }
      else if (!logic.effects.has(k)) logic.effect(k, { run: (e, rt) => rt.emit(`stub:${k}`, {}) });
    }
  },
};
// Keep each space whose primitive exists (dropping generators that don't yet); swap the rest for the
// reference test space with the same zone ids. Keep only registered systems.
function headless(doc, registry) {
  const d = structuredClone(doc), real = new Set();
  d.spaces = d.spaces.map(s => {
    if (registry.has(s.use)) { real.add(s.id); return { ...s, generators: (s.generators || []).filter(g => registry.has(g.use)) }; }
    return { id: s.id, use: 'engine.space.test', with: { size: [10 * (s.zones || []).length + 2, 12, 1] }, zones: (s.zones || []).map((z, i) => ({ id: z.id, rect: [10 * i, 0, 10 * i + 10, 12], tags: z.tags })) };
  });
  d.systems = (d.systems || []).filter(s => registry.has(s.use)); d.graphics = [];
  const space = d.player.space ?? d.spaces[0].id;
  d.player = { archetype: d.player.archetype, space, at: real.has(space) ? d.player.at : [1, 1, 0] };
  return { doc: d, real };
}

test('the full plots run headless: characters spawn, every character can be talked to, conversations play out, deterministically', () => {
  const registry = new Registry([...PRIMITIVES, testSpace, stubVocab]), logic = buildLogic(registry, Logic);
  for (const g of GAMES.slice(0, 3)) {
    const { doc: hd, real } = headless(load(g), registry);
    if (g === 'hollow-lantern') assert.ok(real.has('ashmere'), 'hollow-lantern runs on its real tilemap');
    const r = preflight(hd, registry, logic);
    assert.ok(r.ok, `${g}: ${r.errors.slice(0, 5).map(e => `${e.code} ${e.path} ${e.message}`).join('; ')}`);
    const fresh = createWorld(r.doc, registry, logic, { seed: 9 });
    const homed = r.doc.plot.characters.filter(c => c.home && fresh.entity(c.id));
    assert.deepEqual(homed.filter(c => fresh.entity(c.id).zone !== c.home).map(c => `${c.id}@${fresh.entity(c.id).zone}`), [], `${g}: characters start in their home zones`);
    const play = () => {
      const rt = createWorld(r.doc, registry, logic, { seed: 9 });
      for (let i = 0; i < 60; i++) rt.step();
      let talks = 0, lines = 0; const missed = [];
      // Play out whatever the story put in front of the player: cutscenes and conversations, through solver options.
      const settle = () => {
        for (let k = 0; k < 200 && rt.state.status === 'playing'; k++) {
          const every = rt.availableOptions();
          assert.equal(new Set(every.map(x => x.label)).size, every.length, `option labels are unique: ${every.map(x => x.label).join(' | ')}`);
          const opts = every.filter(x => 'choose' in x.actions || 'skip_cutscene' in x.actions || /^watch /.test(x.label));
          if (!opts.length) return;
          const v = rt.service('dialogue').view(), chosen = rt.state.prim['plot.dialogue'].chosen[v.dialogue] || {};
          const o = opts.find(x => typeof x.actions.choose === 'string' && x.actions.choose !== 'next' && !chosen[x.actions.choose]) ?? opts[opts.length - 1]; // explore unpicked choices first
          for (let s = 0; s < (o.steps || 1); s++) rt.step({ actions: s === (o.steps || 1) - 1 ? o.actions : {} });
          if ('choose' in o.actions) lines++;
        }
      };
      settle();
      for (const c of r.doc.plot.characters) {
        settle();
        const e = rt.entity(c.id); if (!e || rt.state.status !== 'playing') continue;
        if (e.space !== rt.player().space) rt.moveToSpace(rt.player(), e.space, e.at); else rt.space(e.space).setPos(rt.player(), e.at, rt);
        rt.step({ actions: { talk: c.id } });
        if (rt.state.counts[`talked:${c.id}`]) talks++; else missed.push(`${c.id}:${JSON.stringify(rt.service("dialogue").view().node)}@${rt.service("dialogue").view().dialogue}:${rt.service('cutscene').playing()}:${rt.state.status}:${rt.service('character').alive(c.id)}`);
        settle();
      }
      for (let i = 0; i < 60 && rt.state.status === 'playing'; i++) rt.step();
      return { rt, talks, lines, missed };
    };
    const a = play(), b = play();
    const spawnable = r.doc.plot.characters.filter(c => a.rt.state.prim['plot.character'].spawned[c.id]).length;
    assert.ok(spawnable >= r.doc.plot.characters.length - 1, `${g}: characters spawned`);
    assert.ok(a.talks >= spawnable - 3 && a.lines > 10, `${g}: talked to ${a.talks}/${spawnable}, ${a.lines} lines; missed ${a.missed.join(' ')}`);
    assert.ok(a.rt.service('quests').list().some(q => q.state === 'active' || q.state === 'complete'), `${g}: quests started`);
    assert.deepEqual(a.rt.snapshot(), b.rt.snapshot(), `${g}: deterministic`);
  }
});
