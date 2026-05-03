/**
 * CF Pages Function — catches all /api/* requests and routes to workers/index.js
 * Deployed as: functions/api/[[path]].js
 * CF Pages auto-discovers this and serves it for /api/* routes.
 */

import router from '../../workers/index.js';

export async function onRequest(context) {
  return router.fetch(context.request, context.env, context.waitUntil);
}
