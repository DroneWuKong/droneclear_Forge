const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium} = require('playwright');

(async()=>{
  const root=path.resolve(process.argv[2] || 'build');
  const server=http.createServer((req,res)=>{
    let relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(relative.endsWith('/'))relative+='index.html';
    const file=path.resolve(root,'.'+relative);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser=await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/suppliers/');
    await page.waitForSelector('#supplier-id');
    assert.equal(await page.locator('.supplier-profile').count(),5);
    assert.equal(await page.locator('.supplier-offer').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const db=JSON.parse(fs.readFileSync(path.join(root,'static/forge_database.json'),'utf8'));
    const [category,parts]=Object.entries(db.components).find(([,rows])=>rows.some(p=>p.pid));
    const part=parts.find(p=>p.pid);
    const now=new Date(), date=now.toISOString().slice(0,10);
    const datasets={};
    for(const name of ['suppliers','offers','changes','fx','health'])datasets[name]=JSON.parse(fs.readFileSync(path.join(root,`data/suppliers/${name}.v1.json`),'utf8'));
    datasets.offers.offers=[{offer_id:'test-offer',supplier_id:'SUP-DE-FPV24',part_id:part.pid,
      identity:{name:'Test component <script>alert(1)</script>'},price:{amount:'10.00',currency:'EUR',tax:'unknown',pack_quantity:null},
      availability:{status:'in_stock',quantity:10,quantity_kind:'lower_bound_exclusive',lead_time_days:null},ships_from:[],
      observed_at:now.toISOString(),expires_at:new Date(+now+72*3600000).toISOString(),source_url:'https://www.fpv24.com/en/test/component'}];
    datasets.fx={date,rates:{EUR:'1',USD:'1.15'}};
    const bodies=Object.fromEntries(Object.entries(datasets).map(([name,value])=>[name+'.v1.json',JSON.stringify(value)]));
    const manifest={schema:'forge.supplier-manifest.v1',files:Object.fromEntries(Object.entries(bodies).map(([name,value])=>[name,crypto.createHash('sha256').update(value).digest('hex')]))};
    bodies['manifest.v1.json']=JSON.stringify(manifest);
    await page.route('**/data/suppliers/*.json',route=>route.fulfill({contentType:'application/json',body:bodies[new URL(route.request().url()).pathname.split('/').pop()]}));
    await page.reload();await page.waitForSelector('.supplier-offer');
    await page.locator('[data-supplier-currency]').selectOption('USD');
    assert.match(await page.locator('.supplier-price').textContent(),/11\.50/);
    assert.match(await page.locator('.supplier-offer').textContent(),/more than 10/);
    assert.equal(await page.locator('.supplier-offer script').count(),0);
    await page.locator('#supplier-availability').selectOption('out_of_stock');
    assert.equal(await page.locator('.supplier-offer').count(),0);
    await page.goto(base+'/builder/?category='+encodeURIComponent(category),{waitUntil:'domcontentloaded'});
    await page.locator(`.part-card[data-pid=${JSON.stringify(part.pid)}] .part-details`).click();
    await page.waitForSelector('#builder-supplier-offers .supplier-offer');
    assert.match(await page.locator('#builder-supplier-offers .supplier-price').textContent(),/11\.50/);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS supplier directory, mobile layout, currency choice, stock filter, escaped source text, and Builder offer panel');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
