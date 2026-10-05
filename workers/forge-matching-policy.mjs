// Display-only reranking. Eligibility groups, warning strata, and membership
// stay fixed; public input is operational telemetry, never an accepted label.
import { canonicalJson, sha256 } from './retrieval-policy.mjs';
const HASH = /^[0-9a-f]{64}$/;
const VERSION = /^candidate-[0-9a-f]{16}$/;
export const INCUMBENT = 'compatibility-weight-v1';
export const SHADOW_LIMITS = Object.freeze({receipts:100,contexts:25,duration_days:7,
  maximum_failure_rate:.01,maximum_p95_ms:50});
const hash = value => sha256(canonicalJson(value));
const without = (value, ...keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const exact = (value, keys) => value && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
class ForgePolicyError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
const fail = (message,status=400) => { throw new ForgePolicyError(message,status); };

export async function validateForgeBundle(bundle) {
  const c=bundle?.candidate,e=bundle?.evaluation,p=c?.parameters;
  if (!exact(bundle,['schema_version','candidate','evaluation','contains_raw_private_input','serving_changes','bundle_sha256'])
    || bundle.schema_version!=='forge-match-runtime-v1' || bundle.contains_raw_private_input!==false || bundle.serving_changes!==false
    || !HASH.test(bundle.bundle_sha256||'') || await hash(without(bundle,'bundle_sha256'))!==bundle.bundle_sha256
    || !exact(c,['schema_version','candidate_version','built_at','policy_id','incumbent_version','training_contexts_sha256',
      'training_records_sha256','parameters','corpus_sha256','compatible_feature_schema','writes_to_serving','promotion_eligible'])
    || c?.schema_version!=='forge-match-candidate-v1' || c.policy_id!=='forge-product-matching'
    || c.incumbent_version!==INCUMBENT || c.compatible_feature_schema!=='forge-match-features-v1'
    || c.writes_to_serving!==false || c.promotion_eligible!==false || !VERSION.test(c.candidate_version||'')
    || !['corpus_sha256','training_contexts_sha256','training_records_sha256'].every(k=>HASH.test(c[k]||''))
    || !Number.isFinite(Date.parse(c.built_at)) || Date.parse(c.built_at)>Date.now()
    || !exact(p,['lightness_weight','specification_completeness_weight'])
    || !Object.values(p).every(v=>Number.isInteger(v)&&v>=0&&v<=4) || Object.values(p).every(v=>v===0)
    || e?.schema_version!=='forge-match-evaluation-v1' || e.candidate_version!==c.candidate_version
    || !exact(e,['schema_version','candidate_version','cutoff','gates','training','incumbent_holdout','candidate_holdout',
      'accuracy_delta','regressed_cases','shadow_eligible','promotion_eligible','serving_changes','source_evaluation_sha256','evaluation_sha256'])
    || e.shadow_eligible!==true || e.promotion_eligible!==false || e.serving_changes!==false
    || await hash(without(e,'evaluation_sha256'))!==e.evaluation_sha256
    || !exact(e.gates,['context_disjoint','chronological_holdout','compatibility_groups_fixed','warning_count_order_fixed','no_case_regressions','accuracy_improved'])
    || !Object.values(e.gates).every(v=>v===true) || !Array.isArray(e.regressed_cases) || e.regressed_cases.length
    || !finite(e.accuracy_delta,.02,1)
    || !HASH.test(e.source_evaluation_sha256||'')
    || ![e.training?.pairs,e.training?.contexts,e.incumbent_holdout?.pairs,e.incumbent_holdout?.contexts].every(Number.isInteger)
    || e.training.pairs<20 || e.training.contexts<10 || e.incumbent_holdout.pairs<10 || e.incumbent_holdout.contexts<5
    || e.candidate_holdout?.pairs!==e.incumbent_holdout.pairs || e.candidate_holdout?.contexts!==e.incumbent_holdout.contexts
    || !finite(e.candidate_holdout?.macro_case_accuracy,0,1) || !finite(e.incumbent_holdout?.macro_case_accuracy,0,1)
    || Math.abs(e.candidate_holdout.macro_case_accuracy-e.incumbent_holdout.macro_case_accuracy-e.accuracy_delta)>1e-6
  ) fail('Invalid Forge runtime bundle or unpassed offline gates');
  for(const metrics of [e.training,e.incumbent_holdout,e.candidate_holdout]) {
    if(!exact(metrics,['pairs','contexts','macro_case_accuracy','case_accuracy']) || !metrics.case_accuracy
      || Array.isArray(metrics.case_accuracy) || Object.keys(metrics.case_accuracy).length>10000
      || !Object.entries(metrics.case_accuracy).every(([key,value])=>HASH.test(key)&&finite(value,0,1)))
      fail('Invalid minimized Forge evaluation metrics');
  }
  const core={policy_id:c.policy_id,incumbent_version:c.incumbent_version,
    training_contexts_sha256:c.training_contexts_sha256,training_records_sha256:c.training_records_sha256,parameters:p};
  if ('candidate-'+(await hash(core)).slice(0,16)!==c.candidate_version) fail('Forge candidate identity mismatch');
  return bundle;
}

export function validateMatchingInput(value) {
  if (!exact(value,['request_id','context_sha256','catalog_revision','items'])
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.request_id||'')
    || !HASH.test(value.context_sha256||'') || !HASH.test(value.catalog_revision||'')
    || !Array.isArray(value.items) || value.items.length<1 || value.items.length>100
    || new Set(value.items.map(v=>v.id)).size!==value.items.length) fail('Invalid bounded matching input');
  for (const row of value.items) {
    const f=row?.features;
    if (!exact(row,['id','group','features']) || !Number.isInteger(row.id) || row.id<0 || row.id>=100
      || !['compatible','caution','incompatible'].includes(row.group)
      || !exact(f,['weight_known','weight_g','warning_count','specification_completeness'])
      || typeof f.weight_known!=='boolean' || !finite(f.weight_g,0,100000) || !finite(f.specification_completeness,0,1)
      || !Number.isInteger(f.warning_count) || !finite(f.warning_count,0,100)
      || (!f.weight_known&&f.weight_g!==0) || ((row.group==='compatible')!==(f.warning_count===0))) fail('Invalid matching feature snapshot');
  }
  // Ordering/group declarations must be the existing incumbent ordering.
  const groups={compatible:0,caution:1,incompatible:2};
  for(let i=1;i<value.items.length;i++) {
    const a=value.items[i-1],b=value.items[i];
    if(groups[a.group]>groups[b.group] || a.group===b.group && a.group==='caution' && a.features.warning_count>b.features.warning_count)
      fail('Input crosses fixed eligibility or warning strata');
  }
  return value;
}

export function rankForgeItems(items, parameters) {
  const score=row=>parameters.lightness_weight*(row.features.weight_known?1/(1+row.features.weight_g/100):0)
    +parameters.specification_completeness_weight*row.features.specification_completeness;
  return items.map((row,index)=>({row,index})).sort((a,b)=>{
    if(a.row.group!==b.row.group || a.row.group==='incompatible' || a.row.features.warning_count!==b.row.features.warning_count)
      return a.index-b.index;
    return score(b.row)-score(a.row) || a.index-b.index;
  }).map(v=>v.row.id);
}

export function matchingConstraintsHold(items,order) {
  if(!Array.isArray(order)||order.length!==items.length||new Set(order).size!==items.length)return false;
  const rows=new Map(items.map(v=>[v.id,v]));
  return order.every((id,i)=>{const row=rows.get(id),before=items[i];
    return row&&row.group===before.group&&row.features.warning_count===before.features.warning_count
      &&(row.group!=='incompatible'||row.id===before.id);});
}

async function event(db, id, kind, version, data) {
  const encoded=canonicalJson(data);
  await db.prepare('INSERT OR IGNORE INTO evidence_events(id,entity_type,entity_id,event_type,data,created) VALUES(?1,?2,?3,?4,?5,?6)')
    .bind(id,'forge-policy',version,kind,encoded,new Date().toISOString()).run();
  if((await db.prepare('SELECT data FROM evidence_events WHERE id=?1').bind(id).first())?.data!==encoded)
    fail('Forge artifact identifier conflict',409);
}
async function readBundle(db, version) {
  const row=await db.prepare("SELECT data FROM evidence_events WHERE entity_type='forge-policy' AND event_type='candidate' AND entity_id=?1").bind(version).first();
  if(!row) fail('Registered Forge candidate unavailable');
  return validateForgeBundle(JSON.parse(row.data));
}
async function state(db) {
  return await db.prepare('SELECT * FROM forge_matching_policy_state WHERE policy_id=?1').bind('forge-product-matching').first()
    || {active_version:INCUMBENT,active_manifest_id:null,shadow_version:null,generation:0};
}
async function change(db, input, updates, action, requireIncumbent=false, requireNoShadow=false) {
  if(!Number.isInteger(input?.expected_generation) || input.expected_generation<0
    || typeof input.notes!=='string' || !input.notes.trim() || input.notes.length>5000) fail('Exact generation and reviewer note required');
  await db.prepare("INSERT OR IGNORE INTO forge_matching_policy_state(policy_id,updated) VALUES('forge-product-matching',?1)").bind(new Date().toISOString()).run();
  const current=await state(db);
  const next={...current,...updates};
  return db.prepare('UPDATE forge_matching_policy_state SET active_version=?1,active_manifest_id=?2,shadow_version=?3,generation=generation+1,action=?4,notes=?5,updated=?6 WHERE policy_id=?7 AND generation=?8 AND (?9=0 OR active_version=?10) AND (?11=0 OR shadow_version IS NULL) RETURNING generation,active_version,shadow_version')
    .bind(next.active_version,next.active_manifest_id,next.shadow_version,action,input.notes.trim(),new Date().toISOString(),'forge-product-matching',input.expected_generation,
      Number(requireIncumbent),INCUMBENT,Number(requireNoShadow)).first();
}
async function hmac(secret, value) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(canonicalJson(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function verifyForgeManifest(manifest, secret) {
  if(typeof secret!=='string' || new TextEncoder().encode(secret).length<32
    || !exact(manifest,['schema_version','policy_id','candidate_version','bundle_sha256','shadow_sha256','rollback_to','approval','serving_changes','manifest_sha256','signature'])
    || manifest.schema_version!=='forge-match-manifest-v1' || manifest.policy_id!=='forge-product-matching'
    || !VERSION.test(manifest.candidate_version||'') || manifest.rollback_to!==INCUMBENT || manifest.serving_changes!==false
    || !['bundle_sha256','shadow_sha256','manifest_sha256','signature'].every(k=>HASH.test(manifest[k]||''))) return false;
  const a=manifest.approval;
  if(!exact(a,['schema_version','approval_id','action','approved_at','bundle_sha256','shadow_sha256','rationale_sha256','reviewer_reference_sha256'])
    || a.schema_version!=='forge-match-approval-v1' || a.action!=='approve-promotion'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a.approval_id||'')
    || !HASH.test(a.rationale_sha256||'') || !HASH.test(a.reviewer_reference_sha256||'')
    || a.bundle_sha256!==manifest.bundle_sha256 || a.shadow_sha256!==manifest.shadow_sha256
    || !Number.isFinite(Date.parse(a.approved_at)) || Date.parse(a.approved_at)>Date.now()) return false;
  if(await hash(without(manifest,'signature','manifest_sha256'))!==manifest.manifest_sha256) return false;
  const expected=await hmac(secret,without(manifest,'signature'));
  let mismatch=0;for(let i=0;i<64;i++) mismatch|=expected.charCodeAt(i)^manifest.signature.charCodeAt(i);
  return mismatch===0;
}

async function shadowReport(db, version) {
  const bundle=await readBundle(db,version);
  const result=await db.prepare("SELECT context_sha256,latency_ms,outcome,reason,created FROM forge_matching_receipts WHERE candidate_version=?1 AND bundle_sha256=?2 AND mode='shadow' ORDER BY created LIMIT 10001")
    .bind(version,bundle.bundle_sha256).all();
  const rows=result.results,latencies=rows.map(r=>r.latency_ms).sort((a,b)=>a-b);
  const metrics={receipts:rows.length,contexts:new Set(rows.map(r=>r.context_sha256)).size,
    duration_days:rows.length?(Date.parse(rows.at(-1).created)-Date.parse(rows[0].created))/86400000:0,
    failure_rate:rows.length?rows.filter(r=>r.outcome==='fallback').length/rows.length:1,
    p95_ms:latencies.length?latencies[Math.ceil(latencies.length*.95)-1]:null,
    constraint_failures:rows.filter(r=>r.reason==='constraint-failure').length};
  const passed=rows.length<=10000 && metrics.receipts>=SHADOW_LIMITS.receipts && metrics.contexts>=SHADOW_LIMITS.contexts
    && metrics.duration_days>=SHADOW_LIMITS.duration_days && metrics.failure_rate<=SHADOW_LIMITS.maximum_failure_rate
    && metrics.p95_ms<=SHADOW_LIMITS.maximum_p95_ms && metrics.constraint_failures===0;
  const report={schema_version:'forge-match-shadow-evaluation-v1',candidate_version:version,bundle_sha256:bundle.bundle_sha256,
    evaluated_at:new Date().toISOString(),limits:SHADOW_LIMITS,metrics,passed,truncated:rows.length>10000,
    telemetry_quality:'public-client-feature-snapshot',promotion_eligible:false,serving_changes:false};
  report.shadow_sha256=await hash(report);
  return report;
}

async function resolve(input,env) {
  validateMatchingInput(input);
  const started=performance.now(),db=env.AUTONOMY_DB;
  const incumbent=input.items.map(v=>v.id);
  let current,version,bundle,reason=null,order=incumbent,comparisonOrder=incumbent,mode='incumbent';
  try {
    current=await state(db);
    version=current.active_version!==INCUMBENT?current.active_version:current.shadow_version;
    if(version) {
      bundle=await readBundle(db,version);
      const proposed=rankForgeItems(input.items,bundle.candidate.parameters);
      if(!matchingConstraintsHold(input.items,proposed)){reason='constraint-failure';fail('Forge fixed constraints failed');}
      comparisonOrder=proposed;
      if(current.active_version!==INCUMBENT) {
        const row=await db.prepare('SELECT data FROM evidence_events WHERE id=?1 AND event_type=?2').bind(current.active_manifest_id,'manifest').first();
        const manifest=row&&JSON.parse(row.data);
        if(!manifest || !await verifyForgeManifest(manifest,env.FORGE_POLICY_SIGNING_SECRET)
          || manifest.bundle_sha256!==bundle.bundle_sha256 || manifest.candidate_version!==version) fail('Active manifest invalid');
        mode='active';order=proposed;
      } else mode='shadow';
    }
  } catch {reason ||= 'policy-unavailable-or-invalid';mode='incumbent';comparisonOrder=incumbent;}
  if(version) {
    const record={candidate:version,bundle:bundle?.bundle_sha256||'0'.repeat(64),context:input.context_sha256,
      catalog:input.catalog_revision,mode:current?.active_version!==INCUMBENT?'active':'shadow',
      outcome:reason?'fallback':'compared',reason,latency:performance.now()-started,
      input:await hash(input.items),result:await hash(comparisonOrder)};
    const id=await hash({request_id:input.request_id,generation:current.generation});
    const old=await db.prepare('SELECT input_sha256,context_sha256,catalog_revision,candidate_version FROM forge_matching_receipts WHERE id=?1').bind(id).first();
    if(old && (old.input_sha256!==record.input || old.context_sha256!==record.context || old.catalog_revision!==record.catalog || old.candidate_version!==version))
      fail('Matching request identifier reused',409);
    await db.prepare('INSERT OR IGNORE INTO forge_matching_receipts VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)')
      .bind(id,record.candidate,record.bundle,record.context,record.catalog,record.mode,record.outcome,reason,
        record.latency,record.input,record.result,new Date().toISOString()).run();
  }
  return {order,policy_version:mode==='active'?version:INCUMBENT,configured_version:version||null,mode,
    generation:current?.generation||0,fallback:!!reason,fallback_reason:reason,automatic_promotion:false};
}

async function handlePolicy(request,env,helpers) {
  const path=new URL(request.url).pathname.split('/api/autonomy/forge-policy')[1]||'';
  const {respond,parseBody,reviewAuthorized,sameOrigin,rateLimit}=helpers,db=env.AUTONOMY_DB;
  if(path==='/resolve' && request.method==='POST') {
    if(!sameOrigin) return respond(403,{error:'Same-origin matching request required'});
    const limited=await rateLimit();if(limited)return limited;
    return respond(200,await resolve(await parseBody(request,65536),env));
  }
  if(path==='/status' && request.method==='GET') {
    const s=await state(db);
    const row=await db.prepare("SELECT data FROM evidence_events WHERE entity_type='forge-policy' AND event_type='manifest' ORDER BY created DESC,rowid DESC LIMIT 1").first();
    let approved;try{const m=row&&JSON.parse(row.data);if(m&&await verifyForgeManifest(m,env.FORGE_POLICY_SIGNING_SECRET))approved=m;}catch{}
    return respond(200,{policy_id:'forge-product-matching',active_version:s.active_version,shadow_version:s.shadow_version,active_manifest_sha256:s.active_manifest_id,
      approved_manifest_sha256:approved?.manifest_sha256||null,approved_candidate_version:approved?.candidate_version||null,
      signing_configured:typeof env.FORGE_POLICY_SIGNING_SECRET==='string'&&new TextEncoder().encode(env.FORGE_POLICY_SIGNING_SECRET).length>=32,
      generation:s.generation,automatic_promotion:false,serving_scope:'within-fixed-eligibility-and-warning-strata'});
  }
  if(!reviewAuthorized) return respond(401,{error:'Reviewer authorization required'});
  if(path==='/audit' && request.method==='GET') return respond(200,{transitions:(await db.prepare('SELECT * FROM forge_matching_transitions ORDER BY generation DESC LIMIT 100').all()).results});
  if(request.method!=='POST') return respond(405,{error:'Method not allowed'});
  const input=await parseBody(request,262144);
  if(path==='/candidates') {
    await validateForgeBundle(input);
    const id=await hash({candidate_version:input.candidate.candidate_version});
    await event(db,id,'candidate',input.candidate.candidate_version,input);
    return respond(200,{candidate_version:input.candidate.candidate_version,bundle_sha256:input.bundle_sha256,serving_changes:false});
  }
  if(path==='/shadow') {
    if(input.enabled!==false) await readBundle(db,input.candidate_version);
    if((await state(db)).active_version!==INCUMBENT) return respond(409,{error:'Return to incumbent before changing shadow'});
    const result=await change(db,input,{shadow_version:input.enabled===false?null:input.candidate_version},'shadow',true);
    return respond(result?200:409,result||{error:'Stale Forge generation'});
  }
  if(path==='/evaluate') {
    const report=await shadowReport(db,input.candidate_version);
    await event(db,report.shadow_sha256,'shadow-evaluation',input.candidate_version,report);
    return respond(200,report);
  }
  if(path==='/approve') {
    const notes=typeof input.notes==='string'?input.notes.trim():'';
    if(!notes || notes.length>4000 || !HASH.test(input.bundle_sha256||'') || !HASH.test(input.shadow_sha256||'')
      || typeof input.reviewer_reference!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,127}$/.test(input.reviewer_reference))
      fail('Exact evidence, reviewer reference and rationale required');
    const row=await db.prepare('SELECT data FROM evidence_events WHERE id=?1 AND event_type=?2').bind(input.shadow_sha256,'shadow-evaluation').first();
    const report=row&&JSON.parse(row.data);
    if(!report?.passed || report.bundle_sha256!==input.bundle_sha256 || report.candidate_version!==input.candidate_version)
      return respond(409,{error:'Passing evaluation changed or is unavailable'});
    if(typeof env.FORGE_POLICY_SIGNING_SECRET!=='string'||new TextEncoder().encode(env.FORGE_POLICY_SIGNING_SECRET).length<32)
      return respond(503,{error:'Forge policy signing is not configured'});
    const approval={schema_version:'forge-match-approval-v1',approval_id:crypto.randomUUID(),action:'approve-promotion',
      approved_at:new Date().toISOString(),bundle_sha256:input.bundle_sha256,shadow_sha256:input.shadow_sha256,
      rationale_sha256:await sha256(notes),reviewer_reference_sha256:await sha256(input.reviewer_reference)};
    const manifest={schema_version:'forge-match-manifest-v1',policy_id:'forge-product-matching',candidate_version:input.candidate_version,
      bundle_sha256:input.bundle_sha256,shadow_sha256:input.shadow_sha256,rollback_to:INCUMBENT,approval,serving_changes:false};
    manifest.manifest_sha256=await hash(manifest);manifest.signature=await hmac(env.FORGE_POLICY_SIGNING_SECRET,manifest);
    return handlePolicy(new Request(new URL('./manifests',request.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(manifest)}),env,helpers);
  }
  if(path==='/manifests') {
    if(!await verifyForgeManifest(input,env.FORGE_POLICY_SIGNING_SECRET)) return respond(400,{error:'Invalid signed Forge manifest'});
    const bundle=await readBundle(db,input.candidate_version);
    const row=await db.prepare('SELECT data FROM evidence_events WHERE id=?1 AND event_type=?2').bind(input.shadow_sha256,'shadow-evaluation').first();
    const report=row&&JSON.parse(row.data);
    if(bundle.bundle_sha256!==input.bundle_sha256 || !report?.passed || report.bundle_sha256!==input.bundle_sha256
      || Date.parse(input.approval.approved_at)<Date.parse(report.evaluated_at)) return respond(409,{error:'Exact passing shadow evaluation unavailable'});
    await event(db,input.manifest_sha256,'manifest',input.candidate_version,input);
    return respond(200,{manifest_sha256:input.manifest_sha256,serving_changes:false});
  }
  if(path==='/activate') {
    const row=await db.prepare('SELECT data FROM evidence_events WHERE id=?1 AND event_type=?2').bind(input.manifest_sha256,'manifest').first();
    const manifest=row&&JSON.parse(row.data),s=await state(db);
    if(!manifest || !await verifyForgeManifest(manifest,env.FORGE_POLICY_SIGNING_SECRET)) return respond(409,{error:'Approved manifest unavailable'});
    if(s.shadow_version || s.active_version!==INCUMBENT) return respond(409,{error:'Disable shadow and verify incumbent before activation'});
    const latest=await shadowReport(db,manifest.candidate_version);
    if(!latest.passed) return respond(409,{error:'Current shadow evidence no longer passes'});
    const result=await change(db,input,{active_version:manifest.candidate_version,active_manifest_id:manifest.manifest_sha256},'activate',true,true);
    return respond(result?200:409,result?{...result,serving_changes:true}:{error:'Stale Forge generation'});
  }
  if(path==='/rollback') {
    const result=await change(db,input,{active_version:INCUMBENT,active_manifest_id:null,shadow_version:null},'rollback');
    return respond(result?200:409,result?{...result,serving_changes:true}:{error:'Stale Forge generation'});
  }
  return respond(404,{error:'Forge policy route not found'});
}

export async function handleForgeMatchingPolicy(request,env,helpers) {
  try{return await handlePolicy(request,env,helpers);}
  catch(error){
    if(error instanceof ForgePolicyError)return helpers.respond(error.status,{error:error.message});
    throw error;
  }
}
