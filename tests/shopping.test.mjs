import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../src/data.mjs';
import { checkPantry, addToShoppingList, updateShoppingList, planMeal, updatePantry } from '../src/engine.mjs';
import { runKitchenTool } from '../src/tools.mjs';
import { createApplication } from '../src/app.mjs';
import { MemoryStore } from '../src/store.mjs';

function seed() {
  return {
    ...createSeedState({ now: '2026-10-15T10:00:00.000Z' }),
    history: [],
    requests: [],
    demo: { enabled: false },
  };
}
function harness(env = {}, options = {}) {
  const app = createApplication({ store: new MemoryStore(), env: { SOPHIA_PROVIDER: 'demo', ...env }, ...options });
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

test('pantry check reports what a dish needs beyond the entered stock, for saved preferences', () => {
  let state = seed();
  const before = checkPantry(state, { dishId: 'dal-tadka' });
  assert.equal(before.servings, 3);
  const dal = before.missing.find(item => item.id === 'toor-dal');
  assert.deepEqual([dal.needed, dal.have, dal.missing], [180, 0, 180]);
  // Ravi's saved preference is spicy, so his red chilli tadka needs chilli; the seed pantry has 20 g.
  assert.ok(!before.missing.some(item => item.id === 'chilli'));

  state = updatePantry(state, { id: 'toor-dal', quantity: 500 });
  assert.ok(!checkPantry(state, { dishId: 'dal-tadka' }).missing.some(item => item.id === 'toor-dal'));
  assert.equal(state.revision, 1, 'checking never changes the household');
});

test('shopping list rounds up, keeps the larger amount for repeats, and ticks, removes and clears', () => {
  let state = addToShoppingList(
    seed(),
    [
      { id: 'toor-dal', quantity: 178 },
      { id: 'egg', quantity: 1.2 },
    ],
    'For dal',
  );
  assert.deepEqual(
    state.shoppingList.map(item => [item.id, item.quantity, item.bought]),
    [
      ['toor-dal', 180, false],
      ['egg', 2, false],
    ],
  );
  state = addToShoppingList(state, [{ id: 'toor-dal', quantity: 90 }], 'For khichdi');
  assert.equal(state.shoppingList.find(item => item.id === 'toor-dal').quantity, 180);
  assert.equal(state.shoppingList.length, 2);

  state = updateShoppingList(state, { op: 'toggle', id: 'egg' });
  assert.equal(state.shoppingList.find(item => item.id === 'egg').bought, true);
  state = updateShoppingList(state, { op: 'clear-bought' });
  assert.deepEqual(
    state.shoppingList.map(item => item.id),
    ['toor-dal'],
  );
  state = updateShoppingList(state, { op: 'remove', id: 'toor-dal' });
  assert.equal(state.shoppingList.length, 0);

  assert.throws(() => addToShoppingList(seed(), [{ id: 'gold', quantity: 1 }]), /existing pantry ingredient/);
  assert.throws(() => addToShoppingList(seed(), [{ id: 'rice', quantity: -1 }]), /between 0 and 100,000/);
  assert.throws(() => updateShoppingList(seed(), { op: 'toggle', id: 'rice' }), /not on the shopping list/);
  assert.throws(() => updateShoppingList(seed(), { op: 'order' }), /toggle, remove/);
});

test('MCP tools: check_pantry is read-only and add_to_shopping_list adds what the active meal is missing', () => {
  const planned = planMeal(seed(), { dishId: 'palak-paneer', servings: 3 });
  const check = runKitchenTool('check_pantry', planned, {});
  assert.equal(check.state, undefined);
  assert.ok(check.result.missing.some(item => item.id === 'paneer'));

  const added = runKitchenTool('add_to_shopping_list', planned, {});
  assert.ok(added.state.shoppingList.some(item => item.id === 'paneer' && item.reason === 'For Palak paneer'));
  assert.ok(added.result.kitchen.shoppingList.length > 0);

  const explicit = runKitchenTool('add_to_shopping_list', seed(), {
    items: [{ ingredient: 'Toor dal', quantity: 500 }],
  });
  assert.equal(explicit.state.shoppingList[0].id, 'toor-dal');
  assert.throws(() => runKitchenTool('add_to_shopping_list', seed(), {}), /Say which dish/);

  const ticked = runKitchenTool('update_shopping_list', explicit.state, { op: 'toggle', ingredient: 'toor dal' });
  assert.equal(ticked.state.shoppingList[0].bought, true);
});

test('chat: "Do I have everything for dal?", then "add them to my shopping list", then read the list', async () => {
  const call = harness();
  await call('/api/state');
  const check = await call('/api/chat', { message: 'Do I have everything for dal?' });
  assert.equal(check.json.action, 'check');
  assert.match(check.json.reply, /short on dry toor dal \(180 g\)/);
  assert.equal(check.json.state.shoppingList, undefined, 'checking adds nothing');

  const add = await call('/api/chat', { message: 'add them to my shopping list' });
  assert.equal(add.json.action, 'shop');
  assert.match(add.json.reply, /Nothing is ordered/);
  assert.ok(add.json.state.shoppingList.some(item => item.id === 'toor-dal'));

  const read = await call('/api/chat', { message: "What's on my shopping list?" });
  assert.equal(read.json.action, 'help');
  assert.match(read.json.reply, /dry toor dal \(180 g\)/);

  // "shopping" alone still means the grocery forecast.
  const forecast = await call('/api/chat', { message: 'Plan groceries for next month' });
  assert.equal(forecast.json.action, 'forecast');
});

test("web route adds the active meal's shortages; without a meal it explains what to do", async () => {
  const call = harness();
  const state = await call('/api/state');
  const none = await call('/api/shopping-list', { op: 'add-shortages', revision: state.json.state.revision });
  assert.equal(none.status, 400);
  assert.match(none.json.error, /Say which dish/);

  const plan = await call('/api/chat', { message: 'Make palak paneer for 3' });
  const added = await call('/api/shopping-list', { op: 'add-shortages', revision: plan.json.state.revision });
  assert.equal(added.status, 200);
  assert.ok(added.json.state.shoppingList.some(item => item.id === 'paneer'));
  const toggled = await call('/api/shopping-list', {
    op: 'toggle',
    id: 'paneer',
    revision: added.json.state.revision,
  });
  assert.equal(toggled.json.state.shoppingList.find(item => item.id === 'paneer').bought, true);
});

test('Polly voice: off by default, speaks with a daily limit when on, and reports failures for browser fallback', async () => {
  const browser = harness();
  assert.equal((await browser('/api/state')).json.provider.speech, 'browser');
  assert.equal((await browser('/api/speak', { text: 'Hello' })).status, 404);

  const spoken = [];
  const polly = harness(
    { SOPHIA_VOICE: 'polly', SOPHIA_MAX_DAILY_SPEECH: '2' },
    {
      synthesizeSpeech: async text => {
        spoken.push(text);
        return new Uint8Array([73, 68, 51]);
      },
    },
  );
  const state = await polly('/api/state');
  assert.equal(state.json.provider.speech, 'polly');
  assert.equal(state.json.provider.voice, 'Kajal');
  const ok = await polly('/api/speak', { text: 'Dal for three.' });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.json.contentType, ok.json.audio], ['audio/mpeg', 'SUQz']);
  assert.equal(state.json.state.revision, (await polly('/api/state')).json.state.revision, 'speaking saves nothing');
  assert.equal((await polly('/api/speak', { text: '' })).status, 400);
  assert.equal((await polly('/api/speak', { text: 'Second.' })).status, 200);
  assert.equal((await polly('/api/speak', { text: 'Third.' })).status, 429);
  assert.deepEqual(spoken, ['Dal for three.', 'Second.']);

  const failing = harness(
    { SOPHIA_VOICE: 'polly' },
    {
      synthesizeSpeech: async () => {
        throw new Error('AccessDenied');
      },
    },
  );
  await failing('/api/state');
  const failed = await failing('/api/speak', { text: 'Hello' });
  assert.equal(failed.status, 502);
  assert.match(failed.json.error, /browser voice will be used/);
});

test('"add them" after checking another dish adds that dish, even while a meal is cooking', async () => {
  const call = harness();
  await call('/api/state');
  await call('/api/chat', { message: 'Make dal for 3' });
  const check = await call('/api/chat', { message: 'Do I have everything for palak paneer?' });
  assert.equal(check.json.action, 'check');
  const add = await call('/api/chat', { message: 'add them to my shopping list' });
  assert.ok(
    add.json.state.shoppingList.every(item => item.reason === 'For Palak paneer'),
    add.json.reply,
  );
  assert.ok(add.json.state.shoppingList.some(item => item.id === 'paneer'));

  // Asking about the meal being cooked, then "add them", uses that meal's actual portions.
  await call('/api/chat', { message: 'what am I missing?' });
  const meal = await call('/api/chat', { message: 'add them to my list' });
  assert.ok(meal.json.state.shoppingList.some(item => item.reason === 'For Dal tadka'));
});
