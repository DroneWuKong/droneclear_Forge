import test from 'node:test';
import assert from 'node:assert/strict';
import {partnerRuntime} from './partner_runtime.mjs';
import {deliverPartnerEmails} from '../workers/partner-email-worker.mjs';
const origin='https://uas-forge.com',password='synthetic developer passphrase 456';
function call(rt,path,{input,cookie,method=input?'POST':'GET',badOrigin=false}={}) {
  return rt.dispatchFetch(origin+'/api/ecosystem/v1'+path,{method,headers:{Origin:badOrigin?'https://untrusted.example':origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(input?{body:JSON.stringify(input)}:{})});
}
async function signup(rt,db,email,hubSite) {
  const r=await call(rt,'/auth/signup',{input:{email,password,name:'Test developer',organizationName:'Test company',hubSite}});
  assert.equal(r.status,201,await r.clone().text());
  const cookie=r.headers.get('Set-Cookie').split(';')[0],messages=[];
  await deliverPartnerEmails({ECOSYSTEM_DB:db,EMAIL:{async send(message){messages.push(message)}}});
  const token=messages.at(-1).text.match(/#verify=([0-9a-f]{64})/)[1];
  return {cookie,token,messages};
}
test('developer approval is separate by site, owner-only, revocable and notification-deduplicated',async()=>{
  const {runtime:rt,db}=await partnerRuntime();
  try {
    assert.equal((await call(rt,'/developer-access/readiness')).status,200);
    assert.equal((await call(rt,'/developer-access/status?site=orqa-reference')).status,401);
    const user=await signup(rt,db,'dev@example.com','orqa-reference');
    assert.ok(user.messages[0].text.includes('https://dev.prismoprime.com/login#verify='));
    assert.equal((await call(rt,'/developer-access/request',{cookie:user.cookie,input:{site:'orqa-reference'}})).status,403);
    await call(rt,'/auth/verify-email',{input:{token:user.token}});
    assert.equal((await call(rt,'/developer-access/status?site=toString',{cookie:user.cookie})).status,400);
    assert.equal((await call(rt,'/developer-access/request',{cookie:user.cookie,input:{site:'__proto__'}})).status,400);
    const request=await call(rt,'/developer-access/request',{cookie:user.cookie,input:{site:'orqa-reference',reason:'Camera development'}});
    assert.equal(request.status,201);const {requestId}=await request.json();
    assert.equal((await call(rt,'/developer-access/request',{cookie:user.cookie,input:{site:'orqa-reference'}})).status,200);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ecosystem_developer_hub_notifications').first()).n,1);
    const delivery=[];
    await deliverPartnerEmails({ECOSYSTEM_DB:db,DEVELOPER_HUB_OWNER_EMAIL:'owner@example.com',EMAIL:{async send(message){delivery.push(message)}}});
    assert.equal(delivery.length,1);assert.equal(delivery[0].to,'owner@example.com');
    assert.match(delivery[0].text,/https:\/\/dev\.prismoprime\.com\/access-admin/);
    assert.equal((await call(rt,'/developer-access/review',{cookie:user.cookie,input:{requestId,status:'APPROVED'}})).status,403);
    const owner=await signup(rt,db,'owner@example.com');await call(rt,'/auth/verify-email',{input:{token:owner.token}});
    const decisions=await call(rt,'/developer-access/requests',{cookie:owner.cookie});assert.equal(decisions.status,200);assert.equal((await decisions.json()).requests.length,1);
    assert.equal((await call(rt,'/developer-access/review',{cookie:owner.cookie,badOrigin:true,input:{requestId,status:'APPROVED'}})).status,403);
    assert.equal((await call(rt,'/developer-access/review',{cookie:owner.cookie,input:{requestId,status:'APPROVED'}})).status,200);
    assert.equal((await (await call(rt,'/developer-access/status?site=orqa-reference',{cookie:user.cookie})).json()).status,'APPROVED');
    assert.equal((await (await call(rt,'/developer-access/status?site=prismo-full',{cookie:user.cookie})).json()).status,'NONE');
    assert.equal((await call(rt,'/developer-access/review',{cookie:owner.cookie,input:{requestId,status:'REVOKED'}})).status,200);
    assert.equal((await (await call(rt,'/developer-access/status?site=orqa-reference',{cookie:user.cookie})).json()).status,'REVOKED');
    await call(rt,'/auth/request-reset',{input:{email:'dev@example.com',hubSite:'orqa-reference'}});
    const resetMessages=[];
    await deliverPartnerEmails({ECOSYSTEM_DB:db,EMAIL:{async send(message){resetMessages.push(message)}}});
    assert.equal(resetMessages.length,1);
    assert.ok(resetMessages[0].text.includes('https://dev.prismoprime.com/login#reset='));
    await call(rt,'/auth/logout',{cookie:user.cookie,input:{}});
    assert.equal((await call(rt,'/developer-access/status?site=orqa-reference',{cookie:user.cookie})).status,401);
  }finally{await rt.dispose();}
});
test('owner email outages stay retryable and no request is accepted without notification service',async()=>{
  const options={};const {runtime:rt,db}=await partnerRuntime(options);
  try {
    const user=await signup(rt,db,'dev@example.com','prismo-full');
    assert.ok(user.messages[0].text.includes('https://labs.prismoprime.com/login#verify='));
    await call(rt,'/auth/verify-email',{input:{token:user.token}});
    await call(rt,'/developer-access/request',{cookie:user.cookie,input:{site:'prismo-full'}});
    await deliverPartnerEmails({ECOSYSTEM_DB:db,DEVELOPER_HUB_OWNER_EMAIL:'owner@example.com',EMAIL:{async send(){throw Error('test outage')}}});
    assert.equal((await db.prepare('SELECT status FROM ecosystem_developer_hub_notifications').first()).status,'PENDING');
    const messages=[];await deliverPartnerEmails({ECOSYSTEM_DB:db,DEVELOPER_HUB_OWNER_EMAIL:'owner@example.com',EMAIL:{async send(m){messages.push(m)}}});
    assert.equal(messages.length,1);assert.equal((await db.prepare('SELECT status FROM ecosystem_developer_hub_notifications').first()).status,'SENT');
    assert.match(messages[0].text,/https:\/\/labs\.prismoprime\.com\/access-admin/);
    await call(rt,'/auth/request-reset',{input:{email:'dev@example.com',hubSite:'prismo-full'}});
    await deliverPartnerEmails({ECOSYSTEM_DB:db,EMAIL:{async send(m){messages.push(m)}}});
    assert.ok(messages.at(-1).text.includes('https://labs.prismoprime.com/login#reset='));
    options.emailAvailable=false;
    assert.equal((await call(rt,'/developer-access/request',{cookie:user.cookie,input:{site:'orqa-reference'}})).status,503);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ecosystem_developer_hub_access').first()).n,1);
  }finally{await rt.dispose();}
});
