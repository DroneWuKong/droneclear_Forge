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

test('supplier dollar reservations serialize, settle, and survive a restart', async () => {
  const source = `export { ModelBudget } from './workers/model-budget.mjs';
    export default { async fetch(req,env) {
      const stub=env.MODEL_BUDGET.get(env.MODEL_BUDGET.idFromName('supplier-runtime-test'));
      const body=await req.json();
      return Response.json(await stub[body.method](body.input));
    }};`;
  const bundled = await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],write:false});
  const directory=await mkdtemp(join(tmpdir(),'supplier-budget-test-'));
  const options=convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-09',durableObjects:{MODEL_BUDGET:{className:'ModelBudget',useSQLite:true}},resourcePersistencePath:directory});
  let runtime;
  const call=async(method,input)=>(await runtime.dispatchFetch('http://localhost/',{method:'POST',body:JSON.stringify({method,input})})).json();
  try {
    runtime=new Miniflare(options);
    const countries=['DE','FR','NL','CZ','PL','AT','BE','BG','HR','CY'];
    const results=await Promise.all(countries.map(country=>call('reserveSupplier',{id:`2026-W44-${country}`,week:'2026-W44',amount:5000000})));
    assert.equal(results.filter(r=>r.allowed).length,5);
    assert.equal((await call('supplierStatus',{})).committed_micro_usd,25000000);
    const index=results.findIndex(r=>r.allowed), id=`2026-W44-${countries[index]}`;
    await call('settleSupplier',{month:results[index].month,id,actual:10000,result:{status:'completed',candidates:[]}});
    assert.equal((await call('supplierStatus',{})).committed_micro_usd,20010000);
    await runtime.dispose();runtime=new Miniflare(options);
    assert.equal((await call('supplierStatus',{})).committed_micro_usd,20010000);
    const retry=await call('reserveSupplier',{id,week:'2026-W44',amount:5000000});
    assert.equal(retry.duplicate,true);assert.equal(retry.entry.status,'settled');
  } finally {await runtime?.dispose();await rm(directory,{recursive:true,force:true});}
});
