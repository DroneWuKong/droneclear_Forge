(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IntelHealth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const GOOD = new Set(['ok', 'empty', 'fresh']);
  const WARNING = new Set(['degraded', 'silent', 'stale']);
  const FAILURE = new Set(['error', 'failed', 'invalid']);
  const NEUTRAL = new Set(['skip', 'unknown', 'unreported']);

  function unwrap(value) {
    let current = value;
    for (let i = 0; i < 3; i += 1) {
      if (!current || Array.isArray(current) || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, 'data')) break;
      current = current.data;
    }
    return current;
  }

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function list(value) {
    if (Array.isArray(value)) return value.map(String);
    if (value && typeof value === 'object') return Object.keys(value);
    return [];
  }

  function statusTone(status) {
    const value = String(status || 'unreported').toLowerCase();
    if (GOOD.has(value)) return 'good';
    if (WARNING.has(value)) return 'warning';
    if (FAILURE.has(value)) return 'failure';
    return NEUTRAL.has(value) ? 'neutral' : 'neutral';
  }

  function parseTime(value) {
    if (!value) return null;
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }

  function freshness(value, now) {
    const timestamp = parseTime(value);
    const current = now instanceof Date ? now.getTime() : Number(now || Date.now());
    if (timestamp === null) return { status: 'unknown', hours: null, label: 'Timestamp unavailable' };
    const hours = (current - timestamp) / 3600000;
    if (hours < -0.25) return { status: 'invalid', hours, label: 'Future timestamp' };
    if (hours <= 36) return { status: 'fresh', hours, label: 'Current' };
    if (hours <= 72) return { status: 'delayed', hours, label: 'Delayed' };
    return { status: 'stale', hours, label: 'Stale' };
  }

  function daysSince(value, now) {
    const timestamp = parseTime(value);
    const current = now instanceof Date ? now.getTime() : Number(now || Date.now());
    if (timestamp === null) return null;
    return Math.max(0, Math.floor((current - timestamp) / 86400000));
  }

  function registryRows(registry) {
    const doc = object(unwrap(registry));
    return Array.isArray(doc.miners) ? doc.miners : (Array.isArray(registry) ? registry : []);
  }

  function buildRows(healthValue, registryValue, now) {
    const health = object(unwrap(healthValue));
    const registry = registryRows(registryValue);
    const collectorStatus = object(health.collector_status);
    const sourceStatus = object(health.source_status);
    const collectorLastRun = object(health.collector_last_run);
    const lastSeen = object(health.last_seen);
    const newestScrape = object(health.newest_scrape);
    const details = object(health.collector_details);
    const stale = object(health.evidence_stale_sources);
    const quiet = object(health.quiet_sources);
    const failed = new Set(list(health.failed_collectors));
    const silent = new Set(list(health.silent_sources));
    const stalled = new Set(list(health.stalled_sources));
    const registryMap = new Map(registry.map(item => [String(item.id || item.name || ''), item]));
    const ids = new Set([
      ...Object.keys(collectorStatus), ...Object.keys(sourceStatus), ...Object.keys(collectorLastRun),
      ...Object.keys(lastSeen), ...Object.keys(newestScrape), ...Object.keys(details),
      ...Object.keys(stale), ...Object.keys(quiet), ...failed, ...silent, ...stalled,
      ...registryMap.keys()
    ]);
    ids.delete('');

    return Array.from(ids).sort().map(id => {
      const meta = object(registryMap.get(id));
      const detail = object(details[id]);
      const runStatus = String(collectorStatus[id] || (failed.has(id) ? 'error' : 'unreported')).toLowerCase();
      let evidenceStatus = String(sourceStatus[id] || 'unreported').toLowerCase();
      if (silent.has(id)) evidenceStatus = 'silent';
      else if (stalled.has(id)) evidenceStatus = 'stale';
      const evidenceDate = newestScrape[id] || lastSeen[id] || null;
      const ageDays = stale[id] !== undefined ? Number(stale[id]) : (quiet[id] !== undefined ? Number(quiet[id]) : daysSince(evidenceDate, now));
      const success = Number(detail.feed_success_count);
      const failure = Number(detail.feed_failure_count);
      let persistence = 'unreported';
      if (detail.article_output_validated === true || detail.output_written === true) persistence = 'verified';
      if (detail.article_output_validated === false || detail.output_written === false) persistence = 'failed';
      const processingErrors = Array.isArray(detail.processing_errors) ? detail.processing_errors.filter(Boolean) : [];
      const notes = [];
      if (processingErrors.length) notes.push(`${processingErrors.length} processing error${processingErrors.length === 1 ? '' : 's'}`);
      if (detail.health_semantics) notes.push(String(detail.health_semantics));
      if (silent.has(id)) notes.push('No recent evidence observed');
      if (stalled.has(id)) notes.push('Evidence stream stalled');
      return {
        id,
        name: String(meta.name || id.replaceAll('_', ' ')),
        category: String(meta.category || detail.output_type || 'uncategorized'),
        schedule: String(meta.schedule || 'not declared'),
        active: meta.active !== false,
        url: typeof meta.url === 'string' ? meta.url : '',
        runStatus,
        runTone: statusTone(runStatus),
        evidenceStatus,
        evidenceTone: statusTone(evidenceStatus),
        lastRun: collectorLastRun[id] || null,
        evidenceDate,
        ageDays: Number.isFinite(ageDays) ? ageDays : null,
        successCount: Number.isFinite(success) ? success : null,
        failureCount: Number.isFinite(failure) ? failure : null,
        persistence,
        note: notes.join(' · ')
      };
    });
  }

  function countBy(rows, field) {
    return rows.reduce((counts, row) => {
      const key = String(row[field] || 'unreported');
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  }

  function summarize(healthValue, registryValue, now) {
    const health = object(unwrap(healthValue));
    const registry = object(unwrap(registryValue));
    const rows = buildRows(health, registry, now);
    const runCounts = countBy(rows, 'runStatus');
    const evidenceCounts = countBy(rows, 'evidenceStatus');
    const healthFreshness = freshness(health.timestamp, now);
    const failures = rows.filter(row => row.runTone === 'failure').length;
    const warnings = rows.filter(row => row.runTone === 'warning' || row.evidenceTone === 'warning').length;
    const unknown = rows.filter(row => row.runTone === 'neutral').length;
    let overall = 'healthy';
    let headline = 'Pipeline reporting current';
    if (healthFreshness.status === 'unknown') {
      overall = 'neutral'; headline = 'Pipeline health timestamp unavailable';
    } else if (healthFreshness.status === 'invalid' || healthFreshness.status === 'stale') {
      overall = 'failure'; headline = 'Health telemetry is stale';
    } else if (healthFreshness.status === 'delayed' || failures > 0 || warnings > 0) {
      overall = 'warning'; headline = 'Pipeline has collection gaps';
    } else if (unknown > 0) {
      overall = 'neutral'; headline = 'Pipeline has unreported collectors';
    }
    return {
      health, registry, rows, runCounts, evidenceCounts, healthFreshness,
      overall, headline, failures, warnings, unknown,
      registered: Number(registry.total || object(health.miners).registered || 0),
      active: Number(object(health.miners).active || rows.filter(row => row.active).length),
      records: Number(health.total || 0),
      run: health.run === undefined ? null : health.run
    };
  }

  function stageSummary(summary, source) {
    const runGood = summary.rows.filter(row => row.runTone === 'good').length;
    const reported = summary.rows.filter(row => row.runStatus !== 'unreported').length;
    const verified = summary.rows.filter(row => row.persistence === 'verified').length;
    const persistenceFailed = summary.rows.filter(row => row.persistence === 'failed').length;
    const evidenceCurrent = summary.rows.filter(row => row.evidenceTone === 'good').length;
    const liveReadback = String(source || '').startsWith('/api/');
    const publicationTone = summary.healthFreshness.status === 'fresh' && liveReadback
      ? 'good'
      : (summary.healthFreshness.status === 'invalid' || summary.healthFreshness.status === 'stale' ? 'failure' : 'warning');
    return [
      { title: 'Collector run', value: `${runGood}/${reported}`, note: 'successful among reported', tone: summary.failures ? 'failure' : (runGood < reported ? 'warning' : 'good') },
      { title: 'Evidence', value: `${evidenceCurrent}/${summary.rows.length}`, note: 'current source streams', tone: summary.warnings ? 'warning' : 'good' },
      { title: 'Persistence', value: verified.toLocaleString(), note: `${persistenceFailed} explicit failures`, tone: persistenceFailed ? 'failure' : (verified ? 'good' : 'neutral') },
      { title: 'Publication', value: summary.healthFreshness.label, note: liveReadback ? 'production API readback' : 'static fallback', tone: publicationTone }
    ];
  }

  function fmtDate(value, withTime) {
    const timestamp = parseTime(value);
    if (timestamp === null) return 'Not reported';
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      ...(withTime ? { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' } : {})
    }).format(new Date(timestamp));
  }

  function human(value) {
    return String(value || 'unreported').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  }

  async function fetchFirst(urls) {
    const errors = [];
    for (const url of urls) {
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = unwrap(await response.json());
        if (!data || typeof data !== 'object') throw new Error('Invalid JSON document');
        return { data, source: url };
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
      }
    }
    throw new Error(errors.join('; '));
  }

  function text(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function badge(status, tone) {
    const element = document.createElement('span');
    element.className = `status ${tone || statusTone(status)}`;
    element.textContent = human(status);
    return element;
  }

  function renderSummary(summary, source) {
    const banner = document.getElementById('health-banner');
    banner.className = `banner ${summary.overall}`;
    text('health-headline', summary.headline);
    text('health-detail', `${summary.failures} failed · ${summary.warnings} degraded or stale · ${summary.unknown} unreported. Collector success does not prove fresh upstream evidence.`);
    text('health-time', `Artifact ${fmtDate(summary.health.timestamp, true)}`);
    text('metric-run', summary.run === null ? '—' : `#${summary.run}`);
    text('metric-registered', summary.registered.toLocaleString());
    text('metric-active', summary.active.toLocaleString());
    text('metric-records', summary.records.toLocaleString());
    text('metric-failed', summary.failures.toLocaleString());
    text('metric-stale', summary.warnings.toLocaleString());
    text('contract-semantics', summary.health.collector_health_semantics || 'Execution time, evidence time, and publication time are reported separately.');
    text('source-channel', source.startsWith('/api/') ? 'Live API readback' : 'Static fallback — live API unavailable');
  }

  function stageCard(title, value, note, tone) {
    const card = document.createElement('article'); card.className = `stage ${tone}`;
    const label = document.createElement('p'); label.textContent = title;
    const metric = document.createElement('strong'); metric.textContent = value;
    const detail = document.createElement('span'); detail.textContent = note;
    card.append(label, metric, detail); return card;
  }

  function renderStages(summary, source) {
    const grid = document.getElementById('stage-grid'); grid.replaceChildren();
    const stages = stageSummary(summary, source);
    grid.append(...stages.map((stage, index) => stageCard(
      `${index + 1} · ${stage.title}`,
      stage.value,
      stage.note,
      stage.tone
    )));
  }

  function renderCounts(containerId, counts) {
    const container = document.getElementById(containerId); container.replaceChildren();
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
      const item = document.createElement('div'); item.className = 'count-row';
      item.append(badge(status), Object.assign(document.createElement('strong'), { textContent: count.toLocaleString() }));
      container.append(item);
    });
  }

  function rowMatches(row, query, status, category) {
    const haystack = `${row.id} ${row.name} ${row.category} ${row.note}`.toLowerCase();
    const matchesStatus = !status || row.runStatus === status || row.evidenceStatus === status || row.runTone === status || row.evidenceTone === status;
    return (!query || haystack.includes(query)) && matchesStatus && (!category || row.category === category);
  }

  function renderRows(rows) {
    const body = document.getElementById('collector-body'); body.replaceChildren();
    const query = document.getElementById('collector-search').value.trim().toLowerCase();
    const status = document.getElementById('collector-status').value;
    const category = document.getElementById('collector-category').value;
    const filtered = rows.filter(row => rowMatches(row, query, status, category));
    text('collector-count', `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} collectors`);
    filtered.forEach(row => {
      const tr = document.createElement('tr');
      const source = document.createElement('td');
      const title = row.url ? document.createElement('a') : document.createElement('strong');
      title.textContent = row.name; if (row.url) { title.href = row.url; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
      const meta = document.createElement('small'); meta.textContent = `${row.id} · ${human(row.category)} · ${row.schedule}`;
      source.append(title, meta);
      const run = document.createElement('td'); run.append(badge(row.runStatus, row.runTone)); run.append(document.createElement('br'), document.createTextNode(fmtDate(row.lastRun, false)));
      const evidence = document.createElement('td'); evidence.append(badge(row.evidenceStatus, row.evidenceTone)); evidence.append(document.createElement('br'), document.createTextNode(row.evidenceDate ? `${fmtDate(row.evidenceDate, false)}${row.ageDays === null ? '' : ` · ${row.ageDays}d`}` : 'Not reported'));
      const transport = document.createElement('td'); transport.textContent = row.successCount === null && row.failureCount === null ? 'Not reported' : `${row.successCount || 0} ok / ${row.failureCount || 0} failed`;
      const persistence = document.createElement('td'); persistence.append(badge(row.persistence, row.persistence === 'verified' ? 'good' : (row.persistence === 'failed' ? 'failure' : 'neutral')));
      const note = document.createElement('td'); note.textContent = row.note || '—';
      tr.append(source, run, evidence, transport, persistence, note); body.append(tr);
    });
    if (!filtered.length) {
      const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 6; td.className = 'empty'; td.textContent = 'No collectors match these filters.'; tr.append(td); body.append(tr);
    }
  }

  function populateFilters(rows) {
    const categories = [...new Set(rows.map(row => row.category))].sort();
    const select = document.getElementById('collector-category');
    categories.forEach(category => { const option = document.createElement('option'); option.value = category; option.textContent = human(category); select.append(option); });
  }

  async function start() {
    try {
      const healthResult = await fetchFirst(['/api/data?type=miner_health', `/static/miner_health.json?ts=${Date.now()}`]);
      let registryResult = { data: { miners: [], total: 0 }, source: 'unavailable' };
      try { registryResult = await fetchFirst(['/api/data?type=miner_registry', `/static/miner_registry.json?ts=${Date.now()}`]); } catch (_) { /* health remains useful without registry metadata */ }
      const summary = summarize(healthResult.data, registryResult.data, new Date());
      renderSummary(summary, healthResult.source);
      renderStages(summary, healthResult.source);
      renderCounts('run-counts', summary.runCounts);
      renderCounts('evidence-counts', summary.evidenceCounts);
      populateFilters(summary.rows);
      renderRows(summary.rows);
      ['collector-search', 'collector-status', 'collector-category'].forEach(id => document.getElementById(id).addEventListener('input', () => renderRows(summary.rows)));
      document.getElementById('loading').hidden = true;
      document.getElementById('health-content').hidden = false;
    } catch (error) {
      const banner = document.getElementById('health-banner'); banner.className = 'banner failure';
      text('health-headline', 'Pipeline health unavailable');
      text('health-detail', 'Neither the production API nor the static fallback returned a valid health document. No healthy status is inferred.');
      text('health-time', 'Read failed');
      const errorBox = document.getElementById('health-error'); errorBox.hidden = false; errorBox.textContent = error.message;
      document.getElementById('loading').hidden = true;
    }
  }

  if (typeof document !== 'undefined') {
    const startStandalonePage = () => {
      if (document.getElementById('health-banner')) start();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startStandalonePage);
    else startStandalonePage();
  }

  return { unwrap, list, statusTone, freshness, buildRows, summarize, stageSummary, rowMatches, human };
});
