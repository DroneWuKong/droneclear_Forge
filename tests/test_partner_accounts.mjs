import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerRuntime } from './partner_runtime.mjs';
import { onRequest as privateGate } from '../functions/private/[[path]].js';

const origin = 'https://uas-forge.com';
const password = 'a long synthetic partner passphrase';
const product = { productId:'motor-1',revision:'r1',manufacturerName:'Test OEM',partNumber:'M-42',name:'Example motor',category:'MOTOR',compatibilityTags:['voltage:6s'],lifecycle:'ACTIVE',evidenceRefs:['datasheet:m-42'] };

test('partner accounts persist drafts, isolate companies, and revoke sessions in the Workers runtime', async () => {
  const {runtime,db} = await partnerRuntime();
  const call = (path, {method='GET',input,cookie,headers={}}={}) => runtime.dispatchFetch(origin+'/api/ecosystem/v1'+path, {
    method, headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},
    ...(input ? {body:JSON.stringify(input)} : {}),
  });
  try {
    const anonymous = await call('/me'); assert.equal(anonymous.status,401);
    const signup = await call('/auth/signup',{method:'POST',input:{email:'PARTNER@example.com',password,name:'Partner Test',organizationName:'Test OEM',kind:'OEM'}});
    assert.equal(signup.status,201,await signup.clone().text());
    const cookie = signup.headers.get('Set-Cookie').split(';')[0];
    assert.match(signup.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Strict/);
    const account = await signup.json();
    const me = await (await call('/me',{cookie})).json();
    assert.equal(me.identityKind,'PARTNER'); assert.equal(me.email,'partner@example.com');
    assert.equal(me.organizations[0].role,'EDITOR');
    const org = account.organizationId;
    const stored = await db.prepare('SELECT * FROM ecosystem_partner_accounts WHERE email = ?').bind('partner@example.com').first();
    assert.notEqual(stored.password_hash,password); assert.equal(stored.password_iterations,600000);
    assert.equal((await db.prepare('SELECT token_hash FROM ecosystem_partner_sessions').first()).token_hash.includes(cookie.split('=')[1]),false);
    const duplicate = await call('/auth/signup',{method:'POST',input:{email:'partner@example.com',password,name:'Duplicate',organizationName:'Duplicate',kind:'OEM'}});
    assert.equal(duplicate.status,409);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM ecosystem_organizations').first()).count,1,'Duplicate signup must roll back its entire workspace transaction');
    const save = await call(`/organizations/${org}/products`,{method:'POST',cookie,input:product});
    assert.equal(save.status,201,await save.clone().text());
    const bom = {bomId:'bom-1',revision:'r1',productId:'motor-1',productRevision:'r1',evidenceRefs:['drawing:bom-1'],lines:[{lineId:'motor-line',slot:'motor',quantity:1,manufacturerId:org,productId:'motor-1',productRevision:'r1',requiredCompatibilityTags:['voltage:6s'],substitutionsAllowed:false}]};
    assert.equal((await call(`/organizations/${org}/boms`,{method:'POST',cookie,input:bom})).status,201);
    const preflight = await call(`/organizations/${org}/catalog-imports/preflight`,{method:'POST',cookie,input:{resource:'BOMS',records:[bom]}}); assert.equal(preflight.status,200);
    assert.equal((await call('/organizations',{method:'POST',cookie,input:{organizationId:'existing-oem',name:'Hijack',kind:'OEM'}})).status,401);
    assert.equal((await call(`/organizations/${org}/products/motor-1/r1/review`,{method:'POST',cookie})).status,200);
    assert.equal((await call(`/organizations/${org}/products/motor-1/r1/publish`,{method:'POST',cookie})).status,403);
    assert.equal((await call(`/organizations/${org}/products`,{method:'POST',cookie,input:product})).status,409,'Reviewed revisions remain immutable');
    assert.equal((await call(`/organizations/${org}/products/motor-1/r1/request-changes`,{method:'POST',cookie})).status,200);
    const second = await call('/auth/signup',{method:'POST',input:{email:'second@example.com',password,name:'Second Test',organizationName:'Other OEM'}});
    assert.equal(second.status,201); const otherCookie=second.headers.get('Set-Cookie').split(';')[0];
    assert.equal((await call(`/organizations/${org}/products`,{cookie:otherCookie})).status,404);
    assert.equal((await call(`/organizations/${org}/boms`,{method:'POST',cookie:otherCookie,input:bom})).status,404);
    const blocked = await call(`/organizations/${org}/products`,{method:'POST',cookie,input:product,headers:{Origin:'https://attacker.invalid'}}); assert.equal(blocked.status,403);
    assert.equal((await call('/auth/signup',{method:'POST',input:{},headers:{Origin:'https://attacker.invalid'}})).status,403);
    const privatePage=await privateGate({request:new Request(origin+'/private/components-bom/',{headers:{Cookie:cookie}}),env:{ECOSYSTEM_DB:db},next:async()=>new Response('private data')});
    assert.equal(privatePage.status,403,'Partner sessions must never unlock private intelligence assets');
    assert.equal((await call('/auth/logout',{method:'POST',cookie})).status,200);
    assert.equal((await call('/me',{cookie})).status,401);
    const wrong=await call('/auth/login',{method:'POST',input:{email:'partner@example.com',password:'wrong password'}});assert.equal(wrong.status,401);
    const login=await call('/auth/login',{method:'POST',input:{email:'partner@example.com',password}});assert.equal(login.status,200);
    const newCookie=login.headers.get('Set-Cookie').split(';')[0];assert.notEqual(newCookie,cookie);
    const read=await (await call(`/organizations/${org}/products`,{cookie:newCookie})).json(); assert.equal(read.products[0].name,'Example motor');
    assert.equal((await call(`/organizations/${org}/products`,{method:'POST',cookie:newCookie,input:{...product,name:'Updated motor'}})).status,201);
    const reread=await (await call(`/organizations/${org}/products`,{cookie:newCookie})).json();assert.equal(reread.products[0].name,'Updated motor');
    await db.prepare('UPDATE ecosystem_partner_sessions SET expires_at_ms = 0').run();assert.equal((await call('/me',{cookie:newCookie})).status,401);
    const audit=await db.prepare("SELECT actor_kind FROM ecosystem_audit_events WHERE action = 'product.save-draft'").first();assert.equal(audit.actor_kind,'PARTNER');
  } finally { await runtime.dispose(); }
});

test('signup validates input and login throttles guesses before password hashing',async()=>{
  const {runtime,db}=await partnerRuntime();
  const post=input=>runtime.dispatchFetch(origin+'/api/ecosystem/v1/auth/signup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
  try{
    const short=await post({email:'invalid@example.com',password:'short',name:'Test',organizationName:'Test'});assert.equal(short.status,400);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM ecosystem_partner_accounts').first()).count,0);
    const oversized=await post({padding:'x'.repeat(9000)});assert.equal(oversized.status,400);
    const url=origin+'/api/ecosystem/v1/auth/login';
    for(let i=0;i<11;i++){
      const result=await runtime.dispatchFetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'unknown@example.com',password})});
      assert.equal(result.status,i===10?429:401);
    }
  }finally{await runtime.dispose()}
});
