import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createCodexAgent } from '../scripts/codex-agent.mjs';

function fixture({ account = { type: 'chatgpt', planType: 'pro' }, completion = 'completed', stall = false } = {}) {
  const calls = [], child = new EventEmitter(); child.stdout = new PassThrough(); child.kill = () => child.emit('exit', 0);
  const emit = value => child.stdout.write(JSON.stringify(value) + '\n');
  child.stdin = new Writable({ write(chunk, encoding, done) {
    const request = JSON.parse(chunk); calls.push(request);
    const respond = result => queueMicrotask(() => emit({ id: request.id, result }));
    if (request.method === 'initialize') respond({});
    if (request.method === 'account/read') respond({ account });
    if (request.method === 'thread/start') respond({ thread: { id: 'thread-test' } });
    if (request.method === 'turn/interrupt') { respond({}); setImmediate(() => emit({ method: 'turn/completed', params: { threadId: 'thread-test', turn: { id: 'turn-test', status: 'interrupted' } } })); }
    if (request.method === 'turn/start') {
      respond({ turn: { id: 'turn-test' } });
      if (!stall) setImmediate(() => { emit({ method: 'item/agentMessage/delta', params: { threadId: 'thread-test', delta: 'hello' } }); emit({ method: 'turn/completed', params: { threadId: 'thread-test', turn: { id: 'turn-test', status: completion } } }); });
    }
    done();
  } });
  return { agent: createCodexAgent({ cwd: '/tmp', spawnImpl: () => child, timeoutMs: 25 }), calls };
}
test('requires actual ChatGPT authentication and never falls back to API billing', async () => {
  const { agent, calls } = fixture({ account: { type: 'apiKey' } });
  assert.equal((await agent.status()).authenticated, false);
  await assert.rejects(agent.run({ prompt: 'build' }), /ChatGPT account/);
  assert.equal(calls.some(call => call.method === 'thread/start'), false); agent.close();
});
test('completes only after a completed event, streams text, and uses workspace sandbox', async () => {
  const { agent, calls } = fixture(), chunks = [];
  const result = await agent.run({ prompt: 'build', onEvent: event => chunks.push(event) });
  assert.equal(result.status, 'completed'); assert.equal(result.text, 'hello');
  assert.deepEqual(chunks.filter(event => event.type === 'text'), [{ type: 'text', delta: 'hello' }]);
  assert.equal(chunks[0].threadId, 'thread-test');
  assert.equal(calls.find(call => call.method === 'thread/start').params.sandbox, 'workspace-write'); agent.close();
});
test('failed completion does not become successful output', async () => {
  const { agent } = fixture({ completion: 'failed' }); await assert.rejects(agent.run({ prompt: 'build' }), /failed/); agent.close();
});
test('bounded turn timeout interrupts supported Codex turn', async () => {
  const { agent, calls } = fixture({ stall: true }); await assert.rejects(agent.run({ prompt: 'build' }), /timed out/);
  assert.equal(calls.some(call => call.method === 'turn/interrupt'), true); agent.close();
});
