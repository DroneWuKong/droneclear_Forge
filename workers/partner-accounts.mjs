import { canonicalDigest } from './ecosystem-contracts.mjs';

const COOKIE = '__Secure-forge_partner';
const COOKIE_PATH = '/api/ecosystem/v1';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g) || [], byte => parseInt(byte, 16));
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));

function reply(status, value, cookie) {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(cookie ? { 'Set-Cookie': cookie } : {}),
  } });
}

function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return `${COOKIE}=${token}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function cookieToken(request) {
  const value = (request.headers.get('Cookie') || '').split(';').map(item => item.trim()).find(item => item.startsWith(COOKIE + '='));
  const token = value?.slice(COOKIE.length + 1);
  return /^[0-9a-f]{64}$/.test(token || '') ? token : null;
}

export function sameOriginMutation(request) {
  return request.headers.get('Origin') === new URL(request.url).origin &&
    request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}

async function passwordHash(password, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations }, key, 256));
}

function equalHash(left, right) {
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

export async function authenticatePartner(request, env) {
  const token = cookieToken(request);
  if (!token) return null;
  const row = await env.ECOSYSTEM_DB.prepare(`SELECT a.account_id, a.email, a.name, a.email_verified_at_ms
    FROM ecosystem_partner_sessions s JOIN ecosystem_partner_accounts a ON a.account_id = s.account_id
    WHERE s.token_hash = ? AND s.expires_at_ms > ? AND a.status = 'ACTIVE' AND s.account_generation = a.account_generation`)
    .bind(await canonicalDigest(token), Date.now()).first();
  return row ? { kind: 'PARTNER', subject: `partner:${row.account_id}`, email: row.email, name: row.name, emailVerified: row.email_verified_at_ms != null } : null;
}

async function limited(db, bucket, ceiling, duration) {
  const window = Math.floor(Date.now() / duration) * duration;
  const results = await db.batch([
    db.prepare(`INSERT INTO ecosystem_partner_auth_windows (bucket, window_start_ms, request_count) VALUES (?, ?, 1)
      ON CONFLICT (bucket, window_start_ms) DO UPDATE SET request_count = request_count + 1`).bind(bucket, window),
    db.prepare('SELECT request_count FROM ecosystem_partner_auth_windows WHERE bucket = ? AND window_start_ms = ?').bind(bucket, window),
  ]);
  return (results[1].results?.[0]?.request_count || 0) > ceiling;
}

async function issueSession(db, request, accountId, generation = 0) {
  const token = randomToken();
  const now = Date.now();
  const oldToken = cookieToken(request);
  const statements = [
    db.prepare('DELETE FROM ecosystem_partner_sessions WHERE expires_at_ms <= ?').bind(now),
    db.prepare(`INSERT INTO ecosystem_partner_sessions (token_hash, account_id, created_at_ms, expires_at_ms, account_generation)
      SELECT ?, account_id, ?, ?, account_generation FROM ecosystem_partner_accounts WHERE account_id = ? AND account_generation = ? AND status = 'ACTIVE'`)
      .bind(await canonicalDigest(token), now, now + SESSION_SECONDS * 1000, accountId, generation),
  ];
  if (oldToken) statements.push(db.prepare('DELETE FROM ecosystem_partner_sessions WHERE token_hash = ?').bind(await canonicalDigest(oldToken)));
  const results = await db.batch(statements);
  return results[1].meta.changes === 1 ? sessionCookie(token) : null;
}

async function emailReady(env) {
  if (!env.PARTNER_EMAIL) return false;
  try {
    const response = await env.PARTNER_EMAIL.fetch('https://partner-email.internal/health');
    return response.ok && (await response.json()).configured === true;
  } catch { return false; }
}

async function queueEmail(db, accountId, purpose, generation) {
  const now = Date.now();
  await db.prepare(`INSERT INTO ecosystem_partner_email_requests
    (request_id, account_id, purpose, account_generation, status, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`).bind(crypto.randomUUID(), accountId, purpose, generation, now, now).run();
}

async function dispatchEmail(env) {
  try { await env.PARTNER_EMAIL.fetch('https://partner-email.internal/dispatch', {method:'POST'}); } catch { /* The scheduled sender retries persisted requests. */ }
}

async function recoveryAction(request, env, action, input) {
  const db = env.ECOSYSTEM_DB;
  if (action === 'resend-verification') {
    const principal = await authenticatePartner(request, env);
    if (!principal) return reply(401, {error:'Log in to request a verification email.'});
    if (principal.emailVerified) return reply(200, {emailVerified:true});
    if (!await emailReady(env)) return reply(503, {error:'Email delivery is temporarily unavailable. Please try again shortly.'});
    if (await limited(db, await canonicalDigest('verify-email:' + principal.email), 3, 15 * 60_000)) return reply(429, {error:'Please wait 15 minutes before requesting another email.'});
    const account = await db.prepare('SELECT account_id, account_generation FROM ecosystem_partner_accounts WHERE email = ?').bind(principal.email).first();
    await queueEmail(db, account.account_id, 'VERIFY_EMAIL', account.account_generation);
    await dispatchEmail(env);
    return reply(200, {message:'Verification email queued. Check your inbox shortly.'});
  }
  if (action === 'request-reset') {
    const email = String(input.email || '').trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, {error:'Enter a valid email address.'});
    if (!await emailReady(env)) return reply(503, {error:'Email delivery is temporarily unavailable. Please try again shortly.'});
    if (await limited(db, await canonicalDigest('reset-email:' + email), 3, 15 * 60_000)) return reply(429, {error:'Please wait 15 minutes before requesting another email.'});
    const now = Date.now();
    // The same SQL, sender dispatch, and response serve known and unknown emails.
    await db.prepare(`INSERT INTO ecosystem_partner_email_requests
      (request_id, account_id, purpose, account_generation, status, created_at_ms, updated_at_ms)
      SELECT ?, account_id, 'RESET_PASSWORD', account_generation, 'PENDING', ?, ?
      FROM ecosystem_partner_accounts WHERE email = ? AND status = 'ACTIVE'`)
      .bind(crypto.randomUUID(), now, now, email).run();
    await dispatchEmail(env);
    return reply(200, {message:'If an account uses this email, a password reset link will arrive shortly.'});
  }
  if (!/^[0-9a-f]{64}$/.test(input.token || '')) return reply(400, {error:'This link is invalid or expired. Request a new email.'});
  const hash = await canonicalDigest(input.token), now = Date.now();
  const purpose = action === 'verify-email' ? 'VERIFY_EMAIL' : 'RESET_PASSWORD';
  const token = await db.prepare(`SELECT t.account_id, t.account_generation FROM ecosystem_partner_action_tokens t
    JOIN ecosystem_partner_accounts a ON a.account_id = t.account_id
    WHERE t.token_hash = ? AND t.purpose = ? AND t.consumed_at_ms IS NULL AND t.expires_at_ms > ?
      AND t.account_generation = a.account_generation AND a.status = 'ACTIVE'`).bind(hash, purpose, now).first();
  if (!token) return reply(400, {error:'This link is invalid or expired. Request a new email.'});
  let update;
  if (action === 'verify-email') {
    update = db.prepare(`UPDATE ecosystem_partner_accounts SET email_verified_at_ms = ? WHERE account_id = ?
      AND email_verified_at_ms IS NULL AND account_generation = ? AND EXISTS (SELECT 1 FROM ecosystem_partner_action_tokens
        WHERE token_hash = ? AND consumed_at_ms IS NULL AND expires_at_ms > ?)`)
      .bind(now, token.account_id, token.account_generation, hash, now);
  } else {
    if (typeof input.password !== 'string' || input.password.length < 15 || input.password.length > 128) return reply(400, {error:'Choose a password with 15–128 characters.'});
    const salt = randomToken(), password = await passwordHash(input.password, salt);
    update = db.prepare(`UPDATE ecosystem_partner_accounts SET password_hash = ?, password_salt = ?, password_iterations = ?,
      account_generation = account_generation + 1, email_verified_at_ms = COALESCE(email_verified_at_ms, ?) WHERE account_id = ? AND account_generation = ?
      AND EXISTS (SELECT 1 FROM ecosystem_partner_action_tokens WHERE token_hash = ? AND consumed_at_ms IS NULL AND expires_at_ms > ?)`)
      .bind(password, salt, ITERATIONS, now, token.account_id, token.account_generation, hash, now);
  }
  const statements = [update,
    db.prepare('UPDATE ecosystem_partner_action_tokens SET consumed_at_ms = ? WHERE token_hash = ? AND consumed_at_ms IS NULL').bind(now, hash),
  ];
  if (action === 'reset-password') statements.push(db.prepare('DELETE FROM ecosystem_partner_sessions WHERE account_id = ? AND account_generation <= ?').bind(token.account_id, token.account_generation));
  const results = await db.batch(statements);
  if (results[0].meta.changes !== 1) return reply(400, {error:'This link was already used. Request a new email.'});
  return action === 'verify-email' ? reply(200, {emailVerified:true,message:'Email verified. You can now submit complete products for review.'})
    : reply(200, {message:'Password updated. Log in with your new password.'}, sessionCookie('',0));
}

async function readInput(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return null;
  if (Number(request.headers.get('Content-Length') || 0) > 8192) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const input = JSON.parse(new TextDecoder().decode(bytes));
    return input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  } catch { return null; }
}

export async function handlePartnerAuth(request, env, action) {
  if (action === 'status' && request.method === 'GET') return reply(200, {emailDeliveryConfigured:await emailReady(env)});
  if (request.method !== 'POST') return reply(405, { error: 'Use POST for account actions.' });
  if (!sameOriginMutation(request)) return reply(403, { error: 'Account actions must come from this site.' });
  const db = env.ECOSYSTEM_DB;
  if (action === 'logout') {
    const token = cookieToken(request);
    if (token) await db.prepare('DELETE FROM ecosystem_partner_sessions WHERE token_hash = ?').bind(await canonicalDigest(token)).run();
    return reply(200, { signedOut: true }, sessionCookie('', 0));
  }
  if (!['signup', 'login', 'request-reset', 'reset-password', 'verify-email', 'resend-verification'].includes(action)) return reply(404, { error: 'Account action not found.' });
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipBucket = await canonicalDigest(`${action}:ip:${ip}`);
  if (await limited(db, ipBucket, action === 'signup' ? 10 : 50, 15 * 60_000)) return reply(429, { error: 'Too many attempts. Please try again in 15 minutes.' });
  await db.prepare('DELETE FROM ecosystem_partner_auth_windows WHERE window_start_ms < ?').bind(Date.now() - 24 * 60 * 60_000).run();
  const input = await readInput(request);
  if (!input) return reply(400, { error: 'Send account details as JSON, up to 8 KB.' });
  if (!['signup','login'].includes(action)) return recoveryAction(request, env, action, input);
  const email = String(input.email || '').trim().toLowerCase();
  const password = input.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || !password || password.length > 128) {
    return reply(400, { error: 'Enter a valid email and password (up to 128 characters).' });
  }
  if (await limited(db, await canonicalDigest(`${action}:email:${email}`), 10, 15 * 60_000)) return reply(429, { error: 'Too many attempts. Please try again in 15 minutes.' });
  if (action === 'login') {
    const account = await db.prepare('SELECT account_id, name, password_hash, password_salt, password_iterations, status, account_generation FROM ecosystem_partner_accounts WHERE email = ?').bind(email).first();
    // Match the hashing cost for unknown emails without storing a dummy account.
    const candidate = await passwordHash(password, account?.password_salt || '0'.repeat(64), account?.password_iterations || ITERATIONS);
    if (!account || account.status !== 'ACTIVE' || !equalHash(candidate, account.password_hash)) return reply(401, { error: 'Email or password is incorrect.' });
    const cookie = await issueSession(db, request, account.account_id, account.account_generation);
    return cookie ? reply(200, { email, name: account.name }, cookie) : reply(401, {error:'Your account changed. Please log in again.'});
  }
  const name = String(input.name || '').trim();
  const organizationName = String(input.organizationName || '').trim();
  const kind = String(input.kind || 'OEM');
  if (password.length < 15) return reply(400, { error: 'Choose a password with at least 15 characters.' });
  if (!name || name.length > 128 || !organizationName || organizationName.length > 256 || !['OEM', 'MANUFACTURER', 'SUPPLIER', 'OPERATOR', 'HYBRID'].includes(kind)) {
    return reply(400, { error: 'Enter your name, company name, and company type.' });
  }
  if (!await emailReady(env)) return reply(503, {error:'Account email delivery is temporarily unavailable. Please try again shortly.'});
  const accountId = crypto.randomUUID();
  const subject = `partner:${accountId}`;
  const organizationId = `partner-${crypto.randomUUID()}`;
  const salt = randomToken();
  const hash = await passwordHash(password, salt);
  const now = Date.now();
  try {
    await db.batch([
      db.prepare(`INSERT INTO ecosystem_partner_accounts (account_id, email, name, password_hash, password_salt, password_iterations, status, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`).bind(accountId, email, name, hash, salt, ITERATIONS, now),
      db.prepare('INSERT INTO ecosystem_organizations (organization_id, name, kind, created_at_ms) VALUES (?, ?, ?, ?)').bind(organizationId, organizationName, kind, now),
      // Signup grants draft editing in a new workspace, never access to an
      // existing company or the Access-only platform administration routes.
      db.prepare(`INSERT INTO ecosystem_memberships (organization_id, access_subject, email, role, status, created_at_ms)
        VALUES (?, ?, ?, 'EDITOR', 'ACTIVE', ?)`).bind(organizationId, subject, email, now),
      db.prepare(`INSERT INTO ecosystem_audit_events
        (event_id, organization_id, actor_subject, actor_kind, action, resource_type, resource_id, detail_json, created_at_ms)
        VALUES (?, ?, ?, 'PARTNER', 'partner.signup', 'organization', ?, '{}', ?)`)
        .bind(crypto.randomUUID(), organizationId, subject, organizationId, now),
      db.prepare(`INSERT INTO ecosystem_partner_email_requests
        (request_id, account_id, purpose, account_generation, status, created_at_ms, updated_at_ms)
        VALUES (?, ?, 'VERIFY_EMAIL', 0, 'PENDING', ?, ?)`).bind(crypto.randomUUID(), accountId, now, now),
    ]);
  } catch (error) {
    if (/UNIQUE.*ecosystem_partner_accounts.email/i.test(error.message)) return reply(409, { error: 'An account already uses this email. Log in to continue.' });
    throw error;
  }
  await dispatchEmail(env);
  return reply(201, { email, name, organizationId, organizationName, role: 'EDITOR', emailVerified:false, message:'Your account is ready. Check your email to verify it before submitting products for review.' }, await issueSession(db, request, accountId));
}
