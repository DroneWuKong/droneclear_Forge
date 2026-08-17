import { timingSafeEqual } from './_auth.js';
import { privateOpenApi } from './openapi-v1.js';

const VERSION = '1';
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_KEY_BYTES = 512;
const MAX_PREFIX_LENGTH = 256;

const NAMESPACES = Object.freeze({
  pie: { binding: 'PIE_DB', purpose: 'private and curated PIE working data' },
  outputs: { binding: 'PIE_OUTPUTS', purpose: 'validated pipeline outputs' },
  parts: { binding: 'PARTS_DB', purpose: 'parts and pricing working data' },
  procurement: { binding: 'PROCUREMENT_DB', purpose: 'procurement working data' },
  grayzone: { binding: 'GRAYZONE_DB', purpose: 'gray-zone working data' },
  history: { binding: 'PIE_HISTORY', purpose: 'historical PIE snapshots' },
});

function requestOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const allowed = String(env.PRIVATE_API_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : false;
}

function headers(request, env, extra = {}) {
  const allowedOrigin = requestOriginAllowed(request, env);
  const result = {
    'API-Version': VERSION,
    'Cache-Control': 'no-store, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };
  if (allowedOrigin) result['Access-Control-Allow-Origin'] = allowedOrigin;
  return result;
}

function json(request, env, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request, env, extraHeaders),
  });
}

function problem(request, env, status, code, message, requestId, extra = {}) {
  return json(
    request,
    env,
    { error: { code, message, request_id: requestId, ...extra } },
    status,
    { 'X-Request-ID': requestId },
  );
}

function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function authorize(request, env, requestId) {
  if (!env.PRIVATE_API_KEY) {
    return problem(
      request,
      env,
      503,
      'private_api_not_configured',
      'PRIVATE_API_KEY is not configured',
      requestId,
    );
  }
  if (!(await timingSafeEqual(bearerToken(request), env.PRIVATE_API_KEY))) {
    return problem(
      request,
      env,
      401,
      'unauthorized',
      'A valid bearer token is required',
      requestId,
      {},
    );
  }
  return null;
}

function namespaceBinding(env, name) {
  const descriptor = NAMESPACES[name];
  if (!descriptor) return { error: 'unknown_namespace' };
  const binding = env[descriptor.binding];
  if (!binding || typeof binding.get !== 'function') {
    return { error: 'namespace_unavailable', descriptor };
  }
  return { binding, descriptor };
}

function parseDatasetPath(pathname) {
  const prefix = '/api/private/v1/datasets/';
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/$/, '');
  if (!rest) return null;
  const slash = rest.indexOf('/');
  const encodedNamespace = slash === -1 ? rest : rest.slice(0, slash);
  const encodedKey = slash === -1 ? null : rest.slice(slash + 1);
  try {
    return {
      namespace: decodeURIComponent(encodedNamespace),
      key: encodedKey == null || encodedKey === ''
        ? null
        : decodeURIComponent(encodedKey),
    };
  } catch {
    return null;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function parseStoredValue(raw) {
  try {
    return { data: JSON.parse(raw), encoding: 'json' };
  } catch {
    return { data: raw, encoding: 'text' };
  }
}

function audit(event) {
  console.log(JSON.stringify({ service: 'private-api-v1', ...event }));
}

function readMethod(request) {
  return request.method === 'GET' || request.method === 'HEAD';
}

async function listKeys(request, env, namespace, binding, requestId) {
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') || '';
  if (prefix.length > MAX_PREFIX_LENGTH) {
    return problem(request, env, 400, 'invalid_prefix', `prefix is limited to ${MAX_PREFIX_LENGTH} characters`, requestId);
  }
  const limit = boundedInteger(url.searchParams.get('limit'), 100, 1, 1000);
  const cursor = url.searchParams.get('cursor') || undefined;
  const result = await binding.list({ prefix, limit, cursor });
  audit({ action: 'list', namespace, returned: result.keys.length, request_id: requestId });
  return json(request, env, {
    data: result.keys.map((key) => ({
      name: key.name,
      expiration: key.expiration || null,
      metadata: key.metadata || null,
    })),
    meta: {
      namespace,
      prefix,
      limit,
      list_complete: result.list_complete,
      cursor: result.list_complete ? null : result.cursor,
    },
    request_id: requestId,
  }, 200, { 'X-Request-ID': requestId });
}

async function readKey(request, env, namespace, key, binding, requestId) {
  const raw = await binding.get(key);
  if (raw == null) {
    return problem(request, env, 404, 'key_not_found', 'The requested key does not exist', requestId);
  }
  audit({ action: 'read', namespace, key_bytes: bytes(key), bytes: bytes(raw), request_id: requestId });
  return json(request, env, {
    ...parseStoredValue(raw),
    meta: { namespace, key, bytes: bytes(raw) },
    request_id: requestId,
  }, 200, { 'X-Request-ID': requestId });
}

async function writeKey(request, env, namespace, key, binding, requestId) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return problem(request, env, 415, 'unsupported_media_type', 'Content-Type must be application/json', requestId);
  }
  const declaredLength = Number.parseInt(request.headers.get('Content-Length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return problem(request, env, 413, 'body_too_large', `Request body is limited to ${MAX_BODY_BYTES} bytes`, requestId);
  }

  const body = await request.text();
  const bodyBytes = bytes(body);
  if (bodyBytes > MAX_BODY_BYTES) {
    return problem(request, env, 413, 'body_too_large', `Request body is limited to ${MAX_BODY_BYTES} bytes`, requestId);
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return problem(
      request,
      env,
      400,
      'invalid_json',
      error instanceof Error ? error.message : 'Invalid JSON',
      requestId,
    );
  }

  const url = new URL(request.url);
  const dryRun = ['1', 'true', 'yes'].includes(
    String(url.searchParams.get('dry_run') || '').toLowerCase(),
  );
  const normalized = JSON.stringify(parsed);
  if (!dryRun) await binding.put(key, normalized);
  audit({
    action: dryRun ? 'validate_write' : 'write',
    namespace,
    key_bytes: bytes(key),
    bytes: bytes(normalized),
    request_id: requestId,
  });
  return json(request, env, {
    ok: true,
    dry_run: dryRun,
    stored: !dryRun,
    meta: { namespace, key, bytes: bytes(normalized) },
    request_id: requestId,
  }, 200, { 'X-Request-ID': requestId });
}

async function handle(request, env, ctx, requestId) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (path === '/api/private/v1') {
    if (!readMethod(request)) {
      return problem(request, env, 405, 'method_not_allowed', 'Discovery is read-only', requestId);
    }
    return json(request, env, {
      name: 'DroneWuKong Private Data API',
      version: VERSION,
      access: 'private-read-write',
      authentication: 'bearer',
      static_fallback: false,
      simulation: 'Append ?dry_run=1 to PUT requests to validate without writing.',
      links: {
        namespaces: `${url.origin}/api/private/v1/namespaces`,
        openapi: `${url.origin}/api/private/v1/openapi.json`,
      },
      request_id: requestId,
    }, 200, { 'X-Request-ID': requestId });
  }

  if (path === '/api/private/v1/openapi.json') {
    if (!readMethod(request)) {
      return problem(request, env, 405, 'method_not_allowed', 'OpenAPI discovery is read-only', requestId);
    }
    return json(request, env, privateOpenApi(url.origin), 200, { 'X-Request-ID': requestId });
  }

  if (path === '/api/private/v1/namespaces') {
    if (!readMethod(request)) {
      return problem(request, env, 405, 'method_not_allowed', 'Namespace discovery is read-only', requestId);
    }
    const data = Object.entries(NAMESPACES).map(([name, descriptor]) => ({
      name,
      binding: descriptor.binding,
      purpose: descriptor.purpose,
      available: Boolean(env[descriptor.binding]),
      access: ['read', 'write'],
    }));
    return json(request, env, {
      data,
      meta: { count: data.length },
      request_id: requestId,
    }, 200, { 'X-Request-ID': requestId });
  }

  const target = parseDatasetPath(url.pathname);
  if (!target) {
    return problem(request, env, 404, 'route_not_found', 'Private API route not found', requestId);
  }
  const resolved = namespaceBinding(env, target.namespace);
  if (resolved.error === 'unknown_namespace') {
    return problem(request, env, 404, 'unknown_namespace', `Unknown namespace: ${target.namespace}`, requestId);
  }
  if (resolved.error === 'namespace_unavailable') {
    return problem(request, env, 503, 'namespace_unavailable', `${resolved.descriptor.binding} is not configured`, requestId);
  }

  if (target.key == null) {
    if (!readMethod(request)) {
      return problem(request, env, 405, 'method_not_allowed', 'Namespace collections are read-only', requestId);
    }
    return listKeys(request, env, target.namespace, resolved.binding, requestId);
  }

  const keyBytes = bytes(target.key);
  if (!target.key || keyBytes > MAX_KEY_BYTES) {
    return problem(request, env, 400, 'invalid_key', `Keys must be 1-${MAX_KEY_BYTES} UTF-8 bytes`, requestId);
  }
  if (readMethod(request)) {
    return readKey(request, env, target.namespace, target.key, resolved.binding, requestId);
  }
  if (request.method === 'PUT') {
    return writeKey(request, env, target.namespace, target.key, resolved.binding, requestId);
  }
  return problem(
    request,
    env,
    405,
    'method_not_allowed',
    'Private dataset keys support GET, HEAD, and PUT only',
    requestId,
    { allowed: ['GET', 'HEAD', 'PUT', 'OPTIONS'] },
  );
}

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    if (request.method === 'OPTIONS') {
      const allowedOrigin = requestOriginAllowed(request, env);
      if (allowedOrigin === false) {
        return problem(request, env, 403, 'origin_not_allowed', 'Origin is not allowed', requestId);
      }
      return new Response(null, {
        status: 204,
        headers: headers(request, env, {
          'Access-Control-Allow-Methods': 'GET, HEAD, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '600',
          'X-Request-ID': requestId,
        }),
      });
    }

    const unauthorized = await authorize(request, env, requestId);
    if (unauthorized && unauthorized.status === 401) {
      unauthorized.headers.set('WWW-Authenticate', 'Bearer realm="DroneWuKong Private API"');
    }
    if (unauthorized) return unauthorized;

    try {
      const response = await handle(request, env, ctx, requestId);
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      return response;
    } catch (error) {
      console.error(JSON.stringify({
        service: 'private-api-v1',
        action: 'unhandled_error',
        request_id: requestId,
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return problem(request, env, 500, 'internal_error', 'Internal server error', requestId);
    }
  },
};
