/* Evidence labels describe published records; legacy scores never certify claims. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PatternsFlagEvidence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function time(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return NaN;
    const parsed = Date.parse(value);
    const day = Date.parse(value.slice(0, 10));
    return Number.isFinite(parsed) && Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value.slice(0, 10) ? parsed : NaN;
  }
  function safeURL(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
    catch { return ''; }
  }
  function references(flag) {
    const supplied = Array.isArray(flag.evidence) ? flag.evidence : flag.sources;
    const rows = Array.isArray(supplied) ? supplied : supplied && typeof supplied === 'object' ? [supplied] : [];
    return new Set(rows.map(row => safeURL(typeof row === 'string' ? row : row?.url)).filter(Boolean)).size;
  }
  function reviewRecorded(flag, now = Date.now()) {
    const review = flag.lifecycle_review;
    if (flag.change_schema_version !== 1 || flag.evidence_fingerprint_version !== 2 || flag.claim_review_status !== 'reviewed'
        || !hash(flag.claim_sha256) || !review || review.status !== 'reviewed' || review.flag_id !== flag.id
        || review.claim_sha256 !== flag.claim_sha256 || !hash(review.evidence_sha256) || !text(review.reviewer)
        || !['resolved', 'contradicted'].includes(review.outcome) || flag.lifecycle_state !== review.outcome) return false;
    const reviewed = time(review.reviewed_at), firstSeen = time(flag.first_seen);
    return Number.isFinite(reviewed) && reviewed <= now && (!Number.isFinite(firstSeen) || reviewed >= firstSeen)
      && Array.isArray(review.evidence) && review.evidence.length > 0 && review.evidence.every(item => item
        && safeURL(item.url) && text(item.excerpt) && Number.isFinite(time(item.published_at)) && time(item.published_at) <= reviewed
        && (item.event_date == null || Number.isFinite(time(item.event_date)) && time(item.event_date) <= reviewed));
  }
  function describe(flag = {}, now = Date.now()) {
    if (reviewRecorded(flag, now)) return {key:'review_recorded', label:'Lifecycle review recorded',
      detail:'The pipeline records a review of this exact claim and evidence. This is a lifecycle decision; it does not certify every linked source.', color:'var(--cyan)'};
    if (references(flag)) return {key:'references_unreviewed', label:'Source references; unreviewed',
      detail:'Links are available for inspection. Claim support and independent corroboration have not been established by a recorded review.', color:'var(--text-d)'};
    return {key:'evidence_unavailable', label:'Evidence unavailable',
      detail:'No usable evidence link or valid lifecycle review is supplied. Treat this record as a lead for investigation.', color:'var(--text-d)'};
  }
  function legacyScore(flag = {}) {
    return typeof flag.confidence === 'number' && Number.isFinite(flag.confidence) && flag.confidence >= 0 && flag.confidence <= 1
      ? `Legacy heuristic: ${flag.confidence}/1` : '';
  }
  function badge(flag) {
    const state = describe(flag);
    return `<span class="badge" data-evidence-status="${state.key}" style="background:var(--surface);color:${state.color};font-size:10px">${state.label}</span>`;
  }
  function panel(flag) {
    const state = describe(flag), score = legacyScore(flag);
    return `<section data-evidence-status="${state.key}" style="background:var(--surface);border-radius:6px;padding:9px 10px;margin-bottom:10px">
      <div style="font:600 11px var(--mono);color:${state.color};margin-bottom:4px">${state.label}</div>
      <div style="font-size:11px;color:var(--text-d);line-height:1.5">${state.detail}</div>
      ${state.key === 'review_recorded' ? `<div style="font-size:10px;color:var(--text-d);margin-top:5px">Recorded outcome: ${esc(flag.lifecycle_review.outcome)} · ${esc(flag.lifecycle_review.reviewer)} · ${esc(flag.lifecycle_review.reviewed_at)}</div>` : ''}
      ${score ? `<details style="font-size:10px;color:var(--text-d);margin-top:6px"><summary>Legacy scoring metadata</summary>${score}. Uncalibrated ranking metadata; it does not establish verification, evidence quality, or event probability.</details>` : ''}
    </section>`;
  }
  function counts(flags) {
    const result = {review_recorded:0, references_unreviewed:0, evidence_unavailable:0};
    for (const flag of flags) result[describe(flag).key]++;
    return result;
  }
  function summary(flags) {
    const n = counts(flags);
    return `${n.review_recorded} lifecycle reviews recorded · ${n.references_unreviewed} with unreviewed references · ${n.evidence_unavailable} without usable evidence`;
  }
  function distribution(flags) {
    const labels = {review_recorded:'Lifecycle review recorded', references_unreviewed:'References; unreviewed', evidence_unavailable:'Evidence unavailable'};
    return Object.entries(counts(flags)).map(([key, count]) => `<div data-evidence-status="${key}" style="display:flex;gap:12px;justify-content:space-between;padding:6px 0;font-size:11px;color:var(--text-d)"><span>${labels[key]}</span><strong>${count} flags</strong></div>`).join('');
  }
  return {describe, reviewRecorded, legacyScore, badge, panel, counts, summary, distribution};
});
