import test from 'node:test';
import assert from 'node:assert/strict';
import report from '../workers/compliance-report.js';
import groq from '../workers/groq-proxy.js';

const request = (body = {}, secret = 'test') => new Request('https://local.invalid/api/compliance/report', {
  method: 'POST', headers: {'X-Proxy-Secret': secret}, body: JSON.stringify(body),
});
test('reports share model authorization, bounded input and quota before provider spending', async () => {
  const old = globalThis.fetch; let calls = 0, reservations = 0, units = 0;
  let allowed = true, status = 200, content = [{type:'text',text:'{"executive_summary":"Test report"}'}];
  globalThis.fetch = async (url, options) => {
    calls++; const body = JSON.parse(options.body);
    assert.equal(body.model, 'claude-sonnet-4-6'); assert.equal(body.max_tokens, 2048);
    assert.ok(units > body.messages[0].content.length + 2048);
    return Response.json(status === 200 ? {content} : {error:{message:'Provider account unavailable'}}, {status});
  };
  const env = {WINGMAN_PROXY_SECRET:'test', ANTHROPIC_API_KEY:'fake', PIE_OUTPUTS:{get:async()=>'[]'},
    MODEL_BUDGET:{idFromName:name=>{assert.equal(name,'owner-model-budget-v1'); return name;},
      get:()=>({reserve:async value=>{reservations++;units=value.units;return {allowed};}})}};
  try {
    assert.equal((await report.fetch(request({},'wrong'),env)).status,401);
    assert.equal((await report.fetch(request(),{...env,MODEL_BUDGET:null})).status,503);
    for (const body of [{subject:{}},{subject:'x'.repeat(2001)},{report_type:'x'.repeat(101)},{extra:'x'.repeat(40000)}]) {
      assert.equal((await report.fetch(request(body),env)).status,400);
    }
    assert.equal(calls,0); assert.equal(reservations,0);
    allowed=false;
    assert.equal((await report.fetch(request(),env)).status,429); assert.equal(calls,0);
    allowed=true;
    const success=await report.fetch(request({subject:'Test'}),env);
    assert.equal(success.status,200); assert.equal(success.headers.get('cache-control'),'no-store');
    assert.equal((await success.json()).executive_summary,'Test report');
    status=403;
    const denied=await report.fetch(request(),env);
    assert.equal(denied.status,403); assert.equal((await denied.json()).error.message,'Provider account unavailable');
    status=200;
    for (const value of ['', '{}', '[]', 'null']) {
      content=[{type:'text',text:value}]; assert.equal((await report.fetch(request(),env)).status,502);
    }
    assert.equal(calls,6); assert.equal(reservations,7);
  } finally {globalThis.fetch=old;}
});

test('Groq selects the supported default while retaining explicit model permissions', async () => {
  const old=globalThis.fetch; const bodies=[];
  globalThis.fetch=async (_,opts)=>{bodies.push(JSON.parse(opts.body));return Response.json({choices:[{message:{content:'OK'}}]});};
  const env={WINGMAN_PROXY_SECRET:'test',GROQ_API_KEY:'fake',MODEL_BUDGET:{idFromName:x=>x,get:()=>({reserve:async()=>({allowed:true})})}};
  try {
    const body={messages:[{role:'user',content:'Test'}],max_tokens:9999};
    assert.equal((await groq.fetch(request(body),env)).status,200);
    assert.equal(bodies[0].model,'openai/gpt-oss-120b'); assert.equal(bodies[0].reasoning_effort,'low');
    assert.equal(bodies[0].include_reasoning,false); assert.equal(bodies[0].max_tokens,4096);
    assert.equal((await groq.fetch(request({...body,model:'unapproved'}),env)).status,400);
    assert.equal(bodies.length,1);
    assert.equal((await groq.fetch(request(body),{...env,GROQ_ALLOWED_MODELS:'custom-permitted-model'})).status,200);
    assert.equal(bodies[1].model,'custom-permitted-model'); assert.ok(!('reasoning_effort' in bodies[1]));
  } finally {globalThis.fetch=old;}
});
