import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { createLambdaHandler } from '../lambda.mjs';
import { createApplication } from '../src/app.mjs';
import { MemoryStore } from '../src/store.mjs';
import { catalog, createSeedState } from '../src/data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = [
  'search_recipes',
  'get_kitchen_state',
  'plan_meal',
  'complete_current_step',
  'alter_portion',
  'finish_meal',
  'cancel_meal',
  'update_pantry',
  'forecast_groceries',
  'check_pantry',
  'add_to_shopping_list',
  'update_shopping_list',
  'save_tastes',
];

/** Run the real server.mjs on a free port with its own temporary data directory. */
async function startServer(env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sophia-mcp-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SOPHIA_PROVIDER: 'demo',
      SOPHIA_DATA_DIR: dir,
      PORT: '0',
      SOPHIA_TABLE: '',
      SOPHIA_ACCESS_CODE: '',
      ...env,
    },
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    const read = chunk => {
      output += chunk;
      const match = /localhost:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Server exited (${code}): ${output}`));
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    dir,
    async stop() {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function connect(url, headers) {
  const client = new Client({ name: 'sophia-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL('/api/mcp', url),
    headers ? { requestInit: { headers } } : undefined,
  );
  await client.connect(transport);
  return { client, transport };
}
const ok = result => {
  assert.ok(!result.isError, result.content?.[0]?.text);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
};
const refused = result => {
  assert.equal(result.isError, true);
  return result.content[0].text;
};

let server;
const clients = [];
before(async () => {
  server = await startServer();
});
after(async () => {
  for (const client of clients) await client.close();
  await server?.stop();
});
async function session(headers) {
  const connection = await connect(server.url, headers);
  clients.push(connection.client);
  return connection;
}

test('initialize negotiates protocol 2025-11-25 over Streamable HTTP and lists every kitchen tool', async () => {
  const { client, transport } = await session();
  assert.equal(LATEST_PROTOCOL_VERSION, '2025-11-25');
  assert.equal(transport.protocolVersion, '2025-11-25');
  assert.equal(client.getServerVersion().name, 'sophia-kitchen');
  assert.match(transport.sessionId, /^[0-9a-f-]{36}$/);
  assert.match(client.getInstructions(), /householdId/);
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map(tool => tool.name),
    TOOLS,
  );
  for (const tool of tools) {
    assert.ok(tool.description.length > 80, tool.name);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.properties.householdId.type, 'string');
  }
  const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
  for (const name of ['search_recipes', 'get_kitchen_state', 'forecast_groceries'])
    assert.equal(byName[name].annotations.readOnlyHint, true);
  assert.equal(byName.cancel_meal.annotations.destructiveHint, true);
  assert.deepEqual(byName.plan_meal.inputSchema.required, ['dishId']);
});

test('tools/call drives a whole meal through the engine and saves it in the session household', async () => {
  const { client, transport } = await session();
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const start = ok(await call('get_kitchen_state'));
  assert.deepEqual(
    start.household.map(p => p.name),
    ['Asha', 'Ravi', 'Noor'],
  );
  assert.equal(start.meal, null);
  assert.equal(start.confirmedCookedMeals, 10);
  const dal = catalog.find(d => d.id === 'dal-tadka'),
    finishes = dal.variants.map(v => v.id);
  const found = ok(await call('search_recipes', { query: 'dal' }));
  assert.deepEqual(
    found.recipes.find(r => r.id === 'dal-tadka').variants.map(v => v.id),
    finishes,
  );
  let state = ok(await call('plan_meal', { dishId: 'dal-tadka' }));
  const preferred = createSeedState().household.map(p =>
    finishes.includes(p.preference) ? p.preference : dal.defaultVariant,
  );
  assert.deepEqual(
    state.kitchen.meal.portions.map(p => p.variant),
    preferred,
  );
  // Switch Asha by the finish's label, as a person would say it.
  const other = dal.variants.find(v => v.id !== preferred[0]);
  state = ok(await call('alter_portion', { portionName: 'Asha', variant: other.label }));
  assert.deepEqual(
    state.kitchen.meal.portions.map(p => p.variant),
    [other.id, ...preferred.slice(1)],
  );
  assert.match(refused(await call('complete_current_step', { stepId: 'split-portions' })), /Nothing was changed/);
  assert.match(refused(await call('plan_meal', { dishId: 'pasta' })), /Finish or cancel/);
  let current = state.kitchen.meal.currentStep;
  while (current) {
    if (current.phase === 'finish') assert.equal(state.kitchen.meal.splitConfirmed, true);
    else assert.match(refused(await call('finish_meal')), /Confirm every cooking step/);
    state = ok(await call('complete_current_step', { stepId: current.id }));
    assert.equal(state.completedStep.id, current.id);
    current = state.kitchen.meal.currentStep;
  }
  state = ok(await call('finish_meal'));
  assert.equal(state.kitchen.confirmedCookedMeals, 11);
  assert.equal(state.kitchen.meal.status, 'completed');
  assert.match(ok(await call('finish_meal')).message, /already recorded/);
  assert.match(refused(await call('cancel_meal')), /already confirmed cooked/);
  assert.equal(ok(await call('forecast_groceries', { weeks: 2 })).forecast.historyCount, 11);
  const pantry = ok(
    await call('update_pantry', {
      items: [
        { ingredient: 'Dry rice', quantity: 500 },
        { ingredient: 'eggs', quantity: 12 },
      ],
    }),
  );
  assert.deepEqual(
    pantry.updated.map(item => [item.id, item.quantity]),
    [
      ['rice', 500],
      ['egg', 12],
    ],
  );
  const saved = JSON.parse(await readFile(join(server.dir, 'state.json'), 'utf8')).records[pantry.householdId];
  assert.equal(pantry.householdId, `mcp-${transport.sessionId}`);
  assert.equal(saved.history.length, 11);
  assert.equal(saved.pantry.find(item => item.id === 'rice').quantity, 500);
});

test('households are per session by default, shared by householdId, and refusals are tool errors', async () => {
  const a = (await session()).client,
    b = (await session()).client;
  const planned = ok(
    await a.callTool({
      name: 'plan_meal',
      arguments: { dishId: 'pasta', portions: [{ name: 'Mira', variant: 'cheese' }] },
    }),
  );
  assert.equal(ok(await b.callTool({ name: 'get_kitchen_state', arguments: {} })).meal, null);
  const shared = ok(await b.callTool({ name: 'get_kitchen_state', arguments: { householdId: planned.householdId } }));
  assert.equal(shared.meal.dishId, 'pasta');
  assert.equal(shared.householdId, planned.householdId);
  assert.match(
    ok(await b.callTool({ name: 'cancel_meal', arguments: { householdId: planned.householdId } })).message,
    /Cancelled Tomato pasta/,
  );
  assert.equal(ok(await a.callTool({ name: 'get_kitchen_state', arguments: {} })).meal, null);
  assert.match(
    refused(await b.callTool({ name: 'get_kitchen_state', arguments: { householdId: '../state' } })),
    /householdId/,
  );
  assert.match(
    refused(await b.callTool({ name: 'plan_meal', arguments: { dishId: 'pasta', servings: 'four' } })),
    /servings must be a whole number/,
  );
  assert.match(
    refused(await b.callTool({ name: 'plan_meal', arguments: { dishId: 'birthday cake' } })),
    /search_recipes/,
  );
  await assert.rejects(b.callTool({ name: 'delete_household', arguments: {} }), /Unknown tool/);
  // The web app reports its household id, so an MCP client can cook in the same kitchen.
  const web = await fetch(`${server.url}/api/state`);
  const cookie = web.headers.get('set-cookie').split(';')[0],
    { householdId } = await web.json();
  ok(await b.callTool({ name: 'plan_meal', arguments: { dishId: 'poha', householdId } }));
  const seen = await (await fetch(`${server.url}/api/state`, { headers: { cookie } })).json();
  assert.equal(seen.state.session.dishId, 'poha');
});

test('the endpoint answers POST only, from its own origin, with JSON-RPC errors for bad input', async () => {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
  assert.equal((await fetch(`${server.url}/api/mcp`)).status, 405);
  assert.equal((await fetch(`${server.url}/api/mcp`, { method: 'DELETE' })).status, 405);
  assert.equal(
    (
      await fetch(`${server.url}/api/mcp`, {
        method: 'POST',
        headers: { ...headers, origin: 'https://evil.example' },
        body: ping,
      })
    ).status,
    403,
  );
  const malformed = await fetch(`${server.url}/api/mcp`, { method: 'POST', headers, body: '{nope' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, -32700);
  const pong = await fetch(`${server.url}/api/mcp`, {
    method: 'POST',
    headers: { ...headers, 'mcp-protocol-version': '2025-11-25' },
    body: ping,
  });
  assert.equal(pong.status, 200);
  assert.deepEqual((await pong.json()).result, {});
  // /mcp is a local alias of /api/mcp.
  const alias = await fetch(`${server.url}/mcp`, {
    method: 'POST',
    headers: { ...headers, 'mcp-protocol-version': '2025-11-25' },
    body: ping,
  });
  assert.equal(alias.status, 200);
  assert.deepEqual((await alias.json()).result, {});
});

test('with SOPHIA_ACCESS_CODE set, MCP needs the code as a bearer token or the signed web session cookie', async () => {
  const locked = await startServer({ SOPHIA_ACCESS_CODE: 'test-only-access-code' });
  try {
    await assert.rejects(connect(locked.url));
    await assert.rejects(connect(locked.url, { Authorization: 'Bearer wrong-code' }));
    await assert.rejects(
      connect(locked.url, {
        cookie: 'sophia_session=00000000-0000-0000-0000-000000000000.9999999999.' + '0'.repeat(64),
      }),
    );
    const bearer = await connect(locked.url, { Authorization: 'Bearer test-only-access-code' });
    assert.equal((await bearer.client.listTools()).tools.length, TOOLS.length);
    await bearer.client.close();
    assert.equal((await fetch(`${locked.url}/api/state`)).status, 401);
    // The browser's signed cookie also authorizes MCP and selects that browser's household.
    const unlocked = await fetch(`${locked.url}/api/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessCode: 'test-only-access-code' }),
    });
    const cookie = unlocked.headers.get('set-cookie').split(';')[0];
    const { householdId } = await (await fetch(`${locked.url}/api/state`, { headers: { cookie } })).json();
    const web = await connect(locked.url, { cookie });
    const planned = ok(await web.client.callTool({ name: 'plan_meal', arguments: { dishId: 'pasta' } }));
    assert.equal(planned.householdId, householdId);
    await web.client.close();
    assert.equal(
      (await (await fetch(`${locked.url}/api/state`, { headers: { cookie } })).json()).state.session.dishId,
      'pasta',
    );
  } finally {
    await locked.stop();
  }
});

test('Lambda serves the same stateless MCP endpoint and maps the session id to a household', async () => {
  const handler = createLambdaHandler(
    createApplication({ store: new MemoryStore(), env: { SOPHIA_PROVIDER: 'demo' } }),
  );
  const post = (message, headers = {}) =>
    handler({
      rawPath: '/api/mcp',
      requestContext: { http: { method: 'POST', sourceIp: 'test' } },
      headers: {
        host: 'api.example',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(message),
    });
  const init = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'lambda-test', version: '1' } },
  });
  assert.equal(init.statusCode, 200);
  assert.equal(JSON.parse(init.body).result.protocolVersion, '2025-11-25');
  const sessionId = init.headers['mcp-session-id'];
  assert.match(sessionId, /^[0-9a-f-]{36}$/);
  const next = { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' };
  assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, next)).statusCode, 202);
  const listed = JSON.parse((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, next)).body);
  assert.deepEqual(
    listed.result.tools.map(tool => tool.name),
    TOOLS,
  );
  const planned = JSON.parse(
    (
      await post(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'plan_meal', arguments: { dishId: 'fried-rice' } },
        },
        next,
      )
    ).body,
  );
  assert.equal(planned.result.structuredContent.householdId, `mcp-${sessionId}`);
  const again = JSON.parse(
    (
      await post(
        { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_kitchen_state', arguments: {} } },
        next,
      )
    ).body,
  );
  assert.deepEqual(
    again.result.structuredContent.meal.portions.map(p => p.variant),
    ['mild', 'spicy', 'egg'],
  );
});
