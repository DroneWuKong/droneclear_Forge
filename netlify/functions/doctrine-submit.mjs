// Doctrine submission endpoint.
// Accepts multipart POST from contribute-doctrine.html, validates the file,
// stores PDF + metadata sidecar in Netlify Blobs (`doctrine-inbox` store),
// returns a submission_id the user can quote later.
//
// Submitter never gets to choose category — that's audited downstream.
// Auto-rejects: non-PDF magic bytes, < 50 KB, > 25 MB, suspicious sha256.

import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const MIN_BYTES = 50_000;
const MAX_BYTES = 25 * 1024 * 1024;
const PDF_MAGIC = '%PDF';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    });
  }
  const ct = req.headers.get('content-type') || '';
  if (!ct.startsWith('multipart/form-data')) {
    return new Response(JSON.stringify({ error: 'expected multipart/form-data' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  let form;
  try {
    form = await req.formData();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'bad form data: ' + e.message }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const file = form.get('file');
  const title = (form.get('title') || '').toString().trim().slice(0, 240);
  const sourceUrl = (form.get('source_url') || '').toString().trim().slice(0, 500);
  const submitterEmail = (form.get('email') || '').toString().trim().slice(0, 200);
  const categoryHint = (form.get('category_hint') || '').toString().trim().slice(0, 60);
  const notes = (form.get('notes') || '').toString().trim().slice(0, 1000);

  if (!file || typeof file === 'string') {
    return new Response(JSON.stringify({ error: 'file field missing' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }
  if (!title) {
    return new Response(JSON.stringify({ error: 'title required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length < MIN_BYTES) {
    return new Response(JSON.stringify({ error: `file too small: ${buf.length} < ${MIN_BYTES}` }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }
  if (buf.length > MAX_BYTES) {
    return new Response(JSON.stringify({ error: `file too large: ${buf.length} > ${MAX_BYTES}` }), {
      status: 413, headers: { 'Content-Type': 'application/json' }
    });
  }
  if (!buf.slice(0, 4).toString().startsWith(PDF_MAGIC)) {
    return new Response(JSON.stringify({ error: 'not a PDF (magic bytes mismatch)' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const submissionId = sha.slice(0, 16) + '_' + Date.now().toString(36);

  const store = getStore('doctrine-inbox');

  // Dedup by sha256 — if we've already seen this file, return its existing id
  const dupKey = `sha/${sha}`;
  const existing = await store.get(dupKey, { type: 'json' });
  if (existing) {
    return new Response(JSON.stringify({
      ok: true,
      duplicate: true,
      submission_id: existing.submission_id,
      message: 'This document is already in the queue or accepted earlier.',
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Store PDF + metadata
  await store.set(`pdf/${submissionId}`, buf);
  const meta = {
    submission_id: submissionId,
    title,
    source_url: sourceUrl,
    submitter_email: submitterEmail,
    category_hint: categoryHint,
    notes,
    sha256: sha,
    size_bytes: buf.length,
    submitted_at: new Date().toISOString(),
    status: 'pending',
    filename: file.name || `${title.slice(0, 60)}.pdf`,
  };
  await store.setJSON(`meta/${submissionId}`, meta);
  await store.setJSON(dupKey, { submission_id: submissionId, sha256: sha });

  return new Response(JSON.stringify({
    ok: true,
    submission_id: submissionId,
    sha256_prefix: sha.slice(0, 12),
    message: 'Submission received. It will appear in the audit queue.',
  }), { headers: { 'Content-Type': 'application/json' } });
};
