// Exercise the actual page scripts after the build's navigation replacement.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const pages=JSON.parse(execFileSync('python3',['-c',`
import json
from pathlib import Path
from build_static import inject_nav
print(json.dumps({name: inject_nav((Path('forge-source')/(name+'.html')).read_text(),name+'.html')
                 for name in ['adversary-bom','mirroring','evasion']}))
`],{encoding:'utf8'}));
const cases=[
  ['adversary-bom','adversary_bom','levers-list','No levers above the score threshold'],
  ['mirroring','component_mirroring_index','results','No mirror matches'],
  ['evasion','sanctions_evasion_graph','results','No reachable entities']
];
function element(){return {textContent:'',innerHTML:'Loading…',style:{},dataset:{},classList:{add(){},remove(){}}};}
for(const [name,dataset,result,empty] of cases){
  for(const state of ['empty','unavailable','invalid-json']){
    test(`${name}: built application exits loading on ${state}`,async()=>{
      const html=pages[name],elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element()]));
      const tabs=['levers','weapons'].map(value=>({...element(),dataset:{tab:value},addEventListener(event,fn){this.click=fn;}}));
      const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes("fetch('/api/data?type="+dataset));
      assert.ok(script,'Navigation replacement must retain the page data loader');
      const requested=[];
      const context=vm.createContext({window:{},document:{getElementById:id=>elements[id]||null,querySelectorAll:selector=>selector==='.tab'?tabs:[]},fetch:async url=>{
        requested.push(url);
        if(!url.includes('?type='+dataset)||state==='unavailable')return {ok:false,status:503};
        return {ok:true,json:async()=>{if(state==='invalid-json')throw Error('Invalid JSON');return {data:{meta:{total_candidates:0,total_component_rows:0},results:[],per_weapon:[],top_export_control_levers:[]}};}};
      }});
      vm.runInContext(script,context);
      await new Promise(setImmediate);
      assert.ok(requested.includes('/api/data?type='+dataset));
      assert.doesNotMatch(elements[result].innerHTML,/Loading/);
      assert.ok(elements[result].innerHTML.includes(state==='empty'?empty:'Failed to load'),elements[result].innerHTML);
      if(name==='adversary-bom'){
        tabs[1].click();assert.equal(elements['pane-weapons'].style.display,'');assert.equal(elements['pane-levers'].style.display,'none');
        assert.doesNotMatch(elements['weapons-list'].innerHTML,/Loading/);
      }
    });
  }
}

test('directory fetch failure preserves the generated public links',async()=>{
  const elements={'tool-search':{value:''},'tool-area':{value:'',options:[{value:''},{value:'Research'}]},'tool-results':{innerHTML:'<a href="/adversary-bom/">Adversary BOM</a>'},'tool-count':{textContent:''}};
  const context=vm.createContext({document:{getElementById:id=>elements[id],querySelector:()=>({addEventListener(){}})},location:{search:'',hostname:'uas-patterns.com'},URLSearchParams,fetch:async()=>{throw Error('Offline');}});
  vm.runInContext(fs.readFileSync('forge-source/tool-directory.js','utf8'),context);
  await new Promise(setImmediate);
  assert.match(elements['tool-count'].textContent,/Browse the complete list below/);
  assert.match(elements['tool-results'].innerHTML,/adversary-bom/);
  assert.equal(elements['tool-area'].value,'Research');
});
