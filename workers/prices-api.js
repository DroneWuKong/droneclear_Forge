/**
 * prices-api — CF Worker replacing /.netlify/functions/prices-api
 * Route: /api/prices
 *
 * GET  — serve pricing data from PARTS_DB KV
 * POST — community price submission (PRICES_API_KEY auth), stored in PARTS_DB KV
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);

    // ── POST: community price submission ──────────────────────────────────
    if (req.method === 'POST') {
      const apiKey = env.PRICES_API_KEY;
      const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!apiKey || provided !== apiKey) return resp({ error: 'Unauthorized' }, 401);

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
      const raw = await env.PARTS_DB.get('prices');
      const components = raw ? JSON.parse(raw) : [];

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
          generated: new Date().toISOString(),
          community_submissions: 0,
        }
      });
    } catch(e) {
      return resp({ error: 'Failed to load pricing data: ' + e.message }, 500);
    }
  }
};
