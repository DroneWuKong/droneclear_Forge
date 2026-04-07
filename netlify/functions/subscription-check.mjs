// Netlify function — validates a Stripe subscription and issues a session token
// Flow:
//   1. User pays via Stripe Payment Link → lands on /pro/ with ?session_id=
//   2. Frontend calls this function with session_id
//   3. Function verifies with Stripe, returns a signed token
//   4. Token stored in localStorage, checked by claude-proxy before serving Claude
//
// Env vars needed in Netlify:
//   STRIPE_SECRET_KEY        — sk_live_... or sk_test_...
//   STRIPE_WEBHOOK_SECRET    — whsec_... (for webhook endpoint)
//   PRO_TOKEN_SECRET         — any random string, used to sign session tokens
//   STRIPE_PRO_PRICE_ID      — price_... (your Pro product price ID)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Simple HMAC-SHA256 token using Web Crypto (available in Netlify edge)
async function signToken(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(JSON.stringify(payload)));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return btoa(JSON.stringify({ payload, sig: b64 }));
}

async function verifyToken(token, secret) {
  try {
    const { payload, sig } = JSON.parse(atob(token));
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(JSON.stringify(payload)));
    if (!valid) return null;
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const stripeKey   = process.env.STRIPE_SECRET_KEY;
  const tokenSecret = process.env.PRO_TOKEN_SECRET;
  const proPriceId  = process.env.STRIPE_PRO_PRICE_ID;
  const dfrPriceId  = process.env.STRIPE_DFR_PRICE_ID;

  if (!stripeKey || !tokenSecret) {
    return json({ error: 'Subscription service not configured' }, 500);
  }

  const url    = new URL(req.url);
  const action = url.searchParams.get('action') || 'verify';

  // ── GET /subscription-check?action=verify&token=... ───────────────────────
  // Verifies a stored token is still valid (called on page load)
  if (req.method === 'GET' && action === 'verify') {
    const token = url.searchParams.get('token');
    if (!token) return json({ valid: false });
    const payload = await verifyToken(token, tokenSecret);
    if (!payload) return json({ valid: false });

    // For demo tokens, check revocation registry in Blobs
    if (payload.demo) {
      try {
        const { getStore } = await import('@netlify/blobs');
        const store = getStore('wingman-demo-tokens');
        const raw = await store.get('registry');
        if (raw) {
          const registry = JSON.parse(raw);
          const entry = registry.find(r => r.email === payload.email);
          if (entry && entry.revoked) return json({ valid: false, reason: 'revoked' });
        }
      } catch { /* blob unavailable, fall through */ }
    }

    // Backwards compat: old tokens with tier:'pro' map to 'dfr'
    const tier = payload.tier === 'pro' ? 'dfr' : (payload.tier || 'commercial');

    return json({
      valid: true,
      tier,
      demo:  payload.demo || false,
      email: payload.email,
      exp:   payload.exp,
      scope: payload.scope || [],
    });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await req.json().catch(() => ({}));

  // ── POST action=activate — exchange Stripe session_id for a token ─────────
  if (action === 'activate') {
    const { session_id } = body;
    if (!session_id) return json({ error: 'session_id required' }, 400);

    // Fetch session from Stripe
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${session_id}?expand[]=subscription`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    const session = await stripeRes.json();

    if (session.error) return json({ error: 'Invalid session' }, 400);
    if (session.payment_status !== 'paid') return json({ error: 'Payment not completed' }, 402);

    const sub = session.subscription;
    const isActive = sub?.status === 'active' || sub?.status === 'trialing';
    if (!isActive) return json({ error: 'Subscription not active' }, 402);

    // Determine tier from price ID
    const priceId = sub?.items?.data?.[0]?.price?.id || '';
    const tier = priceId === proPriceId ? 'dfr'
               : priceId === dfrPriceId ? 'commercial'
               : 'agency';

    // Issue 30-day token
    const token = await signToken({
      email:      session.customer_email || '',
      customerId: session.customer,
      subId:      sub.id,
      tier,
      iat: Date.now(),
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    }, tokenSecret);

    return json({ token, tier, email: session.customer_email });
  }

  // ── POST action=portal — create Stripe customer portal session ────────────
  if (action === 'portal') {
    const { customer_id } = body;
    if (!customer_id) return json({ error: 'customer_id required' }, 400);

    const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer:   customer_id,
        return_url: 'https://nvmillbuilditmyself.com/pro/',
      }),
    });
    const portal = await portalRes.json();
    if (portal.error) return json({ error: portal.error.message }, 400);
    return json({ url: portal.url });
  }

  return json({ error: 'Unknown action' }, 400);
};

export const config = { path: '/.netlify/functions/subscription-check' };
