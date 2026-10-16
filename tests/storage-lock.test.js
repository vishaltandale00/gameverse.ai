import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireSessionLock } from '../src/storage.js';

test('awaiting release waits for the Web Locks handoff before an immediate retry', async t => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const held = new Set();
  let allowHandoff;
  const handoff = new Promise(resolve => { allowHandoff = resolve; });
  // Model the specified distinction: callback completion initiates release, but
  // request completion signals that the lock manager has actually released it.
  const locks = { async request(key, options, callback) {
    assert.equal(options.ifAvailable, true);
    if (held.has(key)) return callback(null);
    held.add(key);
    try { await callback({ name: key }); await handoff; }
    finally { held.delete(key); }
  } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  t.after(() => { allowHandoff(); if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator; });

  const release = await acquireSessionLock('profile:firered');
  let returned = false;
  const released = Promise.resolve(release()).then(() => { returned = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(returned, false, 'release must not report completion before the lock manager handoff');
  await assert.rejects(acquireSessionLock('profile:firered'), /already open/);
  allowHandoff(); await released;
  assert.equal(held.size, 0);

  const releaseRetry = await acquireSessionLock('profile:firered');
  await releaseRetry();
  assert.equal(held.size, 0, 'the retry can finish without leaving a held lock');
});
