// Netlify serverless function — proxies Wingman AI requests to Anthropic Claude API
// API key stored as ANTHROPIC_API_KEY env var in Netlify dashboard
// Access controlled by WINGMAN_PROXY_SECRET — only you can use this
// Rate limit: 30 requests per minute per IP (tighter than public proxies)

const rateLimiter = new Map();
const RATE_LIMIT  = 30;
const RATE_WINDOW = 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
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

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Auth check — owner-only via proxy secret ──
  const proxySecret = process.env.WINGMAN_PROXY_SECRET;
  const clientSecret = req.headers.get('x-proxy-secret') || '';

  if (!proxySecret || clientSecret !== proxySecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── API key ───────────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Rate limit ────────────────────────────────────────────────────────────
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }), {
      status: 429, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();

    // Enforce sane limits server-side
    const safeBody = {
      model:      body.model      || 'claude-sonnet-4-5',
      max_tokens: Math.min(body.max_tokens || 4096, 8192),
      system:     body.system     || '',
      messages:   body.messages   || [],
    };

    // Pass through tools if provided (web search)
    if (body.tools) safeBody.tools = body.tools;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(safeBody),
    });

    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
};

export const config = {
  path: '/.netlify/functions/claude-proxy',
};
