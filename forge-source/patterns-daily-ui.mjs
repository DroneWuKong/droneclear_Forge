import { safeURL } from './patterns-daily.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
function date(value) {
  const raw=String(value || '');
  if (/^\d{4}(?:-\d{2})?$/.test(raw)) return raw+' (source precision)';
  return Number.isFinite(Date.parse(raw)) ? new Date(raw).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}) : 'Publication date unknown';
}
const storageKey='patterns.daily.followed.v1';
let saved=[];
try { const value=JSON.parse(localStorage.getItem(storageKey)||'[]'); if(Array.isArray(value)) saved=value.filter(x=>typeof x==='string').slice(0,50); } catch {}
const root=document.getElementById('daily-workspace');
let current, selected, appliedFilters, requestSequence=0, controller;
function links(row) {
  return row.sources.map(source=>`<li>${safeURL(source.url) ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.name || new URL(source.url).hostname)} ↗</a>` : `<span>${esc(source.name || 'Source not identified')} — citation missing</span>`}<small>${esc(date(source.published_at))} · ${esc(source.citation_status.replaceAll('_',' '))}</small></li>`).join('') || '<li>No supporting citation attached.</li>';
}
function showEvidence(id,navigate=true) {
  const matches=current?.items.filter(row=>row.id===id) || [];
  if(matches.length!==1) {
    selected=null;
    root.querySelector('[data-evidence]').textContent='The exact record is missing or ambiguous. No substitute record has been selected.';
    return;
  }
  const row=selected=matches[0];
  const collection=current, filters={...appliedFilters};
  const panel=root.querySelector('[data-evidence]');
  panel.innerHTML=`<p class="daily-eyebrow">Evidence dossier</p><h3>${esc(row.title)}</h3><p>${esc(row.detail)}</p><dl><dt>What changed</dt><dd>${esc(row.change_reason)}</dd><dt>Why it may matter</dt><dd>${esc(row.implication || 'No reviewed implication attached. Inspect the evidence and affected records.')}</dd><dt>Evidence status</dt><dd>${esc(row.review_status)} · ${esc(date(row.source_published_at))}${row.source_date_basis ? ` · ${esc(row.source_date_basis.replaceAll('_',' '))}` : ''}</dd></dl><ul class="daily-sources">${links(row)}</ul><div class="daily-actions"><a href="${esc(row.record_url)}">Full signal record →</a><a href="${esc(row.research_url)}">Research this topic →</a></div>${row.component_id ? `<a href="https://uas-forge.com/dossier/?component=${encodeURIComponent(row.component_id)}">Component dossier →</a>` : row.platform_id ? `<a href="https://uas-forge.com/dossier/?platform=${encodeURIComponent(row.platform_id)}">Platform dossier →</a>` : ''}<button type="button" data-export>Export evidence packet</button><p class="daily-note">A linked source is a research lead. Claim support and source independence remain unreviewed unless explicitly recorded.</p>`;
  panel.querySelector('[data-export]').addEventListener('click',()=>{
    const packet={schema_version:1,exported_at:new Date().toISOString(),collection_generated_at:collection.generated_at,coverage:collection.coverage,query:filters.q,filters,projection_query:collection.query,record:row};
    const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`patterns-evidence-${row.id.replace(/[^\w-]/g,'_')}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  if(navigate){const url=new URL(location.href);url.hash=`daily=${encodeURIComponent(id)}`;if(url.href!==location.href)history.pushState(null,'',url);}
}
function viewFilters(){return {q:root.querySelector('input').value.trim(),state:root.querySelector('select').value};}
function restoreFilters(){const params=new URL(location.href).searchParams;root.querySelector('input').value=(params.get('q')||'').slice(0,160);const state=params.get('state')||'all';root.querySelector('select').value=['all','new','changed','escalated','deescalated','contradicted','resolved','unchanged','baseline'].includes(state)?state:'all';}
async function load() {
  const sequence=++requestSequence;
  if(controller)controller.abort();controller=new AbortController();
  const status=root.querySelector('[data-status]'),list=root.querySelector('[data-list]');
  const filters=viewFilters();
  status.textContent='Loading current collection…';list.setAttribute('aria-busy','true');
  try {
    const linked=location.hash.startsWith('#daily=')?decodeURIComponent(location.hash.slice(7)):'';
    const params=new URLSearchParams({type:'daily_changes',limit:'10',q:linked?'':filters.q,state:linked?'all':filters.state});
    if(linked)params.set('record',linked);
    const response=await fetch(`/api/data?${params}`,{signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw new Error('Collection unavailable');
    const envelope=await response.json();
    if(sequence!==requestSequence)return;
    const next=envelope.data??envelope;
    if(!next || next.schema_version!==1 || !Array.isArray(next.items) || !next.coverage || !next.counts)throw new Error('Invalid collection');
    current=next;appliedFilters=filters;
    const changed=['new','changed','escalated','deescalated','resolved','contradicted'].reduce((n,key)=>n+(current.counts[key]||0),0);
    status.textContent=current.coverage.status==='partial'?'Identity conflicts prevent a complete change summary. Unambiguous records are shown.':current.coverage.status!=='available'?'Coverage unavailable or stale. These records cannot establish today’s changes.':!current.baseline_established?'Baseline records. Change comparisons begin after a verified collection run.':changed?`${changed} material changes in the collection · ${date(current.generated_at)}`:'No material change in collected records. Source coverage may be incomplete.';
    list.innerHTML=current.items.map(row=>`<article class="daily-row"><div class="daily-row-meta"><span>${esc(row.change_kind)}</span><span>${esc(row.lens)}</span></div><button class="daily-title" data-id="${esc(row.id)}">${esc(row.title)}</button><p>${esc(row.detail.slice(0,210))}${row.detail.length>210?'…':''}</p><div class="daily-row-meta"><span>${esc(date(row.source_published_at))}</span><span>${row.sources.filter(source=>safeURL(source.url)).length} references · ${esc(row.review_status)}</span></div><small>Priority: ${esc(row.rank_reason)}</small></article>`).join('')||'<p>No matching records in this collection. This does not establish absence.</p>';
    list.querySelectorAll('[data-id]').forEach(button=>button.addEventListener('click',()=>showEvidence(button.dataset.id)));
    if(linked) showEvidence(linked,false);
    else if(current.items.length)showEvidence(current.items[0].id,false);
    else {selected=null;root.querySelector('[data-evidence]').textContent='Choose another topic or open Research to inspect wider coverage.';}
  } catch(error) {
    if(sequence!==requestSequence)return;
    selected=null;current=null;
    status.textContent='Current coverage unavailable. Retry or inspect data quality; no change conclusion is available.';
    list.innerHTML='<a href="/miner-health/">Inspect source coverage →</a>';
    root.querySelector('[data-evidence]').textContent='Evidence will appear when the collection is available.';
  } finally {if(sequence===requestSequence)list.removeAttribute('aria-busy');}
}
function queryLoad(){const url=new URL(location.href),filters=viewFilters();url.hash='';if(filters.q)url.searchParams.set('q',filters.q);else url.searchParams.delete('q');if(filters.state!=='all')url.searchParams.set('state',filters.state);else url.searchParams.delete('state');if(url.href!==location.href)history.pushState(null,'',url);load();}
if(root) {
  root.innerHTML=`<header class="daily-heading"><div><p class="daily-eyebrow">Your daily intelligence workspace</p><h2>What changed. What supports it.</h2></div><a href="/ask-pie/">Open research →</a></header><form class="daily-filters"><label>Topic or technology<input type="search" placeholder="An actor, company, or technology" maxlength="160"></label><label>Change<select><option value="all">All records</option><option value="new">New</option><option value="changed">Changed</option><option value="escalated">Escalated</option><option value="deescalated">Deescalated</option><option value="contradicted">Contradicted</option><option value="resolved">Resolved</option><option value="unchanged">Unchanged</option><option value="baseline">Baseline</option></select></label><button type="submit">Review</button><button type="button" data-follow>Follow topic</button></form><div class="daily-following" aria-label="Followed topics"></div><p data-status role="status" aria-live="polite"></p><div class="daily-columns"><section data-list aria-label="Daily changes"></section><aside data-evidence aria-label="Selected evidence">Select a record to inspect its evidence.</aside></div>`;
  const persistSaved=next=>{try{localStorage.setItem(storageKey,JSON.stringify(next));saved=next;return true;}catch{root.querySelector('[data-status]').textContent='Browser storage is unavailable; followed topics were not saved.';return false;}};
  const renderSaved=()=>{const area=root.querySelector('.daily-following');area.replaceChildren();saved.forEach(topic=>{const button=document.createElement('button');button.type='button';button.textContent=topic;button.addEventListener('click',()=>{root.querySelector('input').value=topic;queryLoad();});area.append(button);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Unfollow ${topic}`);remove.addEventListener('click',()=>{if(persistSaved(saved.filter(value=>value!==topic)))renderSaved();});area.append(remove);});};
  root.querySelector('form').addEventListener('submit',event=>{event.preventDefault();queryLoad();});
  root.querySelector('[data-follow]').addEventListener('click',()=>{const topic=root.querySelector('input').value.trim();if(topic&&!saved.includes(topic)&&persistSaved([...saved,topic].slice(-50)))renderSaved();});
  const navigate=()=>{restoreFilters();load();};
  window.addEventListener('popstate',navigate);window.addEventListener('hashchange',navigate);
  restoreFilters();renderSaved();load();
}
