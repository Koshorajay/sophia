import test from 'node:test';
import assert from 'node:assert/strict';
import { createLambdaHandler } from '../lambda.mjs';
import { createApplication } from '../src/app.mjs';
import { MemoryStore } from '../src/store.mjs';

const make = env =>
  createLambdaHandler(createApplication({ store: new MemoryStore(), env: { SOPHIA_PROVIDER: 'demo', ...env } }));
const event = (method, path, body, cookies = []) => ({
  rawPath: path,
  requestContext: { http: { method, sourceIp: 'test' } },
  headers: { host: 'preview.example', 'x-forwarded-proto': 'https' },
  cookies,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test('HTTP API v2 cookie responses are separate, secure, and persist kitchen state', async () => {
  const handler = make();
  const initial = await handler(event('GET', '/api/state'));
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.headers['set-cookie'], undefined);
  assert.match(initial.cookies[0], /HttpOnly/);
  assert.match(initial.cookies[0], /Secure/);
  const cookies = [initial.cookies[0].split(';')[0]];
  const saved = await handler(event('POST', '/api/pantry', { id: 'rice', quantity: 456, revision: 0 }, cookies));
  assert.equal(saved.statusCode, 200);
  const loaded = await handler(event('GET', '/api/state', undefined, cookies));
  assert.equal(JSON.parse(loaded.body).state.pantry.find(x => x.id === 'rice').quantity, 456);
});

test('base64 requests are decoded and malformed JSON remains a readable JSON error', async () => {
  const handler = make();
  const initial = await handler(event('GET', '/api/state'));
  const e = event('POST', '/api/pantry', { id: 'rice', quantity: 123 }, [initial.cookies[0].split(';')[0]]);
  e.body = Buffer.from(e.body).toString('base64');
  e.isBase64Encoded = true;
  assert.equal((await handler(e)).statusCode, 200);
  e.body = Buffer.from('{bad').toString('base64');
  const bad = await handler(e);
  assert.equal(bad.statusCode, 400);
  assert.match(JSON.parse(bad.body).error, /JSON/);
});

test('deployed access gate cannot be bypassed by a public state call', async () => {
  const handler = make({ SOPHIA_ACCESS_CODE: 'unit-test-only-secret' });
  assert.equal((await handler(event('GET', '/api/state'))).statusCode, 401);
  const unlocked = await handler(event('POST', '/api/unlock', { accessCode: 'unit-test-only-secret' }));
  assert.equal(unlocked.statusCode, 200);
  const cookies = [unlocked.cookies[0].split(';')[0]];
  assert.equal((await handler(event('GET', '/api/state', undefined, cookies))).statusCode, 200);
});

test('without CloudFront, Lambda serves the web app files and keeps API routes separate', async () => {
  const { createLambdaHandler } = await import('../lambda.mjs');
  const { createApplication } = await import('../src/app.mjs');
  const { MemoryStore } = await import('../src/store.mjs');
  const handler = createLambdaHandler(
    createApplication({ store: new MemoryStore(), env: { SOPHIA_PROVIDER: 'demo' } }),
  );
  const event = path => ({
    rawPath: path,
    requestContext: { http: { method: 'GET', sourceIp: '1.2.3.4' } },
    headers: { host: 'x' },
  });

  const page = await handler(event('/'));
  assert.equal(page.statusCode, 200);
  assert.equal(page.isBase64Encoded, true);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(Buffer.from(page.body, 'base64').toString('utf8'), /<div id="app">/);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);

  const script = await handler(event('/app.js'));
  assert.equal(script.statusCode, 200);
  assert.match(script.headers['cache-control'], /max-age=300/);

  assert.equal((await handler(event('/../package.json'))).statusCode, 403);
  assert.equal((await handler(event('/%2e%2e/package.json'))).statusCode, 403);
  assert.equal((await handler(event('/missing.css'))).statusCode, 404);

  const api = await handler(event('/api/state'));
  assert.equal(api.statusCode, 200);
  assert.ok(JSON.parse(api.body).state);
});
