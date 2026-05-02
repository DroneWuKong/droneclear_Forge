/**
 * prismo-api.js — Forge site API client
 *
 * Intercepts static JSON fetches AND /.netlify/functions/forge-data calls,
 * routes them to the Prismo Worker API at Cloudflare edge.
 * Falls back to original request if Worker is unavailable.
 *
 * Include ONCE before any other scripts:
 *   <script src="/prismo-api.js"></script>
 *
 * "It just runs programs." — Number 5, Short Circuit
 */

(function () {
  'use strict';

  const API_BASE = 'https://pie-api.jeremiah-173.workers.dev';

  // Map static file paths → Worker endpoints
  const STATIC_ROUTES = {
    '/pie_brief.json':           '/api/brief',
    '/pie_flags.json':           '/api/flags',
    '/pie_predictions.json':     '/api/predictions',
    '/forge_intel.json':         '/api/intel',
    '/intel_articles.json':      '/api/articles?limit=500',
    '/solicitations.json':       '/api/procurement/solicitations',
    '/federal_awards.json':      '/api/procurement/federal_awards',
    '../static/pie_brief.json':  '/api/brief',
    '../static/pie_flags.json':  '/api/flags',
    '/static/pie_brief.json':    '/api/brief',
    '/static/pie_flags.json':    '/api/flags',
    '/static/miner_health.json': '/api/health',
    '../static/miner_health.json': '/api/health',
  };

  // Map forge-data ?type= values → Worker endpoints
  // Response is wrapped in { data, tier:'free', type } to match Netlify function shape
  const FORGE_DATA_ROUTES = {
    pie_flags:           '/api/flags',
    pie_brief:           '/api/brief',
    pie_predictions:     '/api/predictions',
    pie_trends:          '/api/health',        // served from KV meta
    pie_brief_history:   '/api/brief',         // brief with history from DO
    predictions_best:    '/api/predictions',
    forge_intel:         '/api/intel',
    intel_articles:      '/api/articles?limit=500',
    intel_companies:     '/api/articles/meta',
    solicitations:       '/api/procurement/solicitations',
    federal_awards:      '/api/procurement/federal_awards',
    entity_graph:        '/api/grayzone/entities',
  };

  // In-memory cache for this page load
  const _cache = {};
  const _nativeFetch = window.fetch.bind(window);

  // ── Wrapped fetch ─────────────────────────────────────────

  window.fetch = async function (input, init) {
    const urlStr = (typeof input === 'string') ? input : (input?.url || '');
    const clean  = urlStr.split('?')[0].split('#')[0];
    const qs     = urlStr.includes('?') ? urlStr.slice(urlStr.indexOf('?')) : '';

    // ── 1. Netlify forge-data intercept ──────────────────────
    if (clean.includes('forge-data')) {
      const params = new URLSearchParams(qs);
      const type   = params.get('type');
      const route  = type && FORGE_DATA_ROUTES[type];

      if (route) {
        const cacheKey = `fd:${type}`;
        if (_cache[cacheKey]) {
          return new Response(JSON.stringify({ data: _cache[cacheKey], tier: 'free', type }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const r = await _nativeFetch(`${API_BASE}${route}`, { cache: 'no-store' });
          if (!r.ok) throw new Error(`API ${r.status}`);
          const data = await r.json();
          _cache[cacheKey] = data;
          return new Response(JSON.stringify({ data, tier: 'free', type }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        } catch (e) {
          console.warn(`[Prismo] forge-data fallback: ${type} (${e.message})`);
          return _nativeFetch(input, init);
        }
      }
    }

    // ── 2. Static JSON file intercept ────────────────────────
    const route = STATIC_ROUTES[clean];
    if (route) {
      if (_cache[clean]) {
        return new Response(JSON.stringify(_cache[clean]), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      try {
        const r = await _nativeFetch(`${API_BASE}${route}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`API ${r.status}`);
        const data = await r.json();
        _cache[clean] = data;
        return new Response(JSON.stringify(data), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        console.warn(`[Prismo] static fallback: ${clean} (${e.message})`);
        return _nativeFetch(input, init);
      }
    }

    // ── 3. Pass through unchanged ─────────────────────────────
    return _nativeFetch(input, init);
  };

  // ── window.Prismo — live data helpers ────────────────────

  window.Prismo = {
    API_BASE,

    /** Live PIE brief from Durable Object — real-time */
    async getLiveBrief() {
      try {
        const r = await _nativeFetch(`${API_BASE}/api/live/brief`);
        if (r.ok) return r.json();
      } catch(e) {}
      return _nativeFetch('/pie_brief.json').then(r => r.json());
    },

    /** Real-time entity signal index */
    async getSignals() {
      const r = await _nativeFetch(`${API_BASE}/api/signals`);
      return r.ok ? r.json() : null;
    },

    /**
     * Semantic search across all intel articles
     * @param {string} query
     * @param {{ limit?, category?, since?, minScore? }} opts
     */
    async search(query, opts = {}) {
      const p = new URLSearchParams({ q: query });
      if (opts.limit)    p.set('limit',     opts.limit);
      if (opts.category) p.set('category',  opts.category);
      if (opts.since)    p.set('since',      opts.since);
      if (opts.minScore) p.set('min_score',  opts.minScore);
      const r = await _nativeFetch(`${API_BASE}/api/search?${p}`);
      return r.ok ? r.json() : { results: [] };
    },

    /** Last N pipeline events — articles ingested, briefs updated, flag runs */
    async getTicker(n = 20) {
      const r = await _nativeFetch(`${API_BASE}/api/live/ticker?n=${n}`);
      return r.ok ? r.json() : { events: [] };
    },

    /** Analytics Engine time-series queries */
    async getAnalytics(dataset = 'prismo_articles', opts = {}) {
      const p = new URLSearchParams({ dataset });
      if (opts.days)    p.set('days',     opts.days);
      if (opts.groupBy) p.set('group_by', opts.groupBy);
      const r = await _nativeFetch(`${API_BASE}/api/analytics?${p}`);
      return r.ok ? r.json() : null;
    },

    /** Full live state snapshot from Durable Object */
    async getLiveState() {
      const r = await _nativeFetch(`${API_BASE}/api/live`);
      return r.ok ? r.json() : null;
    },
  };

  console.log('[Prismo] API client v2 loaded — routing Forge fetches to Cloudflare edge');
})();
