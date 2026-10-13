import test from 'node:test';
import assert from 'node:assert/strict';
import { partnerRuntime } from './partner_runtime.mjs';
import { deliverPartnerEmails } from '../workers/partner-email-worker.mjs';

const origin='https://uas-forge.com', password='a synthetic partner recovery passphrase';
function client(runtime) {
  return (path,{method='GET',input,cookie,reviewer=false}={})=>runtime.dispatchFetch(origin+'/api/ecosystem/v1'+path,{
    method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(reviewer?{'X-Fixture-Reviewer':'yes'}:{})},
    ...(input?{body:JSON.stringify(input)}:{}),
  });
}
async function delivery(db,messages) {
  await deliverPartnerEmails({ECOSYSTEM_DB:db,EMAIL:{async send(message){messages.push(message)}}});
}
async function signup(call,db,email='partner@example.com') {
  const response=await call('/auth/signup',{method:'POST',input:{email,password,name:'Partner fixture',organizationName:'Fixture OEM'}});
  assert.equal(response.status,201,await response.clone().text());
  const account=await response.json(),cookie=response.headers.get('Set-Cookie').split(';')[0],messages=[];
  await delivery(db,messages);
  const token=messages[0].text.match(/#verify=([0-9a-f]{64})/)[1];
  return {account,cookie,messages,token};
}

test('verification and password recovery use expiring single-use links and revoke old sessions',async()=>{
  const {runtime,db}=await partnerRuntime();const call=client(runtime);
  try {
    const {cookie,messages,token}=await signup(call,db);
    assert.equal((await (await call('/me',{cookie})).json()).emailVerified,false);
    assert.equal((await call('/auth/reset-password',{method:'POST',input:{token,password}})).status,400,'Verification links cannot reset passwords');
    assert.equal((await call('/auth/verify-email',{method:'POST',input:{token}})).status,200);
    assert.equal((await (await call('/me',{cookie})).json()).emailVerified,true);
    assert.equal((await call('/auth/verify-email',{method:'POST',input:{token}})).status,400,'Verification link is consumed once');
    const known=await call('/auth/request-reset',{method:'POST',input:{email:'partner@example.com'}});
    const unknown=await call('/auth/request-reset',{method:'POST',input:{email:'unknown@example.com'}});
    assert.equal(known.status,200);assert.equal(unknown.status,200);assert.deepEqual(await known.json(),await unknown.json());
    await delivery(db,messages);const reset=messages.at(-1).text.match(/#reset=([0-9a-f]{64})/)[1];
    assert.equal((await call('/auth/verify-email',{method:'POST',input:{token:reset}})).status,400,'Reset links cannot be used as verification links');
    const nextPassword='a changed synthetic recovery passphrase';
    const results=await Promise.all([1,2].map(()=>call('/auth/reset-password',{method:'POST',input:{token:reset,password:nextPassword}})));
    assert.deepEqual(results.map(response=>response.status).sort(),[200,400],'Concurrent resets consume the token once');
    assert.equal((await call('/me',{cookie})).status,401);
    assert.equal((await call('/auth/login',{method:'POST',input:{email:'partner@example.com',password}})).status,401);
    assert.equal((await call('/auth/login',{method:'POST',input:{email:'partner@example.com',password:nextPassword}})).status,200);
    assert.equal((await call('/auth/request-reset',{method:'POST',input:{email:'partner@example.com'}})).status,200);
    await delivery(db,messages);const expired=messages.at(-1).text.match(/#reset=([0-9a-f]{64})/)[1];
    await db.prepare('UPDATE ecosystem_partner_action_tokens SET expires_at_ms = 0').run();
    assert.equal((await call('/auth/reset-password',{method:'POST',input:{token:expired,password}})).status,400);
    assert.ok(messages.every(message=>message.text.includes('https://uas-forge.com/partners/#')));
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM ecosystem_partner_email_requests WHERE purpose = 'RESET_PASSWORD'").first()).count,2,'Unknown emails do not create a delivery request');
  }finally{await runtime.dispose()}
});

test('email outages are reported and persisted requests retry without leaking usable tokens',async()=>{
  const unavailable=await partnerRuntime({emailAvailable:false});
  try{
    const response=await client(unavailable.runtime)('/auth/signup',{method:'POST',input:{email:'test@example.com',password,name:'Test',organizationName:'Test'}});
    assert.equal(response.status,503);
    assert.equal((await unavailable.db.prepare('SELECT COUNT(*) AS count FROM ecosystem_partner_accounts').first()).count,0);
  }finally{await unavailable.runtime.dispose()}
  const {runtime,db}=await partnerRuntime();
  try{
    const call=client(runtime),created=await call('/auth/signup',{method:'POST',input:{email:'test@example.com',password,name:'Test',organizationName:'Test'}});
    assert.equal(created.status,201);
    await deliverPartnerEmails({ECOSYSTEM_DB:db,EMAIL:{async send(){throw new Error('Synthetic provider outage')}}});
    assert.equal((await db.prepare('SELECT status FROM ecosystem_partner_email_requests').first()).status,'PENDING');
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM ecosystem_partner_action_tokens').first()).count,0);
    const messages=[];await delivery(db,messages);assert.equal(messages.length,1);
    assert.equal((await db.prepare('SELECT status FROM ecosystem_partner_email_requests').first()).status,'SENT');
  }finally{await runtime.dispose()}
});

test('customers see only complete approved products; assemblies publish with their complete BOM',async()=>{
  const {runtime,db}=await partnerRuntime({reviewerFixture:true});const call=client(runtime);
  try{
    const {account,cookie,token}=await signup(call,db);const org=account.organizationId,path=`/organizations/${org}`;
    const component={productId:'motor-1',revision:'r1',manufacturerName:'Fixture OEM',partNumber:'M-42',name:'Fixture motor',category:'MOTOR',compatibilityTags:[],lifecycle:'ACTIVE',evidenceRefs:['datasheet:motor-1']};
    assert.equal((await call(path+'/products',{method:'POST',cookie,input:component})).status,201);
    assert.equal((await call(path+'/products/motor-1/r1/review',{method:'POST',cookie})).status,403,'An unverified partner cannot submit for review');
    assert.equal((await call('/auth/verify-email',{method:'POST',input:{token}})).status,200);
    const incomplete=await call(path+'/products/motor-1/r1/review',{method:'POST',cookie});assert.equal(incomplete.status,422);
    assert.ok((await incomplete.json()).missing.some(value=>value.includes('description')));
    assert.equal((await (await call('/products')).json()).products.length,0);
    const finished={...component,description:'A finished fixture motor listing.',productKind:'COMPONENT',completionState:'COMPLETE'};
    assert.equal((await call(path+'/products',{method:'POST',cookie,input:finished})).status,201);
    assert.equal((await call(path+'/products/motor-1/r1/review',{method:'POST',cookie})).status,200);
    assert.equal((await call('/partner-reviews',{cookie})).status,403);
    assert.equal((await (await call('/partner-reviews',{reviewer:true})).json()).products.length,1);
    assert.equal((await call(path+'/products/motor-1/r1/publish',{method:'POST',cookie})).status,403);
    const published=await call(path+'/products/motor-1/r1/publish',{method:'POST',reviewer:true});assert.equal(published.status,200,await published.clone().text());
    assert.equal((await (await call('/products')).json()).products.length,1);
    const assembly={...finished,productId:'system-1',partNumber:'SYS-1',name:'Fixture assembly',productKind:'ASSEMBLY'};
    assert.equal((await call(path+'/products',{method:'POST',cookie,input:assembly})).status,201);
    assert.equal((await call(path+'/products/system-1/r1/review',{method:'POST',cookie})).status,422);
    const bom={bomId:'system-bom',revision:'r1',productId:'system-1',productRevision:'r1',evidenceRefs:['drawing:system-1'],lines:[{lineId:'motor-line',slot:'motor-slot',quantity:1,category:'MOTOR',requiredCompatibilityTags:[],substitutionsAllowed:false}]};
    assert.equal((await call(path+'/boms',{method:'POST',cookie,input:bom})).status,201);
    assert.equal((await call(path+'/boms/system-bom/r1/review',{method:'POST',cookie})).status,422,'Category placeholders cannot be published as a complete BOM');
    bom.lines=[{...bom.lines[0],manufacturerId:org,productId:'motor-1',productRevision:'r1'}];
    assert.equal((await call(path+'/boms',{method:'POST',cookie,input:bom})).status,201);
    assert.equal((await call(path+'/boms/system-bom/r1/review',{method:'POST',cookie})).status,200);
    assert.equal((await call(path+'/products/system-1/r1/review',{method:'POST',cookie})).status,200);
    assert.equal((await call(`/products/system-1?manufacturer_id=${org}`)).status,404);
    const publishedAssembly=await call(path+'/products/system-1/r1/publish',{method:'POST',reviewer:true});assert.equal(publishedAssembly.status,200,await publishedAssembly.clone().text());
    assert.equal((await (await call('/products')).json()).products.length,2);
    const publicBoms=await (await call(`/boms?manufacturer_id=${org}&product_id=system-1`)).json();assert.equal(publicBoms.boms.length,1);assert.equal(publicBoms.boms[0].publicationState,'PUBLISHED');
    const legacy={...component,productId:'legacy-1'};
    assert.equal((await call(path+'/products',{method:'POST',cookie,input:legacy})).status,201);
    await db.prepare("UPDATE ecosystem_product_revisions SET publication_state = 'PUBLISHED', is_current = 1 WHERE product_id = 'legacy-1'").run();
    assert.equal((await call(`/products/legacy-1?manufacturer_id=${org}`)).status,404,'Historical published records without completeness approval stay private');
    assert.equal((await (await call('/products')).json()).products.length,2);
    const audit=await db.prepare("SELECT actor_kind FROM ecosystem_audit_events WHERE action = 'boms.publish'").first();assert.equal(audit.actor_kind,'ACCESS');
    assert.equal((await call(path+'/boms/system-bom/r1/withdraw',{method:'POST',reviewer:true,input:{reason:'Required BOM withdrawn in fixture'}})).status,200);
    assert.equal((await call(`/products/system-1?manufacturer_id=${org}`)).status,404,'Assemblies are hidden if their required published BOM is withdrawn');
    assert.equal((await (await call('/products')).json()).products.length,1);
    const owned=await (await call(path+'/products',{cookie})).json();
    assert.equal(owned.products.find(product=>product.productId==='system-1').customerVisible,false);
  }finally{await runtime.dispose()}
});

test('only explicitly assigned verified partner accounts can review without gaining team or tenant write authority',async()=>{
  const {runtime,db}=await partnerRuntime();const call=client(runtime);
  try{
    const owner=await signup(call,db,'owner@example.com');
    const reviewer=await signup(call,db,'reviewer@example.com');
    const path=`/organizations/${owner.account.organizationId}`;
    const reviewerId=(await db.prepare("SELECT account_id FROM ecosystem_partner_accounts WHERE email = 'reviewer@example.com'").first()).account_id;
    await db.prepare("INSERT INTO ecosystem_partner_reviewers (account_id,status,assigned_by,assigned_at_ms) VALUES (?,'ACTIVE','test-fixture',?)").bind(reviewerId,Date.now()).run();
    assert.equal((await (await call('/me',{cookie:reviewer.cookie})).json()).platformReviewer,false,'Assignment requires email verification');
    assert.equal((await call('/partner-reviews',{cookie:reviewer.cookie})).status,403);
    await call('/auth/verify-email',{method:'POST',input:{token:reviewer.token}});
    const identity=await (await call('/me',{cookie:reviewer.cookie})).json();
    assert.equal(identity.platformReviewer,true);assert.equal(identity.platformAdmin,false);
    assert.equal((await call(path+'/products',{cookie:reviewer.cookie})).status,200);
    assert.equal((await call(path+'/members',{cookie:reviewer.cookie})).status,404);
    assert.equal((await call(path+'/api-credentials',{cookie:reviewer.cookie})).status,404);
    assert.equal((await call(path+'/products',{method:'POST',cookie:reviewer.cookie,input:{}})).status,404);
    assert.equal((await call('/organizations',{method:'POST',cookie:reviewer.cookie,input:{}})).status,401);
    assert.equal((await call('/partner-reviews',{cookie:owner.cookie})).status,403);
    await db.prepare("UPDATE ecosystem_partner_reviewers SET status = 'SUSPENDED' WHERE account_id = ?").bind(reviewerId).run();
    assert.equal((await call('/partner-reviews',{cookie:reviewer.cookie})).status,403,'Revocation applies to existing sessions');
    assert.equal((await call(path+'/products',{cookie:reviewer.cookie})).status,404);
  }finally{await runtime.dispose()}
});
