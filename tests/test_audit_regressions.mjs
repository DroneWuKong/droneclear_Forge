import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { verifyAccessToken, createSession, verifySession } from '../workers/access-auth.mjs';
import { onRequest } from '../functions/private/[[path]].js';
import data from '../workers/forge-data.js';
import freshness from '../forge-source/data-freshness.js';
import groq from '../workers/groq-proxy.js';
import gemini from '../workers/gemini-proxy.js';
import claude from '../workers/claude-proxy.js';
import { budgetDecision } from '../workers/proxy-policy.mjs';

test('forecast accuracy excludes legacy and revoked verdicts', () => {
  const source = fs.readFileSync(new URL('../forge-source/forecast-accountability.html', import.meta.url), 'utf8');
  const predicate = source.match(/function isGraded\(o\)\{[^\n]+\}/)[0];
  const context = vm.createContext({});
  vm.runInContext(predicate, context);
  assert.equal(context.isGraded({was_correct:true}), false);
  const row = {was_correct:true, resolution_method:'reviewed-evidence-v1', calibration_eligible:true};
  assert.equal(context.isGraded(row), true);
  assert.equal(context.isGraded({...row, review_status:'needs_review'}), false);
  assert.equal(context.isGraded({...row, calibration_eligible:false}), false);
});

test('private assets reject spoofed identity and malformed cookies', async () => {
  for (const headers of [{ 'Cf-Access-Jwt-Assertion': 'fake' }, { 'Cf-Access-Authenticated-User-Email': 'fake@example.com' }, { Cookie: 'pg=%E0%A4%A' }]) {
    let next = false;
    const response = await onRequest({ request: new Request('https://local.invalid/private/x', { headers }), env: { PRIVATE_GATE_SECRET: 'test-password' }, next() { next = true; return new Response('private'); } });
    assert.equal(next, false); assert.equal(response.status, 401);
  }
});
test('password session is signed, expiring, tamper resistant and contains no password', async () => {
  const session = await createSession('secret-test-value', 60, 100000);
  assert.ok(!session.includes('secret-test-value'));
  assert.equal(await verifySession(session, 'secret-test-value', 110000), true);
  assert.equal(await verifySession(session, 'wrong', 110000), false);
  assert.equal(await verifySession(session, 'secret-test-value', 161000), false);
  const response = await onRequest({ request: new Request('https://local.invalid/private/x', { headers: { Cookie: `pg=${await createSession('test', 60)}` } }), env: { PRIVATE_GATE_SECRET: 'test' }, next: async () => new Response('private-content') });
  assert.equal(await response.text(), 'private-content'); assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('Access verifies actual RSA signature, audience, issuer, time and key identity', async () => {
  const now = Date.now(); const sec = Math.floor(now / 1000);
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'test-key' };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  async function token(claims = {}, header = {}) {
    const input = encode({ alg:'RS256',kid:'test-key',...header }) + '.' + encode({ iss:'https://audit.cloudflareaccess.com',aud:['audience'],iat:sec,exp:sec+300,...claims });
    return input + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(input))).toString('base64url');
  }
  const env = { PRIVATE_ACCESS_TEAM_DOMAIN:'audit.cloudflareaccess.com', PRIVATE_ACCESS_AUD:'audience' };
  const fetcher = async () => Response.json({ keys:[jwk] });
  assert.equal(await verifyAccessToken(await token(),env,fetcher,now), true);
  for (const claims of [{ aud:['other'] }, { iss:'https://evil.invalid' }, { exp:sec-1 }, { iat:sec+3600 }, { nbf:sec+3600 }]) assert.equal(await verifyAccessToken(await token(claims),env,fetcher,now), false);
  for (const header of [{ alg:'none' }, { kid:'unknown' }]) assert.equal(await verifyAccessToken(await token({},header),env,fetcher,now), false);
  const altered = (await token()).split('.'); altered[1] = encode({ iss:'https://audit.cloudflareaccess.com',aud:['audience'],iat:sec,exp:sec+9999 });
  assert.equal(await verifyAccessToken(altered.join('.'),env,fetcher,now), false);
});
const request = () => new Request('https://local.invalid/api/data?type=data_quality_score');
const fresh = () => JSON.stringify({ generated_at: new Date().toISOString(), overall_score: 50 });
test('future timestamps are withheld on reads and writes', async () => {
  const raw = JSON.stringify({ generated_at:'2099-01-01T00:00:00Z' }); let writes = 0;
  const env = { FORGE_BLOBS_ADMIN_KEY:'test', PIE_OUTPUTS:{ get:async()=>raw,put:async()=>writes++ } };
  assert.equal((await data.fetch(request(),env)).status,503);
  const write = new Request(request(), { method:'POST',headers:{Authorization:'Bearer test'},body:raw });
  assert.equal((await data.fetch(write,env)).status,400); assert.equal(writes,0);
});
test('fresh asset recovers from stale or malformed KV; all-stale still withholds', async () => {
  for (const raw of ['not-json','{"generated_at":"2000-01-01"}']) {
    const response = await data.fetch(request(),{ PIE_OUTPUTS:{get:async()=>raw}, ASSETS:{fetch:async()=>new Response(fresh())} });
    assert.equal(response.status,200); assert.match(response.headers.get('X-Data-Fallback'),/^kv:/);
  }
  assert.equal((await data.fetch(request(),{ PIE_OUTPUTS:{get:async()=>'{}'}, ASSETS:{fetch:async()=>new Response('{}')} })).status,503);
});
test('browser fallback validates static timestamps and recomputes catalog row state', async () => {
  const fetcher = async url => url === 'api' ? new Response('{}',{status:503}) : Response.json({ generated_at:'2000-01-01',overall_score:99 });
  await assert.rejects(freshness.load(['api','static'],{fetcher}),/stale/);
  const current = { meta:{generated_at:new Date().toISOString()},datasets:[{id:'flags',generated_at:'2000-01-01',status:'fresh',role:'current',freshness_sla_hours:24}] };
  assert.equal(freshness.refreshCatalog(current).datasets[0].status,'stale');
  assert.equal(current.datasets[0].status,'fresh'); // immutable source
});
test('static adapter intercepts only legacy catalog requests', async () => {
  const calls=[];
  const network=async (...args)=>{calls.push(args);return Response.json({components:{}});};
  const context=vm.createContext({window:{fetch:network},fetch:network,Response,URLSearchParams,AbortController,setTimeout,clearTimeout,console:{log(){},warn(){},error(){}}});
  vm.runInContext(fs.readFileSync(new URL('../forge-source/forge-static-adapter.js',import.meta.url),'utf8'),context);
  await context.window.__forgeAdapterReady; calls.length=0;
  const options={method:'POST',body:'{}'};
  for (const route of ['/api/faa-lookup?cert=1','/api/analytics/ingest','/api/wingman',new Request('https://local.invalid/api/data')]) {
    await context.window.fetch(route,options); assert.equal(calls.at(-1)[0],route); assert.equal(calls.at(-1)[1],options);
  }
  const before=calls.length; await context.window.fetch('/api/categories/'); assert.equal(calls.length,before);
});
test('model routes require authorization and an available shared quota', async () => {
  for (const worker of [groq,gemini,claude]) {
    const req=()=>new Request('https://local.invalid/api/wingman',{method:'POST',body:'{}'});
    assert.equal((await worker.fetch(req(),{WINGMAN_PROXY_SECRET:'test'})).status,401);
    const authenticated=new Request(req(),{headers:{'X-Proxy-Secret':'test'}});
    assert.equal((await worker.fetch(authenticated,{WINGMAN_PROXY_SECRET:'test'})).status,503);
  }
});
test('native Gemini caps output/candidates and unsupported models never reach a provider', async () => {
  const old=globalThis.fetch; const calls=[];
  globalThis.fetch=async (url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return Response.json({ok:true});};
  const env={WINGMAN_PROXY_SECRET:'test',GEMINI_API_KEY:'fake',MODEL_BUDGET:{idFromName:x=>x,get:()=>({reserve:async()=>({allowed:true})})}};
  const req=body=>new Request('https://local.invalid/api/wingman/gemini',{method:'POST',headers:{'X-Proxy-Secret':'test'},body:JSON.stringify(body)});
  try {
    assert.equal((await gemini.fetch(req({contents:[{parts:[{text:'test'}]}],generationConfig:{maxOutputTokens:999999,candidateCount:8}}),env)).status,200);
    assert.equal(calls[0].body.generationConfig.maxOutputTokens,4096); assert.equal(calls[0].body.generationConfig.candidateCount,1);
    assert.equal((await gemini.fetch(req({model:'unapproved'}),env)).status,400);
    assert.equal((await gemini.fetch(req({contents:[{parts:[{text:'x'.repeat(40000)}]}]}),env)).status,400); assert.equal(calls.length,1);
    env.MODEL_BUDGET.get=()=>({reserve:async()=>({allowed:false})});
    assert.equal((await gemini.fetch(req({contents:[{parts:[{text:'test'}]}]}),env)).status,429); assert.equal(calls.length,1);
  } finally {globalThis.fetch=old;}
});
test('budget reservations persist across minutes and reset daily with bounded counters',()=>{
  let state;
  for(let i=0;i<20;i++){const result=budgetDecision(state,100,1000);assert.equal(result.allowed,true);state=result.state;}
  assert.equal(budgetDecision(state,100,1000).allowed,false);
  const next=budgetDecision(state,100,61000);assert.equal(next.allowed,true);assert.equal(next.state.dayCount,21);
  assert.equal(budgetDecision({...next.state,units:250000},100,61000).allowed,false);
  assert.equal(budgetDecision(next.state,100,86400000).state.dayCount,1);
});

// Exercise the real inline send() against the actual proxy handlers. Provider I/O is mocked.
const wingmanSource = fs.readFileSync(new URL('../forge-source/wingman.html', import.meta.url), 'utf8');
const sendSource = wingmanSource.slice(wingmanSource.indexOf('async function send() {'), wingmanSource.indexOf('// ─── RENDER'));
function wingmanContext(provider, options = {}) {
  const element = { value: 'Follow up', style: {} };
  const context = vm.createContext({
    provider, loading: false, stagedImgs: [], proxySecret: 'owner-test', apiKey: '', geminiKey: '', groqKey: '', subToken: '',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Original question' }] }, { role: 'assistant', content: [], text: 'Previous answer' }],
    document: { getElementById: () => element },
    updateSendBtn() {}, hideEmpty() {}, renderStagedImages() {}, renderMessages() {}, showThinking() {}, hideThinking() {}, scrollBottom() {}, trackQuery() {},
    buildPrompt: () => 'Use the supplied Forge reference material.',
    ...options,
  });
  vm.runInContext(sendSource, context);
  return context;
}
for (const [provider, worker] of [['gemini', gemini], ['groq', groq], ['anthropic', claude]]) {
  test(`Wingman ${provider} text chat reaches authorized proxy with history`, async () => {
    const upstream = []; let reservations = 0;
    const old = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      upstream.push({ url, body: JSON.parse(options.body), headers: options.headers });
      return Response.json({ candidates: [{content:{parts:[{text:'Answer'}]}}], choices:[{message:{content:'Answer'}}], content:[{type:'text',text:'Answer'}] });
    };
    const env = { WINGMAN_PROXY_SECRET: 'owner-test', GEMINI_API_KEY:'provider-test', GROQ_API_KEY:'provider-test', ANTHROPIC_API_KEY:'provider-test',
      MODEL_BUDGET: {idFromName:x=>x, get:()=>({reserve:async()=>{ reservations++; return {allowed:true}; }})} };
    let requests = 0;
    const context = wingmanContext(provider, {fetch:async (url, options) => {
      requests++;
      assert.ok(url.startsWith('/api/wingman/'));
      const response = await worker.fetch(new Request('https://local.invalid'+url, options), env);
      assert.equal(response.status, 200, await response.clone().text());
      return response;
    }});
    try {
      await context.send();
      assert.equal(requests, 1); assert.equal(reservations, 1); assert.equal(upstream.length, 1);
      assert.equal(context.messages.at(-1).text, 'Answer');
      assert.ok(JSON.stringify(upstream[0].body).includes('Previous answer'));
      assert.ok(JSON.stringify(upstream[0].body).includes('Use the supplied Forge reference material.'));
      assert.equal(upstream[0].body.tools, undefined);
      assert.equal(new Headers(upstream[0].headers).get('x-proxy-secret'), null);
      assert.equal(context.loading, false);
    } finally { globalThis.fetch = old; }
  });
  test(`Wingman ${provider} requires credentials and never sends anonymous paid requests`, async () => {
    let calls = 0;
    const context = wingmanContext(provider, {proxySecret:'', subToken:'legacy-token', fetch:async()=>{calls++;}});
    await context.send();
    assert.equal(calls, 0); assert.match(context.messages.at(-1).text, /API key/);
    assert.equal(context.loading, false);
  });
  test(`Wingman ${provider} BYOK never leaks owner proxy credential`, async () => {
    const requests = [];
    const key = provider === 'gemini' ? 'geminiKey' : provider === 'groq' ? 'groqKey' : 'apiKey';
    const context = wingmanContext(provider, {[key]:'user-test', fetch:async(url, options)=>{ requests.push({url,options});return Response.json({}); }});
    await context.send();
    assert.equal(requests.length, 1); assert.ok(requests[0].url.startsWith('https://'));
    assert.equal(new Headers(requests[0].options.headers).get('x-proxy-secret'), null);
    assert.ok(!JSON.stringify(requests).includes('owner-test'));
  });
}
test('Wingman shared chat does not silently drop image history', async () => {
  let calls = 0;
  const context = wingmanContext('gemini', {stagedImgs:[{mediaType:'image/png', b64:'test', preview:'test'}], fetch:async()=>{calls++;}});
  await context.send();
  assert.equal(calls, 0); assert.match(context.messages.at(-1).text, /supports text only/);
});
test('Wingman surfaces Claude provider errors', async () => {
  const context = wingmanContext('anthropic', {fetch:async()=>Response.json({error:{message:'Provider account unavailable'}},{status:400})});
  await context.send();
  assert.match(context.messages.at(-1).text, /Provider account unavailable/);
});
