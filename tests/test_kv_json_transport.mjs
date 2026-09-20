import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {decodeKVJSON, readKVJSON, KV_JSON_LIMITS} from '../workers/kv-json-transport.mjs';
import worker from '../workers/forge-data.js';

const bytes = value => Buffer.from(value, 'utf8');
function encoded(raw) {
  const source = typeof raw === 'string' ? bytes(raw) : raw;
  return {value:gzipSync(source),metadata:{schema:'kv-json-gzip-v1',encoding:'gzip',
    uncompressed_bytes:source.length,sha256:createHash('sha256').update(source).digest('hex')}};
}
const decode = ({value,metadata}, limits) => decodeKVJSON(value,metadata,limits);
const request = suffix => new Request('https://uas-patterns.com/api/data?type=intel_articles'+suffix);

test('gzip round trip preserves every original UTF-8 byte, whitespace and duplicate records',async()=>{
  const raw='[\r\n {"aid":"same","title":"Drone café 日本 🚁"},\n {"aid":"same","title":"Second version"}\n]\r\n';
  assert.equal(await decode(encoded(raw)),raw);
  assert.equal(await decodeKVJSON(bytes(raw),null),raw);
  assert.equal(await decodeKVJSON(null,null),null);
});
test('one atomic metadata read supports legacy plain values and never fetches a second key',async()=>{
  for (const document of [encoded('[1,2]'),{value:bytes('[1,2]'),metadata:null}]) {
    const reads=[];
    assert.equal(await readKVJSON({getWithMetadata:async(key,type)=>{reads.push([key,type]);return document;},get:()=>assert.fail('non-atomic read')},'intel_articles'),'[1,2]');
    assert.deepEqual(reads,[['intel_articles','arrayBuffer']]);
  }
});
test('unknown codecs, schema, metadata, noninteger size, excessive size and malformed hashes reject',async()=>{
  const document=encoded('[1,2]');
  for (const metadata of [false,'gzip',[],{}, {...document.metadata,encoding:'br'}, {...document.metadata,schema:'future-v2'},
    {...document.metadata,uncompressed_bytes:0}, {...document.metadata,uncompressed_bytes:1.5},
    {...document.metadata,uncompressed_bytes:KV_JSON_LIMITS.decoded+1}, {...document.metadata,sha256:'x'.repeat(64)}]) {
    await assert.rejects(decode({...document,metadata}),{code:'KV_JSON_TRANSPORT'});
  }
});
test('corruption, truncation, digest mismatch and inaccurate decoded lengths reject',async()=>{
  const document=encoded('[1,2]');
  const changed=Buffer.from(document.value);changed[changed.length-8]^=1;
  for (const bad of [{...document,value:changed},{...document,value:document.value.subarray(0,-3)},
    {...document,metadata:{...document.metadata,sha256:'0'.repeat(64)}},
    {...document,metadata:{...document.metadata,uncompressed_bytes:4}},
    {...document,metadata:{...document.metadata,uncompressed_bytes:6}}]) {
    await assert.rejects(decode(bad),{code:'KV_JSON_TRANSPORT'});
  }
});
test('stream inflation stops at declared limit and rejects encoded overflow before inflation',async()=>{
  const bomb=encoded(' '.repeat(1024*1024));
  await assert.rejects(decode({...bomb,metadata:{...bomb.metadata,uncompressed_bytes:32}}),/exceeds its declared size/);
  await assert.rejects(decode(bomb,{encoded:bomb.value.length-1,decoded:2*1024*1024}),/Stored JSON exceeds/);
  await assert.rejects(decodeKVJSON(bytes('[]'),null,{encoded:10,decoded:1}),/Decoded JSON exceeds/);
});
test('invalid UTF-8 is rejected for both formats even with a matching digest',async()=>{
  const raw=Buffer.from([0x5b,0x22,0xff,0x22,0x5d]);
  await assert.rejects(decode(encoded(raw)),/not valid UTF-8/);
  await assert.rejects(decodeKVJSON(raw,null),/not valid UTF-8/);
});
test('compressed API preserves complete response shape and exact article detail projection',async()=>{
  const rows=[{aid:'1',title:'Drone café',body_text:'Complete first record'},{aid:'2',title:'日本',body_text:'Second record'}];
  const env={PIE_OUTPUTS:{getWithMetadata:async()=>encoded(JSON.stringify(rows))}};
  const response=await worker.fetch(request(''),env);assert.equal(response.status,200);
  const payload=await response.json();assert.deepEqual(payload.data,rows);assert.equal(payload.source,'kv');assert.equal(payload.type,'intel_articles');
  const detail=await (await worker.fetch(request('&record_id=2'),env)).json();
  assert.equal(detail.data.record_status,'found');assert.equal(detail.data.record.body_excerpt,'Second record');
});
test('transport corruption fails closed, with existing static fallback explicitly identified',async()=>{
  const bad=encoded('[1]');bad.metadata.sha256='0'.repeat(64);
  const env={PIE_OUTPUTS:{getWithMetadata:async()=>bad}};
  const failed=await worker.fetch(request(''),env);assert.equal(failed.status,503);
  assert.match((await failed.json()).error,/transport integrity/);
  const fallback=await worker.fetch(request(''),{...env,ASSETS:{fetch:async()=>new Response('[{"aid":"fallback"}]')}});
  assert.equal(fallback.status,200);assert.equal(fallback.headers.get('X-Data-Fallback'),'kv:503');
  assert.equal((await fallback.json()).source,'static:/intel_articles.json');
});
