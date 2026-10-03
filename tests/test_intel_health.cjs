const assert = require('node:assert/strict');
const test = require('node:test');
const health = require('../forge-source/intel-health.js');

const NOW = new Date('2026-10-02T20:00:00Z');

function fixture() {
  return {
    data: {
      timestamp: '2026-10-02T19:00:00Z', run: 285, total: 120,
      miners: { registered: 2, active: 2 },
      collector_status: { alpha: 'ok', beta: 'error' },
      source_status: { alpha: 'ok', beta: 'silent' },
      collector_last_run: { alpha: '2026-10-02T18:00:00Z', beta: '2026-10-02T18:00:00Z' },
      last_seen: { alpha: '2026-10-02', beta: '2026-09-20' },
      collector_details: {
        alpha: { feed_success_count: 1, feed_failure_count: 0, article_output_validated: true },
        beta: { feed_success_count: 0, feed_failure_count: 1, output_written: false }
      },
      failed_collectors: ['beta'], silent_sources: ['beta'], stalled_sources: {},
      collector_health_semantics: 'Execution and evidence time differ.'
    }
  };
}

const registry = { data: { total: 2, miners: [
  { id: 'alpha', name: 'Alpha', category: 'defense_wire', schedule: 'daily', active: true },
  { id: 'beta', name: 'Beta', category: 'commercial', schedule: 'daily', active: true }
] } };

test('unwraps the production API envelope', () => {
  assert.equal(health.unwrap({ data: { run: 2 }, tier: 'free' }).run, 2);
});

test('keeps collector execution, evidence freshness, and persistence separate', () => {
  const rows = health.buildRows(fixture(), registry, NOW);
  const alpha = rows.find(row => row.id === 'alpha');
  const beta = rows.find(row => row.id === 'beta');
  assert.equal(alpha.runStatus, 'ok');
  assert.equal(alpha.persistence, 'verified');
  assert.equal(beta.runStatus, 'error');
  assert.equal(beta.evidenceStatus, 'silent');
  assert.equal(beta.persistence, 'failed');
});

test('fails closed when a current artifact contains collector failures', () => {
  const summary = health.summarize(fixture(), registry, NOW);
  assert.equal(summary.healthFreshness.status, 'fresh');
  assert.equal(summary.overall, 'warning');
  assert.equal(summary.failures, 1);
  assert.equal(summary.registered, 2);
});

test('fails closed when the health timestamp is missing', () => {
  const summary = health.summarize({ collector_status: { alpha: 'ok' } }, registry, NOW);
  assert.equal(summary.healthFreshness.status, 'unknown');
  assert.equal(summary.overall, 'neutral');
  assert.equal(summary.headline, 'Pipeline health timestamp unavailable');
});

test('builds the same four stage boundaries for the page and dashboard', () => {
  const summary = health.summarize(fixture(), registry, NOW);
  const stages = health.stageSummary(summary, '/api/data?type=miner_health');
  assert.deepEqual(stages.map(stage => stage.title), ['Collector run', 'Evidence', 'Persistence', 'Publication']);
  assert.equal(stages[3].tone, 'good');
  assert.equal(stages[3].note, 'production API readback');
});

test('classifies stale and future telemetry instead of treating it as current', () => {
  assert.equal(health.freshness('2026-09-28T00:00:00Z', NOW).status, 'stale');
  assert.equal(health.freshness('2026-10-03T00:00:00Z', NOW).status, 'invalid');
});

test('supports tone and exact-status filters', () => {
  const rows = health.buildRows(fixture(), registry, NOW);
  assert.equal(rows.filter(row => health.rowMatches(row, '', 'failure', '')).length, 1);
  assert.equal(rows.filter(row => health.rowMatches(row, 'alpha', '', 'defense_wire')).length, 1);
});
