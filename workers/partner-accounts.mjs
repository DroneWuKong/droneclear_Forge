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
  const row = await env.ECOSYSTEM_DB.prepare(`SELECT a.account_id, a.email, a.name
    FROM ecosystem_partner_sessions s JOIN ecosystem_partner_accounts a ON a.account_id = s.account_id
    WHERE s.token_hash = ? AND s.expires_at_ms > ? AND a.status = 'ACTIVE'`)
    .bind(await canonicalDigest(token), Date.now()).first();
  return row ? { kind: 'PARTNER', subject: `partner:${row.account_id}`, email: row.email, name: row.name } : null;
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

async function issueSession(db, request, accountId) {
  const token = randomToken();
  const now = Date.now();
  const oldToken = cookieToken(request);
  const statements = [
    db.prepare('DELETE FROM ecosystem_partner_sessions WHERE expires_at_ms <= ?').bind(now),
    db.prepare('INSERT INTO ecosystem_partner_sessions (token_hash, account_id, created_at_ms, expires_at_ms) VALUES (?, ?, ?, ?)')
      .bind(await canonicalDigest(token), accountId, now, now + SESSION_SECONDS * 1000),
  ];
  if (oldToken) statements.push(db.prepare('DELETE FROM ecosystem_partner_sessions WHERE token_hash = ?').bind(await canonicalDigest(oldToken)));
  await db.batch(statements);
  return sessionCookie(token);
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
  if (request.method !== 'POST') return reply(405, { error: 'Use POST for account actions.' });
  if (!sameOriginMutation(request)) return reply(403, { error: 'Account actions must come from this site.' });
  const db = env.ECOSYSTEM_DB;
  if (action === 'logout') {
    const token = cookieToken(request);
    if (token) await db.prepare('DELETE FROM ecosystem_partner_sessions WHERE token_hash = ?').bind(await canonicalDigest(token)).run();
    return reply(200, { signedOut: true }, sessionCookie('', 0));
  }
  if (!['signup', 'login'].includes(action)) return reply(404, { error: 'Account action not found.' });
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipBucket = await canonicalDigest(`${action}:ip:${ip}`);
  if (await limited(db, ipBucket, action === 'signup' ? 10 : 50, 15 * 60_000)) return reply(429, { error: 'Too many attempts. Please try again in 15 minutes.' });
  await db.prepare('DELETE FROM ecosystem_partner_auth_windows WHERE window_start_ms < ?').bind(Date.now() - 24 * 60 * 60_000).run();
  const input = await readInput(request);
  if (!input) return reply(400, { error: 'Send account details as JSON, up to 8 KB.' });
  const email = String(input.email || '').trim().toLowerCase();
  const password = input.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || !password || password.length > 128) {
    return reply(400, { error: 'Enter a valid email and password (up to 128 characters).' });
  }
  if (await limited(db, await canonicalDigest(`${action}:email:${email}`), 10, 15 * 60_000)) return reply(429, { error: 'Too many attempts. Please try again in 15 minutes.' });
  if (action === 'login') {
    const account = await db.prepare('SELECT account_id, name, password_hash, password_salt, password_iterations, status FROM ecosystem_partner_accounts WHERE email = ?').bind(email).first();
    // Match the hashing cost for unknown emails without storing a dummy account.
    const candidate = await passwordHash(password, account?.password_salt || '0'.repeat(64), account?.password_iterations || ITERATIONS);
    if (!account || account.status !== 'ACTIVE' || !equalHash(candidate, account.password_hash)) return reply(401, { error: 'Email or password is incorrect.' });
    return reply(200, { email, name: account.name }, await issueSession(db, request, account.account_id));
  }
  const name = String(input.name || '').trim();
  const organizationName = String(input.organizationName || '').trim();
  const kind = String(input.kind || 'OEM');
  if (password.length < 15) return reply(400, { error: 'Choose a password with at least 15 characters.' });
  if (!name || name.length > 128 || !organizationName || organizationName.length > 256 || !['OEM', 'MANUFACTURER', 'SUPPLIER', 'OPERATOR', 'HYBRID'].includes(kind)) {
    return reply(400, { error: 'Enter your name, company name, and company type.' });
  }
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
    ]);
  } catch (error) {
    if (/UNIQUE.*ecosystem_partner_accounts.email/i.test(error.message)) return reply(409, { error: 'An account already uses this email. Log in to continue.' });
    throw error;
  }
  return reply(201, { email, name, organizationId, organizationName, role: 'EDITOR' }, await issueSession(db, request, accountId));
}
