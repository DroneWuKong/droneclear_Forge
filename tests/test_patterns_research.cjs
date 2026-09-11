const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ask=require('../forge-source/ask-pie-retrieval.js');
const normal=require('../forge-source/intel-normalization.js');
const signals=require('../forge-source/dossier-signals.js');
const {buildResearchIndex}=require('../tools/build_research_index.cjs');
const article=(id,url=`https://source.test/${id}`)=>({aid:id,title:`Shahed supply chain ${id}`,summary:'Component supply reporting',url,site:'Publisher',pub_date:'2026-09-01',body_text:'large body '.repeat(2000)});
function fixture(n=48){return {schema_version:1,meta:{generated_at:'2026-09-11T00:00:00Z',input_revision:'fixed'},counts:{article:n},records:ask.articleRecords(Array.from({length:n},(_,i)=>article(String(i)))).map(ask.compactRecord)};}
test('48 matching records keep every citation in displayed and exported packets',()=>{
  const result=ask.projectResearch(fixture(),new URLSearchParams({q:'Shahed',limit:'48'}));
  const packet=ask.evidencePacket(result.ranked,'Shahed');
  assert.equal(packet.citations.length,48);
  for(const {record} of packet.ranked) assert.equal(ask.citationNumbers(record,packet).length,record.citations.length);
  const saved=ask.savedPacket(packet,{meta:result.meta});
  assert.equal(saved.citations.length,48);assert.equal(saved.publication.meta.input_revision,'fixed');
  assert.equal(JSON.stringify(saved).includes('large body'),false);
});
test('per-record eight-reference cap does not cap complete packet bibliography',()=>{
  const rows=Array.from({length:48},(_,i)=>({id:'F'+i,title:'Shahed supply',sources:Array.from({length:10},(_,j)=>({url:`https://source.test/${i}/${j}`}))}));
  const records=ask.flagRecords(rows);const packet=ask.evidencePacket(ask.rankEvidence(records,'Shahed',{limit:48}),'Shahed');
  assert.equal(packet.citations.length,384);
});
test('distinct URLs with punctuation and case do not collapse into one citation',()=>{
  const values=['https://source.test/A','https://source.test/a','https://source.test/path?a=b','https://source.test/path/a/b'].map(url=>ask.normalizeCitation({url}));
  assert.equal(ask.dedupeCitations(values).length,4);
});
test('untrusted URL schemes, credentials and oversized citations are rejected',()=>{
  assert.equal(ask.normalizeCitation({url:'javascript:alert(1)'}),null);
  assert.equal(ask.normalizeCitation({url:'https://user:password@source.test/'}),null);
  assert.equal(ask.normalizeCitation({url:'https://source.test/'+ 'a'.repeat(3000)}),null);
});
test('research responses cap records and omit full search index and raw bodies',()=>{
  const data=fixture(150);
  const response=ask.projectResearch(data,new URLSearchParams({q:'Shahed',limit:'999999'}));
  assert.equal(response.ranked.length,100);assert.equal(response.total_matches,150);
  assert.equal(response.ranked[0].record.raw,undefined);assert.equal(response.ranked[0].record.searchText,undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(response))<1000000);
  const summary=ask.projectResearch(data,new URLSearchParams({view:'summary'}));assert.equal(summary.records.length,0);
});
test('queries and exact links preserve identities and explicitly refuse missing or ambiguous IDs',()=>{
  const data=fixture(2);
  assert.equal(ask.projectResearch(data,new URLSearchParams({record:'article:0'})).record_status,'found');
  assert.equal(ask.projectResearch(data,new URLSearchParams({record:'article:missing'})).record_status,'missing');
  data.records.push({...data.records[0],title:'Different record sharing ID'});
  const ambiguous=ask.projectResearch(data,new URLSearchParams({record:'article:0'}));assert.equal(ambiguous.record_status,'ambiguous');assert.deepEqual(ambiguous.records,[]);
});
test('empty, stopword and restrictive type queries behave explicitly',()=>{
  const data=fixture();
  assert.equal(ask.projectResearch(data,new URLSearchParams({q:'what is the'})).total_matches,0);
  assert.equal(ask.projectResearch(data,new URLSearchParams({q:'Shahed',record_type:'flag'})).total_matches,0);
  assert.equal(ask.projectResearch(data,new URLSearchParams({q:'Shahed',after:'2026-09-02'})).total_matches,0);
});
test('reordering records does not change search order or synthetic IDs',()=>{
  const data=fixture();const before=ask.projectResearch(data,new URLSearchParams({q:'Shahed'}));data.records.reverse();
  assert.deepEqual(ask.projectResearch(data,new URLSearchParams({q:'Shahed'})),before);
  const rows=[{title:'One',url:'https://source.test/one'},{title:'Two',url:'https://source.test/two'}];
  assert.equal(ask.articleRecords(rows)[0].id,ask.articleRecords(rows.slice().reverse())[1].id);
});
test('unknown reference dates remain unknown and missing URLs never gain publisher homepages',()=>{
  const row=normal.defenseRecords({meta:{last_updated:'2026-09-11'},contracts:[{program:'Program A',awardee:'Acme'}]})[0];
  assert.equal(row.pub_date,'');assert.equal(row.date_precision,'unknown');assert.equal(row.url,'');assert.equal(row.citation_status,'missing');assert.equal(row.reference_as_of,'2026-09-11');
  assert.equal(normal.dates({date:'2026'},{}).date_precision,'year');
  assert.equal(normal.dates({date:'2026-07'},{}).date_precision,'month');
  assert.equal(normal.dates({date:'spring'},{}).pub_date,'');
});
test('reference IDs remain attached to their original identity after reorder',()=>{
  const contracts=[{program:'One',awardee:'Acme'},{program:'Two',awardee:'Zeta'}];
  assert.equal(normal.defenseRecords({contracts})[0].id,normal.defenseRecords({contracts:contracts.slice().reverse()})[1].id);
});
test('shared generic words do not attach flags; exact structured identities and contextual names carry reasons',()=>{
  const flags=[{id:'F1',title:'Acme production update',entity:'Acme',status:'new'},{id:'F2',title:'Acme support announcement',entity:'all'},{id:'F3',title:'Other production update',entity:'Other'},{id:'F4',title:'Acme old issue',entity:'Acme',status:'resolved'}];
  assert.deepEqual(normal.relatedFlags({title:'Production update technology platform'},flags,signals),[]);
  const matches=normal.relatedFlags({entities:{companies:['Acme']}},flags,signals);
  assert.deepEqual(matches.map(row=>row.id),['F1','F2']);assert.equal(matches[0]._match_confidence,'direct');assert.equal(matches[1]._match_confidence,'contextual');
});
test('saved packets retain snapshots and surface quota failures instead of pretending success',()=>{
  const map=new Map();const storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};
  const packet=ask.evidencePacket(ask.projectResearch(fixture(),new URLSearchParams({q:'Shahed'})).ranked,'Shahed');
  ask.writeSaved(storage,ask.savedPacket(packet,{meta:{input_revision:'original'}}));
  assert.equal(ask.readSaved(storage)[0].publication.meta.input_revision,'original');
  assert.throws(()=>ask.writeSaved({getItem:()=>null,setItem:()=>{throw new Error('Quota');}},ask.savedPacket(packet,{})),/Quota/);
});
test('generator records input bytes and revision, preserves source age, and excludes full bodies',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-index-test-'));
  try {
    fs.writeFileSync(path.join(dir,'intel_articles.json'),JSON.stringify([article('a')]));
    fs.writeFileSync(path.join(dir,'flags.json'),JSON.stringify([{id:'F',title:'Shahed',last_verified_at:'2026-09-01T00:00:00Z'}]));
    const index=buildResearchIndex(dir,{generatedAt:'2026-09-11T00:00:00Z',revision:'commit'});
    assert.equal(index.meta.publication_revision,null);assert.equal(index.meta.requested_publication_revision,'commit');assert.equal(index.meta.publication_consistency,'local_snapshot');assert.equal(index.meta.inputs.intel_articles.sha256.length,64);
    assert.equal(ask.projectResearch(index,new URLSearchParams({record:'flag:F'})).records[0].dataset_status,'historical snapshot');
    assert.equal(index.meta.availability,'partial');assert.equal(JSON.stringify(index).includes('large body'),false);
    assert.equal(buildResearchIndex(dir,{generatedAt:'2026-09-12T00:00:00Z'}).meta.input_revision,index.meta.input_revision);
  } finally { for(const entry of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,entry));fs.rmdirSync(dir); }
});

test('observation dates do not become publication dates in supporting citations',()=>{
  const record=ask.flagRecords([{id:'F',title:'Signal',date:'2026-09-11',source_url:'https://example.test/a',sources:[{url:'https://example.test/b'}]}])[0];
  assert.equal(record.date,'2026-09-11');assert.ok(record.citations.every(citation=>!citation.date));
  assert.equal(normal.dates({date:'2026-02-30'},{}).pub_date,'');assert.equal(ask.parseDate('2026-02-30'),null);
});

test('collector-local article IDs use distinct stable record keys',()=>{
  const rows=ask.articleRecords([{aid:'ART-1',title:'One',site:'one',url:'https://one.test/a'},{aid:'ART-1',title:'Two',site:'two',url:'https://two.test/a'}]).map(ask.compactRecord);
  assert.notEqual(ask.recordKey(rows[0]),ask.recordKey(rows[1]));
  const data={schema_version:1,meta:{},counts:{article:2},records:rows};
  assert.equal(ask.projectResearch(data,new URLSearchParams({record:ask.recordKey(rows[0])})).records[0].title,'One');
  assert.equal(ask.projectResearch(data,new URLSearchParams({record:'article:ART-1'})).record_status,'ambiguous');
});

test('mixed publication input origins cannot claim one pinned upstream revision',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-origin-test-'));
  try {
    const articles=JSON.stringify([article('a')]), flags=JSON.stringify([{id:'F',title:'Shahed'}]);
    const hash=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
    fs.writeFileSync(path.join(dir,'intel_articles.json'),articles);fs.writeFileSync(path.join(dir,'flags.json'),flags);
    const manifest={schema_version:1,inputs:{'intel-db/articles.json':{status:'selected_input',origin:'pinned_selected_input',revision_verified:true,upstream_ref:'a'.repeat(40),sha256:hash(articles),destinations:['intel_articles.json']},'flags.json':{status:'missing_in_selected_input',origin:'retained_local_fallback',revision_verified:false,destinations:['flags.json'],fallback_artifacts:{'flags.json':{sha256:hash(flags)}}}}};
    fs.writeFileSync(path.join(dir,'publication_inputs.json'),JSON.stringify(manifest));
    const index=buildResearchIndex(dir,{revision:'a'.repeat(40)});
    assert.equal(index.meta.publication_revision,null);assert.equal(index.meta.publication_consistency,'mixed_sources');
    assert.equal(index.meta.inputs.intel_articles.origin,'pinned_selected_input');assert.equal(index.meta.inputs.flags.origin,'retained_local_fallback');
    const record=ask.projectResearch(index,new URLSearchParams({record:'flag:F'})).records[0];assert.equal(record.dataset_origin,'retained_local_fallback');assert.equal(record.dataset_revision,null);
    fs.writeFileSync(path.join(dir,'flags.json'),'[{"id":"F2","title":"changed"}]');
    assert.equal(buildResearchIndex(dir).meta.inputs.flags.origin,'unreconciled_artifact');
  } finally {for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);}
});
