const DEFAULT_EVENT_LIMIT = 20;
const MAX_EVENT_LIMIT = 100;

function integerParam(params, name, fallback, minimum, maximum) {
  const raw = params && typeof params.get === 'function' ? params.get(name) : null;
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizedActor(value) {
  return String(value || '').trim();
}

function eventDateValue(event) {
  const raw = event && (event.publication_end || event.publication_start);
  const parsed = Date.parse(raw || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortEventsNewestFirst(events) {
  return [...events].sort((left, right) => {
    const dateDifference = eventDateValue(right) - eventDateValue(left);
    if (dateDifference) return dateDifference;
    return String(left.candidate_event_id || '').localeCompare(
      String(right.candidate_event_id || ''),
    );
  });
}

export function projectArticleEventClusters(data, params) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const actor = normalizedActor(params && params.get ? params.get('actor') : '');
  const eventId = String(params && params.get ? params.get('event_id') || '' : '').trim();
  const view = String(params && params.get ? params.get('view') || '' : '').trim().toLowerCase();
  const meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  const summaries = Array.isArray(data.actor_summary) ? data.actor_summary : [];
  const events = Array.isArray(data.candidate_events) ? data.candidate_events : [];

  if (eventId) {
    const event = events.find(
      (row) => row && row.candidate_event_id === eventId,
    ) || null;
    return {
      meta,
      candidate_event: event,
      query: {
        event_id: eventId,
        found: Boolean(event),
      },
    };
  }

  if (actor) {
    const offset = integerParam(params, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = integerParam(
      params,
      'limit',
      DEFAULT_EVENT_LIMIT,
      1,
      MAX_EVENT_LIMIT,
    );
    const matching = sortEventsNewestFirst(
      events.filter(
        (event) =>
          event &&
          Array.isArray(event.actors_mentioned) &&
          event.actors_mentioned.includes(actor),
      ),
    );
    const summary = summaries.find(
      (row) => row && row.actor === actor,
    ) || null;
    return {
      meta,
      actor_summary: summary ? [summary] : [],
      candidate_events: matching.slice(offset, offset + limit),
      query: {
        actor,
        offset,
        limit,
        returned_event_count: Math.max(
          0,
          Math.min(limit, matching.length - offset),
        ),
        total_candidate_event_count: matching.length,
        has_more: offset + limit < matching.length,
      },
    };
  }

  if (view === 'summary') {
    return {
      meta,
      actor_summary: summaries,
      query: {
        view: 'summary',
        candidate_event_count:
          Number(meta.candidate_event_cluster_count) || events.length,
        serialized_candidate_event_count: events.length,
      },
    };
  }

  if (view === 'method') {
    return {
      meta,
      query: { view: 'method' },
    };
  }

  return data;
}

export function projectDataset(data, type, params) {
  if (type === 'article_event_clusters') {
    return projectArticleEventClusters(data, params);
  }
  return data;
}

export const EVENT_PROJECTION_LIMITS = Object.freeze({
  default: DEFAULT_EVENT_LIMIT,
  maximum: MAX_EVENT_LIMIT,
});
