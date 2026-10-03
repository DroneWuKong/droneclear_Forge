const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ask=require('../forge-source/ask-pie-retrieval.js');
const values=require('../forge-source/builder-values.js');
function index(rows){return {schema_version:1,meta:{generated_at:'2026-10-03T12:00:00Z'},records:ask.articleRecords(rows).map(ask.compactRecord)};}
function article(id,title,date='2026-10-01'){return {aid:id,title,pub_date:date,url:'https://example.test/'+id};}
test('UAS selection happens across the corpus before pagination and does not accept publisher boilerplate',()=>{
 const data=index([...Array.from({length:150},(_,i)=>({...article('sports'+i,'Baseball results','2026-10-03'),site:'UAS Daily',entities:{companies:['Drone Inc']}})),article('uas','Drone delivery program expands','2026-09-01')]);
 const result=ask.projectResearch(data,new URLSearchParams({record_type:'article',scope:'uas',limit:'1'}));
 assert.equal(result.total_matches,1);assert.equal(result.records[0].id,'uas');assert.equal(result.query.scope,'uas');
 assert.equal(ask.projectResearch(data,new URLSearchParams({scope:'all-articles'})).total_matches,151);
});
test('future and missing source dates remain inspectable but do not displace dated news',()=>{
 const data=index([article('future','Drone report','23.11.2026 15:21'),article('missing','Drone report','not a date'),article('past','Drone report','2026-09-29')]);
 const result=ask.projectResearch(data,new URLSearchParams({scope:'uas'}));
 assert.deepEqual(result.records.map(r=>r.id),['past','future','missing']);
 assert.equal(result.records[1].date,'23.11.2026 15:21');assert.equal(result.records[1].source_date_status,'future');assert.equal(result.records[2].source_date_status,'unknown');
});
test('article metadata and stable pagination survive compact projection',()=>{
 const data=index([{...article('a','UAS article'),article_type:'commercial',vertical:'dfr'},article('b','UAV article')]);
 const first=ask.projectResearch(data,new URLSearchParams({scope:'uas',limit:'1'}));
 const second=ask.projectResearch(data,new URLSearchParams({scope:'uas',limit:'1',offset:'1'}));
 assert.equal(first.total_matches,2);assert.notEqual(first.records[0].key,second.records[0].key);
 const selected=ask.projectResearch(data,new URLSearchParams({record:'article:a'})).records[0];
 assert.equal(selected.article_type,'commercial');assert.equal(selected.vertical,'dfr');assert.equal(selected.date_basis,'source publication date');
});
test('current build preserves selected IDs, deduplicates, and safely handles corrupt or empty shared inputs',()=>{
 const saved=[{pid:'a',cat:'frames'},{pid:'a',cat:'frames'},null,{pid:'b',cat:'__proto__'}];
 const model=values.currentBuildModel(saved);assert.deepEqual(model.relations.frames,['a']);assert.deepEqual(model.relations.__proto__,['b']);
 assert.deepEqual(values.currentBuildModel(saved,values.encode(['c'])).relations.selected_parts,['c']);
 assert.deepEqual(Object.keys(values.currentBuildModel(saved,values.encode([])).relations),[]);
 assert.deepEqual(values.currentBuildModel(saved,'invalid%').relations.frames,['a']);
 assert.equal(Object.keys(values.currentBuildModel({}).relations).length,0);
});
test('Cost renderer excludes quote/range prices, preserves zero, and labels partial totals',()=>{
 const html=fs.readFileSync('forge-source/cost.html','utf8');
 const source=html.slice(html.indexOf('        function resolveBOM('),html.indexOf('        async function init()'));
 const elements={};const context=vm.createContext({ForgeBuilderValues:values,ESC:s=>String(s),SLOT_LABELS:{},SLOT_COLORS:{},allParts:{a:{pid:'a',name:'A',approx_price:'$100–200'},b:{pid:'b',name:'B',approx_price:0,weight_g:0},c:{pid:'c',name:'C',approx_price:12,weight_g:5}},selectedBuild:{relations:{parts:['a','b','c','missing']}},document:{getElementById:id=>elements[id]??={innerHTML:''}}});
 vm.runInContext(source+'\nrenderBOM();',context);
 assert.match(elements['cost-gauges'].innerHTML,/Known cost/);assert.match(elements['cost-gauges'].innerHTML,/2 prices unavailable/);assert.match(elements['cost-gauges'].innerHTML,/\$12/);
 assert.match(elements['bom-output'].innerHTML,/\$0\.00/);assert.match(elements['bom-output'].innerHTML,/Known totals/);assert.doesNotMatch(elements['bom-output'].innerHTML,/NaN/);
});
