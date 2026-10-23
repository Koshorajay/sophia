import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/app.mjs';
import { MemoryStore, FileStore } from '../src/store.mjs';
import { catalog, createSeedState } from '../src/data.mjs';

// Offline Bedrock double: replays scripted Converse responses and records each request.
function fakeBedrock(script) {
  const requests = [];
  return {
    requests,
    async send(command) {
      requests.push(structuredClone(command.input));
      const step = script[requests.length - 1];
      if (!step) throw new Error('Unexpected Bedrock call');
      return typeof step === 'function' ? step(command.input) : step;
    },
  };
}
const toolUse = (name, input, id = `tool-${name}`) => ({
  stopReason: 'tool_use',
  output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: id, name, input } }] } },
  usage: { inputTokens: 10, outputTokens: 5 },
});
const say = text => ({
  stopReason: 'end_turn',
  output: { message: { role: 'assistant', content: [{ text }] } },
  usage: { inputTokens: 10, outputTokens: 5 },
});
const bedrockEnv = (more = {}) => ({
  SOPHIA_PROVIDER: 'bedrock',
  AWS_REGION: 'us-east-1',
  BEDROCK_MODEL_ID: 'amazon.nova-micro-v1:0',
  ...more,
});
const lastToolResult = input => JSON.parse(input.messages.at(-1).content[0].toolResult.content[0].text);

function harness(options = {}) {
  const app = createApplication({ store: new MemoryStore(), env: { SOPHIA_PROVIDER: 'demo' }, ...options });
  let cookie = '';
  const call = async (path, body, extra = {}) => {
    const response = await app.handle({
      method: body === undefined ? 'GET' : 'POST',
      path,
      headers: { host: 'localhost', cookie, ...extra.headers },
      body,
      ip: 'test',
    });
    if (response.headers['set-cookie']) cookie = response.headers['set-cookie'].split(';')[0];
    return { ...response, json: JSON.parse(response.body) };
  };
  return { app, call };
}

test('HTTP workflow persists split cooking and records actual completion once', async () => {
  const { call } = harness();
  let r = await call('/api/state');
  assert.equal(r.status, 200);
  assert.equal(r.json.provider.mode, 'demo');
  const baseHistory = r.json.state.history.length;
  r = await call('/api/chat', { message: 'I am curious about pasta' });
  assert.equal(r.json.state.history.length, baseHistory);
  assert.equal(r.json.state.session, null);
  r = await call('/api/plan', {
    dishId: 'fried-rice',
    servings: 2,
    portions: [
      { name: 'A', variant: 'mild' },
      { name: 'B', variant: 'egg' },
    ],
  });
  assert.equal(r.status, 200);
  const riceBefore = r.json.state.pantry.find(i => i.id === 'rice').quantity;
  const session = r.json.state.session;
  const skip = await call('/api/step', { stepId: session.steps.at(-1).id });
  assert.equal(skip.status, 400);
  const early = await call('/api/finish', {});
  assert.equal(early.status, 400);
  for (const step of session.steps) {
    r = await call('/api/step', { stepId: step.id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  assert.equal(r.json.state.session.confirmedSplit, true);
  r = await call('/api/finish', {});
  assert.equal(r.status, 200);
  assert.equal(r.json.state.history.length, baseHistory + 1);
  assert.equal(r.json.state.pantry.find(i => i.id === 'rice').quantity, riceBefore - 150);
  const duplicate = await call('/api/finish', {});
  assert.equal(duplicate.json.state.history.length, baseHistory + 1);
  assert.equal(duplicate.json.state.pantry.find(i => i.id === 'rice').quantity, riceBefore - 150);
});

test('forecast ignores questions and makes no order; clear demo starts empty', async () => {
  const { call } = harness();
  await call('/api/state');
  const first = await call('/api/forecast', { weeks: 4, awayDays: 0, confirmPantry: false });
  await call('/api/chat', { message: 'What about wraps?' });
  const second = await call('/api/forecast', { weeks: 4, awayDays: 0, confirmPantry: false });
  assert.equal(first.json.forecast.historyCount, second.json.forecast.historyCount);
  const clear = await call('/api/clear-history', {});
  assert.equal(clear.json.state.history.length, 0);
  assert.equal(clear.json.state.demo.enabled, false);
  const empty = await call('/api/forecast', { weeks: 4 });
  assert.equal(empty.json.forecast.monthly.length, 0);
  const saved = await call('/api/shopping', { weeks: 4 });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.state.shopping, []);
});

test('saved shopping snapshot preserves quantities and configuration across reloads', async () => {
  const { call } = harness();
  const initial = await call('/api/state');
  const preview = await call('/api/forecast', {
    weeks: 4,
    awayDays: 14,
    confirmPantry: true,
    revision: initial.json.state.revision,
  });
  assert.equal(preview.json.sourceRevision, initial.json.state.revision);
  const saved = await call('/api/shopping', {
    awayDays: 14,
    confirmPantry: true,
    revision: preview.json.sourceRevision,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.state.shoppingPlan.awayDays, 14);
  assert.deepEqual(saved.json.state.shoppingPlan.monthly, preview.json.forecast.monthly);
  assert.deepEqual(saved.json.state.shoppingPlan.weekly, preview.json.forecast.weekly);
  const reloaded = await call('/api/state');
  assert.deepEqual(reloaded.json.state.shoppingPlan, saved.json.state.shoppingPlan);
  await call('/api/pantry', { id: 'rice', quantity: 1, revision: reloaded.json.state.revision });
  assert.deepEqual((await call('/api/state')).json.state.shoppingPlan, saved.json.state.shoppingPlan);
});

test('stale forecast cannot silently save a newly recalculated shopping list', async () => {
  const { call } = harness();
  const initial = await call('/api/state');
  const preview = await call('/api/forecast', { weeks: 4, confirmPantry: false });
  await call('/api/pantry', { id: 'rice', quantity: 1200, revision: initial.json.state.revision });
  const stale = await call('/api/shopping', { confirmPantry: false, revision: preview.json.sourceRevision });
  assert.equal(stale.status, 409);
  assert.deepEqual((await call('/api/state')).json.state.shopping, []);
});

test('a just-confirmed meal contributes to the immediate grocery forecast', async () => {
  const { call } = harness();
  await call('/api/state');
  await call('/api/clear-history', {});
  let r = await call('/api/plan', { dishId: 'fried-rice', servings: 1, portions: [{ name: 'Asha', variant: 'mild' }] });
  for (const step of r.json.state.session.steps) await call('/api/step', { stepId: step.id });
  r = await call('/api/finish', {});
  assert.equal(r.status, 200);
  const forecast = await call('/api/forecast', { weeks: 4 });
  assert.equal(forecast.json.forecast.historyCount, 1);
});

test('storage failures are JSON503 errors, including unlock and quota checks', async () => {
  const broken = {
    async get() {
      throw new Error('private-provider-details');
    },
    async save() {
      throw new Error('private-provider-details');
    },
    async consumeQuota() {
      throw new Error('private-provider-details');
    },
  };
  const { call } = harness({ store: broken });
  const load = await call('/api/state');
  assert.equal(load.status, 503);
  assert.equal(load.json.code, 'storage_unavailable');
  assert.ok(!load.body.includes('private-provider-details'));
  const unlock = await call('/api/unlock', {});
  assert.equal(unlock.status, 503);
  const store = new MemoryStore();
  let modelCalls = 0;
  const h = harness({
    store,
    env: { SOPHIA_PROVIDER: 'bedrock' },
    interpret: async () => {
      modelCalls++;
      return { action: 'help' };
    },
  });
  await h.call('/api/state');
  store.consumeQuota = broken.consumeQuota;
  assert.equal((await h.call('/api/chat', { message: 'Cook rice' })).status, 503);
  assert.equal(modelCalls, 0);
});

test('signed access cookie unlocks only with correct code and rejects cross-origin writes', async () => {
  const { call } = harness({ env: { SOPHIA_PROVIDER: 'demo', SOPHIA_ACCESS_CODE: 'this-is-a-test-access-code' } });
  assert.equal((await call('/api/state')).status, 401);
  assert.equal((await call('/api/unlock', { accessCode: 'wrong' })).status, 401);
  assert.equal((await call('/api/unlock', { accessCode: 'this-is-a-test-access-code' })).status, 200);
  assert.equal((await call('/api/state')).status, 200);
  assert.equal((await call('/api/reset', {}, { headers: { origin: 'https://other.example' } })).status, 403);
  assert.equal(
    (
      await call(
        '/api/reset',
        {},
        { headers: { origin: 'https://viewer.cloudfront.net', 'x-forwarded-host': 'viewer.cloudfront.net' } },
      )
    ).status,
    200,
  );
});

test('cookie tampering cannot access a hosted household', async () => {
  const { app, call } = harness({ env: { SOPHIA_ACCESS_CODE: 'private-judge-code', SOPHIA_PROVIDER: 'demo' } });
  const unlocked = await call('/api/unlock', { accessCode: 'private-judge-code' });
  const cookie = unlocked.headers['set-cookie'].split(';')[0];
  const invalid = cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0');
  const r = await app.handle({ method: 'GET', path: '/api/state', headers: { cookie: invalid }, body: {} });
  assert.equal(r.status, 401);
});

test('separate sessions never share household writes', async () => {
  const store = new MemoryStore();
  const a = harness({ store }),
    b = harness({ store });
  await a.call('/api/state');
  await b.call('/api/state');
  await a.call('/api/pantry', { id: 'rice', quantity: 1 });
  const stateB = await b.call('/api/state');
  assert.equal(stateB.json.state.pantry.find(i => i.id === 'rice').quantity, 1200);
});

test('stale revision returns 409 without overwriting a newer pantry entry', async () => {
  const { call } = harness();
  const first = await call('/api/state');
  await call('/api/pantry', { id: 'rice', quantity: 600 });
  assert.equal(
    (await call('/api/pantry', { id: 'rice', quantity: 10, revision: first.json.state.revision })).status,
    409,
  );
  assert.equal((await call('/api/state')).json.state.pantry.find(i => i.id === 'rice').quantity, 600);
});

test('Bedrock agent plans through engine tools and every model call counts toward the daily quota', async () => {
  const bedrock = fakeBedrock([
    toolUse('plan_meal', { dishId: 'fried-rice', servings: 1, portions: [{ name: 'A', variant: 'mild' }] }),
    say('Fried rice is planned for A.'),
  ]);
  const { call } = harness({ env: bedrockEnv({ SOPHIA_MAX_DAILY_CALLS: '2' }), bedrockClient: bedrock });
  const first = await call('/api/chat', { message: 'Please cook dinner' });
  assert.equal(first.status, 200);
  assert.equal(first.json.provider.mode, 'bedrock');
  assert.equal(first.json.state.session.servings, 1);
  assert.equal(first.json.action, 'plan');
  assert.equal(first.json.reply, 'Fried rice is planned for A.');
  assert.deepEqual(first.json.usage, { inputTokens: 20, outputTokens: 10 });
  assert.deepEqual(first.json.toolCalls, [{ name: 'plan_meal', ok: true }]);
  const sent = bedrock.requests[0];
  assert.equal(sent.inferenceConfig.temperature, 0);
  assert.deepEqual(
    sent.toolConfig.tools.map(t => t.toolSpec.name),
    [
      'search_recipes',
      'get_kitchen_state',
      'plan_meal',
      'complete_current_step',
      'alter_portion',
      'finish_meal',
      'cancel_meal',
      'update_pantry',
      'forecast_groceries',
      'check_pantry',
      'add_to_shopping_list',
      'update_shopping_list',
    ],
  );
  assert.ok(
    sent.toolConfig.tools.every(
      t => t.toolSpec.inputSchema.json.type === 'object' && !t.toolSpec.inputSchema.json.properties.householdId,
    ),
  );
  assert.match(lastToolResult(bedrock.requests[1]).message, /planned for 1/);
  const quota = await call('/api/chat', { message: 'Please help' });
  assert.equal(quota.status, 429);
  assert.equal(bedrock.requests.length, 2);
  assert.equal((await call('/api/step', { stepId: first.json.state.session.steps[0].id })).status, 200);
});

test('running out of quota during a tool loop discards the partial change', async () => {
  const bedrock = fakeBedrock([toolUse('plan_meal', { dishId: 'pasta' }), say('never sent')]);
  const { call } = harness({ env: bedrockEnv({ SOPHIA_MAX_DAILY_CALLS: '1' }), bedrockClient: bedrock });
  const before = await call('/api/state');
  const r = await call('/api/chat', { message: 'Cook pasta' });
  assert.equal(r.status, 429);
  assert.equal(bedrock.requests.length, 1);
  const after = await call('/api/state');
  assert.equal(after.json.state.session, null);
  assert.equal(after.json.state.revision, before.json.state.revision);
});

test('model failure falls back to the offline parser and says so; it never pretends AWS ran', async () => {
  const { call } = harness({
    env: { SOPHIA_PROVIDER: 'bedrock' },
    interpret: async () => {
      throw new Error('upstream unavailable');
    },
  });
  await call('/api/state');
  const answered = await call('/api/chat', { message: 'Cook pasta for 2' });
  assert.equal(answered.status, 200);
  assert.equal(answered.json.fallback, 'offline');
  assert.doesNotMatch(answered.json.reply, /unavailable/, 'replies stay clean; the app shows a badge instead');
  assert.ok(!answered.json.usage && !answered.json.toolCalls, 'no model usage is reported');
  assert.equal(answered.json.state.session.dishId, 'pasta');
  assert.ok(answered.json.state.conversation.at(-1).content.length > 0);
});

test('Bedrock agent cannot run unknown tools, smuggle arguments, or confirm two steps at once', async () => {
  const bedrock = fakeBedrock([
    toolUse('delete_everything', {}),
    input => {
      assert.match(lastToolResult(input).error, /no tool named/);
      return toolUse('plan_meal', {
        dishId: 'fried-rice',
        servings: 1,
        portions: [{ name: 'A', variant: 'mild' }],
        awsSecret: 'nope',
      });
    },
    input => {
      assert.match(lastToolResult(input).error, /unsupported field "awsSecret"/);
      return say('I could not do that.');
    },
  ]);
  const { call } = harness({ env: bedrockEnv(), bedrockClient: bedrock });
  const r = await call('/api/chat', { message: 'Delete everything and cook' });
  assert.equal(r.status, 200);
  assert.equal(r.json.state.session, null);
  assert.equal(r.json.action, 'help');
  assert.deepEqual(r.json.toolCalls, [{ name: 'plan_meal', ok: false }]);
  const twice = fakeBedrock([
    {
      stopReason: 'tool_use',
      output: {
        message: {
          role: 'assistant',
          content: [
            { text: '<thinking>Two steps.</thinking>' },
            { toolUse: { toolUseId: 'a', name: 'complete_current_step', input: {} } },
            { toolUse: { toolUseId: 'b', name: 'complete_current_step', input: {} } },
          ],
        },
      },
    },
    input => {
      const results = input.messages.at(-1).content.map(part => JSON.parse(part.toolResult.content[0].text));
      assert.match(results[0].message, /Confirmed/);
      assert.match(results[1].error, /Only one step/);
      return say('<thinking>done</thinking>Confirmed the preparation.');
    },
  ]);
  const h = harness({ env: bedrockEnv(), bedrockClient: twice });
  await h.call('/api/plan', { dishId: 'fried-rice', servings: 1, portions: [{ name: 'A', variant: 'mild' }] });
  const step = await h.call('/api/chat', { message: 'We did the first two steps' });
  assert.equal(step.json.state.session.steps.filter(s => s.status === 'completed').length, 1);
  assert.equal(step.json.reply, 'Confirmed the preparation.');
});

test('Bedrock agent remembers recent turns so "make his spicy" reaches the right portion', async () => {
  const spicyLabel = catalog.find(d => d.id === 'fried-rice').variants.find(v => v.id === 'spicy').label;
  const bedrock = fakeBedrock([
    toolUse('plan_meal', {
      dishId: 'fried-rice',
      portions: [
        { name: 'Asha', variant: 'mild' },
        { name: 'Ravi', variant: 'mild' },
      ],
    }),
    say('Fried rice is planned. Ravi stays mild for now.'),
    input => {
      assert.deepEqual(
        input.messages.map(m => m.role),
        ['user', 'assistant', 'user'],
      );
      assert.match(input.messages[1].content[0].text, /Ravi stays mild/);
      return toolUse('alter_portion', { portionName: 'Ravi', variant: spicyLabel });
    },
    say('Ravi’s plate will be spicy.'),
  ]);
  const { call } = harness({ env: bedrockEnv(), bedrockClient: bedrock });
  await call('/api/chat', { message: 'Fried rice for me and Ravi, keep his mild for now' });
  const r = await call('/api/chat', { message: 'Actually make his spicy' });
  assert.equal(r.status, 200);
  assert.equal(r.json.action, 'alter');
  assert.deepEqual(
    r.json.state.session.portions.map(p => p.variant),
    ['mild', 'spicy'],
  );
  assert.deepEqual(
    r.json.state.conversation.map(t => t.role),
    ['user', 'assistant', 'user', 'assistant'],
  );
  assert.ok(r.json.state.conversation.every(t => typeof t.content === 'string' && t.at));
});

test('conversation memory keeps only the latest ten turns and is cleared with history', async () => {
  const { call } = harness();
  let r;
  for (let i = 0; i < 7; i++) r = await call('/api/chat', { message: `What is next ${i}?` });
  assert.equal(r.json.state.conversation.length, 10);
  assert.equal(r.json.state.conversation.at(-2).content, 'What is next 6?');
  assert.equal((await call('/api/state')).json.state.conversation.length, 10);
  r = await call('/api/clear-history', {});
  assert.deepEqual(r.json.state.conversation, []);
});

test('conversation changes only the named portion and validates the full serving count', async () => {
  const { call } = harness();
  await call('/api/state');
  const invalid = await call('/api/chat', { message: 'Cook rice for 10' });
  assert.equal(invalid.json.state.session, null);
  assert.match(invalid.json.reply, /one to six/);
  await call('/api/plan', {
    dishId: 'pasta',
    servings: 2,
    portions: [
      { name: 'Asha', variant: 'cheese' },
      { name: 'Ravi', variant: 'cheese' },
    ],
  });
  const change = await call('/api/chat', { message: 'Remove cheese from Asha' });
  assert.equal(change.status, 200);
  assert.deepEqual(
    change.json.state.session.portions.map(p => p.variant),
    ['without-cheese', 'cheese'],
  );
});

test('pantry help is grounded and ambiguous egg changes ask for a person', async () => {
  const { call } = harness();
  await call('/api/state');
  const pantry = await call('/api/chat', { message: 'What can I cook with what I have?' });
  assert.match(pantry.json.reply, /entered pantry quantities/);
  assert.match(pantry.json.reply, /pasta/i);
  await call('/api/plan', {
    dishId: 'fried-rice',
    servings: 2,
    portions: [
      { name: 'A', variant: 'mild' },
      { name: 'Ravi', variant: 'mild' },
    ],
  });
  const ambiguous = await call('/api/chat', { message: 'Add egg' });
  assert.deepEqual(
    ambiguous.json.state.session.portions.map(p => p.variant),
    ['mild', 'mild'],
  );
  assert.match(ambiguous.json.reply, /Whose plate/);
  const named = await call('/api/chat', { message: 'Add egg to Ravi' });
  assert.deepEqual(
    named.json.state.session.portions.map(p => p.variant),
    ['mild', 'egg'],
  );
});

test('negations and questions do not confirm steps; distinct requested versions survive', async () => {
  const { call } = harness();
  await call('/api/state');
  const plan = await call('/api/chat', { message: 'Cook rice for 2, one spicy, one with egg' });
  assert.deepEqual(new Set(plan.json.state.session.portions.map(p => p.variant)), new Set(['spicy', 'egg']));
  for (const message of [
    'This step is not done',
    'Is this step done?',
    'We have not finished cooking',
    'Is the meal done?',
  ]) {
    const r = await call('/api/chat', { message });
    assert.equal(r.json.state.session.steps[0].status, 'pending');
    assert.equal(r.json.state.session.status, 'cooking');
  }
});

test('oversized requests and repeated names are rejected without writes', async () => {
  const { call } = harness();
  await call('/api/state');
  const large = await call('/api/chat', { message: 'a'.repeat(20000) });
  assert.equal(large.status, 413);
  const badName = await call('/api/plan', {
    dishId: 'pasta',
    servings: 1,
    portions: [{ name: 'a'.repeat(100), variant: 'cheese' }],
  });
  assert.equal(badName.status, 400);
  assert.equal((await call('/api/state')).json.state.session, null);
});

test('local persistence survives a store restart and rejects conflicting revisions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sophia-test-'));
  try {
    const a = new FileStore(dir);
    await a.save('a', { revision: 0, value: 'before' });
    await a.save('a', { revision: 1, value: 'saved' }, 0);
    await assert.rejects(a.save('a', { revision: 1, value: 'lost' }, 0));
    const b = new FileStore(dir);
    assert.equal((await b.get('a')).value, 'saved');
    assert.equal(await b.consumeQuota('2026-10-14', 1), true);
    assert.equal(await b.consumeQuota('2026-10-14', 1), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local chat plans use saved household preferences, filling extra plates with the dish default', async () => {
  const { call } = harness();
  await call('/api/state');
  const r = await call('/api/chat', { message: 'I want to make dal for 4 people' });
  assert.equal(r.status, 200);
  assert.equal(r.json.action, 'plan');
  // Each person gets their saved finish when this dish has it (Ravi: spicy); others and the guest get the dish default.
  const dal = catalog.find(d => d.id === r.json.state.session.dishId),
    finishes = new Set(dal.variants.map(v => v.id));
  assert.equal(dal.id, 'dal-tadka');
  assert.ok(finishes.has('spicy'));
  const expected = [...createSeedState().household, { name: 'Guest 4' }].map(p => ({
    name: p.name,
    variant: finishes.has(p.preference) ? p.preference : dal.defaultVariant,
  }));
  assert.deepEqual(r.json.state.session.portions, expected);
  // Replies name the finish ("red chilli tadka"), since they are read aloud.
  const spicyLabel = dal.variants.find(v => v.id === 'spicy').label.toLowerCase();
  assert.ok(r.json.reply.includes(`Ravi (${spicyLabel})`), r.json.reply);
  const two = harness();
  await two.call('/api/state');
  const words = await two.call('/api/chat', { message: 'Cook pasta for two, no cheese' });
  assert.deepEqual(
    words.json.state.session.portions.map(p => p.variant),
    ['without-cheese', 'spicy'],
  );
  // Every plate already has a requested finish, so a repeated one changes: the guest's, not Asha's.
  const full = harness();
  await full.call('/api/state');
  const all = await full.call('/api/chat', { message: 'Cook pasta for 4, one without cheese, one spicy, one cheese' });
  assert.deepEqual(
    all.json.state.session.portions.map(p => p.variant),
    ['without-cheese', 'spicy', 'without-cheese', 'cheese'],
  );
});

test('local chat switches any named portion to any supported finish, by id, label, or pronoun', async () => {
  const { call } = harness();
  await call('/api/state');
  await call('/api/plan', {
    dishId: 'pasta',
    servings: 3,
    portions: [
      { name: 'Asha', variant: 'without-cheese' },
      { name: 'Ravi', variant: 'cheese' },
      { name: 'Noor', variant: 'cheese' },
    ],
  });
  let r = await call('/api/chat', { message: "Make Ravi's spicy" });
  assert.equal(r.json.action, 'alter');
  assert.deepEqual(
    r.json.state.session.portions.map(p => p.variant),
    ['without-cheese', 'spicy', 'cheese'],
  );
  r = await call('/api/chat', { message: 'Change Asha to cheese' });
  assert.deepEqual(
    r.json.state.session.portions.map(p => p.variant),
    ['cheese', 'spicy', 'cheese'],
  );
  r = await call('/api/chat', { message: 'Switch Noor to without cheese' });
  assert.deepEqual(
    r.json.state.session.portions.map(p => p.variant),
    ['cheese', 'spicy', 'without-cheese'],
  );
  r = await call('/api/chat', { message: 'Noor is hungry today' });
  r = await call('/api/chat', { message: 'Actually give her the cheese one' });
  assert.deepEqual(
    r.json.state.session.portions.map(p => p.variant),
    ['cheese', 'spicy', 'cheese'],
  );
  r = await call('/api/chat', { message: 'Make Asha and Ravi spicy' });
  assert.match(r.json.reply, /one person/);
  assert.deepEqual(
    r.json.state.session.portions.map(p => p.variant),
    ['cheese', 'spicy', 'cheese'],
  );
  r = await call('/api/chat', { message: 'Make it spicy' });
  assert.match(r.json.reply, /Whose plate/);
  r = await call('/api/chat', { message: "Make Ravi's spicy" });
  assert.match(r.json.reply, /already/);
  // A negated finish is an omission, never a switch to that finish.
  r = await call('/api/chat', { message: "Asha doesn't want cheese" });
  assert.equal(r.json.action, 'alter');
  assert.deepEqual(
    r.json.state.session.portions.map(p => p.variant),
    ['without-cheese', 'spicy', 'cheese'],
  );
});

test('cancel abandons only the active meal through the API and chat, never history or pantry', async () => {
  const { call } = harness();
  const initial = await call('/api/state');
  assert.equal((await call('/api/cancel', {})).status, 400);
  let r = await call('/api/plan', {
    dishId: 'fried-rice',
    servings: 2,
    portions: [
      { name: 'A', variant: 'mild' },
      { name: 'B', variant: 'egg' },
    ],
  });
  r = await call('/api/step', { stepId: r.json.state.session.steps[0].id });
  r = await call('/api/cancel', { revision: r.json.state.revision });
  assert.equal(r.status, 200);
  assert.equal(r.json.state.session, null);
  assert.match(r.json.reply, /not recorded as cooked/);
  assert.equal(r.json.state.history.length, initial.json.state.history.length);
  assert.deepEqual(r.json.state.pantry, initial.json.state.pantry);
  assert.equal(r.json.state.requests.find(q => q.kind === 'plan').status, 'cancelled');
  r = await call('/api/chat', { message: 'Cook pasta for 2' });
  assert.equal(r.json.state.session.dishId, 'pasta');
  for (const message of ["Don't cancel the meal", 'Should we cancel this meal?', 'Cancel the egg for B']) {
    r = await call('/api/chat', { message });
    assert.equal(r.json.state.session?.dishId, 'pasta', message);
  }
  r = await call('/api/chat', { message: 'Cancel this meal' });
  assert.equal(r.json.action, 'cancel');
  assert.equal(r.json.state.session, null);
  r = await call('/api/chat', { message: 'cancel' });
  assert.match(r.json.reply, /no active meal/);
  r = await call('/api/chat', { message: 'Cook fried rice for 2' });
  assert.equal(r.json.state.session.dishId, 'fried-rice');
  r = await call('/api/chat', { message: 'Please cancel the fried rice.' });
  assert.equal(r.json.state.session, null);
});
