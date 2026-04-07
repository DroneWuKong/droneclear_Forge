// Netlify function — issue and manage demo Pro tokens
//
// Protected by WINGMAN_PROXY_SECRET (owner only).
// Uses Netlify Blobs to store a registry of issued demo tokens.
//
// Env vars needed:
//   WINGMAN_PROXY_SECRET  — your owner secret
//   PRO_TOKEN_SECRET      — same secret used by subscription-check
//
// Actions:
//   POST ?action=issue    — mint a demo token for an email
//   GET  ?action=list     — list all issued demo tokens
//   POST ?action=revoke   — revoke a demo token by email
//
// Usage (from your browser or curl):
//   POST /.netlify/functions/issue-demo?action=issue
//   Body: { "email": "contact@orqa.eu", "name": "Petar / Orqa", "days": 30, "note": "DDP eval" }
//
//   GET  /.netlify/functions/issue-demo?action=list
//   POST /.netlify/functions/issue-demo?action=revoke
//   Body: { "email": "contact@orqa.eu" }

import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Owner-Secret',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// HMAC-SHA256 token — same algorithm as subscription-check.mjs
async function signToken(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(JSON.stringify(payload)));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return btoa(JSON.stringify({ payload, sig: b64 }));
}

function authCheck(req, ownerSecret) {
  const header = req.headers.get('x-owner-secret') || '';
  const url    = new URL(req.url);
  const query  = url.searchParams.get('secret') || '';
  return ownerSecret && (header === ownerSecret || query === ownerSecret);
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const ownerSecret = process.env.WINGMAN_PROXY_SECRET;
  const tokenSecret = process.env.PRO_TOKEN_SECRET;

  if (!ownerSecret || !tokenSecret) {
    return json({ error: 'Server not configured — set WINGMAN_PROXY_SECRET and PRO_TOKEN_SECRET' }, 500);
  }

  if (!authCheck(req, ownerSecret)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const url    = new URL(req.url);
  const action = url.searchParams.get('action') || 'list';
  const store  = getStore('wingman-demo-tokens');

  // ── GET ?action=list — show all issued demo tokens ─────────────────────────
  if (req.method === 'GET' && action === 'list') {
    let registry = [];
    try {
      const raw = await store.get('registry');
      if (raw) registry = JSON.parse(raw);
    } catch { /* empty */ }

    // Annotate with expired status
    const now = Date.now();
    const annotated = registry.map(r => ({
      ...r,
      status: r.revoked ? 'revoked' : (r.exp < now ? 'expired' : 'active'),
      daysLeft: r.revoked ? 0 : Math.max(0, Math.ceil((r.exp - now) / 86400000)),
    }));

    return json({
      count:   annotated.length,
      active:  annotated.filter(r => r.status === 'active').length,
      entries: annotated,
    });
  }

  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  const body = await req.json().catch(() => ({}));

  // ── POST ?action=issue — mint a demo token ──────────────────────────────────
  if (action === 'issue') {
    const { email, name, days = 30, note = '', tier = 'commercial', scope = [] } = body;
    if (!email) return json({ error: 'email required' }, 400);

    // Resolve tier + scope
    // tier: 'commercial' | 'dfr' | 'defense' | 'full'
    // scope: [] means tier defaults; ['dfr','vault','wingman','pie','compliance'] means explicit
    const resolvedTier  = tier === 'full' ? 'full' : ['dfr','defense','commercial'].includes(tier) ? tier : 'commercial';
    const resolvedScope = resolvedTier === 'full'
      ? ['dfr', 'vault', 'wingman', 'pie', 'compliance', 'intel', 'command']
      : resolvedTier === 'defense'
      ? ['dfr', 'vault', 'wingman', 'pie', 'compliance', 'intel', 'command']
      : resolvedTier === 'dfr'
      ? ['dfr', 'wingman', 'pie', 'compliance', 'intel']
      : (scope.length ? scope : ['wingman', 'pie', 'compliance']); // commercial

    const exp   = Date.now() + days * 24 * 60 * 60 * 1000;
    const iat   = Date.now();

    const token = await signToken({
      email,
      name:       name || email,
      tier:       resolvedTier,
      scope:      resolvedScope,
      demo:       true,
      note,
      iat,
      exp,
    }, tokenSecret);

    // Load and update registry
    let registry = [];
    try {
      const raw = await store.get('registry');
      if (raw) registry = JSON.parse(raw);
    } catch { /* empty */ }

    // Replace if email already exists
    registry = registry.filter(r => r.email !== email);
    registry.push({
      email,
      name:    name || email,
      note,
      days,
      tier:    resolvedTier,
      scope:   resolvedScope,
      exp,
      iat,
      revoked: false,
      token,
    });

    await store.set('registry', JSON.stringify(registry));

    return json({
      ok:      true,
      email,
      name:    name || email,
      days,
      tier:    resolvedTier,
      scope:   resolvedScope,
      expires: new Date(exp).toISOString(),
      note,
      token,
      instructions: `Share this token with ${name || email}. They paste it under Wingman Settings → Subscription Token. Expires in ${days} days. Tier: ${resolvedTier}. Scope: ${resolvedScope.join(', ')}.`,
    });
  }

  // ── POST ?action=revoke — invalidate a demo token ───────────────────────────
  if (action === 'revoke') {
    const { email } = body;
    if (!email) return json({ error: 'email required' }, 400);

    let registry = [];
    try {
      const raw = await store.get('registry');
      if (raw) registry = JSON.parse(raw);
    } catch { /* empty */ }

    const entry = registry.find(r => r.email === email);
    if (!entry) return json({ error: `No demo token found for ${email}` }, 404);

    entry.revoked    = true;
    entry.revokedAt  = Date.now();
    // Set exp to now so verifyToken rejects it immediately
    entry.exp        = Date.now() - 1;

    await store.set('registry', JSON.stringify(registry));
    return json({ ok: true, revoked: email });
  }

  return json({ error: 'Unknown action. Use: issue, list, revoke' }, 400);
};

export const config = { path: '/.netlify/functions/issue-demo' };
