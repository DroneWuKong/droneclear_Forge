/**
 * claude-proxy — CF Worker replacing /.netlify/functions/claude-proxy
 * Route: /api/wingman/claude
 * Owner-only via WINGMAN_PROXY_SECRET header.
 */

const rateLimiter = new Map();
const RATE_LIMIT = 30;
const RATE_WINDOW = 60_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret',
};

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function resp(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return resp({ error: 'POST required' }, 405);

    const proxySecret = env.WINGMAN_PROXY_SECRET;
    const clientSecret = req.headers.get('x-proxy-secret') || '';
    if (!proxySecret || clientSecret !== proxySecret) return resp({ error: 'Unauthorized' }, 401);

    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(ip)) return resp({ error: 'Rate limit exceeded. Try again in a minute.' }, 429);

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return resp({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

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
      return resp({ error: 'Upstream error: ' + e.message }, 502);
    }
  }
};
