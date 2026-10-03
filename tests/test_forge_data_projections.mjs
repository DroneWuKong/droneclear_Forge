import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVENT_PROJECTION_LIMITS,
  articleEventPublicationErrors,
  intelligenceAdvisoryPublicationErrors,
  projectArticleEventClusters,
  projectDataset,
} from '../workers/forge-data-projections.mjs';

function params(values = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) query.set(key, String(value));
  return query;
}

function fixture() {
  return {
    meta: {
      generated_at: '2026-07-31T12:00:00Z',
      generator: 'services/pipeline/article_event_clusters_quality.py',
      version: '1.1',
      candidate_event_cluster_count: 4,
      quality_controls: {
        shared_url_requires_title_and_time_agreement: true,
        same_source_shared_url_different_title_merge_allowed: false,
        same_single_source_candidate_pair_allowed: false,
        largest_serialized_reporting_cluster_span_days: 5,
        largest_serialized_candidate_event_span_days: 3,
        largest_serialized_reporting_cluster_articles: 12,
        largest_serialized_candidate_event_articles: 9,
      },
    },
    actor_summary: [
      {
        actor: 'Actor A',
        article_mention_count: 9,
        reporting_cluster_count: 6,
        candidate_event_count: 3,
        multi_source_candidate_event_count: 1,
      },
      {
        actor: 'Actor B',
        article_mention_count: 3,
        reporting_cluster_count: 2,
        candidate_event_count: 1,
        multi_source_candidate_event_count: 0,
      },
    ],
    duplicate_reporting_clusters: [{ reporting_cluster_id: 'RPT-1' }],
    candidate_events: [
      {
        candidate_event_id: 'EVT-older',
        publication_end: '2026-07-28T00:00:00Z',
        actors_mentioned: ['Actor A'],
      },
      {
        candidate_event_id: 'EVT-newest',
        publication_end: '2026-07-31T00:00:00Z',
        actors_mentioned: ['Actor A', 'Actor B'],
      },
      {
        candidate_event_id: 'EVT-middle',
        publication_end: '2026-07-30T00:00:00Z',
        actors_mentioned: ['Actor A'],
      },
      {
        candidate_event_id: 'EVT-other',
        publication_end: '2026-07-29T00:00:00Z',
        actors_mentioned: ['Actor C'],
      },
    ],
  };
}

test('summary view omits heavy event and duplicate arrays', () => {
  const projected = projectDataset(
    fixture(),
    'article_event_clusters',
    params({ view: 'summary' }),
  );
  assert.equal(projected.actor_summary.length, 2);
  assert.equal(projected.query.candidate_event_count, 4);
  assert.equal(projected.query.serialized_candidate_event_count, 4);
  assert.equal('candidate_events' in projected, false);
  assert.equal('duplicate_reporting_clusters' in projected, false);
});

test('actor view filters, sorts, and paginates exact actor mentions', () => {
  const projected = projectArticleEventClusters(
    fixture(),
    params({ actor: 'Actor A', offset: 1, limit: 1 }),
  );
  assert.deepEqual(
    projected.candidate_events.map((row) => row.candidate_event_id),
    ['EVT-middle'],
  );
  assert.equal(projected.actor_summary[0].actor, 'Actor A');
  assert.equal(projected.query.total_candidate_event_count, 3);
  assert.equal(projected.query.returned_event_count, 1);
  assert.equal(projected.query.has_more, true);
});

test('actor matching is exact and cannot leak adjacent actor names', () => {
  const value = fixture();
  value.candidate_events.push({
    candidate_event_id: 'EVT-prefix',
    publication_end: '2026-07-31T01:00:00Z',
    actors_mentioned: ['Actor Alpha'],
  });
  const projected = projectArticleEventClusters(
    value,
    params({ actor: 'Actor A' }),
  );
  assert.equal(
    projected.candidate_events.some((row) => row.candidate_event_id === 'EVT-prefix'),
    false,
  );
});

test('event-id view returns one exact event and metadata', () => {
  const projected = projectArticleEventClusters(
    fixture(),
    params({ event_id: 'EVT-newest' }),
  );
  assert.equal(projected.candidate_event.candidate_event_id, 'EVT-newest');
  assert.equal(projected.query.found, true);
});

test('event limits are bounded against abusive response requests', () => {
  const projected = projectArticleEventClusters(
    fixture(),
    params({ actor: 'Actor A', limit: 999999 }),
  );
  assert.equal(projected.query.limit, EVENT_PROJECTION_LIMITS.maximum);
});

test('publication controls accept the hardened event artifact', () => {
  assert.deepEqual(articleEventPublicationErrors(fixture()), []);
});

test('unsafe v1 event artifacts are withheld before projection', () => {
  const value = fixture();
  value.meta.version = '1.0';
  value.meta.generator = 'services/pipeline/article_event_clusters.py';
  value.meta.quality_controls.same_source_shared_url_different_title_merge_allowed = true;
  assert.throws(
    () => projectDataset(value, 'article_event_clusters', params({ view: 'summary' })),
    /failed publication controls/,
  );
});

test('oversized or overlong clusters fail publication controls', () => {
  const value = fixture();
  value.meta.quality_controls.largest_serialized_reporting_cluster_articles = 2399;
  value.meta.quality_controls.largest_serialized_reporting_cluster_span_days = 118;
  const errors = articleEventPublicationErrors(value);
  assert.ok(errors.some((error) => error.includes('article-count ceiling')));
  assert.ok(errors.some((error) => error.includes('five-day')));
});

test('non-event datasets are returned unchanged', () => {
  const value = { meta: { generated_at: '2026-07-31T12:00:00Z' }, rows: [1] };
  assert.equal(projectDataset(value, 'threat_scores', params()), value);
});

function intelligenceAdvisoryFixture() {
  return {
    schema_version: 'forge.intelligence-advisory.v1',
    generated_at: '2026-09-27T13:00:00Z',
    advisory_count: 1,
    publication_controls: {
      human_review_required: true,
      source_evidence_required: true,
      execution_authority_prohibited: true,
      readiness_authority_prohibited: true,
    },
    advisories: [{
      advisory_id: 'adv-esc-example-1', revision: 1, status: 'ACTIVE',
      title: 'Review affected ESC lot', summary: 'Review installed components.',
      category: 'SAFETY', observed_at: '2026-09-26T12:00:00Z',
      reviewed_at: '2026-09-27T12:00:00Z', expires_at: null,
      confidence: 0.82, confidence_basis: 'Primary notice plus analyst matching.',
      sources: [{
        source_id: 'source-notice-1', url: 'https://example.invalid/notice/1',
        title: 'Manufacturer notice', publisher: 'Example Manufacturer',
        published_at: '2026-09-26T11:00:00Z', retrieved_at: '2026-09-26T13:00:00Z',
      }],
      affected_selectors: [{ kind: 'PART_NUMBER', value: 'ESC-42', match: 'EXACT' }],
      recommended_action: 'INSPECT',
      recommended_action_rationale: 'Confirm the installed lot before flight.',
      reviewer_id: 'analyst-example-1', review_decision_ref: 'review:example-1',
      requires_human_review: true, authorizes_execution: false,
      authorizes_readiness_change: false,
      advisory_digest: `sha256:${'a'.repeat(64)}`,
    }],
  };
}

test('reviewed intelligence advisories pass the public non-authorizing gate', () => {
  const value = intelligenceAdvisoryFixture();
  assert.deepEqual(intelligenceAdvisoryPublicationErrors(value), []);
  assert.equal(projectDataset(value, 'intelligence_advisories', params()), value);
});

test('authority-bearing or source-free advisories are withheld', () => {
  const authority = intelligenceAdvisoryFixture();
  authority.advisories[0].authorizes_readiness_change = true;
  assert.ok(intelligenceAdvisoryPublicationErrors(authority).some((error) => error.includes('non-authorizing')));
  const sourceFree = intelligenceAdvisoryFixture();
  sourceFree.advisories[0].sources = [];
  assert.throws(
    () => projectDataset(sourceFree, 'intelligence_advisories', params()),
    /failed publication controls/,
  );
  const expired = intelligenceAdvisoryFixture();
  expired.advisories[0].expires_at = expired.generated_at;
  assert.ok(intelligenceAdvisoryPublicationErrors(expired).some((error) => error.includes('expiry')));
});
