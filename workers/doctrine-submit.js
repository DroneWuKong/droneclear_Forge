/**
 * workers/doctrine-submit.js
 * ==========================
 * Doctrine submission endpoint (CF Pages Functions / Workers).
 * Replaces netlify/functions/doctrine-submit.mjs.
 *
 * Storage split:
 *   - R2 bucket DOCTRINE_INBOX_R2 stores the PDF blob at pdf/<submission_id>.pdf
 *     (no per-value size limit; lets us keep the 25 MB upload cap)
 *   - KV namespace DOCTRINE_META holds metadata (small JSON) + sha-dedup index
 *
 * KV keys:
 *   meta/<submission_id>   -> {title, source_url, status, ...}
 *   sha/<sha256>           -> {submission_id}      (dedup index)
 */

const MIN_BYTES = 50_000;
const MAX_BYTES = 25 * 1024 * 1024;
const PDF_MAGIC = 0x25; // '%' — first byte of "%PDF"

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

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'POST only' });

    const ct = req.headers.get('content-type') || '';
    if (!ct.startsWith('multipart/form-data')) {
      return json(400, { error: 'expected multipart/form-data' });
    }
    if (!env.DOCTRINE_INBOX_R2 || !env.DOCTRINE_META) {
      return json(500, { error: 'doctrine storage bindings missing' });
    }

    let form;
    try { form = await req.formData(); }
    catch (e) { return json(400, { error: 'bad form data: ' + e.message }); }

    const file = form.get('file');
    const title          = (form.get('title')          || '').toString().trim().slice(0, 240);
    const sourceUrl      = (form.get('source_url')     || '').toString().trim().slice(0, 500);
    const submitterEmail = (form.get('email')          || '').toString().trim().slice(0, 200);
    const categoryHint   = (form.get('category_hint')  || '').toString().trim().slice(0, 60);
    const notes          = (form.get('notes')          || '').toString().trim().slice(0, 1000);

    if (!file || typeof file === 'string') return json(400, { error: 'file field missing' });
    if (!title) return json(400, { error: 'title required' });

    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);

    if (bytes.byteLength < MIN_BYTES) {
      return json(400, { error: `file too small: ${bytes.byteLength} < ${MIN_BYTES}` });
    }
    if (bytes.byteLength > MAX_BYTES) {
      return json(413, { error: `file too large: ${bytes.byteLength} > ${MAX_BYTES}` });
    }
    if (bytes[0] !== PDF_MAGIC || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      return json(400, { error: 'not a PDF (magic bytes mismatch)' });
    }

    const sha = await sha256Hex(buf);
    const submissionId = sha.slice(0, 16) + '_' + Date.now().toString(36);

    // sha256-based dedup
    const dupRaw = await env.DOCTRINE_META.get(`sha/${sha}`);
    if (dupRaw) {
      let dup;
      try { dup = JSON.parse(dupRaw); } catch { dup = {}; }
      return json(200, {
        ok: true,
        duplicate: true,
        submission_id: dup.submission_id || null,
        message: 'This document is already in the queue or accepted earlier.',
      });
    }

    // Store PDF in R2
    await env.DOCTRINE_INBOX_R2.put(`pdf/${submissionId}.pdf`, buf, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { sha256: sha, submission_id: submissionId },
    });

    // Store metadata + dedup index in KV
    const meta = {
      submission_id: submissionId,
      title,
      source_url: sourceUrl,
      submitter_email: submitterEmail,
      category_hint: categoryHint,
      notes,
      sha256: sha,
      size_bytes: bytes.byteLength,
      submitted_at: new Date().toISOString(),
      status: 'pending',
      filename: file.name || `${title.slice(0, 60)}.pdf`,
    };
    await env.DOCTRINE_META.put(`meta/${submissionId}`, JSON.stringify(meta));
    await env.DOCTRINE_META.put(`sha/${sha}`, JSON.stringify({ submission_id: submissionId, sha256: sha }));

    return json(200, {
      ok: true,
      submission_id: submissionId,
      sha256_prefix: sha.slice(0, 12),
      message: 'Submission received. It will appear in the audit queue.',
    });
  },
};
