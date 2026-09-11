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
  assert.equal(record.date,'');assert.equal(record.observed_at,'2026-09-11');assert.ok(record.citations.every(citation=>!citation.date));
  assert.equal(normal.dates({date:'2026-02-30'},{}).pub_date,'');assert.equal(ask.parseDate('2026-02-30'),null);
});

test('flag cards label observed and source dates separately while preserving exact links and citation anchors',()=>{
  const record=ask.compactRecord(ask.flagRecords([{id:'F / #1',title:'Shahed signal',timestamp:'2026-05-29T14:00:00Z',sources:[{title:'Source',url:'https://source.test/report#section'}]}])[0]);
  const packet=ask.evidencePacket(ask.rankEvidence([record],'Shahed'),'Shahed');
  const markup=ask.renderResult(packet.ranked[0],packet);
  assert.equal(record.date,'');assert.equal(record.source_published_at,'');assert.equal(record.observed_at,'2026-05-29T14:00:00Z');
  assert.match(markup,/<span>Source published: unknown<\/span>/);
  assert.match(markup,/<span>Observed: May 29, 2026<\/span>/);
  assert.match(markup,/href="\/patterns\/#flag=F%20%2F%20%231"/);
  assert.match(markup,/href="#citation-1"/);
  const bibliography=ask.renderCitation(packet.citations[0],1);
  assert.match(bibliography,/id="citation-1"/);assert.match(bibliography,/href="https:\/\/source.test\/report#section"/);
  assert.match(bibliography,/Source published: unknown/);
  const saved=ask.savedPacket(packet,{}).ranked[0].record;
  assert.equal(saved.source_published_at,'');assert.equal(saved.observed_at,record.observed_at);
});

test('explicit flag source dates survive compaction independently of pipeline observations',()=>{
  const record=ask.compactRecord(ask.flagRecords([{id:'dated',title:'Shahed signal',last_seen:'2026-09-11',source_published_at:'2026-08',source_url:'https://source.test/report'}])[0]);
  assert.equal(record.date,'2026-08');assert.equal(record.source_published_at,'2026-08');assert.equal(record.observed_at,'2026-09-11');
  const packet=ask.evidencePacket(ask.rankEvidence([record],'Shahed'),'Shahed');
  assert.match(ask.renderResult(packet.ranked[0],packet),/Source published: 2026-08 \(source precision\)/);
  assert.match(ask.renderResult(packet.ranked[0],packet),/Observed: Sep 11, 2026/);
  assert.equal(packet.citations[0].date,'2026-08');
});

test('legacy flag observation dates neither gain source recency nor satisfy publication-date filters',()=>{
  const legacy={...ask.compactRecord(ask.flagRecords([{id:'old',title:'Shahed signal'}])[0]),date:'2026-09-10'};
  delete legacy.source_published_at;delete legacy.observed_at;
  const undated={...legacy,date:''};
  assert.equal(ask.scoreRecord(legacy,'Shahed',{now:'2026-09-11'}).score,ask.scoreRecord(undated,'Shahed',{now:'2026-09-11'}).score);
  const index={schema_version:1,meta:{},records:[legacy],counts:{flag:1}};
  assert.equal(ask.projectResearch(index,new URLSearchParams({after:'2026-09-01'})).total_matches,0);
  const projected=ask.projectResearch(index,new URLSearchParams({record:'flag:old'})).records[0];
  assert.equal(projected.date,'');assert.equal(projected.source_published_at,'');assert.equal(projected.observed_at,'2026-09-10');
  const packet=ask.evidencePacket(ask.rankEvidence([legacy],'Shahed'),'Shahed');
  const markup=ask.renderResult(packet.ranked[0],packet);
  assert.match(markup,/Source published: unknown/);assert.match(markup,/Observed: Sep 10, 2026/);
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

test('question scaffolding is excluded from coverage while domain phrases remain searchable',()=>{
  assert.deepEqual(ask.queryTerms('What records describe ModalAI visual inertial odometry or onboard compute?'),['modalai','visual','inertial','odometry','onboard','compute']);
  assert.deepEqual(ask.queryTerms('What public records mention BVLOS waivers for drone as first responder programs?'),['bvlos','waivers','drone','first','responder','programs']);
  assert.deepEqual(ask.queryTerms('What records describe public safety flight records?'),['public','safety','flight','records']);
});

test('Q025 exact indexed ModalAI subject precedes Skydio and excludes a records-only minister article',()=>{
  const records=[
    ...ask.flagRecords([{id:'0965070b85ef',title:'Nav/PNT: Skydio Visual-Inertial Odometry',detail:'Skydio visual inertial odometry uses cameras.'}]),
    ...ask.genericRecords([{id:'modalai',name:'ModalAI',capability:'visual inertial odometry'}],'entity','entities'),
    ...ask.articleRecords([{aid:'ART-3976',title:'Emergency call records deepen probe into former Turkish minister’s death',url:'https://source.test/minister'},
      {aid:'modalai-report',title:'ModalAI onboard compute',summary:'Visual inertial odometry',url:'https://source.test/modalai'}])
  ].map(ask.compactRecord);
  const index={schema_version:1,meta:{},records};
  const q='What records describe ModalAI visual inertial odometry or onboard compute?';
  const result=ask.projectResearch(index,new URLSearchParams({q}));
  assert.deepEqual(result.ranked.map(item=>item.record.id),['modalai-report','modalai','0965070b85ef']);
  assert.ok(result.ranked.slice(0,2).every(item=>item.ranking.matchedSubjects.includes('modalai')));
  assert.equal(result.ranked[1].ranking.coverage,4/6);
  assert.deepEqual(ask.rankEvidence(records,q).map(item=>item.record.id),result.ranked.map(item=>item.record.id));
  // Type filtering must not discard the entity vocabulary used by the query.
  assert.deepEqual(ask.projectResearch(index,new URLSearchParams({q,record_type:'article'})).ranked.map(item=>item.record.id),['modalai-report']);
  const missing=ask.projectResearch(index,new URLSearchParams({q:'What records describe ModalAIX onboard compute?'}));
  assert.ok(missing.ranked.every(item=>!item.ranking.matchedSubjects.includes('modalai')));
});

test('known subject phrases require exact token boundaries without merging distinct actors',()=>{
  const records=[...ask.genericRecords([{id:'firestorm labs',name:'Firestorm Labs'}],'entity','entities'),
    ...ask.articleRecords([{aid:'exact',title:'Firestorm Labs manufacturing',url:'https://source.test/exact'},
      {aid:'different',title:'Firestorm LabsX manufacturing',url:'https://source.test/different'}])].map(ask.compactRecord);
  assert.deepEqual(ask.rankEvidence(records,'What public records discuss Firestorm Labs manufacturing?').map(item=>item.record.id),['exact','firestorm labs','different']);
  const actors=ask.actorRecords({actors:[{actor:'Ukraine / HUR (GUR)'},{actor:'Ukraine / SBU'}]});
  assert.deepEqual(ask.rankEvidence(actors,'Ukraine / HUR (GUR)').map(item=>item.record.id),['Ukraine / HUR (GUR)','Ukraine / SBU']);
});

test('ordinary General wording cannot impose an entity priority or exclude procurement results',()=>{
  const records=[...ask.genericRecords([{id:'general',name:'General'}],'entity','entities'),
    ...ask.articleRecords([{aid:'procurement',title:'Drone procurement',summary:'Public procurement practices',url:'https://source.test/procurement'},
      {aid:'staff',title:'General staff news',url:'https://source.test/staff'}])].map(ask.compactRecord);
  const result=ask.rankEvidence(records,'general drone procurement');
  assert.equal(result[0].record.id,'procurement');
  assert.ok(result.every(item=>item.ranking.matchedSubjects.length===0));
});

test('short and overlapping exact names retain both sides of comparisons',()=>{
  for(const names of [['FT','DJI'],['3B','DJI'],['Alpha','Alpha Labs']]) {
    const records=[...ask.genericRecords(names.map(name=>({id:name,name})),'entity','entities'),
      ...ask.articleRecords(names.map(name=>({aid:'article-'+name,title:name+' flight controllers',url:'https://source.test/'+encodeURIComponent(name)})))].map(ask.compactRecord);
    const result=ask.rankEvidence(records,`Compare ${names[0]} and ${names[1]} flight controllers`);
    for(const name of names) {
      assert.ok(result.find(item=>item.record.id===name)?.ranking.matchedSubjects.includes(name.toLowerCase()));
      assert.ok(result.find(item=>item.record.id==='article-'+name)?.ranking.matchedSubjects.includes(name.toLowerCase()));
    }
  }
});

test('rare waiver evidence beats generic DFR overlap and publisher boilerplate contributes no matches',()=>{
  const records=ask.articleRecords([
    {aid:'generic',title:'Drone as First Responder programs',summary:'Public records',url:'https://source.test/generic'},
    {aid:'specific',title:'BVLOS waivers for drone programs',summary:'First responder approvals',url:'https://source.test/specific'},
    ...Array.from({length:30},(_,i)=>({aid:'background'+i,title:'Drone programs and first responder update '+i,url:'https://source.test/background'+i})),
    {aid:'portal',title:'Other news',summary:'The information portal for unmanned air system traffic management (UTM) and counter-UAS (C-UAS) systems',url:'https://source.test/portal'}
  ]).map(ask.compactRecord);
  const ranked=ask.rankEvidence(records,'What public records mention BVLOS waivers for drone as first responder programs?');
  assert.equal(ranked[0].record.id,'specific');assert.equal(ranked[0].ranking.direct,true);
  assert.ok(ranked[0].ranking.weightedCoverage>ranked[1].ranking.weightedCoverage);
  assert.equal(ask.rankEvidence([records.at(-1)],'unmanned systems').length,0);
});

test('fragment-only article variants share one result while preserving every exact identity and citation',()=>{
  const base='https://dronelife.com/2026/04/22/airdata-brinc-integration-public-safety-drone-records/';
  const rows=[{aid:'bf_06f405f4138b',title:'AirData and BRINC flight records',summary:'Drone programs',url:base},
    {aid:'bf_d689c12168d7',title:'AirData and BRINC flight records',summary:'Other excerpt',url:base+'#comments'},
    {aid:'query-a',title:'AirData and BRINC flight records',url:base+'?edition=A'},
    {aid:'query-b',title:'AirData and BRINC flight records',url:base+'?edition=B'},
    {aid:'different-title',title:'Different publication at a reused URL',url:base}];
  const records=ask.articleRecords(rows).map(ask.compactRecord);
  const original=JSON.stringify(records), index={schema_version:1,meta:{},records};
  const result=ask.projectResearch(index,new URLSearchParams({q:'AirData BRINC',limit:'1'}));
  // The reused-URL title also matches via its original source URL, but remains a
  // distinct publication rather than being merged into the fragment group.
  assert.equal(result.total_matches,4);assert.equal(result.ranked.length,1);
  const grouped=result.ranked[0].record;
  assert.equal(grouped.sourceAliases.length,2);assert.equal(grouped.citations.length,2);assert.equal(grouped.canonicalSourceUrl,base);
  for(const record of records) {
    const exact=ask.projectResearch(index,new URLSearchParams({record:record.key}));
    assert.equal(exact.record_status,'found');assert.equal(exact.records[0].sourceUrl,record.sourceUrl);assert.equal(exact.records[0].summary,record.summary);
  }
  assert.equal(ask.projectResearch(index,new URLSearchParams()).total_matches,4);
  const page2=ask.projectResearch(index,new URLSearchParams({q:'AirData BRINC',limit:'1',offset:'1'}));
  assert.notEqual(page2.ranked[0].record.key,grouped.key);
  const packet=ask.evidencePacket(result.ranked,'AirData BRINC');
  assert.equal(ask.savedPacket(packet,{}).citations.length,2);
  const markup=ask.renderResult(result.ranked[0],packet);
  assert.match(markup,/2 indexed versions/);assert.match(markup,/not independent corroboration/);
  for(const alias of grouped.sourceAliases)assert.ok(markup.includes(encodeURIComponent(alias.key)));
  assert.equal(JSON.stringify(records),original);
  index.records.reverse();assert.deepEqual(ask.projectResearch(index,new URLSearchParams({q:'AirData BRINC',limit:'1'})),result);
  // The non-matching fragment variant still contributes its exact alias/citation.
  const limited=ask.projectResearch(index,new URLSearchParams({q:'programs'}));
  assert.equal(limited.ranked[0].record.sourceAliases.length,2);
});

test('same-title tracker records at one URL remain separate across publication dates',()=>{
  const records=ask.articleRecords([
    {aid:'april',title:'Air Defence: 1 Iskander launched',url:'https://source.test/tracker',pub_date:'2026-04-16'},
    {aid:'august',title:'Air Defence: 1 Iskander launched',url:'https://source.test/tracker',pub_date:'2026-08-28'},
    {aid:'august-comments',title:'Air Defence: 1 Iskander launched',url:'https://source.test/tracker#comments',pub_date:'2026-08-28'},
    {aid:'unknown',title:'Air Defence: 1 Iskander launched',url:'https://source.test/tracker#unknown'}
  ]).map(ask.compactRecord);
  const data={schema_version:1,meta:{},records};
  const result=ask.projectResearch(data,new URLSearchParams({q:'Iskander'}));
  assert.equal(result.total_matches,3);
  const group=result.ranked.find(row=>row.record.sourceAliases);
  assert.equal(group.record.date,'2026-08-28');assert.equal(group.record.sourceAliases.length,2);
  assert.equal(group.record.citations.length,2);
  assert.equal(result.ranked.find(row=>row.record.id==='april').record.citations[0].date,'2026-04-16');
  assert.ok(result.ranked.some(row=>row.record.id==='unknown'));
});

test('oversized source cohorts retain original rows, full citations, bounded responses and honest exports',()=>{
  const records=ask.articleRecords(Array.from({length:600},(_,i)=>({aid:'version-'+i,title:'Drone source report',url:'https://source.test/'+ 'a'.repeat(900)+'#version-'+i,pub_date:'2026-09-01'}))).map(ask.compactRecord);
  const data={schema_version:1,meta:{},records};
  const first=ask.projectResearch(data,new URLSearchParams({q:'drone',limit:'1'}));
  assert.equal(first.total_matches,600);assert.equal(first.ranked.length,1);
  assert.ok(Buffer.byteLength(JSON.stringify(first))<100000);
  assert.equal(first.ranked[0].record.sourceGroupingLimited,true);
  assert.equal(first.ranked[0].record.sourceVersionCount,600);
  assert.equal(first.ranked[0].record.sourceAliases,undefined);
  const packet=ask.evidencePacket(first.ranked,'drone'),saved=ask.savedPacket(packet,{});
  assert.equal(saved.citations.length,1);assert.equal(saved.ranked[0].record.sourceGroupingLimited,true);
  assert.match(ask.renderResult(first.ranked[0],packet),/Records remain separate with their own citations/);
  const keys=new Set(),citations=new Set();
  for(let offset=0;offset<600;offset+=100){
    const page=ask.projectResearch(data,new URLSearchParams({q:'drone',limit:'100',offset:String(offset)}));
    for(const {record} of page.ranked){keys.add(record.key);for(const citation of record.citations)citations.add(citation.url);}
  }
  assert.equal(keys.size,600);assert.equal(citations.size,600);
});
