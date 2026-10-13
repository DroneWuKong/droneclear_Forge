import { canonicalDigest } from './ecosystem-contracts.mjs';

const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2,'0')).join('');
const escape = value => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export async function deliverPartnerEmails(env) {
  const db = env.ECOSYSTEM_DB;
  const now = Date.now();
  await db.prepare('DELETE FROM ecosystem_partner_action_tokens WHERE expires_at_ms < ?').bind(now - 24 * 60 * 60_000).run();
  const requests = await db.prepare(`SELECT r.request_id, r.account_id, r.purpose, r.account_generation, a.email, a.email_verified_at_ms
    FROM ecosystem_partner_email_requests r JOIN ecosystem_partner_accounts a ON a.account_id = r.account_id
    WHERE (r.status = 'PENDING' OR (r.status = 'SENDING' AND r.updated_at_ms < ?))
      AND r.attempts < 5 AND a.status = 'ACTIVE' AND r.account_generation = a.account_generation
    ORDER BY r.created_at_ms LIMIT 20`).bind(now - 60_000).all();
  for (const request of requests.results || []) {
    const claim = await db.prepare(`UPDATE ecosystem_partner_email_requests SET status = 'SENDING', attempts = attempts + 1, updated_at_ms = ?
      WHERE request_id = ? AND (status = 'PENDING' OR (status = 'SENDING' AND updated_at_ms < ?)) AND attempts < 5`)
      .bind(now, request.request_id, now - 60_000).run();
    if (claim.meta.changes !== 1) continue;
    const verification = request.purpose === 'VERIFY_EMAIL';
    if (verification && request.email_verified_at_ms) {
      await db.prepare("UPDATE ecosystem_partner_email_requests SET status = 'SENT', updated_at_ms = ? WHERE request_id = ?").bind(now, request.request_id).run();
      continue;
    }
    const rawToken = token(), hash = await canonicalDigest(rawToken);
    const lifetime = verification ? 24 * 60 * 60_000 : 60 * 60_000;
    const link = `https://uas-forge.com/partners/#${verification ? 'verify' : 'reset'}=${rawToken}`;
    const subject = verification ? 'Verify your UAS Forge partner email' : 'Reset your UAS Forge password';
    const action = verification ? 'Verify email' : 'Reset password';
    await db.prepare(`INSERT INTO ecosystem_partner_action_tokens
      (token_hash, account_id, purpose, account_generation, created_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(hash, request.account_id, request.purpose, request.account_generation, now, now + lifetime).run();
    try {
      await env.EMAIL.send({
        to: request.email, from: {email:'accounts@uas-forge.com',name:'UAS Forge'}, subject,
        text: `${subject}\n\n${action}: ${link}\n\nThis link expires in ${verification ? '24 hours' : '1 hour'} and can be used once. If you did not request it, ignore this email.`,
        html: `<div style="font:16px/1.6 system-ui,sans-serif;max-width:560px"><h1 style="font-size:24px">${subject}</h1><p><a href="${escape(link)}">${action}</a></p><p>This link expires in ${verification ? '24 hours' : '1 hour'} and can be used once.</p><p>If you did not request it, ignore this email.</p></div>`,
      });
      await db.prepare("UPDATE ecosystem_partner_email_requests SET status = 'SENT', updated_at_ms = ? WHERE request_id = ?").bind(Date.now(), request.request_id).run();
    } catch {
      await db.batch([
        db.prepare('DELETE FROM ecosystem_partner_action_tokens WHERE token_hash = ?').bind(hash),
        db.prepare("UPDATE ecosystem_partner_email_requests SET status = CASE WHEN attempts >= 5 THEN 'FAILED' ELSE 'PENDING' END, updated_at_ms = ? WHERE request_id = ?").bind(Date.now(), request.request_id),
      ]);
      console.error(JSON.stringify({event:'partner-email-delivery-failed',requestId:request.request_id}));
    }
  }
}

export default {
  async scheduled(controller, env) { await deliverPartnerEmails(env); },
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/health') return Response.json({configured:typeof env.EMAIL?.send === 'function'});
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/dispatch') return new Response('Not found',{status:404});
    ctx.waitUntil(deliverPartnerEmails(env));
    return Response.json({queued:true},{status:202});
  },
};
