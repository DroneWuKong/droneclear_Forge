// Cold first launch of the actual frozen executable. Only loopback networking
// is permitted; real MediaRecorder, UDP and disk ZIPs use synthetic inputs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),dgram=require('node:dgram');
const {spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const E=require('../forge-source/session-evidence.js');
const fixtures=require('./fixtures/session_mavlink.json').fixtures;
const executable=path.resolve(process.argv[2]||('build/session-desktop/native/Forge-UAS-Recorder'+(process.platform==='win32'?'.exe':'')));
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
  const origin=new URL(config.url).origin;assert.equal(config.version,'1.1.0');
  assert.ok(!startup.includes('Connection key:'),'Native launch need not expose its connection key');
  browser=await chromium.launch({headless:true,...(process.env.AUDIT_CHROMIUM?{executablePath:process.env.AUDIT_CHROMIUM}:{})});
  async function offlineProfile(){
   const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1080}});
   await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();external.push(url.origin);return route.abort();});
   await context.addInitScript(()=>{
    // Internet is disconnected, but localhost remains available, as at a field.
    Object.defineProperty(navigator,'onLine',{get:()=>false});
    function video(label){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');function draw(){ctx.fillStyle='#172012';ctx.fillRect(0,0,640,360);ctx.fillStyle='#f3cd72';ctx.font='28px sans-serif';ctx.fillText(label+' '+performance.now().toFixed(0),30,170);}draw();setInterval(draw,80);return canvas.captureStream(12);}
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>video('GCS fixture')});
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>video('Bench fixture')});
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
  await page.locator('#session-title').fill('Offline field reproduction');
  await page.locator('#session-aircraft').fill('PX4 software fixture');
  await page.locator('#session-firmware').fill('fixture-commit');
  await page.locator('#session-stack').selectOption('px4');
  await page.locator('#session-test-mode').selectOption('sitl');
  await page.locator('#session-expected').fill('Mission becomes active');
  await page.locator('#session-steps').fill('Select Mission in the GCS');
  await page.locator('#choose-screen').click();await page.waitForFunction(()=>document.querySelector('#screen-preview').srcObject);
  await page.locator('#choose-camera').click();await page.waitForFunction(()=>document.querySelector('#camera-preview').srcObject);
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
  await page.waitForTimeout(1600);await page.locator('#stop-recording').click();
  await page.waitForFunction(()=>document.querySelector('#rec-status').textContent.startsWith('Saved locally.'),null,{timeout:30000});
  await page.locator('button[data-layout="workspace"]').click();
  assert.match(await page.locator('#archive-status').innerText(),/Saved on disk:/);
  const copies=fs.readdirSync(folder).filter(name=>name.endsWith('.zip'));assert.equal(copies.length,1);
  const copy=path.join(folder,copies[0]);let parsed=await E.verifyBundle(new Uint8Array(fs.readFileSync(copy)));
  assert.equal(parsed.session.tool_version,'1.1.0');assert.equal(parsed.session.state,'finished');
  assert.ok(parsed.files.get('screen.webm')?.length>100);assert.ok(parsed.files.get('camera.webm')?.length>100);
  assert.ok(parsed.files.get('telemetry.tlog')?.length>8);
  assert.ok(parsed.timeline.some(row=>row.kind==='note'&&row.text.includes('Team saw')));
  const receipts=new TextDecoder().decode(parsed.files.get('telemetry-receipts.jsonl')).trim().split('\n').map(JSON.parse);
  assert.match(receipts[0].helper_received_unix_ns,/^[0-9]+$/);
  await page.locator('#session-actual').fill('Observed behavior recorded during the team call');
  await page.locator('#attach-log').setInputFiles({name:'flight.ulg',mimeType:'application/octet-stream',buffer:Buffer.from('original-field-log')});
  await page.waitForFunction(()=>document.querySelector('#evidence-files').textContent.includes('flight.ulg'));
  await page.locator('#session-actual').fill('Observed behavior recorded during the team call');
  await page.locator('#save-archive').click();await page.waitForFunction(()=>document.querySelector('#archive-status').textContent.startsWith('Saved on disk:')&&!document.querySelector('#save-archive').disabled);
  parsed=await E.verifyBundle(new Uint8Array(fs.readFileSync(copy)));
  assert.match(parsed.session.actual,/team call/);assert.ok(parsed.session.files.some(file=>file.original_name==='flight.ulg'));
  for(const target of ['px4','ardupilot','betaflight','clickup','jira']){
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
  console.log('Native '+process.platform+' checks passed: cold offline launch, automatic local UDP, real media encoding, live view, disk copy/update, reports, fresh-profile reopen and replay.');
 }finally{
  if(browser)await browser.close();
  if(process.platform==='win32'&&app.pid){try{execFileSync('taskkill',['/pid',String(app.pid),'/T','/F'],{stdio:'ignore'});}catch{app.kill();}}else app.kill();
  await new Promise(resolve=>{if(app.exitCode!==null||app.signalCode!==null)return resolve();app.once('exit',resolve);});
  fs.rmSync(folder,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
