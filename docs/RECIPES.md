# Sophia's recipe library

30 everyday dishes, each with three finishes (90 combinations), chosen for family cooking in Indian households plus a few quick everyday meals.

| Group | Dishes |
| --- | --- |
| Rice & grains (7) | Shared-base fried rice, vegetable pulao, lemon rice, curd rice, tomato rice, jeera rice, moong dal khichdi |
| Curries & dal (10) | Dal tadka, chana masala, rajma, aloo gobi, aloo matar, palak paneer, matar paneer, paneer bhurji, mixed vegetable curry, sambar |
| Breakfast (8) | Poha, upma, oats porridge, masala omelette, egg bhurji, besan chilla, masala dosa, idli |
| Quick meals (5) | Tomato pasta, chickpea vegetable wraps, vegetable noodles, vegetable sandwich, tomato soup |

## The design rule: anything that differs waits until after the split

Every recipe is a list of steps, and every step records which ingredients it puts into the food. Ingredients that differ between people are kept out of the shared pot and added only in each person's finishing step. That is what lets Sophia say "yes, Noor can still skip the paneer" or "no, the onion is already in".

Dishes that show this best:

- **Dal tadka.** The tadka is where chilli normally goes, so Sophia cooks one pot of dal, splits it, and gives each bowl its own tadka: cumin, red chilli, or a ghee drizzle. Ravi can change his mind about chilli right up until his tadka.
- **Palak paneer.** One spinach sauce. Paneer goes in after the split, so one plate can have sweet corn instead and another can get a chilli tadka.
- **Shared-base fried rice.** The rice and vegetables are shared; the egg is cooked in a separate pan for the plates that want it.
- **Masala omelette, besan chilla, masala dosa.** The raw mixture is divided before cooking, so chilli or cheese only goes into some of them.

Across the whole library, chilli never enters a shared pot. Spicy plates get a small chilli tadka (chilli flakes sizzled in a little oil) poured over only their portion. `tests/splits.test.mjs` checks this for every dish.

## Using the library

Search by dish name, alias (`chole`, `dosa`, `khichdi`, `omelette`, `palak`) or ingredient, or filter by category. Choose a dish, name the people eating, pick each person's finish, and build the plan. Shared quantities scale with the number of people; each finish lists its own extra quantities.

Changing a finish or removing an optional ingredient rebuilds the remaining steps and the ingredient totals. Ingredients that are already in the food cannot be removed, and a finished portion cannot be changed.

## Ingredients

52 ingredient types with fixed units. Chickpeas and kidney beans are **ready-cooked, drained weights**; dosa and idli use **ready-fermented batter**. Water is in the instructions but not in grocery totals. When the library gains an ingredient, existing households get a new zero-stock pantry row; nothing they entered is overwritten.

## Adding a recipe (no model training needed)

1. Add the entry in `src/recipes.mjs`, reusing ingredient ids and units.
2. Give it a name, aliases, category, description, three finishes, a default finish and the required ingredients.
3. List each ingredient in the `adds` of the step where it enters the food. Keep anything that differs between people in the finishes, not the shared steps.
4. Wrap optional sentences as `[[onion|Soften the chopped onion.]]` so omitting the ingredient also removes the instruction.
5. Write a dish-specific `splitInstruction` when dividing a cooked base would be wrong (for example, divide raw batter before cooking).
6. Run `npm test`. The library tests walk every dish and every finish through planning, the split, completion, pantry deduction and the grocery forecast.

The catalogue cards, pantry, local name matching, MCP tools and the Bedrock agent all read from this one library.

## Provenance and food safety

Dish selection was informed by [Swasthi's Indian dinner](https://www.indianhealthyrecipes.com/indian-dinner-recipes/) and [breakfast](https://www.indianhealthyrecipes.com/recipes/indian-breakfast/) collections and [Good Food's popular dinners](https://www.bbcgoodfood.com/howto/guide/most-popular-dinner-recipes). No recipe text, photos or datasets were copied; quantities and instructions were written for this project. Egg dishes use the 71°C / 160°F temperature from the [FoodSafety.gov chart](https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures).
