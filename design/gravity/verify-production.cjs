const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge',args:['--no-proxy-server','--disable-quic','--host-resolver-rules=MAP jingtiang.com 103.240.198.211']});
 const errors=[], results=[];
 try {
 for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width,height:1000}});
  page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()));
  page.on('response',r=>console.log('HTTP',r.status(),r.url()));
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.GRAVITY_PRODUCTION_URL || 'https://jingtiang.com',{waitUntil:'domcontentloaded',timeout:180000});
  await page.locator('h1').waitFor();
  await page.locator('#inspiration img').first().scrollIntoViewIfNeeded();
  for (const img of await page.locator('#inspiration img').all()) { await img.scrollIntoViewIfNeeded(); await img.evaluate(i=>i.complete&&i.naturalWidth>0 || new Promise((resolve,reject)=>{i.onload=resolve;i.onerror=reject;})); }
  await page.evaluate(()=>{document.querySelectorAll('*').forEach(el=>{if(el.scrollTop)el.scrollTop=0;});window.scrollTo(0,0);});
  const state=await page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth,heading:document.querySelector('h1').textContent}));
  assert.equal(state.overflow,false);assert.equal(state.bg,'rgb(8, 11, 12)');
  await page.screenshot({path:`design/gravity/qa/production-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'开始创作'}).click();
  await page.locator('input[type="password"]').waitFor();
  await page.screenshot({path:`design/gravity/qa/production-login-${width}.png`});
  results.push({width,...state,login:true});await page.close();
 }
 assert.deepEqual(errors,[]);
 await fs.writeFile('design/gravity/qa/production.json',JSON.stringify({results,errors},null,2));
 console.log(JSON.stringify({results,errors}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
