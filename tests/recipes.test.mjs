import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalog,
  recipeDefinitions,
  ingredientCatalog,
  createSeedState,
  ingredientsFor,
  withRecipePantry,
  matchRecipes,
} from '../src/data.mjs';
import { planMeal, completeStep, finishMeal, alterMeal, updatePantry, forecastGroceries } from '../src/engine.mjs';
import { compactContext, runBedrockAgent } from '../src/bedrock.mjs';
import { kitchenTools, runKitchenTool } from '../src/tools.mjs';
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
function portions(dish) {
  return dish.variants.map((variant, index) => ({ name: `Person ${index + 1}`, variant: variant.id }));
}

test('catalogue has 30 distinct dishes with consistent ingredient identities and units', () => {
  assert.equal(catalog.length, 30);
  assert.equal(new Set(catalog.map(d => d.id)).size, 30);
  assert.equal(Object.keys(recipeDefinitions).length, catalog.length);
  const registry = new Map(ingredientCatalog.map(item => [item.id, item]));
  for (const dish of catalog) {
    const recipe = recipeDefinitions[dish.id];
    assert.ok(
      dish.variants.some(v => v.id === recipe.defaultVariant),
      dish.id,
    );
    assert.equal(new Set(recipe.sharedSteps.map(s => s.id)).size, recipe.sharedSteps.length);
    const all = [...recipe.base, ...Object.values(recipe.extras).flat()];
    for (const item of all) {
      const { quantity, ...identity } = item;
      assert.deepEqual(identity, registry.get(item.id), `${dish.id}: ${item.id}`);
      assert.ok(Number.isFinite(quantity) && quantity > 0);
      if (item.unit === 'item') assert.ok(Number.isInteger(quantity));
    }
    for (const required of recipe.requiredIngredients)
      assert.ok(
        all.some(i => i.id === required),
        `${dish.id} missing ${required}`,
      );
  }
});

for (const dish of catalog)
  test(`${dish.name}: all finishes, ordered split, pantry and forecast work together`, () => {
    const selected = portions(dish),
      recipe = recipeDefinitions[dish.id];
    const one = ingredientsFor(dish.id, selected);
    const double = ingredientsFor(dish.id, [...selected, ...selected]);
    for (const item of one) assert.equal(double.find(i => i.id === item.id).quantity, item.quantity * 2);
    let state = seed();
    for (const item of one) state = updatePantry(state, { id: item.id, quantity: item.quantity * 2 });
    state = planMeal(state, { dishId: dish.id, servings: selected.length, portions: selected });
    const ledger = new Set(state.session.steps.flatMap(s => s.adds));
    for (const item of one) assert.ok(ledger.has(item.id), `${dish.id} never adds ${item.id}`);
    assert.ok(state.session.steps.every(s => s.instruction && !s.instruction.includes('[[')));
    assert.equal(forecastGroceries(state).historyCount, 0);
    assert.throws(() => completeStep(state, 'finish-1'), /split/);
    for (const step of state.session.steps) state = completeStep(state, step.id);
    assert.equal(state.session.confirmedSplit, true);
    state = finishMeal(state);
    assert.equal(state.history.length, 1);
    assert.deepEqual(state.history[0].ingredients, one);
    for (const item of one) assert.equal(state.pantry.find(i => i.id === item.id).quantity, item.quantity);
    assert.equal(forecastGroceries(state).historyCount, 1);
    assert.deepEqual(finishMeal(state), state);
    for (const item of recipe.base.filter(i => !recipe.requiredIngredients.includes(i.id))) {
      const planned = planMeal(seed(), { dishId: dish.id, servings: 1, portions: [selected[0]] });
      const omitted = alterMeal(planned, { omitIngredient: item.id });
      assert.ok(!omitted.session.ingredients.some(i => i.id === item.id), `${dish.id}: omitted ${item.id} remains`);
      assert.ok(omitted.session.steps.every(s => !s.adds.includes(item.id) && !s.instruction.includes('[[')));
      if (recipe.version === '2') {
        for (const step of recipe.sharedSteps) {
          const clause = new RegExp(`\\[\\[${item.id}\\|([^\\]]+)\\]\\]`).exec(step.instruction)?.[1];
          if (clause)
            assert.ok(!omitted.session.steps.find(s => s.id === `shared-${step.id}`).instruction.includes(clause));
        }
      }
      let inProgress = planned;
      for (const step of planned.session.steps) {
        inProgress = completeStep(inProgress, step.id);
        if (step.adds.includes(item.id)) break;
      }
      assert.throws(() => alterMeal(inProgress, { omitIngredient: item.id }), /already been added/);
    }
  });

test('specific names, aliases and two-dish ambiguity resolve across the whole catalogue', () => {
  for (const dish of catalog) {
    for (const alias of [dish.name, ...dish.aliases]) {
      assert.deepEqual(
        matchRecipes(`Please cook ${alias} for 2`).map(d => d.id),
        [dish.id],
        alias,
      );
    }
  }
  assert.deepEqual(
    matchRecipes('Cook lemon rice for 3').map(d => d.id),
    ['lemon-rice'],
  );
  assert.equal(matchRecipes('Cook dal and rice').length, 2);
  assert.equal(matchRecipes('Cook butter chicken').length, 0);
});

test('old household migration preserves entered stock, history, active sessions and revision', () => {
  const old = planMeal(seed(), { dishId: 'pasta', servings: 1 });
  old.pantry = old.pantry.filter(i => ['rice', 'pasta', 'onion'].includes(i.id));
  old.pantry[0] = { ...old.pantry[0], quantity: 321, confirmed: true, source: 'user' };
  old.shoppingPlan = { savedAt: '2026-10-15', monthly: [], weekly: [] };
  const before = structuredClone(old),
    migrated = withRecipePantry(old);
  assert.deepEqual(old, before);
  assert.equal(migrated.revision, old.revision);
  assert.deepEqual(migrated.session, old.session);
  assert.deepEqual(migrated.shoppingPlan, old.shoppingPlan);
  assert.deepEqual(migrated.pantry.slice(0, 3), old.pantry);
  assert.equal(migrated.pantry.find(i => i.id === 'paneer').quantity, 0);
  assert.equal(migrated.pantry.find(i => i.id === 'paneer').confirmed, false);
  assert.deepEqual(withRecipePantry(migrated), migrated);
});

test('new named finishes change only the selected plate and cannot remove core egg', () => {
  let state = planMeal(seed(), {
    dishId: 'besan-chilla',
    servings: 2,
    portions: [
      { name: 'Asha', variant: 'cheese' },
      { name: 'Ravi', variant: 'cheese' },
    ],
  });
  state = alterMeal(state, { omitIngredient: 'cheese', portionName: 'Asha' });
  assert.deepEqual(
    state.session.portions.map(p => p.variant),
    ['mild', 'cheese'],
  );
  assert.equal(state.session.ingredients.find(i => i.id === 'cheese').quantity, 20);
  state = planMeal(seed(), { dishId: 'egg-bhurji', servings: 1 });
  assert.throws(() => alterMeal(state, { omitIngredient: 'egg' }), /essential/);
  assert.match(state.session.steps.find(s => s.phase === 'finish').instruction, /71°C/);
});

function apiHarness() {
  const store = new MemoryStore();
  const app = createApplication({ store, env: { SOPHIA_PROVIDER: 'demo' } });
  let cookie = '';
  return {
    store,
    async call(path, body) {
      const response = await app.handle({
        method: body === undefined ? 'GET' : 'POST',
        path,
        headers: { host: 'localhost', cookie },
        body,
      });
      if (response.headers['set-cookie']) cookie = response.headers['set-cookie'].split(';')[0];
      return { status: response.status, json: JSON.parse(response.body), id: cookie.split('=')[1] };
    },
  };
}

test('local chat can plan all 30 dishes without an AWS call', async () => {
  for (const dish of catalog) {
    const { call } = apiHarness();
    const result = await call('/api/chat', { message: `Cook ${dish.name} for 2` });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.state.session?.dishId, dish.id, dish.name);
    assert.equal(result.json.state.session.servings, 2);
    assert.equal(result.json.provider.mode, 'demo');
  }
  const { call } = apiHarness();
  const multiple = await call('/api/chat', { message: 'Cook dal and rice for 3' });
  assert.equal(multiple.json.state.session, null);
  assert.match(multiple.json.reply, /Choose one dish/);
  const help = await call('/api/chat', { message: 'What can I cook with my pantry?' });
  assert.ok(help.json.reply.length < 1200);
  assert.match(help.json.reply, /closest three/);
});

test('an existing API household can edit a newly introduced pantry ingredient', async () => {
  const { call, store } = apiHarness();
  const initial = await call('/api/state');
  const old = {
    ...initial.json.state,
    revision: 1,
    pantry: initial.json.state.pantry.filter(i => i.source === 'demo'),
  };
  await store.save(initial.id, old, 0);
  const loaded = await call('/api/state');
  assert.equal(loaded.json.state.revision, 1);
  assert.equal(loaded.json.state.pantry.find(i => i.id === 'paneer').quantity, 0);
  const edited = await call('/api/pantry', { id: 'paneer', quantity: 400, revision: 1 });
  assert.equal(edited.status, 200);
  assert.equal((await store.get(initial.id)).pantry.find(i => i.id === 'paneer').quantity, 400);
  assert.deepEqual(edited.json.state.history, old.history);
});

test('Bedrock retrieves every recipe including the last entry and preserves the active dish', () => {
  for (const dish of catalog) {
    const context = compactContext(
      { catalog, session: { dishId: 'fried-rice', servings: 3, portions: [], steps: [] } },
      `Cook ${dish.name} for 2`,
    );
    assert.ok(
      context.recipes.some(d => d.id === dish.id),
      dish.id,
    );
    assert.ok(context.recipes.some(d => d.id === 'fried-rice'));
    assert.equal(context.recipeIndex.length, 30);
    assert.ok(context.recipes.length <= 6);
    assert.ok(JSON.stringify(context).length <= 10000);
  }
});

test('Bedrock request uses retrieved variant choices, tested with an offline SDK double', async () => {
  const requests = [];
  let state = createSeedState();
  const client = {
    async send(command) {
      requests.push(structuredClone(command.input));
      return requests.length === 1
        ? {
            stopReason: 'tool_use',
            output: {
              message: {
                role: 'assistant',
                content: [
                  {
                    toolUse: {
                      toolUseId: 't1',
                      name: 'plan_meal',
                      input: { dishId: 'tomato-soup', servings: 1, portions: [{ name: 'Asha', variant: 'pepper' }] },
                    },
                  },
                ],
              },
            },
          }
        : {
            stopReason: 'end_turn',
            output: {
              message: { role: 'assistant', content: [{ text: 'Tomato soup is planned with black pepper for Asha.' }] },
            },
          };
    },
  };
  const execute = async (name, input) => {
    const outcome = runKitchenTool(name, state, input);
    if (outcome.state) state = outcome.state;
    return outcome.result;
  };
  const result = await runBedrockAgent(
    'Cook tomato soup for 1 with black pepper',
    { context: { catalog }, tools: kitchenTools, execute },
    { client, region: 'us-east-1', modelId: 'amazon.nova-micro-v1:0' },
  );
  const context = JSON.parse(requests[0].system[0].text.split('Context: ')[1]);
  assert.ok(context.recipes.find(d => d.id === 'tomato-soup').variants.some(v => v.id === 'pepper'));
  assert.equal(state.session.dishId, 'tomato-soup');
  assert.equal(state.session.portions[0].variant, 'pepper');
  assert.equal(result.reply, 'Tomato soup is planned with black pepper for Asha.');
  assert.ok(!requests[0].system[0].text.includes('dishId is fried-rice, pasta, or wraps'));
});
