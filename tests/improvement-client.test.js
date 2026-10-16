import test from 'node:test';
import assert from 'node:assert/strict';
import { submitImprovement, continueImprovement, resumeCampaign } from '../scripts/improvement-client.mjs';

test('agent helpers default to standalone port and preserve explicit server overrides', async t => {
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  let observed;
  globalThis.fetch=async url=>{observed=url;throw Error('stop before network');};
  for(const helper of [submitImprovement,continueImprovement,resumeCampaign]){
    await assert.rejects(helper({priorRunId:'prior',requestId:'request'}),/stop before network/);
    assert.ok(observed.startsWith('http://127.0.0.1:4175/api/improvement/'));
    await assert.rejects(helper({server:'http://localhost:9876',priorRunId:'prior',requestId:'request'}),/stop before network/);
    assert.ok(observed.startsWith('http://localhost:9876/api/improvement/'));
  }
});
