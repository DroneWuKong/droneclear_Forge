import assert from 'node:assert/strict';
import test from 'node:test';

import ecosystemApi, { handleEcosystemRequest } from '../workers/ecosystem-api.mjs';
import { bomRevisionContract, canonicalDigest, productRevisionContract, supplierOfferContract } from '../workers/ecosystem-contracts.mjs';
import { processCatalogImport } from '../workers/ecosystem-catalog-worker.mjs';

const now = 1_800_000_000_000;

function productInput() {
  return {
    productId: 'motor-1', revision: 'r1', manufacturerName: 'Example OEM', partNumber: 'MOTOR-42', gtin: '00012345678905',
    name: 'Example Motor', category: 'MOTOR', compatibilityTags: ['voltage:6s', 'frame:5in'], lifecycle: 'ACTIVE', evidenceRefs: ['datasheet:motor-42'],
  };
}

test('product and BOM contracts keep immutable product truth apart from supplier terms', async () => {
  const product = await productRevisionContract(productInput(), 'example-oem');
  assert.equal(product.schemaVersion, 'forge.product-revision.v2');
  assert.equal(product.qualifiedProductId, 'example-oem:motor-1');
  assert.match(product.productDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal('unitPriceMinor' in product, false);

  const bom = await bomRevisionContract({
    bomId: 'airframe-bom-1', revision: 'r1', productId: 'airframe-1', productRevision: 'r1', evidenceRefs: ['drawing:airframe-1'],
    lines: [{ lineId: 'motor-line', slot: 'motor-fl', quantity: 1, manufacturerId: 'example-oem', productId: 'motor-1', productRevision: 'r1', requiredCompatibilityTags: ['frame:5in'], substitutionsAllowed: true }],
  }, 'example-oem');
  assert.match(bom.bomDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(bom.lines[0].substitutionsAllowed, true);
});

test('supplier offers retain explicit sponsorship and evidence markers', async () => {
  const offer = await supplierOfferContract({
    offerId: 'offer-1', supplierId: 'supplier-1', productManufacturerId: 'example-oem', productId: 'motor-1', productRevision: 'r1', currency: 'usd', unitPriceMinor: 1299,
    availableQuantity: 100, leadTimeDays: 4, validAtMs: now - 1000, validUntilMs: now + 1000, evidenceRefs: ['erp:offer-1'], sponsored: true,
  });
  assert.equal(offer.currency, 'USD');
  assert.equal(offer.sponsored, true);
  assert.match(offer.offerDigest, /^sha256:[0-9a-f]{64}$/);
});

test('public catalog serves published contracts and keeps sponsored offers in a separate array', async () => {
  const product = { ...(await productRevisionContract(productInput(), 'example-oem')), publishedAtMs: now };
  const offerInput = { supplierId: 'supplier-1', productManufacturerId: 'example-oem', productId: 'motor-1', productRevision: 'r1', currency: 'USD', unitPriceMinor: 1299, availableQuantity: 100, leadTimeDays: 4, validAtMs: Date.now() - 1000, validUntilMs: Date.now() + 100000, evidenceRefs: ['erp:offer-1'] };
  const unsponsored = await supplierOfferContract({ ...offerInput, offerId: 'offer-1', sponsored: false });
  const sponsored = await supplierOfferContract({ ...offerInput, offerId: 'offer-2', sponsored: true });
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (sql.includes('ecosystem_product_revisions')) return { results: [{ contract_json: JSON.stringify(product) }] };
          if (sql.includes('ecosystem_supplier_offers')) return { results: [{ contract_json: JSON.stringify(unsponsored) }, { contract_json: JSON.stringify(sponsored) }] };
          return { results: [] };
        },
      };
    },
  };
  const catalogResponse = await handleEcosystemRequest(new Request('https://uas-forge.com/api/ecosystem/v1/products'), { ECOSYSTEM_DB: db }, null);
  assert.equal(catalogResponse.status, 200);
  assert.equal((await catalogResponse.json()).products[0].productId, 'motor-1');
  const offersResponse = await handleEcosystemRequest(new Request('https://uas-forge.com/api/ecosystem/v1/offers?manufacturer_id=example-oem&product_id=motor-1'), { ECOSYSTEM_DB: db }, null);
  const offers = await offersResponse.json();
  assert.equal(offers.offers.length, 1);
  assert.equal(offers.sponsoredOffers.length, 1);
});

test('public detail and offer reads require a manufacturer-qualified product identity', async () => {
  const db = { prepare() { throw new Error('ambiguous requests must fail before querying'); } };
  const detail = await handleEcosystemRequest(new Request('https://uas-forge.com/api/ecosystem/v1/products/motor-1'), { ECOSYSTEM_DB: db }, null);
  assert.equal(detail.status, 400);
  const offers = await handleEcosystemRequest(new Request('https://uas-forge.com/api/ecosystem/v1/offers?product_id=motor-1'), { ECOSYSTEM_DB: db }, null);
  assert.equal(offers.status, 400);
});

test('BOM product references require their manufacturer identity', async () => {
  await assert.rejects(() => bomRevisionContract({
    bomId: 'airframe-bom-1', revision: 'r1', productId: 'airframe-1', productRevision: 'r1', evidenceRefs: ['drawing:airframe-1'],
    lines: [{ lineId: 'motor-line', slot: 'motor-fl', quantity: 1, productId: 'motor-1', productRevision: 'r1', requiredCompatibilityTags: [], substitutionsAllowed: true }],
  }, 'example-oem'), /requires manufacturerId/);
});

test('tenant writes fail closed without a verified Access identity', async () => {
  const db = { prepare() { throw new Error('membership query must not run without identity'); } };
  const response = await handleEcosystemRequest(new Request('https://uas-forge.com/api/ecosystem/v1/organizations/example-oem/products', { method: 'POST', body: JSON.stringify(productInput()) }), { ECOSYSTEM_DB: db }, null);
  assert.equal(response.status, 401);
});

test('Pages execution context can never be mistaken for an Access identity', async () => {
  const db = { prepare() { throw new Error('database must not be queried for an unauthenticated organization create'); } };
  const request = new Request('https://uas-forge.com/api/ecosystem/v1/organizations', { method: 'POST', body: JSON.stringify({ organizationId: 'example-oem', name: 'Example OEM', kind: 'OEM' }) });
  const result = await ecosystemApi.fetch(request, { ECOSYSTEM_DB: db }, { waitUntil() {} });
  assert.equal(result.status, 401);
});

test('ordinary Access users cannot self-provision an organization', async () => {
  const db = { prepare() { throw new Error('database must not be touched by denied provisioning'); } };
  const request = new Request('https://uas-forge.com/api/ecosystem/v1/organizations', { method: 'POST', body: '{not valid json' });
  const result = await handleEcosystemRequest(request, { ECOSYSTEM_DB: db }, { subject: 'partner-user', email: 'partner@example.com' });
  assert.equal(result.status, 403);
  assert.deepEqual(await result.json(), { error: 'organization provisioning is restricted to Forge platform administrators' });
});

test('organization provisioning uses an exact Access subject allowlist with no email fallback', async () => {
  let batches = 0;
  const db = {
    prepare() { return { bind() { return this; }, async run() { return { meta: { changes: 1 } }; } }; },
    async batch() { batches += 1; return [{ meta: { changes: 1 } }]; },
  };
  const payload = JSON.stringify({ organizationId: 'partner-oem', name: 'Partner OEM', kind: 'OEM' });
  const denied = await handleEcosystemRequest(new Request('https://uas-forge.com/api/ecosystem/v1/organizations', { method: 'POST', body: payload }), {
    ECOSYSTEM_DB: db, ECOSYSTEM_PLATFORM_ADMIN_SUBJECTS: 'other-subject',
  }, { subject: 'partner-user', email: 'other-subject' });
  assert.equal(denied.status, 403);
  assert.equal(batches, 0);

  const allowed = await handleEcosystemRequest(new Request('https://uas-forge.com/api/ecosystem/v1/organizations', { method: 'POST', body: payload }), {
    ECOSYSTEM_DB: db, ECOSYSTEM_PLATFORM_ADMIN_SUBJECTS: ' other-subject, platform-admin ',
  }, { subject: 'platform-admin', email: 'admin@example.com' });
  assert.equal(allowed.status, 201);
  assert.equal(batches, 1);
});

test('an Access member cannot read or mutate another organization by changing the route', async () => {
  let targetOperations = 0;
  const db = {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (sql.startsWith('SELECT role FROM ecosystem_memberships')) {
            return this.values[0] === 'tenant-a' && this.values[1] === 'user-a' ? { role: 'OWNER' } : null;
          }
          targetOperations += 1;
          return null;
        },
        async all() { targetOperations += 1; return { results: [] }; },
        async run() { targetOperations += 1; return { meta: { changes: 1 } }; },
      };
      return statement;
    },
    async batch() { targetOperations += 1; return []; },
  };
  const cases = [
    ['POST', '/products', JSON.stringify(productInput())],
    ['POST', '/catalog-imports/preflight', JSON.stringify({ resource: 'PRODUCTS', records: [productInput()] })],
    ['POST', '/invitations', JSON.stringify({ email: 'intruder@example.com', role: 'ADMIN' })],
    ['POST', '/api-credentials', JSON.stringify({ name: 'stolen', role: 'EDITOR', scopes: ['catalog:write'] })],
    ['GET', '/audit-events'],
  ];
  for (const [method, suffix, requestBody] of cases) {
    const result = await handleEcosystemRequest(new Request(`https://uas-forge.com/api/ecosystem/v1/organizations/tenant-b${suffix}`, { method, ...(requestBody ? { body: requestBody } : {}) }), { ECOSYSTEM_DB: db }, { subject: 'user-a', email: 'user-a@example.com' });
    assert.equal(result.status, 404, `${method} ${suffix}`);
    assert.deepEqual(await result.json(), { error: 'organization workspace not found' });
  }
  assert.equal(targetOperations, 0);
});

test('an organization-bound service credential cannot cross tenant boundaries', async () => {
  const credentialId = '11111111-1111-4111-8111-111111111111';
  const token = `forge_oem_${credentialId}.service-secret`;
  let targetOperations = 0;
  const db = {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (sql.includes('FROM ecosystem_api_credentials WHERE credential_id')) return {
            credential_id: credentialId, organization_id: 'tenant-a', key_hash: await canonicalDigest(token), role: 'EDITOR', scopes_json: JSON.stringify(['catalog:read', 'catalog:write']),
          };
          if (sql.startsWith('SELECT request_count FROM ecosystem_service_rate_windows')) return { request_count: 1 };
          targetOperations += 1;
          return null;
        },
        async all() { targetOperations += 1; return { results: [] }; },
        async run() {
          if (sql.startsWith('INSERT INTO ecosystem_service_rate_windows') || sql.startsWith('UPDATE ecosystem_api_credentials SET last_used_at_ms')) return { meta: { changes: 1 } };
          targetOperations += 1;
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
  const result = await handleEcosystemRequest(new Request('https://uas-forge.com/api/ecosystem/v1/organizations/tenant-b/products', {
    headers: { Authorization: `Bearer ${token}` },
  }), { ECOSYSTEM_DB: db });
  assert.equal(result.status, 404);
  assert.deepEqual(await result.json(), { error: 'organization workspace not found' });
  assert.equal(targetOperations, 0);
});

test('catalog worker reports a protected published-record conflict instead of false success', async () => {
  const source = { schemaVersion: 'forge.catalog-import.v2', importId: 'import-1', organizationId: 'example-oem', resource: 'PRODUCTS', records: [productInput()] };
  const sourceDigest = await canonicalDigest(source);
  let terminal = null;
  const db = {
    prepare(sql) {
      const statement = {
        values: [], bind(...values) { this.values = values; return this; },
        async first() { return sql.startsWith('SELECT status') ? { status: 'QUEUED', source_digest: sourceDigest } : null; },
        async run() {
          if (sql.startsWith('UPDATE ecosystem_catalog_imports SET status = ?, accepted_count')) terminal = { status: this.values[0], accepted: this.values[1], rejected: this.values[2], errors: JSON.parse(this.values[3]) };
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch() { return [{ meta: { changes: 0 } }]; },
  };
  const env = { ECOSYSTEM_DB: db, OEM_CATALOGS: { async get() { return { async text() { return JSON.stringify(source); } }; } } };
  const result = await processCatalogImport({ organizationId: 'example-oem', importId: 'import-1', resource: 'PRODUCTS', objectKey: 'source.json', sourceDigest }, env);
  assert.deepEqual(result, { status: 'REJECTED', acceptedCount: 0, rejectedCount: 1 });
  assert.equal(terminal.status, 'REJECTED');
  assert.match(terminal.errors[0].error, /no longer an editable draft/);
});

test('inventory sync may refresh commercial facts but cannot switch the reviewed product identity', async () => {
  const base = await supplierOfferContract({
    offerId: 'offer-1', supplierId: 'supplier-1', productManufacturerId: 'example-oem', productId: 'motor-1', productRevision: 'r1', currency: 'USD', unitPriceMinor: 1299,
    availableQuantity: 100, leadTimeDays: 4, validAtMs: now - 1000, validUntilMs: now + 1000, evidenceRefs: ['erp:offer-1'], sponsored: false,
  });
  let writes = 0;
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (sql.startsWith('SELECT role')) return { role: 'OWNER' };
          if (sql.startsWith('SELECT publication_state')) return { publication_state: 'PUBLISHED', contract_json: JSON.stringify(base), offer_digest: base.offerDigest };
          return null;
        },
        async run() { writes += 1; return { meta: { changes: 1 } }; },
      };
    },
  };
  const changedTarget = { ...base, productManufacturerId: 'other-oem' };
  for (const field of ['schemaVersion', 'qualifiedProductId', 'offerDigest']) delete changedTarget[field];
  const result = await handleEcosystemRequest(new Request('https://uas-forge.com/api/ecosystem/v1/organizations/supplier-1/offers/offer-1/sync', { method: 'POST', body: JSON.stringify(changedTarget) }), { ECOSYSTEM_DB: db }, { subject: 'owner-1', email: 'owner@example.com' });
  assert.equal(result.status, 409);
  assert.equal(writes, 0);
});
