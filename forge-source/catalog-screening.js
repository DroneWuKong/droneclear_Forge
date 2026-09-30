// Recorded catalog flags are evidence inputs, never whole-configuration approval.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CatalogScreening = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function flag(record, key) {
    const values = [record && record[key], record && record.compliance && record.compliance[key]]
      .filter(value => typeof value === 'boolean');
    if (!values.length || values.some(value => value !== values[0])) return null;
    return values[0];
  }
  function tier(record) {
    const ndaa = flag(record, 'ndaa_compliant');
    if (ndaa === null) return 'unknown';
    if (ndaa === false) return 'orange';
    return flag(record, 'blue_uas') === true ? 'green' : 'yellow';
  }
  function evidence(record) {
    const p = record || {};
    const source = [p.source_url, p.doc_url, p.link, p.verification && p.verification.source_url]
      .find(value => typeof value === 'string' && /^https?:\/\//i.test(value)) || null;
    const stamp = p.last_verified_at || (p.verification && p.verification.audited_at);
    const time = typeof stamp === 'string' && stamp.trim() ? Date.parse(stamp) : NaN;
    return { source, verifiedAt: Number.isFinite(time) ? new Date(time).toISOString() : null };
  }
  function summarize(pids, components) {
    const records = new Map();
    for (const rows of Object.values(components || {})) {
      if (!Array.isArray(rows)) continue;
      for (const record of rows) if (record && record.pid) records.set(record.pid, record);
    }
    const unique = [...new Set(pids || [])];
    const rows = unique.map(pid => {
      const record = records.get(pid);
      return { pid, record: record || null, ndaa: flag(record, 'ndaa_compliant'), ...evidence(record) };
    });
    return {
      rows,
      recordedTrue: rows.filter(row => row.ndaa === true).length,
      recordedFalse: rows.filter(row => row.ndaa === false).length,
      unknown: rows.filter(row => row.ndaa === null).length,
      missing: rows.filter(row => !row.record).length,
    };
  }
  return { flag, tier, evidence, summarize };
});
