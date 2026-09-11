import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {projectDaily,safeURL,buildDailyEvidencePacket} from '../forge-source/patterns-daily.mjs';
const now=Date.parse('2026-09-11T12:00:00Z');
const flag=(id,extra={})=>({id,title:'Record '+id,last_verified_at:'2026-09-11T11:00:00Z',change_schema_version:1,change_kind:'new',...extra});

test('mixed or incomplete batches cannot inherit freshness from one recent row',()=>{
  for(const rows of [[flag('a'),flag('b',{last_verified_at:null})],[flag('a'),flag('b',{last_verified_at:'2020-01-01'})]])assert.equal(projectDaily(rows,new URLSearchParams(),now).coverage.status,'unavailable');
});
test('password-only credentials and oversized URLs never enter public evidence links',()=>{
  assert.equal(safeURL('https://:secret@example.org/'),'');
  assert.equal(safeURL('https://example.org/'+'a'.repeat(3000)),'');
});
test('conflicting duplicate identities remain unresolved, while exact repeated evidence can still be opened by its ID',()=>{
  const conflict=projectDaily([flag('a',{detail:'first'}),flag('a',{detail:'other'})],new URLSearchParams('record=a'),now);
  assert.equal(conflict.record_status,'ambiguous');assert.deepEqual(conflict.items,[]);assert.equal(conflict.coverage.status,'partial');
  const repeated=projectDaily([flag('a',{evidence_fingerprint:'same'}),flag('b',{evidence_fingerprint:'same'})],new URLSearchParams('record=b'),now);
  assert.equal(repeated.record_status,'found');assert.equal(repeated.items[0].id,'b');assert.equal(repeated.counts.new,1);
});

class Element {
  constructor(){this.innerHTML='';this.textContent='';this.value='';this.dataset={};this.events={};this.nodes={};this.attrs={};this.children=[];}
  querySelector(selector){return this.nodes[selector] ||= new Element();}
  querySelectorAll(selector){if(selector==='[data-id]')return [...this.innerHTML.matchAll(/data-id="([^"]+)"/g)].map(match=>{const node=new Element();node.dataset.id=match[1];return node;});return [];}
  addEventListener(name,callback){this.events[name]=callback;}
  setAttribute(name,value){this.attrs[name]=value;}
  removeAttribute(name){delete this.attrs[name];}
  scrollIntoView(){this.scrolled=true;}
  replaceChildren(){this.children=[];}
  append(child){this.children.push(child);}
  click(){return this.events.click?.({preventDefault(){}});}
}
const uiSource=fs.readFileSync(new URL('../forge-source/patterns-daily-ui.mjs',import.meta.url),'utf8').replace(/^\uFEFF?import[^\n]*\n/,'');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(initial='https://uas-patterns.com/patterns-home/',fetcher) {
  const root=new Element(),listeners={},requests=[],blobs=[],history=[];
  let address=new URL(initial);
  const location={get href(){return address.href;},get hash(){return address.hash;},get pathname(){return address.pathname;},get search(){return address.search;}};
  class BrowserURL extends URL {static createObjectURL(blob){blobs.push(blob);return 'blob:test';}static revokeObjectURL(){}}
  const context={safeURL,buildDailyEvidencePacket,console,URL:BrowserURL,URLSearchParams,AbortController,Blob,Date,location,
    localStorage:{getItem:()=>null,setItem(){}},
    document:{getElementById:()=>root,createElement:()=>new Element()},
    window:{addEventListener:(name,callback)=>{listeners[name]=callback;}},
    history:{pushState:(_,__,url)=>{address=new URL(String(url),address);history.push(address.href);}},
    setTimeout:callback=>callback(),
    fetch:async(url,options)=>{requests.push(url);if(fetcher)return fetcher(url,options);return {ok:true,json:async()=>({data:projectDaily([flag('a',{title:'Battery supply'}),flag('b',{title:'Motor supply'})],new URL(url,'https://uas-patterns.com').searchParams,now)})};}
  };
  vm.createContext(context);vm.runInContext(uiSource+'\nglobalThis.dailyTest={load,queryLoad,showEvidence};',context);
  return {root,context,requests,blobs,history,listeners,navigate(url){address=new URL(url);return listeners.popstate();},get href(){return address.href;}};
}
test('daily query and state restore from URL and browser back restores the prior selected record',async()=>{
  const page=harness('https://uas-patterns.com/patterns-home/?q=Battery&state=new#daily=a');await settle();
  assert.equal(page.root.querySelector('input').value,'Battery');assert.equal(page.root.querySelector('select').value,'new');
  assert.match(page.root.querySelector('[data-evidence]').innerHTML,/Battery supply/);
  page.root.querySelector('input').value='Motor';page.root.querySelector('select').value='all';page.context.dailyTest.queryLoad();await settle();
  assert.equal(new URL(page.href).searchParams.get('q'),'Motor');assert.equal(new URL(page.href).hash,'');
  assert.match(page.root.querySelector('[data-evidence]').innerHTML,/Motor supply/);
  page.navigate('https://uas-patterns.com/patterns-home/?q=Battery&state=new#daily=a');await settle();
  assert.equal(page.root.querySelector('input').value,'Battery');assert.equal(page.root.querySelector('select').value,'new');assert.match(page.root.querySelector('[data-evidence]').innerHTML,/Battery supply/);
});
test('export uses applied collection filters instead of unsubmitted input edits',async()=>{
  const page=harness('https://uas-patterns.com/patterns-home/?q=Battery&state=new');await settle();
  page.root.querySelector('input').value='unsubmitted change';
  page.root.querySelector('[data-evidence]').querySelector('[data-export]').click();
  const exported=JSON.parse(await page.blobs[0].text());assert.equal(exported.query,'Battery');assert.equal(exported.filters.state,'new');assert.equal(exported.record.id,'a');
  assert.equal(exported.schema_version,2);assert.equal(exported.publication.status,'unavailable');assert.equal(exported.publication.input_revision,null);
  assert.match(exported.publication.limitation,/no newer publication was substituted/);
  assert.equal(page.requests.length,1);
});

test('an export closure keeps its displayed record and same-load identity after another collection loads',async()=>{
  let revision='a';
  const page=harness('https://uas-patterns.com/patterns-home/?q=Battery',async()=>{
    const data=projectDaily([flag(revision,{title:revision==='a'?'Battery supply':'Motor supply',sources:[{url:`https://example.test/${revision}`} ]})],new URLSearchParams(),now);
    data.publication={schema_version:1,status:'identified_by_content',input_revision:revision.repeat(64),artifact_sha256:revision.repeat(64),source:'kv',publication_revision:null};
    return {ok:true,json:async()=>({data})};
  });
  await settle();
  const oldExport=page.root.querySelector('[data-evidence]').querySelector('[data-export]').events.click;
  revision='b';page.root.querySelector('input').value='Motor';page.context.dailyTest.queryLoad();await settle();
  oldExport();page.root.querySelector('[data-evidence]').querySelector('[data-export]').click();
  const oldPacket=JSON.parse(await page.blobs[0].text()),newPacket=JSON.parse(await page.blobs[1].text());
  assert.equal(oldPacket.record.id,'a');assert.equal(oldPacket.record.sources[0].url,'https://example.test/a');assert.equal(oldPacket.query,'Battery');assert.equal(oldPacket.publication.input_revision,'a'.repeat(64));
  assert.equal(newPacket.record.id,'b');assert.equal(newPacket.query,'Motor');assert.equal(newPacket.publication.input_revision,'b'.repeat(64));
  assert.equal(oldPacket.projected_at,new Date(now).toISOString());assert.equal(oldPacket.projection_method,'daily-navigation-v1');
  assert.equal(page.requests.length,2,'export must not fetch a newer snapshot or catalog');
});

test('packet builder cannot substitute another collection record and copies the captured evidence',()=>{
  const collection=projectDaily([flag('a',{sources:[{url:'https://example.test/a'}]})],new URLSearchParams(),now);
  collection.publication={schema_version:1,input_revision:'a'.repeat(64)};
  assert.throws(()=>buildDailyEvidencePacket(collection,'missing',{q:''}),/missing or ambiguous/);
  assert.throws(()=>buildDailyEvidencePacket({...collection,items:[collection.items[0],collection.items[0]]},'a',{q:''}),/missing or ambiguous/);
  const packet=buildDailyEvidencePacket(collection,'a',{q:''});
  collection.publication.input_revision='b'.repeat(64);collection.items[0].sources[0].url='https://example.test/changed';
  assert.equal(packet.publication.input_revision,'a'.repeat(64));assert.equal(packet.record.sources[0].url,'https://example.test/a');
});
test('mobile selection brings evidence into view and offers a return to the list',async()=>{
  const page=harness();await settle();page.context.window.matchMedia=()=>({matches:true});
  page.context.dailyTest.showEvidence('a');
  const panel=page.root.querySelector('[data-evidence]');assert.equal(panel.scrolled,true);
  panel.querySelector('[data-back-to-list]').click();assert.equal(page.root.querySelector('[data-list]').scrolled,true);
});
test('a malformed or missing record URL cannot silently show the first available record',async()=>{
  const page=harness('https://uas-patterns.com/patterns-home/#daily=missing',async()=>({ok:true,json:async()=>({data:projectDaily([flag('a')],new URLSearchParams(),now)})}));await settle();
  assert.match(page.root.querySelector('[data-evidence]').textContent,/missing or ambiguous/);assert.doesNotMatch(page.root.querySelector('[data-evidence]').innerHTML,/Record a/);
  page.navigate('https://uas-patterns.com/patterns-home/#daily=%E0%A4');await settle();assert.match(page.root.querySelector('[data-status]').textContent,/unavailable/);
});
test('an older successful load cannot overwrite a newer query or clear its busy state',async()=>{
  const pending=[];const page=harness('https://uas-patterns.com/patterns-home/',()=>new Promise(resolve=>pending.push(resolve)));
  page.root.querySelector('input').value='Motor';page.context.dailyTest.queryLoad();
  const newer=projectDaily([flag('b',{title:'Motor supply'})],new URLSearchParams(),now);
  newer.publication={input_revision:'b'.repeat(64)};
  pending[1]({ok:true,json:async()=>({data:newer})});await settle();
  const old=projectDaily([flag('a',{title:'Battery supply'})],new URLSearchParams(),now);old.publication={input_revision:'a'.repeat(64)};pending[0]({ok:true,json:async()=>({data:old})});await settle();
  assert.match(page.root.querySelector('[data-evidence]').innerHTML,/Motor supply/);assert.doesNotMatch(page.root.querySelector('[data-list]').innerHTML,/Battery supply/);
  page.root.querySelector('[data-evidence]').querySelector('[data-export]').click();
  assert.equal(JSON.parse(await page.blobs[0].text()).publication.input_revision,'b'.repeat(64));
});
test('daily user-facing labels are valid text rather than double-decoded UTF-8',()=>{
  assert.doesNotMatch(uiSource,/\u00e2\u2020|\u00c2\u00b7|\u00e2\u20ac/);
});
