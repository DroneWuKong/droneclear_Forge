import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/private/[[path]].js';
const secret='local-fixture-password';
const context=request=>({request,env:{PRIVATE_GATE_SECRET:secret},next:async()=>new Response('protected-fixture')});
const url='https://local.invalid/private/components-bom/?company=Test%20Company&mode=details&key=remove-me';
test('gate preserves company context and escapes form destination while removing key',async()=>{
 const response=await onRequest(context(new Request(url)));assert.equal(response.status,401);
 const html=await response.text();assert.match(html,/action="\/private\/components-bom\/\?company=Test\+Company&amp;mode=details"/);assert.ok(!html.includes('remove-me'));assert.match(html,/<label for="access-password">/);
});
test('POST login and error retain exact noncredential query context',async()=>{
 for(const key of ['', 'wrong',secret]){
  const response=await onRequest(context(new Request(url,{method:'POST',body:new URLSearchParams({key})})));
  if(key===secret){assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/private/components-bom/?company=Test+Company&mode=details');assert.ok(!response.headers.get('Set-Cookie').includes(secret));}
  else {assert.equal(response.status,401);const html=await response.text();assert.match(html,/role="alert"/);assert.match(html,/aria-describedby="access-error" aria-invalid="true"/);}
 }
});
