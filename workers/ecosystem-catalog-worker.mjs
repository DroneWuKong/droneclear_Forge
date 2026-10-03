import { bomRevisionContract, canonicalDigest, canonicalJson, productRevisionContract, supplierOfferContract } from './ecosystem-contracts.mjs';

async function processRecord(resource, value, organizationId) {
  if (resource === 'PRODUCTS') return productRevisionContract(value, organizationId);
  if (resource === 'BOMS') return bomRevisionContract(value, organizationId);
  if (resource === 'OFFERS') {
    const offer = await supplierOfferContract(value);
    if (offer.supplierId !== organizationId) throw new Error('supplier offer must be owned by the importing organization');
    return offer;
  }
  throw new Error('catalog import resource is unsupported');
}

function insertStatement(db, resource, organizationId, contract, now) {
  if (resource === 'PRODUCTS') return db.prepare(`INSERT INTO ecosystem_product_revisions
    (organization_id, product_id, revision, manufacturer_id, part_number, category, lifecycle, publication_state, contract_json, product_digest, created_at_ms, updated_at_ms, published_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, NULL)
    ON CONFLICT (organization_id, product_id, revision) DO UPDATE SET part_number = excluded.part_number, category = excluded.category, lifecycle = excluded.lifecycle, contract_json = excluded.contract_json, product_digest = excluded.product_digest, updated_at_ms = excluded.updated_at_ms
    WHERE ecosystem_product_revisions.publication_state = 'DRAFT'`)
    .bind(organizationId, contract.productId, contract.revision, contract.manufacturerId, contract.partNumber, contract.category, contract.lifecycle, canonicalJson(contract), contract.productDigest, now, now);
  if (resource === 'BOMS') return db.prepare(`INSERT INTO ecosystem_bom_revisions
    (organization_id, bom_id, revision, product_id, product_revision, publication_state, contract_json, bom_digest, created_at_ms, updated_at_ms, published_at_ms)
    VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, NULL)
    ON CONFLICT (organization_id, bom_id, revision) DO UPDATE SET product_id = excluded.product_id, product_revision = excluded.product_revision, contract_json = excluded.contract_json, bom_digest = excluded.bom_digest, updated_at_ms = excluded.updated_at_ms
    WHERE ecosystem_bom_revisions.publication_state = 'DRAFT'`)
    .bind(organizationId, contract.bomId, contract.revision, contract.productId, contract.productRevision, canonicalJson(contract), contract.bomDigest, now, now);
  return db.prepare(`INSERT INTO ecosystem_supplier_offers
    (organization_id, offer_id, supplier_id, product_id, product_revision, unit_price_minor, currency, available_quantity, lead_time_days, valid_until_ms, sponsored, publication_state, contract_json, offer_digest, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
    ON CONFLICT (organization_id, offer_id) DO UPDATE SET product_id = excluded.product_id, product_revision = excluded.product_revision, unit_price_minor = excluded.unit_price_minor, currency = excluded.currency, available_quantity = excluded.available_quantity, lead_time_days = excluded.lead_time_days, valid_until_ms = excluded.valid_until_ms, sponsored = excluded.sponsored, contract_json = excluded.contract_json, offer_digest = excluded.offer_digest, updated_at_ms = excluded.updated_at_ms
    WHERE ecosystem_supplier_offers.publication_state = 'DRAFT'`)
    .bind(organizationId, contract.offerId, contract.supplierId, contract.productId, contract.productRevision, contract.unitPriceMinor, contract.currency, contract.availableQuantity, contract.leadTimeDays, contract.validUntilMs, contract.sponsored ? 1 : 0, canonicalJson(contract), contract.offerDigest, now, now);
}

export async function processCatalogImport(job, env) {
  if (!env.ECOSYSTEM_DB || !env.OEM_CATALOGS) throw new Error('ecosystem catalog bindings are unavailable');
  const importState = await env.ECOSYSTEM_DB.prepare('SELECT status, source_digest FROM ecosystem_catalog_imports WHERE organization_id = ? AND import_id = ?').bind(job.organizationId, job.importId).first();
  if (!importState || importState.source_digest !== job.sourceDigest) throw new Error('catalog import database identity or digest mismatch');
  if (['COMPLETED', 'PARTIAL', 'REJECTED'].includes(importState.status)) return { status: importState.status, idempotent: true };
  const stored = await env.OEM_CATALOGS.get(job.objectKey);
  if (!stored) throw new Error('catalog import source object is missing');
  const source = JSON.parse(await stored.text());
  if (source.organizationId !== job.organizationId || source.importId !== job.importId || source.resource !== job.resource || await canonicalDigest(source) !== job.sourceDigest) throw new Error('catalog import source identity or digest mismatch');
  const now = Date.now();
  await env.ECOSYSTEM_DB.prepare("UPDATE ecosystem_catalog_imports SET status = 'PROCESSING', updated_at_ms = ? WHERE organization_id = ? AND import_id = ? AND status = 'QUEUED'").bind(now, job.organizationId, job.importId).run();
  const accepted = [];
  const errors = [];
  for (let index = 0; index < source.records.length; index += 1) {
    try { accepted.push(await processRecord(job.resource, source.records[index], job.organizationId)); }
    catch (error) { errors.push({ index, error: error instanceof Error ? error.message : 'invalid catalog record' }); }
  }
  if (accepted.length > 0) await env.ECOSYSTEM_DB.batch(accepted.map(contract => insertStatement(env.ECOSYSTEM_DB, job.resource, job.organizationId, contract, now)));
  const status = accepted.length === 0 ? 'REJECTED' : errors.length === 0 ? 'COMPLETED' : 'PARTIAL';
  await env.ECOSYSTEM_DB.prepare('UPDATE ecosystem_catalog_imports SET status = ?, accepted_count = ?, rejected_count = ?, error_json = ?, updated_at_ms = ? WHERE organization_id = ? AND import_id = ?')
    .bind(status, accepted.length, errors.length, errors.length ? JSON.stringify(errors) : null, Date.now(), job.organizationId, job.importId).run();
  return { status, acceptedCount: accepted.length, rejectedCount: errors.length };
}

export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      try { await processCatalogImport(message.body, env); message.ack(); }
      catch { message.retry({ delaySeconds: 30 }); }
    }
  },
  async fetch(request) {
    return new Response(JSON.stringify({ service: 'forge-ecosystem-catalog', status: 'ok', acceptsHttpImports: false, authorizesExecution: false }), { headers: { 'Content-Type': 'application/json' } });
  },
};
