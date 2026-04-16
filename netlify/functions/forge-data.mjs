/**
 * Forge Data API
 * GET /.netlify/functions/forge-data?type=<dataset>
 *
 * Paywall removed — every dataset is free. The function now exists purely
 * as a pass-through to Netlify Blobs (fresh pipeline output) with fallback
 * to the committed build files. No tier logic, no JWT verification on GET.
 *
 * The access_code path is kept as a no-op for backwards compatibility with
 * old URLs/bookmarks — it still mints a token so clients that cached one
 * keep working, but the token is never required.
 *
 * POST path (admin Blobs write) is unchanged — that's infra, not paywall.
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

// Dataset registry — flat list, no tiers
const DATASETS = new Set([
  'forge_database','drone_database','topic_component_map','forge_firmware_versions',
  'forge_troubleshooting','forge_incompatibilities','miner_health','miner_registry',
  'intel_articles','intel_companies','intel_platforms','intel_programs',
  'pie_flags','pie_brief','pie_brief_history','pie_predictions','pie_trends',
  'pie_weekly','predictions_best','predictions_archive','llm_predictions',
  'gap_analysis_latest','entity_graph','forge_intel','commercial_master',
  'solicitations','federal_awards','sam_watchlist','dfr_master','defense_master',
]);

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

  const url = new URL(req.url);

  // ── POST: admin Blobs write path (unchanged) ─────────────────────────────
  if (req.method === 'POST' && url.searchParams.get('type')) {
    const adminKey = process.env.FORGE_BLOBS_ADMIN_KEY;
    const authHeader = req.headers.get('authorization') || '';
    const providedKey = authHeader.replace(/^Bearer\s+/i, '');
    if (!adminKey) return resp({ error: 'FORGE_BLOBS_ADMIN_KEY not configured' }, 503);
    if (providedKey !== adminKey) return resp({ error: 'Invalid admin key' }, 401);

    const writeType = url.searchParams.get('type');
    if (!DATASETS.has(writeType)) return resp({ error: `Unknown dataset: ${writeType}` }, 404);

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
  const accessCode = url.searchParams.get('access_code') || '';

  // ── Access code path (no-op compat) ──────────────────────────────────────
  // Used to gate access — now just mints a token so any client that still
  // expects one keeps working. Anyone with any code gets data.
  if (accessCode) {
    const tokenSecret = process.env.PRO_TOKEN_SECRET;
    let token = null;
    if (tokenSecret) {
      try {
        token = await signToken({
          email: 'access-code',
          tier: 'agency',
          access_code: accessCode,
          iat: Date.now(),
          exp: Date.now() + 365 * 24 * 60 * 60 * 1000,
        }, tokenSecret);
      } catch {}
    }
    if (type && DATASETS.has(type)) {
      try {
        const data = await loadDataset(type);
        return resp({ token, tier: 'agency', data });
      } catch (e) {
        return resp({ error: 'Failed to load dataset: ' + e.message }, 500);
      }
    }
    return resp({ token, tier: 'agency', message: 'Access code accepted (all data is free now).' });
  }

  // ── Normal GET: serve the requested dataset, no auth required ────────────
  if (!type) return resp({ error: 'type parameter required', available: Array.from(DATASETS) }, 400);
  if (!DATASETS.has(type)) return resp({ error: `Unknown dataset: ${type}` }, 404);

  try {
    const data = await loadDataset(type);
    return resp({ data, tier: 'free', type });
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
  federal_awards:      'federal_awards.json',
  sam_watchlist:       'sam_watchlist.json',
  miner_health:        'miner_health.json',
  miner_registry:      'miner_registry.json',
};

// Load dataset — Blobs first (fresh pipeline output), then committed build file, then static slice
async function loadDataset(type) {
  // 1. Try Netlify Blobs (populated by sync workflow when available)
  try {
    const { getStore } = await import('@netlify/blobs');
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

  // 2. Fall back to committed files in build (always present after build)
  const filename = DATASET_FILES[type];
  const origin = process.env.URL || 'https://uas-forge.com';
  if (filename) {
    try {
      // Try root first — full data (270 flags, full predictions, full brief)
      const res = await fetch(`${origin}/${filename}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) ? data.length > 0 : (data && typeof data === 'object'))
          return data;
      }
    } catch {}
    try {
      // Try /static/ — may be truncated slice but better than nothing
      const res = await fetch(`${origin}/static/${filename}`);
      if (res.ok) return await res.json();
    } catch {}
  }

  // 3. Last resort: static slice by type name
  try {
    const res = await fetch(`${origin}/static/${type}.json`);
    if (res.ok) return await res.json();
  } catch {}

  throw new Error(`Dataset ${type} not available`);
}

export const config = { path: '/.netlify/functions/forge-data' };
