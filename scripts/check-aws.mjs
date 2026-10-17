/** Offline AWS adapter checks. No credentials, network, or account calls. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runBedrockAgent } from '../src/bedrock.mjs';
import { kitchenTools, runKitchenTool } from '../src/tools.mjs';
import { createSeedState } from '../src/data.mjs';
import { planMeal } from '../src/engine.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = { region: 'us-east-1', modelId: 'amazon.nova-micro-v1:0' };
const noTools = {
  execute: async () => {
    throw new Error('No tool should run.');
  },
};
await assert.rejects(runBedrockAgent('', noTools, options), /request/);

// The model can only request listed tools; the engine validates every argument.
let state = planMeal(createSeedState(), {
  dishId: 'pasta',
  servings: 1,
  portions: [{ name: 'Maya', variant: 'cheese' }],
});
const executed = [];
const execute = async (name, input) => {
  executed.push(name);
  const outcome = runKitchenTool(name, state, input);
  if (outcome.state) state = outcome.state;
  return outcome.result;
};
const seen = [];
const script = [
  {
    stopReason: 'tool_use',
    output: {
      message: {
        role: 'assistant',
        content: [
          { toolUse: { toolUseId: 'a', name: 'execute_shell', input: { command: 'drop-me' } } },
          {
            toolUse: {
              toolUseId: 'b',
              name: 'alter_portion',
              input: { omitIngredient: 'cheese', portionName: 'Maya', buy: true },
            },
          },
          {
            toolUse: {
              toolUseId: 'c',
              name: 'alter_portion',
              input: { omitIngredient: 'cheese', portionName: 'Maya' },
            },
          },
        ],
      },
    },
    usage: { inputTokens: 800, outputTokens: 70 },
  },
  {
    stopReason: 'end_turn',
    output: {
      message: { role: 'assistant', content: [{ text: '<thinking>plan</thinking>Maya’s pasta will have no cheese.' }] },
    },
    usage: { inputTokens: 900, outputTokens: 20 },
  },
];
const client = {
  async send(command, sendOptions) {
    seen.push({ input: structuredClone(command.input), options: sendOptions });
    return script[seen.length - 1];
  },
};
const context = {
  catalog: [{ id: 'pasta', name: 'Pasta', variants: ['cheese', 'without-cheese'] }],
  session: {
    dishId: 'pasta',
    servings: 1,
    status: 'cooking',
    title: 'Pasta',
    portions: [{ name: 'Maya', variant: 'cheese' }],
    steps: [{ id: 's1', title: 'Boil', status: 'pending', phase: 'shared', adds: ['pasta'] }],
  },
  pantry: [{ id: 'pasta', name: 'Dry pasta', quantity: 300, unit: 'g', secret: 'DROP_PANTRY_SECRET' }],
  household: [{ name: 'Maya', preference: 'without-cheese', secret: 'DROP_PERSON_SECRET' }],
  entireChatArchive: 'DO_NOT_INCLUDE_THIS',
  credentials: 'DO_NOT_INCLUDE_THIS',
};
const answer = await runBedrockAgent(
  'Make Maya’s portion without cheese.',
  { context, tools: kitchenTools, execute },
  { ...options, client, maxTokens: 9999 },
);
assert.deepEqual(executed, ['alter_portion', 'alter_portion']);
assert.equal(state.session.portions[0].variant, 'without-cheese');
assert.equal(answer.reply, 'Maya’s pasta will have no cheese.');
assert.deepEqual(answer.usage, { inputTokens: 1700, outputTokens: 90 });
assert.deepEqual(answer.toolCalls, [
  { name: 'alter_portion', ok: false },
  { name: 'alter_portion', ok: true },
]);
const first = seen[0].input;
assert.equal(first.modelId, 'amazon.nova-micro-v1:0');
assert.equal(first.inferenceConfig.maxTokens, 700);
assert.equal(first.inferenceConfig.temperature, 0);
assert.equal(first.messages.length, 1);
assert.deepEqual(
  first.toolConfig.tools.map(tool => tool.toolSpec.name),
  kitchenTools.map(tool => tool.name),
);
const results = seen[1].input.messages.at(-1).content.map(part => JSON.parse(part.toolResult.content[0].text));
assert.match(results[0].error, /no tool named/);
assert.match(results[1].error, /unsupported field "buy"/);
assert.ok(results[2].message);
assert.ok(!first.system[0].text.includes('DO_NOT_INCLUDE_THIS'));
const sentContext = JSON.parse(first.system[0].text.split('Context: ')[1]);
assert.deepEqual(sentContext.pantry, [{ id: 'pasta', name: 'Dry pasta', quantity: 300, unit: 'g' }]);
assert.deepEqual(sentContext.household, [{ name: 'Maya', preference: 'without-cheese' }]);
assert.equal(sentContext.session.dishId, 'pasta');
assert.ok(!first.system[0].text.includes('DROP_PANTRY_SECRET'));
assert.ok(!first.system[0].text.includes('DROP_PERSON_SECRET'));
assert.ok(seen[0].options.abortSignal instanceof AbortSignal);

// Oversized context stays bounded, and the loop stops after four tool rounds.
let calls = 0;
const looping = {
  async send(command) {
    calls++;
    seen.push({ input: command.input });
    return {
      stopReason: 'tool_use',
      output: {
        message: {
          role: 'assistant',
          content: [{ toolUse: { toolUseId: `t${calls}`, name: 'get_kitchen_state', input: {} } }],
        },
      },
    };
  },
};
await runBedrockAgent(
  'What can I cook?',
  {
    tools: kitchenTools,
    execute,
    context: {
      catalog: Array.from({ length: 100 }, () => ({
        id: 'x'.repeat(999),
        name: 'x'.repeat(999),
        variants: Array.from({ length: 100 }, () => ({ id: 'x'.repeat(999), name: 'x'.repeat(999) })),
      })),
      household: Array.from({ length: 100 }, () => ({ name: 'x'.repeat(999), preference: 'x'.repeat(999) })),
      allowedActions: Array(100).fill('plan'),
      pantry: Array.from({ length: 100 }, () => ({
        id: 'x'.repeat(999),
        name: 'y'.repeat(999),
        quantity: 10,
        unit: 'g'.repeat(999),
      })),
      session: {
        steps: Array.from({ length: 100 }, () => ({
          id: 'x'.repeat(999),
          title: 'x'.repeat(999),
          phase: 'x'.repeat(999),
          status: 'x'.repeat(999),
          adds: Array(20).fill('x'.repeat(999)),
        })),
      },
    },
  },
  { ...options, client: looping },
);
assert.equal(calls, 5);
assert.ok(seen.at(-1).input.system[0].text.split('Context: ')[1].length <= 10000);
const template = await readFile(resolve(root, 'infra/template.yaml'), 'utf8');
assert.ok(template.includes('Runtime: nodejs22.x'));
assert.ok(template.includes('BillingMode: PAY_PER_REQUEST'));
assert.ok(template.includes('NoEcho: true'));
assert.ok(template.includes('4135ea2d-6df8-44a3-9df3-4b5a84be39ad'));
assert.ok(template.includes('BlockPublicPolicy: true'));
assert.ok(template.includes('bedrock:InvokeModel'));
assert.ok(!template.includes('bedrock:*'));
assert.ok(!template.includes('AWS::Lambda::Url'));
assert.ok(template.includes("request.headers['x-forwarded-host'] = {value: request.headers.host.value}"));
assert.ok(template.includes('HeaderBehavior: whitelist'));
// MCP is served at /api/mcp, which the /api/{proxy+} route already sends to Lambda.
assert.ok(template.includes("RouteKey: 'ANY /api/{proxy+}'"));
console.log(
  'AWS offline checks passed: agent tool allowlist and argument validation, mocked Converse tool loop limits/context, and infrastructure guardrails.',
);
console.log('CloudFormation deployment validation and live service permissions still require your AWS account.');
