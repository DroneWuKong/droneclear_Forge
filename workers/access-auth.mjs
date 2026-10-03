// Access identity is accepted only after signature and claim validation.
const encoder = new TextEncoder();
const bytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const encode = value => btoa(String.fromCharCode(...value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

export async function verifyAccessIdentity(token, env, fetcher = fetch, now = Date.now()) {
  try {
    const team = env.PRIVATE_ACCESS_TEAM_DOMAIN;
    const audience = env.PRIVATE_ACCESS_AUD;
    if (!team || !audience || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) return null;
    if (typeof token !== 'string' || token.length > 16384) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(bytes(parts[1])));
    const seconds = now / 1000;
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) return null;
    if (claims.iss !== `https://${team}` || !Array.isArray(claims.aud) || !claims.aud.includes(audience)) return null;
    if (!Number.isFinite(claims.exp) || claims.exp <= seconds || !Number.isFinite(claims.iat) || claims.iat > seconds + 60) return null;
    if (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > seconds + 60)) return null;
    const response = await fetcher(`https://${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) return null;
    const raw = await response.text();
    if (raw.length > 65536) return null;
    const jwk = JSON.parse(raw).keys?.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig'));
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), encoder.encode(parts[0] + '.' + parts[1]));
    if (!verified || typeof claims.sub !== 'string' || !claims.sub) return null;
    return Object.freeze({
      subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      name: typeof claims.name === 'string' ? claims.name : null,
      issuedAt: claims.iat,
      expiresAt: claims.exp,
    });
  } catch { return null; }
}

export async function verifyAccessToken(token, env, fetcher = fetch, now = Date.now()) {
  return (await verifyAccessIdentity(token, env, fetcher, now)) !== null;
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
