import forgeData, {
  describePublicDatasets,
  isPublicDataset,
} from './forge-data.js';
import { publicOpenApi } from './openapi-v1.js';

const VERSION = '1';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function responseHeaders(extra = {}) {
  return {
    ...CORS,
    'API-Version': VERSION,
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8',
    ...extra,
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(extraHeaders),
  });
}

function problem(status, code, message, requestId, extra = {}) {
  return json(
    { error: { code, message, request_id: requestId, ...extra } },
    status,
    { 'X-Request-ID': requestId },
  );
}

function addVersionHeaders(response, requestId) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
  headers.set('API-Version', VERSION);
  headers.set('X-Request-ID', requestId);
  headers.set(
    'Link',
    '<https://uas-patterns.com/api-docs/>; rel="documentation"',
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function decodeDataset(path) {
  const prefix = '/api/v1/datasets/';
  if (!path.startsWith(prefix)) return null;
  const encoded = path.slice(prefix.length).replace(/\/$/, '');
  if (!encoded || encoded.includes('/')) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

async function get(request, env, ctx, requestId) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const origin = url.origin;

  if (path === '/api/v1') {
    return json({
      name: 'UAS Forge and Patterns Public Data API',
      version: VERSION,
      access: 'public-read-only',
      authentication: 'none',
      dataset_count: describePublicDatasets().length,
      links: {
        datasets: `${origin}/api/v1/datasets`,
        openapi: `${origin}/api/v1/openapi.json`,
        documentation: 'https://uas-patterns.com/api-docs/',
        legacy_compatibility: `${origin}/api/data?type=dataset_catalog`,
      },
      request_id: requestId,
    }, 200, { 'X-Request-ID': requestId });
  }

  if (path === '/api/v1/openapi.json') {
    return json(publicOpenApi(origin), 200, { 'X-Request-ID': requestId });
  }

  if (path === '/api/v1/datasets') {
    const datasets = describePublicDatasets();
    return json({
      data: datasets,
      meta: { count: datasets.length, version: VERSION },
      request_id: requestId,
    }, 200, { 'X-Request-ID': requestId });
  }

  const dataset = decodeDataset(url.pathname);
  if (!dataset) {
    return problem(404, 'route_not_found', 'Public API route not found', requestId);
  }
  if (!isPublicDataset(dataset)) {
    return problem(404, 'unknown_dataset', `Unknown public dataset: ${dataset}`, requestId);
  }

  const legacyUrl = new URL(request.url);
  legacyUrl.pathname = '/api/data';
  legacyUrl.searchParams.set('type', dataset);
  const delegated = await forgeData.fetch(
    new Request(legacyUrl.toString(), {
      method: request.method,
      headers: request.headers,
    }),
    env,
    ctx,
  );
  return addVersionHeaders(delegated, requestId);
}

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: responseHeaders({ 'X-Request-ID': requestId }),
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return problem(
        405,
        'method_not_allowed',
        'The public v1 API is read-only',
        requestId,
        { allowed: ['GET', 'HEAD', 'OPTIONS'] },
      );
    }

    const response = await get(request, env, ctx, requestId);
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return response;
  },
};
