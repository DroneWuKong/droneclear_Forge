/**
 * groq-proxy — CF Worker replacing /.netlify/functions/groq-proxy
 * Route: /api/wingman/groq
 */

const rateLimiter = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: CORS });
    }

    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GROQ_API_KEY not configured' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(ip)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }), {
        status: 429, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await req.json();
      body.model = body.model || 'llama-3.3-70b-versatile';
      body.max_tokens = Math.min(body.max_tokens || 1000, 4096);

      const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
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
