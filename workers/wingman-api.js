/**
 * wingman-api — CF Worker replacing /.netlify/functions/wingman-api
 * Route: /api/wingman
 * Public (anonymous) proxy to Anthropic. Hardened 2026-07-03 (audit F-C1):
 * per-IP rate limiting + origin-locked CORS + server-side model/token caps.
 * No in-repo caller references this route; if confirmed dead, delete this file
 * and its route in index.js. Owner path with a shared secret is claude-proxy.js.
 */

const ALLOWED_ORIGIN = 'https://uas-forge.com';

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
};

// Per-IP rate limit (in-memory, per-isolate — best-effort, mirrors groq/gemini proxies).
const rateLimiter = new Map();
const RATE_LIMIT = 30;
const RATE_WINDOW = 60_000;

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
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(ip)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }), {
        status: 429, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
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
