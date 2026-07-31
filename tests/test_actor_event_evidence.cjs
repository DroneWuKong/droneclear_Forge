const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const evidence = require('../forge-source/actor-event-evidence.js');

function meta(overrides = {}) {
  return {
    version: '1.1',
    quality_controls: {
      shared_url_requires_title_and_time_agreement: true,
      same_source_shared_url_different_title_merge_allowed: false,
      same_single_source_candidate_pair_allowed: false,
      largest_serialized_reporting_cluster_span_days: 5,
      largest_serialized_candidate_event_span_days: 3,
    },
    ...overrides,
  };
}

function actorPageHtml() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'forge-source', 'actors.html'),
    'utf8',
  );
}

test('actor summaries preserve the four distinct public units', () => {
  const index = evidence.indexActorSummaries([
    {
      actor: 'Actor A',
      article_mention_count: 12,
      reporting_cluster_count: 8,
      candidate_event_count: 3,
      multi_source_candidate_event_count: 1,
      semantics: 'mentions, not attribution',
    },
  ]);
  assert.deepEqual(evidence.summaryFor(index, 'Actor A'), {
    actor: 'Actor A',
    article_mention_count: 12,
    reporting_cluster_count: 8,
    candidate_event_count: 3,
    multi_source_candidate_event_count: 1,
    semantics: 'mentions, not attribution',
  });
  assert.equal(evidence.summaryFor(index, 'Missing').candidate_event_count, 0);
});

test('actor event filtering is exact and newest-first', () => {
  const rows = [
    {
      candidate_event_id: 'old',
      publication_end: '2026-07-20',
      actors_mentioned: ['Actor A'],
    },
    {
      candidate_event_id: 'new',
      publication_end: '2026-07-30',
      actors_mentioned: ['Actor A', 'Actor B'],
    },
    {
      candidate_event_id: 'adjacent',
      publication_end: '2026-07-31',
      actors_mentioned: ['Actor Alpha'],
    },
  ];
  assert.deepEqual(
    evidence.eventsForActor(rows, 'Actor A').map((row) => row.candidate_event_id),
    ['new', 'old'],
  );
});

test('actor query encodes the name and bounds the client limit', () => {
  const query = evidence.actorQuery('Russia / Mil', 12, 999);
  const parsed = new URL(query, 'https://uas-patterns.com');
  assert.equal(parsed.searchParams.get('actor'), 'Russia / Mil');
  assert.equal(parsed.searchParams.get('offset'), '12');
  assert.equal(parsed.searchParams.get('limit'), '100');
});

test('publication metadata validation accepts hardened controls', () => {
  assert.deepEqual(evidence.validatePublicationMeta(meta()), []);
});

test('publication metadata validation rejects v1 and missing source guards', () => {
  const errors = evidence.validatePublicationMeta({
    version: '1.0',
    quality_controls: {
      shared_url_requires_title_and_time_agreement: false,
      same_source_shared_url_different_title_merge_allowed: true,
      same_single_source_candidate_pair_allowed: true,
      largest_serialized_reporting_cluster_span_days: 120,
      largest_serialized_candidate_event_span_days: 90,
    },
  });
  assert.ok(errors.some((error) => error.includes('version')));
  assert.ok(errors.some((error) => error.includes('rolling-URL')));
  assert.ok(errors.some((error) => error.includes('candidate-event guard')));
  assert.ok(errors.some((error) => error.includes('five-day')));
  assert.ok(errors.some((error) => error.includes('three-day')));
});

test('unsafe evidence URLs are withheld', () => {
  assert.equal(evidence.safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(evidence.safeHttpUrl('data:text/html,x'), '');
  assert.equal(evidence.safeHttpUrl('https://example.test/evidence'), 'https://example.test/evidence');
});

test('actor page states event semantics and loads projected evidence', () => {
  const html = actorPageHtml();
  for (const marker of [
    'Duplicate-adjusted reporting and candidate events',
    'Duplicate-adjusted reporting groups',
    'Candidate-event clusters',
    'Multi-site candidates',
    "loadDataset('article_event_clusters', {view:'summary'})",
    "loadDataset('article_event_clusters', {actor:actor",
    'not confirmed incidents, attribution, or proof',
    'site diversity is only a proxy',
    'one repeated source is not corroboration',
  ]) {
    assert.ok(html.includes(marker), `missing actor-page marker: ${marker}`);
  }
  assert.equal(html.includes('site labels are independent sources'), false);
  assert.equal(html.includes('candidate events are confirmed incidents'), false);
});

test('actor page inline scripts are syntactically valid JavaScript', () => {
  const html = actorPageHtml();
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  assert.ok(scripts.length >= 1);
  for (const [index, source] of scripts.entries()) {
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: `actors-inline-${index}.js` }),
    );
  }
});

test('worker allowlists, validates, and freshness-gates event evidence', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'workers', 'forge-data.js'),
    'utf8',
  );
  const projection = fs.readFileSync(
    path.join(__dirname, '..', 'workers', 'forge-data-projections.mjs'),
    'utf8',
  );
  assert.ok(source.includes("['article_event_clusters', 72 * 60 * 60 * 1000]"));
  assert.ok(source.includes("'article_event_clusters'"));
  assert.ok(source.includes('projectDataset(data, type, params)'));
  assert.ok(source.includes("'dataset_catalog'"));
  assert.ok(projection.includes('articleEventPublicationErrors'));
  assert.ok(projection.includes('DATASET_PUBLICATION_CONTROL'));
});
