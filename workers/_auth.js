/**
 * Shared auth helpers for Forge workers. Added 2026-07-03 (audit F-H5).
 */

/**
 * Constant-time string comparison via SHA-256 digests.
 * Avoids the early-return timing leak of `===`/`!==` on secrets. Both inputs are
 * hashed to fixed-length digests first, so length is not leaked either.
 * Returns false for missing/empty/non-string inputs (fail closed).
 */
export async function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) {
    return false;
  }
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}
