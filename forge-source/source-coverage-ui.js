(function(root, factory){
  var api = factory();
  if(typeof module === 'object' && module.exports){ module.exports = api; }
  else { root.SourceCoverageUI = api; }
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  function text(value){ return String(value == null ? '' : value).trim(); }
  function number(value){
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function ratio(numerator, denominator){
    var total = number(denominator);
    return total > 0 ? Math.max(0, Math.min(1, number(numerator) / total)) : 0;
  }
  function percent(value, digits){
    var amount = number(value) * 100;
    return amount.toFixed(digits == null ? 1 : digits) + '%';
  }
  function unwrap(payload){
    var value = payload && payload.data && typeof payload.data === 'object' ? payload.data : payload;
    if(!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('coverage payload must be an object');
    return value;
  }
  function publicationErrors(payload){
    var data;
    try { data = unwrap(payload); }
    catch(error){ return [error.message]; }
    var errors = [];
    var meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
    var sources = Array.isArray(data.sources) ? data.sources : null;
    if(text(meta.version) !== '1.0') errors.push('coverage artifact version is not 1.0');
    if(text(meta.generator) !== 'services/pipeline/source_coverage_matrix.py') errors.push('coverage artifact generator is not the validated coverage pipeline');
    if(meta.event_artifact_used !== true) errors.push('publication-safe candidate-event evidence was not used');
    if(!sources || !sources.length) errors.push('coverage source matrix is empty or missing');
    if(!data.coverage || typeof data.coverage !== 'object') errors.push('coverage detail object is missing');
    if(!data.gaps || typeof data.gaps !== 'object') errors.push('coverage gaps object is missing');
    var analyzed = number(meta.analyzed_article_records);
    if(analyzed < 1) errors.push('analyzed article count is not positive');
    if(sources){
      var sum = sources.reduce(function(total, row){ return total + number(row && row.article_count); }, 0);
      if(sum !== analyzed) errors.push('per-source article counts do not equal the analyzed article count');
      var ids = sources.map(function(row){ return text(row && row.source_key); }).filter(Boolean);
      if(new Set(ids).size !== ids.length) errors.push('source keys are not unique');
    }
    var concentration = meta.source_concentration && typeof meta.source_concentration === 'object' ? meta.source_concentration : {};
    if(number(concentration.top_source_share) > 1 || number(concentration.top_five_source_share) > 1){
      errors.push('source concentration shares exceed one');
    }
    return errors;
  }
  function summary(payload){
    var data = unwrap(payload);
    var meta = data.meta || {};
    var gaps = data.gaps || {};
    var concentration = meta.source_concentration || {};
    var total = number(meta.analyzed_article_records);
    var explicitLanguageMissing = number(gaps.explicit_language_metadata_missing_record_count);
    var explicitGeoMissing = number(gaps.explicit_geography_metadata_missing_record_count);
    return {
      generated_at: text(meta.generated_at),
      coverage_start: text(meta.coverage_start),
      coverage_end: text(meta.coverage_end),
      article_count: total,
      parseable_date_count: number(meta.parseable_publication_date_count),
      unparseable_date_count: number(meta.unparseable_publication_date_count),
      future_date_count: number(meta.future_dated_record_count),
      date_completeness: ratio(meta.parseable_publication_date_count, total),
      observed_source_count: number(meta.observed_source_key_count),
      registered_source_count: number(meta.registered_source_count),
      active_registered_source_count: number(meta.active_registered_source_count),
      observed_registered_source_count: number(meta.observed_registered_source_count),
      observed_unregistered_source_count: number(meta.observed_unregistered_source_count),
      top_source_share: number(concentration.top_source_share),
      top_five_source_share: number(concentration.top_five_source_share),
      effective_source_count: number(concentration.effective_source_count),
      unique_url_count: number(meta.unique_canonical_url_count),
      duplicate_url_record_count: number(meta.duplicate_url_record_count),
      explicit_language_completeness: 1 - ratio(explicitLanguageMissing, total),
      explicit_geography_completeness: 1 - ratio(explicitGeoMissing, total),
      reporting_cluster_count: number(meta.reporting_cluster_count),
      candidate_event_count: number(meta.candidate_event_cluster_count),
      caveat: text(meta.caveat),
      language_semantics: text(meta.language_semantics),
      geography_semantics: text(meta.geography_semantics),
      temporal_semantics: text(meta.temporal_semantics),
      source_semantics: text(meta.source_semantics)
    };
  }
  function healthStatus(row){
    return text(row && row.collector_health && row.collector_health.status) || 'unknown';
  }
  function sourceSearchText(row){
    var aliases = Array.isArray(row && row.observed_aliases)
      ? row.observed_aliases.map(function(item){ return text(item && item.value); }).join(' ')
      : '';
    return [
      row && row.source_key,
      row && row.display_name,
      row && row.category,
      row && row.vertical,
      row && row.registered_geo,
      row && row.registered_url,
      aliases
    ].map(text).join(' ').toLowerCase();
  }
  function filterSources(rows, filters){
    var query = text(filters && filters.query).toLowerCase();
    var registration = text(filters && filters.registration);
    var health = text(filters && filters.health);
    var activity = text(filters && filters.activity);
    var values = (Array.isArray(rows) ? rows : []).filter(function(row){
      if(!row || typeof row !== 'object') return false;
      if(query && sourceSearchText(row).indexOf(query) === -1) return false;
      if(registration === 'registered' && row.registered !== true) return false;
      if(registration === 'unregistered' && row.registered !== false) return false;
      if(health && healthStatus(row) !== health) return false;
      if(activity === 'observed' && number(row.article_count) < 1) return false;
      if(activity === 'no-articles' && number(row.article_count) > 0) return false;
      if(activity === 'events' && number(row.candidate_event_count) < 1) return false;
      return true;
    });
    var sort = text(filters && filters.sort) || 'articles';
    values.sort(function(left, right){
      if(sort === 'name') return text(left.display_name || left.source_key).localeCompare(text(right.display_name || right.source_key));
      if(sort === 'recent'){
        var leftDate = Date.parse(left.coverage_end || '') || 0;
        var rightDate = Date.parse(right.coverage_end || '') || 0;
        return rightDate - leftDate || number(right.article_count) - number(left.article_count);
      }
      if(sort === 'events') return number(right.candidate_event_count) - number(left.candidate_event_count) || number(right.article_count) - number(left.article_count);
      return number(right.article_count) - number(left.article_count) || text(left.source_key).localeCompare(text(right.source_key));
    });
    return values;
  }
  function topEntries(value, limit){
    var entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
    return entries.sort(function(left, right){ return number(right[1]) - number(left[1]) || text(left[0]).localeCompare(text(right[0])); }).slice(0, limit || 12);
  }
  function recentWindows(payload){
    var data = unwrap(payload);
    var rows = data.coverage && Array.isArray(data.coverage.recent_windows) ? data.coverage.recent_windows : [];
    return rows.slice().sort(function(left, right){ return number(left.window_days) - number(right.window_days); });
  }
  function alerts(payload){
    var data = unwrap(payload);
    return (Array.isArray(data.alerts) ? data.alerts : []).map(function(row){
      return {
        code: text(row && row.code),
        severity: text(row && row.severity) || 'info',
        detail: text(row && row.detail)
      };
    });
  }
  function freshness(generatedAt, nowValue, maxAgeHours){
    var generated = Date.parse(generatedAt || '');
    var now = nowValue == null ? Date.now() : Number(nowValue);
    if(!Number.isFinite(generated)) return {status:'unknown', age_seconds:null};
    var age = Math.max(0, now - generated);
    var limit = Math.max(1, number(maxAgeHours) || 72) * 3600000;
    return {status: age <= limit ? 'fresh' : 'stale', age_seconds: Math.floor(age / 1000)};
  }
  return {
    text:text,
    number:number,
    ratio:ratio,
    percent:percent,
    unwrap:unwrap,
    publicationErrors:publicationErrors,
    summary:summary,
    healthStatus:healthStatus,
    filterSources:filterSources,
    topEntries:topEntries,
    recentWindows:recentWindows,
    alerts:alerts,
    freshness:freshness
  };
});
