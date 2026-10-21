// What a concept IS and how the idea USES it are two questions (v2/planner/decompose.js). Every game or genre concept
// declares its own loop mechanic in step 2, whatever the idea does with it; step 3, with every loop known, relates each
// additional game concept to the primary over enums: nested (its loop runs inside the primary's, entered on the
// primary mechanic named first), union, or skin (only its content: its loop is marked flavor and never selected).
// A skin that the spec contradicts (win, lose or a core mechanic names the joined loop by id) is asked again.
// Scripted fake writers; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decomposeIdea, skinProblems } from '../v2/planner/decompose.js';
import { conceptMashupProblem, mashupSides, unplayedLoops } from '../v2/planner/play-spec.js';
import { worklist } from '../v2/planner/build.js';
import { selectPrimitives } from '../v2/planner/select.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { fakeWriter, buildAnswer, decomposer } from './v2-p-pipeline-fixtures.js';

const { registry } = buildCatalogue();
const writerOf = plan => { const answer = decomposer(plan); return fakeWriter([req => answer(req) ?? (() => { throw Error(`unexpected form ${req.schema?.name}`); })()]); };
const named = (writer, prefix) => writer.calls.filter(c => c.schema.name.startsWith(prefix));
const loopsOf = d => d.mechanics.filter(m => d.concepts.some(c => c.loop === m.id)).map(m => m.id);

const CHESS = { id: 'chess', name: 'Chess', quote: 'chess', kind: 'game', keeps: ['the board and its pieces', 'checkmate'] };
const POKEMON = { id: 'pokemon', name: 'Pokemon', quote: 'pokemon', kind: 'game', keeps: ['pokemon creatures', 'type advantages'] };
const CHESS_MECHANICS = [
  { id: 'chess_match', verb: 'move', description: 'move pieces by chess rules in turns until one king is checkmated', from: 'chess', role: 'loop' },
  { id: 'capture_pieces', verb: 'capture', description: 'capture an opposing piece by moving onto its square', from: 'chess', role: 'core' },
];
const CREATURE_BATTLE = { id: 'creature_battle', verb: 'battle', description: 'turn-based battle between two creatures using their moves', from: 'pokemon', role: 'loop' };
const POKEMON_CONTENT = [
  { id: 'use_creatures', verb: 'use', description: 'creatures stand in for the pieces', from: 'pokemon', role: 'core' },
  { id: 'type_advantages', verb: 'counter', description: 'creature types beat or resist other types', from: 'pokemon', role: 'supporting' },
];
const BASE_SPEC = { loop: 'chess_match', interaction: 'pieces-turns', opponent: 'ai-side', win: "checkmate the rival's king", lose: 'your own king is checkmated', theme: 'creature chess', narrative: false };
const NESTED = [{ relation: 'nested', mechanics: ['capture_pieces', 'creature_battle', 'type_advantages'], why: 'a capture starts a creature battle that decides it' }];
const SKIN = [{ relation: 'skin', mechanics: ['chess_match', 'creature_battle', 'use_creatures'], why: 'creatures are the pieces' }];
const plan = (spec, mechanics) => ({ concepts: [CHESS, POKEMON], mechanics: mechanics || { chess: CHESS_MECHANICS, pokemon: [CREATURE_BATTLE, ...POKEMON_CONTENT] }, spec,
  about: { title: 'Pocket Gambit', premise: 'Chess with creatures.', tone: 'bright' },
  where: { spaces: [{ role: 'board', kind: 'board', description: '8x8' }], views: ['board', 'ui'] } });

test('(a) a two-game idea always yields two loop mechanics: the second game\'s loop is a declaration, re-asked when left out', async () => {
  // The live failure's shape: the second game's mechanics answered as content only (no loop), as if the idea decided it.
  const writer = writerOf(plan(() => ({ ...BASE_SPEC, mashup: NESTED }), (req, n, concept) => ({ mechanics: concept === 'chess' ? CHESS_MECHANICS : n === 0 ? POKEMON_CONTENT : [CREATURE_BATTLE, ...POKEMON_CONTENT] })));
  const d = await decomposeIdea({ writer, prompt: 'chess but with pokemon', registry });
  // Step 1 asks for no "brings" flag: what a concept is decides it.
  const concepts = named(writer, 'idea_concepts')[0].schema.schema.properties.concepts.items.properties;
  assert.ok(!('brings' in concepts));
  const form = named(writer, 'concept_mechanics').find(c => /\nConcept: pokemon /.test(c.user));
  assert.deepEqual(form.schema.schema.properties.mechanics.items.properties.role.enum, ['loop', 'core', 'supporting', 'flavor'], 'a game is always offered its loop role');
  const fix = named(writer, 'concept_mechanics_fields')[0];
  assert.match(fix.user, /pokemon is a game, which always has its own loop, so exactly one of its mechanics has role loop/);
  assert.deepEqual(d.concepts.map(c => [c.id, c.loop]), [['chess', 'chess_match'], ['pokemon', 'creature_battle']]);
  assert.deepEqual(loopsOf(d), ['chess_match', 'creature_battle']);
  // Step 3 is asked with both loops known and their descriptions shown.
  const ask = named(writer, 'play_spec')[0];
  assert.deepEqual(ask.schema.schema.properties.loop.enum, ['chess_match', 'creature_battle']);
  assert.match(ask.user, /- pokemon: creature_battle: turn-based battle between two creatures using their moves/);
  assert.match(ask.user, /- chess: chess_match: move pieces by chess rules/);
});

test('(a) every additional game concept has exactly one entry, naming its loop mechanic', () => {
  const concepts = [{ ...CHESS, loop: 'chess_match' }, { ...POKEMON, loop: 'creature_battle' }];
  const mechanics = [...CHESS_MECHANICS, CREATURE_BATTLE, ...POKEMON_CONTENT];
  const check = mashup => conceptMashupProblem({ concepts, mechanics, mashup, loop: 'chess_match' });
  assert.equal(check(NESTED), null);
  assert.equal(check(SKIN), null);
  assert.equal(check([])?.code, 'mashup_missing');
  assert.equal(check([...NESTED, ...SKIN])?.code, 'mashup_duplicate');
  // Skin still names the joined loop: the relation is about that loop, whatever it decides.
  assert.equal(check([{ relation: 'skin', mechanics: ['chess_match', 'use_creatures'], why: '' }])?.code, 'mashup_loop_missing');
  // The primary's mechanic comes first: an entry joining chess into pokemon names the wrong side.
  assert.equal(check([{ relation: 'nested', mechanics: ['creature_battle', 'capture_pieces', 'chess_match'], why: '' }])?.code, 'mashup_outer');
});

test('(b) relation skin marks the joined loop flavor, and selection never builds it', async () => {
  const writer = writerOf(plan({ ...BASE_SPEC, mashup: SKIN }));
  const d = await decomposeIdea({ writer, prompt: 'chess but with pokemon', registry });
  assert.deepEqual(d.core.mashup, SKIN);
  assert.equal(d.mechanics.find(m => m.id === 'creature_battle').importance, 'flavor');
  assert.equal(d.mechanics.find(m => m.id === 'chess_match').importance, 'core');
  assert.deepEqual([...unplayedLoops(d)], ['creature_battle']);
  assert.ok(!worklist(d).some(m => m.id === 'creature_battle'), 'never on the worklist');
  // The build is offered the joined loop's own primitive: it is never asked about, never mapped.
  const build = fakeWriter([req => buildAnswer(req, { picks: { chess_match: ['gameplay.turns'], creature_battle: ['gameplay.creature.battle'] } }) ?? '{}']);
  const sel = await selectPrimitives({ decomposition: d, registry, writer: build });
  assert.ok(!build.calls.some(c => /\nMechanic creature_battle \(/.test(c.user)), 'no pick is asked for the unplayed loop');
  assert.ok(!sel.build.steps.some(s => s.mechanic === 'creature_battle'), 'no build step for it');
  const battle = sel.mechanics.find(m => m.id === 'creature_battle');
  assert.deepEqual([battle.primitives, battle.source], [[], 'unplayed']);
  assert.ok(!sel.gaps.some(g => g.mechanic === 'creature_battle'), 'an unplayed loop is not a gap');
  // Offline (lexical) selection skips it as well.
  const offline = await selectPrimitives({ decomposition: d, registry });
  assert.deepEqual(offline.mechanics.find(m => m.id === 'creature_battle').primitives, []);
});

test('(b) skin contradicted by the spec (win, lose or a core mechanic names the joined loop by id) re-asks the mashup', async () => {
  const mechanics = [...CHESS_MECHANICS, CREATURE_BATTLE, ...POKEMON_CONTENT];
  const concepts = [CHESS, POKEMON];
  const check = (spec, ms = mechanics) => skinProblems({ ...BASE_SPEC, mashup: SKIN, ...spec }, { concepts, mechanics: ms });
  assert.deepEqual(check({}), []);
  assert.match(check({ win: 'win the creature_battle for the last king' })[0].message, /win \('win the creature_battle for the last king'\) names creature_battle/);
  assert.match(check({ lose: 'your use_creatures squad is wiped out' })[0].message, /lose .* names use_creatures/);
  const capture = { ...CHESS_MECHANICS[1], description: 'a capture is decided by a creature_battle' };
  const [p] = check({}, [CHESS_MECHANICS[0], capture, CREATURE_BATTLE, ...POKEMON_CONTENT]);
  assert.equal(p.field, 'mashup');
  assert.match(p.message, /the core mechanic capture_pieces names creature_battle in its description/);
  // A supporting mechanic of the joined concept is not its loop: naming it is no contradiction.
  assert.deepEqual(check({ win: 'checkmate with type_advantages on your side' }), []);
  // In the decomposition: the skin answer is re-asked as the mashup field alone, and the nested answer kept.
  const writer = writerOf(plan((req, n) => ({ ...BASE_SPEC, win: 'checkmate the rival king after each creature_battle', mashup: n === 0 ? SKIN : NESTED })));
  const d = await decomposeIdea({ writer, prompt: 'chess but with pokemon', registry });
  const asks = named(writer, 'play_spec');
  assert.deepEqual(asks.map(c => c.schema.name), ['play_spec', 'play_spec_fields']);
  assert.deepEqual(Object.values(asks[1].schema.schema.properties).map(x => x.description.split(':')[0]), ['mashup']);
  assert.match(asks[1].user, /leaves pokemon's loop creature_battle unplayed/);
  assert.deepEqual(d.core.mashup, NESTED);
  assert.equal(d.mechanics.find(m => m.id === 'creature_battle').importance, 'core');
});

test('(c) relation nested keeps both loops and names the primary event that enters the joined one', async () => {
  const writer = writerOf(plan({ ...BASE_SPEC, mashup: NESTED }));
  const d = await decomposeIdea({ writer, prompt: 'chess but with pokemon', registry });
  assert.deepEqual(d.mechanics.filter(m => loopsOf(d).includes(m.id)).map(m => [m.id, m.importance]), [['chess_match', 'core'], ['creature_battle', 'core']]);
  assert.equal(unplayedLoops(d).size, 0);
  assert.deepEqual(worklist(d).map(m => m.id).slice(0, 3), ['chess_match', 'capture_pieces', 'creature_battle']);
  const [entry] = d.core.mashup;
  assert.equal(entry.relation, 'nested');
  assert.deepEqual(mashupSides(entry, d.mechanics), { outer: ['capture_pieces'], inner: ['creature_battle', 'type_advantages'] }, 'the capture enters the battle');
  assert.equal(d.mechanics.find(m => m.id === entry.mechanics[0]).from, 'chess');
});

test('(d) a single game plus a setting yields one loop, and the setting joins as skin or not at all', async () => {
  const MAZE = { id: 'pac_man', name: 'Pac-Man', quote: 'Pac-Man', kind: 'game', keeps: ['maze chase'] };
  const LIBRARY = { id: 'haunted_library', name: 'haunted library', quote: 'a haunted library', kind: 'setting', keeps: ['shelves as walls'] };
  const mechanics = { pac_man: [{ id: 'maze_chase', verb: 'eat', description: 'eat every pellet while ghosts chase you', from: 'pac_man', role: 'loop' }], haunted_library: [{ id: 'shelf_walls', verb: 'wall', description: 'shelves form the maze walls', from: 'haunted_library', role: 'flavor' }] };
  const spec = { loop: 'maze_chase', interaction: 'avatar-grid', opponent: 'ai-rival', win: 'eat every pellet in the library', lose: 'a ghost catches you', theme: 'haunted', narrative: false, mashup: [{ relation: 'skin', mechanics: ['maze_chase', 'shelf_walls'], why: 'the library is the maze' }] };
  const writer = writerOf({ concepts: [MAZE, LIBRARY], mechanics, spec, where: { spaces: [{ role: 'maze', kind: 'tiles-topdown', description: 'shelves' }], views: ['td'], movement: 'ground' } });
  const d = await decomposeIdea({ writer, prompt: 'Pac-Man in a haunted library', registry });
  assert.deepEqual(loopsOf(d), ['maze_chase']);
  assert.deepEqual(d.concepts.map(c => c.loop), ['maze_chase', undefined]);
  assert.equal(unplayedLoops(d).size, 0, 'a setting has no loop to leave unplayed');
  assert.deepEqual(named(writer, 'concept_mechanics').find(c => /\nConcept: haunted_library /.test(c.user)).schema.schema.properties.mechanics.items.properties.role.enum, ['core', 'supporting', 'flavor']);
  assert.ok(d.calls.every(c => !c.problems));
});

test('(e) three unrelated two-game ideas: two loops each, one entry per joined game, the same prompts for all', async () => {
  const game = (id, name) => ({ id, name, quote: name, kind: 'game', keeps: [] });
  const loop = (id, from, description) => ({ id, verb: id.split('_')[0], description, from, role: 'loop' });
  const ideas = [
    { prompt: 'a racing game where item boxes start a maze chase', concepts: [game('kart_racer', 'kart racer'), game('maze_chaser', 'maze chaser')],
      mechanics: { kart_racer: [loop('race_laps', 'kart_racer', 'race laps against rivals'), { id: 'item_boxes', verb: 'grab', description: 'drive through item boxes for a bonus', from: 'kart_racer', role: 'core' }], maze_chaser: [loop('chase_maze', 'maze_chaser', 'eat every pellet while ghosts chase you')] },
      spec: { loop: 'race_laps', interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'finish first', lose: 'finish behind every rival', theme: 'arcade', narrative: false, mashup: [{ relation: 'nested', mechanics: ['item_boxes', 'chase_maze'], why: 'an item box opens a maze round' }] } },
    { prompt: 'falling blocks and a snake on the same grid', concepts: [game('falling_blocks', 'falling blocks'), game('snake', 'snake')],
      mechanics: { falling_blocks: [loop('clear_lines', 'falling_blocks', 'drop pieces and clear full lines')], snake: [loop('grow_snake', 'snake', 'steer a growing snake to eat food without biting itself')] },
      spec: { loop: 'clear_lines', interaction: 'cursor-board', opponent: 'clock', win: 'clear forty lines', lose: 'the stack reaches the top', theme: 'neon', narrative: false, mashup: [{ relation: 'union', mechanics: ['clear_lines', 'grow_snake'], why: 'the snake crawls over the stack' }] } },
    { prompt: 'a farming game dressed as a space shooter', concepts: [game('farm_sim', 'farming game'), game('space_shooter', 'space shooter')],
      mechanics: { farm_sim: [loop('tend_crops', 'farm_sim', 'plant, water and harvest crops by season')], space_shooter: [loop('shoot_waves', 'space_shooter', 'shoot down waves of ships'), { id: 'ship_designs', verb: 'show', description: 'ships and starfields as the look', from: 'space_shooter', role: 'flavor' }] },
      spec: { loop: 'tend_crops', interaction: 'avatar-realtime', opponent: 'clock', win: 'harvest every field before winter', lose: 'the crops wither', theme: 'space farm', narrative: false, mashup: [{ relation: 'skin', mechanics: ['tend_crops', 'shoot_waves', 'ship_designs'], why: 'the farm looks like a starfield' }] } },
  ];
  const systems = new Map();
  for (const idea of ideas) {
    // Each is first answered with no mashup: the second game is asked for, as that field alone.
    const writer = writerOf({ concepts: idea.concepts, mechanics: idea.mechanics, spec: (req, n) => (n === 0 ? { ...idea.spec, mashup: [] } : idea.spec) });
    const d = await decomposeIdea({ writer, prompt: idea.prompt, registry });
    assert.equal(loopsOf(d).length, 2, idea.prompt);
    assert.deepEqual(d.concepts.map(c => Boolean(c.loop)), [true, true], idea.prompt);
    const fix = named(writer, 'play_spec_fields')[0];
    assert.match(fix.user, new RegExp(`no entry links ${idea.concepts[1].id}`), idea.prompt);
    assert.deepEqual(d.core.mashup, idea.spec.mashup, idea.prompt);
    const joinedLoop = d.concepts[1].loop;
    assert.equal(d.mechanics.find(m => m.id === joinedLoop).importance, idea.spec.mashup[0].relation === 'skin' ? 'flavor' : 'core', idea.prompt);
    for (const c of writer.calls) { const k = c.schema.name; if (!systems.has(k)) systems.set(k, new Set()); systems.get(k).add(c.system); }
  }
  // The concept, mechanics and play spec forms: one system prompt each across the ideas (idea_spaces varies with the
  // interaction alone).
  for (const [k, s] of systems) if (/^(idea_concepts|concept_mechanics|play_spec)/.test(k)) assert.equal(s.size, 1, `${k} has ${s.size} system prompts`);
  assert.ok(systems.has('play_spec_fields'));
});
