// Main score freshness uses the artifact's actual generation date, not a wrapper date.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UasClockScore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_AGE_MS = 72 * 3600 * 1000;
  const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
  function inspect(payload, now = Date.now()) {
    const score = payload && payload.data != null ? payload.data : payload;
    const stamp = score && score.generated;
    const generated = typeof stamp === 'string' && stamp.trim() ? Date.parse(stamp) : NaN;
    const value = score && score.ueri_score;
    if (!Number.isFinite(generated)) return { status: 'invalid-date', data: null, generatedAt: null };
    const generatedAt = new Date(generated).toISOString();
    if (generated > now + FUTURE_TOLERANCE_MS) return { status: 'invalid-future', data: null, generatedAt };
    if (now - generated > MAX_AGE_MS) return { status: 'stale', data: null, generatedAt };
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      return { status: 'invalid-score', data: null, generatedAt };
    }
    if (score.factors != null && (typeof score.factors !== 'object' || Array.isArray(score.factors) ||
      Object.values(score.factors).some(factor => !factor || typeof factor !== 'object' || Array.isArray(factor)))) {
      return { status: 'invalid-shape', data: null, generatedAt };
    }
    return { status: 'fresh', data: score, generatedAt };
  }
  function count(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
  function map(score) {
    const factors = score.factors || {};
    const flags = factors.flag_severity || {};
    const entities = factors.grayzone && Array.isArray(factors.grayzone.top_entities) ? factors.grayzone.top_entities : [];
    return {
      generated: score.generated,
      ueri_score: score.ueri_score,
      minutes_to_midnight: score.minutes_to_midnight,
      display: score.display,
      narrative: typeof score.narrative === 'string' ? score.narrative : '',
      factors,
      flags: { total: count(flags.total), by_severity: { critical: count(flags.critical), warning: count(flags.warning) } },
      gray_zone: Object.fromEntries(entities.filter(row => row && typeof row.entity === 'string' &&
        typeof row.score === 'number' && Number.isFinite(row.score) && row.score >= 0 && row.score <= 1)
        .map(row => [row.entity, row.score])),
      predictions: [], top_flags: [], history: [],
    };
  }
  async function load(sources, { fetcher = fetch, now = Date.now() } = {}) {
    const failures = [];
    for (const source of sources) {
      try {
        const response = await fetcher(source, { cache: 'no-store',
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined });
        if (!response.ok) { failures.push({ status: 'unavailable', source }); continue; }
        const result = inspect(await response.json(), now);
        if (result.status === 'fresh') return { ...result, data: map(result.data), source, failures };
        failures.push({ ...result, source });
      } catch (_) { failures.push({ status: 'unavailable', source }); }
    }
    return { status: failures.some(row => row.status === 'stale') ? 'stale' : 'unavailable', data: null, source: null, failures };
  }
  return { inspect, map, load, MAX_AGE_MS, FUTURE_TOLERANCE_MS };
});
