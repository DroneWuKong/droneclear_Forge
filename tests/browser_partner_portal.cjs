const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const { partnerRuntime } = await import('./partner_runtime.mjs');
  const { runtime } = await partnerRuntime();
  const browser = await chromium.launch({ headless:true, ...(process.env.AUDIT_CHROMIUM ? {executablePath:process.env.AUDIT_CHROMIUM} : {}) });
  const directory = path.resolve(process.argv[2] || 'build');
  const origin = 'https://forge.test.localhost';
  const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.route('**/*',async route=>{
      const request=route.request(), url=new URL(request.url());
      if(url.origin!==origin)return route.abort();
      if(url.pathname.startsWith('/api/ecosystem/v1/')) {
        const response=await runtime.dispatchFetch(request.url(),{method:request.method(),headers:await request.allHeaders(),...(request.postData()?{body:request.postData()}: {})});
        return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
      }
      const file=path.join(directory,url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname);
      if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({status:200,contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
      return route.fulfill({status:404,body:'Missing local artifact'});
    });
    await page.goto(origin+'/partners/');
    const consent = page.locator('#uas-analytics-consent [data-reject]');
    if (await consent.isVisible()) await consent.click();
    assert.equal(await page.locator('#account-panel').isVisible(),true);
    assert.equal(await page.locator('#partner-workspace').isVisible(),false);
    for(const width of [320,390,1440]) {
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Account page must reflow at '+width);
    }
    await page.locator('#account-name').fill('Browser Partner');
    await page.locator('#company-name').fill('Browser OEM');
    await page.locator('#account-email').fill('browser@example.com');
    await page.locator('#account-password').fill('a synthetic browser test passphrase');
    await page.locator('#account-submit').click();
    await page.locator('#partner-workspace').waitFor({state:'visible'});
    assert.equal(await page.locator('#account-panel').isVisible(),false);
    assert.match(await page.locator('#identity').innerText(),/browser@example.com/);
    const product=[{productId:'browser-motor',revision:'r1',manufacturerName:'Browser OEM',partNumber:'MOTOR-42',name:'Browser motor',category:'MOTOR',compatibilityTags:['voltage:6s'],lifecycle:'ACTIVE',evidenceRefs:['datasheet:browser-motor']}];
    await page.locator('#file').setInputFiles({name:'products.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(product))});
    await page.locator('#save-drafts').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='DRAFTS SAVED');
    await page.locator('#records-list .card').waitFor();
    await page.reload();
    await page.locator('#partner-workspace').waitFor({state:'visible'});
    await page.locator('#records-list button').filter({hasText:'Edit draft'}).click();
    await page.locator('#records').fill(JSON.stringify([{...product[0],name:'Updated browser motor'}]));
    await page.locator('#save-drafts').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='DRAFTS SAVED');
    await page.locator('#resource').selectOption('BOMS');
    const org=await page.locator('#org-select').inputValue();
    const bom=[{bomId:'browser-bom',revision:'r1',productId:'browser-motor',productRevision:'r1',evidenceRefs:['drawing:browser-bom'],lines:[{lineId:'motor-line',slot:'motor',quantity:1,manufacturerId:org,productId:'browser-motor',productRevision:'r1',requiredCompatibilityTags:[],substitutionsAllowed:false}]}];
    const csv='bomId,revision,productId,productRevision,lines,evidenceRefs\n'+[bom[0].bomId,bom[0].revision,bom[0].productId,bom[0].productRevision,JSON.stringify(bom[0].lines),JSON.stringify(bom[0].evidenceRefs)].map(value=>'"'+value.replace(/"/g,'""')+'"').join(',');
    await page.locator('#file').setInputFiles({name:'bom.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await page.locator('#save-drafts').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='DRAFTS SAVED');
    await page.locator('#records-list .card').filter({hasText:'browser-bom'}).waitFor();
    for(const width of [320,390,1440]) {
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Workspace must reflow at '+width);
    }
    fs.mkdirSync('.local/design-review',{recursive:true});
    await page.screenshot({path:'.local/design-review/partner-workspace.png',fullPage:true});
    await page.locator('#logout').click();
    await page.locator('#account-panel').waitFor({state:'visible'});
    assert.equal(await page.locator('#partner-workspace').isVisible(),false);
    assert.equal(await page.locator('#records').inputValue(),'[]');
    await page.locator('#account-password').fill('incorrect password');
    await page.locator('#account-submit').click();
    await page.waitForFunction(()=>document.querySelector('#account-message').textContent.includes('incorrect'));
    await page.locator('#account-password').fill('a synthetic browser test passphrase');
    await page.locator('#account-submit').click();
    await page.locator('#partner-workspace').waitFor({state:'visible'});
    await page.locator('#records-list .card').filter({hasText:'browser-bom'}).waitFor();
    await page.locator('#records-list .card').filter({hasText:'browser-motor'}).getByRole('button',{name:'Edit draft'}).click();
    assert.equal(JSON.parse(await page.locator('#records').inputValue())[0].name,'Updated browser motor');
    assert.deepEqual(errors,[]);
    await page.locator('#logout').click();await page.locator('#show-signup').click();
    await page.screenshot({path:'.local/design-review/partner-signup.png',fullPage:true});
    console.log('Partner browser acceptance passed: signup, JSON/CSV upload, save, reload, edit, logout/login, persistence, and phone/desktop reflow.');
  } finally { await browser.close(); await runtime.dispose(); }
})().catch(error=>{console.error(error);process.exitCode=1});
