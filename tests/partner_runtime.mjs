import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function partnerRuntime() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const bundle = await build({
    stdin: { contents: "export { default } from './workers/ecosystem-api.mjs';", resolveDir: root },
    bundle: true, format: 'esm', platform: 'browser', write: false,
  });
  // The pinned test workerd supports dates through September 15. Production
  // continues to use its own existing compatibility date.
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-09-09', d1Databases: ['ECOSYSTEM_DB'],
  }));
  try {
    const db = await runtime.getD1Database('ECOSYSTEM_DB');
    for (const file of ['0001_ecosystem.sql','0002_partner_portal_v2.sql','0003_partner_accounts.sql']) {
      const sql = (await readFile(new URL('../ecosystem-migrations/' + file, import.meta.url), 'utf8')).replace(/^\s*--.*$/gm, '');
      for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    return { runtime, db };
  } catch (error) { await runtime.dispose(); throw error; }
}
