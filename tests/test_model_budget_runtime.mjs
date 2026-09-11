import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('SQLite budget serializes concurrent reservations and survives a runtime restart', async () => {
  const source = `export { ModelBudget } from './workers/model-budget.mjs';
    export default { async fetch(req,env) {
      const stub=env.MODEL_BUDGET.get(env.MODEL_BUDGET.idFromName('runtime-test'));
      return Response.json(await stub.reserve({units:16384}));
    }};`;
  const bundled = await build({ stdin: { contents:source, resolveDir:fileURLToPath(new URL('..',import.meta.url)) }, bundle:true, format:'esm', platform:'browser', external:['cloudflare:workers'], write:false });
  const directory = await mkdtemp(join(tmpdir(),'patterns-budget-test-'));
  const options = convertV4MiniflareOptions({ modules:true, script:bundled.outputFiles[0].text, compatibilityDate:'2026-09-09', durableObjects:{ MODEL_BUDGET:{ className:'ModelBudget',useSQLite:true } }, resourcePersistencePath:directory });
  let runtime;
  try {
    runtime = new Miniflare(options);
    const answers = await Promise.all(Array.from({length:30},async () => (await runtime.dispatchFetch('http://localhost/reserve')).json()));
    assert.equal(answers.filter(x=>x.allowed).length,15);
    assert.equal(answers.filter(x=>!x.allowed).length,15);
    await runtime.dispose();
    runtime = new Miniflare(options);
    assert.equal((await (await runtime.dispatchFetch('http://localhost/reserve')).json()).allowed,false);
  } finally {
    await runtime?.dispose();
    await rm(directory,{recursive:true,force:true});
  }
});
