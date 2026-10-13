import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function partnerRuntime(options = {}) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const bundle = await build({
    stdin: { contents: options.reviewerFixture ? `import {handleEcosystemRequest} from './workers/ecosystem-api.mjs';
      export default {fetch(request,env){return handleEcosystemRequest(request,{...env,ECOSYSTEM_PLATFORM_ADMIN_SUBJECTS:'reviewer-fixture'},
        request.headers.get('X-Fixture-Reviewer')==='yes'?{subject:'reviewer-fixture',email:'reviewer@example.com'}:undefined)}};`
      : "export { default } from './workers/ecosystem-api.mjs';", resolveDir: root },
    bundle: true, format: 'esm', platform: 'browser', write: false,
  });
  // Match the production Pages compatibility date. Reviewer identities and
  // email delivery are explicit local fixtures, never production auth paths.
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-05-03', d1Databases: ['ECOSYSTEM_DB'],
    serviceBindings: {PARTNER_EMAIL: async request => Response.json(new URL(request.url).pathname === '/health' ? {configured:options.emailAvailable !== false} : {queued:true},{status:200})},
  }));
  try {
    const db = await runtime.getD1Database('ECOSYSTEM_DB');
    for (const file of ['0001_ecosystem.sql','0002_partner_portal_v2.sql','0003_partner_accounts.sql','0004_partner_completion_and_recovery.sql','0005_partner_reviewers.sql']) {
      const sql = (await readFile(new URL('../ecosystem-migrations/' + file, import.meta.url), 'utf8')).replace(/^\s*--.*$/gm, '');
      for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    return { runtime, db };
  } catch (error) { await runtime.dispose(); throw error; }
}
