// Exercise the shipped shell on both product domains, including zoom and routing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(process.argv[2] || 'build');
const mime = {'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript',
  '.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};

async function serve(context) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['uas-forge.com','uas-patterns.com'].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({status:503,
      contentType:'application/json',body:'{"error":"Synthetic unavailable data"}'});
    const file = path.resolve(root, '.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
      return route.fulfill({status:404,body:'Missing local artifact'});
    // Keep search input usable while the directory request is still pending.
    if (url.pathname === '/static/site-directory.json') await new Promise(resolve => setTimeout(resolve, 200));
    return route.fulfill({contentType:mime[path.extname(file)] || 'application/octet-stream',body:fs.readFileSync(file)});
  });
}

(async () => {
  const browser = await chromium.launch({headless:true,
    ...(process.env.AUDIT_CHROMIUM ? {executablePath:process.env.AUDIT_CHROMIUM} : {})});
  try {
    const context = await browser.newContext(); await serve(context);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const cases = [
      ['uas-forge.com','/suppliers/','build','EU suppliers'],
      ['uas-patterns.com','/suppliers/','research','EU suppliers'],
      ['uas-patterns.com','/ttps/','research','Defense signals'],
      ['uas-forge.com','/builder/','build','My build'],
      ['uas-patterns.com','/builder/','research','My build','build'],
    ];
    for (const [host,route,area,label,selectedGroup=area] of cases) {
      for (const width of [320,390,1440]) {
        await page.setViewportSize({width,height:844});
        await page.goto('https://' + host + route);
        for (const size of ['default','xlarge']) {
          await page.locator('[data-text-size-control]').click();
          await page.locator('.uas-text-size-panel:not([hidden]) input[value="'+size+'"]').check();
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('#dc-nav-page').innerText(), label);
          assert.equal(await page.locator('#dc-nav-page').isVisible(), true);
          assert.equal(await page.locator('#dc-nav-right').isVisible(), width > 760);
          const height = await page.locator('#dc-nav').evaluate(el => el.getBoundingClientRect().height);
          if (width <= 760) assert.ok(height <= 90, 'Compact mobile header: '+height);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
          const consentVisible = await page.locator('#uas-analytics-consent').isVisible();
          await page.locator('#dc-hamburger').click();
          assert.equal(await page.locator('#uas-analytics-consent').isVisible(),false,'Consent banner must not cover the modal menu');
          assert.equal(await page.locator('#uas-analytics-choices').isVisible(),false,'Privacy button must not cover the modal menu');
          assert.equal(await page.locator('#dc-area-switch [aria-current]').getAttribute('data-uas-link'), area);
          const active = page.locator('#dc-drawer [aria-current="page"]');
          assert.equal(await active.count(), 1);
          assert.equal(await active.evaluate(el => el.closest('[data-area]').dataset.area), selectedGroup);
          for (const workspace of ['research','build','learn'])
            assert.equal(await page.locator('#dc-area-switch [data-uas-link="'+workspace+'"]').isVisible(), true);
          // Wait for the opening transition before checking the off-canvas edge.
          await page.waitForTimeout(320);
          const bounds = await page.locator('#dc-drawer').boundingBox();
          assert.ok(bounds.x >= -1 && bounds.x+bounds.width <= width+1);
          assert.ok(await page.locator('#dc-drawer-close').evaluate(el => {
            const b=el.getBoundingClientRect(), hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
            return hit===el || el.contains(hit);
          }));
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('#dc-drawer').isVisible(), false);
          assert.equal(await page.locator('#uas-analytics-consent').isVisible(),consentVisible,'Closing the menu must restore consent controls');
          assert.ok(await page.locator('#dc-hamburger').evaluate(el => el===document.activeElement));
        }
      }
    }
    // Follow actual supplier links from each workspace, then exercise directory search.
    for (const [host,area] of [['uas-forge.com','build'],['uas-patterns.com','research']]) {
      await page.setViewportSize({width:390,height:844});
      await page.goto('https://'+host+(area==='build' ? '/' : '/patterns-home/'));
      await page.locator('#dc-hamburger').click();
      await page.locator('[data-area="'+area+'"] [data-page="suppliers"]').click();
      assert.equal(new URL(page.url()).hostname,host);
      assert.equal(new URL(page.url()).pathname,'/suppliers/');
      await page.goto('https://'+host+'/tools-home/?area='+ (area==='build' ? 'Build' : 'Research'));
      await page.locator('#tool-search').fill('European supplier');
      await page.waitForFunction(() => document.querySelectorAll('#tool-results a').length === 1 && document.querySelector('#tool-results a').textContent.includes('EU suppliers'));
      assert.equal(await page.locator('#tool-results a').count(),1);
      assert.equal(await page.locator('#tool-results a').getAttribute('href'),'https://'+host+'/suppliers/');
    }
    assert.deepEqual(errors, []);
    const noJs = await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    await serve(noJs); const fallback = await noJs.newPage();
    await fallback.goto('https://uas-forge.com/suppliers/');
    assert.equal(await fallback.locator('#dc-nav-page').innerText(),'EU suppliers');
    assert.equal(await fallback.locator('#dc-nav-right').isVisible(),true,'Workspace links survive disabled JS');
    await fallback.goto('https://uas-patterns.com/tools-home/');
    assert.ok(await fallback.locator('a[href="https://uas-patterns.com/suppliers/"]').count()>0);
    console.log('PASS navigation: both domains, 30 viewport/text states, compact page context, menu focus, supplier journeys, shared search, and no-JS links');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
