import assert from 'node:assert/strict';
import test from 'node:test';

import { handleEcosystemRequest } from '../workers/ecosystem-api.mjs';
import { bomRevisionContract, productRevisionContract, supplierOfferContract } from '../workers/ecosystem-contracts.mjs';

const now = 1_800_000_000_000;

function productInput() {
  return {
    productId: 'motor-1', revision: 'r1', manufacturerName: 'Example OEM', partNumber: 'MOTOR-42', gtin: '00012345678905',
    name: 'Example Motor', category: 'MOTOR', compatibilityTags: ['voltage:6s', 'frame:5in'], lifecycle: 'ACTIVE', evidenceRefs: ['datasheet:motor-42'],
  };
}

test('product and BOM contracts keep immutable product truth apart from supplier terms', async () => {
  const product = await productRevisionContract(productInput(), 'example-oem');
  assert.equal(product.schemaVersion, 'forge.product-revision.v1');
  assert.match(product.productDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal('unitPriceMinor' in product, false);

  const bom = await bomRevisionContract({
    bomId: 'airframe-bom-1', revision: 'r1', productId: 'airframe-1', productRevision: 'r1', evidenceRefs: ['drawing:airframe-1'],
    lines: [{ lineId: 'motor-line', slot: 'motor-fl', quantity: 1, productId: 'motor-1', productRevision: 'r1', requiredCompatibilityTags: ['frame:5in'], substitutionsAllowed: true }],
  }, 'example-oem');
  assert.match(bom.bomDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(bom.lines[0].substitutionsAllowed, true);
});

test('supplier offers retain explicit sponsorship and evidence markers', async () => {
  const offer = await supplierOfferContract({
    offerId: 'offer-1', supplierId: 'supplier-1', productId: 'motor-1', productRevision: 'r1', currency: 'usd', unitPriceMinor: 1299,
    availableQuantity: 100, leadTimeDays: 4, validAtMs: now - 1000, validUntilMs: now + 1000, evidenceRefs: ['erp:offer-1'], sponsored: true,
  });
  assert.equal(offer.currency, 'USD');
  assert.equal(offer.sponsored, true);
  assert.match(offer.offerDigest, /^sha256:[0-9a-f]{64}$/);
});

test('public catalog serves published contracts and keeps sponsored offers in a separate array', async () => {
  const product = { ...(await productRevisionContract(productInput(), 'example-oem')), publishedAtMs: now };
  const offerInput = { supplierId: 'supplier-1', productId: 'motor-1', productRevision: 'r1', currency: 'USD', unitPriceMinor: 1299, availableQuantity: 100, leadTimeDays: 4, validAtMs: Date.now() - 1000, validUntilMs: Date.now() + 100000, evidenceRefs: ['erp:offer-1'] };
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
  const offersResponse = await handleEcosystemRequest(new Request('https://uas-forge.com/api/ecosystem/v1/offers?product_id=motor-1'), { ECOSYSTEM_DB: db }, null);
  const offers = await offersResponse.json();
  assert.equal(offers.offers.length, 1);
  assert.equal(offers.sponsoredOffers.length, 1);
});

test('tenant writes fail closed without a verified Access identity', async () => {
  const db = { prepare() { throw new Error('membership query must not run without identity'); } };
  const response = await handleEcosystemRequest(new Request('https://uas-forge.com/api/ecosystem/v1/organizations/example-oem/products', { method: 'POST', body: JSON.stringify(productInput()) }), { ECOSYSTEM_DB: db }, null);
  assert.equal(response.status, 401);
});
