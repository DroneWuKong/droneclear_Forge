/* Issuance dates belong to forecasts; publication dates do not renew them. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PatternsPredictionFreshness = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const stamp = value => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
  function select(live, archive) {
    const current = rows(live), historical = rows(archive);
    return { records: current.length ? current : historical, archived: !current.length && historical.length > 0 };
  }
  function ordered(records) {
    return rows(records).map((record, index) => ({record, index})).sort((a, b) =>
      (stamp(b.record.issued_at) ?? -Infinity) - (stamp(a.record.issued_at) ?? -Infinity) || a.index - b.index
    ).map(item => item.record);
  }
  function summary(records, now = Date.now()) {
    const issued = rows(records).map(row => stamp(row.issued_at)).filter(at => at !== null && at <= now);
    const newest = issued.length ? Math.max(...issued) : null;
    return { total: rows(records).length, dated: issued.length, newest,
      daysSinceIssue: newest === null ? null : Math.floor((now - newest) / 86400000) };
  }
  function lifecycle(record, now = Date.now()) {
    if (record.resolved === true) return 'Outcome recorded · inspect review';
    const end = record.resolution_criteria?.window_end || record.target_date;
    const at = stamp(end);
    const deadline = at === null ? null : at + (/^\d{4}-\d{2}-\d{2}$/.test(end) ? 86400000 : 0);
    return deadline !== null && now >= deadline ? 'Window ended · awaiting reviewed outcome' : 'Awaiting outcome';
  }
  return {select, ordered, summary, lifecycle};
});
