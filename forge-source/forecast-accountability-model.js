(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ForecastAccountability = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const METHOD = 'reviewed-evidence-v2';
  const HASH = /^[a-f0-9]{64}$/;
  const STATES = {
    due: 'Due for review', candidate_evidence: 'Evidence candidates', pending: 'Window open',
    reviewed: 'Reviewed', legacy_unregistered: 'Legacy · unregistered', issuance_invalid: 'Issuance unavailable'
  };
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const numeric = value => typeof value === 'number' && Number.isFinite(value);
  const probability = value => numeric(value) && value >= 0 && value <= 1 ? value : null;
  const number = (value, digits = 3) => numeric(value) ? value.toFixed(digits) : 'Unavailable';
  const percent = value => probability(value) !== null ? Math.round(value * 100) + '%' : 'Unavailable';
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const time = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  const when = value => time(value) === null ? 'Not registered' : new Date(time(value)).toISOString().replace('T', ' ').replace('.000Z', ' UTC');

  function safeURL(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }

  function eligible(row) {
    if (!row || row.resolution_method !== METHOD || row.calibration_eligible !== true ||
        ['needs_review', 'revoked'].includes(row.review_status) || row.record_type !== 'forecast' ||
        row.cohort !== 'prospective-v1' || !row.prediction_id || row.issuance_id !== row.prediction_id ||
        !HASH.test(row.issuance_sha256 || '') || probability(row.predicted_probability) === null ||
        !['confirmed', 'refuted'].includes(row.resolution_outcome) ||
        row.was_correct !== (row.resolution_outcome === 'confirmed')) return false;
    const criteria = row.resolution_criteria || {}, review = row.evidence_review || {};
    const issued = time(row.issued_at), start = time(criteria.window_start), end = time(criteria.window_end);
    if (issued === null || start === null || end === null || issued > start || start >= end ||
        criteria.event !== row.event || !Array.isArray(criteria.entities) || !criteria.entities.length ||
        !['occurs', 'does_not_occur'].includes(criteria.direction) || !criteria.threshold || !criteria.ambiguity_policy ||
        !Array.isArray(criteria.resolution_sources) || !criteria.resolution_sources.length ||
        !criteria.resolution_sources.every(safeURL)) return false;
    const reviewed = time(review.reviewed_at);
    const absence = (criteria.direction === 'does_not_occur') === (review.verdict === 'confirmed');
    if (reviewed === null || reviewed < issued || reviewed > Date.now() || (absence && reviewed < end)) return false;
    return review.prediction_id === row.prediction_id && review.issuance_sha256 === row.issuance_sha256 &&
      ['criteria_sha256', 'prediction_sha256', 'evidence_sha256'].every(key => HASH.test(review[key] || '')) &&
      review.verdict === row.resolution_outcome && typeof review.reviewed_by === 'string' && !!review.reviewed_by.trim() &&
      Array.isArray(review.evidence) && review.evidence.length > 0 && review.evidence.every(item => {
        const published = time(item.published_at), occurred = time(item.event_date);
        return safeURL(item.url) && typeof item.excerpt === 'string' && !!item.excerpt.trim() &&
          published !== null && occurred !== null && issued <= published && published <= reviewed &&
          start <= occurred && occurred <= Math.min(end, reviewed);
      });
    // This is a display gate on the published resolver result. The server-side
    // resolver verifies the independent issuance ledger and evidence checksums.
  }

  function criteriaHTML(row) {
    const criteria = row.resolution_criteria;
    if (!criteria || typeof criteria !== 'object' || !row.issuance_id) {
      return '<p class="forecast-muted">No prospective registration. Historical values are retained and cannot be retroactively graded.</p>';
    }
    const sources = Array.isArray(criteria.resolution_sources) ? criteria.resolution_sources : [];
    const sourcesHTML = sources.map((value, index) => {
      const url = safeURL(value);
      return '<li>' + (url ? '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + escape(value) + '</a>' : escape(value) + ' (unavailable URL)') + '</li>';
    }).join('');
    return '<details class="forecast-criteria"><summary>Issued question and resolution criteria</summary><dl>' +
      '<dt>Version</dt><dd><code>' + escape(row.issuance_id) + '</code></dd>' +
      '<dt>Issued</dt><dd>' + escape(when(row.issued_at)) + '</dd>' +
      '<dt>Evidence cutoff</dt><dd>' + escape(when(row.evidence_cutoff)) + '</dd>' +
      '<dt>Window</dt><dd>' + escape(when(criteria.window_start)) + ' → ' + escape(when(criteria.window_end)) + '</dd>' +
      '<dt>Entities</dt><dd>' + escape((Array.isArray(criteria.entities) ? criteria.entities : []).join(', ')) + '</dd>' +
      '<dt>Direction</dt><dd>' + escape(criteria.direction) + '</dd>' +
      '<dt>Threshold</dt><dd>' + escape(criteria.threshold || 'Not registered') + '</dd>' +
      '<dt>Ambiguity</dt><dd>' + escape(criteria.ambiguity_policy || 'Not registered') + '</dd>' +
      (row.supersedes ? '<dt>Prior version</dt><dd><code>' + escape(row.supersedes) + '</code></dd>' : '') +
      '<dt>Issuance hash</dt><dd><code>' + escape(row.issuance_sha256 || '') + '</code></dd></dl>' +
      '<p class="forecast-muted">Resolution source hierarchy, in order:</p><ol>' + sourcesHTML + '</ol></details>';
  }

  function queueDocument(payload) {
    const doc = payload && payload.data ? payload.data : payload;
    if (!doc || doc.schema_version !== 'forecast-review-queue-v1' || !Array.isArray(doc.records) || time(doc.generated_at) === null) return null;
    if (doc.records.some(row => !row || !STATES[row.state] || typeof row.prediction_id !== 'string')) return null;
    return doc;
  }

  function queueRows(doc, filter = 'prospective', query = '') {
    const text = String(query).trim().toLowerCase();
    return (doc && doc.records || []).filter(row =>
      (filter === 'all' || (filter === 'prospective' ? row.state !== 'legacy_unregistered' : row.state === filter)) &&
      (!text || [row.event, row.prediction_id, ...(row.resolution_criteria && Array.isArray(row.resolution_criteria.entities) ? row.resolution_criteria.entities : [])].join(' ').toLowerCase().includes(text)));
  }

  function queueCard(row) {
    const p = probability(row.probability);
    const registered = !!row.issuance_id && row.state !== 'issuance_invalid';
    const candidates = Array.isArray(row.review_candidates) ? row.review_candidates : [];
    return '<article class="forecast-queue-row" data-state="' + escape(row.state) + '">' +
      '<div class="rcall-top"><span class="forecast-state">' + escape(STATES[row.state]) + '</span>' +
      '<span class="rcall-meta">' + escape(registered ? 'Issued probability ' + percent(p) : 'Historical value ' + percent(p) + ' · ungraded') + '</span></div>' +
      '<h3>' + escape(row.event || 'Untitled forecast') + '</h3>' +
      '<p class="forecast-muted">' + escape(row.reason) + '</p>' +
      (row.deadline ? '<p class="rcall-meta">Deadline ' + escape(when(row.deadline)) + (row.state === 'due' && numeric(row.age_days) ? ' · due ' + Math.max(0, Math.floor(row.age_days)) + ' days' : '') + '</p>' : '') +
      (row.owner ? '<p class="rcall-meta">Reviewer: ' + escape(row.owner) + '</p>' : '') +
      criteriaHTML(row) +
      (candidates.length ? '<details class="forecast-criteria"><summary>Candidate evidence (' + candidates.length + ')</summary><ul>' + candidates.map(item => {
        const url = safeURL(item.url);
        return '<li>' + (url ? '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + escape(item.title || url) + '</a>' : escape(item.title || 'Source unavailable')) +
          '<span class="forecast-muted"> · ' + escape(item.published_at || 'Publication date unknown') + '</span></li>';
      }).join('') + '</ul><p class="forecast-muted">Retrieval candidates require analyst review; they are not verdicts.</p></details>' : '') + '</article>';
  }

  function cohortHTML(evaluation) {
    const groups = evaluation && evaluation.cohorts;
    if (!groups || typeof groups !== 'object') return '<p class="forecast-muted">Prospective cohort reporting is not available in the current publication. Historical outcome records remain below.</p>';
    const names = {'prospective-v1': 'Prospective · registered', 'legacy-unregistered': 'Legacy · unregistered', invalid_issuance: 'Issuance unavailable', not_a_forecast: 'Observations / analysis'};
    const keys = Object.keys(groups);
    if (!keys.length) return '<p class="forecast-muted">No forecast cohorts have been published yet.</p>';
    return '<div class="forecast-table"><table><thead><tr><th class="l">Cohort</th><th>Versions</th><th>Reviewed</th><th>Unreviewed</th><th>Coverage</th></tr></thead><tbody>' +
      keys.map(key => { const g = groups[key] || {}; return '<tr><th scope="row" class="l">' + escape(names[key] || key) + '</th>' +
        [count(g.total), count(g.reviewed), count(g.unreviewed)].map(v => '<td>' + (v === null ? 'Unavailable' : v) + '</td>').join('') +
        '<td>' + percent(g.resolution_coverage) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="forecast-muted">Legacy records stay in the historical denominator. Prospective coverage does not replace the original data-quality score.</p>';
  }

  function metricsRow(label, metrics) {
    metrics = metrics || {};
    return '<tr><th scope="row" class="l">' + escape(label) + '</th><td>' + (count(metrics.n) === null ? 'Unavailable' : metrics.n) + '</td><td>' + number(metrics.brier_score) + '</td><td>' + number(metrics.log_score) + '</td></tr>';
  }

  function evaluationHTML(report) {
    if (!report || report.schema_version !== 'forecast-evaluation-v1') return '<p class="forecast-muted">No prospective evaluation has been published. Forecast skill is not rated.</p>';
    const holdout = report.temporal_holdout || {}, baseline = report.no_change_baseline || {}, metrics = report.metrics || {};
    const header = '<div class="forecast-table"><table><thead><tr><th class="l">Same-question comparison</th><th>Questions</th><th>Brier ↓</th><th>Log loss ↓</th></tr></thead><tbody>';
    return '<p class="forecast-muted">' + escape(report.sample_unit) + '. ' +
      escape(count(report.reviewed_questions) === null ? 'Unknown' : report.reviewed_questions) + ' reviewed / ' +
      escape(count(report.registered_questions) === null ? 'unknown' : report.registered_questions) + ' registered questions.</p>' +
      header + metricsRow('Issued probabilities', metrics) + metricsRow('Neutral 0.5 baseline', report.neutral_baseline) +
      (count(baseline.coverage) > 0 ? metricsRow('Forecasts with pre-registered no-change baseline', baseline.forecast_on_same_questions) + metricsRow('Pre-registered no-change baseline', baseline.baseline) : '') + '</tbody></table></div>' +
      '<p class="forecast-muted">Outcome mix: ' + (count(metrics.confirmed) === null ? 'unknown' : metrics.confirmed) + ' confirmed, ' + (count(metrics.refuted) === null ? 'unknown' : metrics.refuted) +
      ' refuted. Brier standard error: ' + number(metrics.brier_standard_error) + '. No-change baseline coverage: ' + (count(baseline.coverage) === null ? 'unknown' : baseline.coverage) + ' questions.</p>' +
      '<h3 class="panel-h">Chronological holdout</h3><p class="forecast-muted">Training answers available before ' + escape(when(holdout.cutoff)) + ': ' +
      (count(holdout.training_n) === null ? 'unknown' : holdout.training_n) + '. Training base rate: ' + percent(holdout.training_base_rate) + '.</p>' +
      header + metricsRow('Holdout forecasts', holdout.forecast) + metricsRow('Neutral baseline', holdout.neutral) + metricsRow('Prior training base-rate baseline', holdout.base_rate) + '</tbody></table></div>' +
      '<p class="forecast-muted">' + escape(holdout.note || 'Descriptive comparison only; no weight promotion.') + '</p>' +
      '<p class="forecast-muted">' + escape(report.weight_policy) + '. ' + escape(report.uncertainty_note) + '.</p>';
  }
  return {METHOD, STATES, escape, probability, percent, when, safeURL, eligible, criteriaHTML, queueDocument, queueRows, queueCard, cohortHTML, evaluationHTML};
});
