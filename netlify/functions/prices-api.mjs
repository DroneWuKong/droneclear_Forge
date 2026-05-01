/**
 * Prices API — Bidirectional component pricing
 *
 * GET  /.netlify/functions/prices-api
 *      ?component=<pid|name>   filter to one component
 *      ?category=<category>    filter by category
 *      ?all=1                  return all components (no filter)
 *
 *      Returns: { components: [...], meta: { total, generated, community_submissions } }
 *      Each component includes: pid, name, category, manufacturer, price_usd,
 *        approx_price, confidence, source, availability, last_updated, link
 *
 * POST /.netlify/functions/prices-api
 *      Headers: Authorization: Bearer <PRICES_API_KEY>
 *      Body: {
 *        pid?:          string   // match existing component by pid
 *        name:          string   // component name (required if no pid)
 *        category?:     string   // component category
 *        manufacturer?: string
 *        price_usd:     number   // current spot price in USD
 *        availability:  "in_stock"|"limited"|"unavailable"|"lead_time_weeks"
 *        lead_time_weeks?: number
 *        source_url?:   string   // distributor/quote URL
 *        note?:         string
 *      }
 *      Returns: { ok: true, submission_id, message }
 *
 *      Submissions land in Blobs as community_prices (append-only log).
 *      PIE pipeline folds them into confidence scoring on next run.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function resp(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function authError() {
  return resp({ error: 'Invalid or missing API key' }, 401);
}

// ── Confidence scoring ────────────────────────────────────────────────────
// static = scraped at build time from manufacturer/distributor
// community = user-submitted (this API)
// usaspending = validated against federal contract award
function scoreConfidence(component, communitySubmissions) {
  const subs = communitySubmissions.filter(s =>
    s.pid === component.pid || s.name?.toLowerCase() === component.name?.toLowerCase()
  );
  if (subs.length === 0) return { confidence: 0.55, source: 'static' };
  if (subs.length >= 3) return { confidence: 0.82, source: 'community_validated' };
  return { confidence: 0.65 + subs.length * 0.05, source: 'community' };
}

// ── Flatten all components from forge_database ────────────────────────────
function flattenComponents(db) {
  const cats = db?.components || {};
  const out = [];
  for (const [cat, items] of Object.entries(cats)) {
    if (!Array.isArray(items)) continue;
    for (const c of items) {
      out.push({
        pid:          c.pid || null,
        name:         c.name || '',
        category:     c.category || cat,
        manufacturer: c.manufacturer || null,
        price_usd:    c.price_usd ?? c.approx_price ?? null,
        approx_price: c.approx_price || null,
        link:         c.link || (c.links && c.links[0]?.url) || null,
        manufacturer_country: c.manufacturer_country || c.country || null,
        ndaa_compliant: c.ndaa_compliant ?? null,
      });
    }
  }
  return out;
}

// ── Merge latest community submission per component ───────────────────────
function mergeSubmissions(components, submissions) {
  // Build map: pid/name → most recent submission
  const latest = {};
  for (const s of submissions) {
    const key = s.pid || s.name?.toLowerCase();
    if (!key) continue;
    if (!latest[key] || s.submitted_at > latest[key].submitted_at) {
      latest[key] = s;
    }
  }

  return components.map(c => {
    const key = c.pid || c.name?.toLowerCase();
    const sub = latest[key];
    if (!sub) return c;
    return {
      ...c,
      price_usd:        sub.price_usd ?? c.price_usd,
      availability:     sub.availability ?? null,
      lead_time_weeks:  sub.lead_time_weeks ?? null,
      community_price:  sub.price_usd,
      community_source: sub.source_url || null,
      last_community_update: sub.submitted_at,
    };
  });
}

// ── Handler ───────────────────────────────────────────────────────────────
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { getStore } = await import('@netlify/blobs');
  const url = new URL(req.url);

  // ── POST: price submission ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const apiKey = process.env.PRICES_API_KEY;
    if (!apiKey) return resp({ error: 'PRICES_API_KEY not configured on server' }, 503);

    const authHeader = req.headers.get('authorization') || '';
    const provided = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (provided !== apiKey) return authError();

    let body;
    try { body = await req.json(); }
    catch { return resp({ error: 'Invalid JSON body' }, 400); }

    const { name, price_usd, availability } = body;
    if (!name) return resp({ error: '`name` is required' }, 400);
    if (price_usd == null || typeof price_usd !== 'number')
      return resp({ error: '`price_usd` must be a number' }, 400);

    const VALID_AVAILABILITY = ['in_stock','limited','unavailable','lead_time_weeks'];
    if (availability && !VALID_AVAILABILITY.includes(availability))
      return resp({ error: `availability must be one of: ${VALID_AVAILABILITY.join(', ')}` }, 400);

    const submission = {
      submission_id: `cs-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      submitted_at:  new Date().toISOString(),
      pid:           body.pid || null,
      name:          body.name,
      category:      body.category || null,
      manufacturer:  body.manufacturer || null,
      price_usd:     body.price_usd,
      availability:  body.availability || null,
      lead_time_weeks: body.lead_time_weeks || null,
      source_url:    body.source_url || null,
      note:          body.note || null,
    };

    // Append to community_prices log in Blobs
    const store = getStore('forge-datasets');
    let existing = [];
    try {
      const raw = await store.get('community_prices', { type: 'json' });
      if (Array.isArray(raw)) existing = raw;
    } catch { /* first submission */ }

    existing.push(submission);
    await store.setJSON('community_prices', existing);

    return resp({
      ok: true,
      submission_id: submission.submission_id,
      message: `Price submission for "${name}" received. Will be folded into PIE pipeline on next run.`,
    });
  }

  // ── GET: return component pricing ──────────────────────────────────────
  if (req.method !== 'GET')
    return resp({ error: 'Method not allowed' }, 405);

  // Load forge_database from Blobs (fresh) with fallback
  let db;
  try {
    const store = getStore('forge-datasets');
    db = await store.get('forge_database', { type: 'json' });
  } catch {
    // Blobs miss — fall back to build-time file
    try {
      const fs = await import('fs');
      const path = await import('path');
      const raw = fs.readFileSync(
        path.join(process.cwd(), 'DroneClear Components Visualizer', 'forge_database.json'),
        'utf8'
      );
      db = JSON.parse(raw);
    } catch {
      return resp({ error: 'Component database unavailable' }, 503);
    }
  }

  // Load community submissions
  let submissions = [];
  try {
    const store = getStore('forge-datasets');
    const raw = await store.get('community_prices', { type: 'json' });
    if (Array.isArray(raw)) submissions = raw;
  } catch { /* none yet */ }

  let components = flattenComponents(db);
  components = mergeSubmissions(components, submissions);

  // Apply filters
  const filterPid      = url.searchParams.get('component');
  const filterCategory = url.searchParams.get('category');
  const all            = url.searchParams.get('all');

  if (filterPid) {
    const q = filterPid.toLowerCase();
    components = components.filter(c =>
      c.pid?.toLowerCase() === q ||
      c.name?.toLowerCase().includes(q)
    );
  } else if (filterCategory) {
    components = components.filter(c =>
      c.category?.toLowerCase() === filterCategory.toLowerCase()
    );
  } else if (!all) {
    // No filter and no ?all=1 → require at least one filter
    return resp({
      error: 'Provide ?component=<pid|name>, ?category=<category>, or ?all=1',
      available_categories: [...new Set(components.map(c => c.category))].sort(),
      total_components: components.length,
    }, 400);
  }

  // Score confidence on filtered set
  const withConfidence = components.map(c => ({
    ...c,
    ...scoreConfidence(c, submissions),
  }));

  return resp({
    components: withConfidence,
    meta: {
      total: withConfidence.length,
      community_submissions: submissions.length,
      generated: new Date().toISOString(),
    },
  });
};
