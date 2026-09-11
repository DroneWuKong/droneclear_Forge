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

const processorDatabase = {
  components: {companion_computers:[
    {pid:'COMP-0001',name:'ModalAI VOXL 2',manufacturer:'ModalAI',processor:'Qualcomm QRB5165',compatible_platforms:['PLAT-001']},
    {pid:'COMP-0002',name:'ModalAI VOXL 2 Mini',manufacturer:'ModalAI',specs:{companion_processor:'Qualcomm QRB5165'}},
    {pid:'COMP-0005',name:'ARK carrier',processor:'Qualcomm QRB5165 (via VOXL 2)'},
    {pid:'OTHER',name:'Different chip',processor:'Qualcomm Snapdragon 845'},
    {pid:'PROSE',name:'Unrelated product',description:'Qualcomm QRB5165 mentioned in marketing copy'},
    {pid:'LONGER',name:'Longer identifier',processor:'Qualcomm QRB5165X'}
  ]},
  drone_models:database.drone_models
};
const processorComponents=records.flattenComponents(processorDatabase);
const referenceContext={
  components:processorComponents, platforms:records.flattenPlatforms(processorDatabase,[]), catalog:{datasets:[]},
  flags:[{id:'flag /1',component_id:'qualcomm-qrb5165',title:'Processor signal',status:'active'},
    {id:'unrelated',component_id:'qualcomm-snapdragon-845',title:'Other processor signal'}]
};

test('chip reference stays unresolved and only full structured processor values form relationships', () => {
  const query='qualcomm-qrb5165';
  assert.equal(records.resolveRecord(processorComponents,query,'component').record,null);
  const related=records.findComponentReferenceRelationships(query,processorComponents);
  assert.deepEqual(related.map(row=>row.pid),['COMP-0001','COMP-0002']);
  assert.deepEqual(related[0]._reference_fields,[{field:'processor',value:'Qualcomm QRB5165'}]);
  assert.match(related[1]._relationship_reason,/specs\.companion_processor = Qualcomm QRB5165/);
  assert.deepEqual(records.findComponentReferenceRelationships('Qualcomm',processorComponents),[]);
  assert.deepEqual(records.findComponentReferenceRelationships('QRB5165',processorComponents),[]);
  assert.equal(records.resolveRecord(processorComponents,'COMP-0001','component').record.name,'ModalAI VOXL 2');
});

test('relationships exclude duplicate catalog PIDs that cannot resolve to one exact product', () => {
  const duplicate=processorComponents.concat({...processorComponents[0],name:'Conflicting product'});
  assert.deepEqual(records.findComponentReferenceRelationships('qualcomm-qrb5165',duplicate).map(row=>row.pid),['COMP-0002']);
});

test('unresolved reference page preserves the reference and links documented products, BOMs, and exact signals', () => {
  const markup=records.renderComponentReferencePage('qualcomm-qrb5165',referenceContext);
  assert.match(markup,/Component reference/);assert.match(markup,/No exact catalog identity/);
  assert.match(markup,/<h1>qualcomm-qrb5165<\/h1>/);
  assert.match(markup,/href="\/dossier\/\?component=COMP-0001"/);
  assert.match(markup,/processor = Qualcomm QRB5165/);
  assert.match(markup,/href="\/dossier\/\?platform=PLAT-001"/);
  assert.match(markup,/Via catalog component COMP-0001/);
  assert.match(markup,/href="https:\/\/uas-patterns\.com\/ask-pie\/\?q=qualcomm-qrb5165"/);
  assert.match(markup,/href="https:\/\/uas-patterns\.com\/patterns\/#flag=flag%20%2F1"/);
  assert.doesNotMatch(markup,/>Other processor signal</);
  assert.doesNotMatch(markup,/Candidate alternatives|drop-in replacement|location\.(?:href|replace)/);
});

test('unknown reference text is escaped and research URLs retain the complete encoded identifier', () => {
  const query='unknown / <img src=x onerror=alert(1)>&"';
  const markup=records.renderComponentReferencePage(query,referenceContext);
  assert.doesNotMatch(markup,/<img/);
  assert.ok(markup.includes('q='+encodeURIComponent(query)));
  assert.match(markup,/No exact structured processor relationship/);
});

test('browser bootstrap renders chip reference recovery while genuine PID still opens its exact dossier', async () => {
  const originals=Object.fromEntries(['document','location','window','fetch'].map(key=>[key,globalThis[key]]));
  const main={innerHTML:'',querySelector:()=>null};
  const nav={textContent:''};
  globalThis.document={title:'',querySelector:selector=>selector==='main'?main:null,
    getElementById:id=>id==='forge-record-dossier-styles'?{}:id==='dc-nav-page'?nav:null};
  globalThis.location={search:'?component=qualcomm-qrb5165',href:'https://uas-forge.com/dossier/?component=qualcomm-qrb5165'};
  globalThis.window={};
  globalThis.fetch=async url=>({ok:true,json:async()=>url.includes('forge_database')?processorDatabase:url.includes('pie_flags')?referenceContext.flags:url.includes('dataset_catalog')?referenceContext.catalog:[]});
  try {
    assert.equal(await records.bootstrapFromLocation(),false);
    assert.match(main.innerHTML,/No exact catalog identity/);
    assert.match(main.innerHTML,/component=COMP-0001/);
    assert.equal(nav.textContent,'Component Reference');
    assert.equal(location.search,'?component=qualcomm-qrb5165');
    location.search='?component=COMP-0001';
    assert.equal(await records.bootstrapFromLocation(),true);
    assert.match(main.innerHTML,/<h1>ModalAI VOXL 2<\/h1>/);
    assert.doesNotMatch(main.innerHTML,/No exact catalog identity/);
    assert.equal(nav.textContent,'Component Dossier');
  } finally {
    for (const [key,value] of Object.entries(originals)) {
      if (value===undefined) delete globalThis[key]; else globalThis[key]=value;
    }
  }
});
