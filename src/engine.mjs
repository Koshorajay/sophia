import { catalog, recipeDefinitions, ingredientsFor, renderInstruction } from './data.mjs';

const clone = value => structuredClone(value);
const round = value => Number(value.toFixed(3));
const ingredientAliases = {
  eggs: 'egg',
  onions: 'onion',
  carrots: 'carrot',
  tomatoes: 'tomato',
  tortillas: 'tortilla',
  chili: 'chilli',
  'chili flakes': 'chilli',
  'chilli flakes': 'chilli',
  'dry rice': 'rice',
  'dry pasta': 'pasta',
  'cooking oil': 'oil',
  'soy sauce': 'soy-sauce',
  'cooked chickpeas': 'chickpeas',
};
const timestamp = state => new Date(Date.parse(state.clock || state.createdAt) + state.revision * 1000).toISOString();
function change(state) {
  const next = clone(state);
  next.revision += 1;
  // Revisions order writes; they must not move a confirmed meal into the future.
  // The application anchors clock + revision seconds to the request's real time.
  next.clock = new Date(Date.parse(state.clock || state.createdAt) - 1000).toISOString();
  return next;
}
function activity(state, type, message) {
  state.activity.push({
    id: `activity-${state.revision}-${state.activity.length}`,
    at: timestamp(state),
    type,
    message,
  });
}
function cooking(state) {
  if (!state.session || state.session.status !== 'cooking') throw new Error('Start a cooking session first.');
  return state.session;
}
function refreshPantryEstimate(state) {
  if (state.session?.status !== 'cooking') return;
  state.session.shortages = state.session.ingredients.flatMap(item => {
    const availableQuantity = state.pantry.find(stock => stock.id === item.id)?.quantity || 0;
    return availableQuantity < item.quantity
      ? [{ ...item, availableQuantity, missingQuantity: round(item.quantity - availableQuantity), estimated: true }]
      : [];
  });
  state.session.pantryEstimateNote =
    'Based on planned recipe amounts and entered pantry quantities. Confirm what is available before cooking.';
}
function instructionWithOmissions(dishId, step, recipe, omitted) {
  if (recipe.version === '2') return renderInstruction(step.instruction, recipe, omitted);
  if (!omitted.length) return step.instruction;
  const names = ids =>
    recipe.base
      .filter(item => ids.includes(item.id) && !omitted.includes(item.id))
      .map(item => item.name.toLowerCase())
      .join(', ');
  if (step.id === 'prepare')
    return `Prepare the shared ingredients: ${names(recipe.base.map(item => item.id))}. Wash and chop the vegetables as needed, measure the ingredients, and keep portion toppings aside.`;
  if (dishId === 'fried-rice' && step.id === 'base')
    return `Cook the remaining shared vegetables and seasonings (${names(step.adds) || 'none remaining'}), then combine with the cooked rice. Keep portion toppings separate.`;
  if (dishId === 'pasta' && step.id === 'base')
    return `Make the shared sauce using ${names(step.adds)}, then combine with the cooked pasta. Keep portion toppings separate.`;
  if (dishId === 'wraps' && step.id === 'starch')
    return `Cook the shared filling using ${names(step.adds)}. Heat the cooked chickpeas through. Keep portion toppings separate.`;
  return step.instruction;
}
/** The finish's display name ("Red chilli tadka"), for instructions that are read aloud. */
export function finishLabel(dishId, variant) {
  return catalog.find(dish => dish.id === dishId)?.variants.find(item => item.id === variant)?.label || variant;
}
function normalizedPortions(state, dishId, servings, portions) {
  const dish = catalog.find(item => item.id === dishId);
  if (!dish) throw new Error('Choose a dish from the curated recipe collection.');
  if (!Number.isInteger(servings) || servings < 1 || servings > 8)
    throw new Error('Choose between one and eight whole servings.');
  const chosen =
    portions ||
    Array.from({ length: servings }, (_, index) => {
      const person = state.household[index];
      return {
        name: person?.name || `Person ${index + 1}`,
        variant: dish.variants.some(item => item.id === person?.preference)
          ? person.preference
          : recipeDefinitions[dishId].defaultVariant,
      };
    });
  if (!Array.isArray(chosen) || chosen.length !== servings)
    throw new Error('Provide one named portion for each serving.');
  const names = new Set();
  return chosen.map(portion => {
    if (!portion || typeof portion !== 'object' || Array.isArray(portion) || typeof portion.name !== 'string')
      throw new Error('Each portion needs a name and a supported variation.');
    const name = portion.name.trim();
    if (!name || name.length > 60 || names.has(name.toLowerCase()))
      throw new Error('Each portion needs a different name of 1-60 characters.');
    names.add(name.toLowerCase());
    if (!dish.variants.some(item => item.id === portion.variant))
      throw new Error(`Choose a supported variation for ${name}.`);
    return { name, variant: portion.variant };
  });
}
function buildSession(state, { dishId, servings, portions }, original = null) {
  const selected = normalizedPortions(state, dishId, servings, portions);
  const recipe = recipeDefinitions[dishId];
  const omitted = original?.omittedIngredientIds || [];
  const ingredients = ingredientsFor(dishId, selected).filter(item => !omitted.includes(item.id));
  let previousId = null;
  const steps = recipe.sharedSteps.map(step => {
    const next = {
      ...clone(step),
      instruction: instructionWithOmissions(dishId, step, recipe, omitted),
      id: `shared-${step.id}`,
      phase: 'shared',
      status: 'pending',
      dependsOn: previousId ? [previousId] : [],
      adds: step.adds.filter(id => !omitted.includes(id)),
    };
    previousId = next.id;
    return next;
  });
  steps.push({
    id: 'split-portions',
    title: 'Split and confirm the named portions',
    instruction: `${recipe.splitInstruction || `Divide the shared base into ${servings} equal portion${servings === 1 ? '' : 's'}.`} Named portions: ${selected.map(portion => `${portion.name} (${finishLabel(dishId, portion.variant).toLowerCase()})`).join(', ')}. Keep the portions separate. Confirm only after you have actually divided them.`,
    durationMinutes: 1,
    phase: 'split',
    status: 'pending',
    dependsOn: [previousId],
    adds: [],
  });
  previousId = 'split-portions';
  selected.forEach((portion, index) => {
    const id = `finish-${index + 1}`;
    const extras = recipe.extras[portion.variant].filter(item => !omitted.includes(item.id));
    const amounts = extras.length
      ? `For ${portion.name} only: ${extras.map(item => `${item.quantity} ${item.unit} ${item.name.toLowerCase()}`).join(', ')}. `
      : '';
    steps.push({
      id,
      title: `Finish ${portion.name}'s plate: ${finishLabel(dishId, portion.variant).toLowerCase()}`,
      instruction: amounts + recipe.finish[portion.variant],
      durationMinutes: recipe.finishMinutes?.[portion.variant] ?? (portion.variant === 'egg' ? 5 : 2),
      phase: 'finish',
      portion: portion.name,
      status: 'pending',
      dependsOn: [previousId],
      adds: [...(recipe.finishAdds || []), ...extras.map(item => item.id)].filter(id => !omitted.includes(id)),
    });
    previousId = id;
  });
  if (original) {
    for (const step of steps) {
      const old = original.steps.find(item => item.id === step.id);
      if (old?.status === 'completed') step.status = 'completed';
    }
  }
  return {
    id: original?.id || `meal-${state.revision}`,
    dishId,
    title: catalog.find(item => item.id === dishId).name,
    servings,
    portions: selected,
    ingredients,
    steps,
    estimatedMinutes: steps.reduce((total, step) => total + step.durationMinutes, 0),
    timingNote:
      'Approximate sum of this sequential plan; package instructions, equipment, and actual cooking can change the time.',
    status: 'cooking',
    confirmedSplit: original?.confirmedSplit || false,
    omittedIngredientIds: [...omitted],
    createdAt: original?.createdAt || timestamp(state),
    recipeVersion: recipe.version || '1',
    recipeNote: recipe.note || '',
    source: 'simulation',
    notices: [
      'Sophia cannot see your kitchen. Confirm steps only after doing them.',
      'Dietary preferences do not establish allergy safety; allergy-sensitive cooking needs a separate plan and equipment from the start.',
      ...(recipe.note ? [recipe.note] : []),
    ],
  };
}

export function recordRequest(state, text) {
  const message = String(text || '').trim();
  if (!message || message.length > 4000) throw new Error('Enter a cooking request between 1 and 4,000 characters.');
  const next = change(state);
  next.requests.push({
    id: `request-${next.revision}`,
    text: message,
    status: 'asked',
    kind: 'request',
    at: timestamp(next),
  });
  activity(next, 'request', 'Saved a request. Requests alone do not count as cooked meals or ingredient usage.');
  if (/\ballerg(?:y|ies|ic)\b/i.test(message))
    activity(
      next,
      'guidance',
      'Allergy-sensitive meals need a separate plan and equipment from the start. Splitting a shared dish later does not remove cross-contact. Sophia cannot certify allergy safety.',
    );
  return next;
}

export function planMeal(state, { dishId, servings = 3, portions } = {}) {
  if (state.session?.status === 'cooking')
    throw new Error('Finish or cancel the current meal before starting another one.');
  const next = change(state);
  next.session = buildSession(next, { dishId, servings, portions });
  const requestId = `plan-${next.revision}`;
  next.requests.push({
    id: requestId,
    kind: 'plan',
    status: 'planned',
    sessionId: next.session.id,
    dishId,
    servings,
    portions: clone(next.session.portions),
    at: timestamp(next),
  });
  next.session.requestId = requestId;
  activity(
    next,
    'plan',
    `Planned ${next.session.title} for ${servings}. Ingredient use will be recorded only after the meal is confirmed cooked.`,
  );
  refreshPantryEstimate(next);
  if (next.session.shortages.length)
    activity(
      next,
      'pantry',
      `Estimated shortage from the entered pantry: ${next.session.shortages.map(item => item.name).join(', ')}. Confirm supplies before cooking or alter the meal.`,
    );
  return next;
}

export function completeStep(state, stepId) {
  const session = cooking(state);
  const step = session.steps.find(item => item.id === stepId);
  if (!step) throw new Error('That cooking step does not exist.');
  if (step.status === 'completed') return clone(state);
  const incomplete = step.dependsOn.filter(id => session.steps.find(item => item.id === id)?.status !== 'completed');
  if (incomplete.length)
    throw new Error(
      step.phase === 'finish' && !session.confirmedSplit
        ? 'Finish the shared steps, then confirm the portion split before adding separate toppings.'
        : 'Complete the previous cooking step first.',
    );
  const next = change(state);
  next.session.steps.find(item => item.id === stepId).status = 'completed';
  if (step.phase === 'split') next.session.confirmedSplit = true;
  activity(next, 'step', `Confirmed: ${step.title}.`);
  return next;
}

export function alterMeal(state, { omitIngredient, variant, portionName } = {}) {
  const session = cooking(state);
  if (!omitIngredient && !variant) throw new Error('Specify an ingredient to omit or a supported portion variation.');
  if (omitIngredient && variant) throw new Error('Make one alteration at a time.');
  const portions = clone(session.portions);
  const target = portionName
    ? portions.find(portion => portion.name.toLowerCase() === String(portionName).trim().toLowerCase())
    : null;
  if (portionName && !target) throw new Error('Choose a named portion from this meal.');
  const next = change(state);
  const original = clone(session);
  let description;
  if (omitIngredient) {
    const normalized = String(omitIngredient).toLowerCase().trim();
    const search = ingredientAliases[normalized] || normalized;
    const item = session.ingredients.find(
      ingredient => ingredient.id === search || ingredient.name.toLowerCase() === search,
    );
    if (!item) throw new Error('That ingredient is not in the current meal.');
    if (recipeDefinitions[session.dishId].requiredIngredients.includes(item.id))
      throw new Error(
        `${item.name} is essential to this curated dish. Choose another dish or start a separately planned recipe instead.`,
      );
    const alreadyAdded = session.steps.some(
      step =>
        step.status === 'completed' &&
        step.adds.includes(item.id) &&
        (!target || !step.portion || step.portion === target.name),
    );
    if (alreadyAdded)
      throw new Error(
        `${item.name} has already been added. Splitting or changing the instructions cannot remove it; prepare a separate portion instead.`,
      );
    const commonIngredient = recipeDefinitions[session.dishId].base.some(ingredient => ingredient.id === item.id);
    if (target && commonIngredient)
      throw new Error(
        `${item.name} belongs to the shared base. Omit it for the whole meal, or start a separately prepared portion before shared cooking.`,
      );
    if (target) {
      const definition = recipeDefinitions[session.dishId];
      const blocked = new Set([...session.omittedIngredientIds, item.id]);
      const replacement = [definition.defaultVariant, ...Object.keys(definition.extras)].find(id =>
        definition.extras[id].every(extra => !blocked.has(extra.id)),
      );
      if (!replacement) throw new Error(`No supported variation can omit ${item.name}. Choose another dish.`);
      const extras = recipeDefinitions[session.dishId].extras[target.variant];
      if (!extras.some(extra => extra.id === item.id))
        throw new Error(`${target.name}'s portion does not contain ${item.name}.`);
      if (session.steps.some(step => step.portion === target.name && step.status === 'completed'))
        throw new Error('That portion is already finished. Prepare a separate portion for a different version.');
      target.variant = replacement;
      description = `Changed ${target.name}'s portion to ${replacement} before adding ${item.name}.`;
    } else {
      original.omittedIngredientIds = [...new Set([...original.omittedIngredientIds, item.id])];
      for (const portion of portions) {
        const definition = recipeDefinitions[session.dishId];
        if (definition.extras[portion.variant].some(extra => extra.id === item.id)) {
          const replacement = [definition.defaultVariant, ...Object.keys(definition.extras)].find(id =>
            definition.extras[id].every(extra => !original.omittedIngredientIds.includes(extra.id)),
          );
          if (!replacement) throw new Error(`No supported variation can omit ${item.name}. Choose another dish.`);
          portion.variant = replacement;
        }
      }
      description = `Omitted ${item.name} from all unfinished preparation for this meal.`;
    }
  } else {
    if (!target) throw new Error('Name the portion you want to alter.');
    if (session.steps.some(step => step.portion === target.name && step.status === 'completed'))
      throw new Error('That portion is already finished. Prepare a separate portion for a different version.');
    if (!catalog.find(dish => dish.id === session.dishId).variants.some(item => item.id === variant))
      throw new Error('Choose a supported variation for this dish.');
    if (recipeDefinitions[session.dishId].extras[variant].some(item => session.omittedIngredientIds.includes(item.id)))
      throw new Error(
        'That variation requires an ingredient omitted from this meal. Choose another variation or start a new plan.',
      );
    target.variant = variant;
    description = `Changed ${target.name}'s unfinished portion to ${variant}.`;
  }
  next.session = {
    ...buildSession(next, { dishId: session.dishId, servings: session.servings, portions }, original),
    requestId: session.requestId,
  };
  refreshPantryEstimate(next);
  activity(next, 'alteration', description);
  return next;
}

export function finishMeal(state) {
  if (state.session?.status === 'completed') return clone(state);
  const session = cooking(state);
  if (session.steps.some(step => step.status !== 'completed'))
    throw new Error('Confirm every cooking step, including the portion split, before recording this meal as cooked.');
  const next = change(state);
  const at = timestamp(next);
  if (next.history.some(meal => meal.sessionId === session.id))
    throw new Error('This cooking session has already been recorded.');
  next.history.push({
    id: `cooked-${next.revision}`,
    sessionId: session.id,
    dishId: session.dishId,
    title: session.title,
    servings: session.servings,
    portions: clone(session.portions),
    ingredients: clone(session.ingredients),
    ingredientQuantities: 'recipe-estimate',
    note: 'Meal completion was confirmed by the user. Ingredient quantities are planned recipe amounts, not measured consumption.',
    cookedAt: at,
    confirmed: true,
    source: 'user',
    demo: false,
    recipeVersion: session.recipeVersion,
  });
  for (const item of session.ingredients) {
    const stock = next.pantry.find(ingredient => ingredient.id === item.id);
    if (stock) stock.quantity = round(Math.max(0, stock.quantity - item.quantity));
  }
  next.session.status = 'completed';
  next.session.completedAt = at;
  next.session.shortages = [];
  const plan = next.requests.find(request => request.id === session.requestId);
  if (plan) plan.status = 'cooked';
  activity(
    next,
    'cooked',
    `Recorded your confirmation that ${session.title} was cooked. Saved the planned recipe quantities and deducted estimated usage from entered pantry stock once.`,
  );
  return next;
}

/** Abandon the active meal without recording it as cooked or touching pantry stock. */
export function cancelMeal(state) {
  if (state.session?.status === 'completed')
    throw new Error('This meal is already confirmed cooked and recorded. There is no active meal to cancel.');
  if (state.session?.status !== 'cooking') throw new Error('There is no active meal to cancel.');
  const session = state.session;
  const next = change(state);
  next.session = null;
  const plan = next.requests.find(request => request.id === session.requestId);
  if (plan) Object.assign(plan, { status: 'cancelled', cancelledAt: timestamp(next) });
  const started = session.steps.some(step => step.status === 'completed');
  activity(
    next,
    'cancelled',
    `Cancelled ${session.title}. It was not recorded as cooked and pantry stock was not changed${started ? '; update the pantry yourself for anything already used' : ''}.`,
  );
  return next;
}

export function updatePantry(state, { id, quantity } = {}) {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0 || quantity > 100000)
    throw new Error('Enter a finite pantry quantity between 0 and 100,000.');
  const item = state.pantry.find(stock => stock.id === id);
  if (!item) throw new Error('Choose an existing pantry ingredient.');
  if (item.unit === 'item' && !Number.isInteger(quantity)) throw new Error('Count whole items for this ingredient.');
  const next = change(state);
  Object.assign(
    next.pantry.find(stock => stock.id === id),
    { quantity, confirmed: true, confirmedAt: timestamp(next), source: 'user' },
  );
  refreshPantryEstimate(next);
  activity(next, 'pantry', `Confirmed ${item.name}: ${quantity} ${item.unit}.`);
  return next;
}

function purchaseQuantity(quantity, unit) {
  const increment = unit === 'item' ? 1 : unit === 'ml' ? 10 : 5;
  return round(Math.ceil(Math.max(0, quantity) / increment) * increment);
}

export function forecastGroceries(state, { weeks = 4, awayDays = 0, confirmPantry = false } = {}) {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) throw new Error('Choose a forecast of one to twelve weeks.');
  if (!Number.isInteger(awayDays) || awayDays < 0 || awayDays > weeks * 7)
    throw new Error('Days away must fit inside the forecast period.');
  const now = Date.parse(timestamp(state));
  const cutoff = now - 28 * 86_400_000;
  const meals = state.history.filter(
    meal => meal.confirmed === true && Date.parse(meal.cookedAt) >= cutoff && Date.parse(meal.cookedAt) <= now,
  );
  const totals = new Map();
  for (const meal of meals)
    for (const item of meal.ingredients) {
      const existing = totals.get(item.id);
      if (existing && existing.unit !== item.unit)
        throw new Error(`Ingredient units conflict for ${item.name}; review cooked history before forecasting.`);
      const kind = item.kind || state.pantry.find(stock => stock.id === item.id)?.kind || 'fresh';
      totals.set(item.id, {
        ...item,
        kind,
        quantity: (existing?.quantity || 0) + item.quantity,
        mealCount: (existing?.mealCount || 0) + 1,
      });
    }
  const result = {
    historyCount: meals.length,
    demoHistoryCount: meals.filter(meal => meal.source === 'demo' || meal.demo).length,
    monthly: [],
    weekly: [],
    notes: [],
    windowDays: 28,
    weeks,
    awayDays,
    activeDays: weeks * 7 - awayDays,
    pantryApplied: false,
    generatedAt: timestamp(state),
  };
  for (const item of totals.values()) {
    const demand = (item.quantity * result.activeDays) / 28;
    const stock = state.pantry.find(ingredient => ingredient.id === item.id);
    const canUseStock = stock && (confirmPantry === true || stock.confirmed === true);
    const normalWeeklyDemand = demand / weeks;
    // Existing fresh stock cannot be assumed to remain usable for the entire forecast.
    const pantryUsed = canUseStock ? Math.min(stock.quantity, item.kind === 'fresh' ? normalWeeklyDemand : demand) : 0;
    if (pantryUsed > 0) result.pantryApplied = true;
    const net = Math.max(0, demand - pantryUsed);
    const quantity = purchaseQuantity(item.kind === 'fresh' ? normalWeeklyDemand : net, item.unit);
    const entry = {
      id: item.id,
      name: item.name,
      quantity,
      unit: item.unit,
      estimatedUsage: round(demand),
      pantryUsed: round(pantryUsed),
      reason: `Used in ${item.mealCount} of ${meals.length} confirmed cooked meals in the last 28 days${pantryUsed ? (item.kind === 'fresh' ? '; confirmed fresh pantry reduces the first week only' : '; confirmed pantry subtracted') : ''}.`,
      frequency: item.kind === 'fresh' ? 'per-week' : 'forecast-period',
    };
    if (item.kind === 'fresh')
      entry.firstWeekQuantity = purchaseQuantity(Math.max(0, normalWeeklyDemand - pantryUsed), item.unit);
    (item.kind === 'staple' ? result.monthly : result.weekly).push(entry);
  }
  result.monthly.sort((a, b) => a.name.localeCompare(b.name));
  result.weekly.sort((a, b) => a.name.localeCompare(b.name));
  result.notes.push(
    'Only confirmed cooked meals contribute. Requests and uncompleted plans are excluded. Quantities are estimates, not automatic orders.',
  );
  if (result.demoHistoryCount)
    result.notes.push(
      `${result.demoHistoryCount} meals are explicitly synthetic demonstration history. Clear demo history before treating these as personal recommendations.`,
    );
  result.notes.push(
    confirmPantry
      ? 'You confirmed the entered pantry for this forecast.'
      : 'Only pantry quantities individually confirmed by you are subtracted. Confirm the remaining pantry to avoid duplicate buying.',
  );
  result.notes.push(
    `Staples cover ${weeks} weeks. Fresh amounts show a normal week; the first week's shopping subtracts confirmed stock. Recheck freshness, plans, and stock before each later week.`,
  );
  if (awayDays) result.notes.push(`Reduced demand for ${awayDays} day${awayDays === 1 ? '' : 's'} away.`);
  if (!meals.length) result.notes.push('Confirm some cooked meals to generate a personal forecast.');
  return result;
}
