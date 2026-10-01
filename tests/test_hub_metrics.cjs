const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync(require('node:path').join(__dirname,'../forge-source/uas-hub.html'),'utf8');
const script=html.match(/<!-- Counts are hydrated[\s\S]*?<script>([\s\S]*?)<\/script>/)?.[1];

async function hydrate(responses) {
  const elements=Object.fromEntries(['stat-parts','hero-parts','stat-platforms','hero-platforms','stat-flags','stat-articles','stat-sols'].map(id=>[id,{textContent:''}]));
  const fetch=(url)=>Promise.resolve(responses[url] ? {ok:true,json:async()=>({data:responses[url]})} : {ok:false,status:503});
  vm.runInNewContext(script,{document:{getElementById:id=>elements[id]},fetch,Object,Number});
  await new Promise(resolve=>setImmediate(resolve));
  return Object.fromEntries(Object.entries(elements).map(([id,node])=>[id,node.textContent]));
}

test('hub hero and counters hydrate from the current response envelopes',async()=>{
  const values=await hydrate({
    '/api/data?type=forge_database':{components:{FC:[{},{}],RF:[{}]},drone_models:[{},{}]},
    '/api/data?type=dataset_catalog':{datasets:[
      {id:'flags',record_count:481,status:'fresh'},
      {id:'intel_articles',record_count:17733,status:'fresh'},
      {id:'solicitations',record_count:1096,status:'fresh'},
    ]},
  });
  assert.deepEqual(values,{'stat-parts':'3','hero-parts':'3','stat-platforms':'2','hero-platforms':'2','stat-flags':'481','stat-articles':'17,733','stat-sols':'1,096'});
});

test('hub exposes unavailable feeds instead of an old count',async()=>{
  const values=await hydrate({'/api/data?type=dataset_catalog':{datasets:[{id:'flags',record_count:481,status:'stale'}]}});
  for(const value of Object.values(values))assert.equal(value,'Unavailable');
});
