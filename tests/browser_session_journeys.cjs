// Guided first-use and support-report walkthrough. These are automated
// interactions, not participant research or a measurement of human speed.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.argv[2]||'build');
(async()=>{
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');const file=path.resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.txt':'text/plain'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1366,height:768},acceptDownloads:true});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/session-recorder/');await page.waitForFunction(()=>document.querySelector('#rec-status').textContent.startsWith('Ready.'));
  assert.equal(await page.locator('#session-firmware').isVisible(),false,'Guided setup initially conceals technical fields');
  await page.locator('#session-title').fill('Guided support journey');
  assert.equal(await page.locator('#choose-screen').isVisible(),true);assert.equal(await page.locator('[data-section=report]').isVisible(),false);assert.equal(await page.locator('[data-section=replay]').isVisible(),false);
  assert.ok(await page.locator('#start-recording').evaluate(button=>{const rect=button.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight;}),'Start is visible on first load without reading or scrolling through setup');
  await page.locator('#start-recording').click();await page.locator('#marker-note').fill('Observed the problem');await page.locator('#mark-event').click();
  await page.locator('#stop-recording').click();await page.waitForFunction(()=>document.querySelector('#rec-status').textContent.startsWith('Saved locally.'));
  assert.equal(await page.locator('body').getAttribute('data-stage'),'evidence');assert.equal(await page.locator('#replay-title').isVisible(),true);assert.equal(await page.locator('#choose-screen').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'replay-title');
  await page.locator('a[data-stage=report]').click();
  await page.locator('#session-actual').fill('My report draft before attaching the log');
  await page.locator('a[data-stage=evidence]').click();await page.locator('#attach-log').setInputFiles({name:'fixture.log',mimeType:'text/plain',buffer:Buffer.from('Original test log')});
  await page.waitForFunction(()=>document.querySelector('#evidence-files').textContent.includes('fixture.log'));
  assert.equal(await page.locator('#session-actual').inputValue(),'My report draft before attaching the log');
  await page.locator('a[data-stage=report]').click();await page.locator('#report-destination').selectOption('jira');
  assert.match(await page.locator('#report-preview').textContent(),/^Guided support journey\n/);
  assert.match(await page.locator('#copy-report').textContent(),/Jira editor/);
  await page.locator('#copy-report').click();await page.waitForFunction(()=>document.querySelector('#rec-status').textContent==='Formatted report copied.');
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/My report draft before attaching the log/);
  let download=page.waitForEvent('download');await page.locator('#download-report').click();
  assert.equal(JSON.parse(fs.readFileSync(await (await download).path(),'utf8')).type,'doc','Jira download remains valid ADF');
  await page.locator('#complete-report').click();assert.equal(await page.locator('#technical-details').evaluate(node=>node.open),true);
  assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SUMMARY');
  await page.locator('button[data-view="developer"]').click();assert.equal(JSON.parse(await page.locator('#report-preview').textContent()).type,'doc');
  await page.locator('button[data-view="guided"]').click();assert.match(await page.locator('#report-preview').textContent(),/^Guided support journey\n/);
  // Detail drawers cannot push recording controls or review below a long setup column.
  await page.locator('a[data-stage=record]').click();assert.ok(await page.locator('#start-recording').evaluate(e=>e.getBoundingClientRect().bottom<innerHeight));
  await page.locator('#capture-help').click();assert.equal(await page.locator('#window-capture-help').isVisible(),true);assert.match(await page.locator('#window-capture-help').textContent(),/minimized/);
  fs.mkdirSync('.local/design-review',{recursive:true});
  for(const width of [320,390,1366]){
   await page.setViewportSize({width,height:768});await page.locator('a[data-stage=record]').click();await page.evaluate(()=>scrollTo(0,0));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Guided reflow '+width);
   await page.screenshot({path:'.local/design-review/session-journey-guided-'+width+'.png'});
  }
  await page.locator('a[data-stage=evidence]').click();await page.locator('#replay-title').scrollIntoViewIfNeeded();await page.screenshot({path:'.local/design-review/session-journey-replay.png'});
  assert.equal(errors.length,0,errors.join('\n'));await context.close();
  console.log('Guided journeys passed: source/record navigation, notes-only capture, review focus, draft preservation, readable Jira clipboard, valid ADF download, detail recovery and desktop/mobile reflow.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
