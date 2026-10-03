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
  const CODE_STATE = 'Human code review required';
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
    const sources = row.resolution_criteria && row.resolution_criteria.resolution_sources;
    const pathRestricted = registered && Array.isArray(sources) && sources.length > 0 && sources.every(value => {
      const url = safeURL(value);
      return url && new URL(url).pathname !== '/';
    });
    return '<article class="forecast-queue-row" data-state="' + escape(row.state) + '">' +
      '<div class="rcall-top"><span class="forecast-state">' + escape(STATES[row.state]) + '</span>' +
      '<span class="rcall-meta">' + escape(registered ? 'Issued probability ' + percent(p) : 'Historical value ' + percent(p) + ' · ungraded') + '</span></div>' +
      '<h3>' + escape(row.event || 'Untitled forecast') + '</h3>' +
      '<p class="forecast-muted">' + escape(row.reason) + '</p>' +
      (pathRestricted ? '<p class="forecast-muted"><strong>Allowed sources are restricted to specific URL paths.</strong> Reporting elsewhere is a research lead and cannot resolve this forecast. Issued criteria remain binding.</p>' : '') +
      (row.deadline ? '<p class="rcall-meta">Deadline ' + escape(when(row.deadline)) + (row.state === 'due' && numeric(row.age_days) ? ' · due ' + Math.max(0, Math.floor(row.age_days)) + ' days' : '') + '</p>' : '') +
      (row.owner ? '<p class="rcall-meta">Reviewer: ' + escape(row.owner) + '</p>' : '') +
      criteriaHTML(row) +
      (candidates.length ? '<details class="forecast-criteria"><summary>Candidate evidence (' + candidates.length + ')</summary><ul>' + candidates.map(item => {
        const url = safeURL(item.url);
        const context = item.candidate_context || {};
        const sourceStatus = context.source_allowed === true ? 'Within issued source hierarchy · requires event and threshold review' :
          context.source_allowed === false ? 'Outside issued source hierarchy · research lead only' : 'Source eligibility not assessed';
        return '<li>' + (url ? '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + escape(item.title || url) + '</a>' : escape(item.title || 'Source unavailable')) +
          '<span class="forecast-muted"> · ' + escape(item.published_at || 'Publication date unknown') + '</span>' +
          '<p class="forecast-muted">' + escape(sourceStatus) + '</p></li>';
      }).join('') + '</ul><p class="forecast-muted">Retrieval candidates require analyst review; they are not verdicts.</p></details>' : '') + '</article>';
  }

  function codeReviewDocument(payload) {
    const doc = payload && payload.data ? payload.data : payload;
    if (!doc || doc.schema_version !== 'code-evolution-review-queue-v1' ||
        time(doc.generated_at) === null || doc.read_only !== true ||
        doc.human_decision_required !== true || !HASH.test(doc.queue_sha256 || '') ||
        !doc.counts || Object.keys(doc.counts).length !== 1 ||
        count(doc.counts.needs_review) === null || !Array.isArray(doc.records) ||
        doc.counts.needs_review !== doc.records.length) return null;
    const gateNames = ['baseline_green', 'agent_adapter_green', 'protected_evaluator_unchanged',
      'path_and_diff_budget_passed', 'candidate_evaluation_green', 'head_unchanged',
      'human_review_required'];
    const valid = doc.records.every(row => {
      const paths = row && row.paths, stats = row && row.stats, gates = row && row.gates;
      return row && row.state === 'needs_review' && typeof row.review_id === 'string' &&
        typeof row.request_id === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(row.repository_id || '') &&
        /^[a-f0-9]{40,64}$/.test(row.base_commit || '') && time(row.generated_at) !== null &&
        ['evaluation_sha256', 'candidate_sha256', 'tracked_patch_sha256', 'evaluator_snapshot_sha256',
          'objective_sha256', 'success_criteria_sha256'].every(name => HASH.test(row[name] || '')) &&
        Array.isArray(paths) && paths.length > 0 && paths.every(path =>
          typeof path === 'string' && path.length > 0 && !path.startsWith('/') &&
          !path.includes('\\') && path.split('/').every(part => part && part !== '.' && part !== '..')) &&
        stats && count(stats.changed_files) === paths.length && count(stats.additions) !== null &&
        count(stats.deletions) !== null && Array.isArray(row.evaluator_ids) && row.evaluator_ids.length > 0 &&
        row.evaluator_ids.every(value => typeof value === 'string' && value.length > 0) &&
        gates && Object.keys(gates).length === gateNames.length && gateNames.every(name => gates[name] === true) &&
        row.pull_request_eligible === true && row.promotion_eligible === false &&
        row.automatic_merge === false && row.automatic_deploy === false && row.serving_changes === false &&
        row.evidence_level === 'isolated-software-evaluation';
    });
    return valid ? doc : null;
  }

  function repositoryURL(repository, revision, path) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') ||
        !/^[a-f0-9]{40,64}$/.test(revision || '')) return null;
    const suffix = path ? '/blob/' + revision + '/' + path.split('/').map(encodeURIComponent).join('/') : '/tree/' + revision;
    return safeURL('https://github.com/' + repository + suffix);
  }

  function codeReviewCard(row) {
    const stats = row.stats, repo = repositoryURL(row.repository_id, row.base_commit);
    const pathItems = row.paths.map(path => {
      const url = repositoryURL(row.repository_id, row.base_commit, path);
      return '<li>' + (url ? '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer"><code>' + escape(path) + '</code></a>' : '<code>' + escape(path) + '</code>') + '</li>';
    }).join('');
    return '<article class="forecast-queue-row code-review-row" data-state="needs_review">' +
      '<div class="rcall-top"><span class="forecast-state">' + CODE_STATE + '</span>' +
      '<span class="rcall-meta">' + escape(row.evidence_level) + '</span></div>' +
      '<h3>' + (repo ? '<a class="forecast-docs" href="' + escape(repo) + '" target="_blank" rel="noopener noreferrer">' + escape(row.repository_id) + '</a>' : escape(row.repository_id)) + ' · ' + escape(row.request_id) + '</h3>' +
      '<p class="forecast-muted">' + escape(row.review_action) + '</p>' +
      '<p class="rcall-meta">Evaluated ' + escape(when(row.generated_at)) + ' · ' + stats.changed_files + ' file · +' + stats.additions + ' / −' + stats.deletions + '</p>' +
      '<details class="forecast-criteria"><summary>Exact software evidence</summary><dl>' +
      '<dt>Base commit</dt><dd><code>' + escape(row.base_commit) + '</code></dd>' +
      '<dt>Candidate</dt><dd><code>' + escape(row.candidate_sha256) + '</code></dd>' +
      '<dt>Evaluation</dt><dd><code>' + escape(row.evaluation_sha256) + '</code></dd>' +
      '<dt>Evaluators</dt><dd>' + escape(row.evaluator_ids.join(', ')) + '</dd>' +
      '<dt>Authority</dt><dd>PR-eligible only · no automatic merge, deploy, promotion, or serving change</dd>' +
      '</dl><p class="forecast-muted">Changed paths:</p><ul>' + pathItems + '</ul>' +
      '<p class="forecast-muted"><strong>Evidence limit:</strong> ' + escape(row.limitation) + '</p></details></article>';
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
  return {METHOD, STATES, escape, probability, percent, when, safeURL, eligible, criteriaHTML, queueDocument, queueRows, queueCard, codeReviewDocument, codeReviewCard, cohortHTML, evaluationHTML};
});
