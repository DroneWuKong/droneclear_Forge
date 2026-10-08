const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../forge-source/session-evidence.js'),V=require('../forge-source/session-vehicle.js'),R=require('../forge-source/session-reports.js');
const fixture=require('./fixtures/session_vehicle.json'),target=fixture.target;
const wire=name=>Uint8Array.from(Buffer.from(fixture.responses[name],'hex'));
const row=name=>new E.MavlinkParser().feed(wire(name),0)[0];
function client(respond){let c;const sent=[];c=new V.Client(async bytes=>{sent.push(bytes[5]);await respond?.(bytes,c);},()=>{});c.observe(row('heartbeat_px4'));return {c,sent};}
const feed=(c,...names)=>names.forEach(name=>c.observe(row(name)));
test('read requests match independent pymavlink wire fixtures, with bounded indexes and ranges',()=>{
 for(const [id,hex]of Object.entries(fixture.requests))assert.equal(Buffer.from(V.readRequest(Number(id),target,{index:1,logId:9,count:271})).toString('hex'),hex);
 for(const [id,options]of [[76,{}],[20,{index:10000}],[119,{offset:32*1048576,count:1}],[119,{count:11521}]])assert.throws(()=>V.readRequest(id,target,options));
});
test('v1/v2 parameter/log responses decode exact wire layout, including truncated final log data',()=>{
 for(const name of Object.keys(fixture.responses)){const decoded=row(name);assert.ok(decoded,name);assert.equal(decoded.system_id,42);assert.equal(decoded.component_id,7);}
 const f=row('log_entry').fields;assert.deepEqual(f,{time_utc:1791417600,size:271,id:9,num_logs:1,last_log_num:9});
 assert.equal(row('log_270').fields.count,1);assert.equal(row('log_270').fields.ofs,270);
});
test('parameter export uses PX4 bytewise and ArduPilot C-cast values and ignores foreign targets',async()=>{
 for(const ap of ['px4','ardupilot']){
  const {c}=client((bytes,c)=>{assert.equal(bytes[5],21);c.observe({...row('param_float'),system_id:1});feed(c,'param_int_'+ap,'param_float');});
  c.observe(row('heartbeat_'+ap));const result=await c.parameters('42:7'),text=new TextDecoder().decode(result.bytes);
  assert.match(text,new RegExp('42\\t7\\tTEST_INT\\t'+(ap==='px4'?'1234567890':'-123')+'\\t6'));assert.match(text,/TEST_FLOAT\t1.25\t9/);assert.equal(result.count,2);assert.equal(c.operation,null);
 }
});
test('missing parameters retry by index before exporting a complete snapshot',async()=>{
 const {c,sent}=client((bytes,c)=>{if(bytes[5]===21)feed(c,'param_int_px4');else if(bytes[5]===20){assert.equal(new DataView(bytes.buffer,bytes.byteOffset).getInt16(6,true),1);feed(c,'param_float');}});
 const result=await c.parameters('42:7');assert.equal(result.count,2);assert.deepEqual(sent,[21,20]);
});
test('changing parameter identity, count or invalid encoding aborts without a partial file',async()=>{
 for(const change of [f=>f.param_id='OTHER',f=>f.param_count=3,f=>f.param_type=10]){
  const {c}=client((_,c)=>{feed(c,'param_int_px4');const changed=row('param_int_px4');change(changed.fields);c.observe(changed);});
  await assert.rejects(()=>c.parameters('42:7'));assert.equal(c.operation,null);
 }
});
test('log listing and gap recovery preserve original bytes and end the transfer',async()=>{
 let downloads=0;
 const {c,sent}=client((bytes,c)=>{
  if(bytes[5]===117)feed(c,'log_entry');
  if(bytes[5]===119){downloads++;const offset=new DataView(bytes.buffer,bytes.byteOffset).getUint32(6,true);if(downloads===1){assert.equal(offset,0);feed(c,'log_0','log_180','log_270');}else{assert.equal(offset,90);feed(c,'log_90');}}
 });
 assert.equal((await c.listLogs('42:7'))[0].size,271);const result=await c.log('42:7',9);
 assert.equal(Buffer.from(result.bytes).toString('hex'),fixture.log_hex);assert.equal(result.name,'vehicle-42-log-9.ulg');assert.deepEqual(sent,[117,122,119,119,122]);
});
test('armed, signed and stale vehicles cannot start logs; cancellation and arming during a read send cleanup',async()=>{
 const {c,sent}=client();c.observe(row('heartbeat_armed'));await assert.rejects(()=>c.listLogs('42:7'),/disarmed/);assert.equal(sent.length,0);
 c.observe({...row('heartbeat_px4'),signature_present:true});await assert.rejects(()=>c.parameters('42:7'),/authenticated GCS/);
 c.observe(row('heartbeat_px4'));c.vehicles.get('42:7').last_seen-=11000;await assert.rejects(()=>c.parameters('42:7'),/fresh/);
 for(const action of ['cancel','arm']){const {c,sent}=client((bytes,c)=>{if(bytes[5]===117){if(action==='cancel')c.cancel();else c.observe(row('heartbeat_armed'));}});await assert.rejects(()=>c.listLogs('42:7'),action==='cancel'?/cancelled/:/disarmed/);assert.deepEqual(sent,[117,122]);}
});
test('Betaflight adapter matches official form fields, copies a raw Support ID, and routes configuration help',()=>{
 const s={id:'test-session',title:'Bug',stack:'betaflight',files:[],test_outcome:'not_run',aircraft:'FC board',firmware:'4.5',expected:'Expected',actual:'Actual',steps:'Reproduce',support_id:'abc123',flight_controller:'Board model',components:'RX model',wiring:'RX on UART 2'};
 const fields=R.officialFields(s,[],'betaflight');assert.equal(fields.length,8);assert.equal(fields.find(([label])=>label==='Flight controller')[1],'Board model');assert.equal(fields.find(([label])=>label.startsWith('How are'))[1],'RX on UART 2');assert.equal(fields.find(([label])=>label==='Support ID')[1],'abc123');
 const url=new URL(R.composer(s,[],'betaflight'));assert.equal(url.searchParams.get('template'),'firmware-bug-report.yml');assert.equal(url.searchParams.get('body'),null);assert.equal(R.composer(s,[],'betaflight_support'),'https://discord.betaflight.com/invite');
});
