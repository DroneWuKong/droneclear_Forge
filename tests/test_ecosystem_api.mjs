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
