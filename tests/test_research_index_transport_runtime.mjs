import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import builder from '../tools/build_research_index.cjs';
import ask from '../forge-source/ask-pie-retrieval.js';

test('workerd and real asset binding preserve an oversized research corpus and its HTTP encoding',async()=>{
  const repo=fileURLToPath(new URL('..',import.meta.url));
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'research-runtime-'));
  const inputDir=process.env.RESEARCH_INDEX_BUILD || scratch;
  let runtime;
  try {
    if(!process.env.RESEARCH_INDEX_BUILD) {
      // Normal CI proves the same path with a complete >25 MiB index; release
      // rehearsal supplies the exact built immutable upstream corpus instead.
      const rows=Array.from({length:16000},(_,i)=>({aid:String(i),title:'Shahed evidence '+i,
        summary:'Evidence for component supply and manufacturing. '.repeat(25),url:'https://source.test/'+i}));
      fs.writeFileSync(path.join(inputDir,'intel_articles.json'),JSON.stringify(rows));
      builder.writeResearchIndex(builder.buildResearchIndex(inputDir),path.join(inputDir,'research_index.json'));
      fs.copyFileSync(path.join(repo,'_headers'),path.join(inputDir,'_headers'));
    }
    const metadata=JSON.parse(fs.readFileSync(path.join(inputDir,'research_index.metadata.json')));
    const compressed=fs.readFileSync(path.join(inputDir,'research_index.json.gzip'));
    const raw=gunzipSync(compressed), index=JSON.parse(raw);
    assert.ok(raw.length>25*1024*1024);
    assert.ok(compressed.length<=25*1024*1024);
    assert.equal(raw.length,metadata.uncompressed_bytes);
    assert.equal(createHash('sha256').update(raw).digest('hex'),metadata.sha256);
    const rebuilt=builder.buildResearchIndex(inputDir,{generatedAt:index.meta.generated_at,revision:index.meta.requested_publication_revision});
    assert.deepEqual(index,rebuilt);
    const articles=JSON.parse(fs.readFileSync(path.join(inputDir,'intel_articles.json')));
    // The established generator removes exact duplicate compact rows. Transport
    // preserves its entire output and every original source identity, including
    // source corpora that repeat an identical article more than once.
    const expectedKeys=[...new Set(ask.articleRecords(articles).map(ask.recordKey))].sort();
    assert.deepEqual([...new Set(index.records.filter(row=>row.type==='article').map(ask.recordKey))].sort(),expectedKeys);
    const bundled=await build({stdin:{contents:"import worker from './workers/forge-data.js'; export default {fetch(request,env,ctx){return new URL(request.url).pathname==='/api/data'?worker.fetch(request,env,ctx):env.ASSETS.fetch(request);}};",resolveDir:repo},
      bundle:true,format:'esm',platform:'browser',write:false});
    runtime=new Miniflare(convertV4MiniflareOptions({name:'research-test',modules:true,script:bundled.outputFiles[0].text,
      compatibilityDate:'2026-09-09',assets:{directory:inputDir,binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}}}));
    const asset=await runtime.dispatchFetch('http://localhost/research_index.json.gzip',{headers:{'Accept-Encoding':'identity'}});
    assert.equal(asset.status,200,asset.ok ? '' : await asset.text());
    assert.match(asset.headers.get('Content-Type'),/^application\/gzip/);
    // Fetch implementations may normalize an identity coding to no header.
    assert.ok([null,'identity'].includes(asset.headers.get('Content-Encoding')));
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()),compressed);
    const last=index.records.filter(row=>row.type==='article').at(-1);
    for(const query of ['view=summary','q=Shahed&limit=7','record='+encodeURIComponent(ask.recordKey(last))]) {
      const response=await runtime.dispatchFetch('http://localhost/api/data?type=research_index&'+query);
      assert.equal(response.status,200);
      const payload=await response.json();
      assert.equal(payload.source,'static:/research_index.json.gzip');
      assert.deepEqual(payload.data,JSON.parse(JSON.stringify(ask.projectResearch(index,new URLSearchParams(query)))));
    }
    console.log(JSON.stringify({runtime:'workerd',articles:articles.length,records:index.records.length,index_bytes:raw.length,
      stored_bytes:compressed.length,sha256:metadata.sha256,full_index_equality:true,search_and_detail_equal:true}));
  } finally {
    if(runtime)await runtime.dispose();
    fs.rmSync(scratch,{recursive:true,force:true});
  }
});
