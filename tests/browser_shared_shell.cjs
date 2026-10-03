// Software-only browser acceptance for the shared menu, reading controls and apps.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const research=require('../forge-source/ask-pie-retrieval.js');
const directory=path.resolve(process.argv[2]||'build');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
(async()=>{const options={headless:true};if(process.env.AUDIT_CHROMIUM)options.executablePath=process.env.AUDIT_CHROMIUM;
const browser=await chromium.launch(options);try{const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[],apiRequests=[];let researchFixture=false;
const fixture={schema_version:1,meta:{generated_at:'2026-10-03T12:00:00Z',input_revision:'browser-fixture'},counts:{article:2},records:research.articleRecords([{aid:'uas-fixture',title:'Drone delivery test article',summary:'Civil aviation report',pub_date:'2026-10-01',url:'https://source.invalid/drone'},{aid:'sports-fixture',title:'Baseball test article',summary:'Sports report',pub_date:'2026-10-02',url:'https://source.invalid/sports'}]).map(research.compactRecord)};
page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='forge.test.localhost')return route.abort();
if(u.pathname.startsWith('/api/')){apiRequests.push(u.pathname);if(researchFixture&&u.searchParams.get('type')==='research_index')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:research.projectResearch(fixture,u.searchParams)})});return route.fulfill({status:404,contentType:'application/json',body:'{"error":"Synthetic unavailable record"}'});}
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

await page.evaluate(()=>renderEditorMediaList([{type:'video',url:'',caption:'Local fixture'}]));
assert.equal(await page.locator('#se-media-list [data-field="caption"]').inputValue(),'Local fixture');
for(const field of ['type','url','caption'])assert.ok(await page.locator('#se-media-list [data-field="'+field+'"]').evaluate(e=>e.labels.length>0),'Media fields need visible associated labels');
await page.goto('http://forge.test.localhost/software-library/');await page.waitForTimeout(150);assert.ok(Number(await page.locator('#totalCount').innerText())>0,'Software catalog must retain startup after shell replacement');
await page.goto('http://forge.test.localhost/intel/feed/');await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>typeof IntelNormalization),'object');
// Test the actual current-build UI against shipped catalog values and browser storage.
await page.setViewportSize({width:390,height:844});
await page.evaluate(()=>localStorage.setItem('forge-build',JSON.stringify([{pid:'ESC-1155',name:'Legacy ESC',cat:'escs'}])));
await page.goto('http://forge.test.localhost/builder/');await page.waitForFunction(()=>document.querySelector('#new-build')?.disabled===false);
assert.match(await page.locator('#cat-title').innerText(),/Frames/i);
await page.locator('#build-name').fill('Bench list');await page.locator('#rename-build').click();
await page.locator('#review-build').click();await page.locator('[data-quantity="ESC-1155"]').fill('4');await page.locator('[data-quantity="ESC-1155"]').press('Tab');
assert.equal(await page.locator('#bom-cost').innerText(),'$794.00');await page.keyboard.press('Escape');
await page.locator('#build-cost-link').click();await page.waitForFunction(()=>document.querySelector('#cost-gauges')?.textContent.includes('794'));
assert.match(await page.locator('#bom-output').innerText(),/4/);await page.locator('#return-build').click();await page.waitForFunction(()=>document.querySelector('[data-quantity]')?.value==='4');await page.keyboard.press('Escape');
await page.locator('#new-build').click();assert.equal(await page.locator('#build-count').innerText(),'0');
await page.locator('#saved-builds').selectOption('legacy');assert.equal(await page.locator('#build-count').innerText(),'1');
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('forge-build'))[0].name),'Legacy ESC','Migration preserves old bytes');
const oldShare=Buffer.from(JSON.stringify(['FRM-1003'])).toString('base64url');
await page.goto('http://forge.test.localhost/builder/?b='+oldShare);await page.waitForFunction(()=>document.querySelector('#new-build')?.disabled===false);
assert.equal(await page.locator('#build-name').inputValue(),'Shared build');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('forge.builds.v1')).builds.length),2,'Opening a link does not overwrite saved work');
await page.locator('#rename-build').click();await page.goto('http://forge.test.localhost/guide/');await page.waitForFunction(()=>document.querySelector('[data-build-context]')?.textContent.includes('Shared build'));assert.match(await page.locator('[data-build-context]').innerText(),/Shared build/);
await page.goto('http://forge.test.localhost/tools-home/');await page.locator('#tool-search').fill('cost');await page.waitForFunction(()=>document.querySelector('#tool-results').textContent.includes('Cost estimate'));assert.equal(await page.locator('#tool-results a').count(),1);
researchFixture=true;
await page.goto('http://forge.test.localhost/ask-pie/');assert.equal(await page.locator('#answer-summary').isVisible(),false);await page.locator('#ask-query').fill('drone');await page.locator('#ask-form button').click();await page.waitForFunction(()=>document.querySelector('#save-packet')?.disabled===false);assert.equal(await page.locator('#answer-summary').isVisible(),true);await page.locator('#save-packet').click();await page.reload();await page.waitForFunction(()=>document.querySelector('#saved-packets')?.textContent.includes('drone'));await page.waitForFunction(()=>document.querySelector('#save-packet')?.disabled===false);assert.match(await page.locator('#advanced-search').getAttribute('href'),/q=drone/);
await page.goto('http://forge.test.localhost/intel/feed/');await page.waitForFunction(()=>document.querySelector('#news-scope')?.disabled===false);assert.match(await page.locator('#feed-list').innerText(),/Drone delivery/);assert.doesNotMatch(await page.locator('#feed-list').innerText(),/Baseball/);await page.locator('#news-scope').selectOption('all-articles');await page.waitForFunction(()=>document.querySelector('#feed-list').textContent.includes('Baseball'));assert.match(await page.locator('#feed-list').innerText(),/unclassified/);
assert.deepEqual(errors,[]);console.log('PASS: closed/open menu focus, Tab wrap/Escape restore, 9 reading-size viewport states, setting persistence, Audit request/failure, Guide detail/edit/save/reload at phone and desktop, Intel dependencies');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
