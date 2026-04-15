// Netlify function — generates a PIE intelligence report
// Pro and Agency tier only — validates sub token before generating
//
// POST /.netlify/functions/compliance-report
// Body: { token, report_type, subject, proxy_secret? }
// Returns: JSON structured report data for client-side rendering + PDF

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sub-Token, X-Proxy-Secret',
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
  for (const fl of flags) {
    const text = ((fl.title||'') + ' ' + (fl.detail||'')).toLowerCase();
    for (const e of KNOWN_ENTITIES) {
      if (text.includes(e.key.toLowerCase())) {
        map[e.name].flags.push(fl);
        const sev = fl.severity || '';
        if (sev === 'critical')     map[e.name].critical++;
        else if (sev === 'warning') map[e.name].warning++;
        else                        map[e.name].info++;
      }
    }
  }
  return Object.values(map)
    .filter(e => e.flags.length > 0)
    .map(e => ({
      ...e,
      composite_score: Math.round(Math.min(0.98, e.critical * 0.08 + e.warning * 0.04 + e.info * 0.01) * 100) / 100,
      risk_tier: e.critical >= 6 ? 'CRITICAL' : e.critical >= 3 ? 'HIGH' : e.warning >= 4 ? 'MEDIUM' : 'LOW',
      flag_count: e.flags.length,
      key_flags: e.flags.filter(f => f.severity === 'critical').slice(0, 4)
        .map(f => ({ title: (f.title||'').replace(/\[GRAY ZONE\]\s*[^:]+:\s*/, ''), detail: f.detail, confidence: f.confidence })),
    }))
    .sort((a, b) => b.composite_score - a.composite_score)
    .filter((e, i, arr) => arr.findIndex(x => x.name === e.name) === i); // dedupe
}

function filterRelevant(flags, subject) {
  if (!subject) return flags;
  const s = subject.toLowerCase();
  const matched = flags.filter(f =>
    (f.title||'').toLowerCase().includes(s) || (f.detail||'').toLowerCase().includes(s)
  );
  return matched.length >= 4 ? matched : flags.filter(f => f.severity === 'critical' || (f.flag_type||'').includes('grayzone'));
}

async function synthesize(subject, flags, entities, predictions, reportType, apiKey) {
  if (!apiKey) return null;
  const critFlags = flags.filter(f => f.severity === 'critical').slice(0, 8);
  const entityLines = entities.slice(0, 3).map(e =>
    `${e.name}: composite score ${e.composite_score} (${e.risk_tier}), ${e.critical} critical flags, ${e.warning} warning flags`
  ).join('\n');
  const flagLines = critFlags.map(f =>
    `• ${(f.title||'').replace(/\[GRAY ZONE\]\s*[^:]+:\s*/, '')} — ${(f.detail||'').slice(0, 120)}`
  ).join('\n');
  const predLines = predictions.slice(0, 4).map(p =>
    `• ${Math.round(p.probability*100)}% probability: ${p.event} (${p.timeframe}, ${p.impact} impact)`
  ).join('\n');

  const prompt = `You are a drone procurement intelligence analyst for DroneClear. Write a concise executive assessment for a ${reportType} intelligence report.
${subject ? `Report subject: "${subject}"` : 'Subject: General UAS supply chain and gray zone intelligence'}

ENTITY RISK SCORES:
${entityLines || 'No gray zone entities matched.'}

CRITICAL FLAGS:
${flagLines || 'No critical flags in current dataset.'}

SUPPLY CHAIN PREDICTIONS:
${predLines}

Write exactly 3 short paragraphs (no headers, no bullets, no markdown):
1. The most critical finding and its procurement implication — be specific with numbers and entity names.
2. The most urgent action item for a procurement officer in the next 30-60 days — concrete and direct.
3. What the PIE predictions indicate for the next 6-12 months — one forward-looking risk and one opportunity.

Keep it under 220 words total. Write like you are briefing someone who has 2 minutes to read this.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 450, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch { return null; }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST required' }), {
    status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
  });

  const tokenSecret  = process.env.PRO_TOKEN_SECRET;
  const proxySecret  = process.env.WINGMAN_PROXY_SECRET;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const body         = await req.json().catch(() => ({}));
  const clientToken  = body.token || req.headers.get('x-sub-token') || '';
  const clientSecret = body.proxy_secret || req.headers.get('x-proxy-secret') || '';

  let authed = false;
  if (proxySecret && clientSecret === proxySecret) authed = true;
  if (!authed && tokenSecret && clientToken) {
    const payload = await verifySubToken(clientToken, tokenSecret);
    if (payload) authed = true;
  }
  if (!authed) return new Response(JSON.stringify({ error: 'Pro subscription required', upgrade_url: '/pro/' }), {
    status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
  });

  const { subject = '', report_type = 'full' } = body;
  const base = process.env.URL || 'https://uas-forge.com';

  let flags = [], predictions = [];
  try {
    const [fr, pr] = await Promise.all([
      fetch(`${base}/static/pie_flags.json`).then(r => r.ok ? r.json() : []),
      fetch(`${base}/static/pie_predictions.json`).then(r => r.ok ? r.json() : []),
    ]);
    flags       = Array.isArray(fr) ? fr : [];
    predictions = Array.isArray(pr) ? pr : [];
  } catch { /* continue with empty */ }

  const entities = scoreEntities(flags);

  // Filter by report type
  let reportFlags = flags;
  if (report_type === 'grayzone')     reportFlags = flags.filter(f => (f.flag_type||'').includes('grayzone') || f.severity === 'critical');
  if (report_type === 'supply_chain') reportFlags = flags.filter(f => ['supply_constraint','lead_time','concentration_risk'].includes(f.flag_type));
  if (report_type === 'procurement')  reportFlags = flags.filter(f => ['procurement_spike','contract_award','program_signal'].includes(f.flag_type));

  const relevantFlags = filterRelevant(reportFlags, subject);
  const critFlags     = relevantFlags.filter(f => f.severity === 'critical');
  const supplyFlags   = relevantFlags.filter(f => f.flag_type === 'supply_constraint');
  const procFlags     = relevantFlags.filter(f => f.flag_type === 'procurement_spike');
  const topPreds      = predictions.filter(p => p.probability >= 0.6).sort((a,b) => b.probability - a.probability).slice(0, 6);

  // Run Claude synthesis in parallel
  const synthesis = await synthesize(subject, relevantFlags, entities, topPreds, report_type, anthropicKey);

  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const riskLevel = critFlags.length > 10 ? 'HIGH' : critFlags.length > 4 ? 'HIGH' : critFlags.length > 1 ? 'MEDIUM' : 'LOW';

  const displayEntities = (() => {
    if (!subject) return entities.slice(0, 4);
    const matched = entities.filter(e =>
      e.name.toLowerCase().includes(subject.toLowerCase()) ||
      subject.toLowerCase().includes(e.key?.toLowerCase() || '')
    );
    return matched.length > 0 ? matched : entities.slice(0, 4);
  })();

  const reportData = {
    meta: {
      title: 'DroneClear Intelligence Report',
      subtitle: subject ? `Supply Chain & Compliance Analysis: ${subject}` : 'UAS Supply Chain & Gray Zone Intelligence Brief',
      report_type,
      generated: dateStr,
      generated_iso: now.toISOString(),
      generated_by: 'DroneClear PIE v1.2 · Claude Sonnet 4.6',
      classification: 'UNCLASSIFIED // FOR OFFICIAL USE',
      report_id: `DCR-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${Math.random().toString(36).slice(2,8).toUpperCase()}`,
    },
    executive_summary: {
      total_flags:        relevantFlags.length,
      critical_flags:     critFlags.length,
      gray_zone_entities: displayEntities.length,
      supply_flags:       supplyFlags.length,
      procurement_flags:  procFlags.length,
      risk_level:         riskLevel,
      key_finding:        synthesis || (critFlags.length > 0
        ? `${critFlags.length} critical-severity signals detected across ${relevantFlags.length} total flags. ${displayEntities.length} gray zone entities identified. Immediate procurement review recommended.`
        : `No critical flags matched the subject. ${topPreds.length} active supply chain predictions relevant to this space. Standard due diligence applies.`),
      ai_synthesized: !!synthesis,
    },
    gray_zone_entities: displayEntities.map(e => ({
      name:        e.name,
      score:       e.composite_score,
      risk:        e.risk_tier,
      country:     e.country,
      ndaa_status: e.ndaa,
      fcc_covered: e.fcc,
      flag_count:  e.flag_count,
      key_flag:    e.key_flags?.[0]?.detail?.slice(0, 200) || '',
    })),
    critical_flags: critFlags.slice(0, 12).map(f => ({
      title:      (f.title||'').replace(/\[GRAY ZONE\]\s*[^:]+:\s*/, ''),
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
      event:           p.event,
      timeframe:       p.timeframe,
      probability:     p.probability,
      confidence:      p.confidence,
      impact:          p.impact,
      drivers:         (p.drivers||[]).slice(0, 4),
      model_outputs:   (p.model_outputs||[]).slice(0, 3),
      cross_validated: (p.model_outputs||[]).length >= 2,
    })),
    procurement_flags: procFlags.slice(0, 6).map(f => ({
      title:      f.title,
      detail:     f.detail,
      confidence: f.confidence,
    })),
    methodology: {
      data_sources: [
        'DroneClear PIE pipeline — 251 flags across 7 flag types',
        'FCC Equipment Authorization database + Covered List',
        'NDAA §848 Blue UAS Framework + DoD covered entity list',
        'Security research (Jon Sawyer, White Knight Labs pentest)',
        'Texas AG v. Anzu Robotics — Collin County, Feb 2026',
        'OR/NASAO grounding database — 467 drones, 25 states',
        'USAspending.gov + SAM.gov federal procurement records',
        'Drone Industry Insights — $3.86B 2025 funding dataset',
        'PIE LLM cross-validation — Claude Sonnet 4.6 + Gemini + Groq',
      ],
      gray_zone_dimensions: [
        'Adversary technology dependency (firmware, SDK, hardware) — weight: 0.30',
        'Supply chain traceability and country-of-origin disclosure — weight: 0.25',
        'Data pipeline and cloud infrastructure routing — weight: 0.25',
        'Regulatory compliance (NDAA, FCC, Blue UAS Framework) — weight: 0.20',
      ],
      scoring_formula: 'composite_score = min(0.98, critical × 0.08 + warning × 0.04 + info × 0.01)',
      disclaimer: 'This report is generated from open-source intelligence, public procurement records, and AI synthesis. It constitutes an analytical assessment and does not constitute legal advice. Gray zone scores reflect pattern analysis across sourced evidence and should be verified before procurement decisions. Midwest Nice Advisory LLC · uas-forge.com',
    },
  };

  return new Response(JSON.stringify(reportData), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
};

export const config = { path: '/.netlify/functions/compliance-report' };
