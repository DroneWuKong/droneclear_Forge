const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

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
function exact(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !(key in value)) || Object.keys(value).some(key => !allowed.has(key))) throw new Error(`${label} contains missing or unknown fields`);
}

export async function productRevisionContract(value, manufacturerId) {
  const input = object(value, 'product revision');
  exact(input, ['productId', 'revision', 'manufacturerName', 'partNumber', 'name', 'category', 'compatibilityTags', 'lifecycle', 'evidenceRefs'], ['gtin'], 'product revision');
  const lifecycle = text(input.lifecycle, 'product lifecycle', 32);
  if (!['ACTIVE', 'LIMITED', 'END_OF_LIFE', 'WITHDRAWN'].includes(lifecycle)) throw new Error('product lifecycle is unsupported');
  const base = {
    schemaVersion: 'forge.product-revision.v1', productId: id(input.productId, 'product ID'), revision: text(input.revision, 'product revision', 128),
    manufacturerId: id(manufacturerId, 'manufacturer ID'), manufacturerName: text(input.manufacturerName, 'manufacturer name'), partNumber: text(input.partNumber, 'part number'),
    ...(input.gtin === undefined ? {} : { gtin: text(input.gtin, 'GTIN', 64) }), name: text(input.name, 'product name'), category: id(input.category, 'product category'),
    compatibilityTags: strings(input.compatibilityTags, 'compatibility tag'), lifecycle, evidenceRefs: strings(input.evidenceRefs, 'product evidence reference'),
  };
  if (base.evidenceRefs.length === 0) throw new Error('product revision requires evidence');
  return { ...base, productDigest: await canonicalDigest(base) };
}

export async function bomRevisionContract(value, manufacturerId) {
  const input = object(value, 'BOM revision');
  exact(input, ['bomId', 'revision', 'productId', 'productRevision', 'lines', 'evidenceRefs'], [], 'BOM revision');
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 4096) throw new Error('BOM lines must be a non-empty bounded array');
  const lines = input.lines.map((entry, index) => {
    const line = object(entry, `BOM line ${index}`);
    exact(line, ['lineId', 'slot', 'quantity', 'requiredCompatibilityTags', 'substitutionsAllowed'], ['productId', 'productRevision', 'category'], `BOM line ${index}`);
    if (typeof line.substitutionsAllowed !== 'boolean') throw new Error(`BOM line ${index} substitution policy is invalid`);
    if (line.productId === undefined && line.category === undefined) throw new Error(`BOM line ${index} requires a product or category`);
    return {
      lineId: id(line.lineId, 'BOM line ID'), slot: id(line.slot, 'BOM line slot'), quantity: integer(line.quantity, 'BOM line quantity', 1),
      ...(line.productId === undefined ? {} : { productId: id(line.productId, 'BOM product ID') }),
      ...(line.productRevision === undefined ? {} : { productRevision: text(line.productRevision, 'BOM product revision', 128) }),
      ...(line.category === undefined ? {} : { category: id(line.category, 'BOM category') }),
      requiredCompatibilityTags: strings(line.requiredCompatibilityTags, 'BOM compatibility tag'), substitutionsAllowed: line.substitutionsAllowed,
    };
  });
  if (new Set(lines.map(line => line.lineId)).size !== lines.length || new Set(lines.map(line => line.slot)).size !== lines.length) throw new Error('BOM line identities and slots must be unique');
  const base = { schemaVersion: 'forge.bom-revision.v1', bomId: id(input.bomId, 'BOM ID'), revision: text(input.revision, 'BOM revision', 128), manufacturerId: id(manufacturerId, 'manufacturer ID'), productId: id(input.productId, 'BOM product ID'), productRevision: text(input.productRevision, 'BOM product revision', 128), lines, evidenceRefs: strings(input.evidenceRefs, 'BOM evidence reference') };
  if (base.evidenceRefs.length === 0) throw new Error('BOM revision requires evidence');
  return { ...base, bomDigest: await canonicalDigest(base) };
}

export async function supplierOfferContract(value) {
  const input = object(value, 'supplier offer');
  exact(input, ['offerId', 'supplierId', 'productId', 'productRevision', 'currency', 'unitPriceMinor', 'availableQuantity', 'leadTimeDays', 'validAtMs', 'validUntilMs', 'evidenceRefs', 'sponsored'], [], 'supplier offer');
  if (typeof input.sponsored !== 'boolean') throw new Error('supplier offer sponsored marker is invalid');
  const base = {
    schemaVersion: 'forge.supplier-offer.v1', offerId: id(input.offerId, 'offer ID'), supplierId: id(input.supplierId, 'supplier ID'),
    productId: id(input.productId, 'offer product ID'), productRevision: text(input.productRevision, 'offer product revision', 128), currency: text(input.currency, 'offer currency', 3).toUpperCase(),
    unitPriceMinor: integer(input.unitPriceMinor, 'offer unit price'), availableQuantity: integer(input.availableQuantity, 'offer available quantity'), leadTimeDays: integer(input.leadTimeDays, 'offer lead time'),
    validAtMs: integer(input.validAtMs, 'offer valid-at time'), validUntilMs: integer(input.validUntilMs, 'offer expiry time'), evidenceRefs: strings(input.evidenceRefs, 'offer evidence reference'), sponsored: input.sponsored,
  };
  if (base.validUntilMs <= base.validAtMs || base.evidenceRefs.length === 0) throw new Error('supplier offer validity or evidence is invalid');
  return { ...base, offerDigest: await canonicalDigest(base) };
}
