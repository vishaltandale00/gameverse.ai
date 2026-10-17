import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMashupApi } from '../scripts/mashup-api.mjs';
const id = '11111111-1111-4111-8111-111111111111';
test('retained result opens V1 without rewriting checkpoint or history evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'v1-retained-')); t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, 'local-data/mashup-runs', id); await mkdir(folder, { recursive: true });
  const record = { request_id: id, status: 'completed', playable: true, artifact: { url: `/create?play=${id}`, sha256: 'a'.repeat(64) }, checkpoint: { sha256: 'b'.repeat(64) }, chunks: [{ evidence: 'retained' }] };
  const bytes = JSON.stringify(record); await writeFile(join(folder, 'run.json'), bytes);
  const api = createMashupApi({ root, agent: { status: async () => ({ authenticated: true }) }, pipeline: { capabilities: async () => ({}) } });
  const result = await api.status(id);
  assert.equal(result.artifact.url, `/v1?create=1&play=${id}`);
  assert.deepEqual(result.checkpoint, record.checkpoint); assert.deepEqual(result.chunks, record.chunks);
  assert.equal(await readFile(join(folder, 'run.json'), 'utf8'), bytes);
});
class Element extends EventTarget {
  constructor(tagName = 'DIV') { super(); this.tagName = tagName; this.children = []; this.value = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {} removeAttribute() {} focus() {}
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('embedded composer scopes source inputs and preserves failed intent during fresh retries', async t => {
  const ids = ['new-idea','cancel','resume','submit','intent-label','connect','history','starter','run-panel','run-state','run-title','run-message','qualification-summary','stages','play','download-rom','result-player-host','events','evidence','timing','recheck','capability-note','intent','login-link','connection-message','composer','form-status','refresh-run','presets','source-options','dictate','voice-status'];
  const nodes = new Map(ids.map(key => [key, new Element()]));
  const root = { querySelector: selector => nodes.get(selector.match(/id="([^"]+)"/)[1]), querySelectorAll: () => [{ value: 'metroid-zero-mission', checked: true }] };
  const fakeDocument = { getElementById: () => null, createElement: tag => new Element(tag.toUpperCase()), createTextNode: text => ({ textContent: text }), querySelectorAll: () => { throw Error('Global source lookup'); } };
  const fakeWindow = new EventTarget(), submissions = [];
  const fetcher = async (path, options) => {
    if (path === '/api/chatgpt/status') return Response.json({ authenticated: true });
    if (path === '/api/mashup/capabilities') return Response.json({ available: true, presets: [], source_games: [] });
    if (options?.method === 'POST') { const body = JSON.parse(options.body); submissions.push(body); return Response.json({ ...body, status: 'blocked', playable: false }); }
    return Response.json({ request_id: id, intent: 'Original connected route', library_refs: ['system:retained-movement'], status: 'blocked', playable: false });
  };
  const globals = { window: fakeWindow, document: fakeDocument, location: { search: '', href: 'http://127.0.0.1/v1?create=1' }, localStorage: { getItem: () => JSON.stringify([{ request_id: id, intent: 'Original connected route', message: 'Original connected route' }]), setItem() {} }, fetch: fetcher };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  const { initializeConversation } = await import('../src/conversation.js'); await initializeConversation(root, { embedded: true });
  t.after(() => fakeWindow.dispatchEvent(new Event('pagehide')));
  assert.equal(nodes.get('submit').disabled, false); nodes.get('intent').value = 'Make jumps forgiving';
  nodes.get('composer').dispatchEvent(new Event('submit', { cancelable: true })); await settle();
  assert.equal(submissions.length, 1); assert.equal(submissions[0].retry_of, id); assert.equal(submissions[0].parent_request_id, undefined);
  assert.equal(submissions[0].intent, 'Original connected route\n\nRefinement: Make jumps forgiving');
  assert.deepEqual(submissions[0].source_games, ['metroid-zero-mission']); assert.equal(nodes.get('history').children.length, 2);
  assert.deepEqual(submissions[0].library_refs, ['system:retained-movement']);
  // A result deep link must retain its parent even in a fresh browser history.
  localStorage.getItem = () => '[]'; location.search = `?create=1&play=${id}`;
  const linkedNodes = new Map(ids.map(key => [key, new Element()]));
  const linkedRoot = { querySelector: selector => linkedNodes.get(selector.match(/id="([^"]+)"/)[1]), querySelectorAll: () => [] };
  await initializeConversation(linkedRoot, { embedded: true });
  assert.equal(linkedNodes.get('submit').textContent, 'Build this refinement ↗');
  linkedNodes.get('intent').value = 'Add a shortcut';
  linkedNodes.get('composer').dispatchEvent(new Event('submit', { cancelable: true })); await settle();
  assert.equal(submissions[1].retry_of, id); assert.equal(submissions[1].parent_request_id, undefined);
  assert.equal(submissions[1].intent, 'Original connected route\n\nRefinement: Add a shortcut');
  linkedNodes.get('resume').dispatchEvent(new Event('click')); await settle();
  assert.equal(submissions[2].intent, submissions[1].intent); assert.equal(submissions[2].retry_of, submissions[1].request_id); assert.equal(submissions[2].parent_request_id, undefined);
});
