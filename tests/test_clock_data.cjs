#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const data = require('../forge-source/clock-data.js');

test('live mixed-schema predictions replace embedded April demo rows', () => {
  const rows = [
    { event: 'old demo', impact: 'critical', probability: 0.99, last_updated: '2026-04-13' },
    { event: 'current signal', impact: 'Long-form consequence text', probability: 0.9, last_updated: '2026-09-18' },
  ];
  const projected = data.selectPredictions(rows);
  assert.equal(projected[0].event, 'current signal');
  assert.equal(projected[0].impact, 'critical');
});

test('trend projection uses the latest observations rather than embedded April history', () => {
  const trends = { trends: [
    { metric: 'total_flags', dates: ['2026-04-01', '2026-09-17', '2026-09-18'], values: [10, 20, 22] },
    { metric: 'critical_flags', dates: ['2026-04-01', '2026-09-17', '2026-09-18'], values: [2, 5, 6] },
  ] };
  assert.deepEqual(data.historyFromTrends(trends, 2), [
    { date: 'Sep 17', critical: 5, other: 15 },
    { date: 'Sep 18', critical: 6, other: 16 },
  ]);
});

test('stale supporting datasets are rejected instead of mixed into a fresh clock', () => {
  const now = Date.parse('2026-09-19T00:00:00Z');
  assert.equal(data.isFreshDataset('predictions', [{ last_updated: '2026-09-18' }], null, now), true);
  assert.equal(data.isFreshDataset('predictions', [{ last_updated: '2026-04-13' }], null, now), false);
  assert.equal(data.isFreshDataset('pie_trends', { generated: '2026-09-18', trends: [] }, null, now), true);
});

test('active flag selection prefers new and recently changed evidence', () => {
  const flags = data.selectTopFlags([
    { title: 'old critical', severity: 'critical', status: 'active', change_kind: 'unchanged', changed_at: '2026-04-01' },
    { title: 'new warning', severity: 'warning', status: 'active', change_kind: 'new', changed_at: '2026-09-18' },
  ]);
  assert.equal(flags[0].title, 'new warning');
});

test('clock first render is not blocked by supporting datasets', () => {
  const page = readFileSync(join(__dirname, '../forge-source/clock.html'), 'utf8');
  const init = page.slice(page.indexOf('// ── INIT'));
  assert.ok(init.indexOf('renderClock();') < init.indexOf('loadSupportingData();'));
  assert.match(page, /Promise\.allSettled\(\[predictionTask, flagTask, trendTask\]\)/);
  assert.doesNotMatch(page, /const \[predictions, flags, trends\] = await Promise\.all/);
});
