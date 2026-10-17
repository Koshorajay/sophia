import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/app.mjs';
import { MemoryStore } from '../src/store.mjs';

function harness() {
  const app = createApplication({ store: new MemoryStore(), env: { SOPHIA_PROVIDER: 'demo' } });
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

test('coming back mid-meal: "where was I?" answers with the current step and the chat is remembered', async () => {
  const call = harness();
  await call('/api/state');
  await call('/api/chat', { message: 'Cook dal tadka for 3' });
  await call('/api/chat', { message: 'done' });

  // A reload only re-reads the saved household.
  const reloaded = await call('/api/state');
  const current = reloaded.json.state.session.steps.find(step => step.status !== 'completed');
  assert.ok(reloaded.json.state.conversation.length >= 4);

  for (const message of ['Where was I?', 'where were we', 'Where am I']) {
    const answer = await call('/api/chat', { message });
    assert.equal(answer.status, 200);
    assert.equal(answer.json.action, 'help', message);
    assert.ok(answer.json.reply.startsWith(current.title), `${message}: ${answer.json.reply}`);
    assert.equal(answer.json.state.session.steps.filter(step => step.status === 'completed').length, 1);
  }
});
