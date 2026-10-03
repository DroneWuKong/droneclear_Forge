import { verifyAccessIdentity } from './access-auth.mjs';
import { bomRevisionContract, canonicalDigest, canonicalJson, productRevisionContract, supplierOfferContract } from './ecosystem-contracts.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, CF-Access-Jwt-Assertion' };
const response = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors, ...extra } });

async function body(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > 2_000_000) throw new Error('request body exceeds 2 MB');
  const raw = await request.text();
  if (raw.length > 2_000_000) throw new Error('request body exceeds 2 MB');
  try { return JSON.parse(raw); } catch { throw new Error('request body must be valid JSON'); }
}

function requireDb(env) {
  if (!env.ECOSYSTEM_DB) throw new Error('ecosystem database binding is unavailable');
  return env.ECOSYSTEM_DB;
}

async function member(db, organizationId, identity) {
  return db.prepare('SELECT role FROM ecosystem_memberships WHERE organization_id = ? AND access_subject = ? AND status = ?')
    .bind(organizationId, identity.subject, 'ACTIVE').first();
}

async function requireMember(env, organizationId, identity, roles = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER']) {
  if (!identity) return { error: response(401, { error: 'Cloudflare Access identity required' }) };
  const membership = await member(requireDb(env), organizationId, identity);
  if (!membership || !roles.includes(membership.role)) return { error: response(403, { error: 'organization membership does not permit this operation' }) };
  return { membership };
}

function bearer(request) {
  const access = request.headers.get('CF-Access-Jwt-Assertion');
  if (access) return access;
  const authorization = request.headers.get('Authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
}

async function listPublicProducts(db, url) {
  const category = url.searchParams.get('category');
  const manufacturer = url.searchParams.get('manufacturer_id');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200);
  const clauses = ["publication_state = 'PUBLISHED'"];
  const bindings = [];
  if (category) { clauses.push('category = ?'); bindings.push(category); }
  if (manufacturer) { clauses.push('manufacturer_id = ?'); bindings.push(manufacturer); }
  bindings.push(limit);
  const result = await db.prepare(`SELECT contract_json FROM ecosystem_product_revisions WHERE ${clauses.join(' AND ')} ORDER BY published_at_ms DESC, product_id, revision LIMIT ?`).bind(...bindings).all();
  return response(200, { schemaVersion: 'forge.product-catalog.v1', products: (result.results || []).map(row => JSON.parse(row.contract_json)), authorizesExecution: false }, { 'Cache-Control': 'public, max-age=60' });
}

async function getPublicProduct(db, productId, revision) {
  const statement = revision
    ? db.prepare("SELECT contract_json FROM ecosystem_product_revisions WHERE product_id = ? AND revision = ? AND publication_state = 'PUBLISHED'").bind(productId, revision)
    : db.prepare("SELECT contract_json FROM ecosystem_product_revisions WHERE product_id = ? AND publication_state = 'PUBLISHED' ORDER BY published_at_ms DESC LIMIT 1").bind(productId);
  const row = await statement.first();
  return row ? response(200, JSON.parse(row.contract_json), { 'Cache-Control': 'public, max-age=60' }) : response(404, { error: 'published product revision not found' });
}

async function listPublicOffers(db, url) {
  const productId = url.searchParams.get('product_id');
  if (!productId) return response(400, { error: 'product_id is required' });
  const result = await db.prepare("SELECT contract_json FROM ecosystem_supplier_offers WHERE product_id = ? AND publication_state = 'PUBLISHED' AND valid_until_ms > ? ORDER BY sponsored, unit_price_minor, offer_id LIMIT 200").bind(productId, Date.now()).all();
  const offers = (result.results || []).map(row => JSON.parse(row.contract_json));
  return response(200, { schemaVersion: 'forge.supplier-offer-catalog.v1', productId, offers: offers.filter(item => item.sponsored === false), sponsoredOffers: offers.filter(item => item.sponsored === true), authorizesExecution: false }, { 'Cache-Control': 'public, max-age=30' });
}

async function listPublicBoms(db, url) {
  const productId = url.searchParams.get('product_id');
  const productRevision = url.searchParams.get('product_revision');
  if (!productId) return response(400, { error: 'product_id is required' });
  const statement = productRevision
    ? db.prepare("SELECT contract_json FROM ecosystem_bom_revisions WHERE product_id = ? AND product_revision = ? AND publication_state = 'PUBLISHED' ORDER BY published_at_ms DESC").bind(productId, productRevision)
    : db.prepare("SELECT contract_json FROM ecosystem_bom_revisions WHERE product_id = ? AND publication_state = 'PUBLISHED' ORDER BY published_at_ms DESC").bind(productId);
  const result = await statement.all();
  return response(200, { schemaVersion: 'forge.bom-catalog.v1', productId, boms: (result.results || []).map(row => JSON.parse(row.contract_json)), authorizesExecution: false }, { 'Cache-Control': 'public, max-age=60' });
}

async function createOrganization(env, identity, request) {
  if (!identity) return response(401, { error: 'Cloudflare Access identity required' });
  const input = await body(request);
  const organizationId = String(input.organizationId || '').trim();
  const name = String(input.name || '').trim();
  const kind = String(input.kind || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(organizationId) || !name || !['OEM', 'MANUFACTURER', 'SUPPLIER', 'OPERATOR', 'HYBRID'].includes(kind)) return response(400, { error: 'organizationId, name, or kind is invalid' });
  const db = requireDb(env);
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO ecosystem_organizations (organization_id, name, kind, created_at_ms) VALUES (?, ?, ?, ?)').bind(organizationId, name, kind, now),
    db.prepare('INSERT INTO ecosystem_memberships (organization_id, access_subject, email, role, status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)').bind(organizationId, identity.subject, identity.email, 'OWNER', 'ACTIVE', now),
  ]);
  return response(201, { organizationId, name, kind, role: 'OWNER' });
}

async function saveProduct(env, identity, organizationId, request) {
  const admission = await requireMember(env, organizationId, identity, ['OWNER', 'ADMIN', 'EDITOR']);
  if (admission.error) return admission.error;
  const contract = await productRevisionContract(await body(request), organizationId);
  const now = Date.now();
  await requireDb(env).prepare(`INSERT INTO ecosystem_product_revisions
    (organization_id, product_id, revision, manufacturer_id, part_number, category, lifecycle, publication_state, contract_json, product_digest, created_at_ms, updated_at_ms, published_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, NULL)`)
    .bind(organizationId, contract.productId, contract.revision, contract.manufacturerId, contract.partNumber, contract.category, contract.lifecycle, canonicalJson(contract), contract.productDigest, now, now).run();
  return response(201, { ...contract, publicationState: 'DRAFT', publishedAtMs: null });
}

async function transitionProduct(env, identity, organizationId, productId, revision, transition) {
  const roles = transition === 'publish' ? ['OWNER', 'ADMIN'] : ['OWNER', 'ADMIN', 'EDITOR'];
  const admission = await requireMember(env, organizationId, identity, roles);
  if (admission.error) return admission.error;
  const db = requireDb(env);
  const row = await db.prepare('SELECT publication_state, contract_json FROM ecosystem_product_revisions WHERE organization_id = ? AND product_id = ? AND revision = ?').bind(organizationId, productId, revision).first();
  if (!row) return response(404, { error: 'product revision not found' });
  const expected = transition === 'review' ? 'DRAFT' : 'REVIEWED';
  const next = transition === 'review' ? 'REVIEWED' : 'PUBLISHED';
  if (row.publication_state !== expected) return response(409, { error: `${transition} requires ${expected} state`, currentState: row.publication_state });
  const now = Date.now();
  const contract = JSON.parse(row.contract_json);
  if (transition === 'publish') contract.publishedAtMs = now;
  await db.prepare('UPDATE ecosystem_product_revisions SET publication_state = ?, contract_json = ?, updated_at_ms = ?, published_at_ms = ? WHERE organization_id = ? AND product_id = ? AND revision = ? AND publication_state = ?')
    .bind(next, canonicalJson(contract), now, transition === 'publish' ? now : null, organizationId, productId, revision, expected).run();
  return response(200, { productId, revision, publicationState: next, publishedAtMs: transition === 'publish' ? now : null });
}

async function transitionOwnedRecord(env, identity, organizationId, kind, recordId, revision, transition) {
  const roles = transition === 'publish' ? ['OWNER', 'ADMIN'] : ['OWNER', 'ADMIN', 'EDITOR'];
  const admission = await requireMember(env, organizationId, identity, roles);
  if (admission.error) return admission.error;
  const config = kind === 'boms'
    ? { table: 'ecosystem_bom_revisions', idColumn: 'bom_id', digestColumn: 'bom_digest', revisioned: true }
    : { table: 'ecosystem_supplier_offers', idColumn: 'offer_id', digestColumn: 'offer_digest', revisioned: false };
  const db = requireDb(env);
  const where = config.revisioned ? `organization_id = ? AND ${config.idColumn} = ? AND revision = ?` : `organization_id = ? AND ${config.idColumn} = ?`;
  const values = config.revisioned ? [organizationId, recordId, revision] : [organizationId, recordId];
  const row = await db.prepare(`SELECT publication_state, contract_json FROM ${config.table} WHERE ${where}`).bind(...values).first();
  if (!row) return response(404, { error: `${kind === 'boms' ? 'BOM revision' : 'supplier offer'} not found` });
  const expected = transition === 'review' ? 'DRAFT' : 'REVIEWED';
  const next = transition === 'review' ? 'REVIEWED' : 'PUBLISHED';
  if (row.publication_state !== expected) return response(409, { error: `${transition} requires ${expected} state`, currentState: row.publication_state });
  const now = Date.now();
  const contract = JSON.parse(row.contract_json);
  if (transition === 'publish' && config.revisioned) contract.publishedAtMs = now;
  const publishedColumn = config.revisioned ? ', published_at_ms = ?' : '';
  const updateBindings = config.revisioned
    ? [next, canonicalJson(contract), now, transition === 'publish' ? now : null, ...values, expected]
    : [next, canonicalJson(contract), now, ...values, expected];
  await db.prepare(`UPDATE ${config.table} SET publication_state = ?, contract_json = ?, updated_at_ms = ?${publishedColumn} WHERE ${where} AND publication_state = ?`).bind(...updateBindings).run();
  return response(200, { recordId, ...(revision === null ? {} : { revision }), publicationState: next, publishedAtMs: transition === 'publish' ? now : null });
}

async function saveBom(env, identity, organizationId, request) {
  const admission = await requireMember(env, organizationId, identity, ['OWNER', 'ADMIN', 'EDITOR']);
  if (admission.error) return admission.error;
  const contract = await bomRevisionContract(await body(request), organizationId);
  const now = Date.now();
  await requireDb(env).prepare(`INSERT INTO ecosystem_bom_revisions
    (organization_id, bom_id, revision, product_id, product_revision, publication_state, contract_json, bom_digest, created_at_ms, updated_at_ms, published_at_ms)
    VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, NULL)`)
    .bind(organizationId, contract.bomId, contract.revision, contract.productId, contract.productRevision, canonicalJson(contract), contract.bomDigest, now, now).run();
  return response(201, { ...contract, publicationState: 'DRAFT' });
}

async function saveOffer(env, identity, organizationId, request) {
  const admission = await requireMember(env, organizationId, identity, ['OWNER', 'ADMIN', 'EDITOR']);
  if (admission.error) return admission.error;
  const contract = await supplierOfferContract(await body(request));
  if (contract.supplierId !== organizationId) return response(400, { error: 'supplier offer must be owned by the organization' });
  const now = Date.now();
  await requireDb(env).prepare(`INSERT INTO ecosystem_supplier_offers
    (organization_id, offer_id, supplier_id, product_id, product_revision, unit_price_minor, currency, available_quantity, lead_time_days, valid_until_ms, sponsored, publication_state, contract_json, offer_digest, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`)
    .bind(organizationId, contract.offerId, contract.supplierId, contract.productId, contract.productRevision, contract.unitPriceMinor, contract.currency, contract.availableQuantity, contract.leadTimeDays, contract.validUntilMs, contract.sponsored ? 1 : 0, canonicalJson(contract), contract.offerDigest, now, now).run();
  return response(201, { ...contract, publicationState: 'DRAFT' });
}

async function createCatalogImport(env, identity, organizationId, request) {
  const admission = await requireMember(env, organizationId, identity, ['OWNER', 'ADMIN', 'EDITOR']);
  if (admission.error) return admission.error;
  const input = await body(request);
  const importId = String(input.importId || '').trim();
  const resource = String(input.resource || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(importId) || !['PRODUCTS', 'BOMS', 'OFFERS'].includes(resource) || !Array.isArray(input.records) || input.records.length === 0 || input.records.length > 10_000) return response(400, { error: 'catalog import shape is invalid' });
  const source = { schemaVersion: 'forge.catalog-import.v1', importId, organizationId, resource, records: input.records };
  const sourceDigest = await canonicalDigest(source);
  const objectKey = `${organizationId}/${importId}/${sourceDigest.slice(7)}.json`;
  if (!env.OEM_CATALOGS) throw new Error('OEM catalog evidence bucket binding is unavailable');
  const db = requireDb(env);
  const existing = await db.prepare('SELECT source_digest, status FROM ecosystem_catalog_imports WHERE organization_id = ? AND import_id = ?').bind(organizationId, importId).first();
  if (existing && existing.source_digest !== sourceDigest) return response(409, { error: 'catalog import ID is already bound to different source bytes' });
  if (existing && ['COMPLETED', 'PARTIAL', 'REJECTED'].includes(existing.status)) {
    return response(200, { importId, organizationId, resource, recordCount: input.records.length, sourceDigest, status: existing.status, idempotent: true });
  }
  await env.OEM_CATALOGS.put(objectKey, canonicalJson(source), { httpMetadata: { contentType: 'application/json' }, customMetadata: { organizationId, importId, sourceDigest } });
  await db.prepare(`INSERT INTO ecosystem_catalog_imports
    (organization_id, import_id, resource, object_key, source_digest, record_count, status, submitted_by, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)
    ON CONFLICT (organization_id, import_id) DO NOTHING`)
    .bind(organizationId, importId, resource, objectKey, sourceDigest, input.records.length, identity.subject, Date.now(), Date.now()).run();
  if (!env.OEM_CATALOG_QUEUE) throw new Error('OEM catalog queue binding is unavailable');
  await env.OEM_CATALOG_QUEUE.send({ schemaVersion: 'forge.catalog-import-job.v1', organizationId, importId, resource, objectKey, sourceDigest });
  return response(202, { importId, organizationId, resource, recordCount: input.records.length, sourceDigest, status: 'QUEUED' });
}

export async function handleEcosystemRequest(request, env, identityOverride) {
  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const segments = url.pathname.replace(/^\/api\/ecosystem\/v1\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const identity = identityOverride === undefined ? await verifyAccessIdentity(bearer(request), env) : identityOverride;
    const db = requireDb(env);
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'products') return listPublicProducts(db, url);
    if (request.method === 'GET' && segments[0] === 'products' && segments.length === 2) return getPublicProduct(db, segments[1], url.searchParams.get('revision'));
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'offers') return listPublicOffers(db, url);
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'boms') return listPublicBoms(db, url);
    if (request.method === 'POST' && segments.length === 1 && segments[0] === 'organizations') return createOrganization(env, identity, request);
    if (segments[0] === 'organizations' && segments.length >= 3) {
      const organizationId = segments[1];
      if (request.method === 'POST' && segments.length === 3 && segments[2] === 'products') return saveProduct(env, identity, organizationId, request);
      if (request.method === 'POST' && segments.length === 3 && segments[2] === 'boms') return saveBom(env, identity, organizationId, request);
      if (request.method === 'POST' && segments.length === 3 && segments[2] === 'offers') return saveOffer(env, identity, organizationId, request);
      if (request.method === 'POST' && segments.length === 3 && segments[2] === 'catalog-imports') return createCatalogImport(env, identity, organizationId, request);
      if (request.method === 'POST' && segments.length === 6 && segments[2] === 'products' && ['review', 'publish'].includes(segments[5])) return transitionProduct(env, identity, organizationId, segments[3], segments[4], segments[5]);
      if (request.method === 'POST' && segments.length === 6 && segments[2] === 'boms' && ['review', 'publish'].includes(segments[5])) return transitionOwnedRecord(env, identity, organizationId, 'boms', segments[3], segments[4], segments[5]);
      if (request.method === 'POST' && segments.length === 5 && segments[2] === 'offers' && ['review', 'publish'].includes(segments[4])) return transitionOwnedRecord(env, identity, organizationId, 'offers', segments[3], null, segments[4]);
    }
    return response(404, { error: 'ecosystem route not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ecosystem request failed';
    const status = /UNIQUE|constraint/i.test(message) ? 409 : /invalid|missing|unknown|requires|must|exceeds/i.test(message) ? 400 : 503;
    return response(status, { error: message });
  }
}

export default { fetch: handleEcosystemRequest };
