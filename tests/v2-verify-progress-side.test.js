// Progress toward the win is measured on the player's side (ARCHITECTURE.md §6.3: play moving the quantity the core
// loop's win reads toward it). A loop played against participants (racers, teams, sides: card mode/loop needs
// participants) whose win reads an event counts the player's side only: the read declares `of: 'player'` and the event
// is emitted typed (`name:*`, rt.emitTyped by subject), so the gate's measure (verify/objective.js winMeasure, through
// planner/loop.js winQuantity) counts `event:<subject>` of the player and the sides it joins, never a rival's lap or the
// other team's goal. Catalogue-wide over the cards; and on the race template, idling (the rivals lap) moves nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { cardLoop, readsOf, winQuantity } from '../v2/planner/loop.js';
import { winMeasure } from '../v2/verify/objective.js';
import { templateById } from '../v2/templates/registry.js';
import { controlledMaker, hostPreflight } from '../v2/verify/controls.js';

const { registry, logic } = buildCatalogue();

test('every loop played against participants whose win reads an event counts the player\'s side (of: player, typed event)', () => {
  const checked = [];
  for (const card of registry.cards()) {
    const loop = cardLoop(card), reads = readsOf(loop?.win), participants = card.mode?.needs?.participants ?? card.loop?.needs?.participants;
    if (!reads?.event || !participants) continue;
    checked.push(card.id);
    assert.equal(reads.of, 'player', `${card.id}: its win reads '${reads.event}', which every ${participants} member emits: declare of: 'player'`);
    assert.ok((card.provides?.events || []).includes(`${reads.event}:*`), `${card.id}: '${reads.event}' is emitted typed by subject (provides '${reads.event}:*')`);
  }
  assert.ok(checked.length >= 2, checked.join());
});

test('race: the rivals lapping an idle player is no progress toward the player\'s win', () => {
  const host = hostPreflight(templateById('race').doc, registry, logic).doc, wq = winQuantity(host, registry);
  assert.deepEqual(wq.subjects, ['player']);
  const wm = winMeasure(wq), rt = controlledMaker(host, registry, logic)(host.seed ?? 1), from = wm.start(rt);
  let rivalLaps = 0;
  for (let f = 0; f < 7200 && rt.state.status === 'playing'; f++) { rt.step({}); rivalLaps = Object.entries(rt.state.counts).filter(([k]) => k.startsWith('lap:') && k !== 'lap:player').reduce((n, [, v]) => n + v, 0); if (rivalLaps >= 2) break; }
  assert.ok(rivalLaps >= 1, 'the rivals lapped');
  assert.equal(wm.advance(rt, from), 0, 'the player did not');
});
