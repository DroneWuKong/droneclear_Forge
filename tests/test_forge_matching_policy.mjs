import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {handlePatternsAutonomy} from '../workers/patterns-autonomy.mjs';
import {validateForgeBundle,rankForgeItems,verifyForgeManifest,matchingConstraintsHold} from '../workers/forge-matching-policy.mjs';
import {canonicalJson,sha256} from '../workers/retrieval-policy.mjs';
import {verifyMatchingOrder,applyMatchingPolicy} from '../forge-source/forge-matching-policy.js';
import {cleanForgeMatchingFeedback} from '../workers/forge-matching-feedback.mjs';

// Entirely fictional bundle from the Python test fixture; no production labels.
const bundle=JSON.parse(readFileSync(new URL('./fixtures/forge_matching_bundle.json',import.meta.url)));
const version=bundle.candidate.candidate_version,secret='test-forge-signing-secret-at-least-32-bytes';
function setup(){
  const sql=new DatabaseSync(':memory:');
  for(const file of ['0001_autonomous_evidence','0002_retrieval_shadow','0003_retrieval_policy_promotion',
    '0004_retrieval_policy_monitoring','0005_autonomy_ingress_controls','0006_portfolio_improvement_decisions',
    '0007_improvement_experiment_os','0008_forge_matching_policy'])
    sql.exec(readFileSync(new URL(`../migrations/${file}.sql`,import.meta.url),'utf8'));
  const db={prepare(query){let args={};return {bind(...values){args=Object.fromEntries(values.map((v,i)=>[i+1,v]));return this;},
    async first(){return sql.prepare(query).get(args)||null;},async all(){return {results:sql.prepare(query).all(args)};},
    async run(){return {meta:sql.prepare(query).run(args)};}};}};
  return {sql,env:{AUTONOMY_DB:db,PATTERNS_REVIEW_TOKEN:'review-token',FORGE_POLICY_SIGNING_SECRET:secret,
    PATTERNS_RATE_LIMIT_SECRET:'test-rate-limit-secret-with-more-than-32-bytes'}};
}
function request(path,payload,token='review-token',origin='https://uas-forge.com'){
  return new Request('https://uas-forge.com/api/autonomy/forge-policy/'+path,{method:payload===undefined?'GET':'POST',
    headers:{'content-type':'application/json',origin,'cf-connecting-ip':'203.0.113.99',...(token?{authorization:'Bearer '+token}:{})},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
}
async function call(env,path,payload,token){return handlePatternsAutonomy(request(path,payload,token),env);}
const f=(weight,complete,warnings=0)=>({weight_known:true,weight_g:weight,specification_completeness:complete,warning_count:warnings});
const items=[{id:0,group:'compatible',features:f(100,.1)},{id:1,group:'compatible',features:f(200,1)},
  {id:2,group:'caution',features:f(100,.1,1)},{id:3,group:'caution',features:f(200,1,1)},
  {id:4,group:'caution',features:f(200,1,2)},{id:5,group:'incompatible',features:f(1,1,1)}];
const input=()=>({request_id:crypto.randomUUID(),context_sha256:'a'.repeat(64),catalog_revision:'b'.repeat(64),items});
async function registered(env){
  assert.equal((await call(env,'candidates',bundle)).status,200);
  assert.equal((await call(env,'shadow',{candidate_version:version,expected_generation:0,notes:'Fictional test shadow'})).status,200);
}
function addReceipts(sql){
  const stmt=sql.prepare('INSERT INTO forge_matching_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<100;i++)stmt.run('fictional-'+i,version,bundle.bundle_sha256,String(i%25).padStart(64,'0'),'b'.repeat(64),
    'shadow','compared',null,1,'c'.repeat(64),'d'.repeat(64),new Date(Date.UTC(2026,8,1)+i*7200000).toISOString());
}
async function manifestFor(report){
  const m={schema_version:'forge-match-manifest-v1',policy_id:'forge-product-matching',candidate_version:version,
    bundle_sha256:bundle.bundle_sha256,shadow_sha256:report.shadow_sha256,rollback_to:'compatibility-weight-v1',
    approval:{schema_version:'forge-match-approval-v1',approval_id:crypto.randomUUID(),action:'approve-promotion',
      approved_at:new Date().toISOString(),bundle_sha256:bundle.bundle_sha256,shadow_sha256:report.shadow_sha256,
      rationale_sha256:'e'.repeat(64),reviewer_reference_sha256:'f'.repeat(64)},serving_changes:false};
  m.manifest_sha256=await sha256(canonicalJson(m));
  m.signature=createHmac('sha256',secret).update(canonicalJson(m)).digest('hex');return m;
}

test('Python bundle validates; offline tampering and missing sample coverage fail closed',async()=>{
  await validateForgeBundle(bundle);
  for(const mutate of [b=>b.candidate.parameters.lightness_weight++,b=>delete b.evaluation.training.pairs,b=>b.evaluation.gates.no_case_regressions=false]){
    const b=structuredClone(bundle);mutate(b);b.evaluation.evaluation_sha256=await sha256(canonicalJson(Object.fromEntries(Object.entries(b.evaluation).filter(([k])=>k!=='evaluation_sha256'))));
    b.bundle_sha256=await sha256(canonicalJson(Object.fromEntries(Object.entries(b).filter(([k])=>k!=='bundle_sha256'))));
    await assert.rejects(validateForgeBundle(b));
  }
});
test('ordering preserves fixed groups, warning strata, ties and incompatible membership',()=>{
  const order=rankForgeItems(items,bundle.candidate.parameters);assert.deepEqual(order,[1,0,3,2,4,5]);
  assert.equal(verifyMatchingOrder(items,order),true);
  assert.equal(matchingConstraintsHold(items,order),true);
  for(const wrong of [[5,0,3,2,4,1],[1,0,4,2,3,5],[0,0,2,3,4,5],[],[99,0,3,2,4,5]])assert.equal(verifyMatchingOrder(items,wrong),false);
  assert.deepEqual(rankForgeItems(items,{lightness_weight:0,specification_completeness_weight:0}),[0,1,2,3,4,5]);
});
test('registry and shadow require reviewer authority; shadow keeps incumbent order and retry identity',async()=>{
  const {env,sql}=setup();assert.equal((await call(env,'candidates',bundle,null)).status,401);
  await registered(env);
  const body=input(),response=await call(env,'resolve',body,null);assert.equal(response.status,200);
  const result=await response.json();assert.deepEqual(result.order,[0,1,2,3,4,5]);assert.equal(result.mode,'shadow');
  assert.equal((await call(env,'resolve',body,null)).status,200);
  assert.equal(sql.prepare('SELECT count(*) n FROM forge_matching_receipts').get().n,1);
  assert.equal(sql.prepare('SELECT result_sha256 FROM forge_matching_receipts').get().result_sha256,
    await sha256(canonicalJson([1,0,3,2,4,5])));
  assert.equal((await call(env,'resolve',{...body,context_sha256:'c'.repeat(64)},null)).status,409);
  assert.equal((await handlePatternsAutonomy(request('resolve',input(),null,'https://hostile.invalid'),env)).status,403);
  assert.equal((await call(env,'shadow',{enabled:false,expected_generation:0,notes:'Stale attempt'})).status,409);
});
test('signed release requires exact recorded evidence and supports atomic audited rollback',async()=>{
  const {env,sql}=setup();await registered(env);
  let report=await (await call(env,'evaluate',{candidate_version:version})).json();assert.equal(report.passed,false);
  const early=await manifestFor(report);assert.equal((await call(env,'manifests',early)).status,409);
  addReceipts(sql);report=await (await call(env,'evaluate',{candidate_version:version})).json();assert.equal(report.passed,true);
  const manifest=await manifestFor(report);assert.equal(await verifyForgeManifest(manifest,secret),true);
  assert.equal((await call(env,'manifests',manifest)).status,200);
  assert.equal((await call(env,'activate',{manifest_sha256:manifest.manifest_sha256,expected_generation:1,notes:'Still shadowing'})).status,409);
  assert.equal((await call(env,'shadow',{enabled:false,expected_generation:1,notes:'End shadow'})).status,200);
  assert.equal((await call(env,'activate',{manifest_sha256:manifest.manifest_sha256,expected_generation:2,notes:'Fictional explicit activation'})).status,200);
  const result=await (await call(env,'resolve',input(),null)).json();assert.equal(result.mode,'active');assert.deepEqual(result.order,[1,0,3,2,4,5]);
  assert.equal((await call(env,'rollback',{expected_generation:2,notes:'Stale rollback'})).status,409);
  assert.equal((await call(env,'rollback',{expected_generation:3,notes:'Fictional rollback drill'})).status,200);
  assert.equal((await (await call(env,'status')).json()).active_version,'compatibility-weight-v1');
  assert.equal(sql.prepare('SELECT count(*) n FROM forge_matching_transitions').get().n,4);
  assert.throws(()=>sql.prepare("UPDATE forge_matching_transitions SET notes='tampered'").run(),/immutable/);
  assert.throws(()=>sql.prepare('UPDATE forge_matching_policy_state SET generation=generation+2').run(),/exactly once/);
});
test('invalid active signature returns incumbent fallback, not learned results',async()=>{
  const {env,sql}=setup();await registered(env);addReceipts(sql);
  const report=await (await call(env,'evaluate',{candidate_version:version})).json(),manifest=await manifestFor(report);
  await call(env,'manifests',manifest);await call(env,'shadow',{enabled:false,expected_generation:1,notes:'End shadow'});
  await call(env,'activate',{manifest_sha256:manifest.manifest_sha256,expected_generation:2,notes:'Fixture'});
  env.FORGE_POLICY_SIGNING_SECRET='wrong-signing-secret-at-least-32-bytes';
  const result=await (await call(env,'resolve',input(),null)).json();
  assert.equal(result.fallback,true);assert.equal(result.policy_version,'compatibility-weight-v1');assert.deepEqual(result.order,[0,1,2,3,4,5]);
  assert.equal(sql.prepare("SELECT count(*) n FROM forge_matching_receipts WHERE outcome='fallback'").get().n,1);
});
test('dashboard approval signs only the exact passing evidence and never activates it',async()=>{
  const {env,sql}=setup();await registered(env);addReceipts(sql);
  const report=await (await call(env,'evaluate',{candidate_version:version})).json();
  const approval={candidate_version:version,bundle_sha256:bundle.bundle_sha256,shadow_sha256:report.shadow_sha256,
    notes:'Fictional independent release review',reviewer_reference:'dashboard:fictional-audit'};
  assert.equal((await call(env,'approve',{...approval,shadow_sha256:'0'.repeat(64)})).status,409);
  const response=await call(env,'approve',approval);assert.equal(response.status,200,await response.clone().text());
  assert.equal((await response.json()).serving_changes,false);
  const status=await (await call(env,'status')).json();assert.equal(status.active_version,'compatibility-weight-v1');
  assert.ok(status.approved_manifest_sha256);assert.equal(status.signing_configured,true);
});
test('browser refuses an unsafe response and preserves incumbent during outages',async()=>{
  const saved=globalThis.fetch;
  const rows=()=>[['compatible',[{comp:{schema_data:{weight_g:100}},warningCount:0},{comp:{schema_data:{weight_g:200}},warningCount:0}]]];
  try{
    globalThis.fetch=async()=>new Response(JSON.stringify({mode:'active',policy_version:version,fallback:false,order:[0,0]}));
    assert.equal((await applyMatchingPolicy(rows(),{context_sha256:'a'.repeat(64),catalog_revision:'b'.repeat(64)})).applied,false);
    globalThis.fetch=async()=>{throw Error('offline');};assert.equal((await applyMatchingPolicy(rows(),{})).applied,false);
  }finally{globalThis.fetch=saved;}
});
test('learned feedback retains original order and cannot silently claim incumbent',()=>{
  const v={schema_version:'forge-match-feedback-v1',feedback_id:crypto.randomUUID(),context_sha256:'a'.repeat(64),catalog_revision:'b'.repeat(64),
    policy_version:version,category:'motors',label:'helpful',target:{product_id:'fictional-part',compatibility_group:'compatible',position:1,incumbent_position:2,features:f(200,1)}};
  assert.equal(cleanForgeMatchingFeedback(v).target.incumbent_position,2);
  const changed=structuredClone(v);delete changed.target.incumbent_position;assert.throws(()=>cleanForgeMatchingFeedback(changed));
  assert.throws(()=>cleanForgeMatchingFeedback({...v,policy_version:'compatibility-weight-v1'}));
});
