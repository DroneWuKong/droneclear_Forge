#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const signals = require('../forge-source/dossier-signals.js');

const vendor = {
  name: 'Anzu Robotics, LLC',
  aliases: ['Anzu', 'Anzu Robotics'],
  ticker: ''
};
const parts = [
  { pid: 'CAM-001', name: 'Raptor camera' },
  { pid: 'FC-009', name: 'Flight controller' }
];

test('entity alias matching is direct', () => {
  const row = signals.matchFlag({
    id: 'f1', entity: 'anzu-robotics', title: 'Legal update', status: 'active'
  }, 'anzu-robotics', vendor, parts);
  assert.ok(row);
  assert.equal(row._match_confidence, 'direct');
  assert.ok(row._match_reasons.includes('entity'));
});

test('global flags do not match every dossier', () => {
  const row = signals.matchFlag({
    id: 'f2', entity: 'all', title: 'General UAS regulatory update', status: 'active'
  }, 'anzu-robotics', vendor, parts);
  assert.equal(row, null);
});

test('global flag with explicit vendor mention is contextual', () => {
  const row = signals.matchFlag({
    id: 'f3', entity: 'all', title: 'Anzu Robotics filing update', status: 'active'
  }, 'anzu-robotics', vendor, parts);
  assert.ok(row);
  assert.equal(row._match_confidence, 'contextual');
  assert.deepEqual(row._match_reasons, ['text']);
});

test('component IDs create a direct match', () => {
  const row = signals.matchFlag({
    id: 'f4', entity: 'all', component_id: 'CAM-001', title: 'Component constraint', status: 'active'
  }, 'anzu-robotics', vendor, parts);
  assert.ok(row);
  assert.equal(row._match_confidence, 'direct');
  assert.ok(row._match_reasons.includes('component'));
});

test('closed and resolved rows are excluded', () => {
  for (const status of ['closed', 'resolved', 'archived']) {
    assert.equal(signals.matchFlag({ entity: 'anzu-robotics', status }, 'anzu-robotics', vendor, parts), null);
  }
});

test('signals sort by severity and then recency', () => {
  const rows = signals.sortSignals([
    { id: 'old-warning', severity: 'warning', last_seen: '2026-01-01' },
    { id: 'critical', severity: 'critical', last_seen: '2025-01-01' },
    { id: 'new-warning', severity: 'warning', last_seen: '2026-07-01' }
  ]);
  assert.deepEqual(rows.map(row => row.id), ['critical', 'new-warning', 'old-warning']);
});

test('summary separates direct and contextual evidence', () => {
  const summary = signals.summarize([
    {
      severity: 'critical',
      last_seen: '2026-07-30',
      _match_confidence: 'direct',
      sources: [{ type: 'primary', url: 'https://example.gov/a' }]
    },
    {
      severity: 'warning',
      last_seen: '2026-07-29',
      _match_confidence: 'contextual',
      sources: [{ type: 'secondary', url: 'https://example.com/b' }]
    }
  ]);
  assert.equal(summary.count, 2);
  assert.equal(summary.direct_match_count, 1);
  assert.equal(summary.contextual_match_count, 1);
  assert.equal(summary.unique_source_count, 2);
  assert.equal(summary.primary_source_reference_count, 1);
});

test('review prompts are framed as verification steps', () => {
  const prompts = signals.reviewPrompts([{
    title: 'FCC regulatory action creates a supply-chain constraint',
    detail: 'Export and component lead-time signal',
    sources: [{ type: 'primary', url: 'https://fcc.gov/example' }]
  }]);
  assert.ok(prompts.some(text => /authoritative record/.test(text)));
  assert.ok(prompts.some(text => /qualified substitutes/.test(text)));
  assert.ok(prompts.every(text => !/must buy|must avoid|is noncompliant/i.test(text)));
});

test('API envelopes unwrap without mutating raw arrays', () => {
  const rows = [{ id: 1 }];
  assert.equal(signals.unwrapApi({ data: rows }), rows);
  assert.equal(signals.unwrapApi(rows), rows);
});
