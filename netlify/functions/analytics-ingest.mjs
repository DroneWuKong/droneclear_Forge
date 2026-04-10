/**
 * AI Wingman Analytics — Forge Ingest
 * Endpoint: forgeprole.netlify.app/.netlify/functions/analytics-ingest
 *
 * Receives events from all Forge pages (same-origin — no cross-site URL in source).
 * Writes to thebluefairy's Blobs store via cross-site access using:
 *   ANALYTICS_SITE_ID  — thebluefairy Netlify site ID (from Netlify dashboard)
 *   NETLIFY_API_TOKEN  — Netlify personal access token with Blobs write scope
 *
 * Stores:
 *   analytics-events / daily_YYYY-MM-DD  — per-day aggregate (fast dashboard reads)
 *   analytics-events / archive-YYYY-MM   — monthly rollup (persistent)
 *   analytics-events / raw-YYYY-MM-DD    — raw event batches (replay / audit)
 */

const ALLOWED_ORIGINS = [
  'https://forgeprole.netlify.app',
  'http://localhost:8888',
  'http://localhost:3000',
];

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), {
      status: 405, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const events = Array.isArray(body.events) ? body.events : [];
    if (!events.length) {
      return new Response(JSON.stringify({ accepted: 0 }), {
        status: 200, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    const valid = events.filter(e =>
      e.event_id && e.timestamp && e.surface && e.event_type && e.event_action
    ).map(e => ({
      event_id:     e.event_id,
      timestamp:    e.timestamp,
      surface:      e.surface,
      page:         e.page || null,
      event_type:   e.event_type,
      event_action: e.event_action,
      session_id:   e.context?.session_id || null,
      geo_region:   e.context?.geo_region || null,
      platform:     e.context?.platform || null,
      payload:      e.payload || {},
    }));

    if (!valid.length) {
      return new Response(JSON.stringify({ accepted: 0, rejected: events.length }), {
        status: 200, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    // Init cross-site Blobs store — writes to thebluefairy's store
    let store;
    try {
      const blobs = await import('@netlify/blobs');
      const siteID = process.env.ANALYTICS_SITE_ID;
      const token  = process.env.NETLIFY_API_TOKEN;
      if (siteID && token) {
        // Cross-site: write to thebluefairy's analytics-events store
        store = blobs.getStore({ name: 'analytics-events', siteID, token });
      } else {
        // Fallback: write to own store (useful for local dev)
        store = blobs.getStore('analytics-events');
        console.warn('[ingest] ANALYTICS_SITE_ID or NETLIFY_API_TOKEN not set — writing to local store');
      }
    } catch (e) {
      return new Response(JSON.stringify({ accepted: valid.length, stored: false, error: e.message }), {
        status: 200, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
    const month = today.slice(0, 7);                        // YYYY-MM

    // ── 1. Raw event archive (one blob per day, appended) ─────────────────
    // Preserves full event history for replay / audit. Never overwritten.
    try {
      let raw = [];
      try { raw = await store.get(`raw-${today}`, { type: 'json' }) || []; } catch {}
      raw.push(...valid);
      // Cap at 5000 events/day to stay under 5MB blob limit
      if (raw.length > 5000) raw = raw.slice(-5000);
      await store.setJSON(`raw-${today}`, raw);
    } catch (e) {
      console.warn('[ingest] raw archive write failed:', e.message);
    }

    // ── 2. Daily aggregate (fast reads for dashboard) ─────────────────────
    let d = null;
    try { d = await store.get(`daily_${today}`, { type: 'json' }); } catch {}

    if (!d) d = {
      date: today,
      handbook: {
        views: 0, searches: 0, scroll_25: 0, scroll_50: 0, scroll_75: 0, scroll_100: 0,
        outbound_clicks: 0, deep_reads: 0, sessions: [],
        top_paths: {}, top_queries: {}, top_outbound: {},
      },
      forge: {
        views: 0, sessions: [], pages: {},
        searches: 0, filters: 0, compares: 0, no_results: 0,
        component_views: 0, tab_switches: 0,
        wingman_queries: 0, wingman_cats: {},
        flag_views: 0, flag_severities: {},
        intel_views: 0, intel_sources: {},
        gap_queries: {}, top_pids: {}, top_tabs: {}, top_pages: {}, regions: {},
        patterns: {
          views: 0, tab_switches: 0, flag_views: 0, wingman_queries: 0, intel_views: 0,
          top_tabs: {}, flag_severities: {}, flag_types: {}, flag_ids: {},
          wingman_cats: {}, intel_sources: {},
        },
      },
    };

    const hbS = new Set(d.handbook.sessions || []);
    const fgS = new Set(d.forge.sessions || []);

    for (const e of valid) {
      const p = e.payload || {};
      if (e.surface === 'handbook') {
        const h = d.handbook;
        if (e.session_id) hbS.add(e.session_id);
        if (e.event_action === 'view')           { h.views++; const pt=p.path||'?'; h.top_paths[pt]=(h.top_paths[pt]||0)+1; }
        if (e.event_action === 'search')         { h.searches++; const qk=(p.query||'').toLowerCase().slice(0,100); if(qk) h.top_queries[qk]=(h.top_queries[qk]||0)+1; }
        if (e.event_action === 'scroll_depth')   { const dp=p.depth_pct; if(dp===25)h.scroll_25++; if(dp===50)h.scroll_50++; if(dp===75)h.scroll_75++; if(dp===100)h.scroll_100++; }
        if (e.event_action === 'outbound_link')  { h.outbound_clicks++; const dom=p.to||p.to_domain||'?'; h.top_outbound[dom]=(h.top_outbound[dom]||0)+1; }
        if (e.event_action === 'time_on_page' && p.deep_read) h.deep_reads++;
      }

      if (e.surface === 'forge') {
        const f = d.forge;
        if (e.session_id) fgS.add(e.session_id);
        const pg = e.page || p.page || 'unknown';
        const rg = e.geo_region || 'Unknown';
        f.regions[rg] = (f.regions[rg]||0)+1;

        if (e.event_action === 'view')             { f.views++; f.pages[pg]=(f.pages[pg]||0)+1; f.top_pages[pg]=(f.top_pages[pg]||0)+1; }
        if (e.event_action === 'component_detail') { f.component_views++; const pid=p.pid||p.component_pid||'?'; f.top_pids[pid]=(f.top_pids[pid]||0)+1; }
        if (e.event_action === 'component_search') f.searches++;
        if (e.event_action === 'no_results')       { f.no_results++; const qk=(p.query||'').toLowerCase().slice(0,100); if(qk) f.gap_queries[qk]=(f.gap_queries[qk]||0)+1; }
        if (e.event_action === 'apply_filter')     f.filters++;
        if (e.event_action === 'side_by_side')     f.compares++;
        if (e.event_action === 'tab_switch')       { f.tab_switches++; const tab=p.tab||'?'; f.top_tabs[tab]=(f.top_tabs[tab]||0)+1; }
        if (e.event_action === 'wingman_query')    { f.wingman_queries++; const cat=p.category||p.cat||'general'; f.wingman_cats[cat]=(f.wingman_cats[cat]||0)+1; }
        if (e.event_action === 'flag_view')        { f.flag_views++; const sev=p.severity||'?'; f.flag_severities[sev]=(f.flag_severities[sev]||0)+1; }
        if (e.event_action === 'article_view')     { f.intel_views++; const src=p.source||'?'; f.intel_sources[src]=(f.intel_sources[src]||0)+1; }

        // Patterns-specific sub-aggregate
        if (pg === 'patterns') {
          const pt = f.patterns;
          if (e.event_action === 'view')          pt.views++;
          if (e.event_action === 'tab_switch')    { pt.tab_switches++; const tab=p.tab||'?'; pt.top_tabs[tab]=(pt.top_tabs[tab]||0)+1; }
          if (e.event_action === 'flag_view')     { pt.flag_views++; const sev=p.severity||'?'; const ft=p.flag_type||'?'; const fid=p.flag_id||'?'; pt.flag_severities[sev]=(pt.flag_severities[sev]||0)+1; pt.flag_types[ft]=(pt.flag_types[ft]||0)+1; pt.flag_ids[fid]=(pt.flag_ids[fid]||0)+1; }
          if (e.event_action === 'wingman_query') { pt.wingman_queries++; const cat=p.category||p.cat||'general'; pt.wingman_cats[cat]=(pt.wingman_cats[cat]||0)+1; }
          if (e.event_action === 'article_view')  { pt.intel_views++; const src=p.source||'?'; pt.intel_sources[src]=(pt.intel_sources[src]||0)+1; }
        }
      }
    }

    d.handbook.sessions = [...hbS];
    d.forge.sessions    = [...fgS];
    await store.setJSON(`daily_${today}`, d);

    // ── 3. Monthly rollup archive ─────────────────────────────────────────
    // Accumulates totals by month — survives daily blob expiry
    try {
      let arc = null;
      try { arc = await store.get(`archive-${month}`, { type: 'json' }); } catch {}
      if (!arc) arc = { month, forge: { views:0, sessions:0, flag_views:0, wingman_queries:0, intel_views:0, searches:0, tab_switches:0 }, handbook: { views:0, sessions:0, searches:0 } };
      arc.forge.views           += d.forge.views;
      arc.forge.flag_views      += d.forge.flag_views;
      arc.forge.wingman_queries += d.forge.wingman_queries;
      arc.forge.intel_views     += d.forge.intel_views;
      arc.forge.searches        += d.forge.searches;
      arc.forge.tab_switches    += d.forge.tab_switches;
      arc.forge.sessions        = (arc.forge.sessions||0) + fgS.size;
      arc.handbook.views        += d.handbook.views;
      arc.handbook.searches     += d.handbook.searches;
      arc.handbook.sessions     = (arc.handbook.sessions||0) + hbS.size;
      arc.last_updated = new Date().toISOString();
      await store.setJSON(`archive-${month}`, arc);
    } catch (e) {
      console.warn('[ingest] monthly archive write failed:', e.message);
    }

    return new Response(JSON.stringify({ accepted: valid.length, rejected: events.length - valid.length }), {
      status: 200, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
};

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export const config = { path: '/.netlify/functions/analytics-ingest' };
