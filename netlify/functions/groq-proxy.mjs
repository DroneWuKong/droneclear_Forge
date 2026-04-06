// Netlify serverless function — proxies Wingman AI requests to Groq API
// API key stored as GROQ_API_KEY env var in Netlify dashboard
// Model: llama-3.3-70b-versatile (free tier: 14,400 req/day)

const rateLimiter = new Map();
const RATE_LIMIT = 20;  // requests per minute per IP
const RATE_WINDOW = 60 * 1000;

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

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'GROQ_API_KEY not configured on server' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }),
      { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json();

    // Enforce sane limits
    if (body.max_tokens) body.max_tokens = Math.min(body.max_tokens, 8192);

    // Groq uses OpenAI-compatible chat completions format
    const groqBody = {
      model:       body.model || 'llama-3.3-70b-versatile',
      messages:    body.messages || [],
      max_tokens:  body.max_tokens || 4096,
      temperature: body.temperature ?? 0.7,
      stream:      false,
    };

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(groqBody),
    });

    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
};

export const config = {
  path: '/.netlify/functions/groq-proxy',
};
