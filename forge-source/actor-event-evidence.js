(function(root, factory){
  var api = factory();
  if(typeof module === 'object' && module.exports){ module.exports = api; }
  else { root.ActorEventEvidence = api; }
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  function number(value){
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function text(value){
    return String(value == null ? '' : value).trim();
  }

  function safeHttpUrl(value){
    var url = text(value);
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function indexActorSummaries(rows){
    var index = Object.create(null);
    (Array.isArray(rows) ? rows : []).forEach(function(row){
      if(!row || !text(row.actor)) return;
      index[text(row.actor)] = {
        actor: text(row.actor),
        article_mention_count: number(row.article_mention_count),
        reporting_cluster_count: number(row.reporting_cluster_count),
        candidate_event_count: number(row.candidate_event_count),
        multi_source_candidate_event_count: number(row.multi_source_candidate_event_count),
        semantics: text(row.semantics)
      };
    });
    return index;
  }

  function emptySummary(actor){
    return {
      actor: text(actor),
      article_mention_count: 0,
      reporting_cluster_count: 0,
      candidate_event_count: 0,
      multi_source_candidate_event_count: 0,
      semantics: 'Actor counts mean the actor was mentioned in grouped reporting; they are not incident attribution.'
    };
  }

  function summaryFor(index, actor){
    return index && index[text(actor)] || emptySummary(actor);
  }

  function eventDate(event){
    var raw = event && (event.publication_end || event.publication_start);
    var parsed = Date.parse(raw || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function eventsForActor(rows, actor){
    var name = text(actor);
    return (Array.isArray(rows) ? rows : []).filter(function(event){
      return event && Array.isArray(event.actors_mentioned) && event.actors_mentioned.indexOf(name) !== -1;
    }).sort(function(left, right){
      var difference = eventDate(right) - eventDate(left);
      if(difference) return difference;
      return text(left.candidate_event_id).localeCompare(text(right.candidate_event_id));
    });
  }

  function actorQuery(actor, offset, limit){
    var params = new URLSearchParams();
    params.set('type', 'article_event_clusters');
    params.set('actor', text(actor));
    params.set('offset', String(Math.max(0, number(offset))));
    params.set('limit', String(Math.max(1, Math.min(100, number(limit) || 20))));
    return '/api/data?' + params.toString();
  }

  function formatRange(event){
    function day(value){
      var parsed = new Date(value || '');
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0,10) : '';
    }
    var start = day(event && event.publication_start);
    var end = day(event && event.publication_end);
    if(start && end && start !== end) return start + ' to ' + end;
    return end || start || 'date unavailable';
  }

  function eventSourceLabel(event){
    var count = number(event && event.unique_site_count);
    return count + (count === 1 ? ' site label' : ' site labels');
  }

  function eventAssessment(event){
    var assessment = event && event.assessment;
    return assessment && text(assessment.note) ||
      'Machine-grouped candidate event. Review the linked evidence before drawing an operational or attribution conclusion.';
  }

  function validatePublicationMeta(meta){
    var errors = [];
    var value = meta && typeof meta === 'object' ? meta : {};
    var controls = value.quality_controls && typeof value.quality_controls === 'object'
      ? value.quality_controls : {};
    if(text(value.version) !== '1.1') errors.push('event artifact version is not 1.1');
    if(controls.shared_url_requires_title_and_time_agreement !== true){
      errors.push('shared-URL title/time control is missing');
    }
    if(controls.same_source_shared_url_different_title_merge_allowed !== false){
      errors.push('same-source rolling-URL guard is missing');
    }
    if(controls.same_single_source_candidate_pair_allowed !== false){
      errors.push('same-source candidate-event guard is missing');
    }
    if(number(controls.largest_serialized_reporting_cluster_span_days) > 5.01){
      errors.push('reporting cluster exceeds five-day publication span');
    }
    if(number(controls.largest_serialized_candidate_event_span_days) > 3.01){
      errors.push('candidate event exceeds three-day publication span');
    }
    return errors;
  }

  return {
    number: number,
    text: text,
    safeHttpUrl: safeHttpUrl,
    indexActorSummaries: indexActorSummaries,
    emptySummary: emptySummary,
    summaryFor: summaryFor,
    eventsForActor: eventsForActor,
    actorQuery: actorQuery,
    formatRange: formatRange,
    eventSourceLabel: eventSourceLabel,
    eventAssessment: eventAssessment,
    validatePublicationMeta: validatePublicationMeta
  };
});
