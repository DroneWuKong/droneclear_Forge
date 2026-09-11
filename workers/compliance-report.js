/**
 * compliance-report — CF Worker replacing /.netlify/functions/compliance-report
 * Route: /api/compliance/report
 * Owner-only via WINGMAN_PROXY_SECRET.
 * Generates PIE intelligence compliance reports via Anthropic API.
 */

import claudeProxy from './claude-proxy.js';
import { authorize, readBoundedJson, json } from './proxy-policy.mjs';

const CORS = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret',
};

const KNOWN_ENTITIES = [
  { key: 'SkyRover',  name: 'SkyRover / Knowact',   country: 'China (Shenzhen)',  ndaa: 'Non-compliant', fcc: true  },
  { key: 'Knowact',   name: 'SkyRover / Knowact',   country: 'China (Shenzhen)',  ndaa: 'Non-compliant', fcc: true  },
  { key: 'Cogito',    name: 'Cogito Tech / SPECTA',  country: 'China (presumed)',  ndaa: 'Non-compliant', fcc: false },
  { key: 'SPECTA',    name: 'Cogito Tech / SPECTA',  country: 'China (presumed)',  ndaa: 'Non-compliant', fcc: false },
  { key: 'Autel',     name: 'Autel Robotics',        country: 'China / US ops',   ndaa: 'FY2025 §1709 named', fcc: true },
  { key: 'Anzu',      name: 'Anzu Robotics',         country: 'US (DJI-derived)', ndaa: 'Disputed',      fcc: false },
];

function scoreEntities(flags) {
  const map = {};
  for (const e of KNOWN_ENTITIES) {
    if (!map[e.name]) map[e.name] = { ...e, flags: [], critical: 0, warning: 0, info: 0 };
  }
  for (const fl of (flags || [])) {
    const text = ((fl.title || '') + ' ' + (fl.detail || '')).toLowerCase();
    for (const e of KNOWN_ENTITIES) {
      if (text.includes(e.key.toLowerCase())) {
        const bucket = map[e.name];
        if (bucket) {
          bucket.flags.push(fl);
          if (fl.level === 'critical') bucket.critical++;
          else if (fl.level === 'warning') bucket.warning++;
          else bucket.info++;
        }
      }
    }
  }
  return Object.values(map).filter(e => e.flags.length > 0);
}

export default {
  async fetch(req, env) {
    const denied = await authorize(req, env);
    if (denied) return denied;
    let body;
    try {
      ({ body } = await readBoundedJson(req));
      for (const [key, max] of [['report_type', 100], ['subject', 2000]]) {
        if (body[key] != null && (typeof body[key] !== 'string' || body[key].length > max)) {
          throw new Error(`${key} must be text up to ${max} characters`);
        }
      }
    } catch (error) { return json({ error: error.message }, 400); }

    try {
      const { report_type, subject } = body;

      // Load flags from KV
      const flagsRaw = await env.PIE_OUTPUTS.get('pie_flags');
      const flags = flagsRaw ? JSON.parse(flagsRaw) : [];

      // Build entity risk summary
      const entityScores = scoreEntities(flags);
      const critical = flags.filter(f => f.level === 'critical');
      const warnings = flags.filter(f => f.level === 'warning');

      // Ask Claude to generate the report
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      const prompt = `You are a UAS procurement compliance analyst. Generate a structured compliance report.

Report type: ${report_type || 'general'}
Subject: ${subject || 'UAS supply chain'}
Total flags: ${flags.length} (${critical.length} critical, ${warnings.length} warnings)
Entity risks: ${JSON.stringify(entityScores.map(e => ({ name: e.name, ndaa: e.ndaa, critical: e.critical, warning: e.warning })))}
Top critical flags: ${JSON.stringify(critical.slice(0, 5).map(f => ({ title: f.title, detail: f.detail })))}

Return a JSON object with: { executive_summary, risk_level, entity_risks, top_flags, recommendations, generated_at }`;

      const upstream = await claudeProxy.fetch(new Request(req.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Proxy-Secret': req.headers.get('x-proxy-secret'),
        },
        body: JSON.stringify({
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        }),
      }), env);
      if (!upstream.ok) return upstream;

      const result = await upstream.json();
      const text = (result.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
      if (!text.trim()) return json({ error: 'Provider returned an empty report' }, 502);
      let reportData;
      try {
        reportData = JSON.parse(text.replace(/```json|```/g, '').trim());
      } catch {
        reportData = { executive_summary: text, risk_level: 'unknown' };
      }
      if (!reportData || Array.isArray(reportData) || typeof reportData !== 'object' || !Object.keys(reportData).length) {
        return json({ error: 'Provider returned an invalid report' }, 502);
      }
      reportData.generated_at = new Date().toISOString();
      reportData.raw_flag_counts = { total: flags.length, critical: critical.length, warning: warnings.length };

      return new Response(JSON.stringify(reportData), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }
};
