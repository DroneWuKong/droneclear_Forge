import { sha256, canonicalJson } from './retrieval-policy.mjs';

const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACTIONS = new Set(['accept-as-judgment', 'reject-as-noise', 'needs-context']);

export function cleanForgeMatchingFeedback(input) {
  const target = input?.target, f = target?.features;
  const finite = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  if (input?.schema_version !== 'forge-match-feedback-v1'
    || !UUID.test(input.feedback_id || '') || !SHA.test(input.context_sha256 || '')
    || !SHA.test(input.catalog_revision || '') || input.policy_version !== 'compatibility-weight-v1'
    || !/^[a-z][a-z0-9_]{0,63}$/.test(input.category || '')
    || !['helpful', 'wrong_match', 'catalog_error'].includes(input.label)
    || typeof target?.product_id !== 'string' || !target.product_id.trim()
    || target.product_id.length > 256 || /[\u0000-\u001f\u007f]/.test(target.product_id)
    || !['compatible', 'caution', 'incompatible'].includes(target?.compatibility_group)
    || !Number.isInteger(target?.position) || target.position < 1 || target.position > 10000
    || typeof f?.weight_known !== 'boolean' || !finite(f?.weight_g, 100000)
    || !Number.isInteger(f?.warning_count) || !finite(f.warning_count, 100)
    || !finite(f?.specification_completeness, 1)
    || (!f.weight_known && f.weight_g !== 0)
    || (target.compatibility_group === 'compatible' && f.warning_count !== 0)
    || (target.compatibility_group !== 'compatible' && f.warning_count === 0)) {
    throw new Error('Invalid Forge matching feedback');
  }
  // Whitelist fields: build contents, free text and identity never enter this ledger.
  return {
    schema_version: 'forge-match-feedback-v1', feedback_id: input.feedback_id,
    context_sha256: input.context_sha256, catalog_revision: input.catalog_revision,
    policy_id: 'forge-product-matching', policy_version: input.policy_version,
    category: input.category, label: input.label,
    target: { product_id: target.product_id, compatibility_group: target.compatibility_group,
      position: target.position, features: { weight_known: f.weight_known, weight_g: f.weight_g,
        warning_count: f.warning_count, specification_completeness: f.specification_completeness } },
    signal_quality: 'explicit-unreviewed',
    data_policy: { anonymized: true, retention_days: 180 },
  };
}

export async function handleForgeMatchingFeedback(request, env, helpers) {
  const path = new URL(request.url).pathname.split('/api/autonomy/')[1];
  if (path !== 'forge-feedback' && !/^forge-feedback\/[0-9a-f]{24}$/.test(path || '')) return null;
  const { respond, parseBody, reviewAuthorized, sameOrigin, rateLimit } = helpers;
  const db = env.AUTONOMY_DB;
  if (path === 'forge-feedback' && request.method === 'POST') {
    if (!sameOrigin) return respond(403, { error: 'Same-origin feedback required' });
    const limited = await rateLimit();
    if (limited) return limited;
    const feedback = cleanForgeMatchingFeedback(await parseBody(request, 16384));
    const id = (await sha256(`forge-match-feedback\x1f${feedback.feedback_id}`)).slice(0, 24);
    const data = canonicalJson(feedback);
    const existing = await db.prepare('SELECT data FROM evidence_events WHERE id=?1').bind(id).first();
    if (existing && existing.data !== data) return respond(409, { error: 'Feedback id already used for different data' });
    // OR IGNORE also makes concurrent retries idempotent. Read again to detect conflicting races.
    await db.prepare('INSERT OR IGNORE INTO evidence_events(id,entity_type,entity_id,event_type,data,created) VALUES(?1,?2,?3,?4,?5,?6)')
      .bind(id, 'forge-matching', feedback.context_sha256, 'forge-match-feedback', data, new Date().toISOString()).run();
    const stored = await db.prepare('SELECT data FROM evidence_events WHERE id=?1').bind(id).first();
    if (stored?.data !== data) return respond(409, { error: 'Feedback id already used for different data' });
    return respond(202, { received: true, event_id: id, signal_quality: 'explicit-unreviewed', automatic_promotion: false });
  }
  if (!reviewAuthorized) return respond(401, { error: 'Reviewer authorization required' });
  if (path === 'forge-feedback' && request.method === 'GET') {
    const rows = await db.prepare("SELECT e.id,e.entity_id,e.data,e.created,(SELECT d.data FROM evidence_events d WHERE d.entity_type='forge-feedback' AND d.entity_id=e.id AND d.event_type='reviewer-disposition' ORDER BY d.created DESC,d.rowid DESC LIMIT 1) disposition FROM evidence_events e WHERE e.entity_type='forge-matching' AND e.event_type='forge-match-feedback' ORDER BY e.created DESC,e.id DESC LIMIT 1000").all();
    return respond(200, { schema_version: 'forge-match-feedback-export-v1', automatic_promotion: false,
      limit: 1000, truncated: rows.results.length === 1000,
      feedback: rows.results.map(row => ({ id: row.id, created: row.created,
        data: JSON.parse(row.data), disposition: row.disposition ? JSON.parse(row.disposition) : null })) });
  }
  if (request.method === 'POST' && path !== 'forge-feedback') {
    const input = await parseBody(request, 8192);
    const notes = typeof input?.notes === 'string' ? input.notes.trim() : '';
    if (!ACTIONS.has(input?.action) || !notes || notes.length > 5000) return respond(400, { error: 'A valid disposition and reviewer note are required' });
    const id = path.split('/')[1];
    if (!await db.prepare("SELECT id FROM evidence_events WHERE id=?1 AND entity_type='forge-matching' AND event_type='forge-match-feedback'").bind(id).first()) return respond(404, { error: 'Forge feedback not found' });
    const disposition = { action: input.action, notes, reviewed_at: new Date().toISOString() };
    const eventId = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    await db.prepare('INSERT INTO evidence_events(id,entity_type,entity_id,event_type,data,created) VALUES(?1,?2,?3,?4,?5,?6)')
      .bind(eventId, 'forge-feedback', id, 'reviewer-disposition', JSON.stringify(disposition), disposition.reviewed_at).run();
    return respond(200, { id, event_id: eventId, disposition, automatic_promotion: false });
  }
  return respond(405, { error: 'Method not allowed' });
}
