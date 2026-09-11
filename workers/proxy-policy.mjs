import { timingSafeEqual } from './_auth.js';
export const PROXY_HEADERS = {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret',
};
export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: PROXY_HEADERS });
export async function readBoundedJson(request, limit = 32768) {
  if (!request.body) throw new Error('Body required');
  const reader = request.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error('Request exceeds 32 KiB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const merged = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder().decode(merged));
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('JSON object required');
  return { body, inputUnits: length };
}
export async function authorize(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: PROXY_HEADERS });
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  if (!env.WINGMAN_PROXY_SECRET) return json({ error: 'Model access is not configured' }, 503);
  if (!await timingSafeEqual(request.headers.get('x-proxy-secret'), env.WINGMAN_PROXY_SECRET)) return json({ error: 'Unauthorized' }, 401);
  if (!env.MODEL_BUDGET) return json({ error: 'Shared model budget is unavailable' }, 503);
  return null;
}
export function outputLimit(value, max = 4096) {
  if (value == null) return 1000;
  if (!Number.isInteger(value) || value < 1) throw new Error('Output limit must be a positive integer');
  return Math.min(value, max);
}
export function allowedModel(body, env, provider, fallback) {
  const allowed = (env[`${provider}_ALLOWED_MODELS`] || fallback).split(',').map(x => x.trim()).filter(Boolean);
  const model = body.model || allowed[0];
  if (!allowed.includes(model)) throw new Error('Model is not permitted');
  return model;
}
export async function reserve(env, inputUnits, outputTokens) {
  try {
    const stub = env.MODEL_BUDGET.get(env.MODEL_BUDGET.idFromName('owner-model-budget-v1'));
    const result = await stub.reserve({ units: inputUnits + outputTokens });
    if (!result?.allowed) return json({ error: 'Shared model budget exhausted', retry_after: result?.retryAfter || 60 }, 429);
    return null;
  } catch { return json({ error: 'Shared model budget is unavailable' }, 503); }
}
export function budgetDecision(previous, units, now, limits = { minute: 20, day: 200, units: 250000 }) {
  const minute = Math.floor(now / 60000), day = Math.floor(now / 86400000);
  const state = { minute, day, minuteCount: previous?.minute === minute ? previous.minuteCount : 0,
    dayCount: previous?.day === day ? previous.dayCount : 0, units: previous?.day === day ? previous.units : 0 };
  if (!Number.isSafeInteger(units) || units < 1 || units > 65536) return { allowed: false, retryAfter: 60, state };
  if (state.minuteCount >= limits.minute) return { allowed: false, retryAfter: 60 - Math.floor(now / 1000) % 60, state };
  if (state.dayCount >= limits.day || state.units + units > limits.units) return { allowed: false, retryAfter: 86400 - Math.floor(now / 1000) % 86400, state };
  return { allowed: true, state: { ...state, minuteCount: state.minuteCount + 1, dayCount: state.dayCount + 1, units: state.units + units } };
}
