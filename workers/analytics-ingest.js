/**
 * analytics-ingest — CF Worker replacing /.netlify/functions/analytics-ingest
 * Route: /api/analytics/ingest
 *
 * Receives page-view / event batches from Forge pages.
 * Writes to Analytics Engine (prismo_articles dataset) + daily KV aggregate.
 */

import { timingSafeEqual } from './_auth.js';

const ALLOWED_ORIGINS = [
  'https://uas-forge.com', 'https://www.uas-forge.com',
  'https://uas-patterns.com', 'https://www.uas-patterns.com',
  'https://uas-handbook.com', 'https://www.uas-handbook.com',
  'http://localhost:8888', 'http://localhost:3000',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    // ── GET: admin-gated — key verification + daily aggregates ────────────
    // The analytics dashboard (analytics.html) calls GET ?verify=1 to check
    // the admin key and GET ?range=N to load daily KV aggregates.
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const provided = req.headers.get('x-admin-key') || '';
      const adminKey = env.ANALYTICS_ADMIN_KEY;
      const authed = !!adminKey && await timingSafeEqual(provided, adminKey);
      const jsonHeaders = { ...corsHeaders(origin), 'Content-Type': 'application/json' };

      if (url.searchParams.get('verify') === '1') {
        return new Response(JSON.stringify(authed ? { ok: true } : { error: 'Unauthorized' }),
          { status: authed ? 200 : 401, headers: jsonHeaders });
      }

      if (url.searchParams.has('range')) {
        if (!authed) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });
        const range = Math.min(Math.max(parseInt(url.searchParams.get('range'), 10) || 30, 1), 90);
        const days = [];
        for (let i = 0; i < range; i++) {
          const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
          const raw = await env.PIE_OUTPUTS.get(`analytics_daily_${d}`);
          if (raw) { try { days.push(JSON.parse(raw)); } catch(e) {} }
        }
        return new Response(JSON.stringify({ days, recentQueries: [] }), { status: 200, headers: jsonHeaders });
      }

      return new Response(JSON.stringify({ error: 'Unknown GET action' }), { status: 400, headers: jsonHeaders });
    }

    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });

    try {
      const body = await req.json();
      const events = Array.isArray(body) ? body : [body];
      const today = new Date().toISOString().slice(0, 10);
      const dayKey = `analytics_daily_${today}`;

      // Write to Analytics Engine if bound
      if (env.FORGE_ANALYTICS) {
        for (const event of events) {
          env.FORGE_ANALYTICS.writeDataPoint({
            dataset: 'forge_analytics',
            doubles: [event.value || 1],
            blobs: [event.type || 'pageview', event.page || '', event.session_id || ''],
            indexes: [event.type || 'pageview'],
          });
        }
      }

      // Aggregate into daily KV bucket
      const existing = await env.PIE_OUTPUTS.get(dayKey);
      const agg = existing ? JSON.parse(existing) : { date: today, events: 0, pages: {} };
      agg.events += events.length;
      for (const event of events) {
        const page = event.page || 'unknown';
        agg.pages[page] = (agg.pages[page] || 0) + 1;
      }
      await env.PIE_OUTPUTS.put(dayKey, JSON.stringify(agg), { expirationTtl: 60 * 60 * 24 * 90 }); // 90 days

      return new Response(JSON.stringify({ ok: true, recorded: events.length }), {
        status: 200,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }
  }
};
