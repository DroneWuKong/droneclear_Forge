/*
 * Autonomous evidence API for UAS Patterns.
 * Models propose evidence packets. Trusted code retrieves and hashes sources,
 * then deterministic policy marks a claim eligible, abstained, or exceptional.
 * Nothing in this module publishes a model conclusion to PIE_OUTPUTS.
 */
import {
  canonicalJson, loadActiveRetrievalPolicy, sha256, verifyPolicyManifest,
} from './retrieval-policy.mjs';
import {
  createActivationDecision, createRollbackDecision, improvementDecisionDigest,
  validateApprovedDecisionChain,
} from './portfolio-improvement.mjs';
import {
  recordEvaluation, recordIncident, recordServingReceipt, registerCandidate,
  registerExperiment,
} from './experiment-runtime.mjs';
import { handleForgeMatchingFeedback } from './forge-matching-feedback.mjs';
import { handleSourceLearningFeedback } from './source-learning-feedback.mjs';

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
const encoder = new TextEncoder();
const TERMINAL_FAILURES = new Map([
  ['response.failed', 'failed'],
  ['response.incomplete', 'incomplete'],
  ['response.cancelled', 'cancelled'],
]);
const CLAIM_POLICIES = {
  observation: { minimumSources: 2, eligible: true },
  analysis: { minimumSources: 2, eligible: false, review: true },
  hypothesis: { minimumSources: 2, eligible: false, review: true },
  forecast: { minimumSources: 1, eligible: false, forecast: true },
  regulatory: { minimumSources: 1, eligible: false, review: true, authority: true },
  procurement: { minimumSources: 1, eligible: false, review: true, authority: true },
  hardware: { minimumSources: 2, eligible: false, review: true, physical: true },
  field: { minimumSources: 2, eligible: false, review: true, physical: true },
  safety: { minimumSources: 2, eligible: false, review: true, physical: true },
};
const CONCLUSIONS = new Set(['supports', 'partially-supports', 'contradicts', 'insufficient']);
const SOURCE_CLASSES = new Set([
  'controlling-authority', 'government-guidance', 'standard', 'manufacturer',
  'peer-reviewed', 'independent-technical', 'field-observation', 'other',
]);
const OFFICIAL_DOMAINS = [
  'acquisition.gov', 'congress.gov', 'defense.gov', 'ecfr.gov', 'faa.gov',
  'fcc.gov', 'federalregister.gov', 'gao.gov', 'govinfo.gov', 'sam.gov',
  'usaspending.gov', 'nist.gov', 'cisa.gov', 'ntia.gov', 'itu.int',
];
const RETRIEVAL_FEEDBACK_LABELS = new Set([
  'helpful', 'wrong_match', 'missing_source', 'outdated_evidence', 'misleading_citation',
]);
const RETRIEVAL_REVIEW_ACTIONS = new Set([
  'accept-as-judgment', 'reject-as-noise', 'needs-context',
]);
const SHADOW_THRESHOLDS = Object.freeze({
  minimum_receipts: 100,
  minimum_unique_queries: 25,
  minimum_duration_seconds: 7 * 24 * 60 * 60,
  maximum_error_basis_points: 100,
  maximum_p95_latency_ms: 50,
});
const SERVING_MONITOR_THRESHOLDS = Object.freeze({
  window_seconds: 24 * 60 * 60,
  minimum_receipts: 100,
  maximum_fallback_basis_points: 100,
  maximum_p95_latency_ms: 75,
});
const HARD_POLICY_FALLBACKS = new Set([
  'manifest-contract-invalid', 'parameters-digest-invalid',
  'approval-digest-invalid', 'manifest-digest-invalid',
  'manifest-signature-invalid', 'manifest-verification-failed',
  'active-policy-json-invalid', 'active-policy-incompatible',
]);
const INGRESS_RATE_LIMITS = Object.freeze({feedback:60, shadow:300});
const RETENTION_DAYS = Object.freeze({
  retrieval_feedback:180,
  retrieval_shadow:90,
  retrieval_serving_receipts:30,
  policy_monitor_evaluations:365,
});
const SHADOW_FEATURES = [
  'coverage', 'weighted_coverage', 'direct', 'subject_in_title', 'citation_count',
];
const respond = (status, data, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status, headers:{...JSON_HEADERS, ...extraHeaders},
});
const improvementFailure = error => {
  const message = error instanceof Error ? error.message : 'Invalid improvement record';
  const status = /conflict|already registered|different content/i.test(message) ? 409 : 400;
  return respond(status, {error:message, changes_serving:false, authorizes_action:false});
};
const improvementReceipt = (recordType, receipt) => ({
  schema_version:'patterns.improvement-registration-receipt.v1',
  record_type:recordType,
  ...receipt,
  changes_serving:false,
  changes_authority:false,
  changes_hardware:false,
  authorizes_action:false,
});
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const sha = async value => hex(new Uint8Array(await crypto.subtle.digest(
  'SHA-256', typeof value === 'string' ? encoder.encode(value) : value,
)));
const safeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
};

async function reviewer(request, secret) {
  const value = request.headers.get('authorization') || '';
  if (!secret || !value.startsWith('Bearer ')) return false;
  return safeEqual(await sha(value.slice(7)), await sha(secret));
}

async function parseBody(request, limit = 262144) {
  const text = await request.text();
  if (encoder.encode(text).length > limit) throw new Error('Body too large');
  return JSON.parse(text);
}

async function opaqueRateKey(secret, route, address, bucket) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, encoder.encode(`${route}\x1f${address}\x1f${bucket}`),
  ))).slice(0, 32);
}

async function consumeIngressRateLimit(request, env, route, now = Date.now()) {
  const secret = String(env.PATTERNS_RATE_LIMIT_SECRET || '');
  const address = String(request.headers.get('cf-connecting-ip') || '').trim();
  if (encoder.encode(secret).length < 32 || !address) return {configured:false};
  const windowMs = 60 * 60 * 1000;
  const bucket = Math.floor(now / windowMs);
  const id = await opaqueRateKey(secret, route, address, bucket);
  const updated = new Date(now).toISOString();
  const expiresAt = new Date((bucket + 1) * windowMs).toISOString();
  await env.AUTONOMY_DB.prepare(
    'INSERT INTO autonomy_ingress_rate_buckets(id,route,count,expires_at,created,updated) '
    + 'VALUES(?1,?2,1,?3,?4,?4) ON CONFLICT(id) DO UPDATE SET '
    + 'count=autonomy_ingress_rate_buckets.count+1,updated=excluded.updated',
  ).bind(id, route, expiresAt, updated).run();
  const row = await env.AUTONOMY_DB.prepare(
    'SELECT count,expires_at FROM autonomy_ingress_rate_buckets WHERE id=?1',
  ).bind(id).first();
  const limit = INGRESS_RATE_LIMITS[route];
  return {
    configured:true, allowed:row.count <= limit, limit, count:row.count,
    remaining:Math.max(0, limit - row.count),
    retryAfter:Math.max(1, Math.ceil((Date.parse(row.expires_at) - now) / 1000)),
  };
}

function rateLimitResponse(rate) {
  if (!rate.configured) return respond(503, {
    error:'Privacy-preserving ingress rate limiting is not configured',
  });
  if (!rate.allowed) return respond(429, {
    error:'Too many autonomy observations; retry after the current window',
  }, {'retry-after':String(rate.retryAfter), 'x-ratelimit-limit':String(rate.limit),
    'x-ratelimit-remaining':'0'});
  return null;
}

function decodeSecret(secret) {
  const value = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Uint8Array.from(atob(normalized), character => character.charCodeAt(0));
  } catch {
    return encoder.encode(secret);
  }
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', decodeSecret(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  let raw = '';
  for (const byte of signed) raw += String.fromCharCode(byte);
  return btoa(raw);
}

export async function verifyWebhook(raw, headers, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = headers.get('webhook-id') || '';
  const timestamp = headers.get('webhook-timestamp') || '';
  const signatures = headers.get('webhook-signature') || '';
  if (!secret || !id || !/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const expected = await hmac(secret, `${id}.${timestamp}.${raw}`);
  return signatures.split(' ').some(item => {
    const [version, value] = item.split(',', 2);
    return version === 'v1' && Boolean(value) && safeEqual(value, expected);
  });
}

async function recordEvent(env, entityType, entityId, eventType, data) {
  const serialized = JSON.stringify(data);
  const id = (await sha(`${entityType}\x1f${entityId}\x1f${eventType}\x1f${serialized}`)).slice(0, 24);
  const now = new Date().toISOString();
  await env.AUTONOMY_DB.prepare(
    'INSERT OR IGNORE INTO evidence_events(id,entity_type,entity_id,event_type,data,created) VALUES(?1,?2,?3,?4,?5,?6)',
  ).bind(id, entityType, entityId, eventType, serialized, now).run();
  return id;
}

function feedbackOriginAllowed(request) {
  const origin = request.headers.get('origin') || '';
  if (origin === 'https://uas-patterns.com' || origin === 'https://www.uas-patterns.com') return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function finiteNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function cleanShadowRegistryBundle(input) {
  const candidate = input?.candidate;
  const replay = input?.replay;
  const holdout = input?.chronological_evaluation;
  const adjustments = candidate?.parameters?.feature_adjustments;
  const candidateVersion = String(candidate?.candidate_version || '');
  const bundleSha256 = String(input?.bundle_sha256 || '');
  const adjustmentKeys = adjustments && typeof adjustments === 'object'
    ? Object.keys(adjustments).sort() : [];
  if (
    input?.schema_version !== 'retrieval-shadow-registry-bundle-v1'
    || input?.state !== 'registered-shadow-only'
    || input?.serving_pointer !== null
    || input?.promotion_eligible !== false
    || !/^candidate-[0-9a-f]{16}$/.test(candidateVersion)
    || input?.candidate_version !== candidateVersion
    || !/^[0-9a-f]{64}$/.test(bundleSha256)
    || candidate?.schema_version !== 'retrieval-policy-candidate-v1'
    || candidate?.policy_id !== 'ask-pie-ranking'
    || candidate?.candidate_built !== true
    || candidate?.writes_to_serving !== false
    || candidate?.promotion_eligible !== false
    || candidate?.compatible_feature_schema !== 'ask-pie-feedback-features-v1'
    || !/^[0-9a-f]{64}$/.test(String(candidate?.frozen_corpus_sha256 || ''))
    || candidate?.parameters?.base_score_weight !== 1
    || adjustmentKeys.join('|') !== [...SHADOW_FEATURES].sort().join('|')
    || !SHADOW_FEATURES.every(name => {
      const value = adjustments[name];
      return Number.isFinite(value) && value >= -12 && value <= 12 && value % 4 === 0;
    })
    || replay?.schema_version !== 'retrieval-frozen-replay-v1'
    || replay?.candidate_version !== candidateVersion
    || !/^[0-9a-f]{64}$/.test(String(replay?.replay_evidence_sha256 || ''))
    || replay?.shadow_eligible !== true
    || replay?.promotion_eligible !== false
    || holdout?.schema_version !== 'retrieval-chronological-evaluation-v1'
    || holdout?.candidate_version !== candidateVersion
    || !/^[0-9a-f]{64}$/.test(String(holdout?.holdout_evidence_sha256 || ''))
    || holdout?.chronological_holdout_passed !== true
    || holdout?.promotion_eligible !== false
  ) throw new Error('Invalid shadow registry bundle');
  const incumbentVersion = String(candidate.incumbent_version || '');
  if (!incumbentVersion || incumbentVersion.length > 128) {
    throw new Error('Invalid shadow incumbent version');
  }
  return {
    schema_version: 'retrieval-shadow-runtime-v1',
    policy_id: 'ask-pie-ranking',
    candidate_version: candidateVersion,
    incumbent_version: incumbentVersion,
    bundle_sha256: bundleSha256,
    parameters: {
      base_score_weight: 1,
      feature_adjustments: Object.fromEntries(
        SHADOW_FEATURES.map(name => [name, Number(adjustments[name])]),
      ),
      feature_transforms: {
        citation_count: 'min(value,4)/4',
        booleans: '0-or-1',
      },
    },
    evidence: {
      frozen_corpus_sha256: String(candidate.frozen_corpus_sha256 || ''),
      replay_evidence_sha256: String(replay.replay_evidence_sha256 || ''),
      holdout_evidence_sha256: String(holdout.holdout_evidence_sha256 || ''),
    },
    state: 'registered-shadow-only',
    serving_changes: false,
    promotion_eligible: false,
  };
}

function cleanShadowObservation(input, runtime) {
  const observationId = String(input?.observation_id || '').toLowerCase();
  const query = String(input?.query || '').trim();
  const inputRevision = String(input?.input_revision || '').trim();
  if (
    input?.schema_version !== 1
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(observationId)
    || !query || query.length > 300
    || input?.policy_id !== 'ask-pie-ranking'
    || input?.policy_version !== runtime.incumbent_version
    || !inputRevision || inputRevision.length > 128
    || !Array.isArray(input?.results) || input.results.length < 1 || input.results.length > 100
  ) throw new Error('Invalid shadow observation');
  const keys = new Set();
  const positions = new Set();
  const results = input.results.map(item => {
    const recordKey = String(item?.record_key || '').trim();
    const position = finiteNumber(item?.position, 1, 100);
    const features = item?.features;
    const score = finiteNumber(features?.score, -100000, 100000);
    const coverage = finiteNumber(features?.coverage, 0, 1);
    const weightedCoverage = finiteNumber(features?.weighted_coverage, 0, 1);
    const citationCount = finiteNumber(features?.citation_count, 0, 100);
    if (
      !recordKey || recordKey.length > 256 || keys.has(recordKey)
      || !Number.isInteger(position) || positions.has(position)
      || score == null || coverage == null || weightedCoverage == null
      || !Number.isInteger(citationCount)
      || typeof features?.direct !== 'boolean'
      || typeof features?.subject_in_title !== 'boolean'
    ) throw new Error('Invalid shadow result feature snapshot');
    keys.add(recordKey);
    positions.add(position);
    return {
      record_key: recordKey,
      position,
      features: {
        score, coverage, weighted_coverage: weightedCoverage,
        direct: features.direct, subject_in_title: features.subject_in_title,
        citation_count: citationCount,
      },
    };
  });
  return { observationId, query, inputRevision, results };
}

function shadowScore(item, runtime) {
  const features = item.features;
  const weights = runtime.parameters.feature_adjustments;
  return features.score
    + weights.coverage * features.coverage
    + weights.weighted_coverage * features.weighted_coverage
    + weights.direct * Number(features.direct)
    + weights.subject_in_title * Number(features.subject_in_title)
    + weights.citation_count * (Math.min(features.citation_count, 4) / 4);
}

async function evaluateShadowObservation(env, input, runtime) {
  const observation = cleanShadowObservation(input, runtime);
  const started = Date.now();
  const incumbentOrder = [...observation.results]
    .sort((left, right) => left.position - right.position || left.record_key.localeCompare(right.record_key));
  const candidateOrder = [...observation.results].sort((left, right) =>
    shadowScore(right, runtime) - shadowScore(left, runtime)
    || left.position - right.position
    || left.record_key.localeCompare(right.record_key));
  const incumbentKeys = incumbentOrder.map(item => item.record_key);
  const candidateKeys = candidateOrder.map(item => item.record_key);
  const changedPositions = incumbentKeys.reduce(
    (count, key, index) => count + Number(candidateKeys[index] !== key), 0,
  );
  const queryId = (await sha(observation.query.toLowerCase().replace(/\s+/g, ' '))).slice(0, 24);
  const receiptId = (await sha(`shadow-receipt\x1f${observation.observationId}`)).slice(0, 24);
  const observationSha256 = await sha(JSON.stringify({
    candidate_version: runtime.candidate_version,
    query_id: queryId,
    input_revision: observation.inputRevision,
    results: observation.results,
  }));
  const receipt = {
    schema_version: 'retrieval-shadow-receipt-v1',
    observation_id: observation.observationId,
    policy_id: runtime.policy_id,
    incumbent_version: runtime.incumbent_version,
    candidate_version: runtime.candidate_version,
    bundle_sha256: runtime.bundle_sha256,
    query_id: queryId,
    observation_sha256: observationSha256,
    input_revision: observation.inputRevision,
    result_count: incumbentKeys.length,
    incumbent_order_sha256: await sha(JSON.stringify(incumbentKeys)),
    candidate_order_sha256: await sha(JSON.stringify(candidateKeys)),
    changed_positions: changedPositions,
    top_result_changed: incumbentKeys[0] !== candidateKeys[0],
    evaluation_latency_ms: Date.now() - started,
    visible_effect: false,
    serving_changes: false,
    promotion_eligible: false,
    data_policy: { raw_query_stored: false, retention_days: 90 },
  };
  const serialized = JSON.stringify(receipt);
  const existing = await env.AUTONOMY_DB.prepare(
    'SELECT data FROM retrieval_shadow_receipts WHERE id=?1',
  ).bind(receiptId).first();
  if (existing) {
    const previous = JSON.parse(existing.data);
    if (previous.observation_sha256 !== observationSha256) return { conflict: true, receiptId };
    return { conflict: false, receiptId, receipt: previous, replayed: true };
  }
  if (!existing) {
    await env.AUTONOMY_DB.prepare(
      'INSERT INTO retrieval_shadow_receipts(id,candidate_version,query_id,input_revision,data,created) VALUES(?1,?2,?3,?4,?5,?6)',
    ).bind(receiptId, runtime.candidate_version, queryId, observation.inputRevision,
      serialized, new Date().toISOString()).run();
  }
  return { conflict: false, receiptId, receipt };
}

async function recordShadowAttempt(env, runtime, observationId, state, latencyMs, errorCode) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    String(observationId || '').toLowerCase())) return;
  const id = (await sha(`shadow-attempt\x1f${String(observationId).toLowerCase()}`)).slice(0, 24);
  await env.AUTONOMY_DB.prepare(
    'INSERT OR IGNORE INTO retrieval_shadow_attempts(id,candidate_version,state,latency_ms,error_code,created) VALUES(?1,?2,?3,?4,?5,?6)',
  ).bind(id, runtime.candidate_version, state, Math.max(0, Math.round(latencyMs)),
    errorCode || null, new Date().toISOString()).run();
}

function percentile95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)];
}

async function evaluateShadowWindow(env, candidateVersion, evaluatedAt = new Date().toISOString()) {
  const candidate = await env.AUTONOMY_DB.prepare(
    'SELECT bundle_sha256 FROM retrieval_candidates WHERE candidate_version=?1',
  ).bind(candidateVersion).first();
  if (!candidate) throw new Error('Invalid shadow candidate');
  const attempts = (await env.AUTONOMY_DB.prepare(
    'SELECT state,latency_ms,created FROM retrieval_shadow_attempts WHERE candidate_version=?1 AND created<=?2 ORDER BY created LIMIT 10000',
  ).bind(candidateVersion, evaluatedAt).all()).results;
  const receipts = (await env.AUTONOMY_DB.prepare(
    'SELECT query_id,data,created FROM retrieval_shadow_receipts WHERE candidate_version=?1 AND created<=?2 ORDER BY created LIMIT 10000',
  ).bind(candidateVersion, evaluatedAt).all()).results;
  const successful = attempts.filter(row => row.state === 'succeeded');
  const failures = attempts.length - successful.length;
  const times = attempts.map(row => Date.parse(row.created)).filter(Number.isFinite).sort();
  const durationSeconds = times.length > 1 ? Math.max(0, Math.floor((times.at(-1) - times[0]) / 1000)) : 0;
  const parsedReceipts = receipts.map(row => JSON.parse(row.data));
  const bundles = new Set(parsedReceipts.map(row => row.bundle_sha256));
  const metrics = {
    receipts: receipts.length,
    attempts: attempts.length,
    failures,
    unique_queries: new Set(receipts.map(row => row.query_id)).size,
    duration_seconds: durationSeconds,
    p95_latency_ms: percentile95(successful.map(row => Number(row.latency_ms))),
    error_basis_points: attempts.length ? Math.round(failures * 10000 / attempts.length) : null,
    top_result_changes: parsedReceipts.filter(row => row.top_result_changed).length,
    changed_position_observations: parsedReceipts.filter(row => row.changed_positions > 0).length,
  };
  const thresholds = {...SHADOW_THRESHOLDS};
  const gates = {
    minimum_receipts: {
      observed: metrics.receipts, minimum: thresholds.minimum_receipts,
      passed: metrics.receipts >= thresholds.minimum_receipts,
    },
    minimum_unique_queries: {
      observed: metrics.unique_queries, minimum: thresholds.minimum_unique_queries,
      passed: metrics.unique_queries >= thresholds.minimum_unique_queries,
    },
    minimum_duration_seconds: {
      observed: metrics.duration_seconds, minimum: thresholds.minimum_duration_seconds,
      passed: metrics.duration_seconds >= thresholds.minimum_duration_seconds,
    },
    maximum_error_basis_points: {
      observed: metrics.error_basis_points, maximum: thresholds.maximum_error_basis_points,
      passed: metrics.error_basis_points != null
        && metrics.error_basis_points <= thresholds.maximum_error_basis_points,
    },
    maximum_p95_latency_ms: {
      observed: metrics.p95_latency_ms, maximum: thresholds.maximum_p95_latency_ms,
      passed: metrics.p95_latency_ms != null
        && metrics.p95_latency_ms <= thresholds.maximum_p95_latency_ms,
    },
    attempt_receipt_reconciliation: {
      observed_attempt_successes: successful.length,
      observed_receipts: metrics.receipts,
      passed: successful.length === metrics.receipts,
    },
    single_candidate_bundle: {
      observed: bundles.size, required: 1,
      passed: bundles.size === 1 && bundles.has(candidate.bundle_sha256),
    },
  };
  const shadowPassed = Object.values(gates).every(gate => gate.passed);
  const evidence = {
    candidate_version: candidateVersion,
    bundle_sha256: candidate.bundle_sha256,
    window_start: times.length ? new Date(times[0]).toISOString() : null,
    window_end: times.length ? new Date(times.at(-1)).toISOString() : null,
    thresholds,
    metrics,
    gates,
  };
  const evidenceDigest = await sha(canonicalJson(evidence));
  const report = {
    schema_version: 'retrieval-shadow-evaluation-v1',
    evaluated_at: evaluatedAt,
    ...evidence,
    shadow_evidence_sha256: evidenceDigest,
    shadow_passed: shadowPassed,
    approval_eligible: shadowPassed,
    promotion_eligible: false,
    note: 'Operational shadow evidence can authorize human approval only; it cannot activate serving.',
  };
  const id = (await sha(`shadow-evaluation\x1f${candidateVersion}\x1f${evidenceDigest}`)).slice(0, 24);
  await env.AUTONOMY_DB.prepare(
    'INSERT OR IGNORE INTO retrieval_shadow_evaluations(id,candidate_version,bundle_sha256,evidence_digest,passed,data,created) VALUES(?1,?2,?3,?4,?5,?6,?7)',
  ).bind(id, candidateVersion, candidate.bundle_sha256, evidenceDigest,
    Number(shadowPassed), JSON.stringify(report), evaluatedAt).run();
  return {id, report};
}

async function evaluateServingWindow(env, requestedAction, evaluatedAt = new Date().toISOString()) {
  const state = await env.AUTONOMY_DB.prepare(
    'SELECT active_version,rollback_version,generation,improvement_decision_json,improvement_chain_digest '
    + 'FROM retrieval_policy_state WHERE policy_id=?1',
  ).bind('ask-pie-ranking').first();
  const activeVersion = state?.active_version || 'lexical-subject-v2';
  const generation = state?.generation || 0;
  const windowStart = new Date(
    Date.parse(evaluatedAt) - SERVING_MONITOR_THRESHOLDS.window_seconds * 1000,
  ).toISOString();
  const rows = (await env.AUTONOMY_DB.prepare(
    'SELECT outcome,fallback_reason,latency_ms,created FROM retrieval_serving_receipts '
    + 'WHERE policy_id=?1 AND configured_version=?2 AND generation=?3 '
    + 'AND created>=?4 AND created<=?5 ORDER BY created LIMIT 10000',
  ).bind('ask-pie-ranking', activeVersion, generation, windowStart, evaluatedAt).all()).results;
  const fallbackRows = rows.filter(row => row.outcome === 'fallback');
  const hardFallbacks = [...new Set(fallbackRows.map(row => row.fallback_reason)
    .filter(reason => HARD_POLICY_FALLBACKS.has(reason)))].sort();
  const metrics = {
    receipts: rows.length,
    served: rows.length - fallbackRows.length,
    fallbacks: fallbackRows.length,
    fallback_basis_points: rows.length
      ? Math.round(fallbackRows.length * 10000 / rows.length) : null,
    p95_latency_ms: percentile95(rows.map(row => Number(row.latency_ms))),
    hard_integrity_fallbacks: fallbackRows.filter(
      row => HARD_POLICY_FALLBACKS.has(row.fallback_reason)).length,
    hard_integrity_reasons: hardFallbacks,
  };
  const thresholds = {...SERVING_MONITOR_THRESHOLDS};
  const enoughReceipts = metrics.receipts >= thresholds.minimum_receipts;
  const gates = {
    minimum_receipts: {
      observed: metrics.receipts, minimum: thresholds.minimum_receipts,
      passed: enoughReceipts,
    },
    maximum_fallback_basis_points: {
      observed: metrics.fallback_basis_points,
      maximum: thresholds.maximum_fallback_basis_points,
      passed: metrics.fallback_basis_points != null
        && metrics.fallback_basis_points <= thresholds.maximum_fallback_basis_points,
    },
    maximum_p95_latency_ms: {
      observed: metrics.p95_latency_ms, maximum: thresholds.maximum_p95_latency_ms,
      passed: metrics.p95_latency_ms != null
        && metrics.p95_latency_ms <= thresholds.maximum_p95_latency_ms,
    },
    no_hard_integrity_fallback: {
      observed: metrics.hard_integrity_fallbacks, maximum: 0,
      passed: metrics.hard_integrity_fallbacks === 0,
    },
  };
  const candidateActive = /^candidate-[0-9a-f]{16}$/.test(activeVersion);
  const rollbackRecommended = candidateActive && (
    !gates.no_hard_integrity_fallback.passed
    || (enoughReceipts && (
      !gates.maximum_fallback_basis_points.passed
      || !gates.maximum_p95_latency_ms.passed
    ))
  );
  const evidence = {
    policy_id: 'ask-pie-ranking',
    evaluated_version: activeVersion,
    rollback_version: state?.rollback_version || null,
    generation,
    window_start: windowStart,
    window_end: evaluatedAt,
    first_receipt_at: rows[0]?.created || null,
    last_receipt_at: rows.at(-1)?.created || null,
    thresholds,
    metrics,
    gates,
  };
  const evidenceDigest = await sha(canonicalJson(evidence));
  const report = {
    schema_version: 'retrieval-serving-monitor-v1',
    evaluated_at: evaluatedAt,
    ...evidence,
    serving_evidence_sha256: evidenceDigest,
    rollback_recommended: rollbackRecommended,
    requested_action: requestedAction,
    automatic_promotion: false,
    data_policy: {
      raw_query_stored: false, identity_stored: false,
      session_stored: false, ip_address_stored: false,
    },
  };
  const id = (await sha(
    `serving-monitor\x1f${activeVersion}\x1f${generation}\x1f${evidenceDigest}\x1f${requestedAction}`,
  )).slice(0, 24);
  await env.AUTONOMY_DB.prepare(
    'INSERT OR IGNORE INTO retrieval_policy_monitor_evaluations('
    + 'id,policy_id,evaluated_version,generation,evidence_digest,rollback_recommended,'
    + 'requested_action,data,created) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)',
  ).bind(id, 'ask-pie-ranking', activeVersion, generation, evidenceDigest,
    Number(rollbackRecommended), requestedAction, JSON.stringify(report), evaluatedAt).run();
  return {id, state, report};
}

async function purgeExpiredOperationalData(env, now = new Date()) {
  const cutoff = days => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const operations = [
    ['rate_buckets',
      'DELETE FROM autonomy_ingress_rate_buckets WHERE expires_at<=?1', now.toISOString()],
    ['feedback_dispositions',
      "DELETE FROM evidence_events WHERE entity_type='feedback' AND event_type='reviewer-disposition' "
      + "AND entity_id IN (SELECT id FROM evidence_events WHERE entity_type='retrieval' "
      + "AND event_type='retrieval-feedback' AND created<?1)",
      cutoff(RETENTION_DAYS.retrieval_feedback)],
    ['retrieval_feedback',
      "DELETE FROM evidence_events WHERE entity_type='retrieval' "
      + "AND event_type='retrieval-feedback' AND created<?1",
      cutoff(RETENTION_DAYS.retrieval_feedback)],
    ['forge_feedback_dispositions',
      "DELETE FROM evidence_events WHERE entity_type='forge-feedback' AND entity_id IN "
      + "(SELECT id FROM evidence_events WHERE entity_type='forge-matching' AND created<?1)",
      cutoff(RETENTION_DAYS.retrieval_feedback)],
    ['forge_matching_feedback',
      "DELETE FROM evidence_events WHERE entity_type='forge-matching' AND event_type='forge-match-feedback' AND created<?1",
      cutoff(RETENTION_DAYS.retrieval_feedback)],
    ['source_learning_reviews',"DELETE FROM evidence_events WHERE entity_type='learning-source-judgment' AND created<?1",
      cutoff(RETENTION_DAYS.retrieval_feedback)],
    ['shadow_receipts', 'DELETE FROM retrieval_shadow_receipts WHERE created<?1',
      cutoff(RETENTION_DAYS.retrieval_shadow)],
    ['shadow_attempts', 'DELETE FROM retrieval_shadow_attempts WHERE created<?1',
      cutoff(RETENTION_DAYS.retrieval_shadow)],
    ['serving_receipts', 'DELETE FROM retrieval_serving_receipts WHERE created<?1',
      cutoff(RETENTION_DAYS.retrieval_serving_receipts)],
    ['policy_monitor_evaluations',
      'DELETE FROM retrieval_policy_monitor_evaluations WHERE created<?1',
      cutoff(RETENTION_DAYS.policy_monitor_evaluations)],
  ];
  const deleted = {};
  for (const [name, query, boundary] of operations) {
    const result = await env.AUTONOMY_DB.prepare(query).bind(boundary).run();
    deleted[name] = Number(result.meta?.changes || 0);
  }
  return {deleted, retention_days:{...RETENTION_DAYS}, completed_at:now.toISOString()};
}

function cleanRetrievalFeedback(input) {
  const query = String(input?.query || '').trim();
  const feedbackId = String(input?.feedback_id || '').trim().toLowerCase();
  const policyId = String(input?.policy_id || '').trim();
  const policyVersion = String(input?.policy_version || '').trim();
  const inputRevision = String(input?.input_revision || '').trim();
  if (
    input?.schema_version !== 1
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(feedbackId)
    || !query || query.length > 300
    || policyId !== 'ask-pie-ranking'
    || !(policyVersion === 'lexical-subject-v2' || /^candidate-[0-9a-f]{16}$/.test(policyVersion))
    || !inputRevision || inputRevision.length > 128
    || !RETRIEVAL_FEEDBACK_LABELS.has(input?.label)
  ) throw new Error('Invalid retrieval feedback');

  let target = null;
  if (input.target != null) {
    const features = input.target?.features;
    const score = finiteNumber(features?.score, -100000, 100000);
    const coverage = finiteNumber(features?.coverage, 0, 1);
    const weightedCoverage = finiteNumber(features?.weighted_coverage, 0, 1);
    const citationCount = finiteNumber(features?.citation_count, 0, 100);
    const recordKey = String(input.target?.record_key || '').trim();
    const recordType = String(input.target?.record_type || '').trim();
    const position = finiteNumber(input.target?.position, 1, 100);
    if (
      !recordKey || recordKey.length > 256 || !recordType || recordType.length > 64
      || !Number.isInteger(position) || !Number.isInteger(citationCount)
      || score == null || coverage == null || weightedCoverage == null
      || typeof features?.direct !== 'boolean' || typeof features?.subject_in_title !== 'boolean'
    ) throw new Error('Invalid retrieval feedback target');
    target = {
      record_key: recordKey,
      position,
      record_type: recordType,
      features: {
        score,
        coverage,
        weighted_coverage: weightedCoverage,
        direct: features.direct,
        subject_in_title: features.subject_in_title,
        citation_count: citationCount,
      },
    };
  }
  if (input.label !== 'missing_source' && !target) {
    throw new Error('Invalid retrieval feedback target');
  }
  return {
    schema_version: 1,
    feedback_id: feedbackId,
    query,
    policy_id: policyId,
    policy_version: policyVersion,
    input_revision: inputRevision,
    label: input.label,
    target,
    signal_quality: 'explicit-unreviewed',
    data_policy: { collection_tier: 'explicit-feedback', anonymized: true, retention_days: 180 },
  };
}

async function recordRetrievalFeedback(env, feedback) {
  const queryId = (await sha(feedback.query.toLowerCase().replace(/\s+/g, ' '))).slice(0, 24);
  const eventId = (await sha(`retrieval-feedback\x1f${feedback.feedback_id}`)).slice(0, 24);
  const data = JSON.stringify({ ...feedback, query_id: queryId });
  const existing = await env.AUTONOMY_DB.prepare(
    'SELECT data FROM evidence_events WHERE id=?1',
  ).bind(eventId).first();
  if (existing && existing.data !== data) return { conflict: true, eventId, queryId };
  if (!existing) {
    await env.AUTONOMY_DB.prepare(
      'INSERT INTO evidence_events(id,entity_type,entity_id,event_type,data,created) VALUES(?1,?2,?3,?4,?5,?6)',
    ).bind(eventId, 'retrieval', queryId, 'retrieval-feedback', data, new Date().toISOString()).run();
  }
  return { conflict: false, eventId, queryId };
}

function cleanSpec(input) {
  if (
    input?.schema_version !== 1 || typeof input.id !== 'string' || !/^[0-9a-f]{24}$/.test(input.id)
    || typeof input.claim_id !== 'string' || !input.claim_id || typeof input.release !== 'string'
    || !CLAIM_POLICIES[input.claim_type] || !['low', 'medium', 'high', 'critical'].includes(input.risk)
    || typeof input.statement !== 'string' || !input.statement.trim()
  ) throw new Error('Invalid research spec');
  if (!Array.isArray(input.candidate_sources) || input.candidate_sources.length > 20) {
    throw new Error('Invalid research source candidates');
  }
  if (!Array.isArray(input.allowed_domains) || input.allowed_domains.length > 30) {
    throw new Error('Invalid research domain allowlist');
  }
  if (JSON.stringify(input).length > 60000) throw new Error('Research spec too large');
  return input;
}

function cleanResearchRequest(input, spec, role) {
  if (
    !input || input.background !== true || input.tool_choice !== 'required'
    || input.metadata?.research_spec_id !== spec.id || input.metadata?.claim_id !== spec.claim_id
    || input.metadata?.role !== role || !Number.isInteger(input.max_output_tokens)
    || input.max_output_tokens < 500 || input.max_output_tokens > 5000
  ) throw new Error('Invalid bounded background research request');
  if (
    !Array.isArray(input.tools) || input.tools.length !== 1 || input.tools[0]?.type !== 'web_search'
    || input.text?.format?.type !== 'json_schema' || input.text?.format?.strict !== true
  ) throw new Error('Research request must use web search and strict structured output');
  if (JSON.stringify(input).length > 90000) throw new Error('Research request too large');
  return input;
}

async function startResearchRun(env, spec, requests) {
  const now = new Date().toISOString();
  const jobs = [];
  await env.AUTONOMY_DB.prepare(
    "INSERT INTO research_specs(id,claim_id,release,claim_type,risk,data,state,created,updated) VALUES(?1,?2,?3,?4,?5,?6,'planned',?7,?7) ON CONFLICT(id) DO NOTHING",
  ).bind(spec.id, spec.claim_id, spec.release, spec.claim_type, spec.risk, JSON.stringify(spec), now).run();
  for (const role of ['researcher', 'verifier']) {
    const id = (await sha(`${spec.id}\x1f${role}`)).slice(0, 24);
    const existing = await env.AUTONOMY_DB.prepare(
      'SELECT response_id,state FROM research_jobs WHERE id=?1',
    ).bind(id).first();
    if (existing?.response_id && ['queued', 'in_progress', 'completed'].includes(existing.state)) {
      jobs.push({ id, role, ...existing, replayed: true });
      continue;
    }
    const providerRequest = cleanResearchRequest(requests?.[role], spec, role);
    await env.AUTONOMY_DB.prepare(
      "INSERT OR IGNORE INTO research_jobs(id,spec_id,role,provider,state,created,updated) VALUES(?1,?2,?3,'openai','planned',?4,?4)",
    ).bind(id, spec.id, role, now).run();
    const remote = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(providerRequest),
    });
    if (!remote.ok) {
      await env.AUTONOMY_DB.prepare(
        "UPDATE research_jobs SET state='failed',attempts=attempts+1,last_error=?1,updated=?2 WHERE id=?3",
      ).bind(`Provider HTTP ${remote.status}`, now, id).run();
      throw new Error('Research provider rejected a background request');
    }
    const response = await remote.json();
    if (!response.id || !['queued', 'in_progress', 'completed'].includes(response.status)) {
      throw new Error('Research provider did not acknowledge background work');
    }
    await env.AUTONOMY_DB.prepare(
      'UPDATE research_jobs SET response_id=?1,state=?2,attempts=attempts+1,last_error=NULL,updated=?3 WHERE id=?4',
    ).bind(response.id, response.status, now, id).run();
    await recordEvent(env, 'job', id, 'provider-acknowledged', {
      response_id: response.id, state: response.status, role,
    });
    await env.AUTONOMY_DB.prepare(
      "UPDATE research_specs SET state='researching',updated=?1 WHERE id=?2",
    ).bind(now, spec.id).run();
    jobs.push({ id, role, response_id: response.id, state: response.status });
  }
  if (!jobs.every(job => job.state === 'completed')) {
    await env.AUTONOMY_DB.prepare(
      "UPDATE research_specs SET state='researching',updated=?1 WHERE id=?2",
    ).bind(now, spec.id).run();
  }
  return jobs;
}

function packetFromResponse(response) {
  const text = (response.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text || '')
    .join('');
  if (!text) throw new Error('Completed response has no evidence packet');
  return JSON.parse(text);
}

function validatePacket(packet, claimId, role) {
  const strings = ['proposed_statement', 'scope', 'jurisdiction', 'effective_date', 'notes'];
  const arrays = ['sources', 'contradictions', 'calculations', 'alternatives', 'limitations'];
  if (
    !packet || packet.claim_id !== claimId || packet.role !== role || !CONCLUSIONS.has(packet.conclusion)
    || !Number.isFinite(packet.confidence) || packet.confidence < 0 || packet.confidence > 1
    || strings.some(key => typeof packet[key] !== 'string')
    || arrays.some(key => !Array.isArray(packet[key]))
  ) throw new Error('Invalid evidence packet');
  if (
    packet.sources.length > 10 || packet.contradictions.length > 20
    || packet.calculations.length > 20 || packet.alternatives.length > 20
    || packet.limitations.length > 20
  ) throw new Error('Evidence packet exceeds bounded collection limits');
  for (const source of packet.sources) {
    if (
      !source || typeof source !== 'object' || !SOURCE_CLASSES.has(source.source_class)
      || !['url', 'title', 'publisher', 'passage', 'locator', 'supports', 'version']
        .every(key => typeof source[key] === 'string')
      || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z)?$/.test(source.retrieved_at || '')
    ) throw new Error('Invalid evidence source');
  }
  for (const calculation of packet.calculations) {
    if (
      !calculation || typeof calculation !== 'object'
      || !['method', 'inputs', 'units', 'result', 'code'].every(key => typeof calculation[key] === 'string')
      || typeof calculation.reproduced !== 'boolean'
    ) throw new Error('Invalid evidence calculation');
  }
  return packet;
}

function allowedHost(hostname, domains) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (
    !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':')
  ) return false;
  return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
}

function allowedDomains(spec) {
  const candidates = (spec.candidate_sources || []).map(value => {
    try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
  });
  return [...new Set([...OFFICIAL_DOMAINS, ...(spec.allowed_domains || []), ...candidates]
    .map(value => String(value).toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean))];
}

async function verifyPacketSources(packet, spec, env) {
  const domains = allowedDomains(spec);
  for (const source of packet.sources) {
    let url;
    try { url = new URL(source.url); } catch { throw new Error('Invalid evidence source URL'); }
    if (url.protocol !== 'https:' || !allowedHost(url.hostname, domains)) {
      throw new Error('Evidence source outside allowlist');
    }
    let remote;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      remote = await fetch(url, {
        headers: { 'user-agent': 'UAS-Patterns-Evidence/1.0' }, redirect: 'manual',
      });
      if (![301, 302, 303, 307, 308].includes(remote.status)) break;
      const location = remote.headers.get('location');
      if (!location) throw new Error('Evidence source redirect is missing a target');
      url = new URL(location, url);
      if (url.protocol !== 'https:' || !allowedHost(url.hostname, domains)) {
        throw new Error('Evidence source redirect left allowlist');
      }
      if (redirects === 5) throw new Error('Evidence source redirect limit exceeded');
    }
    if (!remote?.ok) throw new Error(`Evidence source retrieval failed: ${remote?.status || 0}`);
    const declared = Number(remote.headers.get('content-length') || 0);
    if (declared > 4 * 1024 * 1024) throw new Error('Evidence source is too large');
    const bytes = new Uint8Array(await remote.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Evidence source is too large');
    const digest = await sha(bytes);
    source.url = url.toString();
    source.content_sha256 = digest;
    source.retrieved_by = 'trusted-worker';
    if (env.RESEARCH_EVIDENCE) {
      await env.RESEARCH_EVIDENCE.put(`sources/${digest}`, bytes, {
        httpMetadata: { contentType: remote.headers.get('content-type') || 'application/octet-stream' },
        customMetadata: { source_url: source.url, sha256: digest },
      });
      source.snapshot_key = `sources/${digest}`;
    } else {
      delete source.snapshot_key;
    }
  }
  return packet;
}

export async function adjudicateStored(env, specRow) {
  const spec = JSON.parse(specRow.data);
  const result = await env.AUTONOMY_DB.prepare(
    'SELECT p.role,p.data FROM evidence_packets p JOIN research_jobs j ON j.id=p.job_id WHERE j.spec_id=?1 ORDER BY p.role',
  ).bind(spec.id).all();
  const packets = result.results.map(row => JSON.parse(row.data));
  const byRole = Object.fromEntries(packets.map(packet => [packet.role, packet]));
  const policy = CLAIM_POLICIES[spec.claim_type];
  const sources = packets.flatMap(packet => packet.sources || []);
  const uniqueDigests = [...new Set(sources.map(source => source.content_sha256).filter(Boolean))];
  const contradictions = packets.flatMap(packet => packet.contradictions || []);
  const now = new Date().toISOString();
  let decision = {
    claim_id: spec.claim_id,
    claim_type: spec.claim_type,
    risk: spec.risk,
    publication_state: 'abstained',
    publish_eligible: false,
    human_intervention: false,
    reasons: [],
    evidence_packet_digests: packets.map(packet => packet.packet_digest).filter(Boolean),
    source_digests: uniqueDigests,
    created_at: now,
  };
  if (!byRole.researcher || !byRole.verifier) {
    decision.reasons = ['independent-role-pair-required'];
  } else if (policy.physical) {
    decision = { ...decision, publication_state: 'exception', human_intervention: true,
      reasons: ['hardware-field-or-safety-evidence-is-not-software-validation'] };
  } else if (policy.forecast) {
    decision = { ...decision, publication_state: 'forecast-evidence',
      reasons: ['forecast-remains-preregistered-and-is-not-a-current-fact'] };
  } else if (!packets.every(packet => packet.conclusion === 'supports' && packet.confidence >= 0.8)) {
    decision.reasons = ['independent-roles-did-not-both-support-at-high-confidence'];
  } else if (contradictions.length) {
    decision = { ...decision, publication_state: 'exception', human_intervention: true,
      reasons: ['unresolved-counterevidence'] };
  } else if (uniqueDigests.length < policy.minimumSources) {
    decision.reasons = ['insufficient-distinct-trusted-source-snapshots'];
  } else if (
    byRole.researcher.proposed_statement.trim() !== byRole.verifier.proposed_statement.trim()
    || byRole.researcher.scope.trim() !== byRole.verifier.scope.trim()
  ) {
    decision.reasons = ['independent-roles-did-not-propose-the-same-scoped-statement'];
  } else if (policy.authority && !sources.some(source => source.source_class === 'controlling-authority')) {
    decision = { ...decision, publication_state: 'exception', human_intervention: true,
      reasons: ['controlling-authority-source-required'] };
  } else if (policy.review) {
    decision = { ...decision, publication_state: 'exception', human_intervention: true,
      reasons: ['policy-requires-human-review'] };
  } else if (!policy.eligible) {
    decision.reasons = ['research-evidence-is-not-publication-eligible-for-this-claim-type'];
  } else {
    decision = {
      ...decision,
      publication_state: 'corroborated',
      publish_eligible: true,
      reasons: ['deterministic-eligibility-policy-passed'],
      statement: byRole.verifier.proposed_statement,
      scope: byRole.verifier.scope,
      source_urls: [...new Set(sources.map(source => source.url))].sort(),
    };
  }
  decision.id = (await sha(`${spec.id}\x1f${JSON.stringify(packets)}`)).slice(0, 24);
  await env.AUTONOMY_DB.prepare(
    'INSERT OR IGNORE INTO evidence_decisions(id,spec_id,claim_id,publication_state,publish_eligible,human_intervention,data,created) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)',
  ).bind(
    decision.id, spec.id, spec.claim_id, decision.publication_state,
    decision.publish_eligible ? 1 : 0, decision.human_intervention ? 1 : 0,
    JSON.stringify(decision), decision.created_at,
  ).run();
  await recordEvent(env, 'decision', decision.id, 'adjudicated', {
    publication_state: decision.publication_state,
    publish_eligible: decision.publish_eligible,
    human_intervention: decision.human_intervention,
    reasons: decision.reasons,
  });
  const state = decision.human_intervention ? 'exception' : decision.publish_eligible ? 'complete' : 'abstained';
  await env.AUTONOMY_DB.prepare(
    'UPDATE research_specs SET state=?1,updated=?2 WHERE id=?3',
  ).bind(state, now, spec.id).run();
  return decision;
}

async function processCompletedResponse(env, event) {
  const now = new Date().toISOString();
  const responseId = event.data.id;
  const job = await env.AUTONOMY_DB.prepare(
    'SELECT id,spec_id,role FROM research_jobs WHERE response_id=?1',
  ).bind(responseId).first();
  if (!job) {
    await env.AUTONOMY_DB.prepare(
      "UPDATE webhook_events SET state='ignored',updated=?1 WHERE id=?2",
    ).bind(now, event.id).run();
    return;
  }
  const remote = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
  });
  if (!remote.ok) throw new Error(`Response retrieval failed: ${remote.status}`);
  const declared = Number(remote.headers.get('content-length') || 0);
  if (declared > 2 * 1024 * 1024) throw new Error('Completed response is too large');
  const bytes = new Uint8Array(await remote.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Completed response is too large');
  const response = JSON.parse(new TextDecoder().decode(bytes));
  const specRow = await env.AUTONOMY_DB.prepare(
    'SELECT claim_id,data FROM research_specs WHERE id=?1',
  ).bind(job.spec_id).first();
  if (!specRow) throw new Error('Research spec is missing');
  let packet = validatePacket(packetFromResponse(response), specRow.claim_id, job.role);
  packet = await verifyPacketSources(packet, JSON.parse(specRow.data), env);
  const packetData = JSON.stringify(packet);
  const digest = await sha(packetData);
  packet.packet_digest = digest;
  const packetId = (await sha(`${job.id}|${digest}`)).slice(0, 24);
  await env.AUTONOMY_DB.prepare(
    'INSERT OR IGNORE INTO evidence_packets(id,job_id,claim_id,role,data,digest,created) VALUES(?1,?2,?3,?4,?5,?6,?7)',
  ).bind(packetId, job.id, packet.claim_id, packet.role, JSON.stringify(packet), digest, now).run();
  await recordEvent(env, 'job', job.id, 'packet-stored', { packet_id: packetId, digest, role: packet.role });
  await env.AUTONOMY_DB.prepare(
    "UPDATE research_jobs SET state='completed',last_error=NULL,updated=?1 WHERE id=?2",
  ).bind(now, job.id).run();
  const pending = await env.AUTONOMY_DB.prepare(
    "SELECT count(*) count FROM research_jobs WHERE spec_id=?1 AND state!='completed'",
  ).bind(job.spec_id).first();
  await env.AUTONOMY_DB.prepare(
    'UPDATE research_specs SET state=?1,updated=?2 WHERE id=?3',
  ).bind(Number(pending.count) === 0 ? 'adjudicating' : 'researching', now, job.spec_id).run();
  if (Number(pending.count) === 0) await adjudicateStored(env, specRow);
  await env.AUTONOMY_DB.prepare(
    "UPDATE webhook_events SET state='processed',updated=?1 WHERE id=?2",
  ).bind(now, event.id).run();
}

async function processTerminalFailure(env, event, state) {
  const now = new Date().toISOString();
  const job = await env.AUTONOMY_DB.prepare(
    'SELECT id,spec_id FROM research_jobs WHERE response_id=?1',
  ).bind(event.data.id).first();
  if (!job) {
    await env.AUTONOMY_DB.prepare(
      "UPDATE webhook_events SET state='ignored',updated=?1 WHERE id=?2",
    ).bind(now, event.id).run();
    return;
  }
  await env.AUTONOMY_DB.prepare(
    'UPDATE research_jobs SET state=?1,last_error=?2,updated=?3 WHERE id=?4',
  ).bind(state, `OpenAI terminal event: ${event.type}`, now, job.id).run();
  await env.AUTONOMY_DB.prepare(
    "UPDATE research_specs SET state='failed',updated=?1 WHERE id=?2",
  ).bind(now, job.spec_id).run();
  await recordEvent(env, 'job', job.id, 'provider-terminal-failure', { state, event_type: event.type });
  await env.AUTONOMY_DB.prepare(
    "UPDATE webhook_events SET state='processed',updated=?1 WHERE id=?2",
  ).bind(now, event.id).run();
}

async function handleWebhook(request, env, context) {
  const raw = await request.text();
  if (encoder.encode(raw).length > 262144) return respond(413, { error: 'Webhook body too large' });
  if (!await verifyWebhook(raw, request.headers, env.OPENAI_WEBHOOK_SECRET)) {
    return respond(400, { error: 'Invalid webhook signature' });
  }
  const event = JSON.parse(raw);
  if (!event.id || !event.type || !event.data?.id) throw new Error('Invalid webhook event');
  const now = new Date().toISOString();
  const saved = await env.AUTONOMY_DB.prepare(
    "INSERT OR IGNORE INTO webhook_events(id,event_type,response_id,state,created,updated) VALUES(?1,?2,?3,'received',?4,?4)",
  ).bind(event.id, event.type, event.data.id, now).run();
  if (saved.meta.changes === 0) return respond(200, { received: true, replayed: true });
  let work;
  if (event.type === 'response.completed') work = processCompletedResponse(env, event);
  else if (TERMINAL_FAILURES.has(event.type)) work = processTerminalFailure(env, event, TERMINAL_FAILURES.get(event.type));
  else {
    await env.AUTONOMY_DB.prepare(
      "UPDATE webhook_events SET state='ignored',updated=?1 WHERE id=?2",
    ).bind(now, event.id).run();
    return respond(202, { received: true, ignored: true });
  }
  const guarded = work.catch(async error => {
    await env.AUTONOMY_DB.prepare(
      "UPDATE webhook_events SET state='failed',updated=?1 WHERE id=?2",
    ).bind(new Date().toISOString(), event.id).run();
    const job = await env.AUTONOMY_DB.prepare(
      'SELECT id,spec_id FROM research_jobs WHERE response_id=?1',
    ).bind(event.data.id).first();
    if (job) {
      await env.AUTONOMY_DB.prepare(
        "UPDATE research_jobs SET state='failed',last_error=?1,updated=?2 WHERE id=?3",
      ).bind(error?.message?.slice(0, 500) || 'Evidence processing failed', new Date().toISOString(), job.id).run();
      await env.AUTONOMY_DB.prepare(
        "UPDATE research_specs SET state='failed',updated=?1 WHERE id=?2",
      ).bind(new Date().toISOString(), job.spec_id).run();
    }
  });
  if (context?.waitUntil) context.waitUntil(guarded); else await guarded;
  return respond(202, { received: true });
}

export async function handlePatternsAutonomy(request, env, context) {
  const path = new URL(request.url).pathname.replace(/^\/api\/autonomy\/?/, '');
  const db = env.AUTONOMY_DB;
  if (path === 'status' && request.method === 'GET') {
    if (!db) return respond(200, { enabled: false, schema_version: 1 });
    const specs = await db.prepare('SELECT state,count(*) count FROM research_specs GROUP BY state').all();
    const decisions = await db.prepare(
      'SELECT publication_state,count(*) count FROM evidence_decisions GROUP BY publication_state',
    ).all();
    return respond(200, {
      enabled: true,
      live_research: Boolean(env.OPENAI_API_KEY && env.OPENAI_WEBHOOK_SECRET),
      source_snapshots: Boolean(env.RESEARCH_EVIDENCE),
      automatic_publication: false,
      specs: specs.results,
      decisions: decisions.results,
      schema_version: 1,
    });
  }
  if (!db) return respond(503, { error: 'Autonomous evidence storage is not configured' });
  try {
    if (path === 'forge-feedback' || path.startsWith('forge-feedback/')) {
      const response = await handleForgeMatchingFeedback(request, env, {
        respond, parseBody,
        reviewAuthorized: await reviewer(request, env.PATTERNS_REVIEW_TOKEN),
        sameOrigin: feedbackOriginAllowed(request)
          || ['https://uas-forge.com', 'https://www.uas-forge.com'].includes(request.headers.get('origin')),
        rateLimit: async () => rateLimitResponse(await consumeIngressRateLimit(request, env, 'feedback')),
      });
      return response || respond(404, { error: 'Forge feedback route not found' });
    }
    if (path === 'source-learning') return await handleSourceLearningFeedback(request,env,{
      respond,parseBody,reviewAuthorized:await reviewer(request,env.PATTERNS_REVIEW_TOKEN),
    });
    if (path === 'improvement/experiments' && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, {error:'Reviewer authorization required'});
      }
      try {
        const receipt = await registerExperiment(env, await parseBody(request));
        return respond(receipt.idempotentReplay ? 200 : 201,
          improvementReceipt('EXPERIMENT', receipt));
      } catch (error) {
        return improvementFailure(error);
      }
    }
    if (path === 'improvement/candidates' && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, {error:'Reviewer authorization required'});
      }
      try {
        const input = await parseBody(request);
        const stored = await db.prepare(
          'SELECT record_json FROM improvement_experiments WHERE experiment_id=?1',
        ).bind(String(input?.experimentId || '')).first();
        if (!stored) return respond(404, {
          error:'Registered improvement experiment not found', changes_serving:false,
          authorizes_action:false,
        });
        const receipt = await registerCandidate(env, input, JSON.parse(stored.record_json));
        return respond(receipt.idempotentReplay ? 200 : 201,
          improvementReceipt('CANDIDATE', receipt));
      } catch (error) {
        return improvementFailure(error);
      }
    }
    if (path === 'improvement/evaluations' && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, {error:'Reviewer authorization required'});
      }
      try {
        const input = await parseBody(request);
        const candidateRow = await db.prepare(
          "SELECT record_json FROM improvement_candidates WHERE json_extract(record_json,'$.candidateDigest')=?1",
        ).bind(String(input?.candidateDigest || '')).first();
        if (!candidateRow) return respond(404, {
          error:'Registered improvement candidate not found', changes_serving:false,
          authorizes_action:false,
        });
        const candidate = JSON.parse(candidateRow.record_json);
        const experimentRow = await db.prepare(
          'SELECT record_json FROM improvement_experiments WHERE experiment_id=?1',
        ).bind(candidate.experimentId).first();
        if (!experimentRow) return respond(409, {
          error:'Candidate experiment lineage is unavailable', changes_serving:false,
          authorizes_action:false,
        });
        const receipt = await recordEvaluation(
          env, input, JSON.parse(experimentRow.record_json), candidate,
        );
        return respond(receipt.idempotentReplay ? 200 : 201,
          improvementReceipt('EVALUATION', receipt));
      } catch (error) {
        return improvementFailure(error);
      }
    }
    if (path === 'improvement/incidents' && request.method === 'POST') {
      const reviewAuthorized = await reviewer(request, env.PATTERNS_REVIEW_TOKEN);
      const monitorAuthorized = await reviewer(request, env.PATTERNS_MONITOR_TOKEN);
      if (!reviewAuthorized && !monitorAuthorized) {
        return respond(401, {error:'Monitor or reviewer authorization required'});
      }
      try {
        const input = await parseBody(request);
        const lineage = await db.prepare(
          "SELECT record_json FROM improvement_candidates WHERE json_extract(record_json,'$.candidateDigest')=?1",
        ).bind(String(input?.candidateDigest || '')).first();
        if (!lineage) return respond(404, {
          error:'Incident candidate lineage not found', changes_serving:false,
          authorizes_action:false,
        });
        const candidate = JSON.parse(lineage.record_json);
        if (candidate.experimentId !== input?.experimentId) return respond(409, {
          error:'Incident does not match candidate experiment lineage', changes_serving:false,
          authorizes_action:false,
        });
        const receipt = await recordIncident(env, input);
        return respond(receipt.idempotentReplay ? 200 : 201,
          improvementReceipt('INCIDENT', receipt));
      } catch (error) {
        return improvementFailure(error);
      }
    }
    if (path === 'improvement/serving-receipts' && request.method === 'POST') {
      const reviewAuthorized = await reviewer(request, env.PATTERNS_REVIEW_TOKEN);
      const monitorAuthorized = await reviewer(request, env.PATTERNS_MONITOR_TOKEN);
      if (!reviewAuthorized && !monitorAuthorized) {
        return respond(401, {error:'Monitor or reviewer authorization required'});
      }
      try {
        const receipt = await recordServingReceipt(env, await parseBody(request));
        return respond(receipt.idempotentReplay ? 200 : 201,
          improvementReceipt('SERVING_RECEIPT', receipt));
      } catch (error) {
        return improvementFailure(error);
      }
    }
    if (path === 'improvement/audit' && request.method === 'GET') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, {error:'Reviewer authorization required'});
      }
      const tables = {
        experiments:'improvement_experiments', candidates:'improvement_candidates',
        evaluations:'improvement_evaluations', incidents:'improvement_incidents',
        serving_receipts:'improvement_serving_receipts',
      };
      const audit = {};
      for (const [name, table] of Object.entries(tables)) {
        const result = await db.prepare(
          `SELECT record_json FROM ${table} ORDER BY created DESC LIMIT 200`,
        ).all();
        audit[name] = result.results.map(row => JSON.parse(row.record_json));
      }
      return respond(200, {
        schema_version:'patterns.improvement-audit.v1', ...audit,
        read_only:true, changes_serving:false, changes_authority:false,
        changes_hardware:false, authorizes_action:false,
      });
    }
    if (path === 'candidates' && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const runtime = cleanShadowRegistryBundle(await parseBody(request, 2000000));
      const serialized = JSON.stringify(runtime);
      const runtimeDigest = await sha(serialized);
      const existing = await db.prepare(
        'SELECT bundle_sha256,runtime_digest,data FROM retrieval_candidates WHERE candidate_version=?1',
      ).bind(runtime.candidate_version).first();
      if (existing && (
        existing.bundle_sha256 !== runtime.bundle_sha256
        || existing.runtime_digest !== runtimeDigest
        || existing.data !== serialized
      )) return respond(409, { error: 'Candidate version is already registered with different evidence' });
      const now = new Date().toISOString();
      if (!existing) {
        await db.prepare(
          'INSERT INTO retrieval_candidates(candidate_version,bundle_sha256,policy_id,incumbent_version,runtime_digest,state,data,created) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)',
        ).bind(runtime.candidate_version, runtime.bundle_sha256, runtime.policy_id,
          runtime.incumbent_version, runtimeDigest, runtime.state, serialized, now).run();
      }
      const eventId = await recordEvent(env, 'candidate', runtime.candidate_version,
        'candidate-registered-for-shadow', {
          bundle_sha256: runtime.bundle_sha256,
          runtime_digest: runtimeDigest,
          serving_changes: false,
          promotion_eligible: false,
        });
      return respond(existing ? 200 : 201, {
        candidate_version: runtime.candidate_version,
        bundle_sha256: runtime.bundle_sha256,
        runtime_digest: runtimeDigest,
        state: 'registered-shadow-only',
        event_id: eventId,
        replayed: Boolean(existing),
        serving_changes: false,
        promotion_eligible: false,
      });
    }
    const candidateShadowMatch = path.match(/^(candidates)\/(candidate-[0-9a-f]{16})\/shadow$/);
    if (candidateShadowMatch && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const input = await parseBody(request, 32768);
      const action = input?.action;
      const notes = String(input?.notes || '').trim();
      if (!['enable-shadow', 'disable-shadow'].includes(action) || !notes || notes.length > 5000) {
        return respond(400, { error: 'A valid shadow action and concise reviewer note are required' });
      }
      const candidateVersion = candidateShadowMatch[2];
      const candidate = await db.prepare(
        "SELECT candidate_version FROM retrieval_candidates WHERE candidate_version=?1 AND state='registered-shadow-only'",
      ).bind(candidateVersion).first();
      if (!candidate) return respond(404, { error: 'Registered shadow candidate not found' });
      const enabled = action === 'enable-shadow' ? 1 : 0;
      const now = new Date().toISOString();
      await db.prepare(
        'INSERT INTO retrieval_shadow_state(policy_id,candidate_version,enabled,updated) VALUES(?1,?2,?3,?4) '
        + 'ON CONFLICT(policy_id) DO UPDATE SET candidate_version=excluded.candidate_version,enabled=excluded.enabled,updated=excluded.updated',
      ).bind('ask-pie-ranking', candidateVersion, enabled, now).run();
      const eventId = await recordEvent(env, 'candidate', candidateVersion,
        'shadow-state-changed', { action, notes, enabled: Boolean(enabled), serving_changes: false });
      return respond(200, {
        candidate_version: candidateVersion,
        shadow_enabled: Boolean(enabled),
        event_id: eventId,
        visible_effect: false,
        serving_changes: false,
        promotion_eligible: false,
      });
    }
    if (path === 'shadow/status' && request.method === 'GET') {
      const state = await db.prepare(
        'SELECT s.enabled,s.candidate_version,c.incumbent_version FROM retrieval_shadow_state s '
        + 'JOIN retrieval_candidates c ON c.candidate_version=s.candidate_version WHERE s.policy_id=?1',
      ).bind('ask-pie-ranking').first();
      return respond(200, {
        enabled: Boolean(state?.enabled),
        candidate_version: state?.enabled ? state.candidate_version : null,
        incumbent_version: state?.enabled ? state.incumbent_version : null,
        visible_effect: false,
        serving_changes: false,
        promotion_eligible: false,
      });
    }
    if (path === 'shadow' && request.method === 'POST') {
      if (!feedbackOriginAllowed(request)) return respond(403, { error: 'Same-origin shadow observation required' });
      const state = await db.prepare(
        'SELECT c.data FROM retrieval_shadow_state s JOIN retrieval_candidates c '
        + 'ON c.candidate_version=s.candidate_version WHERE s.policy_id=?1 AND s.enabled=1',
      ).bind('ask-pie-ranking').first();
      if (!state) return respond(200, {
        enabled: false, visible_effect: false, serving_changes: false, promotion_eligible: false,
      });
      const rateResponse = rateLimitResponse(
        await consumeIngressRateLimit(request, env, 'shadow'));
      if (rateResponse) return rateResponse;
      const runtime = JSON.parse(state.data);
      const input = await parseBody(request, 131072);
      const started = Date.now();
      let evaluated;
      try {
        evaluated = await evaluateShadowObservation(env, input, runtime);
      } catch (error) {
        await recordShadowAttempt(
          env, runtime, input?.observation_id, 'failed', Date.now() - started,
          'invalid-or-failed-observation');
        throw error;
      }
      if (evaluated.conflict) {
        await recordShadowAttempt(
          env, runtime, input?.observation_id, 'failed', Date.now() - started,
          'observation-id-conflict');
        return respond(409, { error: 'Observation id was already used for different shadow data' });
      }
      await recordShadowAttempt(
        env, runtime, input?.observation_id, 'succeeded', Date.now() - started, null);
      return respond(202, {
        enabled: true,
        receipt_id: evaluated.receiptId,
        receipt: evaluated.receipt,
      });
    }
    if (path === 'shadow/receipts' && request.method === 'GET') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const result = await db.prepare(
        'SELECT id,candidate_version,query_id,input_revision,data,created FROM retrieval_shadow_receipts ORDER BY created DESC LIMIT 200',
      ).all();
      return respond(200, {
        receipts: result.results.map(row => ({
          id: row.id,
          candidate_version: row.candidate_version,
          query_id: row.query_id,
          input_revision: row.input_revision,
          created: row.created,
          data: JSON.parse(row.data),
        })),
        visible_effect: false,
        serving_changes: false,
        promotion_eligible: false,
      });
    }
    const shadowEvaluationMatch = path.match(/^candidates\/(candidate-[0-9a-f]{16})\/shadow\/evaluate$/);
    if (shadowEvaluationMatch && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const evaluated = await evaluateShadowWindow(env, shadowEvaluationMatch[1]);
      return respond(evaluated.report.shadow_passed ? 201 : 200, {
        id: evaluated.id,
        evaluation: evaluated.report,
        serving_changes: false,
      });
    }
    if (path === 'promotions' && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      if (!env.PATTERNS_POLICY_SIGNING_SECRET) {
        return respond(503, { error: 'Policy signature verification is not configured' });
      }
      const promotionPayload = await parseBody(request, 524288);
      const manifest = promotionPayload?.manifest || promotionPayload;
      const decisionChain = promotionPayload?.decision_chain || null;
      const verified = await verifyPolicyManifest(manifest, env.PATTERNS_POLICY_SIGNING_SECRET);
      if (!verified.valid) return respond(400, { error: verified.reason });
      const currentPolicy = await db.prepare(
        'SELECT generation FROM retrieval_policy_state WHERE policy_id=?1',
      ).bind('ask-pie-ranking').first();
      const currentGeneration = currentPolicy?.generation || 0;
      if (env.REQUIRE_IMPROVEMENT_DECISION_CHAIN === 'true' && !decisionChain) {
        return respond(400, { error: 'A complete portfolio improvement decision chain is required' });
      }
      let admittedChain = null;
      if (decisionChain) {
        try {
          admittedChain = await validateApprovedDecisionChain(
            decisionChain, manifest, currentGeneration);
        } catch (error) {
          return respond(400, { error: error instanceof Error ? error.message : 'Invalid improvement decision chain' });
        }
      }
      const candidate = await db.prepare(
        'SELECT bundle_sha256,data FROM retrieval_candidates WHERE candidate_version=?1',
      ).bind(manifest.version).first();
      if (!candidate || candidate.bundle_sha256 !== manifest.candidate_bundle_sha256) {
        return respond(409, { error: 'Signed manifest does not match the registered candidate' });
      }
      const runtime = JSON.parse(candidate.data);
      if (await sha256(canonicalJson(runtime.parameters)) !== manifest.parameters_sha256) {
        return respond(409, { error: 'Signed manifest parameters do not match the registered candidate' });
      }
      const shadow = await db.prepare(
        'SELECT id,data FROM retrieval_shadow_evaluations WHERE candidate_version=?1 AND evidence_digest=?2 AND passed=1',
      ).bind(manifest.version, manifest.shadow_evidence_sha256).first();
      if (!shadow) return respond(409, { error: 'Passing shadow evidence is not registered' });
      const shadowReport = JSON.parse(shadow.data);
      if (Date.parse(manifest.approval.approved_at) < Date.parse(shadowReport.evaluated_at)) {
        return respond(409, { error: 'Signed approval predates the registered shadow evaluation' });
      }
      const id = (await sha(`policy-manifest\x1f${manifest.manifest_sha256}`)).slice(0, 24);
      const serialized = JSON.stringify(manifest);
      const existing = await db.prepare(
        'SELECT manifest_sha256,signature,data,state FROM retrieval_policy_manifests WHERE candidate_version=?1',
      ).bind(manifest.version).first();
      if (existing && (
        existing.manifest_sha256 !== manifest.manifest_sha256
        || existing.signature !== manifest.signature
        || existing.data !== serialized
      )) return respond(409, { error: 'Candidate already has a different approved manifest' });
      const now = new Date().toISOString();
      if (admittedChain) {
        const existingChain = await db.prepare(
          'SELECT chain_digest,record_json FROM portfolio_improvement_chains WHERE candidate_digest=?1',
        ).bind(admittedChain.candidateDigest).first();
        if (existingChain && (
          existingChain.chain_digest !== admittedChain.chainDigest
          || existingChain.record_json !== JSON.stringify(admittedChain.chain)
        )) return respond(409, { error: 'Candidate already has a different improvement decision chain' });
        if (!existingChain) {
          const statements = [];
          for (const decision of admittedChain.chain.decisions) {
            const decisionDigest = await improvementDecisionDigest(decision);
            statements.push(db.prepare(
              'INSERT INTO portfolio_improvement_decisions('
              + 'decision_id,decision_digest,chain_digest,lane,candidate_digest,permitted_surface,'
              + 'previous_state,new_state,active_generation,record_json,created'
              + ') VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)',
            ).bind(
              decision.decisionId, decisionDigest, admittedChain.chainDigest,
              decision.lane, decision.candidateDigest, decision.permittedSurface,
              decision.previousState, decision.newState, decision.activeGeneration,
              JSON.stringify(decision), now,
            ));
          }
          statements.push(db.prepare(
            "INSERT INTO portfolio_improvement_chains(chain_digest,candidate_digest,evidence_chain_digest,final_decision_id,state,record_json,created,updated) VALUES(?1,?2,?3,?4,'approved',?5,?6,?6)",
          ).bind(
            admittedChain.chainDigest, admittedChain.candidateDigest,
            admittedChain.evidenceChainDigest, admittedChain.approvedDecision.decisionId,
            JSON.stringify(admittedChain.chain), now,
          ));
          await db.batch(statements);
        }
      }
      if (!existing) {
        await db.prepare(
          "INSERT INTO retrieval_policy_manifests(id,candidate_version,manifest_sha256,signature,state,data,created,updated) VALUES(?1,?2,?3,?4,'approved',?5,?6,?6)",
        ).bind(id, manifest.version, manifest.manifest_sha256, manifest.signature,
          serialized, now).run();
      }
      return respond(existing ? 200 : 201, {
        id,
        version: manifest.version,
        manifest_sha256: manifest.manifest_sha256,
        state: existing?.state || 'approved',
        replayed: Boolean(existing),
        activation_eligible: (existing?.state || 'approved') === 'approved',
        serving_changes: false,
        decision_chain_digest: admittedChain?.chainDigest || null,
        approved_decision_id: admittedChain?.approvedDecision.decisionId || null,
      });
    }
    const promotionActivateMatch = path.match(/^promotions\/([0-9a-f]{24})\/activate$/);
    if (promotionActivateMatch && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const input = await parseBody(request, 32768);
      const notes = String(input?.notes || '').trim();
      const expectedVersion = String(input?.expected_active_version || '');
      const expectedGeneration = Number(input?.expected_generation);
      if (input?.action !== 'activate' || !notes || notes.length > 5000
        || !expectedVersion || !Number.isInteger(expectedGeneration) || expectedGeneration < 0) {
        return respond(400, { error: 'Explicit activation, expected pointer, generation, and notes are required' });
      }
      const row = await db.prepare(
        'SELECT state,data FROM retrieval_policy_manifests WHERE id=?1',
      ).bind(promotionActivateMatch[1]).first();
      if (!row || row.state !== 'approved') {
        return respond(409, { error: 'Approved inactive manifest not found' });
      }
      const manifest = JSON.parse(row.data);
      const verified = await verifyPolicyManifest(
        manifest, env.PATTERNS_POLICY_SIGNING_SECRET || '');
      if (!verified.valid) return respond(409, { error: 'Approved manifest signature is invalid' });
      const shadowState = await db.prepare(
        'SELECT enabled FROM retrieval_shadow_state WHERE policy_id=?1 AND candidate_version=?2',
      ).bind('ask-pie-ranking', manifest.version).first();
      if (shadowState?.enabled) {
        return respond(409, { error: 'Disable candidate shadow execution before activation' });
      }
      const current = await db.prepare(
        'SELECT active_version,generation FROM retrieval_policy_state WHERE policy_id=?1',
      ).bind('ask-pie-ranking').first();
      const currentVersion = current?.active_version || 'lexical-subject-v2';
      const currentGeneration = current?.generation || 0;
      if (currentVersion !== expectedVersion || currentGeneration !== expectedGeneration
        || manifest.rollback_to !== currentVersion) {
        return respond(409, { error: 'Active policy pointer changed or rollback target does not match' });
      }
      const now = new Date().toISOString();
      const admitted = await db.prepare(
        'SELECT c.chain_digest,d.record_json FROM portfolio_improvement_chains c '
        + 'JOIN portfolio_improvement_decisions d ON d.decision_id=c.final_decision_id '
        + "WHERE c.candidate_digest=?1 AND c.state='approved'",
      ).bind(`sha256:${manifest.candidate_bundle_sha256}`).first();
      if (!admitted) return respond(409, { error: 'Approved portfolio improvement chain is unavailable' });
      let activationDecision;
      try {
        activationDecision = createActivationDecision({
          approvedDecision: JSON.parse(admitted.record_json),
          expectedGeneration,
          nowMs: Date.parse(now),
          notes,
        });
      } catch (error) {
        return respond(409, { error: error instanceof Error ? error.message : 'Invalid activation decision' });
      }
      const activationDecisionDigest = await improvementDecisionDigest(activationDecision);
      const changed = await db.prepare(
        'INSERT INTO retrieval_policy_state('
        + 'policy_id,active_version,rollback_version,manifest_id,generation,last_action,last_notes,updated,'
        + 'improvement_decision_json,improvement_decision_digest,improvement_chain_digest) '
        + "VALUES(?1,?2,?3,?4,?5,'activate',?6,?7,?8,?9,?10) ON CONFLICT(policy_id) DO UPDATE SET "
        + "active_version=excluded.active_version,rollback_version=excluded.rollback_version,manifest_id=excluded.manifest_id,generation=retrieval_policy_state.generation+1,last_action='activate',last_notes=excluded.last_notes,updated=excluded.updated,"
        + 'improvement_decision_json=excluded.improvement_decision_json,improvement_decision_digest=excluded.improvement_decision_digest,improvement_chain_digest=excluded.improvement_chain_digest '
        + 'WHERE retrieval_policy_state.active_version=?11 AND retrieval_policy_state.generation=?12',
      ).bind('ask-pie-ranking', manifest.version, manifest.rollback_to,
        promotionActivateMatch[1], expectedGeneration + 1, notes, now,
        JSON.stringify(activationDecision), activationDecisionDigest, admitted.chain_digest,
        expectedVersion, expectedGeneration).run();
      if (!changed.meta?.changes) return respond(409, { error: 'Active policy pointer changed concurrently' });
      return respond(200, {
        policy_id: 'ask-pie-ranking',
        active_version: manifest.version,
        rollback_version: manifest.rollback_to,
        generation: expectedGeneration + 1,
        manifest_sha256: manifest.manifest_sha256,
        serving_changes: true,
        rollback_available: true,
        improvement_decision_id: activationDecision.decisionId,
        improvement_decision_digest: activationDecisionDigest,
        improvement_chain_digest: admitted.chain_digest,
      });
    }
    if (path === 'policy/rollback' && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const input = await parseBody(request, 32768);
      const notes = String(input?.notes || '').trim();
      const expectedVersion = String(input?.expected_active_version || '');
      const expectedGeneration = Number(input?.expected_generation);
      if (input?.action !== 'rollback' || !notes || notes.length > 5000
        || !expectedVersion || !Number.isInteger(expectedGeneration) || expectedGeneration < 1) {
        return respond(400, { error: 'Explicit rollback, expected pointer, generation, and notes are required' });
      }
      const current = await db.prepare(
        'SELECT active_version,rollback_version,generation,improvement_decision_json,improvement_chain_digest '
        + 'FROM retrieval_policy_state WHERE policy_id=?1',
      ).bind('ask-pie-ranking').first();
      if (!current || current.active_version !== expectedVersion
        || current.generation !== expectedGeneration) {
        return respond(409, { error: 'Active policy pointer changed' });
      }
      const targetVersion = current.rollback_version;
      let targetManifestId = null;
      let nextRollback = 'lexical-subject-v2';
      if (targetVersion !== 'lexical-subject-v2') {
        const target = await db.prepare(
          "SELECT id,data FROM retrieval_policy_manifests WHERE candidate_version=?1 AND state IN ('superseded','rolled-back','active')",
        ).bind(targetVersion).first();
        if (!target) return respond(409, { error: 'Rollback manifest is unavailable' });
        const targetManifest = JSON.parse(target.data);
        const verified = await verifyPolicyManifest(
          targetManifest, env.PATTERNS_POLICY_SIGNING_SECRET || '');
        if (!verified.valid) return respond(409, { error: 'Rollback manifest signature is invalid' });
        targetManifestId = target.id;
        nextRollback = targetManifest.rollback_to;
      }
      const now = new Date().toISOString();
      if (!current.improvement_decision_json || !current.improvement_chain_digest) {
        return respond(409, { error: 'Active policy lacks its portfolio improvement activation receipt' });
      }
      let rollbackDecision;
      try {
        rollbackDecision = createRollbackDecision({
          activeDecision: JSON.parse(current.improvement_decision_json),
          expectedGeneration,
          nowMs: Date.parse(now),
          notes,
        });
      } catch (error) {
        return respond(409, { error: error instanceof Error ? error.message : 'Invalid rollback decision' });
      }
      const rollbackDecisionDigest = await improvementDecisionDigest(rollbackDecision);
      const changed = await db.prepare(
        "UPDATE retrieval_policy_state SET active_version=?1,rollback_version=?2,manifest_id=?3,generation=generation+1,last_action='rollback',last_notes=?4,updated=?5,"
        + 'improvement_decision_json=?6,improvement_decision_digest=?7,improvement_chain_digest=?8 '
        + 'WHERE policy_id=?9 AND active_version=?10 AND generation=?11',
      ).bind(targetVersion, nextRollback, targetManifestId, notes, now,
        JSON.stringify(rollbackDecision), rollbackDecisionDigest, current.improvement_chain_digest,
        'ask-pie-ranking', expectedVersion, expectedGeneration).run();
      if (!changed.meta?.changes) return respond(409, { error: 'Active policy pointer changed concurrently' });
      return respond(200, {
        policy_id: 'ask-pie-ranking',
        active_version: targetVersion,
        rollback_version: nextRollback,
        generation: expectedGeneration + 1,
        serving_changes: true,
        rolled_back_from: expectedVersion,
        improvement_decision_id: rollbackDecision.decisionId,
        improvement_decision_digest: rollbackDecisionDigest,
        improvement_chain_digest: current.improvement_chain_digest,
      });
    }
    if (path === 'policy/monitor' && request.method === 'POST') {
      const reviewAuthorized = await reviewer(request, env.PATTERNS_REVIEW_TOKEN);
      const monitorAuthorized = await reviewer(request, env.PATTERNS_MONITOR_TOKEN);
      if (!reviewAuthorized && !monitorAuthorized) {
        return respond(401, { error: 'Monitor or reviewer authorization required' });
      }
      const input = await parseBody(request, 32768);
      const action = String(input?.action || '');
      const notes = String(input?.notes || '').trim();
      if (!['evaluate', 'evaluate-and-rollback'].includes(action)
        || !notes || notes.length > 5000) {
        return respond(400, {
          error: 'A valid monitor action and concise operational note are required',
        });
      }
      const retention = await purgeExpiredOperationalData(env);
      const evaluated = await evaluateServingWindow(env, action);
      let rollback = {recommended:evaluated.report.rollback_recommended, applied:false};
      if (action === 'evaluate-and-rollback' && evaluated.report.rollback_recommended) {
        const current = evaluated.state;
        if (!current || current.active_version !== evaluated.report.evaluated_version
          || current.generation !== evaluated.report.generation) {
          return respond(409, {error:'Active policy pointer changed during monitor evaluation'});
        }
        const targetVersion = current.rollback_version;
        let targetManifestId = null;
        let nextRollback = 'lexical-subject-v2';
        if (targetVersion !== 'lexical-subject-v2') {
          const target = await db.prepare(
            "SELECT id,data FROM retrieval_policy_manifests WHERE candidate_version=?1 AND state IN ('superseded','rolled-back','active')",
          ).bind(targetVersion).first();
          if (!target) return respond(409, {error:'Automatic rollback manifest is unavailable'});
          const targetManifest = JSON.parse(target.data);
          const verified = await verifyPolicyManifest(
            targetManifest, env.PATTERNS_POLICY_SIGNING_SECRET || '');
          if (!verified.valid) {
            return respond(409, {error:'Automatic rollback manifest signature is invalid'});
          }
          targetManifestId = target.id;
          nextRollback = targetManifest.rollback_to;
        }
        const now = new Date().toISOString();
        const monitorNotes = `Automatic hard-gate rollback: ${notes}`.slice(0, 5000);
        let rollbackDecision = null;
        let rollbackDecisionDigest = null;
        if (current.improvement_decision_json && current.improvement_chain_digest) {
          try {
            rollbackDecision = createRollbackDecision({
              activeDecision: JSON.parse(current.improvement_decision_json),
              expectedGeneration: current.generation,
              nowMs: Date.parse(now),
              notes: monitorNotes,
              monitorEvidenceRef: `monitor:${evaluated.id}`,
            });
            rollbackDecisionDigest = await improvementDecisionDigest(rollbackDecision);
          } catch (error) {
            return respond(409, {error:error instanceof Error ? error.message : 'Invalid monitor rollback decision'});
          }
        }
        const changed = await db.prepare(
          "UPDATE retrieval_policy_state SET active_version=?1,rollback_version=?2,manifest_id=?3,generation=generation+1,last_action='rollback',last_notes=?4,updated=?5,"
          + 'improvement_decision_json=?6,improvement_decision_digest=?7,improvement_chain_digest=?8 '
          + 'WHERE policy_id=?9 AND active_version=?10 AND generation=?11',
        ).bind(targetVersion, nextRollback, targetManifestId, monitorNotes, now,
          rollbackDecision ? JSON.stringify(rollbackDecision) : null,
          rollbackDecisionDigest, current.improvement_chain_digest || null,
          'ask-pie-ranking', current.active_version, current.generation).run();
        if (!changed.meta?.changes) {
          return respond(409, {error:'Active policy pointer changed concurrently'});
        }
        rollback = {
          recommended:true, applied:true, from_version:current.active_version,
          to_version:targetVersion, generation:current.generation + 1,
          improvement_decision_id:rollbackDecision?.decisionId || null,
          improvement_decision_digest:rollbackDecisionDigest,
          improvement_chain_digest:current.improvement_chain_digest || null,
        };
      }
      return respond(200, {
        evaluation_id: evaluated.id,
        evaluation: evaluated.report,
        rollback,
        retention,
        automatic_promotion: false,
      });
    }
    if (path === 'policy/monitor' && request.method === 'GET') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const result = await db.prepare(
        'SELECT id,evaluated_version,generation,rollback_recommended,requested_action,data,created '
        + 'FROM retrieval_policy_monitor_evaluations ORDER BY created DESC LIMIT 100',
      ).all();
      return respond(200, {
        evaluations: result.results.map(row => ({
          id:row.id, evaluated_version:row.evaluated_version, generation:row.generation,
          rollback_recommended:Boolean(row.rollback_recommended),
          requested_action:row.requested_action, created:row.created,
          data:JSON.parse(row.data),
        })),
        automatic_promotion: false,
      });
    }
    if (path === 'maintenance/retention' && request.method === 'POST') {
      const reviewAuthorized = await reviewer(request, env.PATTERNS_REVIEW_TOKEN);
      const monitorAuthorized = await reviewer(request, env.PATTERNS_MONITOR_TOKEN);
      if (!reviewAuthorized && !monitorAuthorized) {
        return respond(401, {error:'Monitor or reviewer authorization required'});
      }
      const input = await parseBody(request, 32768);
      if (input?.action !== 'purge-expired') {
        return respond(400, {error:'Explicit purge-expired action is required'});
      }
      return respond(200, {
        ...(await purgeExpiredOperationalData(env)),
        candidate_registry_deleted:false,
        policy_transition_history_deleted:false,
      });
    }
    if (path === 'policy/status' && request.method === 'GET') {
      const active = await loadActiveRetrievalPolicy(env, 'research-index-v1');
      return respond(200, {...active.receipt, parameters_exposed: false});
    }
    if (path === 'policy/transitions' && request.method === 'GET') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const result = await db.prepare(
        'SELECT policy_id,from_version,to_version,action,generation,manifest_id,notes,created,'
        + 'improvement_decision_digest,improvement_chain_digest '
        + 'FROM retrieval_policy_transitions ORDER BY id DESC LIMIT 100',
      ).all();
      return respond(200, {
        transitions: result.results,
        improvement_contract: 'patterns.improvement-decision.v1',
        authorizes_action: false,
      });
    }
    if (path === 'feedback' && request.method === 'POST') {
      if (!feedbackOriginAllowed(request)) return respond(403, { error: 'Same-origin feedback required' });
      const rateResponse = rateLimitResponse(
        await consumeIngressRateLimit(request, env, 'feedback'));
      if (rateResponse) return rateResponse;
      const feedback = cleanRetrievalFeedback(await parseBody(request, 32768));
      const activePolicy = await loadActiveRetrievalPolicy(env, 'research-index-v1');
      if (feedback.policy_version !== activePolicy.receipt.version) {
        return respond(409, { error: 'Feedback policy version is not the currently served policy' });
      }
      const stored = await recordRetrievalFeedback(env, feedback);
      if (stored.conflict) return respond(409, { error: 'Feedback id was already used for different data' });
      return respond(202, {
        received: true,
        event_id: stored.eventId,
        query_id: stored.queryId,
        signal_quality: feedback.signal_quality,
        automatic_promotion: false,
      });
    }
    if (path === 'feedback' && request.method === 'GET') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const result = await db.prepare(
        "SELECT e.id,e.entity_id,e.data,e.created,(SELECT d.data FROM evidence_events d WHERE d.entity_type='feedback' AND d.entity_id=e.id AND d.event_type='reviewer-disposition' ORDER BY d.created DESC,d.rowid DESC LIMIT 1) disposition FROM evidence_events e WHERE e.entity_type='retrieval' AND e.event_type='retrieval-feedback' ORDER BY e.created DESC,e.id DESC LIMIT 1000",
      ).all();
      return respond(200, {
        automatic_promotion: false,
        limit: 1000,
        truncated: result.results.length === 1000,
        feedback: result.results.map(row => ({
          id: row.id,
          query_id: row.entity_id,
          created: row.created,
          data: JSON.parse(row.data),
          disposition: row.disposition ? JSON.parse(row.disposition) : null,
        })),
      });
    }
    const feedbackMatch = path.match(/^feedback\/([0-9a-f]{24})$/);
    if (feedbackMatch && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const input = await parseBody(request, 32768);
      const notes = String(input?.notes || '').trim();
      if (!RETRIEVAL_REVIEW_ACTIONS.has(input?.action) || !notes || notes.length > 5000) {
        return respond(400, { error: 'A valid feedback disposition and concise reviewer note are required' });
      }
      const feedback = await db.prepare(
        "SELECT id FROM evidence_events WHERE id=?1 AND entity_type='retrieval' AND event_type='retrieval-feedback'",
      ).bind(feedbackMatch[1]).first();
      if (!feedback) return respond(404, { error: 'Retrieval feedback not found' });
      const disposition = { action: input.action, notes, reviewed_at: new Date().toISOString() };
      const eventId = await recordEvent(env, 'feedback', feedback.id, 'reviewer-disposition', disposition);
      return respond(200, { id: feedback.id, event_id: eventId, disposition, automatic_promotion: false });
    }
    if (path === 'runs' && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      if (!env.OPENAI_API_KEY) return respond(503, { error: 'Live research provider is not configured' });
      const input = await parseBody(request, 220000);
      const spec = cleanSpec(input.spec);
      const jobs = await startResearchRun(env, spec, input.requests);
      return respond(202, { id: spec.id, state: 'researching', jobs });
    }
    if (path === 'webhooks/openai' && request.method === 'POST') {
      return handleWebhook(request, env, context);
    }
    if (path === 'exceptions' && request.method === 'GET') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const result = await db.prepare(
        "SELECT d.id,d.claim_id,d.publication_state,d.data,d.created,s.data spec_data,(SELECT e.data FROM evidence_events e WHERE e.entity_type='decision' AND e.entity_id=d.id AND e.event_type='reviewer-disposition' ORDER BY e.created DESC LIMIT 1) disposition FROM evidence_decisions d JOIN research_specs s ON s.id=d.spec_id WHERE d.human_intervention=1 ORDER BY d.created DESC LIMIT 100",
      ).all();
      return respond(200, { exceptions: result.results.map(row => ({
        id: row.id,
        claim_id: row.claim_id,
        publication_state: row.publication_state,
        created: row.created,
        data: JSON.parse(row.data),
        spec: JSON.parse(row.spec_data),
        disposition: row.disposition ? JSON.parse(row.disposition) : null,
      })) });
    }
    const exceptionMatch = path.match(/^exceptions\/([0-9a-f]{24})$/);
    if (exceptionMatch && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const input = await parseBody(request, 32768);
      const allowed = new Set(['accept-proposal', 'reject-proposal', 'needs-field-evidence', 'defer']);
      const notes = String(input?.notes || '').trim();
      if (!allowed.has(input?.action) || !notes || notes.length > 5000) {
        return respond(400, { error: 'A valid disposition and concise reviewer note are required' });
      }
      const decision = await db.prepare(
        'SELECT id FROM evidence_decisions WHERE id=?1 AND human_intervention=1',
      ).bind(exceptionMatch[1]).first();
      if (!decision) return respond(404, { error: 'Evidence exception not found' });
      const disposition = { action: input.action, notes };
      const eventId = await recordEvent(env, 'decision', decision.id, 'reviewer-disposition', disposition);
      return respond(200, { id: decision.id, event_id: eventId, disposition });
    }
    if (path === 'eligible' && request.method === 'GET') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const result = await db.prepare(
        'SELECT d.id,d.claim_id,d.data,d.created,s.data spec_data FROM evidence_decisions d JOIN research_specs s ON s.id=d.spec_id WHERE d.publish_eligible=1 ORDER BY d.created DESC LIMIT 100',
      ).all();
      return respond(200, { automatic_publication: false, eligible: result.results.map(row => ({
        id: row.id, claim_id: row.claim_id, created: row.created,
        decision: JSON.parse(row.data), spec: JSON.parse(row.spec_data),
      })) });
    }
    return respond(404, { error: 'Autonomy route unavailable' });
  } catch (error) {
    const message = error?.message || '';
    if (/Invalid|too large|JSON/i.test(message)) return respond(400, { error: message });
    return respond(503, { error: 'Autonomous evidence operation failed closed' });
  }
}

export default { fetch: handlePatternsAutonomy };
