const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const values=require('../forge-source/builder-values.js');
const database=JSON.parse(fs.readFileSync(new URL('../forge-source/forge_database.json','file://'+__filename),'utf8'));
const parts=Object.entries(database.components).flatMap(([cat,rows])=>rows.map(part=>({...part,_cat:cat})));
const buildFor=pids=>pids.map(pid=>{const part=parts.find(p=>p.pid===pid);return {pid,name:part.name,cat:part._cat}});

test('actual fixed, range, and quoted catalog prices remain distinct and totals are finite',()=>{
 const rows=values.rows(buildFor(['ESC-1155','FC-2050','GPS-1075']),parts);
 assert.equal(rows[0].price,198.50);assert.equal(rows[1].price,null);assert.equal(rows[1].priceNote,'Contact for quote');assert.equal(rows[2].price,null);assert.match(rows[2].priceNote,/615/);
 const total=values.totals(rows);assert.equal(total.price,198.50);assert.equal(total.unknownPrices,2);
 for(const value of [NaN,Infinity,-1,{},null,'$300–$500','Contact vendor'])assert.equal(values.finiteAmount(value),null);
 assert.equal(values.finiteAmount('$1,170'),1170);assert.equal(values.finiteAmount(0),0);
});
test('actual raw-only weight record has the same row and total value',()=>{
 const rows=values.rows(buildFor(['BAT-FF-SL8AIR']),parts);assert.equal(rows[0].weight,1202);assert.equal(values.totals(rows).weight,1202);
 assert.equal(values.weight({schema_data:{weight_g:'unknown'},weight_g:25}),25);
 assert.equal(values.weight({weight_g:'$25'}),null);
});
test('all committed price shapes produce finite totals and valid CSV',()=>{
 const rows=values.rows(parts.filter(p=>p.pid).map(p=>({pid:p.pid,name:p.name,cat:p._cat})),parts);
 const total=values.totals(rows);assert.ok(Number.isFinite(total.price));assert.ok(Number.isFinite(total.weight));assert.ok(total.unknownPrices>0);
 const output=values.csv(rows);assert.ok(!output.includes('[object Object]'));assert.ok(output.includes('KNOWN TOTAL'));assert.ok(output.includes('Price_Notes'));
});
test('UTF-8 shared builds round-trip existing Cyrillic catalog PID and old links',()=>{
 const pids=['ESC-UA-603700-Франківськ-v','ANT-1366'];assert.deepEqual(values.decode(values.encode(pids)),pids);
 assert.deepEqual(values.decode(btoa(JSON.stringify(['FRM-1003']))),['FRM-1003']);
 assert.deepEqual(values.decode(btoa(JSON.stringify(['legacy-é']))),['legacy-é']);
 for(const encoded of ['invalid%','e30=',btoa(JSON.stringify([{}]))])assert.equal(values.decode(encoded),null);
});
test('actual quote-bearing names and newlines are escaped without changing contents',()=>{
 const rows=values.rows(buildFor(['ANT-1366','FRM-1003']),parts);const out=values.csv(rows);
 assert.match(out,/Omnivision 5\.8GHz ""Stubby""/);assert.match(out,/HGLRC MY5 5"" Frame Kit/);
 assert.equal(values.csv([{pid:'test',name:'A,"B"\nC',cat:'frames',price:null,weight:null,priceNote:'Needs quote'}]).split('\r\n')[1], '"test","A,""B""\nC","frames","","","Needs quote","Weight unavailable"');
});
test('actual inline drawer render and export survive all formerly crashing catalog records',()=>{
 const html=fs.readFileSync(new URL('../forge-source/index.html','file://'+__filename),'utf8');
 const source=html.slice(html.indexOf('function updateBuildUI() {'),html.indexOf('// ── ArduPilot .param generator'));
 const elements={};let csv='';
 const ctx=vm.createContext({values,build:buildFor(['ESC-1155','FC-2050','GPS-1075','BAT-FF-SL8AIR','ANT-1366']),allParts:parts,
 $:id=>elements[id]??={style:{},querySelectorAll:()=>[]},esc:s=>String(s),fmtCat:s=>s,
 Blob:class{constructor(content){csv=content.join('')}},URL:{createObjectURL:()=>'',revokeObjectURL(){}},document:{createElement:()=>({click(){}})},setTimeout:fn=>fn()});
 vm.runInContext(source,ctx);vm.runInContext('updateBuildUI();exportBuild()',ctx);
 assert.equal(elements['bom-cost'].textContent,'$208.50');assert.equal(elements['bom-cost-label'].textContent,'Known cost');assert.match(elements['bom-coverage'].textContent,/3 part prices/);assert.ok(csv.includes('"198.5"'));
});
