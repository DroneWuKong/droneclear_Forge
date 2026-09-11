import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/forge-data.js';
import ask from '../forge-source/ask-pie-retrieval.js';
const request=query=>new Request('https://uas-patterns.com/api/data?'+query);
const now=new Date().toISOString();
const index={schema_version:1,meta:{generated_at:now,input_revision:'snapshot'},counts:{article:120},records:ask.articleRecords(Array.from({length:120},(_,i)=>({aid:String(i),title:'Shahed '+i,url:'https://example.test/'+i}))).map(ask.compactRecord)};
test('research endpoint bounds KV reads and preserves source metadata',async()=>{
  const response=await worker.fetch(request('type=research_index&q=Shahed&limit=9999'),{PIE_OUTPUTS:{get:async key=>key==='research_index'?JSON.stringify(index):null}});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.source,'kv');assert.equal(result.data.ranked.length,100);assert.equal(result.data.meta.input_revision,'snapshot');
});
test('static research fallback is explicit, and stale indexes fail closed',async()=>{
  const result=await worker.fetch(request('type=research_index&view=summary'),{ASSETS:{fetch:async()=>Response.json(index)}});
  assert.equal(result.status,200);assert.match((await result.json()).source,/static/);
  const stale={...index,meta:{...index.meta,generated_at:'2020-01-01T00:00:00Z'}};
  assert.equal((await worker.fetch(request('type=research_index&q=Shahed'),{PIE_OUTPUTS:{get:async()=>JSON.stringify(stale)}})).status,503);
});
test('daily_changes only accepts a coherent complete ledger batch timestamp',async()=>{
  for(const flags of [[{id:'1'}],[{id:'1',last_verified_at:now},{id:'2'}],[{id:'1',last_verified_at:now},{id:'2',last_verified_at:'2020-01-01'}]]) {
    assert.equal((await worker.fetch(request('type=daily_changes'),{PIE_OUTPUTS:{get:async()=>JSON.stringify(flags)}})).status,503);
  }
  let key;const response=await worker.fetch(request('type=daily_changes'),{PIE_OUTPUTS:{get:async value=>{key=value;return JSON.stringify([{id:'1',title:'Example',last_verified_at:now,change_kind:'new'}]);}}});
  assert.equal(key,'flags');assert.equal(response.status,200);
});
test('article detail returns one exact bounded excerpt and refuses ID collisions',async()=>{
  const rows=[{aid:'1',title:'A',body_text:'x'.repeat(50000)},{aid:'2',title:'B'}];
  const env={PIE_OUTPUTS:{get:async()=>JSON.stringify(rows)}};
  const response=await worker.fetch(request('type=intel_articles&record_id=1'),env);const payload=await response.json();
  assert.equal(payload.data.record.body_excerpt.length,16000);assert.equal(payload.data.record_status,'found');
  rows.push({aid:'1',title:'other'});assert.equal((await (await worker.fetch(request('type=intel_articles&record_id=1'),env)).json()).data.record_status,'ambiguous');
});

for (const [type,schema] of [['forecast_review_queue','forecast-review-queue-v1'],['analytic_judgments','analytic-judgments-v1']]) {
  test(`${type} is a freshness-gated read-only publication with honest absence`,async()=>{
    const absent=await worker.fetch(request('type='+type),{});assert.equal(absent.status,404);const missing=await absent.json();assert.ok(missing.error);assert.equal(missing.data,undefined);
    const valid={schema_version:schema,generated_at:now,records:[{prediction_id:'P',state:'pending'}],...(type==='forecast_review_queue'?{counts:{pending:1}}:{})};
    const response=await worker.fetch(request('type='+type),{ASSETS:{fetch:async()=>Response.json(valid)}});assert.equal(response.status,200);const result=await response.json();assert.equal(result.data.records.length,1);assert.match(result.source,/static/);
    const stale={...valid,generated_at:'2020-01-01'};assert.equal((await worker.fetch(request('type='+type),{PIE_OUTPUTS:{get:async()=>JSON.stringify(stale)}})).status,503);
    const malformed={...valid,records:null};const bad=await worker.fetch(request('type='+type),{PIE_OUTPUTS:{get:async()=>JSON.stringify(malformed)}});assert.equal(bad.status,503);assert.match((await bad.json()).error,/publication controls/);
    const write=await worker.fetch(new Request('https://uas-patterns.com/api/data?type='+type,{method:'POST',body:JSON.stringify(valid)}),{FORGE_BLOBS_ADMIN_KEY:'test'});assert.equal(write.status,405);
  });
}
test('queue nonzero counters cannot accompany an empty result artifact',async()=>{
  const artifact={schema_version:'forecast-review-queue-v1',generated_at:now,counts:{due:3},records:[]};
  assert.equal((await worker.fetch(request('type=forecast_review_queue'),{PIE_OUTPUTS:{get:async()=>JSON.stringify(artifact)}})).status,503);
});
