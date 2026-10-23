import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiSchema, runGeminiAgent } from '../src/gemini.mjs';
import { kitchenTools } from '../src/tools.mjs';
import { createApplication } from '../src/app.mjs';
import { MemoryStore } from '../src/store.mjs';

/** A fake Gemini endpoint: replies in order and records what it was sent. */
function fakeGemini(replies) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const next = replies.shift() ?? { text: 'Done.' };
    if (next.status) return { ok: false, status: next.status, json: async () => ({ error: { message: 'busy' } }) };
    const parts = next.call
      ? [{ functionCall: { id: 'call-1', name: next.call, args: next.args || {} } }]
      : [{ text: next.text }];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { role: 'model', parts } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
      }),
    };
  };
  return { fetch, requests };
}

function harness(env, fetch) {
  const app = createApplication({
    store: new MemoryStore(),
    env: { SOPHIA_PROVIDER: 'demo', ...env },
    geminiFetch: fetch,
  });
  let cookie = '';
  return async (path, body) => {
    const response = await app.handle({
      method: body === undefined ? 'GET' : 'POST',
      path,
      headers: { host: 'localhost', cookie },
      body,
    });
    if (response.headers['set-cookie']) cookie = response.headers['set-cookie'].split(';')[0];
    return { status: response.status, json: JSON.parse(response.body) };
  };
}

test('tool schemas keep only the JSON Schema keywords Gemini accepts', () => {
  const schema = geminiSchema(kitchenTools.find(tool => tool.name === 'plan_meal').inputSchema);
  const text = JSON.stringify(schema);
  assert.ok(!/additionalProperties|maxLength|minItems|maxItems/.test(text));
  assert.deepEqual(schema.required, ['dishId']);
  assert.equal(schema.properties.portions.items.properties.name.type, 'string');
});

test('the Gemini agent runs tools through the executor and returns the final reply', async () => {
  const gemini = fakeGemini([{ call: 'plan_meal', args: { dishId: 'dal-tadka' } }, { text: 'Dal is planned.' }]);
  const calls = [];
  const answer = await runGeminiAgent(
    'Dal for three',
    {
      tools: kitchenTools,
      execute: async (name, input) => {
        calls.push([name, input]);
        return { message: 'planned' };
      },
    },
    { apiKey: 'test-key', model: 'gemini-test', fetch: gemini.fetch },
  );
  assert.deepEqual(calls, [['plan_meal', { dishId: 'dal-tadka' }]]);
  assert.equal(answer.reply, 'Dal is planned.');
  assert.deepEqual(answer.toolCalls, [{ name: 'plan_meal', ok: true }]);
  assert.deepEqual(answer.usage, { inputTokens: 200, outputTokens: 20 });
  assert.equal(gemini.requests[0].headers['x-goog-api-key'], 'test-key');
  assert.ok(!gemini.requests[0].url.includes('test-key'), 'the key is sent in a header, never in the URL');
  const response = gemini.requests[1].body.contents.at(-1).parts[0].functionResponse;
  assert.equal(response.id, 'call-1');
  assert.equal(response.name, 'plan_meal');
});

test('with the toggle on, chat uses Gemini; quick commands and toggle-off never call it', async () => {
  const gemini = fakeGemini([
    { call: 'plan_meal', args: { dishId: 'dal-tadka' } },
    { text: 'Dal for three is planned.' },
  ]);
  const call = harness({ GEMINI_API_KEY: 'test-key' }, gemini.fetch);
  const state = await call('/api/state');
  assert.equal(state.json.provider.gemini, true);

  const planned = await call('/api/chat', { message: 'Dal for the three of us please', engine: 'gemini' });
  assert.equal(planned.status, 200);
  assert.equal(planned.json.engine, 'gemini');
  assert.equal(planned.json.reply, 'Dal for three is planned.');
  assert.equal(planned.json.state.session.dishId, 'dal-tadka');
  const sent = gemini.requests.length;

  const done = await call('/api/chat', { message: 'done', engine: 'gemini' });
  assert.match(done.json.reply, /^Confirmed:/);
  await call('/api/chat', { message: 'What is next?' });
  assert.equal(gemini.requests.length, sent, 'quick commands and toggle-off chat use the engine only');
});

test('if Gemini is busy, chat keeps working in labelled offline mode', async () => {
  const gemini = fakeGemini([{ status: 503 }]);
  const call = harness({ GEMINI_API_KEY: 'test-key' }, gemini.fetch);
  await call('/api/state');
  const answered = await call('/api/chat', { message: 'Make dal for 3', engine: 'gemini' });
  assert.equal(answered.status, 200);
  assert.equal(answered.json.fallback, 'offline');
  assert.match(answered.json.fallbackReason, /Gemini is busy/);
  assert.equal(answered.json.state.session.dishId, 'dal-tadka');
});

test('without a Gemini key the toggle is hidden and requests stay on the built-in engine', async () => {
  const gemini = fakeGemini([]);
  const call = harness({}, gemini.fetch);
  const state = await call('/api/state');
  assert.equal(state.json.provider.gemini, false);
  const answered = await call('/api/chat', { message: 'Make dal for 3', engine: 'gemini' });
  assert.equal(answered.status, 200);
  assert.equal(gemini.requests.length, 0);
  assert.equal(answered.json.state.session.dishId, 'dal-tadka');
});
