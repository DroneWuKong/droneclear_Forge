const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../forge-source/private-relationships.js');
const data = {
  nodes: [{id:'a',label:'Example Radio'},{id:'b',label:'Aircraft A'},{id:'c',label:'Aircraft B'}],
  relationships: [
    {id:'r1',source:'a',target:'b',relation:'supplies_component',component:'Radio',origin:'legacy_supply',review_status:'needs_review',evidence:[],conflicting_record_ids:['r2']},
    {id:'r2',source:'a',target:'b',relation:'unverified_supply_claim',origin:'graphify_candidate',review_status:'needs_review',evidence:[{dossier_slug:'example'}],conflicting_record_ids:['r1']},
    {id:'r3',source:'a',target:'c',relation:'supplies_component',origin:'legacy_supply',review_status:'supported',evidence:[],conflicting_record_ids:[]}
  ]
};
test('candidate view never silently joins the supply view', () => {
  assert.deepEqual(api.filterRows(data,{view:'supply'}).map(r=>r.id),['r1','r3']);
  assert.deepEqual(api.filterRows(data,{view:'research',dossier:'example'}).map(r=>r.id),['r2']);
});
test('conflict comparison includes both records and search is literal', () => {
  assert.deepEqual(api.filterRows(data,{view:'all',status:'conflict',query:'Example Radio'}).map(r=>r.id),['r1','r2']);
  assert.equal(api.filterRows(data,{query:'['}).length,0);
  assert.equal(api.filterRows(data,{status:'supported'}).length,1);
});
test('focused graph and complete evidence list share filtered neighbors', () => {
  const rows=api.filterRows(data,{view:'supply'});
  assert.equal(api.entities(data,rows)[0].id,'a');
  assert.deepEqual(api.connected(rows,'b').map(r=>r.id),['r1']);
});
test('source links reject executable and credential URLs', () => {
  for(const url of ['javascript:alert(1)','data:text/html,x','file:///etc/passwd','https://user:secret@example.com/']) assert.equal(api.safeUrl(url),null);
  assert.equal(api.safeUrl('https://example.com/source'),'https://example.com/source');
});
test('retired claims are hidden by default but reachable in history', () => {
  const d={...data,relationships:[...data.relationships,{...data.relationships[0],id:'old',active:false,review_status:'superseded'}]};
  assert.equal(api.filterRows(d,{}).length,3);
  assert.deepEqual(api.filterRows(d,{status:'resolved'}).map(r=>r.id),['old']);
  assert.equal(api.filterRows(d,{includeHistory:true}).length,4);
});
test('role stages and priority queue filter the same evidence', () => {
  const d={...data,relationships:data.relationships.map((r,i)=>({...r,review_priority:i===0?'high':'normal',lifecycle:i===2?'tested':'available_option'}))};
  assert.deepEqual(api.filterRows(d,{status:'priority'}).map(r=>r.id),['r1']);
  assert.deepEqual(api.filterRows(d,{lifecycle:'tested'}).map(r=>r.id),['r3']);
});
