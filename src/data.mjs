/** Curated recipes for Sophia's software cooking simulation. */
import { additionalRecipes } from './recipes.mjs';
export const catalog = [
  {
    id: 'fried-rice',
    name: 'Shared-base fried rice',
    description: 'Share the rice and vegetable preparation, then finish mild, spicy, or egg portions.',
    timeMinutes: 25,
    tags: ['Shared preparation', 'Three variations'],
    variants: [
      { id: 'mild', label: 'Mild vegetables' },
      { id: 'spicy', label: 'Spicy vegetables' },
      { id: 'egg', label: 'Egg topping' },
    ],
  },
  {
    id: 'pasta',
    name: 'Tomato pasta',
    description: 'One tomato base with separate cheese, no-cheese, or spicy finishes.',
    timeMinutes: 25,
    tags: ['Flexible finish', 'One shared sauce'],
    variants: [
      { id: 'cheese', label: 'With cheese' },
      { id: 'without-cheese', label: 'Without cheese' },
      { id: 'spicy', label: 'Spicy, without cheese' },
    ],
  },
  {
    id: 'wraps',
    name: 'Chickpea vegetable wraps',
    description: 'Prepare one chickpea filling and personalize the wraps after dividing it.',
    timeMinutes: 20,
    tags: ['Quick dinner', 'Personalized plates'],
    variants: [
      { id: 'mild', label: 'Mild' },
      { id: 'spicy', label: 'Spicy' },
      { id: 'cheese', label: 'With cheese' },
    ],
  },
];

const ingredient = (id, name, quantity, unit, kind) => ({ id, name, quantity, unit, kind });

export const recipeDefinitions = {
  'fried-rice': {
    defaultVariant: 'mild',
    requiredIngredients: ['rice'],
    base: [
      ingredient('rice', 'Dry rice', 75, 'g', 'staple'),
      ingredient('carrot', 'Carrot', 50, 'g', 'fresh'),
      ingredient('peas', 'Peas', 40, 'g', 'fresh'),
      ingredient('oil', 'Cooking oil', 10, 'ml', 'staple'),
      ingredient('soy-sauce', 'Soy sauce', 10, 'ml', 'staple'),
    ],
    extras: {
      mild: [],
      spicy: [ingredient('chilli', 'Chilli flakes', 2, 'g', 'staple')],
      egg: [ingredient('egg', 'Eggs', 1, 'item', 'fresh')],
    },
    sharedSteps: [
      {
        id: 'prepare',
        title: 'Prepare the shared ingredients',
        instruction: 'Wash and chop the vegetables. Measure the rice and seasonings. Keep the portion toppings aside.',
        durationMinutes: 5,
        adds: [],
      },
      {
        id: 'starch',
        title: 'Cook the shared rice',
        instruction: 'Cook the measured rice according to its package instructions; drain if needed.',
        durationMinutes: 12,
        adds: ['rice'],
      },
      {
        id: 'base',
        title: 'Make the common vegetable base',
        instruction:
          'Cook the vegetables in oil, then combine with the cooked rice and soy sauce. Keep chilli and eggs out of this shared base.',
        durationMinutes: 5,
        adds: ['carrot', 'peas', 'oil', 'soy-sauce'],
      },
    ],
    finish: {
      mild: 'Finish this mild portion without chilli or egg.',
      spicy: 'Add the measured chilli flakes to this portion and stir through.',
      egg: 'Cook the egg thoroughly in a separate pan, then combine it with this portion.',
    },
  },
  pasta: {
    defaultVariant: 'without-cheese',
    requiredIngredients: ['pasta', 'tomato'],
    base: [
      ingredient('pasta', 'Dry pasta', 90, 'g', 'staple'),
      ingredient('tomato', 'Tomatoes', 150, 'g', 'fresh'),
      ingredient('onion', 'Onion', 40, 'g', 'fresh'),
      ingredient('oil', 'Cooking oil', 10, 'ml', 'staple'),
    ],
    extras: {
      cheese: [ingredient('cheese', 'Cheese', 20, 'g', 'fresh')],
      'without-cheese': [],
      spicy: [ingredient('chilli', 'Chilli flakes', 2, 'g', 'staple')],
    },
    sharedSteps: [
      {
        id: 'prepare',
        title: 'Prepare the shared ingredients',
        instruction: 'Chop the tomatoes and onion. Measure the pasta. Keep cheese and chilli separate.',
        durationMinutes: 5,
        adds: [],
      },
      {
        id: 'starch',
        title: 'Cook the pasta',
        instruction: 'Cook the pasta according to its package instructions and drain.',
        durationMinutes: 12,
        adds: ['pasta'],
      },
      {
        id: 'base',
        title: 'Make the shared tomato base',
        instruction:
          'Soften the onion in oil, cook the tomatoes into a sauce, then combine with the pasta. Leave cheese and chilli out.',
        durationMinutes: 6,
        adds: ['onion', 'oil', 'tomato'],
      },
    ],
    finish: {
      cheese: 'Add the measured cheese only to this portion.',
      'without-cheese': 'Finish this portion without adding cheese or chilli.',
      spicy: 'Add the measured chilli only to this portion; leave cheese out.',
    },
  },
  wraps: {
    defaultVariant: 'mild',
    requiredIngredients: ['tortilla', 'chickpeas'],
    base: [
      ingredient('tortilla', 'Tortillas', 2, 'item', 'staple'),
      ingredient('chickpeas', 'Cooked chickpeas', 100, 'g', 'fresh'),
      ingredient('carrot', 'Carrot', 40, 'g', 'fresh'),
      ingredient('onion', 'Onion', 25, 'g', 'fresh'),
      ingredient('oil', 'Cooking oil', 5, 'ml', 'staple'),
    ],
    extras: {
      mild: [],
      spicy: [ingredient('chilli', 'Chilli flakes', 2, 'g', 'staple')],
      cheese: [ingredient('cheese', 'Cheese', 20, 'g', 'fresh')],
    },
    sharedSteps: [
      {
        id: 'prepare',
        title: 'Prepare the shared filling',
        instruction: 'Chop the carrot and onion. Drain the cooked chickpeas. Reserve separate toppings.',
        durationMinutes: 5,
        adds: [],
      },
      {
        id: 'starch',
        title: 'Cook the common filling',
        instruction: 'Cook the onion and carrot in oil, then add the cooked chickpeas and heat through.',
        durationMinutes: 10,
        adds: ['onion', 'carrot', 'oil', 'chickpeas'],
      },
      {
        id: 'base',
        title: 'Warm the tortillas',
        instruction: 'Warm the tortillas according to their package instructions. Do not assemble portions yet.',
        durationMinutes: 2,
        adds: ['tortilla'],
      },
    ],
    finish: {
      mild: 'Assemble this portion with the mild filling, without chilli or cheese.',
      spicy: 'Add chilli to this portion of filling, then assemble its wraps.',
      cheese: 'Add cheese to this portion, then assemble its wraps.',
    },
  },
};

const originalMetadata = {
  'fried-rice': { aliases: ['fried rice', 'rice'], category: 'Rice & grains', art: 'rice' },
  pasta: { aliases: ['pasta', 'tomato pasta'], category: 'Quick meals', art: 'pasta' },
  wraps: { aliases: ['wrap', 'wraps', 'chickpea wraps'], category: 'Quick meals', art: 'wraps' },
};
for (const dish of catalog)
  Object.assign(dish, originalMetadata[dish.id], { defaultVariant: recipeDefinitions[dish.id].defaultVariant });
for (const entry of additionalRecipes) {
  catalog.push(entry.catalog);
  recipeDefinitions[entry.catalog.id] = entry.definition;
}

export const ingredientCatalog = [
  ...new Map(
    Object.values(recipeDefinitions).flatMap(recipe =>
      [...recipe.base, ...Object.values(recipe.extras).flat()].map(({ quantity, ...item }) => [item.id, item]),
    ),
  ).values(),
];
for (const dish of catalog) {
  dish.ingredients = [
    ...new Set(
      [...recipeDefinitions[dish.id].base, ...Object.values(recipeDefinitions[dish.id].extras).flat()].map(
        item => item.name,
      ),
    ),
  ];
}

/** Add new library ingredients as unknown/zero stock; preserve every existing value. */
export function withRecipePantry(state) {
  const present = new Set(state.pantry.map(item => item.id));
  return {
    ...state,
    pantry: [
      ...state.pantry,
      ...ingredientCatalog
        .filter(item => !present.has(item.id))
        .map(item => ({ ...item, quantity: 0, confirmed: false, source: 'recipe-library' })),
    ],
  };
}

export function renderInstruction(instruction, recipe, omitted = []) {
  const available = new Set(
    [...recipe.base, ...Object.values(recipe.extras).flat()].map(item => item.id).filter(id => !omitted.includes(id)),
  );
  return instruction
    .replace(/\[\[([a-z-]+)\|([^\]]+)\]\]/g, (_, id, text) => (available.has(id) ? text : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

export const normalizeRecipeText = value =>
  String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Prefer a complete dish phrase over an alias contained in it: lemon rice > rice. */
export function matchRecipes(message, recipes = catalog) {
  const text = ` ${normalizeRecipeText(message)} `;
  const matches = [];
  for (const dish of recipes)
    for (const alias of [dish.id, dish.name, ...(dish.aliases || [])]) {
      const term = ` ${normalizeRecipeText(alias)} `;
      let start = text.indexOf(term);
      while (start !== -1) {
        matches.push({ dish, start, end: start + term.length, length: term.length });
        start = text.indexOf(term, start + 1);
      }
    }
  const specific = matches.filter(
    match =>
      !matches.some(other => other.length > match.length && other.start <= match.start && other.end >= match.end),
  );
  return [...new Map(specific.sort((a, b) => b.length - a.length).map(({ dish }) => [dish.id, dish])).values()];
}

/** Retrieve a small recipe context; the complete compact index remains available. */
export function retrieveRecipes(message, recipes = catalog, activeDishId) {
  const exact = matchRecipes(message, recipes);
  const words = new Set(
    normalizeRecipeText(message)
      .split(' ')
      .filter(word => word.length > 2),
  );
  const ranked = recipes
    .map((dish, index) => {
      const terms = new Set(
        normalizeRecipeText([dish.name, ...(dish.aliases || []), ...(dish.ingredients || [])].join(' ')).split(' '),
      );
      return { dish, index, score: [...words].filter(word => terms.has(word)).length };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.dish);
  return [
    ...new Map([...exact, ...recipes.filter(d => d.id === activeDishId), ...ranked].map(d => [d.id, d])).values(),
  ].slice(0, 6);
}

/** Ingredient snapshots are copied into cooked history, never inferred from requests. */
export function ingredientsFor(dishId, portions) {
  const recipe = recipeDefinitions[dishId];
  if (!recipe) throw new Error('Choose a dish from the curated recipe collection.');
  const totals = new Map();
  for (const portion of portions) {
    if (!portion || !Object.hasOwn(recipe.extras, portion.variant))
      throw new Error('Choose a supported recipe variation.');
    for (const item of [...recipe.base, ...recipe.extras[portion.variant]]) {
      const previous = totals.get(item.id);
      totals.set(item.id, { ...item, quantity: Number(((previous?.quantity || 0) + item.quantity).toFixed(3)) });
    }
  }
  return [...totals.values()];
}

export function createSeedState(options = {}) {
  const now = options.now || new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error('A valid starting time is required.');
  const household = [
    { id: 'asha', name: 'Asha', preference: 'mild' },
    { id: 'ravi', name: 'Ravi', preference: 'spicy' },
    { id: 'noor', name: 'Noor', preference: 'egg' },
  ];
  const pantry = [
    ingredient('rice', 'Dry rice', 1200, 'g', 'staple'),
    ingredient('carrot', 'Carrot', 350, 'g', 'fresh'),
    ingredient('peas', 'Peas', 300, 'g', 'fresh'),
    ingredient('oil', 'Cooking oil', 400, 'ml', 'staple'),
    ingredient('soy-sauce', 'Soy sauce', 100, 'ml', 'staple'),
    ingredient('chilli', 'Chilli flakes', 20, 'g', 'staple'),
    ingredient('egg', 'Eggs', 6, 'item', 'fresh'),
    ingredient('pasta', 'Dry pasta', 600, 'g', 'staple'),
    ingredient('tomato', 'Tomatoes', 900, 'g', 'fresh'),
    ingredient('onion', 'Onion', 400, 'g', 'fresh'),
    ingredient('cheese', 'Cheese', 150, 'g', 'fresh'),
    ingredient('tortilla', 'Tortillas', 8, 'item', 'staple'),
    ingredient('chickpeas', 'Cooked chickpeas', 800, 'g', 'fresh'),
  ].map(item => ({ ...item, confirmed: false, source: 'demo' }));
  const meals = [
    'fried-rice',
    'pasta',
    'wraps',
    'fried-rice',
    'pasta',
    'fried-rice',
    'wraps',
    'pasta',
    'fried-rice',
    'wraps',
  ];
  const daysAgo = [27, 24, 21, 18, 15, 12, 9, 6, 3, 1];
  const history = meals.map((dishId, index) => {
    const portions = household.map((person, personIndex) => ({
      name: person.name,
      variant: catalog.find(dish => dish.id === dishId).variants[personIndex].id,
    }));
    return {
      id: `demo-cooked-${index + 1}`,
      sessionId: `demo-session-${index + 1}`,
      dishId,
      title: catalog.find(dish => dish.id === dishId).name,
      servings: portions.length,
      portions,
      ingredients: ingredientsFor(dishId, portions),
      cookedAt: new Date(Date.parse(now) - daysAgo[index] * 86_400_000).toISOString(),
      confirmed: true,
      source: 'demo',
      demo: true,
      recipeVersion: '1',
      note: 'Synthetic demonstration meal; not your actual cooking history.',
    };
  });
  return withRecipePantry({
    revision: 0,
    clock: now,
    createdAt: now,
    household,
    pantry,
    requests: [],
    history,
    session: null,
    shopping: [],
    demo: {
      enabled: true,
      historyCount: history.length,
      label:
        'Demo household and 10 synthetic cooked meals over the last 28 days. Clear demo history to start your own record.',
    },
    activity: [
      {
        id: 'activity-0',
        at: now,
        type: 'demo',
        message: 'Loaded a demo household, pantry, and explicitly labeled synthetic cooking history.',
      },
    ],
  });
}
