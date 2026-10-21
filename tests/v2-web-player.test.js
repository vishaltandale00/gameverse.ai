// The browser host (v2/web/player.js mountGame) in a fake browser (tests/v2-web-host.js over the DOM stub):
// - its own behaviour: held (UI pause) and away (blur, hidden page) hold the world; view.act forces a step, and
//   steps one per action while held; restart and load; update() hot-loads (extend, or rebuild-and-restore) and
//   leaves the running game untouched when the new version cannot take over; failed mounts release what they
//   installed; keys bound to the game's verbs have their default prevented only while focus is in the game;
// - the lifecycle as a catalogue-wide property (ARCHITECTURE §1.7): every template's host document, every UI lab
//   document and every example game mounts, starts, plays, hot-loads, still takes input after the hot-load, and on
//   dispose leaves nothing behind: listeners on window, document and the container balance, and no animation
//   frame, timer, interval, AudioContext, Worker or node remains.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { installBrowser } from './v2-web-host.js';
import { TEMPLATES, templateById } from '../v2/templates/registry.js';
import * as labDocs from '../v2/primitives/graphics/ui-lab-docs.js';
import { docBindings, openKeys, MODAL_KEYS } from '../v2/primitives/graphics/ui-input.js';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { hostPreflight } from '../v2/verify/controls.js';

const B = installBrowser();
test.after(() => B.restore());
const { mountGame, loadPromoted } = await import('../v2/web/player.js');
await loadPromoted();

const maze = templateById('maze-chase');
const flush = () => new Promise(r => setImmediate(r));
const mount = (doc, opts = {}) => mountGame(B.container, { doc, version: 1 }, { now: B.now, ...opts });
const frames = (n, ms) => { for (let i = 0; i < n; i++) B.frame(ms); };
const uses = (doc, id) => (doc.graphics || []).some(g => g.use === id);
/** Start play: press confirm on the title screen (when the game has one), then let intros that hold play pass. */
async function start(game) {
  await flush();
  if (game.rt.view.paused) { B.key('Enter'); B.keyup('Enter'); }
  // Intros may hold play once it starts (a VS screen on match_start): run until play has gone on for 10 frames.
  for (let i = 0, free = 0; i < 400 && free < 10; i++) { B.frame(game.rt.view.paused ? 50 : 1000 / 60); free = game.rt.view.paused ? 0 : free + 1; }
}

test('host: the title holds the world; play steps at 60 Hz; blur and a hidden page hold it until they return', async () => {
  const g = mount(maze.doc);
  await flush();
  assert.equal(g.rt.view.paused, true, 'the title screen holds the world');
  frames(10); assert.equal(g.rt.state.frame, 0, 'no steps under the title');
  await start(g);
  const f0 = g.rt.state.frame;
  frames(60); assert.ok(Math.abs(g.rt.state.frame - f0 - 60) <= 1, `60 display frames of 1/60 s are ~60 steps (got ${g.rt.state.frame - f0})`);
  B.win.dispatchEvent({ type: 'blur' });
  assert.equal(g.rt.view.paused, true, 'a blurred window holds the world');
  const f1 = g.rt.state.frame; frames(30); assert.equal(g.rt.state.frame, f1, 'no steps while away');
  B.win.dispatchEvent({ type: 'focus' });
  frames(1); frames(30); assert.ok(g.rt.state.frame > f1, 'play resumes on focus');
  B.hide(true); const f2 = g.rt.state.frame; frames(30); assert.equal(g.rt.state.frame, f2, 'a hidden page holds the world');
  B.hide(false); frames(30);
  // graphics.ui.menu autoPause: coming back to a page hidden in play finds the pause screen, not a running game.
  assert.equal(g.rt.view.paused, true); assert.ok(B.container.querySelector('[aria-label="Paused"]'));
  B.key('Escape'); B.keyup('Escape'); frames(30); assert.ok(g.rt.state.frame > f2, 'and resumes from the pause screen');
  g.dispose();
  assert.deepEqual(B.held(), []);
});

test('host: a game mounted in a hidden page starts held', async () => {
  B.hide(true);
  const g = mount(templateById('farm').doc);
  await flush();
  B.key('Enter'); B.keyup('Enter'); frames(30);
  assert.equal(g.rt.state.frame, 0, 'nothing runs in a hidden tab');
  B.hide(false); frames(30); assert.ok(g.rt.state.frame > 0);
  g.dispose(); assert.deepEqual(B.held(), []);
});

test('host: view.act forces a step while running and steps once per action while held', async () => {
  const g = mount(maze.doc);
  await start(g);
  const view = g.rt.view, f0 = g.rt.state.frame;
  view.act({ run: true });
  await flush();
  assert.equal(g.rt.state.frame, f0 + 1, 'an action from the UI applies at once, without waiting for the display loop');
  assert.ok(g.rt.state.events.some(e => e.name === 'action' && e.action === 'run'));
  view.pause(true);
  const f1 = g.rt.state.frame;
  frames(20); assert.equal(g.rt.state.frame, f1, 'held: the display loop does not step');
  view.act({ run: true }); view.act({ run: true });
  await flush();
  assert.equal(g.rt.state.frame, f1 + 2, 'held: one step per action');
  view.pause(false);
  g.dispose(); assert.deepEqual(B.held(), []);
});

test('host: restart goes back to the first state; load restores a snapshot; setTimeScale(0) holds the steps', async () => {
  const g = mount(maze.doc);
  await start(g);
  frames(40);
  const snap = g.rt.snapshot(), at = g.rt.state.frame;
  frames(20); assert.ok(g.rt.state.frame > at);
  g.rt.view.load(snap); assert.equal(g.rt.state.frame, at, 'load restores the saved state');
  g.rt.view.restart(); assert.equal(g.rt.state.frame, 0, 'restart is the first state');
  g.rt.view.setTimeScale(0); const f = g.rt.state.frame; frames(20); assert.equal(g.rt.state.frame, f, 'time scale 0 holds');
  g.rt.view.setTimeScale(1); frames(20); assert.ok(g.rt.state.frame > f);
  g.dispose(); assert.deepEqual(B.held(), []);
});

test('host: update() rebuilds the world, carries the running state over (no title), and replaces the old world only once built', async () => {
  const g = mount(maze.doc);
  await start(g);
  frames(45);
  const old = g.rt, at = g.rt.state.frame, listeners = B.listeners();
  const next = structuredClone(maze.doc);
  assert.equal(g.update({ doc: next, version: 1 }), false, 'a version that is not newer is refused');
  assert.equal(g.update({ doc: next, version: 2 }), true);
  assert.notEqual(g.rt, old, 'a new world');
  assert.equal(g.rt.state.frame, at, 'the running state carried over (rt.restore)');
  assert.equal(g.rt.view.continuing, true);
  assert.equal(g.rt.view.paused, false, 'a hot-loaded version continues play: no title screen');
  assert.deepEqual(B.listeners(), listeners, 'the old world released its listeners: the counts are those of one world');
  assert.equal(B.container.querySelectorAll('.gv-overlay').length, 1, 'one overlay');
  old.view.act({ run: true }); await flush();
  assert.ok(!g.rt.state.events.some(e => e.action === 'run'), 'the old view no longer reaches the game');
  frames(10); assert.ok(g.rt.state.frame > at, 'the new world plays');
  assert.equal(g.version, 2);
  g.dispose(); assert.deepEqual(B.held(), []);
});

test('host: an update that fails checks, fails to build or cannot take the running state leaves the game untouched', async () => {
  const g = mount(maze.doc);
  await start(g);
  frames(20);
  const rt = g.rt, listeners = B.listeners(), nodes = [...B.container.childNodes];
  const bad = structuredClone(maze.doc); bad.systems.push({ use: 'gameplay.no-such-primitive', with: {} });
  assert.equal(g.update({ doc: bad, version: 2 }), false, 'fails checks');
  assert.equal(g.rt, rt, 'the running world is kept');
  assert.deepEqual(B.listeners(), listeners);
  assert.deepEqual([...B.container.childNodes], nodes, 'and its nodes');
  g.dispose();
  const boom = { id: 'gameplay.test.boom', card: { intent: 'Throws on install, after taking a window listener.', views: ['any'], params: {} },
    install(rt) { const fn = () => {}; window.addEventListener('keydown', fn); rt.view.onDispose(() => window.removeEventListener('keydown', fn)); throw Error('boom'); } };
  const g2 = mountGame(B.container, { doc: maze.doc, version: 1 }, { now: B.now, primitives: [boom] });
  await start(g2);
  const withBoom = structuredClone(maze.doc); withBoom.systems.push({ use: 'gameplay.test.boom', with: {} });
  const l2 = B.listeners();
  assert.equal(g2.update({ doc: withBoom, version: 2 }), false, 'fails to build');
  assert.deepEqual(B.listeners(), l2, 'what the failed build installed is released');
  assert.equal(g2.rt.state.status, 'playing'); g2.dispose();
  assert.deepEqual(B.held(), []);
  const picky = { id: 'gameplay.test.picky', card: { intent: 'Refuses a state it did not make (its restore hook throws).', views: ['any'], params: {} }, install(rt) { rt.onRestore(() => { throw Error('not my state'); }); } };
  const g3 = mountGame(B.container, { doc: maze.doc, version: 1 }, { now: B.now, primitives: [picky] });
  await start(g3); frames(20);
  const rt3 = g3.rt, l3 = B.listeners(), nodes3 = [...B.container.childNodes];
  const withPicky = structuredClone(maze.doc); withPicky.systems.push({ use: 'gameplay.test.picky', with: {} });
  assert.equal(g3.update({ doc: withPicky, version: 3 }), false, 'a world that cannot take the running state');
  assert.equal(g3.rt, rt3, 'the running world is kept');
  assert.deepEqual(B.listeners(), l3);
  assert.deepEqual([...B.container.childNodes], nodes3, 'and its nodes');
  frames(10); assert.equal(g3.rt.view.paused, false);
  g3.dispose(); assert.deepEqual(B.held(), []);
});

test('host: a mount that fails (checks, install or the first step) releases everything it installed', () => {
  assert.throws(() => mount({ ...maze.doc, systems: [...maze.doc.systems, { use: 'gameplay.no-such-primitive', with: {} }] }), /failed checks/);
  assert.deepEqual(B.held(), []);
  const late = { id: 'graphics.test.boom', card: { intent: 'Throws on install after the UI took its listeners.', views: ['any'], params: {} },
    install() { throw Error('boom'); } };
  const doc = structuredClone(maze.doc); doc.graphics = [...(doc.graphics || []), { use: 'graphics.ui.menu', with: {} }, { use: 'graphics.test.boom', with: {} }];
  assert.throws(() => mountGame(B.container, { doc, version: 1 }, { now: B.now, primitives: [late] }), /boom/);
  assert.deepEqual(B.held(), [], 'the UI installed before the failure is released');
  const step = { id: 'gameplay.test.step-boom', card: { intent: 'Throws on its first step.', views: ['any'], params: {} }, install(rt) { rt.system('rules', () => { throw Error('step boom'); }, 'gameplay.test.step-boom'); } };
  const doc2 = structuredClone(templateById('race').doc); doc2.graphics = [{ use: 'graphics.ui.menu', with: { title: false } }]; doc2.systems.push({ use: 'gameplay.test.step-boom', with: {} });
  assert.throws(() => mountGame(B.container, { doc: doc2, version: 1 }, { now: B.now, primitives: [step] }), /step boom/);
  assert.deepEqual(B.held(), [], 'a first step that throws releases the mounted game');
});

test('host: keys bound to the game are prevented while focus is in the game, never while typing; mounting does not steal a text field', async () => {
  const field = B.doc.createElement('input'); B.doc.body.append(field); field.focus();
  const g = mount(maze.doc);
  await flush();
  assert.equal(B.doc.activeElement, field, 'a person typing keeps the focus');
  B.doc.activeElement = null;
  const g2 = (g.dispose(), mount(maze.doc));
  await flush();
  assert.equal(B.doc.activeElement, B.container, 'otherwise the game takes focus on mount');
  await start(g2);
  const bound = B.key('ArrowLeft'); B.keyup('ArrowLeft');
  assert.equal(bound.defaultPrevented, true, 'a bound key does not scroll the page');
  const free = B.key('k'); B.keyup('k');
  assert.equal(free.defaultPrevented, false, 'an unbound key keeps its default');
  field.focus();
  const typed = B.key('ArrowLeft'); B.keyup('ArrowLeft');
  assert.equal(typed.defaultPrevented, false, 'typing in a field is never taken');
  B.container.dispatchEvent({ type: 'pointerdown' });
  assert.equal(B.doc.activeElement, B.container, 'pointer down focuses the game');
  g2.dispose(); field.remove(); assert.deepEqual(B.held(), []);
});

// ---------------------------------------------------------------- catalogue-wide lifecycle

const examples = readdirSync(new URL('../v2/games/', import.meta.url)).filter(f => f.endsWith('.json')).map(f => [`game ${f}`, JSON.parse(readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8'))]);
const cases = [
  ...TEMPLATES.map(t => [`template ${t.id}`, t.doc]),
  ...Object.entries(labDocs).filter(([, f]) => typeof f === 'function').map(([name, f]) => [`ui lab ${name}`, f()]),
  ...examples,
];

/** A key the host document binds to a gameplay verb (primary view), and the verb. */
function gameplayKey(rt) {
  const b = docBindings(rt.doc), ui = new Set(Object.values(openKeys(rt.doc)).flat());
  for (const [verb, keys] of Object.entries(b)) for (const k of keys) if (/^[a-z]$|^(up|down|left|right|space|enter|shift)$/.test(k) && !ui.has(k)) return { verb, key: k };
  return null;
}
/** Press a key the document binds to a gameplay verb: does the verb reach the game? -> { verb, reached } or null. */
function probeInput(g) {
  const gk = gameplayKey(g.rt);
  if (!gk || g.rt.state.status !== 'playing') return null;
  B.focusGame();
  B.key(KEY[gk.key] ?? gk.key);
  let reached = false;
  for (let i = 0; i < 3 && !reached; i++) { B.frame(); reached = reachedVerb(g.rt.input, gk.verb); }
  B.keyup(KEY[gk.key] ?? gk.key); B.frame();
  return { verb: gk.verb, reached };
}
/** Press the pause menu's key and then Esc: -> { paused, screen, resumed } or null (no pause menu). */
function probeMenu(g) {
  if (!(g.rt.doc.graphics || []).some(x => x.use === 'graphics.ui.menu' && x.with?.pause !== false) || g.rt.state.status !== 'playing') return null;
  // A menu key that is no UI navigation key (Esc is also 'back': a screen with something to go back from takes it first).
  const nav = new Set(Object.values(MODAL_KEYS).flat()), keys = openKeys(g.rt.doc).menu, k = keys.find(x => !nav.has(x)) ?? keys[0], name = k === 'esc' ? 'Escape' : k;
  B.key(name); B.keyup(name); B.frame();
  const paused = g.rt.view.paused, screen = Boolean(B.container.querySelector('[aria-label="Paused"]'));
  B.key('Escape'); B.keyup('Escape'); B.frame();
  const resumed = !g.rt.view.paused;
  // Esc goes back on screens that have somewhere to go back to, and pauses from the rest: a few presses reach the pause.
  let esc = null;
  if (keys.includes('esc')) { esc = false; for (let i = 0; i < 4 && !esc; i++) { B.key('Escape'); B.keyup('Escape'); B.frame(); esc = g.rt.view.paused; } if (esc) { B.key('Escape'); B.keyup('Escape'); B.frame(); } }
  return { paused, screen, resumed, esc };
}
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', space: ' ', enter: 'Enter', shift: 'Shift' };
const reachedVerb = (input, verb) => Boolean(input?.actions?.[verb] || input?.held?.[verb] || (Array.isArray(input?.axes?.[verb]) && input.axes[verb].some(Boolean)));

const { registry: liveRegistry, logic: liveLogic } = await liveCatalogue();

for (const [name, doc] of cases) {
  test(`lifecycle ${name}: mount, start, play, hot-load, input after the hot-load, dispose leaves nothing behind`, async () => {
    if (!hostPreflight(doc, liveRegistry, liveLogic).ok) {
      // A document that fails checks does not mount: it says why, and leaves nothing behind.
      assert.throws(() => mount(doc), e => /failed checks/.test(e.message) && e.errors?.length > 0);
      assert.deepEqual(B.held(), []);
      return;
    }
    const g = mount(doc);
    try {
      await start(g);
      frames(30);
      const before = { input: probeInput(g), menu: probeMenu(g) };
      const listeners = B.listeners(), at = g.rt.state.frame;
      assert.ok(listeners.window + listeners.document + listeners.container > 0, 'the host and the game listen for input');
      assert.equal(g.update({ doc: structuredClone(doc), version: 2 }), true, 'the hot-load rebuilds');
      assert.equal(g.rt.state.frame, at, 'state carried over');
      assert.deepEqual(B.listeners(), listeners, 'after the hot-load, one world listens');
      frames(5);
      // Input works after the hot-load exactly as before it: the same key reaches the game, the menu key pauses.
      assert.deepEqual(probeInput(g), before.input, 'a gameplay key does after the hot-load what it did before');
      assert.deepEqual(probeMenu(g), before.menu, 'the menu key does after the hot-load what it did before');
      if (before.menu) assert.deepEqual({ ...before.menu, esc: before.menu.esc ?? true }, { paused: true, screen: true, resumed: true, esc: true }, 'the menu key pauses, shows the pause screen, and resumes; Esc reaches the pause');
    } finally { g.dispose(); }
    assert.deepEqual(B.held(), [], 'nothing remains after dispose');
  });
}
