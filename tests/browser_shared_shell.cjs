// Software-only browser acceptance for the shared menu, reading controls and apps.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const directory=path.resolve(process.argv[2]||'build');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
(async()=>{const options={headless:true};if(process.env.AUDIT_CHROMIUM)options.executablePath=process.env.AUDIT_CHROMIUM;
const browser=await chromium.launch(options);try{const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[],apiRequests=[];
page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='forge.test.localhost')return route.abort();
if(u.pathname.startsWith('/api/')){apiRequests.push(u.pathname);return route.fulfill({status:404,contentType:'application/json',body:'{"error":"Synthetic unavailable record"}'});}
const file=path.join(directory,u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname);if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({status:200,contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});return route.fulfill({status:404,body:'Missing local artifact'});});
await page.goto('http://forge.test.localhost/');await page.waitForTimeout(100);
assert.equal(await page.locator('#dc-drawer').isVisible(),false);
for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert.equal(await page.locator('#dc-drawer').evaluate(el=>el.contains(document.activeElement)),false,'Closed drawer must not capture Tab');}
await page.locator('#dc-hamburger').focus();await page.keyboard.press('Enter');
assert.equal(await page.locator('#dc-hamburger').getAttribute('aria-expanded'),'true');
assert.ok(await page.locator('#dc-drawer-close').evaluate(el=>el===document.activeElement));
await page.keyboard.press('Shift+Tab');assert.ok(await page.locator('#dc-drawer').evaluate(el=>el.contains(document.activeElement)));
await page.keyboard.press('Tab');assert.ok(await page.locator('#dc-drawer-close').evaluate(el=>el===document.activeElement));
await page.keyboard.press('Escape');assert.equal(await page.locator('#dc-drawer').isVisible(),false);assert.equal(await page.locator('#dc-hamburger').getAttribute('aria-expanded'),'false');assert.ok(await page.locator('#dc-hamburger').evaluate(el=>el===document.activeElement));
for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});for(const value of ['default','large','xlarge']){
await page.locator('[data-text-size-control]').click();await page.locator('.uas-text-size-panel:not([hidden]) input[value="'+value+'"]').check();await page.waitForTimeout(40);
const box=await page.locator('.uas-text-size-panel:not([hidden])').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,'Reading popup must stay in viewport');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,'Reading setting must not create page overflow');
await page.keyboard.press('Escape');assert.ok(await page.locator('[data-text-size-control]').evaluate(el=>el===document.activeElement));
}}
await page.locator('[data-text-size-control]').click();await page.locator('.uas-text-size-panel:not([hidden]) input[value="default"]').check();await page.keyboard.press('Escape');
await page.reload();assert.equal(await page.evaluate(()=>document.documentElement.dataset.uasTextSize),'default');
if(await page.locator('#uas-analytics-consent [data-reject]').isVisible())await page.locator('#uas-analytics-consent [data-reject]').click();
await page.goto('http://forge.test.localhost/audit/');await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>typeof initAuditPage),'function');await page.locator('#audit-sn-input').fill('LOCAL-SYNTHETIC-RECORD');await page.locator('#btn-audit-search').click();await page.waitForTimeout(100);assert.ok(apiRequests.some(p=>p.startsWith('/api/audit/')));assert.match(await page.locator('body').innerText(),/Build record not found/);
await page.goto('http://forge.test.localhost/guide/');await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>typeof initGuidePage),'function');assert.ok(await page.locator('.guide-card').count()>0,'Shipped guide cards must initialize');await page.locator('.guide-card').first().click();await page.waitForFunction(()=>guideState.phase==='overview');
for(const width of [390,1440]){await page.setViewportSize({width,height:900});await page.locator('#btn-mode-edit').click();assert.equal(await page.evaluate(()=>guideState.phase),'editing');
await page.locator('#btn-new-guide').click();await page.waitForFunction(()=>guideState.editingGuide?.name==='New Guide');
const pid=await page.locator('#ge-pid').inputValue();await page.locator('#ge-name').fill('Local acceptance guide '+width);await page.locator('#btn-save-guide').click();
await page.waitForFunction(w=>guideState.editingGuide?.name==='Local acceptance guide '+w,width);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,'Guide editor must fit phone and desktop');
await page.reload();await page.locator('#btn-mode-edit').click();await page.locator('.guide-editor-guide-item').filter({hasText:pid}).click();await page.waitForFunction(p=>guideState.editingGuide?.pid===p,pid);
assert.equal(await page.locator('#ge-name').inputValue(),'Local acceptance guide '+width,'Local guide must survive reload');}

await page.goto('http://forge.test.localhost/intel/feed/');await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>typeof IntelNormalization),'object');
assert.deepEqual(errors,[]);console.log('PASS: closed/open menu focus, Tab wrap/Escape restore, 9 reading-size viewport states, setting persistence, Audit request/failure, Guide detail/edit/save/reload at phone and desktop, Intel dependencies');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
