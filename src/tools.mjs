/** Kitchen tools shared by the MCP server and the Bedrock agent.
 * Each tool is a pure function of household state; the deterministic engine validates every write,
 * and callers own loading, locking and saving.
 */
import { catalog, matchRecipes, normalizeRecipeText } from './data.mjs';
import {
  planMeal,
  completeStep,
  alterMeal,
  finishMeal,
  cancelMeal,
  updatePantry,
  forecastGroceries,
  finishLabel,
} from './engine.mjs';

const text = (description, maxLength = 120) => ({ type: 'string', maxLength, description });
const noArguments = { type: 'object', properties: {}, additionalProperties: false };

export function nextInstruction(state) {
  const s = state.session;
  if (!s) return 'Choose a dish and the people eating, or say “Cook fried rice for 3, one spicy and one with egg”.';
  if (s.status === 'completed')
    return 'This meal is confirmed cooked and recorded once. You can plan your next meal or review next month’s grocery suggestions.';
  const step = s.steps.find(x => x.status !== 'completed');
  return step
    ? `${step.title}: ${step.instruction}`
    : 'All steps are confirmed. Select “Finish cooking” to save the meal and update pantry quantities.';
}

/** A compact, model-friendly view of the household. */
export function kitchenSummary(state, { includePantry = false } = {}) {
  const s = state.session;
  const dish = s && catalog.find(item => item.id === s.dishId);
  const finish = id => dish?.variants.find(v => v.id === id)?.label || id;
  const current = s?.status === 'cooking' ? s.steps.find(step => step.status !== 'completed') : null;
  return {
    household: state.household.map(({ name, preference }) => ({ name, preference })),
    meal: s
      ? {
          dishId: s.dishId,
          title: s.title,
          status: s.status,
          servings: s.servings,
          portions: s.portions.map(p => ({ name: p.name, variant: p.variant, finish: finish(p.variant) })),
          splitConfirmed: s.confirmedSplit,
          stepsConfirmed: `${s.steps.filter(step => step.status === 'completed').length} of ${s.steps.length}`,
          currentStep: current
            ? {
                id: current.id,
                title: current.title,
                instruction: current.instruction,
                phase: current.phase,
                ...(current.portion ? { portion: current.portion } : {}),
              }
            : null,
          remainingSteps: s.steps.filter(step => step.status !== 'completed').map(step => step.title),
          omittedIngredients: s.omittedIngredientIds,
          pantryShortages: (s.shortages || []).map(item => ({
            name: item.name,
            missing: item.missingQuantity,
            unit: item.unit,
          })),
          estimatedMinutes: s.estimatedMinutes,
        }
      : null,
    next: nextInstruction(state),
    confirmedCookedMeals: state.history.length,
    ...(includePantry
      ? {
          pantry: state.pantry.map(({ id, name, quantity, unit, confirmed }) => ({
            id,
            name,
            quantity,
            unit,
            confirmedByUser: confirmed === true,
          })),
        }
      : {}),
  };
}

function resolveDish(value) {
  const exact = catalog.find(dish => dish.id === value);
  if (exact) return exact;
  const matches = matchRecipes(value);
  if (matches.length === 1) return matches[0];
  throw new Error(
    matches.length
      ? `"${value}" matches ${matches.map(d => d.id).join(', ')}. Choose one dishId.`
      : `"${value}" is not in Sophia's recipe collection. Call search_recipes for valid dish ids.`,
  );
}

/** Accept a variant id or its label ("Extra chilli" -> spicy); the engine rejects anything else. */
export function resolveVariant(dish, value) {
  const wanted = normalizeRecipeText(value);
  return (
    dish.variants.find(v => normalizeRecipeText(v.id) === wanted || normalizeRecipeText(v.label) === wanted)?.id ||
    value
  );
}

function recipeCard(dish, detailed) {
  return {
    id: dish.id,
    name: dish.name,
    category: dish.category,
    defaultVariant: dish.defaultVariant,
    variants: dish.variants.map(({ id, label }) => ({ id, label })),
    ...(detailed ? { description: dish.description, aliases: dish.aliases || [], ingredients: dish.ingredients } : {}),
  };
}

function searchRecipes(query, limit) {
  if (!query) return catalog.slice(0, limit);
  const words = new Set(
    normalizeRecipeText(query)
      .split(' ')
      .filter(word => word.length > 2),
  );
  const ranked = catalog
    .map((dish, index) => {
      const terms = new Set(
        normalizeRecipeText(
          [dish.name, dish.category, ...(dish.aliases || []), ...(dish.ingredients || [])].join(' '),
        ).split(' '),
      );
      return { dish, index, score: [...words].filter(word => terms.has(word)).length };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.dish);
  return [...new Map([...matchRecipes(query), ...ranked].map(dish => [dish.id, dish])).values()].slice(0, limit);
}

function resolvePantryItem(state, value) {
  const wanted = normalizeRecipeText(value);
  const item =
    state.pantry.find(
      stock => normalizeRecipeText(stock.id) === wanted || normalizeRecipeText(stock.name) === wanted,
    ) || state.pantry.find(stock => normalizeRecipeText(stock.name).replace(/s$/, '') === wanted.replace(/s$/, ''));
  if (!item)
    throw new Error(`"${value}" is not a pantry ingredient. Call get_kitchen_state with includePantry for valid ids.`);
  return item;
}

const changed = (next, message, extra = {}) => ({
  state: next,
  result: { message, ...extra, kitchen: kitchenSummary(next) },
});

const definitions = [
  {
    name: 'search_recipes',
    title: 'Search recipes',
    description:
      'Search Sophia\'s curated recipe collection by dish name, alias, category or ingredient (for example "dal", "paneer" or "rice"). Returns dish ids and each dish\'s supported per-person finishes (variants), which plan_meal and alter_portion need. Omit query to list every dish. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: text('Dish name, alias, category or ingredient. Omit to list all dishes.', 200),
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Maximum dishes to return. Default 6 for a query, 50 for the full list.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run(state, { query = '', limit }) {
      const recipes = searchRecipes(query.trim(), limit ?? (query.trim() ? 6 : 50));
      return {
        result: {
          count: recipes.length,
          recipes: recipes.map(dish => recipeCard(dish, Boolean(query.trim()))),
          ...(recipes.length
            ? {}
            : { message: 'No dish matched. Call search_recipes without a query to list every dish.' }),
        },
      };
    },
  },
  {
    name: 'get_kitchen_state',
    title: 'Get kitchen state',
    description:
      'Read the household kitchen: the people eating and their saved finish preferences, the active meal with its current step and remaining steps, each named portion and its finish, estimated pantry shortages, and how many meals are confirmed cooked. Call this first, and whenever you are unsure what step the cook is on. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        includePantry: {
          type: 'boolean',
          description: 'Also return every pantry ingredient with its quantity and unit. Default false.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run(state, { includePantry = false }) {
      return { result: kitchenSummary(state, { includePantry }) };
    },
  },
  {
    name: 'plan_meal',
    title: 'Plan a meal',
    description:
      "Start cooking one dish for the household. Sophia orders the shared preparation steps, then a mandatory split checkpoint, then one finish step per named portion. Omit portions to use each household member's saved preference (or the dish default when the dish has no such finish). Fails while another meal is in progress: finish it, or call cancel_meal only if the user asks. Nothing is recorded as cooked until finish_meal.",
    inputSchema: {
      type: 'object',
      required: ['dishId'],
      properties: {
        dishId: text('Dish id from search_recipes, such as "dal-tadka". An exact dish name is also accepted.', 80),
        servings: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: 'Number of people. Defaults to the number of portions given, otherwise the household size.',
        },
        portions: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          description: 'Optional full list with one entry per person; its length must equal servings.',
          items: {
            type: 'object',
            required: ['name', 'variant'],
            additionalProperties: false,
            properties: {
              name: text("Person's name, unique within the meal.", 60),
              variant: text('Finish for this person: a variant id or label from search_recipes, such as "spicy".', 80),
            },
          },
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run(state, { dishId, servings, portions }) {
      const dish = resolveDish(dishId);
      const named = portions?.map(p => ({ name: p.name, variant: resolveVariant(dish, p.variant) }));
      const count = servings ?? named?.length ?? Math.max(1, Math.min(8, state.household.length));
      const next = planMeal(state, { dishId: dish.id, servings: count, portions: named });
      return changed(
        next,
        `${next.session.title} is planned for ${count}: ${next.session.portions.map(p => `${p.name} (${finishLabel(next.session.dishId, p.variant).toLowerCase()})`).join(', ')}. Shared preparation comes first; the split must be confirmed before any personal finish.`,
      );
    },
  },
  {
    name: 'complete_current_step',
    title: 'Confirm current step',
    description:
      'Mark the current cooking step of the active meal as done and return the next step. Call only after the user says they actually finished the step; Sophia cannot see the kitchen. Steps run in order, and the split step must be confirmed before any personal finish.',
    inputSchema: {
      type: 'object',
      properties: {
        stepId: text(
          'Optional safety check: the id of the step the user is confirming. If it is not the current step, nothing changes.',
          60,
        ),
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run(state, { stepId }) {
      const s = state.session;
      if (s?.status === 'completed')
        throw new Error('This meal is already recorded as cooked. Plan a new meal to continue.');
      if (s?.status !== 'cooking') throw new Error('There is no active meal. Call plan_meal first.');
      const current = s.steps.find(step => step.status !== 'completed');
      if (!current)
        throw new Error('Every step is already confirmed. Call finish_meal once the user confirms the meal is cooked.');
      if (stepId && stepId !== current.id)
        throw new Error(`The current step is "${current.title}" (${current.id}), not ${stepId}. Nothing was changed.`);
      const next = completeStep(state, current.id);
      return changed(next, `Confirmed: ${current.title}.`, { completedStep: { id: current.id, title: current.title } });
    },
  },
  {
    name: 'alter_portion',
    title: 'Alter a portion',
    description:
      'Change the unfinished part of the active meal, one change per call. Either switch one named portion to another supported finish (portionName + variant), or omit an ingredient (omitIngredient) from one named portion or, without portionName, from the whole meal. Sophia refuses to remove an ingredient that a confirmed step already added, and refuses to change a portion that is already finished.',
    inputSchema: {
      type: 'object',
      properties: {
        portionName: text('Name of the portion to change, as shown in get_kitchen_state.', 60),
        variant: text('New finish for that portion: a variant id or label for the current dish.', 80),
        omitIngredient: text('Ingredient to leave out, such as "cheese" or "chilli".', 80),
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run(state, { portionName, variant, omitIngredient }) {
      const dish = state.session && catalog.find(item => item.id === state.session.dishId);
      const next = alterMeal(state, {
        portionName,
        omitIngredient,
        variant: variant && dish ? resolveVariant(dish, variant) : variant,
      });
      return changed(next, next.activity.at(-1).message);
    },
  },
  {
    name: 'finish_meal',
    title: 'Finish the meal',
    description:
      'Record the active meal as cooked after every step, including the split, is confirmed. Saves the planned ingredient amounts to cooking history (the basis for grocery forecasts) and deducts them from pantry stock exactly once; repeating the call changes nothing. Call only when the user confirms the meal is cooked.',
    inputSchema: noArguments,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run(state) {
      if (state.session?.status === 'completed')
        return {
          result: {
            message: 'This meal was already recorded as cooked; nothing changed.',
            kitchen: kitchenSummary(state),
          },
        };
      return changed(
        finishMeal(state),
        'Meal recorded as cooked. Ingredient amounts were saved to history and deducted from estimated pantry stock once.',
      );
    },
  },
  {
    name: 'cancel_meal',
    title: 'Cancel the meal',
    description:
      'Abandon the active meal. Nothing is recorded as cooked, cooking history is unchanged and pantry stock is not deducted. Step progress is lost. Call only when the user explicitly asks to cancel, abandon or stop this meal.',
    inputSchema: noArguments,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run(state) {
      const next = cancelMeal(state);
      return changed(next, next.activity.at(-1).message);
    },
  },
  {
    name: 'update_pantry',
    title: 'Update pantry',
    description:
      "Set how much of one or more ingredients the household has, as confirmed by the user. Quantities are absolute amounts in the ingredient's own unit (g, ml or item), not additions. Confirmed amounts are subtracted in grocery forecasts.",
    inputSchema: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            required: ['ingredient', 'quantity'],
            additionalProperties: false,
            properties: {
              ingredient: text('Ingredient id or name, such as "rice" or "Dry rice".', 80),
              quantity: {
                type: 'number',
                minimum: 0,
                maximum: 100000,
                description: "Amount on hand in the ingredient's unit; whole numbers for items.",
              },
            },
          },
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run(state, { items }) {
      let next = state;
      for (const { ingredient, quantity } of items)
        next = updatePantry(next, { id: resolvePantryItem(next, ingredient).id, quantity });
      const updated = items.map(({ ingredient }) => {
        const { id, name, quantity, unit } = resolvePantryItem(next, ingredient);
        return { id, name, quantity, unit };
      });
      return changed(
        next,
        `Updated ${updated.map(item => `${item.name} to ${item.quantity} ${item.unit}`).join(', ')}.`,
        { updated },
      );
    },
  },
  {
    name: 'forecast_groceries',
    title: 'Forecast groceries',
    description:
      'Estimate groceries for the coming weeks from meals confirmed cooked in the last 28 days; requests and unfinished plans never count. Staples cover the whole period and fresh items are listed per week. Read-only: nothing is ordered or saved.',
    inputSchema: {
      type: 'object',
      properties: {
        weeks: { type: 'integer', minimum: 1, maximum: 12, description: 'Forecast length in weeks. Default 4.' },
        awayDays: {
          type: 'integer',
          minimum: 0,
          maximum: 84,
          description: 'Days nobody will cook at home during the period. Default 0.',
        },
        confirmPantry: {
          type: 'boolean',
          description:
            'True only if the user confirmed every entered pantry amount is accurate, so all of it can be subtracted. Default false.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run(state, { weeks = 4, awayDays = 0, confirmPantry = false }) {
      const forecast = forecastGroceries(state, { weeks, awayDays, confirmPantry });
      return {
        forecast,
        result: {
          message: `Based on ${forecast.historyCount} confirmed cooked meals. Staples cover ${weeks} weeks; fresh items are per week. Nothing was ordered.`,
          forecast,
        },
      };
    },
  },
];

/** Tool metadata without implementations: MCP tools/list and Bedrock toolConfig both use this. */
export const kitchenTools = definitions.map(({ run, ...definition }) => definition);
const byName = new Map(definitions.map(definition => [definition.name, definition]));
export const hasKitchenTool = name => byName.has(name);

function validate(schema, value, path) {
  const fail = message => {
    throw new Error(`${path} ${message}`);
  };
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('must be an object.');
    for (const key of schema.required || []) if (value[key] === undefined) fail(`needs "${key}".`);
    for (const [key, item] of Object.entries(value)) {
      if (!schema.properties[key]) fail(`has unsupported field "${key}".`);
      validate(schema.properties[key], item, `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('must be an array.');
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity))
      fail(`must have ${schema.minItems ?? 0}-${schema.maxItems} entries.`);
    value.forEach((item, index) => validate(schema.items, item, `${path}[${index}]`));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || !value.trim() || value.length > schema.maxLength)
      fail(`must be text of 1-${schema.maxLength} characters.`);
  } else if (schema.type === 'integer' || schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)))
      fail(`must be ${schema.type === 'integer' ? 'a whole number' : 'a number'}.`);
    if (value < schema.minimum || value > schema.maximum) fail(`must be from ${schema.minimum} to ${schema.maximum}.`);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') fail('must be true or false.');
}
// Models often send null for an omitted optional argument.
const withoutNulls = value =>
  Array.isArray(value)
    ? value.map(withoutNulls)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => item !== null)
            .map(([key, item]) => [key, withoutNulls(item)]),
        )
      : value;

/** Run one tool against a household state. Returns { result, state? (when it changed), forecast? }. Throws on invalid input or a refused change. */
export function runKitchenTool(name, state, args = {}) {
  const tool = byName.get(name);
  if (!tool) throw new Error(`Unknown tool "${name}".`);
  const input = withoutNulls(args ?? {});
  validate(tool.inputSchema, input, 'arguments');
  return tool.run(state, input);
}
