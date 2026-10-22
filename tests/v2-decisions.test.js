import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1Client, createOpenAIDecisionsClient, createAutoDecisions, createDecisions, toOpenAI } from '../v2/planner/decisions.js';

const questions = { engine: { type: 'choice', instructions: 'Which?', criteria: { puzzle: 'blocks', arcade: 'jumping' } }, ok: { type: 'noul', instructions: 'Fine?' }, size: { type: 'score', instructions: 'How big?', criteria: ['small', 'big'] } };
const reply = body => async () => ({ ok: true, status: 200, json: async () => body });

test('both providers take d1-shaped questions and return d1-shaped answers', async () => {
  const native = { engine: { type: 'choice', choice: 'puzzle', confidence: 0.9, probabilities: { puzzle: 0.9, arcade: 0.1 } }, ok: { type: 'noul', noul: 0.8 }, size: { type: 'score', score: 0.3, probabilities: [0.7, 0.3] } };
  let sent = null;
  const d1 = createD1Client({ fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return reply({ answers: native })(); } });
  assert.deepEqual((await d1.decide({ state: 's', questions })).answers, native);
  assert.equal(sent.url, 'http://rrh-llm-1:4000/v1/decisions');

  const wire = toOpenAI(questions);
  assert.deepEqual(wire.map(q => q.type), ['choice', 'predicate', 'score']);
  assert.deepEqual(wire[0].choices, [{ value: 'puzzle', description: 'blocks' }, { value: 'arcade', description: 'jumping' }]);
  const openai = createOpenAIDecisionsClient({ apiKey: 'test', fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return reply({ answers: [
    { name: 'engine', type: 'choice', choice: 'puzzle', confidence: 0.9, probabilities: [{ value: 'puzzle', probability: 0.9 }, { value: 'arcade', probability: 0.1 }] },
    { name: 'ok', type: 'predicate', probability: 0.8 },
    { name: 'size', type: 'score', score: 0.3, confidence: 0.6, probabilities: [{ value: 1, label: 'level_1', probability: 0.3 }, { value: 0, label: 'level_0', probability: 0.7 }] },
  ] })(); } });
  const { answers } = await openai.decide({ state: 's', questions });
  assert.equal(sent.url, 'https://api.openai.com/v1/decisions');
  assert.equal(sent.body.model, 'gpt-6-luna');
  assert.equal(sent.auth, 'Bearer test');
  assert.deepEqual(answers.engine.probabilities, { puzzle: 0.9, arcade: 0.1 });
  assert.equal(answers.ok.noul, 0.8);
  assert.deepEqual(answers.size.probabilities, [0.7, 0.3]);
});

test('auto switches to OpenAI only when d1 is unreachable, and stays switched', async () => {
  let d1Calls = 0, openaiCalls = 0;
  const fail = error => ({ provider: 'd1', url: 'x', decide: async () => { d1Calls++; throw error; } });
  const openai = { provider: 'openai', decide: async () => { openaiCalls++; return { answers: {}, provider: 'openai' }; } };
  const auto = createAutoDecisions({ d1: fail(new TypeError('fetch failed')), openai });
  await auto.decide({}); await auto.decide({});
  assert.deepEqual([d1Calls, openaiCalls, auto.provider], [1, 2, 'openai']);
  const strict = createAutoDecisions({ d1: fail(Object.assign(Error('HTTP 500'), { status: 502 })), openai });
  await assert.rejects(strict.decide({}), /HTTP 500/, 'a reachable d1 that errors is not silently replaced');
  assert.equal(createDecisions({ V2_DECISIONS: 'off' }), null);
  assert.equal(createDecisions({ V2_DECISIONS: 'openai' }, { openaiKey: 'k' }).provider, 'openai');
  assert.throws(() => createDecisions({ V2_DECISIONS: 'openai' }, { openaiKey: '' }), /OPENAI_API_KEY/);
});

// Genre routing (planner/router.js) is retired: decisions now pick primitives per mechanic
// (tests/v2-p-pipeline-select.test.js).
