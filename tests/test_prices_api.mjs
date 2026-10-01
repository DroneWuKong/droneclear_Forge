import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/prices-api.js';

const request=(suffix='')=>new Request('https://uas-forge.test/api/prices'+suffix);
const env={PARTS_DB:{get:async()=>null},ASSETS:{fetch:async()=>Response.json({components:{motors:[
  {pid:'M-1',name:'Motor',price_usd:29.5,link:'https://seller.test/m'},
  {pid:'M-2',name:'Unknown price'},
],frames:[{pid:'F-1',name:'Frame',approx_price:70}]}})}};

test('empty price KV uses labeled catalog estimates and preserves filters',async()=>{
  const response=await worker.fetch(request('?component=M-1'),env);
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(data.meta.source,'catalog_estimate');
  assert.equal(data.meta.total,2);
  assert.deepEqual(data.components.map(row=>row.pid),['M-1']);
  assert.match(data.meta.caveat,/verify seller price/i);
});

test('unavailable catalog returns an error rather than a healthy empty price feed',async()=>{
  const response=await worker.fetch(request(),{PARTS_DB:{get:async()=>null},ASSETS:{fetch:async()=>new Response('',{status:404})}});
  assert.equal(response.status,500);
});
