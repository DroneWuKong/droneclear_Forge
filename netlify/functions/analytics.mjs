// Netlify serverless function — centralized Wingman analytics collector
// Stores anonymized interaction data in Netlify Blobs (key-value store)
// No PII collected — just query categories, image usage, session patterns

import { getStore } from "@netlify/blobs";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
  'Content-Type': 'application/json',
};

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const store = getStore("wingman-analytics");

  // ─── POST: Ingest analytics event ───
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const { type } = body;

      // ── batch handler (from analytics.html, patterns, intel, platforms) ──
      if (type === 'batch') {
        const events = body.events || [];
        if (!Array.isArray(events) || events.length === 0) {
          return new Response(JSON.stringify({ error: 'empty batch' }), { status: 400, headers: CORS });
        }
        const dayKey = `day-${new Date().toISOString().split('T')[0]}`;
        let dayData = [];
        try { const ex = await store.get(dayKey); if (ex) dayData = JSON.parse(ex); } catch(e) {}

        let totals = {};
        try { const ex = await store.get('totals'); if (ex) totals = JSON.parse(ex); } catch(e) {}
        totals.batchEvents = (totals.batchEvents || 0) + events.length;
        totals.pageViews   = (totals.pageViews || 0)   + events.filter(e => e.event_type === 'page_view').length;
        totals.searches    = (totals.searches || 0)    + events.filter(e => e.event_action === 'component_search').length;
        totals.compares    = (totals.compares || 0)    + events.filter(e => e.event_action === 'side_by_side').length;
        totals.gapAnalyses = (totals.gapAnalyses || 0) + events.filter(e => e.event_action === 'gap_analysis_run').length;
        totals.surfaces    = totals.surfaces || {};
        for (const e of events) {
          const s = e.surface || 'unknown';
          totals.surfaces[s] = (totals.surfaces[s] || 0) + 1;
        }
        totals.lastUpdated = new Date().toISOString();

        // Store sanitized batch
        const sanitized = events.map(e => ({
          ts: e.timestamp || new Date().toISOString(),
          surface: (e.surface || 'forge').substring(0, 20),
          type: (e.event_type || 'unknown').substring(0, 30),
          action: (e.event_action || 'unknown').substring(0, 50),
          session: (e.context?.session_id || '').substring(0, 30),
          region: (e.context?.geo_region || '').substring(0, 30),
          platform: (e.context?.platform || '').substring(0, 20),
          payload: e.payload || {},
        }));
        dayData.push(...sanitized);
        if (dayData.length > 5000) dayData = dayData.slice(-5000);
        await store.set(dayKey, JSON.stringify(dayData));
        await store.set('totals', JSON.stringify(totals));
        return new Response(JSON.stringify({ ok: true, accepted: sanitized.length }), { status: 200, headers: CORS });
      }

      if (type === 'query') {
        // Track a single query event
        const event = {
          ts: new Date().toISOString(),
          cat: (body.cat || 'general').substring(0, 30),
          img: !!body.img,
          mode: (body.mode || 'wingman').substring(0, 20),
          provider: (body.provider || 'gemini').substring(0, 20),
          respLen: Math.min(body.respLen || 0, 100000),
          qLen: Math.min((body.q || '').length, 200),
          q: (body.q || '').substring(0, 200), // First 200 chars of query
          session: (body.session || '').substring(0, 30),
        };

        // Append to daily bucket
        const dayKey = `day-${new Date().toISOString().split('T')[0]}`;
        let dayData = [];
        try {
          const existing = await store.get(dayKey);
          if (existing) dayData = JSON.parse(existing);
        } catch (e) { /* new day */ }

        dayData.push(event);
        await store.set(dayKey, JSON.stringify(dayData));

        // Also maintain a persistent rolling query log (last 200 queries)
        // This survives even if day buckets are empty/expired
        if (event.q) {
          let queryLog = [];
          try {
            const existing = await store.get('query-log');
            if (existing) queryLog = JSON.parse(existing);
          } catch (e) {}
          queryLog.push({ q: event.q, cat: event.cat, img: event.img, ts: event.ts, mode: event.mode });
          if (queryLog.length > 200) queryLog = queryLog.slice(-200);
          await store.set('query-log', JSON.stringify(queryLog));
        }

        // Update running totals
        let totals = {};
        try {
          const existing = await store.get('totals');
          if (existing) totals = JSON.parse(existing);
        } catch (e) { /* fresh */ }

        totals.queries = (totals.queries || 0) + 1;
        totals.imageQueries = (totals.imageQueries || 0) + (event.img ? 1 : 0);
        totals.cats = totals.cats || {};
        totals.cats[event.cat] = (totals.cats[event.cat] || 0) + 1;
        totals.lastUpdated = new Date().toISOString();

        await store.set('totals', JSON.stringify(totals));

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });

      } else if (type === 'session') {
        // Track session summary
        const session = {
          ts: new Date().toISOString(),
          turns: Math.min(body.turns || 0, 1000),
          mode: (body.mode || 'wingman').substring(0, 20),
          provider: (body.provider || 'gemini').substring(0, 20),
          duration: body.duration || 0,
        };

        const monthKey = `sessions-${new Date().toISOString().substring(0, 7)}`;
        let monthData = [];
        try {
          const existing = await store.get(monthKey);
          if (existing) monthData = JSON.parse(existing);
        } catch (e) { /* new month */ }

        monthData.push(session);
        await store.set(monthKey, JSON.stringify(monthData));

        // Update session totals
        let totals = {};
        try {
          const existing = await store.get('totals');
          if (existing) totals = JSON.parse(existing);
        } catch (e) {}

        totals.sessions = (totals.sessions || 0) + 1;
        totals.totalTurns = (totals.totalTurns || 0) + session.turns;
        totals.lastUpdated = new Date().toISOString();

        await store.set('totals', JSON.stringify(totals));

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });

      } else if (type === 'gap_analysis') {
        // Track gap analyzer runs
        const event = {
          ts: new Date().toISOString(),
          entityA: (body.entityA || '').substring(0, 100),
          entityB: (body.entityB || '').substring(0, 100),
          gapCount: Math.min(body.gapCount || 0, 50),
          criticalCount: Math.min(body.criticalCount || 0, 50),
          session: (body.session || '').substring(0, 30),
          provider: (body.provider || 'unknown').substring(0, 20),
        };
        let totals = {};
        try { const ex = await store.get('totals'); if (ex) totals = JSON.parse(ex); } catch(e) {}
        totals.gapAnalyses = (totals.gapAnalyses || 0) + 1;
        totals.lastUpdated = new Date().toISOString();
        await store.set('totals', JSON.stringify(totals));
        const dayKey = `day-${new Date().toISOString().split('T')[0]}`;
        let dayData = [];
        try { const ex = await store.get(dayKey); if (ex) dayData = JSON.parse(ex); } catch(e) {}
        dayData.push({ ...event, type: 'gap_analysis', action: 'gap_analysis_run', surface: 'forge' });
        await store.set(dayKey, JSON.stringify(dayData));
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });

      } else if (type === 'backfill') {
        // Backfill query-log from localStorage data sent by analytics.html
        // Accepts array of {q, cat, img, ts, mode} — merges into query-log deduped by ts
        const queries = Array.isArray(body.queries) ? body.queries : [];
        if (!queries.length) {
          return new Response(JSON.stringify({ ok: true, added: 0 }), { status: 200, headers: CORS });
        }
        let queryLog = [];
        try {
          const existing = await store.get('query-log');
          if (existing) queryLog = JSON.parse(existing);
        } catch (e) {}

        const existingTs = new Set(queryLog.map(e => e.ts));
        let added = 0;
        for (const q of queries) {
          if (!q.q || !q.q.trim()) continue;
          if (q.ts && existingTs.has(q.ts)) continue; // dedupe
          queryLog.push({
            q: (q.q || '').substring(0, 200),
            cat: (q.cat || 'general').substring(0, 30),
            img: !!q.img,
            ts: q.ts || new Date().toISOString(),
            mode: (q.mode || 'wingman').substring(0, 20),
          });
          added++;
        }
        // Keep last 200, sorted by ts
        queryLog.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
        if (queryLog.length > 200) queryLog = queryLog.slice(-200);
        await store.set('query-log', JSON.stringify(queryLog));
        return new Response(JSON.stringify({ ok: true, added, total: queryLog.length }), { status: 200, headers: CORS });

      } else {
        return new Response(JSON.stringify({ error: 'Unknown type' }), { status: 400, headers: CORS });
      }

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
  }

  // ─── GET: Admin dashboard data ───
  if (req.method === 'GET') {
    const adminKey = process.env.ANALYTICS_ADMIN_KEY || 'forge-admin-2026';
    const reqKey = req.headers.get('x-admin-key') || new URL(req.url).searchParams.get('key');

    if (reqKey !== adminKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    }

    try {
      const range = new URL(req.url).searchParams.get('range') || '7'; // days
      const days = Math.min(parseInt(range) || 7, 90);

      // Get totals
      let totals = {};
      try {
        const existing = await store.get('totals');
        if (existing) totals = JSON.parse(existing);
      } catch (e) {}

      // Get daily data for the range
      const dailyData = {};
      const recentQueriesFromDays = [];
      const now = new Date();

      for (let i = 0; i < days; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayKey = `day-${d.toISOString().split('T')[0]}`;
        try {
          const data = await store.get(dayKey);
          if (data) {
            const parsed = JSON.parse(data);
            const queryEvents = parsed.filter(e => e.q && e.q.trim()); // type='query' events only
            dailyData[d.toISOString().split('T')[0]] = {
              count: queryEvents.length,
              images: queryEvents.filter(e => e.img).length,
              cats: queryEvents.reduce((acc, e) => { acc[e.cat] = (acc[e.cat] || 0) + 1; return acc; }, {}),
            };
            // Collect recent queries (last 50) — only entries with actual q text
            if (recentQueriesFromDays.length < 50) {
              parsed.filter(e => e.q && e.q.trim()).slice(-50).forEach(e => {
                if (recentQueriesFromDays.length < 50) {
                  recentQueriesFromDays.push({ q: e.q, cat: e.cat, img: e.img, ts: e.ts, mode: e.mode });
                }
              });
            }
          }
        } catch (e) { /* no data for that day */ }
      }

      // Use persistent query-log as primary source (survives day bucket issues)
      // Fall back to day bucket queries if log is empty
      let recentQueries = [];
      try {
        const logData = await store.get('query-log');
        if (logData) {
          const log = JSON.parse(logData);
          recentQueries = log.filter(e => e.q && e.q.trim()).slice(-50).reverse();
        }
      } catch (e) {}
      if (recentQueries.length === 0) {
        recentQueries = recentQueriesFromDays;
      }

      // Get session data for current month
      const monthKey = `sessions-${now.toISOString().substring(0, 7)}`;
      let sessionData = [];
      try {
        const data = await store.get(monthKey);
        if (data) sessionData = JSON.parse(data);
      } catch (e) {}

      const avgTurns = sessionData.length
        ? Math.round(sessionData.reduce((a, s) => a + s.turns, 0) / sessionData.length * 10) / 10
        : 0;

      const result = {
        totals,
        daily: dailyData,
        recentQueries: recentQueries.reverse(),
        thisMonth: {
          sessions: sessionData.length,
          avgTurns,
        },
        summary: {
          totalPageViews: totals.pageViews || 0,
          totalSearches:  totals.searches || 0,
          totalCompares:  totals.compares || 0,
          totalGapRuns:   totals.gapAnalyses || 0,
          bySurface:      totals.surfaces || {},
        },
        generated: new Date().toISOString(),
      };

      return new Response(JSON.stringify(result, null, 2), { status: 200, headers: CORS });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
};

export const config = {
  path: '/.netlify/functions/analytics',
};
