import { randomUUID, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import {
  catalog,
  createSeedState,
  ingredientsFor,
  matchRecipes,
  normalizeRecipeText,
  withRecipePantry,
} from './data.mjs';
import {
  planMeal,
  completeStep,
  finishMeal,
  updatePantry,
  alterMeal,
  cancelMeal,
  recordRequest,
  forecastGroceries,
  finishLabel,
  checkPantry,
  mealShortages,
  updateShoppingList,
} from './engine.mjs';
import { FileStore, DynamoStore } from './store.mjs';
import { kitchenTools, runKitchenTool, nextInstruction, describeMissing } from './tools.mjs';
import { createMcpHandler } from './mcp.mjs';

const VERSION = '0.1.0';
const MAX_MESSAGE_LENGTH = 1500;
const CONVERSATION_MEMORY = 10;
const LIMIT_ACTIONS = new Set(['plan', 'next', 'finish', 'forecast', 'alter', 'cancel', 'check', 'shop', 'help']);
// The chat response keeps the action names the web client already understands.
const TOOL_ACTIONS = {
  plan_meal: 'plan',
  complete_current_step: 'next',
  finish_meal: 'finish',
  alter_portion: 'alter',
  cancel_meal: 'cancel',
  update_pantry: 'pantry',
  forecast_groceries: 'forecast',
  check_pantry: 'check',
  add_to_shopping_list: 'shop',
  update_shopping_list: 'shop',
};
const QUICK_COMMAND =
  /^(?:next|next step|done|ok done|step done|this step is done|complete (?:this |the )?step|confirm split|split done|what(?:'s| is) next\??|where was i\??)[.!]?$/;
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const STRICT_SYNONYMS = { 'without-cheese': ['no cheese'] };
const LOOSE_SYNONYMS = {
  mild: ['plain', 'classic', 'not spicy', 'no chilli', 'no spice'],
  spicy: ['hot', 'chilli', 'extra chilli', 'extra spicy'],
  egg: ['eggs'],
  'without-cheese': ['no cheese'],
};
const NEGATION = /\b(?:not|no|never|without|remove|omit|hold)\b|n't\b/;
const cleanHeaders = (headers = {}) =>
  Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
const digest = value => createHash('sha256').update(value).digest();
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const portionsNamed = (portions, text) =>
  portions.filter(p => new RegExp(`(^|[^a-z0-9])${escapeRegExp(p.name.toLowerCase())}($|[^a-z0-9])`, 'i').test(text));

/** Finishes named in a message, keeping the longest phrase ("without cheese" is not "cheese") and dropping negated ones ("no chilli" is not spicy). */
function variantsMentioned(dish, message, { loose = false } = {}) {
  const text = ` ${normalizeRecipeText(message)} `,
    found = [];
  for (const variant of dish.variants) {
    const phrases = [
      variant.id,
      ...(loose ? [variant.label, ...(LOOSE_SYNONYMS[variant.id] || [])] : STRICT_SYNONYMS[variant.id] || []),
    ];
    for (const phrase of phrases) {
      const term = ` ${normalizeRecipeText(phrase)} `;
      for (let start = text.indexOf(term); start !== -1; start = text.indexOf(term, start + 1))
        found.push({
          id: variant.id,
          start,
          end: start + term.length,
          negative: /^ (?:no|not|without|non) /.test(term),
        });
    }
  }
  const specific = found
    .filter(m => !found.some(o => o.end - o.start > m.end - m.start && o.start <= m.start && o.end >= m.end))
    .filter(m => !/(?:^| )(?:no|not|without|non)$/.test(text.slice(0, m.start)));
  return [...new Map(specific.map(m => [m.id, m])).values()];
}

export function createApplication({
  store,
  env = process.env,
  interpret,
  bedrockClient,
  synthesizeSpeech,
  geminiAgent,
  geminiFetch,
} = {}) {
  store ||= env.SOPHIA_TABLE ? new DynamoStore(env.SOPHIA_TABLE) : new FileStore(env.SOPHIA_DATA_DIR || '.data');
  const providerMode = env.SOPHIA_PROVIDER === 'bedrock' ? 'bedrock' : 'demo';
  const code = env.SOPHIA_ACCESS_CODE || '';
  const locks = new Map();
  const loginAttempts = new Map();
  const provider = {
    mode: providerMode,
    label: providerMode === 'bedrock' ? 'Amazon Bedrock' : 'Local demo',
    cloud: Boolean(env.SOPHIA_TABLE),
    model: providerMode === 'bedrock' ? env.BEDROCK_MODEL_ID || 'amazon.nova-micro-v1:0' : null,
    // Spoken replies: Amazon Polly when enabled, otherwise the browser's own voice.
    speech: env.SOPHIA_VOICE === 'polly' ? 'polly' : 'browser',
    // An optional Google Gemini agent the cook can switch on in the chat while Bedrock is unavailable.
    gemini: Boolean(env.GEMINI_API_KEY),
    ...(env.SOPHIA_VOICE === 'polly' ? { voice: env.SOPHIA_POLLY_VOICE || 'Kajal' } : {}),
  };
  let pollyClient;
  /** Amazon Polly neural text-to-speech; returns MP3 bytes. */
  async function pollySpeech(text) {
    const sdk = await import('@aws-sdk/client-polly');
    pollyClient ||= new sdk.PollyClient({ region: env.AWS_REGION, maxAttempts: 2 });
    const result = await pollyClient.send(
      new sdk.SynthesizeSpeechCommand({
        Engine: 'neural',
        VoiceId: provider.voice,
        // Kajal is bilingual; ask for her Indian English rather than Hindi.
        ...(provider.voice === 'Kajal' ? { LanguageCode: 'en-IN' } : {}),
        OutputFormat: 'mp3',
        TextType: 'text',
        Text: text,
      }),
      { abortSignal: AbortSignal.timeout(8000) },
    );
    return Buffer.from(await result.AudioStream.transformToByteArray());
  }
  const verifyAccessCode = value =>
    !code || (typeof value === 'string' && timingSafeEqual(digest(value), digest(code)));
  function sessionCookie(id, secure) {
    const expiry = Math.floor(Date.now() / 1000) + 86400 * 30;
    const value = code ? `${id}.${expiry}.${createHmac('sha256', code).update(`${id}.${expiry}`).digest('hex')}` : id;
    return `sophia_session=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${86400 * 30}${secure ? '; Secure' : ''}`;
  }
  function readSession(headers) {
    const raw = (headers.cookie || '')
      .split(';')
      .map(s => s.trim())
      .find(s => s.startsWith('sophia_session='))
      ?.slice(15);
    if (!raw) return null;
    const [id, expiry, signature] = raw.split('.');
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    if (!code) return id;
    if (!/^\d+$/.test(expiry || '') || Number(expiry) < Date.now() / 1000 || !/^[a-f0-9]{64}$/.test(signature || ''))
      return null;
    const expected = createHmac('sha256', code).update(`${id}.${expiry}`).digest();
    return timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? id : null;
  }
  async function locked(id, fn) {
    const prior = locks.get(id) || Promise.resolve();
    const work = prior.catch(() => {}).then(fn);
    locks.set(id, work);
    try {
      return await work;
    } finally {
      if (locks.get(id) === work) locks.delete(id);
    }
  }
  const envelope = (state, more = {}) => ({ state, catalog, provider, ...more });
  const json = (status, value, headers = {}) => ({
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
    body: JSON.stringify(value),
  });
  async function durable(operation, fn) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 409) throw err;
      const unavailable = new Error(
        `Sophia could not ${operation} the saved kitchen. No successful change has been confirmed. Please try again shortly.`,
      );
      unavailable.status = 503;
      unavailable.code = 'storage_unavailable';
      throw unavailable;
    }
  }
  /** One household transaction for the web API and MCP: serialized per household, loaded or seeded,
   * and saved only through save(next), which is checked against the revision that was loaded. */
  async function household(id, fn) {
    return locked(id, async () => {
      let state = await durable('load', () => store.get(id));
      if (!state) {
        state = createSeedState();
        await durable('save', () => store.save(id, state));
      }
      // The deterministic engine derives timestamps from clock + revision seconds.
      // Anchor it to real time for a household revisiting on a different day.
      state = withRecipePantry({ ...state, clock: new Date(Date.now() - state.revision * 1000).toISOString() });
      const previous = state.revision;
      const save = async next => {
        if (next.revision === previous) next = { ...next, revision: previous + 1 };
        // Bound state growth for both a predictable model context and DynamoDB's item size limit.
        next = {
          ...next,
          requests: next.requests.slice(-50),
          activity: next.activity.slice(-100),
          history: next.history.slice(-100),
          conversation: (next.conversation || []).slice(-CONVERSATION_MEMORY),
        };
        while (Buffer.byteLength(JSON.stringify(next), 'utf8') > 300000 && next.requests.length > 5)
          next.requests.shift();
        while (Buffer.byteLength(JSON.stringify(next), 'utf8') > 300000 && next.history.length > 5)
          next.history.shift();
        if (Buffer.byteLength(JSON.stringify(next), 'utf8') > 350000)
          throw new Error(
            'This household record is too large. Clear cooking history or reset the demo before continuing.',
          );
        await durable('save', () => store.save(id, next, previous));
        return next;
      };
      return fn(state, save);
    });
  }
  const mcp = createMcpHandler({ household, verifyAccessCode, requireAccessCode: Boolean(code), version: VERSION });

  /** A portion named in this message, or for "his/her/their" the one person named in the latest turn that named anyone. */
  function chatTarget(state, t) {
    const portions = state.session?.portions || [];
    const named = portionsNamed(portions, t);
    if (named.length || !/\b(?:his|her|hers|him|their|theirs|them)\b/.test(t)) return { named, target: named[0] };
    for (const turn of [...(state.conversation || [])].reverse()) {
      const earlier = portionsNamed(portions, String(turn.content).toLowerCase());
      if (earlier.length) return { named, target: earlier.length === 1 ? earlier[0] : undefined };
    }
    return { named, target: undefined };
  }
  /** Household preferences first. Anonymous requests such as "one spicy" change a plate whose finish was not asked for,
   * otherwise a second plate with the same requested finish; guests change before household members. */
  function demoPortions(state, dish, servings, mentioned) {
    const supported = new Set(dish.variants.map(v => v.id));
    const portions = Array.from({ length: servings }, (_, i) => {
      const person = state.household[i];
      return {
        name: person?.name || `Guest ${i + 1}`,
        variant: supported.has(person?.preference) ? person.preference : dish.defaultVariant,
      };
    });
    const lastFirst = [...portions.keys()].reverse();
    for (const variant of mentioned.filter(v => !portions.some(p => p.variant === v))) {
      const index =
        lastFirst.find(i => !mentioned.includes(portions[i].variant)) ??
        lastFirst.find(i => portions.filter(p => p.variant === portions[i].variant).length > 1);
      portions[index].variant = variant;
    }
    return portions;
  }

  function demoIntent(message, state) {
    const t = message.toLowerCase().replace(/’/g, "'");
    const { named, target } = chatTarget(state, t);
    const cooking = state.session?.status === 'cooking';
    const activeDish = cooking ? catalog.find(d => d.id === state.session.dishId) : null;
    const question = /^(?:is|are|was|does|do|did|what|which|who|how|why|when)\b/.test(t.trim()) && /\?$/.test(t.trim());
    const switchTo =
      activeDish &&
      !question &&
      /\b(?:make|change|switch|swap|turn|give|add|want|wants|prefer|prefers|put|set|instead|should|for|to|with)\b/.test(
        t,
      )
        ? variantsMentioned(activeDish, t, { loose: true }).filter(m => m.negative || !NEGATION.test(t))
        : [];
    if (/allerg|anaphyla|celiac|coeliac/.test(t))
      return {
        action: 'help',
        reply:
          'Sophia’s demo handles taste preferences, not allergy-safe preparation. For an allergy, plan separate ingredients and equipment from the start; splitting a shared dish later does not undo cross-contact.',
      };
    const listWords = /\b(?:shopping list|grocery list|my list|the list|to list)\b/;
    if (
      /\b(?:add|put|save)\b/.test(t) &&
      (listWords.test(t) || /\badd (?:them|those|these|it|what'?s missing|the missing (?:items|things))\b/.test(t))
    ) {
      // "Add them" means the dish just checked; otherwise the meal being cooked.
      const named = matchRecipes(t)[0]?.id;
      const check = state.lastPantryCheck;
      const recent = check && Date.now() - Date.parse(check.at || 0) < 15 * 60 * 1000;
      if (named) return { action: 'shop', arguments: { dishId: named } };
      if (recent && !check.meal) return { action: 'shop', arguments: { dishId: check.dishId } };
      if (cooking) return { action: 'shop', arguments: {} };
      return { action: 'help', reply: 'Which dish is it for? Try “Do I have everything for dal?” first.' };
    }
    if (/\b(?:what'?s|what is|read|show|tell me)\b/.test(t) && listWords.test(t)) {
      const items = (state.shoppingList || []).filter(item => !item.bought);
      return {
        action: 'help',
        reply: items.length
          ? `Your shopping list: ${items.map(item => `${item.name.toLowerCase()} (${item.quantity} ${item.unit})`).join(', ')}.`
          : 'Your shopping list is empty.',
      };
    }
    if (
      /\b(?:do|have) (?:i|we) (?:have|got) (?:everything|enough|all|the ingredients|what (?:i|we) need)\b|\bwhat (?:am i|are we|is) missing\b|\bwhat (?:do|else do) (?:i|we) need\b|\bcheck (?:my |the )?pantry\b/.test(
        t,
      )
    ) {
      const dishId = matchRecipes(t)[0]?.id;
      if (!dishId && !cooking)
        return { action: 'help', reply: 'Which dish should I check? For example, “Do I have everything for dal?”' };
      return { action: 'check', arguments: dishId ? { dishId } : {} };
    }
    const cancel = t
      .trim()
      .replace(/[.!?]+$/, '')
      .match(/(?:^|\b)(?:cancel|abandon|discard|scrap|call off|stop cooking)\b(.*)$/);
    if (
      cancel &&
      (/^(?:\s+(?:the|this|my|our|that|current|whole|entire|today's|tonight's))*(?:\s+(?:meal|cooking|session|plan|dinner|lunch|breakfast|recipe|dish|it|everything|all))?(?:\s+please)?$/.test(
        cancel[1],
      ) ||
        (state.session && matchRecipes(cancel[1]).some(d => d.id === state.session.dishId)))
    ) {
      if (/\b(?:don't|do not|not|never|no need to)\s+(?:cancel|abandon|discard|scrap|call off|stop)\b/.test(t))
        return { action: 'help', reply: `I have not cancelled anything. ${nextInstruction(state)}` };
      if (/\b(?:should|could|can) (?:i|we)\b|\bhow (?:do|can) (?:i|we)\b/.test(t))
        return {
          action: 'help',
          reply: 'Say “Cancel this meal” to abandon it. Nothing is recorded as cooked and pantry stock stays the same.',
        };
      if (!cooking) return { action: 'help', reply: `There is no active meal to cancel. ${nextInstruction(state)}` };
      return { action: 'cancel', arguments: {} };
    }
    if (switchTo.length && named.length > 1)
      return { action: 'help', reply: 'Change one person’s finish at a time, for example “Make Ravi’s spicy”.' };
    if (switchTo.length && target) {
      if (switchTo.length > 1)
        return {
          action: 'help',
          reply: `Choose one finish for ${target.name}: ${switchTo.map(m => activeDish.variants.find(v => v.id === m.id).label).join(' or ')}.`,
        };
      if (target.variant === switchTo[0].id)
        return {
          action: 'help',
          reply: `${target.name}’s portion is already ${activeDish.variants.find(v => v.id === target.variant).label.toLowerCase()}. ${nextInstruction(state)}`,
        };
      return { action: 'alter', arguments: { variant: switchTo[0].id, portionName: target.name } };
    }
    if (/what.*cook.*(?:have|pantry)|cook.*with.*(?:have|pantry)/.test(t)) {
      const servings = state.household.length || 1;
      const choices = catalog
        .map(dish => {
          const variants = dish.variants.map(v => v.id),
            fallback = dish.defaultVariant;
          const portions = Array.from({ length: servings }, (_, i) => ({
            name: state.household[i]?.name || `Guest ${i + 1}`,
            variant: variants.includes(state.household[i]?.preference) ? state.household[i].preference : fallback,
          }));
          const missing = ingredientsFor(dish.id, portions).filter(
            item => (state.pantry.find(p => p.id === item.id)?.quantity || 0) < item.quantity,
          );
          return {
            missing: missing.length,
            text: `${dish.name}: ${missing.length ? `check or top up ${missing.map(i => i.name).join(', ')}` : 'entered stock covers the plan'}`,
          };
        })
        .sort((a, b) => a.missing - b.missing)
        .slice(0, 3);
      return {
        action: 'help',
        reply: `For ${servings} people, based on entered pantry quantities, the closest three matches are: ${choices.map(item => item.text).join('; ')}. Check stock and freshness, then choose a dish. Browse all ${catalog.length} dishes using recipe search.`,
      };
    }
    if (/groc|next month|monthly|shopping|buy next|forecast/.test(t))
      return {
        action: 'forecast',
        arguments: { weeks: 4, awayDays: Number(t.match(/away (?:for )?(\d+)/)?.[1] || 0), confirmPantry: false },
      };
    if (/what.*next|show.*next|where.*left|where (?:was|were|am|are) (?:i|we)|resume|continue/.test(t))
      return { action: 'help', reply: nextInstruction(state) };
    if (
      /\b(?:not|never|haven't|isn't|isnt|don't|do not|didn't|did not)\b/.test(t) &&
      /\b(?:done|finish|finished|complete|cooked|ate|next)\b/.test(t)
    )
      return {
        action: 'help',
        reply:
          'I have not confirmed any progress. Finish the current step first, then use its confirmation button or say “Done”.',
      };
    if (
      /^(?:finish meal|finished cooking|meal (?:is )?done|all done|we ate|confirm (?:meal )?cooked)[.!]?$/.test(
        t.trim(),
      )
    )
      return { action: 'finish', arguments: {} };
    const dishes = matchRecipes(t);
    if (dishes.length > 1 && /\b(cook|make|plan|prepare|start)\b/.test(t))
      return {
        action: 'help',
        reply: `Choose one dish for this cooking session: ${dishes.map(d => d.name).join(' or ')}. Each dish has its own portion plan.`,
      };
    const dishId = dishes[0]?.id;
    if (dishId && /\b(cook|make|plan|prepare|start)\b/.test(t)) {
      const count = t.match(
        /(?:for|serve|serves|servings?(?: of)?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/,
      )?.[1];
      const servings = count ? Number(NUMBER_WORDS[count] ?? count) : Math.min(6, state.household.length || 3);
      if (!Number.isInteger(servings) || servings < 1 || servings > 6)
        return {
          action: 'help',
          reply:
            'This demo supports one to six people. Tell me a serving count in that range, or use the portion builder.',
        };
      const dish = catalog.find(x => x.id === dishId);
      const mentioned = variantsMentioned(dish, t).map(m => m.id);
      if (mentioned.length > servings)
        return {
          action: 'help',
          reply:
            'You named more different versions than people. Use the portion builder to choose exactly one version for each person.',
        };
      // Local mode honours saved preferences plus one portion per mentioned variant.
      // The named portion builder is authoritative for custom maps.
      return {
        action: 'plan',
        arguments: { dishId, servings, portions: demoPortions(state, dish, servings, mentioned) },
      };
    }
    const omit = t.match(
      /(?:without|no|remove|omit|out of|don't have|(?:doesn't|does not|don't|do not) want)\s+(?:any\s+|the\s+)?(.+?)(?:\s+(?:from|for|in)\s+|[.!?]|$)/,
    );
    if (omit) {
      if (/\b(my|his|her|their|one)\s+portion\b/.test(t) && !target)
        return {
          action: 'help',
          reply: 'Which named plate should change? Tell me the person’s name, or choose them in the alteration form.',
        };
      return {
        action: 'alter',
        arguments: { omitIngredient: omit[1], ...(target ? { portionName: target.name } : {}) },
      };
    }
    if (switchTo.length)
      return {
        action: 'help',
        reply: `Whose plate should get ${switchTo.map(m => activeDish.variants.find(v => v.id === m.id).label.toLowerCase()).join(' or ')}? Tell me the person’s name, or choose their portion in the alteration form.`,
      };
    if (
      /^(?:next|done|step done|this step is done|complete (?:this |the )?step|confirm split|split done)[.!]?$/.test(
        t.trim(),
      )
    )
      return { action: 'next', arguments: {} };
    if (/history|how many.*cook|cooked before/.test(t))
      return {
        action: 'help',
        reply: `There are ${state.history.length} confirmed cooked meals in this household history. ${state.demo?.enabled ? 'The initial entries are clearly labeled synthetic demo history. ' : ''}Recipe requests and unfinished plans do not count toward groceries.`,
      };
    return {
      action: 'help',
      reply: `Choose from ${catalog.length} dishes: try “Cook poha for 2”, “Cook palak paneer for 3”, “What is next?”, “Done”, or “Plan groceries for next month”. Use the portion builder for exact preferences. Local demo supports recipe names and aliases; Amazon Bedrock adds natural-language interpretation when connected.`,
    };
  }
  function context(state) {
    return {
      catalog: catalog.map(({ id, name, aliases, ingredients, variants, defaultVariant }) => ({
        id,
        name,
        aliases,
        ingredients,
        variants,
        defaultVariant,
      })),
      household: state.household,
      pantry: state.pantry.map(({ id, name, quantity, unit }) => ({ id, name, quantity, unit })),
      session: state.session
        ? {
            title: state.session.title,
            dishId: state.session.dishId,
            servings: state.session.servings,
            status: state.session.status,
            portions: state.session.portions,
            steps: state.session.steps.map(({ id, title, status, phase, adds }) => ({
              id,
              title,
              status,
              phase,
              adds,
            })),
          }
        : null,
    };
  }

  function demoChat(requested, message) {
    const intent = demoIntent(message, requested);
    if (!LIMIT_ACTIONS.has(intent?.action))
      throw new Error('The assistant returned an unsupported action. Nothing was changed.');
    const args = intent.arguments || {};
    let next = requested,
      reply = '',
      forecast;
    switch (intent.action) {
      case 'plan':
        next = planMeal(requested, args);
        reply = `${next.session.title} is planned for ${next.session.servings}: ${next.session.portions.map(p => `${p.name} (${finishLabel(next.session.dishId, p.variant).toLowerCase()})`).join(', ')}. We’ll share preparation, then confirm the split before finishing the named portions. ${nextInstruction(next)}`;
        break;
      case 'next': {
        const step = requested.session?.steps.find(x => x.status !== 'completed');
        if (!step) {
          reply = nextInstruction(requested);
          break;
        }
        next = completeStep(requested, step.id);
        reply = `Confirmed: ${step.title}. ${nextInstruction(next)}`;
        break;
      }
      case 'finish':
        next = finishMeal(requested);
        reply =
          'Meal confirmed cooked. I saved the ingredient quantities from your final plan and updated estimated pantry stock once. This meal now contributes to future grocery suggestions.';
        break;
      case 'alter':
        next = alterMeal(requested, args);
        reply = `${next.activity.at(-1).message} ${nextInstruction(next)}`;
        break;
      case 'cancel':
        next = cancelMeal(requested);
        reply = `${next.activity.at(-1).message} ${nextInstruction(next)}`;
        break;
      case 'check': {
        const check = args.dishId ? checkPantry(requested, { dishId: args.dishId }) : mealShortages(requested);
        next = {
          ...requested,
          lastPantryCheck: {
            dishId: args.dishId || requested.session.dishId,
            title: check.title,
            meal: !args.dishId,
            at: new Date().toISOString(),
          },
        };
        const people = check.servings ? ` for ${check.servings}` : '';
        reply = check.missing.length
          ? `For ${check.title}${people}, you're short on ${describeMissing(check.missing)}, based on your pantry. Say “add them to my shopping list” to save them.`
          : `Yes, your pantry covers ${check.title}${people}.`;
        break;
      }
      case 'shop': {
        const outcome = runKitchenTool('add_to_shopping_list', requested, args);
        if (outcome.state) next = outcome.state;
        reply = `${outcome.result.message} Nothing is ordered; it's a list for your next shop.`;
        break;
      }
      case 'forecast':
        forecast = forecastGroceries(requested, { weeks: 4, awayDays: args.awayDays || 0, confirmPantry: false });
        reply = `I based this suggestion on ${forecast.historyCount} confirmed cooked meals, not recipe requests. Staples cover the next four weeks; fresh items are weekly suggestions. Confirm pantry stock in Grocery plan before subtracting what you own.`;
        break;
      default:
        reply = String(intent.reply || nextInstruction(requested)).slice(0, 2000);
    }
    return { state: next, reply, ...(forecast ? { forecast } : {}), action: intent.action };
  }

  async function agentChat(requested, message, engine = 'bedrock') {
    const gemini = engine === 'gemini';
    const name = gemini ? 'Gemini' : 'Bedrock';
    const limit = Number((gemini ? env.SOPHIA_MAX_DAILY_GEMINI : env.SOPHIA_MAX_DAILY_CALLS) || (gemini ? 150 : 100));
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
      throw new Error('Daily model-call limits must be 1-10000.');
    // Every model call, including each tool round, counts toward that engine's daily quota and is reserved first.
    const reserve = async () => {
      const day = new Date().toISOString().slice(0, 10);
      if (!(await durable('check', () => store.consumeQuota(gemini ? `gemini:${day}` : day, limit)))) {
        const e = new Error(
          `Today’s ${name} limit is reached. Cooking buttons and history still work. Try again tomorrow.`,
        );
        e.status = 429;
        throw e;
      }
    };
    await reserve();
    let working = requested,
      action = 'help',
      forecast,
      confirmations = 0,
      firstReserved = true;
    // The model only requests tools; each one runs through the engine against this request's working state.
    const execute = async (name, input) => {
      if (name === 'complete_current_step' && confirmations++)
        throw new Error('Only one step can be confirmed per message. Ask the user to say when the next step is done.');
      // The web grocery view saves the four-week, unconfirmed-pantry forecast through /api/shopping.
      const outcome = runKitchenTool(
        name,
        working,
        name === 'forecast_groceries' ? { ...input, weeks: 4, confirmPantry: false } : input,
      );
      if (outcome.state) working = outcome.state;
      if (outcome.forecast) forecast = outcome.forecast;
      action = TOOL_ACTIONS[name] || action;
      return outcome.result;
    };
    let answer;
    try {
      const agent = gemini
        ? geminiAgent || (await import('./gemini.mjs')).runGeminiAgent
        : interpret || (await import('./bedrock.mjs')).runBedrockAgent;
      answer = await agent(
        message,
        {
          context: context(requested),
          history: requested.conversation || [],
          tools: kitchenTools,
          execute,
          beforeCall: async () => {
            if (firstReserved) {
              firstReserved = false;
              return;
            }
            await reserve();
          },
        },
        gemini
          ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, fetch: geminiFetch }
          : { modelId: env.BEDROCK_MODEL_ID, region: env.AWS_REGION, client: bedrockClient },
      );
    } catch (err) {
      // Real Bedrock failures go to the server log (terminal or CloudWatch) with AWS's own error, never the prompt.
      if (gemini ? !geminiAgent && !geminiFetch : !interpret && !bedrockClient)
        console.error(
          `[sophia] ${name} request failed: ${err.cause?.name || err.name}: ${err.cause?.message || err.message}`,
        );
      if (err.status) throw err;
      const e = new Error(
        `Bedrock could not interpret this request. Check model access, region, and the server configuration. ${err.name === 'AccessDeniedException' ? 'AWS denied access to the configured model.' : ''}`,
      );
      e.status = 502;
      throw e;
    }
    return {
      state: working,
      reply: String(answer?.reply || nextInstruction(working)).slice(0, 2000),
      action,
      ...(forecast ? { forecast } : {}),
      ...(answer?.usage ? { usage: answer.usage } : {}),
      ...(answer?.toolCalls ? { toolCalls: answer.toolCalls } : {}),
      engine: gemini ? 'gemini' : 'bedrock',
    };
  }

  async function executeChat(state, message, engine) {
    const requested = recordRequest(state, message);
    // Gemini is opt-in per message (the chat toggle) and only when this server has a Gemini key.
    const gemini = engine === 'gemini' && provider.gemini;
    // Short cooking commands don't need a model; the engine answers them instantly, even in AI mode.
    const quick = QUICK_COMMAND.test(message.trim().toLowerCase().replace(/’/g, "'"));
    let result;
    if ((providerMode !== 'bedrock' && !gemini) || (gemini && quick)) result = demoChat(requested, message);
    else {
      try {
        result = await agentChat(requested, message, gemini ? 'gemini' : 'bedrock');
      } catch (err) {
        // When the model can't answer (account not enabled, outage, timeout), keep cooking with the offline
        // parser. The response is flagged so the app can show an "Offline mode" badge; replies stay clean
        // because they are read aloud. Storage (503) errors, and Bedrock's daily limit (429), stay errors.
        if (err.status !== 502 && !(gemini && err.status === 429)) throw err;
        const offline = demoChat(requested, message);
        result = {
          ...offline,
          fallback: 'offline',
          fallbackReason: err.message,
        };
      }
    }
    // A short conversation memory lets follow-ups such as "make his spicy" resolve.
    const at = new Date().toISOString();
    const conversation = [
      ...(requested.conversation || []),
      { role: 'user', content: message.slice(0, 500), at },
      { role: 'assistant', content: result.reply.slice(0, 500), at },
    ].slice(-CONVERSATION_MEMORY);
    return { ...result, state: { ...result.state, conversation } };
  }

  async function handle(request) {
    const method = request.method || 'GET',
      path = request.path.split('?')[0],
      headers = cleanHeaders(request.headers);
    const secure = headers['x-forwarded-proto'] === 'https' || Boolean(env.AWS_LAMBDA_FUNCTION_NAME);
    if (path === '/api/health' && method === 'GET')
      return json(200, {
        ok: true,
        app: 'Sophia',
        provider: providerMode,
        storage: env.SOPHIA_TABLE ? 'dynamodb' : 'local',
      });
    if (method === 'OPTIONS') return { status: 204, headers: {}, body: '' };
    // Same-origin only; do not permit browser cross-origin writes through a signed cookie.
    const origin = headers.origin,
      host = headers['x-forwarded-host'] || headers.host;
    if (method !== 'GET' && origin && host) {
      try {
        if (new URL(origin).host !== host) return json(403, { error: 'Use the app from its own address.' });
      } catch {
        return json(403, { error: 'Invalid request origin.' });
      }
    }
    let body = request.body || {};
    if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body), 'utf8') > 16384)
      return json(413, { error: 'This request is too large. Use a short cooking request or a small form.' });
    // /api/mcp is the hosted path (CloudFront and API Gateway route /api/*); /mcp is a local alias.
    if (path === '/api/mcp' || path === '/mcp') {
      try {
        return await mcp({ method, headers, body, ip: request.ip || 'local', cookieHousehold: readSession(headers) });
      } catch {
        return json(500, {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Sophia could not complete that MCP request.' },
          id: null,
        });
      }
    }
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return json(400, { error: 'Request body must be JSON.' });
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json(400, { error: 'Request body must be an object.' });
    if (path === '/api/unlock' && method === 'POST') {
      const key = request.ip || 'local',
        now = Date.now(),
        prior = loginAttempts.get(key);
      const count = prior && now - prior.start < 60000 ? prior.count + 1 : 1;
      loginAttempts.set(key, { start: prior && now - prior.start < 60000 ? prior.start : now, count });
      if (count > 10) return json(429, { error: 'Too many attempts. Wait a minute and try again.' });
      if (!verifyAccessCode(body.accessCode))
        return json(401, { error: 'The access code is incorrect.', code: 'access_required' });
      const sid = randomUUID();
      try {
        await durable('save', () => store.save(sid, createSeedState()));
      } catch (err) {
        return json(err.status || 503, { error: err.message, code: err.code });
      }
      return json(200, { ok: true }, { 'set-cookie': sessionCookie(sid, secure) });
    }
    const existingId = readSession(headers);
    if (code && !existingId)
      return json(401, { error: 'Enter the demo access code to open Sophia.', code: 'access_required' });
    const id = existingId || randomUUID();
    const cookie = !existingId ? { 'set-cookie': sessionCookie(id, secure) } : {};
    if (path === '/api/speak' && method === 'POST') {
      if (provider.speech !== 'polly')
        return json(404, { error: 'Spoken replies use the browser voice here.' }, cookie);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > MAX_MESSAGE_LENGTH)
        return json(400, { error: `Send 1-${MAX_MESSAGE_LENGTH} characters to speak.` }, cookie);
      try {
        const limit = Number(env.SOPHIA_MAX_DAILY_SPEECH || 300);
        const today = new Date().toISOString().slice(0, 10);
        if (!(await durable('check', () => store.consumeQuota(`speech:${today}`, limit))))
          return json(429, { error: 'Today’s Polly voice limit is reached; the browser voice will be used.' }, cookie);
        const audio = await (synthesizeSpeech || pollySpeech)(text);
        return json(200, { audio: Buffer.from(audio).toString('base64'), contentType: 'audio/mpeg' }, cookie);
      } catch (err) {
        return json(
          err.status === 503 ? 503 : 502,
          { error: 'Amazon Polly could not speak this reply; the browser voice will be used.' },
          cookie,
        );
      }
    }
    try {
      return await household(id, async (state, save) => {
        // householdId lets an MCP client work on this same household.
        if (path === '/api/state' && method === 'GET') return json(200, envelope(state, { householdId: id }), cookie);
        if (method !== 'POST') return json(404, { error: 'That API route does not exist.' }, cookie);
        if (body.revision !== undefined && body.revision !== state.revision)
          return json(409, { error: 'The household changed in another tab. Refresh before continuing.' }, cookie);
        const previous = state.revision;
        let more = {};
        switch (path) {
          case '/api/plan':
            state = planMeal(state, body);
            break;
          case '/api/step':
            state = completeStep(state, body.stepId);
            break;
          case '/api/finish':
            state = finishMeal(state);
            break;
          case '/api/cancel':
            state = cancelMeal(state);
            more.reply = `${state.activity.at(-1).message} ${nextInstruction(state)}`;
            break;
          case '/api/alter':
            state = alterMeal(state, body);
            break;
          case '/api/shopping-list': {
            if (body.op === 'add-shortages') {
              const outcome = runKitchenTool('add_to_shopping_list', state, {});
              more.reply = outcome.result.message;
              if (!outcome.state) return json(200, envelope(state, more), cookie);
              state = outcome.state;
            } else state = updateShoppingList(state, { op: body.op, id: body.id });
            break;
          }
          case '/api/pantry':
            state = updatePantry(state, body);
            break;
          case '/api/forecast':
            return json(200, { forecast: forecastGroceries(state, body), sourceRevision: state.revision }, cookie);
          case '/api/shopping': {
            const forecast = forecastGroceries(state, {
              weeks: 4,
              awayDays: body.awayDays || 0,
              confirmPantry: body.confirmPantry === true,
            });
            state = {
              ...state,
              revision: state.revision + 1,
              shopping: [
                ...forecast.monthly.map(x => ({ ...x, cadence: 'monthly' })),
                ...forecast.weekly.map(x => ({ ...x, cadence: 'weekly' })),
              ],
              shoppingPlan: {
                ...forecast,
                confirmPantry: body.confirmPantry === true,
                savedAt: new Date().toISOString(),
                sourceRevision: state.revision,
              },
            };
            more.reply = 'Saved the monthly staples and weekly fresh suggestions to your shopping list.';
            break;
          }
          case '/api/reset': {
            state = createSeedState();
            state.revision = previous + 1;
            break;
          }
          case '/api/clear-history': {
            state = {
              ...state,
              history: [],
              requests: [],
              conversation: [],
              revision: previous + 1,
              demo: { enabled: false, label: 'Your confirmed cooking history', historyCount: 0 },
            };
            break;
          }
          case '/api/chat': {
            if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > MAX_MESSAGE_LENGTH)
              return json(400, { error: `Write a request of 1-${MAX_MESSAGE_LENGTH} characters.` }, cookie);
            const result = await executeChat(state, body.message.trim(), body.engine);
            state = result.state;
            more = { ...result };
            delete more.state;
            break;
          }
          default:
            return json(404, { error: 'That API route does not exist.' }, cookie);
        }
        state = await save(state);
        return json(200, envelope(state, more), cookie);
      });
    } catch (err) {
      return json(
        err.status || 400,
        { error: err.message || 'Sophia could not complete that action.', ...(err.code ? { code: err.code } : {}) },
        cookie,
      );
    }
  }
  return { handle, store };
}
