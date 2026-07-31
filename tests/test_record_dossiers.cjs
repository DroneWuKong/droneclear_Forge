#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const records = require('../forge-source/record-dossiers.js');

const database = {
  components: {
    flight_controllers: [
      {
        pid: 'FC-001',
        name: 'Atlas H7',
        manufacturer: 'Acme Systems',
        protocol: 'MAVLink',
        mounting_pattern_mm: 30.5,
        ndaa_compliant: true,
        compatible_platforms: ['PLAT-001']
      },
      {
        pid: 'FC-002',
        name: 'Atlas H7-R',
        manufacturer: 'Northwind',
        protocol: 'MAVLink',
        mounting_pattern_mm: 30.5
      },
      {
        pid: 'FC-003',
        name: 'Tiny F4',
        manufacturer: 'Northwind',
        protocol: 'MSP',
        mounting_pattern_mm: 20
      }
    ],
    motors: [
      { pid: 'MOT-001', name: '2806 Motor', manufacturer: 'Acme Systems', kv_rating: 1300 }
    ]
  },
  drone_models: [
    {
      pid: 'PLAT-001',
      name: 'Surveyor VTOL',
      manufacturer: 'Acme Systems',
      category: 'fixed_wing_vtol',
      component_ids: ['FC-001'],
      specs: { payload_kg: 2, max_range_km: 40 },
      compliance: { ndaa_compliant: true }
    },
    {
      pid: 'PLAT-002',
      name: 'Surveyor VTOL II',
      manufacturer: 'Northwind',
      category: 'fixed_wing_vtol',
      specs: { payload_kg: 2, max_range_km: 40 }
    }
  ]
};

const components = records.flattenComponents(database);
const platforms = records.flattenPlatforms(database, []);

test('components flatten with category and stable key', () => {
  assert.equal(components.length, 4);
  const component = components.find(row => row.pid === 'FC-001');
  assert.equal(component._category, 'flight_controllers');
  assert.equal(component._key, 'FC-001');
  assert.equal(records.componentUrl(component), '/dossier/?component=FC-001');
});

test('platform normalization creates stable identifiers and preserves structured data', () => {
  const platform = platforms.find(row => row.id === 'PLAT-001');
  assert.ok(platform);
  assert.equal(platform.platform_name, 'Surveyor VTOL');
  assert.equal(platform.specs.payload_kg, 2);
  assert.equal(platform.compliance.ndaa_compliant, true);
  assert.equal(records.platformUrl(platform), '/dossier/?platform=PLAT-001');
});

test('record resolution prefers exact identifiers and refuses ambiguous names', () => {
  const exact = records.resolveRecord(components, 'FC-001', 'component');
  assert.equal(exact.record.pid, 'FC-001');
  assert.equal(exact.match_type, 'id');

  const duplicateName = components.concat([{
    ...components.find(row => row.pid === 'FC-001'),
    pid: 'FC-099',
    _key: 'FC-099'
  }]);
  const ambiguous = records.resolveRecord(duplicateName, 'Atlas H7', 'component');
  assert.equal(ambiguous.record, null);
  assert.equal(ambiguous.ambiguous, true);
});

test('component to platform joins require structured references', () => {
  const component = components.find(row => row.pid === 'FC-001');
  const related = records.findRelatedPlatforms(component, platforms);
  assert.deepEqual(related.map(row => row.id), ['PLAT-001']);
  assert.equal(related[0]._relationship_confidence, 'direct');

  const unreferenced = {
    ...platforms[1],
    description: 'Marketing copy happens to mention Atlas H7 but no BOM field exists.'
  };
  assert.deepEqual(records.findRelatedPlatforms(component, [unreferenced]), []);
});

test('platform BOM joins resolve exact component records', () => {
  const platform = platforms.find(row => row.id === 'PLAT-001');
  const related = records.findPlatformComponents(platform, components);
  assert.deepEqual(related.map(row => row.pid), ['FC-001']);
});

test('candidate component alternatives stay in category and disclose uncertainty', () => {
  const component = components.find(row => row.pid === 'FC-001');
  const alternatives = records.candidateAlternatives(component, components, 'component', 8);
  assert.deepEqual(alternatives.map(row => row.pid), ['FC-002', 'FC-003']);
  assert.ok(alternatives[0]._matched_fields.includes('protocol'));
  assert.ok(alternatives[0]._matched_fields.includes('mounting_pattern_mm'));
  assert.match(alternatives[0]._alternative_caveat, /not a drop-in-replacement determination/i);
  assert.equal(alternatives.some(row => row.pid === 'MOT-001'), false);
});

test('candidate platform peers stay in the same category', () => {
  const platform = platforms.find(row => row.id === 'PLAT-001');
  const alternatives = records.candidateAlternatives(platform, platforms, 'platform', 8);
  assert.deepEqual(alternatives.map(row => row.id), ['PLAT-002']);
  assert.ok(alternatives[0]._matched_fields.includes('payload_kg'));
});

test('record signals distinguish direct IDs from contextual text', () => {
  const component = components.find(row => row.pid === 'FC-001');
  const direct = records.matchRecordFlag({
    id: 'f1', status: 'active', component_id: 'FC-001', title: 'Component constraint'
  }, 'component', component);
  assert.ok(direct);
  assert.equal(direct._match_confidence, 'direct');
  assert.ok(direct._match_reasons.includes('component'));

  const contextual = records.matchRecordFlag({
    id: 'f2', status: 'active', title: 'Reporting mentions Atlas H7 in a broader review'
  }, 'component', component);
  assert.ok(contextual);
  assert.equal(contextual._match_confidence, 'contextual');

  const unrelated = records.matchRecordFlag({
    id: 'f3', status: 'active', entity: 'all', title: 'General UAS update'
  }, 'component', component);
  assert.equal(unrelated, null);
});

test('platform identifiers create direct signal matches', () => {
  const platform = platforms.find(row => row.id === 'PLAT-001');
  const result = records.matchRecordFlag({
    id: 'f4', status: 'active', platform_id: 'PLAT-001', title: 'Program update'
  }, 'platform', platform);
  assert.ok(result);
  assert.equal(result._match_confidence, 'direct');
  assert.ok(result._match_reasons.includes('platform'));
});

test('public URLs are encoded and manufacturer links are stable', () => {
  assert.equal(records.componentUrl('FC 1/2'), '/dossier/?component=FC%201%2F2');
  assert.equal(records.platformUrl('PLAT 1/2'), '/dossier/?platform=PLAT%201%2F2');
  assert.equal(records.manufacturerUrl('Acme Systems, Inc.'), '/dossier/?m=acme-systems-inc');
});

test('source URLs reject unsafe schemes', () => {
  assert.equal(records.sourceUrl({ product_url: 'javascript:alert(1)' }), '');
  assert.equal(records.sourceUrl({ product_url: 'https://example.com/part' }), 'https://example.com/part');
});

test('output language never issues automatic procurement or compliance decisions', () => {
  const component = components.find(row => row.pid === 'FC-001');
  const alternatives = records.candidateAlternatives(component, components, 'component', 2);
  const joined = JSON.stringify(alternatives);
  assert.doesNotMatch(joined, /must buy|must avoid|automatically noncompliant|guaranteed compatible/i);
});
