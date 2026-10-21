// Catalogue conformance for the loop check's two identifications (v2/planner/loop-check.js), derived from the registry:
//   win owner      a game is won one way. Of the loops declaring a game-ending win, the one the document wires to a won
//                  ending owns it (winOwner); another loop's declared win the document does not use is never demanded
//                  (no loop_win_unwired / loop_win_unaffected / reads problem for it), whatever the order, and a document
//                  with no wired win still fails (loop_win_unwired). A `when` win is wired by the ending that fills ITS
//                  template, not by any ending with a trigger.
//   player movement  every primitive that moves the player's body (movesPlayer: a locomotion with player verbs, or a
//                  primitive moving the entity the player is seated in, card.engage.player.movement) is the player's
//                  movement for every win that reads movement (reads.by.movement); every seat a primitive spawns for the
//                  player declares whether it moves the player, and a moving one declares the seat and its controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { cardLoop, endsGame } from '../v2/planner/loop.js';
import { loopReport, movesPlayer, playerChanges, evaluatesEndings, readsOf, LOOP_CODES } from '../v2/planner/loop-check.js';

const { registry, logic } = buildCatalogue();
const cards = registry.cards();
const won = [{ do: 'end_game', outcome: 'won' }];
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The codes that demand a win be reached. */
const DEMANDS = [LOOP_CODES.win, LOOP_CODES.unaffected, LOOP_CODES.reads, LOOP_CODES.component, LOOP_CODES.owner];

/** A required primitive id (or prefix) resolved to a registered primitive. */
const resolve = req => (registry.has(req) ? req : cards.find(c => c.id.startsWith(`${req}.`))?.id ?? null);

/**
 * The instance config that wires a card's game-ending win in its own instance, from its declarations (the `applies`
 * configuration it exists in, an end_game effect in its param or list field, its `end` boolean); null when its win is
 * not wired in its own instance (a `when` or story ending, or a `via` host).
 */
function wiring(card) {
  const loop = cardLoop(card), end = loop?.win;
  if (!endsGame(end) || loop.via || (typeof end.param !== 'string' && typeof end.end !== 'string')) return null;
  const w = {};
  if (end.applies) {
    const { param, field, is } = end.applies;
    w[param] = card.params?.[param]?.type === 'list' ? [field ? { [field]: is } : is] : field ? { [field]: is } : is;
  }
  if (typeof end.param === 'string') {
    const [p, field] = end.param.split('.');
    if (field) w[p] = (Array.isArray(w[p]) && w[p].length ? w[p] : [{}]).map(e => ({ ...(isObj(e) ? e : {}), [field]: won }));
    else w[p] = won;
  }
  if (typeof end.end === 'string') w[end.end] = true;
  return w;
}

const wins = cards.filter(c => endsGame(cardLoop(c)?.win));
const wirable = wins.filter(c => wiring(c));
/** `when` wins: wired by a plot ending filling their template, evaluated by the primitive that reads plot.endings. */
const whens = wins.filter(c => isObj(cardLoop(c).win.when));
const evaluator = cards.find(evaluatesEndings);
const filled = card => JSON.parse(JSON.stringify(cardLoop(card).win.when).replace(/"\$[a-z]+"/g, '5'));
const fixed = card => JSON.stringify(Object.entries(cardLoop(card).win.when).filter(([, v]) => !(typeof v === 'string' && v.startsWith('$'))));

const demanded = (report, id) => report.problems.filter(p => p.primitive === id && DEMANDS.includes(p.code)).map(p => p.code);

test('the catalogue has declared wins wired in their own instance, `when` wins and an endings evaluator to check', () => {
  assert.ok(wirable.length >= 5, wirable.map(c => c.id).join(', '));
  assert.ok(whens.length >= 3, whens.map(c => c.id).join(', '));
  assert.ok(evaluator, 'a primitive evaluates plot.endings');
});

test('win owner: the loop whose win the document wires owns it, and no other declared win is demanded, in either order', () => {
  const failures = [];
  for (const p of wirable) for (const w of wins) {
    // A loop played through p (card.mode.via) is wired by p's wiring itself: its win is used, not another one.
    if (w.id === p.id || cardLoop(w).via === p.id) continue;
    for (const systems of [[{ use: w.id }, { use: p.id, with: wiring(p) }], [{ use: p.id, with: wiring(p) }, { use: w.id }]]) {
      const report = loopReport({ systems }, registry, { logic });
      if (report.owner !== p.id) failures.push(`${systems.map(s => s.use).join(' + ')}: owner ${report.owner}, wired ${p.id}`);
      const d = demanded(report, w.id);
      if (d.length) failures.push(`${systems.map(s => s.use).join(' + ')}: ${w.id}'s unused win demanded (${d.join(', ')})`);
    }
  }
  assert.deepEqual(failures, []);
});

test('win owner: a document that wires no win still fails (loop_win_unwired), for every pair of declared wins', () => {
  const failures = [];
  for (const a of wins) for (const b of wins) {
    if (a.id === b.id) continue;
    const report = loopReport({ systems: [{ use: a.id }, { use: b.id }] }, registry, { logic });
    if (!report.problems.some(p => p.code === LOOP_CODES.win && p.primitive === report.owner)) failures.push(`${a.id} + ${b.id}: no loop_win_unwired (owner ${report.owner})`);
  }
  assert.deepEqual(failures, []);
});

test('win owner: a `when` win is wired by the ending that fills its own template; another `when` win is not demanded', () => {
  const failures = [];
  for (const p of whens) for (const w of whens) {
    if (w.id === p.id || fixed(w) === fixed(p)) continue;
    for (const systems of [[{ use: w.id }, { use: p.id }], [{ use: p.id }, { use: w.id }]]) {
      const doc = { systems: [...systems, { use: evaluator.id }], plot: { endings: [{ id: 'victory', outcome: 'won', when: filled(p) }] } };
      const report = loopReport(doc, registry, { logic });
      if (report.owner !== p.id) failures.push(`${systems.map(s => s.use).join(' + ')}: owner ${report.owner}, ending fills ${p.id}'s template`);
      const d = demanded(report, w.id).filter(c => c !== LOOP_CODES.unaffected || report.owner === w.id);
      if (d.length) failures.push(`${systems.map(s => s.use).join(' + ')}: ${w.id}'s unused win demanded (${d.join(', ')})`);
    }
  }
  assert.deepEqual(failures, []);
});

/** Primitives that move the player's body, from their declarations: a locomotion with player verbs, or a seat's motion. */
const movers = cards.filter(c => c.engage?.player?.movement === true || (typeof c.locomotion === 'string' && cardLoop(c)?.verbs.length));
/** Wins that read the player's movement through an event or var their loop's primitive provides. */
const moveWins = wins.filter(c => { const r = readsOf(cardLoop(c).win); return r?.by?.movement && (r.event || r.var); });
const required = card => (card.requires?.primitives || []).map(resolve).filter(Boolean);

test('player movement: every seat a primitive spawns for the player declares whether it moves the player; a moving one declares the seat and its controls', () => {
  const failures = [];
  for (const c of cards) {
    const spawn = c.engage?.player?.spawn;
    if (!spawn?.role) continue;
    // The seat: a primitive it requires enters the player into the entity it spawns (engage.player.enter names its role).
    const seats = required(c).some(id => JSON.stringify(registry.get(id)?.card.engage?.player?.enter || []).includes(`"$${spawn.role}"`));
    if (!seats) continue;
    const m = c.engage.player.movement;
    if (typeof m !== 'boolean') failures.push(`${c.id}: spawns the player's seat (${spawn.role}) and does not declare engage.player.movement`);
    if (m === true && !Object.keys(c.actionSpace || {}).length) failures.push(`${c.id}: moves the seated player and declares no controls (actionSpace)`);
  }
  for (const c of cards.filter(x => x.engage?.player?.movement === true)) {
    const role = c.engage.player.spawn?.role;
    if (!role || !required(c).some(id => JSON.stringify(registry.get(id)?.card.engage?.player?.enter || []).includes(`"$${role}"`))) failures.push(`${c.id}: declares engage.player.movement without a spawn a required primitive seats the player in`);
  }
  assert.deepEqual(failures, []);
  assert.ok(cards.some(c => c.engage?.player?.movement === true), 'the catalogue has primitives that move a seated player');
  for (const c of movers) assert.ok(movesPlayer(c), `${c.id}: moves the player's body`);
});

test('player movement: every mover drives every win that reads the player\'s movement; without it the win is unaffected', () => {
  assert.ok(movers.length >= 5 && moveWins.length >= 2, `${movers.map(c => c.id)} / ${moveWins.map(c => c.id)}`);
  const failures = [];
  for (const m of movers) {
    assert.ok(playerChanges(registry, m, { movement: true }, { logic, used: [m.id, ...required(m)] }), `${m.id}: changes what movement changes`);
    const support = required(m).map(use => ({ use }));
    for (const l of moveWins) {
      const loop = { use: l.id, with: wiring(l) || {} };
      const report = loopReport({ systems: [{ use: m.id }, ...support, loop] }, registry, { logic });
      if (report.owner === l.id && report.problems.some(p => p.primitive === l.id && p.code === LOOP_CODES.unaffected)) failures.push(`${m.id} + ${l.id}: the player's movement does not reach its win`);
      // The control: the same document without the mover (its required primitives kept), when nothing else in it is player-driven.
      const rest = [...support, loop];
      if (rest.some(s => (cardLoop(registry.get(s.use).card)?.verbs || []).length && s.use === l.id) || rest.some(s => movesPlayer(registry.get(s.use).card))) continue;
      const without = loopReport({ systems: rest }, registry, { logic });
      if (!without.problems.some(p => p.primitive === l.id && p.code === LOOP_CODES.unaffected)) failures.push(`${l.id} without ${m.id}: its win is not reported unaffected`);
    }
  }
  assert.deepEqual(failures, []);
});
