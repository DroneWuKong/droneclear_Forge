(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UasClockData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY_MS = 86400000;
  const SEVERITIES = new Set(['critical', 'high', 'medium', 'warning', 'low', 'info']);

  function validDate(value) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? time : 0;
  }

  function newestTimestamp(type, data, freshness) {
    const declared = validDate(freshness && freshness.generated_at);
    if (declared) return declared;
    if (data && !Array.isArray(data)) return validDate(data.generated || data.generated_at || data.as_of);
    const fields = type === 'flags'
      ? ['last_verified_at', 'changed_at', 'last_seen']
      : ['last_updated', 'issued_at', 'evidence_cutoff', 'target_date'];
    return Math.max(0, ...(Array.isArray(data) ? data : []).flatMap(row =>
      fields.map(field => validDate(row && row[field]))));
  }

  function isFreshDataset(type, data, freshness, now = Date.now(), maxAgeDays = 8) {
    if (!data || (Array.isArray(data) && !data.length)) return false;
    const generated = newestTimestamp(type, data, freshness);
    return generated > 0 && now - generated <= maxAgeDays * DAY_MS;
  }

  function predictionSeverity(row) {
    const raw = String(row && row.impact || '').toLowerCase();
    if (SEVERITIES.has(raw)) return raw === 'warning' ? 'medium' : raw === 'info' ? 'low' : raw;
    const probability = Number(row && row.probability) || 0;
    if (probability >= 0.85) return 'critical';
    if (probability >= 0.75) return 'high';
    if (probability >= 0.6) return 'medium';
    return 'low';
  }

  function selectPredictions(rows, limit = 12) {
    return (Array.isArray(rows) ? rows : [])
      .filter(row => row && row.event && row.resolved !== true)
      .map(row => ({
        event: String(row.event),
        probability: Math.max(0, Math.min(1, Number(row.probability) || 0)),
        impact: predictionSeverity(row),
        timeframe: String(row.timeframe || row.target_date || 'Open window'),
        drivers: Array.isArray(row.drivers) && row.drivers.length
          ? row.drivers.map(String)
          : [String(row.evidence_basis || row.probability_basis || 'Current PIE evidence')],
        updated_at: row.last_updated || row.issued_at || row.evidence_cutoff || '',
      }))
      .sort((a, b) => validDate(b.updated_at) - validDate(a.updated_at) || b.probability - a.probability)
      .slice(0, limit);
  }

  function selectTopFlags(rows, limit = 12) {
    const severityRank = { critical: 5, high: 4, warning: 3, medium: 2, info: 1, low: 0 };
    const changeRank = { new: 4, escalated: 3, updated: 2, changed: 2, unchanged: 0 };
    return (Array.isArray(rows) ? rows : [])
      .filter(row => row && row.title && !['closed', 'resolved', 'archived'].includes(String(row.status).toLowerCase()))
      .sort((a, b) =>
        (changeRank[String(b.change_kind).toLowerCase()] || 0) - (changeRank[String(a.change_kind).toLowerCase()] || 0) ||
        validDate(b.changed_at || b.last_verified_at) - validDate(a.changed_at || a.last_verified_at) ||
        (severityRank[String(b.severity).toLowerCase()] || 0) - (severityRank[String(a.severity).toLowerCase()] || 0))
      .slice(0, limit)
      .map(row => ({
        title: String(row.title),
        severity: SEVERITIES.has(String(row.severity).toLowerCase()) ? String(row.severity).toLowerCase() : 'info',
        type: String(row.flag_type || row.category || 'signal'),
      }));
  }

  function historyFromTrends(doc, limit = 14) {
    const trends = doc && Array.isArray(doc.trends) ? doc.trends : [];
    const total = trends.find(row => row.metric === 'total_flags');
    const critical = trends.find(row => row.metric === 'critical_flags');
    if (!total || !critical || !Array.isArray(total.dates) || !Array.isArray(total.values)) return [];
    const criticalByDate = new Map((critical.dates || []).map((date, i) => [date, Number(critical.values[i]) || 0]));
    return total.dates.map((date, i) => {
      const totalValue = Number(total.values[i]) || 0;
      const criticalValue = criticalByDate.get(date) || 0;
      return {
        date: new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        critical: criticalValue,
        other: Math.max(0, totalValue - criticalValue),
      };
    }).slice(-limit);
  }

  function projectAuxData({ predictions, flags, trends }) {
    return {
      predictions: selectPredictions(predictions),
      top_flags: selectTopFlags(flags),
      history: historyFromTrends(trends),
    };
  }

  return { isFreshDataset, predictionSeverity, selectPredictions, selectTopFlags, historyFromTrends, projectAuxData };
});
