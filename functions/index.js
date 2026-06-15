/**
 * CF Pages Function — apex (/) host-based landing redirects.
 * Deployed as: functions/index.js  → handles ONLY the "/" route.
 *
 * Why this exists:
 *   uas-patterns.com, uasdash.com, and uas-forge.com are all custom domains
 *   on the SAME Pages project, serving the same build/. The host-scoped rules
 *   in _redirects (e.g. `https://uas-patterns.com  …/patterns-home/  301`) are
 *   Netlify syntax — Cloudflare Pages _redirects only matches on the PATH, so
 *   those hostname-sourced lines silently no-op and every apex served Forge's
 *   home. This Function restores the intended per-domain apex landing.
 *
 * Cost note: only the bare "/" request hits this Function. Static assets and
 * every other path are served directly by Pages and never invoke a Worker.
 */

// host (sans www.) → absolute apex destination
const APEX_LANDINGS = {
  'uas-patterns.com': 'https://uas-patterns.com/patterns-home/',
  'uasdash.com': 'https://uas-forge.com/hub/',
};

export async function onRequest(context) {
  const { request, next } = context;
  const host = new URL(request.url).hostname.replace(/^www\./, '');
  const dest = APEX_LANDINGS[host];

  if (dest) {
    return Response.redirect(dest, 301);
  }
  // uas-forge.com (and anything else) keep the default apex = Forge home.
  return next();
}
