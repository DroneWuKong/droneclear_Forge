import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {projectDaily,safeURL} from '../forge-source/patterns-daily.mjs';
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
  const context={safeURL,console,URL:BrowserURL,URLSearchParams,AbortController,Blob,Date,location,
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
  pending[1]({ok:true,json:async()=>({data:newer})});await settle();
  const old=projectDaily([flag('a',{title:'Battery supply'})],new URLSearchParams(),now);pending[0]({ok:true,json:async()=>({data:old})});await settle();
  assert.match(page.root.querySelector('[data-evidence]').innerHTML,/Motor supply/);assert.doesNotMatch(page.root.querySelector('[data-list]').innerHTML,/Battery supply/);
});
test('daily user-facing labels are valid text rather than double-decoded UTF-8',()=>{
  assert.doesNotMatch(uiSource,/\u00e2\u2020|\u00c2\u00b7|\u00e2\u20ac/);
});
