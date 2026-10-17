import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchResultRom, mountResultPlayer } from '../src/result-player.js';
import { digest } from '../src/identity.js';

const id = '11111111-1111-4111-8111-111111111111';
function cartridge() {
  const rom = new Uint8Array(192);
  rom.set(new TextEncoder().encode('TEST'), 0xac); rom[0xb2] = 0x96;
  let sum = 0; for (let i = 0xa0; i <= 0xbc; i++) sum -= rom[i]; rom[0xbd] = (sum - 0x19) & 255;
  return rom;
}
async function fixture() {
  const rom = cartridge();
  const record = { request_id: id, status: 'completed', playable: true, qualification: { outcome: 'pass', scope: 'native-boot', bot: { outcome: 'partial' } }, artifact: { title: 'A real candidate', sha256: await digest(rom), rom_url: 'https://untrusted.invalid/game.gba' } };
  const paths = [];
  const fetcher = async (path, options) => {
    paths.push({ path, options });
    return path.endsWith('/artifacts/rom') ? new Response(rom) : Response.json(record);
  };
  return { rom, record, paths, fetcher };
}

test('result ROM uses only pinned run endpoint, verifies digest and accepts native pass with partial bot evidence', async () => {
  const f = await fixture(); const result = await fetchResultRom(id, { fetcher: f.fetcher });
  assert.deepEqual(result.rom, f.rom);
  assert.equal(result.title, 'A real candidate');
  assert.deepEqual(f.paths.map(x => x.path), [`/api/mashup/runs/${id}`, `/api/mashup/runs/${id}/artifacts/rom`]);
  assert.ok(f.paths.every(x => x.options.redirect === 'error' && x.options.cache === 'no-store'));
});

test('invalid, unready, mismatched and altered artifacts fail before emulator construction', async () => {
  const f = await fixture();
  await assert.rejects(fetchResultRom('../outside', { fetcher: f.fetcher }), /Invalid creation/);
  assert.equal(f.paths.length, 0);
  f.record.playable = false;
  await assert.rejects(fetchResultRom(id, { fetcher: f.fetcher }), /not ready/);
  assert.equal(f.paths.length, 1);
  f.record.playable = true; f.record.request_id = 'another';
  await assert.rejects(fetchResultRom(id, { fetcher: f.fetcher }), /not ready/);
  f.record.request_id = id; f.record.artifact.sha256 = '0'.repeat(64);
  await assert.rejects(fetchResultRom(id, { fetcher: f.fetcher }), /does not match/);
});

class Element extends EventTarget {
  constructor(tagName = 'DIV') { super(); this.tagName = tagName; this.children = []; this.nodes = new Map(); }
  querySelector(selector) { return this.nodes.get(selector); }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  focus() {}
  contains(node) { return node === this || this.children.includes(node); }
  setPointerCapture() {}
  transferControlToOffscreen() { return {}; }
}
function hostFixture() {
  const host = new Element(); const section = new Element('SECTION');
  host.nodes.set('.result-player', section);
  for (const selector of ['.result-player-status', '.result-player-title', '.result-player-screen', '[data-action="play"]', '[data-action="reset"]', '.result-player-touch']) section.nodes.set(selector, new Element(selector.includes('action') ? 'BUTTON' : 'DIV'));
  return { host, section, play: section.querySelector('[data-action="play"]'), reset: section.querySelector('[data-action="reset"]'), status: section.querySelector('.result-player-status') };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('player plumbing stays paused until Play, clears inputs, resets worker, disposes listeners', async t => {
  const f = await fixture(), ui = hostFixture(), workers = [];
  const fakeWindow = new EventTarget(), fakeDocument = new EventTarget();
  fakeDocument.createElement = tag => new Element(tag.toUpperCase());
  class FakeWorker {
    constructor() { this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); if (message.id) queueMicrotask(() => this.onmessage?.({ data: { id: message.id, result: {} } })); }
    terminate() { this.terminated = true; }
  }
  class FakeAudio {
    constructor() { this.destination = {}; }
    createGain() { return { gain: {}, connect() {} }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  for (const [key, value] of Object.entries({ window: fakeWindow, document: fakeDocument, Worker: FakeWorker, AudioContext: FakeAudio, fetch: f.fetcher })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  const player = mountResultPlayer(ui.host); await player.load(id);
  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].messages.filter(x => x.id).map(x => x.op), ['load']);
  assert.match(ui.status.textContent, /Ready/);
  ui.play.dispatchEvent(new Event('click')); fakeWindow.dispatchEvent(new Event('blur')); await settle();
  assert.equal(workers[0].messages.at(-1).op, 'pause', 'focus loss during resume must leave the player paused');
  ui.play.dispatchEvent(new Event('click')); await settle();
  assert.equal(workers[0].messages.at(-1).op, 'resume');
  const key = new Event('keydown', { cancelable: true }); key.code = 'KeyX'; ui.section.dispatchEvent(key);
  assert.equal(workers[0].messages.at(-1).mask, 1);
  fakeWindow.dispatchEvent(new Event('blur')); await settle();
  assert.equal(workers[0].messages.at(-1).op, 'pause');
  assert.equal(workers[0].messages.at(-2).mask, 0);
  ui.reset.dispatchEvent(new Event('click')); await settle();
  assert.equal(workers.length, 2); assert.equal(workers[0].terminated, true);
  assert.deepEqual(workers[1].messages.filter(x => x.id).map(x => x.op), ['load']);
  player.destroy(); assert.equal(workers[1].terminated, true);
  assert.equal(ui.host.children.length, 0);
  const count = workers[1].messages.length; fakeWindow.dispatchEvent(new Event('blur')); await settle();
  assert.equal(workers[1].messages.length, count);
});
