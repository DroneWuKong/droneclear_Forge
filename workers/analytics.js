/**
 * analytics — CF Worker replacing /.netlify/functions/analytics
 * Route: /api/analytics
 * Admin key protected. Returns daily/monthly aggregates from KV.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const adminKey = env.ANALYTICS_ADMIN_KEY;
    const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (adminKey && provided !== adminKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    }

    try {
      const url = new URL(req.url);
      const days = parseInt(url.searchParams.get('days') || '7');
      const results = [];

      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const raw = await env.PIE_OUTPUTS.get(`analytics_daily_${dateStr}`);
        if (raw) results.push(JSON.parse(raw));
        else results.push({ date: dateStr, events: 0, pages: {} });
      }

      return new Response(JSON.stringify({ days: results.reverse() }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }
};
