/**
 * prices-api — CF Worker replacing /.netlify/functions/prices-api
 * Route: /api/prices
 *
 * GET  — serve pricing data from PARTS_DB KV or a labeled catalog estimate
 * POST — community price submission (PRICES_API_KEY auth), stored in PARTS_DB KV
 */

import { timingSafeEqual } from './_auth.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control':'no-store' },
  });
}

async function catalogPrices(req, env) {
  const source = new URL('/static/forge_database.json', req.url);
  const response = await env.ASSETS?.fetch(new Request(source));
  if (!response?.ok) throw new Error('Pricing catalog unavailable');
  const database = await response.json();
  if (!database || !database.components || typeof database.components !== 'object') throw new Error('Invalid pricing catalog');
  return Object.entries(database.components).flatMap(([category, rows]) =>
    (Array.isArray(rows) ? rows : []).filter(row => Number.isFinite(Number(row.price_usd ?? row.approx_price_usd ?? row.approx_price)) && Number(row.price_usd ?? row.approx_price_usd ?? row.approx_price) > 0)
      .map(row => ({pid:row.pid,name:row.name,category,price_usd:Number(row.price_usd ?? row.approx_price_usd ?? row.approx_price),source_url:row.link || null,price_kind:'catalog_estimate'})));
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);

    // ── POST: community price submission ──────────────────────────────────
    if (req.method === 'POST') {
      const apiKey = env.PRICES_API_KEY;
      const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!apiKey || !(await timingSafeEqual(provided, apiKey))) return resp({ error: 'Unauthorized' }, 401);

      try {
        const body = await req.json();
        if (!body.name) return resp({ error: 'name is required' }, 400);
        if (typeof body.price_usd !== 'number') return resp({ error: 'price_usd must be a number' }, 400);

        const submissionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const submission = { submission_id: submissionId, submitted_at: new Date().toISOString(), ...body };

        // Append to community_prices log in KV
        const existing = await env.PARTS_DB.get('community_prices');
        const log = existing ? JSON.parse(existing) : [];
        log.push(submission);
        // Keep last 1000 submissions
        if (log.length > 1000) log.splice(0, log.length - 1000);
        await env.PARTS_DB.put('community_prices', JSON.stringify(log));

        return resp({ ok: true, submission_id: submissionId, message: 'Price submission recorded' });
      } catch(e) {
        return resp({ error: 'Submission failed: ' + e.message }, 500);
      }
    }

    // ── GET: serve pricing data ────────────────────────────────────────────
    const componentFilter = url.searchParams.get('component');
    const categoryFilter = url.searchParams.get('category');
    const allFlag = url.searchParams.get('all');

    try {
      const raw = await env.PARTS_DB?.get('prices');
      const stored = raw ? JSON.parse(raw) : [];
      const components = Array.isArray(stored) && stored.length ? stored : await catalogPrices(req, env);
      const source = Array.isArray(stored) && stored.length ? 'parts_db' : 'catalog_estimate';

      let filtered = components;
      if (componentFilter) {
        filtered = components.filter(c =>
          c.pid === componentFilter || c.name?.toLowerCase().includes(componentFilter.toLowerCase())
        );
      } else if (categoryFilter) {
        filtered = components.filter(c => c.category === categoryFilter);
      } else if (!allFlag) {
        filtered = components.slice(0, 50); // default: first 50
      }

      return resp({
        components: filtered,
        meta: {
          total: components.length,
          source,
          as_of: source === 'catalog_estimate' ? null : new Date().toISOString(),
          caveat: source === 'catalog_estimate' ? 'Catalog estimates; verify seller price and availability before procurement.' : null,
          community_submissions: 0,
        }
      });
    } catch(e) {
      return resp({ error: 'Failed to load pricing data: ' + e.message }, 500);
    }
  }
};
