/**
 * workers/contribution-submit.js
 * ==============================
 * Community contribution intake endpoint (CF Pages Functions / Workers).
 * Backs the JSON `fetch('/api/contribution-submit')` calls in
 * forge-source/contribute.html (single-part and CSV-bulk submit paths).
 * Replaces the retired thebluefairy.netlify.app/api/contribution-submit host.
 *
 * Storage:
 *   Reuses the existing DOCTRINE_META KV namespace (the submissions-metadata
 *   store) under a dedicated, non-colliding key prefix so we don't need a new
 *   KV namespace provisioned in the dashboard:
 *     contrib/<submission_id>   -> full contribution JSON + metadata
 *     contribsha/<sha256>       -> {submission_id}   (dedup index)
 *
 * Payload (application/json), as sent by contribute.html:
 *   { type: 'platform'|'component'|..., name, manufacturer, country, category,
 *     description, source_url, compliance:{...}, submitter, email,
 *     specs:{...} | component_specs:{...} | specs_text/approx_price }
 *
 * Note: the original Netlify function also opened a GitHub issue and returned
 * `issue_url`. The frontend treats `issue_url` as optional, so this handler
 * persists the submission durably to KV and omits it. Wiring GitHub-issue
 * creation back in (needs a PAT secret) is a separate follow-up.
 */

const MAX_BYTES = 256 * 1024; // generous cap for a JSON contribution

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'POST only' });

    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return json(400, { error: 'expected application/json' });
    }
    if (!env.DOCTRINE_META) {
      return json(503, { error: 'contribution storage not configured' });
    }

    const raw = await req.text();
    if (raw.length > MAX_BYTES) {
      return json(413, { error: `payload too large: ${raw.length} > ${MAX_BYTES}` });
    }

    let payload;
    try { payload = JSON.parse(raw); }
    catch (e) { return json(400, { error: 'invalid JSON: ' + e.message }); }

    const type = (payload.type || '').toString().trim().slice(0, 40);
    const name = (payload.name || '').toString().trim().slice(0, 240);
    const manufacturer = (payload.manufacturer || '').toString().trim().slice(0, 240);
    if (!type) return json(400, { error: 'type required' });
    if (!name) return json(400, { error: 'name required' });

    // Dedup on a normalized type+manufacturer+name signature.
    const sig = `${type}::${manufacturer}::${name}`.toLowerCase();
    const sha = await sha256Hex(sig);
    const submissionId = sha.slice(0, 16) + '_' + Date.now().toString(36);

    const dupRaw = await env.DOCTRINE_META.get(`contribsha/${sha}`);
    if (dupRaw) {
      let dup;
      try { dup = JSON.parse(dupRaw); } catch { dup = {}; }
      return json(200, {
        ok: true,
        duplicate: true,
        submission_id: dup.submission_id || null,
        message: 'A matching contribution is already in the review queue.',
      });
    }

    const record = {
      submission_id: submissionId,
      sha256: sha,
      submitted_at: new Date().toISOString(),
      status: 'pending',
      submitter: (payload.submitter || 'Anonymous').toString().slice(0, 120),
      email: (payload.email || '').toString().slice(0, 200),
      type,
      name,
      manufacturer,
      payload,
    };

    await env.DOCTRINE_META.put(`contrib/${submissionId}`, JSON.stringify(record));
    await env.DOCTRINE_META.put(`contribsha/${sha}`, JSON.stringify({ submission_id: submissionId }));

    return json(200, {
      ok: true,
      submission_id: submissionId,
      message: 'Contribution received. It will appear in the review queue.',
    });
  },
};
