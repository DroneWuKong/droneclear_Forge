(function (root) {
  'use strict';
  const api = {};
  const statusNames = {needs_review: 'Needs review', stale_review: 'Review expired', supported: 'Source supported', not_supported: 'Unsupported attribution', disputed: 'Disputed', rejected: 'Rejected', superseded: 'Superseded'};
  const text = value => String(value == null ? '' : value);
  api.safeUrl = function (value) {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username ? u.href : null; } catch (_) { return null; }
  };
  const lifecycleNames = {documented:'Documented integration', available_option:'Available option', tested:'Tested integration', demonstrated:'Demonstrated', announced:'Announced collaboration', completed:'Completed transaction', unspecified:'Configuration unrecorded'};
  api.filterRows = function (data, filters) {
    const nodes = new Map(data.nodes.map(n => [n.id, n]));
    const query = text(filters.query).toLowerCase().trim();
    return data.relationships.filter(r => {
      if (filters.status === 'resolved' ? r.active !== false : (!filters.includeHistory && r.active === false)) return false;
      if (filters.status === 'priority' && r.review_priority !== 'high') return false;
      if (filters.lifecycle && r.lifecycle !== filters.lifecycle) return false;
      if (filters.view === 'supply' && r.origin !== 'legacy_supply') return false;
      if (filters.view === 'research' && r.origin !== 'graphify_candidate') return false;
      if (filters.dossier && !r.evidence.some(e => e.dossier_slug === filters.dossier)) return false;
      if (filters.status === 'conflict' && !r.conflicting_record_ids.length) return false;
      if (filters.status === 'supported' && r.review_status !== 'supported') return false;
      if (filters.status === 'needs_review' && !['needs_review', 'stale_review'].includes(r.review_status)) return false;
      const haystack = [nodes.get(r.source)?.label, nodes.get(r.target)?.label, r.component, r.company, r.relation, r.subsystem, r.role, r.configuration, ...(r.source_publishers || [])].join(' ').toLowerCase();
      return !query || haystack.includes(query);
    }).sort((a,b) => (filters.status === 'priority' ? (b.conflicting_record_ids.length - a.conflicting_record_ids.length) : 0) || (nodes.get(a.source)?.label || '').localeCompare(nodes.get(b.source)?.label || '') || (nodes.get(a.target)?.label || '').localeCompare(nodes.get(b.target)?.label || ''));
  };
  api.connected = (rows, id) => rows.filter(r => r.source === id || r.target === id);
  api.entities = function (data, rows) {
    const counts = new Map();
    rows.forEach(r => [r.source, r.target].forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
    return data.nodes.filter(n => counts.has(n.id)).map(n => ({...n, count: counts.get(n.id)}))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  if (typeof module !== 'undefined') module.exports = api;
  if (!root.document) return;
  const doc = root.document;
  function el(tag, value, cls) { const e = doc.createElement(tag); if (value != null) e.textContent = value; if (cls) e.className = cls; return e; }
  function anchor(label, url) { const a = el('a', label); a.href = url; return a; }
  function external(label, url) { const safe = api.safeUrl(url); if (!safe) return null; const a = anchor(label, safe); a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
  let cached;
  function load() {
    if (!cached) cached = fetch('/private/relationships.json', {cache: 'no-store'}).then(r => {
      if (!r.ok) throw new Error('Relationship evidence unavailable'); return r.json();
    }).then(data => { if (data.schema_version !== 1) throw new Error('Unsupported relationship format'); return data; });
    return cached;
  }
  function card(row, nodes, compact) {
    const box = el('article', null, 'relationship-card'); box.id = row.id;
    box.append(el('h3', `${nodes.get(row.source)?.label || '?'} → ${nodes.get(row.target)?.label || '?'}`));
    box.append(el('p', `${row.relation.replaceAll('_', ' ')}${row.component ? ' · ' + row.component : ''}`, 'relationship-kind'));
    box.append(el('p', `${statusNames[row.review_status] || 'Needs review'} · ${row.assertion}${row.legacy_confidence ? ' · legacy ' + row.legacy_confidence : ''}${row.extraction ? ' · ' + row.extraction : ''}`, 'relationship-status'));
    if (row.conflicting_record_ids.length) {
      box.append(el('p', 'Conflicting claim in another record — compare the evidence before relying on this link.', 'relationship-conflict'));
      box.append(anchor('Compare conflicting evidence', '/private/supply-web/?view=all&status=conflict&q=' + encodeURIComponent(nodes.get(row.source)?.label || '')));
    }
    box.append(el('p', lifecycleNames[row.lifecycle] || lifecycleNames.unspecified, 'relationship-scope'));
    if (row.role || row.configuration) box.append(el('p', [row.role?.replaceAll('_', ' '), row.configuration].filter(Boolean).join(' · '), 'relationship-kind'));
    box.append(el('p', row.verified_on ? (row.review_type === 'source_checked' ? 'Sources checked ' : 'Reviewed ') + row.verified_on : 'Review date not recorded', 'relationship-date'));
    if (row.source_count) box.append(el('p', `${row.source_count} primary source${row.source_count === 1 ? '' : 's'} · ${(row.source_publishers || []).length} publisher${row.source_publishers?.length === 1 ? '' : 's'}. Source support is not independent hardware verification.`, 'relationship-date'));
    if (row.active === false) box.append(el('p', 'Retained as review history; excluded from active relationships.', 'relationship-gap'));
    box.append(anchor('Link to this record', '/private/supply-web/?view=all&record=' + encodeURIComponent(row.id) + (row.active === false ? '&status=resolved' : '')));
    if (row.note) box.append(el('p', (row.evidence_scope === 'supplier' ? 'Supplier-level context: ' : '') + row.note));
    if (row.evidence_scope === 'supplier') box.append(el('p', 'These sources belong to the supplier record. They have not been attributed to this individual connection.', 'relationship-gap'));
    row.review_gaps.forEach(g => box.append(el('p', g, 'relationship-gap')));
    if (row.review_priority === 'high') box.append(el('p', 'Priority review: resolve the conflict, expired review, or unsupported legacy confirmation.', 'relationship-gap'));
    const details = el('details'); details.open = !compact;
    details.append(el('summary', 'Evidence and review history'));
    [...row.evidence].sort((a,b) => Number(b.evidence_type === 'primary_source') - Number(a.evidence_type === 'primary_source')).forEach(e => {
      if (e.evidence_type === 'primary_source') {
        const block = el('section', null, 'relationship-source');
        const link = external(e.title, e.url); if (link) block.append(link);
        block.append(el('p', `${e.publisher} · ${e.kind.replaceAll('_',' ')} · ${e.supports === 'claim' ? 'supports this claim' : e.supports}`, 'relationship-kind'));
        block.append(el('p', e.summary));
        block.append(el('p', `Published/modified ${e.published_on || 'date unknown'} · retrieved ${e.retrieved_on}`, 'relationship-date'));
        block.append(el('p', 'Passage: ' + e.locator, 'relationship-date'));
        details.append(block); return;
      }
      if (e.excerpt && !row.source_count) details.append(el('blockquote', e.excerpt));
      if (e.source_path) {
        const p = el('p', e.source_location + (e.source_date ? ' · source dated ' + e.source_date : ' · source date not recorded'));
        p.append(doc.createTextNode(' · '), anchor('Read dossier', '/private/dossiers/#' + encodeURIComponent(e.dossier_slug)));
        details.append(p);
        details.append(el('p', e.passage_matches ? 'Passage matches the pinned document; truth of the claim still requires review.' : 'Passage needs to be checked against the current document.', 'relationship-date'));
      }
      (row.source_count && e.source_path ? [] : e.urls || []).forEach(url => { const a = external(new URL(api.safeUrl(url) || 'https://invalid.local').hostname + ' — source', url); if (a) details.append(a); });
    });
    (row.review_history || []).forEach(r => details.append(el('p', `${r.reviewed_on} · ${r.reviewer}: ${r.status} — ${r.rationale}`)));
    if (!row.evidence.length) details.append(el('p', 'No source attached.'));
    box.append(details);
    return box;
  }
  api.dossierPanel = async function (slug, reader) {
    reader.dataset.relationshipSlug = slug;
    const panel = el('section', null, 'relationship-dossier');
    try {
      const data = await load();
      if (reader.dataset.relationshipSlug !== slug) return;
      const rows = api.filterRows(data, {view: 'research', dossier: slug, includeHistory: true});
      if (!rows.length) return;
      const nodes = new Map(data.nodes.map(n => [n.id, n]));
      panel.append(el('h2', 'Relationship evidence'), el('p', `${rows.length} claims and review records. Source checks and extraction labels remain separate.`));
      panel.append(anchor('Explore these connections', '/private/supply-web/?view=research&dossier=' + encodeURIComponent(slug)));
      rows.forEach(row => panel.append(card(row, nodes, true)));
      reader.prepend(panel);
    } catch (_) {
      // The dossier remains readable when an older release lacks the optional index.
    }
  };
  root.PrivateRelationships = api;

  async function start() {
    if (!doc.getElementById('relationship-browser')) return;
    const get = id => doc.getElementById(id);
    try {
      const data = await load(), nodeMap = new Map(data.nodes.map(n => [n.id, n]));
      const params = new URLSearchParams(root.location.search);
      get('view').value = ['research', 'all'].includes(params.get('view')) ? params.get('view') : 'supply';
      get('status-filter').value = ['conflict', 'supported', 'needs_review', 'priority', 'resolved'].includes(params.get('status')) ? params.get('status') : '';
      get('query').value = params.get('q') || '';
      get('lifecycle-filter').value = Object.keys(lifecycleNames).includes(params.get('stage')) ? params.get('stage') : '';
      const linkedRecord = data.relationships.find(r => r.id === params.get('record'));
      let dossier = params.get('dossier') || '', selected = linkedRecord?.source || '', matchingRows = [];
      get('show-all').checked = params.get('list') === 'all' || get('status-filter').value === 'priority';
      get('dossier-filter').hidden = !dossier;
      get('clear-dossier').textContent = dossier ? 'Clear dossier filter: ' + dossier : '';
      get('provenance').textContent = `Dataset updated ${data.supply_source_generated || 'unknown'} · research checked ${data.research_checked_on || 'not recorded'} · release ${data.upstream_ref.slice(0, 12)}. Dataset dates do not reverify individual claims.`;
      get('summary').textContent = `${data.summary.supply_links} supply links · ${data.summary.candidates} research records · ${data.summary.supported || 0} source supported · ${data.summary.primary_sources || 0} linked primary sources`;
      if (data.rejected_candidates.length) get('summary').append(doc.createTextNode(` · ${data.rejected_candidates.length} candidate(s) excluded because their input needs repair`));
      get('queue-button').textContent = `Review priority gaps (${data.summary.high_priority || 0})`;
      get('history-button').textContent = `View corrections (${data.summary.resolved || 0})`;
      function update() {
        const rows = api.filterRows(data, {view: get('view').value, query: get('query').value, status: get('status-filter').value, lifecycle: get('lifecycle-filter').value, dossier});
        matchingRows = rows;
        const entities = api.entities(data, rows);
        if (!entities.some(n => n.id === selected)) selected = entities[0]?.id || '';
        get('entity').replaceChildren();
        entities.forEach(n => { const option = el('option', `${n.label} (${n.count})`); option.value = n.id; get('entity').append(option); });
        get('entity').value = selected;
        const connected = api.connected(rows, selected);
        get('connections').replaceChildren();
        const displayed = get('show-all').checked ? rows : connected;
        displayed.forEach(row => get('connections').append(card(row, nodeMap, displayed.length > 3)));
        get('result-count').textContent = rows.length ? `${rows.length} matching records · ${rows.filter(r=>r.review_status === 'supported').length} source supported · ${get('show-all').checked ? 'showing all matches' : 'showing ' + connected.length + ' connections for ' + nodeMap.get(selected)?.label}` : 'No matching relationships. Try clearing the filters.';
        if (!rows.length && get('view').value === 'research' && !data.summary.candidates) get('result-count').textContent = 'No Graphify candidates in this release. Existing supply evidence is available in Supply links.';
        draw(connected);
        const next = new URLSearchParams();
        next.set('view', get('view').value);
        if (get('query').value) next.set('q', get('query').value);
        if (get('status-filter').value) next.set('status', get('status-filter').value);
        if (get('lifecycle-filter').value) next.set('stage', get('lifecycle-filter').value);
        if (get('show-all').checked) next.set('list', 'all');
        if (dossier) next.set('dossier', dossier);
        if (linkedRecord && displayed.some(r=>r.id === linkedRecord.id)) next.set('record', linkedRecord.id);
        root.history.replaceState(null, '', '?' + next);
        get('export-matches').disabled = !rows.length;
      }
      function draw(rows) {
        const svg = get('relationship-graph'); svg.replaceChildren();
        if (!selected) return;
        const ns = 'http://www.w3.org/2000/svg';
        const se = (tag, attrs) => { const e = doc.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => e.setAttribute(k, v)); return e; };
        const neighbors = [...new Set(rows.flatMap(r => [r.source, r.target]))].filter(id => id !== selected);
        const mobile = root.matchMedia('(max-width:720px)').matches;
        const shown = neighbors.slice(0, mobile ? 6 : 12), cy = shown.length < 4 ? 115 : 190;
        svg.setAttribute('viewBox', `0 0 600 ${cy * 2 + 10}`);
        get('graph-note').textContent = neighbors.length > shown.length ? `Showing ${shown.length} of ${neighbors.length} neighbors. All connections are listed below.` : 'Tap an entity to explore its connections. All evidence is listed below.';
        const places = [{id: selected, x: 300, y: cy}].concat(shown.map((id, i) => ({id, x: 300 + 195 * Math.cos(2*Math.PI*i/shown.length), y: cy + (cy-52)*Math.sin(2*Math.PI*i/shown.length)})));
        places.slice(1).forEach(p => svg.append(se('line', {x1: 300, y1: cy, x2: p.x, y2: p.y, stroke: '#687886', 'stroke-width': 1.5})));
        places.forEach(p => {
          const n = nodeMap.get(p.id), g = se('g', {role: 'button', tabindex: 0, 'aria-label': n.label});
          g.append(se('circle', {cx:p.x, cy:p.y, r:p.id === selected ? 21 : 12, fill:p.id === selected ? '#5ed294' : '#75aaff'}));
          const title = se('title', {}); title.textContent = n.label; g.append(title);
          const limit = mobile ? 15 : 23;
          const label = se('text', {x:p.x, y:p.y+38, 'text-anchor':'middle', fill:'#f1f4f2', 'font-size':mobile ? 24 : 14});
          label.textContent = n.label.length > limit ? n.label.slice(0, limit-2) + '…' : n.label; g.append(label);
          const choose = () => { selected = p.id; update(); };
          g.addEventListener('click', choose); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
          svg.append(g);
        });
      }
      ['view', 'status-filter', 'lifecycle-filter', 'show-all'].forEach(id => get(id).addEventListener('change', update));
      get('query').addEventListener('input', update);
      get('entity').addEventListener('change', () => { selected = get('entity').value; update(); });
      get('clear-dossier').addEventListener('click', () => { dossier = ''; get('dossier-filter').hidden = true; update(); });
      get('reset').addEventListener('click', () => { dossier = ''; selected = ''; get('dossier-filter').hidden = true; get('query').value = ''; get('status-filter').value = ''; get('lifecycle-filter').value = ''; get('show-all').checked = false; update(); });
      get('queue-button').addEventListener('click', () => { get('view').value = 'all'; get('status-filter').value = 'priority'; get('query').value = ''; get('lifecycle-filter').value = ''; get('show-all').checked = true; dossier = ''; get('dossier-filter').hidden = true; update(); });
      get('history-button').addEventListener('click', () => { get('view').value = 'all'; get('status-filter').value = 'resolved'; get('query').value = ''; get('lifecycle-filter').value = ''; get('show-all').checked = true; dossier = ''; get('dossier-filter').hidden = true; update(); });
      get('export-matches').addEventListener('click', () => {
        const ids = new Set(matchingRows.flatMap(r=>[r.source,r.target]));
        const payload = {schema_version:data.schema_version, upstream_ref:data.upstream_ref, filtered:true, nodes:data.nodes.filter(n=>ids.has(n.id)), relationships:matchingRows};
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}));
        const a = anchor('Download filtered evidence', url); a.download = 'private-relationship-evidence.json'; a.click(); root.setTimeout(()=>URL.revokeObjectURL(url),1000);
      });
      root.addEventListener('resize', update);
      update();
      if (linkedRecord) doc.getElementById(linkedRecord.id)?.scrollIntoView({block:'center'});
    } catch (_) { get('result-count').textContent = 'Relationship evidence could not be loaded. Reload after signing in, or check that this release includes its private evidence index.'; }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof window === 'undefined' ? globalThis : window);
