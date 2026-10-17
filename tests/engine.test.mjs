import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState, ingredientsFor } from '../src/data.mjs';
import {
  recordRequest,
  planMeal,
  completeStep,
  finishMeal,
  alterMeal,
  cancelMeal,
  updatePantry,
  forecastGroceries,
} from '../src/engine.mjs';

const seed = () => createSeedState({ now: '2026-10-14T10:00:00.000Z' });
const plan = (state = seed()) => planMeal(state, { dishId: 'fried-rice', servings: 3 });
function completeAll(state) {
  for (const step of state.session.steps) state = completeStep(state, step.id);
  return state;
}

test('seed history and pantry clearly identify synthetic data', () => {
  const state = seed();
  assert.equal(state.history.length, 10);
  assert.ok(state.history.every(item => item.confirmed && item.demo && item.source === 'demo'));
  assert.ok(state.pantry.every(item => item.confirmed === false));
  assert.match(state.demo.label, /synthetic/);
});

test('planning preserves input and does not record consumption', () => {
  const original = seed();
  const before = structuredClone(original);
  const state = plan(original);
  assert.deepEqual(original, before);
  assert.equal(state.history.length, before.history.length);
  assert.deepEqual(state.pantry, before.pantry);
  assert.equal(state.session.portions.length, 3);
  assert.equal(state.session.ingredients.find(item => item.id === 'rice').quantity, 225);
  assert.equal(state.requests.at(-1).status, 'planned');
});

test('named split checkpoint and ordered step dependencies cannot be skipped', () => {
  let state = plan();
  assert.throws(() => completeStep(state, 'finish-1'), /confirm the portion split/);
  assert.throws(() => completeStep(state, 'split-portions'), /previous cooking step/);
  for (const step of state.session.steps.filter(item => item.phase === 'shared')) state = completeStep(state, step.id);
  assert.throws(() => completeStep(state, 'finish-1'), /confirm the portion split/);
  state = completeStep(state, 'split-portions');
  assert.equal(state.session.confirmedSplit, true);
  assert.throws(() => completeStep(state, 'finish-2'), /previous cooking step/);
  state = completeStep(state, 'finish-1');
  assert.equal(state.session.steps.find(item => item.id === 'finish-1').status, 'completed');
});

test('completed steps and cooked confirmation are idempotent; pantry deducts once', () => {
  let state = plan();
  state = completeStep(state, 'shared-prepare');
  assert.deepEqual(completeStep(state, 'shared-prepare'), state);
  state = completeAll(state);
  const originalRice = state.pantry.find(item => item.id === 'rice').quantity;
  const finished = finishMeal(state);
  assert.equal(finished.history.length, 11);
  assert.equal(finished.pantry.find(item => item.id === 'rice').quantity, originalRice - 225);
  assert.equal(finished.history.at(-1).confirmed, true);
  assert.equal(finished.history.at(-1).source, 'user');
  assert.deepEqual(finishMeal(finished), finished);
  assert.equal(state.session.status, 'cooking');
});

test('cannot finish an incomplete meal or start a second active session', () => {
  const state = plan();
  assert.throws(() => finishMeal(state), /Confirm every cooking step/);
  assert.throws(() => planMeal(state, { dishId: 'pasta' }), /Finish or cancel/);
});

test('switch a pending cheese portion to no-cheese and preserve shared progress', () => {
  let state = planMeal(seed(), {
    dishId: 'pasta',
    servings: 2,
    portions: [
      { name: 'Asha', variant: 'cheese' },
      { name: 'Ravi', variant: 'cheese' },
    ],
  });
  for (const step of state.session.steps.filter(item => item.phase === 'shared')) state = completeStep(state, step.id);
  state = completeStep(state, 'split-portions');
  const altered = alterMeal(state, { omitIngredient: 'cheese', portionName: 'Asha' });
  assert.equal(altered.session.portions[0].variant, 'without-cheese');
  assert.equal(altered.session.ingredients.find(item => item.id === 'cheese').quantity, 20);
  assert.ok(altered.session.confirmedSplit);
  assert.equal(altered.session.steps.find(item => item.id === 'shared-base').status, 'completed');
  assert.equal(state.session.portions[0].variant, 'cheese');
});

test('reject removal once the ingredient was added, but do not confuse another portion', () => {
  let state = planMeal(seed(), {
    dishId: 'pasta',
    servings: 2,
    portions: [
      { name: 'Asha', variant: 'cheese' },
      { name: 'Ravi', variant: 'cheese' },
    ],
  });
  for (const id of ['shared-prepare', 'shared-starch', 'shared-base', 'split-portions', 'finish-1'])
    state = completeStep(state, id);
  assert.throws(() => alterMeal(state, { omitIngredient: 'cheese', portionName: 'Asha' }), /already been added/);
  assert.throws(() => alterMeal(state, { variant: 'without-cheese', portionName: 'Asha' }), /already finished/);
  assert.equal(
    alterMeal(state, { omitIngredient: 'cheese', portionName: 'Ravi' }).session.portions[1].variant,
    'without-cheese',
  );
});

test('omit missing shared ingredient before adding, reject late or portion-only omission', () => {
  let state = planMeal(seed(), { dishId: 'pasta', servings: 1 });
  assert.throws(() => alterMeal(state, { omitIngredient: 'onion', portionName: 'Asha' }), /shared base/);
  state = alterMeal(state, { omitIngredient: 'onion' });
  assert.ok(!state.session.ingredients.some(item => item.id === 'onion'));
  assert.ok(!state.session.steps.find(item => item.id === 'shared-base').adds.includes('onion'));
  assert.doesNotMatch(state.session.steps.find(item => item.id === 'shared-base').instruction, /onion/i);
  assert.doesNotMatch(state.session.steps.find(item => item.id === 'shared-prepare').instruction, /onion/i);
  let other = planMeal(seed(), { dishId: 'pasta', servings: 1 });
  for (const step of other.session.steps.filter(item => item.phase === 'shared')) other = completeStep(other, step.id);
  assert.throws(() => alterMeal(other, { omitIngredient: 'onion' }), /already been added/);
});

test('forecast ignores requests and planned meals and snapshots finished quantities', () => {
  const initial = seed();
  const forecast = forecastGroceries(initial);
  let state = recordRequest(initial, 'I might make pasta twenty times next month.');
  state = plan(state);
  assert.equal(forecastGroceries(state).historyCount, forecast.historyCount);
  assert.deepEqual(forecastGroceries(state).monthly, forecast.monthly);
  state = finishMeal(completeAll(state));
  assert.equal(forecastGroceries(state).historyCount, 11);
  assert.equal(state.history.at(-1).ingredients.find(item => item.id === 'rice').quantity, 225);
  state.session.ingredients[0].quantity = 999;
  assert.equal(state.history.at(-1).ingredients.find(item => item.id === 'rice').quantity, 225);
});

test('forecast separates period staples and weekly fresh food and subtracts only confirmed pantry', () => {
  const state = seed();
  const unconfirmed = forecastGroceries(state);
  const confirmed = forecastGroceries(state, { confirmPantry: true });
  assert.equal(unconfirmed.historyCount, 10);
  assert.equal(unconfirmed.pantryApplied, false);
  assert.ok(unconfirmed.monthly.every(item => item.frequency === 'forecast-period'));
  assert.ok(unconfirmed.weekly.every(item => item.frequency === 'per-week'));
  assert.equal(confirmed.monthly.find(item => item.id === 'rice').quantity, 0);
  assert.equal(confirmed.pantryApplied, true);
  const individual = forecastGroceries(updatePantry(state, { id: 'rice', quantity: 300 }));
  assert.equal(individual.monthly.find(item => item.id === 'rice').quantity, 600);
  assert.equal(individual.monthly.find(item => item.id === 'oil').pantryUsed, 0);
});

test('forecast with no history or all days away makes no purchases', () => {
  const state = seed();
  state.history = [];
  const empty = forecastGroceries(state);
  assert.equal(empty.historyCount, 0);
  assert.deepEqual(empty.monthly, []);
  assert.match(empty.notes.join(' '), /Confirm some cooked meals/);
  const away = forecastGroceries(seed(), { awayDays: 28 });
  assert.ok([...away.monthly, ...away.weekly].every(item => item.quantity === 0));
});

test('forecast ignores old, future, and unconfirmed records without mutating history', () => {
  const state = seed();
  const meal = structuredClone(state.history[0]);
  state.history.push({ ...meal, id: 'old', cookedAt: '2026-08-01T10:00:00.000Z' });
  state.history.push({ ...meal, id: 'future', cookedAt: '2026-11-01T10:00:00.000Z' });
  state.history.push({ ...meal, id: 'not-confirmed', confirmed: false });
  const before = structuredClone(state);
  assert.equal(forecastGroceries(state).historyCount, 10);
  assert.deepEqual(state, before);
});

test('forecast rejects incompatible units instead of silently combining quantities', () => {
  const state = seed();
  state.history[0].ingredients.find(item => item.id === 'rice').unit = 'cup';
  assert.throws(() => forecastGroceries(state), /units conflict/);
});

test('invalid inputs cannot poison quantities, portions, or forecasts', () => {
  assert.throws(() => planMeal(seed(), { dishId: 'unknown' }), /curated/);
  assert.throws(() => planMeal(seed(), { dishId: 'pasta', servings: -1 }), /one and eight/);
  assert.throws(
    () => planMeal(seed(), { dishId: 'pasta', servings: 2, portions: [{ name: 'A', variant: 'cheese' }] }),
    /one named portion/,
  );
  assert.throws(
    () =>
      planMeal(seed(), {
        dishId: 'pasta',
        servings: 2,
        portions: [
          { name: 'A', variant: 'cheese' },
          { name: 'a', variant: 'cheese' },
        ],
      }),
    /different/,
  );
  assert.throws(() => updatePantry(seed(), { id: 'rice', quantity: NaN }), /finite/);
  assert.throws(() => updatePantry(seed(), { id: 'egg', quantity: 1.5 }), /whole items/);
  assert.throws(() => forecastGroceries(seed(), { weeks: 0 }), /one to twelve/);
  assert.throws(() => forecastGroceries(seed(), { awayDays: 29 }), /fit inside/);
});

test('allergy request records a separate preparation caveat, never a safety assurance', () => {
  const state = recordRequest(seed(), 'My child has an egg allergy.');
  assert.match(state.activity.at(-1).message, /separate plan and equipment from the start/);
  assert.match(state.activity.at(-1).message, /cannot certify allergy safety/);
  assert.equal(state.history.length, 10);
});

test('recipe ingredient snapshot scales each distinct portion exactly once', () => {
  const ingredients = ingredientsFor('fried-rice', [
    { name: 'A', variant: 'mild' },
    { name: 'B', variant: 'egg' },
    { name: 'C', variant: 'egg' },
  ]);
  assert.equal(ingredients.find(item => item.id === 'rice').quantity, 225);
  assert.equal(ingredients.find(item => item.id === 'egg').quantity, 2);
  assert.ok(!ingredients.some(item => item.id === 'chilli'));
});

test('global topping omission updates variants and removes positive add instructions', () => {
  let state = planMeal(seed(), {
    dishId: 'pasta',
    servings: 2,
    portions: [
      { name: 'A', variant: 'cheese' },
      { name: 'B', variant: 'spicy' },
    ],
  });
  state = alterMeal(state, { omitIngredient: 'cheese' });
  assert.equal(state.session.portions[0].variant, 'without-cheese');
  assert.ok(!state.session.ingredients.some(item => item.id === 'cheese'));
  assert.doesNotMatch(state.session.steps.find(item => item.id === 'finish-1').instruction, /^Add.*cheese/i);
  assert.throws(() => alterMeal(state, { variant: 'cheese', portionName: 'A' }), /ingredient omitted/);
  state = alterMeal(state, { omitIngredient: 'chili' });
  assert.equal(state.session.portions[1].variant, 'without-cheese');
  assert.ok(!state.session.steps.some(step => step.adds.includes('chilli')));
});

test('ingredient aliases work, while essential base ingredients cannot be removed', () => {
  const pasta = planMeal(seed(), { dishId: 'pasta', servings: 1 });
  assert.ok(!alterMeal(pasta, { omitIngredient: 'onions' }).session.ingredients.some(item => item.id === 'onion'));
  assert.throws(() => alterMeal(pasta, { omitIngredient: 'dry pasta' }), /essential/);
  assert.throws(() => alterMeal(plan(), { omitIngredient: 'rice' }), /essential/);
  assert.throws(
    () => alterMeal(planMeal(seed(), { dishId: 'wraps', servings: 1 }), { omitIngredient: 'tortillas' }),
    /essential/,
  );
  const egg = planMeal(seed(), { dishId: 'fried-rice', servings: 1, portions: [{ name: 'A', variant: 'egg' }] });
  assert.equal(alterMeal(egg, { omitIngredient: 'eggs' }).session.portions[0].variant, 'mild');
});

test('session estimate sums actual ordered steps and changes with portion finishes', () => {
  const state = plan();
  assert.equal(
    state.session.estimatedMinutes,
    state.session.steps.reduce((sum, step) => sum + step.durationMinutes, 0),
  );
  assert.equal(state.session.estimatedMinutes, 32);
  const altered = alterMeal(state, { variant: 'mild', portionName: 'Noor' });
  assert.equal(altered.session.estimatedMinutes, 29);
  assert.match(altered.session.timingNote, /Approximate/);
});

test('fresh stock reduces only first-week shopping, never later normal weekly demand', () => {
  const initial = seed();
  const forecast = forecastGroceries(initial);
  const state = updatePantry(initial, { id: 'carrot', quantity: 9999 });
  const confirmed = forecastGroceries(state);
  const before = forecast.weekly.find(item => item.id === 'carrot');
  const after = confirmed.weekly.find(item => item.id === 'carrot');
  assert.equal(after.quantity, before.quantity);
  assert.equal(after.firstWeekQuantity, 0);
  assert.equal(after.pantryUsed, after.estimatedUsage / 4);
  assert.ok(after.pantryUsed < 9999);
  assert.match(after.reason, /first week only/);
  assert.match(confirmed.notes.join(' '), /before each later week/);
  assert.equal(initial.pantry.find(item => item.id === 'carrot').quantity, 350);
});

test('pantry edits refresh estimated shortages for the active meal without inventing consumption', () => {
  let state = updatePantry(seed(), { id: 'rice', quantity: 0 });
  state = plan(state);
  const shortage = state.session.shortages.find(item => item.id === 'rice');
  assert.equal(shortage.missingQuantity, 225);
  assert.equal(shortage.availableQuantity, 0);
  assert.equal(shortage.estimated, true);
  const original = state;
  state = updatePantry(state, { id: 'rice', quantity: 300 });
  assert.ok(!state.session.shortages.some(item => item.id === 'rice'));
  assert.equal(original.session.shortages.find(item => item.id === 'rice').missingQuantity, 225);
  assert.equal(state.pantry.find(item => item.id === 'rice').quantity, 300);
  state = updatePantry(state, { id: 'rice', quantity: 100 });
  assert.equal(state.session.shortages.find(item => item.id === 'rice').missingQuantity, 125);
  assert.match(state.session.pantryEstimateNote, /planned recipe amounts/);
});

test('alterations recalculate shortages and finished history labels quantities as estimates', () => {
  let state = updatePantry(seed(), { id: 'cheese', quantity: 0 });
  state = planMeal(state, { dishId: 'pasta', servings: 1, portions: [{ name: 'Asha', variant: 'cheese' }] });
  assert.ok(state.session.shortages.some(item => item.id === 'cheese'));
  state = alterMeal(state, { omitIngredient: 'cheese', portionName: 'Asha' });
  assert.ok(!state.session.shortages.some(item => item.id === 'cheese'));
  state = finishMeal(completeAll(state));
  assert.equal(state.history.at(-1).ingredientQuantities, 'recipe-estimate');
  assert.match(state.history.at(-1).note, /not measured consumption/);
  assert.match(state.activity.at(-1).message, /estimated usage/);
  assert.deepEqual(state.session.shortages, []);
});

test('confirmed meals are not timestamped in the future and enter an immediate forecast', () => {
  const currentTime = '2026-10-15T10:00:00.000Z';
  let state = completeAll(plan());
  state.clock = new Date(Date.parse(currentTime) - state.revision * 1000).toISOString();
  state = finishMeal(state);
  assert.equal(state.history.at(-1).cookedAt, currentTime);
  state.clock = new Date(Date.parse(currentTime) - state.revision * 1000).toISOString();
  const forecast = forecastGroceries(state);
  assert.equal(forecast.historyCount, 11);
  assert.equal(forecast.generatedAt, currentTime);
});

test('malformed portions and inherited object names return recipe validation errors', () => {
  assert.throws(() => planMeal(seed(), { dishId: 'pasta', servings: 1, portions: [null] }), /Each portion needs/);
  assert.throws(
    () => planMeal(seed(), { dishId: 'pasta', servings: 1, portions: [{ name: 42, variant: 'cheese' }] }),
    /Each portion needs/,
  );
  assert.throws(() => ingredientsFor('pasta', [{ name: 'A', variant: 'constructor' }]), /supported recipe variation/);
});

test('cancelling an active meal records nothing, keeps pantry and history, and allows a new plan', () => {
  assert.throws(() => cancelMeal(seed()), /no active meal/);
  let state = completeStep(plan(), 'shared-prepare');
  const before = structuredClone(state);
  const cancelled = cancelMeal(state);
  assert.deepEqual(state, before);
  assert.equal(cancelled.session, null);
  assert.equal(cancelled.revision, state.revision + 1);
  assert.deepEqual(cancelled.pantry, state.pantry);
  assert.deepEqual(cancelled.history, state.history);
  assert.equal(cancelled.requests.find(item => item.id === state.session.requestId).status, 'cancelled');
  assert.match(cancelled.activity.at(-1).message, /not recorded as cooked.*anything already used/);
  assert.equal(planMeal(cancelled, { dishId: 'pasta', servings: 1 }).session.dishId, 'pasta');
  const cooked = finishMeal(completeAll(plan()));
  assert.throws(() => cancelMeal(cooked), /already confirmed cooked/);
});
