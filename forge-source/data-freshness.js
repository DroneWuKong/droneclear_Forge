// Shared by browser loaders and Worker publication gates; pure and clock-injectable.
(function (root) {
  const FUTURE_TOLERANCE_MS = 24 * 3600 * 1000;
  function inspect(data, maxAgeMs = 72 * 3600 * 1000, now = Date.now()) {
    const raw = data && (data.meta?.generated_at || data.generated_at || data.generated);
    const stamp = typeof raw === 'string' && raw.trim() ? Date.parse(raw) : NaN;
    const valid = Number.isFinite(stamp);
    const future = valid && stamp > now + FUTURE_TOLERANCE_MS;
    const age = valid ? Math.max(0, now - stamp) : null;
    return {
      generated_at: valid ? new Date(stamp).toISOString() : null,
      checked_at: new Date(now).toISOString(), age_seconds: age == null ? null : Math.floor(age / 1000),
      max_age_seconds: maxAgeMs == null ? null : Math.floor(maxAgeMs / 1000),
      status: future ? 'invalid-future' : maxAgeMs == null ? 'not-gated' : !valid ? 'unknown' : age > maxAgeMs ? 'stale' : 'fresh',
    };
  }
  function requireFresh(data, now = Date.now()) {
    const freshness = inspect(data, 72 * 3600 * 1000, now);
    if (freshness.status !== 'fresh') throw new Error(`Data ${freshness.status}; generated ${freshness.generated_at || 'unknown'}`);
    return data;
  }
  function refreshCatalog(catalog, now = Date.now()) {
    requireFresh(catalog, now);
    if (!catalog.meta || !Array.isArray(catalog.datasets)) throw new Error('catalog contract invalid');
    return { ...catalog, datasets: catalog.datasets.map(row => {
      if (['unavailable', 'invalid', 'invalid-future'].includes(row.status) || row.role === 'reference') return row;
      const hours = Number(row.freshness_sla_hours);
      const f = inspect(row, Number.isFinite(hours) && hours > 0 ? hours * 3600 * 1000 : 72 * 3600 * 1000, now);
      return { ...row, status: f.status === 'unknown' ? 'available-unversioned' : f.status };
    }) };
  }
  async function load(endpoints, { fetcher = fetch, catalog = false, now = Date.now() } = {}) {
    let lastError;
    for (const endpoint of endpoints) {
      try {
        const response = await fetcher(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.error) throw new Error(payload.error);
        const data = payload?.data ?? payload;
        return catalog ? refreshCatalog(data, now) : requireFresh(data, now);
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Data unavailable');
  }
  const api = { inspect, requireFresh, refreshCatalog, load, FUTURE_TOLERANCE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DataFreshness = api;
})(globalThis);
