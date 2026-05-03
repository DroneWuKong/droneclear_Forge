/**
 * wingman-api — CF Worker replacing /.netlify/functions/wingman-api
 * Route: /api/wingman
 * Public proxy to Anthropic — no auth required (model/tokens enforced server-side).
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await req.json();
      body.model = body.model || 'claude-sonnet-4-20250514';
      body.max_tokens = Math.min(body.max_tokens || 1000, 4096);

      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const data = await upstream.text();
      return new Response(data, {
        status: upstream.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }
};
