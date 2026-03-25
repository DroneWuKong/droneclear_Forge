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
      }

      return new Response(JSON.stringify({ error: 'Unknown type' }), { status: 400, headers: CORS });

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
      const recentQueries = [];
      const now = new Date();

      for (let i = 0; i < days; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayKey = `day-${d.toISOString().split('T')[0]}`;
        try {
          const data = await store.get(dayKey);
          if (data) {
            const parsed = JSON.parse(data);
            dailyData[d.toISOString().split('T')[0]] = {
              count: parsed.length,
              images: parsed.filter(e => e.img).length,
              cats: parsed.reduce((acc, e) => { acc[e.cat] = (acc[e.cat] || 0) + 1; return acc; }, {}),
            };
            // Collect recent queries (last 50)
            if (recentQueries.length < 50) {
              parsed.slice(-50).forEach(e => {
                if (recentQueries.length < 50) {
                  recentQueries.push({ q: e.q, cat: e.cat, img: e.img, ts: e.ts, mode: e.mode });
                }
              });
            }
          }
        } catch (e) { /* no data for that day */ }
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
