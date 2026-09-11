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
  const TYPE_ORDER = ['article','flag','actor','ttp','prediction','entity','reference','component','platform'];
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
    const body = value.split(' ').map(escapeRegex).join('[^a-z0-9]+');
    return new RegExp(`(?:^|[^a-z0-9])${body}(?=$|[^a-z0-9])`, 'i');
  }
  function queryTerms(query) {
    const raw = normalize(query).split(' ').filter(Boolean);
    const meaningful = raw.filter(token => token.length > 1 && !STOPWORDS.has(token));
    return Array.from(new Set(meaningful)).slice(0, 16);
  }
  function safeHttpUrl(value) {
    const candidate = text(value);
    try { const url = new URL(candidate); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  }
  function parseDate(value) {
    const raw = text(value);
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const day = new Date(raw.slice(0,10));
      if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== raw.slice(0,10)) return null;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  function dateValue(record) {
    return text(record && (record.published_at || record.pub_date || record.date || record.last_seen || record.first_seen));
  }
  function dateSortValue(value) {
    const parsed = parseDate(value);
    return parsed ? parsed.getTime() : 0;
  }
  function recordSourceDate(record) {
    return text(record.type === 'flag' ? record.source_published_at : record.date);
  }
  function flagDateFields(record) {
    const sourceDate = recordSourceDate(record);
    // Older indexes and saved packets used the observation date as `date`.
    return {date:sourceDate, source_published_at:sourceDate,
      observed_at:text(record.observed_at || (!Object.hasOwn(record, 'source_published_at') ? record.date : ''))};
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
    return JSON.stringify([text(citation.url), text(citation.title), text(citation.source), text(citation.date)]);
  }
  function normalizeCitation(value, fallback) {
    const row = value && typeof value === 'object' ? value : {};
    const url = safeHttpUrl(row.url || row.link || row.source_url || (fallback && fallback.url));
    if (!url || url.length > 2048) return null;
    return {
      url,
      title: text(row.title || row.name || row.label || (fallback && fallback.title)) || 'Source evidence',
      source: text(row.site || row.source || row.publisher || row.organization || (fallback && fallback.source)) || 'Source not labeled',
      date: text(row.published_at || row.pub_date || row.date || row.raw_date || (fallback && fallback.date)),
      kind: text(row.type || row.kind || (fallback && fallback.kind)) || 'source'
    };
  }
  function dedupeCitations(values, limit = MAX_CITATIONS_PER_RECORD) {
    const seen = new Set();
    const output = [];
    values.forEach(value => {
      if (!value) return;
      const key = citationKey(value);
      if (seen.has(key)) return;
      seen.add(key);
      output.push(value);
    });
    return Number.isFinite(limit) ? output.slice(0, limit) : output;
  }
  function citationsFromFlag(row) {
    const values = [];
    const direct = normalizeCitation({url:row.url || row.link || row.source_url, title:row.title, source:row.source, date:row.source_published_at}, { title:row.title, source:row.source });
    if (direct) values.push(direct);
    const sources = Array.isArray(row.sources) ? row.sources : [];
    sources.forEach(source => values.push(normalizeCitation(source, { title:row.title, kind:'flag source' })));
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    evidence.forEach(source => values.push(normalizeCitation(source, { title:row.title, kind:'flag evidence' })));
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
      key:type === 'article' ? `article:${text(fields.id)}~${stableId(row)}` : `${type}:${text(fields.id)}`,
      title,
      summary,
      date: text(fields.date),
      ...(type === 'flag' ? {source_published_at:text(fields.source_published_at), observed_at:text(fields.observed_at)} : {}),
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
        id:row.aid || row.id || stableId(row),
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
      id:row.id || row.flag_id || stableId(row),
      title:row.title || row.headline || row.flag_type || row.id,
      summary:row.detail || row.summary || row.description || row.rationale,
      date:row.source_published_at,
      source_published_at:row.source_published_at,
      observed_at:row.observed_at || row.last_seen || row.timestamp || row.date || row.first_seen,
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
        id:row.actor || stableId(row),
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
      id:row.ttp_id || row.id || stableId(row),
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

  function recordKey(record) { return record.key || `${record.type}:${record.id}`; }
  function recordUrl(record) { return `/ask-pie/?record=${encodeURIComponent(recordKey(record))}`; }
  function stableId(row) {
    const value = JSON.stringify([row.url || row.source_url || '', row.title || row.name || row.event || '', row.site || row.source || '', row.pub_date || row.date || '']);
    let a = 2166136261, b = 5381;
    for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
    return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
  }
  function genericRecords(payload, type, field) {
    const value = unwrap(payload) || {};
    const entries = Array.isArray(value) ? value : value[field] || [];
    const rows = Array.isArray(entries) ? entries : Object.entries(entries).map(([id, row]) => ({ ...row, id:row.id || id }));
    return rows.filter(row => row && typeof row === 'object').map(row => makeRecord(type, row, {
      id:row.id || row.pid || row.key || stableId(row), title:row.title || row.name || row.event || row.program || row.id,
      summary:row.summary || row.detail || row.description || row.rationale || row.note,
      date:row.published_at || row.pub_date || row.issued_at || row.date || row.last_seen,
      source:row.site || row.source || row.manufacturer,
      citations:citationsFromFlag(row),
      semantics:type === 'prediction' ? 'Forecast or preserved legacy judgment. Probability is not evidence confidence. Review the issued criteria and cohort before evaluating it.' : 'Indexed reference. Relationships require their own evidence; a matching name does not establish ownership, supply, or installation.'
    }));
  }
  function compactRecord(record) {
    const shorten = (value, limit) => text(value).slice(0, limit);
    return {
      id:shorten(record.id, 240), key:recordKey(record), type:record.type, title:shorten(record.title, 320),
      summary:shorten(record.summary, 800), date:shorten(record.date, 80), source:shorten(record.source, 160),
      ...(record.type === 'flag' ? Object.fromEntries(Object.entries(flagDateFields(record)).map(([key,value]) => [key,shorten(value,80)])) : {}),
      destination:recordUrl(record), sourceUrl:safeHttpUrl(record.destination),
      datasetDestination:record.type === 'flag' ? `/patterns/#flag=${encodeURIComponent(record.id)}` : record.type === 'entity' ? `/dossier/?m=${encodeURIComponent(record.id)}` : '',
      entities:record.raw && record.raw.entities && typeof record.raw.entities === 'object' ? Object.fromEntries(Object.entries(record.raw.entities).filter(([,values]) => Array.isArray(values)).map(([name, values]) => [name,values.filter(value => typeof value === 'string').slice(0,12).map(value => value.slice(0,120))])) : {},
      semantics:shorten(record.semantics, 500),
      titleText:shorten(record.titleText, 500), summaryText:shorten(record.summaryText, 1200), searchText:shorten(record.searchText, 3600),
      citations:record.citations.map(citation => ({...citation, title:shorten(citation.title, 320), source:shorten(citation.source, 160), url:citation.url}))
    };
  }
  function publicRecord(record) {
    const { searchText, titleText, summaryText, raw, ...visible } = record;
    return record.type === 'flag' ? {...visible, ...flagDateFields(record)} : visible;
  }
  function projectResearch(index, params) {
    if (!index || index.schema_version !== 1 || !Array.isArray(index.records)) throw new Error('Research index missing or incompatible');
    const query = text(params.get('q')).slice(0, 240);
    const type = text(params.get('record_type'));
    const id = text(params.get('record')).slice(0, 500);
    const parsedLimit = Number(params.get('limit'));
    const limit = Math.max(1, Math.min(100, Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 48));
    const offset = Math.max(0, Math.min(index.records.length, Math.floor(Number(params.get('offset')) || 0)));
    function visible(record) {
      const dataset = record.dataset || index.meta?.dataset_by_type?.[record.type];
      const source = index.meta?.inputs?.[dataset] || {};
      return {...publicRecord(record), semantics:record.semantics || index.meta?.record_semantics?.[record.type] || 'Indexed public record; support and relationships require review.', dataset, dataset_sha256:record.dataset_sha256 || source.sha256 || null, dataset_generated_at:record.dataset_generated_at || source.generated_at || null, dataset_status:record.dataset_status || source.evidence_status || 'unversioned', dataset_origin:source.origin || 'untracked local input', dataset_revision:source.revision_verified === true ? source.upstream_ref : null};
    }
    const base = {schema_version:1, meta:index.meta, counts:index.counts, query:{q:query, record_type:type || 'all', limit, offset}, records:[]};
    if (id) {
      const matches = index.records.filter(record => recordKey(record) === id || `${record.type}:${record.id}` === id);
      return {...base, record_status:matches.length === 1 ? 'found' : matches.length ? 'ambiguous' : 'missing', records:matches.length === 1 ? matches.map(visible) : []};
    }
    if (params.get('view') === 'summary') return base;
    let records = index.records.filter(record => !type || type === 'all' || record.type === type);
    const after = parseDate(params.get('after'));
    if (after) records = records.filter(record => dateSortValue(recordSourceDate(record)) >= after.getTime());
    if (query && !queryTerms(query).length) return {...base, total_matches:0, ranked:[]};
    if (!query) {
      records.sort((a,b) => dateSortValue(recordSourceDate(b)) - dateSortValue(recordSourceDate(a)) || recordKey(a).localeCompare(recordKey(b)));
      return {...base, total_matches:records.length, records:records.slice(offset, offset + limit).map(visible)};
    }
    // Rank once with the publication's clock; save that revision with packets.
    const context = queryContext(query);
    const ranked = records.filter(record => context.patterns.some(pattern => pattern.test(record.searchText))).map(record => ({record, ranking:scoreRecord(record, query, {now:index.meta && index.meta.generated_at, context})}))
      .filter(item => item.ranking.matchedTerms.length)
      .sort((a,b) => Number(b.ranking.direct) - Number(a.ranking.direct) || b.ranking.score - a.ranking.score || dateSortValue(recordSourceDate(b.record)) - dateSortValue(recordSourceDate(a.record)) || recordKey(a.record).localeCompare(recordKey(b.record)));
    return {...base, total_matches:ranked.length, ranked:ranked.slice(offset, offset + limit).map(item => ({record:visible(item.record), ranking:item.ranking}))};
  }

  function countOccurrences(haystack, pattern) {
    if (!pattern) return 0;
    const matches = haystack.match(new RegExp(pattern.source, 'gi'));
    return matches ? matches.length : 0;
  }
  function queryContext(query) {
    const terms=queryTerms(query);
    return {terms,phrase:normalize(query),patterns:terms.map(term => termPattern(term))};
  }
  function scoreRecord(record, query, options) {
    const context = options && options.context || queryContext(query);
    const terms = context.terms;
    if (!terms.length) return { score:0, matchedTerms:[], coverage:0, direct:false, reason:[] };
    const phrase = context.phrase;
    const titleText = record.titleText || normalize(record.title);
    const summaryText = record.summaryText || normalize(record.summary);
    const matchedTerms = [];
    const reason = [];
    let score = 0;
    terms.forEach((term, index) => {
      const pattern = context.patterns[index];
      if (!pattern.test(record.searchText)) return;
      const inTitle = countOccurrences(titleText, pattern);
      const inSummary = countOccurrences(summaryText, pattern);
      matchedTerms.push(term);
      if (inTitle) { score += 9 + Math.min(3, inTitle - 1); reason.push(`${term}: title`); }
      else if (inSummary) { score += 5 + Math.min(2, inSummary - 1); reason.push(`${term}: summary`); }
      else { score += 2; reason.push(`${term}: indexed fields`); }
    });
    if (phrase.length >= 5 && titleText.includes(phrase)) { score += 14; reason.push('full query: title'); }
    else if (phrase.length >= 5 && summaryText.includes(phrase)) { score += 8; reason.push('full query: summary'); }
    const coverage = matchedTerms.length / terms.length;
    const direct = coverage === 1;
    if (direct) score += 8;
    else score += Math.round(coverage * 4);
    score += Math.min(4, record.citations.length);
    const age = dateSortValue(recordSourceDate(record));
    if (age) {
      const days = ((dateSortValue(options && options.now) || Date.now()) - age) / 86400000;
      if (days >= 0 && days <= 30) score += 3;
      else if (days >= 0 && days <= 180) score += 1;
    }
    return { score, matchedTerms, coverage, direct, reason };
  }
  function rankEvidence(records, query, options) {
    const limit = Math.max(1, Math.min(100, Number(options && options.limit) || 40));
    const context = queryContext(query);
    return (Array.isArray(records) ? records : []).map((record, index) => ({
      record,
      index,
      ranking:scoreRecord(record, query, {...options,context})
    })).filter(item => item.ranking.matchedTerms.length > 0)
      .sort((left, right) => {
        if (left.ranking.direct !== right.ranking.direct) return left.ranking.direct ? -1 : 1;
        if (right.ranking.score !== left.ranking.score) return right.ranking.score - left.ranking.score;
        const dateDelta = dateSortValue(recordSourceDate(right.record)) - dateSortValue(recordSourceDate(left.record));
        if (dateDelta) return dateDelta;
        const typeDelta = TYPE_ORDER.indexOf(left.record.type) - TYPE_ORDER.indexOf(right.record.type);
        return typeDelta || text(left.record.id).localeCompare(text(right.record.id)) || left.index - right.index;
      }).slice(0, limit);
  }
  function evidencePacket(ranked, query) {
    const direct = ranked.filter(item => item.ranking.direct && item.record.citations.length);
    const contextual = ranked.filter(item => !item.ranking.direct && item.record.citations.length);
    const analytic = ranked.filter(item => !item.record.citations.length);
    const citations = dedupeCitations(ranked.flatMap(item => item.record.citations), Infinity);
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
    if (/^\d{4}(?:-\d{2})?$/.test(text(value))) return `${text(value)} (source precision)`;
    const parsed = parseDate(value);
    if (!parsed) return text(value) ? `${text(value)} (unparsed source date)` : 'Date not reported';
    return new Intl.DateTimeFormat('en-US', { year:'numeric', month:'short', day:'numeric', timeZone:'UTC' }).format(parsed);
  }
  function formatPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : 'Not reported';
  }
  function renderCitation(citation, number) {
    return `<li id="citation-${number}"><a href="${htmlEscape(citation.url)}" target="_blank" rel="noopener noreferrer">[${number}] ${htmlEscape(citation.title)}</a><span>${htmlEscape(citation.source)} · Source published: ${citation.date ? htmlEscape(formatDate(citation.date)) : 'unknown'}</span></li>`;
  }
  function citationNumbers(record, packet) {
    const keys = packet.citations.map(citationKey);
    return record.citations.map(citation => keys.indexOf(citationKey(citation)) + 1).filter(number => number > 0);
  }
  function renderResult(item, packet) {
    const record = publicRecord(item.record);
    const numbers = citationNumbers(record, packet);
    const cited = numbers.map(number => `<a href="#citation-${number}">[${number}]</a>`).join(' ');
    const reasons = item.ranking.reason.slice(0, 6).map(reason => `<span>${htmlEscape(reason)}</span>`).join('');
    const dates = record.type === 'flag'
      ? `<span>Source published: ${record.source_published_at ? htmlEscape(formatDate(record.source_published_at)) : 'unknown'}</span><span>Observed: ${record.observed_at ? htmlEscape(formatDate(record.observed_at)) : 'unknown'}</span>`
      : `<span>${htmlEscape(formatDate(record.date))}</span>`;
    return `<article class="evidence-card">
      <div class="evidence-head"><span class="type ${htmlEscape(record.type)}">${htmlEscape(TYPE_LABEL[record.type] || record.type)}</span><span class="score">retrieval score ${item.ranking.score}</span></div>
      <h3>${htmlEscape(record.title)} ${cited}</h3>
      <p>${htmlEscape(record.summary)}</p>
      <div class="evidence-meta">${dates}<span>${htmlEscape(record.source || 'Source label not reported')}</span><span>${item.ranking.direct ? 'all query terms matched' : `${Math.round(item.ranking.coverage * 100)}% term coverage`}</span></div>
      <div class="reasons">${reasons || '<span>indexed-field match</span>'}</div>
      <p class="semantics">${htmlEscape(record.semantics)}${record.dataset_status ? ` Dataset: ${htmlEscape(record.dataset_status)} (${htmlEscape(record.dataset_origin || 'origin untracked')}); source artifact date ${htmlEscape(record.dataset_generated_at || 'unknown')}.` : ''}</p>
      <div class="actions"><a href="${htmlEscape(record.destination)}"${safeHttpUrl(record.destination) ? ' target="_blank" rel="noopener noreferrer"' : ''}>Open exact record →</a>${record.datasetDestination ? ` · <a href="${htmlEscape(record.datasetDestination)}">Open dossier / source record</a>` : ''}</div>
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
  async function researchRequest(values, signal) {
    const params = new URLSearchParams({type:'research_index', ...values});
    const response = await fetch(`/api/data?${params}`, {cache:'no-store', signal});
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Research unavailable (HTTP ${response.status})`);
    return {data:payload.data || payload, source:payload.source || 'unknown', freshness:payload.freshness || null};
  }
  function savedPacket(packet, publication) {
    return {schema_version:1, saved_at:new Date().toISOString(), query:packet.query, publication,
      ranked:packet.ranked.map(item => ({record:publicRecord(item.record), ranking:item.ranking})),
      citations:packet.citations, limitations:{conclusionAllowed:false, contradictionAssessment:packet.contradictionAssessment, sourceIndependence:'not assessed'}};
  }
  function readSaved(storage) {
    try { const rows = JSON.parse(storage.getItem('patterns.research.packets.v1') || '[]'); return Array.isArray(rows) ? rows.filter(row => row.schema_version === 1 && Array.isArray(row.ranked)).slice(0,6) : []; } catch { return []; }
  }
  function writeSaved(storage, packet) {
    const rows = [packet, ...readSaved(storage).filter(row => row.query !== packet.query || row.publication?.meta?.input_revision !== packet.publication?.meta?.input_revision)].slice(0,6);
    const serialized = JSON.stringify(rows);
    if (serialized.length > 2500000) throw new Error('Saved research storage is full. Export or remove an older packet first.');
    storage.setItem('patterns.research.packets.v1', serialized);
    return rows;
  }
  async function boot() {
    if (typeof document === 'undefined' || !document.querySelector('[data-ask-pie]')) return;
    const form = document.getElementById('ask-form'), input = document.getElementById('ask-query');
    const status = document.getElementById('ask-status'), summary = document.getElementById('answer-summary');
    const directNode = document.getElementById('direct-evidence'), contextNode = document.getElementById('context-evidence');
    const analyticNode = document.getElementById('analytic-context'), citationNode = document.getElementById('citations');
    const coverageNode = document.getElementById('ask-coverage');
    let current = null, generation = 0, controller = null;
    function coverage(publication) {
      const meta = publication.meta || {};
      const inputs = Object.entries(meta.inputs || {});
      coverageNode.innerHTML = `<p>Snapshot ${htmlEscape(meta.input_revision || 'unknown')}. Publication ${htmlEscape(meta.publication_revision || 'no single verified upstream revision')} · ${htmlEscape(meta.publication_consistency || 'source consistency unknown')}.</p>
        <p>Index built ${htmlEscape(meta.generated_at || 'unknown')}; served from ${htmlEscape(publication.source || 'saved packet')}. This is not the date of the underlying evidence.</p>
        <p>${htmlEscape(meta.caveat || 'Source coverage is limited to indexed public records.')}</p>
        <details><summary>Input revisions and availability</summary><ul>${inputs.map(([name,row]) => `<li>${htmlEscape(name)}: ${htmlEscape(row.status)} · ${htmlEscape(row.origin || 'origin untracked')} · upstream revision ${htmlEscape(row.upstream_ref || 'unverified')} · source artifact date ${htmlEscape(row.generated_at || 'unknown')} · ${htmlEscape(row.sha256 || 'no hash')}</li>`).join('')}</ul></details>`;
    }
    function display(packet, publication, saved) {
      current = savedPacket(packet, publication);
      coverage(publication);
      summary.innerHTML = `<h2>${saved ? 'Saved evidence packet' : 'Evidence packet'}</h2><div class="answer-facts"><strong>${packet.direct.length}</strong><span>direct cited matches</span><strong>${packet.contextual.length}</strong><span>contextual cited matches</span><strong>${packet.analytic.length}</strong><span>uncited context rows</span><strong>${packet.citations.length}</strong><span>complete source references</span></div>
        <p>${htmlEscape(packet.query)}. Ranking describes term matches. Contradictions and source independence remain unassessed.</p>`;
      renderGroup(directNode, packet.direct, packet, 'No cited record matched every meaningful query term.');
      renderGroup(contextNode, packet.contextual, packet, 'No partial cited matches in this packet.');
      renderGroup(analyticNode, packet.analytic, packet, 'No uncited context rows in this packet.');
      citationNode.innerHTML = packet.citations.length ? packet.citations.map((citation,index) => renderCitation(citation,index+1)).join('') : '<li>Source URLs are missing. These results are navigation leads.</li>';
      document.getElementById('save-packet').disabled = document.getElementById('export-packet').disabled = false;
    }
    function listSaved() {
      const node = document.getElementById('saved-packets');
      let rows=[];
      try { rows=readSaved(localStorage); } catch { node.innerHTML='<p>Browser storage unavailable. Export remains available.</p>'; return; }
      node.innerHTML = rows.length ? rows.map((row,index) => `<div><button type="button" data-saved="${index}">${htmlEscape(row.query)}</button> <small>saved ${htmlEscape(formatDate(row.saved_at))}</small> <button type="button" data-remove="${index}" aria-label="Remove saved packet ${index + 1}">Remove</button></div>`).join('') : '<p>No packets saved on this browser.</p>';
      node.querySelectorAll('[data-saved]').forEach(button => button.addEventListener('click', () => {
        generation++; if (controller) controller.abort();
        const row = rows[Number(button.dataset.saved)]; input.value = row.query;
        display(evidencePacket(row.ranked,row.query),row.publication,true);
        status.textContent = `Saved snapshot from ${row.saved_at}; not refreshed. Run the query to compare current evidence.`;
      }));
      node.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
        try { localStorage.setItem('patterns.research.packets.v1',JSON.stringify(rows.filter((_,index) => index !== Number(button.dataset.remove)))); listSaved(); } catch { status.textContent = 'Browser storage is unavailable.'; }
      }));
    }
    async function run(query, updateUrl, record) {
      const serial = ++generation;
      if (controller) controller.abort(); controller = new AbortController();
      if (!record && !queryTerms(query).length) { status.textContent = 'Enter a specific actor, technology, program, or source term.'; return; }
      if (updateUrl) {
        const url = new URL(location.href); url.searchParams.delete('record'); url.searchParams.set('q',query); history.pushState(null,'',url);
      }
      status.textContent = 'Retrieving bounded evidence…';
      try {
        const result = await researchRequest(record ? {record} : {q:query,limit:'48'}, controller.signal);
        if (serial !== generation) return;
        const data = result.data;
        if (record && data.record_status !== 'found') {
          current = null; directNode.innerHTML = contextNode.innerHTML = analyticNode.innerHTML = ''; citationNode.innerHTML = '<li>No record selected.</li>';
          summary.innerHTML = `<h2>Record ${htmlEscape(data.record_status || 'unavailable')}</h2><p>The exact requested identity cannot be resolved in this snapshot. No substitute was selected.</p>`;
          document.getElementById('save-packet').disabled = document.getElementById('export-packet').disabled = true;
          status.textContent = 'Try the saved packet for the historical snapshot, or search current records.'; return;
        }
        const ranked = data.ranked || data.records.map(row => ({record:row,ranking:{direct:true,score:0,coverage:1,reason:['exact record identity'],matchedTerms:[]}}));
        const label = record ? data.records[0].title : query;
        display(evidencePacket(ranked,label),{...data,records:undefined,ranked:undefined,source:result.source,freshness:result.freshness},false);
        if (record && data.records[0].type === 'article') {
          const selected=data.records[0];
          const button=document.createElement('button'); button.type='button'; button.textContent='Load article excerpt';
          summary.appendChild(button);
          button.addEventListener('click',async () => {
            button.disabled=true;
            try {
              const response=await fetch(`/api/data?type=intel_articles&record_key=${encodeURIComponent(recordKey(selected))}`,{cache:'no-store'});
              if(!response.ok)throw new Error(`HTTP ${response.status}`);
              const envelope=await response.json(), detail=envelope.data || envelope;
              if(serial!==generation)return;
              if(detail.record_status!=='found' || detail.record.title!==selected.title)throw new Error('Record missing, ambiguous, or changed since this index snapshot');
              const paragraph=document.createElement('p'); paragraph.textContent=detail.record.body_excerpt || 'No article body excerpt available.'; summary.appendChild(paragraph);
              button.textContent='Current source excerpt loaded; packet retains its original snapshot';
            } catch(error) { if(serial===generation){button.textContent=`Excerpt unavailable: ${error.message}`;button.disabled=false;} }
          });
        }
        status.textContent = `${ranked.length} records in this packet${data.total_matches != null ? ` of ${data.total_matches} matching records` : ''}. Snapshot ${text(data.meta?.input_revision).slice(0,12)} · ${data.meta?.availability || 'availability unknown'}.`;
      } catch (error) {
        if (serial !== generation || error.name === 'AbortError') return;
        status.textContent = `Research unavailable: ${error.message}. Existing displayed evidence has not been refreshed.`;
      }
    }
    form.addEventListener('submit', event => {event.preventDefault(); run(input.value.trim(),true);});
    document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {input.value=button.dataset.example || '';run(input.value,true);}));
    window.addEventListener('popstate', () => {const params=new URL(location.href).searchParams; input.value=params.get('q') || ''; if (params.get('record') || input.value) run(input.value,false,params.get('record'));});
    document.getElementById('save-packet').addEventListener('click', () => {
      if (!current) return;
      try { writeSaved(localStorage,current); listSaved(); status.textContent='Evidence packet saved on this browser with its citations and source revision.'; } catch(error) {status.textContent=error.message;}
    });
    document.getElementById('export-packet').addEventListener('click', () => {
      if (!current) return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));
      const anchor=document.createElement('a'); anchor.href=url; anchor.download='patterns-evidence-packet.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    });
    listSaved();
    const params = new URL(location.href).searchParams;
    input.value=params.get('q') || '';
    if (input.value || params.get('record')) await run(input.value,false,params.get('record'));
    else {
      try { const result=await researchRequest({view:'summary'}); coverage({...result.data,source:result.source}); status.textContent=`${Object.values(result.data.counts || {}).reduce((a,b) => a+Number(b),0).toLocaleString()} indexed records. Search requests return at most 48 records; full article bodies load only on demand.`; }
      catch(error) {status.textContent=error.message;}
      input.focus();
    }
  }

  return {
    STOPWORDS, TYPE_ORDER, text, normalize, termPattern, queryTerms, safeHttpUrl, parseDate,
    normalizeCitation, dedupeCitations, citationsFromFlag, citationsFromActor, citationsFromTtp,
    articleRecords, flagRecords, actorRecords, ttpRecords, buildCorpus, scoreRecord, rankEvidence,
    evidencePacket, coverageFacts, htmlEscape, stableId, genericRecords, compactRecord, recordKey, recordUrl, projectResearch, publicRecord, citationNumbers, renderResult, renderCitation, researchRequest, savedPacket, readSaved, writeSaved, boot
  };
});
