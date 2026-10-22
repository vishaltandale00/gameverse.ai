// No document section exists without a declaring reader (v2/HANDOFF.md required work 2: the adventure remnants): every
// plot.* and content.* section a document carries is read by a primitive the document uses (card.reads), or by the
// kernel itself (archetypes), as preflight checks it (kernel/document.js `data_unused`). Over every discovered template,
// every composition of two templates the pick can name (nested, union), every example game in v2/games/*.json, and the
// step path's outputs (its procedural structure for every loop card, and what it publishes end to end with a scripted
// model). Cases come from the registries and the directory, never a hand list of ids. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { buildCatalogue, spaceVariants, isSpace } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { TEMPLATES } from '../v2/templates/registry.js';
import { composeTemplates, offeredTemplates } from '../v2/planner/templates.js';
import { proceduralOutline } from '../v2/planner/outline.js';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import { normalize } from '../v2/planner/decompose.js';
import { cardLoop } from '../v2/kernel/loop.js';
import { mazeWriter, selectionOf } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
/** The sections of a document no primitive it uses reads (preflight's data_unused), by path. */
const unread = doc => (preflight(structuredClone(doc), registry, logic).warnings || []).filter(w => w.code === 'data_unused').map(w => w.path);
/** Every plot.* and content.* section a document carries. */
const sectionsOf = doc => [...Object.keys(doc.plot || {}).filter(k => k !== 'premise').map(k => `plot.${k}`), ...Object.keys(doc.content || {}).map(k => `content.${k}`)];

test('every template and every two-template composition carries only sections a primitive it uses reads', () => {
  const templates = offeredTemplates(TEMPLATES, registry);
  assert.ok(templates.length > 0);
  for (const t of templates) assert.deepEqual(unread(t.doc), [], `template ${t.id}`);
  let composed = 0;
  for (const a of templates) for (const b of templates) for (const relation of ['nested', 'union']) {
    if (a.id === b.id) continue;
    const pick = { title: `${a.id} ${relation} ${b.id}`, premise: 'p', primary: { name: a.id, kind: 'game', template: a.id }, games: [{ name: b.id, kind: 'game', template: b.id, relation }], themes: [], readings: [], mechanics: [] };
    let r = null;
    try { r = composeTemplates(pick, { templates, registry, logic }); } catch { r = null; }
    if (!r?.doc) continue;
    composed++;
    assert.deepEqual(unread(r.doc), [], `${a.id} ${relation} ${b.id}`);
  }
  assert.ok(composed > 0, 'some pair composes');
});

test('every example game carries only sections a primitive it uses reads', () => {
  const dir = new URL('../v2/games/', import.meta.url);
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const g = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    assert.deepEqual(unread(g.doc || g), [], f);
  }
});

/** The step path's structure for one loop card alone, on the first space its loop declares (else the first space). */
function structureFor(loopId) {
  const card = registry.get(loopId).card, loop = cardLoop(card);
  const space = (loop?.space || []).find(s => typeof s === 'string' && registry.has(s)) || registry.ids('engine').find(id => isSpace(id) && spaceVariants(registry, id).length);
  const d = normalize({ title: loopId, premise: `${loopId}.`, mechanics: [{ id: 'core', verb: loop.verbs[0], description: 'the core loop', importance: 'core' }], views: [], spaces: [],
    core: { loop: 'core', interaction: loop.interactions[0] || null, opponent: 'none', win: 'win', lose: '', theme: '', narrative: true, mashup: [] } }, loopId, registry);
  const sel = selectionOf(registry, d, { space, map: { core: [loopId] }, systems: (card.requires?.primitives || []).filter(id => registry.has(id)) });
  return proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 3 }).doc;
}

test('the step path\'s structure adds no section and no story its collection does not read, for every loop card, the narrative flag set', () => {
  // Every card that declares a loop with player verbs, built alone on its declared space with the play spec's narrative
  // flag set: the flag adds no story runner and no story, so nothing appears that no chosen primitive reads.
  const loops = registry.cards().filter(c => (cardLoop(c)?.verbs.length ?? 0) > 0 && !c.adapts && /^(gameplay|plot)\./.test(c.id)).map(c => c.id);
  assert.ok(loops.length > 10, String(loops.length));
  for (const id of loops) {
    const doc = structureFor(id);
    assert.deepEqual(unread(doc), [], id);
    const chosen = new Set([id, ...(registry.get(id).card.requires?.primitives || [])]);
    assert.ok(!(doc.systems || []).some(s => !chosen.has(s.use) && (registry.get(s.use)?.card.reads || []).includes('plot.storyboard')), `${id}: a story runner nothing chose`);
    if (!(doc.systems || []).some(s => (registry.get(s.use)?.card.reads || []).includes('plot.storyboard'))) assert.equal(doc.plot?.storyboard, undefined, `${id}: a story without a story runner`);
  }
});

test('what the step path publishes end to end carries only sections its primitives read', async () => {
  const versions = [];
  const ctx = { stage() {}, draft() {}, checkpoint() {}, async publish(p) { versions.push(p); return p; }, store: { async updateMeta() {}, async version(_, v) { return versions[v - 1]; } } };
  await createKernelPipeline({ catalogue: async () => ({ registry, logic }), writers: { spec: mazeWriter() } })({ gameId: 'g', prompt: 'collect coins in a maze', kind: 'create', seed: 7 }, ctx);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].report.path, 'step');
  assert.deepEqual(unread(versions[0].doc), [], sectionsOf(versions[0].doc).join(', '));
});
