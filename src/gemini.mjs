/** Optional Google Gemini agent, used only when the cook switches it on in the chat.
 * Same tools, same rules and same kitchen engine as the Bedrock agent: the model may only request tools. */
import { compactContext, conversation, INSTRUCTION } from './bedrock.mjs';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_TOOL_ROUNDS = 4;
const MAX_TOOLS_PER_ROUND = 4;
const MAX_TOOL_RESULT = 4000;
// Gemini accepts a subset of JSON Schema for function parameters. The engine still validates every argument.
const SCHEMA_KEYS = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'minimum', 'maximum']);

export function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => SCHEMA_KEYS.has(key))
      .map(([key, value]) => [
        key,
        key === 'properties'
          ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, geminiSchema(item)]))
          : geminiSchema(value),
      ]),
  );
}

export function geminiTools(tools = []) {
  return [
    {
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: geminiSchema(tool.inputSchema),
      })),
    },
  ];
}

/** Recent turns in Gemini's format (assistant turns are "model"), ending with the new message. */
export function geminiContents(history = [], message = '') {
  return conversation(history, message).map(turn => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.content[0].text }],
  }));
}

const clipped = (value, length) => (typeof value === 'string' ? value.slice(0, length) : '');
const bounded = (value, min, max, fallback) =>
  Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback;
const failure = (message, cause) => Object.assign(new Error(message), { status: 502, cause });

/**
 * Gemini function-calling loop: up to MAX_TOOL_ROUNDS rounds of model-requested tools, then a final reply.
 * execute(name, input) runs one tool and returns its result, or throws to report a refusal to the model.
 * beforeCall() runs before every model call (the application reserves its daily quota there).
 */
export async function runGeminiAgent(
  message,
  { context = {}, history = [], tools = [], execute, beforeCall } = {},
  options = {},
) {
  if (typeof message !== 'string' || !message.trim()) throw new Error('Enter a cooking request.');
  if (typeof execute !== 'function') throw new TypeError('The Gemini agent needs a tool executor.');
  const apiKey = options.apiKey;
  const model = options.model || 'gemini-3.5-flash-lite';
  if (!apiKey) throw failure('Gemini is not configured on this server.');
  if (!/^[a-z0-9.\-]+$/.test(model)) throw failure('The configured Gemini model name is invalid.');
  const fetchImpl = options.fetch || fetch;
  const perCall = bounded(options.timeoutMs, 1000, 20000, 12000);
  const deadline = Date.now() + bounded(options.totalTimeoutMs, 2000, 22000, 21000);
  const allowed = new Set(tools.map(tool => tool.name));
  const body = {
    systemInstruction: {
      parts: [{ text: `${INSTRUCTION}\nContext: ${JSON.stringify(compactContext(context, message))}` }],
    },
    contents: geminiContents(history, message.trim()),
    tools: geminiTools(tools),
    generationConfig: { temperature: 0, maxOutputTokens: bounded(options.maxTokens, 100, 1000, 600) },
  };
  const usage = { inputTokens: 0, outputTokens: 0 },
    toolCalls = [];
  for (let round = 0; ; round++) {
    await beforeCall?.();
    const remaining = deadline - Date.now();
    if (remaining < 500) throw failure('Gemini timed out. Your cooking state was not advanced.');
    let response, data;
    try {
      response = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(perCall, remaining)),
      });
      data = await response.json().catch(() => ({}));
    } catch (error) {
      throw failure(
        error.name === 'TimeoutError' || error.name === 'AbortError'
          ? 'Gemini timed out. Your cooking state was not advanced.'
          : 'Gemini could not be reached.',
        error,
      );
    }
    if (!response.ok) {
      const busy = response.status === 429 || response.status === 503;
      throw failure(
        busy ? 'Gemini is busy or out of free quota right now. Try again shortly.' : 'Gemini refused the request.',
        Object.assign(new Error(clipped(data?.error?.message, 300) || `HTTP ${response.status}`), {
          name: `Gemini${response.status}`,
        }),
      );
    }
    usage.inputTokens += bounded(data?.usageMetadata?.promptTokenCount, 0, 1000000, 0);
    usage.outputTokens += bounded(data?.usageMetadata?.candidatesTokenCount, 0, 1000000, 0);
    const content = data?.candidates?.[0]?.content || { role: 'model', parts: [] };
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const calls = parts.filter(part => part?.functionCall);
    if (!calls.length || round >= MAX_TOOL_ROUNDS) {
      const reply = parts
        .filter(part => typeof part?.text === 'string' && !part.thought)
        .map(part => part.text)
        .join('')
        .trim();
      return { reply: clipped(reply, 1000), usage, toolCalls, provider: 'gemini' };
    }
    // Send the model turn back unchanged (it may carry thought signatures the API requires).
    body.contents.push({ role: 'model', parts });
    const responses = [];
    for (const [index, { functionCall }] of calls.entries()) {
      let output;
      if (index >= MAX_TOOLS_PER_ROUND) output = { error: 'Too many tool calls at once; this one was skipped.' };
      else if (!allowed.has(functionCall.name))
        output = { error: `There is no tool named ${String(functionCall.name).slice(0, 60)}. Nothing was changed.` };
      else {
        try {
          output = await execute(functionCall.name, functionCall.args ?? {});
          toolCalls.push({ name: functionCall.name, ok: true });
        } catch (error) {
          output = { error: String(error?.message || 'The kitchen engine refused this action.').slice(0, 500) };
          toolCalls.push({ name: functionCall.name, ok: false });
        }
      }
      let text = JSON.stringify(output ?? {});
      if (text.length > MAX_TOOL_RESULT) text = `${text.slice(0, MAX_TOOL_RESULT)} …(truncated)`;
      responses.push({
        functionResponse: {
          ...(functionCall.id ? { id: functionCall.id } : {}),
          name: functionCall.name,
          response: { result: text },
        },
      });
    }
    body.contents.push({ role: 'user', parts: responses });
  }
}
