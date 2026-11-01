import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function partnerRuntime(options = {}) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const controlledClock = options.nowMs !== undefined;
  if (controlledClock && !Number.isSafeInteger(options.nowMs)) throw new TypeError('Fixture time must be integer milliseconds');
  // This clock and control route exist only in the generated test entrypoint.
  // Set the Worker isolate's clock: mocking Date in Node cannot affect workerd.
  const clock = controlledClock ? `let fixtureNowMs = ${options.nowMs}; Date.now = () => fixtureNowMs;` : '';
  const clockRoute = controlledClock ? `if (request.url === 'https://partner-fixture.invalid/__clock' && request.method === 'POST') {
      fixtureNowMs = Number(await request.text()); return new Response(null, {status:204});
    }` : '';
  const handler = options.reviewerFixture ? `handleEcosystemRequest(request,{...env,ECOSYSTEM_PLATFORM_ADMIN_SUBJECTS:'reviewer-fixture'},
        request.headers.get('X-Fixture-Reviewer')==='yes'?{subject:'reviewer-fixture',email:'reviewer@example.com'}:undefined)`
      : 'handleEcosystemRequest(request,env,undefined)';
  const entry = `import {handleEcosystemRequest} from './workers/ecosystem-api.mjs';
    ${clock}
    export default {async fetch(request,env){${clockRoute} return ${handler};}};`;
  // Miniflare removes the production native PBKDF2 cap. Reproduce it so a
  // locally successful password flow cannot conceal the deployed failure.
  const productionCryptoLimit = `const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
    crypto.subtle.deriveBits = (algorithm, ...args) => {
      if (algorithm.name === 'PBKDF2' && algorithm.iterations > 100000)
        throw new DOMException('Production PBKDF2 iteration cap', 'NotSupportedError');
      return deriveBits(algorithm, ...args);
    };`;
  const bundle = await build({
    stdin: { contents: productionCryptoLimit + entry, resolveDir: root },
    bundle: true, format: 'esm', platform: 'browser', write: false,
  });
  // Match the production Pages compatibility date. Reviewer identities and
  // email delivery are explicit local fixtures, never production auth paths.
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-05-03', d1Databases: ['ECOSYSTEM_DB'],
    bindings: {DEVELOPER_HUB_OWNER_EMAIL:options.ownerEmail || 'owner@example.com'},
    serviceBindings: {PARTNER_EMAIL: async request => Response.json(new URL(request.url).pathname === '/health' ? {configured:options.emailAvailable !== false,developerApprovalConfigured:options.emailAvailable !== false} : {queued:true},{status:200})},
  }));
  try {
    const db = await runtime.getD1Database('ECOSYSTEM_DB');
    for (const file of ['0001_ecosystem.sql','0002_partner_portal_v2.sql','0003_partner_accounts.sql','0004_partner_completion_and_recovery.sql','0005_partner_reviewers.sql','0006_developer_hub_access.sql']) {
      const sql = (await readFile(new URL('../ecosystem-migrations/' + file, import.meta.url), 'utf8')).replace(/^\s*--.*$/gm, '');
      for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    return { runtime, db, async setTime(nowMs) {
      if (!controlledClock || !Number.isSafeInteger(nowMs)) throw new TypeError('A controlled fixture clock and integer milliseconds are required');
      const response = await runtime.dispatchFetch('https://partner-fixture.invalid/__clock', {method:'POST',body:String(nowMs)});
      if (response.status !== 204) throw new Error('Could not advance the fixture clock');
    } };
  } catch (error) { await runtime.dispose(); throw error; }
}
