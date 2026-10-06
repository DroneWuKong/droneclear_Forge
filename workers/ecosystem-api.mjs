import { verifyAccessIdentity } from './access-auth.mjs';
import { bomRevisionContract, canonicalDigest, canonicalJson, productRevisionContract, supplierOfferContract } from './ecosystem-contracts.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, CF-Access-Jwt-Assertion, Idempotency-Key' };
const response = (status, value, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...cors, ...extra } });
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TERMINAL_IMPORTS = ['COMPLETED', 'PARTIAL', 'REJECTED'];

class ApiError extends Error {
  constructor(status, message, detail = {}) { super(message); this.status = status; this.detail = detail; }
}

async function body(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > 2_000_000) throw new ApiError(413, 'request body exceeds 2 MB');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 2_000_000) throw new ApiError(413, 'request body exceeds 2 MB');
  try { return JSON.parse(raw); } catch { throw new ApiError(400, 'request body must be valid JSON'); }
}

function requireDb(env) {
  if (!env.ECOSYSTEM_DB) throw new Error('ecosystem database binding is unavailable');
  return env.ECOSYSTEM_DB;
}

function bearer(request) {
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.startsWith('Bearer ')) return authorization.slice(7);
  return request.headers.get('CF-Access-Jwt-Assertion');
}

function accessPrincipal(identity) {
  return identity ? { kind: 'ACCESS', subject: identity.subject, email: identity.email || null } : null;
}

function changed(result) {
  return result?.meta?.changes ?? result?.changes ?? 1;
}

function encodeCursor(offset) { return btoa(String(offset)).replace(/=+$/g, ''); }
function decodeCursor(value) {
  if (!value) return 0;
  try {
    const offset = Number(atob(value));
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error();
    return offset;
  } catch { throw new ApiError(400, 'cursor is invalid'); }
}

async function audit(db, organizationId, principal, action, resourceType, resourceId, detail = {}) {
  await db.prepare(`INSERT INTO ecosystem_audit_events
    (event_id, organization_id, actor_subject, actor_kind, action, resource_type, resource_id, detail_json, created_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), organizationId, principal.subject, principal.kind, action, resourceType, resourceId, canonicalJson(detail), Date.now()).run();
}

async function authenticateService(db, token) {
  if (!token?.startsWith('forge_oem_')) return null;
  const separator = token.indexOf('.');
  if (separator < 12) throw new ApiError(401, 'service credential is malformed');
  const credentialId = token.slice('forge_oem_'.length, separator);
  if (!ID.test(credentialId)) throw new ApiError(401, 'service credential is malformed');
  const row = await db.prepare(`SELECT credential_id, organization_id, key_hash, role, scopes_json
    FROM ecosystem_api_credentials WHERE credential_id = ? AND status = 'ACTIVE'`).bind(credentialId).first();
  if (!row || row.key_hash !== await canonicalDigest(token)) throw new ApiError(401, 'service credential is invalid or revoked');
  const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
  await db.prepare(`INSERT INTO ecosystem_service_rate_windows (credential_id, window_start_ms, request_count)
    VALUES (?, ?, 1) ON CONFLICT (credential_id, window_start_ms) DO UPDATE SET request_count = request_count + 1`).bind(credentialId, windowStart).run();
  const window = await db.prepare('SELECT request_count FROM ecosystem_service_rate_windows WHERE credential_id = ? AND window_start_ms = ?').bind(credentialId, windowStart).first();
  if ((window?.request_count || 0) > 300) throw new ApiError(429, 'service credential rate limit exceeded');
  await db.prepare('UPDATE ecosystem_api_credentials SET last_used_at_ms = ? WHERE credential_id = ?').bind(Date.now(), credentialId).run();
  return { kind: 'SERVICE', subject: `service:${credentialId}`, organizationId: row.organization_id, role: row.role, scopes: JSON.parse(row.scopes_json), credentialId };
}

async function authenticate(request, env, identityOverride) {
  const db = requireDb(env);
  if (identityOverride !== undefined) return accessPrincipal(identityOverride);
  const token = bearer(request);
  if (token?.startsWith('forge_oem_')) return authenticateService(db, token);
  return accessPrincipal(await verifyAccessIdentity(token, env));
}

async function member(db, organizationId, principal) {
  if (principal?.kind === 'SERVICE') {
    return principal.organizationId === organizationId ? { role: principal.role } : null;
  }
  return db.prepare('SELECT role FROM ecosystem_memberships WHERE organization_id = ? AND access_subject = ? AND status = ?')
    .bind(organizationId, principal.subject, 'ACTIVE').first();
}

function isPlatformAdmin(env, principal) {
  if (principal?.kind !== 'ACCESS') return false;
  const subjects = String(env.ECOSYSTEM_PLATFORM_ADMIN_SUBJECTS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return subjects.includes(principal.subject);
}

async function requireMember(env, organizationId, principal, roles = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'], scope = 'catalog:read') {
  if (!principal) return { error: response(401, { error: 'Cloudflare Access identity or service credential required' }) };
  if (principal.kind === 'SERVICE' && principal.organizationId !== organizationId) {
    return { error: response(404, { error: 'organization workspace not found' }) };
  }
  if (principal.kind === 'SERVICE' && !principal.scopes.includes(scope)) {
    return { error: response(403, { error: 'service credential scope does not permit this operation' }) };
  }
  const membership = await member(requireDb(env), organizationId, principal);
  if (!membership) return { error: response(404, { error: 'organization workspace not found' }) };
  if (!roles.includes(membership.role)) return { error: response(403, { error: 'organization membership does not permit this operation' }) };
  return { membership };
}

function publicRecord(row) {
  return {
    ...JSON.parse(row.contract_json), publicationState: row.publication_state,
    publishedAtMs: row.published_at_ms || null, isCurrent: Boolean(row.is_current),
    ...(row.withdrawn_at_ms ? { withdrawnAtMs: row.withdrawn_at_ms, withdrawalReason: row.withdrawal_reason } : {}),
  };
}

async function listPublicProducts(db, url) {
  const category = url.searchParams.get('category');
  const manufacturer = url.searchParams.get('manufacturer_id');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200);
  const offset = decodeCursor(url.searchParams.get('cursor'));
  const clauses = ["publication_state = 'PUBLISHED'", 'is_current = 1'];
  const bindings = [];
  if (category) { clauses.push('category = ?'); bindings.push(category); }
  if (manufacturer) { clauses.push('manufacturer_id = ?'); bindings.push(manufacturer); }
  bindings.push(limit + 1, offset);
  const result = await db.prepare(`SELECT contract_json, publication_state, published_at_ms, is_current, withdrawn_at_ms, withdrawal_reason
    FROM ecosystem_product_revisions WHERE ${clauses.join(' AND ')}
    ORDER BY manufacturer_id, product_id, revision LIMIT ? OFFSET ?`).bind(...bindings).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  return response(200, {
    schemaVersion: 'forge.product-catalog.v2', products: rows.slice(0, limit).map(publicRecord),
    nextCursor: hasMore ? encodeCursor(offset + limit) : null, authorizesExecution: false,
  }, { 'Cache-Control': 'public, max-age=60' });
}

async function getPublicProduct(db, productId, revision, url) {
  const manufacturerId = url.searchParams.get('manufacturer_id');
  if (!manufacturerId) return response(400, { error: 'manufacturer_id is required for an unambiguous product identity' });
  const statement = revision
    ? db.prepare("SELECT contract_json, publication_state, published_at_ms, is_current, withdrawn_at_ms, withdrawal_reason FROM ecosystem_product_revisions WHERE manufacturer_id = ? AND product_id = ? AND revision = ? AND publication_state = 'PUBLISHED'").bind(manufacturerId, productId, revision)
    : db.prepare("SELECT contract_json, publication_state, published_at_ms, is_current, withdrawn_at_ms, withdrawal_reason FROM ecosystem_product_revisions WHERE manufacturer_id = ? AND product_id = ? AND publication_state = 'PUBLISHED' AND is_current = 1 LIMIT 1").bind(manufacturerId, productId);
  const row = await statement.first();
  return row ? response(200, publicRecord(row), { 'Cache-Control': 'public, max-age=60' }) : response(404, { error: 'published product revision not found' });
}

async function listPublicOffers(db, url) {
  const manufacturerId = url.searchParams.get('manufacturer_id');
  const productId = url.searchParams.get('product_id');
  if (!manufacturerId || !productId) return response(400, { error: 'manufacturer_id and product_id are required' });
  const now = Date.now();
  const result = await db.prepare(`SELECT contract_json FROM ecosystem_supplier_offers
    WHERE product_manufacturer_id = ? AND product_id = ? AND publication_state = 'PUBLISHED'
      AND valid_at_ms <= ? AND valid_until_ms > ?
    ORDER BY sponsored, unit_price_minor, offer_id LIMIT 200`).bind(manufacturerId, productId, now, now).all();
  const offers = (result.results || []).map(row => JSON.parse(row.contract_json));
  return response(200, { schemaVersion: 'forge.supplier-offer-catalog.v2', manufacturerId, productId, offers: offers.filter(item => item.sponsored === false), sponsoredOffers: offers.filter(item => item.sponsored === true), authorizesExecution: false }, { 'Cache-Control': 'public, max-age=30' });
}

async function listPublicBoms(db, url) {
  const manufacturerId = url.searchParams.get('manufacturer_id');
  const productId = url.searchParams.get('product_id');
  const productRevision = url.searchParams.get('product_revision');
  if (!manufacturerId || !productId) return response(400, { error: 'manufacturer_id and product_id are required' });
  const statement = productRevision
    ? db.prepare("SELECT contract_json, publication_state, published_at_ms, is_current, withdrawn_at_ms, withdrawal_reason FROM ecosystem_bom_revisions WHERE organization_id = ? AND product_id = ? AND product_revision = ? AND publication_state = 'PUBLISHED' ORDER BY is_current DESC, published_at_ms DESC").bind(manufacturerId, productId, productRevision)
    : db.prepare("SELECT contract_json, publication_state, published_at_ms, is_current, withdrawn_at_ms, withdrawal_reason FROM ecosystem_bom_revisions WHERE organization_id = ? AND product_id = ? AND publication_state = 'PUBLISHED' AND is_current = 1 ORDER BY published_at_ms DESC").bind(manufacturerId, productId);
  const result = await statement.all();
  return response(200, { schemaVersion: 'forge.bom-catalog.v2', manufacturerId, productId, boms: (result.results || []).map(publicRecord), authorizesExecution: false }, { 'Cache-Control': 'public, max-age=60' });
}

async function activateInvitations(db, principal) {
  if (principal.kind !== 'ACCESS' || !principal.email) return;
  const email = principal.email.trim().toLowerCase();
  const pending = await db.prepare("SELECT invitation_id, organization_id, role FROM ecosystem_invitations WHERE email = ? AND status = 'PENDING'").bind(email).all();
  for (const invitation of pending.results || []) {
    const now = Date.now();
    await db.batch([
      db.prepare(`INSERT INTO ecosystem_memberships (organization_id, access_subject, email, role, status, created_at_ms)
        VALUES (?, ?, ?, ?, 'ACTIVE', ?)
        ON CONFLICT (organization_id, access_subject) DO UPDATE SET email = excluded.email, role = excluded.role, status = 'ACTIVE'`)
        .bind(invitation.organization_id, principal.subject, email, invitation.role, now),
      db.prepare("UPDATE ecosystem_invitations SET status = 'ACCEPTED', accepted_at_ms = ? WHERE invitation_id = ? AND status = 'PENDING'").bind(now, invitation.invitation_id),
    ]);
  }
}

async function getMe(env, principal) {
  if (!principal || principal.kind !== 'ACCESS') return response(401, { error: 'Cloudflare Access identity required' });
  const db = requireDb(env);
  await activateInvitations(db, principal);
  const result = await db.prepare(`SELECT o.organization_id, o.name, o.kind, m.role
    FROM ecosystem_memberships m JOIN ecosystem_organizations o ON o.organization_id = m.organization_id
    WHERE m.access_subject = ? AND m.status = 'ACTIVE' ORDER BY o.name`).bind(principal.subject).all();
  return response(200, { subject: principal.subject, email: principal.email, organizations: (result.results || []).map(row => ({ organizationId: row.organization_id, name: row.name, kind: row.kind, role: row.role })) });
}

async function createOrganization(env, principal, request) {
  if (!principal || principal.kind !== 'ACCESS') return response(401, { error: 'Cloudflare Access identity required' });
  if (!isPlatformAdmin(env, principal)) return response(403, { error: 'organization provisioning is restricted to Forge platform administrators' });
  const input = await body(request);
  const organizationId = String(input.organizationId || '').trim();
  const name = String(input.name || '').trim();
  const kind = String(input.kind || '').trim();
  if (!ID.test(organizationId) || !name || name.length > 256 || !['OEM', 'MANUFACTURER', 'SUPPLIER', 'OPERATOR', 'HYBRID'].includes(kind)) return response(400, { error: 'organizationId, name, or kind is invalid' });
  const db = requireDb(env);
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO ecosystem_organizations (organization_id, name, kind, created_at_ms) VALUES (?, ?, ?, ?)').bind(organizationId, name, kind, now),
    db.prepare("INSERT INTO ecosystem_memberships (organization_id, access_subject, email, role, status, created_at_ms) VALUES (?, ?, ?, 'OWNER', 'ACTIVE', ?)").bind(organizationId, principal.subject, principal.email, now),
  ]);
  await audit(db, organizationId, principal, 'organization.create', 'organization', organizationId, { name, kind });
  return response(201, { organizationId, name, kind, role: 'OWNER' });
}

async function validateCatalog(resource, records, organizationId) {
  if (!['PRODUCTS', 'BOMS', 'OFFERS'].includes(resource) || !Array.isArray(records) || records.length === 0 || records.length > 10_000) throw new ApiError(400, 'catalog import shape is invalid');
  const contracts = [];
  const errors = [];
  for (let index = 0; index < records.length; index += 1) {
    try {
      const contract = resource === 'PRODUCTS' ? await productRevisionContract(records[index], organizationId)
        : resource === 'BOMS' ? await bomRevisionContract(records[index], organizationId) : await supplierOfferContract(records[index]);
      if (resource === 'OFFERS' && contract.supplierId !== organizationId) throw new Error('supplier offer must be owned by the importing organization');
      contracts.push(contract);
    } catch (error) { errors.push({ index, error: error instanceof Error ? error.message : 'invalid catalog record' }); }
  }
  return { contracts, errors, validCount: contracts.length, invalidCount: errors.length };
}

async function preflightCatalog(env, principal, organizationId, request) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN', 'EDITOR'], 'catalog:import');
  if (admission.error) return admission.error;
  const input = await body(request);
  const validation = await validateCatalog(String(input.resource || ''), input.records, organizationId);
  return response(validation.errors.length ? 422 : 200, { resource: input.resource, recordCount: input.records.length, validCount: validation.validCount, invalidCount: validation.invalidCount, errors: validation.errors });
}

async function saveProduct(env, principal, organizationId, request) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN', 'EDITOR'], 'catalog:write');
  if (admission.error) return admission.error;
  const contract = await productRevisionContract(await body(request), organizationId);
  const now = Date.now();
  const result = await requireDb(env).prepare(`INSERT INTO ecosystem_product_revisions
    (organization_id, product_id, revision, manufacturer_id, part_number, category, lifecycle, publication_state, contract_json, product_digest, created_at_ms, updated_at_ms, published_at_ms, is_current, supersedes_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, NULL, 0, ?)
    ON CONFLICT (organization_id, product_id, revision) DO UPDATE SET part_number = excluded.part_number, category = excluded.category, lifecycle = excluded.lifecycle, contract_json = excluded.contract_json, product_digest = excluded.product_digest, supersedes_revision = excluded.supersedes_revision, updated_at_ms = excluded.updated_at_ms
    WHERE ecosystem_product_revisions.publication_state = 'DRAFT'`)
    .bind(organizationId, contract.productId, contract.revision, contract.manufacturerId, contract.partNumber, contract.category, contract.lifecycle, canonicalJson(contract), contract.productDigest, now, now, contract.supersedesRevision || null).run();
  if (!changed(result)) return response(409, { error: 'published or reviewed product revisions are immutable; create a new revision or request changes' });
  await audit(requireDb(env), organizationId, principal, 'product.save-draft', 'product-revision', `${contract.productId}:${contract.revision}`, { digest: contract.productDigest });
  return response(201, { ...contract, publicationState: 'DRAFT', publishedAtMs: null });
}

async function saveBom(env, principal, organizationId, request) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN', 'EDITOR'], 'catalog:write');
  if (admission.error) return admission.error;
  const contract = await bomRevisionContract(await body(request), organizationId);
  const now = Date.now();
  const result = await requireDb(env).prepare(`INSERT INTO ecosystem_bom_revisions
    (organization_id, bom_id, revision, product_id, product_revision, publication_state, contract_json, bom_digest, created_at_ms, updated_at_ms, published_at_ms, is_current, supersedes_revision)
    VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, NULL, 0, ?)
    ON CONFLICT (organization_id, bom_id, revision) DO UPDATE SET product_id = excluded.product_id, product_revision = excluded.product_revision, contract_json = excluded.contract_json, bom_digest = excluded.bom_digest, supersedes_revision = excluded.supersedes_revision, updated_at_ms = excluded.updated_at_ms
    WHERE ecosystem_bom_revisions.publication_state = 'DRAFT'`)
    .bind(organizationId, contract.bomId, contract.revision, contract.productId, contract.productRevision, canonicalJson(contract), contract.bomDigest, now, now, contract.supersedesRevision || null).run();
  if (!changed(result)) return response(409, { error: 'published or reviewed BOM revisions are immutable; create a new revision or request changes' });
  await audit(requireDb(env), organizationId, principal, 'bom.save-draft', 'bom-revision', `${contract.bomId}:${contract.revision}`, { digest: contract.bomDigest });
  return response(201, { ...contract, publicationState: 'DRAFT' });
}

async function saveOffer(env, principal, organizationId, request) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN', 'EDITOR'], 'catalog:write');
  if (admission.error) return admission.error;
  const contract = await supplierOfferContract(await body(request));
  if (contract.supplierId !== organizationId) return response(400, { error: 'supplier offer must be owned by the organization' });
  const now = Date.now();
  const result = await requireDb(env).prepare(`INSERT INTO ecosystem_supplier_offers
    (organization_id, offer_id, supplier_id, product_manufacturer_id, product_id, product_revision, unit_price_minor, currency, available_quantity, lead_time_days, valid_at_ms, valid_until_ms, sponsored, publication_state, contract_json, offer_digest, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
    ON CONFLICT (organization_id, offer_id) DO UPDATE SET product_manufacturer_id = excluded.product_manufacturer_id, product_id = excluded.product_id, product_revision = excluded.product_revision, unit_price_minor = excluded.unit_price_minor, currency = excluded.currency, available_quantity = excluded.available_quantity, lead_time_days = excluded.lead_time_days, valid_at_ms = excluded.valid_at_ms, valid_until_ms = excluded.valid_until_ms, sponsored = excluded.sponsored, contract_json = excluded.contract_json, offer_digest = excluded.offer_digest, updated_at_ms = excluded.updated_at_ms
    WHERE ecosystem_supplier_offers.publication_state = 'DRAFT'`)
    .bind(organizationId, contract.offerId, contract.supplierId, contract.productManufacturerId, contract.productId, contract.productRevision, contract.unitPriceMinor, contract.currency, contract.availableQuantity, contract.leadTimeDays, contract.validAtMs, contract.validUntilMs, contract.sponsored ? 1 : 0, canonicalJson(contract), contract.offerDigest, now, now).run();
  if (!changed(result)) return response(409, { error: 'published or reviewed offers are immutable; withdraw and create a new offer ID' });
  await audit(requireDb(env), organizationId, principal, 'offer.save-draft', 'supplier-offer', contract.offerId, { digest: contract.offerDigest });
  return response(201, { ...contract, publicationState: 'DRAFT' });
}

async function syncPublishedOffer(env, principal, organizationId, offerId, request) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN', 'EDITOR'], 'offers:sync');
  if (admission.error) return admission.error;
  const contract = await supplierOfferContract(await body(request));
  if (contract.offerId !== offerId || contract.supplierId !== organizationId) return response(400, { error: 'synced offer identity must match the owned route identity' });
  const db = requireDb(env);
  const row = await db.prepare('SELECT publication_state, contract_json, offer_digest FROM ecosystem_supplier_offers WHERE organization_id = ? AND offer_id = ?').bind(organizationId, offerId).first();
  if (!row) return response(404, { error: 'supplier offer not found' });
  if (row.publication_state !== 'PUBLISHED') return response(409, { error: 'inventory sync requires an initially reviewed and published offer', currentState: row.publication_state });
  const previous = JSON.parse(row.contract_json);
  for (const field of ['supplierId', 'productManufacturerId', 'productId', 'productRevision', 'sponsored']) {
    if (previous[field] !== contract[field]) return response(409, { error: `inventory sync cannot change ${field}; withdraw and review a new offer instead` });
  }
  const now = Date.now();
  await db.prepare(`UPDATE ecosystem_supplier_offers SET unit_price_minor = ?, currency = ?, available_quantity = ?, lead_time_days = ?, valid_at_ms = ?, valid_until_ms = ?, contract_json = ?, offer_digest = ?, updated_at_ms = ?
    WHERE organization_id = ? AND offer_id = ? AND publication_state = 'PUBLISHED'`)
    .bind(contract.unitPriceMinor, contract.currency, contract.availableQuantity, contract.leadTimeDays, contract.validAtMs, contract.validUntilMs, canonicalJson(contract), contract.offerDigest, now, organizationId, offerId).run();
  await audit(db, organizationId, principal, 'offer.inventory-sync', 'supplier-offer', offerId, { previousDigest: row.offer_digest, offerDigest: contract.offerDigest, availableQuantity: contract.availableQuantity, validUntilMs: contract.validUntilMs });
  return response(200, { ...contract, publicationState: 'PUBLISHED', syncedAtMs: now });
}

async function assertPublishedProduct(db, manufacturerId, productId, revision) {
  const row = await db.prepare("SELECT 1 AS found FROM ecosystem_product_revisions WHERE manufacturer_id = ? AND product_id = ? AND revision = ? AND publication_state = 'PUBLISHED'").bind(manufacturerId, productId, revision).first();
  if (!row) throw new ApiError(409, `referenced product is not published: ${manufacturerId}:${productId}:${revision}`);
}

async function assertPublishableReferences(db, kind, contract) {
  if (kind === 'offers') return assertPublishedProduct(db, contract.productManufacturerId, contract.productId, contract.productRevision);
  if (kind !== 'boms') return;
  await assertPublishedProduct(db, contract.manufacturerId, contract.productId, contract.productRevision);
  for (const line of contract.lines) if (line.productId && line.productRevision) await assertPublishedProduct(db, line.manufacturerId, line.productId, line.productRevision);
}

async function transitionRecord(env, principal, organizationId, kind, recordId, revision, action, request) {
  const publishAction = ['publish', 'withdraw'].includes(action);
  const admission = await requireMember(env, organizationId, principal, publishAction ? ['OWNER', 'ADMIN'] : ['OWNER', 'ADMIN', 'EDITOR'], publishAction ? 'catalog:publish' : 'catalog:write');
  if (admission.error) return admission.error;
  const config = kind === 'products'
    ? { table: 'ecosystem_product_revisions', id: 'product_id', label: 'product revision', revisioned: true, currentBy: 'product_id' }
    : kind === 'boms'
      ? { table: 'ecosystem_bom_revisions', id: 'bom_id', label: 'BOM revision', revisioned: true, currentBy: 'bom_id' }
      : { table: 'ecosystem_supplier_offers', id: 'offer_id', label: 'supplier offer', revisioned: false, currentBy: null };
  const db = requireDb(env);
  const where = config.revisioned ? `organization_id = ? AND ${config.id} = ? AND revision = ?` : `organization_id = ? AND ${config.id} = ?`;
  const values = config.revisioned ? [organizationId, recordId, revision] : [organizationId, recordId];
  const row = await db.prepare(`SELECT publication_state, contract_json FROM ${config.table} WHERE ${where}`).bind(...values).first();
  if (!row) return response(404, { error: `${config.label} not found` });
  const transitions = { review: ['DRAFT', 'REVIEWED'], 'request-changes': ['REVIEWED', 'DRAFT'], publish: ['REVIEWED', 'PUBLISHED'], withdraw: ['PUBLISHED', 'WITHDRAWN'] };
  const rule = transitions[action];
  if (!rule || row.publication_state !== rule[0]) return response(409, { error: `${action} requires ${rule?.[0] || 'a supported'} state`, currentState: row.publication_state });
  const contract = JSON.parse(row.contract_json);
  if (action === 'publish') await assertPublishableReferences(db, kind, contract);
  let reason = null;
  if (action === 'withdraw') {
    const input = await body(request);
    reason = String(input.reason || '').trim();
    if (!reason || reason.length > 512) return response(400, { error: 'withdrawal reason is required' });
  }
  const now = Date.now();
  const statements = [];
  if (action === 'publish' && config.currentBy) statements.push(db.prepare(`UPDATE ${config.table} SET is_current = 0 WHERE organization_id = ? AND ${config.currentBy} = ? AND publication_state = 'PUBLISHED'`).bind(organizationId, recordId));
  const assignments = ['publication_state = ?', 'updated_at_ms = ?'];
  const bindings = [rule[1], now];
  if (action === 'publish' && config.revisioned) { assignments.push('published_at_ms = ?', 'is_current = 1'); bindings.push(now); }
  if (action === 'withdraw') { assignments.push('withdrawn_at_ms = ?', 'withdrawal_reason = ?'); bindings.push(now, reason); if (config.revisioned) assignments.push('is_current = 0'); }
  statements.push(db.prepare(`UPDATE ${config.table} SET ${assignments.join(', ')} WHERE ${where} AND publication_state = ?`).bind(...bindings, ...values, rule[0]));
  await db.batch(statements);
  await audit(db, organizationId, principal, `${kind}.${action}`, config.label, config.revisioned ? `${recordId}:${revision}` : recordId, { from: rule[0], to: rule[1], ...(reason ? { reason } : {}) });
  return response(200, { recordId, ...(revision === null ? {} : { revision }), publicationState: rule[1], ...(action === 'publish' ? { publishedAtMs: now } : {}), ...(action === 'withdraw' ? { withdrawnAtMs: now, withdrawalReason: reason } : {}) });
}

async function createCatalogImport(env, principal, organizationId, request) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN', 'EDITOR'], 'catalog:import');
  if (admission.error) return admission.error;
  const input = await body(request);
  const importId = String(input.importId || '').trim();
  const resource = String(input.resource || '').trim();
  if (!ID.test(importId)) return response(400, { error: 'catalog import ID is invalid' });
  const validation = await validateCatalog(resource, input.records, organizationId);
  if (validation.errors.length) return response(422, { error: 'catalog import failed preflight; no records were queued', recordCount: input.records.length, validCount: validation.validCount, invalidCount: validation.invalidCount, errors: validation.errors });
  const source = { schemaVersion: 'forge.catalog-import.v2', importId, organizationId, resource, records: input.records };
  const sourceDigest = await canonicalDigest(source);
  const objectKey = `${organizationId}/${importId}/${sourceDigest.slice(7)}.json`;
  if (!env.OEM_CATALOGS) throw new Error('OEM catalog evidence bucket binding is unavailable');
  const db = requireDb(env);
  const existing = await db.prepare('SELECT source_digest, status, accepted_count, rejected_count, error_json FROM ecosystem_catalog_imports WHERE organization_id = ? AND import_id = ?').bind(organizationId, importId).first();
  if (existing && existing.source_digest !== sourceDigest) return response(409, { error: 'catalog import ID is already bound to different source bytes' });
  if (existing && TERMINAL_IMPORTS.includes(existing.status)) return response(200, { importId, organizationId, resource, recordCount: input.records.length, sourceDigest, status: existing.status, acceptedCount: existing.accepted_count, rejectedCount: existing.rejected_count, errors: existing.error_json ? JSON.parse(existing.error_json) : [], idempotent: true });
  await env.OEM_CATALOGS.put(objectKey, canonicalJson(source), { httpMetadata: { contentType: 'application/json' }, customMetadata: { organizationId, importId, sourceDigest } });
  const now = Date.now();
  await db.prepare(`INSERT INTO ecosystem_catalog_imports
    (organization_id, import_id, resource, object_key, source_digest, record_count, status, submitted_by, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)
    ON CONFLICT (organization_id, import_id) DO NOTHING`)
    .bind(organizationId, importId, resource, objectKey, sourceDigest, input.records.length, principal.subject, now, now).run();
  if (!env.OEM_CATALOG_QUEUE) throw new Error('OEM catalog queue binding is unavailable');
  await env.OEM_CATALOG_QUEUE.send({ schemaVersion: 'forge.catalog-import-job.v2', organizationId, importId, resource, objectKey, sourceDigest });
  await audit(db, organizationId, principal, 'catalog-import.queue', 'catalog-import', importId, { resource, recordCount: input.records.length, sourceDigest });
  return response(202, { importId, organizationId, resource, recordCount: input.records.length, sourceDigest, status: 'QUEUED' });
}

async function getCatalogImport(env, principal, organizationId, importId) {
  const admission = await requireMember(env, organizationId, principal, undefined, 'catalog:read');
  if (admission.error) return admission.error;
  const row = await requireDb(env).prepare(`SELECT import_id, resource, source_digest, record_count, accepted_count, rejected_count, status, error_json, last_error, attempt_count, submitted_by, created_at_ms, updated_at_ms
    FROM ecosystem_catalog_imports WHERE organization_id = ? AND import_id = ?`).bind(organizationId, importId).first();
  if (!row) return response(404, { error: 'catalog import not found' });
  return response(200, { importId: row.import_id, resource: row.resource, sourceDigest: row.source_digest, recordCount: row.record_count, acceptedCount: row.accepted_count, rejectedCount: row.rejected_count, status: row.status, errors: row.error_json ? JSON.parse(row.error_json) : [], lastError: row.last_error, attemptCount: row.attempt_count, submittedBy: row.submitted_by, createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms });
}

async function listOwned(env, principal, organizationId, type) {
  const admission = await requireMember(env, organizationId, principal, undefined, 'catalog:read');
  if (admission.error) return admission.error;
  const db = requireDb(env);
  if (type === 'catalog-imports') {
    const result = await db.prepare(`SELECT import_id, resource, record_count, accepted_count, rejected_count, status, last_error, attempt_count, created_at_ms, updated_at_ms
      FROM ecosystem_catalog_imports WHERE organization_id = ? ORDER BY created_at_ms DESC LIMIT 200`).bind(organizationId).all();
    return response(200, { imports: (result.results || []).map(row => ({ importId: row.import_id, resource: row.resource, recordCount: row.record_count, acceptedCount: row.accepted_count, rejectedCount: row.rejected_count, status: row.status, lastError: row.last_error, attemptCount: row.attempt_count, createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms })) });
  }
  const config = type === 'products' ? { table: 'ecosystem_product_revisions' } : type === 'boms' ? { table: 'ecosystem_bom_revisions' } : { table: 'ecosystem_supplier_offers' };
  const result = await db.prepare(`SELECT contract_json, publication_state, ${type === 'offers' ? 'NULL AS published_at_ms, 0 AS is_current' : 'published_at_ms, is_current'}, withdrawn_at_ms, withdrawal_reason FROM ${config.table} WHERE organization_id = ? ORDER BY updated_at_ms DESC LIMIT 500`).bind(organizationId).all();
  return response(200, { [type]: (result.results || []).map(publicRecord) });
}

async function inviteMember(env, principal, organizationId, request) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN'], 'catalog:admin');
  if (admission.error) return admission.error;
  if (principal.kind !== 'ACCESS') return response(403, { error: 'only an Access user can manage team membership' });
  const input = await body(request);
  const email = String(input.email || '').trim().toLowerCase();
  const role = String(input.role || '').trim();
  if (!EMAIL.test(email) || !['ADMIN', 'EDITOR', 'VIEWER'].includes(role)) return response(400, { error: 'invitation email or role is invalid' });
  const invitationId = `invite-${crypto.randomUUID()}`;
  const now = Date.now();
  await requireDb(env).prepare(`INSERT INTO ecosystem_invitations
    (invitation_id, organization_id, email, role, status, invited_by, created_at_ms)
    VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`)
    .bind(invitationId, organizationId, email, role, principal.subject, now).run();
  await audit(requireDb(env), organizationId, principal, 'member.invite', 'invitation', invitationId, { email, role });
  return response(201, { invitationId, email, role, status: 'PENDING', createdAtMs: now });
}

async function listMembers(env, principal, organizationId) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN'], 'catalog:admin');
  if (admission.error) return admission.error;
  const db = requireDb(env);
  const [members, invitations] = await Promise.all([
    db.prepare('SELECT access_subject, email, role, status, created_at_ms FROM ecosystem_memberships WHERE organization_id = ? ORDER BY created_at_ms').bind(organizationId).all(),
    db.prepare("SELECT invitation_id, email, role, status, created_at_ms FROM ecosystem_invitations WHERE organization_id = ? AND status = 'PENDING' ORDER BY created_at_ms").bind(organizationId).all(),
  ]);
  return response(200, { members: members.results || [], invitations: invitations.results || [] });
}

async function revokeInvitation(env, principal, organizationId, invitationId) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN'], 'catalog:admin');
  if (admission.error) return admission.error;
  if (principal.kind !== 'ACCESS') return response(403, { error: 'only an Access user can manage team membership' });
  const result = await requireDb(env).prepare("UPDATE ecosystem_invitations SET status = 'REVOKED' WHERE organization_id = ? AND invitation_id = ? AND status = 'PENDING'").bind(organizationId, invitationId).run();
  if (!changed(result)) return response(404, { error: 'pending invitation not found' });
  await audit(requireDb(env), organizationId, principal, 'member.invitation-revoke', 'invitation', invitationId);
  return response(200, { invitationId, status: 'REVOKED' });
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function createCredential(env, principal, organizationId, request) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN'], 'catalog:admin');
  if (admission.error) return admission.error;
  if (principal.kind !== 'ACCESS') return response(403, { error: 'only an Access user can manage service credentials' });
  const input = await body(request);
  const name = String(input.name || '').trim();
  const role = String(input.role || 'EDITOR');
  const allowedScopes = ['catalog:read', 'catalog:write', 'catalog:import', 'offers:sync'];
  const scopes = [...new Set(Array.isArray(input.scopes) ? input.scopes : [])];
  if (!name || name.length > 128 || !['EDITOR', 'VIEWER'].includes(role) || scopes.length === 0 || scopes.some(scope => !allowedScopes.includes(scope)) || (role === 'VIEWER' && scopes.some(scope => scope !== 'catalog:read'))) return response(400, { error: 'credential name, role, or scopes are invalid' });
  const credentialId = crypto.randomUUID();
  const key = `forge_oem_${credentialId}.${randomSecret()}`;
  const now = Date.now();
  await requireDb(env).prepare(`INSERT INTO ecosystem_api_credentials
    (credential_id, organization_id, name, key_prefix, key_hash, role, scopes_json, status, created_by, created_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`)
    .bind(credentialId, organizationId, name, key.slice(0, 24), await canonicalDigest(key), role, canonicalJson(scopes.sort()), principal.subject, now).run();
  await audit(requireDb(env), organizationId, principal, 'credential.create', 'api-credential', credentialId, { name, role, scopes });
  return response(201, { credentialId, name, role, scopes, key, warning: 'This credential is shown once. Store it in your secrets manager.' });
}

async function listCredentials(env, principal, organizationId) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN'], 'catalog:admin');
  if (admission.error) return admission.error;
  const result = await requireDb(env).prepare(`SELECT credential_id, name, key_prefix, role, scopes_json, status, created_at_ms, last_used_at_ms, revoked_at_ms
    FROM ecosystem_api_credentials WHERE organization_id = ? ORDER BY created_at_ms DESC`).bind(organizationId).all();
  return response(200, { credentials: (result.results || []).map(row => ({ credentialId: row.credential_id, name: row.name, keyPrefix: row.key_prefix, role: row.role, scopes: JSON.parse(row.scopes_json), status: row.status, createdAtMs: row.created_at_ms, lastUsedAtMs: row.last_used_at_ms, revokedAtMs: row.revoked_at_ms })) });
}

async function revokeCredential(env, principal, organizationId, credentialId) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN'], 'catalog:admin');
  if (admission.error) return admission.error;
  if (principal.kind !== 'ACCESS') return response(403, { error: 'only an Access user can manage service credentials' });
  const result = await requireDb(env).prepare("UPDATE ecosystem_api_credentials SET status = 'REVOKED', revoked_at_ms = ? WHERE organization_id = ? AND credential_id = ? AND status = 'ACTIVE'").bind(Date.now(), organizationId, credentialId).run();
  if (!changed(result)) return response(404, { error: 'active service credential not found' });
  await audit(requireDb(env), organizationId, principal, 'credential.revoke', 'api-credential', credentialId);
  return response(200, { credentialId, status: 'REVOKED' });
}

async function listAudit(env, principal, organizationId) {
  const admission = await requireMember(env, organizationId, principal, ['OWNER', 'ADMIN'], 'catalog:admin');
  if (admission.error) return admission.error;
  const result = await requireDb(env).prepare(`SELECT event_id, actor_subject, actor_kind, action, resource_type, resource_id, detail_json, created_at_ms
    FROM ecosystem_audit_events WHERE organization_id = ? ORDER BY created_at_ms DESC LIMIT 200`).bind(organizationId).all();
  return response(200, { events: (result.results || []).map(row => ({ eventId: row.event_id, actorSubject: row.actor_subject, actorKind: row.actor_kind, action: row.action, resourceType: row.resource_type, resourceId: row.resource_id, detail: JSON.parse(row.detail_json), createdAtMs: row.created_at_ms })) });
}

export async function handleEcosystemRequest(request, env, identityOverride) {
  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const segments = url.pathname.replace(/^\/api\/ecosystem\/v1\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const db = requireDb(env);
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'products') return listPublicProducts(db, url);
    if (request.method === 'GET' && segments.length === 2 && segments[0] === 'products') return getPublicProduct(db, segments[1], url.searchParams.get('revision'), url);
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'offers') return listPublicOffers(db, url);
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'boms') return listPublicBoms(db, url);

    const principal = await authenticate(request, env, identityOverride);
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'me') return getMe(env, principal);
    if (request.method === 'POST' && segments.length === 1 && segments[0] === 'organizations') return createOrganization(env, principal, request);
    if (segments[0] === 'organizations' && segments.length >= 3) {
      const organizationId = segments[1];
      if (request.method === 'GET' && segments.length === 3 && ['products', 'boms', 'offers', 'catalog-imports'].includes(segments[2])) return listOwned(env, principal, organizationId, segments[2]);
      if (request.method === 'POST' && segments.length === 3 && segments[2] === 'products') return saveProduct(env, principal, organizationId, request);
      if (request.method === 'POST' && segments.length === 3 && segments[2] === 'boms') return saveBom(env, principal, organizationId, request);
      if (request.method === 'POST' && segments.length === 3 && segments[2] === 'offers') return saveOffer(env, principal, organizationId, request);
      if (request.method === 'POST' && segments.length === 5 && segments[2] === 'offers' && segments[4] === 'sync') return syncPublishedOffer(env, principal, organizationId, segments[3], request);
      if (request.method === 'POST' && segments.length === 4 && segments[2] === 'catalog-imports' && segments[3] === 'preflight') return preflightCatalog(env, principal, organizationId, request);
      if (request.method === 'POST' && segments.length === 3 && segments[2] === 'catalog-imports') return createCatalogImport(env, principal, organizationId, request);
      if (request.method === 'GET' && segments.length === 4 && segments[2] === 'catalog-imports') return getCatalogImport(env, principal, organizationId, segments[3]);
      if (request.method === 'GET' && segments.length === 3 && segments[2] === 'members') return listMembers(env, principal, organizationId);
      if (request.method === 'POST' && segments.length === 3 && segments[2] === 'invitations') return inviteMember(env, principal, organizationId, request);
      if (request.method === 'POST' && segments.length === 5 && segments[2] === 'invitations' && segments[4] === 'revoke') return revokeInvitation(env, principal, organizationId, segments[3]);
      if (request.method === 'GET' && segments.length === 3 && segments[2] === 'api-credentials') return listCredentials(env, principal, organizationId);
      if (request.method === 'POST' && segments.length === 3 && segments[2] === 'api-credentials') return createCredential(env, principal, organizationId, request);
      if (request.method === 'POST' && segments.length === 5 && segments[2] === 'api-credentials' && segments[4] === 'revoke') return revokeCredential(env, principal, organizationId, segments[3]);
      if (request.method === 'GET' && segments.length === 3 && segments[2] === 'audit-events') return listAudit(env, principal, organizationId);
      if (request.method === 'POST' && segments.length === 6 && ['products', 'boms'].includes(segments[2]) && ['review', 'request-changes', 'publish', 'withdraw'].includes(segments[5])) return transitionRecord(env, principal, organizationId, segments[2], segments[3], segments[4], segments[5], request);
      if (request.method === 'POST' && segments.length === 5 && segments[2] === 'offers' && ['review', 'request-changes', 'publish', 'withdraw'].includes(segments[4])) return transitionRecord(env, principal, organizationId, 'offers', segments[3], null, segments[4], request);
    }
    return response(404, { error: 'ecosystem route not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ecosystem request failed';
    const status = error instanceof ApiError ? error.status : /UNIQUE|constraint/i.test(message) ? 409 : /invalid|missing|unknown|requires|must|exceeds|unsupported/i.test(message) ? 400 : 503;
    return response(status, { error: message, ...(error instanceof ApiError ? error.detail : {}) });
  }
}

export default {
  fetch(request, env) {
    // The shared Pages router passes an execution context as its third
    // argument. Never reinterpret that object as an authenticated identity.
    return handleEcosystemRequest(request, env, undefined);
  },
};
