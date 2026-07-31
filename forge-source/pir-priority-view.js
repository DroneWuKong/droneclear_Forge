/*
 * Local-only Priority Intelligence Requirement (PIR) ranking for UAS Patterns.
 *
 * Profiles rank already-indexed records using declared terms and weights. They
 * do not change source evidence, remove records from the underlying corpus, or
 * determine truth, relevance, attribution, compliance, or operational priority.
 * Pure functions are exported for browser and Node software-only tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PatternsPriorityView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_STORAGE_KEY = 'patterns_priority_profile_v1';
  const DEFAULT_PROFILE_ID = 'full';
  const SEVERITY_BONUS = Object.freeze({
    critical: 4,
    high: 3,
    warning: 2,
    medium: 2,
    moderate: 1,
    low: 0,
    info: 0,
    unknown: 0
  });

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalize(value) {
    return text(value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function termPattern(term) {
    const normalized = normalize(term);
    if (!normalized) return null;
    const body = normalized.split(' ').map(escapeRegex).join('\\s+');
    return new RegExp(`(?:^|[^a-z0-9])${body}(?=$|[^a-z0-9])`, 'i');
  }

  function flatten(value, depth, output, seen) {
    if (value == null || depth > 5) return output;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const scalar = text(value);
      if (scalar) output.push(scalar);
      return output;
    }
    if (typeof value !== 'object') return output;
    if (seen.has(value)) return output;
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 120).forEach(item => flatten(item, depth + 1, output, seen));
    } else {
      Object.keys(value).sort().forEach(key => {
        if (/^(body_text|raw_html|content_html|embedding)$/i.test(key)) return;
        flatten(value[key], depth + 1, output, seen);
      });
    }
    return output;
  }

  function recordText(record) {
    return normalize(flatten(record, 0, [], new Set()).join(' '));
  }

  function profileIndex(config) {
    const profiles = Array.isArray(config && config.profiles) ? config.profiles : [];
    const index = Object.create(null);
    profiles.forEach(profile => {
      if (profile && text(profile.id)) index[text(profile.id)] = profile;
    });
    return index;
  }

  function defaultProfileId(config) {
    const requested = text(config && config.meta && config.meta.default_profile) || DEFAULT_PROFILE_ID;
    const index = profileIndex(config);
    if (index[requested]) return requested;
    const first = Object.keys(index)[0];
    return first || DEFAULT_PROFILE_ID;
  }

  function normalizeProfileId(value, config) {
    const id = text(value);
    const index = profileIndex(config);
    return index[id] ? id : defaultProfileId(config);
  }

  function storageKey(config) {
    return text(config && config.meta && config.meta.storage_key) || DEFAULT_STORAGE_KEY;
  }

  function readStoredProfile(storage, config) {
    try {
      return normalizeProfileId(storage && storage.getItem(storageKey(config)), config);
    } catch (_) {
      return defaultProfileId(config);
    }
  }

  function writeStoredProfile(storage, config, profileId) {
    const normalized = normalizeProfileId(profileId, config);
    try {
      if (storage) storage.setItem(storageKey(config), normalized);
      return { profile_id: normalized, persisted: Boolean(storage) };
    } catch (_) {
      return { profile_id: normalized, persisted: false };
    }
  }

  function severityOf(record) {
    const raw = normalize(record && (record.severity || record.priority || record.risk_level || record.verdict));
    const first = raw.split(' ')[0] || 'unknown';
    if (first === 'critical') return 'critical';
    if (first === 'high') return 'high';
    if (first === 'warning') return 'warning';
    if (first === 'medium') return 'medium';
    if (first === 'moderate') return 'moderate';
    if (first === 'low') return 'low';
    if (first === 'info' || first === 'informational') return 'info';
    return 'unknown';
  }

  function scoreRecord(record, profile, datasetId) {
    const sourceText = recordText(record);
    const terms = Array.isArray(profile && profile.terms) ? profile.terms : [];
    const matches = [];
    let termScore = 0;
    terms.forEach(termRule => {
      const term = text(termRule && termRule.term);
      const pattern = termPattern(term);
      if (!pattern || !pattern.test(sourceText)) return;
      const weight = Number(termRule.weight);
      const safeWeight = Number.isFinite(weight) && weight > 0 ? weight : 1;
      termScore += safeWeight;
      matches.push({ term, weight: safeWeight });
    });
    const full = text(profile && profile.id) === DEFAULT_PROFILE_ID;
    const datasetWeights = profile && profile.dataset_weights && typeof profile.dataset_weights === 'object'
      ? profile.dataset_weights : {};
    const requestedMultiplier = Number(datasetWeights[datasetId]);
    const multiplier = Number.isFinite(requestedMultiplier) && requestedMultiplier > 0
      ? requestedMultiplier : 1;
    const severity = severityOf(record);
    const severityBonus = termScore > 0 ? (SEVERITY_BONUS[severity] || 0) : 0;
    const score = full ? 0 : Math.round((termScore * multiplier + severityBonus) * 100) / 100;
    return {
      score,
      term_score: termScore,
      dataset_multiplier: multiplier,
      severity,
      severity_bonus: severityBonus,
      matched: full || matches.length > 0,
      matches
    };
  }

  function rankRecords(records, profile, datasetId) {
    const rows = Array.isArray(records) ? records : [];
    return rows.map((record, index) => ({
      record,
      index,
      ranking: scoreRecord(record, profile, datasetId)
    })).sort((left, right) => {
      if (left.ranking.matched !== right.ranking.matched) return left.ranking.matched ? -1 : 1;
      if (right.ranking.score !== left.ranking.score) return right.ranking.score - left.ranking.score;
      return left.index - right.index;
    });
  }

  function safeHttpUrl(value) {
    const candidate = text(value);
    return /^https?:\/\//i.test(candidate) ? candidate : '';
  }

  function unwrap(payload) {
    return payload && payload.data !== undefined ? payload.data : payload;
  }

  function rowsFor(datasetId, payload) {
    const value = unwrap(payload);
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    const keys = datasetId === 'flags'
      ? ['flags', 'results', 'items', 'records']
      : datasetId === 'actors'
        ? ['fingerprints', 'actors', 'results']
        : datasetId === 'ttps'
          ? ['results', 'ttps', 'items']
          : datasetId === 'events'
            ? ['actor_summaries', 'candidate_events', 'results']
            : ['results', 'items', 'records'];
    for (const key of keys) {
      if (Array.isArray(value[key])) return value[key];
    }
    return [];
  }

  function titleFor(record, datasetId) {
    const row = record || {};
    if (datasetId === 'actors') return text(row.actor || row.name) || 'Unnamed actor signal';
    if (datasetId === 'ttps') return text(row.ttp_name || row.ttp || row.name || row.technique) || 'Unnamed TTP signal';
    if (datasetId === 'events') return text(row.actor || row.representative_title || row.title) || 'Candidate-event summary';
    return text(row.title || row.name || row.headline || row.entity || row.flag_type) || 'Untitled indexed signal';
  }

  function summaryFor(record, datasetId) {
    const row = record || {};
    if (datasetId === 'actors') {
      const mentions = Number(row.article_mention_count || row.incident_count || 0);
      const sources = Number(row.unique_source_count || 0);
      const reporting = Number(row.reporting_cluster_count || 0);
      const candidates = Number(row.candidate_event_count || 0);
      const multi = Number(row.multi_source_candidate_event_count || 0);
      const eventClause = reporting || candidates || multi
        ? ` ${reporting.toLocaleString()} reporting clusters, ${candidates.toLocaleString()} candidate-event clusters, and ${multi.toLocaleString()} multi-site candidates.`
        : '';
      return `${mentions.toLocaleString()} article mentions across ${sources.toLocaleString()} source labels.${eventClause} Mentions and clusters are not incident attribution.`;
    }
    if (datasetId === 'ttps') {
      return text(row.verdict || row.summary || row.description || row.note) || 'Indexed TTP and defensive-signal comparison.';
    }
    if (datasetId === 'events') {
      const reporting = Number(row.reporting_cluster_count || 0);
      const candidates = Number(row.candidate_event_count || 0);
      const multi = Number(row.multi_source_candidate_event_count || 0);
      return `${reporting.toLocaleString()} reporting clusters; ${candidates.toLocaleString()} candidate-event clusters; ${multi.toLocaleString()} multi-site candidates. These are machine groupings, not confirmed incidents.`;
    }
    return text(row.detail || row.summary || row.description || row.rationale || row.note) || 'Indexed public-source signal. Review the linked evidence and current status.';
  }

  function dateFor(record) {
    const row = record || {};
    return text(row.last_seen || row.updated_at || row.generated_at || row.date || row.pub_date || row.first_seen);
  }

  function evidenceUrlFor(record) {
    const row = record || {};
    const direct = safeHttpUrl(row.url || row.source_url || row.evidence_url);
    if (direct) return direct;
    const sources = Array.isArray(row.sources) ? row.sources : [];
    for (const source of sources) {
      const url = safeHttpUrl(source && (source.url || source.link));
      if (url) return url;
    }
    const samples = Array.isArray(row.sample_articles) ? row.sample_articles : [];
    for (const sample of samples) {
      const url = safeHttpUrl(sample && sample.url);
      if (url) return url;
    }
    return '';
  }

  function mergeActorEventSummaries(actorRows, eventRows) {
    const eventIndex = Object.create(null);
    (Array.isArray(eventRows) ? eventRows : []).forEach(row => {
      const actor = text(row && row.actor);
      if (actor) eventIndex[actor] = row;
    });
    return (Array.isArray(actorRows) ? actorRows : []).map(row => {
      const actor = text(row && row.actor);
      const event = eventIndex[actor];
      return event ? Object.assign({}, row, {
        reporting_cluster_count: event.reporting_cluster_count,
        candidate_event_count: event.candidate_event_count,
        multi_source_candidate_event_count: event.multi_source_candidate_event_count,
        event_semantics: event.semantics
      }) : row;
    });
  }

  function profileTerms(profile) {
    return (Array.isArray(profile && profile.terms) ? profile.terms : [])
      .map(rule => text(rule && rule.term))
      .filter(Boolean);
  }

  function profileById(config, id) {
    const index = profileIndex(config);
    return index[normalizeProfileId(id, config)] || null;
  }

  async function fetchJson(endpoints) {
    let lastError;
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('dataset unavailable');
  }

  async function fetchDataset(type, options) {
    const extra = options && options.query ? `&${options.query}` : '';
    return fetchJson([
      `/api/data?type=${encodeURIComponent(type)}${extra}`,
      `/static/${encodeURIComponent(type)}.json?ts=${Date.now()}`,
      `/${encodeURIComponent(type)}.json?ts=${Date.now()}`
    ]);
  }

  function htmlEscape(value) {
    return text(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function formatDate(value) {
    if (!value) return 'Date not reported';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Date unparseable';
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
    }).format(parsed);
  }

  function renderRecordCard(item, datasetId) {
    const row = item.record || {};
    const ranking = item.ranking || {};
    const matched = (ranking.matches || []).map(match => match.term);
    const evidence = evidenceUrlFor(row);
    const destination = datasetId === 'flags' ? '/patterns/' : datasetId === 'ttps' ? '/ttps/' : '/actors/';
    return `<article class="signal-card${ranking.matched ? '' : ' unmatched'}">
      <div class="signal-top">
        <span class="dataset-badge">${htmlEscape(datasetId)}</span>
        <span class="score-badge">${ranking.score ? `profile score ${ranking.score}` : 'source order'}</span>
      </div>
      <h3>${htmlEscape(titleFor(row, datasetId))}</h3>
      <p>${htmlEscape(summaryFor(row, datasetId))}</p>
      <div class="signal-meta">
        <span>${htmlEscape(formatDate(dateFor(row)))}</span>
        <span>${htmlEscape(ranking.severity || 'unknown')} severity</span>
      </div>
      <div class="match-row">${matched.length
        ? matched.map(term => `<span>${htmlEscape(term)}</span>`).join('')
        : '<span>no declared profile term matched</span>'}</div>
      <div class="signal-actions">
        <a href="${destination}">Open full dataset</a>
        ${evidence ? `<a href="${htmlEscape(evidence)}" target="_blank" rel="noopener noreferrer">Open evidence ↗</a>` : ''}
      </div>
    </article>`;
  }

  function renderSection(container, rows, profile, datasetId, limit) {
    const ranked = rankRecords(rows, profile, datasetId);
    const matchedCount = ranked.filter(item => item.ranking.matched).length;
    const display = profile.id === DEFAULT_PROFILE_ID
      ? ranked.slice(0, limit)
      : ranked.filter(item => item.ranking.matched).slice(0, limit);
    const omitted = Math.max(0, rows.length - display.length);
    if (!display.length) {
      container.innerHTML = `<div class="empty-state">No record matched the declared terms for this profile. That does not mean the topic is absent from the full corpus. Open the full dataset or select Full analyst view.</div>`;
    } else {
      container.innerHTML = display.map(item => renderRecordCard(item, datasetId)).join('');
    }
    return { total: rows.length, matched: matchedCount, displayed: display.length, omitted };
  }

  function coverageFacts(catalogPayload, coveragePayload) {
    const catalog = unwrap(catalogPayload) || {};
    const coverage = unwrap(coveragePayload) || {};
    const meta = coverage.meta || {};
    const concentration = meta.source_concentration || {};
    return {
      catalog_generated_at: catalog.meta && catalog.meta.generated_at,
      catalog_dataset_count: catalog.meta && (catalog.meta.dataset_count || (catalog.datasets || []).length),
      coverage_generated_at: meta.generated_at,
      article_count: meta.analyzed_article_records,
      observed_source_count: meta.observed_source_key_count,
      registered_source_count: meta.registered_source_count,
      top_source_share: concentration.top_source_share,
      unparseable_date_count: meta.unparseable_publication_date_count,
      future_date_count: meta.future_dated_record_count,
      missing_language_count: meta.explicit_language_metadata_missing_record_count,
      missing_geography_count: meta.explicit_geography_metadata_missing_record_count,
      caveat: meta.caveat || 'Coverage describes indexed public records, not all available intelligence.'
    };
  }

  function percent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : 'Not reported';
  }

  function renderCoverage(container, facts) {
    const metrics = [
      ['Indexed articles', Number(facts.article_count || 0).toLocaleString()],
      ['Observed source keys', Number(facts.observed_source_count || 0).toLocaleString()],
      ['Registered collectors', Number(facts.registered_source_count || 0).toLocaleString()],
      ['Top-source share', percent(facts.top_source_share)],
      ['Unparseable dates', Number(facts.unparseable_date_count || 0).toLocaleString()],
      ['Future-dated excluded', Number(facts.future_date_count || 0).toLocaleString()]
    ];
    container.innerHTML = `<div class="coverage-grid">${metrics.map(([label, value]) =>
      `<div><strong>${htmlEscape(value)}</strong><span>${htmlEscape(label)}</span></div>`
    ).join('')}</div>
    <p class="coverage-note">${htmlEscape(facts.caveat)}</p>
    <p class="coverage-note">Language and geography metadata remain incomplete; profile ranking searches the indexed text and does not repair those coverage gaps.</p>`;
  }

  async function boot() {
    if (typeof document === 'undefined') return;
    const root = document.querySelector('[data-priority-view]');
    if (!root) return;
    const status = document.getElementById('priority-status');
    const profileSelect = document.getElementById('profile-select');
    const profileTitle = document.getElementById('profile-title');
    const profileDescription = document.getElementById('profile-description');
    const termsNode = document.getElementById('profile-terms');
    const countsNode = document.getElementById('priority-counts');
    const coverageNode = document.getElementById('priority-coverage');
    const sections = {
      flags: document.getElementById('priority-flags'),
      actors: document.getElementById('priority-actors'),
      ttps: document.getElementById('priority-ttps')
    };

    try {
      status.textContent = 'Loading profile definitions and current public datasets…';
      const optional = promise => promise.catch(error => ({ __priority_error: error && error.message ? error.message : String(error) }));
      const [config, flagsPayload, actorsPayload, ttpsPayload, eventsPayload, catalogPayload, coveragePayload] = await Promise.all([
        fetchJson(['/static/pir_profiles.json', '/pir_profiles.json']),
        optional(fetchDataset('flags')),
        optional(fetchDataset('actor_fingerprints')),
        optional(fetchDataset('ttp_counter_gap')),
        optional(fetchJson(['/api/data?type=article_event_clusters&view=summary'])),
        optional(fetchDataset('dataset_catalog')),
        optional(fetchDataset('source_coverage_matrix'))
      ]);

      const payloads = { flags: flagsPayload, actors: actorsPayload, ttps: ttpsPayload, events: eventsPayload, catalog: catalogPayload, coverage: coveragePayload };
      const dataErrors = Object.entries(payloads)
        .filter(([, payload]) => payload && payload.__priority_error)
        .map(([name, payload]) => `${name}: ${payload.__priority_error}`);
      const flags = rowsFor('flags', flagsPayload);
      const eventRows = rowsFor('events', eventsPayload);
      const actors = mergeActorEventSummaries(rowsFor('actors', actorsPayload), eventRows);
      const ttps = rowsFor('ttps', ttpsPayload);
      const index = profileIndex(config);
      Object.values(index).forEach(profile => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.label;
        profileSelect.appendChild(option);
      });

      function render(profileId, persist) {
        const id = normalizeProfileId(profileId, config);
        const profile = profileById(config, id);
        if (persist) writeStoredProfile(window.localStorage, config, id);
        profileSelect.value = id;
        profileTitle.textContent = profile.label;
        profileDescription.textContent = profile.description;
        const terms = profileTerms(profile);
        termsNode.innerHTML = terms.length
          ? terms.map(term => `<span>${htmlEscape(term)}</span>`).join('')
          : '<span>All indexed records retain source order</span>';
        const summaries = {
          flags: renderSection(sections.flags, flags, profile, 'flags', 8),
          actors: renderSection(sections.actors, actors, profile, 'actors', 8),
          ttps: renderSection(sections.ttps, ttps, profile, 'ttps', 8)
        };
        const total = summaries.flags.total + summaries.actors.total + summaries.ttps.total;
        const matched = summaries.flags.matched + summaries.actors.matched + summaries.ttps.matched;
        countsNode.textContent = id === DEFAULT_PROFILE_ID
          ? `${total.toLocaleString()} indexed records available; showing a bounded source-order preview.`
          : `${matched.toLocaleString()} of ${total.toLocaleString()} indexed records matched at least one declared profile term. Unmatched records remain in the full datasets.`;
        status.textContent = dataErrors.length
          ? `Priority view loaded with ${dataErrors.length} unavailable dataset${dataErrors.length === 1 ? '' : 's'}; available sections remain usable. Profile stored only in this browser when storage is available.`
          : `Priority view ready. Profile stored only in this browser${persist ? '.' : ' when storage is available.'}`;
        status.title = dataErrors.join(' | ');
      }

      profileSelect.addEventListener('change', () => render(profileSelect.value, true));
      render(readStoredProfile(window.localStorage, config), false);
      if (coveragePayload && coveragePayload.__priority_error) {
        coverageNode.innerHTML = '<div class="empty-state">Coverage metadata is unavailable. Ranking results remain visible, but source concentration and metadata gaps cannot be assessed from this view.</div>';
      } else {
        renderCoverage(coverageNode, coverageFacts(catalogPayload, coveragePayload));
      }
    } catch (error) {
      status.textContent = `Priority view unavailable: ${error && error.message ? error.message : String(error)}`;
      Object.values(sections).forEach(container => {
        if (container) container.innerHTML = '<div class="empty-state">Current data could not be loaded. The full Patterns datasets remain available from the main navigation.</div>';
      });
    }
  }

  return {
    DEFAULT_STORAGE_KEY,
    DEFAULT_PROFILE_ID,
    normalize,
    termPattern,
    recordText,
    profileIndex,
    defaultProfileId,
    normalizeProfileId,
    storageKey,
    readStoredProfile,
    writeStoredProfile,
    severityOf,
    scoreRecord,
    rankRecords,
    safeHttpUrl,
    unwrap,
    rowsFor,
    titleFor,
    summaryFor,
    dateFor,
    evidenceUrlFor,
    mergeActorEventSummaries,
    profileTerms,
    profileById,
    coverageFacts,
    boot
  };
});
