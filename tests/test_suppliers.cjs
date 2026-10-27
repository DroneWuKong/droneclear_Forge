const {test}=require('node:test');
const assert=require('node:assert/strict');
const ui=require('../forge-source/suppliers.js');
const ask=require('../forge-source/ask-pie-retrieval.js');
const now=Date.parse('2026-10-27T09:00:00Z');
const fx={date:'2026-10-26',rates:{EUR:'1',USD:'1.15',JPY:'175'}};
const offer={offer_id:'SO-1',supplier_id:'SUP-DE-1',part_id:'P1',identity:{name:'RadioMaster RP1'},
  price:{amount:'10.00',currency:'EUR',tax:'included',pack_quantity:1},
  availability:{status:'in_stock',quantity:10,quantity_kind:'lower_bound_exclusive',lead_time_days:null},
  observed_at:'2026-10-26T10:00:00Z',expires_at:'2026-10-29T10:00:00Z',source_url:'https://shop.example/product',ships_from:[]};
test('conversion preserves original and uses dated reference cross-rates',()=>{
  assert.equal(ui.convert(offer.price,'USD',fx,now).amount,11.5);
  assert.equal(ui.convert({amount:'11.50',currency:'USD'},'EUR',fx,now).amount,10);
  assert.equal(ui.convert(offer.price,'original',fx,now).amount,10);
  assert.equal(offer.price.amount,'10.00');
  assert.equal(ui.convert(offer.price,'USD',{...fx,date:'2026-10-01'},now),null);
  assert.equal(ui.convert(offer.price,'GBP',fx,now),null);
  assert.equal(ui.convert({amount:null,currency:'EUR'},'USD',fx,now),null);
});
test('currency formatting honors currency precision',()=>assert.match(ui.format({amount:1750,currency:'JPY'}),/1,750/));
test('staleness is recomputed at view time, and stock remains qualified',()=>{
  assert.match(ui.stock(offer,now),/more than 10/);
  assert.equal(ui.stock(offer,now+10*86400000),'Stale observation');
  assert.equal(ui.comparable(offer,{...offer,price:{...offer.price,tax:'unknown'}},'EUR',fx,now),false);
  assert.equal(ui.comparable(offer,{...offer,part_id:'P2'},'EUR',fx,now),false);
  assert.equal(ui.comparable(offer,offer,'EUR',fx,now),true);
});
test('supplier text and links cannot inject markup or javascript',()=>{
  const html=ui.offerCard({...offer,identity:{name:'<img src=x onerror=alert(1)>'},source_url:'javascript:alert(1)'},[], 'original',fx);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('javascript:'));
});
test('supplier research records retain semantics and source observation date',()=>{
  const records=ask.supplierRecords({suppliers:[{id:'SUP-DE-1',name:'Shop',country:'DE',identity_status:'supplier_reported',identity_source:'https://shop.example/legal'}]},{offers:[offer]},{changes:[]});
  assert.equal(records.length,2);
  assert.equal(records[1].type,'supplier_offer');
  assert.equal(records[1].date,offer.observed_at);
  assert.equal(records[1].citations[0].url,offer.source_url);
  assert.match(records[1].semantics,/not independently verified/);
  assert.match(records[1].summary,/expires/);
});
