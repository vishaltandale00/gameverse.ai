import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { testingServiceConfiguration } from '../scripts/local-testing-config.mjs';
test('direct credentials report presence without returning values', async () => {
  const result = await testingServiceConfiguration({ SID_LLM_KEY: 'test-credential-placeholder' });
  assert.equal(result.configured, true); assert.equal(JSON.stringify(result).includes('test-credential-placeholder'), false);
  assert.equal((await testingServiceConfiguration({})).configured, false);
});
test('explicit file route validates both required settings and never evaluates shell expressions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gameverse-testing-config-')), path = join(root,'.env');
  try {
    await writeFile(path, 'export SID_LLM_URL="http://testing.invalid:4000"\nSID_LLM_KEY=\'test-key-placeholder\'\nUNRELATED_SECRET=ignore\n');
    const result = await testingServiceConfiguration({ GAMEVERSE_SID_ENV_FILE: path });
    assert.equal(result.configured, true); assert.equal(JSON.stringify(result).includes('test-key-placeholder'), false);
    assert.equal((await testingServiceConfiguration({ GAMEVERSE_SID_ENV_FILE: path, SID_LLM_KEY: '' })).configured, false);
    await writeFile(path, 'SID_LLM_KEY=test-key-placeholder\n');
    assert.equal((await testingServiceConfiguration({ GAMEVERSE_SID_ENV_FILE: path })).configured, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('missing selected file remains unconfigured even when its variable is present', async () => {
  assert.equal((await testingServiceConfiguration({ GAMEVERSE_SID_ENV_FILE: '/nonexistent/gameverse-authorized-config' })).configured, false);
});
