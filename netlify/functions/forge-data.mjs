/**
 * Forge Gated Data API
 * GET /.netlify/functions/forge-data?type=<dataset>&token=<jwt>
 * GET /.netlify/functions/forge-data?type=<dataset>&access_code=<code>
 *
 * Tiers (need-to-know, not paywall):
 *   free       — parts DB, platform DB, firmware, troubleshooting (no token)
 *   commercial — + intel, flags, predictions, trends, supply chain, entity graph ($39)
 *   dfr        — + solicitations, dfr_master, grants, CAD matrix, federal awards ($49)
 *   agency     — + defense_master, grayzone, allied profiles (contact/vetted)
 *
 * Override: access_code mints a JWT at any tier — Jeremiah's discretion,
 *   no Stripe required. Anyone who genuinely needs it gets it.
 *
 * Never served at any tier: forge_orqa_configs, build-specs/orqa_*,
 *   terminal guidance, RC injection, behavior trees.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const TIER_RANK = { free: 0, commercial: 1, dfr: 2, agency: 3 };
function tierAtLeast(user, required) {
  return (TIER_RANK[user] ?? -1) >= (TIER_RANK[required] ?? 999);
}

// Dataset registry — file paths are relative to /static/ in the built site
const DATASETS = {
  // FREE — no token needed
  forge_database:          { tier: 'free' },
  drone_database:          { tier: 'free' },
  topic_component_map:     { tier: 'free' },
  forge_firmware_versions: { tier: 'free' },
  forge_troubleshooting:   { tier: 'free' },
  forge_incompatibilities: { tier: 'free' },
  miner_health:            { tier: 'free' },
  miner_registry:          { tier: 'free' },

  // COMMERCIAL ($39 or access code)
  intel_articles:          { tier: 'commercial' },
  intel_companies:         { tier: 'commercial' },
  intel_platforms:         { tier: 'commercial' },
  intel_programs:          { tier: 'commercial' },
  pie_flags:               { tier: 'commercial' },
  pie_brief:               { tier: 'commercial' },
  pie_brief_history:       { tier: 'commercial' },
  pie_predictions:         { tier: 'commercial' },
  pie_trends:              { tier: 'commercial' },
  pie_weekly:              { tier: 'commercial' },
  predictions_best:        { tier: 'commercial' },
  predictions_archive:     { tier: 'commercial' },
  llm_predictions:         { tier: 'commercial' },
  gap_analysis_latest:     { tier: 'commercial' },
  entity_graph:            { tier: 'commercial' },
  forge_intel:             { tier: 'commercial' },
  commercial_master:       { tier: 'commercial' },
  solicitations:           { tier: 'commercial' }, // free preview, full at dfr

  // DFR ($49 or access code)
  dfr_master:              { tier: 'dfr' },

  // AGENCY (contact/vetted or access code)
  defense_master:          { tier: 'agency' },
};

// Free-tier: serve the public-safe static slice that's already in the build
// These are truncated versions committed by the sync workflow — same data, less of it
async function freeSummary(type) {
  // Free-tier slices are committed into static/ and built into /static/*.json
  // They are truncated versions of the full data — same structure, less content
  const PUBLIC_SLICES = ['pie_flags','pie_brief','pie_predictions','pie_trends',
                         'pie_brief_history','pie_flags_summary','entity_graph',
                         'gap_analysis_latest','miner_health','miner_registry',
                         'topic_component_map'];
  if (!PUBLIC_SLICES.includes(type)) {
    return { summary_only: true, message: `${type} requires Commercial access or an access code.`, upgrade_url: '/pro/' };
  }
  try {
    // The function runs on forgeprole — fetch from same site's static files
    const origin = 'https://forgeprole.netlify.app';
    const res = await fetch(`${origin}/static/${type}.json`);
    if (res.ok) {
      const data = await res.json();
      return { data, _free_tier: true };
    }
  } catch (e) {}
  return { summary_only: true, message: `${type} not available. Try again shortly.`, upgrade_url: '/pro/' };
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

async function signToken(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(JSON.stringify(payload)));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return btoa(JSON.stringify({ payload, sig: b64 }));
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const tokenSecret = process.env.PRO_TOKEN_SECRET;
  if (!tokenSecret) return resp({ error: 'Service not configured' }, 503);

  const url = new URL(req.url);

  // ── POST: admin Blobs write path ──────────────────────────────────────────
  // Allows uploading fresh dataset content to the forge-datasets Blobs store
  // without needing a valid NETLIFY_API_TOKEN (the @netlify/blobs SDK auto-
  // authenticates from the function's deploy context). Gated by a one-off
  // admin key stored as FORGE_BLOBS_ADMIN_KEY in Netlify env vars.
  //
  // Usage:
  //   POST /.netlify/functions/forge-data?type=pie_brief
  //   Authorization: Bearer <FORGE_BLOBS_ADMIN_KEY>
  //   Content-Type: application/json
  //   <full dataset JSON>
  if (req.method === 'POST' && url.searchParams.get('type')) {
    const adminKey = process.env.FORGE_BLOBS_ADMIN_KEY;
    const authHeader = req.headers.get('authorization') || '';
    const providedKey = authHeader.replace(/^Bearer\s+/i, '');
    if (!adminKey) return resp({ error: 'FORGE_BLOBS_ADMIN_KEY not configured' }, 503);
    if (providedKey !== adminKey) return resp({ error: 'Invalid admin key' }, 401);

    const writeType = url.searchParams.get('type');
    if (!DATASETS[writeType]) return resp({ error: `Unknown dataset: ${writeType}` }, 404);

    try {
      const body = await req.text();
      if (!body || body.length < 2) return resp({ error: 'Empty body' }, 400);
      let parsed;
      try { parsed = JSON.parse(body); }
      catch(e) { return resp({ error: 'Invalid JSON in body: ' + e.message }, 400); }

      const { getStore } = await import('@netlify/blobs');
      const store = getStore('forge-datasets');
      await store.setJSON(writeType, parsed);

      const size = body.length;
      return resp({
        ok: true,
        type: writeType,
        size,
        message: `${writeType} written to Blobs (${size} bytes)`,
      });
    } catch (e) {
      return resp({ error: 'Blobs write failed: ' + e.message }, 500);
    }
  }

  const type = url.searchParams.get('type') || '';
  const rawToken = url.searchParams.get('token') || req.headers.get('authorization')?.replace('Bearer ', '') || '';
  const accessCode = url.searchParams.get('access_code') || '';

  // ── Access code path — mint a JWT, no Stripe needed ──────────────────────
  if (accessCode) {
    try {
      const { getStore } = await import('@netlify/blobs');
      const store = getStore('forge-access-codes');
      const raw = await store.get(accessCode, { type: 'json' }).catch(() => null);

      if (!raw) return resp({ error: 'Invalid or expired access code' }, 403);
      if (raw.used && !raw.reusable) return resp({ error: 'Access code already used' }, 403);
      if (raw.exp && Date.now() > raw.exp) return resp({ error: 'Access code expired' }, 403);

      // Mark used (unless reusable)
      if (!raw.reusable) {
        await store.setJSON(accessCode, { ...raw, used: true, used_at: new Date().toISOString() });
      }

      const tier = raw.tier || 'commercial';
      const token = await signToken({
        email: raw.email || 'access-code',
        tier,
        access_code: accessCode,
        note: raw.note || '',
        iat: Date.now(),
        exp: Date.now() + (raw.duration_days || 365) * 24 * 60 * 60 * 1000,
      }, tokenSecret);

      // If they also want data, serve it now
      if (type && DATASETS[type]) {
        const dataset = DATASETS[type];
        if (!tierAtLeast(tier, dataset.tier)) {
          return resp({ error: `Access code tier (${tier}) cannot access ${type}`, token }, 403);
        }
        const data = await loadDataset(type);
        return resp({ token, tier, data });
      }

      return resp({ token, tier, message: `Access code accepted. Token valid for ${raw.duration_days || 365} days.` });
    } catch (e) {
      return resp({ error: 'Access code check failed: ' + e.message }, 500);
    }
  }

  // ── Determine user tier from token ────────────────────────────────────────
  let userTier = 'free';
  let tokenPayload = null;

  if (rawToken) {
    tokenPayload = await verifyToken(rawToken, tokenSecret);
    if (!tokenPayload) return resp({ error: 'Invalid or expired token', hint: 'Re-authenticate at /pro/' }, 401);
    // Normalise old 'pro' → 'dfr' for backwards compat
    userTier = tokenPayload.tier === 'pro' ? 'dfr' : (tokenPayload.tier || 'commercial');
  }

  // ── Verify dataset access ──────────────────────────────────────────────────
  if (!type) return resp({ error: 'type parameter required', available: Object.keys(DATASETS) }, 400);

  const dataset = DATASETS[type];
  if (!dataset) return resp({ error: `Unknown dataset: ${type}` }, 404);

  if (!tierAtLeast(userTier, dataset.tier)) {
    if (userTier === 'free') {
      const summary = await freeSummary(type);
      return resp({ ...summary, required_tier: dataset.tier, upgrade_url: '/pro/' });
    }
    return resp({
      error: `Your tier (${userTier}) cannot access ${type}. Required: ${dataset.tier}`,
      upgrade_url: '/pro/',
    }, 403);
  }

  // ── Load and serve dataset ─────────────────────────────────────────────────
  try {
    const data = await loadDataset(type);
    return resp({ data, tier: userTier, type });
  } catch (e) {
    return resp({ error: 'Failed to load dataset: ' + e.message }, 500);
  }
};

// Dataset filename map — full files committed into build root
const DATASET_FILES = {
  pie_flags:           'pie_flags.json',
  pie_brief:           'pie_brief.json',
  pie_predictions:     'pie_predictions.json',
  pie_trends:          'pie_trends.json',
  pie_weekly:          'pie_weekly.json',
  pie_brief_history:   'pie_brief_history.json',
  predictions_best:    'predictions_best.json',
  predictions_archive: 'predictions_archive.json',
  llm_predictions:     'llm_predictions.json',
  gap_analysis_latest: 'gap_analysis_latest.json',
  entity_graph:        'entity_graph.json',
  forge_intel:         'forge_intel.json',
  intel_articles:      'intel_articles.json',
  intel_companies:     'intel_companies.json',
  intel_platforms:     'intel_platforms.json',
  intel_programs:      'intel_programs.json',
  solicitations:       'solicitations.json',
  miner_health:        'miner_health.json',
  miner_registry:      'miner_registry.json',
};

// Load dataset — Blobs first (fresh pipeline output), then committed build file, then static slice
async function loadDataset(type) {
  // 1. Try Netlify Blobs (populated by sync workflow when available)
  try {
    const { getStore } = await import('@netlify/blobs');
    // Use explicit siteID+token when available for cross-context reliability
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN;
    const storeOpts = (siteID && token)
      ? { name: 'forge-datasets', siteID, token }
      : 'forge-datasets';
    const store = getStore(storeOpts);
    const data = await store.get(type, { type: 'json' });
    if (data) { console.log(`[forge-data] Blobs hit: ${type} (${Array.isArray(data)?data.length:'obj'} items)`); return data; }
    console.log(`[forge-data] Blobs miss: ${type}`);
  } catch (e) { console.error(`[forge-data] Blobs error for ${type}:`, e.message); }

  // 2. Fall back to full committed file in build root (always present)
  const filename = DATASET_FILES[type];
  if (filename) {
    try {
      const res = await fetch(`https://forgeprole.netlify.app/${filename}`);
      if (res.ok) return await res.json();
    } catch {}
    try {
      // Also try nvmillfindoutmyself.com domain
      const res = await fetch(`https://nvmillfindoutmyself.com/${filename}`);
      if (res.ok) return await res.json();
    } catch {}
  }

  // 3. Last resort: static slice (free-tier truncated version)
  try {
    const res = await fetch(`https://forgeprole.netlify.app/static/${type}.json`);
    if (res.ok) return await res.json();
  } catch {}

  throw new Error(`Dataset ${type} not available`);
}

export const config = { path: '/.netlify/functions/forge-data' };
