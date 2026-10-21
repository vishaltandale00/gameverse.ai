// Templates fit their loops and their presentation (ARCHITECTURE.md §3, §5): a template is a verified document, so the
// space it puts each loop on is one that loop's card declares (card.mode.space / card.loop.space, read by the one
// interpretation the composition check uses: planner/loop.js spaceFitsEntry), and the view it declares
// (views.primary) is one the renderer the host mounts for its play space (ui-defaults.js rendererFor) shows. A race
// on the shooter arena, drawn by the arena renderer, is the defect class this catches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../v2/templates/index.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { compositionSpaces } from '../v2/planner/compose-check.js';
import { cardLoop, loopSpaceFits } from '../v2/planner/loop.js';
import { modesIn } from '../v2/primitives/gameplay/modes-lib-mode.js';
import { rendererFor } from '../v2/primitives/graphics/ui-defaults.js';

const { registry } = buildCatalogue();

/** The space id an instance at a modesIn path is bound to: a generator's own space, a system's `space` or the first. */
function boundSpace(doc, path) {
  const gen = /^spaces\[(\d+)\]\.generators\[\d+\]$/.exec(path);
  if (gen) return doc.spaces[Number(gen[1])].id;
  const sys = /^systems\[(\d+)\]$/.exec(path);
  return (sys && doc.systems[Number(sys[1])].space) ?? doc.spaces[0]?.id;
}

for (const t of TEMPLATES) {
  test(`template ${t.id}: every loop runs on a space its card declares`, () => {
    const spaces = new Map(compositionSpaces(t.doc, registry).map(s => [s.id, s]));
    const loops = modesIn(t.doc, registry).map(m => ({ ...m, loop: cardLoop(registry.get(m.use).card) })).filter(m => m.loop?.space.length);
    assert.ok(loops.length, `${t.id}: a loop in the document declares its spaces`);
    for (const m of loops) {
      const s = spaces.get(boundSpace(t.doc, m.path));
      assert.ok(s, `${t.id}: ${m.use} is bound to a space of the document`);
      assert.ok(loopSpaceFits(m.loop, s.use, new Set(s.caps)), `${t.id}: ${m.use} plays on ${JSON.stringify(m.loop.space)}; the template puts it on ${s.use} (${s.caps.join(', ')})`);
    }
  });

  test(`template ${t.id}: views.primary is a view its play space's renderer shows`, () => {
    const sid = t.doc.player?.space ?? t.doc.spaces[0]?.id, space = t.doc.spaces.find(s => s.id === sid);
    const renderer = rendererFor(space, registry);
    assert.ok(renderer, `${t.id}: the catalogue has a renderer for ${space.use}`);
    const views = registry.get(renderer).card.views || [];
    assert.ok(typeof t.doc.views?.primary === 'string', `${t.id}: the template declares views.primary (${renderer} shows ${views.join(', ')})`);
    assert.ok(views.includes(t.doc.views.primary), `${t.id}: views.primary '${t.doc.views.primary}' is not a view ${renderer} shows (${views.join(', ')})`);
  });
}
