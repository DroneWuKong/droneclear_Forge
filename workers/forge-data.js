/**
 * forge-data — CF Worker replacing /.netlify/functions/forge-data
 * Route: /api/data?type=<dataset>
 *
 * GET  — serve dataset from KV (PIE_DB / PIE_OUTPUTS) → fallback to static asset
 * POST — admin write path (FORGE_BLOBS_ADMIN_KEY auth)
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

const DATASETS = new Set([
  'forge_database','drone_database','topic_component_map','forge_firmware_versions',
  'forge_troubleshooting','forge_incompatibilities','miner_health','miner_registry',
  'intel_articles','intel_companies','intel_platforms','intel_programs',
  'pie_flags','pie_brief','pie_brief_history','pie_predictions','pie_trends',
  'pie_weekly','predictions_best','predictions_archive','llm_predictions',
  'gap_analysis_latest','entity_graph','forge_intel','commercial_master',
  'solicitations','federal_awards','sam_watchlist','dfr_master','defense_master',
  // Patterns Hub lens artefacts
  'flags','predictions','adversary_bom','component_mirroring_index',
  'sanctions_evasion_graph','actor_fingerprints','ttp_counter_gap','threat_scores',
]);

// KV namespace → dataset list mapping
// PIE_OUTPUTS: pipeline outputs (briefs, flags, intel, predictions)
// PIE_DB: parts/forge database
const PIE_OUTPUTS_KEYS = new Set([
  'pie_flags','pie_brief','pie_brief_history','pie_predictions','pie_trends',
  'pie_weekly','predictions_best','predictions_archive','llm_predictions',
  'gap_analysis_latest','entity_graph','forge_intel','intel_articles',
  'intel_companies','intel_platforms','intel_programs','miner_health','miner_registry',
  'solicitations','federal_awards','sam_watchlist',
  // Patterns Hub lens artefacts (all in PIE_OUTPUTS)
  'flags','predictions','adversary_bom','component_mirroring_index',
  'sanctions_evasion_graph','actor_fingerprints','ttp_counter_gap','threat_scores',
]);

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    const type = url.searchParams.get('type') || '';

    // ── POST: admin write ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      const adminKey = env.FORGE_BLOBS_ADMIN_KEY;
      const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!adminKey) return resp({ error: 'FORGE_BLOBS_ADMIN_KEY not configured' }, 503);
      if (provided !== adminKey) return resp({ error: 'Invalid admin key' }, 401);
      if (!type || !DATASETS.has(type)) return resp({ error: `Unknown dataset: ${type}` }, 404);

      try {
        const body = await req.text();
        if (!body || body.length < 2) return resp({ error: 'Empty body' }, 400);
        try { JSON.parse(body); } catch(e) { return resp({ error: 'Invalid JSON: ' + e.message }, 400); }

        const kv = PIE_OUTPUTS_KEYS.has(type) ? env.PIE_OUTPUTS : env.PIE_DB;
        await kv.put(type, body);
        return resp({ ok: true, type, size: body.length, message: `${type} written to KV (${body.length} bytes)` });
      } catch(e) {
        return resp({ error: 'KV write failed: ' + e.message }, 500);
      }
    }

    // ── GET ────────────────────────────────────────────────────────────────
    if (!type) return resp({ error: 'type parameter required', available: Array.from(DATASETS) }, 400);
    if (!DATASETS.has(type)) return resp({ error: `Unknown dataset: ${type}` }, 404);

    try {
      const kv = PIE_OUTPUTS_KEYS.has(type) ? env.PIE_OUTPUTS : env.PIE_DB;
      const raw = await kv.get(type);
      if (raw) {
        const data = JSON.parse(raw);
        return resp({ data, tier: 'free', type });
      }
    } catch(e) {
      console.error(`[forge-data] KV error for ${type}:`, e.message);
    }

    // ── Static asset fallback ──────────────────────────────────────────────
    // KV miss: try fetching from the static file bundled with the Pages deployment.
    // Covers miner_health, miner_registry, and any dataset that didn't make it
    // into KV on the last pipeline run.
    try {
      const staticUrl = new URL(req.url);
      staticUrl.pathname = `/static/${type}.json`;
      const staticResp = await env.ASSETS.fetch(new Request(staticUrl.toString()));
      if (staticResp.ok) {
        const raw = await staticResp.text();
        const data = JSON.parse(raw);
        return resp({ data, tier: 'free', type, source: 'static' });
      }
    } catch(e) {
      // ASSETS binding may not be present in local dev — ignore
    }

    return resp({ error: `Dataset ${type} not available` }, 404);
  }
};
