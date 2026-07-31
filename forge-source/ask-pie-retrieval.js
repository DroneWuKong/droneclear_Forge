/*
 * Ask PIE — deterministic cited retrieval over the public Patterns corpus.
 *
 * This module does not generate conclusions. It converts a natural-language
 * question into transparent search terms, ranks indexed records, and returns an
 * evidence packet with source URLs, dates, match reasons, coverage, and explicit
 * limitations. Pure functions are exported for Node software-only tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AskPieRetrieval = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STOPWORDS = new Set([
    'a','an','and','are','as','at','be','been','being','by','can','could','did','do','does','for','from',
    'has','have','how','i','in','is','it','its','may','might','of','on','or','should','that','the','their',
    'there','these','this','to','was','were','what','when','where','which','who','why','will','with','would'
  ]);
  const TYPE_ORDER = ['article','flag','actor','ttp'];
  const TYPE_LABEL = Object.freeze({ article:'Article evidence', flag:'Indexed signal', actor:'Actor context', ttp:'TTP context' });
  const TYPE_DESTINATION = Object.freeze({ article:'/intel/', flag:'/patterns/', actor:'/actors/', ttp:'/ttps/' });
  const MAX_CITATIONS_PER_RECORD = 8;

  function text(value) { return String(value == null ? '' : value).trim(); }
  function normalize(value) {
    return text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }
  function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function termPattern(term) {
    const value = normalize(term);
    if (!value) return null;
    const body = value.split(' ').map(escapeRegex).join('\\s+');
    return new RegExp(`(?:^|[^a-z0-9])${body}(?=$|[^a-z0-9])`, 'i');
  }
  function queryTerms(query) {
    const raw = normalize(query).split(' ').filter(Boolean);
    const meaningful = raw.filter(token => token.length > 1 && !STOPWORDS.has(token));
    return Array.from(new Set(meaningful)).slice(0, 16);
  }
  function safeHttpUrl(value) {
    const candidate = text(value);
    return /^https?:\/\//i.test(candidate) ? candidate : '';
  }
  function parseDate(value) {
    const raw = text(value);
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  function dateValue(record) {
    return text(record && (record.published_at || record.pub_date || record.date || record.last_seen || record.first_seen || record.generated_at));
  }
  function dateSortValue(value) {
    const parsed = parseDate(value);
    return parsed ? parsed.getTime() : 0;
  }
  function flatten(value, depth, output, seen) {
    if (value == null || depth > 5) return output;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const scalar = text(value);
      if (scalar) output.push(scalar);
      return output;
    }
    if (typeof value !== 'object' || seen.has(value)) return output;
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 160).forEach(item => flatten(item, depth + 1, output, seen));
    } else {
      Object.keys(value).sort().forEach(key => {
        if (/^(raw_html|content_html|embedding|body_text)$/i.test(key)) return;
        flatten(value[key], depth + 1, output, seen);
      });
    }
    return output;
  }
  function searchableText(record) { return normalize(flatten(record, 0, [], new Set()).join(' ')); }
  function unwrap(payload) { return payload && payload.data !== undefined ? payload.data : payload; }

  function citationKey(citation) {
    return [citation.url, citation.title, citation.source, citation.date].map(normalize).join('|');
  }
  function normalizeCitation(value, fallback) {
    const row = value && typeof value === 'object' ? value : {};
    const url = safeHttpUrl(row.url || row.link || row.source_url || (fallback && fallback.url));
    if (!url) return null;
    return {
      url,
      title: text(row.title || row.name || row.label || (fallback && fallback.title)) || 'Source evidence',
      source: text(row.site || row.source || row.publisher || row.organization || (fallback && fallback.source)) || 'Source not labeled',
      date: text(row.published_at || row.pub_date || row.date || row.raw_date || (fallback && fallback.date)),
      kind: text(row.type || row.kind || (fallback && fallback.kind)) || 'source'
    };
  }
  function dedupeCitations(values) {
    const seen = new Set();
    const output = [];
    values.forEach(value => {
      if (!value) return;
      const key = citationKey(value);
      if (seen.has(key)) return;
      seen.add(key);
      output.push(value);
    });
    return output.slice(0, MAX_CITATIONS_PER_RECORD);
  }
  function citationsFromFlag(row) {
    const values = [];
    const direct = normalizeCitation(row, { title:row.title, source:row.source, date:dateValue(row) });
    if (direct) values.push(direct);
    const sources = Array.isArray(row.sources) ? row.sources : [];
    sources.forEach(source => values.push(normalizeCitation(source, { title:row.title, date:dateValue(row), kind:'flag source' })));
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    evidence.forEach(source => values.push(normalizeCitation(source, { title:row.title, date:dateValue(row), kind:'flag evidence' })));
    return dedupeCitations(values);
  }
  function citationsFromActor(row) {
    const values = [];
    const samples = Array.isArray(row.sample_articles) ? row.sample_articles : [];
    samples.forEach(sample => values.push(normalizeCitation(sample, { kind:'actor sample article' })));
    const evidence = Array.isArray(row.evidence_articles) ? row.evidence_articles : [];
    evidence.forEach(sample => values.push(normalizeCitation(sample, { kind:'actor evidence article' })));
    return dedupeCitations(values);
  }
  function citationsFromTtp(row) {
    const values = [];
    const matches = Array.isArray(row.sample_matches) ? row.sample_matches : [];
    matches.forEach(match => values.push(normalizeCitation(match, { title:row.description || row.ttp_id, kind:'defensive-signal match' })));
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    evidence.forEach(match => values.push(normalizeCitation(match, { title:row.description || row.ttp_id, kind:'TTP evidence' })));
    return dedupeCitations(values);
  }

  function makeRecord(type, row, fields) {
    const title = text(fields.title) || 'Untitled indexed record';
    const summary = text(fields.summary) || 'No summary was provided by the source dataset.';
    const citations = dedupeCitations(fields.citations || []);
    const searchText = normalize([title, summary, fields.extra || '', searchableText(row)].join(' '));
    return {
      id: text(fields.id) || `${type}-${normalize(title).slice(0, 80)}`,
      type,
      title,
      summary,
      date: text(fields.date),
      source: text(fields.source),
      destination: fields.destination || TYPE_DESTINATION[type] || '/patterns-home/',
      semantics: text(fields.semantics),
      searchText,
      titleText: normalize(title),
      summaryText: normalize(summary),
      citations,
      raw: row
    };
  }
  function articleRecords(payload) {
    const value = unwrap(payload);
    const rows = Array.isArray(value) ? value : (value && Array.isArray(value.articles) ? value.articles : []);
    return rows.map((row, index) => {
      const citation = normalizeCitation(row, { title:row.title, source:row.site, date:row.pub_date, kind:'article' });
      return makeRecord('article', row, {
        id:row.aid || row.id || `article-${index}`,
        title:row.title || row.aid,
        summary:row.summary || row.description || row.body_excerpt,
        date:row.pub_date || row.published_at || row.date,
        source:row.site || row.source,
        destination:citation ? citation.url : '/intel/',
        citations:citation ? [citation] : [],
        semantics:'Published article record. A publication is evidence of reporting, not automatic proof that every claim in it is correct.',
        extra:row.entities
      });
    });
  }
  function flagRecords(payload) {
    const value = unwrap(payload);
    const rows = Array.isArray(value) ? value : (value && Array.isArray(value.flags) ? value.flags : []);
    return rows.map((row, index) => makeRecord('flag', row, {
      id:row.id || row.flag_id || `flag-${index}`,
      title:row.title || row.headline || row.flag_type || row.id,
      summary:row.detail || row.summary || row.description || row.rationale,
      date:dateValue(row),
      source:row.source || row.entity || row.category,
      citations:citationsFromFlag(row),
      semantics:'Analytic signal derived from indexed public records. It is not an allegation, legal finding, or authoritative compliance determination.'
    }));
  }
  function actorRows(payload) {
    const value = unwrap(payload) || {};
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.fingerprints)) return value.fingerprints;
    if (Array.isArray(value.actors)) return value.actors;
    return [];
  }
  function actorEventRows(payload) {
    const value = unwrap(payload) || {};
    if (Array.isArray(value.actor_summary)) return value.actor_summary;
    if (Array.isArray(value.actor_summaries)) return value.actor_summaries;
    return [];
  }
  function mergeActorEvents(rows, eventPayload) {
    const index = Object.create(null);
    actorEventRows(eventPayload).forEach(row => {
      const actor = text(row.actor);
      if (actor) index[actor] = row;
    });
    return rows.map(row => {
      const event = index[text(row.actor)];
      return event ? Object.assign({}, row, {
        reporting_cluster_count:event.reporting_cluster_count,
        candidate_event_count:event.candidate_event_count,
        multi_source_candidate_event_count:event.multi_source_candidate_event_count,
        event_semantics:event.semantics
      }) : row;
    });
  }
  function actorRecords(payload, eventPayload) {
    return mergeActorEvents(actorRows(payload), eventPayload).map((row, index) => {
      const mentions = Number(row.article_mention_count || row.incident_count || 0);
      const sources = Number(row.unique_source_count || 0);
      const reporting = Number(row.reporting_cluster_count || 0);
      const candidates = Number(row.candidate_event_count || 0);
      const multi = Number(row.multi_source_candidate_event_count || 0);
      const clusterClause = reporting || candidates || multi
        ? ` Duplicate-adjusted reporting: ${reporting.toLocaleString()} reporting clusters, ${candidates.toLocaleString()} candidate-event clusters, ${multi.toLocaleString()} multi-site candidates.`
        : '';
      return makeRecord('actor', row, {
        id:row.actor || `actor-${index}`,
        title:row.actor || row.name,
        summary:`${mentions.toLocaleString()} article mentions across ${sources.toLocaleString()} source labels.${clusterClause}`,
        date:row.last_seen,
        source:(row.top_sources && Object.keys(row.top_sources).slice(0, 4).join(', ')) || '',
        citations:citationsFromActor(row),
        semantics:'Actor-centered public-source reporting signal. Mentions and candidate-event clusters are not confirmed incidents or formal attribution.'
      });
    });
  }
  function ttpRecords(payload) {
    const value = unwrap(payload) || {};
    const rows = Array.isArray(value) ? value : (Array.isArray(value.results) ? value.results : []);
    return rows.map((row, index) => makeRecord('ttp', row, {
      id:row.ttp_id || row.id || `ttp-${index}`,
      title:row.ttp_name || row.ttp || row.description || row.ttp_id,
      summary:[row.description, row.verdict, row.counter_signal_count != null ? `${row.counter_signal_count} indexed defensive-signal matches` : ''].filter(Boolean).join(' · '),
      date:dateValue(row),
      source:'Indexed procurement/component corpus',
      citations:citationsFromTtp(row),
      semantics:'Keyword-based defensive-signal comparison. Missing indexed evidence does not prove that no program, inventory, spending, or capability exists.'
    }));
  }
  function buildCorpus(payloads) {
    return [
      ...articleRecords(payloads && payloads.articles),
      ...flagRecords(payloads && payloads.flags),
      ...actorRecords(payloads && payloads.actors, payloads && payloads.events),
      ...ttpRecords(payloads && payloads.ttps)
    ];
  }

  function countOccurrences(haystack, pattern) {
    if (!pattern) return 0;
    const matches = haystack.match(new RegExp(pattern.source, 'gi'));
    return matches ? matches.length : 0;
  }
  function scoreRecord(record, query) {
    const terms = queryTerms(query);
    if (!terms.length) return { score:0, matchedTerms:[], coverage:0, direct:false, reason:[] };
    const phrase = normalize(query);
    const matchedTerms = [];
    const reason = [];
    let score = 0;
    terms.forEach(term => {
      const pattern = termPattern(term);
      const inTitle = countOccurrences(record.titleText, pattern);
      const inSummary = countOccurrences(record.summaryText, pattern);
      const inAll = countOccurrences(record.searchText, pattern);
      if (!inAll) return;
      matchedTerms.push(term);
      if (inTitle) { score += 9 + Math.min(3, inTitle - 1); reason.push(`${term}: title`); }
      else if (inSummary) { score += 5 + Math.min(2, inSummary - 1); reason.push(`${term}: summary`); }
      else { score += 2; reason.push(`${term}: indexed fields`); }
    });
    if (phrase.length >= 5 && record.titleText.includes(phrase)) { score += 14; reason.push('full query: title'); }
    else if (phrase.length >= 5 && record.summaryText.includes(phrase)) { score += 8; reason.push('full query: summary'); }
    const coverage = matchedTerms.length / terms.length;
    const direct = coverage === 1;
    if (direct) score += 8;
    else score += Math.round(coverage * 4);
    score += Math.min(4, record.citations.length);
    const age = dateSortValue(record.date);
    if (age) {
      const days = Math.max(0, (Date.now() - age) / 86400000);
      if (days <= 30) score += 3;
      else if (days <= 180) score += 1;
    }
    return { score, matchedTerms, coverage, direct, reason };
  }
  function rankEvidence(records, query, options) {
    const limit = Math.max(1, Math.min(100, Number(options && options.limit) || 40));
    return (Array.isArray(records) ? records : []).map((record, index) => ({
      record,
      index,
      ranking:scoreRecord(record, query)
    })).filter(item => item.ranking.matchedTerms.length > 0)
      .sort((left, right) => {
        if (left.ranking.direct !== right.ranking.direct) return left.ranking.direct ? -1 : 1;
        if (right.ranking.score !== left.ranking.score) return right.ranking.score - left.ranking.score;
        const dateDelta = dateSortValue(right.record.date) - dateSortValue(left.record.date);
        if (dateDelta) return dateDelta;
        const typeDelta = TYPE_ORDER.indexOf(left.record.type) - TYPE_ORDER.indexOf(right.record.type);
        return typeDelta || left.index - right.index;
      }).slice(0, limit);
  }
  function evidencePacket(ranked, query) {
    const direct = ranked.filter(item => item.ranking.direct && item.record.citations.length);
    const contextual = ranked.filter(item => !item.ranking.direct && item.record.citations.length);
    const analytic = ranked.filter(item => !item.record.citations.length);
    const citations = dedupeCitations(ranked.flatMap(item => item.record.citations));
    const sources = new Set(citations.map(citation => normalize(citation.source)).filter(Boolean));
    const dated = citations.map(citation => parseDate(citation.date)).filter(Boolean).sort((a,b) => a-b);
    return {
      query:text(query),
      terms:queryTerms(query),
      ranked,
      direct,
      contextual,
      analytic,
      citations,
      uniqueSourceLabelCount:sources.size,
      coverageStart:dated.length ? dated[0].toISOString() : null,
      coverageEnd:dated.length ? dated[dated.length - 1].toISOString() : null,
      conclusionAllowed:false,
      contradictionAssessment:'not automatically assessed'
    };
  }

  function coverageFacts(catalogPayload, coveragePayload, errors) {
    const catalog = unwrap(catalogPayload) || {};
    const coverage = unwrap(coveragePayload) || {};
    const meta = coverage.meta || {};
    const concentration = meta.source_concentration || {};
    return {
      catalogGeneratedAt:catalog.meta && catalog.meta.generated_at,
      coverageGeneratedAt:meta.generated_at,
      indexedArticleCount:meta.analyzed_article_records,
      observedSourceCount:meta.observed_source_key_count,
      registeredSourceCount:meta.registered_source_count,
      topSourceShare:concentration.top_source_share,
      unparseableDateCount:meta.unparseable_publication_date_count,
      futureDatedCount:meta.future_dated_record_count,
      missingLanguageCount:meta.explicit_language_metadata_missing_record_count,
      missingGeographyCount:meta.explicit_geography_metadata_missing_record_count,
      caveat:text(meta.caveat) || 'Coverage describes indexed public records, not all available intelligence.',
      unavailableDatasets:Array.isArray(errors) ? errors.slice() : []
    };
  }

  function htmlEscape(value) {
    return text(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]);
  }
  function formatDate(value) {
    const parsed = parseDate(value);
    if (!parsed) return 'Date not reported';
    return new Intl.DateTimeFormat('en-US', { year:'numeric', month:'short', day:'numeric', timeZone:'UTC' }).format(parsed);
  }
  function formatPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : 'Not reported';
  }
  function renderCitation(citation, number) {
    return `<li id="citation-${number}"><a href="${htmlEscape(citation.url)}" target="_blank" rel="noopener noreferrer">[${number}] ${htmlEscape(citation.title)}</a><span>${htmlEscape(citation.source)}${citation.date ? ` · ${htmlEscape(formatDate(citation.date))}` : ''}</span></li>`;
  }
  function citationNumbers(record, packet) {
    const keys = packet.citations.map(citationKey);
    return record.citations.map(citation => keys.indexOf(citationKey(citation)) + 1).filter(number => number > 0);
  }
  function renderResult(item, packet) {
    const record = item.record;
    const numbers = citationNumbers(record, packet);
    const cited = numbers.map(number => `<a href="#citation-${number}">[${number}]</a>`).join(' ');
    const reasons = item.ranking.reason.slice(0, 6).map(reason => `<span>${htmlEscape(reason)}</span>`).join('');
    return `<article class="evidence-card">
      <div class="evidence-head"><span class="type ${htmlEscape(record.type)}">${htmlEscape(TYPE_LABEL[record.type] || record.type)}</span><span class="score">retrieval score ${item.ranking.score}</span></div>
      <h3>${htmlEscape(record.title)} ${cited}</h3>
      <p>${htmlEscape(record.summary)}</p>
      <div class="evidence-meta"><span>${htmlEscape(formatDate(record.date))}</span><span>${htmlEscape(record.source || 'Source label not reported')}</span><span>${item.ranking.direct ? 'all query terms matched' : `${Math.round(item.ranking.coverage * 100)}% term coverage`}</span></div>
      <div class="reasons">${reasons || '<span>indexed-field match</span>'}</div>
      <p class="semantics">${htmlEscape(record.semantics)}</p>
      <div class="actions"><a href="${htmlEscape(record.destination)}"${safeHttpUrl(record.destination) ? ' target="_blank" rel="noopener noreferrer"' : ''}>Open record or dataset →</a></div>
    </article>`;
  }
  function renderGroup(container, items, packet, emptyMessage) {
    container.innerHTML = items.length
      ? items.map(item => renderResult(item, packet)).join('')
      : `<div class="empty-state">${htmlEscape(emptyMessage)}</div>`;
  }
  function renderCoverage(container, facts) {
    const metrics = [
      ['Indexed articles', Number(facts.indexedArticleCount || 0).toLocaleString()],
      ['Observed source keys', Number(facts.observedSourceCount || 0).toLocaleString()],
      ['Registered collectors', Number(facts.registeredSourceCount || 0).toLocaleString()],
      ['Top-source share', formatPercent(facts.topSourceShare)],
      ['Unparseable dates', Number(facts.unparseableDateCount || 0).toLocaleString()],
      ['Future dates excluded', Number(facts.futureDatedCount || 0).toLocaleString()]
    ];
    container.innerHTML = `<div class="coverage-grid">${metrics.map(([label,value]) => `<div><strong>${htmlEscape(value)}</strong><span>${htmlEscape(label)}</span></div>`).join('')}</div>
      <p>${htmlEscape(facts.caveat)}</p>
      <p>Explicit language and geography metadata remain incomplete. Retrieval cannot repair absent sources, parser failures, inaccessible publications, or classified reporting.</p>
      ${facts.unavailableDatasets.length ? `<p class="warning">Unavailable datasets: ${htmlEscape(facts.unavailableDatasets.join(' · '))}</p>` : ''}`;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache:'no-store' });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }
  async function fetchDataset(type, query) {
    return fetchJson(`/api/data?type=${encodeURIComponent(type)}${query ? `&${query}` : ''}`);
  }
  async function loadCorpus() {
    const requests = {
      flags:fetchDataset('flags'),
      actors:fetchDataset('actor_fingerprints'),
      ttps:fetchDataset('ttp_counter_gap'),
      articles:fetchDataset('intel_articles'),
      events:fetchDataset('article_event_clusters', 'view=summary'),
      catalog:fetchDataset('dataset_catalog'),
      coverage:fetchDataset('source_coverage_matrix')
    };
    const entries = await Promise.all(Object.entries(requests).map(async ([name,promise]) => {
      try { return [name, await promise, null]; }
      catch (error) { return [name, null, error && error.message ? error.message : String(error)]; }
    }));
    const payloads = {};
    const errors = [];
    entries.forEach(([name,payload,error]) => {
      payloads[name] = payload;
      if (error) errors.push(`${name}: ${error}`);
    });
    return { payloads, errors, records:buildCorpus(payloads), coverage:coverageFacts(payloads.catalog, payloads.coverage, errors) };
  }

  async function boot() {
    if (typeof document === 'undefined') return;
    const root = document.querySelector('[data-ask-pie]');
    if (!root) return;
    const form = document.getElementById('ask-form');
    const input = document.getElementById('ask-query');
    const status = document.getElementById('ask-status');
    const summary = document.getElementById('answer-summary');
    const directNode = document.getElementById('direct-evidence');
    const contextNode = document.getElementById('context-evidence');
    const analyticNode = document.getElementById('analytic-context');
    const citationNode = document.getElementById('citations');
    const coverageNode = document.getElementById('ask-coverage');
    const corpus = await loadCorpus();
    renderCoverage(coverageNode, corpus.coverage);
    status.textContent = `${corpus.records.length.toLocaleString()} records available for local deterministic retrieval${corpus.errors.length ? `; ${corpus.errors.length} dataset${corpus.errors.length === 1 ? '' : 's'} unavailable` : ''}.`;
    status.title = corpus.errors.join(' | ');

    function run(query, updateUrl) {
      const terms = queryTerms(query);
      if (!terms.length) {
        summary.innerHTML = '<div class="empty-state">Enter a specific actor, platform, company, program, component, TTP, or procurement term. Common question words are ignored.</div>';
        directNode.innerHTML = contextNode.innerHTML = analyticNode.innerHTML = '';
        citationNode.innerHTML = '<li>No evidence packet has been generated.</li>';
        return;
      }
      if (updateUrl) {
        const url = new URL(location.href);
        url.searchParams.set('q', query);
        history.replaceState(null, '', url);
      }
      const ranked = rankEvidence(corpus.records, query, { limit:48 });
      const packet = evidencePacket(ranked, query);
      summary.innerHTML = `<div class="answer-facts"><strong>${packet.direct.length.toLocaleString()}</strong><span>direct cited matches</span><strong>${packet.contextual.length.toLocaleString()}</strong><span>contextual cited matches</span><strong>${packet.analytic.length.toLocaleString()}</strong><span>uncited analytic context rows</span><strong>${packet.uniqueSourceLabelCount.toLocaleString()}</strong><span>source labels in citations</span></div>
        <p>The corpus supports an evidence packet—not an automatic conclusion—for <q>${htmlEscape(query)}</q>. Direct matches contain every meaningful query term; contextual matches contain only some terms. Contradictions are ${htmlEscape(packet.contradictionAssessment)}.</p>`;
      renderGroup(directNode, packet.direct.slice(0, 16), packet, 'No cited record matched every meaningful query term. Broaden the wording or review contextual evidence.');
      renderGroup(contextNode, packet.contextual.slice(0, 16), packet, 'No partial cited matches were found.');
      renderGroup(analyticNode, packet.analytic.slice(0, 10), packet, 'No uncited analytic context rows matched.');
      citationNode.innerHTML = packet.citations.length
        ? packet.citations.map((citation,index) => renderCitation(citation,index+1)).join('')
        : '<li>No source URL was available in the matched records. Treat the result as uncited analytic context only.</li>';
    }

    form.addEventListener('submit', event => { event.preventDefault(); run(input.value.trim(), true); });
    document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
      input.value = button.getAttribute('data-example') || '';
      run(input.value, true);
    }));
    const initial = new URL(location.href).searchParams.get('q') || '';
    if (initial) { input.value = initial; run(initial, false); }
    else input.focus();
  }

  return {
    STOPWORDS, TYPE_ORDER, text, normalize, termPattern, queryTerms, safeHttpUrl, parseDate,
    normalizeCitation, dedupeCitations, citationsFromFlag, citationsFromActor, citationsFromTtp,
    articleRecords, flagRecords, actorRecords, ttpRecords, buildCorpus, scoreRecord, rankEvidence,
    evidencePacket, coverageFacts, htmlEscape, boot
  };
});
