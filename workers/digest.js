/**
 * workers/digest.js
 * =================
 * PIE email digest — the missing return-trigger (Tier 2).
 *
 * PIE updates daily but had no outbound channel except RSS, so nothing pulled
 * people back. This adds an opt-in email digest built on the flag-state ledger
 * (pie_delta) we already produce: a Smart-Brevity "what changed since yesterday"
 * brief delivered on a schedule.
 *
 * Routes (mounted under /api/digest/* by workers/index.js):
 *   POST /api/digest/subscribe      {email, cadence?}  → store pending, email confirm link
 *   GET  /api/digest/confirm        ?e=&t=             → double-opt-in confirm
 *   GET  /api/digest/unsubscribe    ?e=&t=             → one-click unsubscribe
 *   GET  /api/digest/preview        [?cadence=]        → render the digest HTML (no send)
 *   POST /api/digest/send           {cadence}          → admin-gated broadcast (cron-driven)
 *   POST /api/digest/notify         [?force=1]         → admin-gated Slack/Teams push
 *
 * Storage — KV namespace DIGEST_SUBS:
 *   sub/<email>  -> {email, status:'pending'|'confirmed'|'unsubscribed', cadence, token, created, confirmed_at}
 *
 * Sending is PROVIDER-GATED and SAFE BY DEFAULT: with no RESEND_API_KEY +
 * DIGEST_FROM configured, subscribe still stores the address and send is a
 * logged no-op. Nothing is emailed until the owner provisions a provider and a
 * verified sending domain (SPF/DKIM). See docs/PIE_DIGEST.md.
 *
 * Secrets / vars (CF dashboard or `wrangler secret put`):
 *   RESEND_API_KEY     — email provider key (https://resend.com)
 *   DIGEST_FROM        — verified From, e.g. "PIE <brief@uas-patterns.com>"
 *   DIGEST_ADMIN_KEY   — gates POST /api/digest/send + /api/digest/notify (X-Digest-Key)
 *   DIGEST_BASE_URL    — public origin for links (default https://uas-patterns.com)
 *   SLACK_WEBHOOK_URL  — optional; incoming-webhook URL for Slack pushes
 *   TEAMS_WEBHOOK_URL  — optional; incoming-webhook URL for Microsoft Teams pushes
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Digest-Key',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BROADCAST = 5000;   // safety cap per send

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function htmlResp(status, body) {
  return new Response(body, {
    status, headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}
function token() {
  return crypto.randomUUID().replace(/-/g, '');
}
function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}
function baseUrl(env) {
  return (env.DIGEST_BASE_URL || 'https://uas-patterns.com').replace(/\/$/, '');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── Email provider (Resend). Returns {sent} or {skipped:reason}. ──────────────
async function sendEmail(env, to, subject, html, headers = {}) {
  if (!env.RESEND_API_KEY || !env.DIGEST_FROM) {
    return { skipped: 'provider_not_configured' };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.DIGEST_FROM, to: [to], subject, html, headers }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return { error: `provider_${r.status}`, detail: t.slice(0, 200) };
  }
  return { sent: true };
}

// ── Digest content (Smart-Brevity) built from the live KV data. ──────────────
async function loadKV(env, key) {
  try {
    const raw = await env.PIE_OUTPUTS.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

async function buildDigest(env) {
  const [delta, brief, flagsRaw] = await Promise.all([
    loadKV(env, 'pie_delta'),
    loadKV(env, 'pie_brief'),
    loadKV(env, 'flags'),
  ]);
  const flags = Array.isArray(flagsRaw) ? flagsRaw : (flagsRaw && flagsRaw.data) || [];
  const date = (delta && delta.date) || (brief && brief.date) || new Date().toISOString().slice(0, 10);

  const nc = delta ? (delta.new_count || 0) : 0;
  const ec = delta ? (delta.escalated_count || 0) : 0;
  const rc = delta ? (delta.resolved_count || 0) : 0;
  const vs = delta ? delta.vs_yesterday : '';

  // Headline movement line.
  const moved = [];
  if (nc) moved.push(`${nc} new`);
  if (ec) moved.push(`${ec} escalated`);
  if (rc) moved.push(`${rc} resolved`);
  const movementLine = moved.length ? moved.join(' · ') : (vs || 'No change since yesterday');

  // Lead titles: escalated first, then new (cap 5).
  const lead = [
    ...((delta && delta.escalated_flags) || []).map(e => ({ t: e.title, tag: 'ESCALATED', c: '#ef4444' })),
    ...((delta && delta.new_flags) || []).map(n => ({ t: n.title, tag: 'NEW', c: '#22c55e' })),
  ].filter(x => x.t).slice(0, 5);

  // If nothing moved, fall back to the top critical flags so the email still has substance.
  const topCritical = flags
    .filter(f => f.severity === 'critical')
    .slice(0, 5)
    .map(f => ({ t: f.title, tag: 'CRITICAL', c: '#ef4444' }));

  const items = lead.length ? lead : topCritical;
  const fcc = (brief && brief.fcc_countdown) || {};
  const headline = (brief && brief.headline) || '';
  return { date, movementLine, items, fcc, headline, hasMovement: lead.length > 0 };
}

function renderDigestHTML(env, d, sub) {
  const B = baseUrl(env);
  const unsub = sub
    ? `${B}/api/digest/unsubscribe?e=${encodeURIComponent(sub.email)}&t=${sub.token}`
    : `${B}/api/digest/unsubscribe`;
  const itemRows = d.items.map(it => `
    <tr><td style="padding:8px 0;border-bottom:1px solid #1c1c17">
      <span style="font:700 10px ui-monospace,monospace;color:${it.c};letter-spacing:.05em">${esc(it.tag)}</span>
      <div style="font:600 15px -apple-system,Segoe UI,sans-serif;color:#e8e8e3;margin-top:3px;line-height:1.4">${esc(it.t).slice(0, 140)}</div>
    </td></tr>`).join('');
  const fccLine = d.fcc && d.fcc.days_remaining
    ? `<p style="font:500 13px ui-monospace,monospace;color:#f97316;margin:18px 0 0">⏳ FCC Blue UAS exemption: ${d.fcc.days_remaining} days remaining (Jan 1, 2027)</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#0c0c0a;padding:24px 12px">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#141410;border-radius:12px;border:1px solid #1c1c17">
    <tr><td style="padding:24px 24px 8px">
      <div style="font:800 13px ui-monospace,monospace;color:#22d3ee;letter-spacing:.12em">PIE — PATTERN INTELLIGENCE</div>
      <div style="font:600 12px ui-monospace,monospace;color:#8a8a82;margin-top:4px">Daily brief · ${esc(d.date)}</div>
      <div style="margin-top:14px;padding:10px 14px;background:#0c0c0a;border-left:3px solid #22c55e;border-radius:6px">
        <span style="font:700 10px ui-monospace,monospace;color:#8a8a82;letter-spacing:.06em">SINCE YESTERDAY</span>
        <div style="font:600 15px -apple-system,Segoe UI,sans-serif;color:#e8e8e3;margin-top:3px">${esc(d.movementLine)}</div>
      </div>
      ${d.headline ? `<p style="font:600 16px -apple-system,Segoe UI,sans-serif;color:#e8e8e3;margin:18px 0 4px;line-height:1.4">${esc(d.headline).slice(0, 200)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:4px 24px">
      <div style="font:700 10px ui-monospace,monospace;color:#8a8a82;letter-spacing:.06em;margin-bottom:4px">${d.hasMovement ? "WHAT MOVED" : "TOP CRITICAL SIGNALS"}</div>
      <table role="presentation" width="100%">${itemRows || '<tr><td style="font:14px sans-serif;color:#8a8a82;padding:8px 0">No signals to report.</td></tr>'}</table>
      ${fccLine}
    </td></tr>
    <tr><td style="padding:20px 24px 24px">
      <a href="${B}/patterns/" style="display:inline-block;background:#22d3ee;color:#0c0c0a;font:700 13px -apple-system,Segoe UI,sans-serif;text-decoration:none;padding:10px 18px;border-radius:8px">Open the full board →</a>
      <p style="font:11px ui-monospace,monospace;color:#5a5a52;margin:18px 0 0;line-height:1.5">
        You're getting this because you subscribed at uas-patterns.com.<br>
        <a href="${unsub}" style="color:#8a8a82">Unsubscribe</a> · Intelligence is probabilistic; verify before acting.
      </p>
    </td></tr>
  </table></body></html>`;
}

// ── Handlers ─────────────────────────────────────────────────────────────────
async function subscribe(req, env) {
  if (!env.DIGEST_SUBS) return json(503, { error: 'subscriber store not configured' });
  let body;
  try { body = await req.json(); } catch (e) { return json(400, { error: 'invalid JSON' }); }
  const email = normEmail(body.email);
  const cadence = body.cadence === 'weekly' ? 'weekly' : 'daily';
  if (!EMAIL_RE.test(email) || email.length > 200) return json(400, { error: 'invalid email' });
  // Optional watchlist (array of topic keys, e.g. "component:...", "type:...").
  // Stored for future per-subscriber digest personalization. Bounded + sanitized.
  const watch = Array.isArray(body.watch)
    ? body.watch.filter(w => typeof w === 'string' && w.length <= 80).slice(0, 50)
    : [];

  const key = `sub/${email}`;
  const existing = await env.DIGEST_SUBS.get(key, 'json');
  // Already confirmed → generic OK (don't reveal subscription state).
  if (existing && existing.status === 'confirmed') {
    return json(200, { ok: true, status: 'already_subscribed' });
  }
  const rec = {
    email, cadence,
    status: 'pending',
    token: (existing && existing.token) || token(),
    created: (existing && existing.created) || new Date().toISOString(),
    watch: watch.length ? watch : ((existing && existing.watch) || []),
  };
  await env.DIGEST_SUBS.put(key, JSON.stringify(rec));

  const B = baseUrl(env);
  const confirmUrl = `${B}/api/digest/confirm?e=${encodeURIComponent(email)}&t=${rec.token}`;
  const html = `<!doctype html><body style="background:#0c0c0a;padding:32px;font-family:-apple-system,Segoe UI,sans-serif">
    <div style="max-width:480px;margin:0 auto;background:#141410;border-radius:12px;padding:28px;color:#e8e8e3">
      <div style="font:800 13px ui-monospace,monospace;color:#22d3ee;letter-spacing:.12em">PIE — PATTERN INTELLIGENCE</div>
      <p style="font-size:16px;line-height:1.5;margin:18px 0">Confirm your subscription to the PIE ${esc(cadence)} brief.</p>
      <a href="${confirmUrl}" style="display:inline-block;background:#22d3ee;color:#0c0c0a;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:8px">Confirm subscription</a>
      <p style="font:12px ui-monospace,monospace;color:#5a5a52;margin-top:20px">If you didn't request this, ignore this email — you won't be subscribed.</p>
    </div></body>`;
  const mail = await sendEmail(env, email, 'Confirm your PIE brief subscription', html);

  return json(200, {
    ok: true,
    status: 'pending_confirmation',
    // Surface (without leaking) whether email actually went out, for ops.
    email_sent: !!mail.sent,
    note: mail.sent ? undefined : 'confirmation email not sent (provider not configured) — record stored as pending',
  });
}

async function confirm(req, env) {
  if (!env.DIGEST_SUBS) return htmlResp(503, '<p>subscriber store not configured</p>');
  const url = new URL(req.url);
  const email = normEmail(url.searchParams.get('e'));
  const t = url.searchParams.get('t') || '';
  const key = `sub/${email}`;
  const rec = await env.DIGEST_SUBS.get(key, 'json');
  if (!rec || rec.token !== t) return htmlResp(400, _page('Invalid or expired confirmation link.'));
  rec.status = 'confirmed';
  rec.confirmed_at = new Date().toISOString();
  await env.DIGEST_SUBS.put(key, JSON.stringify(rec));
  return htmlResp(200, _page(`You're in. The PIE ${esc(rec.cadence)} brief will land in your inbox.`, true));
}

async function unsubscribe(req, env) {
  if (!env.DIGEST_SUBS) return htmlResp(503, '<p>subscriber store not configured</p>');
  const url = new URL(req.url);
  const email = normEmail(url.searchParams.get('e'));
  const t = url.searchParams.get('t') || '';
  const key = `sub/${email}`;
  const rec = await env.DIGEST_SUBS.get(key, 'json');
  if (rec && rec.token === t) {
    rec.status = 'unsubscribed';
    rec.unsubscribed_at = new Date().toISOString();
    await env.DIGEST_SUBS.put(key, JSON.stringify(rec));
  }
  // Always show success (don't leak whether the address was subscribed).
  return htmlResp(200, _page('Unsubscribed. You won\'t receive further PIE briefs.'));
}

async function preview(req, env) {
  const url = new URL(req.url);
  const d = await buildDigest(env);
  return htmlResp(200, renderDigestHTML(env, d, null));
}

async function send(req, env) {
  // Admin-gated broadcast — intended to be called by the daily pipeline.
  const provided = req.headers.get('X-Digest-Key') || '';
  if (!env.DIGEST_ADMIN_KEY) return json(503, { error: 'DIGEST_ADMIN_KEY not configured' });
  if (provided !== env.DIGEST_ADMIN_KEY) return json(401, { error: 'unauthorized' });
  if (!env.DIGEST_SUBS) return json(503, { error: 'subscriber store not configured' });

  let cadence = 'daily';
  try { const b = await req.json(); if (b && b.cadence === 'weekly') cadence = 'weekly'; } catch (e) {}

  const d = await buildDigest(env);
  const subject = `PIE brief — ${d.date}${d.hasMovement ? ` · ${d.movementLine}` : ''}`.slice(0, 120);

  let sent = 0, skipped = 0, failed = 0, scanned = 0;
  let cursor;
  do {
    const list = await env.DIGEST_SUBS.list({ prefix: 'sub/', cursor, limit: 1000 });
    for (const k of list.keys) {
      if (scanned >= MAX_BROADCAST) break;
      const rec = await env.DIGEST_SUBS.get(k.name, 'json');
      if (!rec || rec.status !== 'confirmed' || rec.cadence !== cadence) { skipped++; continue; }
      scanned++;
      const html = renderDigestHTML(env, d, rec);
      const unsub = `${baseUrl(env)}/api/digest/unsubscribe?e=${encodeURIComponent(rec.email)}&t=${rec.token}`;
      const r = await sendEmail(env, rec.email, subject, html, {
        'List-Unsubscribe': `<${unsub}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      });
      if (r.sent) sent++;
      else if (r.skipped) { skipped++; }
      else failed++;
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor && scanned < MAX_BROADCAST);

  return json(200, { ok: true, cadence, date: d.date, sent, skipped, failed,
    provider_configured: !!(env.RESEND_API_KEY && env.DIGEST_FROM) });
}

async function postWebhook(url, payload) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return r.ok ? { sent: true } : { error: `http_${r.status}` };
  } catch (e) { return { error: String(e && e.message) }; }
}

// Slack / Teams push (Tier 2 #9) — pings a channel when something CRITICAL or
// ESCALATED moved today, so teams don't have to remember to check the board.
// Admin-gated, called by the daily pipeline. Severity-tiered to avoid alert
// fatigue: silent unless there's new-critical or escalated movement (?force=1
// overrides). No-op if no webhook URL is configured.
async function notify(req, env) {
  const provided = req.headers.get('X-Digest-Key') || '';
  if (!env.DIGEST_ADMIN_KEY) return json(503, { error: 'DIGEST_ADMIN_KEY not configured' });
  if (provided !== env.DIGEST_ADMIN_KEY) return json(401, { error: 'unauthorized' });

  const delta = await loadKV(env, 'pie_delta');
  const date = (delta && delta.date) || new Date().toISOString().slice(0, 10);
  const newCrit = (((delta && delta.new_flags) || []).filter(f => f && f.severity === 'critical'));
  const esc = (delta && delta.escalated_flags) || [];
  const force = new URL(req.url).searchParams.get('force') === '1';
  if (!newCrit.length && !esc.length && !force) {
    return json(200, { ok: true, skipped: 'no_material_movement', date });
  }
  if (!env.SLACK_WEBHOOK_URL && !env.TEAMS_WEBHOOK_URL) {
    return json(200, { ok: true, skipped: 'no_webhook_configured', date,
      new_critical: newCrit.length, escalated: esc.length });
  }

  const B = baseUrl(env);
  const lines = [
    ...esc.map(e => `⬆ *ESCALATED* — ${e.title}`),
    ...newCrit.map(n => `🔴 *NEW* — ${n.title}`),
  ].filter(Boolean).slice(0, 8).map(s => s.slice(0, 160));
  const summary = `PIE ${date}: ${newCrit.length} new critical · ${esc.length} escalated`;

  let slack = null, teams = null;
  if (env.SLACK_WEBHOOK_URL) {
    slack = await postWebhook(env.SLACK_WEBHOOK_URL, {
      text: summary,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `PIE — ${date}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*${summary}*\n${lines.join('\n') || '_movement below threshold_'}` } },
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open the board' }, url: `${B}/patterns/` }] },
      ],
    });
  }
  if (env.TEAMS_WEBHOOK_URL) {
    teams = await postWebhook(env.TEAMS_WEBHOOK_URL, {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: newCrit.length ? 'D7263D' : 'F59E0B',
      summary,
      title: `PIE — ${date}`,
      text: `**${summary}**`,
      sections: [{ text: lines.join('  \n') || '_movement below threshold_' }],
      potentialAction: [{ '@type': 'OpenUri', name: 'Open the board', targets: [{ os: 'default', uri: `${B}/patterns/` }] }],
    });
  }
  return json(200, { ok: true, date, new_critical: newCrit.length, escalated: esc.length,
    slack: slack || 'not_configured', teams: teams || 'not_configured' });
}

function _page(msg, ok = false) {
  return `<!doctype html><body style="background:#0c0c0a;padding:48px 24px;font-family:-apple-system,Segoe UI,sans-serif;text-align:center">
    <div style="max-width:440px;margin:0 auto;color:#e8e8e3">
      <div style="font:800 13px ui-monospace,monospace;color:#22d3ee;letter-spacing:.12em">PIE</div>
      <p style="font-size:18px;line-height:1.5;margin:20px 0;color:${ok ? '#22c55e' : '#e8e8e3'}">${msg}</p>
      <a href="${'/patterns/'}" style="color:#22d3ee;font:600 14px ui-monospace,monospace;text-decoration:none">← Back to the board</a>
    </div></body>`;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(req.url).pathname;
    try {
      if (path === '/api/digest/subscribe' && req.method === 'POST') return await subscribe(req, env);
      if (path === '/api/digest/confirm') return await confirm(req, env);
      if (path === '/api/digest/unsubscribe') return await unsubscribe(req, env);
      if (path === '/api/digest/preview') return await preview(req, env);
      if (path === '/api/digest/send' && req.method === 'POST') return await send(req, env);
      if (path === '/api/digest/notify' && req.method === 'POST') return await notify(req, env);
      return json(404, { error: 'unknown digest route' });
    } catch (e) {
      return json(500, { error: 'digest error: ' + (e && e.message) });
    }
  },
};
