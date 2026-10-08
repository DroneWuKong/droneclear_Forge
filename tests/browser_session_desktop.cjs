// Cold first launch of the actual frozen executable. Only loopback networking
// is permitted; real MediaRecorder, UDP and disk ZIPs use synthetic inputs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),dgram=require('node:dgram');
const {spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const E=require('../forge-source/session-evidence.js');
const fixtures=require('./fixtures/session_mavlink.json').fixtures;
const evidenceFixtures=require('./fixtures/session_vehicle.json');
const executable=path.resolve(process.argv[2]||('build-desktop/native/Forge-UAS-Recorder'+(process.platform==='win32'?'.exe':'')));
(async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'forge-field-test-')),external=[],errors=[];
 const app=spawn(executable,['--no-browser','--http-port','0','--udp-port','0','--session-dir',folder],{stdio:['ignore','pipe','pipe']});
 let browser,stderr='',startup='';app.stderr.on('data',data=>stderr+=data);
 try{
  const config=await new Promise((resolve,reject)=>{
   const deadline=setTimeout(()=>reject(Error('Native startup timed out: '+stderr)),60000);
   app.once('error',error=>{clearTimeout(deadline);reject(error);});
   app.once('exit',code=>{clearTimeout(deadline);reject(Error('Native startup exited '+code+': '+stderr));});
   app.stdout.on('data',data=>{startup+=data;const first=startup.split('\n')[0];try{const config=JSON.parse(first);if(config.url){clearTimeout(deadline);resolve(config);}}catch{}});
  });
  const origin=new URL(config.url).origin;assert.equal(config.version,'1.2.0');
  assert.ok(!startup.includes('Connection key:'),'Native launch need not expose its connection key');
  browser=await chromium.launch({headless:true,...(process.env.AUDIT_CHROMIUM?{executablePath:process.env.AUDIT_CHROMIUM}:{})});
  async function offlineProfile(){
   const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1080}});
   await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();external.push(url.origin);return route.abort();});
   await context.addInitScript(()=>{
    // Internet is disconnected, but localhost remains available, as at a field.
    Object.defineProperty(navigator,'onLine',{get:()=>false});
    function video(label){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');function draw(){ctx.fillStyle='#172012';ctx.fillRect(0,0,640,360);ctx.fillStyle='#f3cd72';ctx.font='28px sans-serif';ctx.fillText(label+' '+performance.now().toFixed(0),30,170);}draw();setInterval(draw,80);return canvas.captureStream(12);}
    window.syntheticStreams=[];window.captureRequests=[];
    Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>[{kind:'videoinput',deviceId:'integrated',label:'Laptop camera'},{kind:'videoinput',deviceId:'usb',label:'USB bench camera'}]});
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{if(window.cancelNextPicker){window.cancelNextPicker=false;throw new DOMException('Picker cancelled','NotAllowedError');}const stream=video('GCS fixture '+window.syntheticStreams.length);window.syntheticStreams.push(stream);return stream;}});
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async options=>{window.captureRequests.push(options);const stream=video('Bench fixture'),track=stream.getVideoTracks()[0],settings=track.getSettings.bind(track);track.getSettings=()=>({...settings(),deviceId:options.video?.deviceId?.exact||'integrated'});if(options.audio){const ac=new AudioContext(),osc=ac.createOscillator(),dest=ac.createMediaStreamDestination();osc.connect(dest);osc.start();stream.addTrack(dest.stream.getAudioTracks()[0]);window.narrationContext=ac;}window.syntheticStreams.push(stream);return stream;}});
   });
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(config.url);await page.waitForFunction(()=>document.querySelector('#rec-status').textContent.startsWith('Ready.'));
   assert.match(await page.locator('#app-status').innerText(),/Standalone field app/);
   assert.match(await page.locator('#network-status').innerText(),/no internet/);
   assert.match(await page.locator('#helper-status').textContent(),/Connected/);
   assert.equal(await page.locator('#field-folder').isVisible(),true);
   assert.equal(await page.locator('#offline-downloads').isVisible(),false);
   return {context,page};
  }
  let {context,page}=await offlineProfile();
  await page.locator('button[data-view="developer"]').click();
  await page.locator('#session-title').fill('Offline field reproduction');
  await page.locator('#session-aircraft').fill('PX4 software fixture');
  await page.locator('#session-firmware').fill('fixture-commit');
  await page.locator('#session-stack').selectOption('px4');
  await page.locator('#session-test-mode').selectOption('sitl');
  await page.locator('#session-expected').fill('Mission becomes active');
  await page.locator('#session-steps').fill('Select Mission in the GCS');
  // The actual frozen helper returns allowlisted reads to the observed UDP peer.
  const peer=dgram.createSocket('udp4'),requests=[];
  await new Promise(resolve=>peer.bind(0,'127.0.0.1',resolve));
  function sendResponse(name){peer.send(Buffer.from(evidenceFixtures.responses[name],'hex'),config.udp_port,'127.0.0.1');}
  peer.on('message',bytes=>{requests.push(bytes[5]);if(bytes[5]===21){sendResponse('param_int_px4');sendResponse('param_float');}if(bytes[5]===117)sendResponse('log_entry');if(bytes[5]===119)for(const ofs of [0,90,180,270])sendResponse('log_'+ofs);});
  const heartbeat=setInterval(()=>sendResponse('heartbeat_px4'),700);sendResponse('heartbeat_px4');
  try{
   await page.waitForFunction(()=>!document.querySelector('#collect-params').disabled);
   await page.locator('#collect-params').click();await page.waitForFunction(()=>document.querySelector('#vehicle-status').textContent.startsWith('Collected and attached'));
   await page.locator('#list-vehicle-logs').click();await page.waitForFunction(()=>document.querySelector('#vehicle-log option[value="9"]'));
   await page.locator('#vehicle-log').selectOption('9');await page.locator('#collect-log').click();await page.waitForFunction(()=>document.querySelector('#vehicle-status').textContent.includes('Collected and attached vehicle-42-log-9.ulg'));
   assert.ok(requests.includes(21)&&requests.includes(117)&&requests.includes(119)&&requests.includes(122));
  }finally{clearInterval(heartbeat);peer.close();}
  for(const name of ['Mission Planner','MP CLI','Terminal']){await page.locator('#choose-screen').click();await page.waitForFunction(()=>!document.querySelector('#choose-screen').disabled);await page.locator('.rec-input-name input').last().fill(name);}
  await page.locator('#include-mic').check();await page.locator('#camera-device').selectOption('integrated');await page.locator('#choose-camera').click();await page.waitForFunction(()=>!document.querySelector('#choose-camera').disabled);await page.locator('.rec-input-name input').last().fill('Laptop camera');
  assert.equal(await page.locator('#camera-device').inputValue(),'usb');await page.locator('#choose-camera').click();await page.waitForFunction(()=>!document.querySelector('#choose-camera').disabled);await page.locator('.rec-input-name input').last().fill('USB bench camera');
  assert.equal(await page.locator('#capture-previews video').count(),5);
  assert.deepEqual(await page.evaluate(()=>window.captureRequests.map(o=>o.audio)),[true,false]);
  await page.locator('#camera-device').selectOption('integrated');await page.locator('#choose-camera').click();await page.waitForFunction(()=>document.querySelector('#rec-status').textContent.includes('already selected'));assert.equal(await page.locator('#capture-previews video').count(),5);
  await page.evaluate(()=>window.cancelNextPicker=true);await page.locator('#choose-screen').click();await page.waitForFunction(()=>!document.querySelector('#choose-screen').disabled);assert.equal(await page.locator('#capture-previews video').count(),5);
  for(let i=0;i<3;i++){await page.locator('#choose-screen').click();await page.waitForFunction(()=>!document.querySelector('#choose-screen').disabled);}
  await page.locator('#choose-screen').click();await page.waitForFunction(()=>document.querySelector('#rec-status').textContent.includes('Eight video'));assert.equal(await page.locator('#capture-previews video').count(),8);
  for(let i=0;i<3;i++)await page.locator('#capture-previews .rec-input-actions button').filter({hasText:'Remove'}).last().click();
  for(const width of [320,390,1366,1920,2560]){await page.setViewportSize({width,height:1080});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Workspace reflow '+width);assert.ok((await page.locator('#main').boundingBox()).width>width*.94,'Workspace uses width '+width);}
  await page.setViewportSize({width:1920,height:1080});assert.ok((await page.locator('[data-section=capture]').boundingBox()).width>1300);
  await page.locator('#fullscreen-workspace').click();await page.waitForFunction(()=>document.fullscreenElement?.id==='main');assert.equal(await page.locator('#fullscreen-workspace').textContent(),'Exit fullscreen');await page.locator('#fullscreen-workspace').click();await page.waitForFunction(()=>!document.fullscreenElement);
  fs.mkdirSync('.local/design-review',{recursive:true});await page.locator('[data-section=capture]').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:'.local/design-review/session-desktop-workspace-'+process.platform+'.png'});
  await page.locator('#capture-previews .rec-input-actions button').filter({hasText:'Focus'}).first().click();assert.equal(await page.locator('#capture-previews video:visible').count(),1);await page.locator('#preview-view').selectOption('');

  await page.locator('#start-recording').click();await page.waitForFunction(()=>!document.querySelector('#mark-event').disabled);
  const socket=dgram.createSocket('udp4'),packet=Buffer.from(fixtures.find(f=>f.name==='HEARTBEAT'&&f.wire_version===2).hex,'hex');
  await new Promise((resolve,reject)=>socket.send(packet,config.udp_port,'127.0.0.1',error=>error?reject(error):resolve()));socket.close();
  await page.waitForFunction(()=>document.querySelector('#live-observation').textContent.includes('reports armed'));
  await page.locator('button[data-layout="live"]').click();
  await page.waitForFunction(()=>document.querySelector('#live-team-values').textContent.includes('reports armed'));
  assert.match(await page.locator('#live-capture-state').innerText(),/Recording on this device/);
  assert.equal(await page.locator('#setup-title').isVisible(),false);
  await page.locator('#marker-note').fill('Team saw the Mission reproduction');await page.locator('#mark-event').click();
  await page.waitForFunction(()=>document.querySelector('#live-team-notes').textContent.includes('Team saw'));
  // Connection state changes do not stop the local recording or change its ID.
  await page.evaluate(()=>dispatchEvent(new Event('offline')));
  await page.locator('button[data-layout="workspace"]').click();
  assert.equal(await page.locator('#stop-recording').isEnabled(),true);
  await page.locator('button[data-layout="live"]').click();
  for(const width of [390,1440]){await page.setViewportSize({width,height:1080});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Live view reflow '+width);}
  fs.mkdirSync('.local/design-review',{recursive:true});
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.local/design-review/session-desktop-live-'+process.platform+'.png',fullPage:true});
  await page.waitForTimeout(1600);
  // Ending one chosen window leaves the other recorders running.
  await page.evaluate(()=>{const track=window.syntheticStreams[2].getVideoTracks()[0];track.stop();track.dispatchEvent(new Event('ended'));});
  await page.waitForFunction(()=>document.querySelector('#live-team-notes').textContent.includes('Terminal: video input ended'));
  assert.equal(await page.locator('#stop-recording').isEnabled(),true);await page.waitForTimeout(400);await page.locator('#stop-recording').click();
  await page.waitForFunction(()=>document.querySelector('#rec-status').textContent.startsWith('Saved locally.'),null,{timeout:30000});
  await page.locator('button[data-layout="workspace"]').click();
  assert.match(await page.locator('#archive-status').innerText(),/Saved on disk:/);
  const copies=fs.readdirSync(folder).filter(name=>name.endsWith('.zip'));assert.equal(copies.length,1);
  const copy=path.join(folder,copies[0]);let parsed=await E.verifyBundle(new Uint8Array(fs.readFileSync(copy)));
  assert.equal(parsed.session.tool_version,'1.2.0');assert.equal(parsed.session.state,'interrupted');
  assert.equal(parsed.session.sources.screen.inputs.length,3);assert.equal(parsed.session.sources.camera.inputs.length,2);
  assert.equal(parsed.session.sources.screen.inputs[2].status,'interrupted');
  for(const name of ['screen-2.webm','screen-3.webm','camera-2.webm'])assert.ok(parsed.files.get(name)?.length>100,name);
  assert.equal(parsed.session.files.find(f=>f.name==='camera.webm').has_audio,true);assert.equal(parsed.session.files.find(f=>f.name==='camera-2.webm').has_audio,false);
  const vehicleLog=parsed.session.files.find(f=>f.original_name==='vehicle-42-log-9.ulg'),params=parsed.session.files.find(f=>f.original_name.endsWith('.params'));
  assert.equal(Buffer.from(parsed.files.get(vehicleLog.name)).toString('hex'),evidenceFixtures.log_hex);assert.match(new TextDecoder().decode(parsed.files.get(params.name)),/TEST_INT\t1234567890/);assert.equal(vehicleLog.collection.system_id,42);
  assert.equal(await page.locator('#replay-previews video').count(),5);
  assert.ok(parsed.files.get('screen.webm')?.length>100);assert.ok(parsed.files.get('camera.webm')?.length>100);
  assert.ok(parsed.files.get('telemetry.tlog')?.length>8);
  assert.ok(parsed.timeline.some(row=>row.kind==='note'&&row.text.includes('Team saw')));
  const receipts=new TextDecoder().decode(parsed.files.get('telemetry-receipts.jsonl')).trim().split('\n').map(JSON.parse);
  assert.match(receipts[0].helper_received_unix_ns,/^[0-9]+$/);
  await page.locator('#session-actual').fill('Observed behavior recorded during the team call');
  await page.locator('#attach-log').setInputFiles({name:'flight.ulg',mimeType:'application/octet-stream',buffer:Buffer.from('original-field-log')});
  await page.waitForFunction(()=>document.querySelector('#evidence-files').textContent.includes('flight.ulg'));
  assert.equal(await page.locator('#session-actual').inputValue(),'Observed behavior recorded during the team call','Attaching a log preserves report drafts');
  assert.match(await page.locator('#archive-status').innerText(),/has updates/);
  await page.locator('#save-archive').click();await page.waitForFunction(()=>document.querySelector('#archive-status').textContent.startsWith('Saved on disk:')&&!document.querySelector('#save-archive').disabled);
  parsed=await E.verifyBundle(new Uint8Array(fs.readFileSync(copy)));
  assert.match(parsed.session.actual,/team call/);assert.ok(parsed.session.files.some(file=>file.original_name==='flight.ulg'));
  for(const target of ['px4','ardupilot','betaflight','betaflight_support','clickup','jira']){
   await page.locator('#report-destination').selectOption(target);
   const download=page.waitForEvent('download');await page.locator('#download-report').click();
   const data=fs.readFileSync(await (await download).path(),'utf8');assert.ok(data.length>100);
   if(target==='jira')assert.equal(JSON.parse(data).type,'doc');
  }
  assert.equal(await page.locator('#send-slack').isEnabled(),false);
  await context.close();
  // Empty IndexedDB/cache profile still opens the disk copy and replays evidence.
  ({context,page}=await offlineProfile());
  assert.equal(await page.locator('#saved-sessions option').count(),1);
  await page.locator('#archived-sessions').selectOption(parsed.session.id);await page.locator('#open-archive').click();
  await page.waitForFunction(()=>document.querySelector('#rec-status').textContent.startsWith('Imported session.'));
  assert.match(await page.locator('#session-summary').innerText(),/Offline field reproduction/);
  assert.equal(await page.locator('#play-session').isEnabled(),true);
  await page.locator('#play-session').click();await page.waitForFunction(()=>document.querySelector('#screen-replay').currentTime>0.1);
  await page.locator('#play-session').click();
  assert.equal(external.length,0,'No external requests even on a first offline launch');
  assert.equal(errors.length,0,errors.join('\n'));await context.close();
  console.log('Native '+process.platform+' checks passed: cold offline launch, automatic local UDP, five independent inputs, one microphone, source interruption, fullscreen/reflow, MAVLink parameters/logs, live view, disk copy/update, reports, fresh-profile reopen and replay.');
 }finally{
  if(browser)await browser.close();
  if(process.platform==='win32'&&app.pid){try{execFileSync('taskkill',['/pid',String(app.pid),'/T','/F'],{stdio:'ignore'});}catch{app.kill();}}else app.kill();
  await new Promise(resolve=>{if(app.exitCode!==null||app.signalCode!==null)return resolve();app.once('exit',resolve);});
  fs.rmSync(folder,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
