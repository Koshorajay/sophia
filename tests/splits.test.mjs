import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, recipeDefinitions, createSeedState } from '../src/data.mjs';
import { planMeal, completeStep, alterMeal, finishMeal } from '../src/engine.mjs';

function seed() {
  return {
    ...createSeedState({ now: '2026-10-15T10:00:00.000Z' }),
    history: [],
    requests: [],
    demo: { enabled: false },
  };
}
function completeUntil(state, predicate) {
  for (const step of state.session.steps) {
    if (predicate(step)) break;
    state = completeStep(state, step.id);
  }
  return state;
}
const family = [
  { name: 'Asha', variant: 'mild' },
  { name: 'Ravi', variant: 'spicy' },
  { name: 'Noor', variant: 'ghee' },
];

test('chilli never goes into a shared pot in any dish', () => {
  for (const dish of catalog) {
    const recipe = recipeDefinitions[dish.id];
    assert.ok(!recipe.base.some(item => item.id === 'chilli'), `${dish.id} has chilli in its shared base`);
    assert.ok(
      !recipe.sharedSteps.some(step => step.adds.includes('chilli')),
      `${dish.id} adds chilli in a shared step`,
    );
  }
});

test('dal tadka splits before the tadka, so only the spicy bowl gets chilli', () => {
  let state = planMeal(seed(), { dishId: 'dal-tadka', servings: 3, portions: family });
  const steps = state.session.steps;
  const split = steps.findIndex(step => step.phase === 'split');
  assert.ok(steps.slice(0, split).every(step => !step.adds.includes('cumin') && !step.adds.includes('chilli')));
  const finishes = Object.fromEntries(
    steps.filter(step => step.phase === 'finish').map(step => [step.portion, step.adds]),
  );
  assert.ok(finishes.Ravi.includes('chilli'));
  assert.ok(!finishes.Asha.includes('chilli') && !finishes.Noor.includes('chilli'));
  assert.equal(state.session.ingredients.find(item => item.id === 'chilli').quantity, 1);

  // After the shared dal is cooked, Ravi can still change his mind: his tadka has not happened.
  state = completeUntil(state, step => step.phase === 'split');
  state = alterMeal(state, { omitIngredient: 'chilli', portionName: 'Ravi' });
  assert.equal(state.session.portions.find(p => p.name === 'Ravi').variant, 'mild');
  assert.ok(!state.session.ingredients.some(item => item.id === 'chilli'));
});

test('palak paneer keeps paneer out of the shared sauce, so one plate can have corn', () => {
  let state = planMeal(seed(), {
    dishId: 'palak-paneer',
    servings: 3,
    portions: [
      { name: 'Asha', variant: 'mild' },
      { name: 'Ravi', variant: 'spicy' },
      { name: 'Noor', variant: 'mild' },
    ],
  });
  assert.ok(state.session.steps.filter(step => step.phase === 'shared').every(step => !step.adds.includes('paneer')));
  assert.equal(state.session.ingredients.find(item => item.id === 'paneer').quantity, 300);

  // The shared sauce is done and split; Noor's paneer has not been added yet.
  state = completeUntil(state, step => step.phase === 'finish');
  state = alterMeal(state, { omitIngredient: 'paneer', portionName: 'Noor' });
  assert.equal(state.session.portions.find(p => p.name === 'Noor').variant, 'corn');
  assert.equal(state.session.ingredients.find(item => item.id === 'paneer').quantity, 200);
  assert.equal(state.session.ingredients.find(item => item.id === 'sweet-corn').quantity, 70);

  for (const step of state.session.steps) state = completeStep(state, step.id);
  state = finishMeal(state);
  assert.equal(state.history.at(-1).ingredients.find(item => item.id === 'sweet-corn').quantity, 70);
});

test('a portion that is already finished cannot be changed', () => {
  let state = planMeal(seed(), { dishId: 'dal-tadka', servings: 3, portions: family });
  state = completeUntil(state, step => step.portion === 'Ravi');
  state = completeStep(state, state.session.steps.find(step => step.portion === 'Ravi').id);
  assert.throws(
    () => alterMeal(state, { omitIngredient: 'chilli', portionName: 'Ravi' }),
    /already been added|already finished/,
  );
});
