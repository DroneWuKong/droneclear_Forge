import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVENT_PROJECTION_LIMITS,
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
      candidate_event_cluster_count: 4,
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
  const projected = projectArticleEventClusters(fixture(), params({ view: 'summary' }));
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

test('non-event datasets are returned unchanged', () => {
  const value = { meta: { generated_at: '2026-07-31T12:00:00Z' }, rows: [1] };
  assert.equal(projectDataset(value, 'threat_scores', params()), value);
});
