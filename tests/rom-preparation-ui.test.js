import test from 'node:test';
import assert from 'node:assert/strict';
import { mountRomPreparation } from '../src/rom-preparation.js';
class Element extends EventTarget {
  constructor(tagName) { super(); this.tagName = tagName; this.children = []; this.value = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('local upload sends only binary bytes, prepares deterministically and refreshes availability without a creation run', async t => {
  const originalDocument = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = originalDocument; });
  const host = new Element('div'), calls = []; let refreshed = 0;
  const original = { id: 'sonic-advance', title: 'Sonic Advance', game_code: 'ASOE', revision: 0, sha1: 'a'.repeat(40), status: 'missing' };
  const api = async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/mashup/roms' && !options) return { originals: [original], limits: { max_upload_bytes: 1024 } };
    if (path === '/api/mashup/roms') return { sha256: 'b'.repeat(64), game_id: original.id, status: 'available' };
    if (path.endsWith('/prepare')) return { job_id: 'job1', status: 'queued' };
    if (path === '/api/mashup/rom-jobs/job1') return { job_id: 'job1', game_id: original.id, status: 'completed', recipe: { id: 'fixture-export', version: 1 }, classification: 'asset-pack-extracted', artifacts: [{ id: 'player-frames', kind: 'asset-pack', sha256: 'c'.repeat(64) }], remaining_inputs: ['LeafGreen source assets'] };
    throw Error(`Unexpected API call: ${path}`);
  };
  const dispose = mountRomPreparation({ querySelector: () => host }, api, () => { refreshed++; }); t.after(dispose); await settle();
  const panel = host.children[0], input = panel.children[2].children[0].children[0], button = panel.children[2].children[1];
  const file = new Blob(['raw cartridge bytes']); Object.defineProperty(file, 'name', { value: 'private-filename.gba' });
  input.files = [file]; input.dispatchEvent(new Event('change')); assert.equal(button.disabled, false);
  button.dispatchEvent(new Event('click')); await settle(); await settle();
  const upload = calls.find(call => call.options?.headers);
  assert.equal(upload.options.body, file); assert.deepEqual(upload.options.headers, { 'Content-Type': 'application/octet-stream' });
  assert.ok(calls.some(call => call.path.endsWith('/prepare'))); assert.ok(!calls.some(call => /runs|login|chatgpt/.test(call.path)));
  assert.equal(refreshed, 1);
  const output = panel.children[4]; assert.match(output.children[0].textContent, /Sonic Advance · ASOE · revision 0/);
  assert.match(output.children[4].children[0].textContent, /player-frames · asset pack/);
  assert.match(output.children[5].textContent, /LeafGreen source assets/);
  assert.ok(output.children.at(-1).children.some(child => /fixture-export · version 1/.test(child.textContent)));
});

test('invalid uploads stop before transfer and do not prepare', async t => {
  const originalDocument = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = originalDocument; });
  const host = new Element('div'), calls = [];
  const dispose = mountRomPreparation({ querySelector: () => host }, async path => { calls.push(path); return { originals: [], limits: { max_upload_bytes: 16 } }; }); t.after(dispose); await settle();
  const panel = host.children[0], input = panel.children[2].children[0].children[0], button = panel.children[2].children[1];
  input.files = [{ name: 'archive.zip', size: 8 }]; input.dispatchEvent(new Event('change')); assert.equal(button.disabled, true);
  input.files = [{ name: 'game.gba', size: 17 }]; input.dispatchEvent(new Event('change')); assert.equal(button.disabled, true);
  assert.match(panel.children[3].textContent, /nonempty .gba/); assert.deepEqual(calls, ['/api/mashup/roms']);
});

test('restored running preparation can be inspected and stopped without reupload or a new prepare job', async t => {
  const originalDocument = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = originalDocument; });
  const host = new Element('div'), calls = [];
  const dispose = mountRomPreparation({ querySelector: () => host }, async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/mashup/roms') return { originals: [{ id: 'sonic-advance', title: 'Sonic Advance', sha256: 'b'.repeat(64), status: 'available', preparation: { job_id: 'retained', status: 'running' } }] };
    return { job_id: 'retained', game_id: 'sonic-advance', status: 'running', cancel_requested: options?.method === 'DELETE' };
  }); t.after(dispose); await settle();
  const panel = host.children[0], view = panel.children[5].children[1].children[0].children[1];
  assert.equal(view.textContent, 'View preparation'); view.dispatchEvent(new Event('click')); await settle();
  const cancel = panel.children[2].children[2]; assert.equal(cancel.hidden, false);
  cancel.dispatchEvent(new Event('click')); await settle();
  assert.ok(calls.some(call => call.path === '/api/mashup/rom-jobs/retained' && call.options?.method === 'DELETE'));
  assert.ok(!calls.some(call => call.path.endsWith('/prepare') || call.options?.method === 'POST'));
});
