import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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

test('daily source identity hashes the complete same-load UTF-8 text, independently of filtering',async()=>{
  const flags=[{id:'a',title:'Drone café → 日本',last_verified_at:now},{id:'b',title:'Battery',last_verified_at:now}];
  const raw=JSON.stringify(flags,null,2)+'\r\n';
  const expected=createHash('sha256').update(raw,'utf8').digest('hex');
  for(const params of ['record=a&limit=1','q=Battery&state=all&limit=20']) {
    const reads=[];
    const env={PIE_OUTPUTS:{get:async key=>{reads.push(key);return reads.length===1?raw:'[]';}},ASSETS:{fetch:async()=>{throw new Error('No second metadata fetch');}}};
    const response=await worker.fetch(request('type=daily_changes&'+params),env);
    assert.equal(response.status,200);const payload=await response.json(),publication=payload.data.publication;
    assert.deepEqual(reads,['flags']);assert.equal(payload.data.items.length,1);
    assert.equal(publication.input_revision,expected);assert.equal(publication.artifact_sha256,expected);assert.equal(publication.hash_basis,'utf8_source_text');
    assert.equal(publication.input_bytes,Buffer.byteLength(raw,'utf8'));assert.equal(publication.input_record_count,2);
    assert.equal(publication.source,'kv');assert.equal(publication.source_generated_at,now);assert.equal(publication.publication_revision,null);assert.equal(publication.publication_revision_status,'unavailable');
  }
  const changed=JSON.stringify([flags[0],{...flags[1],title:'Changed unselected record'}],null,2)+'\r\n';
  const response=await worker.fetch(request('type=daily_changes&record=a'),{PIE_OUTPUTS:{get:async()=>changed}});
  const payload=await response.json();assert.equal(payload.data.items[0].id,'a');assert.notEqual(payload.data.publication.input_revision,expected);
});

test('daily fallback identifies accepted static content, never rejected KV or a later manifest',async()=>{
  const staticRaw=JSON.stringify([{id:'b',title:'Accepted source',last_verified_at:now}]);
  for(const rejected of ['not-json',JSON.stringify([{id:'a',last_verified_at:'2020-01-01T00:00:00Z'}])]) {
    const reads=[],fetches=[];
    const response=await worker.fetch(request('type=daily_changes'),{
      PIE_OUTPUTS:{get:async key=>{reads.push(key);return rejected;}},
      ASSETS:{fetch:async request=>{fetches.push(new URL(request.url).pathname);return fetches.length===1?new Response('Missing',{status:404}):new Response(staticRaw);}},
    });
    assert.equal(response.status,200);assert.match(response.headers.get('X-Data-Fallback'),/^kv:(?:500|503)$/);
    const payload=await response.json();assert.equal(payload.data.items[0].id,'b');assert.equal(payload.data.publication.source,'static:/static/flags.json');
    assert.equal(payload.data.publication.artifact_sha256,createHash('sha256').update(staticRaw).digest('hex'));
    assert.deepEqual(reads,['flags']);assert.deepEqual(fetches,['/flags.json','/static/flags.json']);
  }
});
test('article detail returns one exact bounded excerpt and refuses ID collisions',async()=>{
  const rows=[{aid:'1',title:'A',body_text:'x'.repeat(50000)},{aid:'2',title:'B'}];
  const env={PIE_OUTPUTS:{get:async()=>JSON.stringify(rows)}};
  const response=await worker.fetch(request('type=intel_articles&record_id=1'),env);const payload=await response.json();
  assert.equal(payload.data.record.body_excerpt.length,16000);assert.equal(payload.data.record_status,'found');
  rows.push({aid:'1',title:'other'});assert.equal((await (await worker.fetch(request('type=intel_articles&record_id=1'),env)).json()).data.record_status,'ambiguous');
});

test('fragment-grouped search keeps each original article detail reachable and distinct',async()=>{
  const rows=[{aid:'bf_06f405f4138b',title:'AirData BRINC drone records',url:'https://source.test/report',body_text:'Original article excerpt'},
    {aid:'bf_d689c12168d7',title:'AirData BRINC drone records',url:'https://source.test/report#comments',body_text:'Collected comment version excerpt'}];
  const data={schema_version:1,meta:{generated_at:now},records:ask.articleRecords(rows).map(ask.compactRecord)};
  const env={PIE_OUTPUTS:{get:async key=>JSON.stringify(key==='research_index'?data:rows)}};
  const result=await (await worker.fetch(request('type=research_index&q=AirData%20BRINC&limit=5'),env)).json();
  assert.equal(result.data.retrieval_version,'lexical-subject-v2');assert.equal(result.data.ranked.length,1);
  const record=result.data.ranked[0].record;
  assert.equal(record.sourceAliases.length,2);assert.equal(record.citations.length,2);
  for (const original of data.records) {
    const detail=await (await worker.fetch(request('type=intel_articles&record_key='+encodeURIComponent(original.key)),env)).json();
    assert.equal(detail.data.record_status,'found');
    assert.equal(detail.data.record.body_excerpt,rows.find(row=>row.aid===original.id).body_text);
    assert.equal(detail.data.record.key,original.key);
  }
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
