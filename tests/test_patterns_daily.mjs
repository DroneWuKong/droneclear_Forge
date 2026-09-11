import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDaily, safeURL } from '../forge-source/patterns-daily.mjs';
const now = Date.parse('2026-09-11T12:00:00Z');
const flag = (id, fields = {}) => ({id, title:`Record ${id}`, severity:'info', last_verified_at:'2026-09-11T11:00:00Z', ...fields});
test('legacy records establish baseline instead of inventing daily changes', () => {
  const p=projectDaily([flag('a',{status:'new',timestamp:'2026-09-11T11:00:00Z'})],new URLSearchParams(),now);
  assert.equal(p.counts.new,0); assert.equal(p.items[0].change_kind,'baseline'); assert.equal(p.baseline_established,false);
  assert.equal(p.items[0].source_published_at,'');
});
test('material changes precede unchanged critical context and retain reasons',()=>{
  const p=projectDaily([flag('a',{change_schema_version:1,change_kind:'unchanged',severity:'critical'}),flag('b',{change_schema_version:1,change_kind:'changed',change_reason:'New source'})],new URLSearchParams(),now);
  assert.equal(p.items[0].id,'b');assert.equal(p.items[0].change_reason,'New source');
});
test('exact duplicate evidence does not multiply daily developments',()=>{
  const p=projectDaily([flag('a',{evidence_fingerprint:'same'}),flag('b',{evidence_fingerprint:'same'})],new URLSearchParams(),now);
  assert.equal(p.total,1);assert.equal(p.counts.baseline,1);
});
test('exact record lookup cannot silently select another record',()=>{
  assert.equal(projectDaily([flag('a')],new URLSearchParams('record=missing'),now).items.length,0);
  assert.equal(projectDaily([flag('a'),flag('b')],new URLSearchParams('record=b'),now).items[0].id,'b');
});
test('empty and stale collections cannot establish current coverage',()=>{
  assert.equal(projectDaily([],new URLSearchParams(),now).coverage.status,'unavailable');
  assert.equal(projectDaily([flag('a',{last_verified_at:'2026-07-01T00:00:00Z'})],new URLSearchParams(),now).coverage.status,'stale');
});
test('a newly compared artifact does not certify upstream collection or refresh its evidence',()=>{
  const p=projectDaily([flag('a',{source_published_at:'2020-01-01',change_schema_version:1,change_kind:'unchanged',comparison_baseline_established:true})],new URLSearchParams(),now);
  assert.equal(p.coverage.status,'available');
  assert.equal(p.coverage.collector_health,'not_assessed');
  assert.equal(p.items[0].source_published_at,'2020-01-01');
  assert.equal(p.items[0].lens,'Historical context');
  assert.equal(p.counts.new,0);
});
test('reference and body payloads are bounded and unsafe links rejected',()=>{
  const rows=Array.from({length:120},(_,i)=>flag(`${i}`,{detail:'x'.repeat(5000),sources:[{name:'Unsafe',url:'javascript:alert(1)'}]}));
  const p=projectDaily(rows,new URLSearchParams('limit=99999'),now);
  assert.equal(p.items.length,50);assert.equal(p.items[0].detail.length,1200);assert.equal(p.items[0].sources[0].url,'');
  assert.equal(safeURL('https://user:pass@example.org/'),'');
});
test('query and state filters do not modify underlying counts',()=>{
  const rows=[flag('a',{title:'Battery supply',change_schema_version:1,change_kind:'new'}),flag('b',{title:'Motor supply',change_schema_version:1,change_kind:'new'})];
  const p=projectDaily(rows,new URLSearchParams('q=Battery&state=new'),now);
  assert.equal(p.items.length,1);assert.equal(p.counts.new,2);
});
test('null records are ignored and future collection timestamp is not current',()=>{
  assert.equal(projectDaily([null,flag('a',{last_verified_at:'2030-01-01T00:00:00Z'})],new URLSearchParams(),now).coverage.status,'stale');
});
test('first schema-valid snapshot is still a baseline, not a no-change comparison',()=>{
  assert.equal(projectDaily([flag('a',{change_schema_version:1,change_kind:'baseline'})],new URLSearchParams(),now).baseline_established,false);
  assert.equal(projectDaily([flag('a',{change_schema_version:1,change_kind:'unchanged',comparison_baseline_established:true})],new URLSearchParams(),now).baseline_established,true);
});
test('daily context favors cited UAS evidence over old broad contracts and uncited severity',()=>{
  const rows=[flag('old',{title:'Manned aircraft contract',flag_type:'contract_signal',severity:'critical',source_published_at:'2011-01-01',sources:[{url:'https://example.org/old'}]}),flag('uncited',{title:'Drone supply',severity:'critical'}),flag('recent',{title:'UAS battery procurement',flag_type:'contract_signal',source_published_at:'2026-09-09',sources:[{url:'https://example.org/uas'}]})];
  const p=projectDaily(rows,new URLSearchParams(),now);
  assert.equal(p.items[0].id,'recent');assert.equal(p.items[0].lens,'Opportunity lead · verify terms');assert.equal(p.items.find(r=>r.id==='old').lens,'Historical context');
  assert.equal(projectDaily([rows[0]],new URLSearchParams('record=old'),now).items[0].id,'old');
});
test('missing and invalid dates cannot make procurement look current',()=>{
  for(const source_published_at of [null,'not-a-date','2026-02-30','2099-01-01']) {
    const p=projectDaily([flag('a',{title:'Drone contract',flag_type:'contract_signal',source_published_at,sources:[{url:'https://example.org/'}]})],new URLSearchParams(),now);
    assert.equal(p.items[0].lens,'Procurement context');
  }
});
