import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../src/data.mjs';
import { planMeal, setTastes, checkPantry } from '../src/engine.mjs';
import { runKitchenTool } from '../src/tools.mjs';
import { createApplication } from '../src/app.mjs';
import { MemoryStore } from '../src/store.mjs';

const seed = () => createSeedState({ now: '2026-10-15T10:00:00.000Z' });
const plates = state => Object.fromEntries(state.session.portions.map(p => [p.name, p.variant]));
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

test('saved tastes: each plate gets the first saved taste the dish offers, otherwise the dish default', () => {
  const state = setTastes(seed(), { name: 'noor', tastes: ['ghee', 'egg'] });
  assert.deepEqual(state.household.find(p => p.name === 'Noor').tastes, ['ghee', 'egg']);
  assert.equal(state.household.find(p => p.name === 'Noor').preference, 'ghee');
  assert.match(state.activity.at(-1).message, /Saved Noor’s tastes: ghee, egg/);
  assert.deepEqual(plates(planMeal(state, { dishId: 'dal-tadka', servings: 3 })), {
    Asha: 'mild',
    Ravi: 'spicy',
    Noor: 'ghee',
  });
  // Fried rice has no ghee finish, so Noor's second taste applies.
  assert.equal(plates(planMeal(state, { dishId: 'fried-rice', servings: 3 })).Noor, 'egg');
  // Palak paneer offers neither, so Noor gets the dish default.
  assert.equal(plates(planMeal(state, { dishId: 'palak-paneer', servings: 3 })).Noor, 'mild');
  // Pantry checks use the same choice: Noor's ghee drizzle needs ghee.
  const ghee = checkPantry(state, { dishId: 'dal-tadka' }).missing.find(item => item.id === 'ghee');
  assert.ok(ghee, 'ghee drizzle is counted');
});

test('saved tastes are validated and households saved before tastes still use their single preference', () => {
  const state = seed();
  assert.throws(() => setTastes(state, { name: 'Meera', tastes: ['spicy'] }), /Asha, Ravi, Noor/);
  assert.throws(() => setTastes(state, { name: 'Ravi', tastes: ['smoky'] }), /not a taste/);
  assert.throws(() => setTastes(state, { name: 'Ravi', tastes: ['mild', 'spicy'] }), /mild or spicy/);
  assert.throws(() => setTastes(state, { name: 'Ravi', tastes: [] }), /one to four/);
  const older = { ...state, household: state.household.map(({ tastes, ...person }) => person) };
  assert.equal(plates(planMeal(older, { dishId: 'dal-tadka', servings: 3 })).Ravi, 'spicy');
});

test('save_tastes tool replaces the list, and the kitchen summary shows it', () => {
  const outcome = runKitchenTool('save_tastes', seed(), { name: 'Asha', tastes: ['lemon', 'mild'] });
  assert.deepEqual(outcome.result.kitchen.household.find(p => p.name === 'Asha').tastes, ['lemon', 'mild']);
  assert.throws(() => runKitchenTool('save_tastes', seed(), { name: 'Asha' }), /needs "tastes"/);
});

test('chat: "Remember Noor loves ghee", then "Dal for the three of us" uses everyone’s saved tastes', async () => {
  const call = harness();
  await call('/api/state');
  const save = await call('/api/chat', { message: 'Remember Noor loves ghee' });
  assert.equal(save.json.action, 'tastes');
  assert.deepEqual(save.json.state.household.find(p => p.name === 'Noor').tastes, ['ghee', 'egg']);
  const plan = await call('/api/chat', { message: 'Make dal for the three of us' });
  assert.deepEqual(plates(plan.json.state), { Asha: 'mild', Ravi: 'spicy', Noor: 'ghee' });

  const ask = await call('/api/chat', { message: 'What does Noor like?' });
  assert.equal(ask.json.action, 'help');
  assert.match(ask.json.reply, /Noor likes ghee, then egg/);

  // Tonight-only changes still alter the plate, not the saved taste.
  const tonight = await call('/api/chat', { message: 'actually no chilli for Ravi tonight' });
  assert.equal(tonight.json.action, 'alter');
  assert.deepEqual(tonight.json.state.household.find(p => p.name === 'Ravi').tastes, ['spicy']);

  // A lasting dislike during cooking saves for next time and leaves tonight's plates alone.
  const lasting = await call('/api/chat', { message: "Asha can't eat cheese any more" });
  assert.equal(lasting.json.action, 'tastes');
  assert.deepEqual(lasting.json.state.household.find(p => p.name === 'Asha').tastes, ['without-cheese', 'mild']);
  assert.match(lasting.json.reply, /Tonight’s plates stay as planned/);
  assert.equal(plates(lasting.json.state).Asha, 'mild');
});

test('chat: a lasting "no chilli" makes mild the favourite; the API saves edits from the tastes card', async () => {
  const call = harness();
  await call('/api/state');
  const mild = await call('/api/chat', { message: "Ravi doesn't like spicy food any more" });
  assert.deepEqual(mild.json.state.household.find(p => p.name === 'Ravi').tastes, ['mild']);
  const card = await call('/api/tastes', { name: 'Ravi', tastes: ['spicy', 'lemon'] });
  assert.equal(card.status, 200);
  assert.deepEqual(card.json.state.household.find(p => p.name === 'Ravi').tastes, ['spicy', 'lemon']);
  assert.equal(card.json.tastes.ghee, 'Ghee');
  const bad = await call('/api/tastes', { name: 'Ravi', tastes: ['smoky'] });
  assert.equal(bad.status, 400);
});
