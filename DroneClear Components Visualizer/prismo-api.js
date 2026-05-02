/**
 * prismo-api.js — Forge site API client
 *
 * Intercepts static JSON fetches and routes them to the Prismo Worker API.
 * Static files remain as fallback — zero breakage if Worker is unavailable.
 *
 * Include ONCE at the top of any page that fetches PIE/intel data:
 *   <script src="/prismo-api.js"></script>
 *
 * "It just runs programs." — Number 5, Short Circuit
 */

(function () {
  'use strict';

  const API_BASE = 'https://pie-api.jeremiah-173.workers.dev';

  // Map of static file paths → Worker API endpoints
  const ROUTE_MAP = {
    '/pie_brief.json':        '/api/brief',
    '/pie_flags.json':        '/api/flags',
    '/pie_predictions.json':  '/api/predictions',
    '/forge_intel.json':      '/api/intel',
    '/intel_articles.json':   '/api/articles?limit=500',
    '/intel_companies.json':  '/api/articles/meta',   // served from KV meta
    '/solicitations.json':    '/api/procurement/solicitations',
    // Also handle relative paths
    '../static/pie_brief.json':  '/api/brief',
    '../static/pie_flags.json':  '/api/flags',
    '/static/pie_brief.json':    '/api/brief',
    '/static/pie_flags.json':    '/api/flags',
  };

  // Cache responses in memory for this page load
  const _cache = {};

  // Wrap fetch with API routing
  const _nativeFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url    = (typeof input === 'string') ? input : input.url;
    const clean  = url.split('?')[0].split('#')[0];
    const route  = ROUTE_MAP[clean];

    if (!route) return _nativeFetch(input, init);

    // Return cached response if available
    if (_cache[clean]) {
      return new Response(JSON.stringify(_cache[clean]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const apiUrl  = `${API_BASE}${route}`;
      const resp    = await _nativeFetch(apiUrl, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      _cache[clean] = data;
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.warn(`[Prismo] API fallback to static: ${clean} (${e.message})`);
      return _nativeFetch(input, init);
    }
  };

  // ── Live data helpers — available globally ────────────────

  window.Prismo = {
    API_BASE,

    /**
     * Fetch the live PIE brief from the Durable Object (real-time, not KV).
     * Falls back to KV brief if DO is unavailable.
     */
    async getLiveBrief() {
      try {
        const r = await _nativeFetch(`${API_BASE}/api/live/brief`);
        if (r.ok) return r.json();
      } catch(e) {}
      return window.fetch('/pie_brief.json').then(r => r.json());
    },

    /**
     * Fetch the live signal index — entity hit counts updated in real-time.
     */
    async getSignals() {
      const r = await _nativeFetch(`${API_BASE}/api/signals`);
      return r.ok ? r.json() : null;
    },

    /**
     * Semantic search across all intel articles.
     * @param {string} query
     * @param {object} opts — { limit, category, since, minScore }
     */
    async search(query, opts = {}) {
      const params = new URLSearchParams({ q: query });
      if (opts.limit)    params.set('limit',     opts.limit);
      if (opts.category) params.set('category',  opts.category);
      if (opts.since)    params.set('since',      opts.since);
      if (opts.minScore) params.set('min_score',  opts.minScore);
      const r = await _nativeFetch(`${API_BASE}/api/search?${params}`);
      return r.ok ? r.json() : { results: [] };
    },

    /**
     * Fetch live ticker — last N events (article ingested, brief updated, etc.)
     */
    async getTicker(n = 20) {
      const r = await _nativeFetch(`${API_BASE}/api/live/ticker?n=${n}`);
      return r.ok ? r.json() : { events: [] };
    },

    /**
     * Fetch analytics time-series data.
     * @param {string} dataset — prismo_articles | prismo_flags
     * @param {object} opts    — { days, groupBy }
     */
    async getAnalytics(dataset = 'prismo_articles', opts = {}) {
      const params = new URLSearchParams({ dataset });
      if (opts.days)    params.set('days',     opts.days);
      if (opts.groupBy) params.set('group_by', opts.groupBy);
      const r = await _nativeFetch(`${API_BASE}/api/analytics?${params}`);
      return r.ok ? r.json() : null;
    },
  };

  console.log('[Prismo] API client loaded — routing intel fetches to Cloudflare edge');
})();
