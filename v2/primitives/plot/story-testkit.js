// Test fixtures for the plot story primitives (tests/v2-p-story-*.test.js).
// Builds small documents on the kernel's reference test space so plot
// behaviour is exercised through rt.step / effects / events.
import { compile, testSpace } from '../../kernel/testing.js';
import { PRIMITIVES } from '../index.js';
import { Registry } from '../../kernel/registry.js';
import { Logic } from '../../kernel/logic.js';
import { buildLogic } from '../../kernel/world.js';
import { preflight } from '../../kernel/document.js';

export const ZONES = [
  { id: 'village', rect: [0, 0, 10, 10], tags: ['town'] },
  { id: 'forest', rect: [10, 0, 20, 10], tags: ['wild', 'grove'] },
  { id: 'cave', rect: [20, 0, 30, 10], tags: ['wild'] },
];
export const at = { village: [1, 1, 0], forest: [11, 1, 0], cave: [21, 1, 0] };

/** A minimal story document; `plot`, `systems` and `content` are merged over the defaults. */
export function storyDoc({ plot = {}, systems, extraSystems = [], content = {}, player = {} } = {}) {
  return {
    schema: 'gameverse.v2.game/0.2', id: 'story-test', title: 'Story test', seed: 3,
    spaces: [{ id: 'world', use: 'engine.space.test', with: { size: [32, 12, 1] }, zones: structuredClone(ZONES) }],
    systems: systems ?? [{ use: 'gameplay.inventory' }, { use: 'plot.character', with: { talkRange: 2 } }, { use: 'plot.dialogue' }, { use: 'plot.quest' }, { use: 'plot.gate' }, { use: 'plot.storyboard', with: { sequentialActs: false } }, ...extraSystems],
    plot: { characters: [{ id: 'elder', name: 'Elder', archetype: 'villager', home: 'village', at: [2, 1, 0] }, { id: 'ranger', name: 'Ranger', archetype: 'villager', home: 'forest', at: [12, 1, 0] }], storyboard: { acts: [{ id: 'a1', beats: [] }] }, ...plot },
    content: { items: [{ id: 'herb', name: 'Herb' }, { id: 'key', name: 'Key' }, { id: 'gem', name: 'Gem' }], archetypes: [{ id: 'hero', components: {} }, { id: 'villager', components: {} }, { id: 'wolf', components: {} }, { id: 'cart', kind: 'vehicle', components: {} }], recipes: [{ id: 'r_tea', inputs: [{ item: 'herb', count: 1 }], output: { item: 'gem', count: 1 } }], blocks: [{ id: 'plank', name: 'Plank' }], ...content },
    player: { archetype: 'hero', space: 'world', at: [1, 1, 0], ...player },
  };
}

export const primitives = () => [...PRIMITIVES, testSpace];
export function catalog(extra = []) {
  const registry = new Registry([...primitives(), ...extra]);
  return { registry, logic: buildLogic(registry, Logic) };
}
export const make = (doc, opts = {}) => compile(doc, { primitives: primitives(), ...opts });
export function check(doc, extra = []) { const { registry, logic } = catalog(extra); return preflight(doc, registry, logic); }
export const codes = r => r.errors.map(e => e.code);
export function step(rt, n = 1, input = {}) { for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step(input); return rt; }
export const act = (rt, actions) => rt.step({ actions });
export const goTo = (rt, zone) => rt.run([{ do: 'teleport', zone }]);
export const moveTo = (rt, pos) => rt.space('world').setPos(rt.player(), pos, rt);
export const events = (rt, name) => rt.state.events.filter(e => e.name === name);
/** Record every event of the run (state.events is per-step). */
export function recorder(rt) { const log = []; rt.on('*', e => log.push(e)); return log; }

// A manor on a graph space: the study is behind a gate, the ending needs the letter in the study.
export const manor = () => ({
  schema: 'gameverse.v2.game/0.2', id: 'manor', title: 'Manor', seed: 1,
  spaces: [{ id: 'm', use: 'engine.space.graph', zones: [
    { id: 'hall', exits: [{ to: 'garden' }, { to: 'study' }] },
    { id: 'garden', exits: [{ to: 'hall' }] },
    { id: 'study', exits: [{ to: 'hall' }] },
  ] }],
  systems: [{ use: 'gameplay.inventory' }, { use: 'plot.storyboard', with: { sequentialActs: false } }, { use: 'plot.gate' }, { use: 'plot.ending' }, { use: 'plot.quest' }, { use: 'plot.character', with: { talkRange: 0 } }, { use: 'plot.dialogue', with: { lineSpeed: 0 } }],
  plot: {
    characters: [{ id: 'butler', name: 'Hobbs', archetype: 'npc', home: 'garden', dialogue: [{ id: 'butler_talk' }] }],
    dialogue: { butler_talk: { speaker: 'butler', start: 'n1', nodes: { n1: { say: 'Sir?', choices: [{ text: 'The key, please.', once: true, do: [{ do: 'give_item', item: 'key' }], end: true }, { text: 'Nothing.', end: true }] } } } },
    gates: [{ id: 'study_door', requires: { item: 'key' }, hint: 'Locked.', locks: ['exit:hall>study'] }],
    storyboard: { acts: [{ id: 'a', beats: [{ id: 'b_letter', when: { zone: 'study' }, do: [{ do: 'give_item', item: 'letter' }] }] }] },
    quests: [{ id: 'q_read', title: 'Read it', kind: 'main', autoStart: true, objectives: [{ id: 'o', kind: 'collect', item: 'letter', count: 1 }] }],
    endings: [{ id: 'truth', title: 'Truth', when: { quest: 'q_read', state: 'complete' }, epilogue: '.' }],
  },
  content: { items: [{ id: 'key', name: 'Key' }, { id: 'letter', name: 'Letter' }], archetypes: [{ id: 'detective', components: {} }, { id: 'npc', components: {} }] },
  player: { archetype: 'detective', space: 'm', at: 'hall' },
});
// The graph space has no gates.allows hook yet, so the exit carries the gate predicate too.
export const withExitGate = d => { d.spaces[0].zones[0].exits[1].gate = { gate: 'study_door' }; return d; };

