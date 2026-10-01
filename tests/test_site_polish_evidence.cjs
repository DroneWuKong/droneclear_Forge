const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const screening=require('../forge-source/catalog-screening.js'),clock=require('../forge-source/clock-score.js');
const NOW=Date.parse('2026-09-30T18:00:00Z'),fresh={generated:'2026-09-30T12:00:00Z',ueri_score:0,factors:{}};
const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
test('missing, non-boolean and conflicting procurement flags remain unknown',()=>{
 for(const record of [null,{}, {ndaa_compliant:'true'},{ndaa_compliant:true,compliance:{ndaa_compliant:false}}]){
  assert.equal(screening.flag(record,'ndaa_compliant'),null);assert.equal(screening.tier(record),'unknown');
 }
 assert.equal(screening.flag({ndaa_compliant:false},'ndaa_compliant'),false);
 assert.equal(screening.flag({compliance:{ndaa_compliant:true}},'ndaa_compliant'),true);
});
test('country alone cannot select an adverse compliance tier',()=>{
 assert.equal(screening.tier({country:'China'}),'unknown');assert.equal(screening.tier({country:'USA'}),'unknown');
});
test('gallery screening uses actual selected records and counts missing evidence',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../forge-source/gallery.html'),'utf8');
 const begin=html.indexOf('var BUILDS = ')+13,end=html.indexOf('\n];',begin)+2;
 const builds=vm.runInNewContext(html.slice(begin,end)),db=JSON.parse(fs.readFileSync(path.join(__dirname,'../forge-source/forge_database.json'),'utf8'));
 const summary=screening.summarize(builds.find(row=>row.cat==='beginner').pids,db.components);
 assert.ok(summary.rows.some(row=>row.pid==='RCV-1016'&&row.ndaa===false));assert.ok(summary.recordedFalse>0);
 assert.equal(screening.summarize(['missing'],db.components).unknown,1);assert.equal(screening.summarize(['missing'],db.components).missing,1);
 assert.ok(builds.every(row=>!('ndaa'in row)&&!('specs'in row)));
});
test('evidence dates and sources are not manufactured from origin or update dates',()=>{
 assert.deepEqual(screening.evidence({origin:'USA',last_updated:'2026-09-30'}),{source:null,verifiedAt:null});
 assert.equal(screening.evidence({doc_url:'javascript:alert(1)'}).source,null);
});
test('clock rejects absent, malformed, stale and future generation dates',()=>{
 assert.equal(clock.inspect({},NOW).status,'invalid-date');assert.equal(clock.inspect({...fresh,generated:'not-a-date'},NOW).status,'invalid-date');
 assert.equal(clock.inspect({...fresh,generated:'2026-04-13T12:00:00Z'},NOW).status,'stale');assert.equal(clock.inspect({...fresh,generated:'2026-10-01T12:00:00Z'},NOW).status,'invalid-future');
 assert.equal(clock.inspect({...fresh,generated:new Date(NOW-clock.MAX_AGE_MS).toISOString()},NOW).status,'fresh');assert.equal(clock.inspect({...fresh,generated:new Date(NOW-clock.MAX_AGE_MS-1).toISOString()},NOW).status,'stale');
});
test('wrapper freshness does not relabel an old artifact as current',()=>{
 assert.equal(clock.inspect({data:{...fresh,generated:'2026-09-18T11:41:09Z'},freshness:{generated_at:fresh.generated}},NOW).status,'stale');
});
test('finite numeric score bounds and missing factor counts preserve zeros/unknowns',()=>{
 for(const value of [null,'50',NaN,Infinity,-1,101])assert.equal(clock.inspect({...fresh,ueri_score:value},NOW).status,'invalid-score');
 assert.equal(clock.inspect(fresh,NOW).status,'fresh');assert.equal(clock.map(fresh).flags.total,null);
 assert.deepEqual(clock.map({...fresh,factors:{flag_severity:{total:0,critical:0,warning:0}}}).flags,{total:0,by_severity:{critical:0,warning:0}});assert.deepEqual(clock.map(fresh).gray_zone,{});
});
test('stale API cannot hide independently fresh static score',async()=>{
 const result=await clock.load(['api','static'],{now:NOW,fetcher:async source=>response(source==='api'?{...fresh,generated:'2026-09-18T11:41:09Z'}:fresh)});
 assert.equal(result.status,'fresh');assert.equal(result.source,'static');assert.equal(result.data.ueri_score,0);assert.equal(result.failures[0].status,'stale');
});
test('all failures fail closed without an embedded score',async()=>{
 const stale=await clock.load(['api','static'],{now:NOW,fetcher:async()=>response({...fresh,generated:'2026-04-13T12:00:00Z'})});assert.equal(stale.status,'stale');assert.equal(stale.data,null);
 const unavailable=await clock.load(['api'],{now:NOW,fetcher:async()=>{throw Error('offline')}});assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.data,null);
});

test('malformed factor structures cannot reach browser rendering',()=>{
 for(const factors of ['invalid',[],{flag_severity:null},{flag_severity:5}])assert.equal(clock.inspect({...fresh,factors},NOW).status,'invalid-shape');
});
