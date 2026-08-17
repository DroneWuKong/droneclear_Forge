import assert from 'node:assert/strict';
import test from 'node:test';

import router from '../workers/index.js';

class MockKV {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
    this.puts = [];
  }

  async get(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  async put(key, value) {
    this.values.set(key, value);
    this.puts.push({ key, value });
  }

  async list({ prefix = '', limit = 100, cursor } = {}) {
    const offset = Number.parseInt(cursor || '0', 10) || 0;
    const names = [...this.values.keys()]
      .filter((name) => name.startsWith(prefix))
      .sort();
    const selected = names.slice(offset, offset + limit);
    const next = offset + selected.length;
    const listComplete = next >= names.length;
    return {
      keys: selected.map((name) => ({ name })),
      list_complete: listComplete,
      ...(listComplete ? {} : { cursor: String(next) }),
    };
  }
}

function env(overrides = {}) {
  const pie = new MockKV({
    forge_database: JSON.stringify({ meta: { generated_at: '2026-08-12T00:00:00Z' }, parts: [1] }),
    alpha: JSON.stringify({ value: 1 }),
    'prefix/one': JSON.stringify({ value: 2 }),
  });
  return {
    PIE_DB: pie,
    PIE_OUTPUTS: new MockKV(),
    PARTS_DB: new MockKV(),
    PROCUREMENT_DB: new MockKV(),
    GRAYZONE_DB: new MockKV(),
    PIE_HISTORY: new MockKV(),
    PRIVATE_API_KEY: 'test-private-key',
    PRIVATE_API_ALLOWED_ORIGINS: 'https://admin.example',
    ...overrides,
  };
}

async function call(path, options = {}, bindings = env()) {
  const request = new Request(`https://uas-patterns.com${path}`, options);
  return router.fetch(request, bindings, { waitUntil() {} });
}

async function body(response) {
  return JSON.parse(await response.text());
}

function authHeaders(extra = {}) {
  return { Authorization: 'Bearer test-private-key', ...extra };
}

test('public v1 discovery is versioned, read-only, and open CORS', async () => {
  const response = await call('/api/v1');
  const value = await body(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('api-version'), '1');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(value.access, 'public-read-only');
  assert.ok(value.dataset_count >= 50);

  const rejected = await call('/api/v1', { method: 'POST' });
  assert.equal(rejected.status, 405);
});

test('public dataset listing and exact dataset reads use the curated allowlist', async () => {
  const listing = await call('/api/v1/datasets');
  const listed = await body(listing);
  assert.equal(listing.status, 200);
  assert.ok(listed.data.some((row) => row.id === 'forge_database'));

  const response = await call('/api/v1/datasets/forge_database');
  const value = await body(response);
  assert.equal(response.status, 200);
  assert.equal(value.type, 'forge_database');
  assert.deepEqual(value.data.parts, [1]);

  const unknown = await call('/api/v1/datasets/not_private_data');
  assert.equal(unknown.status, 404);
});

test('public OpenAPI contract is discoverable', async () => {
  const response = await call('/api/v1/openapi.json');
  const value = await body(response);
  assert.equal(response.status, 200);
  assert.equal(value.openapi, '3.1.0');
  assert.ok(value.paths['/api/v1/datasets/{dataset}']);
});

test('private API fails closed when its secret is missing or wrong', async () => {
  const notConfigured = await call(
    '/api/private/v1',
    { headers: authHeaders() },
    env({ PRIVATE_API_KEY: undefined }),
  );
  assert.equal(notConfigured.status, 503);

  const unauthorized = await call('/api/private/v1', {
    headers: { Authorization: 'Bearer wrong-key' },
  });
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('www-authenticate'), /^Bearer /);
  assert.equal(unauthorized.headers.get('access-control-allow-origin'), null);
});

test('private API never emits wildcard CORS and only allows configured origins', async () => {
  const allowed = await call('/api/private/v1', {
    headers: authHeaders({ Origin: 'https://admin.example' }),
  });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://admin.example');

  const blocked = await call('/api/private/v1', {
    headers: authHeaders({ Origin: 'https://evil.example' }),
  });
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);

  const preflight = await call('/api/private/v1', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
});

test('private namespace inventory excludes non-database and PII bindings', async () => {
  const response = await call('/api/private/v1/namespaces', {
    headers: authHeaders(),
  });
  const value = await body(response);
  assert.equal(response.status, 200);
  assert.deepEqual(
    value.data.map((row) => row.name),
    ['pie', 'outputs', 'parts', 'procurement', 'grayzone', 'history'],
  );
  assert.equal(value.data.some((row) => row.binding === 'DIGEST_SUBS'), false);

  const rejected = await call('/api/private/v1/namespaces', {
    method: 'POST',
    headers: authHeaders(),
  });
  assert.equal(rejected.status, 405);
});

test('private API lists keys with bounded pagination and reads exact keys', async () => {
  const listing = await call('/api/private/v1/datasets/pie?prefix=prefix/&limit=1', {
    headers: authHeaders(),
  });
  const listed = await body(listing);
  assert.equal(listing.status, 200);
  assert.deepEqual(listed.data.map((row) => row.name), ['prefix/one']);

  const response = await call('/api/private/v1/datasets/pie/alpha', {
    headers: authHeaders(),
  });
  const value = await body(response);
  assert.equal(response.status, 200);
  assert.deepEqual(value.data, { value: 1 });
});

test('private dry-run validates without writing and live PUT writes normalized JSON', async () => {
  const bindings = env();
  const dryRun = await call(
    '/api/private/v1/datasets/pie/new-key?dry_run=1',
    {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: '{ "answer": 42 }',
    },
    bindings,
  );
  const dryValue = await body(dryRun);
  assert.equal(dryRun.status, 200);
  assert.equal(dryValue.stored, false);
  assert.equal(bindings.PIE_DB.values.has('new-key'), false);

  const written = await call(
    '/api/private/v1/datasets/pie/new-key',
    {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: '{ "answer": 42 }',
    },
    bindings,
  );
  assert.equal(written.status, 200);
  assert.equal(bindings.PIE_DB.values.get('new-key'), '{"answer":42}');

  const oversized = await call(
    '/api/private/v1/datasets/pie/too-large',
    {
      method: 'PUT',
      headers: authHeaders({
        'Content-Type': 'application/json',
        'Content-Length': String(10 * 1024 * 1024 + 1),
      }),
      body: '{}',
    },
    bindings,
  );
  assert.equal(oversized.status, 413);
});

test('legacy public data endpoint remains compatible', async () => {
  const response = await call('/api/data?type=forge_database');
  const value = await body(response);
  assert.equal(response.status, 200);
  assert.equal(value.type, 'forge_database');
});
