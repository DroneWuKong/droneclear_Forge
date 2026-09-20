import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

test('Workers runtime reads a corpus above the KV limit without losing records or API detail',async()=>{
  // A supplied immutable corpus provides a reproducible release rehearsal.
  // CI still exercises a real >25 MiB document through the Workers runtime.
  const raw=process.env.KV_JSON_CORPUS ? await readFile(process.env.KV_JSON_CORPUS)
    : Buffer.from(JSON.stringify([{aid:'oversized-article',title:'Large source',body_text:'x'.repeat(26*1024*1024)}]));
  assert.ok(raw.length>25*1024*1024);
  const rows=JSON.parse(raw), compressed=gzipSync(raw,{level:6});
  const metadata={schema:'kv-json-gzip-v1',encoding:'gzip',uncompressed_bytes:raw.length,
    sha256:createHash('sha256').update(raw).digest('hex')};
  const bundled=await build({stdin:{contents:"export {default} from './workers/forge-data.js';",resolveDir:fileURLToPath(new URL('..',import.meta.url))},
    bundle:true,format:'esm',platform:'browser',write:false});
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,
    compatibilityDate:'2026-09-09',kvNamespaces:['PIE_OUTPUTS']}));
  try {
    const kv=await runtime.getKVNamespace('PIE_OUTPUTS');
    await kv.put('intel_articles',compressed,{metadata});
    const response=await runtime.dispatchFetch('http://localhost/api/data?type=intel_articles');
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.deepEqual(payload.data,rows);
    assert.equal(payload.source,'kv');
    const id=String(rows.at(-1).aid || rows.at(-1).id);
    const detail=await runtime.dispatchFetch('http://localhost/api/data?type=intel_articles&record_id='+encodeURIComponent(id));
    assert.equal(detail.status,200);
    assert.equal((await detail.json()).data.record_status,'found');
    console.log(JSON.stringify({corpus_bytes:raw.length,stored_bytes:compressed.length,records:rows.length,sha256:metadata.sha256,runtime:'workerd',full_record_equality:true}));
  } finally {await runtime.dispose();}
});
