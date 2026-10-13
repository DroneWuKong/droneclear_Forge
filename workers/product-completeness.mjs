export async function bomCompleteness(db, contract) {
  const missing = [];
  if (!contract.evidenceRefs?.length) missing.push('Add BOM evidence.');
  if (!contract.lines?.length) missing.push('Add BOM lines.');
  for (const line of contract.lines || []) {
    if (!line.manufacturerId || !line.productId || !line.productRevision) {
      missing.push(`Resolve ${line.slot || line.lineId} to a manufacturer, product, and exact revision.`);
      continue;
    }
    const product = await db.prepare(`SELECT 1 AS found FROM ecosystem_product_revisions
      WHERE manufacturer_id = ? AND product_id = ? AND revision = ? AND publication_state = 'PUBLISHED' AND is_complete = 1`)
      .bind(line.manufacturerId, line.productId, line.productRevision).first();
    if (!product) missing.push(`Publish the complete component ${line.manufacturerId}:${line.productId}:${line.productRevision}.`);
  }
  return { isComplete: missing.length === 0, missing };
}

export async function productCompleteness(db, organizationId, contract) {
  const missing = [];
  for (const [field, label] of [['name','product name'],['manufacturerName','manufacturer name'],['partNumber','part number'],['category','category'],['revision','revision'],['description','description']]) {
    if (typeof contract[field] !== 'string' || !contract[field].trim()) missing.push(`Add the ${label}.`);
  }
  if (!['COMPONENT','ASSEMBLY'].includes(contract.productKind)) missing.push('Choose whether this is a component or an assembly.');
  if (contract.completionState !== 'COMPLETE') missing.push('Mark the product complete when its information is finished.');
  if (!contract.evidenceRefs?.length) missing.push('Add supporting product evidence.');
  let bom = null;
  if (contract.productKind === 'ASSEMBLY') {
    const row = await db.prepare(`SELECT bom_id, revision, contract_json, publication_state FROM ecosystem_bom_revisions
      WHERE organization_id = ? AND product_id = ? AND product_revision = ? AND publication_state IN ('REVIEWED','PUBLISHED')
      ORDER BY updated_at_ms DESC LIMIT 1`).bind(organizationId, contract.productId, contract.revision).first();
    if (!row) missing.push('Attach and submit a complete BOM for this exact product revision.');
    else {
      const completeness = await bomCompleteness(db, JSON.parse(row.contract_json));
      missing.push(...completeness.missing);
      bom = { bomId: row.bom_id, revision: row.revision, publicationState: row.publication_state };
    }
  }
  return { isComplete: missing.length === 0, missing, requiresBom: contract.productKind === 'ASSEMBLY', bom };
}
