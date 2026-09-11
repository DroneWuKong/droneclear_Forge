// Shared, deterministic daily projection. No model or browser state changes evidence.
const STATES = new Set(['new', 'changed', 'escalated', 'deescalated', 'resolved', 'contradicted', 'unchanged', 'baseline']);
const WEIGHTS = {contradicted: 60, escalated: 50, new: 40, changed: 35, resolved: 30, deescalated: 25, unchanged: 0, baseline: 0};
export function safeURL(value) {
  try { const u = new URL(String(value)); return /^https?:$/.test(u.protocol) && !u.username && !u.password && u.href.length <= 2048 ? u.href : ''; } catch { return ''; }
}
const text = (value, length = 1200) => typeof value === 'string' ? value.slice(0, length) : '';
// Ranking is navigation assistance, never a probability or claim-support score.
const UAS_TERMS = /\b(?:uas|uav|ucav|drones?|unmanned|uncrewed|counter[- ]?uas|fpv|autopilots?)\b/i;
function evidenceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return '';
  const ms=Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10)===value.slice(0,10) ? value : '';
}
export function projectDaily(input, params = new URLSearchParams(), now = Date.now()) {
  const flags = (Array.isArray(input) ? input : Array.isArray(input?.flags) ? input.flags : []).filter(f => f && typeof f === 'object');
  const dates = [...new Set(flags.map(f => f.last_verified_at))];
  const generated = flags.length && dates.length === 1 && typeof dates[0] === 'string' && Number.isFinite(Date.parse(dates[0])) ? dates[0] : null;
  const age = generated ? now - Date.parse(generated) : NaN;
  const coverage = {status: !flags.length || !Number.isFinite(age) ? 'unavailable' : age < -300000 || age > 72 * 3600000 ? 'stale' : 'available', generated_at: generated, collector_health: 'not_assessed', meaning: 'Flag comparison age. Rebuilding an existing artifact does not verify upstream collection or refresh source evidence.'};
  const counts = Object.fromEntries([...STATES].map(k => [k, 0]));
  const requestedRecord = params.get('record') || '';
  const idCounts = new Map();
  for (const flag of flags) { const id=String(flag.id ?? ''); if(id) idCounts.set(id,(idCounts.get(id)||0)+1); }
  const ambiguousIds = new Set([...idCounts].filter(([,count])=>count>1).map(([id])=>id));
  if (ambiguousIds.size && coverage.status === 'available') coverage.status='partial';
  coverage.ambiguous_record_count=ambiguousIds.size;
  const seen = new Set();
  const records = [];
  const query = text(params.get('q'), 160).trim().toLowerCase();
  const kindFilter = params.get('state') || 'all';
  for (const f of flags) {
    if (!f || !['string','number'].includes(typeof f.id) || !String(f.id).trim() || String(f.id).length>240 || ambiguousIds.has(String(f.id))) continue;
    const kind = f.change_schema_version === 1 && STATES.has(f.change_kind) ? f.change_kind : 'baseline';
    const key = f.evidence_fingerprint || String(f.id);
    const repeated = seen.has(key);
    if (!repeated) { seen.add(key); counts[kind]++; }
    if (repeated && String(f.id) !== requestedRecord) continue;
    const sources = (Array.isArray(f.evidence) ? f.evidence : Array.isArray(f.sources) ? f.sources : []).map(s => ({
      name: text(s?.name || s?.id, 150), url: safeURL(s?.url),
      published_at: evidenceDate(s?.source_published_at || s?.published_at || s?.pub_date),
      citation_status: text(s?.citation_status, 40) || (safeURL(s?.url) ? 'linked_unreviewed' : 'missing')
    })).slice(0, 16);
    const row = {id: String(f.id), title: text(f.title, 220), detail: text(f.detail || f.summary),
      entity: text(f.entity || f.manufacturer, 150), component_id: text(f.component_id, 120), platform_id: text(f.platform_id, 120),
      severity: text(f.severity, 24), change_kind: kind, change_reason: text(f.change_reason, 220) || 'Comparison baseline not yet available',
      changed_at: text(f.changed_at, 60), source_published_at: evidenceDate(f.source_published_at),
      source_date_basis: text(f.source_published_at_basis, 60), sources,
      implication: text(f.implication || f.impact, 700), review_status: text(f.claim_review_status, 30) || 'unreviewed',
      lens: 'Research context',
      record_url: `/patterns/#flag=${encodeURIComponent(f.id)}`,
      research_url: `/ask-pie/?q=${encodeURIComponent(text(f.entity || f.component_id || f.platform_id || f.title,220))}`,
      fingerprint: text(f.evidence_fingerprint, 70)};
    if (kindFilter !== 'all' && kindFilter !== kind) continue;
    if (params.get('record') && String(f.id) !== params.get('record')) continue;
    if (query && !`${row.title} ${row.entity} ${row.detail}`.toLowerCase().includes(query)) continue;
    const procurement=/funding|contract_signal|procurement_spike/.test(f.flag_type || '') || f.signal_kind === 'opportunity';
    const uasRelevant=UAS_TERMS.test(`${row.title} ${row.detail}`) || (!procurement && Boolean(row.component_id || row.platform_id));
    const sourceTime=Date.parse(row.source_published_at), sourceAge=now-sourceTime;
    const currentEvidence=Number.isFinite(sourceAge) && sourceAge>=-300000 && sourceAge<=90*86400000;
    const historical=Number.isFinite(sourceAge) && sourceAge>365*86400000;
    const linked=row.sources.some(s=>s.url);
    row.lens=historical ? 'Historical context' : procurement ? uasRelevant && currentEvidence && linked ? 'Opportunity lead · verify terms' : 'Procurement context' : uasRelevant ? 'UAS research lead' : 'Research context';
    row.rank = WEIGHTS[kind]*100 + (uasRelevant ? 50 : 0) + (linked ? 20 : 0) + (currentEvidence ? 15 : 0) - (historical ? 30 : 0) + ({critical: 10, warning: 6, high: 6, info: 1}[f.severity] || 0);
    row.rank_reason = `${kind} · ${uasRelevant ? 'UAS relevance' : 'broader context'} · ${linked ? 'citation attached' : 'citation missing'} · ${historical ? 'historical source' : currentEvidence ? 'source within 90 days' : 'source recency unconfirmed'}`;
    records.push(row);
  }
  records.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  const requested = Number(params.get('limit') || 10);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(50, Math.trunc(requested))) : 10;
  return {schema_version: 1, generated_at: generated, coverage, counts, ranking_version:'daily-navigation-v1', query:{q:query,state:kindFilter,record:requestedRecord || null}, record_status:requestedRecord ? ambiguousIds.has(requestedRecord) ? 'ambiguous' : records.length === 1 ? 'found' : 'missing' : null, baseline_established: flags.some(f => f?.change_schema_version === 1 && f.comparison_baseline_established === true), total: records.length, items: records.slice(0, limit)};
}
