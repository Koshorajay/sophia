import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/app.mjs';
import { MemoryStore } from '../src/store.mjs';

function harness(error) {
  const app = createApplication({
    store: new MemoryStore(),
    env: { SOPHIA_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1', BEDROCK_MODEL_ID: 'amazon.nova-lite-v1:0' },
    bedrockClient: {
      async send() {
        throw Object.assign(new Error(error.message), { name: error.name });
      },
    },
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

test('a blocked AWS account falls back to offline mode with an actionable reason', async () => {
  const call = harness({ name: 'ValidationException', message: 'Operation not allowed' });
  await call('/api/state');
  const answered = await call('/api/chat', { message: 'Plan dal for 3' });
  assert.equal(answered.status, 200);
  assert.equal(answered.json.fallback, 'offline');
  assert.match(
    answered.json.fallbackReason,
    /upgrade from the AWS Free plan to the Paid plan and add a payment method/i,
  );
  assert.match(answered.json.reply, /offline mode/);
  assert.equal(answered.json.state.session.dishId, 'dal-tadka');
});

test('other AWS errors fall back too and keep their specific explanations', async () => {
  for (const [name, message, expected] of [
    ['AccessDeniedException', 'denied', /Bedrock access denied/],
    ['ThrottlingException', 'slow down', /Bedrock is busy/],
    ['ValidationException', 'The provided model identifier is invalid.', /unavailable in this region/],
  ]) {
    const call = harness({ name, message });
    await call('/api/state');
    const answered = await call('/api/chat', { message: 'Plan dal for 3' });
    assert.equal(answered.status, 200, name);
    assert.match(answered.json.fallbackReason, expected, name);
  }
});
