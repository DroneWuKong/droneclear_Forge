/**
 * One-time migration: wingman-analytics → analytics-events
 * GET /.netlify/functions/analytics-migrate?key=ANALYTICS_ADMIN_KEY
 *
 * Reads all data from the old wingman-analytics store on forgeprole
 * and writes it into thebluefairy's analytics-events store.
 * Safe to run multiple times — merges rather than overwrites.
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const adminKey = process.env.ANALYTICS_ADMIN_KEY;
  if (!adminKey) return new Response(JSON.stringify({ error: 'ANALYTICS_ADMIN_KEY not set' }), { status: 503, headers: CORS });

  const url = new URL(req.url);
  const reqKey = url.searchParams.get('key') || req.headers.get('x-admin-key') || '';
  if (reqKey !== adminKey) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

  const blobs = await import('@netlify/blobs');

  // Source: old wingman-analytics store (this site — forgeprole)
  const src = blobs.getStore('wingman-analytics');

  // Destination: thebluefairy's analytics-events store
  const siteID = process.env.ANALYTICS_SITE_ID;
  const token  = process.env.NETLIFY_API_TOKEN;
  if (!siteID || !token) {
    return new Response(JSON.stringify({ error: 'ANALYTICS_SITE_ID or NETLIFY_API_TOKEN not set' }), { status: 503, headers: CORS });
  }
  const dst = blobs.getStore({ name: 'analytics-events', siteID, token });

  const log = [];
  let migrated = 0;

  // ── 1. Migrate totals → seed analytics-events totals ──────────────────────
  try {
    const raw = await src.get('totals');
    if (raw) {
      const srcTotals = JSON.parse(raw);
      log.push(`totals: queries=${srcTotals.queries||0} pageViews=${srcTotals.pageViews||0} sessions=${srcTotals.sessions||0}`);

      // Read existing dst totals and merge
      let dstTotals = {};
      try { const ex = await dst.get('totals'); if (ex) dstTotals = JSON.parse(ex); } catch {}

      // Map old schema → new
      dstTotals.queries       = (dstTotals.queries||0)       + (srcTotals.queries||0);
      dstTotals.imageQueries  = (dstTotals.imageQueries||0)  + (srcTotals.imageQueries||0);
      dstTotals.pageViews     = (dstTotals.pageViews||0)     + (srcTotals.pageViews||0);
      dstTotals.searches      = (dstTotals.searches||0)      + (srcTotals.searches||0);
      dstTotals.sessions      = (dstTotals.sessions||0)      + (srcTotals.sessions||0);
      dstTotals.gapAnalyses   = (dstTotals.gapAnalyses||0)   + (srcTotals.gapAnalyses||0);
      dstTotals.cats          = dstTotals.cats || {};
      for (const [k,v] of Object.entries(srcTotals.cats||{})) {
        dstTotals.cats[k] = (dstTotals.cats[k]||0) + v;
      }
      dstTotals.migrated_from = 'wingman-analytics';
      dstTotals.migrated_at   = new Date().toISOString();
      await dst.set('totals', JSON.stringify(dstTotals));
      log.push('totals migrated ✓');
      migrated++;
    }
  } catch (e) { log.push(`totals error: ${e.message}`); }

  // ── 2. Migrate query-log ──────────────────────────────────────────────────
  try {
    const raw = await src.get('query-log');
    if (raw) {
      const srcLog = JSON.parse(raw);
      log.push(`query-log: ${srcLog.length} entries`);

      let dstLog = [];
      try { const ex = await dst.get('query-log'); if (ex) dstLog = JSON.parse(ex); } catch {}

      const existingTs = new Set(dstLog.map(e => e.ts));
      let added = 0;
      for (const q of srcLog) {
        if (q.ts && existingTs.has(q.ts)) continue;
        dstLog.push({ q: q.q, cat: q.cat, img: q.img, ts: q.ts, mode: q.mode });
        added++;
      }
      dstLog.sort((a,b) => (a.ts||'').localeCompare(b.ts||''));
      if (dstLog.length > 200) dstLog = dstLog.slice(-200);
      await dst.set('query-log', JSON.stringify(dstLog));
      log.push(`query-log: merged ${added} new entries ✓`);
      migrated++;
    }
  } catch (e) { log.push(`query-log error: ${e.message}`); }

  // ── 3. Migrate day-YYYY-MM-DD → daily_YYYY-MM-DD ─────────────────────────
  // Old keys: day-2026-04-01   New keys: daily_2026-04-01
  const now = new Date();
  let daysMigrated = 0;
  for (let i = 0; i < 90; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const srcKey  = `day-${dateStr}`;
    const dstKey  = `daily_${dateStr}`;

    try {
      const raw = await src.get(srcKey);
      if (!raw) continue;

      const events = JSON.parse(raw);
      const queryEvents    = events.filter(e => e.q && e.q.trim());
      const pageViewEvents = events.filter(e => e.event_action === 'page_view' || e.action === 'page_view' || e.type === 'page_view');
      const batchEvents    = events.filter(e => e.event_action && !e.q);

      // Build daily aggregate in new schema
      let d_agg = null;
      try { d_agg = await dst.get(dstKey, { type: 'json' }); } catch {}
      if (!d_agg) d_agg = {
        date: dateStr,
        handbook: { views:0, searches:0, scroll_25:0, scroll_50:0, scroll_75:0, scroll_100:0, outbound_clicks:0, deep_reads:0, sessions:[], top_paths:{}, top_queries:{}, top_outbound:{} },
        forge: { views:0, sessions:[], pages:{}, searches:0, filters:0, compares:0, no_results:0, component_views:0, tab_switches:0, wingman_queries:0, wingman_cats:{}, flag_views:0, flag_severities:{}, intel_views:0, intel_sources:{}, gap_queries:{}, top_pids:{}, top_tabs:{}, top_pages:{}, regions:{}, patterns:{ views:0, tab_switches:0, flag_views:0, wingman_queries:0, intel_views:0, top_tabs:{}, flag_severities:{}, flag_types:{}, flag_ids:{}, wingman_cats:{}, intel_sources:{} } },
      };

      // Map old query events → forge.wingman_queries
      for (const e of queryEvents) {
        d_agg.forge.wingman_queries++;
        const cat = e.cat || 'general';
        d_agg.forge.wingman_cats[cat] = (d_agg.forge.wingman_cats[cat]||0) + 1;
      }

      // Map old batch events
      for (const e of batchEvents) {
        const surface = e.surface || 'forge';
        const action  = e.event_action || e.action || '';
        if (surface === 'forge') {
          if (action === 'page_view' || action === 'view') { d_agg.forge.views++; }
          if (action === 'component_search') d_agg.forge.searches++;
          if (action === 'apply_filter')     d_agg.forge.filters++;
          if (action === 'side_by_side')     d_agg.forge.compares++;
          if (action === 'no_results')       d_agg.forge.no_results++;
          if (action === 'component_detail') { d_agg.forge.component_views++; const pid = e.payload?.component_pid||e.component_pid||'?'; d_agg.forge.top_pids[pid]=(d_agg.forge.top_pids[pid]||0)+1; }
          if (action === 'gap_analysis_run') d_agg.forge.tab_switches++;
        }
        if (surface === 'handbook') {
          if (action === 'view') { d_agg.handbook.views++; const p = e.payload?.path||e.path||'?'; d_agg.handbook.top_paths[p]=(d_agg.handbook.top_paths[p]||0)+1; }
          if (action === 'search') { d_agg.handbook.searches++; const q = (e.payload?.query||e.query||'').toLowerCase().slice(0,100); if(q) d_agg.handbook.top_queries[q]=(d_agg.handbook.top_queries[q]||0)+1; }
        }
      }

      await dst.setJSON(dstKey, d_agg);
      daysMigrated++;
    } catch (e) {
      if (!e.message.includes('404') && !e.message.includes('not found')) {
        log.push(`day ${dateStr} error: ${e.message}`);
      }
    }
  }
  log.push(`day buckets: ${daysMigrated} days migrated ✓`);
  migrated += daysMigrated;

  // ── 4. Migrate sessions ───────────────────────────────────────────────────
  const months = [];
  for (let m = 0; m < 6; m++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - m);
    months.push(d.toISOString().substring(0, 7));
  }
  let sessionsMigrated = 0;
  for (const month of months) {
    try {
      const raw = await src.get(`sessions-${month}`);
      if (!raw) continue;
      const sessions = JSON.parse(raw);

      // Write monthly archive in new schema
      let arc = null;
      try { arc = await dst.get(`archive-${month}`, { type: 'json' }); } catch {}
      if (!arc) arc = { month, forge:{ views:0,sessions:0,flag_views:0,wingman_queries:0,intel_views:0,searches:0,tab_switches:0 }, handbook:{ views:0,sessions:0,searches:0 } };
      arc.forge.sessions   = (arc.forge.sessions||0) + sessions.length;
      arc.forge.wingman_queries = (arc.forge.wingman_queries||0) + sessions.reduce((a,s)=>a+(s.turns||0),0);
      arc.migrated_from = 'wingman-analytics';
      arc.last_updated  = new Date().toISOString();
      await dst.setJSON(`archive-${month}`, arc);
      sessionsMigrated += sessions.length;
    } catch (e) {
      if (!e.message.includes('404')) log.push(`sessions ${month} error: ${e.message}`);
    }
  }
  log.push(`sessions: ${sessionsMigrated} sessions across ${months.length} months migrated ✓`);
  migrated++;

  return new Response(JSON.stringify({
    ok: true,
    migrated_blobs: migrated,
    log,
    next: 'Migration complete. You can now retire analytics.mjs and use analytics-ingest.mjs + analytics-dashboard.mjs exclusively.',
  }), { status: 200, headers: CORS });
};

export const config = { path: '/.netlify/functions/analytics-migrate' };
