/** Sophia as an MCP server (Streamable HTTP, protocol 2025-11-25).
 * Stateless: every POST builds a fresh server, so the same handler runs in Node and in Lambda.
 * Tool calls go through the application's household transaction (lock, load, engine, revision-checked save).
 */
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { kitchenTools, hasKitchenTool, runKitchenTool } from './tools.mjs';

const HOUSEHOLD_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SESSION_ID = /^[A-Za-z0-9-]{16,100}$/;
const SHARED_HOUSEHOLD = 'mcp-shared';
const INSTRUCTIONS = `Sophia is a household cooking assistant. The kitchen engine is the only authority over state: it orders shared steps, enforces a split checkpoint before any per-person finish, refuses to remove an ingredient that was already added, and records a meal as cooked only once.
Typical flow: get_kitchen_state, then search_recipes, then plan_meal, then complete_current_step each time the user says a step is done, then finish_meal. Use alter_portion for one person's change, cancel_meal only when the user asks to abandon the meal, update_pantry for stock the user confirms, and forecast_groceries for shopping estimates.
Each MCP session gets its own demo household (three people with saved preferences and sample cooking history); a request that carries the web app's session cookie uses that browser's household. Pass householdId to any tool to work on a specific household, for example the one the web app reports as householdId at /api/state.`;

const householdIdSchema = {
  type: 'string',
  maxLength: 100,
  description:
    "Optional household to act on. Defaults to this MCP session's household, or the web session's when its cookie is sent.",
};
const tools = kitchenTools.map(tool => ({
  ...tool,
  inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, householdId: householdIdSchema } },
}));
const reply = (status, value, headers = {}) => ({
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  },
  body: value === undefined ? '' : JSON.stringify(value),
});
const rpcError = (status, code, message, headers) =>
  reply(status, { jsonrpc: '2.0', error: { code, message }, id: null }, headers);
const toolResult = (value, isError = false) => ({
  content: [{ type: 'text', text: isError ? value : JSON.stringify(value) }],
  ...(isError ? { isError: true } : { structuredContent: value }),
});

/**
 * household(id, fn) runs fn(state, save) inside the application's per-household transaction.
 * verifyAccessCode(token) is true when no access code is configured or the token matches it.
 * A request is authorized by a bearer access code or by the web app's signed session cookie (cookieHousehold).
 */
export function createMcpHandler({ household, verifyAccessCode, requireAccessCode = false, version = '0.1.0' }) {
  const failures = new Map();

  async function callTool({ name, arguments: args = {} }, defaultHousehold) {
    if (!hasKitchenTool(name)) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    const { householdId, ...input } = args || {};
    if (
      householdId !== undefined &&
      householdId !== null &&
      (typeof householdId !== 'string' || !HOUSEHOLD_ID.test(householdId))
    ) {
      return toolResult(
        'householdId must be 1-100 letters, digits, hyphens or underscores. Nothing was changed.',
        true,
      );
    }
    const id = householdId || defaultHousehold;
    try {
      return toolResult(
        await household(id, async (state, save) => {
          const outcome = runKitchenTool(name, state, input);
          if (outcome.state) await save(outcome.state);
          return { householdId: id, ...outcome.result };
        }),
      );
    } catch (err) {
      return toolResult(err.message || 'Sophia could not complete that tool call. Nothing was changed.', true);
    }
  }

  function buildServer(defaultHousehold) {
    const server = new Server(
      { name: 'sophia-kitchen', title: 'Sophia Kitchen', version },
      { capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async request => callTool(request.params, defaultHousehold));
    return server;
  }

  return async function handleMcp({ method = 'GET', headers = {}, body, ip = 'local', cookieHousehold = null }) {
    if (requireAccessCode && !cookieHousehold) {
      const now = Date.now(),
        prior = failures.get(ip);
      if (prior && now - prior.start < 60000 && prior.count >= 10)
        return rpcError(429, -32000, 'Too many failed attempts. Wait a minute and try again.');
      const token = /^Bearer\s+(.+)$/i.exec(headers.authorization || '')?.[1]?.trim();
      if (!token || !verifyAccessCode(token)) {
        failures.set(
          ip,
          prior && now - prior.start < 60000
            ? { start: prior.start, count: prior.count + 1 }
            : { start: now, count: 1 },
        );
        return rpcError(
          401,
          -32001,
          'Send the Sophia access code as a bearer token (Authorization: Bearer <code>) or the web app session cookie.',
          { 'www-authenticate': 'Bearer realm="sophia"' },
        );
      }
    }
    // Sophia answers every request with JSON and never opens a server-initiated SSE stream or ends sessions on request.
    if (method !== 'POST')
      return rpcError(405, -32000, 'Method not allowed. Send JSON-RPC messages with POST.', { allow: 'POST' });
    let message;
    try {
      message = typeof body === 'string' ? JSON.parse(body) : body;
    } catch {
      return rpcError(400, -32700, 'Parse error: the body must be JSON.');
    }

    const incoming = headers['mcp-session-id'];
    if (incoming !== undefined && !SESSION_ID.test(incoming))
      return rpcError(404, -32001, 'Session not found. Initialize a new MCP session.');
    const initializing = !Array.isArray(message) && message?.method === 'initialize';
    // The session id maps to a household, so it works across Lambda instances without server memory.
    const sessionId = initializing ? randomUUID() : incoming;
    const defaultHousehold = cookieHousehold || (sessionId ? `mcp-${sessionId}` : SHARED_HOUSEHOLD);

    const forwarded = new Headers();
    for (const [key, value] of Object.entries(headers))
      if (value !== undefined) forwarded.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    forwarded.set('accept', 'application/json, text/event-stream');
    const server = buildServer(defaultHousehold);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(
        new Request('http://localhost/mcp', { method: 'POST', headers: forwarded }),
        { parsedBody: message },
      );
      const result = reply(response.status, undefined, {
        ...Object.fromEntries(response.headers),
        ...(initializing && response.ok ? { 'mcp-session-id': sessionId } : {}),
      });
      result.body = await response.text();
      return result;
    } finally {
      await server.close();
    }
  };
}
