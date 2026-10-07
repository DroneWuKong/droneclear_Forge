// Only fixture reports are used here; this is acceptance of the Forge page.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const http=require('node:http');
const {chromium}=require('playwright');
const {checks}=require('../forge-source/test-lab.js');
const directory=path.resolve(process.argv[2]||'build');
(async()=>{
 const options={headless:true};if(process.env.AUDIT_CHROMIUM)options.executablePath=process.env.AUDIT_CHROMIUM;
 const posts=[],server=http.createServer((request,response)=>{
  const u=new URL(request.url,'http://localhost');
  if(request.method!=='GET'){let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{posts.push(body);response.writeHead(204);response.end();});return;}
  const file=path.resolve(directory,'.'+decodeURIComponent(u.pathname)+(u.pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(directory+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end('Missing local artifact');return;}
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.txt':'text/plain','.zip':'application/zip'};
  response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});response.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch(options);
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   if(new URL(route.request().url()).origin!==origin)return route.abort();
   return route.continue();
  });
  await page.goto(origin+'/test-lab/');
  await page.waitForFunction(()=>document.querySelector('#lab-status').textContent.startsWith('Ready.'));
  assert.equal(await page.locator('.check-row').count(),9);
  assert.equal(await page.locator('.status-chip.pass').count(),0);
  await page.locator('[data-profile="gauntlet"]').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('.check-row').count(),16);
  assert.match(await page.locator('#run-command').innerText(),/--profile gauntlet/);
  const bytes=fs.readFileSync(path.join(directory,'system-tests/profiles.json')),catalog=JSON.parse(bytes);
  const report={schema_version:1,tool:'forge-system-test-lab',tool_version:catalog.version,profile:'gauntlet',profile_version:catalog.version,catalog_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),config_sha256:'b'.repeat(64),recorded_at:'2026-10-07T12:00:00Z',system:{name:'PRIVATE-FIXTURE-SYSTEM',version:'1',source_commit:'a'.repeat(40)},scope:'local_software_preparation',certification:false,program_acceptance:false,commands_executed:false,results:checks(catalog,'gauntlet').map(row=>({id:row.id,kind:row.kind,status:row.kind==='external'?'external_required':row.kind==='review'?'review_required':'blocked',detail:'<img src=x onerror="globalThis.reportXss=true">',evidence:[]}))};
  const upload=async value=>page.locator('#report-file').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await upload(report);await page.waitForFunction(()=>document.querySelector('#lab-status').textContent.startsWith('Imported'));
  assert.match(await page.locator('#report-identity').innerText(),/PRIVATE-FIXTURE-SYSTEM/);
  assert.equal(await page.evaluate(()=>Boolean(globalThis.reportXss)),false);
  await page.locator('.review-label textarea').first().fill('PRIVATE-FIXTURE-REVIEW-NOTE');
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-review').click();const download=await downloadPromise;
  const review=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.equal(review.certification,false);assert.equal(review.report_verified,false);assert.equal(review.reviewer_notes.G01,'PRIVATE-FIXTURE-REVIEW-NOTE');
  await page.locator('#clear-report').click();await upload(review);await page.waitForFunction(()=>document.querySelector('#lab-status').textContent.startsWith('Imported saved review'));assert.equal(await page.locator('.review-label textarea').first().inputValue(),'PRIVATE-FIXTURE-REVIEW-NOTE');
  const bad=structuredClone(report);bad.results.at(-1).status='pass';await upload(bad);await page.waitForFunction(()=>document.querySelector('#lab-status').textContent.startsWith('Report rejected'));
  assert.match(await page.locator('#report-identity').innerText(),/PRIVATE-FIXTURE-SYSTEM/);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page must reflow at '+width);}
  fs.mkdirSync(path.resolve('.local/design-review'),{recursive:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.resolve('.local/design-review/test-lab-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.resolve('.local/design-review/test-lab-mobile.png'),fullPage:true});
  const kitPromise=page.waitForEvent('download');await page.locator('a[download]').click();const kit=await kitPromise;assert.equal(kit.suggestedFilename(),'forge-system-tests.zip');assert.ok(fs.statSync(await kit.path()).size>1000);
  await page.locator('#clear-report').click();assert.equal(await page.locator('.status-chip.pass').count(),0);assert.match(await page.locator('#report-identity').innerText(),/No system report/);
  await page.locator('[data-profile="dow"]').click();assert.equal(await page.locator('.check-row').count(),16);
  assert.equal(errors.length,0,errors.join('\n'));assert.ok(posts.every(body=>!body.includes('PRIVATE-FIXTURE')),'Report and notes must never be posted');
  const nojs=await browser.newContext({javaScriptEnabled:false});const plain=await nojs.newPage();await plain.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await plain.goto(origin+'/test-lab/');assert.ok(await plain.locator('noscript a').count()>=3);await nojs.close();
  console.log('System Test Lab browser acceptance passed: profiles, keyboard, imports, rejection, private export, downloads, 320/390/1440px, no-script fallback.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
