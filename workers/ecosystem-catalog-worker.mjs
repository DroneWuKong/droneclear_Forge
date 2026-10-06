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
    (organization_id, product_id, revision, manufacturer_id, part_number, category, lifecycle, publication_state, contract_json, product_digest, created_at_ms, updated_at_ms, published_at_ms, is_current, supersedes_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, NULL, 0, ?)
    ON CONFLICT (organization_id, product_id, revision) DO UPDATE SET part_number = excluded.part_number, category = excluded.category, lifecycle = excluded.lifecycle, contract_json = excluded.contract_json, product_digest = excluded.product_digest, supersedes_revision = excluded.supersedes_revision, updated_at_ms = excluded.updated_at_ms
    WHERE ecosystem_product_revisions.publication_state = 'DRAFT'`)
    .bind(organizationId, contract.productId, contract.revision, contract.manufacturerId, contract.partNumber, contract.category, contract.lifecycle, canonicalJson(contract), contract.productDigest, now, now, contract.supersedesRevision || null);
  if (resource === 'BOMS') return db.prepare(`INSERT INTO ecosystem_bom_revisions
    (organization_id, bom_id, revision, product_id, product_revision, publication_state, contract_json, bom_digest, created_at_ms, updated_at_ms, published_at_ms, is_current, supersedes_revision)
    VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, NULL, 0, ?)
    ON CONFLICT (organization_id, bom_id, revision) DO UPDATE SET product_id = excluded.product_id, product_revision = excluded.product_revision, contract_json = excluded.contract_json, bom_digest = excluded.bom_digest, supersedes_revision = excluded.supersedes_revision, updated_at_ms = excluded.updated_at_ms
    WHERE ecosystem_bom_revisions.publication_state = 'DRAFT'`)
    .bind(organizationId, contract.bomId, contract.revision, contract.productId, contract.productRevision, canonicalJson(contract), contract.bomDigest, now, now, contract.supersedesRevision || null);
  return db.prepare(`INSERT INTO ecosystem_supplier_offers
    (organization_id, offer_id, supplier_id, product_manufacturer_id, product_id, product_revision, unit_price_minor, currency, available_quantity, lead_time_days, valid_at_ms, valid_until_ms, sponsored, publication_state, contract_json, offer_digest, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
    ON CONFLICT (organization_id, offer_id) DO UPDATE SET product_manufacturer_id = excluded.product_manufacturer_id, product_id = excluded.product_id, product_revision = excluded.product_revision, unit_price_minor = excluded.unit_price_minor, currency = excluded.currency, available_quantity = excluded.available_quantity, lead_time_days = excluded.lead_time_days, valid_at_ms = excluded.valid_at_ms, valid_until_ms = excluded.valid_until_ms, sponsored = excluded.sponsored, contract_json = excluded.contract_json, offer_digest = excluded.offer_digest, updated_at_ms = excluded.updated_at_ms
    WHERE ecosystem_supplier_offers.publication_state = 'DRAFT'`)
    .bind(organizationId, contract.offerId, contract.supplierId, contract.productManufacturerId, contract.productId, contract.productRevision, contract.unitPriceMinor, contract.currency, contract.availableQuantity, contract.leadTimeDays, contract.validAtMs, contract.validUntilMs, contract.sponsored ? 1 : 0, canonicalJson(contract), contract.offerDigest, now, now);
}

function writeCount(result) {
  return result?.meta?.changes ?? result?.changes ?? 0;
}

async function persistChunk(db, resource, organizationId, entries, now, errors) {
  const statements = entries.map(entry => insertStatement(db, resource, organizationId, entry.contract, now));
  try {
    const results = await db.batch(statements);
    return entries.reduce((count, entry, offset) => {
      if (writeCount(results[offset]) > 0) return count + 1;
      errors.push({ index: entry.index, error: 'record is no longer an editable draft; create a new revision or offer ID' });
      return count;
    }, 0);
  } catch {
    let accepted = 0;
    for (let offset = 0; offset < entries.length; offset += 1) {
      try {
        const result = await statements[offset].run();
        if (writeCount(result) > 0) accepted += 1;
        else errors.push({ index: entries[offset].index, error: 'record is no longer an editable draft; create a new revision or offer ID' });
      } catch (error) {
        errors.push({ index: entries[offset].index, error: error instanceof Error ? error.message : 'catalog record could not be written' });
      }
    }
    return accepted;
  }
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
  await env.ECOSYSTEM_DB.prepare("UPDATE ecosystem_catalog_imports SET status = 'PROCESSING', last_error = NULL, updated_at_ms = ? WHERE organization_id = ? AND import_id = ? AND status IN ('QUEUED','PROCESSING')").bind(now, job.organizationId, job.importId).run();
  const validated = [];
  const errors = [];
  for (let index = 0; index < source.records.length; index += 1) {
    try { validated.push({ index, contract: await processRecord(job.resource, source.records[index], job.organizationId) }); }
    catch (error) { errors.push({ index, error: error instanceof Error ? error.message : 'invalid catalog record' }); }
  }
  let acceptedCount = 0;
  for (let start = 0; start < validated.length; start += 50) acceptedCount += await persistChunk(env.ECOSYSTEM_DB, job.resource, job.organizationId, validated.slice(start, start + 50), now, errors);
  errors.sort((a, b) => a.index - b.index);
  const status = acceptedCount === 0 ? 'REJECTED' : errors.length === 0 ? 'COMPLETED' : 'PARTIAL';
  await env.ECOSYSTEM_DB.prepare('UPDATE ecosystem_catalog_imports SET status = ?, accepted_count = ?, rejected_count = ?, error_json = ?, last_error = NULL, updated_at_ms = ? WHERE organization_id = ? AND import_id = ?')
    .bind(status, acceptedCount, errors.length, errors.length ? JSON.stringify(errors) : null, Date.now(), job.organizationId, job.importId).run();
  return { status, acceptedCount, rejectedCount: errors.length };
}

async function recordDeliveryFailure(env, job, attempts, error, terminal) {
  if (!env.ECOSYSTEM_DB || !job?.organizationId || !job?.importId) return;
  const message = error instanceof Error ? error.message : 'catalog import consumer failed';
  await env.ECOSYSTEM_DB.prepare(`UPDATE ecosystem_catalog_imports SET
    status = CASE WHEN ? THEN 'REJECTED' ELSE status END,
    rejected_count = CASE WHEN ? THEN record_count ELSE rejected_count END,
    error_json = CASE WHEN ? THEN ? ELSE error_json END,
    last_error = ?, attempt_count = ?, updated_at_ms = ?
    WHERE organization_id = ? AND import_id = ?`)
    .bind(terminal ? 1 : 0, terminal ? 1 : 0, terminal ? 1 : 0, terminal ? JSON.stringify([{ index: null, error: message }]) : null, message, attempts, Date.now(), job.organizationId, job.importId).run();
}

export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await env.ECOSYSTEM_DB.prepare('UPDATE ecosystem_catalog_imports SET attempt_count = ?, updated_at_ms = ? WHERE organization_id = ? AND import_id = ?').bind(message.attempts, Date.now(), message.body.organizationId, message.body.importId).run();
        await processCatalogImport(message.body, env);
        message.ack();
      } catch (error) {
        const terminal = message.attempts >= 5;
        await recordDeliveryFailure(env, message.body, message.attempts, error, terminal);
        message.retry({ delaySeconds: Math.min(30 * (2 ** Math.max(message.attempts - 1, 0)), 900) });
      }
    }
  },
  async fetch() {
    return new Response(JSON.stringify({ service: 'forge-ecosystem-catalog', status: 'ok', acceptsHttpImports: false, authorizesExecution: false }), { headers: { 'Content-Type': 'application/json' } });
  },
};
