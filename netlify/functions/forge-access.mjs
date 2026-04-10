/**
 * Forge Access Code Admin
 * Issue access codes at any tier — Jeremiah's discretion, no Stripe needed.
 * Anyone who genuinely needs the data gets it.
 *
 * POST /.netlify/functions/forge-access
 * Headers: x-admin-key: <ANALYTICS_ADMIN_KEY>
 * Body: { action, ... }
 *
 * actions:
 *   issue   — create a new access code
 *   revoke  — revoke an existing code
 *   list    — list all codes
 *   issue_token — directly mint a JWT (skip code step, for trusted parties)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};
function resp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function signToken(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(JSON.stringify(payload)));
  return btoa(JSON.stringify({ payload, sig: btoa(String.fromCharCode(...new Uint8Array(sig))) }));
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map(b => chars[b % chars.length]).join('').replace(/(.{4})/g, '$1-').slice(0, -1);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return resp({ error: 'POST required' }, 405);

  const adminKey = process.env.ANALYTICS_ADMIN_KEY;
  const tokenSecret = process.env.PRO_TOKEN_SECRET;
  if (!adminKey || !tokenSecret) return resp({ error: 'Not configured' }, 503);

  const reqKey = req.headers.get('x-admin-key') || '';
  if (reqKey !== adminKey) return resp({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  const { getStore } = await import('@netlify/blobs');
  const store = getStore('forge-access-codes');

  // ── Issue an access code ───────────────────────────────────────────────────
  if (action === 'issue') {
    const {
      email = '',
      tier = 'commercial',
      note = '',
      duration_days = 365,
      reusable = false,
    } = body;

    if (!['commercial', 'dfr', 'agency'].includes(tier)) {
      return resp({ error: 'tier must be commercial, dfr, or agency' }, 400);
    }

    const code = genCode();
    const record = {
      code, email, tier, note, duration_days, reusable,
      used: false,
      created_at: new Date().toISOString(),
      exp: Date.now() + duration_days * 24 * 60 * 60 * 1000,
    };
    await store.setJSON(code, record);

    return resp({
      ok: true,
      code,
      tier,
      email,
      note,
      duration_days,
      reusable,
      usage_url: `https://forgeprole.netlify.app/pro/?access_code=${code}`,
      message: `Share this code. Anyone with it gets ${tier} access for ${duration_days} days, no payment needed.`,
    });
  }

  // ── Directly mint a JWT (for trusted parties, skip code step) ─────────────
  if (action === 'issue_token') {
    const {
      email = '',
      tier = 'commercial',
      note = '',
      duration_days = 365,
    } = body;

    const token = await signToken({
      email, tier, note,
      iat: Date.now(),
      exp: Date.now() + duration_days * 24 * 60 * 60 * 1000,
    }, tokenSecret);

    return resp({ ok: true, token, tier, email, note, duration_days });
  }

  // ── Revoke a code ──────────────────────────────────────────────────────────
  if (action === 'revoke') {
    const { code } = body;
    if (!code) return resp({ error: 'code required' }, 400);
    const existing = await store.get(code, { type: 'json' }).catch(() => null);
    if (!existing) return resp({ error: 'Code not found' }, 404);
    await store.setJSON(code, { ...existing, used: true, revoked: true, revoked_at: new Date().toISOString() });
    return resp({ ok: true, code, message: 'Code revoked.' });
  }

  // ── List all codes ─────────────────────────────────────────────────────────
  if (action === 'list') {
    const { keys } = await store.list();
    const records = await Promise.all(
      keys.map(async ({ name }) => {
        try { return await store.get(name, { type: 'json' }); } catch { return null; }
      })
    );
    return resp({
      codes: records.filter(Boolean).sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      ),
    });
  }

  return resp({ error: 'Unknown action. Use: issue, issue_token, revoke, list' }, 400);
};

export const config = { path: '/.netlify/functions/forge-access' };
