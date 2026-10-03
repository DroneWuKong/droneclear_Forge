// Run after an offline build: node tests/browser_site_accessibility.cjs [build-directory]
// Playwright may be supplied through NODE_PATH or CODEX_PRIMARY_RUNTIME_NODE_MODULES.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright'); }
const root = path.resolve(process.argv[2] || 'build');
const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml'};
(async () => {
  const options = {headless:true};
  if (process.env.AUDIT_CHROMIUM) options.executablePath = process.env.AUDIT_CHROMIUM;
  const browser = await playwright.chromium.launch(options);
  try {
    const page = await browser.newPage({viewport:{width:390,height:900},reducedMotion:'reduce'});
    let flagFixture = {status:200, body:[]}, releaseFlags;
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'forge.test.localhost') return route.abort();
      if (url.pathname === '/api/data' && url.searchParams.get('type') === 'flags') {
        const fixture = flagFixture;
        return (async () => {
          if (fixture.hold) await new Promise(resolve => { releaseFlags = resolve; });
          return route.fulfill({status:fixture.status,contentType:'application/json',body:JSON.stringify(fixture.body)});
        })();
      }
      const file = path.join(root,url.pathname.endsWith('/') ? url.pathname+'index.html' : url.pathname);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({status:200,contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
      return route.fulfill({status:404,body:'Local fixture unavailable'});
    });
    const go = async (route='/browse/') => { await page.goto('http://forge.test.localhost'+route); await page.waitForSelector(route.startsWith('/browse/') ? (route.includes('category=') ? '.browse-item-name' : 'button.browse-card') : 'button.doc-card'); };
    await go();
    assert.ok(await page.locator('button.browse-card').count() > 20, 'Categories must be native buttons');
    await page.locator('button.browse-card').first().focus();
    await page.keyboard.press('Enter');
    for (let i=0;i<3 && !await page.locator('.browse-item-name').count();i++) {
      const card = page.locator('button.browse-card').first();
      if (await card.count()) {
        try { await card.focus({timeout:1000}); await page.keyboard.press('Space'); }
        catch (error) {
          // Category rendering replaces the button grid asynchronously. A locator
          // may observe the old grid immediately before it is detached; accept that
          // race only when the intended part list has actually replaced it.
          await page.waitForSelector('.browse-item-name',{timeout:3000}).catch(()=>null);
          if (!await page.locator('.browse-item-name').count()) throw error;
        }
      }
      await page.waitForTimeout(100);
    }
    assert.ok(await page.locator('button.browse-item-name').count(), 'Keyboard category actions must reach part detail actions');
    await page.locator('button.browse-item-name').first().focus(); await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#detail-content').getAttribute('role'),'dialog');
    assert.equal(await page.locator('#detail-content').getAttribute('aria-modal'),'true');
    assert.ok(await page.locator('.browse-modal-close').evaluate(el => el === document.activeElement));
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.locator('#detail-content').evaluate(el => el.contains(document.activeElement)), 'Reverse Tab must remain inside dialog');
    await page.keyboard.press('Tab');
    assert.ok(await page.locator('.browse-modal-close').evaluate(el => el === document.activeElement), 'Forward Tab wraps to first control');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#detail-modal').isVisible(),false);
    assert.ok(await page.locator('button.browse-item-name').first().evaluate(el => el === document.activeElement), 'Escape restores invoking part button');
    const names = await page.locator('.browse-toolbar input,.browse-toolbar select').evaluateAll(els => els.map(el => ({id:el.id,labels:[...el.labels].map(l=>l.textContent.trim())})));
    assert.ok(names.length > 1 && names.every(el=>el.labels.some(Boolean)), 'Dynamic filters need associated visible labels');
    // The former inert Add button now starts a one-part build using the real share contract.
    const link = await page.locator('.browse-item-build').first().getAttribute('href');
    assert.ok(link.startsWith('/builder/?b='));
    assert.equal(await page.locator('.browse-item-build').first().textContent(),'Start build with this part');
    await go('/browse/?category=flight_controllers');
    await page.locator('.ndaa-pill[data-ndaa="ndaa"]').click();
    const part = await page.locator('.browse-item-name').first().textContent();
    const slug = part.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const flags = Array.from({length:5},(_,i)=>({id:'fixture-'+i,component_id:slug,title:'Matched fixture '+i,severity:'high',flag_type:'compliance',detail:'Synthetic evidence only'}));
    flags.push(...Array.from({length:3},(_,i)=>({id:'category-'+i,component_id:'flight_controllers',title:'Category fixture '+i,severity:'critical',flag_type:'supply_chain_risk'})));
    flagFixture = {status:200,hold:true,body:{data:{flags,generated_at:new Date().toISOString()}}};
    await go('/browse/?category=flight_controllers'); await page.locator('.browse-item-name').first().click();
    assert.match(await page.locator('.pie-flags').textContent(),/Research flags loading/);
    assert.equal(await page.locator('#detail-content').isVisible(),true,'A pending research dataset must not block catalog details');
    releaseFlags();
    await page.waitForFunction(()=>document.querySelector('.pie-flags')?.textContent.includes('Loaded dataset dated'));
    assert.ok(await page.locator('.browse-modal-close').evaluate(el=>el===document.activeElement),'Research refresh must preserve dialog focus');
    for (const state of ['unversioned','current','stale','unavailable','invalid','future']) {
      flagFixture = state==='unavailable' ? {status:503,body:{error:'Unavailable'}} : state==='invalid' ? {status:200,body:{flags:'wrong-shape'}} : {status:200,body:state==='unversioned' ? flags : {data:{flags,generated_at:new Date(Date.now() + (state==='stale'?-10*86400000:state==='future'?10*86400000:0)).toISOString()}}};
      await go('/browse/?category=flight_controllers'); await page.locator('.ndaa-pill[data-ndaa="ndaa"]').click(); await page.locator('.browse-item-name').first().click();
      await page.waitForFunction(()=>{const region=document.querySelector('.pie-flags');return region && !region.textContent.includes('Research flags loading');});
      const text = await page.locator('.pie-flags').textContent();
      if (state==='current') assert.match(text,/Loaded dataset dated/);
      if (state==='stale') assert.match(text,/Historical flags .*current coverage unverified/);
      if (state==='unversioned') assert.match(text,/Observation date not documented/);
      if (['unavailable','invalid','future'].includes(state)) assert.match(text,/Current research flags unavailable/);
      assert.ok(await page.locator('.pie-flag').count() <= 4, 'Part matching cap must remain visible and enforced');
      if (state==='current') {
        assert.equal(await page.locator('.pie-flag').count(),4);
        assert.equal(await page.locator('.pie-flag-title').filter({hasText:'Category fixture'}).count(),2,'NDAA selection must retain relevant category risk flags and the two-flag cap');
      }
    }
    flagFixture = {status:200,body:{data:{flags:[],generated_at:new Date().toISOString()}}};
    await go('/browse/?category=flight_controllers'); await page.locator('.browse-item-name').first().click();
    assert.match(await page.locator('.pie-flags').textContent(),/No matching flags in the loaded dataset.*does not establish that a part is risk-free/);
    await go('/waiver/');
    assert.equal(await page.locator('button.doc-card').count(),31);
    await page.locator('button.doc-card').first().focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('button.doc-card').first().getAttribute('aria-pressed'),'true');
    assert.ok(await page.locator('#wizard-title').evaluate(el=>el===document.activeElement));
    console.log('PASS: native category/part/document actions, modal focus/wrap/Escape/restore, visible dynamic labels, one-part Builder link, flag states/caps/no-match copy');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
