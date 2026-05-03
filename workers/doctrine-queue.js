/**
 * workers/doctrine-queue.js
 * =========================
 * Doctrine queue + admin actions (CF Pages Functions / Workers).
 * Replaces netlify/functions/doctrine-queue.mjs.
 *
 *   GET  /api/doctrine-queue                     -> list pending submissions (gated)
 *   GET  /api/doctrine-queue?id=<submission_id>  -> download the PDF (gated)
 *   POST /api/doctrine-queue {id, action, ...}   -> approve / reject / recategorise (gated)
 *
 * Auth: X-Admin-Token header must equal env.DOCTRINE_ADMIN_TOKEN.
 *
 * "Approve" flips the status field. The Ai-Project intake job
 * (scripts/doctrine_intake.py, daily 03:00 UTC) polls this endpoint and
 * pulls approved submissions into the local OSINT corpus tree.
 *
 * Bindings (from wrangler.jsonc):
 *   DOCTRINE_META          KV namespace, holds meta/* and sha/* records
 *   DOCTRINE_INBOX_R2      R2 bucket, holds pdf/<id>.pdf
 *   DOCTRINE_ADMIN_TOKEN   secret (set via `wrangler secret put` or CF dashboard)
 */

const VALID_ACTIONS = new Set(['approve', 'reject', 'recategorise']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function unauthorized() { return json(401, { error: 'unauthorized' }); }

function checkToken(req, env) {
  const expected = env.DOCTRINE_ADMIN_TOKEN;
  if (!expected) return false;
  const got = req.headers.get('x-admin-token');
  return got && got === expected;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!env.DOCTRINE_META || !env.DOCTRINE_INBOX_R2) {
      return json(500, { error: 'doctrine storage bindings missing' });
    }
    if (!checkToken(req, env)) return unauthorized();

    const url = new URL(req.url);

    // GET single PDF
    if (req.method === 'GET' && url.searchParams.get('id')) {
      const id = url.searchParams.get('id');
      const obj = await env.DOCTRINE_INBOX_R2.get(`pdf/${id}.pdf`);
      if (!obj) return json(404, { error: 'not found' });
      const metaRaw = await env.DOCTRINE_META.get(`meta/${id}`);
      let filename = `${id}.pdf`;
      if (metaRaw) {
        try { filename = JSON.parse(metaRaw).filename || filename; } catch {}
      }
      return new Response(obj.body, {
        headers: {
          ...CORS,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // GET list
    if (req.method === 'GET') {
      const filter = url.searchParams.get('status') || 'pending';
      const items = [];

      // KV list is paginated; iterate until exhausted
      let cursor = undefined;
      do {
        const page = await env.DOCTRINE_META.list({ prefix: 'meta/', cursor });
        for (const k of page.keys) {
          const raw = await env.DOCTRINE_META.get(k.name);
          if (!raw) continue;
          let m;
          try { m = JSON.parse(raw); } catch { continue; }
          if (filter !== 'all' && m.status !== filter) continue;
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
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);

      items.sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));
      return json(200, { ok: true, items, count: items.length });
    }

    // POST decision
    if (req.method === 'POST') {
      let body = {};
      try { body = await req.json(); } catch {}
      const id     = (body.id     || '').toString();
      const action = (body.action || '').toString();
      const reason = (body.reason || '').toString().slice(0, 400);
      const newCategory = (body.category || '').toString().slice(0, 60);
      if (!id || !VALID_ACTIONS.has(action)) {
        return json(400, { error: 'bad id or action' });
      }

      const raw = await env.DOCTRINE_META.get(`meta/${id}`);
      if (!raw) return json(404, { error: 'not found' });
      let meta;
      try { meta = JSON.parse(raw); }
      catch { return json(500, { error: 'meta parse error' }); }

      if (action === 'approve')      meta.status = 'approved';
      else if (action === 'reject')  meta.status = 'rejected';
      else if (action === 'recategorise') {
        meta.status = 'pending';
        meta.category_hint = newCategory || meta.category_hint;
      }
      meta.decision_reason = reason || null;
      meta.decided_at = new Date().toISOString();
      await env.DOCTRINE_META.put(`meta/${id}`, JSON.stringify(meta));

      return json(200, { ok: true, submission_id: id, status: meta.status });
    }

    return json(405, { error: 'method not allowed' });
  },
};
