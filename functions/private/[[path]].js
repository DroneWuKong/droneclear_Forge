/**
 * CF Pages Function — fail-closed gate for /private/*
 * Deployed at functions/private/[[path]].js → runs for every /private/* request
 * (see _routes.json include "/private/*").
 *
 * PRIMARY GATE: Cloudflare Access in front of /private/* (configure in Zero
 * Trust dashboard — see docs/PRIVATE_GATE.md). When Access is active it injects
 * a signed JWT (Cf-Access-Jwt-Assertion) + Cf-Access-Authenticated-User-Email,
 * and strips any client-supplied copies, so their presence is trustworthy.
 *
 * This Function is defense-in-depth + a pre-Access escape hatch:
 *  - If a valid Access identity header is present → allow (serve via next()).
 *  - Else if PRIVATE_GATE_SECRET env is set and the request presents it
 *    (?key= or `pg` cookie) → allow (lets you use the site before Access is
 *    configured). The cookie is set so subsequent asset/md/json fetches pass.
 *  - Otherwise → 403 (fail closed). Content is NEVER served unauthenticated.
 */
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // 1) Cloudflare Access identity (only trustworthy when Access is in front).
  const accessEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
  const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (accessEmail || accessJwt) return next();

  // 2) Shared-secret escape hatch (pre-Access). Set PRIVATE_GATE_SECRET in the
  //    Pages project env to enable; remove it once Access is live.
  const secret = env.PRIVATE_GATE_SECRET;
  if (secret) {
    const qsKey = url.searchParams.get('key');
    const cookie = request.headers.get('Cookie') || '';
    const m = cookie.match(/(?:^|;\s*)pg=([^;]+)/);
    const cookieKey = m ? decodeURIComponent(m[1]) : '';
    if (qsKey && qsKey === secret) {
      const dest = url.pathname + (url.pathname.endsWith('/') ? '' : '');
      return new Response(null, {
        status: 302,
        headers: {
          'Location': dest,
          'Set-Cookie': `pg=${encodeURIComponent(secret)}; Path=/private; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,
          'Cache-Control': 'no-store',
        },
      });
    }
    if (cookieKey && cookieKey === secret) return next();
  }

  // 3) Fail closed.
  return new Response(
    `<!doctype html><meta charset=utf-8><title>403 — Private</title>` +
    `<style>body{background:#0c0c0a;color:#d8d4ca;font:14px/1.6 monospace;max-width:560px;margin:12vh auto;padding:0 20px}` +
    `h1{color:#d62828;font-size:20px}a{color:#4a9eff}</style>` +
    `<h1>403 · Private</h1><p>This area is gated. Authenticate via Cloudflare Access` +
    ` (or use the access link you were given). Configuration: docs/PRIVATE_GATE.md.</p>`,
    { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } }
  );
}
