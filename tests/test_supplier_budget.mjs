import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reserveSupplier,settleSupplier,reservationCost,usageCost,MONTHLY_LIMIT} from '../workers/supplier-budget.mjs';
import automation, {discoveryRequest} from '../workers/supplier-automation.mjs';

const now=Date.parse('2026-10-27T09:00:00Z');
test('cost reservation bounds input turns, output and search charges',()=>{
  assert.equal(reservationCost(),434000);
  assert.equal(usageCost({usage:{input_tokens:1000,output_tokens:100},output:[{type:'web_search_call'}]}),10450);
  assert.equal(usageCost({}),null);
  assert.equal(discoveryRequest('DE').max_tool_calls,3);
  assert.equal(discoveryRequest('DE').max_output_tokens,2000);
});
test('monthly ceiling and uncertain reservations are fail closed',()=>{
  let state;
  for(let i=0;i<5;i++)state=reserveSupplier(state,{id:`2026-W4${i}-DE`,week:`2026-W4${i}`,amount:5000000},now).state;
  assert.equal(Object.values(state.entries).reduce((n,e)=>n+e.reserved,0),MONTHLY_LIMIT);
  assert.equal(reserveSupplier(state,{id:'2026-W45-DE',week:'2026-W45',amount:1},now).allowed,false);
  assert.equal(reserveSupplier(state,{id:'2026-W40-DE',week:'2026-W40',amount:5000000},now).duplicate,true);
});
test('settlement is idempotent and refunds only confirmed unused reservation',()=>{
  let state=reserveSupplier(null,{id:'2026-W44-DE',week:'2026-W44',amount:434000},now).state;
  state=settleSupplier(state,{id:'2026-W44-DE',actual:10450,result:{candidates:[]}});
  assert.equal(state.entries['2026-W44-DE'].actual,10450);
  assert.deepEqual(settleSupplier(state,{id:'2026-W44-DE',actual:0}),state);
  assert.throws(()=>settleSupplier(reserveSupplier(null,{id:'2026-W44-DE',week:'2026-W44',amount:1},now).state,{id:'2026-W44-DE',actual:2}));
});
test('weekly task cap remains independent of token spend',()=>{
  let state;
  const countries=['DE','FR','CZ','PL','NL','AT','BE','BG','HR','CY'];
  for(const country of countries)state=reserveSupplier(state,{id:`2026-W44-${country}`,week:'2026-W44',amount:1},now).state;
  assert.equal(reserveSupplier(state,{id:'2026-W44-SE',week:'2026-W44',amount:1},now).allowed,false);
});
test('automation requires authorization and validates exact evidence bytes',async()=>{
  const req=new Request('https://example.test/api/suppliers/evidence/'+'a'.repeat(64),{method:'POST',body:'hello'});
  assert.equal((await automation.fetch(req,{})).status,401);
  const authorized=new Request(req,{headers:{Authorization:'Bearer test'}});
  let stored=false;
  assert.equal((await automation.fetch(authorized,{PATTERNS_REVIEW_TOKEN:'test',RESEARCH_EVIDENCE:{put(){stored=true;}}})).status,422);
  assert.equal(stored,false);
});
