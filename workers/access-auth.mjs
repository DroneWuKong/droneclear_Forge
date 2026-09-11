// Access identity is accepted only after signature and claim validation.
const encoder = new TextEncoder();
const bytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const encode = value => btoa(String.fromCharCode(...value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

export async function verifyAccessToken(token, env, fetcher = fetch, now = Date.now()) {
  try {
    const team = env.PRIVATE_ACCESS_TEAM_DOMAIN;
    const audience = env.PRIVATE_ACCESS_AUD;
    if (!team || !audience || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) return false;
    if (typeof token !== 'string' || token.length > 16384) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(bytes(parts[1])));
    const seconds = now / 1000;
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) return false;
    if (claims.iss !== `https://${team}` || !Array.isArray(claims.aud) || !claims.aud.includes(audience)) return false;
    if (!Number.isFinite(claims.exp) || claims.exp <= seconds || !Number.isFinite(claims.iat) || claims.iat > seconds + 60) return false;
    if (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > seconds + 60)) return false;
    const response = await fetcher(`https://${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) return false;
    const raw = await response.text();
    if (raw.length > 65536) return false;
    const jwk = JSON.parse(raw).keys?.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig'));
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), encoder.encode(parts[0] + '.' + parts[1]));
  } catch { return false; }
}

async function sessionKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function createSession(secret, maxAge, now = Date.now()) {
  const payload = encode(encoder.encode(JSON.stringify({ exp: Math.floor(now / 1000) + maxAge, nonce: crypto.randomUUID(), purpose: 'private' })));
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(secret), encoder.encode(payload));
  return payload + '.' + encode(new Uint8Array(signature));
}
export async function verifySession(token, secret, now = Date.now()) {
  try {
    if (!secret || !token || token.length > 2048) return false;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return false;
    const claims = JSON.parse(new TextDecoder().decode(bytes(payload)));
    return claims.purpose === 'private' && Number.isFinite(claims.exp) && claims.exp > now / 1000 &&
      await crypto.subtle.verify('HMAC', await sessionKey(secret), bytes(signature), encoder.encode(payload));
  } catch { return false; }
}
