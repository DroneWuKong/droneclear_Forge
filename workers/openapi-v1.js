const JSON_SCHEMA = { type: 'object', additionalProperties: true };

function server(origin) {
  return [{ url: origin || 'https://uas-patterns.com' }];
}

export function publicOpenApi(origin) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'UAS Forge and Patterns Public Data API',
      version: '1.0.0',
      description:
        'Read-only access to the curated public Forge and Patterns datasets. ' +
        'Analytical datasets carry freshness metadata and may fail closed with HTTP 503.',
    },
    servers: server(origin),
    paths: {
      '/api/v1': {
        get: {
          summary: 'Discover the public API',
          responses: { '200': { description: 'API discovery document' } },
        },
      },
      '/api/v1/datasets': {
        get: {
          summary: 'List public datasets',
          responses: { '200': { description: 'Dataset allowlist and storage policy' } },
        },
      },
      '/api/v1/datasets/{dataset}': {
        get: {
          summary: 'Read one public dataset',
          parameters: [
            {
              name: 'dataset',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Dataset response envelope',
              content: { 'application/json': { schema: JSON_SCHEMA } },
            },
            '404': { description: 'Unknown or unavailable dataset' },
            '503': { description: 'Freshness or publication gate withheld the dataset' },
          },
        },
      },
      '/api/v1/openapi.json': {
        get: {
          summary: 'Download this OpenAPI contract',
          responses: { '200': { description: 'OpenAPI 3.1 document' } },
        },
      },
    },
  };
}

export function privateOpenApi(origin) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'DroneWuKong Private Data API',
      version: '1.0.0',
      description:
        'Authenticated exact-key read/write access to explicitly allowlisted Cloudflare KV namespaces. ' +
        'No public static fallback is used.',
    },
    servers: server(origin),
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
      },
    },
    paths: {
      '/api/private/v1': {
        get: {
          summary: 'Discover the private API',
          responses: { '200': { description: 'Authenticated API discovery document' } },
        },
      },
      '/api/private/v1/namespaces': {
        get: {
          summary: 'List allowlisted namespaces and binding status',
          responses: { '200': { description: 'Namespace policy' } },
        },
      },
      '/api/private/v1/datasets/{namespace}': {
        get: {
          summary: 'List keys in one namespace',
          parameters: [
            { name: 'namespace', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'prefix', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Bounded key listing' } },
        },
      },
      '/api/private/v1/datasets/{namespace}/{key}': {
        get: {
          summary: 'Read one exact key',
          parameters: [
            { name: 'namespace', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Stored JSON or text value' }, '404': { description: 'Missing key' } },
        },
        put: {
          summary: 'Validate or write one JSON value',
          parameters: [
            { name: 'namespace', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'dry_run', in: 'query', schema: { type: 'boolean' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: JSON_SCHEMA } },
          },
          responses: { '200': { description: 'Validated or stored' }, '413': { description: 'Body too large' } },
        },
      },
      '/api/private/v1/openapi.json': {
        get: {
          summary: 'Download the authenticated OpenAPI contract',
          responses: { '200': { description: 'OpenAPI 3.1 document' } },
        },
      },
    },
  };
}
