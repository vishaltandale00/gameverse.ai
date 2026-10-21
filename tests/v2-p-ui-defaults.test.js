import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { testSpace } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { catalogue } from '../v2/primitives/index.js';
import { defaultGraphics, defaultHud, isTextual, withDefaultGraphics } from '../v2/primitives/graphics/ui-defaults.js';
import { optionLabel } from '../v2/primitives/graphics/ui-story.js';
import { mount } from './v2-p-ui-dom.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const game = f => JSON.parse(fs.readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8'));
const strip = d => ({ ...d, graphics: (d.graphics || []).filter(g => !/^graphics\.(ui|audio)\./.test(g.use)) });

test('defaults: picked from the systems each document uses', () => {
  const { registry } = catalogue([testSpace]);
  const pick = f => Object.fromEntries(defaultGraphics(strip(game(f)), registry).map(g => [g.use, g.with]));
  const bp = pick('blockport.json');
  // talk, accept_quest, travel, build... take a chosen value: graphics.ui.choices issues the ones no other UI names.
  assert.deepEqual(Object.keys(bp).sort(), ['graphics.audio.synth', 'graphics.ui.choices', 'graphics.ui.dialogue', 'graphics.ui.hud', 'graphics.ui.inventory', 'graphics.ui.journal', 'graphics.ui.map', 'graphics.ui.menu', 'graphics.ui.minimap'].sort());
  assert.ok(bp['graphics.ui.hud'].stars, 'wanted level -> stars');
  assert.ok(bp['graphics.ui.hud'].counters.some(c => c.var === 'money.bucks'), 'economy currency -> counter');
  assert.ok(bp['graphics.ui.hud'].meters.some(m => m.pool === 'stamina'), 'resource pool -> meter');
  assert.ok(bp['graphics.ui.inventory'].panels.includes('crafting') && bp['graphics.ui.inventory'].panels.includes('shop'));
  const hl = pick('hollow-lantern.json');
  assert.ok(hl['graphics.ui.hud'].counters.some(c => c.var === 'hp'), 'small hp max -> heart/mask icons');
  assert.ok(hl['graphics.ui.inventory'].panels.includes('loadout'), 'charm notches -> loadout');
  assert.equal(hl['graphics.ui.minimap'], undefined, 'side view: no minimap');
  const qm = pick('quiet-manor.json');
  assert.deepEqual(Object.keys(qm).sort(), ['graphics.audio.synth', 'graphics.render.dom', 'graphics.ui.menu', 'graphics.ui.story']);
  assert.equal(isTextual(game('quiet-manor.json')), true);
  assert.deepEqual(defaultGraphics(game('blockport.json'), registry), [{ use: 'graphics.ui.choices', with: {} }], 'a document that lists UI and audio keeps its own, and gets the control its choice verbs lack');
  assert.equal(defaultHud({ systems: [], content: {} }).meters.length, 0);
});

test('defaults: every default instance preflights against each game', () => {
  const { registry, logic } = catalogue([testSpace]);
  for (const f of fs.readdirSync(new URL('../v2/games/', import.meta.url))) {
    const d = strip(game(f));
    const g = defaultGraphics(d, registry);
    const reduced = { ...d, spaces: d.spaces.map(s => ({ id: s.id, use: s.use === 'engine.space.graph' ? s.use : 'engine.space.test', zones: s.zones })), systems: [], graphics: g };
    const errs = preflight(reduced, registry, logic).errors.filter(e => e.path?.startsWith('graphics') && /^(param_|ref_|ui_|audio_)/.test(e.code));
    assert.deepEqual(errs, [], f);
  }
});

test('defaults: the quiet manor plays in the browser host with only default UI', () => {
  const d = game('quiet-manor.json');
  const { registry } = catalogue();
  d.graphics = withDefaultGraphics(d, registry);
  const m = mount(d, { primitives: PRIMITIVES });
  assert.ok(m.q('.gv-title-name'), 'title screen');
  m.key('Enter'); m.frame(1);
  assert.equal(m.view.modal, null);
  assert.ok(m.q('.gv-story h2').textContent.length > 0, 'scene title shown');
  const first = m.q('.gv-story .gv-choices .gv-btn');
  assert.ok(first, 'choices offered');
  const zoneBefore = m.rt.player().at;
  m.key('1'); m.frame(2);
  assert.notEqual(m.rt.player().at, zoneBefore, 'choosing with a number key moved the player');
  // Each choice reads the text its primitive writes for people (the travel exits name their places), never the solver label.
  const shown = [...m.qa('.gv-story .gv-choices .gv-btn')].map(b => b.textContent.replace(/^\d+/, ''));
  const offered = m.rt.availableOptions();
  assert.deepEqual(shown, offered.map(o => optionLabel(d, o)));
  for (const o of offered) assert.ok(o.text && o.text !== o.label, `option '${o.label}' carries its own text`);
  assert.ok(offered.filter(o => o.actions?.go).every(o => /^Go to /.test(o.text)), 'travel options name their places');
  m.key('Escape'); m.frame(1);
  assert.equal(m.view.modal, 'menu', 'pause still opens over the story');
});
