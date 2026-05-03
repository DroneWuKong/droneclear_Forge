// Doctrine queue + admin actions.
// GET  /doctrine-queue                              -> list pending submissions (gated)
// GET  /doctrine-queue?id=<submission_id>           -> download the PDF (gated)
// POST /doctrine-queue {id, action, reason?}        -> approve/reject/recategorise (gated)
//
// Auth: X-Admin-Token header must equal env DOCTRINE_ADMIN_TOKEN. There is
// only one token; rotate it via Netlify env if compromised.
//
// "Approve" here just flips the status to "approved" so the Ai-Project
// intake script (scripts/doctrine_intake.py) will pick it up on the next
// daily run. The intake script does the real corpus copy + audit-log entry.

import { getStore } from '@netlify/blobs';

const VALID_ACTIONS = new Set(['approve', 'reject', 'recategorise']);

function unauthorized() {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401, headers: { 'Content-Type': 'application/json' }
  });
}

function checkToken(req) {
  const expected = process.env.DOCTRINE_ADMIN_TOKEN;
  if (!expected) return false;
  const got = req.headers.get('x-admin-token');
  return got && got === expected;
}

export default async (req) => {
  if (!checkToken(req)) return unauthorized();
  const url = new URL(req.url);
  const store = getStore('doctrine-inbox');

  // GET single PDF
  if (req.method === 'GET' && url.searchParams.get('id')) {
    const id = url.searchParams.get('id');
    const buf = await store.get(`pdf/${id}`, { type: 'arrayBuffer' });
    if (!buf) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }
    const meta = await store.get(`meta/${id}`, { type: 'json' });
    const filename = (meta && meta.filename) || `${id}.pdf`;
    return new Response(buf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  // GET list
  if (req.method === 'GET') {
    const filter = url.searchParams.get('status') || 'pending';
    const items = [];
    for await (const { key } of store.list({ prefix: 'meta/' })) {
      const m = await store.get(key, { type: 'json' });
      if (!m) continue;
      if (filter !== 'all' && m.status !== filter) continue;
      // Exclude raw PDF bytes from the list response
      items.push({
        submission_id: m.submission_id,
        title: m.title,
        source_url: m.source_url,
        category_hint: m.category_hint,
        sha256_prefix: (m.sha256 || '').slice(0, 12),
        size_bytes: m.size_bytes,
        submitted_at: m.submitted_at,
        status: m.status,
        filename: m.filename,
        decision_reason: m.decision_reason || null,
      });
    }
    items.sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));
    return new Response(JSON.stringify({ ok: true, items, count: items.length }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // POST decision
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const id = (body.id || '').toString();
    const action = (body.action || '').toString();
    const reason = (body.reason || '').toString().slice(0, 400);
    const newCategory = (body.category || '').toString().slice(0, 60);
    if (!id || !VALID_ACTIONS.has(action)) {
      return new Response(JSON.stringify({ error: 'bad id or action' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }
    const meta = await store.get(`meta/${id}`, { type: 'json' });
    if (!meta) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (action === 'approve')      meta.status = 'approved';
    else if (action === 'reject')  meta.status = 'rejected';
    else if (action === 'recategorise') {
      meta.status = 'pending';      // back to queue
      meta.category_hint = newCategory || meta.category_hint;
    }
    meta.decision_reason = reason || null;
    meta.decided_at = new Date().toISOString();
    await store.setJSON(`meta/${id}`, meta);
    return new Response(JSON.stringify({ ok: true, submission_id: id, status: meta.status }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'method not allowed' }), {
    status: 405, headers: { 'Content-Type': 'application/json' }
  });
};
