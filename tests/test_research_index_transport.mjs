import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import builder from '../tools/build_research_index.cjs';
import ask from '../forge-source/ask-pie-retrieval.js';
import worker from '../workers/forge-data.js';
import {readResearchStaticJSON} from '../workers/research-static-transport.mjs';

const fixture=()=>({schema_version:1,meta:{generated_at:new Date().toISOString(),input_revision:'source-snapshot'},counts:{article:4},
  records:ask.articleRecords(Array.from({length:4},(_,i)=>({aid:String(i),title:'Shahed evidence '+i,
    summary:'Source evidence '.repeat(20),url:'https://source.test/'+i}))).map(ask.compactRecord)});

function files(index) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-transport-'));
  builder.writeResearchIndex(index,path.join(dir,'research_index.json'),{encoded:1500,decoded:100000});
  return {dir,metadata:fs.readFileSync(path.join(dir,'research_index.metadata.json')),gzip:fs.readFileSync(path.join(dir,'research_index.json.gzip'))};
}
function assets(data, overrides={}) {
  const calls=[];
  return {calls,fetch:async request=>{
    const name=new URL(request.url).pathname;calls.push(name);
    assert.equal(request.headers.get('Accept-Encoding'),name.endsWith('.json')&&!name.endsWith('metadata.json')?null:'identity');
    if(Object.hasOwn(overrides,name))return overrides[name]();
    if(name==='/research_index.metadata.json')return new Response(data.metadata);
    if(name==='/research_index.json.gzip')return new Response(data.gzip,{headers:{'Content-Type':'application/gzip','Content-Encoding':'identity'}});
    return new Response('missing',{status:404});
  }};
}

test('generator selects lossless gzip, removes stale format, and preserves all search/detail projections',async()=>{
  const index=fixture(), data=files(index);
  try {
    const raw=JSON.stringify(index);
    assert.equal(gunzipSync(data.gzip).toString(),raw);
    assert.equal(fs.existsSync(path.join(data.dir,'research_index.json')),false);
    const binding=assets(data);
    assert.equal(await readResearchStaticJSON(binding,'https://site.test/api/data?type=research_index'),raw);
    assert.equal(binding.calls.length,2);
    for(const query of ['q=Shahed&limit=100','view=summary','record=article:3']) {
      const binding=assets(data);
      const response=await worker.fetch(new Request('https://site.test/api/data?type=research_index&'+query),{ASSETS:binding});
      assert.equal(response.status,200);
      const payload=await response.json();
      assert.equal(payload.source,'static:/research_index.json.gzip');
      assert.deepEqual(payload.data,JSON.parse(JSON.stringify(ask.projectResearch(index,new URLSearchParams(query)))));
      assert.equal(binding.calls.length,4);
    }
    builder.writeResearchIndex(index,path.join(data.dir,'research_index.json'));
    assert.equal(fs.readFileSync(path.join(data.dir,'research_index.json'),'utf8'),raw);
    assert.equal(fs.existsSync(path.join(data.dir,'research_index.metadata.json')),false);
    assert.equal(fs.existsSync(path.join(data.dir,'research_index.json.gzip')),false);
  } finally {fs.rmSync(data.dir,{recursive:true,force:true});}
});

test('legacy plain index retains its API shape and uses only its existing asset request',async()=>{
  const index=fixture();let calls=0;
  const response=await worker.fetch(new Request('https://site.test/api/data?type=research_index&q=Shahed'),{ASSETS:{fetch:async()=>{calls++;return Response.json(index);}}});
  assert.equal(response.status,200);assert.equal(calls,1);
  assert.deepEqual((await response.json()).data,JSON.parse(JSON.stringify(ask.projectResearch(index,new URLSearchParams({q:'Shahed'})))));
});

test('generator fails before writing when decoded or encoded bounds would be exceeded',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-limit-')),output=path.join(dir,'research_index.json');
  try {
    fs.writeFileSync(output,'last-good');
    assert.throws(()=>builder.writeResearchIndex(fixture(),output,{encoded:1,decoded:10}),/decoded/);
    assert.throws(()=>builder.writeResearchIndex({random:randomBytes(1000).toString('hex')},output,{encoded:40,decoded:3000}),/Pages/);
    assert.equal(fs.readFileSync(output,'utf8'),'last-good');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

for(const variant of ['hash','length','unknown-codec','null-metadata','truncated-gzip','missing-gzip','http-gunzip','metadata-overflow','encoded-overflow']) {
  test('research compressed fallback fails closed for '+variant,async()=>{
    const data=files(fixture());
    try {
      const metadata=JSON.parse(data.metadata),overrides={};
      if(variant==='hash')metadata.sha256='0'.repeat(64);
      if(variant==='length')metadata.uncompressed_bytes--;
      if(variant==='unknown-codec')metadata.encoding='brotli';
      data.metadata=JSON.stringify(variant==='null-metadata'?null:metadata);
      if(variant==='truncated-gzip')data.gzip=data.gzip.subarray(0,20);
      if(variant==='missing-gzip')overrides['/research_index.json.gzip']=()=>new Response('missing',{status:404});
      if(variant==='http-gunzip')overrides['/research_index.json.gzip']=()=>new Response(data.gzip,{headers:{'Content-Encoding':'gzip'}});
      if(variant==='metadata-overflow')data.metadata=' '.repeat(1025);
      if(variant==='encoded-overflow')overrides['/research_index.json.gzip']=()=>new Response(data.gzip,{headers:{'Content-Length':String(25*1024*1024+1)}});
      const binding=assets(data,overrides);
      const response=await worker.fetch(new Request('https://site.test/api/data?type=research_index&q=Shahed'),{ASSETS:binding});
      assert.equal(response.status,503);assert.match((await response.json()).error,/integrity/);
      assert.ok(binding.calls.length<=4);
    } finally {fs.rmSync(data.dir,{recursive:true,force:true});}
  });
}

test('encoded body is bounded even without Content-Length and the stream is canceled on overflow',async()=>{
  const data=files(fixture());let canceled=false;
  try {
    const binding=assets(data,{'/research_index.json.gzip':()=>new Response(new ReadableStream({
      pull(controller){controller.enqueue(new Uint8Array(1024*1024));},
      cancel(){canceled=true;}
    }))});
    await assert.rejects(readResearchStaticJSON(binding,'https://site.test/api/data'),/limit/);
    assert.equal(canceled,true);
    assert.equal(binding.calls.length,2);
  } finally {fs.rmSync(data.dir,{recursive:true,force:true});}
});

test('compression never bypasses the existing research freshness gate',async()=>{
  const index=fixture();index.meta.generated_at='2020-01-01T00:00:00Z';
  const data=files(index);
  try {
    const response=await worker.fetch(new Request('https://site.test/api/data?type=research_index&q=Shahed'),{ASSETS:assets(data)});
    assert.equal(response.status,503);
    assert.equal(response.headers.get('X-Data-Freshness'),'stale');
  } finally {fs.rmSync(data.dir,{recursive:true,force:true});}
});
