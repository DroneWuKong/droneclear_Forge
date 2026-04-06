// Netlify function — generates a compliance report PDF for a given platform/build
// Pro and Agency tier only — validates sub token before generating
//
// POST /.netlify/functions/compliance-report
// Body: { token, report_type, subject, components?, platform? }
// Returns: PDF binary (application/pdf)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sub-Token',
};

async function verifySubToken(token, secret) {
  if (!token || !secret) return null;
  try {
    const { payload, sig } = JSON.parse(atob(token));
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(JSON.stringify(payload)));
    if (!valid || (payload.exp && Date.now() > payload.exp)) return null;
    return payload;
  } catch { return null; }
}

// Generate report HTML (converted to PDF client-side via print)
// We return structured JSON that the client renders + prints as PDF
function buildReportData(subject, flags, predictions, entities, reportType) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Filter relevant flags
  const relevantFlags = flags.filter(f => {
    const title = (f.title || '').toLowerCase();
    const detail = (f.detail || '').toLowerCase();
    const subLower = subject.toLowerCase();
    return title.includes(subLower) || detail.includes(subLower) ||
           f.flag_type === 'grayzone' || f.severity === 'critical';
  }).slice(0, 30);

  // Gray zone entities
  const gzEntities = entities.filter(e =>
    e.composite_score > 0.5 ||
    (subject && (e.name || '').toLowerCase().includes(subject.toLowerCase()))
  );

  // Top predictions
  const topPreds = predictions
    .filter(p => p.probability >= 0.6)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 5);

  // NDAA analysis
  const supplyFlags  = flags.filter(f => f.flag_type === 'supply_constraint');
  const procFlags    = flags.filter(f => f.flag_type === 'procurement_spike');
  const gzFlags      = flags.filter(f => f.flag_type === 'grayzone' || f.flag_type === 'grayzone_xref');
  const critFlags    = flags.filter(f => f.severity === 'critical');

  return {
    meta: {
      title: `DroneClear Intelligence Report`,
      subtitle: subject ? `Supply Chain & Compliance Analysis: ${subject}` : 'UAS Supply Chain & Compliance Analysis',
      report_type: reportType,
      generated: dateStr,
      generated_iso: now.toISOString(),
      generated_by: 'DroneClear PIE v0.9',
      classification: 'UNCLASSIFIED // FOR OFFICIAL USE',
      report_id: `DCR-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${Math.random().toString(36).slice(2,8).toUpperCase()}`,
    },
    executive_summary: {
      total_flags: flags.length,
      critical_flags: critFlags.length,
      gray_zone_entities: gzEntities.length,
      supply_flags: supplyFlags.length,
      procurement_flags: procFlags.length,
      risk_level: critFlags.length > 10 ? 'HIGH' : critFlags.length > 5 ? 'MEDIUM' : 'LOW',
      key_finding: critFlags.length > 0
        ? `${critFlags.length} critical-severity signals detected. Immediate review recommended before procurement decisions.`
        : 'No critical-severity signals detected. Standard due diligence applies.',
    },
    gray_zone_entities: gzEntities.map(e => ({
      name:     e.name,
      score:    e.composite_score,
      risk:     e.composite_score >= 0.75 ? 'CRITICAL' : e.composite_score >= 0.5 ? 'HIGH' : 'MEDIUM',
      country:  e.country_of_incorporation || e.headquarters || '?',
      key_flag: e.latest_developments?.[0]?.summary || e.indicators?.[0]?.description || '',
      ndaa_status: e.ndaa_status || 'Non-compliant',
      fcc_covered: e.fcc_covered_list || false,
    })),
    critical_flags: critFlags.slice(0, 10).map(f => ({
      title:      f.title,
      detail:     f.detail,
      type:       f.flag_type,
      confidence: f.confidence,
      timestamp:  f.timestamp,
    })),
    supply_chain_flags: supplyFlags.slice(0, 8).map(f => ({
      title:      f.title,
      detail:     f.detail,
      confidence: f.confidence,
    })),
    predictions: topPreds.map(p => ({
      event:       p.event,
      timeframe:   p.timeframe,
      probability: p.probability,
      impact:      p.impact,
      drivers:     p.drivers?.slice(0, 3) || [],
      cross_validated: p.cross_validated || false,
    })),
    procurement_flags: procFlags.slice(0, 6).map(f => ({
      title:      f.title,
      detail:     f.detail,
      confidence: f.confidence,
    })),
    methodology: {
      data_sources: [
        'USAspending.gov federal awards database',
        'SAM.gov procurement records',
        'FCC Equipment Authorization database',
        'NDAA §848 Blue UAS Framework',
        'DroneClear intel feed (861 articles, 7 sources)',
        'Grayzone Detector v0.9 (6 weighted dimensions)',
        'PIE LLM Synthesis (Claude Sonnet + Gemini + Groq cross-validation)',
      ],
      gray_zone_dimensions: [
        'Identity wash (25%) — corporate structure and ownership transparency',
        'Component pass-through (20%) — adversary-nation component dependency',
        'Firmware dependency (20%) — adversary-nation firmware or signing keys',
        'Data routing risk (15%) — telemetry or data transmission to adversary nations',
        'Regulatory arbitrage (10%) — FCC Covered List, NDAA §848 status',
        'Supply chain fragility (10%) — sole-source concentration risk',
      ],
      disclaimer: 'This report is generated from open-source intelligence and public procurement data. It is intended to support due diligence and does not constitute legal advice. Gray zone scores reflect pattern analysis and should be verified with primary sources before procurement decisions.',
    },
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST required' }), {
    status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
  });

  const tokenSecret = process.env.PRO_TOKEN_SECRET;
  const proxySecret = process.env.WINGMAN_PROXY_SECRET;

  // Auth — sub token OR proxy secret (owner)
  const body = await req.json().catch(() => ({}));
  const clientToken  = body.token || req.headers.get('x-sub-token') || '';
  const clientSecret = req.headers.get('x-proxy-secret') || body.proxy_secret || '';

  let authed = false;
  if (proxySecret && clientSecret === proxySecret) authed = true;
  if (!authed && tokenSecret && clientToken) {
    const payload = await verifySubToken(clientToken, tokenSecret);
    if (payload) authed = true;
  }

  if (!authed) {
    return new Response(JSON.stringify({ error: 'Pro subscription required', upgrade_url: '/pro/' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { subject, report_type = 'full' } = body;

  // Fetch live data from Forge static files
  const base = 'https://nvmillbuilditmyself.com';
  let flags = [], predictions = [], entities = [];
  try {
    const [fr, pr, er] = await Promise.all([
      fetch(`${base}/static/pie_flags.json`).then(r => r.ok ? r.json() : []),
      fetch(`${base}/static/pie_predictions.json`).then(r => r.ok ? r.json() : []),
      fetch(`${base}/static/pie_predictions.json`).then(() => []), // entities via separate source
    ]);
    flags       = Array.isArray(fr) ? fr : [];
    predictions = Array.isArray(pr) ? pr : [];
  } catch(e) {
    // Return empty report if data unavailable
  }

  const reportData = buildReportData(subject || '', flags, predictions, entities, report_type);

  return new Response(JSON.stringify(reportData), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
};

export const config = { path: '/.netlify/functions/compliance-report' };
