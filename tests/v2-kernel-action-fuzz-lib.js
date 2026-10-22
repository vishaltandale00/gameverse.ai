// Action-value fuzzing for registered primitives (KERNEL_API.md §5, §8). Shared by the worker threads and the
// test file. Nothing here knows a primitive id except the RECIPES table of documents for primitives whose
// params cannot be defaulted (they need content the generic builder cannot invent).
import { readFileSync, readdirSync } from 'node:fs';
import { loadCatalogue, satisfying } from '../v2/planner/catalog.js';
import { compile } from '../v2/kernel/testing.js';

/** Every value an action may be handed by a macro, a solver sweep, an LLM or a hostile client. */
export const VALUES = [
  ['true', true], ['0', 0], ["''", ''], ['{}', {}], ['[]', []], ['3.5', 3.5], ["'3'", '3'], ['-1', -1],
  ['{x:3.5}', { x: 3.5 }], ['{x:1e9}', { x: 1e9 }],
  // Beyond the required list: vector and drive-shaped extremes and NaN (solver math can produce it in-process).
  ['[1e9,-1e9]', [1e9, -1e9]], ['{throttle:1e9,steer:-1e9}', { throttle: 1e9, steer: -1e9 }], ['NaN', NaN],
];
/** Events one step may emit before the action counts as a runaway loop (a legitimate step emits tens). */
export const EVENT_CAP = 5000;
const STEPS_WITH_ACTION = 3, STEPS_AFTER = 2;

const SPACES = ['engine.space.tilemap', 'engine.space.grid', 'engine.space.arena2d', 'engine.space.graph', 'engine.space.none', 'engine.space.track', 'engine.space.physics2d'];
const HEAD = { schema: 'gameverse.v2.game/0.2', id: 'fuzz', title: 'Fuzz', seed: 7 };
const root = new URL('../', import.meta.url);

const B = (hp, atk, def, spa, spd, spe) => ({ hp, atk, def, spa, spd, spe });
const creatureContent = () => ({
  types: { fire: { grass: 2, fire: 0.5 }, grass: { fire: 0.5 }, normal: {} },
  moves: [{ id: 'tackle', name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }, { id: 'ember', name: 'Ember', type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25 }],
  species: [{ id: 'sprout', name: 'Sprout', types: ['grass'], base: B(45, 49, 49, 65, 65, 45), catchRate: 45, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }] }, { id: 'pup', name: 'Pup', types: ['fire'], base: B(39, 52, 43, 60, 50, 65), catchRate: 45, expYield: 62, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 4, move: 'ember' }] }],
  items: [{ id: 'orb', name: 'Orb', creature: { kind: 'ball', value: 1 } }, { id: 'tonic', name: 'Tonic', creature: { kind: 'heal', value: 20 } }],
  archetypes: [hero],
});
const creatureRecipe = () => ({ extraSpaces: [{ id: 'arena', use: 'engine.space.tilemap' }], skipTarget: true, content: creatureContent(),
  systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'orb', count: 3 }, { item: 'tonic', count: 2 }] } }, { use: 'gameplay.creature.party', with: { start: [{ species: 'sprout', level: 8 }] } }, { use: 'gameplay.creature.battle', with: { space: 'arena' } }] });

/** Documents for primitives whose required params have no defaults. systems get the target appended. */
const hero = { id: 'hero', components: {} };
const vehicleRecipe = kind => () => ({ systems: [{ use: 'gameplay.vehicle.core' }, { use: `gameplay.vehicle.${kind}` }], skipTarget: true,
  content: { archetypes: [hero, { id: 'veh', kind: 'vehicle', components: { vehicle: { seats: 2, health: 100, fuel: 50 }, [kind]: {} } }] },
  spawn: [['veh', '@player', 'v1']], startInput: { actions: { enter_vehicle: true } } });
const RECIPES = {
  'gameplay.vehicle.car': vehicleRecipe('car'), 'gameplay.vehicle.boat': vehicleRecipe('boat'), 'gameplay.vehicle.aircraft': vehicleRecipe('aircraft'),
  'gameplay.creature.party': () => creatureRecipe(),
  'gameplay.creature.battle': () => creatureRecipe(),
  'gameplay.cards': () => ({ systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: { sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'enemy', control: 'external' }], actions: [], overwatch: false, movePerAp: 0, ap: 1 } }, { use: 'gameplay.cards', with: { deck: ['strike', 'strike', 'defend', 'bash'] } }],
    content: { cards: [{ id: 'strike', name: 'Strike', cost: 1, type: 'attack', effects: [{ do: 'card_damage', amount: 6 }] }, { id: 'defend', name: 'Defend', cost: 1, type: 'skill', target: 'self', effects: [{ do: 'card_block', amount: 5 }] }, { id: 'bash', name: 'Bash', cost: 2, type: 'attack', effects: [{ do: 'card_damage', amount: 8 }] }], archetypes: [hero] }, skipTarget: true }),
  'gameplay.turns': () => ({ systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: { sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'enemy', control: 'ai' }], actions: [{ id: 'shoot', range: 6, hit: { base: 70, optimal: 4, falloff: 5 }, crit: { chance: 0 }, onHit: [{ do: 'damage', who: 'target', amount: 4 }] }] } }],
    content: { archetypes: [{ id: 'hero', components: { health: { max: 10 } } }, { id: 'alien', components: { health: { max: 6 }, turns: { side: 'enemy', defense: 5, initiative: 3 } } }] }, skipTarget: true, spawn: [['alien', [4, 4, 0]]] }),
  'gameplay.minigame': () => ({ systems: [{ use: 'gameplay.minigame', with: { games: [{ id: 'g1', space: 'arena', zone: 'ring', freeze: true, win: { var: 'never' } }] } }],
    content: { archetypes: [hero] }, extraSpaces: [{ id: 'arena', use: 'engine.space.tilemap', zones: [{ id: 'ring', rect: [2, 2, 4, 4] }] }], skipTarget: true, startEffects: [{ do: 'start_minigame', game: 'g1' }] }),
  'gameplay.stage.sequence': () => ({ systems: [{ use: 'gameplay.stage.sequence', with: { introSec: 0, clearSec: 0.1, failSec: 0.1, stages: [{ id: 's1', goal: { kind: 'when', when: { var: 'never' } } }, { id: 's2', goal: { kind: 'when', when: { var: 'never' } } }] } }],
    content: { archetypes: [hero] }, skipTarget: true }),
  'gameplay.sports': () => ({ spaceWith: { size: [30, 16] }, zones: [{ id: 'left_goal', rect: [0, 6, 1, 10] }, { id: 'right_goal', rect: [29, 6, 30, 10] }],
    systems: [{ use: 'gameplay.sports', with: { ball: 'ball', ballAt: [15, 7.75, 0], teams: [{ id: 'blue', members: ['player'], kickoff: [[10, 7.5, 0]] }, { id: 'red', members: ['rival'], kickoff: [[20, 3, 0]] }], goals: [{ zone: 'right_goal', scores: 'blue' }, { zone: 'left_goal', scores: 'red' }], periodSec: 20, periods: 2, kickoffSec: 0.5, resetSec: 0.5, drag: 0.1 } }],
    content: { archetypes: [{ id: 'ball', components: { body: { size: [0.5, 0.5, 0.5], vel: [0, 0, 0] } } }, { id: 'rival', components: { body: { size: [1, 1, 1], vel: [0, 0, 0] } } }, { id: 'hero', components: { body: { size: [1, 1, 1], vel: [0, 0, 0] } } }], }, skipTarget: true, spawn: [['rival', [20, 3, 0], 'rival'], ['ball', [15, 7.75, 0], 'ball']] }),
  'gameplay.paddle': () => ({ space: 'engine.space.physics2d', spaceWith: { gravity: [0, 0], bounds: [13, 20], edges: { bottom: 'open' } },
    systems: [{ use: 'gameplay.paddle', with: { ball: 'ball', bounds: [0, 13] } }],
    content: { archetypes: [{ id: 'pad', components: { body: { size: [2.2, 0.4], type: 'kinematic', restitution: 1, friction: 0 } } }, { id: 'ball', components: { body: { size: [0.36, 0.36], shape: { kind: 'circle', r: 0.18 }, restitution: 1, friction: 0, gravityScale: 0, bullet: true } } }] }, player: { archetype: 'pad', at: [6.5, 1.5] }, skipTarget: true }),
  'gameplay.launcher': () => ({ space: 'engine.space.physics2d', spaceWith: { gravity: [0, -10], bounds: [40, 20] },
    systems: [{ use: 'gameplay.launcher', with: { mode: 'sling', origin: [2, 3], forward: [1, 0], aim: [-0.5, 1.4], speed: 22, shots: [{ archetype: 'bird', count: 2 }] } }],
    content: { archetypes: [hero, { id: 'bird', kind: 'projectile', components: { body: { size: [0.8, 0.8], shape: { kind: 'circle', r: 0.4 }, density: 2.6, bullet: true } } }] }, skipTarget: true }),
  'gameplay.economy': () => ({ systems: [{ use: 'gameplay.inventory' }, { use: 'gameplay.interact' }, { use: 'gameplay.economy', with: { currencies: [{ id: 'gold', start: 20 }], shops: [{ id: 'shop', owner: 'mara', stock: [{ item: 'ale', count: 3, price: 5 }] }] } }],
    plot: { characters: [{ id: 'mara', name: 'Mara' }] }, content: { items: [{ id: 'ale', name: 'Ale', value: 5 }], archetypes: [hero] }, skipTarget: true }),
  'gameplay.build.structure': () => ({ systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'b_planks', count: 20 }, { item: 'stick', count: 2 }] } }, { use: 'gameplay.build.structure', with: { pieces: ['wall', 'door'], custom: [{ id: 'hut', size: [2, 2, 1], cost: [{ item: 'stick', count: 2 }] }], block: 'planks', refund: 0.5 } }],
    content: { items: [{ id: 'b_planks', name: 'Planks', kind: 'block', block: 'planks', stack: 64 }, { id: 'stick', name: 'Stick' }], blocks: [{ id: 'planks', name: 'Planks', hardness: 1 }, { id: 'door', name: 'Door', hardness: 1 }, { id: 'wall', name: 'Wall', hardness: 1 }], archetypes: [hero] }, skipTarget: true }),
};

function closure(registry, id, seen = new Set()) {
  if (seen.has(id)) return [];
  seen.add(id);
  const out = [];
  for (const r of registry.get(id).card.requires?.primitives || []) { const s = satisfying(registry, r); if (s) out.push(...closure(registry, s, seen), s); }
  return out;
}

/** Candidate documents for a primitive: [{source, doc}]. Synthetic ones are tried against each space until one compiles. */
function candidates(registry, id) {
  const out = [], p = registry.get(id), prims = registry.ids().map(i => registry.get(i));
  const tryCompile = (source, doc, setup) => { try { const { rt } = compile(doc, { primitives: prims }); out.push({ source, doc, setup }); return rt; } catch (error) { out.skipped = (out.skipped ? out.skipped + ' || ' : '') + `${source}: ${String(error.message).slice(0, 400)}`; return null; } };
  const recipe = RECIPES[id]?.();
  const deps = [...new Set(closure(registry, id))];
  const build = (space, r) => ({
    ...HEAD, spaces: [{ id: 'world', use: r?.space || space, ...(r?.spaceWith ? { with: r.spaceWith } : {}), ...(r?.zones ? { zones: r.zones } : {}) }, ...(r?.extraSpaces || [])],
    systems: r?.systems || [...deps, id].map(use => ({ use })),
    ...(r?.plot ? { plot: r.plot } : {}), content: r?.content || { archetypes: [hero] }, player: r?.player || { archetype: r?.content?.archetypes?.[0]?.id === 'pad' ? 'pad' : 'hero' },
  });
  if (recipe) {
    const doc = build(SPACES[0], recipe);
    tryCompile(`recipe(${doc.spaces[0].use})`, doc, { spawn: recipe.spawn, startEffects: recipe.startEffects, startInput: recipe.startInput });
  } else {
    for (const space of SPACES) { if (tryCompile(`synthetic(${space})`, build(space), {})) break; }
  }
  // Real games: the first document in v2/games that uses the primitive (richest context available).
  const dirs = ['v2/games', 'v2/examples'];
  for (const dir of dirs) for (const f of readdirSync(new URL(dir + '/', root)).filter(n => n.endsWith('.json')).sort()) {
    let doc; try { doc = JSON.parse(readFileSync(new URL(`${dir}/${f}`, root), 'utf8')); } catch { continue; }
    if (!(doc.systems || []).some(s => s.use === id)) continue;
    tryCompile(`${dir}/${f}`, doc, {});
    break;
  }
  void p;
  return out;
}

// ---------- invariants ----------
function badNumbers(value, path = '$', out = [], depth = 0) {
  if (depth > 40) return out;
  if (typeof value === 'number') { if (!Number.isFinite(value)) out.push(path); }
  else if (Array.isArray(value)) value.forEach((v, i) => badNumbers(v, `${path}[${i}]`, out, depth + 1));
  else if (value && typeof value === 'object') for (const k of Object.keys(value)) badNumbers(value[k], `${path}.${k}`, out, depth + 1);
  return out;
}

function makeWorld(doc, prims, setup) {
  const { rt } = compile(doc, { primitives: prims, seed: 7 });
  for (const [archetype, at, id] of setup.spawn || []) rt.spawn(archetype, { id, at: at === '@player' ? structuredClone(rt.player().at) : at });
  rt.step(); rt.step(setup.startInput || {}); rt.step();
  if (setup.startEffects) { rt.run(setup.startEffects); rt.step(); }
  return rt;
}

/**
 * Fuzz every action of one primitive. `post(progress)` is called before each trial so a parent can name
 * the action when the worker hangs or runs out of memory. Returns { id, ran: [{source, actions, trials}], failures, skipped }.
 */
export async function fuzzPrimitive(id, post = () => {}) {
  const { registry } = await loadCatalogue();
  const p = registry.get(id);
  const verbs = p.card.provides?.actions || [];
  const prims = registry.ids().map(i => registry.get(i));
  const result = { id, verbs, ran: [], failures: [], skipped: null, actionSpace: Boolean(p.card.actionSpace) };
  const cands = candidates(registry, id);
  if (!cands.length) { result.skipped = cands.skipped || 'no document could be built'; return result; }
  for (const { source, doc, setup } of cands) {
    let a, b;
    try { a = makeWorld(doc, prims, setup); b = makeWorld(doc, prims, setup); } catch (error) { result.ran.push({ source, error: `setup: ${error.message}` }); continue; }
    const base = a.snapshot(), baseBad = new Set(badNumbers(base));
    const flag = (action, value, kind, message) => result.failures.push({ source, action, value, kind, message });
    // Control run with no input: a trial whose end state differs from it (ignoring frame counters) proves the action did something.
    a.restore(structuredClone(base)); for (let i = 0; i < STEPS_WITH_ACTION + STEPS_AFTER; i++) a.step({});
    const control = JSON.stringify(a.snapshot());
    let trials = 0, effective = 0;
    // Input axes declared in actionSpace (move, look, drive...) are fuzzed through input.axes the same way.
    const extra = Object.keys(p.card.actionSpace || {}).filter(v => !verbs.includes(v));
    const channels = [...verbs.map(v => ['actions', v]), ...extra.flatMap(v => [['axes', v], ['actions', v]])];
    for (const [channel, verb] of channels) {
      for (const [label, value] of VALUES) {
        post({ source, action: verb, value: label });
        trials++;
        const snaps = [];
        for (const rt of [a, b]) {
          rt.restore(structuredClone(base));
          try {
            for (let i = 0; i < STEPS_WITH_ACTION + STEPS_AFTER; i++) {
              rt.step(i < STEPS_WITH_ACTION ? { [channel]: { [verb]: structuredClone(value) } } : {});
              const n = rt.state.events.length;
              if (n > EVENT_CAP) { flag(verb, label, 'event-flood', `${n} events in one step (cap ${EVENT_CAP})`); break; }
            }
          } catch (error) { flag(verb, label, 'throw', String(error?.stack || error).split('\n').slice(0, 3).join(' | ')); }
          snaps.push(rt.snapshot());
        }
        if (JSON.stringify(snaps[0]) !== control) effective++;
        const fresh = badNumbers(snaps[0]).filter(x => !baseBad.has(x));
        if (fresh.length) flag(verb, label, 'non-finite', `NaN/Infinity at ${fresh.slice(0, 3).join(', ')}`);
        if (JSON.stringify(snaps[0]) !== JSON.stringify(snaps[1])) flag(verb, label, 'nondeterministic', 'two identical worlds diverged');
      }
    }
    result.ran.push({ source, trials, effective });
  }
  return result;
}
