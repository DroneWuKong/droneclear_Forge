import research from '../forge-source/ask-pie-retrieval.js';
import { projectDailyChanges } from './patterns-daily-projection.mjs';
const DEFAULT_EVENT_LIMIT = 20;
const MAX_EVENT_LIMIT = 100;
const MAX_REPORTING_SPAN_DAYS = 5.01;
const MAX_EVENT_SPAN_DAYS = 3.01;
const MAX_REPORTING_CLUSTER_ARTICLES = 250;
const MAX_EVENT_CLUSTER_ARTICLES = 400;

function integerParam(params, name, fallback, minimum, maximum) {
  const raw = params && typeof params.get === 'function' ? params.get(name) : null;
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizedActor(value) {
  return String(value || '').trim();
}

function eventDateValue(event) {
  const raw = event && (event.publication_end || event.publication_start);
  const parsed = Date.parse(raw || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortEventsNewestFirst(events) {
  return [...events].sort((left, right) => {
    const dateDifference = eventDateValue(right) - eventDateValue(left);
    if (dateDifference) return dateDifference;
    return String(left.candidate_event_id || '').localeCompare(
      String(right.candidate_event_id || ''),
    );
  });
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const INTELLIGENCE_ADVISORY_FIELDS = [
  'advisory_id', 'revision', 'status', 'title', 'summary', 'category',
  'observed_at', 'reviewed_at', 'expires_at', 'confidence',
  'confidence_basis', 'sources', 'affected_selectors', 'recommended_action',
  'recommended_action_rationale', 'reviewer_id', 'review_decision_ref',
  'requires_human_review', 'authorizes_execution',
  'authorizes_readiness_change', 'advisory_digest',
].sort();
const INTELLIGENCE_ADVISORY_CATEGORIES = new Set([
  'SAFETY', 'SECURITY', 'SUPPLY_CHAIN', 'REGULATORY', 'RELIABILITY',
]);
const INTELLIGENCE_ADVISORY_ACTIONS = new Set([
  'REVIEW', 'INSPECT', 'HOLD', 'REPLACE', 'UPDATE',
]);
const INTELLIGENCE_ADVISORY_SELECTOR_KINDS = new Set([
  'PART_NUMBER', 'MANUFACTURER', 'MODEL', 'FIRMWARE',
  'COMPONENT_CATEGORY', 'BUILD_TAG',
]);

export function intelligenceAdvisoryPublicationErrors(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['intelligence advisory artifact must be a JSON object'];
  }
  const errors = [];
  if (data.schema_version !== 'forge.intelligence-advisory.v1') {
    errors.push('schema_version must be forge.intelligence-advisory.v1');
  }
  if (!Number.isFinite(Date.parse(data.generated_at || ''))) {
    errors.push('generated_at must be an ISO-8601 timestamp');
  }
  const controls = data.publication_controls;
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)
    || controls.human_review_required !== true
    || controls.source_evidence_required !== true
    || controls.execution_authority_prohibited !== true
    || controls.readiness_authority_prohibited !== true) {
    errors.push('publication controls must require review and prohibit authority');
  }
  if (!Array.isArray(data.advisories)) {
    errors.push('advisories must be a list');
    return errors;
  }
  if (!Number.isInteger(data.advisory_count) || data.advisory_count !== data.advisories.length) {
    errors.push('advisory_count must reconcile with advisories');
  }
  const identities = new Set();
  for (const [index, advisory] of data.advisories.entries()) {
    const label = `advisories[${index}]`;
    if (!advisory || typeof advisory !== 'object' || Array.isArray(advisory)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const keys = Object.keys(advisory).sort();
    if (keys.length !== INTELLIGENCE_ADVISORY_FIELDS.length
      || keys.some((key, keyIndex) => key !== INTELLIGENCE_ADVISORY_FIELDS[keyIndex])) {
      errors.push(`${label} contains missing or unknown fields`);
    }
    const identity = `${String(advisory.advisory_id)}:${String(advisory.revision)}`;
    if (identities.has(identity)) errors.push(`${label} duplicates an advisory id and revision`);
    identities.add(identity);
    if (typeof advisory.advisory_id !== 'string' || advisory.advisory_id.length < 3
      || !Number.isInteger(advisory.revision) || advisory.revision < 1
      || advisory.status !== 'ACTIVE') {
      errors.push(`${label} identity, revision, or status is invalid`);
    }
    if (!INTELLIGENCE_ADVISORY_CATEGORIES.has(advisory.category)
      || !INTELLIGENCE_ADVISORY_ACTIONS.has(advisory.recommended_action)) {
      errors.push(`${label} classification is unsupported`);
    }
    const observedAt = Date.parse(advisory.observed_at || '');
    const reviewedAt = Date.parse(advisory.reviewed_at || '');
    const generatedAt = Date.parse(data.generated_at || '');
    const expiresAt = advisory.expires_at === null ? null : Date.parse(advisory.expires_at || '');
    if (!Number.isFinite(observedAt) || !Number.isFinite(reviewedAt) || observedAt > reviewedAt) {
      errors.push(`${label} observation and review times are invalid`);
    }
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= reviewedAt || expiresAt <= generatedAt)) {
      errors.push(`${label} active expiry is invalid or already elapsed`);
    }
    if (!Number.isFinite(advisory.confidence) || advisory.confidence < 0 || advisory.confidence > 1) {
      errors.push(`${label} confidence must be between zero and one`);
    }
    if (!Array.isArray(advisory.sources) || advisory.sources.length === 0
      || advisory.sources.some((source) => !source || typeof source !== 'object'
        || typeof source.url !== 'string' || !source.url
        || typeof source.source_id !== 'string' || !source.source_id
        || !Number.isFinite(Date.parse(source.published_at || ''))
        || !Number.isFinite(Date.parse(source.retrieved_at || ''))
        || Date.parse(source.published_at) > Date.parse(source.retrieved_at))) {
      errors.push(`${label} requires attributable source evidence`);
    }
    if (!Array.isArray(advisory.affected_selectors) || advisory.affected_selectors.length === 0
      || advisory.affected_selectors.some((selector) => !selector || typeof selector !== 'object'
        || !INTELLIGENCE_ADVISORY_SELECTOR_KINDS.has(selector.kind)
        || !['EXACT', 'PREFIX'].includes(selector.match)
        || typeof selector.value !== 'string' || !selector.value)) {
      errors.push(`${label} requires supported affected selectors`);
    }
    if (advisory.requires_human_review !== true
      || advisory.authorizes_execution !== false
      || advisory.authorizes_readiness_change !== false) {
      errors.push(`${label} violates the non-authorizing review boundary`);
    }
    if (typeof advisory.reviewer_id !== 'string' || !advisory.reviewer_id
      || typeof advisory.review_decision_ref !== 'string' || !advisory.review_decision_ref
      || !/^sha256:[0-9a-f]{64}$/.test(String(advisory.advisory_digest || ''))) {
      errors.push(`${label} lacks a review decision or content digest`);
    }
  }
  return errors;
}

export function articleEventPublicationErrors(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['event artifact must be a JSON object'];
  }
  const meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  const controls =
    meta.quality_controls && typeof meta.quality_controls === 'object'
      ? meta.quality_controls
      : {};
  const errors = [];
  if (String(meta.version || '') !== '1.1') {
    errors.push(`event artifact version must be 1.1; got ${String(meta.version || 'missing')}`);
  }
  if (
    String(meta.generator || '') !==
    'services/pipeline/article_event_clusters_quality.py'
  ) {
    errors.push('event artifact was not generated by the hardened quality path');
  }
  if (controls.shared_url_requires_title_and_time_agreement !== true) {
    errors.push('shared-URL title/time agreement control is missing');
  }
  if (
    controls.same_source_shared_url_different_title_merge_allowed !== false
  ) {
    errors.push('same-source rolling-URL control is missing');
  }
  if (controls.same_single_source_candidate_pair_allowed !== false) {
    errors.push('same-source candidate-event control is missing');
  }
  if (
    finiteNumber(controls.largest_serialized_reporting_cluster_span_days) >
    MAX_REPORTING_SPAN_DAYS
  ) {
    errors.push('a reporting cluster exceeds the five-day publication ceiling');
  }
  if (
    finiteNumber(controls.largest_serialized_candidate_event_span_days) >
    MAX_EVENT_SPAN_DAYS
  ) {
    errors.push('a candidate event exceeds the three-day publication ceiling');
  }
  if (
    finiteNumber(controls.largest_serialized_reporting_cluster_articles) >
    MAX_REPORTING_CLUSTER_ARTICLES
  ) {
    errors.push('a reporting cluster exceeds the article-count ceiling');
  }
  if (
    finiteNumber(controls.largest_serialized_candidate_event_articles) >
    MAX_EVENT_CLUSTER_ARTICLES
  ) {
    errors.push('a candidate event exceeds the article-count ceiling');
  }
  if (!Array.isArray(data.actor_summary)) {
    errors.push('event artifact actor_summary must be a list');
  }
  if (!Array.isArray(data.candidate_events)) {
    errors.push('event artifact candidate_events must be a list');
  }
  return errors;
}

export function validateDatasetForPublication(data, type) {
  if (type === 'intelligence_advisories') {
    return intelligenceAdvisoryPublicationErrors(data);
  }
  const schema = {forecast_review_queue:'forecast-review-queue-v1',code_evolution_review_queue:'code-evolution-review-queue-v1',analytic_judgments:'analytic-judgments-v1'}[type];
  if (schema) {
    const errors=[];
    if (!data || Array.isArray(data) || data.schema_version !== schema) errors.push(`schema_version must be ${schema}`);
    if (!Array.isArray(data?.records) || data.records.some(row=>!row || typeof row !== 'object' || Array.isArray(row))) errors.push('records must be a list of objects');
    if (type === 'forecast_review_queue') {
      if (!data?.counts || typeof data.counts !== 'object' || Array.isArray(data.counts) || Object.values(data.counts).some(count=>!Number.isInteger(count)||count<0)) errors.push('queue counts must be nonnegative integers');
      else if (Array.isArray(data.records) && Object.values(data.counts).reduce((sum,count)=>sum+count,0) !== data.records.length) errors.push('queue counts must reconcile with records');
    }
    if (type === 'code_evolution_review_queue') {
      const hash = /^[a-f0-9]{64}$/;
      if (data?.read_only !== true || data?.human_decision_required !== true) errors.push('code review queue authority boundary is invalid');
      if (!hash.test(data?.queue_sha256 || '') || !Number.isFinite(Date.parse(data?.generated_at || ''))) errors.push('code review queue identity is invalid');
      if (!data?.counts || Object.keys(data.counts).length !== 1 || !Number.isInteger(data.counts.needs_review) || data.counts.needs_review < 0) errors.push('code review queue count is invalid');
      else if (Array.isArray(data.records) && data.counts.needs_review !== data.records.length) errors.push('code review queue count must reconcile with records');
      if (Array.isArray(data?.records) && data.records.some(row=>row.state !== 'needs_review' || !hash.test(row.evaluation_sha256 || '') || !hash.test(row.candidate_sha256 || '') || !/^[a-f0-9]{40,64}$/.test(row.base_commit || '') || !Array.isArray(row.paths) || !row.paths.length || row.pull_request_eligible !== true || row.promotion_eligible !== false || row.automatic_merge !== false || row.automatic_deploy !== false || row.serving_changes !== false)) errors.push('code review record authority boundary is invalid');
    }
    return errors;
  }
  if (type === 'article_event_clusters') {
    return articleEventPublicationErrors(data);
  }
  return [];
}

export function projectArticleEventClusters(data, params) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const actor = normalizedActor(params && params.get ? params.get('actor') : '');
  const eventId = String(params && params.get ? params.get('event_id') || '' : '').trim();
  const view = String(params && params.get ? params.get('view') || '' : '').trim().toLowerCase();
  const meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  const summaries = Array.isArray(data.actor_summary) ? data.actor_summary : [];
  const events = Array.isArray(data.candidate_events) ? data.candidate_events : [];

  if (eventId) {
    const event = events.find(
      (row) => row && row.candidate_event_id === eventId,
    ) || null;
    return {
      meta,
      candidate_event: event,
      query: {
        event_id: eventId,
        found: Boolean(event),
      },
    };
  }

  if (actor) {
    const offset = integerParam(params, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = integerParam(
      params,
      'limit',
      DEFAULT_EVENT_LIMIT,
      1,
      MAX_EVENT_LIMIT,
    );
    const matching = sortEventsNewestFirst(
      events.filter(
        (event) =>
          event &&
          Array.isArray(event.actors_mentioned) &&
          event.actors_mentioned.includes(actor),
      ),
    );
    const summary = summaries.find(
      (row) => row && row.actor === actor,
    ) || null;
    return {
      meta,
      actor_summary: summary ? [summary] : [],
      candidate_events: matching.slice(offset, offset + limit),
      query: {
        actor,
        offset,
        limit,
        returned_event_count: Math.max(
          0,
          Math.min(limit, matching.length - offset),
        ),
        total_candidate_event_count: matching.length,
        has_more: offset + limit < matching.length,
      },
    };
  }

  if (view === 'summary') {
    return {
      meta,
      actor_summary: summaries,
      query: {
        view: 'summary',
        candidate_event_count:
          Number(meta.candidate_event_cluster_count) || events.length,
        serialized_candidate_event_count: events.length,
      },
    };
  }

  if (view === 'method') {
    return {
      meta,
      query: { view: 'method' },
    };
  }

  return data;
}

export function projectDataset(data, type, params, options = {}) {
  const errors = validateDatasetForPublication(data, type);
  if (errors.length) {
    const error = new Error(
      `Dataset ${type} failed publication controls: ${errors.join('; ')}`,
    );
    error.code = 'DATASET_PUBLICATION_CONTROL';
    error.validationErrors = errors;
    throw error;
  }
  if (type === 'research_index') return research.projectResearch(data, params, {
    retrievalPolicy: options.retrievalPolicy,
    policyReceipt: options.policyReceipt,
  });
  if (type === 'daily_changes') return projectDailyChanges(data, params);
  if (type === 'intel_articles' && (params.get('record_id') || params.get('record_key'))) {
    const rows = Array.isArray(data) ? data : data.articles || [];
    const matches = rows.filter(row => params.get('record_key') ? research.recordKey(research.articleRecords([row])[0]) === params.get('record_key') : String(row.aid || row.id || research.stableId(row)) === params.get('record_id'));
    return {record_status:matches.length === 1 ? 'found' : matches.length ? 'ambiguous' : 'missing', record:matches.length === 1 ? {...research.publicRecord(research.compactRecord(research.articleRecords(matches)[0])), body_excerpt:String(matches[0].body_text || matches[0].summary || '').slice(0, 16000)} : null};
  }
  if (type === 'article_event_clusters') {
    return projectArticleEventClusters(data, params);
  }
  return data;
}

export const EVENT_PROJECTION_LIMITS = Object.freeze({
  default: DEFAULT_EVENT_LIMIT,
  maximum: MAX_EVENT_LIMIT,
});
