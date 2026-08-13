/**
 * workers/index.js — CF Pages Functions entry point
 * Routes all /api/* requests to the appropriate worker handler.
 *
 * CF Pages Functions convention: export onRequest from functions/api/[[path]].js
 * This router lives at workers/index.js and is imported by the Pages Function.
 */

import forgeData    from './forge-data.js';
import claudeProxy  from './claude-proxy.js';
import wingmanApi   from './wingman-api.js';
import groqProxy    from './groq-proxy.js';
import geminiProxy  from './gemini-proxy.js';
import pricesApi    from './prices-api.js';
import analyticsIngest from './analytics-ingest.js';
import complianceReport from './compliance-report.js';
import doctrineSubmit from './doctrine-submit.js';
import doctrineQueue  from './doctrine-queue.js';
import contributionSubmit from './contribution-submit.js';
import faaLookup     from './faa-lookup.js';
import digest        from './digest.js';
import publicApiV1   from './public-api-v1.js';
import privateApiV1  from './private-api-v1.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Secret',
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Versioned contracts get their own method and CORS policy. In particular,
    // private preflights must never inherit the wildcard legacy API CORS.
    if (path === '/api/private/v1' || path.startsWith('/api/private/v1/'))
      return privateApiV1.fetch(req, env, ctx);

    if (path === '/api/v1' || path.startsWith('/api/v1/'))
      return publicApiV1.fetch(req, env, ctx);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // Route table
    if (path === '/api/data' || path.startsWith('/api/data?'))
      return forgeData.fetch(req, env, ctx);

    if (path === '/api/wingman/claude')
      return claudeProxy.fetch(req, env, ctx);

    if (path === '/api/wingman')
      return wingmanApi.fetch(req, env, ctx);

    if (path === '/api/wingman/groq')
      return groqProxy.fetch(req, env, ctx);

    if (path === '/api/wingman/gemini')
      return geminiProxy.fetch(req, env, ctx);

    if (path === '/api/prices')
      return pricesApi.fetch(req, env, ctx);

    if (path === '/api/analytics/ingest')
      return analyticsIngest.fetch(req, env, ctx);

    if (path === '/api/compliance/report')
      return complianceReport.fetch(req, env, ctx);

    if (path === '/api/doctrine-submit')
      return doctrineSubmit.fetch(req, env, ctx);

    if (path === '/api/contribution-submit')
      return contributionSubmit.fetch(req, env, ctx);

    if (path === '/api/doctrine-queue' || path.startsWith('/api/doctrine-queue?'))
      return doctrineQueue.fetch(req, env, ctx);

    if (path === '/api/faa-lookup' || path.startsWith('/api/faa-lookup?'))
      return faaLookup.fetch(req, env, ctx);

    // PIE email digest (subscribe / confirm / unsubscribe / preview / admin send)
    if (path.startsWith('/api/digest/'))
      return digest.fetch(req, env, ctx);

    // Legacy /.netlify/functions/* redirect → /api/* equivalents
    if (path.startsWith('/.netlify/functions/')) {
      const fn = path.replace('/.netlify/functions/', '');
      const legacyMap = {
        'forge-data':        '/api/data',
        'claude-proxy':      '/api/wingman/claude',
        'wingman-api':       '/api/wingman',
        'groq-proxy':        '/api/wingman/groq',
        'gemini-proxy':      '/api/wingman/gemini',
        'prices-api':        '/api/prices',
        'analytics-ingest':  '/api/analytics/ingest',
        'compliance-report': '/api/compliance/report',
        'contribution-submit': '/api/contribution-submit',
        'doctrine-submit':   '/api/doctrine-submit',
        'doctrine-queue':    '/api/doctrine-queue',
        'faa-lookup':        '/api/faa-lookup',
      };
      const newPath = legacyMap[fn];
      if (newPath) {
        const newUrl = new URL(req.url);
        newUrl.pathname = newPath;
        return Response.redirect(newUrl.toString(), 308);
      }
    }

    return new Response(JSON.stringify({ error: 'Not found', path }), {
      status: 404,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
};
