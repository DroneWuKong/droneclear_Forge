// Authentication is the existing Forge account/session system. These grants
// are independent of catalog organization membership and product publication.
export const DEVELOPER_SITES = Object.freeze({
  'orqa-reference': {origin:'https://dev.prismoprime.com', name:'Orqa Developer Reference'},
  'prismo-full': {origin:'https://labs.prismoprime.com', name:'Prismo Developer Lab'},
});
export const developerSiteOrigin = site => DEVELOPER_SITES[site]?.origin || null;
const reply = (status, data) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const verified = p => p?.kind === 'PARTNER' && p.emailVerified === true;
export function developerOwner(env, principal) {
  // The configured owner must prove ownership of the email through the existing
  // single-use Forge verification flow. Client-supplied identity is never used.
  const owner = String(env.DEVELOPER_HUB_OWNER_EMAIL || '').trim().toLowerCase();
  return Boolean(owner && verified(principal) && principal.email?.toLowerCase() === owner);
}
async function emailReady(env) {
  try { const r=await env.PARTNER_EMAIL.fetch('https://partner-email.internal/health'); const j=await r.json(); return r.ok && j.configured === true && j.developerApprovalConfigured === true; }
  catch {return false;}
}
async function readBody(request) {
  if (Number(request.headers.get('Content-Length') || 0)>8192) return null;
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>8192) return null;
  try {const value=JSON.parse(raw);return value && typeof value==='object'&&!Array.isArray(value)?value:null;}catch{return null;}
}
export async function handleDeveloperHubAccess(request, env, principal, segments) {
  if(request.method==='GET' && segments[1]==='readiness') {
    const rows=await env.ECOSYSTEM_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ecosystem_developer_hub_access','ecosystem_developer_hub_notifications')").all();
    const ready=Boolean(env.DEVELOPER_HUB_OWNER_EMAIL && rows.results?.length===2 && await emailReady(env));
    return reply(ready?200:503,{ready,protocol:'developer-hub-access.v1'});
  }
  if (!verified(principal)) return reply(principal ? 403 : 401,{error:'Sign in and verify your email before requesting developer access.',emailVerified:false});
  const db=env.ECOSYSTEM_DB, owner=developerOwner(env,principal), url=new URL(request.url);
  const account=principal.subject.slice('partner:'.length);
  if (request.method==='GET' && segments[1]==='status') {
    const site=url.searchParams.get('site');
    if(!DEVELOPER_SITES[site])return reply(400,{error:'Unknown developer site.'});
    const row=await db.prepare('SELECT status, requested_at_ms, updated_at_ms FROM ecosystem_developer_hub_access WHERE account_id = ? AND site = ?').bind(account,site).first();
    return reply(200,{site,status:owner?'APPROVED':row?.status || 'NONE',canReview:owner,email:principal.email,name:principal.name,requestedAtMs:row?.requested_at_ms||null});
  }
  if(request.method==='GET' && segments[1]==='requests') {
    if(!owner)return reply(403,{error:'Site owner approval access required.'});
    const rows=await db.prepare(`SELECT r.*, a.email, a.name, n.status AS email_status FROM ecosystem_developer_hub_access r
      JOIN ecosystem_partner_accounts a ON a.account_id=r.account_id
      LEFT JOIN ecosystem_developer_hub_notifications n ON n.request_id=r.request_id
      ORDER BY r.updated_at_ms DESC LIMIT 500`).all();
    return reply(200,{requests:rows.results||[]});
  }
  if(request.method!=='POST')return reply(405,{error:'Use POST for access changes.'});
  const input=await readBody(request);
  if(!input)return reply(400,{error:'Send JSON up to 8 KB.'});
  if(segments[1]==='request') {
    const site=input.site;
    if(!DEVELOPER_SITES[site])return reply(400,{error:'Unknown developer site.'});
    const existing=await db.prepare('SELECT request_id,status FROM ecosystem_developer_hub_access WHERE account_id = ? AND site = ?').bind(account,site).first();
    if(existing)return reply(200,{status:existing.status,requestId:existing.request_id});
    if(!env.DEVELOPER_HUB_OWNER_EMAIL || !await emailReady(env))return reply(503,{error:'Access request email is unavailable. Please try again shortly.'});
    const reason=String(input.reason||'').trim();
    if(reason.length>1200)return reply(400,{error:'Keep the access reason under 1,200 characters.'});
    const id=crypto.randomUUID(), now=Date.now();
    // One transaction and unique account/site key prevent duplicate signup mail.
    try {await db.batch([
      db.prepare(`INSERT INTO ecosystem_developer_hub_access (request_id,account_id,site,status,reason,requested_at_ms,updated_at_ms)
        VALUES (?,?,?,'PENDING',?,?,?)`).bind(id,account,site,reason,now,now),
      db.prepare("INSERT INTO ecosystem_developer_hub_notifications (request_id,status,updated_at_ms) VALUES (?,'PENDING',?)").bind(id,now),
    ]);}catch(error){if(!/UNIQUE/i.test(error.message))throw error;return reply(200,{status:'PENDING'});}
    try{await env.PARTNER_EMAIL.fetch('https://partner-email.internal/dispatch',{method:'POST'});}catch{/* Durable queue retries. */}
    return reply(201,{status:'PENDING',requestId:id,message:'Your request is saved and the owner notification is queued.'});
  }
  if(segments[1]==='review') {
    if(!owner)return reply(403,{error:'Only the verified site owner can approve access.'});
    if(!['APPROVED','REJECTED','REVOKED'].includes(input.status)||!/^[a-zA-Z0-9-]{20,80}$/.test(input.requestId||''))return reply(400,{error:'Choose a request and approval decision.'});
    const result=await db.prepare('UPDATE ecosystem_developer_hub_access SET status=?,updated_at_ms=?,reviewed_by=? WHERE request_id=?').bind(input.status,Date.now(),principal.subject,input.requestId).run();
    if(result.meta.changes!==1)return reply(404,{error:'Access request not found.'});
    return reply(200,{status:input.status,requestId:input.requestId});
  }
  return reply(404,{error:'Developer access route not found.'});
}

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function deliverDeveloperHubEmails(env) {
  if(!env.DEVELOPER_HUB_OWNER_EMAIL)return;
  const db=env.ECOSYSTEM_DB,now=Date.now();
  const rows=await db.prepare(`SELECT n.request_id,r.site,r.reason,a.email,a.name FROM ecosystem_developer_hub_notifications n
    JOIN ecosystem_developer_hub_access r ON r.request_id=n.request_id
    JOIN ecosystem_partner_accounts a ON a.account_id=r.account_id
    WHERE (n.status='PENDING' OR (n.status='SENDING' AND n.updated_at_ms<?)) AND n.attempts<5
      AND r.status='PENDING' AND a.status='ACTIVE' AND a.email_verified_at_ms IS NOT NULL LIMIT 20`).bind(now-60000).all();
  for(const row of rows.results||[]) {
    const claim=await db.prepare(`UPDATE ecosystem_developer_hub_notifications SET status='SENDING',attempts=attempts+1,updated_at_ms=?
      WHERE request_id=? AND (status='PENDING' OR (status='SENDING' AND updated_at_ms<?)) AND attempts<5`).bind(now,row.request_id,now-60000).run();
    if(claim.meta.changes!==1)continue;
    const site=DEVELOPER_SITES[row.site],review=site.origin+'/access-admin?request='+encodeURIComponent(row.request_id);
    try {
      await env.EMAIL.send({to:env.DEVELOPER_HUB_OWNER_EMAIL,from:{email:'accounts@uas-forge.com',name:'Prismo Developer Access'},subject:'Approval requested: '+site.name,
        text:`${row.name} (${row.email}) requested ${site.name}.\n\n${row.reason}\n\nReview: ${review}\n\nSign in as the owner to approve, reject or revoke. Opening this link does not grant access.`,
        html:`<h2>Developer access request</h2><p>${escape(row.name)} (${escape(row.email)}) requested ${escape(site.name)}.</p><p>${escape(row.reason)}</p><p><a href="${escape(review)}">Review request</a></p><p>Owner login and an explicit approval are required.</p>`});
      await db.prepare("UPDATE ecosystem_developer_hub_notifications SET status='SENT',updated_at_ms=? WHERE request_id=?").bind(Date.now(),row.request_id).run();
    }catch{
      await db.prepare("UPDATE ecosystem_developer_hub_notifications SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,updated_at_ms=? WHERE request_id=?").bind(Date.now(),row.request_id).run();
      console.error(JSON.stringify({event:'developer-access-email-failed',requestId:row.request_id}));
    }
  }
}
