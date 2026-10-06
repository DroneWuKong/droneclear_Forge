const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const CURRENCY = /^[A-Z]{3}$/;
const EVIDENCE_REF = /^[A-Za-z][A-Za-z0-9+.-]*:.+$/;

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export async function canonicalDigest(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value))));
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function object(value, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${label} must be an object`);
  return value;
}
function text(value, label, maximum = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`${label} is invalid`);
  return value.trim();
}
function id(value, label) {
  const parsed = text(value, label, 128);
  if (!ID.test(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}
function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} is invalid`);
  return value;
}
function strings(value, label, maximum = 256) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} must be a bounded array`);
  return [...new Set(value.map(item => text(item, label, 2048)))].sort();
}
function evidence(value, label) {
  const refs = strings(value, label);
  if (refs.length === 0 || refs.some(ref => !EVIDENCE_REF.test(ref))) throw new Error(`${label} must contain scheme-qualified references`);
  return refs;
}
function exact(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !(key in value)) || Object.keys(value).some(key => !allowed.has(key))) throw new Error(`${label} contains missing or unknown fields`);
}

export async function productRevisionContract(value, manufacturerId) {
  const input = object(value, 'product revision');
  exact(input, ['productId', 'revision', 'manufacturerName', 'partNumber', 'name', 'category', 'compatibilityTags', 'lifecycle', 'evidenceRefs'], ['gtin', 'supersedesRevision'], 'product revision');
  const lifecycle = text(input.lifecycle, 'product lifecycle', 32);
  if (!['ACTIVE', 'LIMITED', 'END_OF_LIFE', 'WITHDRAWN'].includes(lifecycle)) throw new Error('product lifecycle is unsupported');
  const parsedManufacturerId = id(manufacturerId, 'manufacturer ID');
  const productId = id(input.productId, 'product ID');
  const base = {
    schemaVersion: 'forge.product-revision.v2', productId, revision: text(input.revision, 'product revision', 128),
    manufacturerId: parsedManufacturerId, qualifiedProductId: `${parsedManufacturerId}:${productId}`,
    manufacturerName: text(input.manufacturerName, 'manufacturer name'), partNumber: text(input.partNumber, 'part number'),
    ...(input.gtin === undefined ? {} : { gtin: text(input.gtin, 'GTIN', 64) }), name: text(input.name, 'product name'), category: id(input.category, 'product category'),
    compatibilityTags: strings(input.compatibilityTags, 'compatibility tag'), lifecycle,
    ...(input.supersedesRevision === undefined ? {} : { supersedesRevision: text(input.supersedesRevision, 'superseded product revision', 128) }),
    evidenceRefs: evidence(input.evidenceRefs, 'product evidence reference'),
  };
  if (base.supersedesRevision === base.revision) throw new Error('product revision cannot supersede itself');
  return { ...base, productDigest: await canonicalDigest(base) };
}

export async function bomRevisionContract(value, manufacturerId) {
  const input = object(value, 'BOM revision');
  exact(input, ['bomId', 'revision', 'productId', 'productRevision', 'lines', 'evidenceRefs'], ['supersedesRevision'], 'BOM revision');
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 4096) throw new Error('BOM lines must be a non-empty bounded array');
  const lines = input.lines.map((entry, index) => {
    const line = object(entry, `BOM line ${index}`);
    exact(line, ['lineId', 'slot', 'quantity', 'requiredCompatibilityTags', 'substitutionsAllowed'], ['manufacturerId', 'productId', 'productRevision', 'category'], `BOM line ${index}`);
    if (typeof line.substitutionsAllowed !== 'boolean') throw new Error(`BOM line ${index} substitution policy is invalid`);
    if (line.productId === undefined && line.category === undefined) throw new Error(`BOM line ${index} requires a product or category`);
    if (line.productId !== undefined && line.manufacturerId === undefined) throw new Error(`BOM line ${index} product requires manufacturerId`);
    if (line.productId === undefined && (line.manufacturerId !== undefined || line.productRevision !== undefined)) throw new Error(`BOM line ${index} has product qualifiers without a product`);
    return {
      lineId: id(line.lineId, 'BOM line ID'), slot: id(line.slot, 'BOM line slot'), quantity: integer(line.quantity, 'BOM line quantity', 1),
      ...(line.manufacturerId === undefined ? {} : { manufacturerId: id(line.manufacturerId, 'BOM product manufacturer ID') }),
      ...(line.productId === undefined ? {} : { productId: id(line.productId, 'BOM product ID') }),
      ...(line.productRevision === undefined ? {} : { productRevision: text(line.productRevision, 'BOM product revision', 128) }),
      ...(line.category === undefined ? {} : { category: id(line.category, 'BOM category') }),
      requiredCompatibilityTags: strings(line.requiredCompatibilityTags, 'BOM compatibility tag'), substitutionsAllowed: line.substitutionsAllowed,
    };
  });
  if (new Set(lines.map(line => line.lineId)).size !== lines.length || new Set(lines.map(line => line.slot)).size !== lines.length) throw new Error('BOM line identities and slots must be unique');
  const parsedManufacturerId = id(manufacturerId, 'manufacturer ID');
  const productId = id(input.productId, 'BOM product ID');
  const base = {
    schemaVersion: 'forge.bom-revision.v2', bomId: id(input.bomId, 'BOM ID'), revision: text(input.revision, 'BOM revision', 128),
    manufacturerId: parsedManufacturerId, productId, qualifiedProductId: `${parsedManufacturerId}:${productId}`,
    productRevision: text(input.productRevision, 'BOM product revision', 128), lines,
    ...(input.supersedesRevision === undefined ? {} : { supersedesRevision: text(input.supersedesRevision, 'superseded BOM revision', 128) }),
    evidenceRefs: evidence(input.evidenceRefs, 'BOM evidence reference'),
  };
  if (base.supersedesRevision === base.revision) throw new Error('BOM revision cannot supersede itself');
  return { ...base, bomDigest: await canonicalDigest(base) };
}

export async function supplierOfferContract(value) {
  const input = object(value, 'supplier offer');
  exact(input, ['offerId', 'supplierId', 'productManufacturerId', 'productId', 'productRevision', 'currency', 'unitPriceMinor', 'availableQuantity', 'leadTimeDays', 'validAtMs', 'validUntilMs', 'evidenceRefs', 'sponsored'], [], 'supplier offer');
  if (typeof input.sponsored !== 'boolean') throw new Error('supplier offer sponsored marker is invalid');
  const currency = text(input.currency, 'offer currency', 3).toUpperCase();
  if (!CURRENCY.test(currency)) throw new Error('offer currency must be a three-letter ISO 4217 code');
  const productManufacturerId = id(input.productManufacturerId, 'offer product manufacturer ID');
  const productId = id(input.productId, 'offer product ID');
  const base = {
    schemaVersion: 'forge.supplier-offer.v2', offerId: id(input.offerId, 'offer ID'), supplierId: id(input.supplierId, 'supplier ID'),
    productManufacturerId, productId, qualifiedProductId: `${productManufacturerId}:${productId}`,
    productRevision: text(input.productRevision, 'offer product revision', 128), currency,
    unitPriceMinor: integer(input.unitPriceMinor, 'offer unit price'), availableQuantity: integer(input.availableQuantity, 'offer available quantity'), leadTimeDays: integer(input.leadTimeDays, 'offer lead time'),
    validAtMs: integer(input.validAtMs, 'offer valid-at time'), validUntilMs: integer(input.validUntilMs, 'offer expiry time'), evidenceRefs: evidence(input.evidenceRefs, 'offer evidence reference'), sponsored: input.sponsored,
  };
  if (base.validUntilMs <= base.validAtMs) throw new Error('supplier offer validity window is invalid');
  return { ...base, offerDigest: await canonicalDigest(base) };
}
