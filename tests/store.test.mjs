import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, FileStore, DynamoStore, ConflictError, StorageUnavailableError } from '../src/store.mjs';

const TABLE = 'SophiaTestTable';
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const epoch = NOW / 1000;
const conditionalFailure = () =>
  Object.assign(new Error('Condition failed'), { name: 'ConditionalCheckFailedException' });

/** Atomic, in-process DynamoDB contract double; it has no AWS transport or credentials. */
class MockDynamoClient {
  constructor() {
    this.items = new Map();
    this.calls = [];
    this.failure = null;
  }
  async send(command) {
    const input = command.input,
      kind = command.constructor.name;
    this.calls.push({ kind, input: structuredClone(input) });
    assert.equal(input.TableName, TABLE);
    if (this.failure) throw this.failure;
    if (kind === 'GetCommand') {
      const item = this.items.get(input.Key.pk);
      return item ? { Item: structuredClone(item) } : {};
    }
    if (kind === 'PutCommand') {
      const current = this.items.get(input.Item.pk),
        values = input.ExpressionAttributeValues || {};
      const create = !input.ExpressionAttributeNames?.['#version'];
      if (
        create
          ? current && !(current.expiresAt <= values[':now'])
          : !current || current.version !== values[':expected'] || current.expiresAt <= values[':now']
      )
        throw conditionalFailure();
      this.items.set(input.Item.pk, structuredClone(input.Item));
      return {};
    }
    if (kind === 'UpdateCommand') {
      const current = this.items.get(input.Key.pk),
        values = input.ExpressionAttributeValues;
      if ((current?.calls || 0) >= values[':limit']) throw conditionalFailure();
      this.items.set(input.Key.pk, {
        pk: input.Key.pk,
        calls: (current?.calls || 0) + values[':one'],
        expiresAt: values[':expiry'],
      });
      return {};
    }
    assert.fail(`Unapproved mocked AWS operation: ${kind}`);
  }
}
const dynamo = (client = new MockDynamoClient(), now = () => NOW) => ({
  client,
  store: new DynamoStore(TABLE, { client, now }),
});

test('DynamoDB sessions use the configured table and consistent, isolated reads', async () => {
  const { store, client } = dynamo();
  await store.save('house-a', { revision: 0, value: 'A' });
  await store.save('house-b', { revision: 0, value: 'B' });
  const a = await store.get('house-a');
  a.value = 'mutated outside storage';
  assert.equal((await store.get('house-a')).value, 'A');
  assert.equal((await store.get('house-b')).value, 'B');
  assert.equal(await store.get('unknown'), null);
  assert.ok(client.calls.filter(call => call.kind === 'GetCommand').every(call => call.input.ConsistentRead === true));
  assert.ok(client.calls.every(call => call.input.TableName === TABLE));
  assert.ok([...client.items.keys()].every(key => key.startsWith('session#')));
});

test('DynamoDB refuses expired/missing-TTL records before parsing retained data', async () => {
  const { store, client } = dynamo();
  for (const [id, expiresAt] of [
    ['expired', epoch - 1],
    ['boundary', epoch],
    ['missing', undefined],
    ['string-ttl', String(epoch + 100)],
  ]) {
    client.items.set(`session#${id}`, { pk: `session#${id}`, expiresAt, version: 0, data: 'not valid JSON' });
    assert.equal(await store.get(id), null);
  }
  client.items.set('session#valid', {
    pk: 'session#valid',
    expiresAt: epoch + 1,
    version: 0,
    data: '{"revision":0,"value":"valid"}',
  });
  assert.equal((await store.get('valid')).value, 'valid');
});

test('DynamoDB can recreate an expired session but never overwrite an active insert', async () => {
  const { store, client } = dynamo();
  await store.save('session-a', { revision: 0, value: 'first' });
  await assert.rejects(store.save('session-a', { revision: 0, value: 'lost' }), ConflictError);
  assert.equal((await store.get('session-a')).value, 'first');
  client.items.get('session#session-a').expiresAt = epoch;
  await store.save('session-a', { revision: 0, value: 'fresh' });
  assert.equal((await store.get('session-a')).value, 'fresh');
  assert.equal(client.items.get('session#session-a').expiresAt, epoch + 60 * 86400);
});

test('concurrent DynamoDB writers retain one winner and reject stale revisions', async () => {
  const { store, client } = dynamo();
  const otherProcess = new DynamoStore(TABLE, { client, now: () => NOW });
  await store.save('session-a', { revision: 0, value: 'before' });
  const results = await Promise.allSettled([
    store.save('session-a', { revision: 1, value: 'A' }, 0),
    otherProcess.save('session-a', { revision: 1, value: 'B' }, 0),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.find(r => r.status === 'rejected').reason instanceof ConflictError);
  assert.equal((await store.get('session-a')).value, 'A');
  await assert.rejects(store.save('session-a', { revision: 2, value: 'stale' }, 0), ConflictError);
});

test('a DynamoDB update cannot revive a household that expired during a request', async () => {
  let now = NOW;
  const { store } = dynamo(new MockDynamoClient(), () => now);
  await store.save('session-a', { revision: 0, value: 'before' });
  now += 60 * 86400 * 1000;
  await assert.rejects(store.save('session-a', { revision: 1, value: 'expired writer' }, 0), ConflictError);
  assert.equal(await store.get('session-a'), null);
});

test('DynamoDB model quota uses one atomic conditional update and fails closed', async () => {
  const { store, client } = dynamo();
  const otherProcess = new DynamoStore(TABLE, { client, now: () => NOW });
  const attempts = await Promise.all(
    Array.from({ length: 30 }, (_, i) => (i % 2 ? store : otherProcess).consumeQuota('2026-10-15', 5)),
  );
  assert.equal(attempts.filter(Boolean).length, 5);
  assert.equal(client.items.get('quota#2026-10-15').calls, 5);
  assert.equal(client.items.get('quota#2026-10-15').expiresAt, epoch + 3 * 86400);
  assert.ok(client.calls.every(call => call.kind === 'UpdateCommand'));
  assert.ok(client.calls.every(call => call.input.ConditionExpression && call.input.UpdateExpression));
  assert.equal(await store.consumeQuota('2026-10-16', 5), true);
  assert.equal(client.items.get('quota#2026-10-15').calls, 5);
  client.failure = Object.assign(new Error('DynamoDB unavailable'), { name: 'ServiceUnavailable' });
  await assert.rejects(
    store.consumeQuota('2026-10-15', 5),
    error => error instanceof StorageUnavailableError && error.status === 503,
  );
});

test('DynamoDB validation rejects invalid quota, IDs, and revisions before any transport', async () => {
  const { store, client } = dynamo();
  for (const limit of [0, -1, 1.5, Infinity, NaN, '2', 10001])
    await assert.rejects(store.consumeQuota('2026-10-15', limit));
  for (const key of ['2026-02-30', 'today', '2026-10-15#other']) await assert.rejects(store.consumeQuota(key, 5));
  for (const id of ['', 'quota#2026-10-15', '../other', null]) await assert.rejects(store.get(id));
  await assert.rejects(store.save('session-a', { revision: -1 }));
  await assert.rejects(store.save('session-a', { revision: 1 }, 1));
  await assert.rejects(store.save('session-a', { revision: 2 }, -1));
  assert.equal(client.calls.length, 0);
  assert.throws(() => new DynamoStore('arn:aws:dynamodb:some-other-table'));
  assert.throws(() => new DynamoStore(TABLE, { client: {} }));
});

test('DynamoDB service errors are unavailable errors, not empty households or quota success', async () => {
  const { store, client } = dynamo();
  client.failure = Object.assign(new Error('Access denied'), { name: 'AccessDeniedException' });
  for (const operation of [
    () => store.get('session-a'),
    () => store.save('session-a', { revision: 0 }),
    () => store.consumeQuota('2026-10-15', 5),
  ]) {
    await assert.rejects(
      operation(),
      error => error instanceof StorageUnavailableError && error.status === 503 && error.cause === client.failure,
    );
  }
  client.failure = null;
  client.items.set('session#session-a', {
    pk: 'session#session-a',
    expiresAt: epoch + 20,
    version: 2,
    data: '{"revision":1}',
  });
  await assert.rejects(store.get('session-a'), StorageUnavailableError);
});

test('MemoryStore matches conditional insert and monotonic revision semantics', async () => {
  const store = new MemoryStore();
  await store.save('a', { revision: 0, value: 'original' });
  await assert.rejects(store.save('a', { revision: 0, value: 'overwrite' }), ConflictError);
  await assert.rejects(store.save('a', { revision: 0, value: 'same version' }, 0));
  await store.save('a', { revision: 1, value: 'updated' }, 0);
  await assert.rejects(store.save('a', { revision: 2, value: 'stale' }, 0), ConflictError);
  assert.equal((await store.get('a')).value, 'updated');
  await assert.rejects(store.consumeQuota('2026-10-15', 0));
  const attempts = await Promise.all(Array.from({ length: 10 }, () => store.consumeQuota('2026-10-15', 3)));
  assert.equal(attempts.filter(Boolean).length, 3);
});

test('FileStore rolls back failed saves and readers wait for durable outcome', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sophia-store-test-'));
  try {
    const store = new FileStore(dir);
    await store.save('a', { revision: 0, value: 'original' });
    const before = await readFile(join(dir, 'state.json'), 'utf8');
    const originalPersist = store.persist.bind(store);
    let signalStarted, release;
    const started = new Promise(resolve => {
      signalStarted = resolve;
    });
    const gate = new Promise(resolve => {
      release = resolve;
    });
    store.persist = async () => {
      signalStarted();
      await gate;
      throw new Error('simulated disk failure');
    };
    const write = store.save('a', { revision: 1, value: 'uncommitted' }, 0);
    await started;
    let readSettled = false;
    const read = store.get('a').then(value => {
      readSettled = true;
      return value;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readSettled, false);
    release();
    await assert.rejects(write, /disk failure/);
    assert.equal((await read).value, 'original');
    assert.equal(await readFile(join(dir, 'state.json'), 'utf8'), before);
    store.persist = originalPersist;
    await store.save('a', { revision: 1, value: 'saved' }, 0);
    assert.equal((await new FileStore(dir).get('a')).value, 'saved');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FileStore failed inserts/quotas leave no phantom state and allow a later retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sophia-store-test-'));
  try {
    const store = new FileStore(dir);
    await store.save('a', { revision: 0, value: 'existing' });
    const originalPersist = store.persist.bind(store);
    store.persist = async () => {
      throw new Error('simulated disk full');
    };
    await assert.rejects(store.save('b', { revision: 0, value: 'phantom' }), /disk full/);
    assert.equal(await store.get('b'), null);
    await assert.rejects(store.consumeQuota('2026-10-15', 1), /disk full/);
    assert.equal(store.quotas.has('2026-10-15'), false);
    store.persist = originalPersist;
    assert.equal(await store.consumeQuota('2026-10-15', 1), true);
    assert.equal(await store.consumeQuota('2026-10-15', 1), false);
    assert.equal((await new FileStore(dir).get('a')).value, 'existing');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
