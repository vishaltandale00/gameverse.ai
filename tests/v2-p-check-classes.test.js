// Catalogue conformance for the static checks' readings of loops, participants and content (ARCHITECTURE.md §1.4, §6.1,
// §6.2), derived from the live registry so a defect class is found once, everywhere:
//   via           a loop played through another primitive (card.mode.via) names that primitive's params: the composition
//                 check never throws on it and finds them there; its participants are the host's (checked once, on the host);
//   win owner     the composition check and the loop check read the game's win one way (loop.js winOwner, unwired): a
//                 wrapper's wired win (card.mode.wraps) owns it and the loops it wraps are not demanded; a declared `end`
//                 boolean wires a win; with nothing wired, both checks report it;
//   placement     participants are placed by any instance whose card declares an archetype reference in its params
//                 (census.js placedBy), not only by spawner rules;
//   content       world content is covered by any unit whose card declares provides.content (a board fills its cells);
//                 every card that owns a board declares it;
//   typed counts  an event count a `when` template fixes is filled by the typed count of that event (`name:<subject>`,
//                 KERNEL_API rt.emitTyped) when a primitive of the document emits it typed, and only then;
//   reads.by      a provider whose code runs on events (reads.by.events) is driven when a player-driven primitive emits them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { checkComposition } from '../v2/planner/compose-check.js';
import { loopReport, readsOf, LOOP_CODES } from '../v2/planner/loop-check.js';
import { cardLoop, endsGame, loopInstances, unwired, typedEvents, fills } from '../v2/planner/loop.js';
import { contractsOf, participantsOf } from '../v2/planner/content.js';
import { placedBy } from '../v2/planner/census.js';
import { BOARD_CONTENT } from '../v2/primitives/gameplay/puzzle-lib-board.js';

const { registry, logic } = await liveCatalogue();
const cards = registry.cards();
const won = [{ do: 'end_game', outcome: 'won' }];
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const SCHEMA = 'gameverse.v2.game/0.2';
const isSpace = id => id.startsWith('engine.space.');

/** A space a loop declares it plays on (its first registered space id), else engine.space.none. */
const spaceFor = card => (cardLoop(card)?.space || []).find(x => typeof x === 'string' && registry.has(x)) || 'engine.space.none';
const docOf = (systems, extra = {}, space = 'engine.space.none') => ({ schema: SCHEMA, id: 't', title: 'T', spaces: [{ id: 'world', use: space }], systems, ...extra });
const compose = doc => checkComposition(doc, registry, { logic });
const codes = (r, unit, code) => r.failures.filter(f => f.unit === unit && f.code === code);

/** The instance config in which a card's win exists (its `applies` configuration), from its declarations. */
function present(card) {
  const end = cardLoop(card)?.win, w = {};
  if (end?.applies?.given === true) {
    const spec = card.params?.[end.applies.param] || {};
    w[end.applies.param] = spec.type === 'list' ? [{}] : spec.default ?? spec.min ?? spec.options?.[0] ?? true;
  } else if (end?.applies) {
    const { param, field, is } = end.applies;
    w[param] = card.params?.[param]?.type === 'list' ? [field ? { [field]: is } : is] : field ? { [field]: is } : is;
  }
  return w;
}
/** Game-ending wins the composition check wires (an effects param that is no list field, or an `end` boolean), in their own instance. */
const ownWins = cards.filter(c => { const l = cardLoop(c), e = l?.win; return endsGame(e) && !l.via && ((typeof e.param === 'string' && !e.param.includes('.')) || typeof e.end === 'string'); });
const wrappers = cards.filter(c => c.mode?.wraps && endsGame(cardLoop(c)?.win) && typeof cardLoop(c).win.param === 'string');
const wireParam = card => ({ ...present(card), [cardLoop(card).win.param]: won });

test('via: every loop played through another primitive is checked on that primitive\'s params, and the check never throws', () => {
  const vias = cards.filter(c => cardLoop(c)?.via);
  assert.ok(vias.length >= 2, vias.map(c => c.id).join(', '));
  const failures = [];
  for (const c of vias) {
    const via = cardLoop(c).via, P = cardLoop(c).needs.participants;
    const host = { use: via, with: {} }, self = { use: c.id, with: present(c) };
    let r;
    try { r = compose(docOf([host, self], {}, spaceFor(c))); } catch (e) { failures.push(`${c.id}: compose-check throws: ${e.message}`); continue; }
    const holes = r.holes.filter(h => h.card === c.id && h.code === 'mode_param_unknown');
    if (holes.length) failures.push(`${c.id}: ${holes.map(h => h.message).join('; ')}`);
    if (typeof P !== 'string') continue;
    // Participants: the host's param, reported on the host only; given its declared minimum, none are missing.
    const min = contractsOf(registry, via).find(x => x.need === 'param' && x.param === P)?.min ?? 2;
    const bare = loopReport(docOf([{ use: via, with: { [P]: [] } }, self]), registry, { logic }).problems.filter(p => p.code === LOOP_CODES.participants);
    if (bare.some(p => p.primitive === c.id)) failures.push(`${c.id}: its participants are reported on it, not on its host ${via}`);
    if (!bare.some(p => p.primitive === via)) failures.push(`${c.id}: ${via} with no ${P} is not reported`);
    const given = { use: via, with: { [P]: Array.from({ length: min }, (_, i) => ({ id: `g${i}` })) } };
    const full = loopReport(docOf([given, self]), registry, { logic }).problems.filter(p => p.code === LOOP_CODES.participants);
    if (full.length) failures.push(`${c.id}: ${via} given ${min} ${P}: ${full.map(p => p.message).join('; ')}`);
  }
  assert.deepEqual(failures, []);
});

test('win owner: a wrapper\'s wired win owns the game; the loops it wraps are not demanded by either check, and both report a document that wires nothing', () => {
  assert.ok(wrappers.length >= 1 && ownWins.length >= 8, `${wrappers.map(c => c.id)} / ${ownWins.map(c => c.id)}`);
  const failures = [];
  for (const w of wrappers) for (const l of ownWins) {
    if (l.id === w.id) continue;
    for (const systems of [[{ use: w.id, with: wireParam(w) }, { use: l.id, with: present(l) }], [{ use: l.id, with: present(l) }, { use: w.id, with: wireParam(w) }]]) {
      const doc = docOf(systems, {}, spaceFor(l)), label = systems.map(s => s.use).join(' + ');
      const r = compose(doc), report = loopReport(doc, registry, { logic });
      if (codes(r, l.id, 'mode_win_unwired').length) failures.push(`${label}: compose-check demands ${l.id}'s wrapped win`);
      if (report.owner !== w.id) failures.push(`${label}: loop owner ${report.owner}, the wired win is ${w.id}'s`);
      if (report.problems.some(p => p.code === LOOP_CODES.win)) failures.push(`${label}: loop_win_unwired`);
    }
    // Nothing wired: each check reports the one owner's win, the same loop.
    const doc = docOf([{ use: w.id }, { use: l.id, with: present(l) }], {}, spaceFor(l));
    const r = compose(doc), report = loopReport(doc, registry, { logic });
    const unwiredUnits = r.failures.filter(f => f.code === 'mode_win_unwired').map(f => f.unit);
    if (unwiredUnits.length !== 1 || unwiredUnits[0] !== report.owner) failures.push(`${w.id} + ${l.id} unwired: compose-check reports ${unwiredUnits.join(', ') || 'nothing'}, the loop check's owner is ${report.owner}`);
    if (!report.problems.some(p => p.code === LOOP_CODES.win)) failures.push(`${w.id} + ${l.id} unwired: no loop_win_unwired`);
  }
  assert.deepEqual(failures, []);
});

test('win owner: the composition check and the loop check agree on every own win, wired by its effects param, by its `end` boolean, or not at all', () => {
  const ends = ownWins.filter(c => typeof cardLoop(c).win.end === 'string');
  assert.ok(ends.length >= 3, ends.map(c => c.id).join(', '));
  const failures = [];
  for (const c of ownWins) {
    const e = cardLoop(c).win;
    const configs = [['nothing', { ...present(c), ...(typeof e.end === 'string' ? { [e.end]: false } : {}) }, false]];
    if (typeof e.param === 'string') configs.push(['its param', wireParam(c), true]);
    if (typeof e.end === 'string') configs.push([`with.${e.end}`, { ...present(c), [e.end]: true }, true]);
    for (const [how, w, wired] of configs) {
      const doc = docOf([{ use: c.id, with: w }], {}, spaceFor(c));
      const composed = codes(compose(doc), c.id, 'mode_win_unwired').length === 0;
      const looped = !loopReport(doc, registry, { logic }).problems.some(p => p.code === LOOP_CODES.win && p.primitive === c.id);
      if (composed !== wired || looped !== wired) failures.push(`${c.id} wired by ${how}: compose-check ${composed ? 'wired' : 'unwired'}, loop check ${looped ? 'wired' : 'unwired'}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('win/lose params: every declared param and `end` of a card loop names a param of the card (or of its via host)', () => {
  const failures = [];
  for (const c of cards) {
    const l = cardLoop(c); if (!l) continue;
    const host = l.via ? registry.get(l.via)?.card : c;
    for (const side of ['win', 'lose']) for (const key of ['param', 'end']) {
      const name = l[side]?.[key];
      if (typeof name === 'string' && !host?.params?.[name.split('.')[0]]) failures.push(`${c.id}: ${side}.${key} '${name}'`);
    }
  }
  assert.deepEqual(failures, []);
});

/** Every param path a card declares as an archetype reference: [path segments with '[]' for list entries]. */
function refPaths(card) {
  const out = [];
  const walk = (spec, path) => {
    if (!isObj(spec)) return;
    if (spec.type === 'ref' && spec.to === 'archetype') { out.push(path); return; }
    if (spec.type === 'list') walk(spec.of, [...path, '[]']);
    if (isObj(spec.fields)) for (const [k, f] of Object.entries(spec.fields)) walk(f, [...path, k]);
  };
  for (const [k, s] of Object.entries(card.params || {})) walk(s, [k]);
  return out;
}
/** A `with` value placing `archetype` at a declared reference path. */
const placing = (path, archetype) => {
  const build = rest => (!rest.length ? archetype : rest[0] === '[]' ? [build(rest.slice(1))] : { [rest[0]]: build(rest.slice(1)) });
  return { [path[0]]: build(path.slice(1)) };
};

test('placement: a participant group is placed by any instance whose card declares an archetype reference in its params', () => {
  const placers = cards.filter(c => !isSpace(c.id)).flatMap(c => refPaths(c).map(path => ({ id: c.id, path })));
  assert.ok(placers.length >= 20 && placers.some(p => p.id === 'gameplay.stage.sequence'), placers.map(p => p.id).join(', '));
  // Loops whose participants are groups of entities with a component (content.js participantsOf).
  const groupLoops = cards.filter(c => typeof cardLoop(c)?.needs.participants === 'string' && !cardLoop(c).via && contractsOf(registry, c.id).some(x => x.need === 'archetypes' && x.component));
  assert.ok(groupLoops.length >= 1, 'the catalogue has loops with group participants');
  const failures = [];
  let checked = 0;
  for (const g of groupLoops) {
    const P = cardLoop(g).needs.participants, component = contractsOf(registry, g.id).find(x => x.need === 'archetypes' && x.component).component;
    const where = isObj(g.engage?.join?.where) ? g.engage.join.where : {};
    const groups = [{ id: 'home', ...where, members: ['player'] }, { id: 'foes', members: ['foe'] }];
    const content = { archetypes: [{ id: 'foe', name: 'Foe', components: { [component]: {} } }] };
    const loop = { use: g.id, with: { [P]: groups } };
    const empty = doc => loopReport(doc, registry, { logic }).problems.some(p => p.code === LOOP_CODES.group && p.need.group === 'foes');
    const base = docOf([loop], { content });
    if (!participantsOf(base, registry).some(p => p.use === g.id)) continue;
    checked++;
    if (!empty(base)) failures.push(`${g.id}: a group nothing places is not reported empty`);
    for (const { id, path } of placers) {
      if (id === g.id) continue;
      const doc = docOf([loop, { use: id, with: placing(path, 'foe') }], { content });
      if (!placedBy(doc, registry).some(r => r.archetype === 'foe' && r._use === id)) failures.push(`${id} ${path.join('.')}: placedBy does not read it`);
      if (empty(doc)) failures.push(`${g.id} + ${id} ${path.join('.')}: the group it places is reported empty`);
    }
  }
  assert.ok(checked >= 1, 'a group loop was checked');
  assert.deepEqual(failures, []);
});

test('content: every unit that declares provides.content covers it on its space; every card that owns a board declares the board\'s cells', () => {
  const boards = cards.filter(c => Object.values(c.params || {}).some(s => s?.region === 'board'));
  assert.ok(boards.length >= 3, boards.map(c => c.id).join(', '));
  const failures = [];
  for (const c of boards) if (!BOARD_CONTENT.every(k => (c.provides.content || []).includes(k))) failures.push(`${c.id}: owns a board and does not declare provides.content ${BOARD_CONTENT.join(', ')}`);
  const mechanics = cards.filter(c => !isSpace(c.id) && !c.id.startsWith('engine.generate.') && !c.adapts && (c.provides.content || []).length);
  assert.ok(mechanics.length >= 3, mechanics.map(c => c.id).join(', '));
  let checked = 0;
  for (const m of mechanics) for (const sp of cards.filter(c => isSpace(c.id) && (c.needs?.content || []).length)) {
    const need = sp.needs.content;
    if (!need.every(k => m.provides.content.includes(k))) continue;
    if (!(m.requires.capabilities || []).every(x => (sp.provides.capabilities || []).includes(x))) continue;
    checked++;
    const missing = doc => compose(doc).failures.filter(f => f.code === 'content_missing' && need.includes(f.need?.item));
    const without = missing(docOf([], {}, sp.id)), withIt = missing(docOf([{ use: m.id }], {}, sp.id));
    if (!without.length) failures.push(`${sp.id}: an empty ${need.join(', ')} is not reported`);
    if (withIt.length) failures.push(`${m.id} on ${sp.id}: ${withIt.map(f => f.message).join('; ')}`);
  }
  assert.ok(checked >= 3, 'mechanics with content were checked on spaces that need it');
  assert.deepEqual(failures, []);
});

/** `when` wins whose template fixes an event count, and the catalogue cards that emit that event typed. */
const countWins = cards.filter(c => endsGame(cardLoop(c)?.win) && isObj(cardLoop(c).win.when) && typeof cardLoop(c).win.when.count === 'string');
const typedBy = event => cards.filter(c => (c.provides.events || []).includes(`${event}:*`));
const evaluator = cards.find(c => (c.reads || []).includes('plot.endings') && cardLoop(c) && !cardLoop(c).win && !(c.requires.capabilities || []).length);

test('typed counts: an event count template is filled by the typed count of that event when the document emits it typed, and only then', () => {
  assert.ok(countWins.length >= 3 && evaluator, countWins.map(c => c.id).join(', '));
  const failures = [];
  let typed = 0;
  for (const c of countWins) {
    const t = cardLoop(c).win.when, event = t.count;
    const fill = count => JSON.parse(JSON.stringify({ ...t, count }).replace(/"\$[a-z]+"/g, '4'));
    const wiredBy = (systems, count) => {
      const doc = docOf([...systems, { use: evaluator.id }], { plot: { endings: [{ id: 'won', outcome: 'won', when: fill(count) }] } });
      const l = loopInstances(doc, registry).find(x => x.use === c.id);
      return unwired(doc, l, cardLoop(c).win, 'won', registry) === null;
    };
    if (!wiredBy([{ use: c.id }], event)) failures.push(`${c.id}: its own template filled is not wired`);
    for (const emitter of typedBy(event)) {
      typed++;
      const systems = emitter.id === c.id ? [{ use: c.id }] : [{ use: c.id }, { use: emitter.id }];
      if (!typedEvents(docOf(systems), registry).has(event)) failures.push(`${emitter.id}: declares ${event}:* and typedEvents misses it`);
      if (!wiredBy(systems, `${event}:target`)) failures.push(`${c.id} + ${emitter.id}: ${event}:target does not fill { count: '${event}' }`);
      if (wiredBy(systems, `${event}_other:target`)) failures.push(`${c.id} + ${emitter.id}: another event fills { count: '${event}' }`);
      if (wiredBy(systems, `${event}:`)) failures.push(`${c.id} + ${emitter.id}: an empty subject fills { count: '${event}' }`);
    }
    // Without a primitive emitting it typed, the narrowed count is another quantity.
    if (!(c.provides.events || []).includes(`${event}:*`) && wiredBy([{ use: c.id }], `${event}:target`)) failures.push(`${c.id}: ${event}:target fills its template with nothing emitting ${event} typed`);
    if (fills(t, fill(`${event}:target`))) failures.push(`${c.id}: fills accepts a typed count with no typed events given`);
  }
  assert.ok(typed >= 2, 'the catalogue has count templates over typed events');
  assert.deepEqual(failures, []);
});

test('reads.by: a provider whose code runs on events is driven when a player-driven primitive of the document emits them', () => {
  const cases = [];
  for (const c of cards) {
    const loop = cardLoop(c), r = readsOf(loop?.win);
    if (!endsGame(loop?.win) || !r || !(r.event || r.var) || loop.verbs.length) continue;
    const events = (r.by?.events || []).filter(e => e !== '*');
    for (const p of cards.filter(x => x.id !== c.id && cardLoop(x)?.verbs.length && (x.provides.events || []).some(e => events.includes(e)))) cases.push({ c, p });
  }
  assert.ok(cases.some(x => x.c.id === 'gameplay.destructible'), cases.map(x => `${x.c.id}+${x.p.id}`).join(', '));
  const failures = [];
  const unaffected = (systems, c) => loopReport({ systems }, registry, { logic, core: [c.id] }).problems.some(p => p.code === LOOP_CODES.unaffected && p.primitive === c.id);
  for (const { c, p } of cases) {
    const support = (p.requires.primitives || []).filter(x => registry.has(x)).map(use => ({ use }));
    if (unaffected([{ use: c.id, with: present(c) }, { use: p.id }, ...support], c)) failures.push(`${c.id} + ${p.id}: the events ${p.id} emits do not drive ${c.id}'s win`);
    if (!unaffected([{ use: c.id, with: present(c) }], c)) failures.push(`${c.id} alone: its win is not reported unaffected`);
  }
  assert.deepEqual(failures, []);
});
