(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ForgeSuppliers = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  const key = 'forge-supplier-currency';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function safeUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } }
  function fresh(offer, now=Date.now()) { return Number.isFinite(Date.parse(offer.observed_at)) && Date.parse(offer.observed_at)<=now && Date.parse(offer.expires_at)>now; }
  function rateAvailable(fx, now=Date.now()) {
    const date = Date.parse(fx?.date || '');
    return Number.isFinite(date) && date <= now && now-date <= 7*86400000;
  }
  function convert(price, currency, fx, now=Date.now()) {
    if (price?.amount == null || !price.currency || !Number.isFinite(Number(price.amount))) return null;
    if (!currency || currency==='original' || currency === price.currency) return {amount:Number(price.amount),currency:price.currency,converted:false};
    if (!rateAvailable(fx,now)) return null;
    const from=Number(fx.rates[price.currency]), to=Number(fx.rates[currency]);
    if (!(from>0 && to>0)) return null;
    return {amount:Number(price.amount)/from*to,currency,converted:true,date:fx.date};
  }
  function format(value) {
    if (!value) return 'Price not provided';
    try { return new Intl.NumberFormat(undefined,{style:'currency',currency:value.currency}).format(value.amount); }
    catch { return `${value.amount} ${value.currency}`; }
  }
  function stock(offer, now=Date.now()) {
    if (!fresh(offer,now)) return 'Stale observation';
    const a=offer.availability;
    const labels={in_stock:'Reported in stock',out_of_stock:'Reported out of stock',backorder:'Backorder',preorder:'Preorder',limited:'Limited availability',discontinued:'Discontinued',unknown:'Availability unknown'};
    return (labels[a.status] || labels.unknown)+(a.quantity_kind==='lower_bound_exclusive'?` · more than ${a.quantity}`:a.quantity_kind==='exact'?` · ${a.quantity}`:'');
  }
  function comparable(a,b,currency,fx,now=Date.now()) {
    return Boolean(a.part_id && a.part_id===b.part_id && a.price.pack_quantity && a.price.pack_quantity===b.price.pack_quantity
      && a.price.tax!=='unknown' && a.price.tax===b.price.tax && fresh(a,now) && fresh(b,now)
      && convert(a.price,currency,fx,now) && convert(b.price,currency,fx,now)
      && convert(a.price,currency,fx,now).currency===convert(b.price,currency,fx,now).currency);
  }
  let promise;
  async function load() {
    if (!promise) promise=(async()=>{
      const base='/data/suppliers/';
      const response=await fetch(base+'manifest.v1.json',{cache:'no-cache'});
      if(!response.ok) throw new Error('Supplier data unavailable');
      const manifest=await response.json();
      if(manifest.schema!=='forge.supplier-manifest.v1')throw new Error('Unsupported supplier data');
      const result={};
      await Promise.all(['suppliers','offers','changes','fx','health'].map(async name=>{
        const file=name+'.v1.json';
        const r=await fetch(base+file,{cache:'no-cache'}); if(!r.ok)throw new Error('Incomplete supplier data');
        const bytes=await r.arrayBuffer();
        const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
        if(hash!==manifest.files[file])throw new Error('Supplier update is incomplete; retry shortly');
        result[name]=JSON.parse(new TextDecoder().decode(bytes));
      }));
      return result;
    })().catch(error=>{promise=null;throw error;});
    return promise;
  }
  function currencyChoice() { try{return localStorage.getItem(key)||'original';}catch{return 'original';} }
  function profileStatus(profile) {
    if(profile.identity_status==='candidate')return 'Company identity awaiting review';
    return ({active:'Listings monitored',pending_first_collection:'First listings pending',
      unavailable:'Listings temporarily unavailable',identity_review_required:'Company identity needs review',
      candidate:'Product feed not yet connected'})[profile.collector_status] || 'Listings pending';
  }
  function profileNote(profile) {
    return profile.identity_status==='candidate'
      ? 'Company details and reported dispatch locations need corroboration.'
      : 'Company details are attributed to the supplier’s own published information.';
  }
  function currencyControl(fx, selected) {
    const options=['original',...Object.keys(fx.rates||{}).sort()];
    return `<label>Display currency <select data-supplier-currency>${options.map(c=>`<option value="${escape(c)}" ${c===selected?'selected':''}>${c==='original'?'Original':escape(c)}</option>`).join('')}</select></label>`;
  }
  function offerCard(offer, profiles, currency, fx) {
    const supplier=profiles.find(s=>s.id===offer.supplier_id);
    const original=convert(offer.price,'original',fx), converted=convert(offer.price,currency,fx);
    const displayed=converted || original;
    const source=safeUrl(offer.source_url);
    return `<article class="supplier-offer"><h3>${escape(offer.identity.name)}</h3>
      <p><a href="/suppliers/?supplier=${encodeURIComponent(offer.supplier_id)}">${escape(supplier?.name || offer.supplier_id)}</a> · ${escape(supplier?.country || 'Location unknown')}</p>
      <p class="supplier-price">${escape(format(displayed))}</p>
      ${displayed?.converted?`<p>Original ${escape(format(original))} · ECB reference ${escape(displayed.date)}</p>`:''}
      ${currency!=='original' && currency!==offer.price.currency && !converted?'<p>Conversion unavailable; original price shown.</p>':''}
      <p>${escape(stock(offer))} · VAT ${escape(offer.price.tax)} · Dispatch location ${escape(offer.ships_from?.join(', ') || 'not reported')}</p>
      <p>Observed ${escape(offer.observed_at)}${offer.availability.lead_time_days==null?' · Lead time not provided':` · Lead time ${escape(offer.availability.lead_time_days)} days`}</p>
      ${!offer.part_id?'<p>Component match awaiting review.</p>':''}
      <a href="${escape(source)}" target="_blank" rel="noopener noreferrer">View supplier listing</a>
      <small>Supplier-reported observation · shipping charges may apply.</small></article>`;
  }
  async function mount(element, partId) {
    if(!element)return;
    element.dataset.supplierPart=partId || '';
    element.innerHTML='<h3>EU supplier offers</h3><p>Loading supplier observations…</p>';
    try {
      const data=await load();
      if(element.dataset.supplierPart!==(partId || ''))return;
      const offers=data.offers.offers.filter(o=>o.part_id===partId && partId);
      function render() {
        const currency=currencyChoice();
        element.innerHTML='<h3>EU supplier offers</h3>'+currencyControl(data.fx,currency)
          +(offers.length?offers.map(o=>offerCard(o,data.suppliers.suppliers,currency,data.fx)).join(''):'<p>No exact supplier matches are published for this component.</p>')
          +'<p><a href="/suppliers/">Browse all EU suppliers</a></p>';
        element.querySelector('select').onchange=e=>{try{localStorage.setItem(key,e.target.value);}catch{}render();};
      }
      render();
    } catch {if(element.dataset.supplierPart===(partId || ''))element.innerHTML='<h3>EU supplier offers</h3><p>Supplier data is temporarily unavailable. <a href="/suppliers/">Open supplier directory</a></p>';}
  }
  async function boot() {
    const app=document.getElementById('supplier-directory'); if(!app)return;
    try {
      const data=await load(), profiles=data.suppliers.suppliers;
      const params=new URLSearchParams(location.search);
      let country='', dispatch='', supplier=params.get('supplier') || '', availability='', query='', currency=currencyChoice();
      const select=(id,label,values,value)=>`<label>${label} <select id="${id}"><option value="">All</option>${values.map(v=>`<option value="${escape(v[0])}" ${value===v[0]?'selected':''}>${escape(v[1])}</option>`).join('')}</select></label>`;
      function render() {
        const selectedProfiles=profiles.filter(p=>(!country||p.country===country)&&(!supplier||p.id===supplier));
        const ids=new Set(selectedProfiles.map(p=>p.id));
        const offers=data.offers.offers.filter(o=>ids.has(o.supplier_id)&&(!dispatch||o.ships_from.includes(dispatch))
          &&(!availability||fresh(o)&&o.availability.status===availability)
          &&(!query||`${o.identity.name} ${o.identity.manufacturer||''}`.toLowerCase().includes(query.toLowerCase())));
        app.innerHTML=`<div class="supplier-controls">${select('supplier-country','Supplier country',[...new Set(profiles.map(p=>p.country))].sort().map(c=>[c,c]),country)}
          ${select('supplier-id','Supplier',profiles.map(p=>[p.id,p.name]),supplier)}
          ${select('supplier-dispatch','Dispatch country',[...new Set(data.offers.offers.flatMap(o=>o.ships_from))].sort().map(c=>[c,c]),dispatch)}
          ${select('supplier-availability','Availability',[['in_stock','Reported in stock'],['out_of_stock','Reported out of stock'],['backorder','Backorder']],availability)}
          ${currencyControl(data.fx,currency)}<label>Product name <input id="supplier-query" type="search" value="${escape(query)}"></label></div>
          <p role="status">${offers.length} listings · ${selectedProfiles.length} suppliers · Updated ${escape(data.offers.generated_at)}</p>
          <div class="supplier-profiles">${selectedProfiles.map(p=>`<article class="supplier-profile"><h2>${escape(p.name)}</h2><p>${escape(p.legal_name || 'Legal identity under review')} · ${escape(p.country)}</p>
            <p>${escape(profileStatus(p))}</p><p>${escape(profileNote(p))}</p><a href="${escape(safeUrl(p.identity_source))}" rel="noopener noreferrer" target="_blank">Source</a></article>`).join('')}</div>
          <h2>Supplier listings</h2><div class="supplier-offers">${offers.map(o=>offerCard(o,profiles,currency,data.fx)).join('') || '<p>No listings match these filters.</p>'}</div>
          <h2>Reported changes</h2><ul>${data.changes.changes.filter(c=>ids.has(c.supplier_id)).slice(0,30).map(c=>`<li>${escape(c.observed_at)} · ${escape(c.name)} · ${escape(c.fields.join(', '))} changed — <a href="${escape(safeUrl(c.source_url))}">supplier source</a></li>`).join('') || '<li>No comparable changes have been recorded yet.</li>'}</ul>`;
        const bind=(id,set)=>{app.querySelector('#'+id).onchange=e=>{set(e.target.value);render();};};
        bind('supplier-country',v=>country=v);bind('supplier-id',v=>supplier=v);bind('supplier-dispatch',v=>dispatch=v);
        bind('supplier-availability',v=>availability=v);bind('supplier-query',v=>query=v);
        app.querySelector('[data-supplier-currency]').onchange=e=>{currency=e.target.value;try{localStorage.setItem(key,currency);}catch{}render();};
      }
      render();
    } catch(error) {app.textContent=error.message;}
  }
  return {fresh,rateAvailable,convert,format,stock,comparable,load,mount,boot,offerCard,escape,safeUrl};
});
