#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const support = require('../forge-source/patterns-decision-support.js');

test('manufacturer slugs remove common corporate suffixes', () => {
  assert.equal(support.slugify('Anzu Robotics, LLC'), 'anzu-robotics');
  assert.equal(support.slugify('Skydio, Inc.'), 'skydio');
});

test('legal and regulatory signals get verification and compliance links', () => {
  const result = support.build({
    severity: 'critical',
    entity: 'Anzu Robotics',
    flag_type: 'legal_action',
    title: 'FCC covered-list and court docket update',
    sources: [{ type: 'primary', url: 'https://example.gov/docket' }]
  });
  assert.ok(result.kinds.includes('legal_regulatory'));
  assert.ok(result.verify_next.some(text => /docket|agency notice/.test(text)));
  assert.ok(result.affected_links.some(link => link.id === 'manufacturer_dossier'));
  assert.ok(result.affected_links.some(link => link.id === 'compliance'));
  assert.ok(result.affected_links.some(link => link.id === 'regulations'));
});

test('global signals do not invent a manufacturer dossier', () => {
  const links = support.affectedLinks({
    entity: 'all',
    category: 'regulatory',
    title: 'General UAS rule update'
  });
  assert.equal(links.some(link => link.id === 'manufacturer_dossier'), false);
  assert.ok(links.some(link => link.id === 'compliance'));
});

test('component and supply-chain signals link to catalog and comparison tools', () => {
  const result = support.build({
    severity: 'warning',
    component_id: 'CAM-001',
    title: 'Component shortage and lead-time signal'
  });
  assert.ok(result.kinds.includes('supply_chain'));
  assert.ok(result.affected_links.some(link => link.id === 'component_dossier'));
  assert.ok(result.affected_links.some(link => link.id === 'component_dossier' && /component=CAM-001/.test(link.url)));
  assert.ok(result.affected_links.some(link => link.id === 'components'));
  assert.ok(result.affected_links.some(link => link.id === 'compare'));
  assert.ok(result.verify_next.some(text => /part numbers|lead times/.test(text)));
});

test('platform identifiers link to the exact platform dossier', () => {
  const links = support.affectedLinks({
    platform_id: 'PLAT-001',
    title: 'Operational platform update'
  });
  assert.ok(links.some(link => link.id === 'platform_dossier'));
  assert.ok(links.some(link => link.id === 'platform_dossier' && /platform=PLAT-001/.test(link.url)));
  assert.ok(links.some(link => link.id === 'platforms'));
});

test('source statistics deduplicate evidence URLs and count primary references', () => {
  const stats = support.sourceStats({
    sources: [
      { type: 'primary', url: 'https://example.gov/a' },
      { type: 'primary', url: 'https://example.gov/a' },
      { type: 'reporting', url: 'https://example.com/b' }
    ]
  });
  assert.equal(stats.reference_count, 3);
  assert.equal(stats.unique_source_count, 2);
  assert.equal(stats.primary_reference_count, 2);
});

test('missing primary evidence is stated as a limitation, not hidden', () => {
  const result = support.build({
    severity: 'warning',
    title: 'Analyst reporting signal',
    sources: [{ type: 'reporting', url: 'https://example.com/report' }]
  });
  assert.ok(result.verify_next.some(text => /authoritative|first-party/.test(text)));
  assert.ok(result.limitations.some(text => /No source marked primary/.test(text)));
});

test('operational flags preserve attribution uncertainty', () => {
  const result = support.build({
    severity: 'high',
    title: 'Public reporting on an electronic-warfare TTP and UAS strike'
  });
  assert.ok(result.kinds.includes('operational'));
  assert.ok(result.why_it_matters.some(text => /does not establish event-level attribution/.test(text)));
  assert.ok(result.verify_next.some(text => /distinct events/.test(text)));
});

test('severity framing prioritizes review without issuing a decision', () => {
  const result = support.build({ severity: 'critical', title: 'Critical signal' });
  assert.ok(result.why_it_matters[0].includes('high-priority indexed signal'));
  const joined = JSON.stringify(result);
  assert.doesNotMatch(joined, /must buy|must avoid|automatically noncompliant|confirmed illegal/i);
});

test('procurement flags point to the authoritative record and contract tracker', () => {
  const result = support.build({
    category: 'procurement',
    title: 'RFI deadline and contract funding update'
  });
  assert.ok(result.kinds.includes('procurement'));
  assert.ok(result.verify_next.some(text => /solicitation or award/.test(text)));
  assert.ok(result.affected_links.some(link => link.id === 'tracker'));
});

test('affected links are deduplicated', () => {
  const links = support.affectedLinks({
    entity: 'Acme Systems, Inc.',
    component_id: 'FC-1',
    title: 'Supply component dependency and replacement signal'
  });
  assert.equal(new Set(links.map(link => link.id)).size, links.length);
});
