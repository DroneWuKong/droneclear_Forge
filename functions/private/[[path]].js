/**
 * CF Pages Function — gate for /private/*
 * Deployed at functions/private/[[path]].js → runs for every /private/* request
 * (see _routes.json include "/private/*").
 *
 * Two ways in, fail-closed:
 *  1) Cloudflare Access identity header (if Access is ever put in front) → allow.
 *  2) Shared password (PRIVATE_GATE_SECRET env). Unauthenticated visitors get a
 *     password prompt page; a correct password sets the `pg` cookie so every
 *     later page / .md / .json fetch passes. POST keeps the password out of the
 *     URL; a ?key=<secret> link still works for sharing.
 * If PRIVATE_GATE_SECRET is not set, the area is fully locked (403) — content is
 * NEVER served unauthenticated.
 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function setCookieRedirect(secret, dest) {
  return new Response(null, {
    status: 303,
    headers: {
      'Location': dest,
      'Set-Cookie': `pg=${encodeURIComponent(secret)}; Path=/private; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
      'Cache-Control': 'no-store',
    },
  });
}

function promptPage(pathname, { error = false, locked = false } = {}) {
  const msg = locked
    ? `<p class="err">This area is locked. (No access password is configured yet.)</p>`
    : error
      ? `<p class="err">Incorrect password.</p>`
      : `<p class="hint">Enter the access password to continue.</p>`;
  const form = locked ? '' : `
    <form method="POST" action="${pathname}">
      <input type="password" name="key" placeholder="Access password" autofocus autocomplete="current-password" />
      <button type="submit">Enter</button>
    </form>`;
  return new Response(
`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Private · DroneWuKong</title>
<style>
  :root{--bg:#0c0c0a;--bg2:#141410;--border:#2a2a22;--green:#22c55e;--red:#d62828;--text:#d8d4ca;--dim:#7a7268;--mono:'JetBrains Mono',ui-monospace,monospace}
  *{box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font:14px/1.6 var(--mono);min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0;padding:20px}
  .card{width:100%;max-width:360px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:28px 24px}
  .badge{font:600 10px var(--mono);color:var(--red);border:1px solid var(--red);border-radius:3px;padding:2px 6px;letter-spacing:.05em}
  h1{font-size:18px;margin:14px 0 4px;color:var(--green);letter-spacing:.5px}
  .hint{color:var(--dim);margin:0 0 16px}
  .err{color:var(--red);margin:0 0 16px}
  form{display:flex;flex-direction:column;gap:10px}
  input{background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font:14px var(--mono);padding:11px 12px;width:100%}
  input:focus{outline:none;border-color:var(--green)}
  button{background:var(--green);color:#06140a;border:0;border-radius:6px;font:700 14px var(--mono);padding:11px;cursor:pointer}
  button:hover{filter:brightness(1.08)}
  .foot{color:var(--dim);font-size:11px;margin-top:16px}
</style></head><body>
  <div class="card">
    <span class="badge">● PRIVATE</span>
    <h1>DRONEWUKONG // INTEL</h1>
    ${msg}
    ${form}
    <div class="foot">Authorized access only. Do not share or redistribute.</div>
  </div>
</body></html>`,
    { status: locked ? 403 : 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } }
  );
}

// Constant-time compare via SHA-256 digests (audit F-H5). Inlined because Pages
// Functions cannot import from the workers/ deploy root.
async function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha), vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // 1) Cloudflare Access identity (only trustworthy when Access is in front).
  if (request.headers.get('Cf-Access-Authenticated-User-Email') ||
      request.headers.get('Cf-Access-Jwt-Assertion')) return next();

  const secret = env.PRIVATE_GATE_SECRET;
  if (!secret) return promptPage(url.pathname, { locked: true });

  // Already authenticated via cookie?
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)pg=([^;]+)/);
  if (m && await timingSafeEqual(decodeURIComponent(m[1]), secret)) return next();

  // Password submitted via form POST (keeps it out of the URL).
  if (request.method === 'POST') {
    let submitted = '';
    try {
      const form = await request.formData();
      submitted = (form.get('key') || '').toString();
    } catch (_) { /* not form data */ }
    if (await timingSafeEqual(submitted, secret)) return setCookieRedirect(secret, url.pathname);
    return promptPage(url.pathname, { error: true });
  }

  // Shareable ?key= link.
  if (await timingSafeEqual(url.searchParams.get('key'), secret)) return setCookieRedirect(secret, url.pathname);

  // Otherwise show the password prompt (fail-closed: no content served).
  return promptPage(url.pathname);
}
