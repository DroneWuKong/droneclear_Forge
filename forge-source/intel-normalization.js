/* Truthful normalization of reference records: publication dates and citations are never invented. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.IntelNormalization = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const text = value => String(value == null ? '' : value).trim();
  function sourceUrl(value) {
    try { const url = new URL(text(value)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  }
  function dates(row, meta) {
    const raw = text(row.published_at || row.pub_date || row.date);
    const isoDay=/^\d{4}-\d{2}-\d{2}/.test(raw) ? new Date(raw.slice(0,10)) : null;
    const validDay=isoDay && Number.isFinite(isoDay.getTime()) && isoDay.toISOString().slice(0,10)===raw.slice(0,10);
    const precision = /^\d{4}$/.test(raw) ? 'year' : /^\d{4}-\d{2}$/.test(raw) ? 'month' : /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw) && validDay && Number.isFinite(Date.parse(raw)) ? 'day' : raw ? 'unparsed' : 'unknown';
    return {pub_date:precision === 'unparsed' ? '' : raw, publication_date_raw:raw, date_precision:precision, date_basis:raw ? 'source reported' : 'not reported', collected_at:text(row.collected_at || row.scraped_at), reference_as_of:text(meta && (meta.last_updated || meta.generated_at))};
  }
  function stableReferenceId(row) {
    const value=JSON.stringify([row.program,row.awardee,row.company,row.name,row.type,row.amount,row.value,row.date]);
    let a=2166136261,b=5381;for(const character of value){a=Math.imul(a^character.charCodeAt(0),16777619);b=Math.imul(b,33)^character.charCodeAt(0);}
    return `${(a>>>0).toString(16)}${(b>>>0).toString(16)}`;
  }
  function reference(row, meta, fields) {
    const url = sourceUrl(row.url || row.source_url);
    return {...fields, id:row.id || fields.id.replace(/_\d+$/, '')+'_'+stableReferenceId(row), ...dates(row, meta), url, citation_status:url ? 'source URL supplied; support not reviewed' : 'missing', source:'forge_intel', paywall:false, record_type:'reference', entities:{companies:[row.awardee, row.company].filter(Boolean)}};
  }
  function defenseRecords(fi) {
    if (!fi) return [];
    const rows = [];
    (fi.contracts || []).forEach((row, i) => rows.push(reference(row, fi.meta, {id:row.id || 'forge_contract_' + i, title:(row.program || 'Defense Contract') + ' — ' + (row.awardee || ''), summary:[row.awardee, row.value || 'Value undisclosed', row.type, row.notes].filter(Boolean).join(' | '), vertical_tag:'defense', data_category:'procurement'})));
    (fi.funding || []).filter(row => /defense|series/i.test(row.type || '')).forEach((row, i) => rows.push(reference(row, fi.meta, {id:row.id || 'forge_funding_def_' + i, title:[row.company, 'raises', row.amount, row.type].filter(Boolean).join(' '), summary:[row.company, row.amount, row.valuation, row.note].filter(Boolean).join(' | '), vertical_tag:'defense', data_category:'financial'})));
    if (fi.market_stats) rows.push(reference(fi.market_stats, fi.meta, {id:'forge_market_stats', title:'Defense UAS market reference', summary:Object.entries(fi.market_stats).filter(([key]) => !['url','source_url','date'].includes(key)).map(([key,value]) => `${key.replace(/_/g,' ')}: ${value}`).join(' | '), vertical_tag:'defense', data_category:'financial'}));
    return rows;
  }
  function commercialRecords(fi) {
    if (!fi) return [];
    const rows = [];
    (fi.funding || []).filter(row => !/defense/i.test(row.type || '')).forEach((row,i) => rows.push(reference(row, fi.meta, {id:row.id || 'forge_funding_com_' + i, title:[row.company, 'raises', row.amount, row.type].filter(Boolean).join(' '), summary:[row.company,row.amount,row.valuation,row.note].filter(Boolean).join(' | '), vertical_tag:'commercial',data_category:'financial'})));
    (fi.commercial_sources || []).slice(0,10).forEach((row,i) => rows.push(reference(row, fi.meta,{id:row.id || 'forge_com_source_' + i,title:[row.name,row.type].filter(Boolean).join(' — '),summary:[row.type,row.parts ? `${row.parts} parts/products` : '',row.note].filter(Boolean).join(' | '),vertical_tag:'commercial',data_category:'platform_intel'})));
    (fi.grants_awards || []).filter(row => row.type && !/defense|legislation/i.test(row.type)).forEach((row,i) => rows.push(reference(row,fi.meta,{id:row.id || 'forge_grant_com_' + i,title:row.program || 'Grant reference',summary:[row.type,row.note,row.amount].filter(Boolean).join(' | '),vertical_tag:'commercial',data_category:'grant'})));
    return rows;
  }
  function relatedFlags(record, flags, signalsApi) {
    if (!signalsApi) return [];
    const structured = record.entities || {};
    const names = [record.manufacturer, record.company, record.awardee, record.actor, ...(structured.companies || []), ...(structured.actors || []), ...(structured.manufacturers || [])];
    const generic = new Set(['all','unknown','drone','drones','defense','military','systems','technology','technologies','uas','uav']);
    const identities = [...new Set(names.filter(value => typeof value === 'string').map(value => value.trim()).filter(value => value.length > 2 && !generic.has(value.toLowerCase())))];
    const matched = new Map();
    for (const name of identities) {
      for (const match of signalsApi.matchFlags(flags, name, {name}, [])) {
        const key = match.id || match.flag_id || JSON.stringify([match.title,match.date]);
        if (!matched.has(key) || match._match_confidence === 'direct') matched.set(key, {...match, _matched_identity:name});
      }
    }
    return signalsApi.sortSignals([...matched.values()]);
  }
  return {sourceUrl,dates,defenseRecords,commercialRecords,relatedFlags};
});
