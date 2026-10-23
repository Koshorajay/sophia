import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class ConflictError extends Error {
  constructor() {
    super('Your cooking session changed in another tab. Refresh and try again.');
    this.status = 409;
  }
}

export class StorageUnavailableError extends Error {
  constructor(
    message = 'Household storage is unavailable. Please retry after checking the storage configuration.',
    cause,
  ) {
    super(message, cause ? { cause } : undefined);
    this.status = 503;
  }
}

function validateId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
    throw new TypeError('A valid household session ID is required.');
}
function validateSave(id, state, expectedRevision) {
  validateId(id);
  if (
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0
  ) {
    throw new TypeError('A household record must have a non-negative integer revision.');
  }
  if (
    expectedRevision !== null &&
    (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || state.revision <= expectedRevision)
  ) {
    throw new TypeError('A saved household revision must advance beyond its expected revision.');
  }
}
function validateQuota(key, limit) {
  // Bedrock calls use the date as the key; spoken replies and Gemini use "speech:<date>" and "gemini:<date>".
  const day = typeof key === 'string' ? key.replace(/^(?:speech|gemini):/, '') : '';
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(`${day}T00:00:00.000Z`)) ||
    new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) !== day
  ) {
    throw new TypeError('A valid UTC calendar date is required for the model quota.');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000)
    throw new RangeError('The daily model quota must be an integer from 1 to 10000.');
}

export class MemoryStore {
  constructor() {
    this.records = new Map();
    this.quotas = new Map();
  }
  async get(id) {
    validateId(id);
    const v = this.records.get(id);
    return v ? structuredClone(v) : null;
  }
  async save(id, state, expectedRevision = null) {
    validateSave(id, state, expectedRevision);
    const current = this.records.get(id);
    if (expectedRevision === null ? this.records.has(id) : current?.revision !== expectedRevision)
      throw new ConflictError();
    this.records.set(id, structuredClone(state));
  }
  async consumeQuota(key, limit) {
    validateQuota(key, limit);
    const n = this.quotas.get(key) || 0;
    if (n >= limit) return false;
    this.quotas.set(key, n + 1);
    return true;
  }
}

export class FileStore extends MemoryStore {
  constructor(directory) {
    super();
    this.directory = directory;
    this.file = join(directory, 'state.json');
    this.loaded = null;
    this.pending = Promise.resolve();
  }
  async load() {
    if (!this.loaded)
      this.loaded = (async () => {
        try {
          const raw = JSON.parse(await readFile(this.file, 'utf8'));
          this.records = new Map(Object.entries(raw.records || {}));
          this.quotas = new Map(Object.entries(raw.quotas || {}));
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
      })();
    await this.loaded;
  }
  async persist() {
    await mkdir(this.directory, { recursive: true });
    const temp = join(this.directory, `.${randomUUID()}.tmp`);
    const snapshot = JSON.stringify({
      records: Object.fromEntries(this.records),
      quotas: Object.fromEntries(this.quotas),
    });
    await writeFile(temp, snapshot, { mode: 0o600 });
    await rename(temp, this.file);
  }
  async get(id) {
    await this.load();
    await this.pending;
    return super.get(id);
  }
  async save(id, state, expectedRevision = null) {
    await this.load();
    const work = this.pending.then(async () => {
      const existed = this.records.has(id),
        previous = this.records.get(id);
      try {
        await super.save(id, state, expectedRevision);
        await this.persist();
      } catch (error) {
        if (existed) this.records.set(id, previous);
        else this.records.delete(id);
        throw error;
      }
    });
    this.pending = work.catch(() => {});
    return work;
  }
  async consumeQuota(key, limit) {
    await this.load();
    const work = this.pending.then(async () => {
      const existed = this.quotas.has(key),
        previous = this.quotas.get(key);
      try {
        const result = await super.consumeQuota(key, limit);
        if (result) await this.persist();
        return result;
      } catch (error) {
        if (existed) this.quotas.set(key, previous);
        else this.quotas.delete(key);
        throw error;
      }
    });
    this.pending = work.catch(() => {});
    return work;
  }
}

export class DynamoStore {
  constructor(table, { client, now = Date.now } = {}) {
    if (typeof table !== 'string' || !/^[a-zA-Z0-9_.-]{3,255}$/.test(table))
      throw new TypeError('Configure a valid DynamoDB table name.');
    if (client && typeof client.send !== 'function')
      throw new TypeError('The injected DynamoDB client must provide send().');
    if (typeof now !== 'function') throw new TypeError('The storage clock must be a function.');
    this.table = table;
    this.library = null;
    this.client = client;
    this.now = now;
  }
  async init() {
    // Injected tests instantiate no real service client and never resolve credentials.
    if (!this.library)
      this.library = this.client
        ? import('@aws-sdk/lib-dynamodb').then(doc => ({ ...doc, client: this.client }))
        : Promise.all([import('@aws-sdk/client-dynamodb'), import('@aws-sdk/lib-dynamodb')]).then(([base, doc]) => ({
            ...doc,
            client: doc.DynamoDBDocumentClient.from(new base.DynamoDBClient({ maxAttempts: 2 }), {
              marshallOptions: { removeUndefinedValues: true },
            }),
          }));
    return this.library;
  }
  async get(id) {
    validateId(id);
    try {
      const { client, GetCommand } = await this.init();
      const result = await client.send(
        new GetCommand({ TableName: this.table, Key: { pk: `session#${id}` }, ConsistentRead: true }),
      );
      const item = result.Item;
      if (!item || !Number.isSafeInteger(item.expiresAt) || item.expiresAt <= Math.floor(this.now() / 1000))
        return null;
      const state = JSON.parse(item.data);
      if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision !== item.version)
        throw new Error('Invalid household revision.');
      return state;
    } catch (error) {
      throw new StorageUnavailableError(
        'Saved household data could not be read. Check DynamoDB availability and configuration before retrying.',
        error,
      );
    }
  }
  async save(id, state, expectedRevision = null) {
    validateSave(id, state, expectedRevision);
    const now = Math.floor(this.now() / 1000);
    const condition =
      expectedRevision === null
        ? 'attribute_not_exists(pk) OR expiresAt <= :now'
        : '#version = :expected AND expiresAt > :now';
    try {
      const { client, PutCommand } = await this.init();
      await client.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            pk: `session#${id}`,
            data: JSON.stringify(state),
            version: state.revision,
            expiresAt: now + 86400 * 60,
          },
          ConditionExpression: condition,
          ...(expectedRevision === null
            ? { ExpressionAttributeValues: { ':now': now } }
            : {
                ExpressionAttributeNames: { '#version': 'version' },
                ExpressionAttributeValues: { ':expected': expectedRevision, ':now': now },
              }),
        }),
      );
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') throw new ConflictError();
      throw new StorageUnavailableError(
        'Household changes could not be saved. Check DynamoDB availability and configuration before retrying.',
        err,
      );
    }
  }
  async consumeQuota(key, limit) {
    validateQuota(key, limit);
    try {
      const { client, UpdateCommand } = await this.init();
      await client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: `quota#${key}` },
          UpdateExpression: 'SET expiresAt = :expiry ADD #calls :one',
          ConditionExpression: 'attribute_not_exists(#calls) OR #calls < :limit',
          ExpressionAttributeNames: { '#calls': 'calls' },
          ExpressionAttributeValues: {
            ':expiry': Math.floor(this.now() / 1000) + 86400 * 3,
            ':one': 1,
            ':limit': limit,
          },
        }),
      );
      return true;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return false;
      throw new StorageUnavailableError(
        'The model usage limit could not be checked. No model call should be made; retry after storage is available.',
        err,
      );
    }
  }
}
